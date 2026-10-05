import { describe, expect, it, vi } from 'vitest';

import { replayDurableDocument } from '../durable-replay.ts';
import { planHistoryAppend } from '../history-append.ts';
import { legacyHistoryToDurable, operationForTool, UnsupportedHistoryFeatureError } from '../history-adapter.ts';
import { replayHistory, type HistoryReplayDependencies } from '../history-replay.ts';
import type { DurableLayerSnapshot } from '../history-model.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayerSource } from '../layer-types.ts';
import {
  PIXEL_FREE_TOOLS,
  toolProcessors,
  type ToolCommitKind,
  type ToolReplayKind,
} from '../../tools/toolProcessors.ts';
import { defaultSettings } from '../../tools/settings.ts';
import { OPEN_DOCUMENT_ACTION, TOOL_ACTION } from '../../util/constants.ts';

const layerId = 'layer-1';
const size = { width: 400, height: 300 };
const frame = { x: 0, y: 0, width: 400, height: 300 };

function layer(): Layer {
  const pos = { x: 20, y: 30, width: 120, height: 80 };
  const source: Extract<LayerSource, { kind: 'blank' }> = {
    kind: 'blank',
    color: '#ffffff',
    opacity: 1,
    isBedrock: false,
    pos,
  };
  return {
    id: layerId,
    name: 'Layer',
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos,
    source,
    operations: [],
  };
}

function history(noOp: HistoryItem): HistoryItem[] {
  return [
    {
      id: 'baseline',
      actionName: OPEN_DOCUMENT_ACTION,
      layerId,
      documentSource: { layers: { [layerId]: layer() }, size, frame },
    },
    noOp,
  ];
}

function dependencies(applyRasterTool: HistoryReplayDependencies['applyRasterTool']): HistoryReplayDependencies {
  return {
    createLayer: ({ layerId: id, layers, source }) => ({
      id,
      name: id,
      isBedrock: Boolean(source.isBedrock),
      tmpCanvas: null,
      bitmap: source.kind === 'image' ? source.bitmap : null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: Object.values(layers).length,
      pos: 'pos' in source ? { ...source.pos } : { x: 0, y: 0, width: source.size.width, height: source.size.height },
      source,
      operations: [],
    }),
    applyRasterTool,
  };
}

describe('durable tool-action invariant', () => {
  it('leaves a geometry tool with no patch untouched on both replay paths', () => {
    const noOp: HistoryItem = {
      id: 'reposition-without-patch',
      actionName: TOOL_ACTION,
      layerId,
      args: { toolName: 'reposition' },
    };
    const timeline = history(noOp);
    const before = structuredClone(noOp);
    const converted = legacyHistoryToDurable(timeline, { documentId: 'tool-action-invariant' });
    const applyRasterTool = vi.fn((currentLayer: Layer) => currentLayer);
    const legacy = replayHistory(timeline, 1, size, dependencies(applyRasterTool), frame);
    const durableCursor = converted.legacyCursorToDurableCursor[1];
    const durable = replayDurableDocument(converted.document, durableCursor);

    expect(operationForTool(noOp, converted.document.baseline.layers[0]!)).toBeNull();
    expect(noOp).toEqual(before);
    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history).toHaveLength(0);
    expect(converted.legacyCursorToDurableCursor).toEqual([-1, -1]);
    expect(legacy.layers[layerId]?.pos).toEqual({ x: 20, y: 30, width: 120, height: 80 });
    expect(durable.layers[layerId]?.snapshot.pos).toEqual(legacy.layers[layerId]?.pos);
    expect(applyRasterTool).not.toHaveBeenCalled();
  });
});

/**
 * The registry-wide half of the same rule. The test above pins ONE geometry tool by name,
 * which leaves every other entry of `toolProcessors` unpinned: a tool can be wired to
 * the wrong `commit` kind, or its `commit` to the wrong `replay.kind`, or be left with
 * neither a per-layer operation nor a refusal, and every other suite stays green because
 * each of them names a single tool.
 *
 * These two tables are the whole contract, and both are exhaustive by construction: the
 * `Record<ToolCommitKind, ...>` annotation is a compile error if a kind is added to the
 * union without a row here, and the runtime count check below catches the reverse.
 */

/** The one commit kind whose replay kind is spelled differently, and why. */
const REPLAY_KIND_FOR_COMMIT: Record<ToolCommitKind, ToolReplayKind> = {
  geometry: 'geometry',
  'layer-operation': 'layer-operation',
  'affine-operation': 'affine-operation',
  'document-operation': 'document-operation',
  source: 'source',
  selection: 'selection',
  // `raster` is the only rename: a raster tool commits a patched bitmap, and the replay
  // side names the mechanism rather than the tool class.
  raster: 'raster-processor',
  unimplemented: 'unimplemented',
};

/**
 * What `operationForTool` owes the timeline for each commit kind, as an EXACT outcome
 * rather than a "may be either".
 *
 * `'declines'` means it returns nothing. `'refuses'` means it throws
 * `UnsupportedHistoryFeatureError`. Naming which of the two each kind owes is the whole
 * point: an earlier version of this table used `null` for all four kinds that owe no
 * operation and accepted EITHER outcome, which made the arm unfalsifiable — `planned` is
 * initialised to `null`, so a tool that threw a plain `TypeError` from a renamed field
 * satisfied "planned is null" without the refusal ever being checked. `unimplemented` in
 * particular must REFUSE, because a quiet `null` there is the silent drop that comment used
 * to warn about while the assertion permitted it.
 */
const OUTCOME_FOR_COMMIT: Record<ToolCommitKind, string | 'declines' | 'refuses'> = {
  geometry: 'reposition-layer',
  'layer-operation': 'apply-filter',
  'affine-operation': 'apply-affine-transform',
  raster: 'apply-raster-processor',
  // A creator commits a whole new layer rather than an edit to this one, and this planner
  // is only ever asked about a layer that already exists — so there is no per-layer
  // operation to plan and the honest answer is to say so rather than invent one.
  source: 'refuses',
  // A document crop moves the document and a selection moves the selection; neither is a
  // per-layer edit, and both are handled outside this planner.
  'document-operation': 'declines',
  selection: 'declines',
  // Nothing is owed AND nothing may be invented: refusing is the only honest answer, and a
  // quiet `null` here would be a silent drop of the tool action.
  unimplemented: 'refuses',
};

/** Args that name a tool and give its commit kind the field it reads. */
function argsFor(toolName: string): Record<string, unknown> {
  switch (toolName) {
    case 'blur':
      return { ...defaultSettings.blur };
    case 'color':
      return { ...defaultSettings.color };
    case 'levels':
      return { ...defaultSettings.levels };
    case 'transform':
      // The stored defaults are all identity, and an identity transform plans nothing.
      // A real rotation is what makes this kind owe an operation.
      return { ...defaultSettings.transform, rotate: 15 };
    case 'crop':
      return { ...defaultSettings.crop };
    case 'reposition':
      // Geometry is the one kind that reads a patch OUT of its args, so a bare
      // `{ toolName }` legitimately plans nothing and would read as a missing
      // operation. The sweep has to carry the patch; the no-patch half is the
      // dedicated test below.
      return { toolName, move: { x: 4, y: 8 } };
    default:
      return { toolName };
  }
}

function toolItem(toolName: string): HistoryItem {
  return { id: `tool-${toolName}`, actionName: TOOL_ACTION, layerId, args: argsFor(toolName) };
}

function snapshot(): DurableLayerSnapshot {
  return legacyHistoryToDurable(
    history({
      id: 'baseline',
      actionName: OPEN_DOCUMENT_ACTION,
      layerId,
      documentSource: { layers: { [layerId]: layer() }, size, frame },
    }),
    {
      documentId: 'registry-invariant',
    }
  ).document.baseline.layers[0]!;
}

const registry = Object.entries(toolProcessors);

describe('tool processor registry invariants', () => {
  it('covers every commit kind in both tables, so a new kind cannot arrive unwired', () => {
    expect(Object.keys(REPLAY_KIND_FOR_COMMIT).sort()).toEqual(
      [
        'affine-operation',
        'document-operation',
        'geometry',
        'layer-operation',
        'raster',
        'selection',
        'source',
        'unimplemented',
      ].sort()
    );
    expect(Object.keys(OUTCOME_FOR_COMMIT).sort()).toEqual(Object.keys(REPLAY_KIND_FOR_COMMIT).sort());
  });

  it('registers at least one tool for every commit kind, so no row above is aspirational', () => {
    const seen = new Set(Object.values(toolProcessors).map((definition) => definition.commit));
    expect([...seen].sort()).toEqual(Object.keys(REPLAY_KIND_FOR_COMMIT).sort());
  });

  it.each(registry)('pairs %s with the replay kind its commit kind promises', (_toolName, definition) => {
    expect(definition.replay.kind).toBe(REPLAY_KIND_FOR_COMMIT[definition.commit]);
  });

  it.each(registry)('%s produces exactly the outcome its commit kind owes', (toolName, definition) => {
    const owed = OUTCOME_FOR_COMMIT[definition.commit];
    let planned: string | null = null;
    let refused: string | null = null;
    try {
      planned = operationForTool(toolItem(toolName), snapshot())?.kind ?? null;
    } catch (error) {
      refused = error instanceof UnsupportedHistoryFeatureError ? error.code : `unexpected ${String(error)}`;
    }

    if (owed === 'declines') {
      expect(refused).toBeNull();
      expect(planned).toBeNull();
    } else if (owed === 'refuses') {
      expect(planned).toBeNull();
      expect(refused).toBe('unsupported-history-feature');
    } else {
      expect(refused).toBeNull();
      expect(planned).toBe(owed);
    }
  });

  it.each(PIXEL_FREE_TOOLS)(
    'refuses %s by name, because a tool that commits no pixels owns no operation',
    (toolName) => {
      expect(toolProcessors).not.toHaveProperty(toolName);
      expect(() => operationForTool(toolItem(toolName), snapshot())).toThrow(UnsupportedHistoryFeatureError);
    }
  );

  it('plans a geometry operation only once the args carry the patch it reads', () => {
    const layer = snapshot();
    expect(
      operationForTool({ id: 'bare', actionName: TOOL_ACTION, layerId, args: { toolName: 'reposition' } }, layer)
    ).toBeNull();
    expect(operationForTool(toolItem('reposition'), layer)).toMatchObject({
      kind: 'reposition-layer',
      move: { x: 4, y: 8 },
    });
  });
});

/**
 * The two boundaries that translate one `TOOL_ACTION`, pinned against each other on the two
 * conditions that used to answer differently.
 *
 * `operationForTool` serves the CONVERSION path (`legacyHistoryToDurable`), and
 * `planHistoryAppend` serves the LIVE path, so a rule one of them honours and the other does not
 * means the same timeline converts one way and is appended another — with the durable document as
 * a navigation cache, that is a shadow whose contents depend on how the edit arrived rather than
 * on what it was.
 */
describe('durable agreement between the conversion and append boundaries', () => {
  const strokeFrame = { x: -16, y: -16, width: 64, height: 64 };

  /** The stroke form of a tool the registry declares `strokeShaped`, over its own defaults. */
  const strokeArgsFor = (toolName: 'blur' | 'sharpen' | 'smudge'): Record<string, unknown> => ({
    ...(defaultSettings[toolName] as Record<string, unknown>),
    toolName,
    points: [
      { x: 4, y: 4 },
      { x: 12, y: 4 },
    ],
    rasterBounds: strokeFrame,
  });

  const strokeShapedTools = ['blur', 'sharpen', 'smudge'] as const;

  /** What the LIVE append boundary would publish for these arguments, or its refusal. */
  const plannedByAppend = (args: Record<string, unknown>) =>
    planHistoryAppend({
      item: { actionName: TOOL_ACTION, layerId, args },
      timeline: {
        entries: [{ id: 'baseline', actionName: OPEN_DOCUMENT_ACTION, layerId }],
        cursor: 0,
        branchRevision: 0,
      },
      currentFrame: frame,
      currentLayer: layer(),
      id: 'tool-stroke',
    });

  it.each(strokeShapedTools)(
    'translates a stroked %s as a raster processor on BOTH boundaries, not by its commit kind',
    (toolName) => {
      const args = strokeArgsFor(toolName);
      const item: HistoryItem = { id: 'stroke', actionName: TOOL_ACTION, layerId, args };
      // The whole-layer form of the same tool, which the commit-kind table above already covers, is
      // what this pair must NOT produce: `blur` owes `apply-filter` as a `layer-operation`, so a
      // stroke silently reclassified by commit kind would replay the brush as a whole-layer blur.
      const converted = operationForTool(item, snapshot());
      const appended = plannedByAppend(args);

      expect(converted).toMatchObject({ kind: 'apply-raster-processor', layerId, processorId: toolName });
      expect(converted).not.toMatchObject({ kind: 'apply-filter' });
      expect(appended.diagnostics).toEqual([]);
      expect(appended.durableEntry?.operation).toEqual(converted);
    }
  );

  it('refuses a raster processor that does not composite onto its input on BOTH boundaries', () => {
    // No registered tool declares `compositesOntoInput: false` — `tool-processors.test.ts` forbids
    // it, because every processor today reads the layer's pixels. The field is still read by both
    // boundaries, so it has to be LIVE in both: a raster created from a processor's own stroke
    // cannot be replayed from the durable layer source, and whichever boundary published it anyway
    // would hand materialization an operation it cannot honour.
    const definition = toolProcessors.gradient;
    expect(definition.compositesOntoInput).toBeUndefined();
    definition.compositesOntoInput = false;

    try {
      const args = { ...defaultSettings.gradient, toolName: 'gradient' };
      const item: HistoryItem = { id: 'own-raster', actionName: TOOL_ACTION, layerId, args };
      const appended = plannedByAppend(args as Record<string, unknown>);

      expect(() => operationForTool(item, snapshot())).toThrow(UnsupportedHistoryFeatureError);
      expect(appended.durableEntry).toBeNull();
      expect(appended.diagnostics).toEqual([
        expect.objectContaining({
          historyId: 'tool-stroke',
          code: 'unsupported-history-feature',
          severity: 'warning',
        }),
      ]);
    } finally {
      delete definition.compositesOntoInput;
    }
  });
});
