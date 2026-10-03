import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'LexisAI — Asisten Hukum Indonesia',
        short_name: 'LexisAI',
        description:
          'Asisten hukum Indonesia berbasis RAG, berjalan sepenuhnya di perangkat Anda.',
        lang: 'id',
        start_url: '.',
        theme_color: '#0b0f17',
        background_color: '#0b0f17',
        display: 'standalone',
        icons: [
          {
            src: 'icons/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Korpus (public/data/) sengaja TIDAK di-precache oleh SW —
        // di-cache sendiri di IndexedDB dengan delta-update per sha256.
        globIgnores: ['**/data/**'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  optimizeDeps: {
    // transformers.js memuat WASM/ONNX sendiri — jangan di-prebundle esbuild
    exclude: ['@xenova/transformers'],
  },
  server: {
    port: 5173,
  },
})
