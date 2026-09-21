import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { handleApi, withThemeBootstrap } from './server/api.mjs'

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'launcher-local-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/api/')) return next()
          handleApi(req, res).catch((err) => {
            res.statusCode = 500
            res.end(JSON.stringify({ error: String(err?.message ?? err) }))
          })
        })
      },
      // Dev serves HTML through Vite, so the theme bootstrap rides along here; server/prod.mjs does the
      // same when it serves dist/. Build output stays theme-free — a build must not freeze the look
      // items.json happened to hold at that moment.
      transformIndexHtml: (html) => (command === 'serve' ? withThemeBootstrap(html) : html),
    },
  ],
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: { main: 'index.html', manage: 'manage.html' },
    },
  },
}))
