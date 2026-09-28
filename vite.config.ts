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
  return {
    name: 'backend-origin-csp',
    // config.env = variables VITE_* déjà résolues pour le mode courant (.env.production au
    // build, .env/.env.local en dev), comme les voit le code de l'app.
    configResolved(config) {
      const raw = config.env.VITE_BACKEND_URL || '';
      try { origin = raw ? new URL(raw).origin : ''; } catch { origin = ''; }
    },
    transformIndexHtml: html => html.replace('__BACKEND_ORIGIN__', origin),
  };
};

export default defineConfig({
  // Base relative : fonctionne aussi bien sur un user page (username.github.io)
  // que sur un project page (username.github.io/nom-du-repo/), sans configuration
  // supplémentaire ni connaissance du nom du repo au moment du build.
  base: './',
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
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'Suivi Épargne',
        short_name: 'Épargne',
        description: 'Mon assistant financier personnel et privé',
        theme_color: '#0f172a',
        background_color: '#0f172a',
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