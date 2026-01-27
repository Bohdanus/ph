import React from 'react';
import type { TransformToolType } from '../../../tools/transform.ts';

interface TransformToolbarProps {
  args: TransformToolType;
  onChange: (args: TransformToolType) => void;
}

const Transform: React.FC<TransformToolbarProps> = ({ args, onChange }) => {
  const { rotate = 0, mirrorH, mirrorV } = args;
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
    onChange({ rotate: newRotate, mirrorH, mirrorV });
  };

  const handleRotateRight = () => {
    let newRotate = rotate + 90;
    if (newRotate >= 360) newRotate -= 360;
    onChange({ rotate: newRotate, mirrorH, mirrorV });
  };

  const handleRotateSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newRotate = Number(event.target.value);
    onChange({ rotate: newRotate, mirrorH, mirrorV });
  };

  const toggleMirrorH = () => {
    onChange({ rotate, mirrorH: !mirrorH, mirrorV });
  };

  const toggleMirrorV = () => {
    onChange({ rotate, mirrorH, mirrorV: !mirrorV });
  };

  // todo add some stratching and free transform
  // const hasDefaultTransform = isEqual(args, defaultSettings.transform);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Rotate</label>
        <div className="flex gap-2">
          <button
            className="flex h-10 flex-1 items-center justify-center rounded border border-gray-300 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
            onClick={handleRotateLeft}
            title="Rotate Left"
          >
            ↺
          </button>
          <button
            className="flex h-10 flex-1 items-center justify-center rounded border border-gray-300 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
            onClick={handleRotateRight}
            title="Rotate Right"
          >
            ↻
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="rotate-slider" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Rotate Degree
        </label>
        <div className="flex items-center gap-2">
          <input
            id="rotate-slider"
            type="range"
            min={-90}
            max={90}
            value={rotate}
            onChange={handleRotateSliderChange}
            className="h-2 flex-grow cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
          />
          <span className="min-w-[40px] text-right text-sm font-bold text-gray-900 dark:text-gray-200">{rotate}°</span>
        </div>
        <button
          className="self-end text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          onClick={() => onChange({ rotate: 0, mirrorH, mirrorV })}
        >
          Reset
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Mirror</label>
        <div className="flex gap-2">
          <button
            className={`flex h-10 flex-1 items-center justify-center rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              mirrorH
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
            }`}
            onClick={toggleMirrorH}
            title="Mirror Horizontal"
          >
            ↔
          </button>
          <button
            className={`flex h-10 flex-1 items-center justify-center rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              mirrorV
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
            }`}
            onClick={toggleMirrorV}
            title="Mirror Vertical"
          >
            ↕
          </button>
        </div>
      </div>
    </div>
  );
};

export default Transform;
