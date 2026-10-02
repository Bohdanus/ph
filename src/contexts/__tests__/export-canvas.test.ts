import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderExportCanvas } from '../export-canvas.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import { drawLayersToCanvas } from '../layer-renderer.ts';

/**
 * The export surface is what every raster format encodes, so these tests are about the
 * DECOUPLING, not about pixels: `renderExportCanvas` must produce the document from
 * `(layers, size, documentFrame)` alone, so that nothing about the visible canvas can
 * reach an exported file. `CANVAS-RESOLUTION-PLAN.md` records the coupling this closes as
 * D1 — the display canvas and the export surface were one element, so raising display
 * resolution would have raised export resolution with it.
 *
 * `drawLayersToCanvas` is spied rather than allowed to run: it calls `drawLayer` and
 * `drawLayerSource` from INSIDE its own module, and an ES module's internal calls do not
 * route through its export bindings, so a spy records nothing. Mocking the boundary is
 * also the stronger assertion — it pins what this module hands the compositor, which is
 * the entire content of its responsibility.
 */

vi.mock('../layer-renderer.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../layer-renderer.ts')>();
  return { ...actual, drawLayersToCanvas: vi.fn(actual.drawLayersToCanvas) };
});

const drawLayersToCanvasMock = vi.mocked(drawLayersToCanvas);

/** The layer array the export hands the compositor, in order. */
const compositedIds = () =>
  drawLayersToCanvasMock.mock.calls.map(([, layers]) => (layers as Layer[]).map((layer) => layer.id)).at(-1) ?? [];

const blankLayer = (overrides: Partial<Layer> = {}): Layer =>
  ({
    id: 'layer-1',
    name: 'layer 1',
    order: 0,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    pos: { x: 0, y: 0, width: 800, height: 600 },
    source: { kind: 'blank' },
    operations: [],
    ...overrides,
  }) as unknown as Layer;

const record = (...layers: Layer[]): LayersRecord => Object.fromEntries(layers.map((l) => [l.id, l]));

afterEach(() => {
  // `mockReset`, not `mockClear`: `mockClear` discards recorded calls but leaves a queued
  // `mockReturnValueOnce`/`mockImplementationOnce` in force, so a case that skips or
  // duplicates the compositor call silently hands its stub to the NEXT case — which then
  // passes or fails for the wrong reason. Because this mock wraps the real implementation,
  // `mockReset` is also what restores it.
  drawLayersToCanvasMock.mockReset();
});

describe('renderExportCanvas', () => {
  it('sizes the export surface from the document frame, not from any canvas it was handed', () => {
    const canvas = renderExportCanvas(
      record(blankLayer()),
      { width: 800, height: 600 },
      { x: 0, y: 0, width: 640, height: 480 }
    );

    // The frame's EXTENT is authoritative, and it disagrees with `size` on purpose: a
    // caller whose `size` lagged its frame would otherwise get the wrong file
    // dimensions, which is the invariant the export gates assert.
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect({ width: canvas.width, height: canvas.height }).toEqual({ width: 640, height: 480 });
  });

  it('paints the surface it hands back, rather than a correctly sized blank one', () => {
    const frame = { x: 5, y: 6, width: 800, height: 600 };
    const returned = renderExportCanvas(record(blankLayer()), { width: 800, height: 600 }, frame);

    // IDENTITY, not shape, and `toHaveBeenCalledExactlyOnceWith(returned, …)` does NOT
    // supply it: Vitest deep-equals its arguments, so a second canvas of the same size
    // satisfies it. Composite onto a scratch surface, return a fresh one that is merely
    // resized, and every other case in this file still passes while the export encodes a
    // blank document at the right dimensions — a silent data-loss bug wearing a green
    // suite. Only this pins that the canvas returned is the one the compositor painted.
    expect(drawLayersToCanvasMock).toHaveBeenCalledTimes(1);
    expect(drawLayersToCanvasMock.mock.calls[0][0]).toBe(returned);

    // Every layer is stamped at `position.x - frame.x`, `position.y - frame.y`
    // (presentation-evaluator.ts:163-164), so the frame supplies the origin as well as the
    // extent.
    expect(drawLayersToCanvasMock.mock.calls[0][2]).toEqual(frame);
  });

  it('sorts layers by order before compositing, so the export z-order matches the document', () => {
    const bottom = blankLayer({ id: 'bottom', order: 0 });
    const top = blankLayer({ id: 'top', order: 5 });
    const middle = blankLayer({ id: 'middle', order: 2 });

    // Deliberately unsorted insertion order. `getSortedLayersArray` is what both existing
    // `drawLayersToCanvas` callers apply (useLayer.ts:768, useHistory.ts:70); without it
    // the export would composite in object-iteration order and invert the stack. Nothing
    // else in this module sorts.
    renderExportCanvas(
      record(top, bottom, middle),
      { width: 800, height: 600 },
      { x: 0, y: 0, width: 800, height: 600 }
    );

    expect(compositedIds()).toEqual(['bottom', 'middle', 'top']);
  });

  it('falls back to the frame its own size implies, so an omitted or invalid frame still exports', () => {
    // `savePsd` defaults the frame the same way (psd-utils.ts:209-213). Two callers in the
    // repo pass the raw store value, so a missing frame is reachable, not hypothetical.
    const omitted = renderExportCanvas(record(blankLayer()), { width: 320, height: 240 });
    const malformed = renderExportCanvas(record(blankLayer()), { width: 320, height: 240 }, {
      x: 0,
      y: 0,
      width: 0,
      height: Number.NaN,
    } as never);

    for (const canvas of [omitted, malformed]) {
      expect({ width: canvas.width, height: canvas.height }).toEqual({ width: 320, height: 240 });
    }
  });

  it('throws rather than hand back an unrendered surface', () => {
    // `drawLayersToCanvas` returns false when a source or the 2d context fails, and its
    // staging discipline leaves the target untouched in that case — so returning the
    // canvas anyway would encode a blank or stale document, silently. Throwing puts the
    // failure on the path the save dialog already handles: resolve `null`, keep the
    // dialog up, let the user retry with a different format.
    drawLayersToCanvasMock.mockReturnValueOnce(false);

    expect(() => renderExportCanvas(record(blankLayer()), { width: 800, height: 600 })).toThrow(
      /Unable to render the document for export/
    );
  });

  it('throws on a false return even when the surface came back the right size', () => {
    // The guard has two disjuncts and they fail for DIFFERENT reasons, so the
    // false-return case above does not pin the first one on its own: a compositor that
    // reported false without touching the target leaves the default 300x150 store, which
    // the extent check catches anyway. Here the target is already the right size, so the
    // reported failure is the only signal there is — a compositor that sizes its target
    // and then reports failure would otherwise yield a correctly-sized blank document.
    drawLayersToCanvasMock.mockImplementationOnce((canvas) => {
      canvas.width = 800;
      canvas.height = 600;
      return false;
    });

    expect(() => renderExportCanvas(record(blankLayer()), { width: 800, height: 600 })).toThrow(
      /Unable to render the document for export/
    );
  });

  it('throws when the compositor reports success but left the surface at its default size', () => {
    // The other disjunct, isolated. `drawLayersToCanvas` returns `true` without drawing
    // when `typeof document === 'undefined'` (layer-renderer.ts:132) — a "successful"
    // export of nothing, which the extent check is what catches.
    drawLayersToCanvasMock.mockImplementationOnce(() => true);

    expect(() => renderExportCanvas(record(blankLayer()), { width: 800, height: 600 })).toThrow(
      /Unable to render the document for export/
    );
  });

  it('rejects a surface at the right width and the wrong height, and accepts the correct shape', () => {
    // The guard is a SHAPE check, and this is the case a width-only check cannot see: the
    // compositor reported success AND matched the frame on the x axis, so `canvas.width`
    // agrees with the frame while the encoded file's dimensions do not. Both axes are
    // asserted in one case because the halves are the same assertion read forwards and
    // backwards — a guard that rejected everything would satisfy the first half alone, and
    // the export would refuse every document instead of encoding a wrong-sized one.
    drawLayersToCanvasMock.mockImplementationOnce((canvas) => {
      canvas.width = 800;
      canvas.height = 300;
      return true;
    });

    expect(() => renderExportCanvas(record(blankLayer()), { width: 800, height: 600 })).toThrow(
      /Unable to render the document for export/
    );

    // The correct shape, and the exact extent `documentFrameSize` reports, is accepted —
    // with no frame argument in play, so nothing else could be supplying the dimensions.
    drawLayersToCanvasMock.mockImplementationOnce((canvas) => {
      canvas.width = 800;
      canvas.height = 600;
      return true;
    });
    const canvas = renderExportCanvas(record(blankLayer()), { width: 800, height: 600 });

    expect({ width: canvas.width, height: canvas.height }).toEqual({ width: 800, height: 600 });
  });

  it('detaches the surface from the document, so no visible canvas is reachable from an export', () => {
    const canvas = renderExportCanvas(record(blankLayer()), { width: 800, height: 600 });

    // The whole point of D1: the encoded surface is created here, on its own, at
    // document resolution. `src/test/setup.ts` replaces `getContext` with a bare mock, so
    // this asserts the DOM fact that the export path is unattached, not a rendering
    // result — which is why no test in this file depends on pixels.
    expect(canvas.isConnected).toBe(false);
    expect(canvas.parentElement).toBeNull();
  });
});
