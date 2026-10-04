import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      // @ts-expect-error Plugin runtime supports Babel options, but the installed Vite 8 plugin types omit this key.
      babel: {
        plugins: [['babel-plugin-react-compiler', { target: '19' }]],
      },
    }),
  ],
  css: {
    transformer: 'postcss',
    preprocessorOptions: {
      scss: {
        silenceDeprecations: ['import', 'if-function', 'color-functions', 'global-builtin'],
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  // No `test` block here on purpose. This file is the Vite build config; unit-test
  // settings live in `vitest.config.ts` (app, jsdom) and `vitest.e2e.config.ts`
  // (e2e helpers, node). Vitest prefers `vitest.config.*` over `vite.config.ts`, so
  // a `test` block below was dead for every default invocation — but it was a live
  // footgun for `vitest --config vite.config.ts` and for any IDE runner pointed at
  // this file, because it could not know about the e2e project's existence and would
  // load every Playwright spec under `e2e/` into jsdom.
});
