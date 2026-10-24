import { SELECTION_ACTION } from '../util/constants.ts';
import type { Point, Selection, SelectionMetadata } from './general-types.ts';
import type { SelectionSnapshot } from './history-model.ts';
import type { HistoryItem } from './history-types.ts';
import { isCanonicalRasterSelectionMask } from '../util/selection-mask.ts';

/**
 * The selection payload carried by a legacy `SELECTION_ACTION` entry. Both the
 * baseline and the per-entry transition are read through this one shape so the
 * legacy replay and the durable conversion cannot disagree about the field
 * names.
 */
export type SelectionHistoryArgs = {
  previousSelectionState?: SelectionSnapshot;
  nextSelectionState?: SelectionSnapshot;
};

function hasOwnDataKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Reflect.ownKeys(value).every((key) => {
      if (typeof key !== 'string' || !allowed.has(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !!descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
    })
  );
}

function hasFiniteKeys(value: unknown, keys: readonly string[]): boolean {
  return (
    hasOwnDataKeys(value, keys) && keys.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]))
  );
}

function hasDenseArray<T>(value: unknown, isItem: (item: unknown) => item is T): value is T[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !isItem(descriptor.value)) return false;
  }
  return keys.every((key) => {
    if (key === 'length') return true;
    if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)) return false;
    const index = Number(key);
    return index < value.length && String(index) === key;
  });
}

const SELECTION_SOURCE_TOOLS = [
  'polygonal-lasso',
  'freehand-lasso',
  'feather-magnetic-lasso',
  'magic-wand',
  'quick-selection',
  'rectangular-selection',
] as const;

function isCanonicalMetadata(value: unknown): value is SelectionMetadata {
  if (
    !hasOwnDataKeys(value, [], ['copiedAtVersion', 'movedAtVersion', 'featherRadius', 'magneticLasso', 'magicWand'])
  ) {
    return false;
  }
  for (const key of ['copiedAtVersion', 'movedAtVersion', 'featherRadius']) {
    const field = value[key];
    if (field !== undefined && (typeof field !== 'number' || !Number.isFinite(field))) return false;
  }

  if (Object.hasOwn(value, 'magneticLasso') && value.magneticLasso !== undefined) {
    const settings = value.magneticLasso;
    const numericKeys = ['width', 'contrast', 'frequency', 'snapStrength', 'smoothing', 'pathPointCount'];
    if (
      !hasOwnDataKeys(settings, [...numericKeys, 'antiAlias']) ||
      !numericKeys.every((key) => typeof settings[key] === 'number' && Number.isFinite(settings[key])) ||
      typeof settings.antiAlias !== 'boolean'
    ) {
      return false;
    }
  }

  if (Object.hasOwn(value, 'magicWand') && value.magicWand !== undefined) {
    const settings = value.magicWand;
    const commonNumericKeys = ['tolerance', 'smoothing', 'selectedPixelCount'];
    const hasEdgeCount =
      !!settings &&
      typeof settings === 'object' &&
      !Array.isArray(settings) &&
      Object.hasOwn(settings, 'boundaryEdgeCount');
    const hasLegacyPointCount =
      !!settings &&
      typeof settings === 'object' &&
      !Array.isArray(settings) &&
      Object.hasOwn(settings, 'boundaryPointCount');
    const boundaryCountKey = hasEdgeCount ? 'boundaryEdgeCount' : 'boundaryPointCount';
    const numericKeys = [...commonNumericKeys, boundaryCountKey];
    if (
      hasEdgeCount === hasLegacyPointCount ||
      !hasOwnDataKeys(settings, [...numericKeys, 'seed', 'sampleColor']) ||
      !numericKeys.every((key) => typeof settings[key] === 'number' && Number.isFinite(settings[key])) ||
      !hasFiniteKeys(settings.seed, ['x', 'y']) ||
      !hasFiniteKeys(settings.sampleColor, ['r', 'g', 'b', 'a'])
    ) {
      return false;
    }
  }

  return true;
}

function isCanonicalSelection(value: unknown): value is Selection {
  if (
    !hasOwnDataKeys(
      value,
      ['id', 'points', 'isActive', 'pos'],
      ['lifecycle', 'geometry', 'sourceTool', 'metadata', 'rasterMask']
    )
  ) {
    return false;
  }
  const validPoints = hasDenseArray(
    value.points,
    (contour): contour is Selection['points'][number] =>
      Array.isArray(contour) && hasDenseArray(contour, (point): point is Point => hasFiniteKeys(point, ['x', 'y']))
  );
  const validPos = hasFiniteKeys(value.pos, ['x', 'y', 'width', 'height']);
  const pos = value.pos;
  const validRasterMask =
    value.rasterMask === undefined ||
    (isCanonicalRasterSelectionMask(value.rasterMask) &&
      value.geometry === 'polygon' &&
      (value.sourceTool === 'magic-wand' || value.sourceTool === 'quick-selection') &&
      Array.isArray(value.points) &&
      value.points.length === 0 &&
      hasOwnDataKeys(pos, ['x', 'y', 'width', 'height']) &&
      ['x', 'y', 'width', 'height'].every((key) => typeof pos[key] === 'number' && Number.isFinite(pos[key])) &&
      pos.width === value.rasterMask.width &&
      pos.height === value.rasterMask.height);

  return (
    typeof value.id === 'string' &&
    typeof value.isActive === 'boolean' &&
    (value.lifecycle === undefined || value.lifecycle === 'committed') &&
    (value.geometry === undefined || value.geometry === 'polygon' || value.geometry === 'rectangle') &&
    (value.sourceTool === undefined ||
      (typeof value.sourceTool === 'string' && SELECTION_SOURCE_TOOLS.some((tool) => tool === value.sourceTool))) &&
    validPoints &&
    validPos &&
    validRasterMask &&
    (value.metadata === undefined || isCanonicalMetadata(value.metadata))
  );
}

export function isValidSelectionSnapshot(value: unknown): value is SelectionSnapshot {
  if (!hasOwnDataKeys(value, ['selections'], ['activeSelectionId'])) return false;
  if (!hasDenseArray(value.selections, isCanonicalSelection)) return false;
  return (
    (value.activeSelectionId === undefined ||
      value.activeSelectionId === null ||
      typeof value.activeSelectionId === 'string') &&
    isSelectionSnapshotActiveStateValid(value.selections, value.activeSelectionId)
  );
}

/** Keep the ID used by pixel tools aligned with the `isActive` flag used by the ants renderer. */
export function isSelectionSnapshotActiveStateValid(
  selections: readonly Pick<Selection, 'id' | 'isActive'>[],
  activeSelectionId: unknown
): boolean {
  const identifiers = new Set<string>();
  for (const selection of selections) {
    if (identifiers.has(selection.id)) return false;
    identifiers.add(selection.id);
  }

  // Key-absent IDs are legacy snapshots whose older consumers relied on `isActive` alone.
  if (activeSelectionId === undefined) return true;

  const activeSelections = selections.filter((selection) => selection.isActive);
  if (activeSelectionId === null) return activeSelections.length === 0;
  if (typeof activeSelectionId !== 'string') return false;

  return (
    activeSelections.length === 1 &&
    activeSelections[0]?.id === activeSelectionId &&
    selections.some((selection) => selection.id === activeSelectionId)
  );
}

function cloneSelection(selection: Selection): Selection {
  return {
    ...selection,
    points: selection.points.map((contour) => contour.map((point) => ({ ...point }))),
    ...(selection.rasterMask ? { rasterMask: { ...selection.rasterMask } } : {}),
    pos: { ...selection.pos },
    ...(selection.metadata ? { metadata: JSON.parse(JSON.stringify(selection.metadata)) } : {}),
  };
}

/**
 * The shared owner of the selection baseline rule, and the clone both replay
 * paths use to keep a selection snapshot off the legacy history args.
 *
 * `points`, `pos`, `metadata`, and the mask object are copied and the wrapper and the
 * selections array are frozen, so nothing returned here aliases the array it
 * was given. The `Selection` elements and their nested objects are copied but
 * not frozen; the durable model deep-freezes those itself when it clones an
 * operation.
 */
export function selectionSnapshot(
  selections: readonly Selection[] = [],
  activeSelectionId: string | null = null
): SelectionSnapshot {
  return Object.freeze({
    selections: Object.freeze(selections.map(cloneSelection)),
    activeSelectionId,
  });
}

/**
 * The single derivation of the selection state a legacy timeline starts from.
 *
 * The lookup is deliberately unbounded. A selection is created by a gesture that
 * writes no history entry, so the first non-disabled `SELECTION_ACTION` entry's
 * `previousSelectionState` is the only record that the selection ever existed;
 * bounding this at a replay target would make undoing a tool-switch deselect a
 * silent visual no-op. The same reasoning is why the durable baseline is seeded
 * from the same unbounded lookup, so both branches agree at every cursor.
 */
export function deriveSelectionBaseline(history: readonly HistoryItem[]): SelectionSnapshot {
  const first = history.find((item) => {
    const actionName = Object.getOwnPropertyDescriptor(item, 'actionName');
    const disabled = Object.getOwnPropertyDescriptor(item, 'disabled');
    return (
      actionName?.enumerable &&
      Object.hasOwn(actionName, 'value') &&
      actionName.value === SELECTION_ACTION &&
      (!disabled || (disabled.enumerable && Object.hasOwn(disabled, 'value') && !disabled.value))
    );
  });
  const argsDescriptor = first ? Object.getOwnPropertyDescriptor(first, 'args') : undefined;
  const args = argsDescriptor?.enumerable && Object.hasOwn(argsDescriptor, 'value') ? argsDescriptor.value : undefined;
  const previousDescriptor = args ? Object.getOwnPropertyDescriptor(args, 'previousSelectionState') : undefined;
  const previous =
    previousDescriptor?.enumerable && Object.hasOwn(previousDescriptor, 'value') ? previousDescriptor.value : undefined;
  if (previous === undefined || previous === null) return selectionSnapshot();
  if (!isValidSelectionSnapshot(previous)) {
    throw new Error('Legacy selection baseline is not a canonical selection snapshot.');
  }
  return selectionSnapshot(previous.selections, previous.activeSelectionId ?? null);
}
