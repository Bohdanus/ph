import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTextWidth, renderText, text, type TextToolArgs } from '../text.ts';
import { TEXT_PADDING } from '../../util/constants.ts';
import { createMockCanvasContext } from '../../__tests__/fixtures/canvas.ts';
import type { Ctx2D, RectXYSorted } from '../../contexts/general-types.ts';

type MockCtx = ReturnType<typeof createMockCanvasContext> & {
  fillText: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;
};

class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  readonly ctx: MockCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.ctx = createMockCanvasContext({
      canvas: this,
      fillText: vi.fn(),
      measureText: vi.fn((value: string) => ({ width: value.length * 10 })),
    }) as MockCtx;
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): MockCtx {
    return this.ctx;
  }
}

const createTextCtx = (measure = (value: string) => value.length * 10): MockCtx =>
  createMockCanvasContext({
    fillText: vi.fn(),
    measureText: vi.fn((value: string) => ({ width: measure(value) })),
  }) as MockCtx;

const rect: RectXYSorted = { x1: 0, y1: 0, x2: 200, y2: 120 };

const baseArgs: TextToolArgs = {
  text: 'Photoshop',
  align: 'left',
  bold: false,
  color: '#ff0000',
  fontFamily: 'Arial',
  fontSize: 20,
  italic: false,
  lineHeight: 1.1,
  rect,
  toolName: 'text',
};

describe('renderText', () => {
  it('fills the line at the padded left origin for left alignment', () => {
    const ctx = createTextCtx();

    renderText(ctx as unknown as Ctx2D, baseArgs);

    expect(ctx.fillStyle).toBe('#ff0000');
    expect(ctx.font).toBe('20px Arial');
    expect(ctx.textAlign).toBe('left');
    expect(ctx.textBaseline).toBe('top');
    expect(ctx.fillText).toHaveBeenCalledWith('Photoshop', TEXT_PADDING, TEXT_PADDING);
  });

  it('centres on the rect midpoint', () => {
    const ctx = createTextCtx();

    renderText(ctx as unknown as Ctx2D, { ...baseArgs, align: 'center' });

    expect(ctx.textAlign).toBe('center');
    expect(ctx.fillText).toHaveBeenCalledWith('Photoshop', 100, TEXT_PADDING);
  });

  it('right-aligns against the rect minus padding', () => {
    const ctx = createTextCtx();

    renderText(ctx as unknown as Ctx2D, { ...baseArgs, align: 'right' });

    expect(ctx.textAlign).toBe('right');
    expect(ctx.fillText).toHaveBeenCalledWith('Photoshop', 200 - TEXT_PADDING, TEXT_PADDING);
  });

  it('composes italic and bold into the font shorthand', () => {
    const ctx = createTextCtx();

    renderText(ctx as unknown as Ctx2D, { ...baseArgs, italic: true, bold: true });

    expect(ctx.font).toBe('italic bold 20px Arial');
  });

  it('renders only the bold variant when italic is off', () => {
    const ctx = createTextCtx();

    renderText(ctx as unknown as Ctx2D, { ...baseArgs, bold: true });

    expect(ctx.font).toBe('bold 20px Arial');
  });

  it('lays out each newline-separated line on its own baseline', () => {
    const ctx = createTextCtx();
    const { fontSize, lineHeight } = baseArgs;

    renderText(ctx as unknown as Ctx2D, { ...baseArgs, text: 'one\ntwo\nthree' });

    expect(ctx.fillText).toHaveBeenCalledTimes(3);
    expect(ctx.fillText).toHaveBeenNthCalledWith(1, 'one', TEXT_PADDING, TEXT_PADDING);
    expect(ctx.fillText).toHaveBeenNthCalledWith(2, 'two', TEXT_PADDING, TEXT_PADDING + fontSize * lineHeight);
    expect(ctx.fillText).toHaveBeenNthCalledWith(3, 'three', TEXT_PADDING, TEXT_PADDING + 2 * fontSize * lineHeight);
  });

  it('stacks lines on top of each other for a zero line height', () => {
    const ctx = createTextCtx();

    renderText(ctx as unknown as Ctx2D, { ...baseArgs, text: 'a\nb', lineHeight: 0 });

    expect(ctx.fillText).toHaveBeenNthCalledWith(1, 'a', TEXT_PADDING, TEXT_PADDING);
    expect(ctx.fillText).toHaveBeenNthCalledWith(2, 'b', TEXT_PADDING, TEXT_PADDING);
  });

  it('draws nothing for an empty string', () => {
    const ctx = createTextCtx();

    renderText(ctx as unknown as Ctx2D, { ...baseArgs, text: '' });

    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(ctx.fillStyle).toBe('');
  });

  it('draws nothing when the text is missing entirely', () => {
    const ctx = createTextCtx();
    renderText(ctx as unknown as Ctx2D, { ...baseArgs, text: undefined });

    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('draws nothing without a rect', () => {
    const ctx = createTextCtx();

    renderText(ctx as unknown as Ctx2D, { ...baseArgs, rect: null });

    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('draws nothing without a rect and with text', () => {
    const ctx = createTextCtx();
    renderText(ctx as unknown as Ctx2D, { ...baseArgs, rect: undefined });

    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('leaves x undefined for an unrecognized align value', () => {
    const ctx = createTextCtx();

    renderText(ctx as unknown as Ctx2D, { ...baseArgs, align: 'justify' as TextToolArgs['align'] });

    expect(ctx.fillText).toHaveBeenCalledWith('Photoshop', undefined, TEXT_PADDING);
  });

  it('fills at full opacity when the shared overlay was left at another tool alpha', () => {
    const ctx = createTextCtx();
    const alphaAtFill: number[] = [];
    vi.mocked(ctx.fillText).mockImplementation(() => {
      alphaAtFill.push(ctx.globalAlpha);
    });
    ctx.globalAlpha = 0.2;

    renderText(ctx as unknown as Ctx2D, baseArgs);

    expect(alphaAtFill).toEqual([1]);
    expect(ctx.globalAlpha).toBe(1);
  });

  it('does not resurrect a leaked alpha for a draft with nothing to draw', () => {
    const ctx = createTextCtx();
    ctx.globalAlpha = 0.2;

    renderText(ctx as unknown as Ctx2D, { ...baseArgs, text: '' });

    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(ctx.globalAlpha).toBe(0.2);
  });
});

describe('getTextWidth', () => {
  it('returns the widest measured line', () => {
    const ctx = createTextCtx((value) => value.length * 10);

    const width = getTextWidth(ctx as unknown as CanvasRenderingContext2D, { ...baseArgs, text: 'a\nlongest\nmid' });

    expect(width).toBe(70);
  });

  it('measures a single line', () => {
    const ctx = createTextCtx((value) => value.length * 10);

    expect(getTextWidth(ctx as unknown as CanvasRenderingContext2D, { ...baseArgs, text: 'abc' })).toBe(30);
  });

  it('measures a single empty string when text is missing', () => {
    const ctx = createTextCtx(() => 123);
    expect(getTextWidth(ctx as unknown as CanvasRenderingContext2D, { ...baseArgs, text: undefined })).toBe(123);
    expect(ctx.measureText).toHaveBeenCalledWith('');
  });

  it('matches the font used by renderText so measured bounds stay valid', () => {
    const ctx = createTextCtx();

    getTextWidth(ctx as unknown as CanvasRenderingContext2D, {
      ...baseArgs,
      italic: true,
      bold: true,
      text: 'x',
    });

    expect(ctx.font).toBe('italic bold 20px Arial');
  });
});

describe('text processor', () => {
  beforeEach(() => {
    RecordingOffscreenCanvas.instances = [];
    vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allocates a creator canvas sized to the document and rasterizes the text', () => {
    const [result] = text({ size: { width: 300, height: 150 } })(baseArgs);

    const canvas = RecordingOffscreenCanvas.instances.at(-1)!;
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(150);
    expect(canvas.ctx.fillText).toHaveBeenCalledWith('Photoshop', TEXT_PADDING, TEXT_PADDING);
    expect(result).toBe(canvas as unknown as OffscreenCanvas);
  });

  it('returns a full-size canvas even when the default empty text renders nothing', () => {
    const [result] = text({ size: { width: 300, height: 150 } })({
      ...baseArgs,
      text: '',
      rect: null,
    });

    const canvas = RecordingOffscreenCanvas.instances.at(-1)!;
    expect(canvas.ctx.fillText).not.toHaveBeenCalled();
    expect(canvas.width).toBe(300);
    expect(result).toBeTruthy();
  });

  it('clamps a degenerate size to at least one pixel per axis', () => {
    const [result] = text({ size: { width: 0, height: 0 } })(baseArgs);

    const canvas = RecordingOffscreenCanvas.instances.at(-1)!;
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(result).toBeTruthy();
  });

  it('documents the current cost: a fresh full-document canvas and a fresh fillText pass on every replay (src/tools/text.ts:66-69)', () => {
    const params = { size: { width: 40, height: 20 } };
    const processor = text(params);

    const first = processor(baseArgs);
    const second = processor(baseArgs);

    // Each replay allocates a fresh canvas and re-runs the font rasterization, so an
    // N-step undo history re-renders the same glyphs N times. There is no vector-durable
    // source to re-materialize from, so this cost is structural, not a caching oversight.
    expect(RecordingOffscreenCanvas.instances).toHaveLength(2);
    expect(first[0]).not.toBe(second[0]);
    expect((first[0] as unknown as RecordingOffscreenCanvas).ctx.fillText).toHaveBeenCalledTimes(1);
    expect((second[0] as unknown as RecordingOffscreenCanvas).ctx.fillText).toHaveBeenCalledTimes(1);
  });

  it.fails('replays text from a durable vector source without re-rasterizing (src/tools/text.ts:63-72)', () => {
    const params = { size: { width: 40, height: 20 } };
    const processor = text(params);

    const first = processor(baseArgs);
    const second = processor(baseArgs);

    // Desired: an identical replay reuses the already-rasterized source instead of
    // allocating a second full-document OffscreenCanvas and re-running renderText.
    expect(RecordingOffscreenCanvas.instances).toHaveLength(1);
    expect(first[0]).toBe(second[0]);
  });
});
