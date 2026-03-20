export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Pos = Point & Size;

export type RectXY = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type RectXYSorted = RectXY;

export type ZoomData = { dx: number; dy: number; zoom: number };
export type Delta = { dx: number; dy: number };

export type BitmapSource = ImageBitmap | HTMLImageElement | OffscreenCanvas;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
