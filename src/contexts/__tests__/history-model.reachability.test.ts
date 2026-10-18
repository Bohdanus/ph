import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { IDENTITY_AFFINE_TRANSFORM } from '../affine-transform.ts';
import {
  DURABLE_SCHEMA_VERSION,
  collectDurableAssetIds,
  type AssetId,
  type DurableDocument,
  type DurableHistoryEntry,
  type DurableLayerSnapshot,
  type DurableLayerSource,
  type DurableOperation,
} from '../history-model.ts';

function assetId(value: string): AssetId {
  return value as AssetId;
}

function rasterSource(id: string): DurableLayerSource {
  return { kind: 'raster', assetId: assetId(id), width: 8, height: 6 };
}

const blankSource: DurableLayerSource = {
  kind: 'blank',
  color: '#ffffff',
  opacity: 1,
  size: { width: 8, height: 6 },
};

const vectorSource: DurableLayerSource = {
  kind: 'vector',
  toolName: 'ellipse',
  args: { color: '#ff0000' },
  size: { width: 8, height: 6 },
  sourcePos: { x: 0, y: 0, width: 8, height: 6 },
};

const textSource: DurableLayerSource = {
  kind: 'text',
  toolName: 'text',
  args: { text: 'hello' },
  size: { width: 8, height: 6 },
  sourcePos: { x: 0, y: 0, width: 8, height: 6 },
};

const legacyToolSource: DurableLayerSource = {
  kind: 'legacy-tool',
  toolName: 'shape',
  args: { figure: 'polygon' },
  size: { width: 8, height: 6 },
};

function layer(id: string, source: DurableLayerSource): DurableLayerSnapshot {
  return {
    id,
    name: id,
    isBedrock: false,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos: { x: 0, y: 0, width: 8, height: 6 },
    source,
  };
}

function entry(id: string, operation: DurableOperation, enabled = true): DurableHistoryEntry {
  return { id, schemaVersion: DURABLE_SCHEMA_VERSION, enabled, operation };
}

function createLayerEntry(
  id: string,
  layerId: string,
  source: DurableLayerSource,
  enabled = true
): DurableHistoryEntry {
  return entry(id, { kind: 'create-layer', layer: layer(layerId, source) }, enabled);
}

function mergeDocumentEntry(
  id: string,
  layerId: string,
  source: DurableLayerSource,
  enabled = true
): DurableHistoryEntry {
  return entry(
    id,
    { kind: 'merge-document', result: layer(layerId, source), removedLayerIds: ['layer-merged-away'] },
    enabled
  );
}

function durableDocument(
  baselineLayers: readonly DurableLayerSnapshot[],
  history: readonly DurableHistoryEntry[],
  cursor = history.length - 1
): DurableDocument {
  return {
    documentId: 'document-a',
    documentRevision: 3,
    branchRevision: 1,
    durableRevision: history.length,
    baseline: {
      frame: { x: 0, y: 0, width: 100, height: 100 },
      layers: baselineLayers,
      selections: { selections: [], activeSelectionId: null },
      activeLayerId: null,
    },
    history,
    cursor,
  };
}

describe('collectDurableAssetIds', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('collects baseline raster asset ids and ignores every other source kind', () => {
    const document = durableDocument(
      [
        layer('layer-raster', rasterSource('asset-baseline')),
        layer('layer-blank', blankSource),
        layer('layer-vector', vectorSource),
        layer('layer-text', textSource),
        layer('layer-legacy', legacyToolSource),
      ],
      []
    );

    const ids = collectDurableAssetIds(document);

    expect([...ids]).toEqual(['asset-baseline']);
  });

  it('collects the baseline asset plus every asset-bearing operation result', () => {
    const document = durableDocument(
      [layer('layer-baseline', rasterSource('asset-baseline'))],
      [
        createLayerEntry('entry-create', 'layer-created', rasterSource('asset-created')),
        mergeDocumentEntry('entry-merge', 'layer-merged', rasterSource('asset-merged')),
      ]
    );

    // Each operation kind contributes its own asset, and the baseline asset is
    // collected alongside them rather than instead of them.
    const ids = collectDurableAssetIds(document);

    expect([...ids].sort()).toEqual(['asset-baseline', 'asset-created', 'asset-merged']);
  });

  it('ignores operations that do not carry a raster layer snapshot', () => {
    const frame = { x: 0, y: 0, width: 100, height: 100 };
    const document = durableDocument(
      [layer('layer-baseline', rasterSource('asset-baseline'))],
      [
        entry('entry-remove', { kind: 'remove-layer', layerId: 'layer-baseline' }),
        entry('entry-properties', {
          kind: 'set-layer-properties',
          layerId: 'layer-baseline',
          patch: { name: 'renamed', visible: false },
        }),
        entry('entry-reposition', {
          kind: 'reposition-layer',
          layerId: 'layer-baseline',
          move: { x: 1, y: 2 },
        }),
        entry('entry-reorder', { kind: 'reorder-layers', orderByLayerId: { 'layer-baseline': 2 } }),
        entry('entry-filter', {
          kind: 'apply-filter',
          layerId: 'layer-baseline',
          filter: { toolName: 'blur', version: 1, args: { radius: 2 } },
        }),
        entry('entry-affine', {
          kind: 'apply-affine-transform',
          layerId: 'layer-baseline',
          transform: IDENTITY_AFFINE_TRANSFORM,
        }),
        entry('entry-processor', {
          kind: 'apply-raster-processor',
          layerId: 'layer-baseline',
          processorId: 'levels',
          version: 1,
          args: { gamma: 1 },
        }),
        entry('entry-frame', { kind: 'set-document-frame', previous: frame, next: frame }),
        entry('entry-selection', {
          kind: 'set-selection',
          before: { selections: [], activeSelectionId: null },
          after: { selections: [], activeSelectionId: null },
        }),
        // An asset-bearing operation kind contributes nothing when its result
        // is not a raster source.
        mergeDocumentEntry('entry-merge-vector', 'layer-vector-result', vectorSource),
      ]
    );

    const ids = collectDurableAssetIds(document);

    expect([...ids]).toEqual(['asset-baseline']);
  });

  it('retains assets referenced only by redo entries after the cursor', () => {
    const baseline = [layer('layer-baseline', rasterSource('asset-baseline'))];
    const history = [
      createLayerEntry('entry-create', 'layer-created', rasterSource('asset-created')),
      mergeDocumentEntry('entry-merge', 'layer-merged', rasterSource('asset-merged')),
    ];

    const undone = collectDurableAssetIds(durableDocument(baseline, history, 0));
    const fullyApplied = collectDurableAssetIds(durableDocument(baseline, history, history.length - 1));

    // Cursor position is intentionally ignored: undo must keep the assets the
    // redo entries need, so an undone document reaches exactly the same ids.
    expect([...undone].sort()).toEqual(['asset-baseline', 'asset-created', 'asset-merged']);
    expect([...undone].sort()).toEqual([...fullyApplied].sort());
  });

  it('returns an empty set for a document without layers and without history', () => {
    const ids = collectDurableAssetIds(durableDocument([], []));

    expect(ids).toBeInstanceOf(Set);
    expect(ids.size).toBe(0);
  });

  it('deduplicates an asset referenced by the baseline and by many entries', () => {
    const document = durableDocument(
      [
        layer('layer-1', rasterSource('asset-shared')),
        layer('layer-2', rasterSource('asset-shared')),
        layer('layer-3', rasterSource('asset-other')),
      ],
      [
        createLayerEntry('entry-create-1', 'layer-a', rasterSource('asset-shared')),
        createLayerEntry('entry-create-2', 'layer-b', rasterSource('asset-shared')),
        mergeDocumentEntry('entry-merge', 'layer-d', rasterSource('asset-shared')),
      ]
    );

    const ids = collectDurableAssetIds(document);

    expect(ids.size).toBe(2);
    expect(ids.has(assetId('asset-shared'))).toBe(true);
    expect(ids.has(assetId('asset-other'))).toBe(true);
  });

  it('retains assets of disabled entries so re-enabling never needs a new baseline', () => {
    const document = durableDocument(
      [],
      [
        createLayerEntry('entry-create', 'layer-created', rasterSource('asset-created'), false),
        mergeDocumentEntry('entry-merge', 'layer-merged', rasterSource('asset-merged'), false),
      ]
    );

    const ids = collectDurableAssetIds(document);

    expect([...ids].sort()).toEqual(['asset-created', 'asset-merged']);
  });
});

/**
 * One top-level function's text, from its `export function` line to the next one.
 * Deliberately not a brace matcher: these assertions are about which `case` labels
 * a specific switch names, and a span that escaped its function would let a
 * sibling function satisfy them.
 */
function functionBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  expect(start, `${declaration} is missing from the source under test`).toBeGreaterThan(-1);
  const next = source.indexOf('\nexport ', start + declaration.length);
  return source.slice(start, next === -1 ? undefined : next);
}

/**
 * A durable kind that nothing can see is not a gap a reviewer will notice: the
 * union grows, every existing test stays green, and the shadow goes on reporting
 * `status: 'current'` while quietly mis-replaying. Both switches below are
 * therefore closed with a `never` arm, and this asserts the closure rather than
 * the intent — a kind added to `DurableOperation` without a replay arm and
 * without an asset classification must fail `tsc`, and it is a typecheck error,
 * so this is the tripwire for a future edit that removes an arm.
 *
 * It pins the SOURCE, not a runtime behaviour, because the failure it exists to
 * prevent never reaches runtime: the arms are unreachable as long as every kind
 * is handled.
 */
describe('durable operation kind exhaustiveness', () => {
  const REACHES_EVERY_KIND =
    /case '(create-layer|remove-layer|set-layer-properties|reposition-layer|reorder-layers|apply-filter|apply-affine-transform|apply-raster-processor|set-document-frame|transform-document|replace-layer-source|merge-document|set-selection)'/g;
  const ASSET_FREE_KINDS = [
    'remove-layer',
    'set-layer-properties',
    'reposition-layer',
    'reorder-layers',
    'apply-filter',
    'apply-affine-transform',
    'apply-raster-processor',
    'set-document-frame',
    'transform-document',
    'replace-layer-source',
    'set-selection',
  ];

  it('names every declared kind in the durable replay switch, with a never arm', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../durable-replay.ts'), 'utf8');
    // Bounded to `replayDurableDocument`. Slicing to end-of-file would let a `case` in
    // any later function satisfy an assertion about this switch, which is how an
    // assertion stops testing the thing it names.
    const body = functionBody(source, 'export function replayDurableDocument');
    const named = [...body.matchAll(REACHES_EVERY_KIND)].map((match) => match[1]);

    // Every kind in the union reaches a replay arm, and each is named once — a
    // duplicate means an arm was copied rather than classified.
    expect([...new Set(named)].sort()).toEqual([...KIND_NAMES].sort());
    expect(named).toHaveLength(new Set(named).size);
    // And the switch closes rather than falling off its end, which is what turns
    // a new kind from a silent no-op into a typecheck error.
    expect(body).toContain('const _exhaustive: never = operation;');
  });

  it('classifies every declared kind in the asset scan, with a never arm', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../history-model.ts'), 'utf8');
    // Bounded, and this bound is load-bearing rather than tidy: `cloneOperation`
    // also spells out `case 'set-selection':` and every other kind, so a body that
    // ran to end-of-file would find all of them there and pass with this switch
    // stripped to nothing.
    const body = functionBody(source, 'export function collectDurableAssetIds');

    // The two kinds that carry a bitmap, and the eleven that provably do not. A new
    // kind has to be placed on one side or the other deliberately.
    expect(body).toContain("case 'create-layer':");
    expect(body).toContain("case 'merge-document':");
    for (const kind of ASSET_FREE_KINDS) {
      expect(body).toContain(`case '${kind}':`);
    }
    expect(body).toContain('const _exhaustive: never = kind;');
  });

  it('declares exactly the kinds the DurableOperation union declares', () => {
    // The two guards above are only as good as this list, and a hand-written list
    // is not tied to the union at all: adding a kind to `DurableOperation` leaves
    // this file untouched, so a count assertion over a literal can never notice —
    // which is what `expect(KIND_NAMES).toHaveLength(11)` was, and it passed for
    // every union it was supposed to police while its comment claimed otherwise.
    // Typing the map as `Record<DurableOperation['kind'], true>` is what ties it: a
    // kind added to the union without an entry here is a typecheck error, which is
    // the only moment the omission is cheap to fix, and an entry the union does not
    // declare is one too. The assertion then only has to say the two agree.
    const UNION_KINDS: Record<DurableOperation['kind'], true> = {
      'create-layer': true,
      'remove-layer': true,
      'set-layer-properties': true,
      'reposition-layer': true,
      'reorder-layers': true,
      'apply-filter': true,
      'apply-affine-transform': true,
      'apply-raster-processor': true,
      'set-document-frame': true,
      'transform-document': true,
      'replace-layer-source': true,
      'merge-document': true,
      'set-selection': true,
    };
    expect(Object.keys(UNION_KINDS).sort()).toEqual([...KIND_NAMES].sort());
  });
});

const KIND_NAMES = [
  'create-layer',
  'remove-layer',
  'set-layer-properties',
  'reposition-layer',
  'reorder-layers',
  'apply-filter',
  'apply-affine-transform',
  'apply-raster-processor',
  'set-document-frame',
  'transform-document',
  'replace-layer-source',
  'merge-document',
  'set-selection',
] as const;
