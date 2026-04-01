import React, { useRef } from 'react';
import type { TransformToolArgs } from '../../../tools/transform.ts';
import { useLayers } from '../../../contexts/useLayer.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { ICON_BUTTON, SMALL_TOGGLE_BUTTON_ACTIVE, SMALL_TOGGLE_BUTTON_INACTIVE, TEXT_LINK_BUTTON } from '../buttonStyles.ts';

const Transform: React.FC<{}> = () => {
  const { tempUpdateLayer } = useLayers();
  const { toolArgs, setToolArgs } = useCurrentTool();

  const args = toolArgs as TransformToolArgs;
  const pendingUpdateRef = useRef<TransformToolArgs | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const throttledOnChange = (newArgs: TransformToolArgs) => {
    pendingUpdateRef.current = newArgs;

    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        if (pendingUpdateRef.current !== null) {
          tempUpdateLayer({ toolName: 'transform', toolArgs: pendingUpdateRef.current });
          setToolArgs(pendingUpdateRef.current);
          pendingUpdateRef.current = null;
        }
        rafIdRef.current = null;
      });
    }
  };

  const { rotate = 0, mirrorH, mirrorV, skewX = 0, skewY = 0, trapezoid = 0, resizeX = 100, resizeY = 100 } = args;
  //
  // function compensateCropCorners({ rotate: newRotate, mirrorV: newMirrorV, mirrorH: newMirrorH }: TransformToolType) {
  //   if (!cropRef.current) return;
  //
  //   const state = originalState.current;
  //
  //   const prevWidth = state.size!.width;
  //   const prevHeight = state.size!.height;
  //
  //   const angle = ((newRotate - state.rotate!) * Math.PI) / 180;
  //   const absCos = Math.abs(Math.cos(angle));
  //   const absSin = Math.abs(Math.sin(angle));
  //
  //   // image expands if rotated
  //   const newWidth = Math.round(prevWidth * absCos + prevHeight * absSin);
  //   const newHeight = Math.round(prevWidth * absSin + prevHeight * absCos);
  //
  //   const scaleX = newWidth / prevWidth;
  //   const scaleY = newHeight / prevHeight;
  //
  //   // compensate resize after rotation corners
  //   let { x1, y1, x2, y2 } = state.crop!;
  //
  //   x1 *= scaleX;
  //   y1 *= scaleY;
  //   x2 *= scaleX;
  //   y2 *= scaleY;
  //
  //   if (mirrorH !== newMirrorH) {
  //     x1 = newWidth - x1;
  //     x2 = newWidth - x2;
  //   }
  //   if (mirrorV !== newMirrorV) {
  //     y1 = newHeight - y1;
  //     y2 = newHeight - y2;
  //   }
  //
  //   const sorted = sortRect({ x1, y1, x2, y2 });
  //   sorted.isRotated = true;
  //   setCrop(sorted);
  // }

  const handleRotateLeft = () => {
    let newRotate = rotate - 90;
    if (newRotate < 0) newRotate += 360;
    throttledOnChange({ ...args, rotate: newRotate });
  };

  const handleRotateRight = () => {
    let newRotate = rotate + 90;
    if (newRotate >= 360) newRotate -= 360;
    throttledOnChange({ ...args, rotate: newRotate });
  };

  const handleRotateSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newRotate = Number(event.target.value);
    throttledOnChange({ ...args, rotate: newRotate });
  };

  const toggleMirrorH = () => {
    throttledOnChange({ ...args, mirrorH: !mirrorH });
  };

  const toggleMirrorV = () => {
    throttledOnChange({ ...args, mirrorV: !mirrorV });
  };

  const handleSkewXChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    throttledOnChange({ ...args, skewX: Number(event.target.value) });
  };

  const handleSkewYChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    throttledOnChange({ ...args, skewY: Number(event.target.value) });
  };

  const handleTrapezoidChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    throttledOnChange({ ...args, trapezoid: Number(event.target.value) });
  };

  const handleResizeXChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    throttledOnChange({ ...args, resizeX: Number(event.target.value) });
  };

  const handleResizeYChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    throttledOnChange({ ...args, resizeY: Number(event.target.value) });
  };

  const resetAll = () => {
    throttledOnChange({
      rotate: 0,
      mirrorH: false,
      mirrorV: false,
      skewX: 0,
      skewY: 0,
      trapezoid: 0,
      resizeX: 100,
      resizeY: 100,
    });
  };

  return (
    <div className="flex flex-row items-center gap-4 h-full">
      <div className="flex flex-col">
        <div className="flex gap-1">
          <button
            className={`flex h-6 w-10 items-center justify-center rounded border transition-colors focus:outline-none ${ICON_BUTTON}`}
            onClick={handleRotateLeft}
            title="Rotate 90° Left"
          >
            -90°
          </button>
          <button
            className={`flex h-6 w-10 items-center justify-center rounded border transition-colors focus:outline-none ${ICON_BUTTON}`}
            onClick={() => throttledOnChange({ ...args, rotate: (rotate + 180) % 360 })}
            title="Rotate 180°"
          >
            180°
          </button>
          <button
            className={`flex h-6 w-10 items-center justify-center rounded border transition-colors focus:outline-none ${ICON_BUTTON}`}
            onClick={handleRotateRight}
            title="Rotate 90° Right"
          >
            +90°
          </button>
        </div>
        <div className="flex items-center gap-1 mt-1">
          <input
            id="rotate-slider"
            type="range"
            min={-90}
            max={90}
            value={rotate}
            onChange={handleRotateSliderChange}
            className="h-1 w-20 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
          />
          <span className="text-[10px] font-bold text-gray-900 dark:text-gray-200 w-6">{rotate}°</span>
        </div>
      </div>

      <div className="flex flex-col">
        <label
          htmlFor="skew-x-slider"
          className="text-[10px] font-medium mb-1 text-gray-700 dark:text-gray-300 flex justify-between"
        >
          Skew X <span>{skewX}°</span>
        </label>
        <input
          id="skew-x-slider"
          type="range"
          min={-45}
          max={45}
          value={skewX}
          onChange={handleSkewXChange}
          className="h-1 w-24 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
        <label
          htmlFor="skew-y-slider"
          className="text-[10px] font-medium mb-1 text-gray-700 dark:text-gray-300 flex justify-between mt-1"
        >
          Skew Y <span>{skewY}°</span>
        </label>
        <input
          id="skew-y-slider"
          type="range"
          min={-45}
          max={45}
          value={skewY}
          onChange={handleSkewYChange}
          className="h-1 w-24 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div className="flex flex-col">
        <label
          htmlFor="trapezoid-slider"
          className="text-[10px] font-medium mb-1 text-gray-700 dark:text-gray-300 flex justify-between"
        >
          Trapezoid <span>{trapezoid}%</span>
        </label>
        <input
          id="trapezoid-slider"
          type="range"
          min={-85}
          max={85}
          value={trapezoid}
          onChange={handleTrapezoidChange}
          className="h-1 w-24 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div className="flex flex-col">
        <label
          htmlFor="resize-x-slider"
          className="text-[10px] font-medium mb-1 text-gray-700 dark:text-gray-300 flex justify-between"
        >
          Resize X <span>{resizeX}%</span>
        </label>
        <input
          id="resize-x-slider"
          type="range"
          min={10}
          max={300}
          value={resizeX}
          onChange={handleResizeXChange}
          className="h-1 w-24 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
        <label
          htmlFor="resize-y-slider"
          className="text-[10px] font-medium mb-1 text-gray-700 dark:text-gray-300 flex justify-between mt-1"
        >
          Resize Y <span>{resizeY}%</span>
        </label>
        <input
          id="resize-y-slider"
          type="range"
          min={10}
          max={300}
          value={resizeY}
          onChange={handleResizeYChange}
          className="h-1 w-24 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex gap-1">
          <button
            className={`flex h-6 w-8 items-center justify-center rounded border transition-colors focus:outline-none ${
              mirrorH ? SMALL_TOGGLE_BUTTON_ACTIVE : SMALL_TOGGLE_BUTTON_INACTIVE
            }`}
            onClick={toggleMirrorH}
            title="Mirror Horizontal"
          >
            ↔
          </button>
          <button
            className={`flex h-6 w-8 items-center justify-center rounded border transition-colors focus:outline-none ${
              mirrorV ? SMALL_TOGGLE_BUTTON_ACTIVE : SMALL_TOGGLE_BUTTON_INACTIVE
            }`}
            onClick={toggleMirrorV}
            title="Mirror Vertical"
          >
            ↕
          </button>
        </div>
        <button
          className={`text-[10px] ${TEXT_LINK_BUTTON} mt-1`}
          onClick={resetAll}
        >
          Reset All
        </button>
      </div>
    </div>
  );
};

export default Transform;
