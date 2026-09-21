import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CropToolArea } from './CropToolArea.tsx';
import { DrawToolArea } from './DrawToolArea.tsx';
import { TextToolArea } from './TextToolArea.tsx';
import { DummyToolArea } from './DummyToolArea.tsx';

import './Main.scss';
import { ShapeToolArea } from './ShapeToolArea.tsx';
import { PolygonClickToolArea } from './PolygonClickToolArea.tsx';
import { RectangularSelectionToolArea } from './RectangularSelectionToolArea.tsx';
import { FeatherMagneticLassoToolArea } from './FeatherMagneticLassoToolArea.tsx';
import { MagicWandToolArea } from './MagicWandToolArea.tsx';
import { useTheme } from '../../contexts/ThemeContext.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import { PRIMARY_BUTTON_LARGE, TEXT_LINK_BUTTON } from '../ToolbarsRight/buttonStyles.ts';
import { useApp } from '../../hooks/useApp.ts';
import { useFile } from '../../contexts/useFile.tsx';
import { loadDocumentFile } from '../../contexts/image-load-save-utils.ts';
import { MoveToolArea } from './MoveToolArea.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { hasPendingText } from '../../util/typeGuards.ts';

const Main = () => {
  const [
    {
      canvasRef,
      containerRef,
      toolOverlayRef,
      rectOverlayRef,
      hasImage,
      hasUnsavedChanges,
      currentArgs,
      layers,
      toolName,
      totalSize,
    },
  ] = useStore();
  const { theme } = useTheme();
  const { setBlankImage, setImageFromUpload } = useApp();
  const { openLoadImageDialog, openNewImageDialog } = useFile();
  const { drawAllLayers } = useLayers();

  const [isDragging, setIsDragging] = useState(false);

  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const toolCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  let interactionMode = 'zoom';
  if (toolName === 'reposition') {
    interactionMode = 'reposition';
  } else if (toolName === 'crop') {
    interactionMode = 'crop';
  } else if (toolName === 'draw' || toolName === 'brush' || toolName === 'pencil' || toolName === 'color-replacement') {
    interactionMode = 'draw';
  } else if (toolName === 'shape' || toolName === 'rectangle' || toolName === 'ellipse' || toolName === 'line') {
    interactionMode = 'shape';
  } else if (toolName === 'text') {
    interactionMode = 'text';
  } else if (toolName === 'polygonal-lasso' || toolName === 'freehand-lasso') {
    interactionMode = 'lasso';
  } else if (toolName === 'feather-magnetic-lasso') {
    interactionMode = 'feather-magnetic-lasso';
  } else if (toolName === 'magic-wand') {
    interactionMode = 'magic-wand';
  } else if (toolName === 'rectangular-selection') {
    interactionMode = 'rectangular-selection';
  }

  useEffect(() => {
    drawAllLayers();
  }, [layers]);

  useLayoutEffect(() => {
    const { width, height } = totalSize;
    if (toolOverlayRef.current) {
      // eslint-disable-next-line react-compiler/react-compiler
      toolOverlayRef.current.width = width;
      toolOverlayRef.current.height = height;

      toolCtxRef.current = toolOverlayRef.current.getContext('2d')!;
      toolCtxRef.current.imageSmoothingEnabled = true;
      toolCtxRef.current.imageSmoothingQuality = 'low';
    }

    if (rectOverlayRef.current) {
      rectOverlayRef.current.width = width;
      rectOverlayRef.current.height = height;
      const rectCtx = rectOverlayRef.current.getContext('2d')!;
      rectCtx.imageSmoothingEnabled = false;
    }

    if (canvasCtxRef.current) {
      canvasCtxRef.current.imageSmoothingEnabled = true;
      canvasCtxRef.current.imageSmoothingQuality = 'low';
    }
  }); // UPDATE ON EVERY RENDER

  const handleDragOver = (event: React.DragEvent) => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
      setIsDragging(true);
    }
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (event: React.DragEvent) => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      if (
        (hasUnsavedChanges || hasPendingText(currentArgs.current)) &&
        !confirm('Discard unsaved changes and open another file?')
      )
        return;
      try {
        setImageFromUpload(await loadDocumentFile(file));
      } catch (error) {
        window.alert(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  const renderContent = () => {
    type ToolAreaComponent =
      | typeof DummyToolArea
      | typeof MoveToolArea
      | typeof CropToolArea
      | typeof DrawToolArea
      | typeof ShapeToolArea
      | typeof TextToolArea
      | typeof PolygonClickToolArea
      | typeof FeatherMagneticLassoToolArea
      | typeof MagicWandToolArea
      | typeof RectangularSelectionToolArea;

    let EventHandler: ToolAreaComponent = DummyToolArea;
    if (hasImage) {
      if (interactionMode === 'reposition') EventHandler = MoveToolArea;
      else if (interactionMode === 'crop') EventHandler = CropToolArea;
      else if (interactionMode === 'draw') EventHandler = DrawToolArea;
      else if (interactionMode === 'shape') EventHandler = ShapeToolArea;
      else if (interactionMode === 'text') EventHandler = TextToolArea;
      else if (interactionMode === 'lasso') EventHandler = PolygonClickToolArea;
      else if (interactionMode === 'feather-magnetic-lasso') EventHandler = FeatherMagneticLassoToolArea;
      else if (interactionMode === 'magic-wand') EventHandler = MagicWandToolArea;
      else if (interactionMode === 'rectangular-selection') EventHandler = RectangularSelectionToolArea;
      else EventHandler = DummyToolArea;
    }

    return (
      <div
        className={`absolute left-0 top-0 flex h-full w-full items-center justify-center ${theme === 'dark' ? 'chessboard-dark' : 'chessboard-light'}`}
        style={{ display: hasImage ? undefined : 'none' }}
      >
        <div
          className="zoom-container h-full w-full"
          style={
            {
              // transform: `translate(${dx}px, ${dy}px) scale(${zoom})`,
            }
          }
        >
          <canvas ref={canvasRef} className="h-full w-full object-contain pointer-events-none" />
        </div>
        <canvas
          ref={toolOverlayRef}
          className="h-full w-full object-contain absolute pointer-events-none"
          style={{
            display: [
              'draw',
              'crop',
              'text',
              'shape',
              'reposition',
              'lasso',
              'feather-magnetic-lasso',
              'magic-wand',
              'rectangular-selection',
            ].includes(interactionMode)
              ? 'block'
              : 'none',
          }}
        />
        <canvas
          ref={rectOverlayRef}
          className="h-full w-full object-contain absolute pointer-events-none"
          style={{
            display: ['reposition'].includes(interactionMode) ? 'block' : 'none',
          }}
        />
        <EventHandler
          className="absolute inset-0 h-full w-full"
          canvasCtxRef={canvasCtxRef}
          overlayCtxRef={toolCtxRef}
        />
      </div>
    );
  };

  return (
    <main
      ref={containerRef}
      className={`relative overflow-y-auto [grid-area:main] ${
        isDragging
          ? 'bg-gray-100 dark:bg-gray-800 border-2 border-dashed border-blue-500'
          : 'bg-white dark:bg-[#1a1a1a]'
      } ${hasImage ? '' : 'flex items-center justify-center'}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {renderContent()}
      {!hasImage && (
        <div className="flex flex-col items-center gap-4">
          <button
            className={PRIMARY_BUTTON_LARGE}
            onClick={() =>
              openLoadImageDialog().then((data) => {
                if (data) setImageFromUpload(data);
              })
            }
            data-testid="main-open-file-button"
          >
            Open File
          </button>
          <button
            className={`${TEXT_LINK_BUTTON} focus:outline-none`}
            onClick={() =>
              openNewImageDialog().then((data) => {
                if (data) setBlankImage(data);
              })
            }
            data-testid="main-blank-image-button"
          >
            blank image
          </button>
        </div>
      )}
    </main>
  );
};

export default Main;
