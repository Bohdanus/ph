import { useContext, useLayoutEffect, useRef, useState } from 'react';
import { ImageContext } from '../../contexts/ImageContext';
import { CropToolArea } from './CropToolArea.tsx';
import { DrawToolArea } from './DrawToolArea.tsx';
import { TextToolArea } from './TextToolArea.tsx';
import { DummyToolArea } from './DummyToolArea.tsx';
import NewImageDialog from '../NewImageDialog/NewImageDialog.tsx';

import './Main.scss';
import { ShapeToolArea } from './ShapeToolArea.tsx';
//
// const pointers = new Map<number, PointerEvent>();

const Main = () => {
  const {
    canvasRef,
    containerRef,
    originalImage,
    _setOriginalImage,
    openLoadImageDialog,
    toolName,
    size,
    zoomDataRef,
    createBlankImage,
  } = useContext(ImageContext);
  const [isDragging, setIsDragging] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);

  const overlayRef = useRef<HTMLCanvasElement>(null);

  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const overlayCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  let interactionMode = 'zoom';
  if (toolName === 'crop') {
    interactionMode = 'crop';
  } else if (toolName === 'draw') {
    interactionMode = 'draw';
  } else if (toolName === 'shape') {
    interactionMode = 'shape';
  } else if (toolName === 'text') {
    interactionMode = 'text';
  }

  // caches the context
  useLayoutEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;
    canvasCtxRef.current = canvas.getContext('2d')!;
    canvasCtxRef.current.imageSmoothingEnabled = false;

    const overlay = overlayRef.current!;
    overlayCtxRef.current = overlay.getContext('2d')!;
    overlayCtxRef.current.imageSmoothingEnabled = false;

    return () => {
      canvasCtxRef.current = null;
      overlayCtxRef.current = null;
    };
  }, [canvasRef]);

  useLayoutEffect(() => {
    if (!overlayRef.current) return;
    const { width, height } = size;
    overlayRef.current.width = width;
    overlayRef.current.height = height;
  }, [size]);

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];

    await _setOriginalImage(file);
  };
  //
  // const getCanvasCoordinates = (event: PointerEvent<HTMLDivElement>) => {
  //   const { offsetX, offsetY, scale } = dimensionsRef.current;
  //
  //   const xBeforeZoom = (event.nativeEvent.offsetX - offsetX) / scale;
  //   const yBeforeZoom = (event.nativeEvent.offsetY - offsetY) / scale;
  //
  //   const { dx, dy, zoom } = zoomDataRef.current;
  //
  //   // account for zoom transformation: translate then scale
  //   // reverse the transformation: (point - translate) / scale
  //   const x = (xBeforeZoom - dx) / zoom;
  //   const y = (yBeforeZoom - dy) / zoom;
  //
  //   return { x, y };
  // };
  //
  // const getOverlayCoordinates = (event: PointerEvent<HTMLDivElement>) => {
  //   const { offsetX, offsetY, scale } = dimensionsRef.current;
  //
  //   const x = (event.nativeEvent.offsetX - offsetX) / scale;
  //   const y = (event.nativeEvent.offsetY - offsetY) / scale;
  //
  //   return { x, y };
  // };

  const renderContent = () => {
    const { dx, dy, zoom } = zoomDataRef.current;

    const ComponentsMap = {
      crop: CropToolArea,
      draw: DrawToolArea,
      shape: ShapeToolArea,
      text: TextToolArea,
    };
    const EventHandler = originalImage ? (ComponentsMap[interactionMode] ?? DummyToolArea) : DummyToolArea;

    return (
      <div
        className="absolute left-0 top-0 flex h-full w-full items-center justify-center"
        style={{ display: originalImage ? undefined : 'none' }}
      >
        <div
          className="zoom-container h-full w-full"
          style={{
            transform: `translate(${dx}px, ${dy}px) scale(${zoom})`,
          }}
        >
          <canvas ref={canvasRef} className="h-full w-full object-contain pointer-events-none" />
        </div>
        <canvas
          ref={overlayRef}
          className="h-full w-full object-contain absolute pointer-events-none"
          style={{
            display: ['draw', 'crop', 'text', 'shape'].includes(interactionMode) ? 'block' : 'none',
          }}
        />
        <EventHandler
          className="absolute inset-0 h-full w-full"
          canvasCtxRef={canvasCtxRef}
          overlayCtxRef={overlayCtxRef}
          overlayRef={overlayRef}
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
      } ${originalImage ? '' : 'flex items-center justify-center'}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {renderContent()}
      {!originalImage && (
        <div className="flex flex-col items-center gap-4">
          <button
            className="rounded bg-blue-600 px-6 py-3 text-xl text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            onClick={openLoadImageDialog}
          >
            Open File
          </button>
          <button
            className="text-blue-600 hover:underline dark:text-blue-400 focus:outline-none"
            onClick={() => setShowNewDialog(true)}
          >
            blank image
          </button>
        </div>
      )}
      {showNewDialog && <NewImageDialog onClose={() => setShowNewDialog(false)} onCreate={createBlankImage} />}
    </main>
  );
};

export default Main;
