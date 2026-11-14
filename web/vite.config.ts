import { defineConfig } from 'vitest/config';
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1500, target: 'es2022' },
  plugins: [{
    // dev only: Vite HMR needs a websocket; the production CSP stays strict
    name: 'dev-csp', apply: 'serve',
    transformIndexHtml: (h) => h.replace("connect-src 'self'", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*"),
  }],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
