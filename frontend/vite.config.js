import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages liefert ein Projekt unter /<repo-name>/ statt der Domain-Wurzel -- lokal (npm
  // run dev) bleibt es bei "/". GITHUB_PAGES wird nur vom Deploy-Workflow gesetzt.
  base: process.env.GITHUB_PAGES ? '/pendenzenliste/' : '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
