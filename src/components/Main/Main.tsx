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
import './Main.scss';
import { useResizeObserverRAF } from '../../hooks/useResizeObserver';
import { useDrawHandler } from './useDrawHandler';
import { useCropHandler } from './useCropHandler';
import { useZoomHandler } from './useZoomHandler';

type Dimensions = {
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  offsetX: number;
  offsetY: number;
  scale: number;
};

const Main = () => {
  const {
    canvasRef,
    originalImage,
    _setOriginalImage,
    toolName,
    addCanvasToHistory,
    openLoadImageDialog,
    crop,
    setCrop,
    size,
    interactionMode,
    zoomData,
  } = useContext(ImageContext);

  const dimensionsRef = useRef<Dimensions>({
    innerWidth: 0,
    innerHeight: 0,
    outerWidth: 0,
    outerHeight: 0,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });
  const [isDragging, setIsDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  const pointerId = useRef<number | null>(null);
  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const overlayCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  const isDrawToolActive = toolName === 'draw';
  const isCropToolActive = interactionMode === 'crop';
  const isZoomToolActive = toolName === 'zoom';

  // caches the context
  useLayoutEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;
    canvasCtxRef.current = canvas.getContext('2d')!;

    const overlay = overlayRef.current!;
    overlayCtxRef.current = overlay.getContext('2d')!;

    return () => {
      canvasCtxRef.current = null;
      overlayCtxRef.current = null;
    };
  }, [canvasRef]);

  useResizeObserverRAF(containerRef, ({ width: outerWidth, height: outerHeight }) => {
    // setZoomData({ width, height, zoom: 1 });
    const { width: imageWidth, height: imageHeight } = size;

    const scaleX = outerWidth / imageWidth;
    const scaleY = outerHeight / imageHeight;

    const scale = Math.min(scaleX, scaleY);

    const innerWidth = imageWidth * scale;
    const innerHeight = imageHeight * scale;
    const offsetX = (outerWidth - innerWidth) / 2;
    const offsetY = (outerHeight - innerHeight) / 2;

    dimensionsRef.current = {
      innerWidth,
      innerHeight,
      outerWidth,
      outerHeight,
      offsetX,
      offsetY,
      scale,
    };
  });

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

  const getCanvasCoordinates = (event: PointerEvent<HTMLCanvasElement>) => {
    const { offsetX, offsetY, scale } = dimensionsRef.current;

    return {
      x: (event.nativeEvent.offsetX - offsetX) / scale,
      y: (event.nativeEvent.offsetY - offsetY) / scale,
    };
  };

  const drawHandler = useDrawHandler({
    getCanvasCoordinates,
    overlayCtxRef,
    addCanvasToHistory,
    canvasCtxRef,
    overlayRef,
  });

  const cropHandler = useCropHandler({
    crop,
    overlayCtxRef,
    overlayRef,
    getCanvasCoordinates,
    interactionMode,
    setCrop,
    size,
  });

  const zoomHandler = useZoomHandler();

  const handleMouseDown: PointerEventHandler<HTMLCanvasElement> = (event) => {
    if (event.button !== undefined && event.button !== 0 && event.button !== 1) return;

    pointerId.current = event.pointerId;
    overlayRef.current!.setPointerCapture(event.pointerId);

    if (isDrawToolActive) {
      drawHandler.handleMouseDown(event);
    } else if (isCropToolActive) {
      cropHandler.handleMouseDown(event);
    } else if (isZoomToolActive) {
      zoomHandler.handleMouseDown(event);
    }
  };

  const handleMouseUp: PointerEventHandler<HTMLCanvasElement> = (event) => {
    if (isDrawToolActive) {
      drawHandler.handleMouseUp();
    } else if (isCropToolActive) {
      cropHandler.handleMouseUp(event);
    } else if (isZoomToolActive) {
      zoomHandler.handleMouseUp();
    }

    pointerId.current = null;
    try {
      overlayRef.current!.releasePointerCapture(event.pointerId);
    } catch {
      // pointer capture might have been lost already
    }
  };

  const handleMouseMove: PointerEventHandler<HTMLCanvasElement> = (event) => {
    if (isDrawToolActive) {
      drawHandler.handleMouseMove(event);
    } else if (isCropToolActive) {
      cropHandler.handleMouseMove(event);
    } else if (isZoomToolActive) {
      zoomHandler.handleMouseMove(event);
    }
  };

  const renderContent = () => {
    const { dx, dy, zoom } = zoomData;
    return (
      <div
        className="canvas-container"
        style={{
          transform: `translate(${dx}px, ${dy}px) scale(${zoom})`,
          transformOrigin: 'center center',
          width: '100%',
          height: '100%',
          display: originalImage ? 'flex' : 'none',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'absolute',
          top: 0,
          left: 0,
          cursor: isCropToolActive ? 'crosshair' : isZoomToolActive ? 'grab' : undefined,
        }}
      >
        <canvas ref={canvasRef} className="canvas-layer" />
        <canvas
          ref={overlayRef}
          className="canvas-layer"
          onPointerDown={handleMouseDown}
          onPointerMove={handleMouseMove}
          onPointerUp={handleMouseUp}
          onPointerLeave={handleMouseUp}
          onWheel={zoomHandler.handleWheel}
          style={{
            display: isDrawToolActive || isCropToolActive ? 'block' : 'none',
            cursor: isDrawToolActive ? 'crosshair' : undefined,
          }}
        />
      </div>
    );
  };

  return (
    <main
      ref={containerRef}
      className={`main-content ${isDragging ? 'bg-light border border-primary' : ''} ${originalImage ? '' : 'button-center'}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ position: 'relative' }}
    >
      {renderContent()}
      {!originalImage && (
        <button className="btn btn-primary btn-lg" onClick={openLoadImageDialog}>
          Open File
        </button>
      )}
    </main>
  );
};

export default Main;
