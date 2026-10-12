import { afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Mouse } from '@playwright/test';
import {
  CANVAS_REDRAW_CLIP,
  DEFAULT_LINE_CLIP,
  LINE_END_X,
  LINE_END_Y,
  LINE_START_X,
  LINE_START_Y,
  canvasRedrawClip,
  drawLine,
  drawLineFromDocument,
  getPageScroll,
  getWorkspaceCanvas,
  takeLineScreenshot,
  type BoundingBox,
  type ClipOptions,
} from '../canvas-helpers';
import {
  canvasElement,
  cleanupTempDirs,
  createMouseMock,
  createPageMock,
  createScreenshotSpy,
  createScrollModel,
  createTestInfoMock,
  createFakePage,
  makeOutputDir,
  resolveFakeMatches,
} from './canvas-helpers.fixtures';

const BOX: BoundingBox = { x: 100, y: 100, width: 200, height: 200 };

describe('getWorkspaceCanvas', () => {
  it('resolves to the single canvas carrying the workspace test id', () => {
    // The Draw toolbar mounts a 96x48 preview canvas ahead of the workspace, so the
    // test id has to carry the resolution - a document index would land on the preview.
    const dom = [canvasElement(), canvasElement('workspace-canvas'), canvasElement()];
    expect(resolveFakeMatches(getWorkspaceCanvas(createFakePage(dom)))).toEqual([dom[1]]);
  });

  it('resolves to nothing when the app does not publish the test id', () => {
    // The app contract is a hard dependency now: no fallback, so an unpublished test
    // id has to fail here rather than silently resolve to some other canvas.
    const dom = [canvasElement(), canvasElement(), canvasElement()];
    expect(resolveFakeMatches(getWorkspaceCanvas(createFakePage(dom)))).toEqual([]);
  });

  it('matches one element, so strict mode cannot fire', () => {
    // The regression that made the earlier `testId.or(nth(1))` attempt fail: once the
    // test id existed, the union matched the workspace canvas AND the fallback, and
    // every boundingBox() raised "resolved to 2 elements". A single-selector locator
    // cannot produce that.
    const dom = [canvasElement(), canvasElement('workspace-canvas'), canvasElement()];
    const matches = resolveFakeMatches(getWorkspaceCanvas(createFakePage(dom)));
    expect(matches).toHaveLength(1);
  });

  it('is unaffected by canvases appearing or disappearing elsewhere in the document', () => {
    // Opening a different tool unmounts the Draw preview canvas, which is what shifted
    // the old positional fallback onto a hidden overlay. Reference identity, not
    // toEqual: the positional implementation also returned elements of the same shape,
    // so a structural comparison would have passed it and pinned nothing.
    const before = [canvasElement(), canvasElement('workspace-canvas'), canvasElement()];
    const after = [canvasElement('workspace-canvas'), canvasElement(), canvasElement()];

    const beforeMatches = resolveFakeMatches(getWorkspaceCanvas(createFakePage(before)));
    const afterMatches = resolveFakeMatches(getWorkspaceCanvas(createFakePage(after)));

    expect(beforeMatches).toHaveLength(1);
    expect(afterMatches).toHaveLength(1);
    expect(beforeMatches[0]).toBe(before[1]);
    expect(afterMatches[0]).toBe(after[0]);
  });

  it('ignores a non-canvas element in the document', () => {
    // The locator keys off the test id, not the tag, so a sibling without the id is
    // not a candidate. A non-canvas element that *did* publish the id would be a
    // second match and trip strict mode - that is the app's contract to keep.
    //
    // The second canvas is what makes the case falsifiable. With one canvas,
    // `locator('canvas').nth(1)` is empty, so the old
    // `getByTestId(...).or(nth(1))` union resolved to the same single element and
    // passed: this DOM could not tell the two helpers apart. A second canvas gives
    // `nth(1)` a real element, so the union returns two and the assertion fails.
    const dom = [{ selector: 'div' }, canvasElement('workspace-canvas'), canvasElement()];
    expect(resolveFakeMatches(getWorkspaceCanvas(createFakePage(dom)))).toEqual([dom[1]]);
  });
});

describe('Locator.or', () => {
  it('returns the union of both sides, not a priority', () => {
    // Pinned so the reason `getWorkspaceCanvas` cannot use `.or()` stays executable.
    // A reader that takes the first match would hide this and make a union look like
    // a preference, which is the mistake the helper already made once.
    //
    // Membership, not order: the double concatenates the two sides, whereas real
    // Playwright returns the union in document order. Asserting the order here would
    // pin the double's behaviour and call it Playwright's.
    const dom = [canvasElement(), canvasElement(), canvasElement('workspace-canvas')];
    const page = createFakePage(dom);
    const union = page.getByTestId('workspace-canvas').or(page.locator('canvas').nth(1));
    const matches = resolveFakeMatches(union);
    expect(matches).toHaveLength(2);
    expect(matches).toEqual(expect.arrayContaining([dom[1], dom[2]]));
  });
});

describe('takeLineScreenshot', () => {
  afterEach(async () => {
    await cleanupTempDirs();
    vi.restoreAllMocks();
  });

  it('captures the documented default clip and hands the buffer back', async () => {
    const outputDir = await makeOutputDir('default-clip');
    const screenshot = Buffer.from('fake-png-data');
    const capture = createScreenshotSpy(screenshot);
    const { testInfo } = createTestInfoMock(outputDir);

    const result = await takeLineScreenshot(createPageMock({ screenshot: capture }), BOX, 'line-test', testInfo);

    expect(result).toBe(screenshot);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][0].clip).toEqual({ x: 220, y: 220, width: 260, height: 80 });
  });

  it('moves the default clip with the canvas box origin', async () => {
    const outputDir = await makeOutputDir('box-origin');
    const capture = createScreenshotSpy(Buffer.from('png'));
    const { testInfo } = createTestInfoMock(outputDir);

    await takeLineScreenshot(createPageMock({ screenshot: capture }), { ...BOX, x: 40, y: 15 }, 'shifted', testInfo);

    expect(capture.mock.calls[0][0].clip).toEqual({
      x: 40 + DEFAULT_LINE_CLIP.x,
      y: 15 + DEFAULT_LINE_CLIP.y,
      width: DEFAULT_LINE_CLIP.width,
      height: DEFAULT_LINE_CLIP.height,
    });
  });

  it('uses a custom clip verbatim instead of the box-relative default', async () => {
    const outputDir = await makeOutputDir('custom-clip');
    const capture = createScreenshotSpy(Buffer.from('png'));
    const { testInfo } = createTestInfoMock(outputDir);
    const custom: ClipOptions = { x: 10, y: 20, width: 30, height: 40 };

    await takeLineScreenshot(createPageMock({ screenshot: capture }), BOX, 'custom', testInfo, custom);

    expect(capture.mock.calls[0][0].clip).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it('keeps the box-relative default for the fields a custom clip leaves out', async () => {
    const outputDir = await makeOutputDir('partial-clip');
    const capture = createScreenshotSpy(Buffer.from('png'));
    const { testInfo } = createTestInfoMock(outputDir);

    await takeLineScreenshot(createPageMock({ screenshot: capture }), BOX, 'partial', testInfo, { x: 10 });

    expect(capture.mock.calls[0][0].clip).toEqual({
      x: 10,
      y: BOX.y + DEFAULT_LINE_CLIP.y,
      width: DEFAULT_LINE_CLIP.width,
      height: DEFAULT_LINE_CLIP.height,
    });
  });

  it('creates a missing output directory and attaches the file it captured', async () => {
    const outputDir = await makeOutputDir(path.join('nested', 'deep', 'line'));
    await expect(fs.stat(outputDir)).rejects.toThrow();

    const capture = createScreenshotSpy(Buffer.from('png'));
    const { testInfo, attach } = createTestInfoMock(outputDir);

    await takeLineScreenshot(createPageMock({ screenshot: capture }), BOX, 'line-test', testInfo);

    expect((await fs.stat(outputDir)).isDirectory()).toBe(true);
    expect(attach).toHaveBeenCalledTimes(1);

    const capturedPath = capture.mock.calls[0][0].path;
    const [attachName, attachOptions] = attach.mock.calls[0];
    expect(attachName).toBe('line-test');
    expect(attachOptions.contentType).toBe('image/png');
    expect(attachOptions.path).toBe(capturedPath);
    expect(path.dirname(capturedPath)).toBe(outputDir);
    expect(path.basename(capturedPath)).toBe('line-test.png');
  });

  it('creates the output directory through the spied fs surface, not a private namespace', async () => {
    // The helper used to `await import('node:fs/promises')` per call. That binds an ESM
    // namespace whose `mkdir` is a copy taken at load time, so a `vi.spyOn(fs, 'mkdir')`
    // replaced a property on a different object and recorded zero calls while `mkdir`
    // certainly ran — the spy proves the import is now a top-level one. mkdir/attach
    // ordering is covered by the test above; this covers the fs surface itself.
    const outputDir = await makeOutputDir('spied-mkdir');
    const mkdir = vi.spyOn(fs, 'mkdir');
    const capture = createScreenshotSpy(Buffer.from('png'));
    const { testInfo } = createTestInfoMock(outputDir);

    await takeLineScreenshot(createPageMock({ screenshot: capture }), BOX, 'line-test', testInfo);

    expect(mkdir).toHaveBeenCalledWith(outputDir, { recursive: true });
  });

  it('names the helper and the missing field when testInfo has no output directory', async () => {
    // `path.join` used to run unguarded, so a TestInfo without an `outputDir` failed with
    // V8's `The "path" argument must be of type string` — naming neither the helper nor
    // the field. The guard runs before anything is captured or attached.
    const capture = createScreenshotSpy(Buffer.from('png'));
    const { testInfo, attach } = createTestInfoMock();
    const page = createPageMock({ screenshot: capture });

    await expect(takeLineScreenshot(page, BOX, 'line-test', testInfo)).rejects.toThrow(
      new Error('takeLineScreenshot: testInfo.outputDir is required to capture and attach a screenshot')
    );
    expect(capture).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });

  it('rejects an empty output directory as readily as a missing one', async () => {
    const capture = createScreenshotSpy(Buffer.from('png'));
    const { testInfo, attach } = createTestInfoMock('');

    await expect(
      takeLineScreenshot(createPageMock({ screenshot: capture }), BOX, 'line-test', testInfo)
    ).rejects.toThrow(/testInfo\.outputDir is required/);
    expect(capture).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });

  it('propagates a screenshot failure and skips the attachment', async () => {
    const outputDir = await makeOutputDir('capture-failure');
    const capture = vi.fn().mockRejectedValue(new Error('capture failed'));
    const { testInfo, attach } = createTestInfoMock(outputDir);
    const page = createPageMock({ screenshot: capture });

    await expect(takeLineScreenshot(page, BOX, 'line-test', testInfo)).rejects.toThrow('capture failed');
    expect(attach).not.toHaveBeenCalled();
  });

  it('propagates an attachment failure', async () => {
    const outputDir = await makeOutputDir('attach-failure');
    const capture = createScreenshotSpy(Buffer.from('png'));
    const { testInfo, attach } = createTestInfoMock(outputDir);
    attach.mockRejectedValue(new Error('reporter offline'));

    await expect(
      takeLineScreenshot(createPageMock({ screenshot: capture }), BOX, 'line-test', testInfo)
    ).rejects.toThrow('reporter offline');
    expect(capture).toHaveBeenCalledTimes(1);
  });
});

/**
 * How far the painted line may reach outside its endpoints and centre line, in CSS pixels:
 * half the Draw tool's default pen width, which is `lineWidth: 10` (`src/tools/settings.ts`).
 * `drawLine` presses at one endpoint, drags to the other and releases, and the default pen
 * is a round-capped 10px stroke, so the paint is a 200x10 bar with semicircular ends. Every
 * containment below is stated against that bar, not against the bare path.
 */
const CAP_ALLOWANCE = 5;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The region `drawLine` actually paints, in the same space the rect passed in is in. */
function paintedLine(box: BoundingBox): Rect {
  return {
    left: box.x + Math.min(LINE_START_X, LINE_END_X) - CAP_ALLOWANCE,
    top: box.y + Math.min(LINE_START_Y, LINE_END_Y) - CAP_ALLOWANCE,
    right: box.x + Math.max(LINE_START_X, LINE_END_X) + CAP_ALLOWANCE,
    bottom: box.y + Math.max(LINE_START_Y, LINE_END_Y) + CAP_ALLOWANCE,
  };
}

function contains(clip: Required<ClipOptions>, rect: Rect): boolean {
  return (
    clip.x <= rect.left &&
    clip.y <= rect.top &&
    clip.x + clip.width >= rect.right &&
    clip.y + clip.height >= rect.bottom
  );
}

/**
 * `CANVAS_REDRAW_CLIP` and `DEFAULT_LINE_CLIP` describe the same thing - the region the
 * standard test line occupies - in the same space, and both are offsets added to the canvas
 * box (`canvasRedrawClip` and the default in `takeLineScreenshot`). Nothing related them:
 * each was pinned by value on its own, so moving one, or the line, could leave a clip that
 * no longer covers the stroke. A redraw wait on a clip that misses the line is not a red
 * failure, it is a pass that never looked, which is the shape of defect these two constants
 * exist to serve.
 *
 * The first case is the pure invariant in canvas-relative space. The next two run the two
 * helpers for a representative box, so the arithmetic that turns a constant into a page clip
 * is part of what is pinned, and not only the constant.
 */
describe('the line clips contain the standard test line', () => {
  afterEach(async () => {
    await cleanupTempDirs();
  });

  it('CANVAS_REDRAW_CLIP contains the line drawLine paints, in canvas-relative space', () => {
    const line = paintedLine({ x: 0, y: 0, width: 0, height: 0 });

    expect(contains(CANVAS_REDRAW_CLIP, line)).toBe(true);
  });

  it('DEFAULT_LINE_CLIP contains the same line, in canvas-relative space', () => {
    const line = paintedLine({ x: 0, y: 0, width: 0, height: 0 });

    expect(contains(DEFAULT_LINE_CLIP, line)).toBe(true);
  });

  it('the page-space clip canvasRedrawClip builds contains the page-space line', () => {
    // The box origin cancels between the two, which is why the canvas-relative case above is
    // the whole invariant; this one pins that the helper adds that same origin to both sides
    // rather than to one of them.
    const line = paintedLine(BOX);

    expect(contains(canvasRedrawClip(BOX), line)).toBe(true);
  });

  it('the page-space clip takeLineScreenshot captures contains the page-space line', async () => {
    const outputDir = await makeOutputDir('line-clip-containment');
    const capture = createScreenshotSpy(Buffer.from('png'));
    const { testInfo } = createTestInfoMock(outputDir);

    await takeLineScreenshot(createPageMock({ screenshot: capture }), BOX, 'line-clip', testInfo);

    const clip = capture.mock.calls[0][0].clip;
    expect(contains(clip, paintedLine(BOX))).toBe(true);
  });

  it('fails if either clip stops covering the line, which is what the three cases above exist to catch', () => {
    // The invariant is only as good as its ability to fail. Each clip has
    // `line.left - clip.x` pixels of margin on its leading edge, so shifting it right by
    // that margin plus one pixel must break containment: a later edit that slides a clip or
    // the line is caught rather than tolerated.
    const line = paintedLine({ x: 0, y: 0, width: 0, height: 0 });
    const shiftedOffLine = (clip: Required<ClipOptions>): Required<ClipOptions> => ({
      ...clip,
      x: line.left + 1,
    });

    expect(contains(shiftedOffLine(CANVAS_REDRAW_CLIP), line)).toBe(false);
    expect(contains(shiftedOffLine(DEFAULT_LINE_CLIP), line)).toBe(false);
    expect(CANVAS_REDRAW_CLIP.x).toBeLessThan(line.left);
    expect(DEFAULT_LINE_CLIP.x).toBeLessThan(line.left);
  });
});

/**
 * Bounds the modelled interpolation loop. This model transcribes the SERVER `Mouse.move` and
 * nothing above it, so it has no client validator to reject a `steps: Infinity` — the real
 * client refuses that one, but here the bound is simply never reached. The cap turns that into
 * a red assertion instead of a dead worker, and so into a usable before/after measurement.
 */
const MOVE_LIMIT = 64;

interface RecordedPointerEvent {
  type: 'mousemove' | 'mousedown' | 'mouseup';
  x: number;
  y: number;
}

interface PointerRecorder {
  mouse: Mouse;
  events: RecordedPointerEvent[];
}

/**
 * Playwright's server `Mouse.move`, transcribed: `const { steps = 1 } = options` followed by
 * `for (let i = 1; i <= steps; i++)`, emitting one event per iteration at the interpolated
 * point. A double that only records what was forwarded to it cannot tell `steps: 0` from no
 * `steps` at all - both read as "a move to the endpoint" - because the loop that decides how
 * many events the page receives runs inside Playwright. This model puts that loop in the test,
 * so a test can assert the gesture the page would actually see.
 */
function createPointerRecorder(): PointerRecorder {
  const events: RecordedPointerEvent[] = [];
  let x = 0;
  let y = 0;
  // The `Partial<T>` annotation is the real type check (it rejects keys the real interface
  // does not have); the `as T` cast below it is unchecked. Same idiom as the fixtures module.
  const double: Partial<Mouse> = {
    move: async (nextX, nextY, options = {}) => {
      const { steps = 1 } = options;
      const fromX = x;
      const fromY = y;
      x = nextX;
      y = nextY;
      // Truncates a `steps` that never reaches its bound, so an unfixed helper reports a red
      // test here rather than taking the whole run down. See `MOVE_LIMIT`.
      for (let i = 1; i <= steps && i <= MOVE_LIMIT; i++) {
        events.push({
          type: 'mousemove',
          x: fromX + (nextX - fromX) * (i / steps),
          y: fromY + (nextY - fromY) * (i / steps),
        });
      }
    },
    down: async () => {
      events.push({ type: 'mousedown', x, y });
    },
    up: async () => {
      events.push({ type: 'mouseup', x, y });
    },
  };
  return { mouse: double as Mouse, events };
}

describe('drawLine', () => {
  it('presses, drags between the box-relative endpoints and releases', async () => {
    const input = createMouseMock();
    const page = createPageMock({ mouse: input.mouse });
    const box: BoundingBox = { x: 100, y: 200, width: 50, height: 50 };

    await expect(drawLine(page, box, 10, 20, 30, 40)).resolves.toBeUndefined();

    expect(input.move.mock.calls).toEqual([
      [110, 220],
      [130, 240],
    ]);
    expect(input.down).toHaveBeenCalledTimes(1);
    expect(input.up).toHaveBeenCalledTimes(1);
    expect(input.down.mock.invocationCallOrder[0]).toBeGreaterThan(input.move.mock.invocationCallOrder[0]);
    expect(input.down.mock.invocationCallOrder[0]).toBeLessThan(input.move.mock.invocationCallOrder[1]);
    expect(input.up.mock.invocationCallOrder[0]).toBeGreaterThan(input.down.mock.invocationCallOrder[0]);
  });

  it('maps document endpoints through the contain fit before drawing', async () => {
    const input = createMouseMock();
    const box: BoundingBox = { x: 100, y: 200, width: 800, height: 800 };

    await drawLineFromDocument(createPageMock({ mouse: input.mouse }), box, 10, 20, 30, 40);

    expect(input.move.mock.calls).toEqual([
      [110, 320],
      [130, 340],
    ]);
  });

  it('uses the measured document size when mapping document endpoints', async () => {
    const input = createMouseMock();
    const box: BoundingBox = { x: 100, y: 200, width: 800, height: 600 };

    await drawLineFromDocument(
      createPageMock({ mouse: input.mouse }),
      box,
      10,
      20,
      30,
      40,
      {},
      { width: 400, height: 300 }
    );

    expect(input.move.mock.calls).toEqual([
      [120, 240],
      [160, 280],
    ]);
  });

  it('interpolates the drag when steps are requested', async () => {
    const input = createMouseMock();

    await drawLine(createPageMock({ mouse: input.mouse }), BOX, 0, 0, 100, 100, { steps: 5 });

    expect(input.move).toHaveBeenCalledTimes(2);
    expect(input.move.mock.calls[0]).toEqual([BOX.x, BOX.y]);
    expect(input.move.mock.calls[1]).toEqual([BOX.x + 100, BOX.y + 100, { steps: 5 }]);
  });

  it('draws the line for an explicit steps of zero rather than dispatching no move', async () => {
    // Playwright's server `Mouse.move` interpolates with `for (let i = 1; i <= steps; i++)`, so
    // a forwarded `steps: 0` iterates zero times: the page receives `mousedown` and `mouseup`
    // at the same point and the stroke has zero length. `0` means "do not interpolate", which
    // is one move, so the gesture a caller asks for with `steps: 0` is the gesture it gets
    // with no options at all. Asserting the recorded event sequence is what makes this a
    // statement about the line that gets drawn; asserting the forwarded argument would pass
    // just as happily against the no-op.
    const explicitZero = createPointerRecorder();
    await drawLine(createPageMock({ mouse: explicitZero.mouse }), BOX, 0, 0, 100, 100, { steps: 0 });

    const omitted = createPointerRecorder();
    await drawLine(createPageMock({ mouse: omitted.mouse }), BOX, 0, 0, 100, 100);

    expect(explicitZero.events).toEqual([
      { type: 'mousemove', x: BOX.x, y: BOX.y },
      { type: 'mousedown', x: BOX.x, y: BOX.y },
      { type: 'mousemove', x: BOX.x + 100, y: BOX.y + 100 },
      { type: 'mouseup', x: BOX.x + 100, y: BOX.y + 100 },
    ]);
    expect(explicitZero.events).toEqual(omitted.events);
  });

  it('forwards an explicit steps of zero as the single move Playwright defaults to', async () => {
    // The forwarding half of the contract above: `0` is normalised to 1 rather than dropped
    // and rather than passed through, so the call still carries an explicit `steps`.
    const input = createMouseMock();

    await drawLine(createPageMock({ mouse: input.mouse }), BOX, 0, 0, 100, 100, { steps: 0 });

    expect(input.move).toHaveBeenCalledTimes(2);
    expect(input.move.mock.calls[0]).toEqual([BOX.x, BOX.y]);
    expect(input.move.mock.calls[1]).toEqual([BOX.x + 100, BOX.y + 100, { steps: 1 }]);
  });

  it('draws the line for a negative steps instead of collapsing the stroke', async () => {
    // `-5` was truthy, so it reached Playwright before the normalisation existed and had the
    // same zero-length outcome as `0`: the loop bound is never reached. Latent - no call site
    // passes a negative count - but the clamp covers it, so it is pinned.
    const input = createPointerRecorder();

    await drawLine(createPageMock({ mouse: input.mouse }), BOX, 0, 0, 100, 100, { steps: -5 });

    expect(input.events.at(-1)).toEqual({ type: 'mouseup', x: BOX.x + 100, y: BOX.y + 100 });
    expect(input.events.filter((event) => event.type === 'mousemove')).toHaveLength(2);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a fractional count', 2.5],
  ])('falls back to the single move for %s, which Playwright rejects outright', async (_label, steps) => {
    // The client validator is `steps: expected integer, got float <value>`, so forwarding one
    // of these throws between `mousedown` and `mouseup` and leaves the button down. A count the
    // helper cannot use has to mean one move, not a broken gesture.
    const input = createPointerRecorder();

    await drawLine(createPageMock({ mouse: input.mouse }), BOX, 0, 0, 100, 100, { steps });

    expect(input.events.at(-1)).toEqual({ type: 'mouseup', x: BOX.x + 100, y: BOX.y + 100 });
    expect(input.events.filter((event) => event.type === 'mousemove')).toHaveLength(2);
  });

  it('passes negative box-relative coordinates through untouched', async () => {
    const input = createMouseMock();
    const box: BoundingBox = { x: -50, y: -20, width: 100, height: 100 };

    await expect(drawLine(createPageMock({ mouse: input.mouse }), box, -5, -5, 5, 5)).resolves.toBeUndefined();
    expect(input.move.mock.calls).toEqual([
      [-55, -25],
      [-45, -15],
    ]);
  });

  it('still performs the gesture for a zero-size box', async () => {
    const input = createMouseMock();
    const box: BoundingBox = { x: 0, y: 0, width: 0, height: 0 };

    await expect(drawLine(createPageMock({ mouse: input.mouse }), box, 10, 20, 30, 40)).resolves.toBeUndefined();
    expect(input.move.mock.calls).toEqual([
      [10, 20],
      [30, 40],
    ]);
    expect(input.down).toHaveBeenCalledTimes(1);
    expect(input.up).toHaveBeenCalledTimes(1);
  });

  it('propagates a mouse failure instead of releasing the button', async () => {
    const input = createMouseMock();
    input.move.mockRejectedValueOnce(new Error('mouse lost'));
    const page = createPageMock({ mouse: input.mouse });

    await expect(drawLine(page, BOX, 0, 0, 10, 10)).rejects.toThrow('mouse lost');
    expect(input.up).not.toHaveBeenCalled();
  });
});

/**
 * The one helper in this module that reads the page rather than deriving geometry from a box.
 *
 * The idiom matters more than the value. `createScrollModel` runs the helper's OWN page
 * function against a stubbed window whose scroll is behind getters, so a `scrollTo` issued by
 * one call is visible to the next; a double that just returned a canned object would pass the
 * same assertions whether the callback read `window.scrollX` or returned a constant. The
 * second case below is what distinguishes the two.
 *
 * Why it is read at the call site at all is the reason `clickToolButton` exists in the
 * production path: it scrolls the window by 440px in this build, so an offset read once is wrong
 * by a different amount before and after any tool click. `toolbar-helpers.ts:127`,
 * `cdp-helpers.ts:60` and `flyout-longpress-race.spec.ts:342,347` are the callers.
 */
describe('getPageScroll', () => {
  it('reports the window scroll its own page function reads', async () => {
    const scroll = createScrollModel({ initialScrollX: 7, initialScrollY: 440 });
    const page = createPageMock({ evaluate: scroll.evaluate });

    expect(await getPageScroll(page)).toEqual({ x: 7, y: 440 });
  });

  it('sees a scrollTo issued between two calls, so a cached read would be caught', async () => {
    const scroll = createScrollModel();
    const page = createPageMock({ evaluate: scroll.evaluate });

    expect(await getPageScroll(page)).toEqual({ x: 0, y: 0 });

    // The tool-switch scroll: the case that makes caching wrong rather than merely stale.
    await page.evaluate((y) => window.scrollTo(0, y), 440);

    expect(await getPageScroll(page)).toEqual({ x: 0, y: 440 });
  });

  it('reports both axes, because only the y axis is what the tool switch moves', async () => {
    // A one-axis result would satisfy the case above on a vertical scroll and hide a dropped
    // `scrollX` entirely, which is the axis a horizontal scrollbar or a Shift-wheel drag moves.
    const scroll = createScrollModel({ initialScrollX: 31 });
    const page = createPageMock({ evaluate: scroll.evaluate });

    expect(Object.keys(await getPageScroll(page)).sort()).toEqual(['x', 'y']);
    expect(await getPageScroll(page)).toEqual({ x: 31, y: 0 });
  });
});
