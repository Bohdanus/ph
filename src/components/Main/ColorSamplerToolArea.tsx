import { useEffect, useRef, type PointerEvent, type RefObject } from 'react';

import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { resetOverlayAlpha } from '../../util/canvas.ts';
import type { Point, Size } from '../../contexts/general-types.ts';
import { COLOR_SAMPLER_HIT_RADIUS, type ColorSampler, type ColorSamplerToolArgs } from '../../tools/colorSampler.ts';
import { readColorSampler } from '../../tools/color-sampler-readback.ts';
import {
  addColorSampler,
  colorSamplerAt,
  moveColorSampler,
  removeColorSampler,
  syncColorSamplerFrameSize,
  useColorSamplers,
} from '../../tools/color-sampler-store.ts';

type ColorSamplerToolAreaProps = {
  className?: string;
  overlayCtxRef?: RefObject<CanvasRenderingContext2D | null>;
};

/** The marker's arm half-width in CSS px, before the fit division. */
const MARKER_ARM_CSS = 7;

/** The label beside the marker in CSS px. */
const LABEL_OFFSET_CSS = 10;

/** The marker's outline, drawn two-tone for the Ruler's reason: readable over any photograph. */
const MARKER_DARK = '#1a1a1a';
const MARKER_LIGHT = '#ffffff';

/**
 * Draws one sampler: a crosshair with its number beside it.
 *
 * **A crosshair, and the glyph is not sourced.** Every description of Photoshop's marker agrees it
 * is a small glyph plus a sequential number and disagrees about the glyph: a crosshair in one
 * source, a target icon in another, and no Adobe sentence describes it at all. A crosshair is the
 * shape this tool's own cursor already is (`cursor-crosshair`, the Eyedropper's too), so the marker
 * reads as the same instrument rather than as a borrowed icon, and the disagreement is recorded
 * rather than papered over.
 *
 * **Drawn twice, dark then light**, so it survives a white document and a dark photograph alike —
 * `RulerToolArea`'s rule and its reason, reused rather than reinvented.
 */
export const drawColorSamplerMarker = (
  ctx: CanvasRenderingContext2D,
  sampler: ColorSampler,
  fitScale: number
): void => {
  // A 0 fit is the unmeasured case, and dividing by it would put `Infinity` into every line width.
  const scale = fitScale || 1;
  const arm = MARKER_ARM_CSS / scale;
  const lineWidth = 1 / scale;
  const { x, y } = sampler.point;

  ctx.save();
  try {
    for (const [width, stroke] of [
      [lineWidth + 2 / scale, MARKER_DARK],
      [lineWidth, MARKER_LIGHT],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(x - arm, y);
      ctx.lineTo(x + arm, y);
      ctx.moveTo(x, y - arm);
      ctx.lineTo(x, y + arm);
      ctx.lineWidth = width;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }

    // The number, which is the half of the marker Adobe's own sources agree on: they describe an
    // index label "#1", "#2", … beside the glyph. `12px` is a text size and so is NOT divided by the
    // fit, which is what keeps the label legible at 25% instead of shrinking to a smudge.
    ctx.font = '12px sans-serif';
    ctx.textBaseline = 'middle';
    const at = { x: x + LABEL_OFFSET_CSS / scale, y };
    ctx.lineWidth = 3 / scale;
    ctx.strokeStyle = MARKER_DARK;
    ctx.strokeText(String(sampler.id), at.x, at.y);
    ctx.fillStyle = MARKER_LIGHT;
    ctx.fillText(String(sampler.id), at.x, at.y);
  } finally {
    ctx.restore();
  }
};

/**
 * Whether a point is inside the document frame.
 *
 * The frame is `[0, 0, totalSize]` in overlay-canvas pixels: `totalSize` is
 * `documentFrameSize(documentFrame)`, so the origin here is the FRAME origin and this deliberately
 * does not subtract `documentFrame.x` — the same rule `RulerToolArea` states, for the same reason.
 */
const isInsideFrame = (point: Point, frame: Size): boolean =>
  point.x >= 0 && point.y >= 0 && point.x < frame.width && point.y < frame.height;

/**
 * The Color Sampler records NO history state.
 *
 * Adobe's line is that the tool "displays color values for up to four areas", and a measurement is
 * not part of the document. So this area dispatches nothing at all: no `COMMIT_DOCUMENT_EDIT`, no
 * `TOOL_ACTION`, no layer, no durable operation. That is also why there is no entry in
 * `src/tools/toolProcessors.ts` — the Color Sampler is in `PIXEL_FREE_TOOLS` — and why there is no
 * `updateLayerByTool` call here to make.
 *
 * **The colour is read, never written.** The Eyedropper beside it ends its handler in a `SET_COLOR`
 * dispatch; this one ends in a store write, and the store is module state rather than
 * `StoreContext` precisely because a sample is not a document fact.
 *
 * Four gestures, all of them Adobe's own:
 * - **click** places: "Click where you want to place a sampler."
 * - **drag a marker** moves it: "To move a color sampler, drag the sampler to the new location."
 * - **drag a marker out of the frame** deletes it: "To delete a color sampler, drag the sampler out
 *   of the document window."
 * - **Alt/Option-click a marker** deletes it: "hold down Alt (Windows) or Option (Mac OS) until the
 *   pointer becomes a scissors and click the sampler." The scissors CURSOR is not drawn — this app
 *   has no cursor registry, and a cursor is chrome the repository has no place to name — but the
 *   gesture it accompanies is the one Adobe uses it for, and it is implemented.
 * <https://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html>
 */
export const ColorSamplerToolArea = ({ className, overlayCtxRef }: ColorSamplerToolAreaProps) => {
  const [{ canvasRef, containerRef, totalSize, renderSelector }] = useStore();
  const { toolArgs } = useCurrentTool();
  const samplers = useColorSamplers();

  const { getLocalCoords, dimensionsRef, isPointerDownValid, isPointerMoveValid, isPointerUpValid } =
    usePointerPosition({ ref: containerRef, imageSize: totalSize });

  /** The sampler a drag is carrying, or `null`. A ref, because a move changes it on every frame. */
  const draggingRef = useRef<ColorSampler | null>(null);

  // A size change is the signal that the document under these samplers is a different one. See the
  // store's own doc.
  useEffect(() => {
    syncColorSamplerFrameSize(totalSize);
  }, [totalSize]);

  useEffect(() => {
    const ctx = overlayCtxRef?.current;
    if (!ctx) return;
    // `resetOverlayAlpha` before the clear, not after: the overlay is ONE 2D context for the whole
    // session, so a previous tool's `globalAlpha` leaks into this one's stroke.
    resetOverlayAlpha(ctx);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    for (const sampler of samplers) drawColorSamplerMarker(ctx, sampler, dimensionsRef.current.scale);
  }, [samplers, dimensionsRef, overlayCtxRef]);

  // The overlay canvas is shared, so this area owns clearing what it drew. The size is read off the
  // canvas at call time rather than off `totalSize`, which is what keeps a resize from under-clearing.
  useEffect(
    () => () => {
      const ctx = overlayCtxRef?.current;
      if (!ctx) return;
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    },
    [overlayCtxRef]
  );

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (toolArgs.toolName !== 'color-sampler') return;
    if (!isPointerDownValid(event)) return;
    event.preventDefault();

    const pointer = getLocalCoords(event);
    const hit = colorSamplerAt(pointer);

    // The Alt/Option delete, which is checked BEFORE the drag because it is a deletion and a drag
    // would otherwise pick the same marker up.
    if (hit && event.altKey) {
      removeColorSampler(hit.id);
      return;
    }

    // A press inside a marker moves it. Adobe does not publish a tolerance, so
    // `COLOR_SAMPLER_HIT_RADIUS` is this app's number and is declared as one in `colorSampler.ts`.
    if (hit) {
      draggingRef.current = hit;
      return;
    }

    // A press on empty canvas places. The cap refuses loudly and changes nothing; see
    // `samplerCapReached` for why it refuses rather than replacing.
    // During replay, the visible canvas is the previous accepted presentation, not the requested
    // history state. Do not create a measurement from that stale image.
    if (renderSelector.source === 'pending') return;

    const args = toolArgs as ColorSamplerToolArgs;
    const readback = readColorSampler(canvasRef.current, pointer, args.sampleSize, totalSize);
    if (!readback.ok) {
      console.error(readback.reason, 'the color sampler cannot read the composited canvas');
      return;
    }
    if (readback.color === null) return;

    const placed = addColorSampler(pointer, readback.color);
    if (!placed.ok) console.error(placed.reason, `the color sampler holds ${placed.samplers.length} samples`);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerMoveValid(event)) return;
    const dragging = draggingRef.current;
    if (!dragging) return;
    moveColorSampler(dragging.id, getLocalCoords(event));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPointerUpValid(event)) return;
    const dragging = draggingRef.current;
    draggingRef.current = null;
    if (!dragging) return;
    const pointer = getLocalCoords(event);
    // Adobe's first removal, tested on RELEASE rather than during the move for the Ruler's reason: a
    // drag out and back is one ordinary gesture and only the end of it is a decision.
    if (!isInsideFrame(pointer, totalSize)) {
      removeColorSampler(dragging.id);
      return;
    }
    moveColorSampler(dragging.id, pointer);
  };

  return (
    <div
      className={`${className} cursor-crosshair`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ userSelect: 'none' }}
    />
  );
};

export { COLOR_SAMPLER_HIT_RADIUS };
