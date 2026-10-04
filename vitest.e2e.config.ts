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
      //
      // NO `include`, NO `all`, AND THAT IS MEASURED RATHER THAN ASSUMED.
      //
      // The obvious repair for "an untested module is absent from the report instead of
      // reported at 0%" is a `coverage.include` over every module under `e2e/`. It does
      // not work with this provider. Run on this tree, the report lists the SAME nine rows
      // with `include` set and without it, and `--coverage.all` changes nothing either:
      // the v8 provider's untested-files query returns an empty list in every
      // configuration, so the file list is exactly the set of modules the suite happened
      // to load. `selection-ants.ts` appears in the report only because
      // `e2e/helpers/__tests__/selection-ants.unit.test.ts` imports it, not because any
      // glob asked for it.
      //
      // So the honest denominator needs a provider that can enumerate files it never
      // loaded — `@vitest/coverage-istanbul`, which is not a dependency of this
      // repository. Adding one is an operator decision about a new devDependency and the
      // `e2e-unit` job's install time, not a line in this file.
      //
      // Until then this report is a loaded-files report, and the check that can actually
      // fail on an untested module is the reachability gate in
      // `e2e/helpers/__tests__/helper-coverage.unit.test.ts`, which reads the module
      // graph rather than this artifact. There are deliberately no thresholds either:
      // see the same file for why a percentage here is not a gate.
    },
  },
});
