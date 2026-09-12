import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['icon-192.png', 'icon-512.png', 'smartrack-logo.png', 'smartrack-mark.png'],
      manifest: {
        name: 'Smartrack - OJT Monitoring',
        short_name: 'Smartrack',
        description: 'AI-Enhanced OJT Monitoring and Performance Analytics System',
        theme_color: '#2563EB',
        background_color: '#F8FAFC',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        importScripts: ['/push-sw.js'],
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:5000',
    },
  },
  preview: {
    allowedHosts: true,
  },
});
