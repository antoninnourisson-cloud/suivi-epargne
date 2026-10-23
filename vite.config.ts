// ================================================
// FILE: vite.config.ts
// ================================================
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { readFileSync } from 'fs';
import { latestVersionFromChangelog } from './src/lib/changelogVersion';

// Version de l'app servie par `virtual:app-version` (voir src/appVersion.ts). Au build : la
// chaîne seule, lue en tête de src/changelog.ts, pour que l'historique complet ne soit chargé
// qu'avec « Quoi de neuf » et « À propos ». En développement et dans les tests : un simple
// renvoi vers LATEST_VERSION (une nouvelle entrée compte sans redémarrer le serveur).
const appVersionPlugin = (): Plugin => {
  const id = 'virtual:app-version';
  const resolvedId = `\0${id}`;
  const changelog = path.resolve(__dirname, 'src/changelog.ts');
  let isBuild = false;
  return {
    name: 'app-version',
    configResolved(config) { isBuild = config.command === 'build'; },
    resolveId: source => (source === id ? resolvedId : undefined),
    load(source) {
      if (source !== resolvedId) return undefined;
      if (!isBuild) return "export { LATEST_VERSION as APP_VERSION } from '/src/changelog.ts';";
      const version = latestVersionFromChangelog(readFileSync(changelog, 'utf8'));
      if (!version) this.error('Version introuvable en tête de src/changelog.ts');
      return `export const APP_VERSION = ${JSON.stringify(version)};`;
    },
  };
};

// Origine du Worker, injectée dans la CSP d'index.html (connect-src). Seule l'origine
// EXACTE est autorisée : ouvrir tout *.workers.dev laisserait un script injecté exfiltrer
// vers n'importe quel Worker tiers. Elle reçoit aussi un `preconnect` : au démarrage, le
// premier appel réseau est souvent la demande de jeton au Worker.
const backendOriginPlugin = (): Plugin => {
  let origin = '';
  let isBuild = false;
  return {
    name: 'backend-origin-csp',
    // config.env = variables VITE_* déjà résolues pour le mode courant (.env.production au
    // build, .env/.env.local en dev), comme les voit le code de l'app.
    configResolved(config) {
      const raw = config.env.VITE_BACKEND_URL || '';
      try { origin = raw ? new URL(raw).origin : ''; } catch { origin = ''; }
      isBuild = config.command === 'build';
    },
    // En production, les connexions au serveur de développement local (ws://localhost)
    // n'ont rien à faire dans la CSP.
    transformIndexHtml: html => {
      const out = html.replace('__BACKEND_ORIGIN__', origin).replace(
        '<!--__BACKEND_PRECONNECT__-->',
        origin ? `<link rel="preconnect" href="${origin}" crossorigin />` : '',
      );
      return isBuild ? out.replace(/ ws:\/\/localhost:5173 ws:\/\/127\.0\.0\.1:5173/, '') : out;
    },
  };
};

export default defineConfig({
  // Base relative : fonctionne à la racine du domaine (pecule-app.com) comme sous un chemin
  // (ancienne adresse github.io/suivi-epargne/), sans configuration
  // supplémentaire ni connaissance du nom du repo au moment du build.
  base: './',
  // Commit du build (7 caractères), fourni par GitHub Actions ; « dev » en local.
  // Déclaration de type : `declare const __BUILD_SHA__: string;` dans src/vite-env.d.ts.
  define: {
    __BUILD_SHA__: JSON.stringify((process.env.GITHUB_SHA || 'dev').slice(0, 7)),
    // Build de production destiné aux tests de bout en bout (playwright.config.ts, dossier
    // dist-e2e, jamais publié) : seul écart avec le build publié, le mode démo (`?demo=1`)
    // y reste disponible. Le build publié vaut `false` : la branche démo et ses données
    // fictives sont retirées du bundle. Déclaration : src/vite-env.d.ts.
    __E2E_DEMO__: JSON.stringify(process.env.PECULE_E2E_BUILD === '1'),
  },
  plugins: [
    react(),
    backendOriginPlugin(),
    appVersionPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      // Réception des notifications push (public/push-sw.js), greffée sur le service
      // worker généré plutôt que de réécrire toute la stratégie de cache à la main.
      workbox: {
        importScripts: ['push-sw.js'],
        // La police est servie avec l'app : précachée pour l'affichage hors ligne. Les icônes
        // de public/ (pwa-*.png, apple-touch-icon.png) sont prises par ce motif : plus de
        // liste includeAssets, qui les faisait figurer deux fois dans le précache.
        globPatterns: ['**/*.{js,css,html,png,woff2}'],
        // Pas précachés (75 Kio de moins à l'installation) :
        // - public/fonts : copie de la police pour les pages statiques (présentation,
        //   confidentialité), identique octet pour octet à celle de l'app ; elles la chargent
        //   en ligne, et se rabattent sur une police système hors ligne ;
        // - le sous-ensemble latin-ext : son unicode-range (index.css) ne le charge que pour
        //   des caractères hors du français ; hors ligne, une police système les affiche.
        globIgnores: ['fonts/**', '**/*latin-ext*'],
      },
      // Icônes du manifeste déjà prises par globPatterns : ne pas les ajouter une seconde fois.
      includeManifestIcons: false,
      manifest: {
        name: 'Pécule',
        short_name: 'Pécule',
        description: 'Faites pousser votre épargne : comptes, paie, intérêts et fiscalité, données sur votre Google Drive',
        // Surfaces Material 3 (src/theme/m3.css) : barre de titre et écran de lancement.
        theme_color: '#ecefe9',
        background_color: '#f8faf4',
        display: 'standalone',
        orientation: 'portrait',
        // Relatifs pour matcher le `base` ci-dessus, quel que soit le sous-dossier
        // sur lequel GitHub Pages sert l'app.
        scope: './',
        start_url: './',
        // Appui long sur l'icône de l'app -> action directe, sans repasser par la nav.
        // `url` relative au `scope` ci-dessus (donc au sous-dossier GitHub Pages, quel
        // qu'il soit) : App.tsx lit `?action=quickadd` au montage pour ouvrir la modale.
        shortcuts: [
          {
            name: 'Ajouter un mouvement',
            short_name: 'Ajouter',
            description: 'Enregistrer rapidement un dépôt ou un retrait',
            url: './?action=quickadd',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }]
          },
          {
            name: 'Actualiser les soldes',
            short_name: 'Actualiser',
            description: 'Saisir les nouveaux soldes des comptes',
            url: './?view=update',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }]
          },
          {
            name: 'Virements de paie',
            short_name: 'Paie',
            description: 'Cocher les virements de la paie du mois',
            url: './?view=pilot',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }]
          }
        ],
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        // Moins de requêtes à la première visite (avant que le service worker serve tout) :
        // les icônes (lucide-react) et le kit d'interface (src/components/ui) forment chacun
        // UN fichier partagé, et les fichiers de moins de 8 Ko sont fusionnés avec un voisin.
        // Mesuré le 22 octobre 2026 (build de production, même code avec et sans ces deux
        // réglages) : 96 fichiers JS dont 48 de moins de 1 Kio → 33, aucun sous 1 Kio ;
        // 30 fichiers JS chargés pour afficher l'Accueil → 5, pour presque le même poids
        // (203 → 206 Kio gzip : les icônes des autres écrans viennent avec) ; précache
        // 107 → 44 entrées (572 → 548 Kio gzip).
        experimentalMinChunkSize: 8000,
        manualChunks: id => (id.includes('node_modules/lucide-react') ? 'icons' : id.includes('/src/components/ui/') ? 'ui' : undefined),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});