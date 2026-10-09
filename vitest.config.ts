import { configDefaults, defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    pool: 'vmThreads',
    maxWorkers: 4,
    isolate: true,
    // Vitest 5 changed the `clearMocks` default to `true`; this suite already depends on that
    // behaviour, so it is stated here rather than inherited from an unstated version, and it
    // survives a major bump that flips the default back.
    clearMocks: true,
    // `include` is left at the Vitest default (`**/*.{test,spec}.?(c|m)[jt]s?(x)`),
    // which also matches the Playwright specs under `e2e/`. Without this exclusion
    // `npm test` would load the browser-driven specs under `e2e/` into jsdom. The e2e helper unit
    // tests have the same problem for a different reason: they need Node's `fs`
    // and `sharp`, not a DOM. Both are run by their own project:
    // `vitest.e2e.config.ts`, driven by `npm run test:e2e:unit`.
    exclude: [...configDefaults.exclude, '**/.kilo/**', 'e2e/**'],
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      // `e2e/**` is listed so app coverage stays a measure of `src/`. The e2e helper
      // modules have their own coverage report from `vitest.e2e.config.ts`.
      exclude: [
        'node_modules/',
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/__tests__/**',
        'src/**/fixtures/**',
        'e2e/**',
      ],
      thresholds: {
        lines: 30,
        functions: 30,
        branches: 30,
        statements: 30,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
