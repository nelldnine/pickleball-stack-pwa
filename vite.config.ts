import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Pickleball Stacking',
        short_name: 'Stacking',
        description: 'Doubles team stacking, fair rotation, and scorekeeping for pickleball.',
        // Now that iOS draws its own status bar (see index.html), these are real chrome
        // colors, not placeholders: `paper`, so the install's system bars and launch
        // splash match the app instead of flashing a near-black that is in neither theme.
        // theme.ts repaints meta[name=theme-color] per theme once the app is running.
        theme_color: '#f6f5f3',
        background_color: '#f6f5f3',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
})
