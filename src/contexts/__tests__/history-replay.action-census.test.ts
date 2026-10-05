/**
 * `ActionType` is the union of every action name a history entry may carry, and
 * `replayHistory` walks a timeline applying each entry. Nothing connected those
 * two facts: an action could join the union, or an existing arm could be
 * deleted, and the loop would skip the entry at
 * `if (actionName !== TOOL_ACTION)` — reporting nothing. A silent skip is a user
 * edit that vanished, which is what `ReplayDiagnostic` exists to prevent.
 *
 * This suite closes that gap as a CONTRACT rather than a defect list. `CENSUS` is
 * a `Record<ActionType, …>`, so adding a union member is a `tsc` error, not a
 * silently-uncased action — the compiler is the exhaustiveness check, and the
 * runtime assertions below only have to say what a member must do.
 *
 * Two deliberate properties:
 *
 *  1. The assertion is APPLIED-OR-DIAGNOSED, never "applies successfully". An
 *     action that is legitimately refused must report itself; one that applies
 *     must change the replayed state. This does not pin which, so a future fix
 *     that turns a refusal into an application does not have to fight the test.
 *  2. Each case carries its own PREFIX. `SHOW_LAYER_ACTION` on a visible layer
 *     and `HIDE_LAYER_ACTION` on a hidden one are both no-ops, so a single shared
 *     baseline would record two members as "silently dropped" when neither is.
 *     Per-case prefixes keep the contract honest without asserting per-action
 *     behaviour, which is what would make it a defect list.
 *
 * What this does NOT pin: that a given action produces a given layer state. The
 * per-arm suites own that. This owns only the closure property — every action the
 * union can name is accounted for.
 *
 * The projection in `replayedStateOf` is the limit on that property, so it has to
 * observe every field a replay arm can write. It did not: it dropped `opacity`, the
 * field `LAYER_TRANSPARENCY_ACTION` is named for, so a CORRECT arm for that action
 * read as `applied:false, reported:false` and this suite failed on the fix it
 * exists to enable. A census that cannot see the change it censuses is worse than
 * none, because it looks like coverage.
 */
import { isDeepStrictEqual } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { replayHistory, type HistoryReplayDependencies, type HistoryReplayResult } from '../history-replay.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayerSource } from '../layer-types.ts';
import { documentFrameFromSize } from '../document-frame.ts';
import { overrideCanvasFilterSupport } from '../../util/canvas-filter.ts';
import {
  HIDE_LAYER_ACTION,
  LAYER_TRANSPARENCY_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  OPEN_DOCUMENT_ACTION,
  REMOVE_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  REPLACE_LAYER_SOURCE_ACTION,
  SELECTION_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SET_LAYER_OPACITY_ACTION,
  SHOW_LAYER_ACTION,
  TOOL_ACTION,
  type ActionType,
} from '../../util/constants.ts';

const layerId = 'layer-1';
const initialSize = { width: 400, height: 300 };

const blankSource = {
  kind: 'blank',
  color: '#ffffff',
  opacity: 1,
  pos: { x: 0, y: 0, width: 100, height: 80 },
} satisfies LayerSource;

/** A merge must leave a layer OBSERVABLY different, or the arm reads as a no-op. */
const mergedSource = { ...blankSource, pos: { x: 0, y: 0, width: 20, height: 20 } } satisfies LayerSource;

/** A `tool` source, which is the only kind `REPLACE_LAYER_SOURCE_ACTION` installs. */
const toolSource = {
  kind: 'tool',
  args: {
    toolName: 'rectangle',
    figure: 'rectangle',
    alpha: 1,
    color: '#000000',
    backgroundColor: null,
    lineWidth: 1,
  },
  pos: { x: 0, y: 0, width: 60, height: 40 },
} satisfies LayerSource;

function createTestLayer(id: string, overrides: Partial<Layer> = {}): Layer {
  return {
    id,
    name: 'Layer',
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 1,
    pos: { ...blankSource.pos },
    operations: [],
    ...overrides,
  };
}

/**
 * `createLayer` from the real dependencies, modelled rather than stubbed: it reads
 * the source's `pos` and keeps the source, so a `MERGE_ACTION` or
 * `REPLACE_LAYER_SOURCE_ACTION` entry is observably different from the layer it
 * replaces. A mock that returned a fixed layer made both arms look like no-ops.
 *
 * `NewLayerData` is a union, so `pos` is narrowed explicitly rather than trusted —
 * a bedrock source carries `size` instead, and reading `pos` off it would be the
 * mistake `history-append.ts` documents at its own narrowing site.
 *
 * `applyRasterTool` is where every `commit: 'raster' | 'source' | 'selection'`
 * tool ends up: `replayHistory` stores its return value as the layer record
 * verbatim, so a stub that returned the layer unchanged made the whole raster path
 * invisible and no such action could ever be reported as applied. `name` is the
 * sentinel this repository already uses for that, in `history-replay.branches`
 * and `history-replay.frame-invariance`.
 */
function createDependencies(): HistoryReplayDependencies {
  return {
    createLayer: vi.fn((input) =>
      createTestLayer(input.layerId, {
        pos: 'pos' in input.source ? { ...input.source.pos } : { ...blankSource.pos },
        source: input.source,
      })
    ),
    applyRasterTool: vi.fn((layer: Layer) => ({ ...layer, name: 'rasterized' })),
  };
}

const entry = (overrides: Partial<HistoryItem>): HistoryItem =>
  ({ id: 'entry', layerId, disabled: false, ...overrides }) as HistoryItem;

/**
 * A one-layer document with the layer VISIBLE, so a visibility action always has
 * a target. The `SHOW_LAYER_ACTION` case hides it with a real `HIDE_LAYER_ACTION`
 * entry first, because showing a visible layer is a no-op — and the census asserts
 * applied-OR-reported, so a no-op toggle would read as a silent drop.
 */
function oneLayerDocument(): HistoryItem[] {
  return [
    entry({
      id: 'open-document',
      actionName: OPEN_DOCUMENT_ACTION,
      documentSource: { layers: {}, size: { ...initialSize }, frame: documentFrameFromSize(initialSize) },
    }),
    entry({ id: 'new-layer', actionName: NEW_LAYER_ACTION, layerSource: blankSource }),
  ];
}

const hideEntry = (): HistoryItem => entry({ id: 'hide-prefix', actionName: HIDE_LAYER_ACTION });
const showEntry = (): HistoryItem => entry({ id: 'show-entry', actionName: SHOW_LAYER_ACTION });

/**
 * The replayed state, reduced to what an entry can change.
 *
 * It covers every `Layer` field a replay arm writes, because the census's whole
 * claim is bounded by what this can see: a field dropped here is an action the
 * census reports as not-applied. `bitmap` and `tmpCanvas` are recorded as presence
 * booleans — they are not JSON-comparable and no action's presence or absence turns
 * on their identity — and layer ids are SORTED so the comparison is not sensitive to
 * the order `replayHistory` happened to insert them in.
 *
 * This is an object, not a string. A `JSON.stringify` comparison drops `undefined`
 * (so an absent `lastHistoryId` and an `undefined` one are the same reading) and
 * renders `NaN` as `null`; both fail OPEN, which is the wrong direction for a gate.
 */
function replayedStateOf(result: HistoryReplayResult): unknown {
  const layers = Object.fromEntries(
    Object.entries(result.layers)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, layer]) => [
        id,
        {
          name: layer.name,
          isBedrock: layer.isBedrock,
          visible: layer.visible,
          opacity: layer.opacity,
          locked: layer.locked,
          blendMode: layer.blendMode,
          order: layer.order,
          pos: layer.pos,
          lastHistoryId: layer.lastHistoryId ?? null,
          hasBitmap: layer.bitmap !== null,
          hasTempCanvas: layer.tmpCanvas !== null,
          sourceKind: layer.source?.kind ?? null,
          operations: layer.operations.map((operation) => ({
            id: operation.id,
            kind: operation.kind ?? null,
            enabled: operation.enabled,
            // `LayerOperation` is a union, so the payload field is narrowed rather
            // than assumed: a filter operation carries `args`, an affine one `transform`.
            payload: 'args' in operation ? { args: operation.args } : { transform: operation.transform },
          })),
        },
      ])
  );
  return {
    layers,
    documentFrame: result.documentFrame,
    selections: result.selections,
    activeSelectionId: result.activeSelectionId,
  };
}

type CensusCase = Readonly<{
  /** What the action is exercised against, so a failure names a real situation. */
  label: string;
  prefix: readonly HistoryItem[];
  entry: HistoryItem;
}>;

const CENSUS: Record<ActionType, CensusCase> = {
  [OPEN_DOCUMENT_ACTION]: {
    // No prefix: a `documentSource` is honoured only at index 0, which is the one
    // position `useApp.ts` writes one. Carried mid-history it is refused, so a
    // prefix would measure that refusal instead of the arm. The entry's document is
    // a different SIZE from the initial frame, so applying it is observable.
    label: 'a document replacement as the first entry of a timeline',
    prefix: [],
    entry: entry({
      id: 'open-document-entry',
      actionName: OPEN_DOCUMENT_ACTION,
      documentSource: { layers: {}, size: { width: 200, height: 150 } },
    }),
  },
  [NEW_LAYER_ACTION]: {
    label: 'a new layer',
    prefix: oneLayerDocument(),
    entry: entry({ id: 'new-layer-entry', actionName: NEW_LAYER_ACTION, layerId: 'layer-2', layerSource: blankSource }),
  },
  [SELECTION_ACTION]: {
    label: 'a selection change',
    prefix: oneLayerDocument(),
    entry: entry({
      id: 'selection-entry',
      actionName: SELECTION_ACTION,
      layerId: 'selection',
      args: {
        nextSelectionState: {
          selections: [{ id: 'selection-1', name: 'Selection 1', source: { kind: 'rectangle' } }],
          activeSelectionId: 'selection-1',
        },
      },
    }),
  },
  [TOOL_ACTION]: {
    label: 'a layer-operation tool, which appends an operation instead of rasterizing',
    prefix: oneLayerDocument(),
    entry: entry({ id: 'tool-entry', actionName: TOOL_ACTION, args: { toolName: 'blur', radius: 2 } }),
  },
  [SHOW_LAYER_ACTION]: {
    label: 'showing a layer an earlier entry hid',
    prefix: [...oneLayerDocument(), hideEntry()],
    entry: showEntry(),
  },
  [HIDE_LAYER_ACTION]: {
    label: 'hiding a visible layer',
    prefix: oneLayerDocument(),
    entry: entry({ id: 'hide-entry', actionName: HIDE_LAYER_ACTION }),
  },
  [RENAME_LAYER_ACTION]: {
    label: 'a rename',
    prefix: oneLayerDocument(),
    entry: entry({ id: 'rename-entry', actionName: RENAME_LAYER_ACTION, args: { name: 'Renamed' } }),
  },
  [SET_LAYER_OPACITY_ACTION]: {
    label: 'setting a layer opacity',
    prefix: oneLayerDocument(),
    entry: entry({ id: 'opacity-entry', actionName: SET_LAYER_OPACITY_ACTION, args: { opacity: 0.35 } }),
  },
  [REORDER_ACTION]: {
    label: 'a reorder',
    prefix: [
      ...oneLayerDocument(),
      entry({ id: 'new-layer-two', actionName: NEW_LAYER_ACTION, layerId: 'layer-2', layerSource: blankSource }),
    ],
    entry: entry({
      id: 'reorder-entry',
      actionName: REORDER_ACTION,
      args: { layerToMoveId: 'layer-2', afterWhichLayerId: layerId },
    }),
  },
  [MERGE_ACTION]: {
    label: 'a merge',
    prefix: oneLayerDocument(),
    entry: entry({ id: 'merge-entry', actionName: MERGE_ACTION, layerSource: mergedSource }),
  },
  [REPLACE_LAYER_SOURCE_ACTION]: {
    label: 'a source replacement',
    prefix: oneLayerDocument(),
    entry: entry({
      id: 'replace-source-entry',
      actionName: REPLACE_LAYER_SOURCE_ACTION,
      args: { source: toolSource },
    }),
  },
  [REMOVE_ACTION]: {
    label: 'a removal',
    prefix: oneLayerDocument(),
    entry: entry({ id: 'remove-entry', actionName: REMOVE_ACTION }),
  },
  [SET_DOCUMENT_FRAME_ACTION]: {
    label: 'a crop',
    prefix: oneLayerDocument(),
    entry: entry({
      id: 'set-frame-entry',
      actionName: SET_DOCUMENT_FRAME_ACTION,
      args: { nextFrame: { x: 0, y: 0, width: 200, height: 150 } },
    }),
  },
  [LAYER_TRANSPARENCY_ACTION]: {
    label: 'a layer transparency change, which no production action dispatches',
    prefix: oneLayerDocument(),
    entry: entry({ id: 'transparency-entry', actionName: LAYER_TRANSPARENCY_ACTION }),
  },
};

const CASES = Object.entries(CENSUS) as [ActionType, CensusCase][];

/**
 * Rows for `it.each`, with the LABEL lifted into its own column.
 *
 * `it.each` formats each `%s` from a column of the row array, so the original
 * two-column row printed the whole `CensusCase` object for the second placeholder —
 * a failure read `{ …(3) }`, and the field that exists to name the situation was
 * never shown. The label is also passed to `expect` as its MESSAGE argument rather
 * than as a payload field, because a payload field comparing to itself asserts
 * nothing.
 */
const ROWS = CASES.map(([actionName, censusCase]) => [actionName, censusCase.label, censusCase] as const);

afterEach(() => {
  overrideCanvasFilterSupport(null);
});

describe('replayHistory accounts for every action the union can name', () => {
  it('cases every member of the union, so removing a case cannot satisfy the contract by cast', () => {
    // `CENSUS` is typed `Record<ActionType, …>`, so `tsc` catches an ADDED member.
    // This catches the other direction: a member deleted from the union, or a case
    // dropped with a cast, which would leave the union short a name.
    expect(CASES.map(([actionName]) => actionName).sort()).toEqual([
      REPLACE_LAYER_SOURCE_ACTION,
      HIDE_LAYER_ACTION,
      LAYER_TRANSPARENCY_ACTION,
      MERGE_ACTION,
      NEW_LAYER_ACTION,
      OPEN_DOCUMENT_ACTION,
      REMOVE_ACTION,
      RENAME_LAYER_ACTION,
      REORDER_ACTION,
      SELECTION_ACTION,
      SET_DOCUMENT_FRAME_ACTION,
      SET_LAYER_OPACITY_ACTION,
      SHOW_LAYER_ACTION,
      TOOL_ACTION,
    ]);
  });

  /**
   * Whether one census case APPLIED or REPORTED, by running its prefix on its own
   * and then with its entry appended. `applied` is a change in the replayed state;
   * `reported` is a diagnostic the appended entry produced that the prefix did not.
   */
  function accountingFor(censusCase: CensusCase): { applied: boolean; reported: boolean } {
    const before = replayHistory(
      [...censusCase.prefix],
      censusCase.prefix.length - 1,
      initialSize,
      createDependencies()
    );
    const after = replayHistory(
      [...censusCase.prefix, censusCase.entry],
      censusCase.prefix.length,
      initialSize,
      createDependencies()
    );
    return {
      // `isDeepStrictEqual`, not `!==`: the projection is an object, so reference
      // inequality would read every action as applied and the census would pass on a
      // replay that changed nothing.
      applied: !isDeepStrictEqual(replayedStateOf(after), replayedStateOf(before)),
      reported: after.diagnostics.length > before.diagnostics.length,
    };
  }

  it.each(ROWS)('%s applies or reports %s, and never drops it in silence', (actionName, label, censusCase) => {
    // `blur` is the only case that needs a capability, and its arm refuses without
    // one — which would report rather than apply, so the assertion still holds.
    overrideCanvasFilterSupport(true);

    const { applied, reported } = accountingFor(censusCase);

    // The disjunction IS the contract, and `toContain(true)` is the only form of it
    // that fails CLOSED: `[applied, reported]` is an array, so a failure prints
    // `[ false, false ]` and names which half was missing. The previous payload —
    // `actionName` comparing to itself plus two `expect.any(Boolean)` fields — could
    // only ever bite on its last element.
    expect([applied, reported], `${actionName} (${label}) was neither applied nor reported`).toContain(true);
  });

  it('applies a raster-commit tool through the dependency that owns the raster path', () => {
    // `commit: 'raster' | 'source' | 'selection'` never reaches an arm by name in
    // `replayHistory`; it lands on `dependencies.applyRasterTool`, whose return value
    // becomes the layer record verbatim. That is why this cannot be a `CENSUS` case:
    // `CENSUS` is keyed by action NAME and `TOOL_ACTION` is already taken, so a second
    // key would be a duplicate-key error rather than a second situation. Without this
    // case, `createDependencies`'s raster stub would be inert and the census would
    // claim coverage it does not have.
    overrideCanvasFilterSupport(true);

    const rasterTool = entry({
      id: 'raster-tool-entry',
      actionName: TOOL_ACTION,
      args: { toolName: 'gradient', gradientType: 'linear', angle: 90 },
    });
    const prefix = oneLayerDocument();
    const applied = accountingFor({ label: 'a raster-commit tool', prefix, entry: rasterTool });

    expect(applied.applied, `TOOL_ACTION (a raster-commit tool) was not applied`).toBe(true);
  });

  it('reports an entry that carries no action name, rather than skipping it in silence', () => {
    // `HistoryItem['actionName']` is a required `ActionType`, so no production writer
    // produces this — but nothing enforces it at runtime, and an entry the loop cannot
    // name is the most reportable thing it can meet: `historyId` and timeline position
    // are the only trace of it. Skipping it would restore the silent skip this file
    // exists to close, so the branch REPORTS and only the message needs a fallback.
    overrideCanvasFilterSupport(true);

    const nameless = entry({ id: 'nameless-entry', actionName: undefined as unknown as ActionType });
    const result = replayHistory(
      [...oneLayerDocument(), nameless],
      oneLayerDocument().length,
      initialSize,
      createDependencies()
    );

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'unhandled-action', historyId: 'nameless-entry', actionName: undefined }),
    ]);
    expect(String((result.diagnostics[0].error as Error).message)).toContain('(no action name)');
  });

  it('lets no other union member report, so a member cannot hide by turning into a refusal', () => {
    // The disjunction above is deliberately permissive — a refusal is a legitimate
    // outcome — and that permissiveness has a cost: this file cannot then tell "an
    // action legitimately refuses" from "an arm stopped applying and started
    // reporting". This pins the NEGATIVE SPACE: exactly one member reports today.
    // Nothing else in the repository asserts that, because the per-arm suites all pin
    // APPLIED state, which stays correct when an arm is deleted only if the deletion
    // also fails the applied-state expectation — which it does, but not for this
    // reason.
    //
    // `LAYER_TRANSPARENCY_ACTION` is in the union with no replay arm and no production
    // dispatch site, so a minimal entry for it can only be refused. Closing that gap
    // — an arm, or retirement from the union — makes THIS case red, and it must also
    // make `replayedStateOf` observe whatever the arm writes. Today that would be
    // `opacity`, which the projection dropped, so the suite failed on the correct
    // fix; the projection now carries it and the two must change together.
    overrideCanvasFilterSupport(true);

    const refused = CASES.filter(([, censusCase]) => accountingFor(censusCase).reported).map(
      ([actionName]) => actionName
    );

    expect(refused).toEqual([LAYER_TRANSPARENCY_ACTION]);
  });

  it('names the entry and the action of a refused transparency change, so the loss is traceable', () => {
    overrideCanvasFilterSupport(true);

    const censusCase = CENSUS[LAYER_TRANSPARENCY_ACTION];
    const after = replayHistory(
      [...censusCase.prefix, censusCase.entry],
      censusCase.prefix.length,
      initialSize,
      createDependencies()
    );

    expect(after.diagnostics).toHaveLength(1);
    expect(after.diagnostics[0].code).toBe('unhandled-action');
    expect(after.diagnostics[0].historyId).toBe('transparency-entry');
    expect(after.diagnostics[0].actionName).toBe(LAYER_TRANSPARENCY_ACTION);
    expect(String((after.diagnostics[0].error as Error).message)).toContain(LAYER_TRANSPARENCY_ACTION);
  });

  it('reports an action whose payload its handler cannot use, rather than skipping it in silence', () => {
    // `useApp.ts` is the only production writer of an `OPEN_DOCUMENT_ACTION` entry
    // and always attaches a `documentSource`, so this entry cannot be produced. It is
    // the shape that made the gap invisible: a plausible timeline whose first entry
    // loses its document, reported by nothing.
    overrideCanvasFilterSupport(true);

    const withoutDocumentSource = entry({ id: 'bare-open-document', actionName: OPEN_DOCUMENT_ACTION });
    const result = replayHistory([withoutDocumentSource], 0, initialSize, createDependencies());

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('unhandled-action');
    expect(result.diagnostics[0].historyId).toBe('bare-open-document');
  });

  it.each(ROWS)(
    'reports nothing for %s alone, so no prefix has become a silent skip',
    (actionName, _label, censusCase) => {
      // Every other case needs its prefix to be clean, or "applied" would be measuring
      // the prefix's refusal instead of the entry's. This ran against ONE prefix, which
      // is a spot check; running every case's own prefix turns it into the statement it
      // was always reaching for, and it is the only leg that would notice a refusal
      // moving INTO a prefix -- where the per-arm suites would not, because they all
      // assert on applied state.
      overrideCanvasFilterSupport(true);

      const result = replayHistory(
        [...censusCase.prefix],
        censusCase.prefix.length - 1,
        initialSize,
        createDependencies()
      );

      expect(result.diagnostics, `${actionName}'s prefix reported something`).toEqual([]);
    }
  );
});
