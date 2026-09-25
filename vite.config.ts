import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

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
  test: {
    environment: 'jsdom',
    pool: 'vmThreads',
    maxWorkers: 4,
    isolate: true,
    exclude: [...configDefaults.exclude, '**/.kilo/**'],
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
});
