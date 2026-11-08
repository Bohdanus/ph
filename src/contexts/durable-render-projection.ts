import { isEqual } from 'lodash-es';
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

/**
 * The current durable presentation/export adapter is approved only when a layer's
 * source, operations, logical metadata and materialized bounds match the legacy
 * renderer contract. Retained operations need separate parity proof before admission.
 */
export function durableLayerPresentationMismatch(
  replayLayer: DurableReplayResult['layers'][string],
  existing: Layer,
  bounds: Layer['pos']
): string | null {
  const { snapshot } = replayLayer;
  const sourceSupported =
    snapshot.source.kind === 'raster' || snapshot.source.kind === 'blank' || snapshot.source.kind === 'vector';
  if (!sourceSupported) return `source kind ${snapshot.source.kind} is unsupported`;
  if (replayLayer.operations.length > 0) {
    return `durable layer operations are not pixel-parity approved (${replayLayer.operations
      .map(({ kind }) => kind)
      .join(', ')})`;
  }
  if (
    !isEqual(
      {
        id: snapshot.id,
        name: snapshot.name,
        isBedrock: snapshot.isBedrock,
        visible: snapshot.visible,
        opacity: snapshot.opacity,
        locked: snapshot.locked,
        blendMode: snapshot.blendMode,
        order: snapshot.order,
        pos: snapshot.pos,
      },
      {
        id: existing.id,
        name: existing.name,
        isBedrock: existing.isBedrock,
        visible: existing.visible,
        opacity: existing.opacity,
        locked: existing.locked,
        blendMode: existing.blendMode,
        order: existing.order,
        pos: existing.pos,
      }
    )
  ) {
    return 'durable layer metadata differs from the legacy layer record';
  }
  return isEqual(bounds, existing.pos) ? null : 'materialized bounds differ from the untransformed layer position';
}

function runtimeLayer(
  snapshot: DurableReplayResult['layers'][string]['snapshot'],
  materialized: MaterializedLayer | undefined
): Layer {
  return {
    id: snapshot.id,
    name: snapshot.name,
    isBedrock: snapshot.isBedrock,
    bitmap: materialized?.bitmap ?? null,
    tmpCanvas: null,
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
