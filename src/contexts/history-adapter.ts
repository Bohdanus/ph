import { v4 as uuidv4 } from 'uuid';

import type { DocumentFrame } from './document-frame.ts';
import { documentFrameFromSize, isValidDocumentFrame } from './document-frame.ts';
import { AssetRegistry, getAssetRegistry } from './asset-registry.ts';
import {
  DURABLE_SCHEMA_VERSION,
  type DurableDocument,
  type DurableFilter,
  type DurableHistoryEntry,
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
import type { BitmapSource, Selection, Size } from './general-types.ts';
import type { ToolArgs } from './tool-types.ts';
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
import { toolProcessors } from '../tools/toolProcessors.ts';

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

function plainValue(value: unknown, path: string): PlainObject[keyof PlainObject] {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`Non-finite value at ${path}`);
    return value;
  }
  if (Array.isArray(value))
    return Object.freeze(
      value.map(
        (item, index) => plainValue(item, `${path}[${index}]`) as Exclude<PlainObject[keyof PlainObject], undefined>
      )
    );
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`Non-plain value at ${path}`);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, plainValue(item, `${path}.${key}`)])
    )
  ) as PlainObject;
}

function plainObject(value: unknown, path: string): PlainObject {
  const result = plainValue(value, path);
  if (!result || Array.isArray(result) || typeof result !== 'object') throw new Error(`Expected object at ${path}`);
  return result as PlainObject;
}

function cloneSelection(selection: Selection): Selection {
  return {
    ...selection,
    points: selection.points.map((point) => ({ ...point })),
    pos: { ...selection.pos },
    ...(selection.metadata ? { metadata: JSON.parse(JSON.stringify(selection.metadata)) } : {}),
  };
}

function selectionSnapshot(
  selections: readonly Selection[] = [],
  activeSelectionId: string | null = null
): SelectionSnapshot {
  return Object.freeze({
    selections: Object.freeze(selections.map(cloneSelection)),
    activeSelectionId,
  });
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

function convertLayer(layer: Layer, documentId: string, registry: AssetRegistry): DurableLayerSnapshot {
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

function entry(id: string, operation: DurableOperation, enabled = true): DurableHistoryEntry {
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

function operationForTool(item: HistoryItem, layer: DurableLayerSnapshot): DurableOperation | null {
  const candidate = item.args as { args?: unknown } | undefined;
  const args = (candidate && candidate.args && typeof candidate.args === 'object' ? candidate.args : item.args) as
    ToolArgs | undefined;
  if (!args || typeof args !== 'object' || typeof args.toolName !== 'string') return null;
  const processor = toolProcessors[args.toolName];
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
        args: plainObject(args, `history:${item.id}.args`),
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
    const filterArgs = plainObject(args, `history:${item.id}.args`);
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
      args: plainObject(args, `history:${item.id}.args`),
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
    selections: selectionSnapshot(),
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
  const initial = snapshotFromDocumentSource(first, documentId, registry) ?? {
    frame: options.initialFrame ?? documentFrameFromSize(initialSize),
    layers: [],
    selections: selectionSnapshot(),
    activeLayerId: null,
  };
  const diagnostics: MigrationDiagnostic[] = [];
  const legacyCursorToDurableCursor: number[] = [];
  let currentLayers = new Map(initial.layers.map((layer) => [layer.id, layer]));
  let currentFrame = { ...initial.frame };
  let currentSelections = initial.selections;
  const entries: DurableHistoryEntry[] = [];
  const baseline = initial;

  for (const item of legacyHistory) {
    if (item.documentSource && (item.actionName === OPEN_DOCUMENT_ACTION || entries.length === 0)) {
      // The first open-document source is the baseline, not a replay operation.
      if (entries.length === 0) {
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
      } else if (item.actionName === SHOW_LAYER_ACTION || item.actionName === HIDE_LAYER_ACTION) {
        operation = Object.freeze({
          kind: 'set-layer-properties',
          layerId: item.layerId,
          patch: { visible: item.actionName === SHOW_LAYER_ACTION },
        });
        const layer = currentLayers.get(item.layerId);
        if (enabled && layer)
          currentLayers.set(
            item.layerId,
            cloneLayerSnapshot({ ...layer, visible: item.actionName === SHOW_LAYER_ACTION })
          );
      } else if (item.actionName === RENAME_LAYER_ACTION) {
        const name = (item.args as { name?: unknown } | undefined)?.name;
        if (typeof name === 'string') {
          operation = Object.freeze({ kind: 'set-layer-properties', layerId: item.layerId, patch: { name } });
          const layer = currentLayers.get(item.layerId);
          if (enabled && layer) currentLayers.set(item.layerId, cloneLayerSnapshot({ ...layer, name }));
        }
      } else if (item.actionName === REORDER_ACTION) {
        const args = item.args as { layerToMoveId?: LayerId; afterWhichLayerId?: LayerId | null } | undefined;
        if (args?.layerToMoveId && currentLayers.has(args.layerToMoveId)) {
          const order = Object.fromEntries(
            [...currentLayers.values()]
              .sort((left, right) => left.order - right.order)
              .map((layer, index) => [layer.id, index])
          );
          const moving = order[args.layerToMoveId];
          const remaining = Object.keys(order).filter((id) => id !== args.layerToMoveId);
          const targetIndex = args.afterWhichLayerId ? remaining.indexOf(args.afterWhichLayerId) + 1 : 0;
          remaining.splice(Math.max(0, targetIndex), 0, args.layerToMoveId);
          const orderByLayerId = Object.fromEntries(remaining.map((id, index) => [id, index]));
          if (moving !== undefined) {
            operation = Object.freeze({ kind: 'reorder-layers', orderByLayerId });
            if (enabled) {
              for (const [id, nextOrder] of Object.entries(orderByLayerId)) {
                const layer = currentLayers.get(id);
                if (layer) currentLayers.set(id, cloneLayerSnapshot({ ...layer, order: nextOrder }));
              }
            }
          }
        }
      } else if (item.actionName === REMOVE_ACTION) {
        if (enabled) currentLayers.delete(item.layerId);
        operation = Object.freeze({ kind: 'remove-layer', layerId: item.layerId });
      } else if (item.actionName === SET_DOCUMENT_FRAME_ACTION) {
        const frameEntry = deriveSetDocumentFrameEntry(item, currentFrame);
        if (frameEntry) {
          operation = frameEntry.operation;
          if (frameEntry.enabled) currentFrame = { ...(frameEntry.operation as { next: DocumentFrame }).next };
        }
      } else if (item.actionName === SELECTION_ACTION) {
        const args = item.args as
          { previousSelectionState?: SelectionSnapshot; nextSelectionState?: SelectionSnapshot } | undefined;
        operation = Object.freeze({
          kind: 'set-selection',
          before: args?.previousSelectionState ?? currentSelections,
          after: args?.nextSelectionState ?? selectionSnapshot(),
        });
        if (enabled) currentSelections = operation.after;
      } else if (item.actionName === MERGE_ACTION && source) {
        const runtimeLayer = sourceToRuntimeLayer(item.layerId, source, currentLayers);
        const layer = convertLayer(runtimeLayer, documentId, registry);
        const removedLayerIds = [...currentLayers.keys()].filter((id) => id !== layer.id);
        if (enabled) currentLayers = new Map([[layer.id, layer]]);
        operation = Object.freeze({ kind: 'merge-document', result: layer, removedLayerIds });
      } else if (item.actionName === TOOL_ACTION) {
        const layer = currentLayers.get(item.layerId);
        if (!layer) throw new UnsupportedHistoryFeatureError(`Layer ${item.layerId} is unavailable`, item.id);
        operation = operationForTool(item, layer);
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
    if (operation) entries.push(entry(item.id, operation, enabled));
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

function sourceToRuntimeLayer(id: LayerId, source: LayerSource, layers: Map<LayerId, DurableLayerSnapshot>): Layer {
  const size = source.isBedrock ? source.size : { width: source.pos.width, height: source.pos.height };
  const pos = source.isBedrock ? { x: 0, y: 0, ...size } : { ...source.pos };
  return {
    id,
    name: source.kind === 'image' ? (source.name ?? 'Image') : source.kind === 'tool' ? source.args.toolName : 'Blank',
    isBedrock: !!source.isBedrock,
    visible: true,
    opacity: source.kind === 'blank' ? source.opacity : 1,
    locked: false,
    blendMode: 'source-over',
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
