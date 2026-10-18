import { describe, expect, it } from 'vitest';
import * as playwright from '@playwright/test';
import * as extended from '../../fixtures/extended-test';

/**
 * `extended-test.ts` without a browser.
 *
 * The file's whole surface is Playwright test REGISTRATION, and registration is the
 * part of a fixture suite nothing else checks: a spec that imports `test` from
 * somewhere else, an `auto` fixture quietly losing `auto`, or the theme pin seeding a
 * value the app has already decided are all invisible to a run that only proves the
 * specs pass.
 *
 * What is reachable without a browser, and is reached here:
 *
 * - the module's exports, and that they are the SAME objects `@playwright/test` exports
 *   rather than copies — a copied `expect` would compile and then behave differently;
 * - the fixture registry, so both fixtures are known to be registered and known to be
 *   `auto`, which is the property the file exists for;
 * - the pinned-theme INIT SCRIPT, captured off the `page.addInitScript` call the fixture
 *   makes and then run against fake storages. That script is the load-bearing part: it
 *   runs on every navigation of every test, and the rule it encodes — seed only an
 *   ABSENT value — is the reason a reload in `document-dialogs.spec.ts` proves
 *   persistence instead of proving the pin;
 * - `useAppDefaultTheme`, the other half of that mechanism, cross-checked against the
 *   script through the key they share rather than through a literal.
 *
 * What is NOT reachable without a browser is whether the theme reaches the screen. That
 * is asserted by `document-dialogs.spec.ts`, which releases the pin and reads the class
 * on `<html>`, and nothing here claims to have covered it.
 */

/** The symbol Playwright hangs its per-`TestType` state on. */
const TEST_TYPE = Object.getOwnPropertySymbols(extended.test).find((symbol) => symbol.description === 'testType');

interface FixtureLayer {
  readonly location: { readonly file: string };
  readonly fixtures: Record<string, unknown>;
}

type FixtureBody = (args: unknown, use: (value: never) => Promise<void>, testInfo: unknown) => Promise<void>;

interface RegisteredFixture {
  readonly name: string;
  readonly body: FixtureBody;
  readonly options: { readonly auto?: boolean } | undefined;
}

/** The shape `addInitScript` is called with: the page function and its serialised argument. */
interface ThemePinArgument {
  readonly storageKey: string;
  readonly releaseKey: string;
  readonly theme: string;
}

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** One recorded call into the `page` or `testInfo` the fixture was handed. */
interface Recording {
  /** Every call, in order, so an assertion can be about ORDER and not only membership. */
  readonly log: string[];
  readonly page: playwright.Page;
  readonly testInfo: playwright.TestInfo;
  readonly initScripts: { readonly fn: (arg: never) => void; readonly arg: unknown }[];
  readonly evaluations: { readonly fn: (arg: never) => void; readonly arg: unknown }[];
}

/** A `Storage` over a Map, so a case can read back what the script wrote. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

/** A storage on an opaque origin, where every call throws `SecurityError`. */
function opaqueStorage(): Storage {
  const refuse = (): never => {
    throw new Error('SecurityError');
  };
  return { getItem: refuse, setItem: refuse, removeItem: refuse };
}

/** `page.on` for the console police, `page.addInitScript` for the theme pin, `page.evaluate` for the release. */
function recorder(): Recording {
  const log: string[] = [];
  const initScripts: { fn: (arg: never) => void; arg: unknown }[] = [];
  const evaluations: { fn: (arg: never) => void; arg: unknown }[] = [];

  const page = {
    on: (event: string) => {
      log.push(`page.on:${event}`);
      return page;
    },
    addInitScript: (fn: (arg: never) => void, arg: unknown) => {
      log.push('page.addInitScript');
      initScripts.push({ fn, arg });
      return Promise.resolve();
    },
    evaluate: (fn: (arg: never) => void, arg: unknown) => {
      log.push('page.evaluate');
      evaluations.push({ fn, arg });
      return Promise.resolve(undefined);
    },
    reload: () => {
      log.push('page.reload');
      return Promise.resolve();
    },
  } as unknown as playwright.Page;

  const testInfo = {
    attach: (name: string) => {
      log.push(`testInfo.attach:${name}`);
    },
  } as unknown as playwright.TestInfo;

  return { log, page, testInfo, initScripts, evaluations };
}

/** The fixture layers `extended-test.ts` contributed, read off the exported test object. */
function contributedLayers(): readonly FixtureLayer[] {
  if (TEST_TYPE === undefined) {
    throw new Error(
      'no Symbol(testType) on the test object exported by e2e/fixtures/extended-test.ts, so its fixture ' +
        'registry cannot be read. Loud rather than skipped: the registry is the only way to prove both ' +
        'fixtures are registered and auto, and a test that quietly stopped checking it would be worse than ' +
        'no test.'
    );
  }
  const container = (extended.test as unknown as { [key: symbol]: unknown })[TEST_TYPE] as { fixtures?: unknown };
  if (!Array.isArray(container.fixtures)) {
    throw new Error(`the test-type container carries no fixture array (found ${typeof container.fixtures})`);
  }
  return (container.fixtures as FixtureLayer[]).filter((layer) =>
    layer.location.file.replace(/\\/g, '/').endsWith('e2e/fixtures/extended-test.ts')
  );
}

/** The one fixture named `name`, from whichever layer contributed it. */
function fixture(name: string): RegisteredFixture {
  for (const layer of contributedLayers()) {
    const entry = layer.fixtures[name];
    if (entry === undefined) continue;
    const [body, options] = entry as [FixtureBody, { readonly auto?: boolean } | undefined];
    return { name, body, options };
  }
  throw new Error(`e2e/fixtures/extended-test.ts registers no fixture named ${name}`);
}

/** Every fixture name the module contributes. */
function fixtureNames(): string[] {
  return contributedLayers()
    .flatMap((layer) => Object.keys(layer.fixtures))
    .sort();
}

/**
 * Runs a fixture body the way the runner would: `use` is awaited in the middle, so the
 * teardown after it is the fixture's. `use` resolves at once and records the moment it
 * was called, which is what makes the ordering assertions about the body rather than
 * about the file's own statements.
 */
async function runFixture(registered: RegisteredFixture, recording: Recording): Promise<void> {
  await registered.body(
    { page: recording.page },
    async () => {
      recording.log.push('use');
    },
    recording.testInfo
  );
  recording.log.push('body returned');
}

/** The one init script the pinned-theme fixture registers, with its argument. */
async function capturedThemePin(): Promise<{ fn: (arg: never) => void; arg: ThemePinArgument }> {
  const recording = recorder();
  await runFixture(fixture('pinnedTheme'), recording);
  if (recording.initScripts.length !== 1) {
    throw new Error(`expected one init script, the fixture registered ${recording.initScripts.length}`);
  }
  return {
    fn: recording.initScripts[0].fn,
    arg: recording.initScripts[0].arg as ThemePinArgument,
  };
}

/** Runs a captured page callback here, with `window` standing in for the page's global. */
function runInPage<T>(callback: (arg: never) => T, arg: unknown, window: unknown): T {
  const globals = globalThis as unknown as { window?: unknown };
  globals.window = window;
  try {
    return callback(arg as never);
  } finally {
    delete globals.window;
  }
}

describe('the shared test object', () => {
  it('is the default export as well as a named one', () => {
    // `export default test` and `export const test` are two spellings of one object. A
    // default that was a second object would leave half the suite on a different fixture
    // set and no assertion anywhere would notice.
    expect(extended.default).toBe(extended.test);
  });

  it('re-exports Playwright expect rather than a second copy', () => {
    expect(extended.expect).toBe(playwright.expect);
  });

  it.each([
    'devices',
    'chromium',
    'firefox',
    'webkit',
    'request',
    'selectors',
    'errors',
    'defineConfig',
    'mergeTests',
    'mergeExpects',
  ])('re-exports %s, so a spec imports one module and not two', (name) => {
    // The star re-export is what keeps `type Page`, `type TestInfo` and `type Locator`
    // coming from here too. A spec importing from two places is a chance to reintroduce
    // the direct import this file exists to replace.
    const reexported = (extended as unknown as Record<string, unknown>)[name];
    expect(reexported, `${name} is not re-exported by e2e/fixtures/extended-test.ts`).toBeDefined();
    expect(reexported).toBe((playwright as unknown as Record<string, unknown>)[name]);
  });
});

describe('the fixtures it registers', () => {
  it('contributes exactly consolePolice, pinnedTheme, and firstUseTourSuppressed', () => {
    // The point of the shared object is that it is universal, so a fixture added here is
    // one every spec in `e2e/` silently acquires. Reading the registry rather than
    // asserting on two names is what makes a third one visible here rather than only in
    // the file that added it.
    expect(fixtureNames()).toEqual(['consolePolice', 'firstUseTourSuppressed', 'pinnedTheme']);
  });

  it.each(['consolePolice', 'pinnedTheme', 'firstUseTourSuppressed'])('registers %s as auto', (name) => {
    // `auto` is the whole argument for this file over a helper each spec calls by hand:
    // a helper is opt-in per spec, and `auto` is opt-out, which is the property a check
    // nobody can forget depends on.
    expect(fixture(name).options?.auto).toBe(true);
  });
});

describe('the pinnedTheme fixture', () => {
  it('seeds the theme the suite pins, under the key the app reads', async () => {
    const { arg } = await capturedThemePin();
    // `ThemeProvider` reads `localStorage.getItem('theme')` synchronously in its `useState`
    // initializer, so the key is the app's. The value is a property of the pixel oracle
    // rather than of the app: the suite's vocabulary is calibrated against a light
    // workspace backdrop, and under dark several pixel predicates read the backdrop as
    // content and return silently wrong answers.
    expect(arg.storageKey).toBe('theme');
    expect(arg.theme).toBe('light');
    // A key collision would make the release flag unreadable as a flag.
    expect(arg.releaseKey).toEqual(expect.any(String));
    expect(arg.releaseKey).not.toBe(arg.storageKey);
  });

  it('seeds light when nothing is stored, which is the fresh-context case', async () => {
    const { fn, arg } = await capturedThemePin();
    const localStorage = memoryStorage();
    runInPage(fn, arg, { localStorage, sessionStorage: memoryStorage() });
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('leaves a stored preference alone, so a reload proves persistence and not the pin', async () => {
    const { fn, arg } = await capturedThemePin();
    // An init script re-runs on EVERY navigation. Writing unconditionally would make
    // `document-dialogs.spec.ts` rewrite `light` over the `dark` it just chose, and the
    // test asserting the choice survived would be asserting the pin instead.
    const localStorage = memoryStorage({ theme: 'dark' });
    runInPage(fn, arg, { localStorage, sessionStorage: memoryStorage() });
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('seeds nothing once the release flag is set for the tab', async () => {
    const { fn, arg } = await capturedThemePin();
    const localStorage = memoryStorage();
    runInPage(fn, arg, { localStorage, sessionStorage: memoryStorage({ [arg.releaseKey]: '1' }) });
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('survives an opaque origin, where storage throws', async () => {
    const { fn, arg } = await capturedThemePin();
    // After an explicit `page.goto('about:blank')` every storage call throws
    // `SecurityError`, and `ConsolePolice` fails a test on any page error — so an
    // unguarded script turns a navigation nothing asserts on into a red test in
    // whichever spec did it.
    expect(() => runInPage(fn, arg, { localStorage: opaqueStorage(), sessionStorage: opaqueStorage() })).not.toThrow();
  });

  it('registers the script before the test body runs', async () => {
    const recording = recorder();
    await runFixture(fixture('pinnedTheme'), recording);
    expect(recording.log).toEqual(['page.addInitScript', 'use', 'body returned']);
  });
});

/** The argument shape the firstUseTourSuppressed init script is serialised with. */
interface TourPinArgument {
  readonly storageKey: string;
  readonly releaseKey: string;
}

/** The one init script the firstUseTourSuppressed fixture registers, with its argument. */
async function capturedFirstUseTourPin(): Promise<{ fn: (arg: never) => void; arg: TourPinArgument }> {
  const recording = recorder();
  await runFixture(fixture('firstUseTourSuppressed'), recording);
  if (recording.initScripts.length !== 1) {
    throw new Error(`expected one init script, the fixture registered ${recording.initScripts.length}`);
  }
  return {
    fn: recording.initScripts[0].fn,
    arg: recording.initScripts[0].arg as TourPinArgument,
  };
}

describe('the firstUseTourSuppressed fixture', () => {
  it('seeds the tour-seen flag when nothing is stored, which is the fresh-context case', async () => {
    const { fn, arg } = await capturedFirstUseTourPin();
    // The app reads `localStorage.getItem('ph.firstUseTourSeen')` synchronously on mount
    // to decide whether to show the first-use tour. Seeding 'true' is the suppression.
    const localStorage = memoryStorage();
    runInPage(fn, arg, { localStorage, sessionStorage: memoryStorage() });
    expect(localStorage.getItem(arg.storageKey)).toBe('true');
  });

  it('leaves an already-set flag alone, so an explicit value survives the pin', async () => {
    const { fn, arg } = await capturedFirstUseTourPin();
    // An init script re-runs on EVERY navigation. Writing unconditionally would let a
    // spec that intentionally clears the flag for a tour test have it silently reseeded
    // on the next navigation, and the test would assert the tour is suppressed rather than
    // asserting the clear worked.
    const localStorage = memoryStorage({ [arg.storageKey]: 'false' });
    runInPage(fn, arg, { localStorage, sessionStorage: memoryStorage() });
    expect(localStorage.getItem(arg.storageKey)).toBe('false');
  });

  it('seeds nothing once the release flag is set for the tab', async () => {
    const { fn, arg } = await capturedFirstUseTourPin();
    const localStorage = memoryStorage();
    runInPage(fn, arg, {
      localStorage,
      sessionStorage: memoryStorage({ [arg.releaseKey]: '1' }),
    });
    expect(localStorage.getItem(arg.storageKey)).toBeNull();
  });

  it('survives an opaque origin, where storage throws', async () => {
    const { fn, arg } = await capturedFirstUseTourPin();
    // After an explicit `page.goto('about:blank')` every storage call throws SecurityError,
    // and ConsolePolice fails a test on any page error — so an unguarded script turns a
    // navigation nothing asserts on into a red test.
    expect(() => runInPage(fn, arg, { localStorage: opaqueStorage(), sessionStorage: opaqueStorage() })).not.toThrow();
  });

  it('registers the init script before the test body runs', async () => {
    const recording = recorder();
    await runFixture(fixture('firstUseTourSuppressed'), recording);
    expect(recording.log).toEqual(['page.addInitScript', 'use', 'body returned']);
  });

  it("uses the app's own storage key for the tour-seen flag", async () => {
    const { arg } = await capturedFirstUseTourPin();
    expect(arg.storageKey).toBe('ph.firstUseTourSeen');
    expect(arg.releaseKey).toEqual(expect.any(String));
    expect(arg.releaseKey).not.toBe(arg.storageKey);
  });
});

describe('showFirstUseTour and the tour pin, together', () => {
  async function releaseThenReload(): Promise<{ localStorage: Storage; sessionStorage: Storage; releaseKey: string }> {
    const pin = await capturedFirstUseTourPin();
    const { page, evaluations, log } = recorder();
    await extended.showFirstUseTour(page);
    if (evaluations.length !== 1) {
      throw new Error(`expected one evaluate, showFirstUseTour made ${evaluations.length}`);
    }
    // `showFirstUseTour` calls `page.reload()` AFTER the evaluate; if the reload is ever
    // deleted, the init script that runs on reload never fires and the release is
    // invisible to the app — so the reload is the whole second half of the mechanism.
    expect(log).toContain('page.reload');

    // The app has written the suppression back on every load, so the key starts out set —
    // which is why showFirstUseTour has to remove it and not only set the release flag.
    const localStorage = memoryStorage({ [pin.arg.storageKey]: 'true' });
    const sessionStorage = memoryStorage();
    const window = { localStorage, sessionStorage };

    runInPage(evaluations[0].fn, evaluations[0].arg, window);
    runInPage(pin.fn, pin.arg, window);

    return { localStorage, sessionStorage, releaseKey: pin.arg.releaseKey };
  }

  it('removes the stored flag and sets the release flag, so a reload shows the tour', async () => {
    const { localStorage, sessionStorage, releaseKey } = await releaseThenReload();
    expect(localStorage.getItem('ph.firstUseTourSeen')).toBeNull();
    expect(sessionStorage.getItem(releaseKey)).toBe('1');
  });

  it('leaves a stored flag that showFirstUseTour already cleared alone, so a reload does not re-seed', async () => {
    const { localStorage } = await releaseThenReload();
    // The init script re-runs on reload: it seeds only when the key is absent, so a
    // release that removed the key must NOT have it reseeded. A test that removed the
    // key but not set the release flag would see the tour re-seed on reload.
    expect(localStorage.getItem('ph.firstUseTourSeen')).toBeNull();
  });

  it('writes through page.evaluate, so it only reaches the tab that runs the test', async () => {
    const { page, evaluations } = recorder();
    await extended.showFirstUseTour(page);
    // sessionStorage is per-tab, so this has to go through the page: a Node-side write
    // would land in nothing, and a context.newPage() would arrive with a fresh flag.
    expect(evaluations).toHaveLength(1);
  });

  it('reloads the page after clearing, so the app re-reads storage from scratch', async () => {
    const recording = recorder();
    const { page } = recording;
    await extended.showFirstUseTour(page);
    // `showFirstUseTour` at extended-test.ts:229 calls `page.reload()` after the evaluate.
    // The release flag is set and the key is removed in the evaluate above; the reload is
    // what makes the app's own init script (which reads storage at mount) see the cleared
    // state rather than the stale cached one. Verify the call actually happened.
    expect(recording.log).toEqual(['page.evaluate', 'page.reload']);
    expect(recording.evaluations).toHaveLength(1);
  });
});

describe('useAppDefaultTheme and the theme pin, together', () => {
  /**
   * The release and then the reload, over one window: the two halves of the mechanism
   * the module's own docstring describes, run in the order the app runs them.
   */
  async function releaseThenReload(): Promise<{ localStorage: Storage; sessionStorage: Storage; releaseKey: string }> {
    const pin = await capturedThemePin();
    const { page, evaluations } = recorder();
    await extended.useAppDefaultTheme(page);
    if (evaluations.length !== 1) {
      throw new Error(`expected one evaluate, useAppDefaultTheme made ${evaluations.length}`);
    }

    // The app has written the pin back on every load, so the key starts out set — which
    // is why the release has to remove it and not only set the flag.
    const localStorage = memoryStorage({ theme: 'light' });
    const sessionStorage = memoryStorage();
    const window = { localStorage, sessionStorage };

    runInPage(evaluations[0].fn, evaluations[0].arg, window);
    runInPage(pin.fn, pin.arg, window);

    return { localStorage, sessionStorage, releaseKey: pin.arg.releaseKey };
  }

  it('removes the stored theme, not only the flag, and writes the pin its own key', async () => {
    // The flag alone leaves `localStorage.theme === 'light'` behind, so the next document
    // resolves `light` from storage and a test claiming to observe the app's default would
    // be observing the pin. Removing the key alone is impossible: the init script runs on
    // the reload and writes it straight back. Both halves, and the flag is compared
    // against the key the init script reads rather than against a literal, because the two
    // halves agreeing IS the contract.
    const { localStorage, sessionStorage, releaseKey } = await releaseThenReload();
    expect(localStorage.getItem('theme')).toBeNull();
    expect(sessionStorage.getItem(releaseKey)).toBe('1');
  });

  it('leaves the pin off across the reload it has to survive', async () => {
    const { localStorage } = await releaseThenReload();
    // The init script ran again over the released window, which is exactly what a reload
    // does. A `theme` here would mean the release is not the mechanism the module claims
    // it is, and the suite's one dark-default assertion would be reading its own pin.
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('writes through page.evaluate, so it only reaches the tab that runs the test', async () => {
    const { page, evaluations } = recorder();
    await extended.useAppDefaultTheme(page);
    // `sessionStorage` is per-tab, so this has to go through the page: a Node-side write
    // would land in nothing, and a `context.newPage()` would arrive with a fresh flag.
    expect(evaluations).toHaveLength(1);
  });
});

describe('the consolePolice fixture', () => {
  it('attaches its listeners before the body and reports after it', async () => {
    const recording = recorder();
    await runFixture(fixture('consolePolice'), recording);

    // Playwright has no global listener hook — `globalSetup` runs in a separate process
    // with no `page` — so the only way to make the check universal is a fixture, and the
    // only way to make a fixture universal is for every spec to import a `test` that
    // carries it. That argument depends entirely on the ORDER below.
    expect(recording.log).toEqual([
      'page.on:console',
      'page.on:pageerror',
      'page.on:requestfailed',
      'use',
      'testInfo.attach:console-police.json',
      'body returned',
    ]);
  });
});
