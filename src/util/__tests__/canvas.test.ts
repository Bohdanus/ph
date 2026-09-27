import { describe, expect, it, vi } from 'vitest';
import { resizeCanvas } from '../canvas.ts';

/**
 * Assigning `width`/`height` on a real canvas resets its drawing state, so the
 * conditional writes in `resizeCanvas` are the behaviour worth pinning. The spy
 * canvas records every write so the test can prove untouched dimensions are not
 * reassigned.
 */
function createSpyCanvas(width: number, height: number) {
  const size = { width, height };
  const widthWrites: number[] = [];
  const heightWrites: number[] = [];

  const canvas = {
    get width() {
      return size.width;
    },
    set width(value: number) {
      widthWrites.push(value);
      size.width = value;
    },
    get height() {
      return size.height;
    },
    set height(value: number) {
      heightWrites.push(value);
      size.height = value;
    },
  } as unknown as HTMLCanvasElement;

  return { canvas, widthWrites, heightWrites };
}

describe('resizeCanvas', () => {
  it('applies both dimensions when both differ', () => {
    const { canvas, widthWrites, heightWrites } = createSpyCanvas(100, 50);

    resizeCanvas(canvas, 200, 80);

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(80);
    expect(widthWrites).toEqual([200]);
    expect(heightWrites).toEqual([80]);
  });

  it('leaves an already matching dimension untouched', () => {
    const { canvas, widthWrites, heightWrites } = createSpyCanvas(100, 50);

    resizeCanvas(canvas, 100, 50);

    expect(widthWrites).toEqual([]);
    expect(heightWrites).toEqual([]);
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(50);
  });

  it('only writes the dimension that changed', () => {
    const { canvas, widthWrites, heightWrites } = createSpyCanvas(100, 50);

    resizeCanvas(canvas, 100, 300);

    expect(widthWrites).toEqual([]);
    expect(heightWrites).toEqual([300]);
  });

  it('works on a real HTMLCanvasElement', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10;
    canvas.height = 20;

    resizeCanvas(canvas, 300, 400);

    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(400);
  });

  it('applies a zero or negative target size instead of ignoring it', () => {
    const { canvas, widthWrites } = createSpyCanvas(100, 50);

    resizeCanvas(canvas, 0, -5);

    expect(widthWrites).toEqual([0]);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(-5);
  });

  it('writes each dimension at most once per call', () => {
    const { canvas, widthWrites, heightWrites } = createSpyCanvas(1, 1);
    const spy = vi.spyOn(canvas, 'width', 'set');

    resizeCanvas(canvas, 2, 2);

    expect(widthWrites).toEqual([2]);
    expect(heightWrites).toEqual([2]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
