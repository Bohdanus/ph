import { useEffect, useMemo, useRef, useState } from 'react';
import { arrow, flip, offset, shift, useFloating, type Placement } from '@floating-ui/react';
import type { BitmapSource } from '../../contexts/general-types.ts';

export type MaybeBitmap = BitmapSource | null;

type PreviewTooltipProps = {
  open: boolean;
  hoveredElement: HTMLElement | null;
  bitmapPromise: Promise<MaybeBitmap>;
  placement?: Placement;
  maxSizePx?: number;
};

export default function PreviewTooltip({
  open,
  hoveredElement,
  bitmapPromise,
  placement = 'left',
  maxSizePx = 200,
}: PreviewTooltipProps) {
  const tooltipCanvasRef = useRef<HTMLCanvasElement>(null);
  const [arrowElement, setArrowElement] = useState<HTMLDivElement | null>(null);

  const middleware = useMemo(
    () => [offset(10), arrow({ element: arrowElement }), flip(), shift({ padding: 8 })],
    [arrowElement]
  );
  const {
    floatingStyles,
    refs: { setFloating, setReference },
    middlewareData,
  } = useFloating({
    placement,
    middleware,
  });

  // Keep Floating UI anchored to the currently hovered element
  useEffect(() => {
    if (!open) return;
    if (!hoveredElement) return;
    setReference(hoveredElement);
  }, [open, hoveredElement, setReference]);

  // Render bitmap to canvas when opened / when source changes
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    bitmapPromise.then((bitmap) => {
      if (cancelled || !tooltipCanvasRef.current) return;

      const canvas = tooltipCanvasRef.current;
      canvas.width = bitmap ? bitmap.width : maxSizePx;
      canvas.height = bitmap ? bitmap.height : maxSizePx;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (bitmap) {
        ctx.drawImage(bitmap, 0, 0);
      } else {
        ctx.fillStyle = '#6b7280'; // text-gray-500
        ctx.font = '133px Inter, system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No preview', canvas.width / 2, canvas.height / 2);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open, bitmapPromise, maxSizePx]);

  if (!open) return null;

  return (
    <div
      ref={setFloating}
      className="fixed bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded shadow-lg p-2 z-50"
      style={floatingStyles}
    >
      <div
        ref={setArrowElement}
        className="absolute bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
        style={{
          width: 12,
          height: 12,
          transform: 'rotate(-45deg)',
          right: -6,
          top: middlewareData.arrow?.y ?? 0,
          borderRight: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
          borderBottom: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
          color: 'inherit',
        }}
      />
      <canvas
        ref={tooltipCanvasRef}
        className="border border-gray-200 dark:border-gray-700 rounded relative z-10"
        style={{
          maxWidth: `${maxSizePx}px`,
          maxHeight: `${maxSizePx}px`,
          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
          display: 'block',
        }}
      />
    </div>
  );
}
