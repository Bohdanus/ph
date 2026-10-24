import { afterEach, describe, expect, it, vi } from 'vitest';

import { drawLayer, drawLayerSource, drawLayersToCanvas } from '../layer-renderer.ts';
import type { Pos } from '../general-types.ts';
import type { Layer } from '../layer-types.ts';
import type { ToolArgs } from '../tool-types.ts';
import { toolProcessors } from '../../tools/toolProcessors.ts';
import { createMockCanvas } from '../../__tests__/fixtures/canvas.ts';
import { makeMockCtx } from '../../__tests__/canvas-mock.ts';

type PixelTransform = { a: number; b: number; c: number; d: number; e: number; f: number };

class PixelSurface {
  readonly pixels: Uint8ClampedArray;
  readonly context: PixelContext;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.context = new PixelContext(this);
  }

  getContext() {
    return this.context;
  }
}

class PixelContext {
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
  filter = 'none';
  imageSmoothingEnabled = true;
  readonly canvas: PixelSurface;
  private transform: PixelTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  private readonly stack: Array<{
    alpha: number;
    composite: GlobalCompositeOperation;
    fill: string;
    stroke: string;
    lineWidth: number;
    transform: PixelTransform;
  }> = [];

  constructor(canvas: PixelSurface) {
    this.canvas = canvas;
  }

  getTransform() {
    return this.transform as DOMMatrix;
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.transform = { a, b, c, d, e, f };
  }

  save() {
    this.stack.push({
      alpha: this.globalAlpha,
      composite: this.globalCompositeOperation,
      fill: this.fillStyle,
      stroke: this.strokeStyle,
      lineWidth: this.lineWidth,
      transform: { ...this.transform },
    });
  }

  restore() {
    const state = this.stack.pop();
    if (!state) return;
    this.globalAlpha = state.alpha;
    this.globalCompositeOperation = state.composite;
    this.fillStyle = state.fill;
    this.strokeStyle = state.stroke;
    this.lineWidth = state.lineWidth;
    this.transform = state.transform;
  }

  setLineDash() {}

  clearRect(x: number, y: number, width: number, height: number) {
    const left = Math.max(0, Math.floor(x));
    const top = Math.max(0, Math.floor(y));
    const right = Math.min(this.canvas.width, Math.ceil(x + width));
    const bottom = Math.min(this.canvas.height, Math.ceil(y + height));
    for (let py = top; py < bottom; py += 1) {
      const start = (py * this.canvas.width + left) * 4;
      const end = (py * this.canvas.width + right) * 4;
      this.canvas.pixels.fill(0, start, end);
    }
  }

  getImageData(x: number, y: number, width: number, height: number) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let py = 0; py < height; py += 1) {
      for (let px = 0; px < width; px += 1) {
        const sourceX = x + px;
        const sourceY = y + py;
        if (sourceX < 0 || sourceY < 0 || sourceX >= this.canvas.width || sourceY >= this.canvas.height) continue;
        const source = (sourceY * this.canvas.width + sourceX) * 4;
        const target = (py * width + px) * 4;
        data.set(this.canvas.pixels.subarray(source, source + 4), target);
      }
    }
    return { data } as ImageData;
  }

  fillRect(x: number, y: number, width: number, height: number) {
    this.paintRect(x, y, x + width, y + height, this.fillStyle);
  }

  strokeRect(x: number, y: number, width: number, height: number) {
    const half = this.lineWidth / 2;
    const outer = { left: x - half, top: y - half, right: x + width + half, bottom: y + height + half };
    const inner = { left: x + half, top: y + half, right: x + width - half, bottom: y + height - half };
    const scaleX = Math.hypot(this.transform.a, this.transform.b);
    const scaleY = Math.hypot(this.transform.c, this.transform.d);
    const left = Math.floor(outer.left * scaleX + this.transform.e);
    const top = Math.floor(outer.top * scaleY + this.transform.f);
    const right = Math.ceil(outer.right * scaleX + this.transform.e);
    const bottom = Math.ceil(outer.bottom * scaleY + this.transform.f);
    for (let py = top; py < bottom; py += 1) {
      for (let px = left; px < right; px += 1) {
        const userX = (px + 0.5 - this.transform.e) / scaleX;
        const userY = (py + 0.5 - this.transform.f) / scaleY;
        const inOuter = userX >= outer.left && userX < outer.right && userY >= outer.top && userY < outer.bottom;
        const inInner = userX >= inner.left && userX < inner.right && userY >= inner.top && userY < inner.bottom;
        if (inOuter && !inInner) this.compositePixel(px, py, this.strokeStyle);
      }
    }
  }

  drawImage(source: CanvasImageSource, x: number, y: number, width: number, height: number) {
    const sourceSurface = source as unknown as PixelSurface;
    for (let py = 0; py < height; py += 1) {
      for (let px = 0; px < width; px += 1) {
        const sourceX = Math.min(sourceSurface.width - 1, Math.floor(((px + 0.5) / width) * sourceSurface.width));
        const sourceY = Math.min(sourceSurface.height - 1, Math.floor(((py + 0.5) / height) * sourceSurface.height));
        const index = (sourceY * sourceSurface.width + sourceX) * 4;
        const color = `#${[0, 1, 2].map((channel) => sourceSurface.pixels[index + channel]!.toString(16).padStart(2, '0')).join('')}`;
        this.compositePixel(Math.floor(x + px), Math.floor(y + py), color, sourceSurface.pixels[index + 3]! / 255);
      }
    }
  }

  private paintRect(left: number, top: number, right: number, bottom: number, color: string) {
    const scaleX = Math.hypot(this.transform.a, this.transform.b);
    const scaleY = Math.hypot(this.transform.c, this.transform.d);
    const x0 = Math.floor(left * scaleX + this.transform.e);
    const y0 = Math.floor(top * scaleY + this.transform.f);
    const x1 = Math.ceil(right * scaleX + this.transform.e);
    const y1 = Math.ceil(bottom * scaleY + this.transform.f);
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const userX = (x + 0.5 - this.transform.e) / scaleX;
        const userY = (y + 0.5 - this.transform.f) / scaleY;
        if (userX >= left && userX < right && userY >= top && userY < bottom) this.compositePixel(x, y, color);
      }
    }
  }

  private compositePixel(x: number, y: number, color: string, sourceOpacity = 1) {
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return;
    const match = /^#([\da-f]{6})$/i.exec(color);
    if (!match) throw new Error(`Unsupported test pixel color ${color}`);
    const source = [0, 2, 4].map((offset) => Number.parseInt(match[1]!.slice(offset, offset + 2), 16));
    const index = (y * this.canvas.width + x) * 4;
    const sourceAlpha = sourceOpacity * this.globalAlpha;
    const destinationAlpha = this.canvas.pixels[index + 3]! / 255;
    const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
    for (let channel = 0; channel < 3; channel += 1) {
      const destination = this.canvas.pixels[index + channel]!;
      const blended =
        this.globalCompositeOperation === 'multiply' ? (source[channel]! * destination) / 255 : source[channel]!;
      const premultiplied =
        (1 - sourceAlpha) * destinationAlpha * destination +
        (1 - destinationAlpha) * sourceAlpha * source[channel]! +
        sourceAlpha * destinationAlpha * blended;
      this.canvas.pixels[index + channel] = outputAlpha > 0 ? premultiplied / outputAlpha : 0;
    }
    this.canvas.pixels[index + 3] = outputAlpha * 255;
  }
}

describe('drawLayerSource', () => {
  it('draws the retained vector source when its only operation is disabled', () => {
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor');
    const ctx = makeMockCtx();
    ctx.globalAlpha = 0.5;
    const layer: Layer = {
      id: 'shape',
      name: 'Shape',
      isBedrock: false,
      bitmap: null,
      tmpCanvas: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 0,
      pos: { x: 4, y: 6, width: 100, height: 50 },
      presentationBounds: null,
      operations: [
        {
          id: 'disabled-filter',
          kind: 'filter',
          enabled: false,
          args: { toolName: 'blur', radius: 4 },
        },
      ],
      source: {
        kind: 'tool',
        pos: { x: 4, y: 6, width: 100, height: 50 },
        args: {
          toolName: 'shape',
          figure: 'rectangle',
          alpha: 0.5,
          color: '#000000',
          backgroundColor: null,
          lineWidth: 2,
          start: { x: 10, y: 15 },
          end: { x: 80, y: 40 },
        },
      },
    };
    const resizedPosition = { x: 4, y: 6, width: 200, height: 100 };

    layer.tmpCanvas = { width: 100, height: 50 } as OffscreenCanvas;

    expect(drawLayerSource(ctx, layer, resizedPosition)).toBe(true);
    expect(processor).not.toHaveBeenCalled();
    expect(ctx.translate).not.toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 4, 6, 200, 100);
    const surface = vi.mocked(ctx.drawImage).mock.calls[0]![0] as OffscreenCanvas;
    const surfaceContext = surface.getContext('2d') as unknown as CanvasRenderingContext2D;
    expect(surfaceContext.strokeRect).toHaveBeenCalledWith(20, 30, 140, 50);
  });

  it('falls back to cached pixels when the retained vector source has zero-sized bounds', () => {
    const sourceCanvas = { width: 100, height: 50 } as OffscreenCanvas;
    const ctx = makeMockCtx();
    const layer: Layer = {
      id: 'invalid-source-bounds',
      name: 'Shape',
      isBedrock: false,
      bitmap: null,
      tmpCanvas: sourceCanvas,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 0,
      pos: { x: 4, y: 6, width: 100, height: 50 },
      presentationBounds: null,
      operations: [],
      source: {
        kind: 'tool',
        pos: { x: 4, y: 6, width: 0, height: 50 },
        args: {
          toolName: 'shape',
          figure: 'rectangle',
          alpha: 1,
          color: '#000000',
          backgroundColor: null,
          lineWidth: 2,
          start: { x: 0, y: 0 },
          end: { x: 100, y: 50 },
        },
      },
    };

    expect(drawLayerSource(ctx, layer)).toBe(true);
    expect(ctx.translate).not.toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledWith(sourceCanvas, 4, 6, 100, 50);
  });

  it.each([
    { label: 'missing start', geometry: { start: undefined } },
    { label: 'missing end', geometry: { end: undefined } },
    { label: 'NaN start coordinate', geometry: { start: { x: Number.NaN, y: 0 } } },
    { label: 'infinite end coordinate', geometry: { end: { x: 100, y: Number.POSITIVE_INFINITY } } },
  ])('falls back to populated cached pixels for $label geometry', ({ geometry }) => {
    const sourceCanvas = { width: 100, height: 50 } as OffscreenCanvas;
    const ctx = makeMockCtx();
    const position = { x: 4, y: 6, width: 100, height: 50 };
    const args = {
      toolName: 'shape',
      figure: 'rectangle',
      alpha: 1,
      color: '#000000',
      backgroundColor: null,
      lineWidth: 2,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 50 },
      ...geometry,
    } as unknown as ToolArgs;
    const layer: Layer = {
      id: 'invalid-geometry',
      name: 'Shape',
      isBedrock: false,
      bitmap: null,
      tmpCanvas: sourceCanvas,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 0,
      pos: position,
      presentationBounds: null,
      operations: [],
      source: { kind: 'tool', pos: position, args },
    };

    expect(drawLayerSource(ctx, layer)).toBe(true);
    expect(ctx.drawImage).toHaveBeenCalledExactlyOnceWith(sourceCanvas, 4, 6, 100, 50);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });

  it('uses a promoted bitmap cache when retained Shape geometry is invalid', () => {
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor');
    const ctx = makeMockCtx();
    const cache = { width: 100, height: 50 } as ImageBitmap;
    const position = { x: 4, y: 6, width: 100, height: 50 };
    const layer: Layer = {
      id: 'promoted-shape-cache',
      name: 'Shape',
      isBedrock: false,
      bitmap: cache,
      tmpCanvas: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 0,
      pos: position,
      presentationBounds: null,
      operations: [],
      source: {
        kind: 'tool',
        pos: position,
        args: {
          toolName: 'shape',
          figure: 'rectangle',
          alpha: 1,
          color: '#000000',
          backgroundColor: null,
          lineWidth: 2,
          start: undefined,
          end: { x: 100, y: 50 },
        } as unknown as ToolArgs,
      },
    };

    expect(drawLayerSource(ctx, layer)).toBe(true);
    expect(processor).not.toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledExactlyOnceWith(cache, 4, 6, 100, 50);
  });

  it('does not materialize invalid retained geometry when no raster cache exists', () => {
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor');
    const ctx = makeMockCtx();
    const position = { x: 4, y: 6, width: 100, height: 50 };
    const layer: Layer = {
      id: 'invalid-shape-without-cache',
      name: 'Shape',
      isBedrock: false,
      bitmap: null,
      tmpCanvas: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 0,
      pos: position,
      presentationBounds: null,
      operations: [],
      source: {
        kind: 'tool',
        pos: position,
        args: {
          toolName: 'shape',
          figure: 'rectangle',
          alpha: 1,
          color: '#000000',
          backgroundColor: null,
          lineWidth: 2,
          start: { x: Number.NaN, y: 0 },
          end: { x: 100, y: 50 },
        } as unknown as ToolArgs,
      },
    };

    expect(drawLayerSource(ctx, layer)).toBe(false);
    expect(processor).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('falls back to cached pixels and releases the surface when optional shape drawing throws', () => {
    const failure = new Error('offscreen shape failure');
    const surfaces: PixelSurface[] = [];
    class ThrowingSurface extends PixelSurface {
      constructor(width: number, height: number) {
        super(width, height);
        surfaces.push(this);
      }

      override getContext() {
        vi.spyOn(this.context, 'strokeRect').mockImplementation(() => {
          throw failure;
        });
        return this.context;
      }
    }
    vi.stubGlobal('OffscreenCanvas', ThrowingSurface);

    try {
      const cache = { width: 100, height: 50 } as OffscreenCanvas;
      const ctx = makeMockCtx();
      const position = { x: 4, y: 6, width: 100, height: 50 };
      const layer: Layer = {
        id: 'shape-with-paint-cache',
        name: 'Shape',
        isBedrock: false,
        bitmap: null,
        tmpCanvas: cache,
        visible: true,
        opacity: 1,
        locked: false,
        blendMode: 'source-over',
        order: 0,
        pos: position,
        presentationBounds: null,
        operations: [],
        source: {
          kind: 'tool',
          pos: position,
          args: {
            toolName: 'shape',
            figure: 'rectangle',
            alpha: 1,
            color: '#000000',
            backgroundColor: null,
            lineWidth: 2,
            start: { x: 0, y: 0 },
            end: { x: 100, y: 50 },
          },
        },
      };

      expect(drawLayerSource(ctx, layer)).toBe(true);
      expect(ctx.drawImage).toHaveBeenCalledExactlyOnceWith(cache, 4, 6, 100, 50);
      expect(surfaces).toHaveLength(1);
      expect(surfaces[0]!.width).toBe(0);
      expect(surfaces[0]!.height).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not swallow an error from the canonical cached draw after the fast path fails', () => {
    const failure = new Error('cached draw failure');
    vi.stubGlobal('OffscreenCanvas', PixelSurface);

    try {
      const cache = { width: 100, height: 50 } as OffscreenCanvas;
      const ctx = makeMockCtx();
      vi.mocked(ctx.drawImage).mockImplementation(() => {
        throw failure;
      });
      const position = { x: 4, y: 6, width: 100, height: 50 };
      const layer: Layer = {
        id: 'shape-with-paint-cache',
        name: 'Shape',
        isBedrock: false,
        bitmap: null,
        tmpCanvas: cache,
        visible: true,
        opacity: 1,
        locked: false,
        blendMode: 'source-over',
        order: 0,
        pos: position,
        presentationBounds: null,
        operations: [],
        source: {
          kind: 'tool',
          pos: position,
          args: {
            toolName: 'shape',
            figure: 'rectangle',
            alpha: 1,
            color: '#000000',
            backgroundColor: null,
            lineWidth: 2,
            start: { x: 0, y: 0 },
            end: { x: 100, y: 50 },
          },
        },
      };

      expect(() => drawLayerSource(ctx, layer)).toThrow(failure);
      expect(ctx.drawImage).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rematerializes retained text at the layer bounds instead of scaling its committed bitmap', () => {
    const sourceCanvas = { width: 200, height: 100 } as OffscreenCanvas;
    const apply = vi.fn((): [OffscreenCanvas] => [sourceCanvas]);
    const processor = vi.spyOn(toolProcessors.text, 'imageProcessor').mockReturnValue(apply);
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
      filter: 'none',
    } as unknown as CanvasRenderingContext2D;
    const sourcePosition = { x: 4, y: 6, width: 100, height: 50 };
    const resizedPosition = { x: 4, y: 6, width: 200, height: 100 };
    const layer: Layer = {
      id: 'text',
      name: 'Text',
      isBedrock: false,
      bitmap: { width: 100, height: 50 } as ImageBitmap,
      tmpCanvas: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 1,
      pos: sourcePosition,
      presentationBounds: null,
      operations: [],
      source: {
        kind: 'tool',
        pos: sourcePosition,
        args: {
          toolName: 'text',
          align: 'left',
          bold: false,
          color: '#000000',
          fontFamily: 'Arial',
          fontSize: 24,
          italic: false,
          lineHeight: 1.2,
          rect: { x1: 10, y1: 5, x2: 90, y2: 35 },
        },
      },
    };

    expect(drawLayerSource(ctx, layer, resizedPosition)).toBe(true);
    expect(processor).toHaveBeenCalledWith({ size: resizedPosition });
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        fontSize: 48,
        rect: { x1: 20, y1: 10, x2: 180, y2: 70 },
      })
    );
    expect(ctx.drawImage).toHaveBeenCalledWith(sourceCanvas, 4, 6, 200, 100);
  });

  it('renders a committed shape at its preview bounds through a non-zero frame', () => {
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor');
    const ctx = makeMockCtx();
    const documentPosition = { x: 58, y: 78, width: 64, height: 64 };
    const documentFrame = { x: 30, y: 40, width: 800, height: 600 };
    const layer: Layer = {
      id: 'shape',
      name: 'Shape',
      isBedrock: false,
      bitmap: null,
      tmpCanvas: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 0,
      pos: documentPosition,
      presentationBounds: null,
      operations: [],
      source: {
        kind: 'tool',
        pos: documentPosition,
        args: {
          toolName: 'shape',
          figure: 'rectangle',
          alpha: 1,
          color: '#000000',
          backgroundColor: null,
          lineWidth: 2,
          start: { x: 2, y: 2 },
          end: { x: 62, y: 62 },
        },
      },
    };

    expect(drawLayerSource(ctx, layer, documentPosition, documentFrame)).toBe(true);
    expect(processor).not.toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 28, 38, 64, 64);
    const surface = vi.mocked(ctx.drawImage).mock.calls[0]![0] as OffscreenCanvas;
    const surfaceContext = surface.getContext('2d') as unknown as CanvasRenderingContext2D;
    expect(surfaceContext.strokeRect).toHaveBeenCalledWith(2, 2, 60, 60);
  });

  it('maps world layer positions into a non-zero document frame', () => {
    const bitmap = { width: 20, height: 10 } as ImageBitmap;
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
      filter: 'none',
    } as unknown as CanvasRenderingContext2D;
    const layer = {
      id: 'image',
      name: 'Image',
      isBedrock: false,
      bitmap,
      tmpCanvas: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over' as const,
      order: 0,
      pos: { x: 45, y: 38, width: 20, height: 10 },
      presentationBounds: null,
      operations: [],
      source: { kind: 'image' as const, bitmap, name: 'Image', pos: { x: 45, y: 38, width: 20, height: 10 } },
    } satisfies Layer;

    expect(drawLayerSource(ctx, layer, layer.pos, { x: 40, y: 30, width: 80, height: 60 })).toBe(true);
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 5, 8, 20, 10);
  });

  it('uses a baked tmpCanvas without rematerializing or reapplying operations', () => {
    const bitmap = { width: 30, height: 40 } as ImageBitmap;
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
      filter: 'none',
    } as unknown as CanvasRenderingContext2D;
    const layer = {
      id: 'baked',
      name: 'Baked',
      isBedrock: false,
      bitmap: null,
      tmpCanvas: bitmap,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over' as const,
      order: 0,
      pos: { x: 0, y: 0, width: 10, height: 10 },
      presentationBounds: { x: 10, y: 20, width: 30, height: 40 },
      operations: [{ id: 'filter', args: { toolName: 'blur', radius: 2 }, enabled: true }],
    } satisfies Layer;

    expect(drawLayerSource(ctx, layer)).toBe(true);
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 10, 20, 30, 40);
  });
});

describe('drawLayer', () => {
  const bitmap = { width: 64, height: 64, close: vi.fn() } as unknown as ImageBitmap;
  const documentFrame = { x: 0, y: 0, width: 100, height: 100 };

  function makeImageLayer(overrides: Partial<Layer> = {}): Layer {
    return {
      id: 'layer-1',
      name: 'Image',
      isBedrock: false,
      tmpCanvas: null,
      bitmap,
      visible: true,
      opacity: 0.8,
      locked: false,
      blendMode: 'source-over',
      order: 0,
      pos: { x: 10, y: 12, width: 64, height: 64 },
      presentationBounds: null,
      operations: [],
      source: { kind: 'image' as const, bitmap, pos: { x: 10, y: 12, width: 64, height: 64 } },
      ...overrides,
    };
  }

  function makeStatefulCtx(
    initial: { alpha: number; composite: GlobalCompositeOperation } = { alpha: 0.62, composite: 'screen' }
  ) {
    let alpha = initial.alpha;
    let composite = initial.composite;
    const drawnStates: Array<{ alpha: number; composite: GlobalCompositeOperation }> = [];
    const snapshots: Array<{ alpha: number; composite: GlobalCompositeOperation }> = [];
    const ctx = makeMockCtx();

    Object.defineProperties(ctx, {
      globalAlpha: { get: () => alpha, set: (value: number) => (alpha = value) },
      globalCompositeOperation: {
        get: () => composite,
        set: (value: GlobalCompositeOperation) => (composite = value),
      },
    });
    ctx.save = vi.fn(() => snapshots.push({ alpha, composite }));
    ctx.restore = vi.fn(() => {
      const snapshot = snapshots.pop();
      if (snapshot) {
        alpha = snapshot.alpha;
        composite = snapshot.composite;
      }
    });
    ctx.drawImage = vi.fn(() => drawnStates.push({ alpha, composite }));

    return { ctx, drawnStates };
  }

  it('sets globalAlpha to the layer opacity before drawing', () => {
    const { ctx, drawnStates } = makeStatefulCtx();
    drawLayer(ctx, makeImageLayer({ opacity: 0.37 }));
    expect(drawnStates[0]?.alpha).toBe(0.37);
  });

  it('sets globalCompositeOperation to the layer blendMode before drawing', () => {
    const { ctx, drawnStates } = makeStatefulCtx();
    drawLayer(ctx, makeImageLayer({ blendMode: 'multiply' }));
    expect(drawnStates[0]?.composite).toBe('multiply');
  });

  it('sets opacity and blend mode before drawImage and restores both afterward', () => {
    const { ctx, drawnStates } = makeStatefulCtx();

    drawLayer(ctx, makeImageLayer({ opacity: 0.37, blendMode: 'multiply' }));

    expect(drawnStates).toEqual([{ alpha: 0.37, composite: 'multiply' }]);
    expect(ctx.globalAlpha).toBe(0.62);
    expect(ctx.globalCompositeOperation).toBe('screen');
  });

  it('composites overlapping fill and stroke once like the cached source under opacity and blend mode', () => {
    vi.stubGlobal('OffscreenCanvas', PixelSurface);

    try {
      const render = (toolMode: 'shape' | 'pixels') => {
        const surface = new PixelSurface(10, 10);
        surface.context.fillStyle = '#f0a050';
        surface.context.fillRect(0, 0, 10, 10);
        const pos = { x: 1, y: 1, width: 8, height: 8 };
        const layer: Layer = {
          id: 'overlap',
          name: 'Overlap',
          isBedrock: false,
          bitmap: null,
          tmpCanvas: null,
          visible: true,
          opacity: 0.5,
          locked: false,
          blendMode: 'multiply',
          order: 0,
          pos,
          presentationBounds: null,
          operations: [],
          source: {
            kind: 'tool',
            pos,
            args: {
              toolName: 'shape',
              toolMode,
              figure: 'rectangle',
              alpha: 1,
              color: '#0000ff',
              backgroundColor: '#ff0000',
              hasFill: true,
              lineWidth: 2,
              start: { x: 2, y: 2 },
              end: { x: 6, y: 6 },
            },
          },
        };

        expect(drawLayer(surface.context as unknown as CanvasRenderingContext2D, layer)).toBe(true);
        return surface;
      };

      const isolated = render('shape');
      const cached = render('pixels');
      const pixelAt = (surface: PixelSurface, x: number, y: number) => {
        const index = (y * surface.width + x) * 4;
        return Array.from(surface.pixels.slice(index, index + 4));
      };

      expect(Array.from(isolated.pixels)).toEqual(Array.from(cached.pixels));
      expect(pixelAt(isolated, 3, 4)).toEqual([120, 80, 80, 255]);
      expect(pixelAt(isolated, 5, 5)).toEqual([240, 80, 40, 255]);
      expect(pixelAt(isolated, 0, 0)).toEqual([240, 160, 80, 255]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('saves and restores the context around the draw', () => {
    const { ctx } = makeStatefulCtx();
    drawLayer(ctx, makeImageLayer());
    expect(ctx.save).toHaveBeenCalledTimes(2);
    expect(ctx.restore).toHaveBeenCalledTimes(2);
  });

  it('returns true for a layer with a bitmap', () => {
    const ctx = makeMockCtx();
    expect(drawLayer(ctx, makeImageLayer())).toBe(true);
  });

  it('delegates drawing with the layer position', () => {
    const ctx = makeMockCtx();
    drawLayer(ctx, makeImageLayer({ opacity: 1 }), documentFrame);
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 10, 12, 64, 64);
  });

  it('draws invisible layers with 0 alpha rather than skipping them', () => {
    const { ctx, drawnStates } = makeStatefulCtx();
    const result = drawLayer(ctx, makeImageLayer({ opacity: 0 }));
    expect(drawnStates[0]?.alpha).toBe(0);
    expect(result).toBe(true);
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 10, 12, 64, 64);
  });
});

describe('drawLayersToCanvas vector staging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createShapeLayer(pos: Pos): Layer {
    return {
      id: 'shape',
      name: 'Shape',
      isBedrock: false,
      bitmap: null,
      tmpCanvas: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 0,
      pos,
      presentationBounds: null,
      operations: [],
      source: {
        kind: 'tool',
        pos: { ...pos },
        args: {
          toolName: 'shape',
          figure: 'rectangle',
          alpha: 1,
          color: '#000000',
          backgroundColor: null,
          lineWidth: 2,
          start: { x: 0, y: 0 },
          end: { x: pos.width, y: pos.height },
        },
      },
    };
  }

  function renderSourceOnlyBitmap(layer: Layer): PixelSurface {
    const { width, height } = layer.pos;
    const rendered = new PixelSurface(width, height);
    expect(drawLayerSource(rendered.context as unknown as CanvasRenderingContext2D, layer, layer.pos)).toBe(true);
    const bitmap = new PixelSurface(width, height);
    bitmap.pixels.set(rendered.pixels);
    return bitmap;
  }

  it('draws the retained vector source directly on the staged display canvas', () => {
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor');
    const staging = createMockCanvas();
    const target = createMockCanvas();
    vi.spyOn(document, 'createElement').mockReturnValue(staging);
    const layer = createShapeLayer({ x: 4, y: 6, width: 100, height: 50 });

    expect(drawLayersToCanvas(target, [layer], { x: 0, y: 0, width: 300, height: 150 })).toBe(true);

    expect(processor).not.toHaveBeenCalled();
    const stagingContext = staging.getContext('2d')!;
    expect(stagingContext.drawImage).toHaveBeenCalledTimes(1);
    expect(stagingContext.drawImage).toHaveBeenCalledWith(expect.anything(), 4, 6, 100, 50);
    const surface = vi.mocked(stagingContext.drawImage).mock.calls[0]![0] as OffscreenCanvas;
    const surfaceContext = surface.getContext('2d') as unknown as CanvasRenderingContext2D;
    expect(surfaceContext.strokeRect).toHaveBeenCalledWith(0, 0, 100, 50);
    const targetContext = target.getContext('2d')!;
    expect(targetContext.clearRect).toHaveBeenCalledWith(0, 0, 300, 150);
    expect(targetContext.drawImage).toHaveBeenCalledWith(staging, 0, 0);
  });

  it('uses the tmpCanvas raster for a retained Shape during its live preview', () => {
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor');
    const staging = createMockCanvas();
    const target = createMockCanvas();
    vi.spyOn(document, 'createElement').mockReturnValue(staging);
    const layer = createShapeLayer({ x: 4, y: 6, width: 100, height: 50 });
    const rasterPreview = { width: 100, height: 50 } as OffscreenCanvas;
    layer.tmpCanvas = rasterPreview;

    expect(drawLayersToCanvas(target, [layer], { x: 0, y: 0, width: 300, height: 150 }, new Set([layer.id]))).toBe(
      true
    );

    expect(processor).not.toHaveBeenCalled();
    expect(staging.getContext('2d')!.drawImage).toHaveBeenCalledExactlyOnceWith(rasterPreview, 4, 6, 100, 50);
  });

  it('uses the promoted bitmap cache for a retained Shape after commit', () => {
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor');
    const staging = createMockCanvas();
    const target = createMockCanvas();
    vi.spyOn(document, 'createElement').mockReturnValue(staging);
    const layer = createShapeLayer({ x: 4, y: 6, width: 100, height: 50 });
    const promotedBitmap = { width: 100, height: 50 } as ImageBitmap;
    layer.bitmap = promotedBitmap;

    expect(drawLayersToCanvas(target, [layer], { x: 0, y: 0, width: 300, height: 150 })).toBe(true);

    expect(processor).not.toHaveBeenCalled();
    expect(staging.getContext('2d')!.drawImage).toHaveBeenCalledExactlyOnceWith(promotedBitmap, 4, 6, 100, 50);
  });

  it('uses vector rendering when a promoted bitmap matches the retained shape across partial edge tiles', () => {
    vi.stubGlobal('OffscreenCanvas', PixelSurface);
    try {
      const pos = { x: 0, y: 0, width: 260, height: 259 };
      const layer = createShapeLayer(pos);
      const bitmap = renderSourceOnlyBitmap(layer);
      layer.bitmap = bitmap as unknown as ImageBitmap;
      const target = new PixelSurface(pos.width, pos.height);
      const drawImage = vi.spyOn(target.context, 'drawImage');

      expect(drawLayerSource(target.context as unknown as CanvasRenderingContext2D, layer, pos)).toBe(true);

      expect(drawImage).toHaveBeenCalledTimes(1);
      expect(drawImage.mock.calls[0]![0]).not.toBe(bitmap);
      expect(target.pixels).toEqual(bitmap.pixels);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 15_000);

  it('keeps the promoted bitmap when it differs from the retained shape by one pixel', () => {
    vi.stubGlobal('OffscreenCanvas', PixelSurface);
    try {
      const pos = { x: 0, y: 0, width: 20, height: 18 };
      const layer = createShapeLayer(pos);
      const bitmap = renderSourceOnlyBitmap(layer);
      bitmap.pixels[0] = bitmap.pixels[0] === 255 ? 254 : 255;
      layer.bitmap = bitmap as unknown as ImageBitmap;
      const target = new PixelSurface(pos.width, pos.height);
      const drawImage = vi.spyOn(target.context, 'drawImage');

      expect(drawLayerSource(target.context as unknown as CanvasRenderingContext2D, layer, pos)).toBe(true);

      expect(drawImage).toHaveBeenCalledExactlyOnceWith(bitmap, 0, 0, pos.width, pos.height);
      expect(target.pixels).toEqual(bitmap.pixels);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rechecks mutable bitmap pixels instead of reusing a stale source comparison', () => {
    vi.stubGlobal('OffscreenCanvas', PixelSurface);
    try {
      const pos = { x: 0, y: 0, width: 20, height: 18 };
      const layer = createShapeLayer(pos);
      const bitmap = renderSourceOnlyBitmap(layer);
      layer.bitmap = bitmap as unknown as ImageBitmap;

      const firstTarget = new PixelSurface(pos.width, pos.height);
      expect(drawLayerSource(firstTarget.context as unknown as CanvasRenderingContext2D, layer, pos)).toBe(true);
      expect(firstTarget.pixels).toEqual(bitmap.pixels);

      bitmap.pixels[0] = bitmap.pixels[0] === 255 ? 254 : 255;
      const secondTarget = new PixelSurface(pos.width, pos.height);
      const drawImage = vi.spyOn(secondTarget.context, 'drawImage');

      expect(drawLayerSource(secondTarget.context as unknown as CanvasRenderingContext2D, layer, pos)).toBe(true);

      expect(drawImage).toHaveBeenCalledExactlyOnceWith(bitmap, 0, 0, pos.width, pos.height);
      expect(secondTarget.pixels).toEqual(bitmap.pixels);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the cached raster when source comparison would allocate an oversized surface', () => {
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor');
    const ctx = makeMockCtx();
    const layer = createShapeLayer({ x: 4, y: 6, width: 5000, height: 5000 });
    const largeBitmap = { width: 5000, height: 5000 } as ImageBitmap;
    layer.bitmap = largeBitmap;

    expect(drawLayerSource(ctx, layer, layer.pos)).toBe(true);

    expect(processor).not.toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledWith(largeBitmap, 4, 6, 5000, 5000);
  });

  it('skips invalid uncached Shape geometry without suppressing later layers', () => {
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor');
    const staging = createMockCanvas();
    const target = createMockCanvas();
    vi.spyOn(document, 'createElement').mockReturnValue(staging);
    const invalid = createShapeLayer({ x: 4, y: 6, width: 100, height: 50 });
    const source = invalid.source;
    if (source?.kind !== 'tool') throw new Error('Expected a tool source');
    invalid.source = {
      ...source,
      args: { ...source.args, start: undefined } as unknown as ToolArgs,
    };
    const healthyBitmap = { width: 20, height: 10 } as ImageBitmap;
    const healthy: Layer = {
      id: 'healthy',
      name: 'Healthy',
      isBedrock: false,
      bitmap: healthyBitmap,
      tmpCanvas: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 1,
      pos: { x: 8, y: 10, width: 20, height: 10 },
      presentationBounds: null,
      operations: [],
    };

    expect(drawLayersToCanvas(target, [invalid, healthy], { x: 0, y: 0, width: 300, height: 150 })).toBe(true);

    expect(processor).not.toHaveBeenCalled();
    expect(staging.getContext('2d')!.drawImage).toHaveBeenCalledExactlyOnceWith(healthyBitmap, 8, 10, 20, 10);
  });

  it('draws a vector source even when its cached creation bitmap is empty', () => {
    const emptyCanvas = { width: 0, height: 0 } as OffscreenCanvas;
    const processor = vi.spyOn(toolProcessors.shape, 'imageProcessor');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const staging = createMockCanvas();
    const target = createMockCanvas();
    vi.spyOn(document, 'createElement').mockReturnValue(staging);
    const shape = createShapeLayer({ x: 4, y: 6, width: 100, height: 50 });
    shape.tmpCanvas = emptyCanvas;
    const bitmap = { width: 20, height: 10, close: vi.fn() } as unknown as ImageBitmap;
    const image: Layer = {
      id: 'image',
      name: 'Image',
      isBedrock: false,
      bitmap,
      tmpCanvas: null,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 1,
      pos: { x: 8, y: 10, width: 20, height: 10 },
      presentationBounds: null,
      operations: [],
    };

    expect(
      drawLayersToCanvas(target, [shape, image], {
        x: 0,
        y: 0,
        width: 300,
        height: 150,
      })
    ).toBe(true);

    expect(processor).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalledWith('skipped layer without bitmap', 'shape');
    const stagingContext = staging.getContext('2d')!;
    expect(stagingContext.drawImage).toHaveBeenCalledTimes(2);
    expect(stagingContext.drawImage).toHaveBeenNthCalledWith(1, expect.anything(), 4, 6, 100, 50);
    expect(stagingContext.drawImage).toHaveBeenCalledWith(bitmap, 8, 10, 20, 10);
    expect(target.getContext('2d')!.drawImage).toHaveBeenCalledWith(staging, 0, 0);
  });
});
