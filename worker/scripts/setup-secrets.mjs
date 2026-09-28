#!/usr/bin/env node
// ================================================
// Pose les secrets du Worker SANS qu'ils apparaissent nulle part : ni à l'écran, ni dans
// un fichier, ni dans l'historique du terminal. Les valeurs générées passent directement
// de ce script à `wrangler secret put` par l'entrée standard.
//
//   npm run setup-secrets            → production (Cloudflare)
//   npm run setup-secrets -- --dev   → écrit .dev.vars pour `npm run dev` (valeurs locales)
//   npm run setup-secrets -- --force → régénère même les secrets déjà présents (voir ci-dessous)
//
// ATTENTION à --force : régénérer ENCRYPTION_KEY rend illisibles les refresh tokens déjà
// stockés (il faudra se reconnecter partout) ; régénérer les clés VAPID invalide les
// abonnements push existants (il faudra réactiver les notifications sur chaque appareil).
// ================================================
import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';

const args = new Set(process.argv.slice(2));
const DEV = args.has('--dev');
const FORCE = args.has('--force');

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

const generate = async () => {
  const encryptionKey = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { ENCRYPTION_KEY: encryptionKey, VAPID_PUBLIC_KEY: b64url(publicRaw), VAPID_PRIVATE_KEY: jwk.d };
};

const wrangler = (cmd, opts = {}) =>
  spawnSync(`npx wrangler ${cmd}`, { shell: true, encoding: 'utf8', ...opts });

const existingSecrets = () => {
  const r = wrangler('secret list');
  if (r.status !== 0) {
    console.error("Impossible de lister les secrets. As-tu fait `npx wrangler login` puis `npx wrangler deploy` une première fois ?");
    console.error(r.stderr || r.stdout);
    process.exit(1);
  }
  return new Set([...(r.stdout || '').matchAll(/"name"\s*:\s*"([^"]+)"/g)].map(m => m[1]));
};

const main = async () => {
  const generated = await generate();

  if (DEV) {
    if (existsSync('.dev.vars') && !FORCE) {
      console.log('.dev.vars existe déjà (utilise --force pour le régénérer).');
      return;
    }
    writeFileSync('.dev.vars', [
      '# Valeurs LOCALES générées par setup-secrets --dev. Ne pas réutiliser en production.',
      'GOOGLE_CLIENT_SECRET=',
      `ENCRYPTION_KEY=${generated.ENCRYPTION_KEY}`,
      `VAPID_PUBLIC_KEY=${generated.VAPID_PUBLIC_KEY}`,
      `VAPID_PRIVATE_KEY=${generated.VAPID_PRIVATE_KEY}`,
      'ALLOWED_EMAILS=',
      '',
    ].join('\n'));
    console.log('.dev.vars écrit (clés de dev). Complète GOOGLE_CLIENT_SECRET et ALLOWED_EMAILS si tu veux tester la connexion en local.');
    return;
  }

  const present = existingSecrets();

  // 1. Secrets générés : clé de chiffrement + paire VAPID (les deux clés VAPID vont
  //    ensemble — ne jamais en régénérer une seule).
  const vapidMissing = !present.has('VAPID_PUBLIC_KEY') || !present.has('VAPID_PRIVATE_KEY');
  const toSet = [];
  if (FORCE || !present.has('ENCRYPTION_KEY')) toSet.push('ENCRYPTION_KEY');
  if (FORCE || vapidMissing) toSet.push('VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY');

  for (const name of toSet) {
    const r = wrangler(`secret put ${name}`, { input: generated[name] });
    if (r.status !== 0) { console.error(`Échec pour ${name} :`, r.stderr || r.stdout); process.exit(1); }
    console.log(`✔ ${name} généré et enregistré`);
  }
  if (toSet.length === 0) console.log('✔ Clés de chiffrement et VAPID déjà présentes (inchangées)');

  // 2. Secrets que TOI seul connais : wrangler te les demande directement (saisie masquée).
  for (const [name, hint] of [
    ['GOOGLE_CLIENT_SECRET', 'le « Code secret du client » de ton client OAuth (Google Cloud Console → Identifiants)'],
    ['ALLOWED_EMAILS', 'ton adresse Gmail (plusieurs possibles, séparées par des virgules)'],
  ]) {
    if (present.has(name) && !FORCE) { console.log(`✔ ${name} déjà présent (inchangé)`); continue; }
    console.log(`\n→ ${name} : colle ${hint}, puis Entrée.`);
    const r = wrangler(`secret put ${name}`, { stdio: 'inherit' });
    if (r.status !== 0) { console.error(`Échec pour ${name}.`); process.exit(1); }
  }

  console.log('\nTous les secrets sont en place.');
};

main().catch(e => { console.error(e); process.exit(1); });
