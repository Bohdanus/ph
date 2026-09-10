import React from 'react';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';
import type { RectangularSelectionToolArgs } from '../../../tools/rectangularSelection.ts';
import { copyRectToClipboard } from '../../../util/clipboard.ts';
import { trimRect } from '../../../util/rect.ts';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from '../buttonStyles.ts';

const RectangularSelection: React.FC<{}> = () => {
  const [{ canvasRef, totalSize }] = useStore();
  const { toolArgs, setToolArgs } = useCurrentTool();

  const args = toolArgs as RectangularSelectionToolArgs;
  const { rect } = args;

  const hasRect =
    !!rect &&
    (() => {
      const { width, height } = trimRect(rect, totalSize);
      return width > 0 && height > 0;
    })();

  const handleCopy = async () => {
    await copyRectToClipboard({
      sourceCanvas: canvasRef.current,
      rect,
      imageSize: totalSize,
    });
  };

  return (
    <div className="flex flex-row items-center gap-6 h-full">
      <div className="text-[10px] text-gray-700 dark:text-gray-300">
        Draw a rectangle and copy selected bitmap area.
      </div>
      <div className="flex gap-2">
        <button className={PRIMARY_BUTTON} disabled={!hasRect} onClick={handleCopy}>
          Copy
        </button>
        <button className={SECONDARY_BUTTON} disabled={!hasRect} onClick={() => setToolArgs({ ...args, rect: null })}>
          Clear
        </button>
      </div>
    </div>
  );
};

export default RectangularSelection;
