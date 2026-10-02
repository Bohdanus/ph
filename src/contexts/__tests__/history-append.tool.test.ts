import { describe, expect, it } from 'vitest';

import { planHistoryAppend } from '../history-append.ts';
import type { DocumentFrame } from '../document-frame.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer } from '../layer-types.ts';
import { OPEN_DOCUMENT_ACTION, TOOL_ACTION } from '../../util/constants.ts';

const frame: DocumentFrame = { x: 0, y: 0, width: 400, height: 300 };

const layer: Layer = {
  id: 'layer-1',
  name: 'Layer 1',
  isBedrock: false,
  tmpCanvas: null,
  bitmap: null,
  visible: true,
  opacity: 1,
  locked: false,
  blendMode: 'source-over',
  order: 0,
  pos: { x: 0, y: 0, width: 100, height: 80 },
  source: {
    kind: 'blank',
    color: '#ffffff',
    opacity: 1,
    isBedrock: false,
    pos: { x: 0, y: 0, width: 100, height: 80 },
  },
  operations: [],
};

const baseline: HistoryItem = { id: 'baseline', actionName: OPEN_DOCUMENT_ACTION, layerId: 'layer-1' };

function plan(args: object, currentLayer: Layer | null = layer, id = 'tool') {
  const input = {
    item: { actionName: TOOL_ACTION, layerId: 'layer-1', args },
    timeline: { entries: [baseline], cursor: 0, branchRevision: 0 },
    currentFrame: frame,
    id,
    ...(currentLayer ? { currentLayer } : {}),
  } satisfies Parameters<typeof planHistoryAppend>[0];
  return planHistoryAppend(input);
}

describe('history append retained tool translation', () => {
  it.each([
    ['blur', { toolName: 'blur', radius: 4 }],
    ['color', { toolName: 'color', grayscale: 0.5 }],
    ['levels', { toolName: 'levels', brightness: 0.2, contrast: 0.8 }],
  ])('retains the %s filter with its processor version', (_label, args) => {
    const result = plan(args);

    expect(result.diagnostics).toEqual([]);
    expect(result.durableEntry?.operation).toMatchObject({
      kind: 'apply-filter',
      layerId: 'layer-1',
      filter: { toolName: args.toolName, version: 1, args },
    });
  });

  it('retains an affine transform using the live layer position for validation', () => {
    const result = plan({
      toolName: 'transform',
      transform: { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.durableEntry?.operation).toMatchObject({ kind: 'apply-affine-transform', layerId: 'layer-1' });
  });

  it('retains a trapezoid transform whose processor is declared affine-operation', () => {
    const result = plan({ toolName: 'transform', trapezoid: 20 });

    expect(result.diagnostics).toEqual([]);
    expect(result.durableEntry?.operation).toMatchObject({
      kind: 'apply-raster-processor',
      processorId: 'transform',
      version: 1,
    });
  });

  it.each([
    ['a raster-commit brush', { toolName: 'brush', color: '#123456', size: 4 }],
    ['a document-operation crop', { toolName: 'crop' }],
    ['a selection tool', { toolName: 'magic-wand' }],
    ['a reposition with no movement or resize', { toolName: 'reposition' }],
  ])('refuses %s without throwing', (_label, args) => {
    const result = plan(args);

    expect(result.durableEntry).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'unsupported-history-feature',
      severity: 'warning',
      actionName: TOOL_ACTION,
    });
  });

  it('refuses a mixed trapezoid and affine transform with an unsupported diagnostic', () => {
    const result = plan({ toolName: 'transform', trapezoid: 20, rotate: 5 });

    expect(result.durableEntry).toBeNull();
    expect(result.diagnostics[0]).toMatchObject({ code: 'unsupported-history-feature' });
    expect(result.diagnostics[0]?.message).toMatch(/Mixed trapezoid and affine transform is unsupported/);
  });

  it('refuses a tool action when the live layer is absent', () => {
    const result = plan({ toolName: 'blur', radius: 4 }, null);

    expect(result.durableEntry).toBeNull();
    expect(result.diagnostics[0]).toMatchObject({ code: 'unsupported-history-feature' });
    expect(result.diagnostics[0]?.message).toContain('layer-1');
  });

  it.each([
    { label: 'a raw retained transform', args: { toolName: 'transform', rotate: 15, resizeX: 125, resizeY: 90 } },
    {
      label: 'a normalized retained transform',
      args: { toolName: 'transform', transform: { a: 1, b: 0, c: 0, d: 1, e: 2, f: 3 } },
    },
    { label: 'a move', args: { toolName: 'reposition', move: { x: 12, y: 18 } } },
    { label: 'a resize', args: { toolName: 'reposition', resize: { x: 0, y: 0, width: 120, height: 90 } } },
  ])('parity matrix retains $label', ({ args }) => {
    const result = plan(args);

    expect(result.diagnostics).toEqual([]);
    expect(result.durableEntry).not.toBeNull();
  });
});
