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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      exclude: ['node_modules/', 'src/**/*.{test,spec}.{ts,tsx}', 'src/**/__tests__/**', 'src/**/fixtures/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
