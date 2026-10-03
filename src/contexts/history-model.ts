import type { DocumentFrame } from './document-frame.ts';
import type { Selection, Size } from './general-types.ts';
import type { AffineTransform } from './affine-transform.ts';
import type { LayerId } from './layer-types.ts';

/** An id is only meaningful through the runtime asset registry. */
export type AssetId = string & { readonly __assetId: unique symbol };

export type PlainPrimitive = string | number | boolean | null;
export type PlainValue = PlainPrimitive | PlainObject | readonly PlainValue[];
export type PlainObject = { readonly [key: string]: PlainValue | undefined };

export type DurableLayerSource =
  | Readonly<{
      kind: 'blank';
      color: string;
      opacity: number;
      size: Size;
      isBedrock?: boolean;
    }>
  | Readonly<{
      kind: 'raster';
      assetId: AssetId;
      width: number;
      height: number;
      name?: string;
      isBedrock?: boolean;
    }>
  | Readonly<{
      kind: 'vector';
      toolName: string;
      args: PlainObject;
      size: Size;
      sourcePos: Readonly<{ x: number; y: number; width: number; height: number }>;
      isBedrock?: boolean;
    }>
  | Readonly<{
      kind: 'text';
      /**
       * Always `'text'` for this variant. Declared rather than inferred: the adapter
       * emitted it from the start, and `Object.freeze`'s inferred return type defeated
       * excess-property checking, so a reader had to probe for it at runtime.
       */
      toolName: string;
      args: PlainObject;
      size: Size;
      sourcePos: Readonly<{ x: number; y: number; width: number; height: number }>;
      isBedrock?: boolean;
    }>
  /** Bounded compatibility input. New writers must use a typed source. */
  | Readonly<{
      kind: 'legacy-tool';
      toolName: string;
      args: PlainObject;
      size: Size;
      isBedrock?: boolean;
    }>;

/**
 * The source kinds a source edit may install, and the reason the union is a
 * narrowing of {@link DurableLayerSource} rather than that type itself.
 *
 * A source edit exists so an existing layer's EDITABLE source arguments can be
 * rewritten in place — a text layer retyped, a shape restyled — instead of being
 * replaced by a second layer. Only `text` and `vector` carry tool arguments a
 * later edit can rewrite, so only those are admissible:
 *
 * - `raster` is excluded so the operation cannot carry a bitmap. A payload that
 *   held one would put a second copy of the pixels in the timeline, which is
 *   exactly what the document-scoped asset registry exists to prevent, and it
 *   would need an asset id this type has no way to prove resolves. Replacing
 *   raster content is a different operation with a different owner.
 * - `legacy-tool` is excluded because it is documented above as bounded
 *   compatibility input: new writers must use a typed source, and a source edit
 *   is a new writer.
 * - `blank` is excluded because its content is a colour and an opacity rather
 *   than tool arguments, so there is no source argument set to rewrite.
 *
 * Excluding them in the TYPE is the guarantee; a runtime check in
 * `validatePlannedDurableEntry` is the second line, for an entry that arrived
 * from outside the type system.
 */
export type EditableDurableLayerSource = Readonly<Extract<DurableLayerSource, { kind: 'text' | 'vector' }>>;

export type DurableLayerSnapshot = Readonly<{
  id: LayerId;
  name: string;
  isBedrock: boolean;
  visible: boolean;
  opacity: number;
  locked: boolean;
  blendMode: GlobalCompositeOperation;
  order: number;
  pos: Readonly<{ x: number; y: number; width: number; height: number }>;
  source: DurableLayerSource;
}>;

/** Kept as a source-compatible alias for the first scaffolding users. */
export type LayerSnapshot = DurableLayerSnapshot;

export type SelectionSnapshot = Readonly<{
  selections: readonly Selection[];
  activeSelectionId: string | null;
}>;

export type DurableFilter = Readonly<{
  toolName: 'blur' | 'color' | 'levels';
  version: number;
  args: PlainObject;
}>;

export type DurableLayerPropertyPatch = Readonly<
  Partial<Pick<DurableLayerSnapshot, 'name' | 'visible' | 'opacity' | 'locked' | 'blendMode' | 'pos'>>
>;

/** Compatibility alias used by callers of the provisional model. */
export type LayerPropertyPatch = DurableLayerPropertyPatch;

export type DurableOperation =
  | Readonly<{ kind: 'create-layer'; layer: DurableLayerSnapshot }>
  | Readonly<{ kind: 'remove-layer'; layerId: LayerId }>
  | Readonly<{ kind: 'set-layer-properties'; layerId: LayerId; patch: DurableLayerPropertyPatch }>
  | Readonly<{
      kind: 'reposition-layer';
      layerId: LayerId;
      move?: Readonly<{ x: number; y: number }>;
      resize?: Readonly<{ x: number; y: number; width: number; height: number }>;
    }>
  | Readonly<{ kind: 'reorder-layers'; orderByLayerId: Readonly<Record<LayerId, number>> }>
  | Readonly<{ kind: 'apply-filter'; layerId: LayerId; filter: DurableFilter }>
  | Readonly<{ kind: 'apply-affine-transform'; layerId: LayerId; transform: AffineTransform }>
  | Readonly<{
      kind: 'apply-raster-processor';
      layerId: LayerId;
      processorId: string;
      version: number;
      args: PlainObject;
    }>
  | Readonly<{
      kind: 'set-document-frame';
      previous: DocumentFrame;
      next: DocumentFrame;
    }>
  | Readonly<{
      /**
       * Replaces an existing layer's editable source arguments in place.
       *
       * This is the correction path: editing a text or shape layer rewrites the
       * source it already has instead of adding a replacement layer, which is
       * what `DurableLayerPropertyPatch` deliberately cannot express. `source`
       * and `pos` travel together because a source edit re-measures the layer
       * box — a longer string, a larger font size — and a legacy entry that
       * moved both must produce ONE durable operation, or the legacy-to-durable
       * cursor map would grow by two for one edit and every cursor after it would
       * address the wrong entry.
       *
       * `pos` is stated rather than derived so this reducer stays mechanical: the
       * reducer installs what the operation says, and the rule that the source
       * measures to this box — `sourcePos` equal to `pos`, `size` equal to the
       * box's width and height — is enforced once, where the entry is derived and
       * once, where it is graded.
       */
      kind: 'replace-layer-source';
      layerId: LayerId;
      source: EditableDurableLayerSource;
      pos: Readonly<{ x: number; y: number; width: number; height: number }>;
    }>
  | Readonly<{ kind: 'merge-document'; result: DurableLayerSnapshot; removedLayerIds: readonly LayerId[] }>
  | Readonly<{ kind: 'set-selection'; before: SelectionSnapshot; after: SelectionSnapshot }>;

/** Compatibility alias used by the initial history-model scaffolding. */
export type HistoryOperation = DurableOperation;

/** The one source-rewrite operation, named for the code that grades and narrows it. */
export type ReplaceLayerSourceOperation = Extract<DurableOperation, { kind: 'replace-layer-source' }>;

export type DurableHistoryEntry<Op extends DurableOperation = DurableOperation> = Readonly<{
  id: string;
  schemaVersion: number;
  enabled: boolean;
  operation: Op;
}>;

export type HistoryEntry = DurableHistoryEntry;

export type DurableBaseline = Readonly<{
  frame: DocumentFrame;
  layers: readonly DurableLayerSnapshot[];
  selections: SelectionSnapshot;
  activeLayerId: LayerId | null;
}>;

export type DocumentSnapshot = DurableBaseline;

export type DurableDocument = Readonly<{
  documentId: string;
  documentRevision: number;
  branchRevision: number;
  durableRevision: number;
  baseline: DurableBaseline;
  history: readonly DurableHistoryEntry[];
  cursor: number;
}>;

export const DURABLE_SCHEMA_VERSION = 1;

function collectLayerSourceAsset(source: DurableLayerSource, assetIds: Set<AssetId>) {
  if (source.kind === 'raster') assetIds.add(source.assetId);
}

function collectLayerAsset(layer: DurableLayerSnapshot, assetIds: Set<AssetId>) {
  collectLayerSourceAsset(layer.source, assetIds);
}

/**
 * Every asset referenced by a baseline or any replayable entry remains
 * reachable, so `reconcileDocumentAssets` never releases a live bitmap. Cursor
 * position is intentionally ignored: undo must retain the assets needed to redo
 * without reconstructing a new baseline.
 *
 * The `never` arm is load-bearing. Without it a kind added to `DurableOperation`
 * compiles, and this switch — which is deliberately selective rather than
 * exhaustive, because only two kinds carry a bitmap — falls off its end and skips
 * the new kind. `reconcileDocumentAssets` then releases an asset the document
 * still reaches, and the next `resolve` throws on a closed bitmap. Adding a kind
 * without classifying it here is a typecheck error, which is the only moment the
 * omission is cheap to fix.
 */
export function collectDurableAssetIds(document: DurableDocument): ReadonlySet<AssetId> {
  const assetIds = new Set<AssetId>();
  for (const layer of document.baseline.layers) collectLayerAsset(layer, assetIds);
  for (const entry of document.history) {
    const { kind } = entry.operation;
    switch (kind) {
      case 'create-layer':
        collectLayerAsset(entry.operation.layer, assetIds);
        break;
      case 'merge-document':
        collectLayerAsset(entry.operation.result, assetIds);
        break;
      // Every remaining kind holds no bitmap: each names layers by id, carries
      // plain args, or writes the frame and the selection. They are named rather
      // than lumped into the default so that the classification is a claim a
      // reader can check, and so that adding a kind forces a decision here.
      case 'remove-layer':
      case 'set-layer-properties':
      case 'reposition-layer':
      case 'reorder-layers':
      case 'apply-filter':
      case 'apply-affine-transform':
      case 'apply-raster-processor':
      case 'set-document-frame':
      case 'set-selection':
        break;
      /**
       * Holds no bitmap, and that is a property of its TYPE rather than of this
       * function's reading of it: `source` is
       * `EditableDurableLayerSource`, which admits only `text` and `vector`, and
       * `collectLayerSourceAsset` above collects from `raster` alone. So there is
       * no arm here to write and none to get wrong — widening the payload type
       * is what would break this claim, and it is a typecheck error wherever the
       * payload is constructed.
       */
      case 'replace-layer-source':
        break;
      default:
        const _exhaustive: never = kind;
        void _exhaustive;
    }
  }
  return assetIds;
}

function clonePlainValue(value: PlainValue | undefined): PlainValue | undefined {
  if (Array.isArray(value)) return Object.freeze(value.map((item) => clonePlainValue(item) as PlainValue));
  if (!value || typeof value !== 'object') return value;
  return Object.freeze(
    Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clonePlainValue(item)])) as PlainObject
  );
}

/**
 * The single copy of a selection snapshot for the durable path. `durable-replay.ts`
 * imports this rather than reimplementing it, because its private predecessor
 * omitted `metadata` unconditionally and a second copy is how that survived.
 */
export function cloneSelectionSnapshot(snapshot: SelectionSnapshot): SelectionSnapshot {
  return Object.freeze({
    selections: Object.freeze(
      snapshot.selections.map((selection) =>
        Object.freeze({
          ...selection,
          points: Object.freeze(selection.points.map((point) => Object.freeze({ ...point }))),
          pos: Object.freeze({ ...selection.pos }),
          ...(selection.metadata ? { metadata: clonePlainValue(selection.metadata) } : {}),
        })
      )
    ),
    activeSelectionId: snapshot.activeSelectionId,
  }) as unknown as SelectionSnapshot;
}

function cloneLayerSource(source: DurableLayerSource): DurableLayerSource {
  switch (source.kind) {
    case 'blank':
      return Object.freeze({ ...source, size: Object.freeze({ ...source.size }) });
    case 'raster':
      return Object.freeze({ ...source });
    case 'vector':
    case 'text':
    case 'legacy-tool':
      return Object.freeze({
        ...source,
        args: clonePlainValue(source.args) as PlainObject,
        size: Object.freeze({ ...source.size }),
        ...('sourcePos' in source ? { sourcePos: Object.freeze({ ...source.sourcePos }) } : {}),
      });
  }
}

/**
 * `cloneLayerSource` widened to its input's kind, so a source edit can clone its
 * payload without erasing what the payload is.
 *
 * The `if` is unreachable while `EditableDurableLayerSource` holds only `text` and
 * `vector`, and it is here so that widening that type is a loud failure at the
 * clone rather than a `DurableLayerSource` quietly handed back where an editable
 * one was promised — which would move the kind check to every reader instead.
 */
function cloneEditableLayerSource(source: EditableDurableLayerSource): EditableDurableLayerSource {
  const cloned = cloneLayerSource(source);
  if (cloned.kind !== 'text' && cloned.kind !== 'vector') {
    throw new Error(`An editable layer source must be text or vector, not ${cloned.kind}`);
  }
  return cloned;
}

export function toLayerSnapshot(
  layer: Omit<DurableLayerSnapshot, 'source'>,
  source: DurableLayerSource
): DurableLayerSnapshot {
  return Object.freeze({
    ...layer,
    pos: Object.freeze({ ...layer.pos }),
    source: cloneLayerSource(source),
  });
}

export function cloneLayerSnapshot(layer: DurableLayerSnapshot): DurableLayerSnapshot {
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
      pos: layer.pos,
    },
    layer.source
  );
}

function cloneOperation(operation: DurableOperation): DurableOperation {
  switch (operation.kind) {
    case 'create-layer':
      return Object.freeze({ ...operation, layer: cloneLayerSnapshot(operation.layer) });
    case 'apply-affine-transform':
      return Object.freeze({ ...operation, transform: Object.freeze({ ...operation.transform }) });
    case 'apply-filter':
      return Object.freeze({
        ...operation,
        filter: Object.freeze({ ...operation.filter, args: clonePlainValue(operation.filter.args) as PlainObject }),
      });
    case 'apply-raster-processor':
      return Object.freeze({ ...operation, args: clonePlainValue(operation.args) as PlainObject });
    case 'set-layer-properties':
      return Object.freeze({
        ...operation,
        patch: Object.freeze({
          ...operation.patch,
          ...(operation.patch.pos ? { pos: Object.freeze({ ...operation.patch.pos }) } : {}),
        }),
      });
    case 'reposition-layer':
      return Object.freeze({
        ...operation,
        ...(operation.move ? { move: Object.freeze({ ...operation.move }) } : {}),
        ...(operation.resize ? { resize: Object.freeze({ ...operation.resize }) } : {}),
      });
    case 'set-document-frame':
      return Object.freeze({
        ...operation,
        previous: Object.freeze({ ...operation.previous }),
        next: Object.freeze({ ...operation.next }),
      });
    case 'merge-document':
      return Object.freeze({
        ...operation,
        result: cloneLayerSnapshot(operation.result),
        removedLayerIds: Object.freeze([...operation.removedLayerIds]),
      });
    case 'set-selection':
      return Object.freeze({
        ...operation,
        before: cloneSelectionSnapshot(operation.before),
        after: cloneSelectionSnapshot(operation.after),
      });
    case 'reorder-layers':
      return Object.freeze({ ...operation, orderByLayerId: Object.freeze({ ...operation.orderByLayerId }) });
    case 'replace-layer-source':
      // `cloneLayerSource` deep-copies the tool arguments and freezes the source,
      // `size` and `sourcePos` with them, so the operation holds no reference into
      // the caller's source object. A clone that aliased `args` here would let a
      // later edit of the legacy args rewrite a past durable entry in place.
      return Object.freeze({
        ...operation,
        source: cloneEditableLayerSource(operation.source),
        pos: Object.freeze({ ...operation.pos }),
      });
    case 'remove-layer':
      return Object.freeze({ ...operation });
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

export function freezeDurableDocument(document: DurableDocument): DurableDocument {
  const baseline: DurableBaseline = Object.freeze({
    frame: Object.freeze({ ...document.baseline.frame }),
    layers: Object.freeze(document.baseline.layers.map(cloneLayerSnapshot)),
    selections: cloneSelectionSnapshot(document.baseline.selections),
    activeLayerId: document.baseline.activeLayerId,
  });
  const history = Object.freeze(
    document.history.map((entry) =>
      Object.freeze({
        id: entry.id,
        schemaVersion: entry.schemaVersion,
        enabled: entry.enabled,
        operation: cloneOperation(entry.operation),
      })
    )
  );
  return Object.freeze({
    ...document,
    baseline,
    history,
    /**
     * Total cursor clamp: a non-finite or non-integer index has no position in the
     * timeline and refuses to `-1`; a finite integer is clamped into `[-1, tip]`.
     * Kept byte-identical in `history-model.ts` and `durable-replay.ts`;
     * `setDurableCursor` refuses with the same `Number.isInteger` predicate.
     */
    cursor: Number.isInteger(document.cursor) ? Math.max(-1, Math.min(document.cursor, history.length - 1)) : -1,
  });
}

export function cloneDurableDocument(document: DurableDocument): DurableDocument {
  return freezeDurableDocument({
    ...document,
    baseline: document.baseline,
    history: document.history,
  });
}
