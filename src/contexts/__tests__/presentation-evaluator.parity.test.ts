import { describe, expect, it, vi } from 'vitest';

import { makeMockCtx } from '../../__tests__/canvas-mock.ts';
import type { AffineTransform } from '../affine-transform.ts';
import { AssetRegistry } from '../asset-registry.ts';
import type { DurableReplayLayer } from '../durable-replay.ts';
import { drawLayerSource } from '../layer-renderer.ts';
import type { Layer } from '../layer-types.ts';
import { materializeLayer } from '../materialization.ts';
import type { DurableOperation } from '../history-model.ts';
import {
  drawEvaluatedPresentation,
  evaluatePresentation,
  getPresentationFilter,
  scaleVectorArgs,
} from '../presentation-evaluator.ts';

const position = { x: 12, y: 18, width: 40, height: 20 };
const frame = { x: 0, y: 0, width: 160, height: 120 };
const scale: AffineTransform = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };

/**
 * The document-frame-relative origin both paths must place a presentation's top-left
 * at, derived by hand: `position.x - frame.x` and `position.y - frame.y`. The runtime
 * reaches it as a `ctx.translate`; materialization reaches it as the `drawImage` offset
 * of its final frame-surface blit. Neither number comes from either implementation.
 */
const DOCUMENT_ORIGIN = { x: position.x - frame.x, y: position.y - frame.y };

/**
 * The placement of one layer's pixels in document-frame-relative coordinates.
 *
 * This is the only quantity the two render paths are required to agree on. They
 * reach it by different routes — the runtime composes `translate` then `transform`
 * on the visible canvas and blits the source at (0, 0), while materialization renders
 * the source into a `localBounds`-sized surface first and then blits that finished
 * presentation onto the frame at its absolute offset — so their raw call sequences
 * are NOT equal and are not asserted to be. What must be equal is where the pixels
 * land, so that is what is compared.
 */
type Placement = { x: number; y: number; width: number; height: number };

type RenderCall = { op: string; args: unknown[] };

/**
 * A stand-in for the global `OffscreenCanvas` that records what is drawn to it.
 * `materialization.ts:55` builds every surface through that global and never reaches
 * the `document.createElement` branch at line 57, so a spy on
 * `HTMLCanvasElement.prototype.getContext` cannot see any of it.
 *
 * `filter` is an accessor because `ctx.filter = …` is a property write, not a method
 * call: no call spy observes it.
 */
class RecordingOffscreenCanvas {
  width: number;
  height: number;
  private context: CanvasRenderingContext2D | null = null;
  readonly calls: RenderCall[] = [];
  readonly createdWith: { width: number; height: number };

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.createdWith = { width, height };
  }

  getContext(): OffscreenCanvasRenderingContext2D {
    if (!this.context) {
      const context = makeMockCtx({ canvas: this as unknown as HTMLCanvasElement });
      let filterValue = '';
      Object.defineProperty(context, 'filter', {
        get: () => filterValue,
        set: (value: string) => {
          this.calls.push({ op: 'filter', args: [value] });
          filterValue = value;
        },
        configurable: true,
      });
      for (const op of ['translate', 'transform', 'drawImage'] as const) {
        const original = context[op] as unknown as (...args: unknown[]) => unknown;
        (context as unknown as Record<string, unknown>)[op] = (...args: unknown[]) => {
          this.calls.push({ op, args });
          return original(...args);
        };
      }
      this.context = context;
    }
    return this.context as unknown as OffscreenCanvasRenderingContext2D;
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  transferToImageBitmap() {
    return { width: this.width, height: this.height, close: vi.fn() };
  }

  convertToBlob() {
    return Promise.resolve(new Blob([]));
  }
}

const surfaces: RecordingOffscreenCanvas[] = [];

/** Records the calls a runtime render makes, on a context the test supplies. */
function runtimeRenderCalls(layer: Layer): RenderCall[] {
  const calls: RenderCall[] = [];
  const context = makeMockCtx({ canvas: document.createElement('canvas') });
  let filterValue = '';
  Object.defineProperty(context, 'filter', {
    get: () => filterValue,
    set: (value: string) => {
      calls.push({ op: 'filter', args: [value] });
      filterValue = value;
    },
    configurable: true,
  });
  for (const op of ['translate', 'transform', 'drawImage'] as const) {
    const original = context[op] as unknown as (...args: unknown[]) => unknown;
    (context as unknown as Record<string, unknown>)[op] = (...args: unknown[]) => {
      calls.push({ op, args });
      return original(...args);
    };
  }

  expect(drawLayerSource(context, layer, position, frame)).toBe(true);
  return calls;
}

/**
 * The layer's placement as the runtime path composes it: `translate` moves the origin
 * into document-frame-relative space and `transform` scales the blit that follows, so
 * the extent has to be read through the matrix rather than off the `drawImage` width.
 * An identity affine emits no `transform` at all, and then the blit is already in
 * document coordinates.
 */
function runtimePlacement(calls: readonly RenderCall[]): Placement {
  const transform = calls.find((call) => call.op === 'transform');
  const blit = calls.find((call) => call.op === 'drawImage');
  const blitArgs = (blit?.args ?? []).slice(1) as number[];
  if (!transform) return { x: blitArgs[0]!, y: blitArgs[1]!, width: blitArgs[2]!, height: blitArgs[3]! };

  const [a, , , d] = transform.args as number[];
  const translate = calls.find((call) => call.op === 'translate');
  const [tx, ty] = (translate?.args ?? [0, 0]) as number[];
  return { x: tx, y: ty, width: blitArgs[2]! * a, height: blitArgs[3]! * d };
}

/** Every `ctx.filter` value the runtime path assigned, in order. */
function filterWrites(calls: readonly RenderCall[]): string[] {
  return calls.filter((call) => call.op === 'filter').map((call) => String(call.args[0]));
}

/** The `ctx.transform` matrices the path assigned, in order. */
function transformMatrices(calls: readonly RenderCall[]): number[][] {
  return calls.filter((call) => call.op === 'transform').map((call) => call.args as number[]);
}

/**
 * The durable equivalent of the fixture above, in the runtime path's own record shape
 * (`layer-types.ts:31-44`): an affine carries `transform`, a filter carries the raw
 * tool args under `args`. This is deliberately NOT `PresentationOperation[]` — the two
 * paths are fed two different record shapes, which is the whole point of a parity test.
 */
function runtimeLayerOperations(kind: 'none' | 'affine' | 'filter' | 'affine-filter'): Layer['operations'] {
  const operations: Layer['operations'][number][] = [];
  if (kind === 'affine' || kind === 'affine-filter') {
    operations.push({ id: 'op-affine', kind: 'affine-transform', enabled: true, transform: scale });
  }
  if (kind === 'filter' || kind === 'affine-filter') {
    operations.push({ id: 'op-filter', kind: 'filter', enabled: true, args: { toolName: 'blur', radius: 3 } });
  }
  return operations;
}

/** The same fixture in the durable record shape (`history-model.ts`, `DurableOperation`). */
function durableOperations(kind: 'none' | 'affine' | 'filter' | 'affine-filter'): DurableOperation[] {
  const operations: DurableOperation[] = [];
  if (kind === 'affine' || kind === 'affine-filter') {
    operations.push({ kind: 'apply-affine-transform', layerId: 'layer-1', transform: scale });
  }
  if (kind === 'filter' || kind === 'affine-filter') {
    operations.push({
      kind: 'apply-filter',
      layerId: 'layer-1',
      filter: { toolName: 'blur', version: 1, args: { radius: 3 } },
    });
  }
  return operations;
}

function runtimeLayer(kind: 'none' | 'affine' | 'filter' | 'affine-filter'): Layer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    isBedrock: false,
    tmpCanvas: null,
    bitmap: { width: position.width, height: position.height },
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos: position,
    source: { kind: 'blank', color: '#ffffff', opacity: 1, isBedrock: false, pos: position },
    operations: runtimeLayerOperations(kind),
  } as unknown as Layer;
}

function durableLayer(kind: 'none' | 'affine' | 'filter' | 'affine-filter'): DurableReplayLayer {
  return {
    snapshot: {
      id: 'layer-1',
      name: 'Layer 1',
      isBedrock: false,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 0,
      pos: position,
      source: {
        kind: 'blank',
        color: '#ffffff',
        opacity: 1,
        size: { width: position.width, height: position.height },
        isBedrock: false,
      },
    },
    operations: durableOperations(kind),
  } as unknown as DurableReplayLayer;
}

async function durableRender(kind: 'none' | 'affine' | 'filter' | 'affine-filter'): Promise<{
  retainedCalls: RenderCall[];
  retainedSurface: { width: number; height: number };
  frameCalls: RenderCall[];
  frameSurface: { width: number; height: number };
}> {
  surfaces.length = 0;
  vi.stubGlobal(
    'OffscreenCanvas',
    class extends RecordingOffscreenCanvas {
      constructor(width: number, height: number) {
        super(width, height);
        surfaces.push(this);
      }
    }
  );
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (source: { width: number; height: number }) => ({ ...source, close: vi.fn() }))
  );
  const registry = new AssetRegistry();
  try {
    const materialized = await materializeLayer(durableLayer(kind), {
      documentId: 'parity-doc',
      baselineAssetGeneration: 0,
      operationSetRevision: 0,
      assetRegistry: registry,
      frame,
    });
    materialized.lease.release();
    // The blank source is filled onto one surface and the presentation is rendered onto
    // the next; the frame surface is the last one the request creates.
    const frameSurface = surfaces.at(-1)!;
    return {
      retainedCalls: surfaces.at(-2)!.calls,
      retainedSurface: surfaces.at(-2)!.createdWith,
      frameCalls: frameSurface.calls,
      frameSurface: frameSurface.createdWith,
    };
  } finally {
    vi.unstubAllGlobals();
    registry.shutdown();
  }
}

describe('presentation evaluator parity', () => {
  // The two paths are fed two different record shapes (`Layer['operations']` and
  // `DurableOperation`) and must still put the layer's pixels in the same place, write
  // the same filter string, and compose the same matrix. Every expectation below is
  // hand-derived from `position`, `frame` and `scale` above; none of them is read back
  // out of `evaluatePresentation`, so a change to the evaluator that moved the layer,
  // dropped a filter or reordered the matrix composition fails here.
  //
  // `margin` is the filter's own spread, carried per edge: three sigmas of the fixture's
  // radius-3 blur, which is 9. It is the one number the two routes cannot both report, and
  // the reason is structural rather than accidental — see the blit assertions.
  it.each([
    {
      fixture: 'none' as const,
      filter: 'none',
      matrices: [] as number[][],
      extent: { width: position.width, height: position.height },
      margin: 0,
    },
    {
      fixture: 'affine' as const,
      filter: 'none',
      matrices: [[2, 0, 0, 2, 0, 0]],
      extent: { width: position.width * 2, height: position.height * 2 },
      margin: 0,
    },
    {
      fixture: 'filter' as const,
      filter: 'blur(3px)',
      matrices: [] as number[][],
      extent: { width: position.width, height: position.height },
      margin: 3 * 3,
    },
    {
      fixture: 'affine-filter' as const,
      filter: 'blur(3px)',
      matrices: [[2, 0, 0, 2, 0, 0]],
      extent: { width: position.width * 2, height: position.height * 2 },
      margin: 3 * 3,
    },
  ])(
    'places the $fixture fixture identically in the runtime and durable render paths',
    async ({ fixture, filter, matrices, extent, margin }) => {
      const expected: Placement = { x: DOCUMENT_ORIGIN.x, y: DOCUMENT_ORIGIN.y, ...extent };
      // The extent `expected` describes, grown by the filter's spread — the box the durable route
      // hands the compositor, and the box it had to stage the presentation into.
      const staged: Placement = {
        x: expected.x - margin,
        y: expected.y - margin,
        width: expected.width + margin * 2,
        height: expected.height + margin * 2,
      };

      const runtimeCalls = runtimeRenderCalls(runtimeLayer(fixture));
      const durable = await durableRender(fixture);

      // The filter string and the composed matrix: identical, and identical to what the
      // fixture asks for. The runtime writes it once; materialization writes it onto the
      // retained-segment surface and resets it to `none` for the frame blit, which carries
      // the already-filtered presentation and must therefore not filter it a second time.
      expect(filterWrites(runtimeCalls)).toEqual([filter]);
      expect(filterWrites(durable.retainedCalls)).toEqual([filter]);
      expect(filterWrites(durable.frameCalls)).toEqual(['none']);

      expect(transformMatrices(runtimeCalls)).toEqual(matrices);
      expect(transformMatrices(durable.retainedCalls)).toEqual(matrices);

      // The placement itself, from both routes, against the hand-derived value.
      //
      // The runtime route draws the source straight onto the document-sized canvas, so the box it
      // blits is `expected`: the halo has somewhere to go and needs no box of its own. The durable
      // route stages the presentation on a surface that DOES have to hold the halo, so it carries
      // `staged` — and inside that surface the source sits at exactly the runtime's placement,
      // which is what `runtimePlacement` below still asserts. Reading the durable blit as `expected`
      // would have been the assertion that let the spread be clipped out of the staging surface in
      // the first place.
      const durableBlit = durable.frameCalls.find((call) => call.op === 'drawImage');
      const durableArgs = (durableBlit?.args ?? []).slice(1) as number[];
      expect({ x: durableArgs[0], y: durableArgs[1], width: durableArgs[2], height: durableArgs[3] }).toEqual(staged);

      expect(runtimePlacement(runtimeCalls)).toEqual(expected);

      // The staging surface is sized from the same extent, so a spread that the blit admits and
      // the surface does not would be a spread clipped at the surface's own edge.
      expect(durable.retainedSurface).toEqual({ width: staged.width, height: staged.height });

      // And the frame surface is the requested frame, not the layer's extent.
      expect(durable.frameSurface).toEqual({ width: frame.width, height: frame.height });
    }
  );

  it('translates the durable retained segment by its own local bounds, which is why its raw calls differ', () => {
    // The structural difference the placement comparison above has to absorb: the
    // runtime translates by the document-space origin, materialization translates the
    // source back into a `localBounds`-sized surface at the origin. For this fixture
    // `localBounds` is (0, 0, 80, 40), so the durable translate is (0, 0) where the
    // runtime's is (10, 14). If the durable path stopped compensating, the blit would
    // land at the surface origin and the frame blit above would still read (10, 14) —
    // so this is the assertion that makes the compensation load-bearing.
    const evaluation = evaluatePresentation({
      position,
      sourceSize: { width: position.width, height: position.height },
      operations: [{ kind: 'affine-transform', transform: scale }],
    });

    expect(evaluation.localBounds).toEqual({ x: 0, y: 0, width: 80, height: 40 });
    expect(evaluation.bounds).toEqual({ x: position.x, y: position.y, width: 80, height: 40 });
  });

  it('uses the same filter dispatch and defaults for runtime and durable operation shapes', () => {
    const runtime = [
      { kind: 'filter' as const, toolName: 'color' as const, args: { grayscale: 10, sepia: 20, saturation: 30 } },
      { kind: 'filter' as const, toolName: 'levels' as const, args: { brightness: -10, contrast: 15 } },
    ];
    const durable = runtime.map((operation) => ({ ...operation, args: { ...operation.args } }));

    expect(getPresentationFilter(runtime)).toBe(getPresentationFilter(durable));
    expect(getPresentationFilter([{ kind: 'filter', toolName: 'blur', args: {} }])).toBe('blur(0px)');
    expect(getPresentationFilter([])).toBe('none');
  });

  it('exposes both bounds modes and agrees in the degenerate full-frame case', () => {
    const layer = evaluatePresentation({
      position: frame,
      sourceSize: { width: frame.width, height: frame.height },
      operations: [],
      mode: 'layer-bounds',
    });
    const document = evaluatePresentation({
      position: frame,
      sourceSize: { width: frame.width, height: frame.height },
      operations: [],
      frame,
      mode: 'frame-bounds',
    });

    expect(layer.bounds).toEqual(frame);
    expect(document.bounds).toEqual(frame);
  });

  it('takes the identity fast path without a transform call', () => {
    const ctx = {
      filter: 'none',
      drawImage: vi.fn(),
      translate: vi.fn(),
      transform: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const bitmap = { width: position.width, height: position.height } as unknown as ImageBitmap;
    const evaluation = evaluatePresentation({
      position,
      sourceSize: { width: position.width, height: position.height },
      operations: [],
    });

    drawEvaluatedPresentation(ctx, bitmap, evaluation, { kind: 'document', frame });

    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, position.x, position.y, position.width, position.height);
    expect(ctx.translate).not.toHaveBeenCalled();
    expect(ctx.transform).not.toHaveBeenCalled();
  });

  it('bounds a rotated layer to the post-affine extent', () => {
    const quarterTurn: AffineTransform = { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 };
    const evaluation = evaluatePresentation({
      position,
      sourceSize: { width: position.width, height: position.height },
      operations: [{ kind: 'affine-transform', transform: quarterTurn }],
    });

    expect(evaluation.bounds.x).toBeCloseTo(position.x - position.height);
    expect(evaluation.bounds.y).toBe(position.y);
    expect(evaluation.bounds.width).toBeCloseTo(position.height);
    expect(evaluation.bounds.height).toBeCloseTo(position.width);
  });

  it('shares vector scaling and preserves an absent lineWidth key', () => {
    const args = {
      toolName: 'shape',
      start: { x: 1, y: 2 },
      end: { x: 5, y: 8 },
    };
    const scaled = scaleVectorArgs(args, { x: 0, y: 0, width: 20, height: 10 }, { x: 0, y: 0, width: 40, height: 20 });

    expect(scaled.start).toEqual({ x: 2, y: 4 });
    expect(scaled.end).toEqual({ x: 10, y: 16 });
    expect(scaled).not.toHaveProperty('lineWidth');
  });

  it('rejects a zero-size presentation before raster evaluation', () => {
    expect(() =>
      evaluatePresentation({
        position,
        sourceSize: { width: 0, height: position.height },
        operations: [],
      })
    ).toThrow(/degenerate bounds/);
  });

  it('keeps the no-bitmap guard outside the evaluator', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const layer = {
      id: 'layer-1',
      name: 'Layer 1',
      isBedrock: true,
      tmpCanvas: null,
      bitmap: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over' as GlobalCompositeOperation,
      order: 0,
      pos: { x: 0, y: 0, width: 20, height: 10 },
      operations: [],
    };

    expect(drawLayerSource(ctx, layer)).toBe(false);
    expect(ctx.save).not.toHaveBeenCalled();
  });
});
