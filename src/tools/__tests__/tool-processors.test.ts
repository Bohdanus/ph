import { render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  findToolProcessor,
  PIXEL_FREE_TOOLS,
  toolProcessors,
  type PixelToolName,
  type ToolProcessorDefinition,
} from '../toolProcessors.ts';
import { toolsMap } from '../toolsMap.ts';
import { defaultSettings } from '../settings.ts';
import { blur } from '../blur.ts';
import { colors } from '../colors.ts';
import { crop } from '../crop.ts';
import { draw } from '../draw.ts';
import { featherMagneticLasso } from '../featherMagneticLasso.ts';
import { levels } from '../levels.ts';
import { magicWand } from '../magicWand.ts';
import { rectangularSelection } from '../rectangularSelection.ts';
import { reposition } from '../reposition.ts';
import { selection } from '../selection.ts';
import { shape } from '../shape.ts';
import { text } from '../text.ts';
import { transform } from '../transform.ts';
import { createMockCanvasContext, createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import type { ToolName } from '../../contexts/tool-types.ts';
import type { PaintToolArgs, PaintToolName } from '../draw.ts';
import type { Point } from '../../contexts/general-types.ts';

const toolNames = Object.keys(defaultSettings) as ToolName[];

/**
 * The registry's own key set, which is every `ToolName` EXCEPT the pixel-free ones. The two sets
 * are related by the coverage test below, so neither can drift: a tool added to `ToolArgsByName`
 * without a processor fails it, and a processor for a name that is not a tool fails
 * `Record<PixelToolName, ...>` at compile time.
 */
const processorNames = Object.keys(toolProcessors) as PixelToolName[];

type MockCtx = ReturnType<typeof createMockCanvasContext>;

class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  readonly ctx: MockCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    // Pixel-capable: the global stub in src/test/setup.ts deliberately has no `getImageData`, so
    // the two fill tools would take their "reduced canvas" branch here and never reach a mask.
    this.ctx = createPixelCanvasContext(this) as unknown as MockCtx;
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): MockCtx {
    return this.ctx;
  }
}

const asRecord = toolProcessors as unknown as Record<string, ToolProcessorDefinition | undefined>;

describe('toolProcessors registry', () => {
  it('covers every ToolName with either exactly one processor or a pixel-free declaration', () => {
    // The eyedropper samples a colour and writes it to the store's foreground, so it rasterizes
    // nothing and records no history state. It therefore has NO processor — which the previous
    // form of this test ("one processor for every ToolName") asserted against, because the registry
    // used to conflate "is a tool" with "rasterizes pixels". The invariant is now coverage by one
    // of the two, disjointly, derived from `ToolArgsByName` rather than hand-listed.
    const pixelFree = [...PIXEL_FREE_TOOLS];
    const overlap = pixelFree.filter((toolName) => processorNames.includes(toolName as PixelToolName));

    expect(overlap).toEqual([]);
    expect([...processorNames, ...pixelFree].sort()).toEqual([...toolNames].sort());
    expect(new Set([...processorNames, ...pixelFree]).size).toBe(toolNames.length);
  });

  it('resolves no processor for a pixel-free tool and one for every other tool', () => {
    for (const toolName of toolNames) {
      const pixelFree = (PIXEL_FREE_TOOLS as readonly ToolName[]).includes(toolName);
      const definition = findToolProcessor(toolName);

      if (pixelFree) expect(definition, toolName).toBeUndefined();
      else expect(typeof definition?.imageProcessor, toolName).toBe('function');
    }
  });

  it('gives every tool a frozen, versioned replay descriptor', () => {
    for (const toolName of processorNames) {
      const entry = findToolProcessor(toolName)!;

      expect(Object.isFrozen(entry.replay), `${toolName}.replay must be frozen`).toBe(true);
      expect(entry.replay.version, `${toolName}.replay.version`).toBe(1);
      expect(entry.replay.kind, `${toolName}.replay.kind`).toBeTruthy();
      expect(typeof entry.commit).toBe('string');
      expect(typeof entry.imageProcessor).toBe('function');
    }
  });

  it('rejects mutation of a replay descriptor', () => {
    expect(() => {
      (toolProcessors.draw.replay as { kind: string }).kind = 'raster-processor';
    }).toThrow(TypeError);

    expect(toolProcessors.draw.replay.kind).toBe('source');
  });

  it('marks only raster-producing tools as requiring raster', () => {
    const requiresRaster = processorNames.filter((toolName) => findToolProcessor(toolName)!.replay.requiresRaster);

    expect(requiresRaster.sort()).toEqual(
      [
        'brush',
        'color-replacement',
        'eraser',
        'feather-magnetic-lasso',
        'magic-eraser',
        'magic-wand',
        'paint-bucket',
        'pencil',
      ].sort()
    );
  });

  it('marks only unimplemented tools as non-deterministic', () => {
    const nonDeterministic = processorNames.filter((toolName) => !findToolProcessor(toolName)!.replay.deterministic);

    expect(nonDeterministic.sort()).toEqual(
      [
        'add-anchor-point',
        'convert-point',
        'curvature-pen',
        'custom-shape',
        'delete-anchor-point',
        'freeform-pen',
        'pen',
      ].sort()
    );
  });

  it('keeps the unimplemented set identical across commit, replay, and determinism', () => {
    const unimplemented = processorNames.filter(
      (toolName) =>
        findToolProcessor(toolName)!.commit === 'unimplemented' ||
        findToolProcessor(toolName)!.replay.kind === 'unimplemented'
    );
    const nonDeterministic = processorNames.filter((toolName) => !findToolProcessor(toolName)!.replay.deterministic);

    expect([...unimplemented].sort()).toEqual([...nonDeterministic].sort());
    for (const toolName of unimplemented) {
      expect(findToolProcessor(toolName)!.replay.deterministic, toolName).toBe(false);
      expect(findToolProcessor(toolName)!.replay.requiresRaster, toolName).toBe(false);
    }
  });

  it('commits every raster processor as a raster-processor replay', () => {
    const rasterCommitted = processorNames.filter((toolName) => findToolProcessor(toolName)!.commit === 'raster');

    expect(rasterCommitted.sort()).toEqual(
      ['brush', 'color-replacement', 'eraser', 'magic-eraser', 'paint-bucket', 'pencil'].sort()
    );
    for (const toolName of rasterCommitted) {
      expect(findToolProcessor(toolName)!.replay.kind).toBe('raster-processor');
    }
  });

  it('only labels source-creating tools as creators, and each creator commits as a source', () => {
    const creators = processorNames.filter((toolName) => findToolProcessor(toolName)!.creator);

    expect(creators.sort()).toEqual(
      [
        'draw',
        'ellipse',
        'freehand-lasso',
        'line',
        'polygon',
        'polygonal-lasso',
        'rectangle',
        'rectangular-selection',
        'shape',
        'text',
        'triangle',
      ].sort()
    );
    for (const toolName of creators) {
      expect(['source', 'selection'], `${toolName} creator commit`).toContain(findToolProcessor(toolName)!.commit);
    }
  });

  it('flags every tool routed to the shape processor as a deterministic creator', () => {
    // The figure family is derived from the processor identity rather than a
    // hand-written name list, so a new shape variant cannot be registered
    // without the `creator` flag `materialization.ts:161` reads.
    const shapeFamily = processorNames.filter((toolName) => findToolProcessor(toolName)!.imageProcessor === shape);

    expect(shapeFamily.sort()).toEqual(['ellipse', 'line', 'polygon', 'rectangle', 'shape', 'triangle']);
    for (const toolName of shapeFamily) {
      expect(findToolProcessor(toolName)!.creator, toolName).toBe(true);
      expect(findToolProcessor(toolName)!.commit, toolName).toBe('source');
    }
  });

  it('maps the full tool roster onto the declared commit kinds', () => {
    // The eyedropper is absent by design and carries no commit kind at all, which is what the
    // coverage test above pins; see `PIXEL_FREE_TOOLS` in src/tools/toolProcessors.ts.
    const commits = Object.fromEntries(
      processorNames.map((toolName) => [toolName, findToolProcessor(toolName)!.commit])
    );

    expect(commits).toEqual({
      reposition: 'geometry',
      blur: 'layer-operation',
      color: 'layer-operation',
      levels: 'layer-operation',
      transform: 'affine-operation',
      crop: 'document-operation',
      draw: 'source',
      shape: 'source',
      text: 'source',
      'polygonal-lasso': 'selection',
      'freehand-lasso': 'selection',
      'feather-magnetic-lasso': 'selection',
      'magic-wand': 'selection',
      'rectangular-selection': 'selection',
      brush: 'raster',
      pencil: 'raster',
      'color-replacement': 'raster',
      eraser: 'raster',
      'magic-eraser': 'raster',
      'paint-bucket': 'raster',
      pen: 'unimplemented',
      'freeform-pen': 'unimplemented',
      'curvature-pen': 'unimplemented',
      'add-anchor-point': 'unimplemented',
      'delete-anchor-point': 'unimplemented',
      'convert-point': 'unimplemented',
      rectangle: 'source',
      ellipse: 'source',
      triangle: 'source',
      polygon: 'source',
      line: 'source',
      'custom-shape': 'unimplemented',
    });
  });

  it('selects the polylasso processor for the lasso and the shape processor for figure variants', () => {
    const lassoSource = toolProcessors['polygonal-lasso'].imageProcessor;
    const featherSource = toolProcessors['feather-magnetic-lasso'].imageProcessor;
    const magicWandSource = toolProcessors['magic-wand'].imageProcessor;
    const rectSelectionSource = toolProcessors['rectangular-selection'].imageProcessor;
    const shapeSource = toolProcessors.shape.imageProcessor;

    expect(toolProcessors['freehand-lasso'].imageProcessor).toBe(lassoSource);
    for (const toolName of ['rectangle', 'ellipse', 'triangle', 'polygon', 'line'] as const) {
      expect(findToolProcessor(toolName)!.imageProcessor).toBe(shapeSource);
    }
    expect(featherSource).not.toBe(lassoSource);
    expect(magicWandSource).not.toBe(lassoSource);
    expect(rectSelectionSource).not.toBe(lassoSource);
  });

  it('returns a null bitmap from every unimplemented processor instead of throwing', () => {
    for (const toolName of processorNames) {
      if (findToolProcessor(toolName)!.commit !== 'unimplemented') continue;

      const result = findToolProcessor(toolName)!.imageProcessor({
        size: { width: 8, height: 8 },
        bitmap: createMockImageBitmap(8, 8),
      })({ toolName } as never);

      expect(result, toolName).toEqual([null]);
    }
  });

  it('has no entry and no throw-safe fallback for an unknown tool name', () => {
    expect(asRecord['definitely-not-a-tool']).toBeUndefined();
    expect((toolsMap as unknown as Record<string, unknown>)['definitely-not-a-tool']).toBeUndefined();
    expect(() => asRecord['definitely-not-a-tool']?.imageProcessor).not.toThrow();
  });
});

describe('paint tool raster processors', () => {
  beforeEach(() => {
    RecordingOffscreenCanvas.instances = [];
    vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const run = (toolName: PaintToolName, args: Partial<PaintToolArgs>): MockCtx => {
    const result = findToolProcessor(toolName)!.imageProcessor({ size: { width: 16, height: 16 } })({
      ...defaultSettings[toolName],
      toolName,
      ...args,
    } as never);

    expect(result).toHaveLength(1);
    return RecordingOffscreenCanvas.instances.at(-1)!.ctx;
  };

  const stroke: Point[] = [
    { x: 1, y: 2 },
    { x: 5, y: 6 },
    { x: 9, y: 3 },
  ];

  it('brush rasterizes a pen stroke at the requested line width', () => {
    const recorded = run('brush', { lineWidth: 8, penType: 'pen', points: stroke });

    expect(recorded.lineWidth).toBe(8);
    expect(recorded.lineCap).toBe('round');
    expect(recorded.stroke).toHaveBeenCalledTimes(1);
  });

  it('brush overrides a spray penType with the pen renderer', () => {
    const recorded = run('brush', { penType: 'spray', points: stroke });

    expect(recorded.lineCap).toBe('round');
    expect(recorded.stroke).toHaveBeenCalledTimes(1);
  });

  it('brush produces an empty canvas for an empty point list', () => {
    const recorded = run('brush', { points: [] });

    expect(recorded.beginPath).not.toHaveBeenCalled();
    expect(recorded.stroke).not.toHaveBeenCalled();
  });

  it('pencil clamps a zero line width up to 1', () => {
    const recorded = run('pencil', { lineWidth: 0, points: stroke });

    expect(recorded.lineWidth).toBe(1);
  });

  it('pencil defaults a missing line width to 3', () => {
    const recorded = run('pencil', { lineWidth: undefined, points: stroke });

    expect(recorded.lineWidth).toBe(3);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['a non-numeric string', 'wide'],
  ])('falls a non-finite pencil line width (%s) back to the 3 default', (_label, lineWidth) => {
    // `??` guards only `undefined`/`null`, so any of these produced NaN and
    // `Math.max(1, NaN)` wrote NaN to `ctx.lineWidth`, where the canvas silently
    // substituted its own width (src/tools/toolProcessors.ts:175-181).
    const recorded = run('pencil', { lineWidth: lineWidth as number, points: stroke });

    expect(recorded.lineWidth).toBe(3);
  });

  it('clamps an empty or blank pencil line width like any other width below 1', () => {
    // `Number('')` and `Number(' ')` are 0, not NaN, so a blank string always
    // reached the clamp and never `ctx.lineWidth` as NaN.
    for (const lineWidth of ['', ' ']) {
      const recorded = run('pencil', { lineWidth: lineWidth as unknown as number, points: stroke });

      expect(recorded.lineWidth, JSON.stringify(lineWidth)).toBe(1);
    }
  });

  it('honours the global alpha from paint defaults', () => {
    const recorded = run('brush', { alpha: 0.25, points: stroke });

    expect(recorded.globalAlpha).toBe(0.25);
  });

  it('coerces a string line width on pencil', () => {
    const recorded = run('pencil', { lineWidth: '5' as unknown as number, points: stroke });

    expect(recorded.lineWidth).toBe(5);
  });
});

describe('toolsMap wiring', () => {
  it('mirrors every processor entry and adds an icon plus a toolbox component', () => {
    for (const toolName of processorNames) {
      const mapped = toolsMap[toolName];
      const definition = findToolProcessor(toolName)!;

      expect(mapped.commit, toolName).toBe(definition.commit);
      expect(mapped.replay, toolName).toBe(definition.replay);
      expect(mapped.imageProcessor, toolName).toBe(definition.imageProcessor);
      expect(typeof mapped.icon, toolName).toBe('string');
      expect(typeof mapped.toolboxComponent, toolName).toBe('function');
    }
  });

  it('spreads no processor into a pixel-free toolsMap entry', () => {
    // The registry's shape is `Partial<ToolProcessorDefinition>`, so a spread that found nothing
    // would silently typecheck. This is the pin that says the eyedropper's entry is icon + bar
    // only: a fabricated no-op processor would be indistinguishable from a real one by type.
    for (const toolName of PIXEL_FREE_TOOLS) {
      const mapped = toolsMap[toolName];

      expect(Object.hasOwn(mapped, 'commit'), toolName).toBe(false);
      expect(Object.hasOwn(mapped, 'replay'), toolName).toBe(false);
      expect(Object.hasOwn(mapped, 'imageProcessor'), toolName).toBe(false);
      expect(Object.hasOwn(mapped, 'creator'), toolName).toBe(false);
      expect(Object.keys(mapped).sort(), toolName).toEqual(['icon', 'toolboxComponent']);
    }
  });

  it('uses distinct icons per tool', () => {
    const icons = toolNames.map((toolName) => toolsMap[toolName].icon);

    expect(new Set(icons).size).toBeGreaterThan(icons.length / 2);
    expect(new Set(icons)).not.toContain('');
  });

  it('renders the placeholder toolbox components with their configured options', () => {
    // `color-replacement` is not here: it has a real options bar now, not a TODO card, and
    // rendering it here would pass on the bar's own labels for the wrong reason.
    const placeholderNames = [
      'brush',
      'pencil',
      'pen',
      'freeform-pen',
      'curvature-pen',
      'add-anchor-point',
      'delete-anchor-point',
      'convert-point',
      'custom-shape',
    ] as const;

    for (const toolName of placeholderNames) {
      const Component = toolsMap[toolName].toolboxComponent;
      const { unmount } = render(React.createElement(Component));

      expect(screen.getAllByText(/TODO|Tool/i).length, toolName).toBeGreaterThan(0);
      unmount();
    }
  });

  it('shows a TODO badge on real placeholders and hides it where the tool is functional', () => {
    const Placeholder = toolsMap['custom-shape'].toolboxComponent;
    const NoBadge = toolsMap.brush.toolboxComponent;

    const withBadge = render(React.createElement(Placeholder));
    expect(screen.getByText('Custom Shape Tool')).toBeInTheDocument();
    expect(screen.getAllByText('TODO').length).toBeGreaterThan(0);
    withBadge.unmount();

    render(React.createElement(NoBadge));
    expect(screen.queryByText('TODO')).not.toBeInTheDocument();
    expect(screen.getByText('Brush Tool')).toBeInTheDocument();
  });
});

/**
 * Every registry entry that must reference a module-level processor *by identity*.
 * A copy-paste slip (registering `blur` for `levels`) is invisible to the commit-kind
 * table above, because both entries carry the same metadata.
 */
const directProcessorSources: readonly [ToolName, unknown][] = [
  ['reposition', reposition],
  ['blur', blur],
  ['color', colors],
  ['levels', levels],
  ['transform', transform],
  ['crop', crop],
  ['draw', draw],
  ['shape', shape],
  ['text', text],
  ['polygonal-lasso', selection],
  ['freehand-lasso', selection],
  ['feather-magnetic-lasso', featherMagneticLasso],
  ['magic-wand', magicWand],
  ['rectangular-selection', rectangularSelection],
  ['rectangle', shape],
  ['ellipse', shape],
  ['triangle', shape],
  ['polygon', shape],
  ['line', shape],
];

const unimplementedTools: readonly ToolName[] = [
  'pen',
  'freeform-pen',
  'curvature-pen',
  'add-anchor-point',
  'delete-anchor-point',
  'convert-point',
  'custom-shape',
];

const paintWrapperTools: readonly PaintToolName[] = ['brush', 'pencil'];

describe('toolProcessors processor identity', () => {
  it.each(directProcessorSources)('routes %s to its own module-level processor', (toolName, source) => {
    expect(findToolProcessor(toolName)!.imageProcessor).toBe(source);
  });

  it.each(unimplementedTools)('gives %s the shared unimplemented processor instance', (toolName) => {
    expect(findToolProcessor(toolName)!.imageProcessor).toBe(toolProcessors.pen.imageProcessor);
  });

  it.each(paintWrapperTools)('wraps %s in its own inline adapter instead of reusing draw', (toolName) => {
    const { imageProcessor } = findToolProcessor(toolName)!;

    expect(imageProcessor).not.toBe(draw);
    for (const other of paintWrapperTools) {
      if (other === toolName) continue;
      expect(imageProcessor, `${toolName} vs ${other}`).not.toBe(toolProcessors[other].imageProcessor);
    }
    // The adapter must still be a two-stage curried processor, not a direct alias.
    expect(typeof imageProcessor({ size: { width: 4, height: 4 } })).toBe('function');
  });

  it('never lets two different tools share the same non-unimplemented processor by accident', () => {
    const seen = new Map<unknown, ToolName[]>();

    for (const toolName of processorNames) {
      if (unimplementedTools.includes(toolName)) continue;
      const { imageProcessor } = findToolProcessor(toolName)!;
      seen.set(imageProcessor, [...(seen.get(imageProcessor) ?? []), toolName]);
    }

    // The only legitimate sharing is the lasso pair and the shape/figure family,
    // which are the same module export wired to several tool names on purpose.
    const shared = [...seen.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([processor, names]) => ({
        names: names.sort(),
        isIntentional: processor === selection || processor === shape,
      }))
      .sort((a, b) => a.names[0].localeCompare(b.names[0]));

    expect(shared).toEqual([
      { names: ['ellipse', 'line', 'polygon', 'rectangle', 'shape', 'triangle'], isIntentional: true },
      { names: ['freehand-lasso', 'polygonal-lasso'], isIntentional: true },
    ]);
  });
});

/**
 * Runtime proxy for the `@ts-expect-error` entries: a processor that publishes a
 * `ToolArgs` type but is declared with zero parameters cannot be handed the
 * registry's `ToolArgs` without a cast, and `fn.length` reports exactly that
 * arity. The unimplemented processors are also zero-arity but need no cast,
 * because a function with fewer parameters is assignable to a wider signature.
 */
describe('toolProcessors declared inner-processor arity', () => {
  const params = { size: { width: 4, height: 4 }, bitmap: createMockImageBitmap(4, 4) };

  it('accepts one params argument on every registry entry except the shared unimplemented stub', () => {
    // `unimplemented` is declared `() => () => [null]`, which is still assignable to the
    // registry signature because a function with fewer parameters is assignable to a
    // wider one — so unlike the three type lies it needs no cast.
    for (const toolName of processorNames) {
      const expected = unimplementedTools.includes(toolName) ? 0 : 1;
      expect(findToolProcessor(toolName)!.imageProcessor.length, toolName).toBe(expected);
    }
  });

  it('declares zero inner parameters only for the three type lies and the unimplemented set', () => {
    const zeroArity = processorNames.filter(
      (toolName) => findToolProcessor(toolName)!.imageProcessor(params).length === 0
    );

    expect(zeroArity.sort()).toEqual(
      [...unimplementedTools, 'feather-magnetic-lasso', 'magic-wand', 'rectangular-selection'].sort()
    );
  });

  it('makes the zero-arity non-unimplemented processors the exact set needing a registry cast', () => {
    // These three are the entries the registry has to silence with @ts-expect-error
    // (src/tools/toolProcessors.ts:146, :152, :159) because their published args type
    // is not reachable from the generic `(args: ToolArgs) => ToolResult` signature.
    const casted = processorNames.filter(
      (toolName) =>
        findToolProcessor(toolName)!.commit !== 'unimplemented' &&
        findToolProcessor(toolName)!.imageProcessor(params).length === 0
    );

    expect(casted.sort()).toEqual(['feather-magnetic-lasso', 'magic-wand', 'rectangular-selection']);
  });
});

describe('toolProcessors dispatch for every tool name', () => {
  const size = { width: 40, height: 24 };
  const bitmap = createMockImageBitmap(size.width, size.height);

  const lassoTriangle: Point[] = [
    { x: 2, y: 3 },
    { x: 12, y: 3 },
    { x: 12, y: 13 },
  ];

  /** Arguments a default cannot satisfy on its own (the crop default rect is `null`). */
  const argOverrides: Partial<Record<ToolName, Record<string, unknown>>> = {
    crop: { rect: { x1: 4, y1: 6, x2: 20, y2: 18 } },
    'polygonal-lasso': { points: lassoTriangle },
    'freehand-lasso': { points: lassoTriangle },
  };

  type Outcome = 'canvas' | 'canvas-with-pos-patch' | 'source-bitmap' | 'bitmap-and-move' | 'null' | 'no-processor';

  const dispatchTable: readonly [ToolName, Outcome, number, number][] = [
    ['reposition', 'bitmap-and-move', 0, 0],
    ['blur', 'canvas', 40, 24],
    ['color', 'canvas', 40, 24],
    ['levels', 'canvas', 40, 24],
    ['transform', 'canvas', 40, 24],
    ['crop', 'canvas-with-pos-patch', 16, 12],
    ['draw', 'canvas', 40, 24],
    ['shape', 'canvas', 40, 24],
    ['text', 'canvas', 40, 24],
    ['polygonal-lasso', 'canvas', 10, 10],
    ['freehand-lasso', 'canvas', 10, 10],
    ['feather-magnetic-lasso', 'source-bitmap', 0, 0],
    ['magic-wand', 'source-bitmap', 0, 0],
    ['rectangular-selection', 'source-bitmap', 0, 0],
    ['brush', 'canvas', 40, 24],
    ['pencil', 'canvas', 40, 24],
    ['color-replacement', 'canvas', 40, 24],
    ['eraser', 'canvas', 40, 24],
    ['magic-eraser', 'canvas', 40, 24],
    ['paint-bucket', 'canvas', 40, 24],
    ['eyedropper', 'no-processor', 0, 0],
    ['pen', 'null', 0, 0],
    ['freeform-pen', 'null', 0, 0],
    ['curvature-pen', 'null', 0, 0],
    ['add-anchor-point', 'null', 0, 0],
    ['delete-anchor-point', 'null', 0, 0],
    ['convert-point', 'null', 0, 0],
    ['rectangle', 'canvas', 40, 24],
    ['ellipse', 'canvas', 40, 24],
    ['triangle', 'canvas', 40, 24],
    ['polygon', 'canvas', 40, 24],
    ['line', 'canvas', 40, 24],
    ['custom-shape', 'null', 0, 0],
  ];

  beforeEach(() => {
    RecordingOffscreenCanvas.instances = [];
    vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('covers every tool name exactly once', () => {
    expect(dispatchTable.map(([toolName]) => toolName).sort()).toEqual([...toolNames].sort());
  });

  it.each(dispatchTable)(
    'runs %s on its own default settings and returns the declared outcome',
    (toolName, outcome, expectedWidth, expectedHeight) => {
      if (outcome === 'no-processor') {
        // The eyedropper rasterizes nothing, so it is not dispatchable at all. Reaching for its
        // processor must fail, not resolve to a stub that returns a blank canvas.
        expect(findToolProcessor(toolName), toolName).toBeUndefined();
        expect(RecordingOffscreenCanvas.instances, toolName).toHaveLength(0);
        return;
      }

      const args = { ...defaultSettings[toolName], ...argOverrides[toolName] } as never;
      const result = findToolProcessor(toolName)!.imageProcessor({ size, bitmap })(args);

      if (outcome === 'null') {
        expect(result, toolName).toEqual([null]);
        expect(RecordingOffscreenCanvas.instances, toolName).toHaveLength(0);
        return;
      }

      if (outcome === 'source-bitmap') {
        expect(result, toolName).toEqual([bitmap]);
        expect(result[0], toolName).toBe(bitmap);
        expect(RecordingOffscreenCanvas.instances, toolName).toHaveLength(0);
        return;
      }

      if (outcome === 'bitmap-and-move') {
        expect(result[0], toolName).toBe(bitmap);
        expect(result[1], toolName).toEqual(defaultSettings.reposition.move);
        expect(RecordingOffscreenCanvas.instances, toolName).toHaveLength(0);
        return;
      }

      if (outcome === 'canvas-with-pos-patch') {
        expect(result, toolName).toHaveLength(2);
        expect(result[1], toolName).toEqual({ width: expectedWidth, height: expectedHeight });
      } else {
        expect(result, toolName).toHaveLength(1);
      }

      // `transform` allocates a second offscreen canvas for its source, so the returned
      // canvas is not necessarily the last one allocated.
      expect(RecordingOffscreenCanvas.instances, toolName).toContain(result[0]);
      const canvas = result[0] as unknown as RecordingOffscreenCanvas;
      expect(canvas.width, toolName).toBe(expectedWidth);
      expect(canvas.height, toolName).toBe(expectedHeight);
    }
  );

  it('consumes the unmodified seeded defaults for every tool except crop', () => {
    for (const toolName of processorNames) {
      if (toolName === 'crop') continue;

      const result = findToolProcessor(toolName)!.imageProcessor({ size, bitmap })({
        ...defaultSettings[toolName],
      } as never);

      expect(result, toolName).toBeDefined();
      expect(result[0], toolName).not.toBeUndefined();
    }
  });

  it('cannot consume the seeded crop defaults at all (src/tools/crop.ts:17)', () => {
    // Every other tool runs straight off its defaults; crop destructures `rect!` and the
    // seeded rect is null, so the document-operation commit needs a real rect first.
    expect(defaultSettings.crop.rect).toBeNull();
    expect(() => toolProcessors.crop.imageProcessor({ size, bitmap })({ ...defaultSettings.crop } as never)).toThrow(
      TypeError
    );
  });

  it('collapses both lasso tools to a 1x1 canvas for the default empty point list', () => {
    for (const toolName of ['polygonal-lasso', 'freehand-lasso'] as const) {
      const result = findToolProcessor(toolName)!.imageProcessor({ size, bitmap })({
        ...defaultSettings[toolName],
      } as never);
      const canvas = RecordingOffscreenCanvas.instances.at(-1)!;

      expect(result[0], toolName).toBe(canvas as unknown as OffscreenCanvas);
      expect(canvas.width, toolName).toBe(1);
      expect(canvas.height, toolName).toBe(1);
    }
  });

  it('hands a creator-param lasso call no source bitmap, because selection consumes one (src/tools/toolProcessors.ts:131,138)', () => {
    // `materialization.ts:164` calls every `creator: true` processor with `{ size }` only.
    // Both lasso tools are flagged creators, yet `selection` reads `bitmap` from
    // `ProcessorToolParams`, so the polygon copy is handed `undefined` on that path.
    // The behaviour is pinned here so the registry/param-type mismatch stays visible.
    const result = toolProcessors['polygonal-lasso'].imageProcessor({ size })({
      ...defaultSettings['polygonal-lasso'],
      points: lassoTriangle,
    } as never);
    const canvas = RecordingOffscreenCanvas.instances.at(-1)!;

    expect(result[0]).toBe(canvas as unknown as OffscreenCanvas);
    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(undefined, -2, -3);
  });
});

describe('toolProcessors classification invariants', () => {
  const commitKinds = new Set(processorNames.map((toolName) => findToolProcessor(toolName)!.commit));

  it('uses every declared commit kind, so no classification is dead', () => {
    expect([...commitKinds].sort()).toEqual([
      'affine-operation',
      'document-operation',
      'geometry',
      'layer-operation',
      'raster',
      'selection',
      'source',
      'unimplemented',
    ]);
  });

  it.each(processorNames)('keeps the %s replay kind aligned with its commit kind', (toolName) => {
    const { commit, replay } = findToolProcessor(toolName)!;

    if (commit === 'raster') {
      expect(replay.kind).toBe('raster-processor');
    } else if (commit === 'unimplemented') {
      expect(replay.kind).toBe('unimplemented');
    } else {
      expect(replay.kind).toBe(commit);
    }
  });

  it.each(processorNames)('derives the %s requiresRaster flag from its commit kind and creator status', (toolName) => {
    const { commit, creator, replay } = findToolProcessor(toolName)!;

    expect(replay.requiresRaster).toBe(commit === 'raster' || (commit === 'selection' && !creator));
  });

  it('gives each tool a distinct replay descriptor that toolsMap reuses by reference', () => {
    const descriptors = new Set<unknown>();

    for (const toolName of processorNames) {
      const { replay } = findToolProcessor(toolName)!;

      expect(toolsMap[toolName].replay, toolName).toBe(replay);
      expect(Object.isFrozen(replay), toolName).toBe(true);
      expect(Object.keys(replay).sort(), toolName).toEqual(['deterministic', 'kind', 'requiresRaster', 'version']);
      descriptors.add(replay);
    }

    expect(descriptors.size).toBe(processorNames.length);
  });

  it('freezes only the replay descriptor, leaving the definition itself mutable metadata', () => {
    expect(Object.isFrozen(toolProcessors.draw)).toBe(false);
    expect(Object.isFrozen(toolProcessors.draw.replay)).toBe(true);
  });
});

describe('toolsMap exhaustiveness', () => {
  const icons: readonly [ToolName, string][] = [
    ['reposition', 'reposition'],
    ['blur', 'blur'],
    ['color', 'color'],
    ['levels', 'levels'],
    ['transform', 'transform'],
    ['crop', 'crop'],
    ['draw', 'draw'],
    ['shape', 'shape'],
    ['text', 'text'],
    ['polygonal-lasso', 'lasso'],
    ['freehand-lasso', 'lasso'],
    ['feather-magnetic-lasso', 'lasso'],
    ['magic-wand', 'magic-wand'],
    ['rectangular-selection', 'rectangular-selection'],
    ['brush', 'brush'],
    ['pencil', 'pencil'],
    ['color-replacement', 'color-replacement'],
    ['eraser', 'eraser'],
    ['magic-eraser', 'magic-eraser'],
    ['paint-bucket', 'paint-bucket'],
    ['eyedropper', 'eyedropper'],
    ['pen', 'pen'],
    ['freeform-pen', 'freeform-pen'],
    ['curvature-pen', 'curvature-pen'],
    ['add-anchor-point', 'add-anchor-point'],
    ['delete-anchor-point', 'delete-anchor-point'],
    ['convert-point', 'convert-point'],
    ['rectangle', 'rectangle'],
    ['ellipse', 'ellipse'],
    ['triangle', 'triangle'],
    ['polygon', 'polygon'],
    ['line', 'line'],
    ['custom-shape', 'custom-shape'],
  ];

  it('exposes exactly the registered tool names, with no unprocessed or missing entries', () => {
    expect(Object.keys(toolsMap).sort()).toEqual([...toolNames].sort());
  });

  it.each(icons)('maps %s to the %s icon', (toolName, icon) => {
    expect(toolsMap[toolName].icon).toBe(icon);
  });

  it('covers every registered tool name in the icon table, so a new tool cannot skip the pin', () => {
    expect(icons.map(([toolName]) => toolName).sort()).toEqual([...toolNames].sort());
  });

  it('shares one Shape toolbox component between the shape tool and every figure variant', () => {
    const shapeTools = ['shape', 'rectangle', 'ellipse', 'triangle', 'polygon', 'line'] as const;
    const component = toolsMap.shape.toolboxComponent;

    for (const toolName of shapeTools) {
      expect(toolsMap[toolName].toolboxComponent, toolName).toBe(component);
    }
  });

  it('gives each lasso variant its own toolbar component', () => {
    const components = [
      toolsMap['polygonal-lasso'].toolboxComponent,
      toolsMap['freehand-lasso'].toolboxComponent,
      toolsMap['feather-magnetic-lasso'].toolboxComponent,
    ];

    expect(new Set(components).size).toBe(3);
  });

  it('builds a distinct placeholder component per unimplemented and paint-stub tool', () => {
    const placeholderTools: readonly ToolName[] = ['brush', 'pencil', ...unimplementedTools];
    const components = placeholderTools.map((toolName) => toolsMap[toolName].toolboxComponent);

    // Six of them share the `pen` placeholder group, but each `placeholderTool(...)` call
    // returns a fresh closure, so no two tool names can be wired to the same component.
    expect(new Set(components).size).toBe(placeholderTools.length);
    for (const toolName of placeholderTools) {
      expect(toolsMap[toolName].toolboxComponent, toolName).not.toBe(toolsMap.shape.toolboxComponent);
    }
  });

  it.each(['polygon-selection', 'lasso', 'Pen', 'colorpicker', 'polygonal-lasso '])(
    'has no entry for the mistyped tool name %j',
    (mistyped) => {
      expect(asRecord[mistyped], mistyped).toBeUndefined();
      expect((toolsMap as unknown as Record<string, unknown>)[mistyped], mistyped).toBeUndefined();
    }
  );

  it('throws a TypeError when an unknown tool name is invoked without optional chaining', () => {
    expect(() => asRecord['definitely-not-a-tool']!.imageProcessor).toThrow(TypeError);
    expect(() => (toolsMap as unknown as Record<string, ToolProcessorDefinition>)['nope']!.imageProcessor).toThrow(
      TypeError
    );
  });
});
