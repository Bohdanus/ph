import { test as base, expect } from '@playwright/test';
import { ConsolePolice } from '../helpers/console-police';

/**
 * The `test` object every spec in `e2e/` imports.
 * -----------------------------------------------
 * WHY A SHARED TEST OBJECT
 *   `ConsolePolice` needs to attach before the test body runs and assert after it
 *   finishes. Playwright has no global listener hook — `globalSetup` runs in a
 *   separate process with no `page` — so the only way to make the check universal
 *   is a fixture, and the only way to make a fixture universal is for every spec to
 *   import a `test` that carries it.
 *
 *   That is why this file exists rather than a helper the specs call by hand. A
 *   helper is opt-in per spec, and 36 opt-in points is 36 chances to forget; an
 *   `auto` fixture is opt-out, which is the property that matters for a check
 *   whose entire value is that nobody can forget it.
 *
 * THE FILE NAME IS NOT ACCIDENTAL
 *   Playwright's default `testMatch` is a glob requiring a literal `.test.ts` or
 *   `.spec.ts` suffix. `extended-test.ts` ends in `-test.ts`, so this file is never
 *   collected as a suite of its own and never trips Playwright's "no tests found in
 *   file" error. Renaming it to `extended.test.ts` breaks the run.
 *
 * WHAT A SPEC THAT WANTS THE DETAIL CAN DO
 *   Nothing. The check is not suppressible per test, deliberately: the two ways to
 *   turn it off are an `ACCEPTED_CONSOLE_ERRORS` entry with a written reason, or
 *   deleting the fixture. A spec that needs to provoke a console error legitimately
 *   provokes it through the app's own error path, and the message it provokes is the
 *   thing under test.
 *
 * WHY EVERYTHING IS RE-EXPORTED
 *   Specs also pull `type Page`, `type TestInfo` and `type Locator` from
 *   `@playwright/test`, and 46 files importing from two places is 46 chances to
 *   reintroduce the direct import this file exists to replace. The star re-export
 *   keeps one module specifier per spec. An explicit local export shadows a star
 *   export, which is how the extended `test` below wins over the base one.
 */
export * from '@playwright/test';

export const test = base.extend<{ consolePolice: ConsolePolice }>({
  consolePolice: [
    async ({ page }, use, testInfo) => {
      const police = new ConsolePolice(page);
      police.attach();
      await use(police);
      police.assertClean(testInfo);
    },
    { auto: true },
  ],
});

export { expect };
export default test;
