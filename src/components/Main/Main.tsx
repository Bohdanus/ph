import {
  type PointerEvent,
  type PointerEventHandler,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { ImageContext } from '../../contexts/ImageContext';
import { useDrawHandler } from './useDrawHandler';
import { useCropHandler } from './useCropHandler';
import { useZoomHandler } from './useZoomHandler';

const pointers = new Map<number, PointerEvent>();

const Main = () => {
  const {
    canvasRef,
    containerRef,
    originalImage,
    _setOriginalImage,
    addCanvasToHistory,
    openLoadImageDialog,
    crop,
    setCrop,
    size,
    interactionMode,
    zoomDataRef,
  } = useContext(ImageContext);
  const [isDragging, setIsDragging] = useState(false);

  const overlayRef = useRef<HTMLCanvasElement>(null);

  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const overlayCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  const isDrawToolActive = interactionMode === 'draw';
  const isCropToolActive = interactionMode === 'crop';
  const isZoomToolActive = interactionMode === 'zoom';

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

  // clean overlay when switching interaction modes
  useEffect(() => {
    overlayCtxRef.current?.clearRect(0, 0, overlayRef.current!.width, overlayRef.current!.height);
  }, [interactionMode]);

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

  const drawHandler = useDrawHandler({
    addCanvasToHistory,
    canvasCtxRef,
    containerRef,
    overlayCtxRef,
    overlayRef,
    size,
  });

  const cropHandler = useCropHandler({
    containerRef,
    crop,
    interactionMode,
    overlayCtxRef,
    overlayRef,
    setCrop,
    size,
  });

  const zoomHandler = useZoomHandler();

  const handleMouseDown: PointerEventHandler<HTMLDivElement> = (event) => {
    if (event.button !== undefined && event.button !== 0 && event.button !== 1) return;
    if (!originalImage) return;

    if (isDrawToolActive) {
      drawHandler.handleMouseDown(event);
    } else if (isCropToolActive) {
      cropHandler.handleMouseDown(event);
    } else if (isZoomToolActive) {
      zoomHandler.handlePointerDown(event);
    }
  };

  const handleMouseUp: PointerEventHandler<HTMLDivElement> = (event) => {
    if (!originalImage) return;

    if (isDrawToolActive) {
      drawHandler.handleMouseUp(event);
    } else if (isCropToolActive) {
      cropHandler.handleMouseUp(event);
    } else if (isZoomToolActive) {
      zoomHandler.handlePointerUp(event);
    }
  };

  const handleMouseMove: PointerEventHandler<HTMLDivElement> = (event) => {
    if (!originalImage) return;

    if (isDrawToolActive) {
      drawHandler.handleMouseMove(event);
    } else if (isCropToolActive) {
      cropHandler.handleMouseMove(event);
    } else if (isZoomToolActive) {
      zoomHandler.handlePointerMove(event);
    }
  };

  const renderContent = () => {
    const { dx, dy, zoom } = zoomDataRef.current;
    return (
      <div
        className="zoom-container absolute left-0 top-0 flex h-full w-full items-center justify-center"
        style={{
          cursor: isCropToolActive ? 'crosshair' : isZoomToolActive ? 'grab' : undefined,
          display: originalImage ? 'flex' : 'none',
          transform: `translate(${dx}px, ${dy}px) scale(${zoom})`,
        }}
      >
        <canvas ref={canvasRef} className="max-h-full max-w-full object-contain" />
        <canvas
          ref={overlayRef}
          className="max-h-full max-w-full object-contain absolute"
          style={{
            display: isDrawToolActive || isCropToolActive ? 'block' : 'none',
          }}
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
      onPointerDown={handleMouseDown}
      onPointerMove={handleMouseMove}
      onPointerUp={handleMouseUp}
      onWheel={zoomHandler.handleWheel}
    >
      {renderContent()}
      {!originalImage && (
        <button
          className="rounded bg-blue-600 px-6 py-3 text-xl text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          onClick={openLoadImageDialog}
        >
          Open File
        </button>
      )}
    </main>
  );
};

export default Main;
