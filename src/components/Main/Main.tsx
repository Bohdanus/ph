import {
  type PointerEvent,
  type PointerEventHandler,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { ImageContext, type Point } from '../../contexts/ImageContext';
import { type DrawToolType, setDrawTool } from '../../tools/draw.ts';
import { savedLastSettings } from '../../tools/settings.ts';
import './Main.scss';

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
    canvasDimensions,
    interactionMode,
  } = useContext(ImageContext);

  const [isDragging, setIsDragging] = useState(false);

  // const viewportRef = useRef<HTMLDivElement | null>(null);
  // const busRef = useRef<HTMLDivElement | null>(null);
  // const stageRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  const isMouseDown = useRef(false);
  const pointerId = useRef<number | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const pointsRef = useRef<Point[]>([]);
  const pendingPoints = useRef<Point[]>([]);
  const cropStart = useRef<Point | null>(null);
  const resizeHandle = useRef<string | null>(null);
  const bufferCtx = useRef<CanvasRenderingContext2D | null>(null);
  const frameRequested = useRef(false);

  const isDrawToolActive = toolName === 'draw'; // && interactionMode === 'draw';
  const isCropToolActive = interactionMode === 'crop';

  // const handlePointerDownMain: PointerEventHandler<HTMLDivElement> = (event) => {
  //   if (interactionMode !== 'pan') return;
  //   if (event.button !== 0) return;
  //
  //   // todo: if you want perfection, later add hybrid pan (drag = transform, wheel = scroll)
  //   const scrollContainer = viewportRef.current!;
  //   const startX = event.clientX;
  //   const startY = event.clientY;
  //   const scrollLeft = scrollContainer.scrollLeft;
  //   const scrollTop = scrollContainer.scrollTop;
  //   // eslint-disable-next-line react-compiler/react-compiler
  //   document.body.style.cursor = 'grabbing';
  //
  //   const handlePointerMove = (moveEvent: PointerEvent) => {
  //     const dx = moveEvent.clientX - startX;
  //     const dy = moveEvent.clientY - startY;
  //     scrollContainer.scrollLeft = scrollLeft - dx;
  //     scrollContainer.scrollTop = scrollTop - dy;
  //   };
  //
  //   const handlePointerUp = () => {
  //     window.removeEventListener('pointermove', handlePointerMove);
  //     window.removeEventListener('pointerup', handlePointerUp);
  //     document.body.style.cursor = '';
  //   };
  //
  //   window.addEventListener('pointermove', handlePointerMove);
  //   window.addEventListener('pointerup', handlePointerUp);
  // };

  // sets width & height for scrollbars to appear, resize
  // useLayoutEffect(() => {
  //   const viewport = viewportRef.current;
  //   const bus = busRef.current;
  //   if (!viewport || !bus) return;
  //
  //   const ro = new ResizeObserver(([entry]) => {
  //     const { width, height } = entry.contentRect;
  //     if (width === 0 || height === 0) return;
  //     bus.style.width = `${width * zoom}px`;
  //     bus.style.height = `${height * zoom}px`;
  //   });
  //
  //   ro.observe(viewport);
  //   return () => ro.disconnect();
  // }, [zoom]);

  // caches the context
  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;
    ctxRef.current = canvas.getContext('2d')!;

    const overlay = overlayRef.current!;
    bufferCtx.current = overlay.getContext('2d')!;

    if (isDrawToolActive) {
      overlayRef.current!.style.cursor = 'crosshair';
    } else if (isCropToolActive && !isMouseDown.current) {
      overlayRef.current!.style.cursor = 'crosshair';
    }

    return () => {
      ctxRef.current = null;
      bufferCtx.current = null;
    };
  }, [canvasRef, isDrawToolActive, isCropToolActive]);

  const HANDLE_SIZE = 10;

  useEffect(() => {
    const ctx = bufferCtx.current;
    if (!ctx) return;

    ctx.clearRect(0, 0, overlayRef.current!.width, overlayRef.current!.height);

    if (isCropToolActive && crop && !isMouseDown.current) {
      const { x, y, width, height } = crop;
      if (width > 0 && height > 0) {
        const width_overlay = overlayRef.current!.width;
        const height_overlay = overlayRef.current!.height;

        // Draw semi-transparent overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, width_overlay, height_overlay);

        // Clear the selection area
        ctx.clearRect(x, y, width, height);

        ctx.strokeStyle = '#007bff';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(x, y, width, height);
        ctx.setLineDash([]);

        // Draw handles
        ctx.fillStyle = '#007bff';
        ctx.fillRect(x - HANDLE_SIZE / 2, y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        ctx.fillRect(x + width - HANDLE_SIZE / 2, y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        ctx.fillRect(x - HANDLE_SIZE / 2, y + height - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        ctx.fillRect(x + width - HANDLE_SIZE / 2, y + height - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      }
    }
  }, [canvasDimensions, crop, isCropToolActive]);

  // useLayoutEffect(() => {
  //   const viewport = viewportRef.current;
  //   const stage = stageRef.current;
  //   if (!originalImage || !viewport || !stage) return;
  //
  //   stage.style.aspectRatio = `${originalImage.width} / ${originalImage.height}`;
  //
  //   // const scaleX = viewport.clientWidth / originalImage.width;
  //   // const scaleY = viewport.clientHeight / originalImage.height;
  //   //
  //   // const newZoom = Math.min(scaleX, scaleY, 1);
  //   // setZoom(newZoom);
  // }, [canvasRef, originalImage, setZoom]);

  useLayoutEffect(() => {
    if (!originalImage || !overlayRef.current) return;
    overlayRef.current.width = canvasRef.current!.width;
    overlayRef.current.height = canvasRef.current!.height;
  }, [canvasDimensions]);

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
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const rectWidth = rect.width;
    const rectHeight = rect.height;

    const canvasRatio = canvasWidth / canvasHeight;
    const rectRatio = rectWidth / rectHeight;

    let displayedWidth, displayedHeight, offsetX, offsetY;

    if (canvasRatio > rectRatio) {
      displayedWidth = rectWidth;
      displayedHeight = rectWidth / canvasRatio;
      offsetX = 0;
      offsetY = (rectHeight - displayedHeight) / 2;
    } else {
      displayedWidth = rectHeight * canvasRatio;
      displayedHeight = rectHeight;
      offsetX = (rectWidth - displayedWidth) / 2;
      offsetY = 0;
    }

    const scaleX = canvasWidth / displayedWidth;
    const scaleY = canvasHeight / displayedHeight;

    return {
      x: (event.clientX - rect.left - offsetX) * scaleX,
      y: (event.clientY - rect.top - offsetY) * scaleY,
    };
  };

  const handleMouseDown: PointerEventHandler<HTMLCanvasElement> = (event) => {
    if (event.button !== undefined && event.button !== 0) return;

    pointerId.current = event.pointerId;
    overlayRef.current!.setPointerCapture(event.pointerId);

    if (isDrawToolActive) {
      isMouseDown.current = true;

      const alpha = (savedLastSettings.draw as DrawToolType).alpha;

      const ctx = alpha === 1 ? ctxRef.current! : bufferCtx.current!;
      setDrawTool(ctx, savedLastSettings.draw as DrawToolType);

      const coords = getCanvasCoordinates(event);
      pointsRef.current = [];
      pendingPoints.current = [coords];

      if (alpha === 1) {
        ctx.beginPath();
        ctx.moveTo(coords.x, coords.y);
      }
      draw();
    } else if (isCropToolActive) {
      isMouseDown.current = true;
      const coords = getCanvasCoordinates(event);

      if (crop) {
        const { x, y, width, height } = crop;
        const h2 = HANDLE_SIZE / 2;

        if (coords.x >= x - h2 && coords.x <= x + h2 && coords.y >= y - h2 && coords.y <= y + h2) {
          resizeHandle.current = 'top-left';
        } else if (
          coords.x >= x + width - h2 &&
          coords.x <= x + width + h2 &&
          coords.y >= y - h2 &&
          coords.y <= y + h2
        ) {
          resizeHandle.current = 'top-right';
        } else if (
          coords.x >= x - h2 &&
          coords.x <= x + h2 &&
          coords.y >= y + height - h2 &&
          coords.y <= y + height + h2
        ) {
          resizeHandle.current = 'bottom-left';
        } else if (
          coords.x >= x + width - h2 &&
          coords.x <= x + width + h2 &&
          coords.y >= y + height - h2 &&
          coords.y <= y + height + h2
        ) {
          resizeHandle.current = 'bottom-right';
        } else {
          resizeHandle.current = null;
        }
      }

      if (resizeHandle.current) {
        cropStart.current = { x: crop!.x, y: crop!.y }; // actually we need the initial crop for reference
      } else {
        cropStart.current = coords;
      }
    }
  };

  const handleMouseUp: PointerEventHandler<HTMLCanvasElement> = (event) => {
    if (!isMouseDown.current) return;

    if (isDrawToolActive) {
      draw();

      ctxRef.current!.drawImage(overlayRef.current!, 0, 0);
      bufferCtx.current!.clearRect(0, 0, overlayRef.current!.width, overlayRef.current!.height);

      const args = savedLastSettings.draw as DrawToolType;
      addCanvasToHistory('draw', { ...args, points: pointsRef.current });
    } else if (isCropToolActive) {
      const coords = getCanvasCoordinates(event);
      const start = cropStart.current!;
      const canvas = canvasRef.current!;

      let x, y, width, height;

      if (resizeHandle.current) {
        const currentCrop = crop!;
        let x1 = currentCrop.x;
        let y1 = currentCrop.y;
        let x2 = currentCrop.x + currentCrop.width;
        let y2 = currentCrop.y + currentCrop.height;

        if (resizeHandle.current === 'top-left') {
          x1 = coords.x;
          y1 = coords.y;
        } else if (resizeHandle.current === 'top-right') {
          x2 = coords.x;
          y1 = coords.y;
        } else if (resizeHandle.current === 'bottom-left') {
          x1 = coords.x;
          y2 = coords.y;
        } else if (resizeHandle.current === 'bottom-right') {
          x2 = coords.x;
          y2 = coords.y;
        }

        const rx1 = Math.max(0, Math.min(canvas.width, x1));
        const ry1 = Math.max(0, Math.min(canvas.height, y1));
        const rx2 = Math.max(0, Math.min(canvas.width, x2));
        const ry2 = Math.max(0, Math.min(canvas.height, y2));

        x = Math.min(rx1, rx2);
        y = Math.min(ry1, ry2);
        width = Math.abs(rx1 - rx2);
        height = Math.abs(ry1 - ry2);
      } else {
        const x1 = Math.max(0, Math.min(canvas.width, start.x));
        const y1 = Math.max(0, Math.min(canvas.height, start.y));
        const x2 = Math.max(0, Math.min(canvas.width, coords.x));
        const y2 = Math.max(0, Math.min(canvas.height, coords.y));

        x = Math.min(x1, x2);
        y = Math.min(y1, y2);
        width = Math.abs(x1 - x2);
        height = Math.abs(y1 - y2);
      }

      if (width > 0 && height > 0) {
        setCrop({
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: Math.round(height),
        });
      }

      requestAnimationFrame(() => {
        drawCrop(coords);
        cropStart.current = null;
        resizeHandle.current = null;
      });
    }

    isMouseDown.current = false;
    pointerId.current = null;
    try {
      overlayRef.current!.releasePointerCapture(event.pointerId);
    } catch {
      // pointer capture might have been lost already
    }
  };

  const handleMouseMove: PointerEventHandler<HTMLCanvasElement> = (event) => {
    if (isDrawToolActive) {
      if (!isMouseDown.current) return;

      const coords = getCanvasCoordinates(event);
      pendingPoints.current.push(coords);

      if (!frameRequested.current) {
        frameRequested.current = true;
        requestAnimationFrame(draw);
      }
    } else if (isCropToolActive) {
      if (!frameRequested.current) {
        frameRequested.current = true;
        const coords = getCanvasCoordinates(event);
        requestAnimationFrame(() => drawCrop(coords));
      }

      const coords = getCanvasCoordinates(event);
      if (crop) {
        const { x, y, width, height } = crop;
        const h2 = HANDLE_SIZE / 2;
        let cursor = 'crosshair';

        if (resizeHandle.current === 'top-left' || resizeHandle.current === 'bottom-right') {
          cursor = 'nwse-resize';
        } else if (resizeHandle.current === 'top-right' || resizeHandle.current === 'bottom-left') {
          cursor = 'nesw-resize';
        } else if (!resizeHandle.current) {
          if (
            (coords.x >= x - h2 && coords.x <= x + h2 && coords.y >= y - h2 && coords.y <= y + h2) ||
            (coords.x >= x + width - h2 &&
              coords.x <= x + width + h2 &&
              coords.y >= y + height - h2 &&
              coords.y <= y + height + h2)
          ) {
            cursor = 'nwse-resize';
          } else if (
            (coords.x >= x + width - h2 && coords.x <= x + width + h2 && coords.y >= y - h2 && coords.y <= y + h2) ||
            (coords.x >= x - h2 && coords.x <= x + h2 && coords.y >= y + height - h2 && coords.y <= y + height + h2)
          ) {
            cursor = 'nesw-resize';
          }
        }
        overlayRef.current!.style.cursor = cursor;
      }
    }
  };

  function drawCrop(coords: Point) {
    const ctx = bufferCtx.current!;
    const start = cropStart.current!;

    const width_overlay = overlayRef.current!.width;
    const height_overlay = overlayRef.current!.height;
    ctx.clearRect(0, 0, width_overlay, height_overlay);

    let x, y, width, height;

    if (resizeHandle.current) {
      const currentCrop = crop!;
      let x1 = currentCrop.x;
      let y1 = currentCrop.y;
      let x2 = currentCrop.x + currentCrop.width;
      let y2 = currentCrop.y + currentCrop.height;

      if (resizeHandle.current === 'top-left') {
        x1 = coords.x;
        y1 = coords.y;
      } else if (resizeHandle.current === 'top-right') {
        x2 = coords.x;
        y1 = coords.y;
      } else if (resizeHandle.current === 'bottom-left') {
        x1 = coords.x;
        y2 = coords.y;
      } else if (resizeHandle.current === 'bottom-right') {
        x2 = coords.x;
        y2 = coords.y;
      }

      x = Math.min(x1, x2);
      y = Math.min(y1, y2);
      width = Math.abs(x1 - x2);
      height = Math.abs(y1 - y2);
    } else {
      x = Math.min(start.x, coords.x);
      y = Math.min(start.y, coords.y);
      width = Math.abs(start.x - coords.x);
      height = Math.abs(start.y - coords.y);
    }

    // Draw semi-transparent overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, width_overlay, height_overlay);

    // Clear the selection area
    ctx.clearRect(x, y, width, height);

    ctx.strokeStyle = '#007bff';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);

    // Draw handles
    ctx.fillStyle = '#007bff';
    ctx.fillRect(x - HANDLE_SIZE / 2, y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fillRect(x + width - HANDLE_SIZE / 2, y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fillRect(x - HANDLE_SIZE / 2, y + height - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fillRect(x + width - HANDLE_SIZE / 2, y + height - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);

    frameRequested.current = false;
  }

  function draw() {
    const pp = pendingPoints.current;
    if (pp.length === 0) return;
    pointsRef.current.push(...pp);

    const alpha = (savedLastSettings.draw as DrawToolType).alpha;
    const ctx = alpha === 1 ? ctxRef.current! : bufferCtx.current!;

    if (alpha === 1) {
      for (let i = 0; i < pp.length; i++) {
        ctx.lineTo(pp[i].x, pp[i].y);
      }
      ctx.stroke();
    } else {
      ctx.clearRect(0, 0, overlayRef.current!.width, overlayRef.current!.height);
      ctx.beginPath();
      const points = pointsRef.current;
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 0; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
    }

    frameRequested.current = false;
    pendingPoints.current = [];
  }

  const renderContent = () => {
    return (
      <>
        <canvas
          ref={canvasRef}
          className="canvas-layer"
          style={{
            display: originalImage ? 'block' : 'none',
          }}
        />
        <canvas
          ref={overlayRef}
          className="canvas-layer"
          onPointerDown={handleMouseDown}
          onPointerMove={handleMouseMove}
          onPointerUp={handleMouseUp}
          onPointerLeave={handleMouseUp}
          style={{
            display: isDrawToolActive || isCropToolActive ? 'block' : 'none',
          }}
        />
      </>
    );
  };

  return (
    <main
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
