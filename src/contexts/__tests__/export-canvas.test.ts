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
  drawLayersToCanvasMock.mockClear();
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

  it('passes the document frame through to the compositor, which supplies both extent and origin', () => {
    const frame = { x: 5, y: 6, width: 800, height: 600 };
    renderExportCanvas(record(blankLayer()), { width: 800, height: 600 }, frame);

    // `drawLayersToCanvas` stamps every layer at `pos.x - frame.x`, `pos.y - frame.y`
    // (layer-renderer.ts:78-79). A frame normalised away or defaulted here would shift
    // every exported layer, so the frame must arrive as the caller gave it.
    expect(drawLayersToCanvasMock).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.anything(), frame);
  });

  it('sorts layers by order before compositing, so the export z-order matches the document', () => {
    const bottom = blankLayer({ id: 'bottom', order: 0 });
    const top = blankLayer({ id: 'top', order: 5 });
    const middle = blankLayer({ id: 'middle', order: 2 });

    // Deliberately unsorted insertion order. `getSortedLayersArray` is what both existing
    // `drawLayersToCanvas` callers apply (useLayer.ts:640, useHistory.ts:70); without it
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
    // `savePsd` defaults the frame the same way (psd-utils.ts:208). Two callers in the
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
    // when `typeof document === 'undefined'` (layer-renderer.ts:118) — a "successful"
    // export of nothing, which the extent check is what catches.
    drawLayersToCanvasMock.mockImplementationOnce(() => true);

    expect(() => renderExportCanvas(record(blankLayer()), { width: 800, height: 600 })).toThrow(
      /Unable to render the document for export/
    );
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
