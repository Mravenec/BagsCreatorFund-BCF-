import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      globals: {
        Buffer: false, // Turned off in favor of manual injection
        global: false,
        process: false,
      },
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: {
      stream: 'stream-browserify',
      crypto: 'crypto-browserify',
    },
  },
  server: {
    port: 5173,
    host: true
  },
  optimizeDeps: {
    exclude: ['@toruslabs/openlogin-jrpc'],
    esbuildOptions: {
      target: 'esnext',
      supported: { 
        bigint: true 
      },
    }
  },
  build: {

    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
})
