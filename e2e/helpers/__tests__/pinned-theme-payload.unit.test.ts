import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A tripwire on the `pinnedTheme` fixture's init-script payload.
 * ----------------------------------------------------------------
 * WHAT IS BEING PROTECTED, AND WHY A UNIT TEST IS THE RIGHT TOOL
 *   The suite's pixel oracle is written for the LIGHT workspace backdrop. Under the app's
 *   own default — dark — the checkerboard is `#000`/`#121212`, so `hasDarkPixels`
 *   (`STROKE_ANALYSIS.DARK_PIXEL_THRESHOLD` in `../canvas-helpers.ts`) is true before a
 *   single stroke exists, and every wait that polls the same region returns on its first
 *   poll. Those are SILENT passes: a green run cannot distinguish "the stroke appeared"
 *   from "the backdrop was already dark". `pinnedTheme` is the only thing standing between
 *   the suite and that, it is an `auto` fixture every spec inherits, and nothing anywhere
 *   fails if it is deleted or if its payload quietly stops writing.
 *
 * WHY THE ASSERTION IS ON THE PAYLOAD AND NOT ON `hasDarkPixels`
 *   A test of the predicate passes identically whether or not the pin exists: the predicate
 *   is a pure function of decoded pixels and never sees the fixture. So does the threshold
 *   table in `canvas-pixel-analysis.unit.test.ts`, and so does the empty-backdrop case in
 *   that file — it proves the LIGHT colours are not dark, which is a property of two
 *   constants, not of anything the suite does. A test that cannot go red when the pin is
 *   removed is not a weaker tripwire; it is a comment. This file reads the payload itself.
 *
 * WHY THE AST AND NOT A REGEX
 *   The payload's values are identifiers (`theme: PINNED_THEME`), so the assertion has to
 *   resolve them to the literals the fixture declares, and `extended-test.ts` is 140 lines
 *   of prose about the theme before its first statement — prose full of parentheses,
 *   backticks and `):NNN` fragments that a bracket-counting regex cannot survive. Reading
 *   the real AST is also what `scripts/lib/citations/resolve.mjs` does, for the same reason,
 *   so this introduces no new dependency and cannot disagree with the compiler about where
 *   a declaration ends.
 *
 * WHAT THIS FILE DOES NOT PROVE, AND WHERE THAT BELONGS
 *   It proves the payload writes the theme storage key to the pinned light value. It does
 *   NOT prove the rendered backdrop is not dark: that needs a real paint of the checkerboard
 *   rule in `src/index.scss` under a boot the app performed itself, which neither jsdom nor a
 *   hand-rolled `window` can observe — a test written that way would pass without proving
 *   anything, which is the failure mode this file exists to remove. The render half is a
 *   headless spec's job; the predicate half is already covered by
 *   `canvas-pixel-analysis.unit.test.ts`.
 */

const FIXTURE_URL = new URL('../../fixtures/extended-test.ts', import.meta.url);
const SOURCE = readFileSync(FIXTURE_URL, 'utf8');
const FIXTURE = ts.createSourceFile('extended-test.ts', SOURCE, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** The three keys the init script is handed, which are exactly the three the fixture declares. */
interface ThemeConstants {
  readonly storageKey: string;
  readonly releaseKey: string;
  readonly theme: string;
}

/** The init script as Playwright receives it: a function, serialised and run inside the page. */
type InitScript = (payload: ThemeConstants) => void;

/** The slice of `Storage` the pin and the release use, over a log of what the script did. */
type StorageDouble = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & {
  readonly written: ReadonlyMap<string, string | null>;
};

function nodes<T extends ts.Node>(root: ts.Node, guard: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  const visit = (node: ts.Node): void => {
    if (guard(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/**
 * `expect(...)` outside a test throws, so this stands in for the early return every
 * structural lookup below would otherwise need. A missing node and a wrong node produce the
 * same red test, but only this one produces a message that names what moved.
 */
function required<T>(value: T | undefined | false, message: string): T {
  expect(value, message).toBeTruthy();
  return value as T;
}

/**
 * The string literal a `const` of this name is initialised with, if there is exactly one and
 * it is a literal. Anything else — a template, a concatenation, a `let` reassigned later —
 * answers `undefined` rather than guessing, because a value computed at runtime is a value
 * this file would then be unable to state.
 */
function declaredString(name: string): string | undefined {
  const declarations = nodes(FIXTURE, ts.isVariableDeclaration).filter(
    (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name
  );
  if (declarations.length !== 1) return undefined;
  const initializer = declarations[0].initializer;
  return initializer !== undefined && ts.isStringLiteral(initializer) ? initializer.text : undefined;
}

/** The storage key, the release key and the theme, each as the literal the fixture pins. */
function themeConstants(): ThemeConstants {
  return {
    storageKey: required(
      declaredString('THEME_STORAGE_KEY'),
      'extended-test.ts still declares THEME_STORAGE_KEY as one string literal. The payload names it and ThemeProvider reads it, so a computed or duplicated declaration makes the pin uncheckable here.'
    ),
    releaseKey: required(
      declaredString('THEME_PIN_RELEASE_KEY'),
      'extended-test.ts still declares THEME_PIN_RELEASE_KEY as one string literal. The payload and useAppDefaultTheme must agree on it, and an app that never reads sessionStorage is what makes the name collision impossible.'
    ),
    theme: required(
      declaredString('PINNED_THEME'),
      'extended-test.ts still declares PINNED_THEME as one string literal. This is the value the whole pixel oracle is calibrated against, so it must be readable without running the app.'
    ),
  };
}

/** The `{ consolePolice, pinnedTheme }` object literal handed to `base.extend`. */
function fixtureRegistry(): ts.ObjectLiteralExpression {
  const extends_ = nodes(FIXTURE, ts.isCallExpression).filter(
    (call) => ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'extend'
  );
  expect(
    extends_,
    'extended-test.ts calls test.extend exactly once, which is what makes the registry the only place a fixture can be added'
  ).toHaveLength(1);
  return required(
    ts.isObjectLiteralExpression(extends_[0].arguments[0]) ? extends_[0].arguments[0] : undefined,
    'the extend() argument is an object literal of fixtures'
  );
}

function propertyAssignment(object: ts.ObjectLiteralExpression, name: string, owner: string): ts.PropertyAssignment {
  return required(
    object.properties.find(
      (property): property is ts.PropertyAssignment =>
        ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name
    ),
    `${owner} still declares a ${name} entry`
  );
}

/** An object literal as `key -> value node`, refusing spreads and computed keys explicitly. */
function objectEntries(object: ts.ObjectLiteralExpression, owner: string): Map<string, ts.Expression> {
  return new Map(
    object.properties.map((property) => {
      const assignment = required(
        ts.isPropertyAssignment(property) ? property : undefined,
        `every entry of ${owner} is a \`key: value\` assignment; a shorthand, a method or a spread means the shape this file reads is no longer the shape the code has`
      );
      const key = required(
        ts.isIdentifier(assignment.name) ? assignment.name.text : undefined,
        `every key of ${owner} is a plain identifier, so a computed or quoted key cannot smuggle a value past these assertions`
      );
      return [key, assignment.initializer] as const;
    })
  );
}

/** The `[fixture, options]` tuple Playwright's `extend` accepts. */
function fixtureTuple(name: string): [ts.Expression, ts.Expression] {
  const entry = propertyAssignment(fixtureRegistry(), name, 'the fixture registry');
  const elements = required(
    ts.isArrayLiteralExpression(entry.initializer) ? [...entry.initializer.elements] : undefined,
    `the ${name} entry is the [fixture, options] tuple Playwright's extend expects`
  );
  expect(elements, `the ${name} entry is a two-element tuple: the fixture and its options`).toHaveLength(2);
  return [elements[0], elements[1]];
}

/** The one `page.addInitScript` call inside the `pinnedTheme` fixture. */
function initScriptCall(): ts.CallExpression {
  const [fixture] = fixtureTuple('pinnedTheme');
  const calls = nodes(
    required(ts.isArrowFunction(fixture) ? fixture : undefined, 'the pinnedTheme fixture is a function'),
    ts.isCallExpression
  ).filter(
    (call) =>
      ts.isPropertyAccessExpression(call.expression) &&
      call.expression.name.text === 'addInitScript' &&
      ts.isIdentifier(call.expression.expression) &&
      call.expression.expression.text === 'page'
  );
  expect(
    calls,
    'the pinnedTheme fixture still calls page.addInitScript, and calls it once. THIS IS THE FAILURE THIS FILE EXISTS FOR: with no init script every context starts on the app default, which is dark, and every hasDarkPixels assertion in the suite becomes true before a stroke is drawn — silently, with a green run.'
  ).toHaveLength(1);
  return calls[0];
}

/** The payload object handed to `addInitScript`, as `key -> value node`. */
function initScriptPayload(): Map<string, ts.Expression> {
  const [, argument] = initScriptCall().arguments;
  return objectEntries(
    required(
      ts.isObjectLiteralExpression(argument) ? argument : undefined,
      'the init script is handed a payload object literal as its second argument, not a bare string'
    ),
    'the init script payload'
  );
}

/** The payload with every identifier resolved through the constants the fixture declares. */
function resolvedInitScriptPayload(): Record<string, string> {
  return Object.fromEntries(
    [...initScriptPayload()].map(([key, value]) => {
      const constant = required(
        ts.isIdentifier(value) ? value.text : undefined,
        `the payload's \`${key}\` is a bare identifier naming a module constant. A literal spelled inline is the same value today and a second home for it tomorrow, which is how the pin and the release end up disagreeing.`
      );
      return [
        key,
        required(
          declaredString(constant),
          `the payload's \`${key}\` names \`${constant}\`, which is not one string literal in extended-test.ts`
        ),
      ];
    })
  );
}

/**
 * The init script as a callable, rebuilt from its own source text.
 *
 * `new Function` is legitimate here for the same reason Playwright can serialise it at all:
 * the function is handed to `addInitScript`, which stringifies it and evaluates it in the
 * page BEFORE any app script runs, so it can only close over its own parameters. That
 * property is what makes the payload testable with no browser — and if a future edit gives
 * it a closure over module scope, this throws instead of quietly testing a stub.
 */
function initScript(): InitScript {
  const [definition] = initScriptCall().arguments;
  const source = required(definition, 'the init script has a definition to evaluate').getText(FIXTURE);
  const rebuilt = new Function(`return (${source});`)() as InitScript | undefined;
  return required(typeof rebuilt === 'function' ? rebuilt : undefined, 'the init script is a function expression');
}

/** The function `useAppDefaultTheme` hands to `page.evaluate`, rebuilt the same way. */
function releaseScript(): InitScript {
  const declaration = required(
    nodes(FIXTURE, ts.isFunctionDeclaration).find((candidate) => candidate.name?.text === 'useAppDefaultTheme'),
    'extended-test.ts still exports useAppDefaultTheme — the one deliberate release of the pin, asserted by `with nothing stored the document starts dark`'
  );
  const evaluate = nodes(declaration, ts.isCallExpression).filter(
    (call) => ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'evaluate'
  );
  expect(evaluate, 'useAppDefaultTheme releases the pin through exactly one page.evaluate').toHaveLength(1);
  const [definition] = evaluate[0].arguments;
  const source = required(definition, 'the release hands page.evaluate a function to evaluate').getText(FIXTURE);
  const rebuilt = new Function(`return (${source});`)() as InitScript | undefined;
  return required(typeof rebuilt === 'function' ? rebuilt : undefined, 'the release is a function expression');
}

/**
 * The slice of `Storage` the pin and the release use.
 *
 * `written` is a LOG of what the page-side code did, not a snapshot of the store, and a `null`
 * entry records a removal. Both halves of the distinction are load-bearing: a seeded store
 * answers "what is stored now", which cannot tell a pin that declined to write from a pin that
 * wrote the value it was already going to find, and the "only seeds an absent value" contract
 * is exactly the claim that a stored theme is never rewritten.
 */
function memoryStorage(seed: Readonly<Record<string, string>> = {}): StorageDouble {
  const store = new Map(Object.entries(seed));
  const written = new Map<string, string | null>();
  return {
    getItem: (key) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key, value) => {
      store.set(key, value);
      written.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
      written.set(key, null);
    },
    get written(): ReadonlyMap<string, string | null> {
      return new Map(written);
    },
  };
}

/** What an explicit `page.goto('about:blank')` leaves behind: every storage access throws. */
function opaqueStorage(): StorageDouble {
  const refuse = (): never => {
    throw new Error('SecurityError: Failed to read the localStorage property from Window');
  };
  return { getItem: refuse, setItem: refuse, removeItem: refuse, written: new Map() };
}

/**
 * Run one of the two page-side functions against a hand-built `window`.
 *
 * The functions read the global `window`, not a parameter, so the only way to invoke them
 * outside a browser is to publish one — and `vi.stubGlobal` publishes exactly that, torn
 * down in `afterEach` so no other file can see a storage double.
 */
function runInPage(
  script: InitScript,
  constants: ThemeConstants,
  local: StorageDouble,
  session: StorageDouble = memoryStorage()
): void {
  vi.stubGlobal('window', { localStorage: local, sessionStorage: session });
  script(constants);
}

describe('the pinnedTheme init-script payload', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hands the fixture three keys and nothing else, so a new one cannot arrive unnoticed', () => {
    expect([...initScriptPayload().keys()].sort()).toEqual(['releaseKey', 'storageKey', 'theme']);
  });

  it('names the theme storage key the app reads, and pins it to light', () => {
    const { storageKey, releaseKey, theme } = themeConstants();
    const payload = resolvedInitScriptPayload();

    // `storageKey` is the key `ThemeProvider` reads inside its `useState` initializer, and
    // `theme` is what the pixel oracle is calibrated against. Both are asserted against the
    // literals the fixture declares rather than against a second copy of them written here,
    // because a copy in this file would be a constant that can drift away from the pin while
    // still passing.
    expect(payload).toEqual({ storageKey, releaseKey, theme });
    expect(storageKey, 'ThemeProvider reads localStorage.getItem("theme"), so the key is a contract, not a name').toBe(
      'theme'
    );
    expect(theme, 'the whole suite is light because the app default is dark, so the pin is the OTHER value').toBe(
      'light'
    );
    expect(releaseKey, 'the app never touches sessionStorage, which is what makes this name collision-proof').toBe(
      'e2e-theme-pin-released'
    );
  });

  it('registers the fixture as auto, because a pin a spec can opt out of is not a pin', () => {
    const [, options] = fixtureTuple('pinnedTheme');
    const shape = objectEntries(
      required(
        ts.isObjectLiteralExpression(options) ? options : undefined,
        'the pinnedTheme options are an object literal'
      ),
      'the pinnedTheme options'
    );
    const auto = required(
      shape.get('auto'),
      'the pinnedTheme options still declare `auto`, which is the only thing making the pin opt-OUT rather than opt-in'
    );
    expect(auto.kind, 'the pin is opted into by default, so a spec that forgets it still gets the light backdrop').toBe(
      ts.SyntaxKind.TrueKeyword
    );
  });

  it('writes light into the theme key on a fresh context, which is the entire point of it', () => {
    const constants = themeConstants();
    const local = memoryStorage();

    runInPage(initScript(), constants, local);

    // The fresh-context case and ONLY that case: an init script re-runs on every navigation, so
    // a pin that wrote unconditionally would overwrite the preference the app stored and turn
    // "the choice survives a reload" into a test of the pin. The two runs below hold the other
    // half of that contract; this one holds that it writes at all.
    expect([...local.written], 'the pin writes exactly one key, to the theme key, and to no other').toEqual([
      [constants.storageKey, 'light'],
    ]);
  });

  it('writes nothing once a theme is stored, so a reload proves persistence rather than the pin', () => {
    const constants = themeConstants();
    const local = memoryStorage({ [constants.storageKey]: 'dark' });

    runInPage(initScript(), constants, local);

    // Seeded DARK on purpose: the value the pin would write is the value already there, so a
    // store snapshot could not tell "declined to write" from "rewrote the same thing". The
    // write log can, and that difference is the contract.
    expect(
      [...local.written],
      'an app-resolved theme is left exactly as the app left it, so the pin never asserts itself across a reload'
    ).toEqual([]);
  });

  it('writes nothing when the release flag is set for the tab', () => {
    const constants = themeConstants();
    const local = memoryStorage();

    runInPage(initScript(), constants, local, memoryStorage({ [constants.releaseKey]: '1' }));

    expect([...local.written], 'the release flag short-circuits the pin before it writes').toEqual([]);
  });

  it('survives an opaque origin without throwing, which is what the catch is for', () => {
    const constants = themeConstants();

    // `ConsolePolice` fails a test on any page error, and after an explicit
    // `page.goto('about:blank')` all three storage calls throw `SecurityError`. Unguarded, an
    // init script turns a navigation that asserts nothing into a red test in whichever spec
    // happened to do it.
    expect(() => runInPage(initScript(), constants, opaqueStorage())).not.toThrow();
  });

  it('leaves useAppDefaultTheme able to un-pin the suite, so the default-dark test still tests the default', () => {
    const constants = themeConstants();
    const local = memoryStorage();
    const session = memoryStorage();

    // The three steps in the order the real flow runs them, in ONE tab: the pin seeds a fresh
    // context, the release runs in the same tab, and the next load — which re-runs the init
    // script — must find nothing to do. This is `with nothing stored the document starts dark`,
    // and it is why this file does not simply forbid a release: the release is a documented part
    // of the contract, so a tripwire that broke it would itself be the defect.
    runInPage(initScript(), constants, local, session);
    expect(
      local.written.get(constants.storageKey),
      'the fresh-context load writes light before the release ever runs'
    ).toBe('light');

    runInPage(releaseScript(), constants, local, session);
    expect(
      local.written.get(constants.storageKey),
      'the release REMOVES the stored theme rather than overwriting it, or the app still resolves the pin'
    ).toBeNull();
    expect(
      session.written.get(constants.releaseKey),
      'the release flag is the SAME key the pin reads, or the release is a silent no-op'
    ).toBe('1');

    const afterRelease = [...local.written];
    runInPage(initScript(), constants, local, session);
    expect(
      [...local.written],
      'a reload with the flag set writes nothing, so the app resolves its own default'
    ).toEqual(afterRelease);
  });
});
