// Vérification du site publié, faite par le serveur lui-même. La surveillance GitHub
// (monitor.yml) ne peut pas le faire seule : la protection anti-robots de Cloudflare refuse
// (403) les requêtes venant des serveurs de GitHub. Le Worker, lui, passe : il interroge les
// pages publiques et `/status` expose le résultat, sans aucune donnée utilisateur.
//
// Écran blanc : index.html contient « Pécule » en dur (balise <title>), même si l'app ne
// peut pas démarrer. Le script principal qu'il cite (assets/index-*.js, nom changé à chaque
// build) est donc aussi demandé : il doit répondre 200 avec un type JavaScript. Un build
// publié à moitié, un fichier manquant ou une page d'erreur servie à sa place sont signalés.

export const SITE_PAGES = ['', 'presentation.html', 'confidentialite.html'] as const;
export const SITE_CHECK_KEY = 'health:site';
/** Résultat réutilisé pendant 15 min : `/status` est public, il ne doit pas servir de relais. */
export const SITE_CHECK_TTL_MS = 15 * 60 * 1000;

export interface SiteCheck {
  checkedAt: string;
  ok: boolean;
  /** Pages en échec (code HTTP ou contenu inattendu). */
  failing: string[];
  /** En-tête HSTS présent sur l'accueil (Worker d'en-têtes actif). */
  hsts: boolean;
}

/**
 * Adresse du script principal cité par index.html (`<script type="module" src="…">`),
 * résolue par rapport à l'accueil. `null` s'il n'y en a pas, ou s'il est servi ailleurs
 * (jamais de requête vers une autre origine).
 */
export const mainScriptUrl = (html: string, base: string): string | null => {
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\btype\s*=\s*["']?module\b/i.test(tag)) continue;
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!src) continue;
    try {
      const url = new URL(src, base);
      return url.origin === new URL(base).origin ? url.href : null;
    } catch {
      return null;
    }
  }
  return null;
};

const REQUEST = { redirect: 'follow', headers: { 'User-Agent': 'PeculeStatus/1.0' } } as const;

/** Le script principal répond-il (200, type JavaScript) ? Renvoie l'échec à signaler, sinon null. */
const checkMainScript = async (html: string, base: string, fetcher: typeof fetch): Promise<string | null> => {
  const url = mainScriptUrl(html, base);
  if (!url) return '/ (script principal introuvable)';
  const basePath = new URL(base).pathname;
  const scriptPath = new URL(url).pathname;
  const path = scriptPath.startsWith(basePath) ? `/${scriptPath.slice(basePath.length)}` : scriptPath;
  try {
    const res = await fetcher(url, REQUEST);
    const type = res.headers.get('content-type') || '';
    // Corps non lu : seul l'en-tête compte (le fichier fait plusieurs centaines de Ko).
    await res.body?.cancel().catch(() => undefined);
    if (!res.ok) return `${path} (${res.status})`;
    if (!/javascript|ecmascript/i.test(type)) return `${path} (type ${type.split(';')[0] || 'absent'})`;
    return null;
  } catch {
    return `${path} (injoignable)`;
  }
};

export const checkSite = async (appUrl: string, fetcher: typeof fetch = fetch, now = new Date()): Promise<SiteCheck> => {
  const base = appUrl.endsWith('/') ? appUrl : `${appUrl}/`;
  const failing: string[] = [];
  let hsts = false;
  await Promise.all(SITE_PAGES.map(async page => {
    try {
      const res = await fetcher(base + page, REQUEST);
      const body = res.ok ? await res.text() : '';
      if (!res.ok || !body.includes('Pécule')) failing.push(`/${page} (${res.status})`);
      if (page === '') {
        hsts = !!res.headers.get('strict-transport-security');
        if (res.ok) {
          const scriptFailure = await checkMainScript(body, base, fetcher);
          if (scriptFailure) failing.push(scriptFailure);
        }
      }
    } catch {
      failing.push(`/${page} (injoignable)`);
    }
  }));
  return { checkedAt: now.toISOString(), ok: failing.length === 0, failing: failing.sort(), hsts };
};

/** Dernier contrôle s'il a moins de 15 min, sinon un nouveau (gardé dans KV). */
export const cachedSiteCheck = async (
  store: KVNamespace, appUrl: string, fetcher: typeof fetch = fetch, now = new Date(),
): Promise<SiteCheck> => {
  const last = await store.get<SiteCheck>(SITE_CHECK_KEY, 'json');
  if (last && now.getTime() - Date.parse(last.checkedAt) < SITE_CHECK_TTL_MS) return last;
  const fresh = await checkSite(appUrl, fetcher, now);
  await store.put(SITE_CHECK_KEY, JSON.stringify(fresh));
  return fresh;
};
