import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env': {},
    global: 'globalThis',
  },
  resolve: {
    alias: {
      stream: 'stream-browserify',
    }
  },
  optimizeDeps: {
    include: ['@coral-xyz/anchor'],
  },
  server: {
    // ── Watcher proxy ──────────────────────────────────────────────────────
    // El browser llama /watcher/* (mismo origen → nunca hay CORS).
    // Vite reenvía server-side a 127.0.0.1:3001.
    // Si el watcher no está corriendo, devolvemos JSON legible (no HTML 500).
    proxy: {
      '/watcher': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/watcher/, ''),
        // Error handler: cuando el watcher no está corriendo (ECONNREFUSED),
        // devuelve JSON en vez del HTML 502/500 de Vite.
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            if (!res.headersSent) {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                ok:    false,
                error: 'WATCHER_DOWN',
              }));
            }
          });
        },
      },
    },
  },
})
