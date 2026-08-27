// ================================================
// FILE: vite.config.ts
// ================================================
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  // Base relative : fonctionne aussi bien sur un user page (username.github.io)
  // que sur un project page (username.github.io/nom-du-repo/), sans configuration
  // supplémentaire ni connaissance du nom du repo au moment du build.
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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