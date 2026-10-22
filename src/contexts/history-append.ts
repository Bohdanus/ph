import {
  LOCK_LAYER_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  REMOVE_ACTION,
  REORDER_ACTION,
  SELECTION_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SHOW_LAYER_ACTION,
  TOOL_ACTION,
} from '../util/constants.ts';
import { isValidDocumentFrame, type DocumentFrame } from './document-frame.ts';
import { getAssetRegistry, type AssetRegistry } from './asset-registry.ts';
import {
  asLegacyLayerSource,
  deriveRemoveLayerEntry,
  deriveReplaceLayerSourceEntry,
  deriveSetDocumentFrameEntry,
  deriveSetLayerPropertiesEntry,
  deriveSetSelectionEntry,
  durableSourceKindForTool,
  editableSourceReplacementFromEntry,
  isSetLayerPropertiesAction,
  isEntryEnabled,
  legacyLayerSourceFromItem,
  layerPropertyKeyFor,
  operationForTool,
  sourceToRuntimeLayer,
  convertLayer,
  UnsupportedHistoryFeatureError,
  type MigrationDiagnostic,
} from './history-adapter.ts';
import {
  DURABLE_SCHEMA_VERSION,
  refreezeDurableDocument,
  type AssetId,
  type DurableDocument,
  type DurableHistoryEntry,
  type DurableLayerSource,
  type DurableLayerSnapshot,
  type DurableOperation,
  type ReplaceLayerSourceOperation,
  type SelectionSnapshot,
} from './history-model.ts';
import { durableEntryProvenance } from './history-provenance.ts';
import {
  isIdentityAffineTransform,
  isTrapezoidOnlyTransform,
  multiplyAffineTransforms,
  validateAffineTransform,
  type AffineTransform,
} from './affine-transform.ts';
import type { HistoryTimeline } from './history-timeline.ts';
import type { HistoryItem, NewHistoryItem } from './history-types.ts';
import { createHistoryItem } from './history-utils.ts';
import { isLayerBlendMode, type Layer, type LayerId, type LayerSource, type ToolLayerSource } from './layer-types.ts';
import { findToolProcessor } from '../tools/toolProcessors.ts';
import type { ToolName } from './tool-types.ts';

const EMPTY_SELECTIONS: SelectionSnapshot = Object.freeze({ selections: Object.freeze([]), activeSelectionId: null });

/**
 * Phase 1 append boundary.
 *
 * Input is normalized UI/tool arguments plus the current legacy timeline.
 * Output is exactly one legacy `HistoryItem` plus either one equivalent durable
 * entry or an explicit durable-unavailable diagnostic.
 *
 * The planned durable entry is published only when `StoreContext` proves that
 * its durable shadow still describes this append's legacy pre-state. Otherwise
 * the store falls back to a full conversion and keeps legacy history/runtime
 * authority unchanged.
 *
 * Invariants:
 *
 * 1. One append mints one entry id. A caller-supplied id is preserved so the
 *    durable entry carries the same id and the legacy-to-durable cursor map
 *    keeps its identity.
 * 2. Branch truncation, cursor mapping, and disabled-entry state stay with the
 *    single reducer transition. This boundary never rewrites the timeline, and
 *    the durable entry carries `enabled` so a publisher cannot drop that gate.
 * 3. Source ownership is untouched: the entry keeps the caller's raster
 *    references, and nothing here adopts, copies, or closes a bitmap. An action
 *    whose durable form needs an asset is therefore not translated yet.
 * 4. A document-frame change never moves layer world coordinates. The durable
 *    entry comes from the adapter's own derivation, so an invalid next frame
 *    yields no durable entry instead of a frame durable replay cannot use. A
 *    selection change is held to the same rule for the same reason: an entry
 *    whose `after` was invented would clear the selection on every durable
 *    replay, so an unusable next selection state yields no durable entry.
 * 5. A boundary failure can never reject or undo a legacy-valid edit. Every
 *    failure is reported as a durable-unavailable diagnostic, and an
 *    error-severity timeline diagnostic withholds the durable plan because the
 *    durable append point is undefined.
 * 6. A source edit is the one source-backed action this boundary translates, and
 *    it is translated because its durable form needs no asset: the payload type
 *    admits only `text` and `vector`, whose conversion registers nothing. So the
 *    derivation needs neither a document id nor a registry, and the append is
 *    publishable from this module alone rather than only through the store-boundary
 *    planners. Its grading still refuses a plan carrying any other source kind.
 */
export type AppendBoundaryInput = Readonly<{
  item: NewHistoryItem;
  timeline: HistoryTimeline;
  currentFrame: DocumentFrame;
  /**
   * The selection state the durable model currently holds, used as the `before`
   * baseline when a selection entry carries no `previousSelectionState`.
   *
   * Optional so a caller with no selection context can still plan an entry, but
   * a publisher that actually passes the entry MUST pass the tracked state: a
   * defaulted empty `before` is a wrong baseline, not a harmless one.
   */
  currentSelections?: SelectionSnapshot;
  /**
   * The live layer record at the append point. Tool derivation needs its current
   * position for affine validation; a writer closure is not authoritative here.
   */
  currentLayer?: Layer;
  id?: string;
}>;

export type AppendBoundaryResult = Readonly<{
  entry: HistoryItem;
  /** `null` means the durable branch is unavailable for this append. */
  durableEntry: DurableHistoryEntry | null;
  diagnostics: readonly MigrationDiagnostic[];
}>;

function unavailable(entry: HistoryItem, message: string, code: MigrationDiagnostic['code']): AppendBoundaryResult {
  return {
    entry,
    durableEntry: null,
    diagnostics: [
      {
        historyId: entry.id,
        actionName: entry.actionName,
        severity: 'warning',
        code,
        message,
      },
    ],
  };
}

function durableEntryForOperation(entry: HistoryItem, operation: DurableOperation): DurableHistoryEntry {
  return Object.freeze({
    id: entry.id,
    schemaVersion: DURABLE_SCHEMA_VERSION,
    enabled: isEntryEnabled(entry),
    provenance: durableEntryProvenance(entry),
    operation,
  });
}

function unavailableFromError(entry: HistoryItem, error: unknown): AppendBoundaryResult {
  return unavailable(
    entry,
    error instanceof Error ? error.message : String(error),
    error instanceof UnsupportedHistoryFeatureError ? 'unsupported-history-feature' : 'invalid-history-entry'
  );
}

function sourceFromEntry(entry: HistoryItem): LayerSource | undefined {
  return legacyLayerSourceFromItem(entry);
}

function hasCanonicalDataKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => {
      if (typeof key !== 'string' || !allowed.has(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !!descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
    })
  );
}

function hasPlainDataProperties(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === 'function') return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
    if (!hasPlainDataProperties(descriptor.value, seen)) return false;
  }
  return true;
}

function hasOwnDataRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !!descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}

function hasSafeLegacyEntryData(value: unknown): value is HistoryItem {
  if (!hasOwnDataRecord(value)) return false;
  const layerSource = Object.getOwnPropertyDescriptor(value, 'layerSource');
  if (layerSource && (!layerSource.enumerable || !Object.hasOwn(layerSource, 'value'))) return false;
  if (
    layerSource &&
    layerSource.value !== undefined &&
    layerSource.value !== null &&
    !legacyLayerSourceFromItem(value as HistoryItem)
  ) {
    return false;
  }

  const args = Object.getOwnPropertyDescriptor(value, 'args');
  if (args && (!args.enumerable || !Object.hasOwn(args, 'value'))) return false;
  const argsSource = args?.value !== undefined && args.value !== null ? asLegacyLayerSource(args.value) : undefined;
  return !(
    args &&
    args.value !== undefined &&
    args.value !== null &&
    !argsSource &&
    !hasPlainDataProperties(args.value)
  );
}

function durableEntryShapeProblem(value: unknown): string | null {
  const malformed = 'the planned durable history operation is missing or malformed';
  if (!hasCanonicalDataKeys(value, ['id', 'schemaVersion', 'enabled', 'operation'], ['provenance'])) return malformed;
  if (
    typeof value.id !== 'string' ||
    typeof value.schemaVersion !== 'number' ||
    !Number.isInteger(value.schemaVersion) ||
    typeof value.enabled !== 'boolean'
  ) {
    return malformed;
  }
  const operationValue = value.operation;
  if (!operationValue || typeof operationValue !== 'object' || Array.isArray(operationValue)) return malformed;
  const operation = operationValue;
  const kindDescriptor = Object.getOwnPropertyDescriptor(operation, 'kind');
  if (!kindDescriptor?.enumerable || !Object.hasOwn(kindDescriptor, 'value')) return malformed;

  let requiredOperationKeys: readonly string[];
  let optionalOperationKeys: readonly string[] = [];
  let operationShapeReason: string;
  switch (kindDescriptor.value) {
    case 'create-layer':
      requiredOperationKeys = ['kind', 'layer'];
      operationShapeReason = 'the durable create-layer operation does not have the canonical shape';
      break;
    case 'remove-layer':
      requiredOperationKeys = ['kind', 'layerId'];
      operationShapeReason = 'the durable remove-layer operation does not have the canonical shape';
      break;
    case 'set-layer-properties':
      requiredOperationKeys = ['kind', 'layerId', 'patch'];
      operationShapeReason = 'the durable layer-property operation does not have the canonical shape';
      break;
    case 'reposition-layer':
      requiredOperationKeys = ['kind', 'layerId'];
      optionalOperationKeys = ['move', 'resize'];
      operationShapeReason = 'the durable reposition operation does not have the canonical shape';
      break;
    case 'reorder-layers':
      requiredOperationKeys = ['kind', 'orderByLayerId'];
      operationShapeReason = 'the durable layer-order operation does not have the canonical shape';
      break;
    case 'apply-filter':
      requiredOperationKeys = ['kind', 'layerId', 'filter'];
      operationShapeReason = 'the durable apply-filter operation does not have the canonical shape';
      break;
    case 'apply-affine-transform':
      requiredOperationKeys = ['kind', 'layerId', 'transform'];
      operationShapeReason = 'the durable apply-affine-transform operation does not have the canonical shape';
      break;
    case 'apply-raster-processor':
      requiredOperationKeys = ['kind', 'layerId', 'processorId', 'version', 'args'];
      operationShapeReason = 'the durable apply-raster-processor operation does not have the canonical shape';
      break;
    case 'set-document-frame':
      requiredOperationKeys = ['kind', 'previous', 'next'];
      operationShapeReason = 'the durable set-document-frame operation does not have the canonical shape';
      break;
    case 'transform-document':
      requiredOperationKeys = ['kind', 'previous', 'next', 'transform'];
      operationShapeReason = 'the durable transform-document operation does not have the canonical shape';
      break;
    case 'replace-layer-source':
      requiredOperationKeys = ['kind', 'layerId', 'source', 'pos'];
      operationShapeReason = 'the durable replace-layer-source operation does not have the canonical shape';
      break;
    case 'merge-document':
      requiredOperationKeys = ['kind', 'result', 'removedLayerIds'];
      operationShapeReason = 'the durable merge-document operation does not have the canonical shape';
      break;
    case 'set-selection':
      requiredOperationKeys = ['kind', 'before', 'after'];
      operationShapeReason = 'the durable set-selection operation does not have the canonical shape';
      break;
    default:
      return malformed;
  }
  if (!hasCanonicalDataKeys(operation, requiredOperationKeys, optionalOperationKeys)) return operationShapeReason;

  if (
    operation.kind === 'reposition-layer' &&
    ((operation.move !== undefined && !hasCanonicalFiniteNumberKeys(operation.move, ['x', 'y'])) ||
      (operation.resize !== undefined &&
        !hasCanonicalFiniteNumberKeys(operation.resize, ['x', 'y', 'width', 'height'])))
  ) {
    return operationShapeReason;
  }
  if (
    (operation.kind === 'apply-affine-transform' && !hasCanonicalAffineTransform(operation.transform)) ||
    (operation.kind === 'apply-filter' && !hasCanonicalDurableFilter(operation.filter)) ||
    (operation.kind === 'set-document-frame' &&
      (!hasCanonicalDocumentFrame(operation.previous) || !hasCanonicalDocumentFrame(operation.next))) ||
    (operation.kind === 'transform-document' &&
      (!hasCanonicalDocumentFrame(operation.previous) ||
        !hasCanonicalDocumentFrame(operation.next) ||
        !hasCanonicalAffineTransform(operation.transform))) ||
    (operation.kind === 'replace-layer-source' &&
      (!hasCanonicalDurableSourceKeys(operation.source) ||
        !hasCanonicalFiniteNumberKeys(operation.pos, ['x', 'y', 'width', 'height'])))
  ) {
    if (operation.kind === 'apply-filter' && !hasCanonicalDurableFilter(operation.filter)) {
      return 'the durable filter does not have the canonical shape';
    }
    if (operation.kind === 'replace-layer-source' && !hasCanonicalDurableSourceKeys(operation.source)) {
      return 'the durable replacement source does not have the canonical shape';
    }
    return operationShapeReason;
  }

  if (Object.hasOwn(value, 'provenance')) {
    const provenance = value.provenance;
    if (
      !hasCanonicalDataKeys(provenance, ['actionName'], ['toolName']) ||
      typeof provenance.actionName !== 'string' ||
      (provenance.toolName !== undefined && typeof provenance.toolName !== 'string')
    ) {
      return malformed;
    }
  }
  return null;
}

function hasCanonicalFiniteNumberKeys(value: unknown, keys: readonly string[]): boolean {
  return (
    hasCanonicalDataKeys(value, keys) &&
    keys.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]))
  );
}

function hasCanonicalDocumentFrame(value: unknown): value is DocumentFrame {
  return (
    hasCanonicalDataKeys(value, ['x', 'y', 'width', 'height']) &&
    ['x', 'y', 'width', 'height'].every((key) => typeof value[key] === 'number')
  );
}

function hasCanonicalAffineTransform(value: unknown): boolean {
  return (
    hasCanonicalDataKeys(value, ['a', 'b', 'c', 'd', 'e', 'f']) &&
    ['a', 'b', 'c', 'd', 'e', 'f'].every((key) => typeof value[key] === 'number')
  );
}

function hasCanonicalDurableFilter(value: unknown): boolean {
  if (!hasCanonicalDataKeys(value, ['toolName', 'version', 'args'])) return false;
  const argsPrototype = value.args && typeof value.args === 'object' ? Object.getPrototypeOf(value.args) : undefined;
  return (
    typeof value.toolName === 'string' &&
    typeof value.version === 'number' &&
    !!value.args &&
    typeof value.args === 'object' &&
    !Array.isArray(value.args) &&
    (argsPrototype === Object.prototype || argsPrototype === null) &&
    hasPlainDataProperties(value.args)
  );
}

function isCanonicalSelectionMetadata(value: unknown): boolean {
  const metadataKeys = ['copiedAtVersion', 'movedAtVersion', 'featherRadius', 'magneticLasso', 'magicWand'];
  if (!hasCanonicalDataKeys(value, [], metadataKeys)) return false;

  const numericKeys = ['copiedAtVersion', 'movedAtVersion', 'featherRadius'];
  if (
    !numericKeys.every(
      (key) => !Object.hasOwn(value, key) || (typeof value[key] === 'number' && Number.isFinite(value[key]))
    )
  ) {
    return false;
  }

  if (Object.hasOwn(value, 'magneticLasso')) {
    const magneticLasso = value.magneticLasso;
    const magneticNumberKeys = ['width', 'contrast', 'frequency', 'snapStrength', 'smoothing', 'pathPointCount'];
    if (
      !hasCanonicalDataKeys(magneticLasso, [...magneticNumberKeys, 'antiAlias']) ||
      !magneticNumberKeys.every(
        (key) => typeof magneticLasso[key] === 'number' && Number.isFinite(magneticLasso[key])
      ) ||
      typeof magneticLasso.antiAlias !== 'boolean'
    ) {
      return false;
    }
  }

  if (Object.hasOwn(value, 'magicWand')) {
    const magicWand = value.magicWand;
    const magicNumberKeys = ['tolerance', 'smoothing', 'selectedPixelCount', 'boundaryPointCount'];
    if (
      !hasCanonicalDataKeys(magicWand, [...magicNumberKeys, 'seed', 'sampleColor']) ||
      !magicNumberKeys.every((key) => typeof magicWand[key] === 'number' && Number.isFinite(magicWand[key])) ||
      !hasCanonicalFiniteNumberKeys(magicWand.seed, ['x', 'y']) ||
      !hasCanonicalFiniteNumberKeys(magicWand.sampleColor, ['r', 'g', 'b', 'a'])
    ) {
      return false;
    }
  }

  return isJsonValue(value);
}

function hasCanonicalDurableSourceKeys(source: unknown): source is DurableLayerSource {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  const kindDescriptor = Object.getOwnPropertyDescriptor(source, 'kind');
  if (!kindDescriptor?.enumerable || !Object.hasOwn(kindDescriptor, 'value')) return false;
  let sourceKeys: readonly string[];
  let optionalKeys: readonly string[] = ['isBedrock'];
  switch (kindDescriptor.value) {
    case 'blank':
      sourceKeys = ['color', 'opacity', 'size'];
      break;
    case 'raster':
      sourceKeys = ['assetId', 'width', 'height'];
      optionalKeys = ['name', 'isBedrock'];
      break;
    case 'vector':
    case 'text':
    case 'paint':
      sourceKeys = ['toolName', 'args', 'size', 'sourcePos'];
      break;
    case 'legacy-tool':
      sourceKeys = ['toolName', 'args', 'size'];
      break;
    default:
      return false;
  }
  return hasCanonicalDataKeys(source, ['kind', ...sourceKeys], optionalKeys);
}

function compareRuntimeLayerToSnapshot(runtime: Layer, snapshot: DurableLayerSnapshot): string | null {
  if (runtime.id !== snapshot.id) return 'the durable layer id does not match the legacy entry';
  if (runtime.name !== snapshot.name) return 'the durable layer name does not match the legacy source';
  if (runtime.isBedrock !== snapshot.isBedrock) return 'the durable bedrock flag does not match the legacy source';
  if (runtime.visible !== snapshot.visible) return 'the durable layer visibility does not match the legacy source';
  if (runtime.opacity !== snapshot.opacity) return 'the durable layer opacity does not match the legacy source';
  if (runtime.locked !== snapshot.locked) return 'the durable layer lock state does not match the legacy source';
  if (runtime.blendMode !== snapshot.blendMode) return 'the durable layer blend mode does not match the legacy source';
  if (!sameJsonValue(runtime.pos, snapshot.pos)) return 'the durable layer position does not match the legacy source';
  if (runtime.order !== snapshot.order) return 'the durable layer order does not match the legacy source';
  return null;
}

function compareDurableSourceToLegacy(source: LayerSource, durable: DurableLayerSnapshot): string | null {
  const sourceDescriptor = Object.getOwnPropertyDescriptor(durable, 'source');
  if (!sourceDescriptor?.enumerable || !Object.hasOwn(sourceDescriptor, 'value')) {
    return 'the durable layer source does not have the canonical shape';
  }
  const durableSource = sourceDescriptor.value;
  if (!hasCanonicalDurableSourceKeys(durableSource))
    return 'the durable layer source does not have the canonical shape';
  if (source.kind === 'blank') {
    if (durableSource.kind !== 'blank') return 'the durable layer source kind does not match the legacy source';
    if (
      durableSource.color !== source.color ||
      durableSource.opacity !== source.opacity ||
      durableSource.isBedrock !== !!source.isBedrock
    ) {
      return 'the durable blank layer source does not match the legacy source';
    }
    const size = source.isBedrock ? source.size : { width: source.pos.width, height: source.pos.height };
    return sameJsonValue(durableSource.size, size)
      ? null
      : 'the durable blank layer size does not match the legacy source';
  }

  if (source.kind === 'image') {
    if (durableSource.kind !== 'raster') return 'the durable layer source kind does not match the legacy source';
    if (
      durableSource.width !== source.bitmap.width ||
      durableSource.height !== source.bitmap.height ||
      (durableSource.name ?? undefined) !== (source.name || undefined) ||
      durableSource.isBedrock !== !!source.isBedrock
    ) {
      return 'the durable raster layer source does not match the legacy source';
    }
    // This checks only descriptor shape and dimensions. The caller checks that
    // the id is live and is registered from this exact legacy bitmap object.
    return typeof durableSource.assetId === 'string' && durableSource.assetId.length > 0
      ? null
      : 'the durable raster layer source names no asset id';
  }

  if (durableSource.kind === 'legacy-tool') {
    return `The tool ${source.args.toolName} has no durable source representation`;
  }
  const expectedKind = durableSourceKindForTool(source.args.toolName);
  if (!expectedKind || durableSource.kind !== expectedKind) {
    return 'the durable layer source kind does not match the legacy source';
  }
  if (
    durableSource.toolName !== source.args.toolName ||
    durableSource.isBedrock !== !!source.isBedrock ||
    !sameJsonValue(durableSource.args, source.args)
  ) {
    return 'the durable tool layer source does not match the legacy source';
  }
  const size = source.isBedrock ? source.size : { width: source.pos.width, height: source.pos.height };
  if (!sameJsonValue(durableSource.size, size)) return 'the durable tool layer size does not match the legacy source';
  const sourcePos = source.isBedrock ? { x: 0, y: 0, ...source.size } : source.pos;
  if (!sameJsonValue(durableSource.sourcePos, sourcePos)) {
    return 'the durable tool layer position does not match the legacy source';
  }
  return null;
}

/**
 * `set-document-frame` is the first operation canonical in both models: it
 * carries no raster, no affine normalization, and no registry ownership, so the
 * writer's own arguments determine the durable entry completely. Deriving it
 * through the adapter's helper is what keeps the planned entry and the converted
 * entry from ever disagreeing.
 *
 * `currentFrame` must be the frame the durable model currently holds, which is
 * the last enabled durable frame. A live writer observes that frame unless the
 * previous entry is disabled, in which case a publisher must re-read it instead
 * of trusting the caller.
 *
 * `set-selection` joins it for the same reason, minus the raster: it carries only
 * the two snapshots the writer already has. The difference is what its derivation
 * refuses. A next selection state that is absent or unreadable produces no entry
 * at all, because the only alternative is an empty `after` that asserts "no
 * selection" for a state the model cannot read, so such an action reports
 * `unsupported-history-feature` exactly like any other untranslated action. Note
 * the deliberate contrast with the conversion in `legacyHistoryToDurable`, which
 * clears for parity with `replayHistory` on an absent state and voids the document
 * on an unreadable one; the boundary has no second authority to stay equal to, so
 * it reports in both cases.
 */
function translate(
  entry: HistoryItem,
  currentFrame: DocumentFrame,
  currentSelections: SelectionSnapshot,
  currentLayer: Layer | undefined,
  compaction: { paths: string[] }
): AppendBoundaryResult {
  if (entry.actionName === SET_DOCUMENT_FRAME_ACTION) {
    if (entry.documentSource) {
      return unavailable(
        entry,
        'A document frame change cannot carry a document replacement; use REPLACE_DOCUMENT.',
        'document-replacement'
      );
    }
    const durableEntry = deriveSetDocumentFrameEntry(entry, currentFrame);
    if (!durableEntry) {
      return unavailable(entry, 'A document frame change requires a valid next frame.', 'invalid-history-entry');
    }
    return { entry, durableEntry, diagnostics: [] };
  }

  if (entry.documentSource) {
    return unavailable(
      entry,
      'A document source can only establish the initial baseline; appended entries cannot carry one.',
      'document-replacement'
    );
  }

  if (entry.actionName === SELECTION_ACTION) {
    const durableEntry = deriveSetSelectionEntry(entry, currentSelections);
    if (!durableEntry) {
      // A selection action whose next state is missing or unusable is one this
      // boundary does not translate, so it takes the same unsupported path as
      // every other untranslated action rather than a frame-specific code. The
      // durable model never fabricates a cleared selection to make room for it.
      return unavailable(
        entry,
        'A selection change without a valid next selection state has no durable translation; the durable model never fabricates a cleared selection.',
        'unsupported-history-feature'
      );
    }
    return { entry, durableEntry, diagnostics: [] };
  }

  if (isSetLayerPropertiesAction(entry.actionName)) {
    const durableEntry = deriveSetLayerPropertiesEntry(entry);
    if (!durableEntry) {
      return unavailable(
        entry,
        `The ${entry.actionName} entry does not carry a valid layer-property value.`,
        'invalid-history-entry'
      );
    }
    return { entry, durableEntry, diagnostics: [] };
  }

  if (entry.actionName === REMOVE_ACTION) {
    // Layer presence is deliberately not a precondition here or in validation:
    // conversion and both replay models retain unknown removals as no-ops, and
    // `replayHistory` filters the id out of the layer record rather than
    // refusing the entry (`replayHistory`'s `REMOVE_ACTION` arm filters the id). The derivation is the parity
    // path, so it has no refusal to make for a layer the document never held.
    // This guard is therefore a narrowing guard, not a check: the derivation
    // returns null only for an action that is not a removal, which this arm has
    // already excluded, so the branch below cannot be reached today.
    const durableEntry = deriveRemoveLayerEntry(entry);
    if (!durableEntry) {
      return unavailable(
        entry,
        'The removal could not be described as a durable operation, so the legacy entry remains authoritative.',
        'invalid-history-entry'
      );
    }
    return { entry, durableEntry, diagnostics: [] };
  }

  if (entry.actionName === TOOL_ACTION) {
    if (!currentLayer) {
      return unavailable(
        entry,
        `The append boundary does not translate "${entry.actionName}" without the live layer ${entry.layerId}.`,
        'unsupported-history-feature'
      );
    }
    try {
      // `operationForTool` only needs the durable layer's position today. The
      // append boundary deliberately passes the store's live record instead of
      // converting it through a registry, which keeps retained operations
      // asset-free and validates affine bounds against current geometry.
      const operation = operationForTool(entry, currentLayer as unknown as DurableLayerSnapshot, compaction);
      if (compaction.paths.length > 0) {
        return unavailable(
          entry,
          `The tool arguments contain sparse array holes at ${compaction.paths.join(', ')}, which durable replay cannot preserve faithfully.`,
          'invalid-history-entry'
        );
      }
      if (!operation) {
        return unavailable(
          entry,
          'The tool action has no retained durable operation; the legacy entry remains authoritative.',
          'unsupported-history-feature'
        );
      }
      if (operation.kind === 'reposition-layer' && !operation.move && !operation.resize) {
        return unavailable(
          entry,
          'A layer reposition without movement or resizing has no durable operation.',
          'unsupported-history-feature'
        );
      }
      if (operation.kind === 'apply-raster-processor') {
        const processor = findToolProcessor(operation.processorId as ToolName);
        if (!processor || (processor.commit === 'raster' && processor.compositesOntoInput === false)) {
          return unavailable(
            entry,
            !processor
              ? `Tool ${operation.processorId} is not registered and has no durable append translation.`
              : `Tool ${operation.processorId} creates a raster from its own input and cannot replay as a retained processor.`,
            'unsupported-history-feature'
          );
        }
        // Raster processors replay from their canonical tool arguments against
        // the durable layer source. Their output is materialized on demand, so
        // the timeline carries no bitmap snapshot or registry-owned result.
      } else if (
        operation.kind !== 'apply-filter' &&
        operation.kind !== 'apply-affine-transform' &&
        operation.kind !== 'reposition-layer'
      ) {
        return unavailable(
          entry,
          `The tool action produced unsupported durable operation "${operation.kind}".`,
          'unsupported-history-feature'
        );
      }
      return { entry, durableEntry: durableEntryForOperation(entry, operation), diagnostics: [] };
    } catch (error) {
      return unavailableFromError(entry, error);
    }
  }

  // The source-edit arm, immediately before the terminal refusal, and its
  // position is the guarantee: every action above claims its own by name, and the
  // reader refuses any entry carrying a creation `layerSource`, so what arrives
  // here with a readable replacement source is an action this boundary has no
  // other rule for.
  //
  // It is here rather than in `deriveCreateLayerEntry` at the store boundary
  // because `deriveReplaceLayerSourceEntry` needs no store: the source it installs
  // is derived from the entry alone and registers nothing. That is what makes a
  // source edit publishable from `planHistoryAppend` — the one gate RQ-2's
  // "appendable, not conversion-only" turns on. `preLayerOrder`, `preLayers` and
  // the registry are the other three source-backed preconditions and none of them
  // applies: the operation states the layer's source outright and re-measures the
  // box from it, so there is nothing to read off the pre-append state and no asset
  // whose liveness needs proving.
  const replaceEntry = deriveReplaceLayerSourceEntry(entry);
  if (replaceEntry) return { entry, durableEntry: replaceEntry, diagnostics: [] };

  return unavailable(
    entry,
    `The append boundary does not translate "${entry.actionName}" yet; the legacy entry remains authoritative.`,
    'unsupported-history-feature'
  );
}

/**
 * The durable order a legacy reorder must produce, recomputed here rather than
 * read out of `legacyHistoryToDurable`.
 *
 * A reorder is the one translated action whose durable operation cannot be a
 * function of the history item: `orderByLayerId` names the resulting position of
 * *every* layer, and the item carries only the intent. So the answer has to come
 * from the pre-append layer order, and the only trustworthy copy of that is the
 * store's live record — a hook closure is 200 ms stale by the time a drag
 * dispatches.
 *
 * This is deliberately a second implementation of the rule rather than a call
 * into the converter's. Reusing the converter's copy would make a bug in it
 * reproduce itself here, which is the opposite of a check. Two copies can drift,
 * so `history-append.reorder.test.ts` pins them against each other over a
 * matrix of orders and intents, and the store test pins the published document
 * against a full conversion.
 *
 * `preOrder` is the layer sequence bottom first — index 0 is the bottom of the
 * stack — which is the same sequence `reorderLayers` and `replayHistory` operate
 * on, and the same one the converter normalizes its own layer snapshots into.
 *
 * A `null` result means the mover or a named anchor is absent from the live
 * order, so the intent cannot produce a valid reorder. Anchoring a layer after
 * itself is a valid no-op in sequence terms: it returns the normalized current
 * order, matching `reorderLayers` and the converter.
 */
export function reorderOrderAfterIntent(
  preOrder: readonly LayerId[],
  intent: { layerToMoveId: LayerId; afterWhichLayerId?: LayerId | null }
): Readonly<Record<LayerId, number>> | null {
  if (!intent.layerToMoveId) return null;
  if (!preOrder.includes(intent.layerToMoveId)) return null;
  if (intent.afterWhichLayerId && !preOrder.includes(intent.afterWhichLayerId)) return null;
  if (intent.afterWhichLayerId === intent.layerToMoveId) {
    return Object.freeze(Object.fromEntries(preOrder.map((id, index) => [id, index])));
  }

  const remaining = preOrder.filter((id) => id !== intent.layerToMoveId);
  // A falsy anchor means the bottom, which is index 0 here. A named anchor is
  // known to be present, so `indexOf` cannot be -1 and the `+ 1` is its slot.
  const targetIndex = intent.afterWhichLayerId ? remaining.indexOf(intent.afterWhichLayerId) + 1 : 0;
  remaining.splice(targetIndex, 0, intent.layerToMoveId);
  return Object.freeze(Object.fromEntries(remaining.map((id, index) => [id, index])));
}

/**
 * The durable entry for a legacy reorder, or `null` when the append is not a
 * reorder or the intent does not apply to the store's layer order.
 *
 * `preOrder` is `null`/absent at every caller that cannot see the live record —
 * including `planHistoryAppend`, which is why reorder is absent from
 * `translate` and planned at the store boundary instead.
 */
export function deriveReorderLayersEntry(
  item: HistoryItem,
  preOrder: readonly LayerId[] | null | undefined
): DurableHistoryEntry | null {
  if (item.actionName !== REORDER_ACTION) return null;
  if (!preOrder) return null;
  const args = item.args as { layerToMoveId?: LayerId; afterWhichLayerId?: LayerId | null } | undefined;
  const layerToMoveId = args?.layerToMoveId;
  if (!layerToMoveId) return null;
  const orderByLayerId = reorderOrderAfterIntent(preOrder, {
    layerToMoveId,
    afterWhichLayerId: args?.afterWhichLayerId,
  });
  if (!orderByLayerId) return null;
  return Object.freeze({
    id: item.id,
    schemaVersion: DURABLE_SCHEMA_VERSION,
    enabled: isEntryEnabled(item),
    provenance: durableEntryProvenance(item),
    operation: Object.freeze({ kind: 'reorder-layers' as const, orderByLayerId }),
  });
}

/**
 * Inputs needed by the store-boundary source-backed planners. The registry and
 * document id are intentionally absent from `AppendBoundaryInput`: a source
 * backed entry may register a raster, so only the store can own this step.
 */
export type SourceBackedEntryContext = Readonly<{
  documentId: string;
  registry: AssetRegistry;
  preLayers: ReadonlyMap<LayerId, DurableLayerSnapshot>;
  /** Legacy runtime witness for authored name/order and merge membership. */
  liveLayers?: Readonly<Record<LayerId, Layer>>;
}>;

function durableLayerForSource(item: HistoryItem, context: SourceBackedEntryContext): DurableLayerSnapshot | null {
  const source = sourceFromEntry(item);
  if (!source) return null;
  const runtimeLayer = sourceToRuntimeLayer(item.layerId, source, context.liveLayers ?? new Map(context.preLayers));
  const layer = convertLayer(runtimeLayer, context.documentId, context.registry);
  if (layer.source.kind === 'legacy-tool') {
    throw new UnsupportedHistoryFeatureError(
      `Tool ${layer.source.toolName} has no durable source representation`,
      item.id
    );
  }
  return layer;
}

/** Store-boundary planner for a source-backed `NEW_LAYER` append. */
export function deriveCreateLayerEntry(
  item: HistoryItem,
  context: SourceBackedEntryContext
): DurableHistoryEntry | null {
  if (
    item.actionName !== NEW_LAYER_ACTION &&
    !(item.actionName === TOOL_ACTION && sourceFromEntry(item)?.kind === 'tool')
  ) {
    return null;
  }
  const layer = durableLayerForSource(item, context);
  if (!layer) return null;
  return durableEntryForOperation(item, Object.freeze({ kind: 'create-layer', layer }));
}

/** Store-boundary planner for an atomic `MERGE_ACTION` append. */
export function deriveMergeDocumentEntry(
  item: HistoryItem,
  context: SourceBackedEntryContext
): DurableHistoryEntry | null {
  if (item.actionName !== MERGE_ACTION) return null;
  const result = durableLayerForSource(item, context);
  if (!result) return null;
  const layerIds = context.liveLayers ? Object.keys(context.liveLayers) : [...context.preLayers.keys()];
  const removedLayerIds = Object.freeze(layerIds.filter((id) => id !== result.id));
  return durableEntryForOperation(item, Object.freeze({ kind: 'merge-document', result, removedLayerIds }));
}

function validateTimeline(entry: HistoryItem, timeline: HistoryTimeline): MigrationDiagnostic | null {
  if (timeline.entries.some((candidate) => candidate.id === entry.id)) {
    return {
      historyId: entry.id,
      actionName: entry.actionName,
      severity: 'error',
      code: 'invalid-history-entry',
      message: 'A history entry id must be unique within a document timeline.',
    };
  }
  const validAppendPoint =
    Number.isInteger(timeline.cursor) &&
    timeline.cursor >= 0 &&
    (timeline.entries.length === 0 ? timeline.cursor === 0 : timeline.cursor < timeline.entries.length);
  if (!validAppendPoint) {
    return {
      historyId: entry.id,
      actionName: entry.actionName,
      severity: 'error',
      code: 'invalid-history-entry',
      message: 'The append point is outside the legacy timeline, so durable cursor mapping is undefined.',
    };
  }
  return null;
}

export function planHistoryAppend({
  item,
  timeline,
  currentFrame,
  currentSelections = EMPTY_SELECTIONS,
  currentLayer,
  id,
}: AppendBoundaryInput): AppendBoundaryResult {
  const entry = createHistoryItem(item, id);
  const result = translate(entry, currentFrame, currentSelections, currentLayer, { paths: [] });
  const timelineDiagnostic = validateTimeline(entry, timeline);
  if (!timelineDiagnostic) return result;
  return {
    entry: result.entry,
    durableEntry: timelineDiagnostic.severity === 'error' ? null : result.durableEntry,
    diagnostics: [...result.diagnostics, timelineDiagnostic],
  };
}

/**
 * Single-writer publication of a planned durable entry.
 *
 * The planned entry is published only when the store's durable document still
 * describes exactly the legacy timeline the append is based on. Anything else
 * (a redo truncation, a replay, a document replacement, a revision that moved
 * without a rebuild) falls back to the full conversion, so the shadow is never
 * patched against a stale base.
 */
export type DurableAppendDecision =
  | Readonly<{ outcome: 'published'; document: DurableDocument }>
  | Readonly<{ outcome: 'preconditions'; reason: string }>
  | Readonly<{ outcome: 'mismatch'; reason: string }>;

export type DurableAppendInput = Readonly<{
  documentId: string;
  /** The durable document the store currently holds, or null when unavailable. */
  base: DurableDocument | null;
  /** The legacy timeline before the append. */
  prior: HistoryTimeline;
  /** The legacy timeline after the append. */
  next: HistoryTimeline;
  /** The entry the writer appended. */
  entry: HistoryItem;
  /** The entry the boundary planned for it, if any. */
  planned?: DurableHistoryEntry | null;
  documentRevision: number;
  /**
   * The store's authoritative pre-append layer order, bottom first.
   *
   * A reorder is the only published action that needs it, because its operation
   * names the resulting order of every layer rather than a change to one of
   * them. It is supplied by the store from the live record, never by a writer.
   */
  preLayerOrder?: readonly LayerId[] | null;
  /**
   * The layer ids the durable document itself holds at its cursor, in the order
   * its own snapshots sort into.
   *
   * A reorder map is keyed on the whole layer set, and durable replay silently
   * skips ids it does not know (`durable-replay.ts`), so a map derived from a
   * layer set the shadow does not share would renumber the layers the two models
   * do agree on and leave the shadow ordered differently from the document. The
   * store supplies the comparison so this module never has to replay anything.
   *
   * The ORDER is compared, not just the membership, and the difference is the
   * whole point. A published map is a fresh normalisation of the order, so it
   * overwrites whatever order the shadow had; publishing it while the two models
   * already disagree about the order launders that disagreement into a document
   * no reconversion will reproduce. Sequence equality is what makes a publication
   * and a reconversion interchangeable.
   */
  durableLayerOrder?: readonly LayerId[] | null;
  /**
   * The durable pre-append layer snapshots used to grade source-backed create
   * and merge plans. A missing map still permits canonical-shape validation,
   * but cannot prove a merge's complete removal set.
   */
  preLayers?: ReadonlyMap<LayerId, DurableLayerSnapshot> | null;
  /** Legacy runtime layer orders used to verify source-backed create metadata. */
  liveLayers?: Readonly<Record<LayerId, Layer>> | null;
  /**
   * The asset registry, for raster liveness and source-identity validation.
   *
   * A source-backed plan naming a raster registers its asset inside the store's
   * document asset transaction, so nothing about the plan itself proves the asset
   * resolves or was registered from the legacy bitmap. This independently checks
   * both facts without mutating registry ownership.
   *
   * Omitted, it defaults to the process registry — the same singleton the store
   * registers the asset in and the same default `legacyHistoryToDurable` converts
   * against, so a caller that registered through the normal path is answered
   * without threading a reference. `null` is the explicit "this store cannot
   * answer", which `decideDurableAppend` reports as a `preconditions` refusal
   * rather than as a writer defect.
   */
  registry?: AssetRegistryProbe | null;
}>;

function sameFrame(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftFrame = left as Record<string, unknown>;
  const rightFrame = right as Record<string, unknown>;
  return (
    leftFrame.x === rightFrame.x &&
    leftFrame.y === rightFrame.y &&
    leftFrame.width === rightFrame.width &&
    leftFrame.height === rightFrame.height
  );
}

/**
 * Structural comparison of a plain JSON value, key-order independent.
 *
 * The durable selection snapshots are rebuilt by spread and `Object.fromEntries`
 * on their way into the document, so key order is not a stable identity. This
 * compares shape and values only, and never throws on an unexpected value: a
 * disagreement is reported, not raised.
 */
function sameDenseArray(
  left: readonly unknown[],
  right: readonly unknown[],
  sameItem: (left: unknown, right: unknown) => boolean
): boolean {
  if (left.length !== right.length) return false;
  if (Object.getPrototypeOf(left) !== Array.prototype || Object.getPrototypeOf(right) !== Array.prototype) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!Object.hasOwn(left, index) || !Object.hasOwn(right, index)) return false;
    const leftDescriptor = Object.getOwnPropertyDescriptor(left, String(index));
    const rightDescriptor = Object.getOwnPropertyDescriptor(right, String(index));
    if (
      !leftDescriptor?.enumerable ||
      !Object.hasOwn(leftDescriptor, 'value') ||
      !rightDescriptor?.enumerable ||
      !Object.hasOwn(rightDescriptor, 'value') ||
      !sameItem(leftDescriptor.value, rightDescriptor.value)
    ) {
      return false;
    }
  }
  return true;
}

function isJsonValue(value: unknown, ancestors = new WeakSet<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return false;
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) return false;
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
        if (!isJsonValue(descriptor.value, ancestors)) return false;
      }
      return true;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
      // JSON omits undefined-valued object properties; keeping them valid here
      // lets append and replay projections agree on serialized tool args.
      if (descriptor.value !== undefined && !isJsonValue(descriptor.value, ancestors)) return false;
    }
    return true;
  } finally {
    ancestors.delete(value);
  }
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  try {
    return sameJsonValueUnchecked(left, right);
  } catch {
    return false;
  }
}

function sameJsonValueUnchecked(left: unknown, right: unknown): boolean {
  if (!isJsonValue(left) || !isJsonValue(right)) return false;
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && sameDenseArray(left, right, sameJsonValue);
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined);
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(rightRecord, key) && sameJsonValue(leftRecord[key], rightRecord[key]))
  );
}

function isCanonicalSelection(value: unknown): value is Record<string, unknown> {
  if (
    !hasCanonicalDataKeys(
      value,
      ['id', 'points', 'isActive', 'pos'],
      ['lifecycle', 'geometry', 'sourceTool', 'metadata']
    )
  ) {
    return false;
  }
  const selection = value;
  const sourceTools = [
    'polygonal-lasso',
    'freehand-lasso',
    'feather-magnetic-lasso',
    'magic-wand',
    'rectangular-selection',
  ];
  const geometry = selection.geometry;
  const sourceTool = selection.sourceTool;
  return (
    typeof selection.id === 'string' &&
    typeof selection.isActive === 'boolean' &&
    (selection.lifecycle === undefined || selection.lifecycle === 'committed') &&
    (geometry === undefined || geometry === 'polygon' || geometry === 'rectangle') &&
    (sourceTool === undefined || (typeof sourceTool === 'string' && sourceTools.includes(sourceTool))) &&
    Array.isArray(selection.points) &&
    isJsonValue(selection.points) &&
    selection.points.every(
      (contour) =>
        Array.isArray(contour) &&
        isJsonValue(contour) &&
        contour.every((point) => hasCanonicalFiniteNumberKeys(point, ['x', 'y']) && isJsonValue(point))
    ) &&
    hasCanonicalFiniteNumberKeys(selection.pos, ['x', 'y', 'width', 'height']) &&
    isJsonValue(selection.pos) &&
    (selection.metadata === undefined || isCanonicalSelectionMetadata(selection.metadata))
  );
}

function isCanonicalSelectionSnapshot(value: unknown): value is Record<string, unknown> {
  if (!hasCanonicalDataKeys(value, ['selections'], ['activeSelectionId'])) return false;
  const selections = value.selections;
  const activeSelectionId = value.activeSelectionId;
  return (
    (activeSelectionId === undefined || activeSelectionId === null || typeof activeSelectionId === 'string') &&
    Array.isArray(selections) &&
    sameDenseArray(selections, selections, isCanonicalSelection)
  );
}

function sameSelection(left: unknown, right: unknown): boolean {
  if (!isCanonicalSelection(left) || !isCanonicalSelection(right)) return false;
  if (left === right) return true;
  const leftSelection = left as Record<string, unknown>;
  const rightSelection = right as Record<string, unknown>;
  return (
    leftSelection.id === rightSelection.id &&
    leftSelection.isActive === rightSelection.isActive &&
    leftSelection.lifecycle === rightSelection.lifecycle &&
    leftSelection.geometry === rightSelection.geometry &&
    leftSelection.sourceTool === rightSelection.sourceTool &&
    sameJsonValue(leftSelection.points, rightSelection.points) &&
    sameJsonValue(leftSelection.pos, rightSelection.pos) &&
    ((leftSelection.metadata === undefined && rightSelection.metadata === undefined) ||
      sameJsonValue(leftSelection.metadata, rightSelection.metadata))
  );
}

/**
 * The selection twin of `sameFrame`: a structural proof that a planned snapshot
 * is the snapshot the legacy item must produce, without depending on which of
 * the two deep-copied it is.
 *
 * `activeSelectionId` is compared through `?? null` because both the derivation
 * and `replayHistory`'s `SELECTION_ACTION` arm read a key-absent id as `null`.
 * A strict `!==` would report a mismatch between a legacy arg that omits the key
 * and the normalized planned entry, degrading a correct append to reconversion.
 */
function sameSelectionSnapshot(left: unknown, right: unknown): boolean {
  if (!isCanonicalSelectionSnapshot(left) || !isCanonicalSelectionSnapshot(right)) return false;
  if (left === right) return true;
  const leftSnapshot = left as { selections?: unknown; activeSelectionId?: unknown };
  const rightSnapshot = right as { selections?: unknown; activeSelectionId?: unknown };
  if ((leftSnapshot.activeSelectionId ?? null) !== (rightSnapshot.activeSelectionId ?? null)) return false;
  if (!Array.isArray(leftSnapshot.selections) || !Array.isArray(rightSnapshot.selections)) return false;
  const leftSelections = leftSnapshot.selections;
  const rightSelections = rightSnapshot.selections;
  return sameDenseArray(leftSelections, rightSelections, sameSelection);
}

function sameOrderMap(left: Readonly<Record<LayerId, number>>, right: Readonly<Record<LayerId, number>>): boolean {
  const leftIds = Object.keys(left);
  if (leftIds.length !== Object.keys(right).length) return false;
  return leftIds.every((id) => left[id] === right[id]);
}

/** Two layer sequences are equal when they name the same ids in the same order. */
function sameLayerSequence(left: readonly LayerId[], right: readonly LayerId[]): boolean {
  return sameDenseArray(left, right, (leftId, rightId) => leftId === rightId);
}

/**
 * Whether the registry can still resolve `assetId`.
 *
 * `AssetRegistry.getRecord` returns `undefined` for an id it never issued AND for
 * one whose entry has been disposed (`asset-registry.ts:243-246`), so absent here
 * means exactly "the registry will throw if anything resolves this" — which
 * covers both an unregistered id and a retired one. That is the liveness half of
 * the rule; a registry that only tracked a `Set` of issued ids would answer a
 * disposed asset as present, so the predicate is deliberately expressed through
 * `getRecord` rather than through any id bookkeeping.
 *
 * A missing registry is not absence. It is a store that cannot answer, and the
 * caller reports it as a `preconditions` refusal rather than as this predicate's
 * verdict, so it must never be reported as "absent".
 */
export function registryResolvesAsset(registry: AssetRegistryProbe | null | undefined, assetId: AssetId): boolean {
  return registry ? !!registry.getRecord(assetId) : false;
}

/** The registry capabilities needed to verify a planned raster source. */
export type AssetRegistryProbe = Pick<AssetRegistry, 'getRecord' | 'matchesRegisteredSource'>;

type RetainedToolOperationKind =
  'apply-filter' | 'apply-affine-transform' | 'apply-raster-processor' | 'reposition-layer';

/** The `commit: 'layer-operation'` tools `operationForTool` names by hand. */
const DURABLE_FILTER_TOOLS: readonly string[] = ['blur', 'color', 'levels'];

/**
 * The tool arguments a `TOOL_ACTION` entry publishes from, read off the entry.
 *
 * A writer nests the tool args under `args.args` when it also carries something
 * else beside them, and both shapes reach this boundary, so the unwrap is part of
 * reading the legacy entry rather than part of the derivation being graded. What
 * comes back is the caller's own object, unmodified and unnormalized, so a
 * structural comparison against it cannot be satisfied by a re-derivation.
 */
function legacyToolArgs(entry: HistoryItem): Record<string, unknown> | null {
  const candidate = entry.args;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const nested = (candidate as { args?: unknown }).args;
  const args: Record<string, unknown> =
    nested && typeof nested === 'object' && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : (candidate as Record<string, unknown>);
  return typeof args.toolName === 'string' ? args : null;
}

/**
 * Which retained durable operation these legacy arguments must publish, derived
 * from the arguments and the tool-processor table alone.
 *
 * This is a second implementation of the dispatch `operationForTool` performs,
 * and it is written the way `reorderOrderAfterIntent` is: deliberately, so a
 * defect in the plan is visible here rather than reproduced by a second call to
 * the code that made the plan. Re-running `operationForTool` and comparing its
 * output with the plan would compare a value with itself, and would accept every
 * plan that code ever produced — which is the whole class of defect this arm
 * exists to catch.
 *
 * `null` is the one answer it refuses, and it means the append has no retained
 * translation at all: no tool name, an unregistered tool, a `document` or
 * `selection` tool, or a geometry tool that moved and resized nothing. Every one
 * of those is refused by `translate` before a plan exists, so reaching `null` from
 * a plan means the plan was not made here.
 */
function retainedToolOperationKind(legacyArgs: Record<string, unknown>): RetainedToolOperationKind | null {
  const toolName = legacyArgs.toolName;
  if (typeof toolName !== 'string') return null;
  // A trapezoid has no affine matrix, so it is the one transform the boundary
  // keeps as a raster processor. `isTrapezoidOnlyTransform` gates the mix below
  // in the derivation; here it refuses a legacy entry whose trapezoid contradicts
  // its own affine values, which no plan built from it could ever describe.
  if (toolName === 'transform') {
    if (!legacyArgs.trapezoid) return 'apply-affine-transform';
    return isTrapezoidOnlyTransform(legacyArgs as never) ? 'apply-raster-processor' : null;
  }
  const processor = findToolProcessor(toolName as ToolName);
  if (!processor) return null;
  if (processor.commit === 'layer-operation') {
    return DURABLE_FILTER_TOOLS.includes(toolName) ? 'apply-filter' : null;
  }
  if (processor.commit === 'geometry') {
    return legacyArgs.move || legacyArgs.resize ? 'reposition-layer' : null;
  }
  if (processor.commit === 'raster' && processor.compositesOntoInput !== false) return 'apply-raster-processor';
  return null;
}

/** `?? ` rather than a typeof test, so a non-number reaches the finiteness rule as it does. */
function numericArg(args: Record<string, unknown>, key: string, fallback: number): number {
  return (args[key] as number | undefined) ?? fallback;
}

/**
 * The 2x2 block these legacy transform arguments must produce, and nothing else.
 *
 * The linear block of a retained transform is a function of the arguments ALONE:
 * scale/mirror, then rotation, then skew, all about the untransformed layer
 * centre, and the centre only enters the translation. So all four of `a`, `b`,
 * `c` and `d` are independently derivable from `entry.args` without the layer box
 * this function is not given — which is what makes grading a raw transform
 * (`{ toolName: 'transform', rotate, resizeX, resizeY }`) possible at all.
 *
 * This is a second implementation of the composition `transformToolArgsToAffine`
 * performs, for the reason given on `retainedToolOperationKind`. The two are
 * pinned against each other over a matrix of arguments in
 * `history-append.tool.test.ts`, which is what keeps a second copy from drifting
 * into a check that refuses correct plans.
 *
 * `e` and `f` are NOT derived here, and cannot be: `aroundCenter` needs the layer
 * box, and the plan was built against the store's LIVE record while the only
 * layer boxes reaching this module are the durable pre-append snapshots — a
 * different source that can disagree, and grading against it would report a
 * writer defect for a correct append. The translation is graded in full for the
 * normalized form below, where the legacy args already carry the whole matrix.
 */
function linearBlockForTransformArgs(
  legacyArgs: Record<string, unknown>
): Readonly<{ a: number; b: number; c: number; d: number }> | string {
  const rotate = numericArg(legacyArgs, 'rotate', 0);
  const skewXDegrees = numericArg(legacyArgs, 'skewX', 0);
  const skewYDegrees = numericArg(legacyArgs, 'skewY', 0);
  const resizeX = numericArg(legacyArgs, 'resizeX', 100);
  const resizeY = numericArg(legacyArgs, 'resizeY', 100);
  if (![rotate, skewXDegrees, skewYDegrees, resizeX, resizeY].every(Number.isFinite)) {
    return 'the retained transform arguments are not finite';
  }
  if (resizeX === 0 || resizeY === 0) return 'the retained transform scale is zero';
  const angle = (rotate * Math.PI) / 180;
  const skewX = Math.tan((skewXDegrees * Math.PI) / 180);
  const skewY = Math.tan((skewYDegrees * Math.PI) / 180);
  if (![angle, skewX, skewY].every(Number.isFinite)) return 'the retained transform angles are too extreme';
  const scale: AffineTransform = {
    a: (legacyArgs.mirrorH ? -1 : 1) * (resizeX / 100),
    b: 0,
    c: 0,
    d: (legacyArgs.mirrorV ? -1 : 1) * (resizeY / 100),
    e: 0,
    f: 0,
  };
  const rotation: AffineTransform = {
    a: Math.cos(angle),
    b: Math.sin(angle),
    c: -Math.sin(angle),
    d: Math.cos(angle),
    e: 0,
    f: 0,
  };
  const skew: AffineTransform = { a: 1, b: skewY, c: skewX, d: 1, e: 0, f: 0 };
  const linear = multiplyAffineTransforms(skew, multiplyAffineTransforms(rotation, scale));
  return { a: linear.a, b: linear.b, c: linear.c, d: linear.d };
}

/** Absolute tolerance for the re-derived linear block; far below any visible difference. */
function nearEnough(left: unknown, right: unknown): boolean {
  return typeof left === 'number' && typeof right === 'number' && Math.abs(left - right) <= 1e-9;
}

function sameLinearBlock(
  planned: Readonly<{ a: number; b: number; c: number; d: number }>,
  expected: Readonly<{ a: number; b: number; c: number; d: number }>
): boolean {
  return (
    nearEnough(planned.a, expected.a) &&
    nearEnough(planned.b, expected.b) &&
    nearEnough(planned.c, expected.c) &&
    nearEnough(planned.d, expected.d)
  );
}

/**
 * The operation carries exactly these own keys, so a plan cannot smuggle a field
 * the rest of the durable model never reads. Same rule the remove and source-backed
 * arms apply to their own operations.
 */
function hasCanonicalKeys(operation: object, expected: readonly string[]): boolean {
  const keys = Object.keys(operation);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function retainedToolOperationProblem(
  operation: DurableOperation,
  entry: HistoryItem,
  legacyArgs: Record<string, unknown>,
  expectedKind: RetainedToolOperationKind
): string | null {
  if (operation.kind !== expectedKind) {
    return `a tool action produced a "${operation.kind}" operation`;
  }
  if (operation.layerId !== entry.layerId) return 'the durable layer id does not match the legacy entry';

  if (operation.kind === 'apply-filter') {
    if (!hasCanonicalKeys(operation, ['kind', 'layerId', 'filter'])) {
      return 'the durable apply-filter operation does not have the canonical shape';
    }
    const { filter } = operation;
    if (!hasCanonicalKeys(filter, ['toolName', 'version', 'args'])) {
      return 'the durable filter does not have the canonical shape';
    }
    if (filter.toolName !== legacyArgs.toolName) {
      return 'the durable filter tool name does not match the legacy entry';
    }
    const processor = findToolProcessor(filter.toolName);
    if (!processor) return 'the durable filter names a tool the processor table does not register';
    if (filter.version !== processor.replay.version) {
      return 'the durable filter version does not match the registered processor';
    }
    return sameJsonValue(filter.args, legacyArgs) ? null : 'the durable filter arguments do not match the legacy entry';
  }

  if (operation.kind === 'apply-affine-transform') {
    if (!hasCanonicalKeys(operation, ['kind', 'layerId', 'transform'])) {
      return 'the durable apply-affine-transform operation does not have the canonical shape';
    }
    const { transform } = operation;
    // The normalized form (`normalizeTransformHistoryArgs` output) carries the
    // whole matrix in the legacy args, so all six components are graded exactly:
    // the plan's transform IS those numbers, re-validated and re-frozen.
    const retained = legacyArgs.transform;
    if (retained && typeof retained === 'object' && !Array.isArray(retained)) {
      const candidate = retained as Partial<AffineTransform>;
      const planned = [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f];
      const expected = [candidate.a, candidate.b, candidate.c, candidate.d, candidate.e, candidate.f];
      if (!expected.every(Number.isFinite)) return 'the retained transform is not a finite matrix';
      return expected.every((value, index) => value === planned[index])
        ? null
        : 'the durable affine transform does not match the retained transform';
    }
    const expected = linearBlockForTransformArgs(legacyArgs);
    if (typeof expected === 'string') return expected;
    return sameLinearBlock(transform, expected)
      ? null
      : 'the durable affine linear block does not match the retained transform arguments';
  }

  if (operation.kind === 'apply-raster-processor') {
    if (!hasCanonicalKeys(operation, ['kind', 'layerId', 'processorId', 'version', 'args'])) {
      return 'the durable apply-raster-processor operation does not have the canonical shape';
    }
    if (operation.processorId !== legacyArgs.toolName) {
      return 'the durable processor id does not match the legacy entry';
    }
    const processor = findToolProcessor(operation.processorId as ToolName);
    if (!processor) return 'the durable processor id is not a registered tool';
    if (operation.version !== processor.replay.version) {
      return 'the durable processor version does not match the registered processor';
    }
    return sameJsonValue(operation.args, legacyArgs)
      ? null
      : 'the durable processor arguments do not match the legacy entry';
  }

  const expectedKeys = [
    'kind',
    'layerId',
    ...(legacyArgs.move ? ['move'] : []),
    ...(legacyArgs.resize ? ['resize'] : []),
  ];
  if (!hasCanonicalKeys(operation, expectedKeys)) {
    return 'the durable reposition operation does not have the canonical shape';
  }
  // Presence is read with `hasOwn`, not by truthiness: an operation carrying
  // `move: undefined` has the key and the plan claims a move the legacy args
  // never made, and a truthiness test would grade that plan as complete.
  if (Object.hasOwn(operation, 'move') !== !!legacyArgs.move) {
    return 'the durable reposition movement does not match the legacy entry';
  }
  if (Object.hasOwn(operation, 'resize') !== !!legacyArgs.resize) {
    return 'the durable reposition resize does not match the legacy entry';
  }
  if (Object.hasOwn(operation, 'move') && !sameJsonValue(operation.move, legacyArgs.move)) {
    return 'the durable reposition movement does not match the legacy entry';
  }
  if (Object.hasOwn(operation, 'resize') && !sameJsonValue(operation.resize, legacyArgs.resize)) {
    return 'the durable reposition resize does not match the legacy entry';
  }
  return null;
}

/**
 * The own keys an installed source must have, exactly.
 *
 * `isBedrock` is among them because `convertSource` always writes it, false
 * included. The count is what does the work: a source that also carried a
 * `bitmap` or an `assetId` — the shape a plan must never publish, because it
 * would put a copy of the pixels in the timeline and name an asset id nothing
 * here can prove resolves — has one key too many, and the operation's own type
 * already excludes such a source, so this is the second line rather than the
 * guarantee.
 */
const REPLACE_SOURCE_KEYS = ['kind', 'toolName', 'args', 'size', 'sourcePos', 'isBedrock'];

/**
 * The source-edit grading, read off the legacy item rather than re-derived from
 * the plan.
 *
 * Four separate facts are checked because the operation is the one durable
 * operation whose payload is a whole source:
 *
 * 1. The operation is the source-edit kind and carries only its four own keys.
 * 2. The source is an editable typed source, and exactly the canonical keys — so
 *    no bitmap is aliased into a document that owns its pixels elsewhere.
 * 3. The source's arguments are the legacy source's arguments, structurally and
 *    key-order independently. This is the whole edit: the text content, the font,
 *    the shape's geometry live here.
 * 4. `pos`, `source.size` and `source.sourcePos` agree with each other and with
 *    the legacy box. `convertSource` derives the last two from the first, so a
 *    plan that states a box the source was not authored against is one whose
 *    materialization would scale the source from a stale rectangle.
 */
function replaceLayerSourceProblem(
  operation: DurableOperation,
  entry: HistoryItem,
  replacement: ToolLayerSource
): string | null {
  // The reader already refuses a bedrock replacement, so this test cannot fire. It
  // is here because this function must narrow the source's `NewLayerData` union to
  // read `pos` at all, and a grading that trusted the reader's RETURN TYPE to have
  // done that narrowing would be one refactor away from reading a bedrock box off
  // a union that does not promise one.
  if (replacement.isBedrock) return 'a bedrock source cannot be installed by a source edit';
  const legacyPos = replacement.pos;
  if (operation.kind !== 'replace-layer-source') {
    return `a source edit produced a "${operation.kind}" operation`;
  }
  const planned: ReplaceLayerSourceOperation = operation;
  if (!hasCanonicalKeys(planned, ['kind', 'layerId', 'source', 'pos'])) {
    return 'the durable replace-layer-source operation does not have the canonical shape';
  }
  if (planned.layerId !== entry.layerId) return 'the durable layer id does not match the legacy entry';
  // `EditableDurableLayerSource` admits only `text` and `vector`, so this test is
  // false for every value the type admits. It exists for a planned entry that
  // arrived from outside the type system, and reading the kind through `unknown`
  // is what lets the refusal NAME the kind it refused instead of printing a type
  // the compiler has already proved cannot occur.
  const installedKind: unknown = planned.source.kind;
  if (installedKind !== 'text' && installedKind !== 'vector') {
    return `the durable source edit installs a "${String(installedKind)}" source`;
  }
  const source = planned.source;
  if (!hasCanonicalKeys(source, REPLACE_SOURCE_KEYS)) {
    return 'the durable replacement source does not have the canonical shape';
  }
  if (source.isBedrock) return 'the durable replacement source declares a bedrock source';
  if (source.toolName !== replacement.args.toolName) {
    return 'the durable replacement source tool name does not match the legacy entry';
  }
  if (!sameJsonValue(source.args, replacement.args)) {
    return 'the durable replacement source arguments do not match the legacy entry';
  }
  if (!sameJsonValue(planned.pos, legacyPos)) return 'the durable layer position does not match the legacy entry';
  if (!sameJsonValue(source.size, { width: legacyPos.width, height: legacyPos.height })) {
    return 'the durable replacement source size does not match the legacy layer box';
  }
  if (!sameJsonValue(source.sourcePos, legacyPos)) {
    return 'the durable replacement source position does not match the legacy layer box';
  }
  return null;
}

/**
 * Proves the planned entry is the entry this legacy item must produce. A
 * disagreement is a defect in the writer, not a reason to reject the edit, so
 * the caller still falls back to the conversion and reports it.
 *
 * `preLayerOrder` is the reorder branch's independent source. Note what that
 * does and does not buy: it catches a `durableEntry` that was built or supplied
 * somewhere other than the store boundary, which is the case that can actually
 * occur, because it is fed the store's record rather than the plan's own output.
 * It does not make `reorderOrderAfterIntent` self-proving — the parity test
 * against the converter, and the store test against a full conversion, are.
 *
 * `registry` is the raster branch's independent source, and it is optional
 * because the answer it gives is a liveness question the caller owns: a store
 * that cannot supply one is reported as a `preconditions` refusal by
 * `decideDurableAppend` rather than as a writer defect here. See
 * `registryResolvesAsset`.
 */
function validatePlannedDurableEntryUnchecked(
  entry: HistoryItem,
  planned: DurableHistoryEntry,
  preLayerOrder?: readonly LayerId[] | null,
  preLayers?: ReadonlyMap<LayerId, DurableLayerSnapshot> | null,
  registry?: AssetRegistryProbe | null,
  documentId?: string,
  liveLayers?: Readonly<Record<LayerId, Layer>> | null
): string | null {
  if (!hasSafeLegacyEntryData(entry)) return 'the legacy history entry is malformed';
  if (!hasPlainDataProperties(planned)) {
    return 'the planned durable history operation is missing or malformed';
  }
  const shapeProblem = durableEntryShapeProblem(planned);
  if (shapeProblem) return shapeProblem;
  if (planned.schemaVersion !== DURABLE_SCHEMA_VERSION) return `durable schema version ${planned.schemaVersion}`;
  if (planned.id !== entry.id) return `durable entry id ${planned.id} does not match the legacy entry id ${entry.id}`;
  if (planned.enabled !== isEntryEnabled(entry)) return 'the durable enabled state does not match the legacy entry';
  const provenanceMismatch = (() => {
    if (!planned.provenance) return null;
    const expectedProvenance = durableEntryProvenance(entry);
    if (
      planned.provenance.actionName !== expectedProvenance.actionName ||
      planned.provenance.toolName !== expectedProvenance.toolName
    ) {
      return 'the durable history provenance does not match the legacy entry';
    }
    return null;
  })();

  if (entry.actionName === SET_DOCUMENT_FRAME_ACTION) {
    if (entry.documentSource) {
      return 'a document frame change cannot carry a document replacement; use REPLACE_DOCUMENT';
    }
    if (planned.operation.kind !== 'set-document-frame' && planned.operation.kind !== 'transform-document') {
      return `a document frame change produced a "${planned.operation.kind}" operation`;
    }
    const args = entry.args as
      { previousFrame?: DocumentFrame; nextFrame?: DocumentFrame; transform?: AffineTransform } | undefined;
    if (!args?.nextFrame) return 'a document frame change has no next frame';
    // Whether the planned `next` is a DOCUMENT FRAME is a separate question from
    // whether it equals the legacy arg, and `sameFrame` cannot answer it: it
    // compares structure, so a 0x0 next frame matches a 0x0 legacy arg perfectly
    // well. Every derivation that BUILDS such an entry refuses one
    // (`history-adapter.ts` — `deriveSetDocumentFrameEntry()`, reached from
    // `translate()`), so only a SUPPLIED entry reaches this — and durable replay
    // applies `next` with no validation of its own while `documentFrameSize()`
    // clamps to a 1x1 minimum, so a published 0x0 crop is visible as a
    // one-pixel-square document rather than as a degenerate size.
    //
    // Checked BEFORE the comparison, so the reason names the invalid frame itself
    // rather than a disagreement that is only a symptom of it. It is a `mismatch`
    // rather than a `preconditions` refusal because the store can answer this
    // question and the answer is a defect in the plan: the two routes over one
    // legacy item then say the same thing, which is the divergence.
    if (!isValidDocumentFrame(planned.operation.next)) {
      return 'the durable next frame is not a document frame';
    }
    if (!isValidDocumentFrame(planned.operation.previous)) {
      return 'the durable previous frame is not a document frame';
    }
    if (!sameFrame(planned.operation.next, args.nextFrame))
      return 'the durable next frame does not match the legacy entry';
    if (args.previousFrame) {
      if (!isValidDocumentFrame(args.previousFrame)) return 'the legacy previous frame is not a document frame';
      if (!sameFrame(planned.operation.previous, args.previousFrame)) {
        return 'the durable previous frame does not match the legacy entry';
      }
    }
    if (args.transform !== undefined) {
      let expectedTransform: AffineTransform;
      try {
        expectedTransform = validateAffineTransform(args.transform);
      } catch {
        return 'the legacy document transform is invalid';
      }
      if (isIdentityAffineTransform(expectedTransform)) {
        if (planned.operation.kind === 'transform-document') {
          return 'an identity document transform produced a transform-document operation';
        }
      } else {
        if (planned.operation.kind !== 'transform-document') {
          return 'a non-identity document transform produced a frame-only operation';
        }
        const actualTransform = planned.operation.transform;
        if (
          actualTransform.a !== expectedTransform.a ||
          actualTransform.b !== expectedTransform.b ||
          actualTransform.c !== expectedTransform.c ||
          actualTransform.d !== expectedTransform.d ||
          actualTransform.e !== expectedTransform.e ||
          actualTransform.f !== expectedTransform.f
        ) {
          return 'the durable document transform does not match the legacy entry';
        }
      }
    } else if (planned.operation.kind === 'transform-document') {
      return 'a document transform has no legacy transform matrix';
    }
    return provenanceMismatch;
  }

  if (entry.documentSource) return 'an appended history entry cannot carry a document replacement';

  if (entry.actionName === SELECTION_ACTION) {
    if (planned.operation.kind !== 'set-selection') {
      return `a selection change produced a "${planned.operation.kind}" operation`;
    }
    // `after` is unconditional: it is the state durable replay applies, so a
    // disagreement here is a wrong entry even when the legacy item is bare.
    // `before` is only a baseline, so it is checked when the legacy item
    // actually supplies one — the same treatment the frame branch gives
    // `previousFrame`, and the same reason the boundary may default it.
    const args = entry.args as
      { previousSelectionState?: SelectionSnapshot; nextSelectionState?: SelectionSnapshot } | undefined;
    if (!args?.nextSelectionState) return 'a selection change has no next selection state';
    if (!sameSelectionSnapshot(planned.operation.after, args.nextSelectionState)) {
      return 'the durable next selection state does not match the legacy entry';
    }
    if (args.previousSelectionState && !sameSelectionSnapshot(planned.operation.before, args.previousSelectionState)) {
      return 'the durable previous selection state does not match the legacy entry';
    }
    return provenanceMismatch;
  }

  if (entry.actionName === REORDER_ACTION) {
    if (planned.operation.kind !== 'reorder-layers') {
      return `a layer reorder produced a "${planned.operation.kind}" operation`;
    }
    const args = entry.args as { layerToMoveId?: LayerId; afterWhichLayerId?: LayerId | null } | undefined;
    const layerToMoveId = args?.layerToMoveId;
    if (!layerToMoveId) return 'a layer reorder has no moving layer id';
    if (!preLayerOrder) return 'a layer reorder was checked without the store layer order it was planned against';
    const expected = reorderOrderAfterIntent(preLayerOrder, {
      layerToMoveId,
      afterWhichLayerId: args?.afterWhichLayerId,
    });
    // The refusal cases never reach here: `decideDurableAppend` sends a reorder
    // whose intent does not apply down the `preconditions` path before it calls
    // this. Grading one as a mismatch would report a writer defect for an append
    // that is behaving exactly as legacy replay does.
    if (!expected) return 'the layer reorder names a layer the document does not hold';
    return sameOrderMap(planned.operation.orderByLayerId, expected)
      ? provenanceMismatch
      : 'the durable layer order does not match the store order';
  }

  if (isSetLayerPropertiesAction(entry.actionName)) {
    if (planned.operation.kind !== 'set-layer-properties') {
      return `a layer-property change produced a "${planned.operation.kind}" operation`;
    }
    const { layerId, patch } = planned.operation;
    if (layerId !== entry.layerId) return 'the durable layer id does not match the legacy entry';
    // Checked against the legacy entry, not against a second call to the
    // derivation that produced this plan: re-deriving would compare a value
    // with itself and could only ever catch a hand-supplied entry, never a
    // defect in the derivation. Exactly one key, and that key's value read
    // from the action and the legacy args.
    if (Object.keys(patch).length !== 1) {
      return 'the durable layer-property operation does not match the legacy entry';
    }
    // Exhaustive on the owned key rather than `name` versus "everything else":
    // an action that owned some other property would otherwise be graded
    // against `visible` and reported as a mismatch for a correct entry.
    switch (layerPropertyKeyFor(entry.actionName)) {
      case 'name': {
        const name = (entry.args as { name?: unknown } | undefined)?.name;
        if (typeof name !== 'string') return 'the layer-property value is invalid';
        if (patch.name !== name) return 'the durable layer name does not match the legacy entry';
        return provenanceMismatch;
      }
      case 'visible':
        return patch.visible === (entry.actionName === SHOW_LAYER_ACTION)
          ? provenanceMismatch
          : 'the durable layer visibility does not match the legacy entry';
      case 'opacity': {
        const opacity = (entry.args as { opacity?: unknown } | undefined)?.opacity;
        if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
          return 'the layer-property value is invalid';
        }
        return patch.opacity === opacity
          ? provenanceMismatch
          : 'the durable layer opacity does not match the legacy entry';
      }
      case 'blendMode': {
        const blendMode = (entry.args as { blendMode?: unknown } | undefined)?.blendMode;
        if (!isLayerBlendMode(blendMode)) return 'the layer-property value is invalid';
        return patch.blendMode === blendMode
          ? provenanceMismatch
          : 'the durable layer blend mode does not match the legacy entry';
      }
      case 'locked': {
        const locked = entry.actionName === LOCK_LAYER_ACTION;
        return patch.locked === locked
          ? provenanceMismatch
          : 'the durable layer lock state does not match the legacy entry';
      }
      default:
        return 'the action does not own a durable layer property';
    }
  }

  if (entry.actionName === REMOVE_ACTION) {
    if (planned.operation.kind !== 'remove-layer') {
      return `a layer removal produced a "${planned.operation.kind}" operation`;
    }
    const operationKeys = Object.keys(planned.operation);
    if (operationKeys.length !== 2 || !operationKeys.includes('kind') || !operationKeys.includes('layerId')) {
      return 'the durable remove-layer operation does not have the canonical shape';
    }
    return planned.operation.layerId === entry.layerId
      ? provenanceMismatch
      : 'the durable layer id does not match the legacy entry';
  }

  const sourceBackedCreate =
    entry.actionName === NEW_LAYER_ACTION ||
    (entry.actionName === TOOL_ACTION && sourceFromEntry(entry)?.kind === 'tool');
  if (sourceBackedCreate || entry.actionName === MERGE_ACTION) {
    const source = sourceFromEntry(entry);
    if (!source) return 'a source-backed layer action has no usable layer source';

    const operation = planned.operation;
    const isCreate = sourceBackedCreate;
    if (isCreate && operation.kind !== 'create-layer') {
      return `a new layer action produced a "${operation.kind}" operation`;
    }
    if (!isCreate && operation.kind !== 'merge-document') {
      return `a merge action produced a "${operation.kind}" operation`;
    }

    const snapshot =
      operation.kind === 'create-layer'
        ? operation.layer
        : operation.kind === 'merge-document'
          ? operation.result
          : null;
    if (!snapshot) return 'the durable source-backed operation has no result layer';
    const operationKeys = Object.keys(operation);
    const expectedKeys = isCreate ? ['kind', 'layer'] : ['kind', 'result', 'removedLayerIds'];
    if (operationKeys.length !== expectedKeys.length || expectedKeys.some((key) => !operationKeys.includes(key))) {
      return isCreate
        ? 'the durable create-layer operation does not have the canonical shape'
        : 'the durable merge-document operation does not have the canonical shape';
    }
    if (snapshot.id !== entry.layerId) return 'the durable result layer id does not match the legacy entry';

    // Source-backed validation needs pre-state to prove canonical order and removals.
    if (!preLayers) {
      return isCreate
        ? 'the durable create-layer order cannot be verified without the pre-append layer set'
        : 'the durable merge order and removal set cannot be verified without the pre-append layer set';
    }
    // The adapter's source-to-runtime rule determines the canonical layer metadata.
    let runtime: Layer;
    try {
      runtime = sourceToRuntimeLayer(entry.layerId, source, liveLayers ?? new Map(preLayers));
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    const runtimeProblem = compareRuntimeLayerToSnapshot(runtime, snapshot);
    if (runtimeProblem) return runtimeProblem;
    const sourceProblem = compareDurableSourceToLegacy(source, snapshot);
    if (sourceProblem) return sourceProblem;

    if (snapshot.source.kind === 'raster') {
      if (source.kind !== 'image') return 'the durable raster layer source has no matching legacy image source';
      if (!registry) {
        return `the durable raster layer source names asset ${snapshot.source.assetId}, which cannot be verified without the asset registry`;
      }
      if (!registryResolvesAsset(registry, snapshot.source.assetId)) {
        return `the durable raster layer source names asset ${snapshot.source.assetId}, which the asset registry cannot resolve`;
      }
      if (typeof documentId !== 'string') {
        return `the durable raster layer source names asset ${snapshot.source.assetId}, which cannot be verified for a document without its id`;
      }
      if (!registry.matchesRegisteredSource(snapshot.source.assetId, source.bitmap, documentId)) {
        return `the durable raster layer source names asset ${snapshot.source.assetId}, which is not owned by this document and registered from the legacy source bitmap`;
      }
    }

    if (operation.kind === 'merge-document') {
      const removedLayerIds = operation.removedLayerIds;
      if (
        !Array.isArray(removedLayerIds) ||
        !isJsonValue(removedLayerIds) ||
        !removedLayerIds.every((id) => typeof id === 'string')
      ) {
        return 'the durable merge-document removal set is malformed';
      }
      if (new Set(removedLayerIds).size !== removedLayerIds.length) {
        return 'the durable merge-document removal set contains duplicate layer ids';
      }
      if (removedLayerIds.includes(snapshot.id))
        return 'the durable merge-document removal set removes its result layer';
      if (preLayers) {
        const expectedRemoved = new Set([...preLayers.keys()].filter((id) => id !== snapshot.id));
        if (removedLayerIds.length !== expectedRemoved.size || removedLayerIds.some((id) => !expectedRemoved.has(id))) {
          return 'the durable merge-document removal set does not match the pre-append layer set';
        }
      }
    }
    return provenanceMismatch;
  }

  // A `TOOL_ACTION` whose entry carries a tool SOURCE is a layer creation and was
  // graded as one above; this arm is the raster-commit tool path — a blur, a
  // transform, a move — which reaches the tail on main and was reported there as
  // an untranslated action, so every one of them fell back to a full reconversion
  // and filed a `durable-append-mismatch` against a writer that did nothing wrong.
  if (entry.actionName === TOOL_ACTION) {
    const legacyArgs = legacyToolArgs(entry);
    if (!legacyArgs) return 'a tool action carries no readable tool arguments';
    const expectedKind = retainedToolOperationKind(legacyArgs);
    if (!expectedKind) {
      return `no retained durable translation is published for the tool action on "${String(legacyArgs.toolName)}" yet`;
    }
    return retainedToolOperationProblem(planned.operation, entry, legacyArgs, expectedKind) ?? provenanceMismatch;
  }

  // The source-edit arm, after every arm that claims an action by name: creation,
  // merge, the tool path, and the four named actions above have all returned, so
  // reaching here with a readable replacement source means the entry is a source
  // edit. Reached through `editableSourceReplacementFromEntry` — the reader of
  // the legacy carrier, shared with the derivation in `history-adapter.ts` — and
  // graded field by field against the caller's own source object rather than by
  // re-deriving it, for the same reason the tool arm re-implements the dispatch.
  const editableReplacement = editableSourceReplacementFromEntry(entry);
  if (editableReplacement) {
    const replaceProblem = replaceLayerSourceProblem(planned.operation, entry, editableReplacement);
    if (replaceProblem) return replaceProblem;
    return replaceProblem ?? provenanceMismatch;
  }

  return `no durable translation is published for "${entry.actionName}" yet`;
}

export function validatePlannedDurableEntry(
  entry: HistoryItem,
  planned: DurableHistoryEntry,
  preLayerOrder?: readonly LayerId[] | null,
  preLayers?: ReadonlyMap<LayerId, DurableLayerSnapshot> | null,
  registry?: AssetRegistryProbe | null,
  documentId?: string,
  liveLayers?: Readonly<Record<LayerId, Layer>> | null
): string | null {
  try {
    return validatePlannedDurableEntryUnchecked(
      entry,
      planned,
      preLayerOrder,
      preLayers,
      registry,
      documentId,
      liveLayers
    );
  } catch {
    return 'the planned durable history entry is malformed';
  }
}

function decideDurableAppendUnchecked({
  documentId,
  base,
  prior,
  next,
  entry,
  planned,
  documentRevision,
  preLayerOrder,
  durableLayerOrder,
  preLayers,
  liveLayers: suppliedLiveLayers,
  registry: suppliedRegistry,
}: DurableAppendInput): DurableAppendDecision {
  if (!planned) return { outcome: 'preconditions', reason: 'no durable entry was planned for this append' };
  if (!hasSafeLegacyEntryData(entry)) {
    return { outcome: 'mismatch', reason: 'the legacy history entry is malformed' };
  }
  if (!hasPlainDataProperties(planned)) {
    return { outcome: 'mismatch', reason: 'the planned durable history operation is missing or malformed' };
  }
  const shapeProblem = durableEntryShapeProblem(planned);
  if (shapeProblem) return { outcome: 'mismatch', reason: shapeProblem };
  if (prior.entries.some((candidate) => candidate.id === entry.id)) {
    return {
      outcome: 'preconditions',
      reason: 'the appended history entry id already exists in the legacy timeline',
    };
  }
  if (!base) return { outcome: 'preconditions', reason: 'the durable document is unavailable' };
  if (base.documentId !== documentId) return { outcome: 'preconditions', reason: 'the durable document is stale' };
  if (base.documentRevision !== documentRevision) {
    return { outcome: 'preconditions', reason: 'the durable document was built for another document revision' };
  }
  if (base.branchRevision !== prior.branchRevision) {
    return { outcome: 'preconditions', reason: 'the durable document was built for another branch' };
  }
  if (base.history.some((candidate) => candidate.id === entry.id)) {
    return { outcome: 'preconditions', reason: 'the appended history entry id already exists in the durable document' };
  }
  if (prior.cursor !== prior.entries.length - 1) {
    return { outcome: 'preconditions', reason: 'the append is not at the tip of the legacy timeline' };
  }
  // The durable twin of the check above, and the one the legacy cursor cannot
  // cover: nothing in the other preconditions asks about `base.cursor` at all.
  //
  // A base below its own tip describes an undone edit — the entries between its
  // cursor and its end are redo-only — and the published cursor is
  // `base.history.length`, NOT `base.cursor + 1`. Appending onto such a base
  // therefore moves the cursor PAST those entries and turns them applied, so the
  // shadow replays an edit the user undid and the redo-only state the base
  // described is gone. It is a silent loss: the base satisfies every other
  // precondition, so nothing reports it.
  //
  // The one cursor guard further down (`cursor > next.cursor`) runs the other way
  // — it catches a base with too MANY entries — so a base with too few is exactly
  // the shape it cannot see.
  //
  // Unreachable from the store today, and only by accident: a mid-timeline base
  // is produced by a rebuild that derives the shadow cursor from the LEGACY cursor
  // (`StoreContext.tsx` — `buildDurableDocument()`), and the same rebuild hands
  // the boundary a `prior` that is not at its tip, which the check above refuses
  // first. Nothing in this boundary enforces the invariant; that coupling does.
  if (base.cursor !== base.history.length - 1) {
    return { outcome: 'preconditions', reason: 'the durable document is not at the tip of its own history' };
  }
  if (next.entries.length !== prior.entries.length + 1) {
    return { outcome: 'preconditions', reason: 'the append truncated the legacy timeline' };
  }
  if (next.cursor !== next.entries.length - 1) {
    return { outcome: 'preconditions', reason: 'the append is not the legacy cursor' };
  }
  if (next.entries[next.entries.length - 1] !== entry) {
    return { outcome: 'preconditions', reason: 'the appended entry is not the one that was planned' };
  }
  // A reorder is the only publication whose correctness depends on the whole
  // layer order, so it is the only one that has to prove it. The refusal is a
  // precondition rather than a mismatch: it describes a store that cannot answer
  // the question, not a writer that answered it wrongly, and the conversion that
  // replaces it already handles the no-op correctly.
  //
  // Of the three, only the sequence comparison is reachable from the store: it
  // supplies an array for the store order by construction, and the base it reads
  // the durable order from was already required non-null above. The other two are
  // the module's API contract — a caller that cannot see the live record has no
  // way to publish a reorder, and must be told that rather than be trusted.
  if (entry.actionName === REORDER_ACTION) {
    if (!preLayerOrder) {
      return { outcome: 'preconditions', reason: 'a layer reorder needs the store layer order it was planned against' };
    }
    if (!durableLayerOrder) {
      return {
        outcome: 'preconditions',
        reason: 'a layer reorder needs the durable layer order to compare the store order against',
      };
    }
    if (!sameLayerSequence(durableLayerOrder, preLayerOrder)) {
      return {
        outcome: 'preconditions',
        reason: 'the durable document and the store record disagree about the layer order',
      };
    }
  }

  const registry = suppliedRegistry === null ? null : (suppliedRegistry ?? getAssetRegistry());
  const problem = validatePlannedDurableEntry(
    entry,
    planned,
    preLayerOrder,
    preLayers,
    registry,
    documentId,
    suppliedLiveLayers
  );
  if (problem) {
    if (!registry && problem.includes('cannot be verified without the asset registry')) {
      return { outcome: 'preconditions', reason: problem };
    }
    return { outcome: 'mismatch', reason: problem };
  }

  const cursor = base.history.length;
  // The durable cursor is the legacy-to-durable map of the appended entry, and a
  // skipped legacy entry can only make it lag. It can never lead.
  if (cursor > next.cursor)
    return { outcome: 'preconditions', reason: 'the durable cursor would lead the legacy cursor' };

  return {
    outcome: 'published',
    // Only `planned` is new here, so the retained timeline is carried across by
    // reference when `base` is one of `history-model.ts`'s own frozen copies, and
    // deep-copied when it is not. `planned` is copied either way: it arrives from
    // the caller and no reuse claim covers it.
    document: refreezeDurableDocument(base, {
      history: [...base.history, planned],
      cursor,
      documentRevision,
      branchRevision: next.branchRevision,
      durableRevision: base.durableRevision + 1,
    }),
  };
}

export function decideDurableAppend(input: DurableAppendInput): DurableAppendDecision {
  try {
    return decideDurableAppendUnchecked(input);
  } catch {
    return { outcome: 'mismatch', reason: 'the planned durable history entry is malformed' };
  }
}

export function durableAppendDiagnostic(entry: HistoryItem, reason: string): MigrationDiagnostic {
  return {
    historyId: entry.id,
    actionName: entry.actionName,
    severity: 'error',
    code: 'durable-append-mismatch',
    message: `The planned durable entry was not published: ${reason}. The durable state was rebuilt from the legacy timeline instead.`,
  };
}
