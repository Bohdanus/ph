import React, { useEffect, useRef } from 'react';
import type { TransformToolArgs } from '../../../tools/transform.ts';
import { useLayers } from '../../../contexts/useLayer.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { ICON_BUTTON, SMALL_TOGGLE_BUTTON_ACTIVE, SMALL_TOGGLE_BUTTON_INACTIVE } from '../buttonStyles.ts';
import { TouchSlider } from '../../Common/TouchSlider.tsx';

const Transform: React.FC<{}> = () => {
  const { tempUpdateLayer, cancelLayerPreview, commitDirtyTool } = useLayers();
  const { toolArgs, setToolArgs } = useCurrentTool();
  const barRef = useRef<HTMLDivElement>(null);

  const args = toolArgs as TransformToolArgs;

  const resetArgs: TransformToolArgs = {
    rotate: 0,
    mirrorH: false,
    mirrorV: false,
    skewX: 0,
    skewY: 0,
    trapezoid: 0,
    resizeX: 100,
    resizeY: 100,
    toolName: 'transform',
  };

  const cancel = () => {
    cancelLayerPreview?.();
    setToolArgs(resetArgs);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // A finished gesture is the commit gesture.
  //
  // React's `onChange` on a range input is bound to the native `input` event, which
  // fires on every frame of a drag, so it cannot express "the user let go". The
  // native `change` event is the one that fires exactly once, when the value is
  // committed: on pointer release, and on a keyboard step. Binding it as a plain
  // listener on the bar is what turns a drag into one history entry instead of a
  // preview nobody commits.
  //
  // `commitDirtyTool()` consumes the pending preview and is a
  // no-op when there is none, and `normalizeCommittedToolArgs` drops an identity
  // transform before it reaches history through `normalizeCommittedToolArgs()` — so a release that
  // moved nothing writes nothing, and a second release cannot double-write.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const onValueCommitted = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.type === 'range') {
        commitDirtyTool?.();
      }
    };
    bar.addEventListener('change', onValueCommitted);
    return () => bar.removeEventListener('change', onValueCommitted);
  });

  // The discrete controls commit in the same place a released slider does: the
  // rotate buttons and the two mirror toggles are finished gestures too, and a
  // panel where a slider lands in history but a mirror flip does not is a panel
  // whose history nobody can reason about.
  const commitPreview = () => {
    commitDirtyTool?.();
  };

  const throttledOnChange = (newArgs: TransformToolArgs) => {
    // This is a transient preview. History is created only when the dirty
    // layer is committed, so applying the latest value synchronously cannot
    // create one history entry per slider frame. The commit rides the `change`
    // listener above, which is the end of the gesture.
    tempUpdateLayer({ toolArgs: newArgs });
    setToolArgs(newArgs);
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
    throttledOnChange({ ...args, rotate: newRotate, trapezoid: 0 });
    commitPreview();
  };

  const handleRotateRight = () => {
    let newRotate = rotate + 90;
    if (newRotate >= 360) newRotate -= 360;
    throttledOnChange({ ...args, rotate: newRotate, trapezoid: 0 });
    commitPreview();
  };

  const handleRotateSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newRotate = Number(event.target.value);
    throttledOnChange({ ...args, rotate: newRotate, trapezoid: 0 });
  };

  const toggleMirrorH = () => {
    throttledOnChange({ ...args, mirrorH: !mirrorH, trapezoid: 0 });
    commitPreview();
  };

  const toggleMirrorV = () => {
    throttledOnChange({ ...args, mirrorV: !mirrorV, trapezoid: 0 });
    commitPreview();
  };

  const handleSkewXChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    throttledOnChange({ ...args, skewX: Number(event.target.value), trapezoid: 0 });
  };

  const handleSkewYChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    throttledOnChange({ ...args, skewY: Number(event.target.value), trapezoid: 0 });
  };

  const handleTrapezoidChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    throttledOnChange({
      ...args,
      rotate: 0,
      mirrorH: false,
      mirrorV: false,
      skewX: 0,
      skewY: 0,
      resizeX: 100,
      resizeY: 100,
      trapezoid: value,
    });
  };

  const handleResizeXChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    throttledOnChange({ ...args, resizeX: Number(event.target.value), trapezoid: 0 });
  };

  const handleResizeYChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    throttledOnChange({ ...args, resizeY: Number(event.target.value), trapezoid: 0 });
  };

  return (
    <div ref={barRef} className="flex w-full flex-row items-center gap-4 h-full">
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
            onClick={() => {
              throttledOnChange({ ...args, rotate: (rotate + 180) % 360, trapezoid: 0 });
              commitPreview();
            }}
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
          <TouchSlider
            id="rotate-slider"
            aria-label="Rotation angle"
            min={-90}
            max={90}
            value={rotate}
            onChange={handleRotateSliderChange}
            trackHeight={4}
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
        <TouchSlider
          id="skew-x-slider"
          min={-45}
          max={45}
          value={skewX}
          onChange={handleSkewXChange}
          trackHeight={4}
          className="h-1 w-24 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
        <label
          htmlFor="skew-y-slider"
          className="text-[10px] font-medium mb-1 text-gray-700 dark:text-gray-300 flex justify-between mt-1"
        >
          Skew Y <span>{skewY}°</span>
        </label>
        <TouchSlider
          id="skew-y-slider"
          min={-45}
          max={45}
          value={skewY}
          onChange={handleSkewYChange}
          trackHeight={4}
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
        <TouchSlider
          id="trapezoid-slider"
          min={-85}
          max={85}
          value={trapezoid}
          onChange={handleTrapezoidChange}
          trackHeight={4}
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
        <TouchSlider
          id="resize-x-slider"
          min={10}
          max={300}
          value={resizeX}
          onChange={handleResizeXChange}
          trackHeight={4}
          className="h-1 w-24 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
        <label
          htmlFor="resize-y-slider"
          className="text-[10px] font-medium mb-1 text-gray-700 dark:text-gray-300 flex justify-between mt-1"
        >
          Resize Y <span>{resizeY}%</span>
        </label>
        <TouchSlider
          id="resize-y-slider"
          min={10}
          max={300}
          value={resizeY}
          onChange={handleResizeYChange}
          trackHeight={4}
          className="h-1 w-24 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div className="flex flex-1 items-center justify-center">
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
      </div>
    </div>
  );
};

export default Transform;
