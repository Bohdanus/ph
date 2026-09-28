/**
 * Pins the seam that carries a paint tool's Photoshop `Mode` from the options bar
 * into the layer the stroke creates.
 *
 * `createLayerSource` seeded every layer with `blendMode: 'source-over'`
 * (`src/contexts/layer-utils.ts:192`); the tool branch now derives it from the tool
 * args instead (`src/contexts/layer-utils.ts:232`, via `toolLayerBlendMode` at
 * `src/contexts/layer-utils.ts:155-158`). A stroke is committed as a NEW layer
 * through `createLayerFromTool` (`src/contexts/useLayer.ts:219-262`), and both undo/
 * redo and the durable shadow re-enter `createLayerSource` with the same history
 * entry's args (`src/contexts/useHistory.ts:97`). So the mode has to be derivable
 * from the args alone — that, and not from any ambient bar state, is the property
 * this file pins.
 *
 * The fixture processors are the real ones: rasterizing a two-point stroke needs no
 * pixel read-back, so nothing here depends on the reduced canvas context
 * (`src/test/setup.ts:185-189`).
 */

import { describe, expect, it } from 'vitest';

import { createMockLayers } from '@/__tests__/fixtures/layer.ts';
import { createLayerSource } from '../layer-utils.ts';
import type { Layer, ToolLayerSource } from '../layer-types.ts';
import type { Pos } from '../general-types.ts';
import type { ToolArgs } from '../tool-types.ts';
import {
  PAINT_BLEND_MODES,
  PAINT_SMOOTHING_DEFAULT,
  type PaintBlendMode,
  type PaintToolName,
} from '../../tools/brush.ts';
import type { PaintToolArgs } from '../../tools/draw.ts';
import { defaultSettings } from '../../tools/settings.ts';

const STROKE_POS: Pos = { x: 1, y: 2, width: 20, height: 10 };

/** The modes every paint bar is built from, sampled across Photoshop's list. */
const SAMPLED_MODES: PaintBlendMode[] = ['source-over', 'multiply', 'screen', 'difference', 'luminosity'];

/** A `ToolLayerSource` laid out as `createLayerFromTool` lays one out: an explicit
 *  document-space position, and a clone of the args rather than the live bar state. */
function toolSource(args: ToolArgs, pos: Pos = STROKE_POS): ToolLayerSource {
  return { kind: 'tool', args, pos: { ...pos } };
}

/** Every field a paint stroke's layer carries, rebuilt from `src/tools/settings.ts:115-134`. */
function paintArgs(toolName: PaintToolName, blendMode: PaintBlendMode): PaintToolArgs {
  return {
    alpha: 0.9,
    color: '#000000',
    penType: 'pen',
    lineWidth: 10,
    points: [
      { x: 2, y: 3 },
      { x: 12, y: 9 },
    ],
    smoothing: PAINT_SMOOTHING_DEFAULT,
    blendMode,
    toolName,
  };
}

/**
 * A layer's fields minus the two a second independent call is allowed to differ on:
 * the freshly generated id and the freshly staged raster. Two `vi.fn()`-bearing
 * mock contexts are never `toEqual`, so the raster is excluded rather than
 * compared by shape.
 */
function comparable(layer: Layer): Omit<Layer, 'id' | 'tmpCanvas'> & { id: string; tmpCanvas: string } {
  return { ...layer, id: '<generated>', tmpCanvas: '<staged>' };
}

describe('a paint tool mode reaches the created layer', () => {
  const cases = (['brush', 'pencil'] as const).flatMap((toolName) => SAMPLED_MODES.map((mode) => ({ toolName, mode })));

  it.each(cases)('composites a $toolName stroke in $mode', ({ toolName, mode }) => {
    const layer = createLayerSource({ layers: {}, source: toolSource(paintArgs(toolName, mode)) });

    expect(layer.blendMode).toBe(mode);
  });

  it('honours every mode the paint options bar offers', () => {
    // The dropdown is built from `PAINT_BLEND_MODES` (`src/tools/brush.ts:23-40`),
    // so a mode it offers but the guard refuses would be a dead option.
    PAINT_BLEND_MODES.forEach((mode) => {
      const layer = createLayerSource({ layers: {}, source: toolSource(paintArgs('brush', mode.value)) });

      expect(layer.blendMode).toBe(mode.value);
    });
  });

  it('does not leave the mode on the stroke canvas instead of the layer', () => {
    // The mode is a layer property, not a stroke-time `globalCompositeOperation`
    // write: the stroke rasterizes onto its own transparent canvas, and the mode
    // applies when the store composites that canvas into the document.
    const layer = createLayerSource({ layers: {}, source: toolSource(paintArgs('brush', 'difference')) });
    const context = (layer.tmpCanvas as OffscreenCanvas).getContext('2d') as unknown as Record<string, unknown>;

    expect(layer.blendMode).toBe('difference');
    expect(context.globalCompositeOperation).toBe('source-over');
  });
});

describe('a tool source with no blendMode', () => {
  it('composites as Normal when the paint args predate the seam', () => {
    // `PaintToolArgs` makes the field required so the bar can read it unguarded
    // (`src/tools/draw.ts:33-41`), but `DrawToolArgs.blendMode` is optional
    // (`src/tools/draw.ts:26`) precisely so a document saved before the bar
    // existed still loads. Stripping the key is how such a document arrives here.
    const argsWithoutMode: Record<string, unknown> = { ...paintArgs('brush', 'source-over') };
    delete argsWithoutMode.blendMode;
    expect(argsWithoutMode).not.toHaveProperty('blendMode');

    const layer = createLayerSource({ layers: {}, source: toolSource(argsWithoutMode as ToolArgs) });

    expect(layer.blendMode).toBe('source-over');
  });

  it('composites the legacy draw stroke as Normal', () => {
    // The `draw` tool keeps its own `Pen Type` bar and never writes a mode, so
    // every stroke it has ever committed is a Normal layer.
    const layer = createLayerSource({
      layers: {},
      source: toolSource({ ...defaultSettings.draw, points: [{ x: 2, y: 3 }] }),
    });

    expect(layer.blendMode).toBe('source-over');
  });
});

describe('an unrecognised blendMode', () => {
  it.each([
    ['a Photoshop mode this renderer cannot express', 'Dissolve'],
    ['a canvas operation that is not a paint mode', 'destination-out'],
    ['a mode name that does not exist', 'not-a-mode'],
    ['an empty string', ''],
    ['a number', 42],
    ['null', null],
  ] as [string, unknown][])('composites as Normal rather than %s', (_label, blendMode) => {
    // `ctx.globalCompositeOperation = 'dissolve'` is silently ignored by the
    // browser rather than erroring (`src/tools/brush.ts:16-19`), so passing an
    // unknown value through would be an invisible defect: the layer would claim a
    // mode nothing applies.
    const args = { ...paintArgs('brush', 'source-over'), blendMode } as unknown as ToolArgs;

    const layer = createLayerSource({ layers: {}, source: toolSource(args) });

    expect(layer.blendMode).toBe('source-over');
    expect(layer.blendMode).not.toBe(blendMode);
  });

  it('falls back for an unrecognised mode on a non-paint tool source too', () => {
    const args = { ...defaultSettings.shape, blendMode: 'Vivid Light' } as unknown as ToolArgs;

    const layer = createLayerSource({ layers: {}, source: toolSource(args) });

    expect(layer.blendMode).toBe('source-over');
  });
});

describe('non-paint tool sources', () => {
  it.each([
    ['text', defaultSettings.text],
    ['shape', defaultSettings.shape],
  ] as const)('composites a %s layer as Normal because its args carry no mode', (toolName, args) => {
    // Only the paint bar exposes `Mode`, and only `PaintToolArgs` declares the
    // field, so a text or shape source has nothing for the seam to read. The
    // defaults are used verbatim because they are what production writes.
    expect(args).not.toHaveProperty('blendMode');

    const layer = createLayerSource({ layers: {}, source: toolSource(args) });

    expect(layer.name).toBe(`${toolName} 1`);
    expect(layer.blendMode).toBe('source-over');
  });

  it('ignores a mode carried on a non-paint tool source, which no bar ever writes', () => {
    // `toolLayerBlendMode` is gated on the paint tool names
    // (`src/contexts/layer-utils.ts:223-234`), not merely on `kind: 'tool'`. That
    // gate is the point: `PaintToolArgs` is the only args type that declares the
    // field, so without it a stray `blendMode` key on a text or shape args object —
    // hand-built, or carried in from an older document — would silently decide how
    // that layer composites. Pinned so widening the seam to other creator tools is
    // a deliberate change with this test to update.
    const args = { ...defaultSettings.text, blendMode: 'multiply' } as unknown as ToolArgs;

    const layer = createLayerSource({ layers: {}, source: toolSource(args) });

    expect(layer.blendMode).toBe('source-over');
  });
});

describe('a non-Normal mode disturbs nothing else', () => {
  it('seeds the same defaults a Normal layer gets', () => {
    const layer = createLayerSource({ layers: {}, source: toolSource(paintArgs('brush', 'multiply')) });

    expect(layer).toMatchObject({
      opacity: 1,
      locked: false,
      visible: true,
      isBedrock: false,
      operations: [],
      pos: STROKE_POS,
      bitmap: null,
    });
  });

  it('moves the blend mode and no other field of the layer', () => {
    const layers = createMockLayers(2);
    const normal = createLayerSource({ layers, source: toolSource(paintArgs('brush', 'source-over')) });
    const multiply = createLayerSource({ layers, source: toolSource(paintArgs('brush', 'multiply')) });

    // The source is normalised too, because the two sources differ in the args the
    // mode was read from. Everything else — name, order, geometry, the seeded
    // defaults — is the same code path, and this asserts exactly that.
    const stripSource = (layer: Layer) => ({ ...comparable(layer), source: '<source>' });
    expect(stripSource(multiply)).toEqual({ ...stripSource(normal), blendMode: 'multiply' });
  });

  it('reuses a supplied layer id whatever the mode is', () => {
    const layer = createLayerSource({
      layerId: 'restored-multiply',
      layers: {},
      source: toolSource(paintArgs('brush', 'multiply')),
    });

    expect(layer.id).toBe('restored-multiply');
  });
});

describe('the mode is read from the args on every call', () => {
  it('produces layers that differ only by id when called twice with the same source', () => {
    // Replay rebuilds the layer from the history entry's args
    // (`src/contexts/useHistory.ts:97`), so a mode cached on the source or on the
    // layer would make a second replay disagree with the first.
    const source = toolSource(paintArgs('brush', 'multiply'));

    const first = createLayerSource({ layers: {}, source });
    const second = createLayerSource({ layers: {}, source });

    expect(first.id).not.toBe(second.id);
    expect(comparable(first)).toEqual(comparable(second));
    expect([first.blendMode, second.blendMode]).toEqual(['multiply', 'multiply']);
  });

  it('re-reads the mode after the source is reused for a different stroke', () => {
    const layers = createMockLayers(1);
    const source = toolSource(paintArgs('brush', 'multiply'));

    const first = createLayerSource({ layers, source });
    const second = createLayerSource({ layers, source: { ...source, args: paintArgs('brush', 'difference') } });

    expect([first.blendMode, second.blendMode]).toEqual(['multiply', 'difference']);
  });
});
