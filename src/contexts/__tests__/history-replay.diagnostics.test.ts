/**
 * `replayHistory` refuses three kinds of history entry, and a refusal loses a user
 * edit, so the refusal has to be reported. All three refusals inside the per-entry
 * loop now push onto a `diagnostics` array instead of logging (`ReplayDiagnostic`),
 * because replay runs on every undo, redo and history-panel click: a per-item log
 * would print the same line on every navigation, forever. `resetHistoryTo` reports
 * the whole set once per replay. Two of the three are CAUGHT exceptions; the third,
 * `unhandled-action`, is not a throw at all, which is why pinned claim 2 below is
 * scoped to a caught refusal.
 *
 * What is pinned here, in the order the change could regress:
 *
 *  1. a CLEAN replay reports nothing — the collection must not become a scrub
 *  2. a CAUGHT refusal is COLLECTED, carrying the raw thrown Error OBJECT, so a
 *     `String(error)` substitution is visible instead of merely plausible — a
 *     refusal that is not a throw synthesises its own `Error`, so this claim does
 *     not extend to `unhandled-action` and does not pretend to
 *  3. each refusal reports its own code against its own history entry
 *  4. two refusals are two diagnostics, in TIMELINE order — not grouped by code
 *
 * The two module mocks below are observation probes, not stubs: each wrapper
 * delegates to the real implementation and records the value on its way out, and
 * that recording is what makes the identity assertions possible. A separately
 * constructed `new Error('Affine transform produced degenerate bounds')` is a
 * different object, so `toBe` against it would fail on a correct implementation —
 * the wrapper is what makes the claim "this is the error that was thrown".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAffineBounds } from '../affine-transform.ts';
import { replayHistory, type HistoryReplayDependencies } from '../history-replay.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayerSource } from '../layer-types.ts';
import { CanvasFilterUnsupportedError, overrideCanvasFilterSupport } from '../../util/canvas-filter.ts';
import { NEW_LAYER_ACTION, TOOL_ACTION } from '../../util/constants.ts';

const probe = vi.hoisted(() => ({
  affineErrors: [] as unknown[],
  filterErrors: [] as unknown[],
}));

vi.mock('../affine-transform.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../affine-transform.ts')>();
  return {
    ...actual,
    getTransformFromHistoryArgs: (...args: Parameters<typeof actual.getTransformFromHistoryArgs>) => {
      try {
        return actual.getTransformFromHistoryArgs(...args);
      } catch (error) {
        probe.affineErrors.push(error);
        throw error;
      }
    },
  };
});

vi.mock('../../util/canvas-filter.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../util/canvas-filter.ts')>();
  return {
    ...actual,
    requireCanvasFilter: (...args: Parameters<typeof actual.requireCanvasFilter>) => {
      try {
        return actual.requireCanvasFilter(...args);
      } catch (error) {
        probe.filterErrors.push(error);
        throw error;
      }
    },
  };
});

const layerId = 'layer-1';
const initialSize = { width: 400, height: 300 };
const layerSource = {
  kind: 'blank',
  color: '#ffffff',
  opacity: 1,
  pos: { x: 4, y: 8, width: 100, height: 80 },
} satisfies LayerSource;

/** The retained affine a non-trapezoid `transform` commit writes into history. */
const IDENTITY_AFFINE = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function createTestLayer(id: string): Layer {
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
    pos: { ...layerSource.pos },
    operations: [],
  };
}

function createDependencies(): HistoryReplayDependencies {
  return {
    createLayer: vi.fn((input) => createTestLayer(input.layerId)),
    applyRasterTool: vi.fn((layer: Layer) => layer),
  };
}

const newLayerEntry = (): HistoryItem =>
  ({ id: 'new-layer', actionName: NEW_LAYER_ACTION, layerId, layerSource }) as HistoryItem;

const toolEntry = (id: string, args: object): HistoryItem =>
  ({ id, actionName: TOOL_ACTION, layerId, args }) as unknown as HistoryItem;

const retainedTransform = (transform: object): object => ({ toolName: 'transform', transform });

const blurEntry = (id = 'tool-blur'): HistoryItem => toolEntry(id, { toolName: 'blur', radius: 3 });

const transformEntry = (id: string): HistoryItem => toolEntry(id, retainedTransform(IDENTITY_AFFINE));

/**
 * A `resize` to zero extent, which is the reachable way a layer's `pos` becomes a
 * size `getAffineBounds` rejects. The affine entry is validated against the pos as
 * it is AT REPLAY TIME (`history-replay.ts:238`), while it was validated at commit
 * time against the pos the layer had then, so a timeline whose layer was collapsed
 * afterwards fails the bounds check — and loses the transform — on replay.
 */
const collapseLayerEntry = (): HistoryItem =>
  toolEntry('tool-collapse', { toolName: 'reposition', resize: { x: 4, y: 8, width: 0, height: 0 } });

const moveLayerEntry = (): HistoryItem => toolEntry('tool-move', { toolName: 'reposition', move: { x: 20, y: 20 } });

beforeEach(() => {
  probe.affineErrors.length = 0;
  probe.filterErrors.length = 0;
});

afterEach(() => {
  // Restores the real detection, so the override cannot leak into another file.
  overrideCanvasFilterSupport(null);
});

describe('replayHistory reports every entry it refused', () => {
  it('reports nothing for a timeline that replays cleanly', () => {
    overrideCanvasFilterSupport(true);
    const history = [newLayerEntry(), blurEntry(), transformEntry('tool-transform')];

    const result = replayHistory(history, history.length - 1, initialSize, createDependencies());

    // Both tools really were applied, so an empty report means "nothing was
    // refused" rather than "nothing was replayed".
    expect(result.layers[layerId].operations).toHaveLength(2);
    expect(result.diagnostics).toEqual([]);
    expect(probe.affineErrors).toEqual([]);
    expect(probe.filterErrors).toEqual([]);
  });

  it('collects a refused affine as the raw thrown Error, not a rendering of it', () => {
    const history = [newLayerEntry(), collapseLayerEntry(), transformEntry('tool-transform')];

    const result = replayHistory(history, history.length - 1, initialSize, createDependencies());

    // Why it throws, asserted against the validator rather than against the code
    // under test: a zero-extent layer collapses all four corners onto one point.
    expect(() => getAffineBounds(IDENTITY_AFFINE, { width: 0, height: 0 })).toThrow(
      'Affine transform produced degenerate bounds'
    );
    expect(probe.affineErrors).toHaveLength(1);
    const thrown = probe.affineErrors[0];

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('invalid-affine-transform');
    expect(result.diagnostics[0].historyId).toBe('tool-transform');
    expect(result.diagnostics[0].actionName).toBe(TOOL_ACTION);
    // Identity, not resemblance: `String(error)`, a rewrapped Error or a
    // `{ message }` copy would satisfy a `toEqual` on the message and lose the
    // stack that `resetHistoryTo` prints.
    expect(result.diagnostics[0].error).toBe(thrown);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Affine transform produced degenerate bounds');
  });

  it('refuses only the transform, and still replays the rest of the timeline', () => {
    const history = [newLayerEntry(), collapseLayerEntry(), transformEntry('tool-transform')];

    const result = replayHistory(history, history.length - 1, initialSize, createDependencies());

    expect(result.layers[layerId].operations).toHaveLength(0);
    expect(result.layers[layerId].pos).toEqual({ x: 4, y: 8, width: 0, height: 0 });
  });

  it('reports a filter the engine cannot apply under its own code', () => {
    overrideCanvasFilterSupport(false);
    const history = [newLayerEntry(), blurEntry()];

    const result = replayHistory(history, history.length - 1, initialSize, createDependencies());

    expect(probe.filterErrors).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('canvas-filter-unsupported');
    expect(result.diagnostics[0].historyId).toBe('tool-blur');
    expect(result.diagnostics[0].actionName).toBe(TOOL_ACTION);
    expect(result.diagnostics[0].error).toBe(probe.filterErrors[0]);
    expect(result.diagnostics[0].error).toBeInstanceOf(CanvasFilterUnsupportedError);
    expect((result.diagnostics[0].error as CanvasFilterUnsupportedError).label).toBe('blur');
  });

  it('reports nothing when the same filter replays with canvas filter support present', () => {
    overrideCanvasFilterSupport(true);
    const history = [newLayerEntry(), blurEntry()];

    const result = replayHistory(history, history.length - 1, initialSize, createDependencies());

    expect(result.layers[layerId].operations).toHaveLength(1);
    expect(result.diagnostics).toEqual([]);
  });

  it('reports two refusals as two diagnostics, in timeline order', () => {
    const history = [
      newLayerEntry(),
      collapseLayerEntry(),
      transformEntry('tool-transform-first'),
      moveLayerEntry(),
      transformEntry('tool-transform-second'),
    ];

    const result = replayHistory(history, history.length - 1, initialSize, createDependencies());

    expect(probe.affineErrors).toHaveLength(2);
    expect(result.diagnostics.map((diagnostic) => diagnostic.historyId)).toEqual([
      'tool-transform-first',
      'tool-transform-second',
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'invalid-affine-transform',
      'invalid-affine-transform',
    ]);
    expect(result.diagnostics[0].error).toBe(probe.affineErrors[0]);
    expect(result.diagnostics[1].error).toBe(probe.affineErrors[1]);
  });

  it('orders by timeline, not by refusal code', () => {
    // The affine refusal comes FIRST in the timeline and the filter refusal second,
    // so collecting the two codes into separate arrays and concatenating them would
    // report them the other way round.
    overrideCanvasFilterSupport(false);
    const history = [
      newLayerEntry(),
      collapseLayerEntry(),
      transformEntry('tool-transform'),
      blurEntry('tool-blur-late'),
    ];

    const result = replayHistory(history, history.length - 1, initialSize, createDependencies());

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'invalid-affine-transform',
      'canvas-filter-unsupported',
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.historyId)).toEqual(['tool-transform', 'tool-blur-late']);
  });

  it('gives each replay its own diagnostics instead of accumulating across replays', () => {
    const history = [newLayerEntry(), collapseLayerEntry(), transformEntry('tool-transform')];
    const dependencies = createDependencies();

    const first = replayHistory(history, history.length - 1, initialSize, dependencies);
    const second = replayHistory(history, history.length - 1, initialSize, dependencies);

    expect(first.diagnostics).toHaveLength(1);
    expect(second.diagnostics).toHaveLength(1);
    expect(second.diagnostics).not.toBe(first.diagnostics);
  });
});
