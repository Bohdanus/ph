import type { BitmapSource, Pos } from './general-types.ts';
import type { DurableLayerSnapshot } from './history-model.ts';
import type { DurableReplayResult } from './durable-replay.ts';
import type { MaterializationLease } from './asset-registry.ts';
import type { MaterializedLayer } from './materialization.ts';

export type DurablePresentationLayer = Readonly<{
  layerId: string;
  snapshot: DurableLayerSnapshot;
  bitmap: BitmapSource | null;
  bounds: Pos;
  lease: MaterializationLease<Pos> | null;
}>;

export type DurablePresentationProjection = Readonly<{
  layers: Readonly<Record<string, DurablePresentationLayer>>;
  visibleLayerIds: readonly string[];
  hiddenLayerIds: readonly string[];
}>;

export class DurablePresentationProjectionRefusal extends Error {
  readonly missingLayerIds: readonly string[];
  readonly unexpectedLayerIds: readonly string[];

  constructor(message: string, missingLayerIds: readonly string[] = [], unexpectedLayerIds: readonly string[] = []) {
    super(message);
    this.name = 'DurablePresentationProjectionRefusal';
    this.missingLayerIds = Object.freeze([...missingLayerIds]);
    this.unexpectedLayerIds = Object.freeze([...unexpectedLayerIds]);
  }
}

/**
 * Builds the durable-to-presentation boundary without retaining replay
 * operations. Visible layers own materialized pixels and leases; hidden layers
 * retain durable metadata only and therefore own neither.
 */
export function buildDurablePresentationProjection(
  replay: DurableReplayResult,
  materializedLayers: Readonly<Record<string, MaterializedLayer>>
): DurablePresentationProjection {
  const orderedReplayLayers = Object.values(replay.layers).sort(
    (left, right) => left.snapshot.order - right.snapshot.order
  );
  const visibleLayerIds = orderedReplayLayers
    .filter(({ snapshot }) => snapshot.visible)
    .map(({ snapshot }) => snapshot.id);
  const hiddenLayerIds = orderedReplayLayers
    .filter(({ snapshot }) => !snapshot.visible)
    .map(({ snapshot }) => snapshot.id);
  const actualLayerIds = Object.keys(materializedLayers);
  const missingLayerIds = visibleLayerIds.filter((layerId) => !materializedLayers[layerId]);
  const unexpectedLayerIds = actualLayerIds.filter((layerId) => !visibleLayerIds.includes(layerId));
  if (missingLayerIds.length > 0 || unexpectedLayerIds.length > 0 || actualLayerIds.length !== visibleLayerIds.length) {
    throw new DurablePresentationProjectionRefusal(
      'Durable presentation projection does not cover exactly the visible replay layers',
      missingLayerIds,
      unexpectedLayerIds
    );
  }

  const layers: Record<string, DurablePresentationLayer> = {};
  for (const replayLayer of orderedReplayLayers) {
    const snapshot = replayLayer.snapshot;
    const materialized = materializedLayers[snapshot.id];
    layers[snapshot.id] = Object.freeze({
      layerId: snapshot.id,
      snapshot,
      bitmap: materialized?.bitmap ?? null,
      bounds: materialized?.bounds ?? snapshot.pos,
      lease: materialized?.lease ?? null,
    });
  }

  return Object.freeze({
    layers: Object.freeze(layers),
    visibleLayerIds: Object.freeze([...visibleLayerIds]),
    hiddenLayerIds: Object.freeze([...hiddenLayerIds]),
  });
}
