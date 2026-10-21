import { v4 as uuidv4 } from 'uuid';
import { isEqual } from 'lodash-es';

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
  type ReplaceLayerSourceOperation,
  type SelectionSnapshot,
  type AssetId,
  cloneDurableDocument,
  cloneLayerSnapshot,
  collectDurableAssetIds,
  freezeDurableDocument,
  refreezeDurableDocument,
  toLayerSnapshot,
} from './history-model.ts';
import { durableEntryProvenance } from './history-provenance.ts';
import type { HistoryItem } from './history-types.ts';
import {
  isLayerBlendMode,
  type Layer,
  type LayerId,
  type LayerSource,
  type LayersRecord,
  type ToolLayerSource,
} from './layer-types.ts';
import type { BitmapSource, Size } from './general-types.ts';
import type { NewBedrockSize, ToolArgs } from './tool-types.ts';
import { deriveSelectionBaseline, selectionSnapshot } from './selection-baseline.ts';
import {
  getTransformFromHistoryArgs,
  isIdentityAffineTransform,
  isTrapezoidOnlyTransform,
  validateAffineTransform,
  type AffineTransform,
} from './affine-transform.ts';
import type { ActionType } from '../util/constants.ts';
import {
  HIDE_LAYER_ACTION,
  LOCK_LAYER_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  OPEN_DOCUMENT_ACTION,
  REMOVE_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  SELECTION_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SET_LAYER_BLEND_MODE_ACTION,
  SET_LAYER_OPACITY_ACTION,
  SHOW_LAYER_ACTION,
  TOOL_ACTION,
  UNLOCK_LAYER_ACTION,
} from '../util/constants.ts';
import { deriveLayerNameAndOrder, type LayerOrderRecord, toolLayerBlendMode } from './layer-utils.ts';
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
  /** The first legacy index whose enabled entry could not be converted exactly. */
  firstErrorIndex?: number;
}>;

/**
 * `partial` means an enabled entry produced a blocking conversion diagnostic, so
 * a prefix may be useful for diagnostics, but no exact durable document is
 * publishable yet. Diagnostics from disabled legacy rows do not block parity.
 * The safe boundary deliberately returns no document or cursor map for it.
 */
export type DurableConversionStatus = 'current' | 'partial' | 'unavailable';

export type DurableSafePrefixProjection = Readonly<{
  /** The exact prefix before the first failing legacy entry. */
  document: DurableDocument;
  /** Cursor mappings are present only through `safeThroughLegacyCursor`. */
  legacyCursorToDurableCursor: readonly number[];
  safeThroughLegacyCursor: number;
  /** Releases the independent prefix owner and any assets it registered. */
  release: () => void;
}>;

export type DurableConversionAttempt = Readonly<{
  status: DurableConversionStatus;
  document: DurableDocument | null;
  diagnostics: readonly MigrationDiagnostic[];
  legacyCursorToDurableCursor: readonly number[];
  /** Diagnostic-only exact prefix; never a current StoreData projection. */
  safePrefix?: DurableSafePrefixProjection;
}>;

export type LegacyConversionOptions = Readonly<{
  documentId?: string;
  documentRevision?: number;
  branchRevision?: number;
  durableRevision?: number;
  initialSize?: Size;
  initialFrame?: DocumentFrame;
  /** Asset owner used for diagnostic-only conversions; defaults to documentId. */
  assetOwnerId?: string;
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
    // was enough to lose the document.
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

function registerRaster(registry: AssetRegistry, assetOwnerId: string, bitmap: BitmapSource): AssetId {
  // Legacy history/runtime layers retain ownership until the durable model is
  // authoritative. The diagnostic sidecar must never close their bitmaps.
  return registry.registerBaseline(assetOwnerId, bitmap, { ownership: 'borrow' });
}

/**
 * The tool names whose layer source is an editable, typed source, and the kind
 * each becomes.
 *
 * One rule, because two decisions depend on it and must not disagree: which
 * sources {@link convertSource} may type rather than leaving as `legacy-tool`,
 * and which legacy source a source edit is allowed to install. A tool added here
 * becomes editable by the conversion and the source edit together.
 */
export function durableSourceKindForTool(toolName: string): 'text' | 'vector' | 'paint' | null {
  if (toolName === 'text') return 'text';
  if (['shape', 'rectangle', 'ellipse', 'triangle', 'polygon', 'line'].includes(toolName)) return 'vector';
  if (['draw', 'brush', 'pencil'].includes(toolName)) return 'paint';
  return null;
}

export function editableDurableSourceKind(toolName: string): 'text' | 'vector' | null {
  const kind = durableSourceKindForTool(toolName);
  return kind === 'text' || kind === 'vector' ? kind : null;
}

/**
 * The tool arm of {@link convertSource}, with no document id and no registry in
 * reach — because it needs neither.
 *
 * An extraction, not a second copy of the rule: a `kind: 'tool'` source's durable
 * form is derived entirely from the source itself and the layer box it was
 * authored against, so the raster registration the other two arms perform has no
 * call site here. Keeping that structural is what lets
 * `deriveReplaceLayerSourceEntry` plan a source edit with no store in reach at
 * all, and it is also what would stop a future `tool` arm from quietly acquiring
 * a registry dependency — the extraction is where that would have to be undone.
 */
function convertToolSource(source: ToolLayerSource, layer: Layer): DurableLayerSource {
  const size = sourceSize(source);
  const isBedrock = !!source.isBedrock;
  const args = plainObject(source.args, `layer:${layer.id}.source.args`);
  const kind = durableSourceKindForTool(source.args.toolName) ?? 'legacy-tool';
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

function convertSource(
  source: LayerSource,
  layer: Layer,
  assetOwnerId: string,
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
        assetId: registerRaster(registry, assetOwnerId, source.bitmap),
        width: source.bitmap.width,
        height: source.bitmap.height,
        ...(source.name ? { name: source.name } : {}),
        isBedrock,
      });
    case 'tool':
      return convertToolSource(source, layer);
  }
}

export function convertLayer(layer: Layer, assetOwnerId: string, registry: AssetRegistry): DurableLayerSnapshot {
  if (!layer.source) {
    if (!layer.bitmap)
      throw new UnsupportedHistoryFeatureError(`Layer ${layer.id} has no durable source or raster materialization`);
    const assetId = registerRaster(registry, assetOwnerId, layer.bitmap);
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
    convertSource(layer.source, layer, assetOwnerId, registry)
  );
}

function snapshotLayers(layers: LayersRecord, assetOwnerId: string, registry: AssetRegistry): DurableLayerSnapshot[] {
  return Object.values(layers)
    .sort((left, right) => left.order - right.order)
    .map((layer) => convertLayer(layer, assetOwnerId, registry));
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
 * The frame an ENABLED first entry establishes when it is a bedrock source rather than a
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
 * For an enabled first entry it outranks `options.initialFrame` deliberately, and
 * for the same reason legacy replay does: that option is the store's CURRENT frame,
 * which a later crop has already moved, while legacy replay restores the bedrock
 * size when the cursor walks back to index 0. A converter that preferred it would
 * describe cursor -1 as the cropped document, so the two models would disagree at
 * exactly the cursor where the user can undo into the un-cropped original.
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

function entry<Op extends DurableOperation>(item: HistoryItem, operation: Op, enabled = true): DurableHistoryEntry<Op> {
  return Object.freeze({
    id: item.id,
    schemaVersion: DURABLE_SCHEMA_VERSION,
    enabled,
    provenance: durableEntryProvenance(item),
    operation,
  });
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
  const args = item.args as
    { previousFrame?: DocumentFrame; nextFrame?: DocumentFrame; transform?: AffineTransform } | undefined;
  if (!isValidDocumentFrame(args?.nextFrame)) return null;
  let transform: AffineTransform | null = null;
  if (args?.transform !== undefined) {
    try {
      transform = validateAffineTransform(args.transform);
    } catch {
      return null;
    }
  }
  const previous = args?.previousFrame ?? { ...currentFrame };
  const next = { ...args.nextFrame };
  const operation =
    transform && !isIdentityAffineTransform(transform)
      ? Object.freeze({ kind: 'transform-document' as const, previous, next, transform })
      : Object.freeze({ kind: 'set-document-frame' as const, previous, next });
  return entry(item, operation, isEntryEnabled(item));
}

/**
 * Structural guard for a durable selection snapshot.
 *
 * A key-absent `activeSelectionId` is ACCEPTED, because `replayHistory` reads it
 * as `next?.activeSelectionId ?? null` in `replayHistory`'s `SELECTION_ACTION`
 * arm: a snapshot that omits the id still retains its selections and only loses
 * the active id.
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
  return entry(item, operation, isEntryEnabled(item));
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
 * widening it to `keyof DurableLayerPropertyPatch` would let a new action own a
 * property without an explicit derivation and validation arm. That is also why
 * an action must not own a property without adding its explicit derivation branch.
 */
type LayerPropertyKey = 'visible' | 'name' | 'opacity' | 'blendMode' | 'locked';

const LAYER_PROPERTY_BY_ACTION = {
  [SHOW_LAYER_ACTION]: 'visible',
  [HIDE_LAYER_ACTION]: 'visible',
  [RENAME_LAYER_ACTION]: 'name',
  [SET_LAYER_OPACITY_ACTION]: 'opacity',
  [SET_LAYER_BLEND_MODE_ACTION]: 'blendMode',
  [LOCK_LAYER_ACTION]: 'locked',
  [UNLOCK_LAYER_ACTION]: 'locked',
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
  } else if (LAYER_PROPERTY_BY_ACTION[item.actionName] === 'opacity') {
    const opacity = (item.args as { opacity?: unknown } | undefined)?.opacity;
    if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) return null;
    patch = { opacity };
  } else if (LAYER_PROPERTY_BY_ACTION[item.actionName] === 'blendMode') {
    const blendMode = (item.args as { blendMode?: unknown } | undefined)?.blendMode;
    if (!isLayerBlendMode(blendMode)) return null;
    patch = { blendMode };
  } else if (LAYER_PROPERTY_BY_ACTION[item.actionName] === 'locked') {
    patch = { locked: item.actionName === LOCK_LAYER_ACTION };
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
  return entry(item, operation, isEntryEnabled(item));
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
  return entry(item, operation, isEntryEnabled(item));
}

/**
 * The legacy carrier of a source edit: the REPLACEMENT source under
 * `args.source`, which is where `updateLayer(id, patch, actionName)` already puts
 * a layer patch.
 *
 * `null` for every shape that is not an installable editable source, and each
 * refusal is a rule rather than a missing arm:
 *
 * - A `layerSource` on the item means the entry carries a source of its own, and
 *   `NEW_LAYER` / `MERGE` / a `TOOL_ACTION` source own that. A source edit
 *   describes the source of a layer that already exists, so an entry that also
 *   carries a creation source is not one.
 * - A `kind: 'tool'` source whose tool has no editable durable representation is
 *   the `legacy-tool` case `convertSource` already refuses to type.
 * - A bedrock source is refused because a bedrock source's SIZE IS THE DOCUMENT.
 *   `replayHistory` honours it as the frame only for the entry that opened the
 *   document and refuses it mid-history, and this operation cannot write the
 *   frame at all — only `set-document-frame` does. So a bedrock replacement is
 *   not expressible here, and the product path that does replace a background
 *   layer's content is an explicit conversion, not a source edit.
 *
 * This is the single reader of the legacy shape. The derivation below and the
 * append-boundary grading in `history-append.ts` both go through it, the way
 * `legacyToolArgs` is shared there, so neither restates the carrier.
 */
export function editableSourceReplacementFromEntry(item: HistoryItem): ToolLayerSource | undefined {
  if (item.layerSource) return undefined;
  const candidate = (item.args as { source?: unknown } | undefined)?.source;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  if ((candidate as { kind?: unknown }).kind !== 'tool') return undefined;
  const source = candidate as ToolLayerSource;
  const toolName = (source.args as { toolName?: unknown } | undefined)?.toolName;
  if (typeof toolName !== 'string' || !editableDurableSourceKind(toolName)) return undefined;
  if (source.isBedrock) return undefined;
  return source;
}

/**
 * The single derivation of the source-edit operation, shared by conversion AND
 * the Phase 1 append boundary, for the reason every other derivation here is
 * shared: a published entry and a converted entry for one legacy item must be the
 * same entry, or the shadow and the authority stop describing the same edit.
 *
 * It takes NO store context — no document id, no registry — and that is the load-
 * bearing property rather than an omission. The reader admits only a `kind:
 * 'tool'` source, and `convertToolSource` is the one arm of layer-source
 * conversion that registers nothing, so there is nothing here for a registry to
 * resolve or a transaction to own. That is what makes the derivation callable
 * from `translate()`, which sees no store, and therefore what makes a source edit
 * APPENDABLE instead of conversion-only: `planHistoryAppend` can plan one from
 * nothing but the entry and its live arguments, exactly as it plans a rename.
 *
 * The two consistency requirements of the payload therefore hold by construction
 * rather than by review: a non-bedrock source's `size` is `sourceSize(source)` —
 * the box's width and height — and its `sourcePos` is the box the replacement was
 * authored against, which is the `pos` this operation carries.
 *
 * The layer map handed to `sourceToRuntimeLayer` is empty deliberately. That
 * helper derives an `order` from the layers it is given; this operation replaces
 * the source of a layer that already exists, so the layer's order is the existing
 * layer's, the derived one is discarded, and requiring the caller to supply the
 * layer set would buy a field nothing reads.
 */
export function deriveReplaceLayerSourceEntry(
  item: HistoryItem
): DurableHistoryEntry<ReplaceLayerSourceOperation> | null {
  const replacement = editableSourceReplacementFromEntry(item);
  if (!replacement) return null;
  const runtime = sourceToRuntimeLayer(item.layerId, replacement, new Map());
  // `convertToolSource` rather than `convertLayer`, and that is the whole reason
  // the derivation needs no store: it is the one arm of source conversion that
  // registers no asset, so there is no registry here to fake and no document id to
  // invent. Reaching for `convertLayer` instead would require a throw-only
  // registry stub, which would only make the same claim less checkably.
  const source = convertToolSource(replacement, runtime);
  // Unreachable while this function and `editableDurableSourceKind` agree, and
  // stated so that loosening either one cannot silently widen the payload type.
  if (source.kind !== 'text' && source.kind !== 'vector') return null;
  const operation: ReplaceLayerSourceOperation = Object.freeze({
    kind: 'replace-layer-source',
    layerId: item.layerId,
    source,
    pos: Object.freeze({ ...runtime.pos }),
  });
  return entry(item, operation, isEntryEnabled(item));
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
  // `HistoryItem.disabled` is the only legacy replay gate. An `enabled` field
  // nested in action args belongs to that action's payload and must not make
  // the durable fold skip an entry that replayHistory will apply.
  return !item.disabled;
}

function duplicateChangesLegacyState(
  operation: DurableOperation,
  layersBefore: ReadonlyMap<LayerId, DurableLayerSnapshot>,
  frameBefore: DocumentFrame,
  selectionsBefore: SelectionSnapshot
): boolean {
  switch (operation.kind) {
    case 'set-layer-properties': {
      const layer = layersBefore.get(operation.layerId);
      if (!layer) return false;
      const before = layer as unknown as Record<string, unknown>;
      return Object.entries(operation.patch).some(([key, value]) => !isEqual(before[key], value));
    }
    case 'remove-layer':
      return layersBefore.has(operation.layerId);
    case 'reposition-layer': {
      const layer = layersBefore.get(operation.layerId);
      if (!layer) return false;
      if (operation.move && (layer.pos.x !== operation.move.x || layer.pos.y !== operation.move.y)) {
        return true;
      }
      if (operation.resize && !isEqual(layer.pos, operation.resize)) {
        return true;
      }
      return false;
    }
    case 'reorder-layers':
      return Object.entries(operation.orderByLayerId).some(
        ([layerId, order]) => layersBefore.get(layerId)?.order !== order
      );
    case 'set-document-frame':
      return !isEqual(frameBefore, operation.next);
    case 'transform-document':
      return !isEqual(frameBefore, operation.next) || !isIdentityAffineTransform(operation.transform);
    case 'set-selection':
      return !isEqual(selectionsBefore, operation.after);
    case 'replace-layer-source': {
      const layer = layersBefore.get(operation.layerId);
      if (!layer) return false;
      return !isEqual(layer.source, operation.source) || !isEqual(layer.pos, operation.pos);
    }
    default:
      // Creation, merge, raster, filter, and affine operations are retained
      // operations even when their arguments happen to repeat; they change the
      // durable operation stream and cannot be proven no-op from the snapshot.
      return true;
  }
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
  if (processor.replay.kind === 'unimplemented') {
    throw new UnsupportedHistoryFeatureError(`Tool ${args.toolName} cannot be replayed durably`, item.id);
  }

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

function snapshotFromDocumentSource(item: HistoryItem, assetOwnerId: string, registry: AssetRegistry) {
  const documentSource = item.documentSource;
  if (!documentSource) return null;
  const layers = snapshotLayers(documentSource.layers, assetOwnerId, registry);
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
  const assetOwnerId = options.assetOwnerId ?? documentId;
  const registry = options.registry ?? getAssetRegistry();
  const first = legacyHistory[0];
  const firstIsEnabled = !!first && isEntryEnabled(first);
  const initialSize = options.initialSize ??
    (firstIsEnabled ? first.documentSource?.size : undefined) ?? { width: 1, height: 1 };
  // Both branches must seed identically, so the durable baseline reads the same
  // unbounded rule legacy replay uses. It cannot be narrowed to the pre-first-entry
  // state while a selection is created outside history: the tool-switch clear's
  // `previousSelectionState` is the only record that the selection existed, and
  // `durable-replay.ts` applies only each operation's `after`.
  const selectionBaseline = deriveSelectionBaseline(legacyHistory);
  // A source never carries a document frame. Bedrock establishes the frame only
  // at history index 0; the durable path's only frame writer is the
  // `set-document-frame` operation.
  const initial = (first && isEntryEnabled(first)
    ? snapshotFromDocumentSource(first, assetOwnerId, registry)
    : null) ?? {
    frame:
      (firstIsEnabled ? frameFromFirstEntryBedrock(first) : undefined) ??
      options.initialFrame ??
      documentFrameFromSize(initialSize),
    layers: [],
    activeLayerId: null,
  };
  const baseline: DurableBaseline = { ...initial, selections: selectionBaseline };
  const diagnostics: MigrationDiagnostic[] = [];
  const legacyCursorToDurableCursor: number[] = [];
  let firstErrorIndex: number | undefined;
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
  // history by ARRAY INDEX in `replayDurableDocument`, so no replay is misresolved
  // either way. Disabled repeats are resolver-only warnings because legacy replay
  // skips them. An enabled repeat is different: legacy applies an edit that the
  // durable history cannot publish, so the safe wrapper must withhold the exact
  // projection rather than call it current.
  //
  // Only ids that actually reached `entries` are recorded, except for the
  // document-source baseline. That source is not a durable entry, but its id is
  // still the first key the legacy timeline can resolve, so a later entry that
  // reuses it must be refused just like a published duplicate. Refused document
  // replacements and entries whose derivation throws do not consume their ids.
  const baselineEntryId = first?.documentSource ? first.id : undefined;
  const publishedEntryIds = new Set<string>(baselineEntryId ? [baselineEntryId] : []);

  for (const [legacyIndex, item] of legacyHistory.entries()) {
    const enabled = isEntryEnabled(item);
    const layersBefore = new Map(currentLayers);
    const frameBefore = { ...currentFrame };
    const selectionsBefore = currentSelections;
    if (item !== first && item.documentSource && publishedEntryIds.has(item.id)) {
      diagnostics.push({
        historyId: item.id,
        actionName: item.actionName,
        // A disabled duplicate is a parity-preserving resolver warning. An
        // enabled duplicate represents a legacy edit that the durable history
        // cannot publish, so the safe boundary must fail closed as partial.
        severity: 'warning',
        code: 'invalid-history-entry',
        message: `History entry ${item.id} (${item.actionName}) reuses the id of the baseline document-source entry, so it was not published as a durable entry. The baseline is not itself in durable history, but its id is already meaningful to the legacy timeline and must remain unique.`,
      });
      legacyCursorToDurableCursor.push(entries.length - 1);
      continue;
    }
    if (!enabled && publishedEntryIds.has(item.id)) {
      diagnostics.push({
        historyId: item.id,
        actionName: item.actionName,
        severity: 'warning',
        code: 'invalid-history-entry',
        message: `History entry ${item.id} (${item.actionName}) repeats an id already published as a durable entry, but legacy replay skips this disabled entry. It was not published again so legacy and durable id resolvers continue to target the first occurrence.`,
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
        severity: enabled ? 'error' : 'warning',
        code: 'document-replacement',
        message: 'Document replacement must create a new durable document and cannot appear inside a document history.',
      });
      if (enabled) firstErrorIndex ??= legacyIndex;
      legacyCursorToDurableCursor.push(entries.length - 1);
      continue;
    }
    let operation: DurableOperation | null = null;
    try {
      const source = item.layerSource ?? asLegacyLayerSource(item.args);
      if ((item.actionName === NEW_LAYER_ACTION || (item.actionName === TOOL_ACTION && source)) && source) {
        const runtimeLayer = sourceToRuntimeLayer(item.layerId, source, currentLayers);
        const layer = convertLayer(runtimeLayer, assetOwnerId, registry);
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
        // in `replayHistory`'s `REORDER_ACTION` arm, leaving the order untouched,
        // so conversion records nothing and leaves `currentLayers` alone. A named but missing
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
          let orderByLayerId = order;
          // Reordering a layer after itself preserves the runtime sequence.
          if (afterWhichLayerId !== layerToMoveId) {
            const remaining = Object.keys(order).filter((id) => id !== layerToMoveId);
            const targetIndex = afterWhichLayerId ? remaining.indexOf(afterWhichLayerId) + 1 : 0;
            remaining.splice(Math.max(0, targetIndex), 0, layerToMoveId);
            orderByLayerId = Object.fromEntries(remaining.map((id, index) => [id, index]));
          }
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
          // `replayHistory` drops a frame action whose `nextFrame` is not valid:
          // its `SET_DOCUMENT_FRAME_ACTION` arm guards the assignment with
          // `isValidDocumentFrame`, so the shadow stays in PARITY for enabled
          // entries. A disabled entry is not parity: legacy replay skips it
          // before dispatch. Bedrock is parity at every index because legacy
          // replay and `frameFromFirstEntryBedrock` both use only the initial
          // entry to establish the frame.
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
        const layer = convertLayer(runtimeLayer, assetOwnerId, registry);
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
        // The tail is where a source edit is recognized, and its position is the
        // guarantee that it claims nothing another arm owns: every action a
        // creation, a merge, a layer property, a removal, a reorder, a frame, a
        // selection or a tool argument already handles has returned above, so
        // anything still here is an action this converter does not have a rule
        // for. A new action carrying a replacement source lands here; an action
        // carrying no replacement source still reports `Unsupported legacy
        // action`, which is the pre-existing behaviour for every unknown action.
        const replaceEntry = deriveReplaceLayerSourceEntry(item);
        if (!replaceEntry) {
          throw new UnsupportedHistoryFeatureError(`Unsupported legacy action ${item.actionName}`, item.id);
        }
        operation = replaceEntry.operation;
        if (replaceEntry.enabled) {
          // The fold advances so the entries derived after this one see the source
          // and box the legacy timeline would produce — the affine-geometry
          // derivation reads `layer.pos`, and a reorder reads the layer set. The
          // layer's absence is not a refusal, matching `replayHistory`, which
          // skips a property change to an id it does not hold.
          const layer = currentLayers.get(item.layerId);
          if (layer) {
            currentLayers.set(
              item.layerId,
              cloneLayerSnapshot({ ...layer, source: replaceEntry.operation.source, pos: replaceEntry.operation.pos })
            );
          }
        }
      }
    } catch (error) {
      const diagnostic = diagnosticFromError(error, item);
      diagnostics.push(diagnostic);
      if (enabled && diagnostic.severity === 'error') firstErrorIndex ??= legacyIndex;
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
        // Disabled repeats preserve parity because legacy replay skips them.
        // Enabled repeats are partial only when the operation changes the
        // legacy snapshot. Proven idempotent or absent-layer no-ops remain
        // warning-only. The cursor map below remains useful to the raw
        // converter but is removed by convertLegacyHistorySafely for errors.
        const duplicateIsStateChanging = Boolean(
          enabled && operation && duplicateChangesLegacyState(operation, layersBefore, frameBefore, selectionsBefore)
        );
        diagnostics.push({
          historyId: item.id,
          actionName: item.actionName,
          severity: duplicateIsStateChanging ? 'error' : 'warning',
          code: 'invalid-history-entry',
          message: isBaselineId
            ? `History entry ${item.id} (${item.actionName}) reuses the id of the baseline document-source entry, so it was not published as a durable entry. The baseline is not itself in durable history, but its id is already meaningful to the legacy timeline and must remain unique.`
            : `History entry ${item.id} (${item.actionName}) repeats an id already published as a durable entry, so it was not published again. A history entry id must be unique within a document: the edit it describes is missing from the durable document, and every entry after it was derived from the state this one would have produced, which that document does not reach.`,
        });
        if (duplicateIsStateChanging) firstErrorIndex ??= legacyIndex;
      } else {
        publishedEntryIds.add(item.id);
        entries.push(entry(item, operation, enabled));
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
  return {
    document,
    diagnostics,
    legacyCursorToDurableCursor: Object.freeze(legacyCursorToDurableCursor),
    ...(firstErrorIndex === undefined ? {} : { firstErrorIndex }),
  };
}

function buildSafePrefixProjection(
  history: readonly HistoryItem[],
  options: LegacyConversionOptions,
  registry: AssetRegistry,
  documentId: string,
  firstErrorIndex: number
): DurableSafePrefixProjection | undefined {
  const ownerId = `${documentId}:partial:${uuidv4()}`;
  try {
    const prefix = legacyHistoryToDurable(history.slice(0, firstErrorIndex), {
      ...options,
      documentId,
      assetOwnerId: ownerId,
      registry,
    });
    if (prefix.firstErrorIndex !== undefined) {
      registry.disposeDocument(ownerId);
      return undefined;
    }
    let released = false;
    return {
      document: prefix.document,
      legacyCursorToDurableCursor: prefix.legacyCursorToDurableCursor,
      safeThroughLegacyCursor: firstErrorIndex - 1,
      release: () => {
        if (released) return;
        released = true;
        registry.disposeDocument(ownerId);
      },
    };
  } catch {
    registry.disposeDocument(ownerId);
    return undefined;
  }
}

/**
 * Conversion has runtime asset side effects, so do not expose a partial
 * document after an enabled unsupported entry. The legacy path remains the
 * fallback until every history action has a durable equivalent.
 */
export function convertLegacyHistorySafely(
  history: readonly HistoryItem[] | DurableDocument,
  options: LegacyConversionOptions = {}
): DurableConversionAttempt {
  if (Array.isArray(history) && options.documentId === undefined) {
    throw new Error('convertLegacyHistorySafely: documentId is required when converting a legacy history array');
  }
  const registry = options.registry ?? getAssetRegistry();
  const isDurableDocument = (h: readonly HistoryItem[] | DurableDocument): h is DurableDocument =>
    !Array.isArray(h) && 'documentId' in h;
  const documentId = options.documentId ?? (isDurableDocument(history) ? history.documentId : undefined);
  const assetOwnerId = options.assetOwnerId ?? documentId;
  const transaction = assetOwnerId ? registry.beginDocumentAssetTransaction(assetOwnerId) : undefined;

  try {
    const converted = legacyHistoryToDurable(history, { ...options, registry });
    if (converted.firstErrorIndex !== undefined) {
      transaction?.rollback();
      const safePrefix =
        Array.isArray(history) && documentId !== undefined && converted.firstErrorIndex !== undefined
          ? buildSafePrefixProjection(history, options, registry, documentId, converted.firstErrorIndex)
          : undefined;
      return {
        // This is a conversion-quality failure, not an infrastructure throw.
        // Keep it distinct from `unavailable` so callers can report that a
        // partial projection exists without ever treating it as exact.
        status: 'partial',
        document: null,
        diagnostics: converted.diagnostics,
        // A conversion error makes the fold after the offending entry
        // unproven: later operations may have been derived from stale state.
        // The document is withheld, so exposing that map would let a caller
        // pair legacy cursors with a durable timeline that is not available.
        legacyCursorToDurableCursor: [],
        ...(safePrefix ? { safePrefix } : {}),
      };
    }
    transaction?.commit();
    if (assetOwnerId) registry.reconcileDocumentAssets(assetOwnerId, collectDurableAssetIds(converted.document));
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

/**
 * The durable converter's source-to-runtime rule, and nothing but a delegation for
 * the two fields the runtime rule owns.
 *
 * It used to re-derive the layer from the source here, binding the bare kind as
 * `name` and folding `Math.max(-1, ...orders) + 1` for `order`. That was a second
 * rule, and it disagreed with `createLayerSource` — the rule `replayHistory` builds
 * a layer through, wired at `useHistory.ts` — on the first layer of any document:
 * `'Blank'` at order `0` here, `'Blank 1'` at order `1` there, and no `ellipsify` on
 * a long image name on this side. Two live tests pinned the two answers, so neither
 * was accidental; the runtime rule is what the document means and this is the copy,
 * so the copy derives through {@link deriveLayerNameAndOrder} — the derivation
 * `createLayerSource` itself makes — rather than keeping a second one.
 *
 * `name` and `order` are read together because they are one derivation: the number
 * in the name suffix IS the order, so taking one from the runtime rule and folding
 * the other here would leave a third rule rather than one of the two.
 *
 * The layer set is read for its orders alone (`LayerOrderRecord`), so a durable
 * snapshot is as good a witness as a runtime `Layer` — which is what makes the rule
 * reachable at all, since every caller here holds the former. That is also why the
 * empty map in {@link deriveReplaceLayerSourceEntry} stays meaningful: the derived
 * order is discarded there, exactly as the old fold's was.
 *
 * The rest of the layer stays derived here, and deliberately: `createLayerSource`
 * would also allocate a canvas per blank source and run a creator tool's
 * `imageProcessor`, and this is a conversion that wants two fields. `pos` in
 * particular is the authored box rather than the patched one, which is a separate
 * question from the one this function was re-deriving.
 */
export function sourceToRuntimeLayer(
  id: LayerId,
  source: LayerSource,
  layers: Map<LayerId, DurableLayerSnapshot>
): Layer {
  const size = source.isBedrock ? source.size : { width: source.pos.width, height: source.pos.height };
  const pos = source.isBedrock ? { x: 0, y: 0, ...size } : { ...source.pos };
  const orders: LayerOrderRecord = Object.create(null);
  for (const [layerId, layer] of layers) orders[layerId] = layer;
  const { name, order } = deriveLayerNameAndOrder(orders, source);
  return {
    id,
    name,
    isBedrock: !!source.isBedrock,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: source.kind === 'tool' ? toolLayerBlendMode(source.args) : 'source-over',
    order,
    pos,
    source,
    operations: [],
    presentationBounds: null,
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
  return refreezeDurableDocument(document, {
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
  return refreezeDurableDocument(document, {
    history,
    branchRevision: document.branchRevision + 1,
    durableRevision: document.durableRevision + 1,
  });
}

export function setDurableCursor(document: DurableDocument, cursor: number): DurableDocument {
  if (!Number.isInteger(cursor) || cursor < -1 || cursor >= document.history.length) return document;
  return cursor === document.cursor
    ? document
    : refreezeDurableDocument(document, { cursor, durableRevision: document.durableRevision + 1 });
}
