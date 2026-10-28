export type Point = { x: number; y: number };
/** Historical processors may carry one flat path; new selection snapshots preserve all contours. */
export type SelectionPointPaths = Point[] | Point[][];
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

export type SelectionSourceTool =
  | 'polygonal-lasso'
  | 'freehand-lasso'
  | 'feather-magnetic-lasso'
  | 'magic-wand'
  | 'quick-selection'
  | 'rectangular-selection';
export type SelectionGeometry = 'polygon' | 'rectangle';

/** A lossless, packed, row-major binary selection mask stored as standard Base64. */
export type RasterSelectionMask = {
  width: number;
  height: number;
  data: string;
};

/** A raster mask positioned in the coordinate space of a raster processor. */
export type PositionedRasterSelectionMask = RasterSelectionMask & Point;

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
  featherRadius?: number;
  magneticLasso?: {
    width: number;
    contrast: number;
    frequency: number;
    snapStrength: number;
    smoothing: number;
    antiAlias: boolean;
    pathPointCount: number;
  };
  magicWand?: {
    tolerance: number;
    smoothing: number;
    selectedPixelCount: number;
    seed: Point;
    sampleColor: {
      r: number;
      g: number;
      b: number;
      a: number;
    };
  } & (
    | { boundaryEdgeCount: number; boundaryPointCount?: undefined }
    | { boundaryPointCount: number; boundaryEdgeCount?: undefined }
  );
};

export type Selection = {
  id: string;
  points: Point[][];
  /** Present for complex pixel selections that would be unsafe to materialize as millions of points. */
  rasterMask?: RasterSelectionMask;
  isActive: boolean;
  pos: Pos;
  lifecycle?: 'committed';
  geometry?: SelectionGeometry;
  sourceTool?: SelectionSourceTool;
  metadata?: SelectionMetadata;
};

export type BitmapSource = ImageBitmap | HTMLCanvasElement | HTMLImageElement | OffscreenCanvas;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type SelectionClipboard = {
  bitmap: BitmapSource;
  copiedAt: number;
  name: string;
  pos: Pos;
  sourceSelectionId: string;
  sourceTool?: SelectionSourceTool;
};
