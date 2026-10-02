import { v4 as uuidv4 } from 'uuid';

import type { DocumentFrame } from './document-frame.ts';
import { documentFrameFromSize, isValidDocumentFrame } from './document-frame.ts';
import { AssetRegistry, getAssetRegistry } from './asset-registry.ts';
import {
  DURABLE_SCHEMA_VERSION,
  type DurableBaseline,
  type DurableDocument,
  type DurableFilter,
  type DurableHistoryEntry,
  type DurableLayerPropertyPatch,
  type DurableLayerSnapshot,
  type DurableLayerSource,
  type DurableOperation,
  type PlainObject,
  type SelectionSnapshot,
  type AssetId,
  cloneDurableDocument,
  cloneLayerSnapshot,
  collectDurableAssetIds,
  freezeDurableDocument,
  toLayerSnapshot,
} from './history-model.ts';
import type { HistoryItem } from './history-types.ts';
import type { Layer, LayerId, LayerSource, LayersRecord } from './layer-types.ts';
import type { BitmapSource, Size } from './general-types.ts';
import type { NewBedrockSize, ToolArgs } from './tool-types.ts';
import { deriveSelectionBaseline, selectionSnapshot } from './selection-baseline.ts';
import type { ActionType } from '../util/constants.ts';
import {
  HIDE_LAYER_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  OPEN_DOCUMENT_ACTION,
  REMOVE_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  SELECTION_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SHOW_LAYER_ACTION,
  TOOL_ACTION,
} from '../util/constants.ts';
import { getTransformFromHistoryArgs, isTrapezoidOnlyTransform, validateAffineTransform } from './affine-transform.ts';
import { toolLayerBlendMode } from './layer-utils.ts';
import { findToolProcessor } from '../tools/toolProcessors.ts';

export class UnsupportedHistoryFeatureError extends Error {
  readonly code = 'unsupported-history-feature';
  readonly historyId?: string;

  constructor(message: string, historyId?: string) {
    super(message);
    this.historyId = historyId;
    this.name = 'UnsupportedHistoryFeatureError';
  }
}

export type MigrationDiagnostic = Readonly<{
  historyId?: string;
  actionName?: ActionType;
  severity: 'warning' | 'error';
  code:
    | 'unsupported-history-feature'
    | 'document-replacement'
    | 'invalid-history-entry'
    | 'conversion-failed'
    | 'array-arg-hole-preserved'
    | 'durable-append-mismatch';
  message: string;
}>;

export type LegacyConversionResult = Readonly<{
  document: DurableDocument;
  diagnostics: readonly MigrationDiagnostic[];
  /**
   * For each legacy entry, the latest durable entry that does not occur after
   * it. Skipped legacy entries deliberately map to the preceding durable
   * cursor, never to the durable history tip.
   */
  legacyCursorToDurableCursor: readonly number[];
}>;

export type DurableConversionStatus = 'current' | 'unavailable';

export type DurableConversionAttempt = Readonly<{
  status: DurableConversionStatus;
  document: DurableDocument | null;
  diagnostics: readonly MigrationDiagnostic[];
  legacyCursorToDurableCursor: readonly number[];
}>;

export type LegacyConversionOptions = Readonly<{
  documentId?: string;
  documentRevision?: number;
  branchRevision?: number;
  durableRevision?: number;
  initialSize?: Size;
  initialFrame?: DocumentFrame;
  registry?: AssetRegistry;
}>;

/**
 * Where an array argument carried an absence that {@link plainValue} preserved
 * as a hole rather than the legacy explicit `undefined`.
 *
 * The hole is value-preserving and observation-preserving in different ways, and
 * this file does not trade either for silence — see the array arm. The caller
 * turns each path into a `warning` so a shadow that reports `current` while
 * holding something other than the authority's observation is never silent.
 */
type ArrayCompaction = { paths: string[] };

function plainValue(value: unknown, path: string, compaction?: ArrayCompaction): PlainObject[keyof PlainObject] {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Non-finite value at ${path}`);
    return value;
  }
  if (Array.isArray(value)) {
    // `undefined` is absence, not a value, and a history arg carrying one is a
    // sparse array rather than a defect. Treating it as one WAS the bug: a throw
    // here became an `error` diagnostic, and `convertLegacyHistorySafely`
    // withholds the WHOLE shadow on the first one, so one holey tool-arg array
    // was enough to lose the document (`HANDOFF.md` §93).
    //
    // The absence is PRESERVED rather than compacted away, because legacy replay
    // (`history-replay.ts`) hands the processor the original array and an index
    // IS the meaning: `lineDash: [4, undefined, 2]` compacting to `[4, 2]` is a
    // different dash pattern, and every positional consumer would read a
    // different value. So the result keeps the legacy length and keeps the hole
    // at the legacy index.
    //
    // It is still not the legacy observation, which is what `compaction` is for:
    // `1 in durableStops` is `false` where legacy's explicit `undefined` makes
    // it `true`, so the hole is recorded and reported by the caller rather than
    // adopted quietly — the same trade this file already refuses further down,
    // where a conversion that cannot fail still emits a diagnostic rather than
    // losing a frame silently.
    const result = new Array<Exclude<PlainObject[keyof PlainObject], undefined>>(value.length);
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index) || value[index] === undefined) {
        compaction?.paths.push(`${path}[${index}]`);
        continue;
      }
      result[index] = plainValue(value[index], `${path}[${index}]`, compaction) as Exclude<
        PlainObject[keyof PlainObject],
        undefined
      >;
    }
    return Object.freeze(result);
  }
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`Non-plain value at ${path}`);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => Object.prototype.propertyIsEnumerable.call(value, key))
        .map(([key, item]) => [key, item === undefined ? undefined : plainValue(item, `${path}.${key}`, compaction)])
    )
  ) as PlainObject;
}

function plainObject(value: unknown, path: string, compaction?: ArrayCompaction): PlainObject {
  const result = plainValue(value, path, compaction);
  if (!result || Array.isArray(result) || typeof result !== 'object') throw new Error(`Expected object at ${path}`);
  return result as PlainObject;
}

function sourceSize(source: LayerSource): Size {
  return source.isBedrock ? { ...source.size } : { width: source.pos.width, height: source.pos.height };
}

function asLegacyLayerSource(value: unknown): LayerSource | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'blank' || kind === 'image' || kind === 'tool' ? (value as LayerSource) : undefined;
}

function registerRaster(registry: AssetRegistry, documentId: string, bitmap: BitmapSource): AssetId {
  // Legacy history/runtime layers retain ownership until the durable model is
  // authoritative. The diagnostic sidecar must never close their bitmaps.
  return registry.registerBaseline(documentId, bitmap, { ownership: 'borrow' });
}

function convertSource(
  source: LayerSource,
  layer: Layer,
  documentId: string,
  registry: AssetRegistry
): DurableLayerSource {
  const size = sourceSize(source);
  const isBedrock = !!source.isBedrock;
  switch (source.kind) {
    case 'blank':
      return Object.freeze({ kind: 'blank', color: source.color, opacity: source.opacity, size, isBedrock });
    case 'image':
      return Object.freeze({
        kind: 'raster',
        assetId: registerRaster(registry, documentId, source.bitmap),
        width: source.bitmap.width,
        height: source.bitmap.height,
        ...(source.name ? { name: source.name } : {}),
        isBedrock,
      });
    case 'tool': {
      const args = plainObject(source.args, `layer:${layer.id}.source.args`);
      const kind =
        source.args.toolName === 'text'
          ? 'text'
          : ['shape', 'rectangle', 'ellipse', 'triangle', 'polygon', 'line'].includes(source.args.toolName)
            ? 'vector'
            : 'legacy-tool';
      if (kind === 'legacy-tool') {
        return Object.freeze({ kind, toolName: source.args.toolName, args, size, isBedrock });
      }
      return Object.freeze({
        kind,
        toolName: source.args.toolName,
        args,
        size,
        sourcePos: Object.freeze({ ...layer.pos }),
        isBedrock,
      });
    }
  }
}

export function convertLayer(layer: Layer, documentId: string, registry: AssetRegistry): DurableLayerSnapshot {
  if (!layer.source) {
    if (!layer.bitmap)
      throw new UnsupportedHistoryFeatureError(`Layer ${layer.id} has no durable source or raster materialization`);
    const assetId = registerRaster(registry, documentId, layer.bitmap);
    return toLayerSnapshot(
      {
        id: layer.id,
        name: layer.name,
        isBedrock: layer.isBedrock,
        visible: layer.visible,
        opacity: layer.opacity,
        locked: layer.locked,
        blendMode: layer.blendMode,
        order: layer.order,
        pos: { ...layer.pos },
      },
      { kind: 'raster', assetId, width: layer.bitmap.width, height: layer.bitmap.height, isBedrock: layer.isBedrock }
    );
  }
  return toLayerSnapshot(
    {
      id: layer.id,
      name: layer.name,
      isBedrock: layer.isBedrock,
      visible: layer.visible,
      opacity: layer.opacity,
      locked: layer.locked,
      blendMode: layer.blendMode,
      order: layer.order,
      pos: { ...layer.pos },
    },
    convertSource(layer.source, layer, documentId, registry)
  );
}

function snapshotLayers(layers: LayersRecord, documentId: string, registry: AssetRegistry): DurableLayerSnapshot[] {
  return Object.values(layers)
    .sort((left, right) => left.order - right.order)
    .map((layer) => convertLayer(layer, documentId, registry));
}

function frameFromLegacy(
  item: HistoryItem | undefined,
  initialSize: Size,
  initialFrame?: DocumentFrame
): DocumentFrame {
  return item?.documentSource?.frame
    ? { ...item.documentSource.frame }
    : item?.documentSource?.size
      ? documentFrameFromSize(item.documentSource.size)
      : initialFrame
        ? { ...initialFrame }
        : documentFrameFromSize(initialSize);
}

/**
 * The frame the FIRST entry establishes when it is a bedrock source rather than a
 * document source — the shape `File > New` produces, where `createBlankLayer(params,
 * true)` replaces the document and writes a single `NEW_LAYER` entry carrying
 * `{ isBedrock: true, size }` (`useLayer.ts:245-258`, `history-utils.ts:22-25`).
 *
 * The baseline describes the document at cursor -1, and for that history the bedrock
 * size IS that document, so reading it here is what makes the shadow agree with the
 * authority instead of coinciding with it. It has to be read, because the converter's
 * create-layer arm cannot reach it: it publishes the layer and deliberately leaves
 * `currentFrame` alone, which is right for every LATER entry and wrong for the one
 * that opened the document.
 *
 * It outranks `options.initialFrame` deliberately, and for the same reason legacy
 * replay does: that option is the store's CURRENT frame, which a later crop has
 * already moved, while legacy replay restores the bedrock size when the cursor walks
 * back to index 0. A converter that preferred it would describe cursor -1 as the
 * cropped document, so the two models would disagree at exactly the cursor where the
 * user can undo into the un-cropped original.
 */
function frameFromFirstEntryBedrock(item: HistoryItem | undefined): DocumentFrame | undefined {
  if (!item || item.documentSource) return undefined;
  const source = item.layerSource ?? asLegacyLayerSource(item.args);
  if (source?.isBedrock) return documentFrameFromSize(source.size);
  if ((item.args as NewBedrockSize | undefined)?.isBedrock) {
    return documentFrameFromSize((item.args as NewBedrockSize).size);
  }
  return undefined;
}

function entry<Op extends DurableOperation>(id: string, operation: Op, enabled = true): DurableHistoryEntry<Op> {
  return Object.freeze({ id, schemaVersion: DURABLE_SCHEMA_VERSION, enabled, operation });
}

/**
 * The single derivation of a document-frame durable entry.
 *
 * Both the shadow conversion and the Phase 1 append boundary must produce the
 * same entry for the same legacy item, so the frame rule lives here only: an
 * invalid next frame yields no durable entry at all, and `currentFrame` is the
 * last *enabled* durable frame.
 */
export function deriveSetDocumentFrameEntry(
  item: HistoryItem,
  currentFrame: DocumentFrame
): DurableHistoryEntry | null {
  const args = item.args as { previousFrame?: DocumentFrame; nextFrame?: DocumentFrame } | undefined;
  if (!isValidDocumentFrame(args?.nextFrame)) return null;
  const operation = Object.freeze({
    kind: 'set-document-frame',
    previous: args?.previousFrame ?? { ...currentFrame },
    next: { ...args.nextFrame },
  });
  return entry(item.id, operation, isEntryEnabled(item));
}

/**
 * Structural guard for a durable selection snapshot.
 *
 * A key-absent `activeSelectionId` is ACCEPTED, because `replayHistory` reads it
 * as `next?.activeSelectionId ?? null` (`history-replay.ts:122`): a snapshot that
 * omits the id still retains its selections and only loses the active id.
 * Rejecting that shape here would make the shadow clear selections that legacy
 * replay keeps. The guard only asks whether the value can be read as a snapshot
 * at all; normalizing the id to `null` is `deriveSetSelectionEntry`'s job.
 */
function isValidSelectionSnapshot(value: unknown): value is SelectionSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as { selections?: unknown; activeSelectionId?: unknown };
  if (!Array.isArray(candidate.selections)) return false;
  const { activeSelectionId } = candidate;
  return activeSelectionId === undefined || activeSelectionId === null || typeof activeSelectionId === 'string';
}

/**
 * The single derivation of a selection durable entry.
 *
 * This is the selection twin of `deriveSetDocumentFrameEntry`, for the same
 * reason: the shadow conversion and the append boundary must produce the same
 * entry for the same legacy item, so the rule lives here only.
 *
 * The rule is deliberately stricter than `replayHistory`, and the asymmetry is
 * the point:
 *
 * - A missing or structurally unusable `nextSelectionState` yields NO durable
 *   entry. Substituting an empty `after` would assert "no selection" for a state
 *   the model cannot read, so a boundary that published it would be
 *   indistinguishable from the user pressing "select none". Returning `null`
 *   makes the caller report instead of inventing state.
 * - A missing (or unreadable) `previousSelectionState` falls back to
 *   `currentSelections`, the selection state the durable model already holds,
 *   copied rather than aliased so the entry cannot be mutated through the
 *   caller's snapshot. A baseline is never invented either.
 *
 * `replayHistory` does clear on an absent next state, and `legacyHistoryToDurable`
 * keeps that behaviour so the shadow agrees with the legacy replay it shadows.
 * That parity is a property of the *conversion*, not of this helper: the append
 * boundary has no second authority to stay equal to, so it refuses the entry.
 */
export function deriveSetSelectionEntry(
  item: HistoryItem,
  currentSelections: SelectionSnapshot
): DurableHistoryEntry | null {
  const args = item.args as
    { previousSelectionState?: SelectionSnapshot; nextSelectionState?: SelectionSnapshot } | undefined;
  const next = args?.nextSelectionState;
  if (!isValidSelectionSnapshot(next)) return null;
  const previous = args?.previousSelectionState;
  const operation = Object.freeze({
    kind: 'set-selection',
    before: isValidSelectionSnapshot(previous)
      ? selectionSnapshot(previous.selections, previous.activeSelectionId)
      : selectionSnapshot(currentSelections.selections, currentSelections.activeSelectionId),
    after: selectionSnapshot(next.selections, next.activeSelectionId),
  });
  return entry(item.id, operation, isEntryEnabled(item));
}

/**
 * The layer-property actions the append boundary translates, and the single
 * property each one owns. This map is the only place membership is stated: a
 * per-action if/else beside it would let the two disagree, and an action added
 * here without a property arm would make conversion record no operation while
 * the boundary reported an invalid value.
 *
 * The value is the closed set of properties an action may own, not every key
 * `DurableLayerPropertyPatch` admits. Narrowing it here is what lets both the
 * derivation and the append validator exhaustively switch on the owned key —
 * widening it to `keyof DurableLayerPropertyPatch` would let a new action own
 * `opacity` and fall into the visibility arm as a silent default.
 */
type LayerPropertyKey = 'visible' | 'name';

const LAYER_PROPERTY_BY_ACTION = {
  [SHOW_LAYER_ACTION]: 'visible',
  [HIDE_LAYER_ACTION]: 'visible',
  [RENAME_LAYER_ACTION]: 'name',
} as const satisfies Partial<Record<ActionType, LayerPropertyKey>>;

type LayerPropertyAction = keyof typeof LAYER_PROPERTY_BY_ACTION;
type LayerPropertyOperation = Extract<DurableOperation, { kind: 'set-layer-properties' }>;
type RemoveLayerOperation = Extract<DurableOperation, { kind: 'remove-layer' }>;

export function isSetLayerPropertiesAction(actionName: ActionType): actionName is LayerPropertyAction {
  return Object.hasOwn(LAYER_PROPERTY_BY_ACTION, actionName);
}

/**
 * The property an action owns, or `null` when it is not a layer-property
 * action. Callers that must check a planned operation against the legacy entry
 * use this rather than re-deriving, so the check reads the action and not the
 * derivation that produced the thing being checked.
 */
export function layerPropertyKeyFor(actionName: ActionType): LayerPropertyKey | null {
  return isSetLayerPropertiesAction(actionName) ? LAYER_PROPERTY_BY_ACTION[actionName] : null;
}

/**
 * The patch a planned entry carries, or `null` when there is no entry or it is
 * not a layer-property operation. A writer needs this to apply the same patch
 * the store will publish; keeping the operation-kind narrowing here means the
 * writer does not restate which kind it is reading.
 */
export function derivedLayerPropertyPatch(
  plannedEntry: DurableHistoryEntry | null | undefined
): DurableLayerPropertyPatch | null {
  const operation = plannedEntry?.operation;
  return operation?.kind === 'set-layer-properties' ? operation.patch : null;
}

/**
 * The single derivation of the durable layer-property operations supported at
 * the append boundary. Keeping the action whitelist here makes conversion and
 * a live writer use the same semantics without accepting arbitrary patches.
 */
export function deriveSetLayerPropertiesEntry(item: HistoryItem): DurableHistoryEntry<LayerPropertyOperation> | null {
  if (!isSetLayerPropertiesAction(item.actionName)) return null;
  let patch: DurableLayerPropertyPatch;
  if (LAYER_PROPERTY_BY_ACTION[item.actionName] === 'name') {
    const name = (item.args as { name?: unknown } | undefined)?.name;
    if (typeof name !== 'string') return null;
    patch = { name };
  } else {
    // Visibility comes from the action, never from `args.visible`: that is the
    // rule legacy replay applies, and a hand-built args object must not be able
    // to record an entry whose durable patch contradicts the action.
    patch = { visible: item.actionName === SHOW_LAYER_ACTION };
  }
  const operation: LayerPropertyOperation = Object.freeze({
    kind: 'set-layer-properties',
    layerId: item.layerId,
    patch: Object.freeze(patch),
  });
  return entry(item.id, operation, isEntryEnabled(item));
}

/**
 * The single action-derived remove-layer entry used by conversion and append.
 * Layer presence is deliberately not a precondition: legacy replay and durable
 * replay both treat removing an unknown id as a no-op while retaining history.
 * No asset-retirement work is needed while the durable baseline remains
 * uncompacted and the full replayable history retains its asset-bearing
 * create/merge entries: removal only changes which layers are visible during
 * replay and cannot make a durable asset unreachable.
 */
export function deriveRemoveLayerEntry(item: HistoryItem): DurableHistoryEntry<RemoveLayerOperation> | null {
  if (item.actionName !== REMOVE_ACTION) return null;
  const operation: RemoveLayerOperation = Object.freeze({ kind: 'remove-layer', layerId: item.layerId });
  return entry(item.id, operation, isEntryEnabled(item));
}

function diagnosticFromError(error: unknown, item?: HistoryItem): MigrationDiagnostic {
  return {
    ...(item ? { historyId: item.id, actionName: item.actionName } : {}),
    severity: 'error',
    code:
      error instanceof UnsupportedHistoryFeatureError
        ? 'unsupported-history-feature'
        : item
          ? 'invalid-history-entry'
          : 'conversion-failed',
    message: error instanceof Error ? error.message : String(error),
  };
}

export function isEntryEnabled(item: HistoryItem): boolean {
  const nested = item.args as { enabled?: unknown } | undefined;
  return !item.disabled && nested?.enabled !== false;
}

export function operationForTool(
  item: HistoryItem,
  layer: DurableLayerSnapshot,
  compaction?: ArrayCompaction
): DurableOperation | null {
  const candidate = item.args as { args?: unknown } | undefined;
  const args = (candidate && candidate.args && typeof candidate.args === 'object' ? candidate.args : item.args) as
    ToolArgs | undefined;
  if (!args || typeof args !== 'object' || typeof args.toolName !== 'string') return null;
  const processor = findToolProcessor(args.toolName);
  if (!processor) throw new UnsupportedHistoryFeatureError(`Unknown processor ${args.toolName}`, item.id);

  if (args.toolName === 'transform') {
    const transformCandidate = args as ToolArgs & { transform?: unknown; trapezoid?: number };
    if (transformCandidate.trapezoid && transformCandidate.transform) {
      throw new UnsupportedHistoryFeatureError('A transform cannot combine trapezoid and affine values', item.id);
    }
    if (transformCandidate.trapezoid) {
      if (!isTrapezoidOnlyTransform(args as never)) {
        throw new UnsupportedHistoryFeatureError('Mixed trapezoid and affine transform is unsupported', item.id);
      }
      return Object.freeze({
        kind: 'apply-raster-processor',
        layerId: item.layerId,
        processorId: 'transform',
        version: processor.replay.version,
        args: plainObject(args, `history:${item.id}.args`, compaction),
      });
    }
    let transform;
    try {
      transform = getTransformFromHistoryArgs(args, layer.pos);
    } catch (error) {
      throw new UnsupportedHistoryFeatureError(
        error instanceof Error ? error.message : 'Invalid retained transform',
        item.id
      );
    }
    if (!transform) return null;
    return Object.freeze({
      kind: 'apply-affine-transform',
      layerId: item.layerId,
      transform: validateAffineTransform(transform, layer.pos),
    });
  }

  if (processor.commit === 'layer-operation') {
    const filterArgs = plainObject(args, `history:${item.id}.args`, compaction);
    if (!['blur', 'color', 'levels'].includes(args.toolName)) {
      throw new UnsupportedHistoryFeatureError(`Unsupported filter ${args.toolName}`, item.id);
    }
    const filter: DurableFilter = Object.freeze({
      toolName: args.toolName as DurableFilter['toolName'],
      version: processor.replay.version,
      args: filterArgs,
    });
    return Object.freeze({ kind: 'apply-filter', layerId: item.layerId, filter });
  }
  if (processor.commit === 'geometry') {
    const geometry = args as ToolArgs & {
      move?: { x: number; y: number };
      resize?: { x: number; y: number; width: number; height: number };
    };
    if (!geometry.move && !geometry.resize) return null;
    return Object.freeze({
      kind: 'reposition-layer',
      layerId: item.layerId,
      ...(geometry.move ? { move: Object.freeze({ ...geometry.move }) } : {}),
      ...(geometry.resize ? { resize: Object.freeze({ ...geometry.resize }) } : {}),
    });
  }
  if (processor.commit === 'raster') {
    return Object.freeze({
      kind: 'apply-raster-processor',
      layerId: item.layerId,
      processorId: args.toolName,
      version: processor.replay.version,
      args: plainObject(args, `history:${item.id}.args`, compaction),
    });
  }
  if (processor.commit === 'document-operation' || processor.commit === 'selection') return null;
  throw new UnsupportedHistoryFeatureError(`Tool ${args.toolName} cannot be replayed durably`, item.id);
}

function snapshotFromDocumentSource(item: HistoryItem, documentId: string, registry: AssetRegistry) {
  const documentSource = item.documentSource;
  if (!documentSource) return null;
  const layers = snapshotLayers(documentSource.layers, documentId, registry);
  const activeLayerId =
    item.layerId && layers.some((layer) => layer.id === item.layerId)
      ? item.layerId
      : (layers[layers.length - 1]?.id ?? null);
  return {
    frame: frameFromLegacy(item, documentSource.size),
    layers,
    activeLayerId,
  };
}

export function legacyHistoryToDurable(
  history: readonly HistoryItem[] | DurableDocument,
  options: LegacyConversionOptions = {}
): LegacyConversionResult {
  if (!Array.isArray(history)) {
    return {
      document: cloneDurableDocument(history as DurableDocument),
      diagnostics: [],
      legacyCursorToDurableCursor: [],
    };
  }
  const legacyHistory = history as readonly HistoryItem[];
  const documentId = options.documentId ?? uuidv4();
  const registry = options.registry ?? getAssetRegistry();
  const first = legacyHistory[0];
  const initialSize = options.initialSize ?? first?.documentSource?.size ?? { width: 1, height: 1 };
  // Both branches must seed identically, so the durable baseline reads the same
  // unbounded rule legacy replay uses. It cannot be narrowed to the pre-first-entry
  // state while a selection is created outside history: the tool-switch clear's
  // `previousSelectionState` is the only record that the selection existed, and
  // `durable-replay.ts` applies only each operation's `after`.
  const selectionBaseline = deriveSelectionBaseline(legacyHistory);
  // A source never carries a document frame. Bedrock establishes the frame only
  // at history index 0; the durable path's only frame writer is the
  // `set-document-frame` operation.
  const initial = (first && isEntryEnabled(first) ? snapshotFromDocumentSource(first, documentId, registry) : null) ?? {
    frame: frameFromFirstEntryBedrock(first) ?? options.initialFrame ?? documentFrameFromSize(initialSize),
    layers: [],
    activeLayerId: null,
  };
  const baseline: DurableBaseline = { ...initial, selections: selectionBaseline };
  const diagnostics: MigrationDiagnostic[] = [];
  const legacyCursorToDurableCursor: number[] = [];
  let currentLayers = new Map(initial.layers.map((layer) => [layer.id, layer]));
  let currentFrame = { ...initial.frame };
  let currentSelections: SelectionSnapshot = selectionBaseline;
  const entries: DurableHistoryEntry[] = [];
  // Ids already published as a durable entry. Two id-based resolvers exist and
  // both take the FIRST match, which is what a repeated id threatens:
  // `updateHistoryTimeline` finds the first entry in the LEGACY timeline
  // (`history-timeline.ts:23-28`) and `toggleDurableEntry` finds the first in the
  // durable document (`toggleDurableEntry` below). Publishing a repeat would give
  // the two lists different first matches for one key, so a History-panel toggle
  // would disable a different edit in each model. Skipping the repeat keeps them
  // aligned. Replay is not part of this: `replayDurableDocument` addresses
  // history by ARRAY INDEX (`durable-replay.ts:56-59`), so no replay is misresolved
  // either way — the alignment of the two id resolvers is the whole reason this
  // is a warning. An error diagnostic would withhold the shadow outright
  // (`convertLegacyHistorySafely` voids on the first one), which is not a price
  // worth paying for a timeline that still replays correctly.
  //
  // Only ids that actually reached `entries` are recorded, except for the
  // document-source baseline. That source is not a durable entry, but its id is
  // still the first key the legacy timeline can resolve, so a later entry that
  // reuses it must be refused just like a published duplicate. Refused document
  // replacements and entries whose derivation throws do not consume their ids.
  const baselineEntryId = first?.documentSource ? first.id : undefined;
  const publishedEntryIds = new Set<string>(baselineEntryId ? [baselineEntryId] : []);

  for (const item of legacyHistory) {
    if (item !== first && item.documentSource && publishedEntryIds.has(item.id)) {
      diagnostics.push({
        historyId: item.id,
        actionName: item.actionName,
        severity: 'warning',
        code: 'invalid-history-entry',
        message: `History entry ${item.id} (${item.actionName}) reuses the id of the baseline document-source entry, so it was not published as a durable entry. The baseline is not itself in durable history, but its id is already meaningful to the legacy timeline and must remain unique.`,
      });
      legacyCursorToDurableCursor.push(entries.length - 1);
      continue;
    }
    if (item.documentSource && (item.actionName === OPEN_DOCUMENT_ACTION || entries.length === 0)) {
      // The first open-document source is the baseline, not a replay operation.
      if (entries.length === 0) {
        if (!isEntryEnabled(item)) {
          diagnostics.push({
            historyId: item.id,
            actionName: item.actionName,
            severity: 'warning',
            code: 'invalid-history-entry',
            message: `History entry ${item.id} is disabled and carries the document's opening state, so legacy replay skips it and the durable baseline starts empty. The disabled opening state was not adopted as the baseline; both models agree at this cursor.`,
          });
        }
        legacyCursorToDurableCursor.push(-1);
        continue;
      }
      diagnostics.push({
        historyId: item.id,
        actionName: item.actionName,
        severity: 'error',
        code: 'document-replacement',
        message: 'Document replacement must create a new durable document and cannot appear inside a document history.',
      });
      legacyCursorToDurableCursor.push(entries.length - 1);
      continue;
    }
    let operation: DurableOperation | null = null;
    const enabled = isEntryEnabled(item);
    try {
      const source = item.layerSource ?? asLegacyLayerSource(item.args);
      if ((item.actionName === NEW_LAYER_ACTION || (item.actionName === TOOL_ACTION && source)) && source) {
        const runtimeLayer = sourceToRuntimeLayer(item.layerId, source, currentLayers);
        const layer = convertLayer(runtimeLayer, documentId, registry);
        if (enabled) currentLayers.set(layer.id, layer);
        operation = Object.freeze({ kind: 'create-layer', layer });
      } else if (isSetLayerPropertiesAction(item.actionName)) {
        const layerPropertiesEntry = deriveSetLayerPropertiesEntry(item);
        if (layerPropertiesEntry) {
          operation = layerPropertiesEntry.operation;
          const layer = currentLayers.get(item.layerId);
          if (enabled && layer) {
            currentLayers.set(item.layerId, cloneLayerSnapshot({ ...layer, ...layerPropertiesEntry.operation.patch }));
          }
        }
      } else if (item.actionName === REORDER_ACTION) {
        const args = item.args as { layerToMoveId?: LayerId; afterWhichLayerId?: LayerId | null } | undefined;
        const layerToMoveId = args?.layerToMoveId;
        const afterWhichLayerId = args?.afterWhichLayerId;
        // `replayHistory` skips the move entirely when either id is absent
        // (`history-replay.ts:148`), leaving the order untouched, so conversion
        // records nothing and leaves `currentLayers` alone. A named but missing
        // anchor is not a placement at the bottom: `remaining.indexOf` would be
        // -1, and `+ 1` would record a move to index 0 that the document never
        // performs. The cursor map below already treats a null operation as
        // "map to the preceding durable cursor", the same as a dropped rename.
        const anchorPresent = !afterWhichLayerId || currentLayers.has(afterWhichLayerId);
        if (layerToMoveId && currentLayers.has(layerToMoveId) && anchorPresent) {
          const order = Object.fromEntries(
            [...currentLayers.values()]
              .sort((left, right) => left.order - right.order)
              .map((layer, index) => [layer.id, index])
          );
          const remaining = Object.keys(order).filter((id) => id !== layerToMoveId);
          const targetIndex = afterWhichLayerId ? remaining.indexOf(afterWhichLayerId) + 1 : 0;
          remaining.splice(Math.max(0, targetIndex), 0, layerToMoveId);
          const orderByLayerId = Object.fromEntries(remaining.map((id, index) => [id, index]));
          operation = Object.freeze({ kind: 'reorder-layers', orderByLayerId });
          if (enabled) {
            for (const [id, nextOrder] of Object.entries(orderByLayerId)) {
              const layer = currentLayers.get(id);
              if (layer) currentLayers.set(id, cloneLayerSnapshot({ ...layer, order: nextOrder }));
            }
          }
        }
      } else if (item.actionName === REMOVE_ACTION) {
        const removeLayerEntry = deriveRemoveLayerEntry(item);
        if (removeLayerEntry) {
          operation = removeLayerEntry.operation;
          if (removeLayerEntry.enabled) currentLayers.delete(item.layerId);
        }
      } else if (item.actionName === SET_DOCUMENT_FRAME_ACTION) {
        const frameEntry = deriveSetDocumentFrameEntry(item, currentFrame);
        if (frameEntry) {
          operation = frameEntry.operation;
          if (frameEntry.enabled) currentFrame = { ...(frameEntry.operation as { next: DocumentFrame }).next };
        } else {
          // `replayHistory` drops a frame action whose `nextFrame` is not a valid
          // frame too (`history-replay.ts:112-117` guards the assignment on
          // `isValidDocumentFrame`), so for an enabled entry the shadow stays in
          // PARITY with legacy replay and there is no disagreement to fail closed
          // over. (One shape is not parity and is not claimed to be: a DISABLED
          // entry, which legacy replay skips without an opinion
          // (`history-replay.ts:75`). A bedrock source is parity at every index —
          // legacy replay honours it only for the initial document entry
          // (`history-replay.ts:104-109`) and `frameFromFirstEntryBedrock` reads the
          // same entry for the baseline, so a bedrock commit at any LATER index
          // moves neither side.)
          // But parity alone is not observability: this branch cannot throw, so
          // without a diagnostic the conversion reports `status: 'current'`
          // while silently losing a document-frame change, and the only other
          // evidence is a frame that no longer matches what the user cropped to.
          //
          // Warning rather than error, and the file had no precedent for either:
          // every diagnostic it emitted before was an error, and each one voids
          // the whole shadow through `convertLegacyHistorySafely`. The test is
          // that an error here would withhold every unrelated entry for a defect
          // the legacy timeline tolerates.
          diagnostics.push({
            historyId: item.id,
            actionName: item.actionName,
            severity: 'warning',
            code: 'invalid-history-entry',
            message: `History entry ${item.id} carries no usable next document frame, so it was not published as a durable entry. Legacy replay drops the same entry, so the durable document stays in parity; the document frame is unchanged at this point in the timeline.`,
          });
        }
      } else if (item.actionName === SELECTION_ACTION) {
        const next = (item.args as { nextSelectionState?: unknown } | undefined)?.nextSelectionState;
        if (next !== undefined && next !== null && !isValidSelectionSnapshot(next)) {
          // Present but unreadable — `{}`, `{ selections: null }`, `[]`, a
          // non-array, and so on. `replayHistory` throws on every one of these
          // when it reads `next.selections.map(...)`, and the pre-derivation code
          // threw too, though from inside `freezeDurableDocument` and therefore
          // outside this loop's catch. Throwing here restores that fail-closed
          // outcome from inside the loop: the per-item catch records an
          // error-severity diagnostic naming this entry, and
          // `convertLegacyHistorySafely` voids the document exactly as before.
          // Falling through to the clear below would instead produce a durable
          // document asserting "no selection" for an unreadable state, with a
          // populated cursor map and no diagnostic — a silent wrong answer where
          // legacy replay crashes.
          throw new Error(`Selection entry ${item.id} carries an unusable nextSelectionState`);
        }
        const selectionEntry = deriveSetSelectionEntry(item, currentSelections);
        if (selectionEntry) {
          operation = selectionEntry.operation;
          if (enabled) currentSelections = (operation as { after: SelectionSnapshot }).after;
        } else {
          // Genuinely absent (or explicitly null) next state. This is the one
          // shape where an invented empty `after` is the correct answer, because
          // it is the answer the legacy timeline itself produces: `replayHistory`
          // reads `next?.selections ?? []`, so the shadow must clear here too.
          // The append boundary has no second authority to stay equal to and
          // reports a diagnostic instead of clearing — see deriveSetSelectionEntry.
          // Both sides are re-cloned from the legacy args rather than adopted, so
          // the operation and every `before` that follows it hold no reference into
          // the history timeline. The twin derivation does the same for the valid
          // case, so neither arm depends on the document's later deep freeze to
          // keep an aliased snapshot out of the operation.
          const args = item.args as { previousSelectionState?: SelectionSnapshot } | undefined;
          const previous = args?.previousSelectionState;
          operation = Object.freeze({
            kind: 'set-selection',
            before: previous
              ? selectionSnapshot(previous.selections, previous.activeSelectionId)
              : selectionSnapshot(currentSelections.selections, currentSelections.activeSelectionId),
            after: selectionSnapshot(),
          });
          if (enabled) currentSelections = operation.after;
        }
      } else if (item.actionName === MERGE_ACTION && source) {
        const runtimeLayer = sourceToRuntimeLayer(item.layerId, source, currentLayers);
        const layer = convertLayer(runtimeLayer, documentId, registry);
        const removedLayerIds = [...currentLayers.keys()].filter((id) => id !== layer.id);
        if (enabled) currentLayers = new Map([[layer.id, layer]]);
        operation = Object.freeze({ kind: 'merge-document', result: layer, removedLayerIds });
      } else if (item.actionName === TOOL_ACTION) {
        const layer = currentLayers.get(item.layerId);
        if (!layer) throw new UnsupportedHistoryFeatureError(`Layer ${item.layerId} is unavailable`, item.id);
        const compaction: ArrayCompaction = { paths: [] };
        operation = operationForTool(item, layer, compaction);
        // An absent element in an array keeps its index and its length, so the
        // sequence of values the processor reads is the legacy one — but the
        // durable array is a real hole where legacy's is an explicit
        // `undefined`, and `1 in array` is `false` where legacy makes it `true`.
        // The shadow therefore publishes `status: 'current'` holding a value the
        // authority does not hold, and the only thing that keeps that from being
        // silent is this report.
        //
        // `warning`, not `error`: an error withholds the ENTIRE durable document
        // through `convertLegacyHistorySafely`, so refusing to convert over a
        // sparse array would cost the user every entry in the timeline to report
        // a divergence the shadow already carries. The divergence is named
        // instead, so `status: 'current'` is never a claim of faithfulness on its
        // own.
        for (const path of compaction.paths) {
          diagnostics.push({
            historyId: item.id,
            actionName: item.actionName,
            severity: 'warning',
            code: 'array-arg-hole-preserved',
            message: `History entry ${item.id} carries an absent element in the array argument at ${path}, which the durable conversion preserved as a hole at the same index. Legacy replay hands the processor an explicit value at that position, so the durable array is not the legacy observation even though its length and its values match.`,
          });
        }
        if (operation?.kind === 'reposition-layer') {
          const pos = {
            ...layer.pos,
            ...(operation.move ? { x: operation.move.x, y: operation.move.y } : {}),
            ...(operation.resize ? { ...operation.resize } : {}),
          };
          if (enabled) currentLayers.set(item.layerId, cloneLayerSnapshot({ ...layer, pos }));
        }
      } else {
        throw new UnsupportedHistoryFeatureError(`Unsupported legacy action ${item.actionName}`, item.id);
      }
    } catch (error) {
      diagnostics.push(diagnosticFromError(error, item));
    }
    if (operation) {
      if (publishedEntryIds.has(item.id)) {
        const isBaselineId = item.id === baselineEntryId;
        // A repeat of an id already claimed by the durable timeline (or by its
        // document-source baseline). The fold state
        // (`currentLayers`, `currentFrame`, `currentSelections`) is deliberately
        // LEFT ADVANCED: the legacy timeline is authoritative and the duplicate is
        // a real edit, so the operations derived after it must see the state the
        // legacy timeline would have produced. `replayHistory` also advances
        // through a repeat — it addresses entries by position and applies both —
        // so NOT advancing would add a second, independent way for a later
        // derivation to disagree with the legacy timeline.
        //
        // The cost is stated here because it is real: `deriveSetDocumentFrameEntry`
        // documents `currentFrame` as the last enabled DURABLE frame, and after a
        // skip that invariant is false, so a later `set-document-frame` can carry
        // a `previous` frame the durable history never reached. Nothing reads
        // `previous` today — `durable-replay.ts` applies `next` only, as
        // `set-selection` applies `after` only — so this is a latent hazard for
        // the day something does, not a live wrong answer.
        //
        // Only the publication is withheld. The cursor map below records the
        // preceding durable index, the same handling a dropped rename gets.
        diagnostics.push({
          historyId: item.id,
          actionName: item.actionName,
          severity: 'warning',
          code: 'invalid-history-entry',
          message: isBaselineId
            ? `History entry ${item.id} (${item.actionName}) reuses the id of the baseline document-source entry, so it was not published as a durable entry. The baseline is not itself in durable history, but its id is already meaningful to the legacy timeline and must remain unique.`
            : `History entry ${item.id} (${item.actionName}) repeats an id already published as a durable entry, so it was not published again. A history entry id must be unique within a document: the edit it describes is missing from the durable document, and every entry after it was derived from the state this one would have produced, which that document does not reach.`,
        });
      } else {
        publishedEntryIds.add(item.id);
        entries.push(entry(item.id, operation, enabled));
      }
    }
    legacyCursorToDurableCursor.push(entries.length - 1);
  }

  const document = freezeDurableDocument({
    documentId,
    documentRevision: options.documentRevision ?? 0,
    branchRevision: options.branchRevision ?? 0,
    durableRevision: options.durableRevision ?? entries.length,
    baseline,
    history: entries,
    cursor: entries.length - 1,
  });
  return { document, diagnostics, legacyCursorToDurableCursor: Object.freeze(legacyCursorToDurableCursor) };
}

/**
 * Conversion has runtime asset side effects, so do not expose a partial
 * document after an unsupported entry. The legacy path remains the fallback
 * until every history action has a durable equivalent.
 */
export function convertLegacyHistorySafely(
  history: readonly HistoryItem[] | DurableDocument,
  options: LegacyConversionOptions = {}
): DurableConversionAttempt {
  const registry = options.registry ?? getAssetRegistry();
  const isDurableDocument = (h: readonly HistoryItem[] | DurableDocument): h is DurableDocument =>
    !Array.isArray(h) && 'documentId' in h;
  const documentId = options.documentId ?? (isDurableDocument(history) ? history.documentId : undefined);
  const transaction = documentId ? registry.beginDocumentAssetTransaction(documentId) : undefined;

  try {
    const converted = legacyHistoryToDurable(history, { ...options, registry });
    if (converted.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      transaction?.rollback();
      return {
        status: 'unavailable',
        document: null,
        diagnostics: converted.diagnostics,
        legacyCursorToDurableCursor: converted.legacyCursorToDurableCursor,
      };
    }
    transaction?.commit();
    registry.reconcileDocumentAssets(converted.document.documentId, collectDurableAssetIds(converted.document));
    return { status: 'current', ...converted };
  } catch (error) {
    transaction?.rollback();
    return {
      status: 'unavailable',
      document: null,
      diagnostics: [diagnosticFromError(error)],
      legacyCursorToDurableCursor: [],
    };
  }
}

/** Named alias used at the compatibility boundary by importers and callers. */
export const convertLegacyHistory = legacyHistoryToDurable;

export function sourceToRuntimeLayer(
  id: LayerId,
  source: LayerSource,
  layers: Map<LayerId, DurableLayerSnapshot>
): Layer {
  const size = source.isBedrock ? source.size : { width: source.pos.width, height: source.pos.height };
  const pos = source.isBedrock ? { x: 0, y: 0, ...size } : { ...source.pos };
  return {
    id,
    name: source.kind === 'image' ? (source.name ?? 'Image') : source.kind === 'tool' ? source.args.toolName : 'Blank',
    isBedrock: !!source.isBedrock,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: source.kind === 'tool' ? toolLayerBlendMode(source.args) : 'source-over',
    order: Math.max(-1, ...[...layers.values()].map((layer) => layer.order)) + 1,
    pos,
    source,
    operations: [],
    bitmap: source.kind === 'image' ? source.bitmap : null,
    tmpCanvas: null,
  };
}

export function createDurableDocument(
  input: Omit<DurableDocument, 'durableRevision'> & { durableRevision?: number }
): DurableDocument {
  return freezeDurableDocument({ ...input, durableRevision: input.durableRevision ?? 0 });
}

export function appendDurableEntry(document: DurableDocument, next: DurableHistoryEntry): DurableDocument {
  const history = [...document.history.slice(0, document.cursor + 1), next];
  return freezeDurableDocument({
    ...cloneDurableDocument(document),
    history,
    cursor: history.length - 1,
    branchRevision: document.branchRevision + 1,
    durableRevision: document.durableRevision + 1,
  });
}

export function toggleDurableEntry(document: DurableDocument, entryId: string): DurableDocument {
  const index = document.history.findIndex((historyEntry) => historyEntry.id === entryId);
  if (index < 0) return document;
  const history = document.history.map((historyEntry, historyIndex) =>
    historyIndex === index ? Object.freeze({ ...historyEntry, enabled: !historyEntry.enabled }) : historyEntry
  );
  return freezeDurableDocument({
    ...document,
    history,
    branchRevision: document.branchRevision + 1,
    durableRevision: document.durableRevision + 1,
  });
}

export function setDurableCursor(document: DurableDocument, cursor: number): DurableDocument {
  if (!Number.isInteger(cursor) || cursor < -1 || cursor >= document.history.length) return document;
  return cursor === document.cursor
    ? document
    : freezeDurableDocument({ ...document, cursor, durableRevision: document.durableRevision + 1 });
}
