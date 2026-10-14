import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'FeltLab — Poker decision trainer',
        short_name: 'FeltLab',
        description:
          'Play complete poker hands, replay your decisions, and build better instincts.',
        theme_color: '#111716',
        background_color: '#111716',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,txt}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'ui-framework',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler|@radix-ui|motion|framer-motion|motion-dom|motion-utils)([\\/]|$)/,
            },
          ],
        },
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'], clearMocks: true },
});
