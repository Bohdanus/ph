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

  it('hands every convertToBlob call the same zero-byte blob, whatever the canvas holds (MOCK ARTEFACT, not a contract)', async () => {
    // `src/util/selection.ts:739-740` reaches this whenever `copyCanvasToClipboard` is given an
    // OffscreenCanvas, and `src/test/setup.ts:214-216` answers with `new Blob([])` and never
    // looks at the canvas. A test that reaches that path through the global stub therefore
    // receives a zero-byte raster, which at the mock boundary is indistinguishable from a
    // correct one: nothing downstream can tell "the image is empty" from "the stub is empty".
    // The zero bytes are the STUB's artefact. Nothing here licenses a test to treat an empty
    // encode as a passing result — a test that needs a real raster must install its own blob,
    // the way `src/util/__tests__/selection.test.ts:1143` does.
    const first = await new OffscreenCanvas(40, 25).convertToBlob({ type: 'image/png' });
    const second = await new OffscreenCanvas(1, 1).convertToBlob({ type: 'image/png' });

    expect(first).toBeInstanceOf(Blob);
    expect(first.size).toBe(0);
    expect(first.type).toBe('');
    expect(await first.text()).toBe('');

    // Size-independent, and a distinct object per call, so two encodes can never be confused
    // for one another by identity either.
    expect(second).not.toBe(first);
    expect(second.size).toBe(0);
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

  it('derives createImageBitmap from an HTMLCanvasElement too, not only from an OffscreenCanvas', async () => {
    // `src/test/setup.ts:236-242` is a second live branch that no other test in the file
    // reaches. `src/contexts/materialization.ts:178` passes an `HTMLCanvasElement` to this
    // function, so the branch is a production path rather than dead harness code.
    const canvas = document.createElement('canvas');
    canvas.width = 17;
    canvas.height = 9;

    const bitmap = await createImageBitmap(canvas);

    expect(bitmap.width).toBe(17);
    expect(bitmap.height).toBe(9);
    expect(vi.isMockFunction(bitmap.close)).toBe(true);
  });

  it('answers every unrecognised createImageBitmap source with a fixed 100x100 (MOCK ARTEFACT, not a contract)', async () => {
    // `src/test/setup.ts:243-247` is the fall-through: any source that is neither an
    // OffscreenCanvas nor an HTMLCanvasElement gets 100x100 and its own size is never read.
    //
    // This branch IS production-reachable, and the route is NOT through `immutableRaster`.
    // Both `immutableRaster` copies (`src/contexts/useLayer.ts:80-86` and
    // `useApp.ts`'s copy) open with
    // `if (typeof bitmap.close === 'function') return bitmap;`, so a decoded raster
    // early-returns and never reaches `createImageBitmap` — the `transferToImageBitmap()`
    // shape used below is precisely the shape those two functions refuse to forward.
    //
    // The live route is the presentation promotion, which has no such guard:
    //   `src/contexts/layer-presentation.ts:59` `materializePresentationBitmap` calls
    //   `createImageBitmap(canvas)` with its `BitmapSource` argument forwarded unchecked
    //   <- `src/contexts/StoreContext.tsx:1126` `promoteLayerPresentation`, from
    //   <- `src/contexts/useLayer.ts:158` `requestPresentations`, which forwards
    //      `layer.tmpCanvas` as-is
    //   <- `src/contexts/useLayer.ts:587`, where `tmpCanvas` is the FIRST element of
    //      whatever `processor.imageProcessor(...)(toolArgs)` returned.
    // Two selection creators return the INPUT bitmap rather than a fresh canvas —
    // `src/tools/quickSelection.ts:24-28` and `src/tools/ellipticalSelection.ts:28-32` are
    // both literally `return [bitmap];` — so on a layer that already holds a raster, the
    // decoded bitmap becomes `tmpCanvas` and is then promoted as though it were a canvas.
    // That is a close()-bearing, non-canvas source, and the fall-through is what answers it.
    //
    // So an assertion of the form `expect(bitmap.width).toBe(<real value>)` on that path can
    // be passing because of this fall-through rather than because the dimensions are right.
    // The value below is pinned so the fall-through is VISIBLE instead of invisible; it is
    // the stub's answer, not a promise about production.
    //
    // WHEN THE FALL-THROUGH IS FIXED, UPDATE THIS EXPECTATION IN THE SAME CHANGE. A fixed
    // branch will read the source's real size, these two lines will go red, and deleting
    // this test instead of updating it would throw away the only pin on the branch.
    const decoded = new OffscreenCanvas(4, 4).transferToImageBitmap();
    const bitmap = await createImageBitmap(decoded);

    // The source is 4x4 and the answer is 100x100: the fall-through discarded the real size.
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(4);
    expect(bitmap.width).toBe(100);
    expect(bitmap.height).toBe(100);
    expect(vi.isMockFunction(bitmap.close)).toBe(true);

    // The fall-through is idempotent on a second pass, which is precisely why an assertion can
    // pass for the wrong reason: feeding a 100x100 bitmap back in yields 100x100 whether the
    // branch read the source or ignored it.
    const roundTripped = await createImageBitmap(bitmap);
    expect([roundTripped.width, roundTripped.height]).toEqual([100, 100]);
    expect(roundTripped).not.toBe(bitmap);
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
 * The `AGENTS.md` "Test traps" that no test enforced until now, and the two
 * silent holes an adversarial review found in the first version of this file.
 * A guard added here is not in this list until it is here, and the list is what
 * the `it` titles below are checked against:
 *
 * 1. a second `setupFiles` entry, in either project;
 * 2. a `globalSetup` on EITHER project — a second setup file that does not run
 *    through the chain the first check can see. The e2e project is included
 *    because the hazard is identical on the Node side;
 * 3. `e2e/**` entering the root project's collection, through `exclude`;
 * 4. the root project's `exclude` dropping the `configDefaults` spread, which
 *    puts `node_modules/**` and `.git/**` back into the collection while the
 *    pinned "additions" array stays byte-identical;
 * 5. a `*.unit.test.ts` under `e2e/` leaving the e2e project's `include`;
 * 6. one leaving it again through the e2e project's `exclude` — the same loss
 *    through the OTHER of the two keys that decide collection, and the one
 *    `passWithNoTests` cannot see because it only trips on an empty collection;
 * 7. an e2e helper unit test becoming a Playwright spec, through `testIgnore`;
 * 8. Playwright's `testMatch` widening, which collects every `.ts` file under
 *    `e2e/` and subtracts none of them with the three pinned `testIgnore` rules;
 * 9. `e2e/**` entering the app coverage report;
 * 10. the root project ceasing to collect the Node script tests, through
 *     `exclude`;
 * 11. the same loss through the root project's `include` — one line beside the
 *     existing `exclude` drops all 267 collected `scripts/*.test.mjs` cases and
 *     leaves every `exclude`-only guard reading true;
 * 12. a THIRD `vitest*.config.*` at the repo root — or a `vitest.workspace.*`,
 *     which Vitest 5 does not read but a later bump would — which is how a second
 *     project with its own `setupFiles` arrives without anything here noticing;
 * 13. the root project leaving the `vmThreads` pool, declared and in force.
 *
 * All three configs — both Vitest configs and `playwright.config.ts` — are
 * IMPORTED, not grepped, so what is asserted is the value the tool itself
 * resolved. That is the mechanism that makes this fail when the config is
 * edited: a deleted `'e2e/**'` is simply absent from the imported `exclude`
 * array, and a substring search could equally well have matched the comment
 * that says the same thing three lines above the deletion.
 *
 * The recurring defect these two rounds share is reading ONE key where TWO
 * decide the property. Every collection guard below reads both `include` and
 * `exclude`, each falling back to the Vitest default rather than to `[]`, and
 * every one of them is stated over the REAL file list rather than over a
 * pattern, so a guard cannot pass by matching nothing.
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

/**
 * Glob metacharacters with NO implementation here: the negating and grouping
 * extglobs, and a bare `|`. A pattern containing one of these THROWS, because a
 * pattern that silently matched nothing would turn the guard below into a test
 * that passes forever.
 */
const UNSUPPORTED_GLOB_SYNTAX = /[!+@|]/;

/** Only the escape set; `-` needs no escape outside a character class. */
const escapeLiteral = (character: string) => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The alternatives of one group, each translated to a regex body. A `{a,b}`
 * group separates on `,` and a `?(a|b)` group on `|`; the other separator inside
 * either form THROWS, because a silently unevaluated alternative is a pattern
 * that quietly matches something other than what it reads as.
 */
const translateAlternatives = (body: string, separator: ',' | '|') => {
  const other = separator === ',' ? '|' : ',';
  if (body.includes(other)) {
    throw new Error(`pinned pattern mixes "${separator}" and "${other}" inside one glob group: "${body}"`);
  }
  const alternatives = body.split(separator).map(translateSegmentBody);
  if (alternatives.some((alternative) => alternative === '')) {
    throw new Error(`pinned pattern has an empty alternative in "${body}"`);
  }
  return `(?:${alternatives.join('|')})`;
};

/**
 * One path segment's glob, translated to a regex BODY. It supports exactly the
 * syntax the patterns this guard evaluates use: `*`, a `{a,b}` alternation, a
 * `?(a|b)` optional group, and a `[abc]` character class.
 *
 * The three groups beyond `*` exist because a guard now evaluates patterns this
 * FILE did not author: the guards read `include`/`exclude` out of the configs,
 * and a project's `include` is the Vitest DEFAULT when the config declares none
 * — a `**` pattern whose last segment is `*.{test,spec}.?(c|m)[jt]s?(x)` —
 * which is all three at once. Refusing that syntax would make the default
 * unreadable, and hardcoding a hand-typed copy of it would put the value the
 * guard actually needs behind a second copy to keep in step. The default is read
 * from `configDefaults` instead, and matched by the same code that matches the
 * pinned literals.
 *
 * Nesting one group inside another throws, and a negated or first-character
 * character class throws. Both are fail-closed for the same reason
 * `UNSUPPORTED_GLOB_SYNTAX` is: an unevaluated alternative is indistinguishable
 * from a matching one.
 */
const translateSegmentBody = (segment: string): string => {
  let body = '';
  let index = 0;

  while (index < segment.length) {
    const character = segment[index];

    if (UNSUPPORTED_GLOB_SYNTAX.test(character)) {
      throw new Error(`pinned pattern uses glob syntax this matcher does not implement: "${segment}"`);
    }

    if (character === '*') {
      body += '[^/]*';
      index += 1;
      continue;
    }

    if (character === '?') {
      const close = segment.indexOf(')', index + 1);
      if (segment[index + 1] !== '(' || close === -1) {
        throw new Error(
          `pinned pattern uses a single-character "?" glob, which this matcher does not implement: "${segment}"`
        );
      }
      body += `${translateAlternatives(segment.slice(index + 2, close), '|')}?`;
      index = close + 1;
      continue;
    }

    if (character === '[') {
      const close = segment.indexOf(']', index + 1);
      if (close === -1) throw new Error(`pinned pattern has an unterminated character class: "${segment}"`);
      const members = segment.slice(index + 1, close);
      if (members === '' || members.includes('[') || members.startsWith('!') || members.startsWith('^')) {
        throw new Error(`pinned pattern uses character-class syntax this matcher does not implement: "[${members}]"`);
      }
      body += `[${members.replace(/\\/g, '\\\\')}]`;
      index = close + 1;
      continue;
    }

    if (character === '{') {
      const close = segment.indexOf('}', index + 1);
      if (close === -1) throw new Error(`pinned pattern has an unterminated brace group: "${segment}"`);
      body += translateAlternatives(segment.slice(index + 1, close), ',');
      index = close + 1;
      continue;
    }

    if (character === ')' || character === '}' || character === ']') {
      throw new Error(`pinned pattern has an unbalanced "${character}": "${segment}"`);
    }

    body += escapeLiteral(character);
    index += 1;
  }

  return body;
};

/**
 * Matching for the glob syntax the guard evaluates: `*` within a path segment
 * and `**` across zero or more segments, plus the `{a,b}`, `?(a|b)` and `[abc]`
 * forms `translateSegmentBody` documents. Every other metacharacter THROWS,
 * because a pattern that silently matched nothing would turn the guard below
 * into a test that passes forever.
 *
 * It behaves as `picomatch(pattern, { dot: true })` and NOT as picomatch's
 * default. Cross-checked against the installed picomatch over the patterns the
 * guard actually evaluates, over THREE path sets, and the numbers below are the
 * measured ones — an earlier version of this comment claimed a 50-path sample
 * and a future edit would have trusted it:
 *
 * - REVIEWER RUN: 29 patterns x 635 real repo-relative paths, and 29 x 87,164
 *   synthetic ones assembled from the segment and prefix shapes a glob can meet.
 *   Zero disagreements with `{ dot: true }` in BOTH sets.
 * - INDEPENDENT RERUN, same conclusion at a smaller sample: 30 patterns x 678
 *   real paths and 30 x 7,224 synthetic paths, again zero with `{ dot: true }`,
 *   and 862 disagreements with picomatch's DEFAULTS — every one of them the same
 *   shape, a `*`/`**` segment matching a dot-prefixed segment (`e2e/**` vs
 *   `e2e/.hidden/a.unit.test.ts`) that picomatch's default declines to match. The
 *   real-input set shows zero disagreements with EITHER option, so the difference
 *   is unreachable from what this guard feeds in today: no path it walks lives
 *   under a dot-prefixed segment.
 * - DEGENERATE paths DO disagree, and are unreachable: a leading or trailing `/`,
 *   a bare `.` or `..` segment, and an empty segment all produce disagreements
 *   (`e2e/**` against `e2e/./a.ts` and `e2e/../a.ts`). `walkTestFiles` cannot
 *   produce one — it joins `readdirSync` directory entries, and `join` normalises
 *   `.` and `..` away while an entry name is never empty and never contains a
 *   separator — so this is the only caller and the divergence cannot reach it.
 *
 * `{ dot: true }` is recorded because "0 disagreements" without the option is the
 * false claim that an earlier version of this comment's reasoning would have
 * carried.
 */
const matchSegment = (segment: string, value: string) => new RegExp(`^${translateSegmentBody(segment)}$`).test(value);

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

/**
 * Whether the declared `exclude` still BEGINS with `configDefaults.exclude`, and
 * so still excludes everything it did when the defaults applied.
 *
 * `rootExcludeAdditions` alone cannot see this: replacing the spread with a bare
 * two-pattern array holding only `.kilo` and `e2e` yields the same two additions,
 * so the pinned array is byte-identical and the guard passes — while
 * `node_modules` and `.git` are back in the collection. Only the SPREAD ITSELF is
 * evidence that the defaults are still there, so the spread is what is pinned.
 */
const excludeKeepsTheDefaults = (exclude: readonly string[] | undefined) =>
  exclude !== undefined && hasExactEntries(exclude.slice(0, configDefaults.exclude.length), configDefaults.exclude);

/** Vitest accepts a bare string here, so both accepted shapes mean one path. */
const asEntryList = (value: string | readonly string[] | undefined) =>
  value === undefined ? undefined : typeof value === 'string' ? [value] : value;

const setupFilesAreTheSingleOne = (
  rootSetupFiles: string | readonly string[] | undefined,
  e2eSetupFiles: string | readonly string[] | undefined
) =>
  hasExactEntries(asEntryList(rootSetupFiles), ['./src/test/setup.ts']) &&
  (asEntryList(e2eSetupFiles)?.length ?? 0) === 0;

/**
 * `globalSetup` runs once per project, outside the test file's own environment,
 * so BOTH projects are read here and not only the root one.
 *
 * A single-argument version of this predicate passed the guard while
 * `vitest.e2e.config.ts` declared a `globalSetup`: the e2e project is imported
 * and its `include`, `exclude`, `environment` and `root` are all asserted, and
 * `globalSetup` was the one key of it nothing looked at. The hazard is identical
 * on both sides — code running once per run, outside the setup-file chain the
 * `setupFiles` check can see — so the shape mirrors `setupFilesAreTheSingleOne`
 * directly above it, which has always read both.
 */
const noGlobalSetup = (
  rootGlobalSetup: string | readonly string[] | undefined,
  e2eGlobalSetup: string | readonly string[] | undefined
) => (asEntryList(rootGlobalSetup)?.length ?? 0) === 0 && (asEntryList(e2eGlobalSetup)?.length ?? 0) === 0;

/** The only two Vitest configs this file imports; a third one is a second project. */
const VITEST_CONFIG_FILES = ['vitest.config.ts', 'vitest.e2e.config.ts'];

/**
 * A `vitest*.config.*` at the root is a project to keep in step, and a
 * `vitest.workspace.*` is named here for the same reason even though Vitest 5
 * does not read it: the string `vitest.workspace` appears nowhere in the
 * installed `vitest@5.0.2`, so such a file is inert today, and an inert file is
 * exactly what a later Vitest bump or a `projects: []` entry would make live.
 * The narrower `/^vitest.*\.config\./` left it invisible with the suite green.
 */
const VITEST_CONFIG_FILE_NAME = /^vitest.*(?:\.config\.|workspace\.)/;

const e2eUnitTestsRunInTheNodeProject = (
  files: readonly string[],
  include: readonly string[],
  exclude: readonly string[]
) =>
  files.every(
    (file) =>
      include.some((pattern) => matchesGlob(pattern, file)) && !exclude.some((pattern) => matchesGlob(pattern, file))
  );

const e2eUnitTestsAreInvisibleToPlaywright = (files: readonly string[], testIgnore: readonly string[]) =>
  files.every((file) => testIgnore.some((pattern) => matchesGlob(pattern, file)));

const scriptTestsAreCollectedByTheRootProject = (
  files: readonly string[],
  include: readonly string[],
  exclude: readonly string[]
) =>
  files.every(
    (file) =>
      include.some((pattern) => matchesGlob(pattern, file)) && !exclude.some((pattern) => matchesGlob(pattern, file))
  );

const coverageExcludesE2E = (exclude: readonly string[] | undefined) => (exclude ?? []).includes('e2e/**');

/**
 * Playwright's `testMatch` is a glob string, a `RegExp`, an array of either, or
 * absent. A `RegExp` is recompiled for every call rather than reused: a `/g` or
 * `/y` regexp carries `lastIndex` between `.test` calls, so a shared instance
 * would make this predicate depend on how many times it had already been called.
 * Both flags throw instead, because that statefulness is a silent wrong answer
 * and not a property of this repository.
 */
const matchesPlaywrightPattern = (pattern: string | RegExp, file: string) => {
  if (typeof pattern === 'string') return matchesGlob(pattern, file);
  if (pattern.flags.includes('g') || pattern.flags.includes('y')) {
    throw new Error(`playwright testMatch uses a stateful regexp flag: /${pattern.source}/${pattern.flags}`);
  }
  return new RegExp(pattern.source, pattern.flags).test(file);
};

/**
 * `testMatch` UNSET is Playwright's own default, and that is the value this
 * repository runs, so the guard accepts it rather than restating Playwright's
 * default as a second copy to keep in step.
 *
 * A DECLARED `testMatch` is held to what it can actually change: every real
 * `*.spec.ts` must still match, and no real `.ts` file under `e2e/` that is
 * neither a spec nor already hidden by `testIgnore` may match. The second half
 * is the escaping mutation — `testMatch: /.*\.(ts|tsx)$/` collects every helper,
 * fixture and `global-setup.ts` in the tree — and it is only falsifiable against
 * the real file list, which is why the caller passes one.
 */
const playwrightTestMatchCollectsOnlySpecs = (
  testMatch: string | RegExp | readonly (string | RegExp)[] | undefined,
  specFiles: readonly string[],
  nonSpecFiles: readonly string[]
) => {
  if (testMatch === undefined) return true;
  const patterns = typeof testMatch === 'string' || testMatch instanceof RegExp ? [testMatch] : testMatch;
  return (
    specFiles.every((file) => patterns.some((pattern) => matchesPlaywrightPattern(pattern, file))) &&
    nonSpecFiles.every((file) => !patterns.some((pattern) => matchesPlaywrightPattern(pattern, file)))
  );
};

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
 * and `testMatch` are the values Playwright's own `defineConfig` produced rather
 * than a regex over the file's text. There is no fallback and no second reading
 * of the file: a `testIgnore` that is absent, a bare string, or a `RegExp` fails
 * the equality assertion below by being exactly what it is.
 *
 * The WHOLE config is returned, not just `testIgnore`, because `testMatch` is
 * the other half of the same decision: `testIgnore` only subtracts from what
 * `testMatch` collected, and widening the collection is invisible to a guard
 * that reads one key.
 *
 * Loading it under the root jsdom project needs three globals jsdom does not
 * define. They are installed with `??=` — an environment that already has one
 * keeps its own — and immediately before the import, because the import is what
 * throws without them. Every test file gets its own global object from Vitest
 * (`isolate: true`), so nothing installed here can reach another file's
 * environment; that is the property this relies on, not the `??=` alone.
 */
const loadPlaywrightConfig = async () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.TransformStream ??= TransformStream;
  globals.WritableStream ??= WritableStream;
  globals.ReadableStream ??= ReadableStream;

  return (await import('../../playwright.config.ts')).default;
};

type PlaywrightConfig = Awaited<ReturnType<typeof loadPlaywrightConfig>>;

/**
 * `forbidOnly` WAS the one `playwright.config.ts` key whose value depended on an
 * environment variable, which is exactly why its guard needs two readings instead of
 * one: `!!process.env.CI` is true under CI, so a single read of the imported config
 * in a CI test run cannot tell the unconditional `true` from the conditional one.
 * Both are therefore taken here, with the module registry reset between them so the
 * config module actually re-evaluates rather than returning its first evaluation
 * from the ESM cache.
 *
 * `process.env.CI` is restored in a `finally`, including the delete case, because a
 * test that leaves `CI` set changes what every later assertion in this file is
 * measuring — the pool checks below are among them.
 */
const readPlaywrightForbidOnly = async (ci: string | undefined) => {
  const previous = process.env.CI;
  if (ci === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = ci;
  }
  vi.resetModules();
  try {
    return (await loadPlaywrightConfig()).forbidOnly;
  } finally {
    if (previous === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = previous;
    }
    vi.resetModules();
  }
};

describe('harness configuration guards (the AGENTS.md test traps)', () => {
  const rootTest = rootProjectConfig.test;
  const e2eTest = e2eProjectConfig.test;

  /**
   * `include` and `exclude` are BOTH read by every collection guard below, and
   * each falls back to the Vitest default rather than to `[]`. An empty fallback
   * would make a project that declares neither key collect nothing while every
   * guard read it as "no constraint", which is the same silent hole from the
   * other side; the defaults are the value the tool really uses, and they are
   * read from the installed Vitest rather than typed out here.
   */
  const rootInclude = rootTest?.include ?? configDefaults.include;
  const rootExclude = rootTest?.exclude ?? configDefaults.exclude;
  const e2eInclude = e2eTest?.include ?? configDefaults.include;
  const e2eExclude = e2eTest?.exclude ?? configDefaults.exclude;

  let e2eSpecFiles: string[] = [];
  let e2eUnitTestFiles: string[] = [];
  let e2eNonSpecTsFiles: string[] = [];
  let scriptTestFiles: string[] = [];
  let vitestConfigFiles: string[] = [];
  let playwrightConfig: PlaywrightConfig;
  let playwrightTestIgnore: readonly string[] = [];

  beforeAll(async () => {
    e2eSpecFiles = walkTestFiles(join(REPO_ROOT, 'e2e'), /\.spec\.ts$/);
    e2eUnitTestFiles = walkTestFiles(join(REPO_ROOT, 'e2e'), /\.unit\.test\.ts$/);
    scriptTestFiles = walkTestFiles(join(REPO_ROOT, 'scripts'), /\.test\.mjs$/);
    playwrightConfig = await loadPlaywrightConfig();
    // The `string[]` reading is the config's own shape here — `playwright.config.ts`
    // writes three literal strings — and one `it` below pins them exactly, so a
    // config that is a bare string or a RegExp fails that assertion before any use
    // of this variable is reached.
    playwrightTestIgnore = playwrightConfig.testIgnore as readonly string[];
    // A third `vitest*.config.*` — or a `vitest.workspace.*` — at the root is how a
    // second project with its own `setupFiles` arrives without any of the imports
    // below noticing it exists. `VITEST_CONFIG_FILE_NAME` documents why the second
    // form is matched even though Vitest 5 does not read it.
    vitestConfigFiles = readdirSync(REPO_ROOT)
      .filter((name) => VITEST_CONFIG_FILE_NAME.test(name))
      .sort();
    // What Playwright would collect BEYOND its specs: every `.ts`/`.tsx` file in
    // `testDir` that is neither a spec nor already subtracted by `testIgnore`.
    // `testIgnore` is pinned exactly, so reading it here is not circular.
    e2eNonSpecTsFiles = walkTestFiles(join(REPO_ROOT, 'e2e'), /\.tsx?$/).filter(
      (file) => !e2eSpecFiles.includes(file) && !playwrightTestIgnore.some((pattern) => matchesGlob(pattern, file))
    );
  });

  it('locates the repository root from this file, not from the working directory', () => {
    expect(
      existsSync(join(REPO_ROOT, 'vitest.config.ts')),
      'the repo root was not resolved from import.meta.dirname, so every guard below would read the wrong tree'
    ).toBe(true);
  });

  it('finds no Vitest config this file does not import', () => {
    // This file imports two configs and asserts properties of both. A third one
    // at the repo root is a fourth project to keep in step — the exact failure
    // `AGENTS.md` names — and nothing above could see it, because the escape is
    // that the file it was written into was never read. The name pattern is
    // `VITEST_CONFIG_FILE_NAME`, which also matches `vitest.workspace.*`.
    expect(
      vitestConfigFiles,
      'a `vitest*.config.*` or `vitest.workspace.*` exists at the repo root that this file does not import, so its `setupFiles`, `environment` and collection rules are unasserted. Import it here and guard it, or delete it.'
    ).toEqual(VITEST_CONFIG_FILES);
    expect(
      existsSync(join(REPO_ROOT, 'playwright.config.ts')),
      '`playwright.config.ts` is imported below, so its absence is a broken import rather than a missing guard'
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

  it('runs no global setup file in either project', () => {
    // `globalSetup` runs ONCE per project, before any test file loads, in its own
    // environment — not per test file, and not through the jsdom `setupFiles`
    // chain above. So a second one is not "a second setup file" to the check
    // that exists: it is invisible to it, and `AGENTS.md`'s "one setup file" trap
    // names both. BOTH projects are read, because a `globalSetup` added to
    // `vitest.e2e.config.ts` is the same hazard on the Node side and the e2e
    // config is imported here for every other key.
    expect(
      noGlobalSetup(rootTest?.globalSetup, e2eTest?.globalSetup),
      'a project declares a globalSetup, so code runs once per run outside the jsdom `setupFiles` chain, where the OffscreenCanvas and createImageBitmap polyfills are not installed'
    ).toBe(true);
  });

  it('keeps every file under e2e/ out of the root project', () => {
    expect(
      excludeKeepsTheDefaults(rootExclude),
      "the root project's `exclude` no longer begins with `configDefaults.exclude`, so the defaults it used to inherit — `**/node_modules/**` and `**/.git/**` — are back in the collection"
    ).toBe(true);
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
      e2eUnitTestsRunInTheNodeProject(e2eUnitTestFiles, e2eInclude, e2eExclude),
      `an e2e helper test is no longer collected by the e2e project, so no project runs it. Outside include: ${e2eUnitTestFiles
        .filter((file) => !e2eInclude.some((pattern) => matchesGlob(pattern, file)))
        .join(', ')}. Excluded: ${e2eUnitTestFiles
        .filter((file) => e2eExclude.some((pattern) => matchesGlob(pattern, file)))
        .join(', ')}`
    ).toBe(true);
    // `passWithNoTests` is NOT the pin, and the reason is the same as the escaping
    // mutation's: it defaults to `false` but only trips on an EMPTY collection. An
    // `exclude` that removes one of the eleven helper files leaves ten, exits 0, and
    // leaves CI's blocking `e2e-unit` job green. Only the file-level predicate above
    // sees the partial case.
    expect(
      e2eUnitTestFiles.length,
      'THIS RUN FOUND NO `*.unit.test.ts` UNDER `e2e/`, so the assertions above are unproven rather than satisfied. Nothing in the configs is wrong: either the helper tests moved out of `e2e/`, or the walk pattern `\\.unit\\.test\\.ts$` in this file is stale. Re-derive it before trusting this file.'
    ).toBeGreaterThan(0);
  });

  it('keeps every e2e helper test out of the browser', () => {
    expect(
      playwrightConfig.testIgnore,
      "Playwright's testIgnore changed, so an e2e helper test is collected as a browser-driven spec and fails in a way that looks like a product bug"
    ).toEqual(['**/__tests__/**', '**/*.unit.spec.ts', '**/*.unit.test.ts']);

    // Safe because of the equality assertion immediately above: the only way to
    // get here with anything else is a config this test has already failed on.
    const testIgnore = playwrightTestIgnore;

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

  it("leaves Playwright's collection scoped to specs", () => {
    // `testMatch` is the key ABOVE `testIgnore`, not beside it: it decides what is
    // collected, and `testIgnore` only subtracts from the result. A `testIgnore`
    // that is byte-identical while `testMatch` is `/.*\.(ts|tsx)$/` collects every
    // helper, every fixture and `e2e/global-setup.ts`, and the three pinned
    // `testIgnore` patterns do not subtract a single one of them.
    expect(
      playwrightTestMatchCollectsOnlySpecs(playwrightConfig.testMatch, e2eSpecFiles, e2eNonSpecTsFiles),
      "Playwright's testMatch collects files in e2e/ that are neither specs nor hidden by testIgnore, so Playwright loads them as browser-driven tests: " +
        e2eNonSpecTsFiles
          .filter((file) => {
            const patterns =
              typeof playwrightConfig.testMatch === 'string' || playwrightConfig.testMatch instanceof RegExp
                ? [playwrightConfig.testMatch]
                : (playwrightConfig.testMatch ?? []);
            return patterns.some((pattern) => matchesPlaywrightPattern(pattern, file));
          })
          .join(', ')
    ).toBe(true);
    expect(
      e2eNonSpecTsFiles.length,
      'THIS RUN FOUND NO NON-SPEC `.ts` FILE UNDER `e2e/`, so the testMatch guard above is unproven rather than satisfied. Either the helpers moved out of `e2e/`, or the walk pattern `\\.tsx?$` in this file is stale. Re-derive it before trusting this file.'
    ).toBeGreaterThan(0);
  });

  it('refuses a committed `test.only` on every run, not only under CI', async () => {
    // A committed `test.only` is a SILENT SCOPE REDUCTION: Playwright collects one
    // test, the reporter prints it green, and nothing in the output says the other
    // tests never ran. Guarding it with `!!process.env.CI` made the failure mode
    // worst where it is least visible — every local run, and no CI run.
    //
    // Both readings, because one does not discriminate: `!!process.env.CI` evaluates
    // to `true` under CI and this file runs in CI.
    expect(
      await readPlaywrightForbidOnly(undefined),
      '`playwright.config.ts` does not set `forbidOnly` unconditionally, so a committed `test.only` is a silent scope reduction on every LOCAL run: the suite collects one test, prints it green, and the operator reads green as coverage. Set it to the literal `true`.'
    ).toBe(true);
    expect(
      await readPlaywrightForbidOnly('1'),
      '`playwright.config.ts` stops forbidding `test.only` under CI. That half used to hold; the guard is `true` in BOTH readings or it is not a guard.'
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
      poolIsVmThreads(rootTest?.pool),
      "the root project's pool changed; node:sqlite works under forks and threads too, so agent-board.test.mjs would keep passing and only an unrelated import error would reveal it"
    ).toBe(true);
    expect(
      runsInTheVmPool(import.meta.env.VITEST_VM_POOL),
      'this very test is not running under the vmThreads pool, so the declared pool and the pool in force have already drifted apart'
    ).toBe(true);
  });

  it('collects the Node script tests by neither excluding nor narrowing the root project', () => {
    // TWO keys decide this, so there are TWO assertions, and the second is the one
    // that used to be missing. A root `include` whose last segment is
    // `*.{test,spec}.?(c|m)[jt]s?(x)` under a `src/` prefix, added beside the
    // existing `exclude`, collects ZERO of the 267 `scripts/*.test.mjs` cases,
    // leaves every `exclude`-only guard true, and reports green here.
    //
    // THE REMAINING ESCAPE IS LOUD, NOT SILENT, and that is the reason no guard
    // sits above it: an `include` narrow enough to also drop
    // `src/__tests__/**` un-collects THIS FILE, so the run reports "No test files
    // found" instead of a red assertion. Accepted deliberately — the config is
    // broken in a way CI and the developer both see, and no predicate can assert
    // on a suite that has stopped collecting itself. Do not add a guard for it;
    // re-derive the `include` instead.
    expect(
      scriptTestsAreCollectedByTheRootProject(scriptTestFiles, rootInclude, rootExclude),
      `a Node script test is no longer collected by the root project, so npm run test silently stops covering it. Not in include: ${scriptTestFiles
        .filter((file) => !rootInclude.some((pattern) => matchesGlob(pattern, file)))
        .join(', ')}. Excluded: ${scriptTestFiles
        .filter((file) => rootExclude.some((pattern) => matchesGlob(pattern, file)))
        .join(', ')}`
    ).toBe(true);
    // The default `include` is the value a project with no explicit `include` runs,
    // and it is read from `configDefaults` rather than typed out, so a Vitest bump
    // that changes the default cannot leave this guard matching a stale copy.
    expect(
      scriptTestFiles.every((file) => configDefaults.include.some((pattern) => matchesGlob(pattern, file))),
      'the Vitest default `include` no longer collects a real `scripts/*.test.mjs`, so the fallback above is asserting that the root project collects nothing. Re-derive the default before trusting this file.'
    ).toBe(true);
    expect(
      scriptTestFiles.length,
      'THIS RUN FOUND NO `*.test.mjs` UNDER `scripts/`, so the assertions above are unproven rather than satisfied. Nothing in the configs is wrong: either the script tests moved out of `scripts/`, or the walk pattern `\\.test\\.mjs$` in this file is stale. Re-derive it before trusting this file.'
    ).toBeGreaterThan(0);
  });

  it('fires on every invariant above (scratch values only; the one process-global write is restored with no await between)', () => {
    // Every argument below is a LITERAL, except `configDefaults` — read, never
    // restated, so the default cannot drift from the installed Vitest. The real
    // layout and the real configs are read by the tests above; a negative proven
    // against them is only as good as the positive next to it, and those
    // positives belong with the guards they justify, not here.
    const realShaped = ['e2e/helpers/__tests__/canvas-helpers.unit.test.ts'];
    const realInclude = ['e2e/**/__tests__/**/*.unit.test.ts'];
    // The two files the e2e project really collects, one under each directory the
    // escaping mutation narrows, so the negative below is falsifiable.
    const realExported = 'e2e/export/__tests__/helpers.unit.test.ts';
    const realScriptShaped = ['scripts/__tests__/agent-board.test.mjs'];
    // The one thing in this file that touches process-global state, and the
    // invariant that makes it safe: Vitest backs `import.meta.env` with
    // `process.env`, so the write below IS a process-global write, and it is
    // restored in the `finally` of the same synchronous block. There must be NO
    // `await` between the write and the restore — an `await` yields to the
    // microtask queue and to any concurrently running test file, which is the
    // only way another file could observe `VITEST_VM_POOL === '0'`. Under
    // `pool: 'vmThreads'` + `isolate: true` each test file has its own global
    // object, so even a leaked value would not cross a file boundary; the
    // no-await rule is what keeps two files in the SAME worker safe.
    const realSpecShaped = ['e2e/helpers/canvas.spec.ts'];
    const realNonSpecShaped = ['e2e/global-setup.ts', 'e2e/helpers/canvas-helpers.ts'];

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
    expect(noGlobalSetup(undefined, undefined), 'a project with no globalSetup is the pinned shape').toBe(true);
    expect(noGlobalSetup([], undefined), 'an empty array is the same as none').toBe(true);
    expect(noGlobalSetup(['./src/test/global-setup.ts'], undefined), 'a single globalSetup must be caught').toBe(false);
    expect(noGlobalSetup('./src/test/global-setup.ts', undefined), "vitest's bare-string form must be caught too").toBe(
      false
    );
    // The e2e half, which is what a single-argument predicate could not see.
    expect(noGlobalSetup(undefined, ['./e2e/global-setup.ts']), 'a globalSetup on the e2e project must be caught').toBe(
      false
    );
    expect(noGlobalSetup(undefined, './e2e/global-setup.ts'), "and the e2e project's bare-string form too").toBe(false);
    expect(noGlobalSetup(undefined, []), 'an empty e2e globalSetup array is the same as none').toBe(true);
    expect(excludeKeepsTheDefaults([...configDefaults.exclude, '**/.kilo/**', 'e2e/**']), 'the real shape').toBe(true);
    expect(
      excludeKeepsTheDefaults(['**/.kilo/**', 'e2e/**']),
      'dropping the `configDefaults` spread yields the same pinned additions, so the spread itself is what is pinned'
    ).toBe(false);
    expect(excludeKeepsTheDefaults(undefined), 'no exclude at all is not a spread').toBe(false);
    expect(
      rootExcludeAdditions(['**/node_modules/**', '**/.git/**', '**/.kilo/**']),
      'e2e/** deleted from exclude'
    ).toEqual(['**/.kilo/**']);
    expect(
      rootExcludeAdditions([...configDefaults.exclude, '**/.kilo/**', 'e2e/**', 'scripts/**']),
      'scripts/** added'
    ).toEqual(['**/.kilo/**', 'e2e/**', 'scripts/**']);
    expect(
      e2eUnitTestsRunInTheNodeProject(realShaped, realInclude, []),
      'the real-layout positive, so the negatives below are not vacuous'
    ).toBe(true);
    expect(
      e2eUnitTestsRunInTheNodeProject([realShaped[0], realExported], realInclude, ['e2e/export/**']),
      'the e2e-unit escaping mutation: an exclude that removes ONE helper file while the collection stays non-empty, so `passWithNoTests` never trips'
    ).toBe(false);
    expect(
      e2eUnitTestsRunInTheNodeProject([realShaped[0], realExported], realInclude, configDefaults.exclude),
      'the defaults must not themselves exclude a real helper test, or the positive above is false for the wrong reason'
    ).toBe(true);
    expect(e2eUnitTestsRunInTheNodeProject(realShaped, [], []), 'an emptied include collects none of the files').toBe(
      false
    );
    expect(
      e2eUnitTestsRunInTheNodeProject(['e2e/helpers/brand-new.test.ts'], realInclude, []),
      'a new e2e test outside __tests__/ or named *.unit.test.ts is caught here'
    ).toBe(false);
    expect(
      e2eUnitTestsRunInTheNodeProject(['e2e/helpers/__tests__/brand-new.test.ts'], realInclude, []),
      'a new e2e __tests__ file not named *.unit.test.ts is caught here'
    ).toBe(false);
    expect(matchesGlob(realInclude[0], realShaped[0]), 'the matcher accepts the shape the real files have').toBe(true);
    expect(
      matchesGlob(realInclude[0], 'e2e/helpers/__tests__/canvas-helpers.test.ts'),
      'the matcher rejects the same file without the .unit. marker'
    ).toBe(false);
    // The three forms `translateSegmentBody` added, each with the positive that
    // makes the negatives below mean something. These are the shapes the Vitest
    // DEFAULT `include` is written in, so they are the reason the guard can read
    // a project that declares no `include` at all.
    expect(
      matchesGlob(configDefaults.include[0], realScriptShaped[0]),
      'the default `include` collects a real scripts test, and the matcher reads it'
    ).toBe(true);
    expect(
      matchesGlob('src/**/*.{test,spec}.?(c|m)[jt]s?(x)', 'src/a.test.ts'),
      'a brace group and two optional groups'
    ).toBe(true);
    expect(
      matchesGlob('src/**/*.{test,spec}.?(c|m)[jt]s?(x)', 'src/a.ts'),
      'the same pattern with no .test. marker'
    ).toBe(false);
    expect(
      matchesGlob('src/**/*.{test,spec}.?(c|m)[jt]s?(x)', 'e2e/a.test.ts'),
      'a path the `src/**` prefix rules out'
    ).toBe(false);
    expect(matchesGlob('*.[jt]s', 'a.ts'), 'a character class').toBe(true);
    expect(matchesGlob('*.[jt]s', 'a.ps'), 'a character class rejects its complement').toBe(false);
    expect(() => matchSegment('*.!(ts)', 'a.ts'), 'unsupported glob syntax must throw, not match nothing').toThrow();
    expect(() => matchSegment('a?(b', 'ab'), 'an unterminated extglob must throw').toThrow();
    expect(() => matchSegment('[!a]', 'a'), 'a negated character class must throw, not match nothing').toThrow();
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
      playwrightTestMatchCollectsOnlySpecs(undefined, realSpecShaped, realNonSpecShaped),
      "an absent testMatch is Playwright's own default and cannot widen anything"
    ).toBe(true);
    expect(
      playwrightTestMatchCollectsOnlySpecs('**/*.spec.ts', realSpecShaped, realNonSpecShaped),
      'a spec-only glob is a legal narrowing and must pass'
    ).toBe(true);
    expect(
      playwrightTestMatchCollectsOnlySpecs(/.*\.(ts|tsx)$/, realSpecShaped, realNonSpecShaped),
      'the escaping mutation: a regexp that collects every .ts file in e2e/'
    ).toBe(false);
    expect(
      playwrightTestMatchCollectsOnlySpecs('**/*.unit.test.ts', realSpecShaped, realNonSpecShaped),
      'a testMatch that collects no spec at all must be caught'
    ).toBe(false);
    expect(() => matchesPlaywrightPattern(/a/g, 'a'), 'a stateful regexp must throw rather than alternate').toThrow();
    expect(
      scriptTestsAreCollectedByTheRootProject(realScriptShaped, configDefaults.include, []),
      'the real-shape positive, so the negatives below are not vacuous'
    ).toBe(true);
    expect(
      scriptTestsAreCollectedByTheRootProject(realScriptShaped, configDefaults.include, ['scripts/**']),
      'a scripts/** exclusion must stop the root project from collecting them'
    ).toBe(false);
    expect(
      scriptTestsAreCollectedByTheRootProject(realScriptShaped, ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'], []),
      'the root-include escaping mutation: an include narrowed to src/** collects zero scripts tests'
    ).toBe(false);
    expect(coverageExcludesE2E(['src/**/__tests__/**']), 'e2e/** dropped from coverage.exclude').toBe(false);
    // The root config-name pattern, including the `vitest.workspace.*` form the
    // narrower `/^vitest.*\.config\./` left invisible with the suite green.
    for (const name of VITEST_CONFIG_FILES) {
      expect(VITEST_CONFIG_FILE_NAME.test(name), `${name} must match the pattern the beforeAll filters with`).toBe(
        true
      );
    }
    expect(VITEST_CONFIG_FILE_NAME.test('vitest.extra.config.mts'), 'a third vitest config is caught').toBe(true);
    expect(
      VITEST_CONFIG_FILE_NAME.test('vitest.workspace.ts'),
      'and a workspace file, though vitest 5 ignores it'
    ).toBe(true);
    expect(VITEST_CONFIG_FILE_NAME.test('vite.config.ts'), 'vite is not vitest').toBe(false);
    expect(VITEST_CONFIG_FILE_NAME.test('src/vitest.config.ts'), 'the filter reads the root listing only').toBe(false);
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

/**
 * The stub this destroyer captured, published to module scope so the observer below can be
 * UNFILTERABLE. Two tests are what make this both a real observation and a `-t`-proof one:
 * merged into a single body, the assertion half proves nothing about re-installation,
 * because a merged body can re-install the stub by itself; and left as two independent
 * tests, a `-t` filter can keep the observer and delete the destruction that gives it
 * meaning. The module-scoped variable closes that gap in the only direction that matters —
 * run the observer alone and it is `undefined`, so the observer FAILS.
 */
let stubBeforeDestruction: unknown;

describe('canvas stub re-installation', () => {
  it('destroys the canvas stub the way a hostile test does', () => {
    // `src/test/setup.ts:361-363` installs the stub from an unconditional `beforeEach`, so
    // this test is handed one no matter what any earlier test did.
    stubBeforeDestruction = HTMLCanvasElement.prototype.getContext;
    expect(vi.isMockFunction(stubBeforeDestruction)).toBe(true);

    vi.restoreAllMocks();

    // The intermediate state. Without this the observer would pass even if the restore had
    // never removed anything, so it would pin an outcome and not the mechanism.
    expect(vi.isMockFunction(HTMLCanvasElement.prototype.getContext)).toBe(false);
  });

  it('re-installs a distinct canvas stub for the next test, so the install is not one-shot', () => {
    // Observed in the NEXT test, never re-established inside this body: that is the whole
    // claim, because a body that re-installs for itself proves only that it agrees with
    // itself. The stub is here because the harness `beforeEach` ran between the two tests.
    const reinstalled = HTMLCanvasElement.prototype.getContext;
    expect(vi.isMockFunction(reinstalled)).toBe(true);

    // Unfilterable: without the destroyer above, `stubBeforeDestruction` is `undefined` and
    // this test FAILS. A `-t` filter therefore cannot keep this test and delete its meaning.
    expect(stubBeforeDestruction).toBeDefined();

    // A DIFFERENT mock object, which is only possible if the destroyer really removed the
    // first one — a `beforeEach` that re-ran the same closure would hand back the same spy.
    expect(reinstalled).not.toBe(stubBeforeDestruction);

    // Discriminating, not tautological. The earlier `expect(contextAfter).not.toBe(contextBefore)`
    // compared two contexts from two different canvases against a factory that allocates per
    // call, so it could not fail. What can actually regress is that the re-installed stub hands
    // back a context LINKED to the canvas that asked for it, and that the context is the
    // spy-recording mock rather than some object that merely answers `fillRect`.
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d') as unknown as Record<string, unknown> | null;
    expect(ctx).not.toBeNull();
    expect(ctx!.canvas).toBe(canvas);
    (ctx as unknown as CanvasRenderingContext2D).fillRect(0, 0, 1, 1);
    expect(ctx!.fillRect).toHaveBeenCalledWith(0, 0, 1, 1);
  });
});

/**
 * LAST IN THE FILE, DELIBERATELY.
 *
 * The test below re-evaluates `src/test/setup.ts`, and evaluating that module registers a
 * SECOND `beforeEach`/`afterEach` on the suite that owns the running test. Those would then
 * run for every test after it in this file, giving each of those tests a second canvas
 * install the real harness does not give it. Sitting last, the duplicates are registered
 * when no further test in this file remains to receive them.
 *
 * Kept last as a margin, NOT because the duplicate is known to be harmful: installing the
 * stub twice is behaviourally idempotent, and the whole file still passes with this block
 * moved to the top. An earlier version of this comment claimed the move would cause a
 * "silently different harness" failure; that was not measured, and it does not occur.
 */
describe('harness module re-evaluation', () => {
  it('installs the canvas stub from the module body, not only from the beforeEach', async () => {
    // This is the ONLY test that can pin `src/test/setup.ts:359` — the TOP-LEVEL
    // `installCanvasContextStub()`. The two tests above reach the stub solely through the
    // unconditional `beforeEach` at `:361-363`, and deleting the top-level call while
    // keeping that hook leaves every other test in this file green, because the hook has
    // already installed a stub before any test body runs. Only a re-evaluation, which
    // happens INSIDE a body where no hook can fire, distinguishes the two install sites.
    // It is named for module re-evaluation because that is precisely and only what it
    // proves: it does not observe the `beforeEach`, and the block above is what does that.
    vi.restoreAllMocks();
    expect(vi.isMockFunction(HTMLCanvasElement.prototype.getContext)).toBe(false);

    // `vi.resetModules()` is what makes the re-import re-execute rather than return the
    // already-evaluated module.
    vi.resetModules();
    await import('../test/setup.ts');

    const fromModuleBody = HTMLCanvasElement.prototype.getContext;
    expect(vi.isMockFunction(fromModuleBody)).toBe(true);
  });
});
