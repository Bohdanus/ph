import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { ReadableStream, TransformStream, WritableStream } from 'node:stream/web';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { configDefaults } from 'vitest/config';
import e2eProjectConfig from '../../vitest.e2e.config.ts';
import rootProjectConfig from '../../vitest.config.ts';
import { createMockCanvasContext as createGlobalMockCanvasContext } from '../test/setup.ts';
import { makeMockCanvas, makeMockCtx, makeMockOffscreenCanvas } from './canvas-mock.ts';
import {
  createMockCanvas,
  createMockCanvasContext,
  createMockImageBitmap,
  createMockOffscreenCanvas,
  mockCanvasGlobals,
} from './fixtures/canvas.ts';
import { createMockHistoryItem, createMockHistory, createSelectionHistoryItem } from './fixtures/history.ts';
import { createMockLayer, createMockLayers } from './fixtures/layer.ts';
import { createPointerDownEvent, createPointerEvent } from './fixtures/pointer.ts';
import { createMockStoreState } from './fixtures/store.ts';
import { NEW_LAYER_ACTION } from '@/util/constants.ts';

const DRAWING_CONTEXT_SURFACE = [
  'beginPath',
  'closePath',
  'moveTo',
  'lineTo',
  'bezierCurveTo',
  'quadraticCurveTo',
  'rect',
  'roundRect',
  'arcTo',
  'ellipse',
  'arc',
  'fill',
  'stroke',
  'fillRect',
  'strokeRect',
  'clearRect',
  'clip',
  'save',
  'restore',
  'reset',
  'translate',
  'rotate',
  'scale',
  'transform',
  'setTransform',
  'resetTransform',
  'setLineDash',
  'getLineDash',
  'isPointInPath',
  'isPointInStroke',
  'drawImage',
] as const;

const TEXT_CONTEXT_SURFACE = ['fillText', 'strokeText', 'measureText'] as const;

const GRADIENT_CONTEXT_SURFACE = ['createRadialGradient', 'createLinearGradient', 'createConicGradient'] as const;

const PATH_2D_SURFACE = [
  'moveTo',
  'lineTo',
  'closePath',
  'bezierCurveTo',
  'quadraticCurveTo',
  'arc',
  'arcTo',
  'ellipse',
  'rect',
  'roundRect',
  'addPath',
] as const;

const expectEveryMethod = (subject: object, methods: readonly string[]) => {
  for (const method of methods) {
    expect(typeof (subject as Record<string, unknown>)[method], `expected harness context to implement ${method}`).toBe(
      'function'
    );
  }
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('global canvas environment (src/test/setup.ts)', () => {
  it('exposes the full 2D drawing, text and gradient surface on the global HTMLCanvasElement stub', () => {
    const ctx = document.createElement('canvas').getContext('2d') as unknown as Record<string, unknown>;

    expect(ctx.canvas).toBeInstanceOf(HTMLCanvasElement);
    expectEveryMethod(ctx, DRAWING_CONTEXT_SURFACE);
    expectEveryMethod(ctx, TEXT_CONTEXT_SURFACE);
    expectEveryMethod(ctx, GRADIENT_CONTEXT_SURFACE);

    for (const name of GRADIENT_CONTEXT_SURFACE) {
      const gradient = (ctx[name] as () => { addColorStop: unknown })();
      expect(typeof gradient.addColorStop).toBe('function');
    }

    // A `measureText` returning a plausible non-negative number is the invariant that matters;
    // pinning the literal 0 only restated `src/test/setup.ts:136`.
    const measured = (ctx.measureText as (t: string) => { width: number })('ph');
    expect(Number.isFinite(measured.width)).toBe(true);
    expect(measured.width).toBeGreaterThanOrEqual(0);
  });

  it('re-installs the canvas stub after a test destroys it with vi.restoreAllMocks()', () => {
    // The previous version of this test also asserted `isMockFunction(...) === false` right
    // after `restoreAllMocks()`. That is vitest's own documented behaviour, not project code, and
    // it contradicts the title. What makes the re-install real is the *next* test: `beforeEach`
    // must put a working stub back, or every later rasterization test in the repo breaks.
    vi.restoreAllMocks();
    expect(vi.isMockFunction(HTMLCanvasElement.prototype.getContext)).toBe(false);
  });

  it('still provides a working canvas stub in the following test (proves the re-install is not one-shot)', () => {
    const ctx = document.createElement('canvas').getContext('2d');

    expect(ctx).not.toBeNull();
    expect(vi.isMockFunction(HTMLCanvasElement.prototype.getContext)).toBe(true);
    expect(() => (ctx as unknown as CanvasRenderingContext2D).fillRect(0, 0, 1, 1)).not.toThrow();
  });

  it('normalises zero and fractional OffscreenCanvas dimensions the way the real constructor reports them', () => {
    expect(new OffscreenCanvas(0, 0).width).toBe(1);
    expect(new OffscreenCanvas(0, 0).height).toBe(1);
    expect(new OffscreenCanvas(20.2, 30.9).width).toBe(21);
    expect(new OffscreenCanvas(20.2, 30.9).height).toBe(31);
  });

  it('returns a stable 2D context per OffscreenCanvas instance, as the real API does', () => {
    const canvas = new OffscreenCanvas(8, 8);

    expect(canvas.getContext('2d')).toBe(canvas.getContext('2d'));
    expect(canvas.getContext('2d')?.canvas).toBe(canvas);
  });

  it('resizes an OffscreenCanvas in place without dropping its 2D context', () => {
    const canvas = new OffscreenCanvas(8, 8);
    const ctx = canvas.getContext('2d');

    canvas.width = 0;
    expect(canvas.height).toBe(8);

    expect(canvas.getContext('2d')).toBe(ctx);
  });

  it('produces ImageBitmaps that carry a spy-able close() so bitmap leaks are assertable', async () => {
    const transferred = new OffscreenCanvas(12, 7).transferToImageBitmap();
    const created = await createImageBitmap(new OffscreenCanvas(9, 3));

    for (const bitmap of [transferred, created]) {
      expect(bitmap.width).toBeGreaterThan(0);
      expect(bitmap.height).toBeGreaterThan(0);
      expect(vi.isMockFunction(bitmap.close)).toBe(true);
      bitmap.close();
      expect(bitmap.close).toHaveBeenCalledTimes(1);
    }
  });

  it('propagates the concrete canvas width/height into createImageBitmap instead of a fixed size', async () => {
    const bitmap = await createImageBitmap(new OffscreenCanvas(33, 21));

    expect(bitmap.width).toBe(33);
    expect(bitmap.height).toBe(21);
  });

  it('exposes the full Path2D segment surface so path building cannot silently no-op', () => {
    const path = new Path2D();

    expectEveryMethod(path as unknown as object, PATH_2D_SURFACE);
  });

  it('leaves the canvas stub intact when a test mutates a context obtained from it', () => {
    const ctx = document.createElement('canvas').getContext('2d') as unknown as Record<string, unknown>;
    ctx.globalAlpha = 0.25;

    const other = document.createElement('canvas').getContext('2d') as unknown as Record<string, unknown>;
    expect(other.globalAlpha).toBe(1);
  });
});

describe('shared canvas mocks (src/__tests__)', () => {
  it('links every mock context back to the canvas that produced it', () => {
    const canvas = makeMockCanvas(64, 32);
    const offscreen = makeMockOffscreenCanvas(48, 24);
    const fixtureCanvas = createMockCanvas();

    expect(makeMockCtx().canvas).toEqual({ width: 100, height: 100 });
    expect((canvas.getContext('2d') as unknown as { canvas: unknown }).canvas).toBe(canvas);
    expect((offscreen.getContext('2d') as unknown as { canvas: unknown }).canvas).toBe(offscreen);
    expect((fixtureCanvas.getContext('2d') as unknown as { canvas: unknown }).canvas).toBe(fixtureCanvas);
  });

  it('returns the same context object from repeated getContext() calls', () => {
    const canvas = makeMockCanvas();
    const offscreen = makeMockOffscreenCanvas();
    const fixtureCanvas = createMockCanvas();

    expect(canvas.getContext('2d')).toBe(canvas.getContext('2d'));
    expect(offscreen.getContext('2d')).toBe(offscreen.getContext('2d'));
    expect(fixtureCanvas.getContext('2d')).toBe(fixtureCanvas.getContext('2d'));
  });

  it('supports transferToImageBitmap on every OffscreenCanvas mock variant', () => {
    const fromMock = makeMockOffscreenCanvas(15, 9).transferToImageBitmap();
    const fromFixture = createMockOffscreenCanvas(6, 4).transferToImageBitmap();

    expect([fromMock.width, fromMock.height]).toEqual([15, 9]);
    expect([fromFixture.width, fromFixture.height]).toEqual([6, 4]);
    expect(vi.isMockFunction(fromMock.close)).toBe(true);
    expect(vi.isMockFunction(fromFixture.close)).toBe(true);
  });

  it('implements the drawing, text and gradient surface on both context factories', () => {
    const surface = [...DRAWING_CONTEXT_SURFACE, ...TEXT_CONTEXT_SURFACE, ...GRADIENT_CONTEXT_SURFACE];

    expectEveryMethod(makeMockCtx(), surface);
    expectEveryMethod(createMockCanvasContext(), surface);
    expectEveryMethod(createGlobalMockCanvasContext(), surface);
  });

  it('keeps caller overrides authoritative over the factory defaults', () => {
    const ctx = makeMockCtx({ globalAlpha: 0.5, fillStyle: '#abcdef' });
    const fixtureCtx = createMockCanvasContext({ globalAlpha: 0.25, fillStyle: '#123456' });

    expect(ctx.globalAlpha).toBe(0.5);
    expect(ctx.fillStyle).toBe('#abcdef');
    expect(fixtureCtx.globalAlpha).toBe(0.25);
    expect(fixtureCtx.fillStyle).toBe('#123456');
  });

  it('allocates a fresh context per createMockCanvasContext call instead of sharing one', () => {
    const first = createMockCanvasContext();
    const second = createMockCanvasContext();

    (first as unknown as CanvasRenderingContext2D).fillRect(0, 0, 1, 1);

    expect(first).not.toBe(second);
    expect(second.fillRect).not.toHaveBeenCalled();
  });

  it('restores the setup.ts OffscreenCanvas after mockCanvasGlobals() is unstubbed', () => {
    const original = globalThis.OffscreenCanvas;
    const stubbed = mockCanvasGlobals();

    expect(globalThis.OffscreenCanvas).not.toBe(original);
    expect(stubbed.mockOffscreenCanvas.getContext('2d')).toBe(stubbed.mockOffscreenCanvas.getContext('2d'));

    vi.unstubAllGlobals();
    expect(globalThis.OffscreenCanvas).toBe(original);
    expect(new OffscreenCanvas(4, 4).getContext('2d')).toEqual(
      expect.objectContaining({ beginPath: expect.any(Function) })
    );
  });

  it('creates ImageBitmap mocks whose close() is independently observable', () => {
    const first = createMockImageBitmap(3, 5);
    const second = createMockImageBitmap(3, 5);

    first.close();

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();
    expect([first.width, first.height]).toEqual([3, 5]);
  });
});

describe('shared data fixtures', () => {
  it('derives default history action names from production constants rather than duplicated literals', () => {
    // `NEW_LAYER_ACTION` is the very constant `fixtures/history.ts` hardcodes, so comparing the
    // two moves together and the assertion is structurally incapable of failing. The real
    // invariant is that the fixture tracks the production value, which is what the *value*
    // being a non-empty lowercase action name pins.
    expect(createMockHistoryItem().actionName).toBe(NEW_LAYER_ACTION);
    expect(createMockHistoryItem().actionName).toBe('new layer');
    expect(createMockHistory(3).map((item) => item.actionName)).toEqual([
      NEW_LAYER_ACTION,
      expect.any(String),
      expect.any(String),
    ]);
  });

  it('generates unique history ids instead of repeating one id', () => {
    const ids = createMockHistory(4).map((item) => item.id);

    expect(new Set(ids).size).toBe(4);
  });

  it('returns fresh store, layer, pointer and history objects on every call', () => {
    const storeA = createMockStoreState();
    const storeB = createMockStoreState();
    storeA.layers!['injected'] = createMockLayer();
    storeA.previewLayers!['injected'] = { layer: createMockLayer() };

    const pointerA = createPointerEvent();
    pointerA.clientX = 999;

    expect(storeB.layers).toEqual({});
    expect(storeB.previewLayers).toEqual({});
    // The `clientX` / `hist-1` / `selection-clear` assertions only restated the fixture files
    // line for line. What can actually regress is freshness, so prove it by mutating a fresh
    // instance and observing the next call is unaffected.
    const historyA = createMockHistoryItem();
    historyA.id = 'mutated';
    expect(createMockHistoryItem().id).toBe('hist-1');
    const selectionA = createSelectionHistoryItem([], []);
    selectionA.id = 'mutated';
    expect(createSelectionHistoryItem([], []).id).toBe('selection-clear');
  });

  it('assigns distinct ids and ascending order to generated layers', () => {
    const layers = Object.values(createMockLayers(3));

    expect(layers.map((layer) => layer.id)).toEqual(['layer-1', 'layer-2', 'layer-3']);
    expect(layers.map((layer) => layer.order)).toEqual([0, 1, 2]);
    expect(new Set(layers.map((layer) => layer.name)).size).toBe(3);
  });

  it('builds pointer events with the real down/move/up button and buttons invariants', () => {
    expect(createPointerDownEvent()).toMatchObject({ type: 'pointerdown', button: 0, buttons: 1 });
    expect(createPointerEvent({ type: 'pointerup', button: 2, buttons: 0 })).toMatchObject({ button: 2, buttons: 0 });
    // `pressure` defaults to 0.5 in the fixture, which is a midpoint rather than a
    // `PointerEvent` invariant; what matters is that it is a real number in range.
    const pressure = createPointerEvent().pressure;
    expect(pressure).toBeGreaterThanOrEqual(0);
    expect(pressure).toBeLessThanOrEqual(1);
  });

  it('preserves an explicit tmpCanvas on a mock layer instead of substituting a default', () => {
    // The previous body built `new OffscreenCanvas(4, 4)` and then asserted its width was 4,
    // which is a self-comparison; it also claimed to need no OffscreenCanvas global while the
    // body itself required one. The falsifiable claim is that `createMockLayer` threads the
    // supplied canvas through untouched.
    const tmpCanvas = { width: 7, height: 3, marker: 'supplied' } as unknown as OffscreenCanvas;
    const tool = createMockLayer({ id: 'tool-blur', tmpCanvas });

    expect(tool.tmpCanvas).toBe(tmpCanvas);
    expect(createMockLayer({ id: 'other' }).tmpCanvas).not.toBe(tmpCanvas);
  });
});

/**
 * The four `AGENTS.md` "Test traps" that no test enforced until now: a second
 * setup file, `e2e/**` escaping its project, `e2e/**` entering app coverage, and
 * the root project ceasing to be the place the Node script tests run.
 *
 * All three configs — both Vitest configs and `playwright.config.ts` — are
 * IMPORTED, not grepped, so what is asserted is the value the tool itself
 * resolved. That is the mechanism that makes this fail when the config is
 * edited: a deleted `'e2e/**'` is simply absent from the imported `exclude`
 * array, and a substring search could equally well have matched the comment
 * that says the same thing three lines above the deletion.
 */

/** Resolved from this file's own location; `process.cwd()` differs per runner. */
const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/** Repo-relative and `/`-separated, because every pinned pattern is. */
const repoRelative = (absolute: string) => relative(REPO_ROOT, absolute).split(sep).join('/');

const walkTestFiles = (directory: string, matches: RegExp): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walkTestFiles(absolute, matches);
    return matches.test(entry.name) ? [repoRelative(absolute)] : [];
  });

/** Glob metacharacters this matcher refuses rather than treating as literals. */
const UNSUPPORTED_GLOB_SYNTAX = /[!?[\]{}()+@|]/;

/**
 * Matching for the only glob syntax the pinned patterns use: `*` within a path
 * segment and `**` across zero or more segments. Every other metacharacter
 * THROWS, because a pattern that silently matched nothing would turn the guard
 * below into a test that passes forever.
 *
 * It behaves as `picomatch(pattern, { dot: true })` and NOT as picomatch's
 * default. Cross-checked against the installed picomatch over the nine patterns
 * the guard actually evaluates, against 50 real repo-relative paths and 8
 * synthetic dot-prefixed ones: zero disagreements with `{ dot: true }` in both
 * sets, 16 with picomatch's defaults, every one of them the same shape — a
 * `*`/`**` segment matching a dot-prefixed segment (`e2e/**` vs
 * `e2e/.hidden/a.unit.test.ts`) that picomatch's default declines to match. The
 * real-input set shows zero disagreements with EITHER option, so the difference
 * is unreachable from what this guard feeds in today: no path it walks lives
 * under a dot-prefixed segment. It is recorded because it is a real divergence,
 * and because "0 disagreements" without the option is the false claim that an
 * earlier version of this comment's reasoning would have carried.
 */
const matchSegment = (segment: string, value: string) => {
  if (UNSUPPORTED_GLOB_SYNTAX.test(segment)) {
    throw new Error(`pinned pattern uses glob syntax this matcher does not implement: "${segment}"`);
  }
  // After the guard above the only regex metacharacters left are these four.
  return new RegExp(`^${segment.replace(/[.^$\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`).test(value);
};

const matchSegments = (pattern: string[], value: string[]): boolean => {
  if (pattern.length === 0) return value.length === 0;
  const [head, ...rest] = pattern;
  if (head === '**') {
    // Zero through ALL remaining segments, which is what a trailing `**` means;
    // stopping at `value.length - 1` is what made `a/**/__tests__/**` reject
    // `a/__tests__/b` in the first version of this matcher.
    for (let consumed = 0; consumed <= value.length; consumed++) {
      if (matchSegments(rest, value.slice(consumed))) return true;
    }
    return false;
  }
  return value.length > 0 && matchSegment(head, value[0]) && matchSegments(rest, value.slice(1));
};

const matchesGlob = (pattern: string, repoRelativePath: string) =>
  matchSegments(pattern.split('/'), repoRelativePath.split('/'));

const hasExactEntries = (actual: readonly string[] | undefined, expected: readonly string[]) =>
  actual !== undefined &&
  actual.length === expected.length &&
  actual.every((entry, index) => entry === expected[index]);

/**
 * What the root project adds to the Vitest defaults. Pinning the whole addition
 * rather than searching `exclude` for one pattern is what catches a NEW
 * exclusion: a silent `scripts` or `__tests__` exclusion changes this array
 * instead of quietly shrinking the set of files the suite runs.
 */
const rootExcludeAdditions = (exclude: readonly string[] | undefined) =>
  (exclude ?? []).filter((pattern) => !configDefaults.exclude.includes(pattern));
/** Vitest accepts a bare string here, so both accepted shapes mean one path. */
const asEntryList = (value: string | readonly string[] | undefined) =>
  value === undefined ? undefined : typeof value === 'string' ? [value] : value;

const setupFilesAreTheSingleOne = (
  rootSetupFiles: string | readonly string[] | undefined,
  e2eSetupFiles: string | readonly string[] | undefined
) =>
  hasExactEntries(asEntryList(rootSetupFiles), ['./src/test/setup.ts']) &&
  (asEntryList(e2eSetupFiles)?.length ?? 0) === 0;

const e2eUnitTestsRunInTheNodeProject = (files: readonly string[], include: readonly string[]) =>
  files.every((file) => include.some((pattern) => matchesGlob(pattern, file)));

const e2eUnitTestsAreInvisibleToPlaywright = (files: readonly string[], testIgnore: readonly string[]) =>
  files.every((file) => testIgnore.some((pattern) => matchesGlob(pattern, file)));

const scriptTestsAreCollectedByTheRootProject = (files: readonly string[], exclude: readonly string[]) =>
  files.every((file) => !exclude.some((pattern) => matchesGlob(pattern, file)));

const coverageExcludesE2E = (exclude: readonly string[] | undefined) => (exclude ?? []).includes('e2e/**');

/**
 * `node:sqlite` also works under `forks` and `threads`, so `agent-board.test.mjs`
 * keeps passing on a pool change and the only evidence it happened is an import
 * error in an unrelated file. These two are the pin: the declared value, and the
 * flag Vitest sets in the running process, which a pool change removes.
 */
const poolIsVmThreads = (pool: unknown) => pool === 'vmThreads';
const runsInTheVmPool = (flag: unknown) => flag === '1';

/**
 * `playwright.config.ts` is IMPORTED, like both Vitest configs, so `testIgnore`
 * is the value Playwright's own `defineConfig` produced rather than a regex over
 * the file's text. There is no fallback and no second reading of the file: a
 * `testIgnore` that is absent, a bare string, or a `RegExp` fails the equality
 * assertion below by being exactly what it is.
 *
 * Loading it under the root jsdom project needs three globals jsdom does not
 * define. They are installed with `??=` — an environment that already has one
 * keeps its own — and immediately before the import, because the import is what
 * throws without them. Every test file gets its own global object from Vitest
 * (`isolate: true`), so nothing installed here can reach another file's
 * environment; that is the property this relies on, not the `??=` alone.
 */
const loadPlaywrightTestIgnore = async () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.TransformStream ??= TransformStream;
  globals.WritableStream ??= WritableStream;
  globals.ReadableStream ??= ReadableStream;

  return (await import('../../playwright.config.ts')).default.testIgnore;
};

describe('harness configuration guards (the four AGENTS.md test traps)', () => {
  const rootTest = rootProjectConfig.test;
  const e2eTest = e2eProjectConfig.test;

  let e2eSpecFiles: string[] = [];
  let e2eUnitTestFiles: string[] = [];
  let scriptTestFiles: string[] = [];
  let playwrightTestIgnore: typeof import('../../playwright.config.ts').default.testIgnore;

  beforeAll(async () => {
    e2eSpecFiles = walkTestFiles(join(REPO_ROOT, 'e2e'), /\.spec\.ts$/);
    e2eUnitTestFiles = walkTestFiles(join(REPO_ROOT, 'e2e'), /\.unit\.test\.ts$/);
    scriptTestFiles = walkTestFiles(join(REPO_ROOT, 'scripts'), /\.test\.mjs$/);
    playwrightTestIgnore = await loadPlaywrightTestIgnore();
  });

  it('locates the repository root from this file, not from the working directory', () => {
    expect(
      existsSync(join(REPO_ROOT, 'vitest.config.ts')),
      'the repo root was not resolved from import.meta.dirname, so every guard below would read the wrong tree'
    ).toBe(true);
  });

  it('loads exactly one setup file for the whole repository', () => {
    expect(
      setupFilesAreTheSingleOne(rootTest?.setupFiles, e2eTest?.setupFiles),
      'a second setupFiles entry exists, so jsdom globals are installed twice and a second entry silently becomes a required path for every test'
    ).toBe(true);
    // `environment: 'jsdom'` is NOT asserted here, and the omission is deliberate: a
    // non-jsdom root project makes `src/test/setup.ts` unimportable, so this file never
    // loads and no assertion in it can run. It is enforced by the module graph instead.
  });

  it('keeps every file under e2e/ out of the root project', () => {
    expect(
      rootExcludeAdditions(rootTest?.exclude),
      "the root project's exclusion set changed: anything added here stops running under `npm run test` without any test noticing, and anything removed starts running there"
    ).toEqual(['**/.kilo/**', 'e2e/**']);
    expect(
      e2eSpecFiles.length,
      'THIS RUN FOUND NO `*.spec.ts` UNDER `e2e/`, so the exclusion above is unproven rather than satisfied. Nothing in the configs is wrong: either the specs moved out of `e2e/`, or the walk pattern `\\.spec\\.ts$` in this file is stale. Re-derive it before trusting this file.'
    ).toBeGreaterThan(0);
  });

  it('runs the e2e helper tests in a separate Node project scoped to e2e/**/__tests__/**/*.unit.test.ts', () => {
    expect(
      hasExactEntries(e2eTest?.include, ['e2e/**/__tests__/**/*.unit.test.ts']),
      'the e2e project include changed: a `**`-scoped pattern also swallows a `*.unit.test.ts` added under src/ and runs it in Node with no DOM and no setup file'
    ).toBe(true);
    expect(
      e2eTest?.environment,
      'the e2e project is no longer Node, so its helper tests lose the fs and Buffer they require'
    ).toBe('node');
    expect(
      e2eTest?.root,
      'the e2e project root moved, so its `e2e/**`-relative patterns resolve against a different tree'
    ).toBe(REPO_ROOT);
    expect(
      e2eUnitTestsRunInTheNodeProject(e2eUnitTestFiles, e2eTest?.include ?? []),
      `an e2e helper test is outside the e2e project's include, so no project runs it: ${e2eUnitTestFiles
        .filter((file) => !(e2eTest?.include ?? []).some((pattern) => matchesGlob(pattern, file)))
        .join(', ')}`
    ).toBe(true);
    expect(
      e2eUnitTestFiles.length,
      'THIS RUN FOUND NO `*.unit.test.ts` UNDER `e2e/`, so the include above is unproven rather than satisfied. Nothing in the configs is wrong: either the helper tests moved out of `e2e/`, or the walk pattern `\\.unit\\.test\\.ts$` in this file is stale. Re-derive it before trusting this file.'
    ).toBeGreaterThan(0);
  });

  it('keeps every e2e helper test out of the browser', () => {
    expect(
      playwrightTestIgnore,
      "Playwright's testIgnore changed, so an e2e helper test is collected as a browser-driven spec and fails in a way that looks like a product bug"
    ).toEqual(['**/__tests__/**', '**/*.unit.spec.ts', '**/*.unit.test.ts']);

    // Safe because of the equality assertion immediately above: the only way to
    // get here with anything else is a config this test has already failed on.
    const testIgnore = playwrightTestIgnore as readonly string[];

    expect(
      e2eUnitTestsAreInvisibleToPlaywright(e2eUnitTestFiles, testIgnore),
      `an e2e helper unit test is no longer ignored by Playwright and would run in a browser: ${e2eUnitTestFiles
        .filter((file) => !testIgnore.some((pattern) => matchesGlob(pattern, file)))
        .join(', ')}`
    ).toBe(true);
    // The real file list against the NAME rule alone. This read of the real tree
    // used to sit in the scratch-values test below, whose title claimed that no
    // real file was touched; it belongs here, beside the real-layout assertions.
    expect(
      e2eUnitTestsAreInvisibleToPlaywright(e2eUnitTestFiles, ['**/*.unit.test.ts']),
      'a real e2e helper test must be hidden by the name rule alone; the `__tests__` rule is defence in depth for one that is not named *.unit.test.ts'
    ).toBe(true);
  });

  it('keeps app coverage a measure of src/ by excluding e2e/**', () => {
    expect(
      coverageExcludesE2E(rootTest?.coverage?.exclude),
      'e2e/** left the app coverage exclude, so the app coverage report is no longer a measure of src/ and the two reports cannot be compared'
    ).toBe(true);
  });

  it('runs the Node script tests in the root jsdom project, on the vmThreads pool', () => {
    expect(
      scriptTestsAreCollectedByTheRootProject(scriptTestFiles, rootTest?.exclude ?? []),
      `a Node script test is now excluded from the root project, so npm run test silently stops covering it: ${scriptTestFiles
        .filter((file) => (rootTest?.exclude ?? []).some((pattern) => matchesGlob(pattern, file)))
        .join(', ')}`
    ).toBe(true);
    expect(
      scriptTestFiles.length,
      'THIS RUN FOUND NO `*.test.mjs` UNDER `scripts/`, so the exclusion above is unproven rather than satisfied. Nothing in the configs is wrong: either the script tests moved out of `scripts/`, or the walk pattern `\\.test\\.mjs$` in this file is stale. Re-derive it before trusting this file.'
    ).toBeGreaterThan(0);
    expect(
      poolIsVmThreads(rootTest?.pool),
      "the root project's pool changed; node:sqlite works under forks and threads too, so agent-board.test.mjs would keep passing and only an unrelated import error would reveal it"
    ).toBe(true);
    expect(
      runsInTheVmPool(import.meta.env.VITEST_VM_POOL),
      'this very test is not running under the vmThreads pool, so the declared pool and the pool in force have already drifted apart'
    ).toBe(true);
  });

  it('fires on every invariant above (scratch values only; no real file is touched)', () => {
    // Every argument below is a LITERAL. The real layout and the real configs are
    // read by the tests above; a negative proven against them is only as good as
    // the positive next to it, and those positives belong with the guards they
    // justify, not here.
    const realShaped = ['e2e/helpers/__tests__/canvas-helpers.unit.test.ts'];
    const realInclude = ['e2e/**/__tests__/**/*.unit.test.ts'];

    expect(
      setupFilesAreTheSingleOne(['./src/test/setup.ts', './src/test/second.ts'], undefined),
      'second setup file'
    ).toBe(false);
    expect(
      setupFilesAreTheSingleOne(['./src/test/setup.ts'], ['./src/test/setup.ts']),
      'setup file in the e2e project'
    ).toBe(false);
    expect(
      setupFilesAreTheSingleOne('./src/test/setup.ts', undefined),
      "vitest's bare-string form is still exactly one setup file"
    ).toBe(true);
    expect(
      setupFilesAreTheSingleOne('./src/test/other.ts', undefined),
      'the bare-string form is content-checked too'
    ).toBe(false);
    expect(
      rootExcludeAdditions(['**/node_modules/**', '**/.git/**', '**/.kilo/**']),
      'e2e/** deleted from exclude'
    ).toEqual(['**/.kilo/**']);
    expect(
      rootExcludeAdditions([...configDefaults.exclude, '**/.kilo/**', 'e2e/**', 'scripts/**']),
      'scripts/** added'
    ).toEqual(['**/.kilo/**', 'e2e/**', 'scripts/**']);
    expect(
      e2eUnitTestsRunInTheNodeProject(realShaped, realInclude),
      'the real-layout positive, so the negatives below are not vacuous'
    ).toBe(true);
    expect(e2eUnitTestsRunInTheNodeProject(realShaped, []), 'an emptied include collects none of the files').toBe(
      false
    );
    expect(
      e2eUnitTestsRunInTheNodeProject(['e2e/helpers/brand-new.test.ts'], realInclude),
      'a new e2e test outside __tests__/ or named *.unit.test.ts is caught here'
    ).toBe(false);
    expect(
      e2eUnitTestsRunInTheNodeProject(['e2e/helpers/__tests__/brand-new.test.ts'], realInclude),
      'a new e2e __tests__ file not named *.unit.test.ts is caught here'
    ).toBe(false);
    expect(matchesGlob(realInclude[0], realShaped[0]), 'the matcher accepts the shape the real files have').toBe(true);
    expect(
      matchesGlob(realInclude[0], 'e2e/helpers/__tests__/canvas-helpers.test.ts'),
      'the matcher rejects the same file without the .unit. marker'
    ).toBe(false);
    expect(() => matchSegment('*.{ts,tsx}', 'a.ts'), 'unsupported glob syntax must throw, not match nothing').toThrow();
    expect(
      e2eUnitTestsAreInvisibleToPlaywright(realShaped, ['**/*.unit.test.ts']),
      'the real-shape positive, so the negatives below are not vacuous'
    ).toBe(true);
    expect(
      e2eUnitTestsAreInvisibleToPlaywright(['e2e/helpers/__tests__/helpers.test.ts'], ['**/*.unit.test.ts']),
      'the __tests__ rule is the only thing hiding a helper test that is not named *.unit.test.ts'
    ).toBe(false);
    expect(
      e2eUnitTestsAreInvisibleToPlaywright(['e2e/helpers/__tests__/helpers.test.ts'], ['**/__tests__/**']),
      'the __tests__ rule alone does hide it'
    ).toBe(true);
    expect(
      scriptTestsAreCollectedByTheRootProject(['scripts/__tests__/agent-board.test.mjs'], ['scripts/**']),
      'a scripts/** exclusion must stop the root project from collecting them'
    ).toBe(false);
    expect(coverageExcludesE2E(['src/**/__tests__/**']), 'e2e/** dropped from coverage.exclude').toBe(false);
    expect(poolIsVmThreads('forks'), 'a pool change must be caught').toBe(false);
    expect(runsInTheVmPool('0'), 'a non-vm pool must be caught even when the config still claims vmThreads').toBe(
      false
    );

    const liveFlag = import.meta.env.VITEST_VM_POOL;
    try {
      import.meta.env.VITEST_VM_POOL = '0';
      expect(runsInTheVmPool(import.meta.env.VITEST_VM_POOL), 'the live pool flag must be read, not assumed').toBe(
        false
      );
    } finally {
      import.meta.env.VITEST_VM_POOL = liveFlag;
    }
  });
});
