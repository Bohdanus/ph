import { useEffect, useRef } from 'react';
import type { Layer } from '../../contexts/layer-types.ts';
import { drawLayerSource } from '../../contexts/layer-renderer.ts';

const THUMBNAIL_WIDTH = 48;
const THUMBNAIL_HEIGHT = 32;

const checkerboardStyle = {
  backgroundImage:
    'linear-gradient(45deg, #d1d5db 25%, transparent 25%), linear-gradient(-45deg, #d1d5db 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d1d5db 75%), linear-gradient(-45deg, transparent 75%, #d1d5db 75%)',
  backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
  backgroundSize: '8px 8px',
} as const;

/** A small live layer preview. History rows intentionally do not use this component. */
export default function LayerThumbnail({ layer, touchReorderEnabled }: { layer: Layer; touchReorderEnabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isTypeLayer = layer.source?.kind === 'tool' && layer.source.args.toolName === 'text';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);

    const { width, height } = layer.pos;
    if (!(width > 0) || !(height > 0)) return;

    const scale = Math.min(THUMBNAIL_WIDTH / width, THUMBNAIL_HEIGHT / height);
    const drawnWidth = width * scale;
    const drawnHeight = height * scale;
    context.save();
    context.translate((THUMBNAIL_WIDTH - drawnWidth) / 2, (THUMBNAIL_HEIGHT - drawnHeight) / 2);
    context.scale(scale, scale);
    try {
      drawLayerSource(context, layer, { x: 0, y: 0, width, height });
    } catch (error) {
      // A thumbnail must never make the layer list unusable when a browser cannot render a
      // retained filter. The main document renderer reports that failure independently.
      console.error('Unable to render layer thumbnail', layer.id, error);
    } finally {
      context.restore();
    }
  }, [layer]);

  return (
    <div className="relative h-8 w-12 shrink-0">
      <canvas
        ref={canvasRef}
        width={THUMBNAIL_WIDTH}
        height={THUMBNAIL_HEIGHT}
        aria-hidden="true"
        data-testid="layer-thumbnail"
        className={[
          'h-full w-full rounded-sm border border-gray-300 dark:border-gray-600',
          touchReorderEnabled && 'touch-none',
        ]
          .filter(Boolean)
          .join(' ')}
        style={checkerboardStyle}
      />
      {isTypeLayer && (
        <span
          role="img"
          aria-label="Type layer"
          data-testid="type-layer-badge"
          className="pointer-events-none absolute bottom-0 right-0 grid h-4 min-w-3 place-items-center rounded-tl-sm bg-white/90 px-0.5 text-[10px] font-bold leading-none text-gray-800 dark:bg-gray-900/90 dark:text-gray-100"
        >
          T
        </span>
      )}
    </div>
  );
}
