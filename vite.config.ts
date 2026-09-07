import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

// App hija "sincro-odoo-depofis" — servida bajo https://apps.dassa.com.ar/sincro-odoo-depofis/
//
// - `base: '/sincro-odoo-depofis/'` → los assets y el cliente API (src/lib/api.ts, que
//   usa import.meta.env.BASE_URL) se montan bajo /sincro-odoo-depofis/.
// - El build va a `dist/`, que el Express sirve estáticamente.
// - En dev el SPA llama a /sincro-odoo-depofis/api/* y /sincro-odoo-depofis/__sso/*; el proxy
//   quita el prefijo y apunta al Express (3038), replicando lo que en
//   producción hace el reverse proxy de Nginx.
export default defineConfig({
  base: '/sincro-odoo-depofis/',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    host: '::',
    port: 5188,
    proxy: {
      '/sincro-odoo-depofis/api': {
        target: 'http://localhost:3038',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/sincro-odoo-depofis/, ''),
      },
      '/sincro-odoo-depofis/__sso': {
        target: 'http://localhost:3038',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/sincro-odoo-depofis/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
