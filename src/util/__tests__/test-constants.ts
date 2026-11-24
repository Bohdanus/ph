/**
 * Test fixture constants to avoid magic numbers in tests.
 */

// Brush test constants
export const BRUSH_TEST_DEFAULTS = {
  /** Default tip radius for test LUTs */
  TEST_RADIUS: 10,
  /** Default half-width/height for test LUTs */
  TEST_HALF: 2,
  /** Default LUT profile: 0 at edges, 1 at center, linear interpolation */
  DEFAULT_LUT_PROFILE: [0, 0.5, 1, 0.5, 0] as const,
  /** Wet edges test factor */
  WET_EDGES_TEST_FACTOR: 0.5,
} as const;

// Selection test constants
export const SELECTION_TEST_DEFAULTS = {
  /** Test canvas size */
  TEST_CANVAS_SIZE: { width: 4, height: 4 },
  /** Small test canvas size */
  SMALL_CANVAS_SIZE: { width: 2, height: 1 },
  /** Test rectangle */
  TEST_RECT: { x1: 10, y1: 10, x2: 50, y2: 30 },
  /** Test points for a square polygon */
  SQUARE_POLYGON: [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ],
  /** Test points for a smaller inner square */
  INNER_SQUARE_POLYGON: [
    { x: 1, y: 1 },
    { x: 3, y: 1 },
    { x: 3, y: 3 },
    { x: 1, y: 3 },
  ],
};

// Rect-aspect test constants
export const RECT_ASPECT_TEST_DEFAULTS = {
  /** Standard test rectangle */
  BASE_RECT: { x1: 10, y1: 10, x2: 50, y2: 30 } as const,
  /** Unit square rect */
  UNIT_SQUARE: { x1: 0, y1: 0, x2: 100, y2: 100 } as const,
} as const;

// Pixel test constants
export const PIXEL_TEST_DEFAULTS = {
  /** Gray pixel (128, 128, 128, 255) */
  GRAY_PIXEL: [128, 128, 128, 255] as const,
  /** White pixel (255, 255, 255, 255) */
  WHITE_PIXEL: [255, 255, 255, 255] as const,
  /** Black pixel (0, 0, 0, 255) */
  BLACK_PIXEL: [0, 0, 0, 255] as const,
  /** Red pixel (255, 0, 0, 255) */
  RED_PIXEL: [255, 0, 0, 255] as const,
  /** Test seed: 2x1 canvas with two distinct pixels (gray + white) */
  SEED_GRAY_WHITE: [10, 20, 30, 255, 40, 50, 60, 255] as const,
  /** Test seed: 4x4 canvas with distinct values */
  SEED_4X4: [
    10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255, 130, 140, 150, 255, 160, 170, 180, 255, 190,
    200, 210, 255, 220, 230, 240, 255, 10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255, 130, 140,
    150, 255, 160, 170, 180, 255, 190, 200, 210, 255, 220, 230, 240, 255,
  ] as const,
} as const;

// Tool args defaults
export const TOOL_ARGS_DEFAULTS = {
  /** Default blur radius */
  BLUR_RADIUS: 5,
  /** Default colors args */
  COLORS: {
    grayscale: 50,
    sepia: 0,
    saturation: 100,
    toolName: 'color' as const,
  },
  /** Default magic wand args */
  MAGIC_WAND: {
    tolerance: 32,
    smoothing: 0,
    contiguous: true,
    toolName: 'magic-wand' as const,
  },
  /** Default reposition args */
  REPOSITION: {
    move: { x: 10, y: 20 },
    toolName: 'reposition' as const,
  },
} as const;

// Rectangular selection constants
export const MARQUEE_TEST_DEFAULTS = {
  /** Test rectangle */
  TEST_RECT: { x1: 0, y1: 0, x2: 10, y2: 10 } as const,
  /** Test size for applyMarqueeRatio */
  SIZE_100x50: { width: 100, height: 50 } as const,
  SIZE_100x30: { width: 100, height: 30 } as const,
  SIZE_30x100: { width: 30, height: 100 } as const,
  SIZE_50x50: { width: 50, height: 50 } as const,
  SIZE_200x50: { width: 200, height: 50 } as const,
} as const;
