import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyRectToClipboard, readImageFromClipboard } from '../clipboard.ts';

function makeSourceCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function makeBlob() {
  return new Blob(['data'], { type: 'image/png' });
}

const mockContext = {
  canvas: { width: 0, height: 0 },
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  closePath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  bezierCurveTo: vi.fn(),
  quadraticCurveTo: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  arc: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  setLineDash: vi.fn(),
  drawImage: vi.fn(),
  clip: vi.fn(),
  createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  strokeStyle: '',
  fillStyle: '',
  lineWidth: 1,
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
};

describe('copyRectToClipboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // `mockContext` is one module-level object and `{ ...mockContext }` copies the SAME
    // `vi.fn()` references into every canvas context, so the whole file shares one call
    // history. `clearAllMocks`, not `restoreAllMocks`: restoring only reinstates spies, and
    // a bare `vi.fn()` keeps every call it was ever given. The guarantee that one test's
    // calls cannot leak into the next is `clearMocks: true`, written down in vitest.config.ts
    // instead of inherited from a Vitest default. The `vi.clearAllMocks()` below restates that
    // guarantee inside this file, so the file does not read as if it were doing the work alone.
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return { ...mockContext, canvas: this } as unknown as CanvasRenderingContext2D;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when sourceCanvas is null', async () => {
    const clipboard = { write: vi.fn() };
    const ClipboardItemCtor = vi.fn() as unknown as typeof ClipboardItem;
    const result = await copyRectToClipboard({
      sourceCanvas: null,
      rect: { x1: 0, y1: 0, x2: 10, y2: 10 },
      imageSize: { width: 100, height: 100 },
      clipboard,
      ClipboardItemCtor,
    });
    expect(result).toBe(false);
    expect(clipboard.write).not.toHaveBeenCalled();
  });

  it('returns false when rect is null', async () => {
    const canvas = makeSourceCanvas(10, 10);
    const result = await copyRectToClipboard({
      sourceCanvas: canvas,
      rect: null,
      imageSize: { width: 100, height: 100 },
      clipboard: { write: vi.fn() },
      ClipboardItemCtor: vi.fn() as unknown as typeof ClipboardItem,
    });
    expect(result).toBe(false);
  });

  it('returns false when clipboard write is unavailable', async () => {
    const canvas = makeSourceCanvas(10, 10);
    const result = await copyRectToClipboard({
      sourceCanvas: canvas,
      rect: { x1: 0, y1: 0, x2: 10, y2: 10 },
      imageSize: { width: 100, height: 100 },
      clipboard: null,
      ClipboardItemCtor: vi.fn() as unknown as typeof ClipboardItem,
    });
    expect(result).toBe(false);
  });

  it('returns false when the trimmed rect has zero area', async () => {
    const canvas = makeSourceCanvas(100, 100);
    const result = await copyRectToClipboard({
      sourceCanvas: canvas,
      rect: { x1: 50, y1: 50, x2: 50, y2: 50 },
      imageSize: { width: 100, height: 100 },
      clipboard: { write: vi.fn() },
      ClipboardItemCtor: vi.fn() as unknown as typeof ClipboardItem,
    });
    expect(result).toBe(false);
  });

  it('returns false when toBlob produces no blob', async () => {
    const canvas = makeSourceCanvas(100, 100);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      cb: (b: Blob | null) => void
    ) {
      cb(null);
    });
    const result = await copyRectToClipboard({
      sourceCanvas: canvas,
      rect: { x1: 0, y1: 0, x2: 50, y2: 50 },
      imageSize: { width: 100, height: 100 },
      clipboard: { write: vi.fn() },
      ClipboardItemCtor: vi.fn() as unknown as typeof ClipboardItem,
    });
    expect(result).toBe(false);
  });

  it('writes the blob to the clipboard and returns true on success', async () => {
    const canvas = makeSourceCanvas(100, 100);
    const blob = makeBlob();
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      cb: (b: Blob | null) => void
    ) {
      cb(blob);
    });

    const writeMock = vi.fn().mockResolvedValue(undefined);
    const ClipboardItemCtor = vi.fn() as unknown as typeof ClipboardItem;

    const result = await copyRectToClipboard({
      sourceCanvas: canvas,
      rect: { x1: 5, y1: 5, x2: 15, y2: 15 },
      imageSize: { width: 100, height: 100 },
      clipboard: { write: writeMock },
      ClipboardItemCtor,
    });

    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
    // The whole function is this crop. `trimRect` is covered on its own in rect.test.ts,
    // but the COMPOSITION is not covered anywhere: the source rect, the destination rect
    // and their order are all arguments of one `drawImage` call, and passing the untrimmed
    // rect, swapping x/y, or ignoring `trimRect` entirely would still return `true` here.
    // `rect {5,5,15,15}` in a 100x100 image trims to x 5, y 5, 10x10.
    expect(mockContext.drawImage).toHaveBeenCalledExactlyOnceWith(canvas, 5, 5, 10, 10, 0, 0, 10, 10);
  });

  it('draws the trimmed region, not the rect it was given', async () => {
    const canvas = makeSourceCanvas(100, 100);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      cb: (b: Blob | null) => void
    ) {
      cb(makeBlob());
    });

    await copyRectToClipboard({
      sourceCanvas: canvas,
      // Overhangs the document on the left, and x/y/width/height are four different
      // numbers, so an untrimmed origin, a swapped x/y pair, or a rect copied through
      // whole each produce a different argument list than the correct one.
      rect: { x1: -10, y1: 20, x2: 45, y2: 90 },
      imageSize: { width: 100, height: 100 },
      clipboard: { write: vi.fn().mockResolvedValue(undefined) },
      ClipboardItemCtor: vi.fn() as unknown as typeof ClipboardItem,
    });

    // -10 clamps to 0; 20, 45 and 90 all survive, and the extent is derived from the
    // rounded edges, so the source rect is 45x70 at 0,20 and lands 1:1 at the origin.
    expect(mockContext.drawImage).toHaveBeenCalledExactlyOnceWith(canvas, 0, 20, 45, 70, 0, 0, 45, 70);
  });

  it('returns false when clipboard.write throws', async () => {
    const canvas = makeSourceCanvas(100, 100);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      cb: (b: Blob | null) => void
    ) {
      cb(makeBlob());
    });

    const result = await copyRectToClipboard({
      sourceCanvas: canvas,
      rect: { x1: 0, y1: 0, x2: 10, y2: 10 },
      imageSize: { width: 100, height: 100 },
      clipboard: { write: vi.fn().mockRejectedValue(new Error('denied')) },
      ClipboardItemCtor: vi.fn().mockImplementation(function () {
        return {};
      }) as unknown as typeof ClipboardItem,
    });

    expect(result).toBe(false);
  });
});

describe('readImageFromClipboard', () => {
  it('decodes the first image item and ignores non-image clipboard types', async () => {
    const blob = makeBlob();
    const bitmap = { width: 32, height: 24 } as ImageBitmap;
    const getType = vi.fn().mockResolvedValue(blob);
    const decode = vi.fn().mockResolvedValue(bitmap);
    const result = await readImageFromClipboard({
      clipboard: { read: vi.fn().mockResolvedValue([{ types: ['text/plain', 'image/png'], getType }]) },
      createImageBitmap: decode,
    });

    expect(getType).toHaveBeenCalledExactlyOnceWith('image/png');
    expect(decode).toHaveBeenCalledExactlyOnceWith(blob);
    expect(result).toEqual({ bitmap, mimeType: 'image/png' });
  });

  it('returns null when clipboard read is unavailable, denied, or has no image', async () => {
    await expect(readImageFromClipboard({ clipboard: null })).resolves.toBeNull();
    await expect(
      readImageFromClipboard({ clipboard: { read: vi.fn().mockRejectedValue(new Error('denied')) } })
    ).resolves.toBeNull();
    await expect(
      readImageFromClipboard({
        clipboard: { read: vi.fn().mockResolvedValue([{ types: ['text/plain'], getType: vi.fn() }]) },
        createImageBitmap: vi.fn(),
      })
    ).resolves.toBeNull();
  });

  it('returns null when image decoding fails', async () => {
    const getType = vi.fn().mockResolvedValue(makeBlob());
    await expect(
      readImageFromClipboard({
        clipboard: { read: vi.fn().mockResolvedValue([{ types: ['image/png'], getType }]) },
        createImageBitmap: vi.fn().mockRejectedValue(new Error('unsupported image format')),
      })
    ).resolves.toBeNull();
  });
});

describe('readImageFromClipboard module defaults', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads navigator.clipboard and global createImageBitmap when no overrides are supplied', async () => {
    const blob = makeBlob();
    const bitmap = { width: 32, height: 24 } as ImageBitmap;
    const read = vi.fn().mockResolvedValue([{ types: ['image/png'], getType: vi.fn().mockResolvedValue(blob) }]);
    const decode = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('navigator', { clipboard: { read } });
    vi.stubGlobal('createImageBitmap', decode);

    await expect(readImageFromClipboard()).resolves.toEqual({ bitmap, mimeType: 'image/png' });
    expect(read).toHaveBeenCalledExactlyOnceWith();
    expect(decode).toHaveBeenCalledExactlyOnceWith(blob);
  });
});

/**
 * `copyRectToClipboard` takes both collaborators as DEFAULT PARAMETERS whose expressions
 * read the real environment:
 *
 *   clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null,
 *   ClipboardItemCtor = typeof window !== 'undefined' ? window.ClipboardItem : null,
 *
 * Every case in the block above passes BOTH explicitly, so not one of them evaluates either
 * expression. A default-parameter expression is evaluated on every CALL and is never captured
 * when the module is evaluated, so the cases below are the only ones that run either one — and
 * they can run them through the static import at the top of this file: `vi.stubGlobal`
 * arranges the globals first, and the call is what reads them. Fresh module instances are
 * therefore not requested, and requesting one would change nothing about what a call sees.
 */
describe('copyRectToClipboard module defaults', () => {
  // `rect {5,5,15,15}` in a 100x100 image trims to x 5, y 5, 10x10 — the same rect the
  // explicit-path success case uses, so the two paths are comparable argument for argument.
  const RECT = { x1: 5, y1: 5, x2: 15, y2: 15 };
  const IMAGE_SIZE = { width: 100, height: 100 };

  // One blob instance per test, so a comparison between the default path and the explicit
  // path is a comparison of plumbing and never of which PNG object happened to be handed out.
  let pngBlob: Blob;

  beforeEach(() => {
    pngBlob = makeBlob();
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return { ...mockContext, canvas: this } as unknown as CanvasRenderingContext2D;
    });
    // The source keys the `ClipboardItem` by the blob's OWN `type` (`[blob.type]: blob`), and
    // asks `toBlob` for `'image/png'`, so the key a real browser produces is `'image/png'`.
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      cb: (b: Blob | null) => void
    ) {
      cb(pngBlob);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /**
   * The `vi.fn()` fake the cases above use, with the one addition they never needed: the
   * `returns false when clipboard.write throws` case already returns a plain object from the
   * mock so that `new` yields something, and echoing the argument back makes the payload
   * visible in what reaches `clipboard.write` — the only place the constructor's output is
   * observable. The raw `vi.fn()` is returned alongside because `ClipboardItemCtor` is typed
   * as the DOM constructor, which carries no assertion methods.
   */
  function makeClipboardItemCtor() {
    const ctorMock = vi.fn().mockImplementation(function (items: Record<string, Blob>) {
      return { items };
    });
    return { ctorMock, ClipboardItemCtor: ctorMock as unknown as typeof ClipboardItem };
  }

  /**
   * Blobs compare by IDENTITY, so comparing two `write` call records directly would pass on
   * the shared instance alone and prove nothing. Reducing each written item to the
   * `type`/`size` of every entry compares the PAYLOAD each path actually produced.
   */
  function writtenPayloads(calls: unknown[][]) {
    return calls.map(([items]) =>
      (items as { items: Record<string, Blob> }[]).map((item) =>
        Object.fromEntries(
          Object.entries(item.items).map(([type, blob]) => [type, { size: blob.size, type: blob.type }])
        )
      )
    );
  }

  it('writes the trimmed rect through navigator.clipboard and window.ClipboardItem with no overrides', async () => {
    const writeMock = vi.fn().mockResolvedValue(undefined);
    const { ctorMock, ClipboardItemCtor } = makeClipboardItemCtor();

    vi.stubGlobal('navigator', { clipboard: { write: writeMock } });
    // jsdom's `window` IS this test's `globalThis`, so this is the very property the default
    // expression reads. Asserted rather than assumed, because a stub on the wrong object
    // would leave `window.ClipboardItem` undefined and the whole case silently vacuous.
    vi.stubGlobal('ClipboardItem', ClipboardItemCtor);
    expect(window.ClipboardItem).toBe(ClipboardItemCtor);

    const canvas = makeSourceCanvas(100, 100);

    const result = await copyRectToClipboard({ sourceCanvas: canvas, rect: RECT, imageSize: IMAGE_SIZE });

    expect(result).toBe(true);
    expect(ctorMock).toHaveBeenCalledExactlyOnceWith({ 'image/png': pngBlob });
    expect(writeMock).toHaveBeenCalledExactlyOnceWith([{ items: { 'image/png': pngBlob } }]);
    // The defaults are the only injection point exercised here, so the crop is asserted too:
    // a default that resolved to something inert would fail the write assertions above, and
    // a default that resolved to the RIGHT object while the rect maths drifted would pass
    // them.
    expect(mockContext.drawImage).toHaveBeenCalledExactlyOnceWith(canvas, 5, 5, 10, 10, 0, 0, 10, 10);
  });

  it('writes the same ClipboardItem payload with the defaults and with explicit overrides', async () => {
    const defaultWrite = vi.fn().mockResolvedValue(undefined);
    const defaultCtor = makeClipboardItemCtor();
    vi.stubGlobal('navigator', { clipboard: { write: defaultWrite } });
    vi.stubGlobal('ClipboardItem', defaultCtor.ClipboardItemCtor);

    const defaultCanvas = makeSourceCanvas(100, 100);
    expect(await copyRectToClipboard({ sourceCanvas: defaultCanvas, rect: RECT, imageSize: IMAGE_SIZE })).toBe(true);

    const explicitWrite = vi.fn().mockResolvedValue(undefined);
    const explicitCtor = makeClipboardItemCtor();
    const explicitCanvas = makeSourceCanvas(100, 100);
    expect(
      await copyRectToClipboard({
        sourceCanvas: explicitCanvas,
        rect: RECT,
        imageSize: IMAGE_SIZE,
        clipboard: { write: explicitWrite },
        ClipboardItemCtor: explicitCtor.ClipboardItemCtor,
      })
    ).toBe(true);

    // Both paths run the SAME function object; the only difference is whether the two default
    // expressions were allowed to run, which is the whole claim.
    expect(defaultCtor.ctorMock.mock.calls).toEqual(explicitCtor.ctorMock.mock.calls);
    expect(writtenPayloads(defaultWrite.mock.calls)).toEqual(writtenPayloads(explicitWrite.mock.calls));
    expect(writtenPayloads(defaultWrite.mock.calls)).toEqual([
      [{ 'image/png': { size: pngBlob.size, type: 'image/png' } }],
    ]);
  });

  it('returns false instead of throwing when the default navigator is absent', async () => {
    const { ctorMock, ClipboardItemCtor } = makeClipboardItemCtor();
    // The `typeof navigator !== 'undefined'` arm: a property whose value is `undefined` is
    // exactly what that guard tests, and an unguarded `navigator.clipboard` read here is a
    // `TypeError` rather than a `false`.
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('ClipboardItem', ClipboardItemCtor);

    const canvas = makeSourceCanvas(100, 100);

    await expect(copyRectToClipboard({ sourceCanvas: canvas, rect: RECT, imageSize: IMAGE_SIZE })).resolves.toBe(false);
    expect(ctorMock).not.toHaveBeenCalled();
    expect(mockContext.drawImage).not.toHaveBeenCalled();
  });

  it('returns false when the default navigator carries no clipboard', async () => {
    const { ctorMock, ClipboardItemCtor } = makeClipboardItemCtor();
    // The other half of the first default: `navigator` exists, `navigator.clipboard` does
    // not. jsdom itself is in this state, which is why the fallback exists at all.
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('ClipboardItem', ClipboardItemCtor);

    const canvas = makeSourceCanvas(100, 100);

    await expect(copyRectToClipboard({ sourceCanvas: canvas, rect: RECT, imageSize: IMAGE_SIZE })).resolves.toBe(false);
    expect(ctorMock).not.toHaveBeenCalled();
    expect(mockContext.drawImage).not.toHaveBeenCalled();
  });

  it('returns false when the default clipboard object has no write method', async () => {
    const { ctorMock, ClipboardItemCtor } = makeClipboardItemCtor();
    // `!clipboard?.write` is a two-part guard, and the explicit-path case only ever supplies
    // `null` — which never reaches the `?.write` half. A permission-gated browser exposes a
    // `navigator.clipboard` object that can lack `write`, so the default can land here too.
    vi.stubGlobal('navigator', { clipboard: {} });
    vi.stubGlobal('ClipboardItem', ClipboardItemCtor);

    const canvas = makeSourceCanvas(100, 100);

    await expect(copyRectToClipboard({ sourceCanvas: canvas, rect: RECT, imageSize: IMAGE_SIZE })).resolves.toBe(false);
    expect(ctorMock).not.toHaveBeenCalled();
    expect(mockContext.drawImage).not.toHaveBeenCalled();
  });

  it('returns false when the default window.ClipboardItem is absent', async () => {
    const writeMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { write: writeMock } });
    // The second default's `null` arm. A non-secure context and every browser without the
    // async clipboard API land here, and jsdom is in this state by default.
    vi.stubGlobal('ClipboardItem', undefined);
    expect(window.ClipboardItem).toBeUndefined();

    const canvas = makeSourceCanvas(100, 100);

    await expect(copyRectToClipboard({ sourceCanvas: canvas, rect: RECT, imageSize: IMAGE_SIZE })).resolves.toBe(false);
    expect(writeMock).not.toHaveBeenCalled();
    // The guard returns before the crop, so nothing was rasterised: a default that resolved
    // to a real constructor anyway would get this far and write.
    expect(mockContext.drawImage).not.toHaveBeenCalled();
  });
});
