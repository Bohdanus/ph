import { describe, expect, it } from 'vitest';

import { decideDurableAppend, planHistoryAppend, type AppendBoundaryResult } from '../history-append.ts';
import type { DocumentFrame } from '../document-frame.ts';
import type { DurableDocument, DurableHistoryEntry } from '../history-model.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer } from '../layer-types.ts';
import { transformToolArgsToAffine } from '../affine-transform.ts';
import type { TransformToolArgs } from '../../tools/transform.ts';
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
    ['brush', { toolName: 'brush', color: '#123456', size: 4 }],
    ['pencil', { toolName: 'pencil', color: '#123456', lineWidth: 3 }],
    ['sponge', { toolName: 'sponge', mode: 'desaturate', size: 4 }],
  ])('retains %s from canonical tool arguments without a bitmap snapshot', (_label, args) => {
    const result = plan(args);

    expect(result.diagnostics).toEqual([]);
    expect(result.durableEntry?.operation).toMatchObject({
      kind: 'apply-raster-processor',
      layerId: 'layer-1',
      processorId: args.toolName,
      version: 1,
      args,
    });
  });

  it('refuses a raster processor whose sparse array argument cannot survive durable cloning', () => {
    const lineDash: number[] = [];
    lineDash[0] = 4;
    lineDash[2] = 2;
    const result = plan({ toolName: 'brush', color: '#123456', size: 4, lineDash });

    expect(result.durableEntry).toBeNull();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'invalid-history-entry', severity: 'warning' })
    );
    expect(result.diagnostics[0]?.message).toContain('lineDash[1]');
  });

  it.each([
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

/**
 * The publication decision, not just the plan. A tool plan that validates is
 * worthless if the decision still grades it a mismatch, which is exactly what
 * main did: every one of these four kinds reached the fallthrough and was
 * reported as an untranslated action, which forced a full reconversion and an
 * error diagnostic on every raster-tool commit.
 */
const base = {
  documentId: 'tool-append-doc',
  documentRevision: 0,
  branchRevision: 0,
  durableRevision: 3,
  baseline: {
    frame,
    layers: [],
    selections: { selections: [], activeSelectionId: null },
    activeLayerId: null,
  },
  history: [],
  cursor: -1,
} as unknown as DurableDocument;

function decide(
  args: object,
  overrides: Readonly<{ planned?: DurableHistoryEntry | null; id?: string; layerId?: string }> = {}
) {
  const id = overrides.id ?? 'tool';
  const result: AppendBoundaryResult = planHistoryAppend({
    item: { actionName: TOOL_ACTION, layerId: overrides.layerId ?? 'layer-1', args },
    timeline: { entries: [baseline], cursor: 0, branchRevision: 0 },
    currentFrame: frame,
    currentLayer: layer,
    id,
  });
  const entry = result.entry;
  return decideDurableAppend({
    documentId: 'tool-append-doc',
    base,
    prior: { entries: [baseline], cursor: 0, branchRevision: 0 },
    next: { entries: [baseline, entry], cursor: 1, branchRevision: 0 },
    entry,
    planned: 'planned' in overrides ? (overrides.planned ?? null) : result.durableEntry,
    documentRevision: 0,
  });
}

function reasonFor(args: object, planned: DurableHistoryEntry | null): string {
  const decision = decide(args, { planned });
  return decision.outcome === 'mismatch' ? decision.reason : `unexpected outcome ${decision.outcome}`;
}

/**
 * A copy of the plan with one field rewritten, so the reason under test is the
 * only difference. `args` may be a DIFFERENT retainable append from the one being
 * graded: a legacy entry the boundary refuses has no plan of its own, and pairing
 * it with a hand-built operation is exactly the case these refusals exist for.
 */
type ToolOperation = NonNullable<DurableHistoryEntry['operation']>;
type ToolRewrite = (operation: ToolOperation) => ToolOperation;

function rewriteOperation(args: object, rewrite: ToolRewrite): DurableHistoryEntry {
  const planned = plan(args).durableEntry;
  if (!planned) throw new Error('the boundary refused the append under test');
  return { ...planned, operation: rewrite(planned.operation) };
}

/** Narrows the rewrite to one operation kind, so a rewrite cannot touch a field another kind owns. */
function rewriteNarrow<Op extends ToolOperation>(args: object, rewrite: (operation: Op) => ToolOperation) {
  return rewriteOperation(args, rewrite as ToolRewrite);
}

type FilterOperation = Extract<ToolOperation, { kind: 'apply-filter' }>;
type AffineOperation = Extract<ToolOperation, { kind: 'apply-affine-transform' }>;
type ProcessorOperation = Extract<ToolOperation, { kind: 'apply-raster-processor' }>;
type RepositionOperation = Extract<ToolOperation, { kind: 'reposition-layer' }>;

/** A plan carrying only the given kind, borrowed from a retainable append. */
function operationOfKind(kind: ToolOperation['kind']): DurableHistoryEntry {
  return rewriteOperation(
    { toolName: 'reposition', move: { x: 1, y: 2 } },
    () =>
      ({
        kind,
        layerId: 'layer-1',
      }) as ToolOperation
  );
}

describe('decideDurableAppend: retained tool operations', () => {
  it.each([
    ['an apply-filter', { toolName: 'blur', radius: 4 }],
    ['a colour apply-filter', { toolName: 'color', grayscale: 0.5 }],
    ['a levels apply-filter', { toolName: 'levels', brightness: 0.2, contrast: 0.8 }],
    ['a raw apply-affine-transform', { toolName: 'transform', rotate: 15, resizeX: 125, resizeY: 90 }],
    [
      'a normalized apply-affine-transform',
      { toolName: 'transform', transform: { a: 1, b: 0, c: 0, d: 1, e: 2, f: 3 } },
    ],
    ['a trapezoid apply-raster-processor', { toolName: 'transform', trapezoid: 20 }],
    ['a reposition move', { toolName: 'reposition', move: { x: 12, y: 18 } }],
    ['a reposition resize', { toolName: 'reposition', resize: { x: 0, y: 0, width: 120, height: 90 } }],
    [
      'a reposition that moves and resizes',
      { toolName: 'reposition', move: { x: 4, y: 5 }, resize: { x: 1, y: 2, width: 33, height: 44 } },
    ],
  ])('publishes %s the boundary planned', (_label, args) => {
    const decision = decide(args);

    expect(decision.outcome).toBe('published');
  });

  /**
   * The two copies of the affine rule — the boundary's independent re-derivation
   * here and `transformToolArgsToAffine` in the plan — pinned against each other.
   * A second implementation that drifts would report a writer defect for a
   * correct append, which is the exact failure this arm exists to stop, so the
   * matrix is what keeps the copy honest.
   */
  it.each([
    { toolName: 'transform' as const },
    { toolName: 'transform' as const, rotate: 30 },
    { toolName: 'transform' as const, rotate: -22.5, skewX: 12 },
    { toolName: 'transform' as const, resizeX: 140, resizeY: 60 },
    { toolName: 'transform' as const, mirrorH: true },
    { toolName: 'transform' as const, mirrorH: true, mirrorV: true, rotate: 17, skewY: -8 },
    { toolName: 'transform' as const, rotate: 45, skewX: 30, skewY: -30, resizeX: 175, resizeY: 55 },
  ])('grades the raw transform arguments %j against the derivation', (args) => {
    // Proves the fixture itself is retainable, so a rejection below is the
    // validator's answer rather than `translate` having refused the append.
    expect(
      transformToolArgsToAffine({ ...args, trapezoid: 0 } as unknown as TransformToolArgs, layer.pos)
    ).not.toBeNull();
    expect(plan(args).durableEntry?.operation.kind).toBe('apply-affine-transform');

    expect(decide(args).outcome).toBe('published');
  });
});

describe('decideDurableAppend: a wrong retained tool operation is still refused', () => {
  // Hoisted and typed rather than inlined: `it.each` gives an inline tuple's
  // arrow function no contextual type, and a rewrite parameter silently typed
  // `any` would let a rewrite that touches the wrong field pass unnoticed.
  const FILTERS: readonly (readonly [string, object, (operation: FilterOperation) => ToolOperation, string])[] = [
    [
      'naming another tool',
      { toolName: 'blur', radius: 4 },
      (operation) => ({ ...operation, filter: { ...operation.filter, toolName: 'levels' } }),
      'the durable filter tool name does not match the legacy entry',
    ],
    [
      'on a stale processor version',
      { toolName: 'blur', radius: 4 },
      (operation) => ({ ...operation, filter: { ...operation.filter, version: 99 } }),
      'the durable filter version does not match the registered processor',
    ],
    [
      'with rewritten arguments',
      { toolName: 'blur', radius: 4 },
      (operation) => ({ ...operation, filter: { ...operation.filter, args: { toolName: 'blur', radius: 40 } } }),
      'the durable filter arguments do not match the legacy entry',
    ],
    [
      'on another layer',
      { toolName: 'blur', radius: 4 },
      (operation) => ({ ...operation, layerId: 'layer-2' }),
      'the durable layer id does not match the legacy entry',
    ],
    [
      'carrying an extra operation field',
      { toolName: 'blur', radius: 4 },
      (operation) => ({ ...operation, blendMode: 'multiply' }),
      'the durable apply-filter operation does not have the canonical shape',
    ],
    [
      'whose filter carries an extra field',
      { toolName: 'blur', radius: 4 },
      (operation) => ({
        ...operation,
        filter: { ...operation.filter, toolName: 'blur', version: 1, args: operation.filter.args, opacity: 1 },
      }),
      'the durable filter does not have the canonical shape',
    ],
  ];

  const AFFINES: readonly (readonly [string, object, (operation: AffineOperation) => ToolOperation, string])[] = [
    [
      'whose matrix was rewritten',
      { toolName: 'transform', transform: { a: 1, b: 0, c: 0, d: 1, e: 2, f: 3 } },
      (operation) => ({ ...operation, transform: { a: 2, b: 0, c: 0, d: 2, e: 2, f: 3 } }),
      'the durable affine transform does not match the retained transform',
    ],
    [
      'whose translation was rewritten',
      { toolName: 'transform', transform: { a: 1, b: 0, c: 0, d: 1, e: 2, f: 3 } },
      (operation) => ({ ...operation, transform: { ...operation.transform, f: 30 } }),
      'the durable affine transform does not match the retained transform',
    ],
    [
      'whose linear block came from other arguments',
      { toolName: 'transform', rotate: 15, resizeX: 125, resizeY: 90 },
      (operation) => ({ ...operation, transform: { ...operation.transform, d: 1 } }),
      'the durable affine linear block does not match the retained transform arguments',
    ],
    [
      'whose linear block was mirrored',
      { toolName: 'transform', rotate: 15, resizeX: 125, resizeY: 90 },
      (operation) => ({ ...operation, transform: { ...operation.transform, a: -operation.transform.a } }),
      'the durable affine linear block does not match the retained transform arguments',
    ],
    [
      'on another layer',
      { toolName: 'transform', rotate: 15, resizeX: 125, resizeY: 90 },
      (operation) => ({ ...operation, layerId: 'layer-2' }),
      'the durable layer id does not match the legacy entry',
    ],
  ];

  const PROCESSORS: readonly (readonly [string, object, (operation: ProcessorOperation) => ToolOperation, string])[] = [
    [
      'naming another processor',
      { toolName: 'transform', trapezoid: 20 },
      (operation) => ({ ...operation, processorId: 'brush' }),
      'the durable processor id does not match the legacy entry',
    ],
    [
      'on a stale version',
      { toolName: 'transform', trapezoid: 20 },
      (operation) => ({ ...operation, version: 7 }),
      'the durable processor version does not match the registered processor',
    ],
    [
      'with rewritten arguments',
      { toolName: 'transform', trapezoid: 20 },
      (operation) => ({ ...operation, args: { toolName: 'transform', trapezoid: 40 } }),
      'the durable processor arguments do not match the legacy entry',
    ],
    [
      'carrying an extra operation field',
      { toolName: 'transform', trapezoid: 20 },
      (operation) => ({ ...operation, opacity: 1 }),
      'the durable apply-raster-processor operation does not have the canonical shape',
    ],
  ];

  const REPOSITIONS: readonly (readonly [string, object, (operation: RepositionOperation) => ToolOperation, string])[] =
    [
      [
        'whose move was rewritten',
        { toolName: 'reposition', move: { x: 12, y: 18 } },
        (operation) => ({ ...operation, move: { x: 120, y: 180 } }),
        'the durable reposition movement does not match the legacy entry',
      ],
      [
        'that dropped its move',
        { toolName: 'reposition', move: { x: 12, y: 18 }, resize: { x: 0, y: 0, width: 30, height: 40 } },
        (operation) => ({ ...operation, move: undefined }),
        'the durable reposition movement does not match the legacy entry',
      ],
      [
        'that invented a resize',
        { toolName: 'reposition', move: { x: 12, y: 18 } },
        (operation) => ({ ...operation, resize: { x: 0, y: 0, width: 30, height: 40 } }),
        'the durable reposition operation does not have the canonical shape',
      ],
      [
        'whose resize was rewritten',
        { toolName: 'reposition', resize: { x: 0, y: 0, width: 120, height: 90 } },
        (operation) => ({ ...operation, resize: { x: 0, y: 0, width: 12, height: 9 } }),
        'the durable reposition resize does not match the legacy entry',
      ],
      [
        'on another layer',
        { toolName: 'reposition', move: { x: 12, y: 18 } },
        (operation) => ({ ...operation, layerId: 'layer-2' }),
        'the durable layer id does not match the legacy entry',
      ],
    ];

  it.each(FILTERS)('refuses an apply-filter %s', (_label, args, rewrite, reason) => {
    expect(reasonFor(args, rewriteNarrow<FilterOperation>(args, rewrite))).toBe(reason);
  });

  it.each(AFFINES)('refuses an apply-affine-transform %s', (_label, args, rewrite, reason) => {
    expect(reasonFor(args, rewriteNarrow<AffineOperation>(args, rewrite))).toBe(reason);
  });

  it.each(PROCESSORS)('refuses an apply-raster-processor %s', (_label, args, rewrite, reason) => {
    expect(reasonFor(args, rewriteNarrow<ProcessorOperation>(args, rewrite))).toBe(reason);
  });

  it.each(REPOSITIONS)('refuses a reposition-layer %s', (_label, args, rewrite, reason) => {
    expect(reasonFor(args, rewriteNarrow<RepositionOperation>(args, rewrite))).toBe(reason);
  });

  it.each([
    ['a filter entry published as a reposition', { toolName: 'blur', radius: 4 }, 'reposition-layer'],
    ['a move entry published as a filter', { toolName: 'reposition', move: { x: 1, y: 2 } }, 'apply-filter'],
    ['a transform entry published as a filter', { toolName: 'transform', rotate: 5 }, 'apply-filter'],
    ['a trapezoid entry published as an affine', { toolName: 'transform', trapezoid: 20 }, 'apply-affine-transform'],
  ] as const)('refuses %s', (_label, args, kind) => {
    expect(reasonFor(args, operationOfKind(kind))).toBe(`a tool action produced a "${kind}" operation`);
  });

  it.each([
    ['a document-operation crop', { toolName: 'crop' }],
    ['a selection tool', { toolName: 'magic-wand' }],
    ['a reposition that moved nothing', { toolName: 'reposition' }],
  ] as const)('refuses %s, which the legacy args publish no operation for', (_label, args) => {
    // The kind check cannot run for these: the independent rule reads the legacy
    // args and finds no retained translation at all, so naming the tool is the
    // whole answer and a plan's kind is beside the point.
    expect(reasonFor(args, operationOfKind('apply-filter'))).toBe(
      `no retained durable translation is published for the tool action on "${args.toolName}" yet`
    );
  });

  it('accepts a raster-processor plan when its canonical legacy args match', () => {
    const args = { toolName: 'sponge', mode: 'desaturate', size: 4 };
    const planned = {
      ...rewriteNarrow<ProcessorOperation>({ toolName: 'transform', trapezoid: 20 }, () => ({
        kind: 'apply-raster-processor',
        layerId: 'layer-1',
        processorId: 'sponge',
        version: 1,
        args,
      })),
      provenance: { actionName: TOOL_ACTION, toolName: 'sponge' } as const,
    };

    expect(decide(args, { planned }).outcome).toBe('published');
  });

  it('refuses a valid raster-processor operation whose provenance does not match the legacy entry', () => {
    const args = { toolName: 'sponge', mode: 'desaturate', size: 4 };
    const planned = {
      ...rewriteNarrow<ProcessorOperation>({ toolName: 'transform', trapezoid: 20 }, () => ({
        kind: 'apply-raster-processor',
        layerId: 'layer-1',
        processorId: 'sponge',
        version: 1,
        args,
      })),
      provenance: { actionName: TOOL_ACTION, toolName: 'transform' } as const,
    };

    expect(reasonFor(args, planned)).toBe('the durable history provenance does not match the legacy entry');
  });

  it('refuses a trapezoid whose legacy args also carry affine values', () => {
    const planned = rewriteOperation({ toolName: 'transform', trapezoid: 20 }, (operation) => operation);

    expect(reasonFor({ toolName: 'transform', trapezoid: 20, rotate: 5 }, planned)).toBe(
      'no retained durable translation is published for the tool action on "transform" yet'
    );
  });

  it('refuses a tool entry whose arguments name no tool', () => {
    const planned = rewriteOperation({ toolName: 'blur', radius: 4 }, (operation) => operation);

    expect(reasonFor({ radius: 4 }, planned)).toBe('a tool action carries no readable tool arguments');
  });
});
