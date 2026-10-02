// ================================================
// FILE: vite.config.ts
// ================================================
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

// Origine du Worker, injectée dans la CSP d'index.html (connect-src). Seule l'origine
// EXACTE est autorisée : ouvrir tout *.workers.dev laisserait un script injecté exfiltrer
// vers n'importe quel Worker tiers.
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
      const out = html.replace('__BACKEND_ORIGIN__', origin);
      return isBuild ? out.replace(/ ws:\/\/localhost:5173 ws:\/\/127\.0\.0\.1:5173/, '') : out;
    },
  };
};

export default defineConfig({
  // Base relative : fonctionne aussi bien sur un user page (username.github.io)
  // que sur un project page (username.github.io/nom-du-repo/), sans configuration
  // supplémentaire ni connaissance du nom du repo au moment du build.
  base: './',
  // Commit du build (7 caractères), fourni par GitHub Actions ; « dev » en local.
  // Déclaration de type : `declare const __BUILD_SHA__: string;` dans src/vite-env.d.ts.
  define: {
    __BUILD_SHA__: JSON.stringify((process.env.GITHUB_SHA || 'dev').slice(0, 7)),
  },
  plugins: [
    react(),
    backendOriginPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      // Réception des notifications push (public/push-sw.js), greffée sur le service
      // worker généré plutôt que de réécrire toute la stratégie de cache à la main.
      workbox: {
        importScripts: ['push-sw.js'],
      },
      // Seules les icônes réellement présentes dans public/ (les anciennes entrées
      // favicon.ico / apple-touch-icon.png / mask-icon.svg pointaient vers des fichiers absents).
      includeAssets: ['pwa-192x192.png', 'pwa-512x512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Pécule',
        short_name: 'Pécule',
        description: 'Faites pousser votre épargne : comptes, paie, intérêts et fiscalité, données sur votre Google Drive',
        theme_color: '#14532d',
        background_color: '#14532d',
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
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});