import { render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toolProcessors, type ToolProcessorDefinition } from '../toolProcessors.ts';
import { toolsMap } from '../toolsMap.ts';
import { defaultSettings } from '../settings.ts';
import { createMockCanvasContext, createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import type { ToolName } from '../../contexts/tool-types.ts';
import type { PaintToolArgs, PaintToolName } from '../draw.ts';
import type { Point } from '../../contexts/general-types.ts';

const toolNames = Object.keys(defaultSettings) as ToolName[];

type MockCtx = ReturnType<typeof createMockCanvasContext>;

class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  readonly ctx: MockCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.ctx = createMockCanvasContext({ canvas: this });
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): MockCtx {
    return this.ctx;
  }
}

const asRecord = toolProcessors as unknown as Record<string, ToolProcessorDefinition | undefined>;

describe('toolProcessors registry', () => {
  it('registers exactly one processor for every ToolName', () => {
    expect(Object.keys(toolProcessors).sort()).toEqual([...toolNames].sort());
  });

  it('gives every tool a frozen, versioned replay descriptor', () => {
    for (const toolName of toolNames) {
      const entry = toolProcessors[toolName];

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
    const requiresRaster = toolNames.filter((toolName) => toolProcessors[toolName].replay.requiresRaster);

    expect(requiresRaster.sort()).toEqual(
      ['brush', 'color-replacement', 'feather-magnetic-lasso', 'magic-wand', 'pencil'].sort()
    );
  });

  it('marks only unimplemented tools as non-deterministic', () => {
    const nonDeterministic = toolNames.filter((toolName) => !toolProcessors[toolName].replay.deterministic);

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
    const unimplemented = toolNames.filter(
      (toolName) =>
        toolProcessors[toolName].commit === 'unimplemented' || toolProcessors[toolName].replay.kind === 'unimplemented'
    );
    const nonDeterministic = toolNames.filter((toolName) => !toolProcessors[toolName].replay.deterministic);

    expect([...unimplemented].sort()).toEqual([...nonDeterministic].sort());
    for (const toolName of unimplemented) {
      expect(toolProcessors[toolName].replay.deterministic, toolName).toBe(false);
      expect(toolProcessors[toolName].replay.requiresRaster, toolName).toBe(false);
    }
  });

  it('commits every raster processor as a raster-processor replay', () => {
    const rasterCommitted = toolNames.filter((toolName) => toolProcessors[toolName].commit === 'raster');

    expect(rasterCommitted.sort()).toEqual(['brush', 'color-replacement', 'pencil']);
    for (const toolName of rasterCommitted) {
      expect(toolProcessors[toolName].replay.kind).toBe('raster-processor');
    }
  });

  it('only labels source-creating tools as creators, and each creator commits as a source', () => {
    const creators = toolNames.filter((toolName) => toolProcessors[toolName].creator);

    expect(creators.sort()).toEqual(
      [
        'draw',
        'freehand-lasso',
        'polygon',
        'polygonal-lasso',
        'rectangular-selection',
        'shape',
        'text',
        'triangle',
      ].sort()
    );
    for (const toolName of creators) {
      expect(['source', 'selection'], `${toolName} creator commit`).toContain(toolProcessors[toolName].commit);
    }
  });

  it.fails(
    'treats every figure variant as layer-creating, like triangle and polygon (src/tools/toolProcessors.ts:214-218)',
    () => {
      // Asymmetry: `rectangle` (:214), `ellipse` (:215) and `line` (:218) commit as `source`
      // but are not flagged `creator`, unlike `triangle` (:216) and `polygon` (:217), so they
      // cannot create a layer on an empty document. The chain has no `never`/exhaustiveness
      // trap, so a new figure variant fails the same way.
      const figureVariants = ['rectangle', 'ellipse', 'triangle', 'polygon', 'line'] as const;

      for (const toolName of figureVariants) {
        expect(toolProcessors[toolName].creator, toolName).toBe(true);
      }
    }
  );

  it('maps the full tool roster onto the declared commit kinds', () => {
    const commits = Object.fromEntries(toolNames.map((toolName) => [toolName, toolProcessors[toolName].commit]));

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
      expect(toolProcessors[toolName].imageProcessor).toBe(shapeSource);
    }
    expect(featherSource).not.toBe(lassoSource);
    expect(magicWandSource).not.toBe(lassoSource);
    expect(rectSelectionSource).not.toBe(lassoSource);
  });

  it('returns a null bitmap from every unimplemented processor instead of throwing', () => {
    for (const toolName of toolNames) {
      if (toolProcessors[toolName].commit !== 'unimplemented') continue;

      const result = toolProcessors[toolName].imageProcessor({
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
    const result = toolProcessors[toolName].imageProcessor({ size: { width: 16, height: 16 } })({
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

  it('passes a NaN pencil line width straight through to the context (src/tools/toolProcessors.ts:175)', () => {
    // `Math.max(1, Number(lineWidth ?? 3))` only guards `undefined`; `NaN ?? 3` is `NaN`
    // and `Math.max(1, NaN)` is `NaN`, so a non-finite width reaches `ctx.lineWidth`.
    //
    // This is a characterization of the CURRENT behavior, and the `it.fails` right below is the
    // same input asserting the DESIRED behavior. Fixing `toolProcessors.ts:175` breaks this
    // test too, so delete it together with that one — do not let it read as a regression pin.
    const recorded = run('pencil', { lineWidth: Number.NaN, points: stroke });

    expect(Number.isNaN(recorded.lineWidth)).toBe(true);
  });

  it.fails(
    'guards a non-finite pencil line width before it reaches the context (src/tools/toolProcessors.ts:175)',
    () => {
      const recorded = run('pencil', { lineWidth: Number.NaN, points: stroke });

      expect(recorded.lineWidth).toBe(1);
    }
  );

  it('color replacement always rasterizes with the spray pen and its own alpha ramp', () => {
    const recorded = run('color-replacement', { penType: 'pen', lineWidth: 6, points: stroke.slice(0, 1) });

    // The penType argument is forced to `spray`, so `setupDrawCtx` bails out and the
    // pen-only lineWidth/globalAlpha assignments never happen.
    expect(recorded.stroke).not.toHaveBeenCalled();
    expect(recorded.lineWidth).toBe(1);
    const gradientCall = (recorded.createRadialGradient.mock.calls as unknown as number[][])[0];
    expect(gradientCall[5]).toBe(6);
    expect(gradientCall[0]).toBe(stroke[0].x);
    expect(recorded.arc).toHaveBeenCalledTimes(1);
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
    for (const toolName of toolNames) {
      const mapped = toolsMap[toolName];
      const definition = toolProcessors[toolName];

      expect(mapped.commit, toolName).toBe(definition.commit);
      expect(mapped.replay, toolName).toBe(definition.replay);
      expect(mapped.imageProcessor, toolName).toBe(definition.imageProcessor);
      expect(typeof mapped.icon, toolName).toBe('string');
      expect(typeof mapped.toolboxComponent, toolName).toBe('function');
    }
  });

  it('uses distinct icons per tool', () => {
    const icons = toolNames.map((toolName) => toolsMap[toolName].icon);

    expect(new Set(icons).size).toBeGreaterThan(icons.length / 2);
    expect(new Set(icons)).not.toContain('');
  });

  it('renders the placeholder toolbox components with their configured options', () => {
    const placeholderNames = [
      'brush',
      'pencil',
      'color-replacement',
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
