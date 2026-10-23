import { test as base, expect, type Page } from '@playwright/test';
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
 *   helper is opt-in per spec, and one opt-in point per spec is one chance to
 *   forget each; an
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
 *   `@playwright/test`, and every spec importing from two places is a chance to
 *   reintroduce the direct import this file exists to replace. The star re-export
 *   keeps one module specifier per spec. An explicit local export shadows a star
 *   export, which is how the extended `test` below wins over the base one.
 *
 * WHY IT ALSO PINS THE THEME, AND WHY THE PIN IS `light`
 *   The app's default theme with nothing stored is DARK, and that is intended:
 *   `DEFAULT_THEME` in `src/contexts/ThemeContext.tsx:20` is `'dark'`, and the
 *   `prefers-color-scheme` fallback that used to decide the default from the
 *   operating system is gone. Every fresh Playwright context has no stored theme, so
 *   every fresh context is now dark, and the suite's pixel vocabulary is written for
 *   the other answer.
 *
 *   The vocabulary is the problem, and it is worse than a pile of failures. This
 *   suite reads "there is nothing here" out of a pixel: `hasDarkPixels`
 *   (`e2e/helpers/canvas-helpers.ts:434`) returns true for any pixel under 60 in all
 *   three channels, past the `alpha === 0` guard at `:443` — a fully transparent pixel
 *   cannot satisfy it, and a screenshot buffer never trips that guard, so the predicate
 *   reads as stated and the guard is not load-bearing here; `getStrokeAnalysis`'s
 *   background filter (`:872-875`, the `const isNearWhite =` and its three channels)
 *   drops near-white and keeps everything else, `STROKE_ANALYSIS.NEAR_WHITE_THRESHOLD`
 *   (`:229`) is 250 "= near white (background)", and `measureInk` (`:988`) weights a pixel
 *   by its darkness against a 255 paper, `INK_LUMA_FLOOR` (`:966`) included. All of that
 *   is calibrated against the LIGHT workspace backdrop — the 20px checkerboard
 *   `src/index.scss:140-151` paints `#fff` and `#f3f3f3` on. The DARK rule at `:153-164`
 *   paints `#000` and `#121212` on the same 20px grid (`src/components/Main/Main.tsx:263`
 *   picks between them from the resolved theme), and the boot document is opaque white
 *   (`src/App.tsx:21-26`), so the checkerboard is visible in the letterbox AROUND it.
 *
 *   Under dark, that backdrop is not "empty" to any of those helpers — it is dark, so
 *   `hasDarkPixels` is true before a single stroke is drawn and the `waitForCanvasPixels`
 *   behind it (`:558`) returns on its first poll; it is not near-white, so the stroke
 *   analysis counts the letterbox as part of the mark; and it is maximally far from 255,
 *   so `measureInk` reports the backdrop as ink and moves the centroid and the bounds.
 *   Those are SILENT passes and silent wrong numbers, not red tests: a test waiting for
 *   a stroke to appear stops testing whether the stroke appeared, and a bounds
 *   measurement reports the canvas edge instead of the mark.
 *
 *   MEASURED, AND THE COUNT IS A FLOOR RATHER THAN A TOTAL. With this fixture's
 *   `setItem` commented out and nothing else changed, one full headless suite run gave
 *   **11 failed, 3 skipped, 337 passed** — `check-dpr.spec.ts:28`,
 *   `document-dialogs.spec.ts:558` and `:1077`, `mobile-shell.spec.ts:114`,
 *   `select-move.spec.ts:53` and `:123`, `transform.spec.ts:107`, and four in
 *   `undo-redo.spec.ts` (`:165`, `:197`, `:231`, `:263`).
 *
 *   Read that as the CHEAP half of the exposure. A loud red assertion is the one failure
 *   mode that cannot be shipped past: it names what broke and it blocks. The half that
 *   matters is the part the 11 does NOT name — the tests that would have gone GREEN on
 *   the pin's absence while measuring something other than what they name: a
 *   `waitForCanvasPixels` returning on its first poll because the backdrop was already
 *   dark, a bounds measurement reporting the canvas edge, a threshold that stops
 *   discriminating because both sides of it moved. "Only 11 went red" is therefore the
 *   wrong way to read this suite unpinned, and so is the absence of a failure: it is not
 *   evidence that a test measured the thing it names.
 *
 *   So the suite pins light and states it here, where every spec's `test` comes from.
 *   The pin is a property of the ORACLE, not a claim about the app. What the app does
 *   with nothing stored is ASSERTED, not RENDERED, by one test
 *   (`e2e/document-dialogs.spec.ts`, "with nothing stored the document starts dark"),
 *   which releases this pin and reloads rather than running under it — and all it reads
 *   is the class on `<html>` and the string in `localStorage`. A `dark:` Tailwind
 *   variant that stopped applying would leave that test green, so it is a claim about
 *   the DEFAULT and not about dark mode as it reaches the screen. The accessibility
 *   suite separately releases this pin and scans the shell, dialogs, options bar, and
 *   tablet flyout in dark theme.
 *
 * WHY `addInitScript` AND NOT A NAVIGATION-TIME `evaluate`
 *   `ThemeProvider` reads `localStorage.getItem('theme')` synchronously inside its
 *   `useState` initializer (`src/contexts/ThemeContext.tsx:30-33`), so the value has to
 *   exist before the bundle's first statement. Setting it after `goto()` resolves is a
 *   race with the first paint: the app has already picked a theme, and a test that
 *   "sets the theme then waits for light" would be asserting on a repaint it provoked
 *   rather than on the value the app started from. `addInitScript` is evaluated before
 *   any page script, on every navigation and every reload, which is also what lets the
 *   pin survive the `page.reload()` several specs use to prove a preference persisted.
 *
 * WHY IT SEEDS ONLY AN ABSENT VALUE, which is the one line of this fixture that is easy
 *   to get wrong
 *   An init script re-runs on EVERY navigation, so a pin that wrote `light`
 *   unconditionally would re-assert itself across every reload in the suite. That is not
 *   a cosmetic problem: `document-dialogs.spec.ts` clicks the toggle to dark and then
 *   reloads to prove the choice survived, and a pin that rewrites the key first makes
 *   that reload read `light` — the assertion fails, and worse, the test stops being a
 *   test of persistence and becomes a test of the pin. So the script seeds only when
 *   nothing is stored, which is exactly the fresh-context case the pin exists for, and
 *   never overwrites a preference the app has already resolved and written back
 *   (`src/contexts/ThemeContext.tsx:35-40` writes it on every load, so from the second
 *   load onward the key is never absent).
 *
 * WHY PLAYWRIGHT'S OWN `colorScheme` OPTION CANNOT DO THIS
 *   `colorScheme` sets the `prefers-color-scheme` media query, and the app no longer
 *   reads it — `DEFAULT_THEME` replaced the `matchMedia` listener, so there is no code
 *   path left for the media query to reach. Setting `colorScheme: 'light'` is now a
 *   claim the config makes and nothing enforces, which is why the one
 *   `test.use({ colorScheme: 'light' })` that was left behind in
 *   `e2e/document-dialogs.spec.ts` has been deleted rather than kept as decoration:
 *   the pin above replaces it, and it now reads as the reason the suite is light when
 *   it is not.
 */
export * from '@playwright/test';

/** The `localStorage` key `ThemeProvider` reads (`src/contexts/ThemeContext.tsx:31`). */
const THEME_STORAGE_KEY = 'theme';
const FIRST_USE_TOUR_STORAGE_KEY = 'ph.firstUseTourSeen';
const FIRST_USE_TOUR_RELEASE_KEY = 'e2e-first-use-tour-released';

/** The theme this suite runs under. A property of the pixel oracle above, not of the app. */
const PINNED_THEME = 'light';

/**
 * `sessionStorage` key that turns the pin off for the rest of the tab.
 *
 * `sessionStorage` rather than `localStorage` because the app never writes it (nothing
 * in `src/` reads or writes `sessionStorage`), so a name collision is impossible, and
 * because it survives exactly the operation a release needs — the reload — while
 * starting empty in the next test's fresh context. That is the whole mechanism: an
 * init script re-runs on every navigation, so a release flag written anywhere but
 * session storage would either be wiped by the reload it has to survive or be wiped by
 * the app's own `useEffect` writing `localStorage.theme` back on every load.
 */
const THEME_PIN_RELEASE_KEY = 'e2e-theme-pin-released';

export const test = base.extend<{
  consolePolice: ConsolePolice;
  pinnedTheme: null;
  firstUseTourSuppressed: null;
}>({
  consolePolice: [
    async ({ page }, use, testInfo) => {
      const police = new ConsolePolice(page);
      police.attach();
      await use(police);
      police.assertClean(testInfo);
    },
    { auto: true },
  ],
  pinnedTheme: [
    async ({ page }, use) => {
      await page.addInitScript(
        ({ storageKey, releaseKey, theme }) => {
          // An OPAQUE ORIGIN has no storage to touch: after an explicit
          // `page.goto('about:blank')` all three calls below throw `SecurityError`, and
          // `ConsolePolice` fails a test on any page error — so an unguarded script turns
          // a navigation nothing asserts on into a red test in whichever spec did it.
          try {
            if (window.sessionStorage.getItem(releaseKey) === '1') return;
            // Only an ABSENT value: an init script re-runs on every navigation, so writing
            // unconditionally would overwrite the preference the app stored on its way
            // through — and would make "the choice survives a reload" assert the pin.
            if (window.localStorage.getItem(storageKey) !== null) return;
            window.localStorage.setItem(storageKey, theme);
          } catch {
            // opaque origin: there is nothing to pin
          }
        },
        { storageKey: THEME_STORAGE_KEY, releaseKey: THEME_PIN_RELEASE_KEY, theme: PINNED_THEME }
      );
      await use(null);
    },
    { auto: true },
  ],
  firstUseTourSuppressed: [
    async ({ page }, use) => {
      await page.addInitScript(
        ({ storageKey, releaseKey }) => {
          try {
            if (window.sessionStorage.getItem(releaseKey) === '1') return;
            if (window.localStorage.getItem(storageKey) === null) {
              window.localStorage.setItem(storageKey, 'true');
            }
          } catch {
            // An opaque origin has no storage to seed.
          }
        },
        { storageKey: FIRST_USE_TOUR_STORAGE_KEY, releaseKey: FIRST_USE_TOUR_RELEASE_KEY }
      );
      await use(null);
    },
    { auto: true },
  ],
});

/** Show the first-use tour for a dedicated E2E test in this tab. */
export async function showFirstUseTour(page: Page): Promise<void> {
  await page.evaluate(
    ({ storageKey, releaseKey }) => {
      window.sessionStorage.setItem(releaseKey, '1');
      window.localStorage.removeItem(storageKey);
    },
    { storageKey: FIRST_USE_TOUR_STORAGE_KEY, releaseKey: FIRST_USE_TOUR_RELEASE_KEY }
  );
  await page.reload();
}

/**
 * Releases the pin for the rest of this tab, so the next load starts from whatever the
 * APP does with no stored preference. For the one thing this suite must still check
 * about the theme: that the default is dark.
 *
 * It writes the release flag AND removes the stored theme, and both are load-bearing.
 * The flag alone leaves `localStorage.theme === 'light'` behind — the app's
 * `useEffect` (`src/contexts/ThemeContext.tsx:35-40`) has written it on every load —
 * so the app would resolve 'light' from storage and the test would assert the default
 * while measuring the pin. Removing the key alone is not possible without the flag,
 * because the init script re-runs on the reload and writes the pin straight back.
 *
 * The caller must `page.reload()` afterwards. `useState` in `ThemeProvider` read the
 * value once, at mount, and nothing since has changed it; the only way to make the app
 * resolve again is a fresh document.
 *
 * Call it AFTER a navigation, and IN THE TAB the assertions run in: it writes through
 * `page.evaluate`, so a page that has not navigated throws `SecurityError` from the
 * write itself, and `sessionStorage` is per-tab, so a `context.newPage()` — or a popup
 * — arrives with a fresh one, the release flag gone and the pin already back on. Nothing
 * in `e2e/` opens a second page today (`grep -rn "newPage|waitForEvent('popup')" e2e/`
 * is empty), so both halves of that are contract rather than enforced precondition.
 */
export async function useAppDefaultTheme(page: Page): Promise<void> {
  await page.evaluate(
    ({ storageKey, releaseKey }) => {
      window.sessionStorage.setItem(releaseKey, '1');
      window.localStorage.removeItem(storageKey);
    },
    { storageKey: THEME_STORAGE_KEY, releaseKey: THEME_PIN_RELEASE_KEY }
  );
}

export { expect };
export default test;
