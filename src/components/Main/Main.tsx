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
import { EllipticalSelectionToolArea } from './EllipticalSelectionToolArea.tsx';
import { QuickSelectionToolArea } from './QuickSelectionToolArea.tsx';
import { EyedropperToolArea } from './EyedropperToolArea.tsx';
import { EraserToolArea } from './EraserToolArea.tsx';
import { CloneStampToolArea } from './CloneStampToolArea.tsx';
import { SharpenToolArea } from './SharpenToolArea.tsx';
import { SmudgeToolArea } from './SmudgeToolArea.tsx';
import { DodgeToolArea } from './DodgeToolArea.tsx';
import { BurnToolArea } from './BurnToolArea.tsx';
import { PaintBucketToolArea } from './PaintBucketToolArea.tsx';
import { GradientToolArea } from './GradientToolArea.tsx';
import { useTheme } from '../../contexts/ThemeContext.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import { PRIMARY_BUTTON_LARGE, TEXT_LINK_BUTTON } from '../ToolbarsRight/buttonStyles.ts';
import { useApp } from '../../hooks/useApp.ts';
import { useFile } from '../../contexts/useFile.tsx';
import { loadDocumentFile } from '../../contexts/image-load-save-utils.ts';
import { MoveToolArea } from './MoveToolArea.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { hasPendingText } from '../../util/typeGuards.ts';
import { resizeCanvas } from '../../util/canvas.ts';

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
      documentFrame,
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
  } else if (
    toolName === 'shape' ||
    toolName === 'rectangle' ||
    toolName === 'ellipse' ||
    toolName === 'triangle' ||
    toolName === 'polygon' ||
    toolName === 'line'
  ) {
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
  } else if (toolName === 'elliptical-selection') {
    // Its own mode rather than a second name on the rectangular one: the two areas
    // paint different geometry (an axis-aligned box and an ellipse) off different args,
    // so the mode has to name the area, not just the family.
    interactionMode = 'elliptical-selection';
  } else if (toolName === 'quick-selection') {
    interactionMode = 'quick-selection';
  } else if (toolName === 'eyedropper') {
    interactionMode = 'eyedropper';
  } else if (toolName === 'eraser') {
    // A brush, but NOT the `draw` mode: `DrawToolArea` creates a new layer from a
    // `{ ...args, points }` and draws the `DrawToolArgs` preview, where the eraser
    // edits the ACTIVE layer in place through `tempUpdateLayer`. Sharing the mode would
    // mount the wrong area rather than a differently-parameterised one.
    interactionMode = 'eraser';
  } else if (toolName === 'smudge') {
    interactionMode = 'smudge';
  } else if (toolName === 'dodge') {
    interactionMode = 'dodge';
  } else if (toolName === 'burn') {
    interactionMode = 'burn';
  } else if (toolName === 'clone-stamp') {
    interactionMode = 'clone-stamp';
  } else if (toolName === 'sharpen') {
    interactionMode = 'sharpen';
  } else if (toolName === 'paint-bucket') {
    // A click, not a drag: the whole gesture is the press point.
    interactionMode = 'paint-bucket';
  } else if (toolName === 'gradient') {
    // A drag, unlike the bucket it shares an options bar with.
    interactionMode = 'gradient';
  }

  useEffect(() => {
    drawAllLayers();
  }, [documentFrame, drawAllLayers, layers]);

  useLayoutEffect(() => {
    const { width, height } = totalSize;
    if (toolOverlayRef.current) {
      resizeCanvas(toolOverlayRef.current, width, height);

      toolCtxRef.current = toolOverlayRef.current.getContext('2d')!;
      toolCtxRef.current.imageSmoothingEnabled = true;
      toolCtxRef.current.imageSmoothingQuality = 'low';
    }

    if (rectOverlayRef.current) {
      resizeCanvas(rectOverlayRef.current, width, height);
      const rectCtx = rectOverlayRef.current.getContext('2d')!;
      rectCtx.imageSmoothingEnabled = false;
    }

    if (canvasCtxRef.current) {
      canvasCtxRef.current.imageSmoothingEnabled = true;
      canvasCtxRef.current.imageSmoothingQuality = 'low';
    }
  }, [rectOverlayRef, toolOverlayRef, totalSize]);

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
        await setImageFromUpload(await loadDocumentFile(file));
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
      | typeof RectangularSelectionToolArea
      | typeof EllipticalSelectionToolArea
      | typeof QuickSelectionToolArea
      | typeof EyedropperToolArea
      | typeof EraserToolArea
      | typeof SmudgeToolArea
      | typeof DodgeToolArea
      | typeof BurnToolArea
      | typeof CloneStampToolArea
      | typeof SharpenToolArea
      | typeof PaintBucketToolArea
      | typeof GradientToolArea;

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
      else if (interactionMode === 'elliptical-selection') EventHandler = EllipticalSelectionToolArea;
      else if (interactionMode === 'quick-selection') EventHandler = QuickSelectionToolArea;
      else if (interactionMode === 'eyedropper') EventHandler = EyedropperToolArea;
      else if (interactionMode === 'eraser') EventHandler = EraserToolArea;
      else if (interactionMode === 'smudge') EventHandler = SmudgeToolArea;
      else if (interactionMode === 'dodge') EventHandler = DodgeToolArea;
      else if (interactionMode === 'burn') EventHandler = BurnToolArea;
      else if (interactionMode === 'clone-stamp') EventHandler = CloneStampToolArea;
      else if (interactionMode === 'sharpen') EventHandler = SharpenToolArea;
      else if (interactionMode === 'paint-bucket') EventHandler = PaintBucketToolArea;
      else if (interactionMode === 'gradient') EventHandler = GradientToolArea;
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
          <canvas
            ref={canvasRef}
            data-testid="workspace-canvas"
            className="h-full w-full object-contain pointer-events-none"
          />
        </div>
        <canvas
          ref={toolOverlayRef}
          className="h-full w-full object-contain absolute pointer-events-none"
          style={{
            // One entry per mode whose mounted area paints into `overlayCtxRef` — the
            // list is a LOOKUP KEY, not a summary of "tools with an area", so a mode that
            // paints and is missing here renders a blank preview with no error, and a
            // mode listed here that paints nothing just shows an already-clear canvas.
            // Painted: clone-stamp (the Alt source marker, CloneStampToolArea.tsx:249),
            // and the two selection tools (EllipticalSelectionToolArea.tsx:107,
            // QuickSelectionToolArea.tsx:99). NOT painted, and so deliberately absent:
            // eraser, smudge, dodge, burn, sharpen, paint-bucket, gradient and the
            // eyedropper — every one of them previews through `tempUpdateLayer`, which
            // republishes the layer and redraws the document canvas, and the eyedropper
            // paints neither context at all (EyedropperToolArea.tsx:12).
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
              'elliptical-selection',
              'quick-selection',
              'clone-stamp',
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
            onClick={async () => {
              try {
                const data = await openLoadImageDialog();
                if (data) await setImageFromUpload(data);
              } catch (error) {
                window.alert(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`);
              }
            }}
            data-testid="main-open-file-button"
          >
            Open File
          </button>
          <button
            className={`${TEXT_LINK_BUTTON} focus:outline-none`}
            onClick={async () => {
              try {
                const data = await openNewImageDialog();
                if (data) setBlankImage(data);
              } catch (error) {
                window.alert(`Failed to create document: ${error instanceof Error ? error.message : String(error)}`);
              }
            }}
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
