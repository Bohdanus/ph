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

export type SelectionSourceTool = 'polygonal-lasso' | 'freehand-lasso' | 'rectangular-selection';
export type SelectionGeometry = 'polygon' | 'rectangle';

export type IdleSelectionDraftState = { status: 'idle' };
export type ActiveSelectionDraftState = {
  status: 'draft';
  sourceTool: SelectionSourceTool;
};
export type SelectionDraftState = IdleSelectionDraftState | ActiveSelectionDraftState;

export type ClearedSelectionState = {
  status: 'cleared';
  version: number;
};

export type SelectionMetadata = {
  copiedAtVersion?: number;
  movedAtVersion?: number;
};

export type Selection = {
  id: string;
  points: Point[];
  isActive: boolean;
  pos: Pos;
  lifecycle?: 'committed';
  geometry?: SelectionGeometry;
  sourceTool?: SelectionSourceTool;
  metadata?: SelectionMetadata;
};

export type BitmapSource = ImageBitmap | HTMLImageElement | OffscreenCanvas;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
