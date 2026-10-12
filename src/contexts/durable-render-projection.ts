import type { DocumentFrame } from './document-frame.ts';
import { requireVisibleLayerCoverage } from './durable-compositor.ts';
import type { MaterializedLayer } from './materialization.ts';
import type { DurableReplayResult } from './durable-replay.ts';
import type { Layer, LayersRecord } from './layer-types.ts';

/**
 * A staged runtime view derived from the durable replay authority. The status
 * describes whether its presentation caches may be rendered; it never changes
 * the legacy history authority or the runtime store by itself.
 */
export type DurableRenderProjection = Readonly<{
  documentId: string;
  documentRevision: number;
  branchRevision: number;
  durableRevision: number;
  historyCursor: number;
  frame: DocumentFrame;
  status: 'pending' | 'durable' | 'legacy';
  layers: LayersRecord;
}>;

export type DurableRenderProjectionInput = Readonly<{
  status: DurableRenderProjection['status'];
  materializedLayers?: Readonly<Record<string, MaterializedLayer>>;
}>;

function runtimeLayer(
  snapshot: DurableReplayResult['layers'][string]['snapshot'],
  materialized: MaterializedLayer | undefined
): Layer {
  return {
    id: snapshot.id,
    name: snapshot.name,
    isBedrock: snapshot.isBedrock,
    bitmap: null,
    tmpCanvas: materialized?.bitmap ?? null,
    visible: snapshot.visible,
    opacity: snapshot.opacity,
    locked: snapshot.locked,
    blendMode: snapshot.blendMode,
    order: snapshot.order,
    pos: { ...snapshot.pos },
    presentationBounds: materialized ? { ...materialized.bounds } : null,
    // Materialization already evaluated every durable operation. Replaying any
    // of them through the legacy renderer would apply them twice.
    operations: [],
  };
}

/**
 * Builds a complete runtime-shaped layer record from durable snapshots only.
 * Materialized bitmaps are borrowed: the caller retains every lease and must
 * release its composite when this short-lived projection is no longer staged.
 */
export function projectDurableRender(
  replay: DurableReplayResult,
  input: DurableRenderProjectionInput
): DurableRenderProjection {
  const materializedLayers = input.materializedLayers ?? {};
  if (input.status === 'durable') {
    requireVisibleLayerCoverage(replay, materializedLayers);
  } else if (Object.keys(materializedLayers).length > 0) {
    throw new Error('Only a durable render projection may carry materialized layers');
  }

  const layers: LayersRecord = {};
  for (const { snapshot } of Object.values(replay.layers)) {
    const materialized = input.status === 'durable' && snapshot.visible ? materializedLayers[snapshot.id] : undefined;
    layers[snapshot.id] = runtimeLayer(snapshot, materialized);
  }

  return {
    documentId: replay.documentId,
    documentRevision: replay.documentRevision,
    branchRevision: replay.branchRevision,
    durableRevision: replay.durableRevision,
    historyCursor: replay.cursor,
    frame: { ...replay.frame },
    status: input.status,
    layers,
  };
}
