import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react';
import type { RasterSelectionMask, Selection } from '../contexts/general-types.ts';
import { type DocumentFrame, documentFrameSize, documentToCanvasPoint } from '../contexts/document-frame.ts';

import { resetOverlayAlpha } from '../util/canvas.ts';
import { DASH_LENGTH, GAP_LENGTH, LINE_WIDTH, SPEED } from './useAnts.ts';
import { readSelectionDragPreview } from './selection-drag-preview.ts';
import {
  decodeRasterSelectionMask,
  isRasterSelectionBoundaryPixel,
  MAX_RASTER_SELECTION_PIXELS,
} from '../util/selection-mask.ts';

/**
 * The two strokes that make the classic marching-ants border: a black dash and a
 * white dash half a dash-length apart. Two passes rather than one solid colour is
 * what keeps the border legible over both light and dark artwork, and it is the
 * same pair `useAnts` paints for a hovered layer.
 */
export const ANT_STROKE_COLOR = 'black';
export const ANT_GAP_COLOR = 'white';

export type SelectionMarchingAntsProps = {
  overlayRef: RefObject<HTMLCanvasElement | null>;
  selections: Selection[];
  documentFrame: DocumentFrame;
  enabled?: boolean;
  /**
   * CSS px per document px, as a ref — the contain fit. See `useContainScale`.
   *
   * The constants imported above are CSS px, but this canvas is sized to the DOCUMENT and displayed
   * with `object-contain`, so a context draws in document px and every one of them has to be divided
   * by this to stay constant on screen. Omitting it leaves the divisor at 1, which is what this hook
   * did before the divisor existed: correct at scale 1, sub-pixel below it, and proportionally heavy
   * above it, with a crawl rate that varies with zoom. It is a REF rather than a number because this
   * reads it inside a 60fps loop.
   */
  scaleRef?: RefObject<number>;
};

export type SelectionRasterOutline = {
  /** The source image can be downsampled under memory pressure; draw it at these document bounds. */
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
  scaleFactor: number;
};

type AntsShape = {
  id: string;
  selection: Selection;
  path: Path2D | null;
  rasterOutline: SelectionRasterOutline | null;
};

type OutlineCacheEntry = {
  width: number;
  height: number;
  outline: SelectionRasterOutline;
  bytes: number;
};

// Content-keyed so a preview mask and its committed re-encoding share one outline.
// The base64 string is already owned by the mask and is reused as the map key without
// building a second, multi-megabyte composite key.
const selectionOutlineCache = new Map<string, OutlineCacheEntry[]>();
// One max-size document outline fits, but a second one forces the oldest canvas out.
const MAX_SELECTION_OUTLINE_CACHE_BYTES = 65 * 1024 * 1024;
const MAX_SELECTION_OUTLINE_CACHE_ENTRIES = 16;
const MAX_SELECTION_OUTLINE_DIMENSION = 16_384;
let selectionOutlineCacheBytes = 0;
let selectionOutlineCacheEntries = 0;

function cacheSelectionOutline(mask: RasterSelectionMask, outline: SelectionRasterOutline): void {
  const bytes = outline.canvas.width * outline.canvas.height * 4;
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_SELECTION_OUTLINE_CACHE_BYTES) return;

  const existing = selectionOutlineCache.get(mask.data) ?? [];
  const previousIndex = existing.findIndex((entry) => entry.width === mask.width && entry.height === mask.height);
  if (previousIndex >= 0) {
    const [previous] = existing.splice(previousIndex, 1);
    if (previous) {
      selectionOutlineCacheBytes -= previous.bytes;
      selectionOutlineCacheEntries -= 1;
    }
  }
  if (existing.length === 0) selectionOutlineCache.delete(mask.data);
  while (
    selectionOutlineCacheEntries >= MAX_SELECTION_OUTLINE_CACHE_ENTRIES ||
    selectionOutlineCacheBytes + bytes > MAX_SELECTION_OUTLINE_CACHE_BYTES
  ) {
    const oldest = selectionOutlineCache.entries().next().value as [string, OutlineCacheEntry[]] | undefined;
    const oldestEntry = oldest?.[1].shift();
    if (!oldest || !oldestEntry) break;
    selectionOutlineCacheBytes -= oldestEntry.bytes;
    selectionOutlineCacheEntries -= 1;
    if (oldest[1].length === 0) selectionOutlineCache.delete(oldest[0]);
  }
  const entries = selectionOutlineCache.get(mask.data) ?? existing;
  entries.push({ width: mask.width, height: mask.height, outline, bytes });
  selectionOutlineCache.delete(mask.data);
  selectionOutlineCache.set(mask.data, entries);
  selectionOutlineCacheBytes += bytes;
  selectionOutlineCacheEntries += 1;
}

function createOutlineAtScale(
  mask: RasterSelectionMask,
  packed: Uint8Array,
  scaleFactor: number
): SelectionRasterOutline | null {
  const innerWidth = Math.ceil(mask.width / scaleFactor);
  const innerHeight = Math.ceil(mask.height / scaleFactor);
  const canvasWidth = innerWidth + 2;
  const canvasHeight = innerHeight + 2;
  let canvas: HTMLCanvasElement | null = null;

  try {
    canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      canvas.width = 0;
      canvas.height = 0;
      return null;
    }

    const chunkHeight = 64;
    for (let top = 0; top < canvasHeight; top += chunkHeight) {
      const height = Math.min(chunkHeight, canvasHeight - top);
      const imageData = ctx.createImageData(canvasWidth, height);
      for (let localY = 0; localY < height; localY += 1) {
        const outputY = top + localY;
        const sourceYStart =
          outputY === 0 ? -1 : outputY === canvasHeight - 1 ? mask.height : (outputY - 1) * scaleFactor;
        const sourceYEnd =
          outputY === 0
            ? 0
            : outputY === canvasHeight - 1
              ? mask.height + 1
              : Math.min(mask.height, sourceYStart + scaleFactor);
        for (let outputX = 0; outputX < canvasWidth; outputX += 1) {
          const sourceXStart =
            outputX === 0 ? -1 : outputX === canvasWidth - 1 ? mask.width : (outputX - 1) * scaleFactor;
          const sourceXEnd =
            outputX === 0
              ? 0
              : outputX === canvasWidth - 1
                ? mask.width + 1
                : Math.min(mask.width, sourceXStart + scaleFactor);
          let hasBoundary = false;
          for (let sourceY = sourceYStart; sourceY < sourceYEnd && !hasBoundary; sourceY += 1) {
            for (let sourceX = sourceXStart; sourceX < sourceXEnd; sourceX += 1) {
              if (isRasterSelectionBoundaryPixel(mask, packed, sourceX, sourceY)) {
                hasBoundary = true;
                break;
              }
            }
          }
          if (hasBoundary) imageData.data[(localY * canvasWidth + outputX) * 4 + 3] = 255;
        }
      }
      ctx.putImageData(imageData, 0, top);
    }

    return {
      width: mask.width + 2,
      height: mask.height + 2,
      canvas,
      scaleFactor,
    };
  } catch {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    return null;
  }
}

/** A closed contour through a selection's absolute points, or `null` when there is nothing to stroke. */
function shapePath(selection: Selection, frame: DocumentFrame): Path2D | null {
  const contours = selection.points.map((contour) =>
    contour.map((point) => documentToCanvasPoint({ x: point.x + selection.pos.x, y: point.y + selection.pos.y }, frame))
  );

  if (contours.every((contour) => contour.length < 3)) return null;

  const path = new Path2D();
  for (const contour of contours) {
    if (contour.length < 3) continue;
    path.moveTo(contour[0].x, contour[0].y);
    for (let i = 1; i < contour.length; i++) path.lineTo(contour[i].x, contour[i].y);
    path.closePath();
  }

  return path;
}

/** Create the bounded edge image used by the animated raster-mask overlay. */
export function createSelectionRasterOutlineCanvas(mask: RasterSelectionMask): SelectionRasterOutline | null {
  const packed = decodeRasterSelectionMask(mask);
  const cachedEntries = selectionOutlineCache.get(mask.data);
  const cached = cachedEntries?.find((entry) => entry.width === mask.width && entry.height === mask.height);
  if (packed && cached && cachedEntries) {
    selectionOutlineCache.delete(mask.data);
    selectionOutlineCache.set(mask.data, cachedEntries);
    return cached.outline;
  }
  if (!packed || typeof document === 'undefined') return null;

  // The full-resolution edge image is exact. Retry at progressively smaller scales,
  // skipping dimensions that exceed the canvas budget before allocating. Long, narrow
  // masks need more than the old fixed 8x fallback to fit common canvas limits. Selection
  // processors and hit tests always use the original packed mask.
  for (let scaleFactor = 1; scaleFactor <= Math.max(mask.width, mask.height); scaleFactor *= 2) {
    const canvasWidth = Math.ceil(mask.width / scaleFactor) + 2;
    const canvasHeight = Math.ceil(mask.height / scaleFactor) + 2;
    if (
      canvasWidth > MAX_SELECTION_OUTLINE_DIMENSION ||
      canvasHeight > MAX_SELECTION_OUTLINE_DIMENSION ||
      canvasWidth * canvasHeight > MAX_RASTER_SELECTION_PIXELS ||
      canvasWidth * canvasHeight * 4 > MAX_SELECTION_OUTLINE_CACHE_BYTES
    ) {
      continue;
    }
    const outline = createOutlineAtScale(mask, packed, scaleFactor);
    if (!outline) continue;
    cacheSelectionOutline(mask, outline);
    return outline;
  }

  console.error('Unable to prepare the raster selection outline at any supported resolution');
  return null;
}

function createMarchingAntsPatternCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const cycle = DASH_LENGTH + GAP_LENGTH;
  const canvas = document.createElement('canvas');
  canvas.width = cycle;
  canvas.height = cycle;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const imageData = ctx.createImageData(cycle, cycle);
  for (let y = 0; y < cycle; y += 1) {
    for (let x = 0; x < cycle; x += 1) {
      const index = (y * cycle + x) * 4;
      const color = (x + y) % cycle < DASH_LENGTH ? 0 : 255;
      imageData.data[index] = color;
      imageData.data[index + 1] = color;
      imageData.data[index + 2] = color;
      imageData.data[index + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function drawRasterMaskOutline(
  ctx: CanvasRenderingContext2D,
  pattern: CanvasPattern | null,
  outline: SelectionRasterOutline,
  selection: Selection,
  frame: DocumentFrame,
  offset: number,
  scale: number
): void {
  const x = selection.pos.x - frame.x - 1;
  const y = selection.pos.y - frame.y - 1;
  const { width, height } = outline;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  if (pattern?.setTransform) {
    const fit = 1 / Math.max(scale, Number.EPSILON);
    pattern.setTransform({ a: fit, b: 0, c: 0, d: fit, e: offset, f: offset });
  }
  ctx.fillStyle = pattern ?? ANT_STROKE_COLOR;
  ctx.fillRect(x, y, width, height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(outline.canvas, x, y, width, height);
  ctx.restore();
}

/**
 * Marching ants for committed selections — every one of them.
 *
 * Adobe documents the border as the universal display of a pixel selection rather than a per-tool
 * feature: its selection-tools table lists all nine marquee and lasso tools as making selections,
 * and nothing in any of them is documented as producing a different kind of border. So this hook
 * takes every active selection, whatever made it, and the tool areas that used to draw their own
 * dashed outline no longer do.
 *
 * The border gets a canvas of its own instead of sharing `toolOverlayRef` with the
 * tool areas, because all three polygon tool areas full-clear that canvas before
 * every repaint (`PolygonClickToolArea.tsx:84`, `MagicWandToolArea.tsx:38`,
 * `FeatherMagneticLassoToolArea.tsx:79`) and a loop painting into it would be
 * erased mid-gesture. Owning the canvas outright is also why each frame clears all
 * of it rather than erasing only the previously painted bounds: two selections can
 * overlap, and a bounds-shaped erase would take the neighbour's dashes with it.
 */
export function useSelectionMarchingAnts({
  overlayRef,
  selections,
  documentFrame,
  enabled = true,
  scaleRef,
}: SelectionMarchingAntsProps) {
  const animationIdRef = useRef<number | null>(null);
  const dashOffsetRef = useRef(0);
  const shapesRef = useRef<AntsShape[]>([]);
  const documentFrameRef = useRef(documentFrame);
  const rasterPatternRef = useRef<{ canvas: HTMLCanvasElement; pattern: CanvasPattern | null } | null>(null);

  const shapes = useMemo<AntsShape[]>(() => {
    if (!enabled) return [];

    return selections.flatMap<AntsShape>((selection): AntsShape[] => {
      if (!selection.isActive) return [];

      if (selection.rasterMask) {
        const rasterOutline = createSelectionRasterOutlineCanvas(selection.rasterMask);
        return rasterOutline ? [{ id: selection.id, selection, path: null, rasterOutline }] : [];
      }

      const path = shapePath(selection, documentFrame);

      return path ? [{ id: selection.id, selection, path, rasterOutline: null }] : [];
    });
  }, [documentFrame, enabled, selections]);

  const clearCanvas = useCallback(() => {
    const canvas = overlayRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const { width, height } = documentFrameSize(documentFrameRef.current);
    ctx.clearRect(0, 0, width, height);
  }, [overlayRef]);

  // Reads the latest shapes and frame through refs rather than closing over them, so that
  // replacing one selection with another repaints on the next frame instead of
  // cancelling and restarting the loop.
  const step = useCallback(
    function frame() {
      animationIdRef.current = null;
      const canvas = overlayRef.current;
      const ctx = canvas?.getContext('2d');
      const committed = shapesRef.current;

      // Nothing to restore once every selection is gone, so the loop parks itself here and the
      // effect below starts it again when shapes come back.
      if (!canvas || !ctx || committed.length === 0) {
        clearCanvas();
        return;
      }

      // Rescheduled before anything that can return. Every branch below leaves a live loop
      // behind on purpose: what to paint is read fresh from outside React every frame, so a
      // loop that stopped would need a re-render to start again — and the one state that
      // paints nothing (a marquee in flight) is exactly the state that has to be escapable.
      animationIdRef.current = requestAnimationFrame(frame);

      const drag = readSelectionDragPreview();

      // A marquee in flight is already painted on the tool overlay, which sits above this
      // canvas. Painting the committed border beside it would show two outlines of one
      // selection, one of them stale. The dash offset is deliberately left where it is rather
      // than advanced, so the ants resume on the phase they left rather than jumping.
      if (drag?.kind === 'marquee') {
        clearCanvas();
        return;
      }

      const { width, height } = documentFrameSize(documentFrameRef.current);
      ctx.clearRect(0, 0, width, height);
      const offset = dashOffsetRef.current;

      ctx.save();
      // This canvas is its own 2D context, but nothing else in this repository skips the reset
      // before painting an overlay: `useAnts.ts` resets for the layer outline it draws on the
      // tool overlay, and `drawSelectionAnchors` resets for the anchors that share the canvas with
      // it. A stroke with no `globalAlpha` of its own renders at whatever the last painter left
      // behind, and the ants are two thin strokes — the first thing that would show it.
      resetOverlayAlpha(ctx);
      // The divide is per frame rather than once at mount, because the ref is read inside the loop
      // and the fit changes when the window does. The cycle is recomputed rather than read from a
      // module constant: the undivided cycle is the WRONG modulus here, because at a scale below 1
      // the dashes are longer in document px than that, so offsetting by it would make the modulo a
      // no-op and let the offset grow without bound.
      const scale = scaleRef?.current ?? 1;
      const lineWidth = LINE_WIDTH / scale;
      const dashLength = DASH_LENGTH / scale;
      const gapLength = GAP_LENGTH / scale;
      const dashCycle = dashLength + gapLength;

      ctx.lineWidth = lineWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'butt';
      ctx.setLineDash([dashLength, gapLength]);

      // A selection being dragged replaces its own committed shape rather than joining it: the
      // committed one is the pre-drag geometry, and both together would be two borders of one
      // selection, the stale one anchored where the pointer left.
      const dragged = drag?.kind === 'follow' ? drag.selection : null;
      const visibleShapes = dragged ? committed.filter(({ id }) => id !== dragged.id) : committed;
      let pattern = rasterPatternRef.current?.canvas === canvas ? rasterPatternRef.current.pattern : null;
      if (!pattern) {
        const patternCanvas = createMarchingAntsPatternCanvas();
        pattern = patternCanvas ? ctx.createPattern(patternCanvas, 'repeat') : null;
        rasterPatternRef.current = { canvas, pattern };
      }

      // Raster selections carry a stable edge image; the marching dash is composited over it once
      // per frame, so no per-contour object walk or millions of Path2D segments are required.
      for (const shape of visibleShapes) {
        if (!shape.rasterOutline) continue;
        drawRasterMaskOutline(
          ctx,
          pattern,
          shape.rasterOutline,
          shape.selection,
          documentFrameRef.current,
          offset,
          scale
        );
      }

      for (const shape of visibleShapes) {
        if (!shape.path) continue;
        const path = shape.path;
        ctx.strokeStyle = ANT_STROKE_COLOR;
        ctx.lineDashOffset = offset;
        ctx.stroke(path);
        ctx.strokeStyle = ANT_GAP_COLOR;
        ctx.lineDashOffset = offset + dashLength;
        ctx.stroke(path);
      }

      if (dragged) {
        const original = committed.find(({ id }) => id === dragged.id);
        if (original?.rasterOutline) {
          drawRasterMaskOutline(ctx, pattern, original.rasterOutline, dragged, documentFrameRef.current, offset, scale);
        } else {
          const path = shapePath(dragged, documentFrameRef.current);
          if (path) {
            ctx.strokeStyle = ANT_STROKE_COLOR;
            ctx.lineDashOffset = offset;
            ctx.stroke(path);
            ctx.strokeStyle = ANT_GAP_COLOR;
            ctx.lineDashOffset = offset + dashLength;
            ctx.stroke(path);
          }
        }
      }

      ctx.restore();

      // A per-frame distance, so it is divided by the same factor as the dash it walks along: at
      // scale 1 this is `SPEED`, and below it the ants keep the same apparent pace instead of
      // crawling in slow motion.
      //
      // Skipped while a selection is being dragged. The dash is still PAINTED on every one of
      // those frames — a border that stopped crawling but stopped showing would be worse than
      // one that crawls — so the hold is here and not in a cancelled frame: a stopped loop
      // would need a re-render to restart, and the drag itself produces none.
      if (!dragged) dashOffsetRef.current = (offset - SPEED / scale) % dashCycle;
    },
    [clearCanvas, overlayRef]
  );

  // Every render, no dependency list: `shapes` is a fresh array whenever the store
  // or the frame changes identity, and the frames must follow it without the loop
  // being torn down. Declared before the effect below so a re-render's shapes are
  // already in the ref when that effect decides whether a loop is needed. The frame is
  // mirrored for the same reason: a dragged preview is rebuilt per pointermove without a
  // re-render, so `shapePath` inside the loop cannot close over the value from render.
  useEffect(() => {
    shapesRef.current = shapes;
    documentFrameRef.current = documentFrame;
  });

  useEffect(() => {
    if (shapes.length === 0) {
      if (animationIdRef.current !== null) cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
      clearCanvas();
      return;
    }

    if (animationIdRef.current === null) animationIdRef.current = requestAnimationFrame(step);
  }, [clearCanvas, shapes.length, step]);

  useEffect(
    () => () => {
      if (animationIdRef.current !== null) cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
      clearCanvas();
    },
    [clearCanvas]
  );
}
