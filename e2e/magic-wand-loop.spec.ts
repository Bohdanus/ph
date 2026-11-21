import { expect, type Page, test } from './fixtures/extended-test';
import { getWorkspaceCanvas, hasDarkPixels, viewportClip, waitForCanvasPixels } from './helpers/canvas-helpers';
import {
  committedAntsOutline,
  readAntRuns,
  waitForCommittedAnts,
  waitForNoCommittedAnts,
  type AntRun,
} from './helpers/selection-ants';
import { clickToolButton } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';

const VIEWPORT = { width: 1280, height: 1000 };
const LOOP_BRUSH_DOCUMENT_PX = 28;
// Allow for ant-stroke width and backing-store-to-page rounding on rasterized brush edges.
const OUTLINE_TOLERANCE_CSS_PX = 1.5;

// Exercise the document-to-screen and marching-ants reads with a Retina backing store.
test.use({ viewport: VIEWPORT, deviceScaleFactor: 2 });

type DocumentFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  logicalWidth: number;
  logicalHeight: number;
};

type DocumentRect = { left: number; top: number; right: number; bottom: number; cornerRadius?: number };
type PagePoint = { x: number; y: number };
type AntsContentBox = { scale: number; left: number; top: number };

const readDocumentFrame = async (page: Page): Promise<DocumentFrame> =>
  getWorkspaceCanvas(page).evaluate((element) => {
    if (!(element instanceof window.HTMLCanvasElement)) {
      throw new Error('workspace canvas is not a canvas element');
    }

    const workspace = document.querySelector<HTMLElement>('[data-testid="workspace-container"]');
    const logicalWidth = Number(workspace?.getAttribute('data-fit-document-width'));
    const logicalHeight = Number(workspace?.getAttribute('data-fit-document-height'));
    if (!Number.isFinite(logicalWidth) || logicalWidth <= 0 || !Number.isFinite(logicalHeight) || logicalHeight <= 0) {
      throw new Error('workspace does not publish a valid fitted document size');
    }

    const rect = element.getBoundingClientRect();
    const scale = Math.min(rect.width / element.width, rect.height / element.height);
    return {
      x: rect.left + (rect.width - element.width * scale) / 2,
      y: rect.top + (rect.height - element.height * scale) / 2,
      width: element.width * scale,
      height: element.height * scale,
      logicalWidth,
      logicalHeight,
    };
  });

const documentPoint = (frame: DocumentFrame, x: number, y: number) => ({
  x: frame.x + (x / frame.logicalWidth) * frame.width,
  y: frame.y + (y / frame.logicalHeight) * frame.height,
});

const expectOutlineNear = async (page: Page, expected: DocumentRect, description: string): Promise<void> => {
  const outline = await committedAntsOutline(page);
  expect(outline, description).not.toBeNull();
  if (!outline) throw new Error(`${description}: no committed ants outline`);

  for (const edge of ['left', 'top', 'right', 'bottom'] as const) {
    expect(Math.abs(outline[edge] - expected[edge]), `${description}: ${edge} edge`).toBeLessThanOrEqual(
      OUTLINE_TOLERANCE_CSS_PX
    );
  }
};

const readMatchingPixelCount = async (page: Page): Promise<number> => {
  const report = page.getByText(/\d[\d,]*\s+matching pixels/);
  await expect(report, 'the active Magic Wand selection has one pixel-count report').toHaveCount(1);
  await expect(report).toBeVisible();
  const match = (await report.innerText()).match(/[\d,]+/);
  if (!match) throw new Error('Magic Wand did not report a matching-pixel count');
  return Number(match[0].replaceAll(',', ''));
};

const pixelProbe = (center: { x: number; y: number }) =>
  viewportClip({
    x: Math.round(center.x - 5),
    y: Math.round(center.y - 5),
    width: 10,
    height: 10,
  });

const readAntsContentBox = async (page: Page): Promise<AntsContentBox> =>
  page.getByTestId('selection-ants-canvas').evaluate((element) => {
    if (!(element instanceof window.HTMLCanvasElement)) {
      throw new Error('selection ants overlay is not a canvas');
    }
    const workspace = document.querySelector<HTMLElement>('[data-testid="workspace-container"]');
    const logicalWidth = Number(workspace?.getAttribute('data-fit-document-width'));
    const logicalHeight = Number(workspace?.getAttribute('data-fit-document-height'));
    if (!Number.isFinite(logicalWidth) || logicalWidth <= 0 || !Number.isFinite(logicalHeight) || logicalHeight <= 0) {
      throw new Error('workspace does not publish a valid fitted document size');
    }
    const rect = element.getBoundingClientRect();
    const scale = Math.min(rect.width / logicalWidth, rect.height / logicalHeight);
    return {
      scale,
      left: rect.left + (rect.width - logicalWidth * scale) / 2,
      top: rect.top + (rect.height - logicalHeight * scale) / 2,
    };
  });

const hasAntsNear = async (
  page: Page,
  frame: AntsContentBox,
  point: PagePoint,
  radiusCssPx: number
): Promise<boolean> => {
  const radius = radiusCssPx / frame.scale;
  const runs = await readAntRuns(
    page,
    {
      x: (point.x - radiusCssPx - frame.left) / frame.scale,
      y: (point.y - radiusCssPx - frame.top) / frame.scale,
      width: radius * 2,
      height: radius * 2,
    },
    'row'
  );
  return runs.some((line) => line.length > 0);
};

const expectContourNear = async (page: Page, expected: DocumentRect, description: string): Promise<void> => {
  const frame = await readAntsContentBox(page);
  const width = expected.right - expected.left;
  const height = expected.bottom - expected.top;
  const probes: Array<[string, PagePoint]> = [];
  for (const fraction of [0.25, 0.5, 0.75]) {
    const x = expected.left + width * fraction;
    const y = expected.top + height * fraction;
    probes.push(
      [`top edge at ${fraction}`, { x, y: expected.top }],
      [`right edge at ${fraction}`, { x: expected.right, y }],
      [`bottom edge at ${fraction}`, { x, y: expected.bottom }],
      [`left edge at ${fraction}`, { x: expected.left, y }]
    );
  }

  for (const [edge, point] of probes) {
    await expect
      .poll(() => hasAntsNear(page, frame, point, 3), {
        message: `${description}: marching ants should reach the ${edge}`,
        timeout: 3_000,
      })
      .toBe(true);
  }
};

const connectedAntBounds = (runsByRow: readonly (readonly AntRun[])[], width: number): DocumentRect[] => {
  const remainingPixels = new Set<number>();
  for (const [y, runs] of runsByRow.entries()) {
    for (const [left, right] of runs) {
      for (let x = left; x <= right; x += 1) remainingPixels.add(y * width + x);
    }
  }

  const components: DocumentRect[] = [];
  while (remainingPixels.size > 0) {
    const start = remainingPixels.values().next().value;
    if (start === undefined) break;
    remainingPixels.delete(start);
    const pending = [start];
    const firstX = start % width;
    const firstY = Math.floor(start / width);
    let left = firstX;
    let top = firstY;
    let right = firstX;
    let bottom = firstY;

    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) continue;
      const x = current % width;
      const y = Math.floor(current / width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);

      for (let neighborY = Math.max(0, y - 1); neighborY <= Math.min(runsByRow.length - 1, y + 1); neighborY += 1) {
        for (let neighborX = Math.max(0, x - 1); neighborX <= Math.min(width - 1, x + 1); neighborX += 1) {
          const neighbor = neighborY * width + neighborX;
          if (remainingPixels.delete(neighbor)) pending.push(neighbor);
        }
      }
    }

    components.push({ left, top, right, bottom });
  }

  return components;
};

const runMatchesContour = (run: AntRun, y: number, contour: DocumentRect, tolerance: number): boolean => {
  const radius = Math.min(
    contour.cornerRadius ?? 0,
    (contour.right - contour.left) / 2,
    (contour.bottom - contour.top) / 2
  );
  const edgeTolerance = tolerance + 0.5;
  for (let x = run[0]; x <= run[1]; x += 1) {
    const centerX = x + 0.5;
    const centerY = y + 0.5;
    const nearTop =
      Math.abs(centerY - contour.top) <= edgeTolerance &&
      centerX >= contour.left + radius - edgeTolerance &&
      centerX <= contour.right - radius + edgeTolerance;
    const nearBottom =
      Math.abs(centerY - contour.bottom) <= edgeTolerance &&
      centerX >= contour.left + radius - edgeTolerance &&
      centerX <= contour.right - radius + edgeTolerance;
    const nearLeft =
      Math.abs(centerX - contour.left) <= edgeTolerance &&
      centerY >= contour.top + radius - edgeTolerance &&
      centerY <= contour.bottom - radius + edgeTolerance;
    const nearRight =
      Math.abs(centerX - contour.right) <= edgeTolerance &&
      centerY >= contour.top + radius - edgeTolerance &&
      centerY <= contour.bottom - radius + edgeTolerance;
    if (nearTop || nearBottom || nearLeft || nearRight) continue;
    if (radius === 0) return false;

    const corners = [
      { x: contour.left + radius, y: contour.top + radius, left: true, top: true },
      { x: contour.right - radius, y: contour.top + radius, left: false, top: true },
      { x: contour.left + radius, y: contour.bottom - radius, left: true, top: false },
      { x: contour.right - radius, y: contour.bottom - radius, left: false, top: false },
    ];
    const nearCornerArc = corners.some((corner) => {
      if ((corner.left && centerX > corner.x) || (!corner.left && centerX < corner.x)) return false;
      if ((corner.top && centerY > corner.y) || (!corner.top && centerY < corner.y)) return false;
      return Math.abs(Math.hypot(centerX - corner.x, centerY - corner.y) - radius) <= edgeTolerance;
    });
    if (!nearCornerArc) return false;
  }
  return true;
};

const findUnexpectedContourComponents = (
  runsByRow: readonly (readonly AntRun[])[],
  width: number,
  expectedContours: readonly DocumentRect[],
  tolerance: number
): {
  unexpectedComponents: DocumentRect[];
  missingContours: DocumentRect[];
  incompleteContours: Array<{ contour: DocumentRect; edges: string[] }>;
} => {
  const matchedContours = new Set<number>();
  const unexpectedComponents: DocumentRect[] = [];
  const incompleteContours: Array<{ contour: DocumentRect; edges: string[] }> = [];

  const findIncompleteEdges = (contour: DocumentRect): string[] => {
    // The brush loop has round outer corners. Its bbox carries the extrema, while the straight
    // edge coverage check starts far enough inward to avoid treating those corner arcs as gaps.
    const cornerInset = Math.max(tolerance * 2, contour.cornerRadius ?? 0);
    const edgeLeft = Math.ceil(contour.left);
    const edgeRight = Math.floor(contour.right);
    const edgeTop = Math.ceil(contour.top);
    const edgeBottom = Math.floor(contour.bottom);
    const firstX = edgeLeft + cornerInset;
    const lastX = edgeRight - cornerInset;
    const firstY = edgeTop + cornerInset;
    const lastY = edgeBottom - cornerInset;
    // Ant runs are indexed by integer document pixels. Compare pixel centers to the
    // geometric straight-edge interval instead of using its fractional coordinates as
    // run indices (or array indexes).
    const firstXPixel = Math.ceil(firstX - 0.5);
    const lastXPixel = Math.floor(lastX - 0.5);
    const firstYPixel = Math.ceil(firstY - 0.5);
    const lastYPixel = Math.floor(lastY - 0.5);
    const incompleteEdges: string[] = [];

    for (const [edgeName, edgeY] of [
      ['top', edgeTop],
      ['bottom', edgeBottom],
    ] as const) {
      let complete = true;
      for (let x = firstXPixel; x <= lastXPixel; x += 1) {
        let covered = false;
        for (let y = Math.max(0, edgeY - tolerance); y <= Math.min(runsByRow.length - 1, edgeY + tolerance); y += 1) {
          if (runsByRow[y]?.some(([left, right]) => left <= x && x <= right)) {
            covered = true;
            break;
          }
        }
        if (!covered) {
          complete = false;
          break;
        }
      }
      if (!complete) incompleteEdges.push(edgeName);
    }

    for (const [edgeName, edgeX] of [
      ['left', edgeLeft],
      ['right', edgeRight],
    ] as const) {
      let complete = true;
      for (let y = firstYPixel; y <= lastYPixel; y += 1) {
        if (!runsByRow[y]?.some(([left, right]) => left <= edgeX + tolerance && edgeX - tolerance <= right)) {
          complete = false;
          break;
        }
      }
      if (!complete) incompleteEdges.push(edgeName);
    }

    return incompleteEdges;
  };

  for (const component of connectedAntBounds(runsByRow, width)) {
    const matchingContours = expectedContours.flatMap((contour, index) =>
      Math.abs(component.left - contour.left) <= tolerance &&
      Math.abs(component.top - contour.top) <= tolerance &&
      Math.abs(component.right - contour.right) <= tolerance &&
      Math.abs(component.bottom - contour.bottom) <= tolerance
        ? [index]
        : []
    );
    const match = matchingContours[0];
    if (matchingContours.length !== 1 || match === undefined || matchedContours.has(match)) {
      unexpectedComponents.push(component);
    } else {
      matchedContours.add(match);
      const expected = expectedContours[match];
      if (expected) {
        const edges = findIncompleteEdges(expected);
        if (edges.length > 0) incompleteContours.push({ contour: expected, edges });
      }
    }
  }

  const missingContours = expectedContours.filter((_contour, index) => !matchedContours.has(index));
  return { unexpectedComponents, missingContours, incompleteContours };
};

const expectOnlyExpectedContours = async (
  page: Page,
  frame: DocumentFrame,
  documentContours: readonly DocumentRect[],
  description: string
): Promise<void> => {
  const cssPerDocumentPixel = Math.min(frame.width / frame.logicalWidth, frame.height / frame.logicalHeight);
  const tolerance = Math.ceil(OUTLINE_TOLERANCE_CSS_PX / cssPerDocumentPixel);
  const runsByRow = await readAntRuns(
    page,
    { x: 0, y: 0, width: frame.logicalWidth, height: frame.logicalHeight },
    'row'
  );
  const unexpectedRuns: string[] = [];

  for (const [y, runs] of runsByRow.entries()) {
    for (const [left, right] of runs) {
      const matchesExpectedContour = documentContours.some((contour) =>
        runMatchesContour([left, right], y, contour, tolerance)
      );

      if (!matchesExpectedContour && unexpectedRuns.length < 10) unexpectedRuns.push(`row ${y}: ${left}-${right}`);
    }
  }

  expect(unexpectedRuns, `${description}: no marching ants away from the expected contours`).toEqual([]);
  expect(
    findUnexpectedContourComponents(runsByRow, frame.logicalWidth, documentContours, tolerance),
    `${description}: each expected contour has complete edges and extra islands are rejected`
  ).toEqual({ unexpectedComponents: [], missingContours: [], incompleteContours: [] });
};

test('the contour component check rejects an extra loop inside the edge tolerance band', () => {
  const rounded = { left: 10, top: 10, right: 90, bottom: 90, cornerRadius: 20 };
  expect(runMatchesContour([15, 16], 15, rounded, 1)).toBe(true);
  expect(runMatchesContour([10, 10], 10, rounded, 1)).toBe(false);
  expect(runMatchesContour([10, 10], 50, rounded, 1)).toBe(true);

  const rows = Array.from({ length: 50 }, () => [] as AntRun[]);
  const expected = { left: 5, top: 5, right: 44, bottom: 44 };
  rows[5]?.push([5, 44]);
  rows[44]?.push([5, 44]);
  for (let y = 6; y < 44; y += 1) {
    rows[y]?.push([5, 5], [44, 44]);
  }
  rows[7]?.push([20, 22]);
  rows[8]?.push([20, 20], [22, 22]);
  rows[9]?.push([20, 22]);

  expect(findUnexpectedContourComponents(rows, 50, [expected], 5)).toEqual({
    unexpectedComponents: [{ left: 20, top: 7, right: 22, bottom: 9 }],
    missingContours: [],
    incompleteContours: [],
  });

  const overlappingContours = [expected, { left: 6, top: 6, right: 43, bottom: 43 }];
  const outlineOnly = rows.map((runs) =>
    runs.filter(
      ([left, right]) => (left === 5 && right === 44) || (left === 5 && right === 5) || (left === 44 && right === 44)
    )
  );
  expect(findUnexpectedContourComponents(outlineOnly, 50, overlappingContours, 5)).toEqual({
    unexpectedComponents: [expected],
    missingContours: overlappingContours,
    incompleteContours: [],
  });
});

test('the contour component check samples fractional rounded edges on integer document pixels', () => {
  const width = 101;
  const contour = { left: 10.5, top: 10.5, right: 90.5, bottom: 90.5, cornerRadius: 20.5 };
  const rows = Array.from({ length: width }, () => [] as AntRun[]);

  for (let y = 0; y < rows.length; y += 1) {
    let runStart: number | null = null;
    for (let x = 0; x < width; x += 1) {
      if (runMatchesContour([x, x], y, contour, 0)) {
        if (runStart === null) runStart = x;
      } else if (runStart !== null) {
        rows[y]?.push([runStart, x - 1]);
        runStart = null;
      }
    }
    if (runStart !== null) rows[y]?.push([runStart, width - 1]);
  }

  expect(findUnexpectedContourComponents(rows, width, [contour], 1)).toEqual({
    unexpectedComponents: [],
    missingContours: [],
    incompleteContours: [],
  });
});

test('the contour component check rejects a long missing edge between the sparse edge probes', () => {
  const rows = Array.from({ length: 360 }, () => [] as AntRun[]);
  const expected = { left: 20, top: 20, right: 339, bottom: 339 };
  rows[20]?.push([20, 110], [150, 339]);
  rows[339]?.push([20, 339]);
  for (let y = 21; y < 339; y += 1) {
    rows[y]?.push([20, 20], [339, 339]);
  }

  const probeXs = [0.25, 0.5, 0.75].map((fraction) => expected.left + (expected.right - expected.left) * fraction);
  expect(probeXs.every((x) => rows[expected.top]?.some(([left, right]) => left <= x && x <= right))).toBe(true);
  expect(findUnexpectedContourComponents(rows, 360, [expected], 5)).toEqual({
    unexpectedComponents: [],
    missingContours: [],
    incompleteContours: [{ contour: expected, edges: ['top'] }],
  });
});

test('the contiguous Magic Wand selects the loop interior, clears it, then selects the connected exterior', async ({
  page,
}) => {
  await page.goto('/');
  await expect(getWorkspaceCanvas(page)).toBeVisible();

  await clickToolButton(page, 'draw');
  const drawFrame = await readDocumentFrame(page);
  const loop = {
    left: Math.round(drawFrame.logicalWidth * 0.28),
    top: Math.round(drawFrame.logicalHeight * 0.25),
    right: Math.round(drawFrame.logicalWidth * 0.68),
    bottom: Math.round(drawFrame.logicalHeight * 0.72),
  };
  const path = [
    { x: loop.left, y: loop.top },
    { x: loop.right, y: loop.top },
    { x: loop.right, y: loop.bottom },
    { x: loop.left, y: loop.bottom },
    { x: loop.left, y: loop.top },
  ];

  await setForegroundColor(page, '#000000', true);
  await page.locator('#size-slider').fill(String(LOOP_BRUSH_DOCUMENT_PX));
  await page.locator('#alpha-slider').fill('1');
  await expect(page.locator('#size-slider')).toHaveValue(String(LOOP_BRUSH_DOCUMENT_PX));
  await expect(page.locator('#alpha-slider')).toHaveValue('1');

  const pagePath = path.map(({ x, y }) => documentPoint(drawFrame, x, y));
  const first = pagePath[0];
  if (!first) throw new Error('Magic Wand loop path has no start point');
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of pagePath.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps: 12 });
  }
  await page.mouse.up();

  const topProbe = documentPoint(drawFrame, (loop.left + loop.right) / 2, loop.top);
  const rightProbe = documentPoint(drawFrame, loop.right, (loop.top + loop.bottom) / 2);
  const bottomProbe = documentPoint(drawFrame, (loop.left + loop.right) / 2, loop.bottom);
  const leftProbe = documentPoint(drawFrame, loop.left, (loop.top + loop.bottom) / 2);
  for (const [side, probe] of [
    ['top', topProbe],
    ['right', rightProbe],
    ['bottom', bottomProbe],
    ['left', leftProbe],
  ] as const) {
    await waitForCanvasPixels(page, pixelProbe(probe), hasDarkPixels, {
      description: `the ${side} side of the closed Magic Wand boundary`,
    });
  }

  const inside = documentPoint(drawFrame, (loop.left + loop.right) / 2, (loop.top + loop.bottom) / 2);
  await waitForCanvasPixels(
    page,
    pixelProbe(inside),
    async (screenshot, mask) => !(await hasDarkPixels(screenshot, mask)),
    { description: 'the loop interior remains clear before selection' }
  );

  await clickToolButton(page, 'magic-wand');
  const tolerance = page.locator('#magic-wand-tolerance');
  const smoothing = page.locator('#magic-wand-smoothing');
  const contiguous = page.getByRole('checkbox', { name: 'Contiguous' });
  await expect(tolerance).toBeVisible();
  await tolerance.fill('0');
  await smoothing.fill('0');
  await expect(tolerance).toHaveValue('0');
  await expect(smoothing).toHaveValue('0');
  await expect(contiguous).toBeChecked();

  // Tool switching can reflow the shell; map the same document-pixel targets through the new frame.
  const wandFrame = await readDocumentFrame(page);
  expect(wandFrame.logicalWidth).toBe(drawFrame.logicalWidth);
  expect(wandFrame.logicalHeight).toBe(drawFrame.logicalHeight);
  const wandInside = documentPoint(wandFrame, (loop.left + loop.right) / 2, (loop.top + loop.bottom) / 2);
  await page.mouse.click(wandInside.x, wandInside.y);
  await waitForCommittedAnts(page, 'the contiguous selection inside the closed loop');

  const totalPixels = wandFrame.logicalWidth * wandFrame.logicalHeight;
  const insideCount = await readMatchingPixelCount(page);
  expect(insideCount, 'a closed loop selects a substantial but bounded interior').toBeGreaterThan(totalPixels * 0.05);
  expect(insideCount, 'the interior selection must not leak into the exterior').toBeLessThan(totalPixels * 0.5);

  const insetX = (LOOP_BRUSH_DOCUMENT_PX / 2 / wandFrame.logicalWidth) * wandFrame.width;
  const insetY = (LOOP_BRUSH_DOCUMENT_PX / 2 / wandFrame.logicalHeight) * wandFrame.height;
  const expectedInside = {
    left: wandFrame.x + (loop.left / wandFrame.logicalWidth) * wandFrame.width + insetX,
    top: wandFrame.y + (loop.top / wandFrame.logicalHeight) * wandFrame.height + insetY,
    right: wandFrame.x + (loop.right / wandFrame.logicalWidth) * wandFrame.width - insetX,
    bottom: wandFrame.y + (loop.bottom / wandFrame.logicalHeight) * wandFrame.height - insetY,
  };
  await expectOutlineNear(page, expectedInside, 'the selection outline follows the loop interior');
  await expectContourNear(page, expectedInside, 'the selection outline follows the loop interior');
  const expectedInsideDocument = {
    left: loop.left + LOOP_BRUSH_DOCUMENT_PX / 2,
    top: loop.top + LOOP_BRUSH_DOCUMENT_PX / 2,
    right: loop.right - LOOP_BRUSH_DOCUMENT_PX / 2,
    bottom: loop.bottom - LOOP_BRUSH_DOCUMENT_PX / 2,
  };
  await expectOnlyExpectedContours(
    page,
    wandFrame,
    [expectedInsideDocument],
    'the interior selection follows only its rectangular loop boundary'
  );

  await page.getByRole('button', { name: 'Deselect', exact: true }).click();
  await waitForNoCommittedAnts(page, 'Deselect to remove the loop interior selection');
  await expect(contiguous, 'Deselect keeps the Magic Wand connectivity setting').toBeChecked();

  const outside = documentPoint(
    wandFrame,
    Math.round(wandFrame.logicalWidth * 0.82),
    Math.round(wandFrame.logicalHeight * 0.48)
  );
  await page.mouse.click(outside.x, outside.y);
  await waitForCommittedAnts(page, 'the connected white area outside the loop');

  const outsideCount = await readMatchingPixelCount(page);
  expect(outsideCount, 'the exterior selection reaches most of the document').toBeGreaterThan(totalPixels * 0.55);
  expect(outsideCount, 'the black loop and its enclosed interior stay outside the connected selection').toBeLessThan(
    totalPixels * 0.9
  );
  const expectedDocument = {
    left: wandFrame.x,
    top: wandFrame.y,
    right: wandFrame.x + wandFrame.width,
    bottom: wandFrame.y + wandFrame.height,
  };
  await expectOutlineNear(page, expectedDocument, 'the exterior selection reaches the document boundary');
  await expectContourNear(page, expectedDocument, 'the exterior selection reaches the document boundary');

  const strokeRadius = LOOP_BRUSH_DOCUMENT_PX / 2;
  const expectedExcludedLoop = {
    left: wandFrame.x + ((loop.left - strokeRadius) / wandFrame.logicalWidth) * wandFrame.width,
    top: wandFrame.y + ((loop.top - strokeRadius) / wandFrame.logicalHeight) * wandFrame.height,
    right: wandFrame.x + ((loop.right + strokeRadius) / wandFrame.logicalWidth) * wandFrame.width,
    bottom: wandFrame.y + ((loop.bottom + strokeRadius) / wandFrame.logicalHeight) * wandFrame.height,
  };
  const expectedExcludedLoopDocument = {
    left: loop.left - strokeRadius,
    top: loop.top - strokeRadius,
    right: loop.right + strokeRadius,
    bottom: loop.bottom + strokeRadius,
    cornerRadius: strokeRadius,
  };
  const cssPerDocumentPixel = Math.min(
    wandFrame.width / wandFrame.logicalWidth,
    wandFrame.height / wandFrame.logicalHeight
  );
  const outlineToleranceDocumentPixels = Math.ceil(OUTLINE_TOLERANCE_CSS_PX / cssPerDocumentPixel);
  expect(
    outlineToleranceDocumentPixels,
    'the outline allowance stays well below one quarter of the brush radius'
  ).toBeLessThan(strokeRadius / 4);
  await expectContourNear(
    page,
    expectedExcludedLoop,
    'the connected exterior selection excludes the drawn loop and its interior'
  );
  await expectOnlyExpectedContours(
    page,
    wandFrame,
    [
      { left: 0, top: 0, right: wandFrame.logicalWidth - 1, bottom: wandFrame.logicalHeight - 1 },
      expectedExcludedLoopDocument,
    ],
    'the exterior selection has no extra enclosed or missing contours'
  );
});
