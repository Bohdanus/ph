import { render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  findToolProcessor,
  PIXEL_FREE_TOOLS,
  toolProcessors,
  type PixelToolName,
  type ToolCommitKind,
  type ToolProcessorDefinition,
  type ToolReplayKind,
} from '../toolProcessors.ts';
import { toolsMap } from '../toolsMap.ts';
import { defaultSettings } from '../settings.ts';
import { blur } from '../blur.ts';
import { cloneStamp } from '../cloneStamp.ts';
import { colors } from '../colors.ts';
import { crop } from '../crop.ts';
import { burn, dodge } from '../dodgeBurn.ts';
import { draw } from '../draw.ts';
import { ellipticalSelection } from '../ellipticalSelection.ts';
import { featherMagneticLasso } from '../featherMagneticLasso.ts';
import { gradient } from '../gradient.ts';
import { levels } from '../levels.ts';
import { magicWand } from '../magicWand.ts';
import { quickSelection } from '../quickSelection.ts';
import { rectangularSelection } from '../rectangularSelection.ts';
import { reposition } from '../reposition.ts';
import { selection } from '../selection.ts';
import { shape } from '../shape.ts';
import { sharpen } from '../sharpen.ts';
import { smudge } from '../smudge.ts';
import { sponge } from '../sponge.ts';
import { text } from '../text.ts';
import { transform } from '../transform.ts';
import { createMockCanvasContext, createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import { placeholderToolGroups } from '../../components/ToolbarsRight/toolbarPlaceholderConfig.ts';
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

/** Every member of the `ToolCommitKind` union, for the closed-set assertions below. */
const declaredCommitKinds = [
  'affine-operation',
  'document-operation',
  'geometry',
  'layer-operation',
  'raster',
  'selection',
  'source',
  'unimplemented',
] as const satisfies readonly ToolCommitKind[];

/**
 * Every member of the `ToolReplayKind` union. It is NOT the commit list above with `raster`
 * renamed: the two unions are separate declarations in `src/tools/toolProcessors.ts`, and the
 * replay union is the one the durable replay path dispatches on, so a kind that fell out of use
 * would leave a declared replay strategy with no tool reaching it.
 */
const declaredReplayKinds = [
  'affine-operation',
  'document-operation',
  'geometry',
  'layer-operation',
  'raster-processor',
  'selection',
  'source',
  'unimplemented',
] as const satisfies readonly ToolReplayKind[];

/**
 * The exact `replay.kind` literal every registry entry declares.
 *
 * `replay()` in `src/tools/toolProcessors.ts` is
 * `Object.freeze({ kind, deterministic, version: 1, requiresRaster })` over arguments handed to it
 * at the entry, so the value is a FIXED LITERAL per tool and never computed from anything: a test
 * can pin all forty-three of them. That is what this table is for, and it is why the literal is
 * asserted instead of its truthiness — `kind` selects the durable replay strategy, so `'source'`
 * swapped for `'selection'` on one tool would replay that tool's history entries through the
 * selection arm while every other assertion in this file stayed green.
 *
 * `satisfies Record<PixelToolName, ToolReplayKind>` is the exhaustiveness half: a tool added to the
 * registry without a row here is a type error, not a silently unpinned entry.
 */
const replayKinds = {
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
  'elliptical-selection': 'selection',
  'single-row-marquee': 'selection',
  'single-column-marquee': 'selection',
  'quick-selection': 'selection',
  gradient: 'raster-processor',
  sharpen: 'raster-processor',
  smudge: 'raster-processor',
  dodge: 'raster-processor',
  burn: 'raster-processor',
  sponge: 'raster-processor',
  'clone-stamp': 'raster-processor',
  'red-eye': 'raster-processor',
  brush: 'raster-processor',
  pencil: 'raster-processor',
  'color-replacement': 'raster-processor',
  eraser: 'raster-processor',
  'magic-eraser': 'raster-processor',
  'paint-bucket': 'raster-processor',
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
} satisfies Record<PixelToolName, ToolReplayKind>;

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

/**
 * The `toolsMap wiring` suite renders `toolsMap[*].toolboxComponent` directly, which is the
 * point: it walks the registry rather than a hand-picked subset. Eleven of those components
 * are now real options bars that read the store, the tool args, the layer preview writer and
 * the selection hooks, so the walk needs the same context treatment every `ToolbarsRight`
 * suite uses.
 *
 * `vi.mock` on the hooks, NOT a `StoreProvider` wrapper. The provider pulls in the durable
 * replay/materialization path, which does not survive jsdom, and mocking the hooks is what
 * `ToolbarsRight/Draw/__tests__/Draw.test.tsx` and `ToolbarsRight/__tests__/ToolbarPlaceholder.test.tsx`
 * do for the same reason. Nothing under `src/tools/` or `src/util/` imports any of these
 * modules, so mocking them cannot perturb the processor behaviour asserted above.
 *
 * Every shared mutable is `vi.hoisted` because a `vi.mock` factory is hoisted above the
 * imports, and a factory argument evaluated at hoist time would be a TDZ read.
 */
const optionsBarStore = vi.hoisted(() => ({ color: '#000000', toolName: 'brush' as string }));
const optionsBarSetToolArgs = vi.hoisted(() => vi.fn());
const optionsBarPatchToolArgs = vi.hoisted(() => vi.fn());
const optionsBarTempUpdateLayer = vi.hoisted(() => vi.fn());
const optionsBarDispatch = vi.hoisted(() => vi.fn());
const optionsBarCopySelection = vi.hoisted(() => vi.fn());
const optionsBarPasteSelection = vi.hoisted(() => vi.fn());
const optionsBarClearSelections = vi.hoisted(() => vi.fn());

vi.mock('../../contexts/StoreContext.tsx', () => ({
  useStore: () => [optionsBarStore, optionsBarDispatch],
}));

vi.mock('../../contexts/useCurrentTool.tsx', async () => {
  // `await import` rather than a top-level binding: `toolsMap` is imported before
  // `../settings.ts` in this file, so the factory — which runs while that import graph is
  // still being evaluated — would read `defaultSettings` in its temporal dead zone.
  const { defaultSettings: seeded } = await import('../settings.ts');
  return {
    useCurrentTool: () => ({
      toolArgs: seeded.brush,
      isToolDirty: false,
      setToolArgs: optionsBarSetToolArgs,
      // The seeded defaults are real args for every one of the eleven, so a bar that
      // renders at all is a bar that mounted on a well-formed args object.
      getToolArgs: (toolName: string) => seeded[toolName as keyof typeof seeded],
      patchToolArgs: optionsBarPatchToolArgs,
    }),
  };
});

vi.mock('../../contexts/useLayer.ts', () => ({
  useLayers: () => ({ tempUpdateLayer: optionsBarTempUpdateLayer }),
}));

vi.mock('../../contexts/useSelectionClipboard.ts', () => ({
  useSelectionClipboard: () => ({
    activeSelection: null,
    copyActiveSelection: optionsBarCopySelection,
    hasSelectionClipboard: false,
    pasteSelectionClipboard: optionsBarPasteSelection,
  }),
}));

vi.mock('../../contexts/useSelectionHistory.ts', () => ({
  useSelectionHistory: () => ({ clearSelections: optionsBarClearSelections }),
}));

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
      expect(entry.replay.kind, `${toolName}.replay.kind`).toBe(replayKinds[toolName]);
      expect(declaredCommitKinds, `${toolName}.commit`).toContain(entry.commit);
      expect(typeof entry.imageProcessor).toBe('function');
    }
  });

  it('assigns every processor the exact replay kind literal its registry entry declares', () => {
    // The whole map in one comparison, so a tool that enters or leaves the registry cannot slip
    // past the per-tool assertion above: `toEqual` on two records compares their key sets too.
    const kinds = Object.fromEntries(
      processorNames.map((toolName) => [toolName, findToolProcessor(toolName)!.replay.kind])
    );

    expect(kinds).toEqual(replayKinds);
    // Every declared replay strategy is still reachable. A literal left behind by a renamed
    // strategy would leave the union and the dispatcher disagreeing, which nothing else here sees.
    expect([...new Set(processorNames.map((toolName) => replayKinds[toolName]))].sort()).toEqual(
      [...declaredReplayKinds].sort()
    );
  });

  it('rejects mutation of a replay descriptor', () => {
    expect(() => {
      (toolProcessors.draw.replay as { kind: string }).kind = 'raster-processor';
    }).toThrow(TypeError);

    expect(toolProcessors.draw.replay.kind).toBe('source');
  });

  it('marks raster and selection processors as requiring raster', () => {
    const requiresRaster = processorNames.filter((toolName) => findToolProcessor(toolName)!.replay.requiresRaster);

    expect(requiresRaster.sort()).toEqual(
      [
        'brush',
        'burn',
        'clone-stamp',
        'color-replacement',
        'dodge',
        'elliptical-selection',
        'eraser',
        'feather-magnetic-lasso',
        'freehand-lasso',
        'gradient',
        'magic-eraser',
        'magic-wand',
        'paint-bucket',
        'pencil',
        'polygonal-lasso',
        'quick-selection',
        'rectangular-selection',
        'red-eye',
        'sharpen',
        'single-column-marquee',
        'single-row-marquee',
        'smudge',
        'sponge',
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
      [
        'brush',
        'burn',
        'clone-stamp',
        'color-replacement',
        'dodge',
        'eraser',
        'gradient',
        'magic-eraser',
        'paint-bucket',
        'pencil',
        'red-eye',
        'sharpen',
        'smudge',
        'sponge',
      ].sort()
    );
    for (const toolName of rasterCommitted) {
      expect(findToolProcessor(toolName)!.replay.kind).toBe('raster-processor');
    }
  });

  it('keeps every raster processor safe to replay over its input bitmap', () => {
    for (const toolName of processorNames) {
      const processor = findToolProcessor(toolName)!;
      if (processor.commit !== 'raster') continue;
      expect(processor.compositesOntoInput, toolName).not.toBe(false);
    }
  });

  it('only labels source-creating tools as creators, and each creator commits as a source', () => {
    const creators = processorNames.filter((toolName) => findToolProcessor(toolName)!.creator);

    expect(creators.sort()).toEqual(
      ['brush', 'draw', 'ellipse', 'line', 'pencil', 'polygon', 'rectangle', 'shape', 'text', 'triangle'].sort()
    );
    for (const toolName of creators) {
      expect(['source', 'selection', 'raster'], `${toolName} creator commit`).toContain(
        findToolProcessor(toolName)!.commit
      );
    }
  });

  it('flags every tool routed to the shape processor as a deterministic creator', () => {
    // The figure family is derived from the processor identity rather than a
    // hand-written name list, so a new shape variant cannot be registered
    // without the `creator` flag `sourceBitmap` reads in src/contexts/materialization.ts.
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
      'elliptical-selection': 'selection',
      'quick-selection': 'selection',
      'single-row-marquee': 'selection',
      'single-column-marquee': 'selection',
      brush: 'raster',
      pencil: 'raster',
      'color-replacement': 'raster',
      eraser: 'raster',
      'magic-eraser': 'raster',
      'paint-bucket': 'raster',
      gradient: 'raster',
      sharpen: 'raster',
      smudge: 'raster',
      dodge: 'raster',
      burn: 'raster',
      sponge: 'raster',
      'clone-stamp': 'raster',
      'red-eye': 'raster',
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
    const ellipseSelectionSource = toolProcessors['elliptical-selection'].imageProcessor;
    const quickSelectionSource = toolProcessors['quick-selection'].imageProcessor;
    const shapeSource = toolProcessors.shape.imageProcessor;

    expect(toolProcessors['freehand-lasso'].imageProcessor).toBe(lassoSource);
    for (const toolName of ['rectangle', 'ellipse', 'triangle', 'polygon', 'line'] as const) {
      expect(findToolProcessor(toolName)!.imageProcessor).toBe(shapeSource);
    }
    expect(featherSource).not.toBe(lassoSource);
    expect(magicWandSource).not.toBe(lassoSource);
    expect(rectSelectionSource).not.toBe(lassoSource);
    expect(ellipseSelectionSource).not.toBe(lassoSource);
    expect(ellipseSelectionSource).not.toBe(rectSelectionSource);
    expect(quickSelectionSource).not.toBe(lassoSource);
    expect(quickSelectionSource).not.toBe(rectSelectionSource);
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
    // Reading through the optional chain has to yield a VALUE, not merely avoid throwing: a
    // registry that synthesised a stub processor would let `?.imageProcessor` off the hook
    // entirely, and `not.toThrow()` could not tell that apart from an absent entry.
    expect(asRecord['definitely-not-a-tool']?.imageProcessor).toBeUndefined();
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
    // substituted its own width: the `pencil` adapter in src/tools/toolProcessors.ts.
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

/**
 * Every tool that has left the placeholder roster and now mounts a real options bar.
 *
 * Asserted disjoint from `placeholderNames` below, and each name is mounted by the
 * `renders a real options bar` test, so a wiring entry reverted to `placeholderTool(...)`
 * fails rather than quietly going untested.
 */
const realBarNames = [
  'eyedropper',
  'color-sampler',
  'ruler',
  'elliptical-selection',
  'quick-selection',
  'eraser',
  'clone-stamp',
  'red-eye',
  'paint-bucket',
  'gradient',
  'sharpen',
  'smudge',
  'dodge',
  'burn',
  'sponge',
  'color-replacement',
] as const satisfies readonly ToolName[];

/** The tools whose toolbox component is still `placeholderTool(...)` in `toolsMap.ts`. */
const placeholderNames = [
  // `color-replacement` was here and is gone: it has a real options bar now
  // (`src/components/ToolbarsRight/ColorReplacement/ColorReplacement.tsx`), not a TODO card, and
  // listing it here would keep a placeholder contract alive for a tool that has left the roster.
  'pen',
  'freeform-pen',
  'curvature-pen',
  'add-anchor-point',
  'delete-anchor-point',
  'convert-point',
  'custom-shape',
] as const satisfies readonly ToolName[];

/**
 * Every placeholder card's exact rendering: the title `toolsMap.ts` passes to `placeholderTool`,
 * and the config group that card is wired to.
 *
 * `configKey` is this file's own claim about which group each card belongs on, and it is what the
 * assertion binds to: the rendered chip set is compared against `placeholderToolGroups` for the key
 * named HERE, never against the group the card actually renders, so re-pointing a card in
 * `toolsMap.ts` hands it another group's chips and fails below. What the table does not claim is a
 * group's own chip list, which would move every row naming that group in step.
 *
 * Four of the seven cards share the `pen` group and the other three name a key of their own, so
 * neither the group nor the title alone tells the cards apart; both are pinned.
 */
const placeholderCards = [
  { toolName: 'pen', configKey: 'pen', title: 'Pen Tool' },
  { toolName: 'freeform-pen', configKey: 'freeform-pen', title: 'Freeform Pen Tool' },
  { toolName: 'curvature-pen', configKey: 'curvature-pen', title: 'Curvature Pen Tool' },
  { toolName: 'add-anchor-point', configKey: 'pen', title: 'Add Anchor Point Tool' },
  { toolName: 'delete-anchor-point', configKey: 'pen', title: 'Delete Anchor Point Tool' },
  { toolName: 'convert-point', configKey: 'pen', title: 'Convert Point Tool' },
  { toolName: 'custom-shape', configKey: 'custom-shape', title: 'Custom Shape Tool' },
] as const;

/** The one description every `PlaceholderTool` falls back to, from its own default parameter. */
const PLACEHOLDER_DESCRIPTION = 'TODO: tool behavior not implemented yet.';

/**
 * The exact control ids each real options bar renders.
 *
 * "Rendered something" was the old claim and it was unfalsifiable for the wiring it exists to
 * catch: the eraser, the sponge and the quick selection all render a caption reading `Mode`, so a
 * caption check passes for three wrong wirings. Ids are tool-scoped, which makes the exact SET the
 * discriminator — and the set is exact in both directions, so a bar that lost a control fails too.
 * `dodge` and `burn` share `Tonal`, which derives its ids from the store's `toolName`; listing
 * both is what pins that routing per tool instead of per component.
 */
const realBarControlIds: readonly (readonly [ToolName, readonly string[]])[] = [
  ['eyedropper', ['eyedropper-sample-size']],
  // The Color Sampler's bar is one control, one Clear button, and a per-sampler readout pair whose
  // ids are number-SUFFIXED because a second sampler adds a row rather than replacing the first.
  // Pinned at the zero-sampler state for the reason above — a Clear that rendered while there is
  // nothing to clear would fail here — and the per-sampler ids are pinned in the bar's own suite,
  // which is where a fifth sampler would be visible.
  ['color-sampler', ['color-sampler-sample-size', 'color-sampler-clear']],
  // The Ruler's bar is readouts, not controls, so its id set is the seven readout outputs plus the
  // one button. Pinned exactly for the reason above: a readout that stopped rendering would
  // otherwise be invisible to this suite.
  ['ruler', ['ruler-x', 'ruler-y', 'ruler-w', 'ruler-h', 'ruler-a', 'ruler-d1', 'ruler-d2', 'ruler-clear']],
  // The seeded `style` is `'normal'`, and `EllipticalSelection.tsx` renders Ratio only for
  // `fixed-ratio` and Width/Height only for `fixed-size`, so the Style select is the whole bar at
  // the defaults. Pinning the gated controls as ABSENT is the other half: a Style select rendered
  // unconditionally would fail here.
  ['elliptical-selection', ['elliptical-selection-style']],
  ['quick-selection', ['quick-selection-mode', 'quick-selection-size', 'quick-selection-tolerance']],
  ['eraser', ['eraser-flow', 'eraser-hardness', 'eraser-mode', 'eraser-opacity', 'eraser-size', 'eraser-spacing']],
  ['clone-stamp', ['clone-stamp-aligned', 'clone-stamp-hardness', 'clone-stamp-opacity', 'clone-stamp-size']],
  ['red-eye', ['red-eye-darken-amount', 'red-eye-pupil-size']],
  [
    'paint-bucket',
    [
      'paint-bucket-anti-aliased',
      'paint-bucket-contiguous',
      'paint-bucket-fill',
      'paint-bucket-opacity',
      'paint-bucket-tolerance',
    ],
  ],
  ['gradient', ['gradient-color-a', 'gradient-color-b', 'gradient-opacity', 'gradient-type']],
  ['sharpen', ['sharpen-amount', 'sharpen-radius']],
  ['smudge', ['smudge-hardness', 'smudge-size', 'smudge-strength']],
  ['dodge', ['dodge-exposure', 'dodge-hardness', 'dodge-range', 'dodge-size']],
  ['burn', ['burn-exposure', 'burn-hardness', 'burn-range', 'burn-size']],
  ['sponge', ['sponge-flow', 'sponge-hardness', 'sponge-mode', 'sponge-size', 'sponge-vibrance']],
  [
    'color-replacement',
    [
      'color-replacement-limits',
      'color-replacement-opacity',
      'color-replacement-sampling',
      'color-replacement-size',
      'color-replacement-smoothness',
      'color-replacement-tolerance',
    ],
  ],
];

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

  it('gives every tool a non-empty icon, and shares exactly the lasso icon', () => {
    // "Distinct" was never the contract: the three lasso tools legitimately share one icon,
    // so a distinctness assertion is a threshold with a fudge factor — `greaterThan(half)`
    // passed at 21 distinct out of 41, leaving twenty tools free to share an icon. The
    // property worth pinning is the exact shared set, derived here and compared by name, so
    // a tool that starts sharing a second icon fails by name rather than by arithmetic.
    // The per-tool icon values themselves are pinned exhaustively further down this file.
    const byIcon = new Map<string, ToolName[]>();

    for (const toolName of toolNames) {
      const { icon } = toolsMap[toolName];

      expect(typeof icon, toolName).toBe('string');
      expect(icon.length, toolName).toBeGreaterThan(0);
      byIcon.set(icon, [...(byIcon.get(icon) ?? []), toolName]);
    }

    const shared = [...byIcon.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([icon, names]) => ({ icon, names: names.sort() }))
      .sort((a, b) => a.icon.localeCompare(b.icon));

    expect(shared).toEqual([{ icon: 'lasso', names: ['feather-magnetic-lasso', 'freehand-lasso', 'polygonal-lasso'] }]);
  });

  it('claims no tool for both the placeholder roster and the real options bars', () => {
    // Both lists are hand-written, so this is what stops either of them rotting into a
    // contradictory picture. The roster is wider than their union — the brush, the levels
    // and the lasso family were never placeholders — so the claim is disjointness plus
    // membership, not coverage: a name in both lists would have the placeholder test below
    // asserting a TODO badge for a bar that has none.
    const claimed = [...placeholderNames, ...realBarNames];
    const unknown = claimed.filter((toolName) => !toolNames.includes(toolName as ToolName));

    expect(unknown).toEqual([]);
    expect(new Set(claimed).size, 'a tool is claimed by both lists').toBe(claimed.length);
  });

  it('renders the placeholder toolbox components with their configured options', () => {
    // `PlaceholderTool` reads no context, so a true placeholder mounts bare. What it renders is
    // three labelled spans in a fixed order — the `TODO` badge, the card's own title, then one
    // span per chip of the group `toolsMap.ts` named — plus the default description. Pinning that
    // array exactly is the claim `/TODO|Tool/i` never made: the old regex was satisfied by the
    // title alone, so a card wired to the wrong group, or one not rendering every chip of the
    // group it names, still passed.
    for (const { toolName, configKey, title } of placeholderCards) {
      const claimedChips = placeholderToolGroups[configKey];

      // The group's existence is checked before it is spread, so a `configKey` that names no group
      // fails with the tool name attached instead of throwing on a non-iterable value.
      expect(claimedChips, toolName).toBeDefined();

      const Component = toolsMap[toolName].toolboxComponent;
      const { container, unmount } = render(React.createElement(Component));
      const spans = [...container.querySelectorAll('span')].map((node) => node.textContent);

      expect(spans, toolName).toEqual(['TODO', title, ...claimedChips]);
      expect(container.textContent, toolName).toContain(PLACEHOLDER_DESCRIPTION);
      unmount();
    }
    expect(placeholderCards.map(({ toolName }) => toolName).sort()).toEqual([...placeholderNames].sort());
  });

  it('renders a real options bar for every tool that left the placeholder roster', () => {
    // The inverse of the assertion above, and the reason the real bars are mounted through
    // the hoisted context mocks at the top of this file rather than through `StoreProvider`:
    // the provider pulls in the durable replay/materialization path, which does not survive
    // jsdom, so rendering these bare would throw `useStore must be used within
    // StoreProvider` before reaching a single assertion.
    for (const [toolName, controlIds] of realBarControlIds) {
      // `Tonal` decides which of its two tools it is from `useStore().toolName`, and the
      // other ten read their args by name, so the store has to agree with the tool under test.
      optionsBarStore.toolName = toolName;
      const Component = toolsMap[toolName].toolboxComponent;
      const { container, unmount } = render(React.createElement(Component));

      // A `PlaceholderTool` is recognisable by exactly what it renders: a TODO badge, the
      // "not implemented yet" description, and no other content. None of the three can be
      // present once the bar is real, and this fails loudly the moment a wiring entry is
      // pointed back at `placeholderTool(...)`.
      //
      // The id set is what replaces `textContent` being non-empty: it is the bar's own
      // controls, so a bar mounted with no args — which is what every one of these components
      // renders when `getToolArgs` misses — fails here instead of passing as "something".
      expect([...container.querySelectorAll('[id]')].map((node) => node.id).sort(), toolName).toEqual(
        [...controlIds].sort()
      );
      expect(screen.queryByText('TODO'), toolName).toBeNull();
      expect(screen.queryByText(PLACEHOLDER_DESCRIPTION), toolName).toBeNull();
      unmount();
    }
    expect(realBarControlIds.map(([toolName]) => toolName).sort()).toEqual([...realBarNames].sort());
    optionsBarStore.toolName = 'brush';
  });

  it('shows a TODO badge on the placeholder toolbox components', () => {
    // The brush and pencil used to be the only `showTodoBadge: false` entries here,
    // the placeholder for a tool whose canvas behaviour was already real. Both now
    // render the Photoshop paint bar instead (the `brush` and `pencil` entries in
    // src/tools/toolsMap.ts), so
    // every remaining placeholder is an unimplemented tool and every one of them
    // carries the badge. Their bars are asserted in
    // `src/components/ToolbarsRight/Paint/__tests__/Paint.test.tsx`.
    //
    // `color-replacement` was on this list and is not any more: it is a built tool now,
    // with its own `ColorReplacementToolArea` and its own `ColorReplacement.tsx` options
    // bar, so there is no placeholder left to carry a badge. It left for the same reason,
    // one tranche later on main. It is not merely deleted from this list — it is in
    // `realBarNames`, so the test above now asserts the OPPOSITE of this one for it, which
    // is the stronger half: one assertion that a tool is not a stub is worth more than the
    // stub assertion it replaces.
    for (const toolName of placeholderNames) {
      const { unmount } = render(React.createElement(toolsMap[toolName].toolboxComponent));

      // Exactly one, not at least one: the badge is a single span, and a card that grew a second
      // one — or matched the description, whose text merely starts with `TODO` — is a different
      // card. `getAllByText` matches whole element text, so the description cannot satisfy it.
      // Every placeholder is walked rather than the two the roster happened to sample, because
      // `showTodoBadge` is `placeholderTool`'s THIRD argument and toolsMap passes it per entry.
      expect(screen.getAllByText('TODO'), toolName).toHaveLength(1);
      unmount();
    }
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
  ['elliptical-selection', ellipticalSelection],
  ['quick-selection', quickSelection],
  ['gradient', gradient],
  ['sharpen', sharpen],
  ['smudge', smudge],
  ['dodge', dodge],
  ['burn', burn],
  ['sponge', sponge],
  ['clone-stamp', cloneStamp],
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

    // The only legitimate sharing is the lasso pair, the shape/figure family, and the
    // marquee trio, which are the same module export wired to several tool names on purpose.
    // `rectangularSelection` joins that list because a selection is geometry in the store and
    // no pixels at all: the processor is a pass-through that hands the document bitmap back
    // untouched (`rectangularSelection.ts:9`-`:13`), so the Rectangular Marquee and the two
    // 1-pixel marquees have nothing to differ on. A processor that DID differ per tool would
    // fail this assertion, which is the point of it.
    const shared = [...seen.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([processor, names]) => ({
        names: names.sort(),
        isIntentional: processor === selection || processor === shape || processor === rectangularSelection,
      }))
      .sort((a, b) => a.names[0].localeCompare(b.names[0]));

    expect(shared).toEqual([
      { names: ['ellipse', 'line', 'polygon', 'rectangle', 'shape', 'triangle'], isIntentional: true },
      { names: ['freehand-lasso', 'polygonal-lasso'], isIntentional: true },
      {
        names: ['rectangular-selection', 'single-column-marquee', 'single-row-marquee'],
        isIntentional: true,
      },
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
      [
        ...unimplementedTools,
        'feather-magnetic-lasso',
        'magic-wand',
        'rectangular-selection',
        'elliptical-selection',
        'quick-selection',
        'single-row-marquee',
        'single-column-marquee',
      ].sort()
    );
  });

  it('makes the zero-arity non-unimplemented processors the exact set needing a registry cast', () => {
    // These are the entries the registry has to silence with @ts-expect-error
    // (src/tools/toolProcessors.ts) because their published args type is not reachable
    // from the generic `(args: ToolArgs) => ToolResult` signature. The raster tools that
    // used to sit here now declare their args parameter, so they join the casted set's
    // complement and are asserted by the arity test above instead.
    const casted = processorNames.filter(
      (toolName) =>
        findToolProcessor(toolName)!.commit !== 'unimplemented' &&
        findToolProcessor(toolName)!.imageProcessor(params).length === 0
    );

    expect(casted.sort()).toEqual(
      [
        'feather-magnetic-lasso',
        'magic-wand',
        'rectangular-selection',
        'elliptical-selection',
        'quick-selection',
        'single-row-marquee',
        'single-column-marquee',
      ].sort()
    );
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
    ['elliptical-selection', 'source-bitmap', 0, 0],
    ['quick-selection', 'source-bitmap', 0, 0],
    // The 1-pixel marquees share `rectangularSelection`, which is the pass-through that hands
    // the document bitmap back untouched, so they resolve to the same outcome as the row above.
    ['single-row-marquee', 'source-bitmap', 0, 0],
    ['single-column-marquee', 'source-bitmap', 0, 0],
    ['brush', 'canvas', 40, 24],
    ['pencil', 'canvas', 40, 24],
    ['color-replacement', 'canvas', 40, 24],
    // The raster tools below own real processors, and every one of them allocates a
    // FRESH full-`size` canvas rather than handing the source bitmap back. That is the whole
    // reason they are `commit: 'raster'`: `tempUpdateLayer` assigns the result straight to
    // `layer.tmpCanvas`, so returning `[bitmap]` would leave the layer holding the very object
    // it already had and the edit would render as nothing at all. `transform` is the one other
    // `canvas` row that allocates twice, which is why the assertion below checks `toContain`
    // rather than the identity of the last instance.
    ['eraser', 'canvas', 40, 24],
    ['magic-eraser', 'canvas', 40, 24],
    ['paint-bucket', 'canvas', 40, 24],
    ['gradient', 'canvas', 40, 24],
    ['sharpen', 'canvas', 40, 24],
    ['smudge', 'canvas', 40, 24],
    ['dodge', 'canvas', 40, 24],
    ['burn', 'canvas', 40, 24],
    ['sponge', 'canvas', 40, 24],
    ['clone-stamp', 'canvas', 40, 24],
    ['red-eye', 'source-bitmap', 0, 0],
    // The eyedropper rasterizes nothing, so it is absent from the registry entirely
    // (`PIXEL_FREE_TOOLS` in toolProcessors.ts) rather than registered with a stub.
    ['eyedropper', 'no-processor', 0, 0],
    ['color-sampler', 'no-processor', 0, 0],
    ['ruler', 'no-processor', 0, 0],
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

  /**
   * The same registry read through the SEEDED DEFAULTS only — no injected rect, no lasso path.
   *
   * `dispatchTable` above is allowed to override arguments, which is exactly why it cannot answer
   * "does this tool run on what `defaultSettings` ships". Two rows differ from it for that reason
   * alone: the two lassos take an empty point list here and collapse to a 1x1 canvas instead of
   * the 10x10 one a real path produces, and crop is absent because its seeded `rect` is `null`
   * (asserted separately, by the throw it causes).
   *
   * `canvas`  — a fresh full-`size` canvas, which is the whole reason a `commit: 'raster'` tool
   *             cannot hand the source bitmap back: `tempUpdateLayer` assigns this straight to
   *             `layer.tmpCanvas`, so a returned `[bitmap]` would render the edit as nothing.
   * `bitmap`  — the source bitmap BY IDENTITY, for the selection processors that rasterize nothing.
   * `bitmap-and-move` — the geometry patch reposition returns beside the bitmap.
   * `null`    — the unimplemented stub's `[null]`.
   */
  type DefaultsOutcome = 'bitmap' | 'bitmap-and-move' | 'canvas' | 'empty-canvas' | 'null';

  const defaultsOutcomeTable: readonly [ToolName, DefaultsOutcome, number, number][] = [
    ['reposition', 'bitmap-and-move', 0, 0],
    ['blur', 'canvas', 40, 24],
    ['color', 'canvas', 40, 24],
    ['levels', 'canvas', 40, 24],
    ['transform', 'canvas', 40, 24],
    ['draw', 'canvas', 40, 24],
    ['shape', 'canvas', 40, 24],
    ['text', 'canvas', 40, 24],
    ['polygonal-lasso', 'empty-canvas', 1, 1],
    ['freehand-lasso', 'empty-canvas', 1, 1],
    ['feather-magnetic-lasso', 'bitmap', 0, 0],
    ['magic-wand', 'bitmap', 0, 0],
    ['rectangular-selection', 'bitmap', 0, 0],
    ['elliptical-selection', 'bitmap', 0, 0],
    ['quick-selection', 'bitmap', 0, 0],
    ['single-row-marquee', 'bitmap', 0, 0],
    ['single-column-marquee', 'bitmap', 0, 0],
    ['brush', 'canvas', 40, 24],
    ['pencil', 'canvas', 40, 24],
    ['color-replacement', 'canvas', 40, 24],
    ['eraser', 'canvas', 40, 24],
    ['magic-eraser', 'canvas', 40, 24],
    ['paint-bucket', 'canvas', 40, 24],
    ['gradient', 'canvas', 40, 24],
    ['sharpen', 'canvas', 40, 24],
    ['smudge', 'canvas', 40, 24],
    ['dodge', 'canvas', 40, 24],
    ['burn', 'canvas', 40, 24],
    ['sponge', 'canvas', 40, 24],
    ['clone-stamp', 'canvas', 40, 24],
    ['red-eye', 'bitmap', 0, 0],
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
    // The claim is that the SEEDED ARGS ALONE drive every processor, so the table below is a
    // second, independent reading of the registry: `dispatchTable` above may inject a rect and a
    // lasso path, which is what makes it a weaker statement about the defaults. What each row
    // pins is the whole returned tuple, not its existence — `toBeDefined()` passed for a tool
    // that returned the wrong bitmap, a zero-by-zero canvas, or a `[null]` it had no business
    // returning, because the only thing asked was that something came back.
    for (const [toolName, outcome, expectedWidth, expectedHeight] of defaultsOutcomeTable) {
      RecordingOffscreenCanvas.instances = [];
      const result = findToolProcessor(toolName)!.imageProcessor({ size, bitmap })({
        ...defaultSettings[toolName],
      } as never);
      const allocated = RecordingOffscreenCanvas.instances;

      if (outcome === 'null') {
        // The unimplemented stub allocates nothing and says so with a null bitmap.
        expect(result, toolName).toEqual([null]);
        expect(allocated, toolName).toHaveLength(0);
        continue;
      }

      if (outcome === 'bitmap') {
        // A selection is geometry in the store, so these hand the document bitmap straight back:
        // identity, not a copy, is the whole claim.
        expect(result, toolName).toEqual([bitmap]);
        expect(result[0], toolName).toBe(bitmap);
        expect(allocated, toolName).toHaveLength(0);
        continue;
      }

      if (outcome === 'bitmap-and-move') {
        // Reposition is the one processor that returns a geometry patch alongside the bitmap.
        expect(result, toolName).toEqual([bitmap, defaultSettings.reposition.move]);
        expect(result[1], toolName).toEqual({ x: 0, y: 0 });
        expect(allocated, toolName).toHaveLength(0);
        continue;
      }

      expect(result, toolName).toHaveLength(1);
      expect(allocated, toolName).toContain(result[0]);
      const canvas = result[0] as unknown as RecordingOffscreenCanvas;
      expect(canvas.width, toolName).toBe(expectedWidth);
      expect(canvas.height, toolName).toBe(expectedHeight);
    }
    expect(defaultsOutcomeTable.map(([toolName]) => toolName).sort()).toEqual(
      processorNames.filter((toolName) => toolName !== 'crop').sort()
    );
  });

  it('cannot consume the seeded crop defaults at all (the crop processor in src/tools/crop.ts)', () => {
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

  it.each(['brush', 'pencil'] as const)('composites %s over the supplied input bitmap', (toolName) => {
    const result = findToolProcessor(toolName)!.imageProcessor({ size, bitmap })({
      ...defaultSettings[toolName],
      points: [
        { x: 4, y: 4 },
        { x: 8, y: 8 },
      ],
    } as never);
    const canvas = result[0] as unknown as RecordingOffscreenCanvas;

    expect(canvas.ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, size.width, size.height);
    expect(canvas.ctx.stroke).toHaveBeenCalledTimes(1);
  });
});

describe('toolProcessors classification invariants', () => {
  const commitKinds = new Set(processorNames.map((toolName) => findToolProcessor(toolName)!.commit));

  it('uses every declared commit kind, so no classification is dead', () => {
    expect([...commitKinds].sort()).toEqual([...declaredCommitKinds].sort());
  });

  it.each(processorNames)('keeps the %s replay kind aligned with its commit kind', (toolName) => {
    const { commit, replay } = findToolProcessor(toolName)!;

    // Derived, so it cannot stand alone — a tool whose commit AND kind were both rewritten
    // satisfies it. The literals are pinned by the `replayKinds` table; this pins the RULE that
    // produces them, which is what makes a newly registered tool's two fields correct by default.
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
    ['elliptical-selection', 'elliptical-selection'],
    ['quick-selection', 'quick-selection'],
    ['single-row-marquee', 'single-row-marquee'],
    ['single-column-marquee', 'single-column-marquee'],
    ['brush', 'brush'],
    ['pencil', 'pencil'],
    ['color-replacement', 'color-replacement'],
    ['red-eye', 'red-eye'],
    ['eraser', 'eraser'],
    ['clone-stamp', 'clone-stamp'],
    ['magic-eraser', 'magic-eraser'],
    ['paint-bucket', 'paint-bucket'],
    ['gradient', 'gradient'],
    ['sharpen', 'sharpen'],
    ['smudge', 'smudge'],
    ['dodge', 'dodge'],
    ['burn', 'burn'],
    ['sponge', 'sponge'],
    ['eyedropper', 'eyedropper'],
    ['color-sampler', 'color-sampler'],
    ['ruler', 'ruler'],
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

  it('builds a distinct placeholder component per unimplemented tool', () => {
    // `color-replacement` was the one other name here and has left the roster: it has a real
    // options bar now, and the brush and the pencil already had `Paint.tsx` before it did.
    const placeholderTools: readonly ToolName[] = [...unimplementedTools];
    const components = placeholderTools.map((toolName) => toolsMap[toolName].toolboxComponent);

    // Four of them share the `pen` placeholder group, but each `placeholderTool(...)` call
    // returns a fresh closure, so no two tool names can be wired to the same component.
    expect(new Set(components).size).toBe(placeholderTools.length);
    for (const toolName of placeholderTools) {
      expect(toolsMap[toolName].toolboxComponent, toolName).not.toBe(toolsMap.shape.toolboxComponent);
    }
  });

  it('builds a distinct paint bar for the brush and the pencil', () => {
    // `createPaintToolbar` mints a closure per tool for the same reason
    // `placeholderTool` does: `ToolbarHorizontal` remounts the bar on
    // `key={toolName}`, and a shared identity would make the two tools'
    // components indistinguishable to that contract.
    expect(toolsMap.brush.toolboxComponent).not.toBe(toolsMap.pencil.toolboxComponent);
    expect(toolsMap.brush.toolboxComponent).not.toBe(toolsMap.shape.toolboxComponent);
    expect(toolsMap.pencil.toolboxComponent).not.toBe(toolsMap.shape.toolboxComponent);
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
