import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// GitHub Pages liefert die App unter /lernapp/ aus.
export default defineConfig({
  base: '/lernapp/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Build-Kennung: wird bei jeder Veröffentlichung automatisch gesetzt (GitHub Actions), lokal „lokal“.
    __APP_BUILD__: JSON.stringify(
      process.env.GITHUB_RUN_NUMBER ? `Build ${process.env.GITHUB_RUN_NUMBER} · ${(process.env.GITHUB_SHA ?? '').slice(0, 7)}` : 'lokal',
    ),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      // Updates nie mitten in einer Sitzung aktivieren – siehe src/lib/appUpdate.ts
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'beispiel-paket.json'],
      manifest: {
        name: 'Lernapp',
        short_name: 'Lernapp',
        description: 'Prüfungsvorbereitung mit Spaced Repetition',
        lang: 'de',
        theme_color: '#f5f5f7',
        background_color: '#f5f5f7',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,json}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Push-Handler (Stundenplan-Änderungen) an denselben Service Worker hängen.
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 800 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
