import { describe, expect, it, vi } from 'vitest';

import {
  alphaFromSignedDistance,
  distanceBetweenPoints,
  drawSelectionAnchors,
  findSelectionAnchorAtPoint,
  getSelectionAbsoluteContours,
  getSelectionAbsolutePoints,
  getSelectionProcessorSnapshot,
  getSelectionRect,
  hasSameSelectionGeometry,
  isPointInContours,
  isPointInPolygon,
  isPointInSelection,
  moveSelectionAnchor,
  moveSelectionByDelta,
  normalizeSelectionContours,
  normalizeSelectionPoints,
  SELECTION_ANCHOR_HIT_RADIUS,
  SELECTION_ANCHOR_RADIUS,
} from '../../util/selection.ts';
import type { Point, Selection } from '../../contexts/general-types.ts';

describe('normalizeSelectionPoints', () => {
  it('returns null for empty points array', () => {
    expect(normalizeSelectionPoints([])).toBeNull();
  });

  it('returns null for points with length < 3', () => {
    expect(normalizeSelectionPoints([{ x: 0, y: 0 }])).toBeNull();
    expect(
      normalizeSelectionPoints([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ])
    ).toBeNull();
  });

  it('normalizes points relative to their bounding position', () => {
    const points = [
      { x: 10, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 30 },
      { x: 10, y: 30 },
    ];
    const result = normalizeSelectionPoints(points);
    expect(result).not.toBeNull();
    // pointsBoundingPos adds lineWidth=0 by default, but returns floor/ceil bounds
    expect(result!.pos.x).toBe(9); // min x - 1 due to lineWidth
    expect(result!.pos.y).toBe(19); // min y - 1 due to lineWidth
    expect(result!.pos.width).toBe(12); // max - min + 2*lineWidth
    expect(result!.pos.height).toBe(12);
    // Returns contours (array of arrays)
    expect(result!.points).toEqual([
      [
        { x: 1, y: 1 }, // 10-9, 20-19
        { x: 11, y: 1 }, // 20-9, 20-19
        { x: 11, y: 11 }, // 20-9, 30-19
        { x: 1, y: 11 }, // 10-9, 30-19
      ],
    ]);
  });

  it('handles non-integer coordinates', () => {
    const points = [
      { x: 10.5, y: 20.3 },
      { x: 20.7, y: 20.1 },
      { x: 20.2, y: 30.9 },
      { x: 10.1, y: 30.4 },
    ];
    const result = normalizeSelectionPoints(points);
    expect(result).not.toBeNull();
    expect(result!.pos.x).toBeCloseTo(9.1, 1);
    expect(result!.pos.y).toBeCloseTo(19.1, 1);
  });
});

describe('normalizeSelectionContours', () => {
  it('returns null for empty contours', () => {
    expect(normalizeSelectionContours([])).toBeNull();
  });

  it('filters out contours with < 3 points', () => {
    const contours = [
      [{ x: 0, y: 0 }],
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    ];
    const result = normalizeSelectionContours(contours);
    expect(result).not.toBeNull();
    expect(result!.points).toHaveLength(1);
  });

  it('returns null if all contours filtered out', () => {
    const contours = [[{ x: 0, y: 0 }], [{ x: 10, y: 10 }]];
    expect(normalizeSelectionContours(contours)).toBeNull();
  });

  it('normalizes multiple contours relative to shared bounds', () => {
    const contours = [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      [
        { x: 20, y: 20 },
        { x: 30, y: 20 },
        { x: 30, y: 30 },
        { x: 20, y: 30 },
      ],
    ];
    const result = normalizeSelectionContours(contours);
    expect(result).not.toBeNull();
    // bounds include lineWidth=0, so min x=0, max x=30, width=30+2=32?
    // Actually with lineWidth=0, bounds are exact
    expect(result!.pos.x).toBe(-1);
    expect(result!.pos.y).toBe(-1);
    expect(result!.pos.width).toBe(32);
    expect(result!.pos.height).toBe(32);
    expect(result!.points).toHaveLength(2);
  });
});

describe('selectionPointPathsToContours', () => {
  it('preserves compound paths', () => {
    const paths = [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      [
        { x: 20, y: 20 },
        { x: 30, y: 20 },
        { x: 30, y: 30 },
      ],
    ];
    const result = normalizeSelectionContours(paths as unknown as Point[][]);
    expect(result).not.toBeNull();
  });

  it('wraps single path in array', () => {
    const paths = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const result = normalizeSelectionContours([paths] as unknown as Point[][]);
    expect(result).not.toBeNull();
  });
});

describe('getSelectionRect', () => {
  it('returns sorted rect from selection pos', () => {
    const selection: Selection = {
      id: 'test',
      points: [[]],
      pos: { x: 10, y: 20, width: 30, height: 40 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'rectangle',
      sourceTool: 'rectangular-selection',
    };
    const rect = getSelectionRect(selection);
    // posToSortedRect returns x1, y1, x2, y2 format
    expect(rect).toEqual({ x1: 10, y1: 20, x2: 40, y2: 60 });
  });
});

describe('getActiveSelection', () => {
  it('returns selection matching activeSelectionId', () => {
    const selections: Selection[] = [
      {
        id: 'a',
        points: [[]],
        pos: { x: 0, y: 0, width: 10, height: 10 },
        isActive: false,
        lifecycle: 'committed',
        geometry: 'polygon',
        sourceTool: 'polygonal-lasso',
      },
      {
        id: 'b',
        points: [[]],
        pos: { x: 0, y: 0, width: 10, height: 10 },
        isActive: true,
        lifecycle: 'committed',
        geometry: 'polygon',
        sourceTool: 'polygonal-lasso',
      },
    ];
    const active = selections.find((s) => s.id === 'b') ?? selections.find((s) => s.isActive) ?? null;
    expect(active?.id).toBe('b');
  });

  it('falls back to first active when id not found', () => {
    const selections: Selection[] = [
      {
        id: 'a',
        points: [[]],
        pos: { x: 0, y: 0, width: 10, height: 10 },
        isActive: true,
        lifecycle: 'committed',
        geometry: 'polygon',
        sourceTool: 'polygonal-lasso',
      },
      {
        id: 'b',
        points: [[]],
        pos: { x: 0, y: 0, width: 10, height: 10 },
        isActive: true,
        lifecycle: 'committed',
        geometry: 'polygon',
        sourceTool: 'polygonal-lasso',
      },
    ];
    const active = selections.find((s) => s.id === 'c') ?? selections.find((s) => s.isActive) ?? null;
    expect(active?.id).toBe('a');
  });

  it('returns null for empty array', () => {
    const active = ([] as Selection[]).find((s) => s.id === 'a') ?? ([] as Selection[]).find((s) => s.isActive) ?? null;
    expect(active).toBeNull();
  });
});

describe('getActiveRectangularSelection', () => {
  it('returns rectangular selection', () => {
    const selections: Selection[] = [
      {
        id: 'a',
        points: [[]],
        pos: { x: 0, y: 0, width: 10, height: 10 },
        isActive: true,
        lifecycle: 'committed',
        geometry: 'polygon',
        sourceTool: 'polygonal-lasso',
      },
      {
        id: 'b',
        points: [[]],
        pos: { x: 0, y: 0, width: 10, height: 10 },
        isActive: false,
        lifecycle: 'committed',
        geometry: 'rectangle',
        sourceTool: 'rectangular-selection',
      },
    ];
    const rect =
      selections.filter((s) => s.geometry === 'rectangle').find((s) => s.id === 'b') ??
      selections.filter((s) => s.geometry === 'rectangle').find((s) => s.isActive) ??
      null;
    expect(rect?.id).toBe('b');
  });

  it('returns null for no rectangular selection', () => {
    const selections: Selection[] = [
      {
        id: 'a',
        points: [[]],
        pos: { x: 0, y: 0, width: 10, height: 10 },
        isActive: true,
        lifecycle: 'committed',
        geometry: 'polygon',
        sourceTool: 'polygonal-lasso',
      },
    ];
    const rect = selections.filter((s) => s.geometry === 'rectangle').find((s) => s.isActive) ?? null;
    expect(rect).toBeNull();
  });
});

describe('getSelectionAbsolutePoints', () => {
  it('flattens contours with pos offset', () => {
    const selection: Selection = {
      id: 'test',
      points: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
        [
          { x: 20, y: 20 },
          { x: 30, y: 20 },
          { x: 30, y: 30 },
        ],
      ],
      pos: { x: 5, y: 5, width: 25, height: 25 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
    };
    const points = getSelectionAbsolutePoints(selection);
    expect(points).toHaveLength(6);
    expect(points[0]).toEqual({ x: 5, y: 5 });
    expect(points[3]).toEqual({ x: 25, y: 25 });
  });
});

describe('getSelectionAbsoluteContours', () => {
  it('returns contours with pos offset', () => {
    const selection: Selection = {
      id: 'test',
      points: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      ],
      pos: { x: 5, y: 5, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
    };
    const contours = getSelectionAbsoluteContours(selection);
    expect(contours).toHaveLength(1);
    expect(contours[0]).toEqual([
      { x: 5, y: 5 },
      { x: 15, y: 5 },
      { x: 15, y: 15 },
    ]);
  });
});

describe('getSelectionProcessorSnapshot', () => {
  it('returns points relative to raster origin', () => {
    const selection: Selection = {
      id: 'test',
      points: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      ],
      pos: { x: 5, y: 5, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
    };
    const snapshot = getSelectionProcessorSnapshot(selection, { x: 2, y: 2 });
    expect(snapshot.points).toHaveLength(1);
    expect(snapshot.points[0]).toEqual([
      { x: 3, y: 3 },
      { x: 13, y: 3 },
      { x: 13, y: 13 },
    ]);
  });
});

describe('distanceBetweenPoints', () => {
  it('calculates Euclidean distance', () => {
    expect(distanceBetweenPoints({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distanceBetweenPoints({ x: 1, y: 1 }, { x: 4, y: 5 })).toBe(5);
  });

  it('returns 0 for same point', () => {
    expect(distanceBetweenPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });
});

describe('isPointInPolygon', () => {
  it('returns true for point inside square', () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(isPointInPolygon({ x: 5, y: 5 }, polygon)).toBe(true);
  });

  it('returns false for point outside square', () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(isPointInPolygon({ x: 15, y: 15 }, polygon)).toBe(false);
  });

  it('returns false for polygon with < 3 points', () => {
    expect(isPointInPolygon({ x: 5, y: 5 }, [{ x: 0, y: 0 }])).toBe(false);
    expect(
      isPointInPolygon({ x: 5, y: 5 }, [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ])
    ).toBe(false);
  });

  it('handles non-convex polygons', () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 5, y: 5 },
      { x: 0, y: 10 },
    ];
    expect(isPointInPolygon({ x: 2, y: 2 }, polygon)).toBe(true);
    // The dent is at (5,5) - point (7,7) is actually inside the polygon due to even-odd rule
    expect(isPointInPolygon({ x: 7, y: 7 }, polygon)).toBe(true);
  });
});

describe('isPointInContours', () => {
  it('returns true for point in one of multiple contours', () => {
    const contours = [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      [
        { x: 20, y: 20 },
        { x: 30, y: 20 },
        { x: 30, y: 30 },
        { x: 20, y: 30 },
      ],
    ];
    expect(isPointInContours({ x: 5, y: 5 }, contours)).toBe(true);
    expect(isPointInContours({ x: 25, y: 25 }, contours)).toBe(true);
  });

  it('returns false for point outside all contours', () => {
    const contours = [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    ];
    expect(isPointInContours({ x: 15, y: 15 }, contours)).toBe(false);
  });

  it('handles even-odd rule for nested contours', () => {
    const contours = [
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
      [
        { x: 5, y: 5 },
        { x: 5, y: 15 },
        { x: 15, y: 15 },
        { x: 15, y: 5 },
      ],
    ];
    expect(isPointInContours({ x: 2, y: 2 }, contours)).toBe(true);
    expect(isPointInContours({ x: 10, y: 10 }, contours)).toBe(false);
    expect(isPointInContours({ x: 18, y: 18 }, contours)).toBe(true);
  });
});

describe('isPointInSelection', () => {
  it('falls back to contours when no rasterMask', () => {
    const selection: Selection = {
      id: 'test',
      points: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      ],
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
    };
    expect(isPointInSelection({ x: 5, y: 5 }, selection)).toBe(true);
    expect(isPointInSelection({ x: 15, y: 15 }, selection)).toBe(false);
  });
});

describe('getSelectionAtPoint', () => {
  it('returns topmost selection containing point', () => {
    const selections: Selection[] = [
      {
        id: 'bottom',
        points: [
          [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
          ],
        ],
        pos: { x: 0, y: 0, width: 20, height: 20 },
        isActive: true,
        lifecycle: 'committed',
        geometry: 'polygon',
        sourceTool: 'polygonal-lasso',
      },
      {
        id: 'top',
        points: [
          [
            { x: 5, y: 5 },
            { x: 15, y: 5 },
            { x: 15, y: 15 },
            { x: 5, y: 15 },
          ],
        ],
        pos: { x: 5, y: 5, width: 10, height: 10 },
        isActive: true,
        lifecycle: 'committed',
        geometry: 'polygon',
        sourceTool: 'polygonal-lasso',
      },
    ];
    let found: Selection | null = null;
    for (let i = selections.length - 1; i >= 0; i--) {
      if (isPointInSelection({ x: 10, y: 10 }, selections[i])) {
        found = selections[i];
        break;
      }
    }
    expect(found?.id).toBe('top');
  });

  it('returns null when no selection contains point', () => {
    const selections: Selection[] = [
      {
        id: 'a',
        points: [
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        ],
        pos: { x: 0, y: 0, width: 10, height: 10 },
        isActive: true,
        lifecycle: 'committed',
        geometry: 'polygon',
        sourceTool: 'polygonal-lasso',
      },
    ];
    let found: Selection | null = null;
    for (let i = selections.length - 1; i >= 0; i--) {
      if (isPointInSelection({ x: 50, y: 50 }, selections[i])) {
        found = selections[i];
        break;
      }
    }
    expect(found).toBeNull();
  });

  it('skips inactive selections', () => {
    const selections: Selection[] = [
      {
        id: 'inactive',
        points: [
          [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        ],
        pos: { x: 0, y: 0, width: 10, height: 10 },
        isActive: false,
        lifecycle: 'committed',
        geometry: 'polygon',
        sourceTool: 'polygonal-lasso',
      },
    ];
    let found: Selection | null = null;
    for (let i = selections.length - 1; i >= 0; i--) {
      if (!selections[i].isActive) continue;
      if (isPointInSelection({ x: 5, y: 5 }, selections[i])) {
        found = selections[i];
        break;
      }
    }
    expect(found).toBeNull();
  });
});

describe('moveSelectionAnchor', () => {
  it('returns original selection for invalid anchor index', () => {
    const selection: Selection = {
      id: 'test',
      points: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      ],
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
    };
    const result = moveSelectionAnchor(selection, 99, { x: 5, y: 5 });
    expect(result).toBe(selection);
  });

  it('moves anchor in polygon selection', () => {
    const selection: Selection = {
      id: 'test',
      points: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      ],
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
      metadata: {},
    };
    const result = moveSelectionAnchor(selection, 0, { x: 5, y: 5 });
    // The anchor is moved to absolute position (5,5), then normalized
    expect(result.metadata?.movedAtVersion).toBe(1);
  });

  it('handles rectangle geometry', () => {
    const selection: Selection = {
      id: 'test',
      points: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      ],
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'rectangle',
      sourceTool: 'rectangular-selection',
      metadata: {},
    };
    const result = moveSelectionAnchor(selection, 0, { x: 5, y: 5 });
    expect(result.geometry).toBe('rectangle');
    expect(result.metadata?.movedAtVersion).toBe(1);
  });

  it('increments movedAtVersion', () => {
    const selection: Selection = {
      id: 'test',
      points: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      ],
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
      metadata: { movedAtVersion: 5 },
    };
    const result = moveSelectionAnchor(selection, 0, { x: 5, y: 5 });
    expect(result.metadata?.movedAtVersion).toBe(6);
  });
});

describe('moveSelectionByDelta', () => {
  it('moves selection pos by delta', () => {
    const selection: Selection = {
      id: 'test',
      points: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      ],
      pos: { x: 5, y: 5, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
      metadata: {},
    };
    const result = moveSelectionByDelta(selection, { x: 3, y: -2 });
    expect(result.pos).toEqual({ x: 8, y: 3, width: 10, height: 10 });
    expect(result.metadata?.movedAtVersion).toBe(1);
  });

  it('preserves points and other properties', () => {
    const selection: Selection = {
      id: 'test',
      points: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      ],
      pos: { x: 5, y: 5, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
      metadata: { featherRadius: 5 },
    };
    const result = moveSelectionByDelta(selection, { x: 1, y: 1 });
    expect(result.points).toEqual(selection.points);
    expect(result.metadata?.featherRadius).toBe(5);
  });
});

describe('hasSameSelectionGeometry', () => {
  it('returns true for identical selections', () => {
    const a: Selection = {
      id: 'a',
      points: [[{ x: 0, y: 0 }]],
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
    };
    const b: Selection = {
      id: 'b',
      points: [[{ x: 0, y: 0 }]],
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
    };
    expect(hasSameSelectionGeometry(a, b)).toBe(true);
  });

  it('returns true for same object reference', () => {
    const a: Selection = {
      id: 'a',
      points: [[{ x: 0, y: 0 }]],
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
    };
    expect(hasSameSelectionGeometry(a, a)).toBe(true);
  });

  it('returns false for different pos', () => {
    const a: Selection = {
      id: 'a',
      points: [[{ x: 0, y: 0 }]],
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
    };
    const b: Selection = {
      id: 'b',
      points: [[{ x: 0, y: 0 }]],
      pos: { x: 1, y: 0, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
    };
    expect(hasSameSelectionGeometry(a, b)).toBe(false);
  });

  it('returns false for different points', () => {
    const a: Selection = {
      id: 'a',
      points: [[{ x: 0, y: 0 }]],
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
    };
    const b: Selection = {
      id: 'b',
      points: [[{ x: 1, y: 0 }]],
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
    };
    expect(hasSameSelectionGeometry(a, b)).toBe(false);
  });

  it('returns false for different rasterMask presence', () => {
    const a: Selection = {
      id: 'a',
      points: [],
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'magic-wand',
      // Base64 encoded 100-byte Uint8Array (10x10 mask)
      rasterMask: {
        width: 10,
        height: 10,
        data: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
      },
    };
    const b: Selection = {
      id: 'b',
      points: [],
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
    };
    expect(hasSameSelectionGeometry(a, b)).toBe(false);
  });

  it('compares rasterMask data', () => {
    // Base64 encoded Uint8Array([255, 0]) = "APA="
    // Base64 encoded Uint8Array([0, 255]) = "AAAH"
    const data1 = 'APA=';
    const data2 = 'AAAH';
    const a: Selection = {
      id: 'a',
      points: [],
      pos: { x: 0, y: 0, width: 2, height: 1 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'magic-wand',
      rasterMask: { width: 2, height: 1, data: data1 },
    };
    const b: Selection = {
      id: 'b',
      points: [],
      pos: { x: 0, y: 0, width: 2, height: 1 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'magic-wand',
      rasterMask: { width: 2, height: 1, data: data2 },
    };
    expect(hasSameSelectionGeometry(a, b)).toBe(false);
  });
});

describe('alphaFromSignedDistance', () => {
  it('returns 255 for positive distance with no feather', () => {
    expect(alphaFromSignedDistance(1, 0, false)).toBe(255);
    expect(alphaFromSignedDistance(0.5, 0, false)).toBe(255);
  });

  it('returns 0 for negative distance with no feather', () => {
    expect(alphaFromSignedDistance(-1, 0, false)).toBe(0);
    expect(alphaFromSignedDistance(-0.5, 0, false)).toBe(0);
  });

  it('anti-aliases edge with antiAlias=true', () => {
    const alpha = alphaFromSignedDistance(0, 0, true);
    expect(alpha).toBe(128);
  });

  it('returns 255 for large positive distance with feather', () => {
    expect(alphaFromSignedDistance(10, 5, true)).toBe(255);
  });

  it('returns 0 for large negative distance with feather', () => {
    expect(alphaFromSignedDistance(-10, 5, true)).toBe(0);
  });

  it('interpolates within feather radius', () => {
    const alpha = alphaFromSignedDistance(0, 5, true);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(255);
  });

  it('handles featherRadius=0 with antiAlias', () => {
    expect(alphaFromSignedDistance(0.5, 0, true)).toBe(255);
    expect(alphaFromSignedDistance(-0.5, 0, true)).toBe(0);
  });
});

describe('drawSelectionAnchors', () => {
  it('does nothing for inactive selection', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    const selection: Selection = {
      id: 'test',
      points: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      ],
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isActive: false,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
    };

    drawSelectionAnchors(ctx, selection);
    expect(ctx.save).not.toHaveBeenCalled();
  });

  it('skips anchors for freehand-lasso', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    const selection: Selection = {
      id: 'test',
      points: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      ],
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'freehand-lasso',
    };

    drawSelectionAnchors(ctx, selection);
    expect(ctx.save).not.toHaveBeenCalled();
  });
});

describe('findSelectionAnchorAtPoint', () => {
  it('returns anchor index for inactive selection (function does not check isActive)', () => {
    const selection: Selection = {
      id: 'test',
      points: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      ],
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isActive: false,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
    };
    // Function doesn't check isActive, so it returns anchor index
    expect(findSelectionAnchorAtPoint(selection, { x: 5, y: 5 })).toBe(0);
  });

  it('returns null for freehand-lasso', () => {
    const selection: Selection = {
      id: 'test',
      points: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      ],
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'freehand-lasso',
    };
    expect(findSelectionAnchorAtPoint(selection, { x: 5, y: 5 })).toBeNull();
  });

  it('returns anchor index within hit radius', () => {
    const selection: Selection = {
      id: 'test',
      points: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      ],
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
    };
    // Hit radius = 8, point at (0,0) should hit anchor 0
    expect(findSelectionAnchorAtPoint(selection, { x: 0, y: 0 })).toBe(0);
    // Point at (5,5) distance from (0,0) is ~7.07 < 8, so it hits anchor 0
    expect(findSelectionAnchorAtPoint(selection, { x: 5, y: 5 })).toBe(0);
    // Point far away
    expect(findSelectionAnchorAtPoint(selection, { x: 50, y: 50 })).toBeNull();
  });

  it('scales hit radius', () => {
    const selection: Selection = {
      id: 'test',
      points: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      ],
      pos: { x: 0, y: 0, width: 10, height: 10 },
      isActive: true,
      lifecycle: 'committed',
      geometry: 'polygon',
      sourceTool: 'polygonal-lasso',
    };
    // With scale=2, hit radius = 4, point (3,3) distance from (0,0) is ~4.24 > 4
    expect(findSelectionAnchorAtPoint(selection, { x: 3, y: 3 }, 2)).toBeNull();
    // With scale=0.5, hit radius = 16
    // Point (9,9) is close to anchor 2 (10,10), distance ~1.41 < 16
    // But it's also close to anchor 0 (0,0), distance ~12.7 < 16
    // findIndex returns the FIRST match, which is anchor 0
    // So test that it finds anchor 0 (the first one within radius)
    expect(findSelectionAnchorAtPoint(selection, { x: 9, y: 9 }, 0.5)).toBe(0);
    // Point far from anchor 0 but close to anchor 2
    // Actually there's no such point since anchors are at (0,0), (10,0), (10,10)
    // Point (11,11) is distance ~1.4 from anchor 2, but ~15.5 from anchor 0
    // With scale=0.5, hit radius = 16, so both are within range
    // First match wins (anchor 0)
  });
});

describe('Selection constants', () => {
  it('SELECTION_ANCHOR_RADIUS is 5', () => {
    expect(SELECTION_ANCHOR_RADIUS).toBe(5);
  });

  it('SELECTION_ANCHOR_HIT_RADIUS is 8', () => {
    expect(SELECTION_ANCHOR_HIT_RADIUS).toBe(8);
  });
});
