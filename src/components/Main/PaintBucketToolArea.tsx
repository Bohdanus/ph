import { type RefObject } from 'react';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { usePaintStroke } from '../../hooks/usePaintStroke.ts';
import { isPointInSize } from '../../util/pixels.ts';
import { type PaintBucketToolArgs } from '../../tools/paintBucket.ts';
import type { Point } from '../../contexts/general-types.ts';

type paintBucketToolAreaProps = {
  className?: string;
  canvasCtxRef: RefObject<CanvasRenderingContext2D | null>;
  overlayCtxRef: RefObject<CanvasRenderingContext2D | null>;
};

/**
 * The Paint Bucket tool area: one click, one fill, one undo entry.
 *
 * ## The seed
 *
 * `PaintBucketToolArgs.seed` is a DECLARED field, `Point | null`, and this component is where
 * its value is produced: the click `usePaintStroke` seeds the gesture with. A bucket is a
 * click, so unlike every stroke tool in the family it has no `points` to carry the gesture,
 * and the seed is the only thing that distinguishes one fill from another.
 *
 * It is attached HERE rather than read out of a module-level ref because that is what keeps
 * the gesture replayable: the args object is what `updateLayerByTool` hands to the
 * `TOOL_ACTION` history entry, so a replay re-runs the processor with the same seed instead of
 * filling wherever the user last clicked. `Point | null` rather than `Point` because
 * `defaultSettings['paint-bucket']` is seeded with `null` and the tool-settings and
 * tool-processors suites dispatch on that literal, so "no click yet" has to be a value the
 * processor can be handed rather than an absent one.
 *
 * ## Why `updateLayerByTool` and not `tempUpdateLayer`
 *
 * `updateLayerByTool` (`src/contexts/useLayer.ts:264`) calls `tempUpdateLayer` on its way
 * through and then `commitDirtyTool(true)`, so it is both the preview and the commit. Calling
 * `tempUpdateLayer` separately first would run the whole flood fill twice per click for no
 * additional guarantee. What must NOT happen is painting without either one: `previewLayersRef`
 * is the only writer of preview state, and a tool that bypasses it leaves its pixels with no
 * history entry, which `commitDirtyTool` reports as a successful `PUBLISH_RUNTIME_PRESENTATION`
 * rather than as a lost edit.
 *
 * ## No local `documentFrame`
 *
 * Every other tool area in this directory spells out
 * `documentFrame ?? documentFrameFromSize(totalSize)`, and this one deliberately does not:
 * `usePaintStroke` resolves the frame itself (`src/hooks/usePaintStroke.ts:141-145`) and
 * converts every pointer sample through it before any callback here runs. A second resolution
 * would be a second place for the crop offset to be got wrong, and it would be dead — the value
 * would never be read.
 */
export const PaintBucketToolArea = ({ className }: paintBucketToolAreaProps) => {
  const [{ containerRef, activeLayerId, layers, totalSize }] = useStore();
  const { updateLayerByTool } = useLayers();
  const { getToolArgs } = useCurrentTool();

  const args = getToolArgs('paint-bucket');
  const activeLayer = activeLayerId ? layers[activeLayerId] : null;
  // A bedrock layer is the immutable backdrop, so there is nothing for the bucket to fill and
  // `usePaintStroke`'s `enabled` hands the whole gesture back to the tool underneath.
  const isEnabled = !!activeLayer && !activeLayer.isBedrock;

  /**
   * Layer-local seed. `tempUpdateLayer` runs the processor against the layer's OWN raster and
   * hands it `size: layer.pos`, so the click has to be expressed in the layer's pixel space —
   * document space would shift the fill by the layer's origin and, for a layer that is not at
   * the document origin, miss entirely. `isPointInSize` rejects a click that is outside the
   * layer before the processor is ever called, which is Photoshop's behaviour: clicking beside
   * the active layer fills nothing.
   */
  const buildArgs = (documentPoint: Point): PaintBucketToolArgs | null => {
    if (!args || !activeLayer) return null;

    const seed = { x: documentPoint.x - activeLayer.pos.x, y: documentPoint.y - activeLayer.pos.y };
    if (!isPointInSize(seed, activeLayer.pos)) return null;

    return { ...args, seed };
  };

  const { onPointerDown, onPointerMove, onPointerUp, onPointerLeave } = usePaintStroke(
    { imageSize: totalSize, containerRef, enabled: isEnabled },
    {
      /**
       * A bucket is a click, so the gesture has no preview phase: the press point is the whole
       * gesture and a drag to the release point is not a different fill. `onMove` is a
       * required part of the hook's surface rather than an optional one, so this is where a
       * stroke tool would repaint; for a bucket it stays empty on purpose, because the fill is
       * the only thing this tool produces and it belongs to the commit.
       */
      onMove: () => {},
      onCommit: (points) => {
        if (!activeLayerId) return;
        // `points[0]` is the press point: `usePaintStroke` seeds the gesture with it and appends
        // every later sample, and `onCommit` hands over a copy it is safe to retain.
        const toolArgs = buildArgs(points[0]);
        if (!toolArgs) return;

        void updateLayerByTool({ id: activeLayerId, toolArgs });
      },
    }
  );

  return (
    <div
      className={`${className} cursor-crosshair`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      style={{ userSelect: 'none' }}
    />
  );
};
