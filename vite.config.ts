import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // `wrangler dev` runs the real Durable Object next door on 8787, while
    // Vite serves the app — so a networked game is playable with HMR still
    // working. `ws: true` is the whole point: without it the upgrade for
    // /api/room/:code never reaches the Worker.
    proxy: {
      '/api': { target: 'http://localhost:8787', ws: true },
    },
  },
})
