import { configDefaults, defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    pool: 'vmThreads',
    maxWorkers: 4,
    isolate: true,
    exclude: [...configDefaults.exclude, '**/.kilo/**'],
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
