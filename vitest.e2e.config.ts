import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Vitest project for the end-to-end suite under `e2e/`.
 *
 * This is a SECOND, independent Vitest project. It exists because the two suites
 * have incompatible environments:
 *
 * - `vitest.config.ts` runs the app's unit tests in jsdom, with
 *   `src/test/setup.ts` loaded as a setup file.
 * - The e2e helper unit tests must run in plain Node: they exercise Playwright
 *   helper modules that touch `node:fs/promises`, `sharp` and `pixelmatch`, none
 *   of which exist in a jsdom environment.
 *
 * Running them under the root config is not just slower, it is wrong: jsdom
 * provides no canvas, no `fs`, and no `Buffer`-backed image pipeline.
 *
 * `setupFiles` is deliberately empty — `src/test/setup.ts` imports
 * `@testing-library/jest-dom` and expects a DOM.
 *
 * The `@` alias is deliberately absent: nothing under `e2e/` imports app source.
 * The e2e suite drives the real application through a browser, so it must not
 * reach into `src/` — that coupling is exactly what the app's own unit tests
 * already cover.
 */
export default defineConfig({
  test: {
    root: import.meta.dirname,
    environment: 'node',
    // No `globals: true`: every unit file imports describe/it/expect from 'vitest'
    // explicitly, and `vitest/globals` is not in tsconfig.e2e.json `types`, so globals
    // would pass under vitest and then fail `npm run tsc` with no explanation.
    // Scoped to `e2e/**`, not `**`: `root` is the repository root, so a bare
    // `**/__tests__/**/*.unit.test.ts` would also match a `*.unit.test.ts` added
    // under `src/` later and run it in Node, with no jsdom and no app setup file.
    include: ['e2e/**/__tests__/**/*.unit.test.ts'],
    exclude: [...configDefaults.exclude],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Separate from the app's ./coverage so the two runs cannot clobber each other.
      reportsDirectory: './coverage-e2e',
    },
  },
});
