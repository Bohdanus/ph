import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Page, TestInfo } from '@playwright/test';
import path from 'node:path';
import { initializeCanvas, writePsd } from 'ag-psd';
import sharp from 'sharp';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import {
  CHANGED_CHANNEL_THRESHOLD_GENERAL,
  EXPORT_LINE_END,
  EXPORT_LINE_START,
  CHANGED_CHANNEL_THRESHOLD_ICO,
  CHANNEL_DELTA_TOLERANCE,
  DOWNLOAD_TIMEOUT_MS,
  INTEGRATION_TEST_TIMEOUT_MS,
  MIN_EXPORT_INK_RATIO,
  browserVerifiedFormats,
  containerVerifiedFormats,
  exportByteVerifiers,
  exportFormats,
  icoFormat,
  ICON_STROKE,
  mimeType,
  exportAndVerify,
  exportIcoAndVerify,
  exportPixelPayload,
  prepareExportDownloadDirectory,
  setupExportTest,
  setupIcoTest,
  submitSaveDialogForDownload,
  verifyExportContainer,
  verifyPsdInPhotopea,
  type ExportFormat,
  type PixelComparisonResult,
  GEOMETRY_TOLERANCE_HORIZONTAL,
  GEOMETRY_TOLERANCE_SPAN,
  GEOMETRY_TOLERANCE_VERTICAL,
  readExportGeometry,
} from '../helpers';
import {
  CANVAS_REDRAW_CLIP,
  CANVAS_REDRAW_POLL_INTERVAL_MS,
  containFit,
  DEFAULT_DOCUMENT_HEIGHT,
  DEFAULT_DOCUMENT_WIDTH,
  documentToCanvasOffset,
  INK_LUMA_FLOOR,
} from '../../helpers/canvas-helpers';

const mocks = vi.hoisted(() => {
  const context: { received: unknown; message: string | undefined } = {
    received: undefined,
    message: undefined,
  };

  const show = (value: unknown): string => (typeof value === 'string' ? JSON.stringify(value) : String(value));

  const fail: (matcher: string, detail: string) => never = (matcher, detail) => {
    throw new Error(`${context.message ? `${context.message}: ` : ''}${matcher} ${detail}`);
  };

  const probeOf = (value: unknown): Probe | undefined => {
    const isProbe =
      typeof value === 'object' &&
      value !== null &&
      typeof Reflect.get(value, 'count') === 'function' &&
      typeof Reflect.get(value, 'isVisible') === 'function' &&
      typeof Reflect.get(value, 'textContent') === 'function';
    return isProbe ? (value as Probe) : undefined;
  };

  interface Probe {
    count(): Promise<number>;
    isVisible(): Promise<boolean>;
    textContent(): Promise<string | null>;
  }

  const matchers = {
    toBeVisible: vi.fn(async () => {
      const probe = probeOf(context.received);
      if (!probe) fail('toBeVisible', `expected a locator, received ${show(context.received)}`);
      if (!(await probe.isVisible())) fail('toBeVisible', 'expected the element to be visible');
    }),
    toHaveCount: vi.fn(async (expected: number) => {
      const probe = probeOf(context.received);
      if (!probe) fail('toHaveCount', `expected a locator, received ${show(context.received)}`);
      const count = await probe.count();
      if (count !== expected) fail('toHaveCount', `expected count ${expected}, received ${count}`);
    }),
    toContainText: vi.fn(async (expected: string, _options?: { timeout?: number }) => {
      const probe = probeOf(context.received);
      if (!probe) fail('toContainText', `expected a locator, received ${show(context.received)}`);
      const text = (await probe.textContent()) ?? '';
      if (!text.includes(expected)) {
        fail('toContainText', `expected text containing ${show(expected)}, received ${show(text)}`);
      }
    }),
    toBeNull: vi.fn(() => {
      if (context.received !== null) fail('toBeNull', `expected null, received ${show(context.received)}`);
    }),
    toBe: vi.fn((expected: unknown) => {
      if (!Object.is(context.received, expected)) {
        fail('toBe', `expected ${show(expected)}, received ${show(context.received)}`);
      }
    }),
    toBeGreaterThan: vi.fn((expected: number) => {
      const received = context.received;
      if (typeof received !== 'number' || !(received > expected)) {
        fail('toBeGreaterThan', `expected a number greater than ${expected}, received ${show(received)}`);
      }
    }),
  };

  /**
   * `expect(x).not` is modelled by inversion, not by re-running the check: every
   * matcher above fails by throwing, so a negated matcher passes exactly when the
   * matcher it wraps FAILED. A mock that ran the wrapped matcher and reported its
   * result would be inverted, which is the easiest part of Playwright to get wrong.
   */
  const negated: Record<string, Mock<(...args: never[]) => Promise<unknown>>> = {};
  for (const [name, matcher] of Object.entries(matchers) as Array<
    [string, Mock<(...args: never[]) => Promise<unknown>>]
  >) {
    negated[name] = vi.fn(async (...args: never[]) => {
      try {
        await matcher(...args);
      } catch {
        return;
      }
      fail(`not.${name}`, 'expected the expectation to fail, but it passed');
    });
  }

  return {
    mockExpect: vi.fn((received: unknown, message?: string) => {
      context.received = received;
      context.message = message;
      return { ...matchers, not: negated };
    }),
    matchers,
    // A real PNG, because `exportAndVerify` decodes the file it reads back to check the
    // export carries ink. `Buffer.alloc(512)` was opaque bytes: larger than the
    // byte-length floor, and not an image at all, so it could not have stood in for an
    // export. This one is 8x8 white with a black diagonal, so it decodes and it has ink.
    exportedFile: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAK0lEQVQImWNgYGD4jw2ARLHKQYUw5RB8NDlUDpIchgkwOWzWguVwuJWBAQBi96dZMmQ13QAAAABJRU5ErkJggg==',
      'base64'
    ),
  };
});

// A blank 256x256 PNG, built rather than pasted: an 8x8 blank is 93 bytes and would have been
// stopped by `exportAndVerify`'s byte-length check, which would make the test prove nothing about
// the ink guard. This one is ~776 bytes, so it clears that floor and is rejected only by the guard.
async function blankExportedFile(): Promise<Buffer<ArrayBuffer>> {
  const blank = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer();
  // sharp types its output over `ArrayBufferLike`. A freshly encoded PNG is not backed by
  // shared memory, and `mockResolvedValueOnce` only accepts the narrow `ArrayBuffer` form.
  return blank as Buffer<ArrayBuffer>;
}

// The Playwright expect is replaced by a recording validator so that assertions
// made inside the helpers really fail the test instead of always passing.
vi.mock('@playwright/test', () => ({
  expect: mocks.mockExpect,
}));

vi.mock('node:fs/promises', () => ({
  rm: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(async () => mocks.exportedFile),
}));

const OCTET_STREAM_MIME = 'application/octet-stream';
const SOURCE_DATA_URL = 'data:image/png;base64,c291cmNlLWNhbnZhcw==';
const EXPORT_FILENAME = 'drawing';
const ICON_EXPORT_FILENAME = 'drawing-icon';
const OUTPUT_DIR = '/tmp/export-unit/output';
const DOWNLOAD_DIRECTORY = path.join(OUTPUT_DIR, 'exports');
const PSD_PATH = '/tmp/export-unit/drawing.psd';
const ICON_CANVAS_SIZE = 256;
const PHOTOPEA_URL = 'https://www.photopea.com/';

/**
 * The `TestInfo` the export entry points are given. One instance for the whole file: the
 * `attach` mock is reset by `beforeEach`, so sharing it cannot leak a recorded call between
 * tests, and every call site needs the same argument to exist.
 */
const testInfo = createTestInfoMock();

/**
 * The document size an export produces, and the bytes that state it. `verifyPsdInPhotopea`
 * reads the expected dimensions out of the PSD header it is given, so a test needs a
 * header that really carries them — the same layout the app's own PSD fixtures build
 * (`src/contexts/__tests__/psd-utils.stub.test.ts`).
 */
function psdHeader(width: number, height: number): Buffer<ArrayBuffer> {
  const header = Buffer.alloc(22);
  header.write('8BPS', 0, 'latin1');
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(3, 12);
  header.writeUInt32BE(height, 14);
  header.writeUInt32BE(width, 18);
  return header;
}

const EXPORTED_DOCUMENT_SIZE = { width: 800, height: 600 };
const PSD_FILE = psdHeader(EXPORTED_DOCUMENT_SIZE.width, EXPORTED_DOCUMENT_SIZE.height);

// Literal pins for the budgets helpers.ts hard-codes: Playwright defaults to
// 30s and a 1ms budget passes any upper-bound-only assertion, so the intended
// values are spelled out here instead of being read back from the source.
const CANVAS_READY_TIMEOUT_MS = 60_000;
const PHOTOPEA_API_TIMEOUT_MS = 10_000;
const PHOTOPEA_NAVIGATION_TIMEOUT_MS = 30_000;
const PHOTOPEA_DOCUMENT_TIMEOUT_MS_LITERAL = 30_000;
const DOWNLOAD_TIMEOUT_MS_LITERAL = 30_000;
const MIN_EXPORT_BYTES = 100;

const COMPARE_IMAGE_SIZE = 256;
const EXPORTED_BASE64 = mocks.exportedFile.toString('base64');
const EXPORTED_PNG_DATA_URL = `data:image/png;base64,${EXPORTED_BASE64}`;
const EXPORTED_ICO_DATA_URL = `data:image/x-icon;base64,${EXPORTED_BASE64}`;

/** The size every container fixture below is built at: small, and not the fixture's. */
const CONTAINER_IMAGE_SIZE = 4;

/** A source canvas carrying a mark, as a data URL. The `container` oracle measures BOTH sides. */
async function drawnSourceDataUrl(): Promise<string> {
  const png = await sharp({
    create: {
      width: CONTAINER_IMAGE_SIZE,
      height: CONTAINER_IMAGE_SIZE,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** A source canvas with no mark on it, as a data URL. */
async function blankSourceDataUrl(): Promise<string> {
  const png = await sharp({
    create: {
      width: CONTAINER_IMAGE_SIZE,
      height: CONTAINER_IMAGE_SIZE,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** sharp writes little-endian TIFF; the app's exporter writes big-endian. Both are legal. */
async function containerTiff(size: number, options: { blank?: boolean } = {}): Promise<Buffer> {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: options.blank ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 },
    },
  })
    .tiff()
    .toBuffer();
}

interface TiffIfd {
  littleEndian: boolean;
  offset: number;
}

/** The first IFD's position and byte order, read the way `verifyTiffExport` reads them. */
function tiffIfd(file: Buffer): TiffIfd {
  const littleEndian = file[0] === 0x49;
  return { littleEndian, offset: littleEndian ? file.readUInt32LE(4) : file.readUInt32BE(4) };
}

function writeTiffU16(file: Buffer, littleEndian: boolean, offset: number, value: number): void {
  if (littleEndian) file.writeUInt16LE(value, offset);
  else file.writeUInt16BE(value, offset);
}

function writeTiffU32(file: Buffer, littleEndian: boolean, offset: number, value: number): void {
  if (littleEndian) file.writeUInt32LE(value, offset);
  else file.writeUInt32BE(value, offset);
}

/**
 * A big-endian TIFF, built by hand from Adobe's TIFF 6.0 layout.
 *
 * sharp only writes little-endian, so the byte order the app's exporter actually uses — a
 * real export begins `4d 4d 00 2a`, measured — cannot be produced by handing libvips a
 * request. This writes the header and IFD directly: mark, IFD offset, entry count, and
 * one 12-byte entry per tag, with `BitsPerSample`'s three shorts out of line.
 *
 * Its raster is deliberately NOT claimed to be decodable. libvips rejects a hand-built
 * uncompressed TIFF of any size tried here, so a unit test cannot use one to exercise the
 * DECODE step in big-endian order; `structured-formats.spec.ts` covers that against the
 * real encoder, whose output is big-endian. What this fixture does establish is the header
 * walk, which is where the byte order is actually read.
 */
function bigEndianTiff(width: number, height: number, rasterValue: number): Buffer {
  const ENTRY = 12;
  const rowsPerStrip = height;
  const entries: Array<[number, number, number, number]> = [
    [0x0100, 4, 1, width], // ImageWidth, LONG
    [0x0101, 4, 1, height], // ImageLength, LONG
    [0x0115, 3, 1, 3], // SamplesPerPixel, SHORT
    [0x0116, 3, 3, 0], // BitsPerSample x3, SHORT — out of line, patched below
    [0x0117, 4, 1, 0], // StripByteCounts, LONG — patched below
    [0x0103, 3, 1, 1], // Compression, SHORT, none
    [0x0106, 3, 1, 2], // PhotometricInterpretation, SHORT, RGB
    [0x0111, 4, 1, 0], // StripOffsets, LONG — patched below
    [278, 4, 1, rowsPerStrip], // RowsPerStrip, LONG
    [284, 3, 1, 1], // PlanarConfiguration, SHORT, chunky
  ];
  const ifdAt = 8;
  const ifdSize = 2 + entries.length * ENTRY + 4;
  const bitsAt = ifdAt + ifdSize; // three u16, which is more than an entry's value field holds
  const stripAt = bitsAt + 6;
  const stripBytes = width * height * 3;
  entries[3][3] = bitsAt;
  entries[4][3] = stripBytes;
  entries[7][3] = stripAt;

  const file = Buffer.alloc(stripAt + stripBytes);
  file.write('MM', 0, 'latin1');
  file[2] = 0;
  file[3] = 0x2a;
  file.writeUInt32BE(ifdAt, 4);
  file.writeUInt16BE(entries.length, ifdAt);
  entries.forEach(([tag, type, count, value], index) => {
    const at = ifdAt + 2 + index * ENTRY;
    file.writeUInt16BE(tag, at);
    file.writeUInt16BE(type, at + 2);
    file.writeUInt32BE(count, at + 4);
    file.writeUInt32BE(value, at + 8);
  });
  for (let sample = 0; sample < 3; sample += 1) file.writeUInt16BE(8, bitsAt + sample * 2);
  file.fill(rasterValue, stripAt, stripAt + stripBytes);
  return file;
}

interface PsdOptions {
  signature?: string;
  version?: number;
  channels?: number;
  width?: number;
  height?: number;
  layerAndMaskLength?: number;
  layerCount?: number;
  layers?: Array<{ name: string } & Partial<PsdLayerSpec>>;
  /** Write the records with no channel data at all. */
  skipLayerImageData?: boolean;
  /**
   * Pixel value for the flat composite. Omit it and `writePsd` synthesises one from the
   * children, which is not what the exporter does — `src/contexts/psd-utils.ts` hands
   * `writePsd` the flattened document canvas — so a test about the composite states it.
   */
  compositeFill?: number;
}

interface PsdLayerSpec {
  name: string;
  /** Pixel value the layer's raster is filled with. `0` is what makes it carry ink. */
  fill?: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/**
 * A PSD carrying `layerCount` layers, the first of which is the bedrock blank layer and the
 * second the `draw` layer `verifyPsdExport` requires. The layout follows Adobe's: a
 * signature, version, six reserved bytes, channels, height, width, depth, colour mode, then
 * three length-prefixed sections.
 */
function containerPsd(options: PsdOptions = {}): Buffer {
  const {
    signature = '8BPS',
    version = 1,
    channels = 3,
    width = CONTAINER_IMAGE_SIZE,
    height = CONTAINER_IMAGE_SIZE,
    layerAndMaskLength,
    layerCount,
    layers,
    skipLayerImageData = false,
    compositeFill,
  } = options;

  const specs = layers ?? [{ name: 'Blank 1' }, { name: 'draw 2', fill: 0 }];

  initializePsdWriteCanvas();
  const buffer = Buffer.from(
    writePsd(
      {
        width,
        height,
        ...(compositeFill === undefined ? {} : { imageData: solidRaster(width, height, compositeFill) }),
        children: specs.map((spec) => ({
          name: spec.name,
          left: spec.left ?? 0,
          top: spec.top ?? 0,
          ...(skipLayerImageData
            ? {}
            : { imageData: solidRaster(spec.right ?? width, spec.bottom ?? height, spec.fill ?? 255) }),
        })),
      },
      // The same two options the exporter uses (`src/contexts/psd-utils.ts:271`), so the
      // bytes this writes are laid out the way the app's are.
      // `skipLayerImageData` is read-side; the write-side spelling is `skipCompositeImageData`
      // plus an empty `imageData` per layer, so the option is applied to the children.
      { noBackground: true } as Parameters<typeof writePsd>[1]
    )
  );

  if (signature !== '8BPS') buffer.write(signature, 0, 'latin1');
  if (version !== 1) buffer.writeUInt16BE(version, 4);
  if (channels !== 3) buffer.writeUInt16BE(channels, 12);

  const resourcesLength = buffer.readUInt32BE(30);
  const layerMaskAt = 30 + 4 + resourcesLength;
  if (layerAndMaskLength !== undefined) buffer.writeUInt32BE(layerAndMaskLength, layerMaskAt);
  if (layerCount !== undefined) buffer.writeInt16BE(layerCount, layerMaskAt + 4 + 4);
  return buffer;
}

/**
 * Offsets of every layer record's four int32 rect fields, walked exactly the way
 * `readPsdLayerRecords` walks it, so a test can patch a rect without knowing the record
 * size up front.
 */
function psdRecordTops(file: Buffer): number[] {
  const resourcesLength = file.readUInt32BE(30);
  // 30 header, then a 4-byte image-resources length and that many bytes, then the
  // 4-byte layer-and-mask length, then the 4-byte layer-info length, then the count.
  const layerInfoAt = 30 + 4 + resourcesLength + 4;
  let at = layerInfoAt + 6;
  const count = Math.abs(file.readInt16BE(layerInfoAt + 4));
  const tops: number[] = [];
  for (let index = 0; index < count; index += 1) {
    tops.push(at);
    const channelCount = file.readUInt16BE(at + 16);
    const extraLengthAt = at + 18 + channelCount * 6 + 12;
    at = extraLengthAt + 4 + file.readUInt32BE(extraLengthAt);
  }
  return tops;
}

/**
 * Where one channel's raster bytes start. PSD packs every layer record first and every
 * layer's channel data after, so this is the sum of every earlier record's size plus every
 * earlier channel's declared length.
 */
function psdChannelDataAt(file: Buffer, layerIndex: number, channelIndex: number): number {
  const tops = psdRecordTops(file);
  let at = tops[tops.length - 1];
  const lastCount = file.readUInt16BE(at + 16);
  const extraLengthAt = at + 18 + lastCount * 6 + 12;
  at = extraLengthAt + 4 + file.readUInt32BE(extraLengthAt);
  for (let layer = 0; layer < layerIndex; layer += 1) {
    const channelCount = file.readUInt16BE(tops[layer] + 16);
    for (let channel = 0; channel < channelCount; channel += 1) {
      at += file.readUInt32BE(tops[layer] + 18 + channel * 6 + 2);
    }
  }
  for (let channel = 0; channel < channelIndex; channel += 1) {
    at += file.readUInt32BE(tops[layerIndex] + 18 + channel * 6 + 2);
  }
  return at;
}

function solidRaster(
  width: number,
  height: number,
  value: number
): {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  colorSpace: 'srgb';
} {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  return { width, height, data, colorSpace: 'srgb' };
}

/**
 * `ag-psd` asks the host for a canvas and for `ImageData`. In a Node test worker there is
 * neither, and on the paths used here — `writePsd` over `ImageData`, and `readPsd` over a
 * buffer — the context is only ever asked to allocate. A stub that allocates and draws
 * nothing is enough, and it is the same shim `helpers.ts` installs for the reader.
 */
let psdCanvasReady = false;

function initializePsdWriteCanvas(): void {
  if (psdCanvasReady) return;
  const noop = () => {};
  const allocate = (width: number, height: number) => solidRaster(width, height, 255) as unknown as ImageData;
  const canvas = (width: number, height: number) => ({
    width,
    height,
    getContext: () => ({
      createImageData: allocate,
      getImageData: allocate,
      putImageData: noop,
      drawImage: noop,
      clearRect: noop,
      save: noop,
      restore: noop,
      translate: noop,
      scale: noop,
      rotate: noop,
    }),
  });
  initializeCanvas(canvas as unknown as (width: number, height: number) => HTMLCanvasElement, allocate);
  psdCanvasReady = true;
}

interface StubImage {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

interface DecodedImage {
  width: number;
  height: number;
  pixels?: Uint8ClampedArray;
  onload?: () => void;
  onerror?: () => void;
}

/** A left/right split image, so `compareImage(0, 255)` and `compareImage(255, 0)` are the same image translated by half its width. */
function compareImage(left: number, right: number, alpha = 255): StubImage {
  const pixels = new Uint8ClampedArray(COMPARE_IMAGE_SIZE * COMPARE_IMAGE_SIZE * 4);
  for (let row = 0; row < COMPARE_IMAGE_SIZE; row += 1) {
    for (let column = 0; column < COMPARE_IMAGE_SIZE; column += 1) {
      const value = column < COMPARE_IMAGE_SIZE / 2 ? left : right;
      const index = (row * COMPARE_IMAGE_SIZE + column) * 4;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = alpha;
    }
  }
  return { width: COMPARE_IMAGE_SIZE, height: COMPARE_IMAGE_SIZE, pixels };
}

/** Every pixel opaque white: inked by no definition in this file, and so the blank case. */
const BLANK_EXPORT = compareImage(255, 255);
const IDENTICAL_EXPORT = compareImage(0, 255);
const SHIFTED_EXPORT = compareImage(255, 0);
const WITHIN_TOLERANCE_EXPORT = compareImage(40, 255);
const ALPHA_ONLY_EXPORT = compareImage(0, 255, 0);

/**
 * A small black mark on white paper, `side` pixels square.
 *
 * Sized for the ink guard, not the colour budget. A mark small enough that erasing most of
 * it stays inside `CHANGED_CHANNEL_THRESHOLD_GENERAL` is the whole reason the guard exists,
 * and a left/right split of the image is the wrong shape to demonstrate that: erasing it
 * relights half the picture.
 */
function sparseMark(side: number): StubImage {
  const pixels = new Uint8ClampedArray(COMPARE_IMAGE_SIZE * COMPARE_IMAGE_SIZE * 4);
  for (let row = 0; row < COMPARE_IMAGE_SIZE; row += 1) {
    for (let column = 0; column < COMPARE_IMAGE_SIZE; column += 1) {
      const inside = row < side && column < side;
      const index = (row * COMPARE_IMAGE_SIZE + column) * 4;
      const value = inside ? 0 : 255;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }
  return { width: COMPARE_IMAGE_SIZE, height: COMPARE_IMAGE_SIZE, pixels };
}

/**
 * Stubs the browser surface the `page.evaluate` pixel comparators close over,
 * returning the array every decoded image source is recorded in.
 */
function stubCompareEnvironment(
  images: Record<string, StubImage>,
  { contextAvailable = true }: { contextAvailable?: boolean } = {}
): string[] {
  const requestedSources: string[] = [];
  vi.stubGlobal(
    'Image',
    class {
      width = 0;
      height = 0;
      pixels: Uint8ClampedArray | undefined = undefined;
      onload?: () => void;
      onerror?: () => void;
      set src(value: string) {
        requestedSources.push(value);
        const image = images[value];
        if (!image) {
          queueMicrotask(() => this.onerror?.());
          return;
        }
        this.width = image.width;
        this.height = image.height;
        this.pixels = image.pixels;
        queueMicrotask(() => this.onload?.());
      }
    }
  );
  vi.stubGlobal('document', {
    createElement: () => {
      let drawn: DecodedImage | undefined;
      return {
        width: 0,
        height: 0,
        getContext: () =>
          contextAvailable
            ? {
                drawImage: (image: DecodedImage) => {
                  drawn = image;
                },
                getImageData: () => ({ data: drawn?.pixels ?? new Uint8ClampedArray(0) }),
              }
            : null,
      };
    },
  });
  return requestedSources;
}

function formatByLabel(label: string): ExportFormat {
  const format = exportFormats.find((candidate) => candidate.label === label);
  if (!format) throw new Error(`Unknown export format: ${label}`);
  return format;
}

const PNG_FORMAT = formatByLabel('PNG');
const TIFF_FORMAT = formatByLabel('TIFF');
const AVIF_FORMAT = formatByLabel('AVIF');

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PixelPayload {
  source: string;
  exported: string;
  mime?: string;
  threshold: number;
  tolerance: number;
  lumaFloor: number;
  minInkRatio: number;
}

interface LocatorSurface {
  click: Mock<() => Promise<void>>;
  fill: Mock<(value: string) => Promise<void>>;
  selectOption: Mock<(option: { label: string }) => Promise<string[]>>;
  first: Mock<() => LocatorSurface>;
  count: Mock<() => Promise<number>>;
  isVisible: Mock<() => Promise<boolean>>;
  textContent: Mock<() => Promise<string | null>>;
  boundingBox: Mock<() => Promise<Box | null>>;
  evaluate: Mock<(read: (element: unknown) => unknown) => Promise<unknown>>;
  setInputFiles: Mock<(file: string) => Promise<void>>;
  or: Mock<(locator: LocatorSurface) => LocatorSurface>;
  nth: Mock<(index: number) => LocatorSurface>;
}

interface MouseSurface {
  move: Mock<(x: number, y: number, options?: { steps?: number }) => Promise<void>>;
  down: Mock<() => Promise<void>>;
  up: Mock<() => Promise<void>>;
}

interface DownloadSurface {
  failure: Mock<() => Promise<string | null>>;
  suggestedFilename: Mock<() => string>;
  saveAs: Mock<(target: string) => Promise<void>>;
}

/** The slice of Playwright's `Dialog` a helper may act on; `accept`/`dismiss` are the only calls. */
interface DialogSurface {
  accept: Mock<() => Promise<void>>;
  dismiss: Mock<() => Promise<void>>;
}

/**
 * `page.on` and `page.once` are on the surface because a helper that installed either one
 * would auto-answer dialogs, and the ICO path's pin is that it installs NEITHER: an
 * unhandled native prompt is auto-dismissed, which the app reads as "declined", so a
 * surprise one surfaces by stopping the flow instead of being accepted away.
 */
interface DialogHandlerSurface {
  on: Mock<(event: string, handler: (dialog: DialogSurface) => void) => void>;
  once: Mock<(event: string, handler: (dialog: DialogSurface) => void) => void>;
}

interface PageSurface extends DialogHandlerSurface {
  goto: Mock<(url: string, options?: { waitUntil?: string; timeout?: number }) => Promise<null>>;
  getByTestId: Mock<(testId: string) => LocatorSurface>;
  getByRole: Mock<(role: string, options?: { name?: string | RegExp }) => LocatorSurface>;
  getByText: Mock<(text: string | RegExp, options?: { exact?: boolean }) => LocatorSurface>;
  locator: Mock<(selector: string) => LocatorSurface>;
  waitForEvent: Mock<(event: string, options?: { timeout?: number }) => Promise<DownloadSurface>>;
  /**
   * `pageFunction` is typed `(...args: never[]) => unknown` and the argument `never`,
   * because a page function is serialised and evaluated in the browser: one that closes
   * over a Node value compiles fine and silently sees `undefined` there, so the value
   * has to be passed as the argument. `never` is what lets a zero-argument and a
   * one-argument page function both be recorded here without either being cast — it is
   * assignable to every parameter type and from none.
   */
  waitForFunction: Mock<
    (pageFunction: (...args: never[]) => unknown, arg: never, options?: { timeout?: number }) => Promise<unknown>
  >;
  evaluate: Mock<
    (
      compare: (payload: PixelPayload) => Promise<PixelComparisonResult>,
      payload: PixelPayload
    ) => Promise<PixelComparisonResult>
  >;
  screenshot: Mock<(options?: { clip?: Box }) => Promise<Buffer>>;
  waitForTimeout: Mock<(timeout: number) => Promise<void>>;
  mouse: MouseSurface;
}

function asPlaywright<T extends object>(surface: object): T {
  return new Proxy({} as T, { get: (_target, property) => Reflect.get(surface, property) });
}

/**
 * The canvas the default `evaluate` mock hands to a page function.
 *
 * `setupExportTest` reads the element twice, and the two reads want different shapes: the
 * document size comes off the backing store (`width`/`height`) and the source image off
 * `toDataURL()`. A single canned return cannot answer both — the mock used to answer
 * `SOURCE_DATA_URL` for every call, so the backing-store read destructured a string,
 * `documentSize` became `{ width: undefined, height: undefined }`, and every offset derived
 * from it was `NaN`. Running the page function against a duck-typed element answers whichever
 * shape it asks for, and fails loudly if a helper starts reading a property this does not have.
 */
const FAKE_CANVAS_ELEMENT = {
  width: DEFAULT_DOCUMENT_WIDTH,
  height: DEFAULT_DOCUMENT_HEIGHT,
  toDataURL: () => SOURCE_DATA_URL,
};

function createLocatorMock(overrides: Partial<LocatorSurface> = {}): LocatorSurface {
  const surface: LocatorSurface = {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue([]),
    first: vi.fn(),
    count: vi.fn().mockResolvedValue(1),
    isVisible: vi.fn().mockResolvedValue(true),
    textContent: vi.fn().mockResolvedValue(''),
    boundingBox: vi.fn().mockResolvedValue(null),
    evaluate: vi.fn(async (read: (element: unknown) => unknown) => read(FAKE_CANVAS_ELEMENT)),
    setInputFiles: vi.fn().mockResolvedValue(undefined),
    or: vi.fn(),
    nth: vi.fn(),
    ...overrides,
  };
  // Playwright's `.first()` caps the match set at one element, so a `toHaveCount`
  // assertion on the result can never see a second match. The derived locator shares
  // the base's mocks — it is the same underlying element — and only `count` is clamped,
  // so `count` is deliberately NOT copied: a clamp that delegated to a copy of itself
  // would recurse, and nothing calls it until a test does.
  surface.first.mockImplementation(() => {
    const first = createLocatorMock();
    for (const key of Object.keys(surface) as Array<keyof LocatorSurface>) {
      if (key === 'count') continue;
      Reflect.set(first, key, surface[key]);
    }
    first.count.mockImplementation(async () => Math.min(1, await surface.count()));
    return first;
  });
  surface.or.mockReturnValue(surface);
  surface.nth.mockReturnValue(surface);
  return surface;
}

function byKey(
  locators: Readonly<Record<string, LocatorSurface>>,
  fallback: LocatorSurface
): Mock<(key: string) => LocatorSurface> {
  return vi.fn((key: string) => locators[key] ?? fallback);
}

function byRole(
  locators: Readonly<Record<string, LocatorSurface>>,
  fallback: LocatorSurface
): Mock<(role: string, options?: { name?: string | RegExp }) => LocatorSurface> {
  return vi.fn(
    (role: string, options?: { name?: string | RegExp }) =>
      locators[`${role}:${String(options?.name ?? '')}`] ?? fallback
  );
}

async function strokePng(drawn: boolean): Promise<Buffer> {
  return sharp({
    create: {
      width: 4,
      height: 4,
      channels: 3,
      background: drawn ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();
}

function createPageMock(overrides: Partial<PageSurface> = {}): {
  surface: PageSurface;
  page: Page;
} {
  const fallback = createLocatorMock();
  const surface: PageSurface = {
    goto: vi.fn().mockResolvedValue(null),
    getByTestId: byKey({}, fallback),
    getByRole: byRole({}, fallback),
    getByText: vi.fn(() => fallback),
    locator: byKey({}, fallback),
    waitForEvent: vi.fn().mockRejectedValue(new Error('waitForEvent was not configured for this test')),
    once: vi.fn().mockReturnValue(undefined),
    on: vi.fn().mockReturnValue(undefined),
    waitForFunction: vi.fn().mockResolvedValue(true),
    // A page that does not scroll, which is the truth: the rail declares
    // `min-h-0 overflow-y-auto`, so the page fits a 720px viewport. `maxScrollY: 0` is what
    // makes the scroll net in `onScreenClip` a no-op here, so these tests assert the
    // un-scrolled clip. Answering the viewport probe is required — a catch-all that returned
    // one shape for every page function left `readPageViewport` with `undefined` fields and
    // the clip's `y` as `NaN`. The extra keys let the same object serve `getPageScroll`
    // (`x`/`y`) and the `toDataURL` read (`ok`) without a per-call switch.
    evaluate: vi
      .fn()
      .mockResolvedValue({ ok: true, x: 0, y: 0, width: 1280, height: 720, scrollX: 0, scrollY: 0, maxScrollY: 0 }),
    screenshot: vi.fn(async () => strokePng(true)),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    mouse: {
      move: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
  return { surface, page: asPlaywright<Page>(surface) };
}

interface TestInfoSurface {
  outputDir: string;
  attach: Mock<(name: string, options: { body: Buffer; contentType: string }) => Promise<void>>;
}

function createTestInfoMock(outputDir: string = OUTPUT_DIR): TestInfoSurface & TestInfo {
  return asPlaywright<TestInfoSurface & TestInfo>({ outputDir, attach: vi.fn().mockResolvedValue(undefined) });
}

function createDownloadMock(suggestedFilename: string, failure: string | null = null): DownloadSurface {
  return {
    failure: vi.fn().mockResolvedValue(failure),
    suggestedFilename: vi.fn().mockReturnValue(suggestedFilename),
    saveAs: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * The redraw region `setupExportTest` now polls, derived from the document-space line.
 *
 * It replaced a fixed `CANVAS_REDRAW_CLIP` region, which only covered the line at the one
 * canvas size it was chosen for: the line sits at document y 57.7, so at any canvas that
 * is not taller than the document's aspect the box-relative 100,100 region is below it and
 * the wait passes without ever confirming the stroke reached the backing store.
 */
function redrawClip(box: Box): Box {
  const start = documentToCanvasOffset(box, EXPORT_LINE_START.x, EXPORT_LINE_START.y);
  const end = documentToCanvasOffset(box, EXPORT_LINE_END.x, EXPORT_LINE_END.y);
  return {
    x: box.x + Math.floor(start.x) - 20,
    y: box.y + Math.floor(start.y) - 20,
    width: Math.ceil(end.x - start.x) + 40,
    height: 40,
  };
}

/**
 * The payload `exportAndVerify` hands to the in-browser comparator.
 *
 * Every threshold is in it, and that is the point: `page.evaluate` serialises the
 * comparator's SOURCE, so a threshold left as a module-scope reference would be an
 * undefined free variable in the page. Asserting the whole object here is what stops a
 * threshold being added to the comparator and not to its input.
 */
function pixelPayload(format: ExportFormat, threshold = CHANGED_CHANNEL_THRESHOLD_GENERAL): PixelPayload {
  return {
    source: SOURCE_DATA_URL,
    exported: mocks.exportedFile.toString('base64'),
    mime: mimeType(format.extension),
    threshold,
    tolerance: CHANNEL_DELTA_TOLERANCE,
    lumaFloor: INK_LUMA_FLOOR,
    minInkRatio: MIN_EXPORT_INK_RATIO,
  };
}

function isValidExportFormat(value: unknown): value is ExportFormat {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ExportFormat>;
  return (
    typeof candidate.label === 'string' &&
    candidate.label.length > 0 &&
    typeof candidate.extension === 'string' &&
    /^\.[a-z0-9]+$/i.test(candidate.extension) &&
    (candidate.verification === 'browser-pixels' || candidate.verification === 'container')
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Export Helpers', () => {
  const DECLARED_FORMATS: Array<[string, ExportFormat]> = [
    ['PNG', { label: 'PNG', extension: '.png', verification: 'browser-pixels' }],
    ['JPEG', { label: 'JPEG', extension: '.jpeg', verification: 'browser-pixels' }],
    ['WebP', { label: 'WebP', extension: '.webp', verification: 'browser-pixels' }],
    ['TIFF', { label: 'TIFF', extension: '.tiff', verification: 'container' }],
    ['BMP', { label: 'BMP', extension: '.bmp', verification: 'browser-pixels' }],
    ['GIF (static)', { label: 'GIF (static)', extension: '.gif', verification: 'browser-pixels' }],
    ['AVIF', { label: 'AVIF', extension: '.avif', verification: 'browser-pixels' }],
    ['SVG (flattened)', { label: 'SVG (flattened)', extension: '.svg', verification: 'browser-pixels' }],
    ['Photoshop PSD (layers)', { label: 'Photoshop PSD (layers)', extension: '.psd', verification: 'container' }],
  ];

  const DECLARED_MIME_TYPES: Array<[string, string]> = [
    ['.png', 'image/png'],
    ['.jpeg', 'image/jpeg'],
    ['.webp', 'image/webp'],
    ['.bmp', 'image/bmp'],
    ['.gif', 'image/gif'],
    ['.avif', 'image/avif'],
    ['.ico', 'image/x-icon'],
    ['.svg', 'image/svg+xml'],
  ];

  describe('export constants', () => {
    // Literal pins: these numbers are the export contract, so drifting any of
    // them has to be a deliberate edit here as well as in helpers.ts.
    const CONSTANT_PINS: Array<[string, number, number]> = [
      ['CHANGED_CHANNEL_THRESHOLD_GENERAL', CHANGED_CHANNEL_THRESHOLD_GENERAL, 50_000],
      ['CHANGED_CHANNEL_THRESHOLD_ICO', CHANGED_CHANNEL_THRESHOLD_ICO, 20_000],
      ['CHANNEL_DELTA_TOLERANCE', CHANNEL_DELTA_TOLERANCE, 40],
      ['DOWNLOAD_TIMEOUT_MS', DOWNLOAD_TIMEOUT_MS, 30_000],
      ['INTEGRATION_TEST_TIMEOUT_MS', INTEGRATION_TEST_TIMEOUT_MS, 60_000],
      ['MIN_EXPORT_INK_RATIO', MIN_EXPORT_INK_RATIO, 2],
    ];

    it.each(CONSTANT_PINS)('pins %s', (_name, value, pinned) => {
      expect(value).toBe(pinned);
    });

    it('pins the canvas redraw clip offsets', () => {
      expect(CANVAS_REDRAW_CLIP).toEqual({ x: 100, y: 100, width: 300, height: 100 });
    });

    it('pins the icon stroke offsets', () => {
      expect(ICON_STROKE).toEqual({ startX: 60, centerY: 128, endX: 196, steps: 10 });
    });
  });

  describe('exportFormats', () => {
    it.each(DECLARED_FORMATS)('declares %s with its extension and verification mechanism', (_label, format) => {
      expect(exportFormats.find((candidate) => candidate.label === format.label)).toEqual(format);
    });

    it('declares label, extension and verification on every format', () => {
      for (const format of exportFormats) {
        expect(format).toHaveProperty('label');
        expect(format).toHaveProperty('extension');
        expect(format).toHaveProperty('verification');
        expect(['browser-pixels', 'container']).toContain(format.verification);
      }
    });

    it('starts every extension with a dot', () => {
      for (const format of exportFormats) {
        expect(format.extension.startsWith('.')).toBe(true);
      }
    });

    it('exposes unique labels and extensions, with ICO kept out of the export list', () => {
      const labels = exportFormats.map((format) => format.label);
      const extensions = exportFormats.map((format) => format.extension);
      expect(new Set(labels).size).toBe(labels.length);
      expect(new Set(extensions).size).toBe(extensions.length);
      expect(new Set([...extensions, icoFormat.extension]).size).toBe(extensions.length + 1);
      expect(labels).not.toContain(icoFormat.label);
    });

    it('compares a format in the browser if and only if the browser can decode it', () => {
      const all = [...exportFormats, icoFormat];
      const decodable = all
        .filter((format) => mimeType(format.extension) !== OCTET_STREAM_MIME)
        .map((format) => format.label);
      const compared = all.filter((format) => format.verification === 'browser-pixels').map((format) => format.label);
      const containers = all.filter((format) => format.verification === 'container').map((format) => format.label);
      expect(compared).toEqual(decodable);
      expect(containers).toEqual(all.map((format) => format.label).filter((label) => !decodable.includes(label)));
      expect(decodable.length).toBeGreaterThan(0);
      expect(containers.length).toBeGreaterThan(0);
    });

    /**
     * THE INVARIANT. A format that names no mechanism is the defect this type was built to
     * remove, and the two that used to be exempt are named in the fixture above: with
     * `comparePixels: false` a blank TIFF and a zero-layer PSD passed, because the only
     * assertions `exportAndVerify` made for them were a `> 100` byte floor and a file
     * extension. Remove a verifier from `exportByteVerifiers` and this is the test that
     * goes red.
     */
    it('registers a container verifier for every format the browser cannot decode, and no others', () => {
      for (const format of [...exportFormats, icoFormat]) {
        const registered = Object.hasOwn(exportByteVerifiers, format.extension);
        expect(
          registered,
          `${format.label} (${format.extension}) is '${format.verification}' with no registered verifier`
        ).toBe(format.verification === 'container');
      }
      for (const extension of Object.keys(exportByteVerifiers)) {
        expect(
          containerVerifiedFormats.some((format) => format.extension === extension),
          `${extension} has a verifier but no format declares it as a container`
        ).toBe(true);
      }
    });

    it('partitions the formats between the two mechanisms, leaving none unverified', () => {
      const partitioned = [...browserVerifiedFormats, ...containerVerifiedFormats].map((format) => format.label);
      expect(partitioned.slice().sort()).toEqual(
        exportFormats
          .map((format) => format.label)
          .slice()
          .sort()
      );
    });

    it('keeps the verifier map free of inherited keys', () => {
      expect(Object.getPrototypeOf(exportByteVerifiers)).toBe(null);
      expect(Object.keys(exportByteVerifiers).sort()).toEqual(['.psd', '.tiff']);
    });

    it('every declared format satisfies the shape contract', () => {
      expect([...exportFormats, icoFormat].filter((format) => !isValidExportFormat(format))).toEqual([]);
    });
  });

  describe('icoFormat', () => {
    it('declares the ICO contract', () => {
      expect(icoFormat).toEqual({ label: 'ICO', extension: '.ico', verification: 'browser-pixels' });
    });
  });

  describe('mimeType', () => {
    it.each(DECLARED_MIME_TYPES)('maps %s to %s', (extension, mime) => {
      expect(mimeType(extension)).toBe(mime);
    });

    it('resolves a well-formed image mime for every declared format the browser can decode', () => {
      for (const format of [...exportFormats, icoFormat]) {
        const mime = mimeType(format.extension);
        if (mime === OCTET_STREAM_MIME) continue;
        expect(mime).toMatch(/^image\/[a-z0-9.+-]+$/i);
      }
    });

    it('falls back to application/octet-stream for unknown extensions', () => {
      expect(mimeType('.unknown')).toBe('application/octet-stream');
      expect(mimeType('.xyz')).toBe('application/octet-stream');
    });

    it('falls back to application/octet-stream for an empty extension', () => {
      expect(mimeType('')).toBe('application/octet-stream');
    });

    it('ignores extension casing', () => {
      expect(mimeType('.PNG')).toBe('image/png');
      expect(mimeType('.JPEG')).toBe('image/jpeg');
      expect(mimeType('.Svg')).toBe('image/svg+xml');
      expect(mimeType('.ICO')).toBe('image/x-icon');
    });

    it('falls back to application/octet-stream without a leading dot', () => {
      expect(mimeType('png')).toBe('application/octet-stream');
      expect(mimeType('svg')).toBe('application/octet-stream');
    });

    it('falls back to application/octet-stream for tiff and psd', () => {
      expect(mimeType('.tiff')).toBe('application/octet-stream');
      expect(mimeType('.psd')).toBe('application/octet-stream');
    });

    it('falls back to application/octet-stream for absent input', () => {
      expect(mimeType(null)).toBe(OCTET_STREAM_MIME);
      expect(mimeType(undefined)).toBe(OCTET_STREAM_MIME);
    });

    it('falls back to application/octet-stream for a non-string at runtime', () => {
      expect(mimeType(123 as never)).toBe(OCTET_STREAM_MIME);
    });
  });

  describe('the export fixture geometry budgets', () => {
    /**
     * A RATCHET, not a transcription. These three numbers are the fixture's whole notion of
     * "close enough", and a review found that raising the horizontal one from 0.25 to 1.4 and
     * the vertical from 0.05 to 5 left all 888 e2e unit tests GREEN — only a browser run,
     * comparing decoded pixels, could tell, and nothing in CI compared them. A budget that
     * nothing can object to is not a budget.
     *
     * Asserting the exact values would be a transcription, and the wrong instinct: an agent
     * who widens a tolerance on purpose would widen it in the test too and never see the
     * moment. Asserting an UPPER bound makes the loosening the thing that fails. These may
     * be tightened freely — that is the direction that makes the fixture stricter — and a
     * widening has to come through this file as a conscious edit with a reason.
     */
    it('are no looser than the measured error, and cannot be widened silently', () => {
      // 0.271 document px is the measured error on the span (see the constants' JSDoc), so a
      // span budget of 1 is already under 4x it. Horizontal 0.25 and vertical 0.05 are the
      // per-edge budgets and have no headroom to give.
      expect(GEOMETRY_TOLERANCE_HORIZONTAL).toBeLessThanOrEqual(0.25);
      expect(GEOMETRY_TOLERANCE_VERTICAL).toBeLessThanOrEqual(0.05);
      expect(GEOMETRY_TOLERANCE_SPAN).toBeLessThanOrEqual(1);

      // And the three are ordered the way the geometry is: the span is the whole mark, so
      // its budget is the largest of the three by construction, not by accident. A swap here
      // would let a mark twice as wrong through on the axis meant to be tightest.
      expect(GEOMETRY_TOLERANCE_SPAN).toBeGreaterThan(GEOMETRY_TOLERANCE_HORIZONTAL);
      expect(GEOMETRY_TOLERANCE_HORIZONTAL).toBeGreaterThan(GEOMETRY_TOLERANCE_VERTICAL);
    });
  });

  describe('readExportGeometry', () => {
    it('does not let low-contrast codec ringing widen the measured ink span', async () => {
      const width = DEFAULT_DOCUMENT_WIDTH;
      const height = DEFAULT_DOCUMENT_HEIGHT;
      const pixels = Buffer.alloc(width * height * 4, 255);
      const setPixel = (x: number, y: number, value: number) => {
        const index = (y * width + x) * 4;
        pixels[index] = value;
        pixels[index + 1] = value;
        pixels[index + 2] = value;
        pixels[index + 3] = 255;
      };

      for (let y = 73; y <= 82; y++) {
        for (let x = 118; x <= 292; x++) setPixel(x, y, 0);
        for (const x of [116, 117, 293, 294]) setPixel(x, y, 245);
      }

      const image = await sharp(pixels, {
        raw: { width, height, channels: 4 },
      })
        .png()
        .toBuffer();

      const geometry = await readExportGeometry(image);
      expect(geometry.inkWidth).toBe(175);
    });
  });

  describe('setupExportTest', () => {
    it('prepares the download directory, strokes the canvas and returns the source data url', async () => {
      const box: Box = { x: 64, y: 48, width: 512, height: 384 };
      const canvas = createLocatorMock({ boundingBox: vi.fn().mockResolvedValue(box) });
      const drawTool = createLocatorMock();
      const { surface, page } = createPageMock({
        getByTestId: byKey({ 'workspace-canvas': canvas, 'tool-button-draw': drawTool }, canvas),
      });

      const result = await setupExportTest(page, createTestInfoMock());

      expect(surface.goto).toHaveBeenCalledWith('/', { waitUntil: 'domcontentloaded' });
      expect(vi.mocked(rm)).toHaveBeenCalledWith(DOWNLOAD_DIRECTORY, { recursive: true, force: true });
      expect(vi.mocked(mkdir)).toHaveBeenCalledWith(DOWNLOAD_DIRECTORY, { recursive: true });
      // The workspace canvas is found by test id only. A positional fallback would put
      // this locator on the Draw preview canvas or a hidden overlay depending on which
      // tool is active, so there is deliberately no `locator('canvas')` call here.
      expect(surface.getByTestId).toHaveBeenCalledWith('workspace-canvas');
      expect(surface.locator).not.toHaveBeenCalled();
      expect(mocks.mockExpect).toHaveBeenCalledWith(canvas);
      expect(drawTool.click).toHaveBeenCalled();
      // The stroke is specified in DOCUMENT space and mapped into this canvas, so the
      // document point it marks does not depend on the canvas size. 512x384 is aspect 1.333,
      // the document's own aspect, so there is no letterbox and the mapping is a plain scale.
      const start = documentToCanvasOffset(box, EXPORT_LINE_START.x, EXPORT_LINE_START.y);
      const end = documentToCanvasOffset(box, EXPORT_LINE_END.x, EXPORT_LINE_END.y);
      expect(surface.mouse.move.mock.calls).toEqual([
        [box.x + start.x, box.y + start.y],
        [box.x + end.x, box.y + end.y],
      ]);
      expect(surface.mouse.down).toHaveBeenCalled();
      expect(surface.mouse.up).toHaveBeenCalled();
      expect(surface.screenshot).toHaveBeenCalledWith({ clip: redrawClip(box) });
      expect(canvas.evaluate).toHaveBeenCalled();
      // The document size is READ off the backing store, not assumed to be the seeded 800x600:
      // `documentToCanvasOffset` used to divide by a hardcoded size, so a document opened at
      // any other resolution was drawn somewhere the app never looks and the export stopped
      // being the line the constants describe. One of the two `evaluate` calls on the canvas
      // is that read, and its result is handed back so a spec can assert on it.
      const backingStoreRead = canvas.evaluate.mock.calls.map(([read]) => read(FAKE_CANVAS_ELEMENT));
      expect(backingStoreRead).toContainEqual({
        width: DEFAULT_DOCUMENT_WIDTH,
        height: DEFAULT_DOCUMENT_HEIGHT,
      });
      expect(result).toEqual({
        box,
        documentSize: { width: DEFAULT_DOCUMENT_WIDTH, height: DEFAULT_DOCUMENT_HEIGHT },
        sourceDataUrl: SOURCE_DATA_URL,
        downloadDirectory: DOWNLOAD_DIRECTORY,
      });
    });

    it('offsets the stroke by the canvas box origin instead of fixed viewport coordinates', async () => {
      const box: Box = { x: 311, y: 197, width: 640, height: 480 };
      const canvas = createLocatorMock({ boundingBox: vi.fn().mockResolvedValue(box) });
      const drawTool = createLocatorMock();
      const { surface, page } = createPageMock({
        getByTestId: byKey({ 'workspace-canvas': canvas, 'tool-button-draw': drawTool }, canvas),
        locator: byKey({ canvas }, canvas),
      });

      await setupExportTest(page, createTestInfoMock());

      const [start, end] = surface.mouse.move.mock.calls;
      const startOffset = documentToCanvasOffset(box, EXPORT_LINE_START.x, EXPORT_LINE_START.y);
      const endOffset = documentToCanvasOffset(box, EXPORT_LINE_END.x, EXPORT_LINE_END.y);
      expect(start).toEqual([box.x + startOffset.x, box.y + startOffset.y]);
      expect(end).toEqual([box.x + endOffset.x, box.y + endOffset.y]);
      // Literal pins. 640x480 is the document's aspect, so `scale = 0.8` with no letterbox
      // and the document points map to 98.5626,46.1602 and 229.9795,46.1602. Hard-coding
      // either viewport coordinates or the old 150/150 box offsets cannot satisfy these.
      expect(start[0]).toBeCloseTo(409.562628, 5);
      expect(start[1]).toBeCloseTo(259.587269, 5);
      expect(end[0]).toBeCloseTo(540.979466, 5);
      expect(end[1]).toBeCloseTo(259.587269, 5);
      expect(surface.screenshot).toHaveBeenCalledWith({ clip: redrawClip(box) });
    });

    it('polls the box-relative redraw region until the stroke reaches the backing store', async () => {
      const box: Box = { x: 12, y: 8, width: 500, height: 500 };
      const canvas = createLocatorMock({ boundingBox: vi.fn().mockResolvedValue(box) });
      const drawTool = createLocatorMock();
      const { surface, page } = createPageMock({
        getByTestId: byKey({ 'workspace-canvas': canvas, 'tool-button-draw': drawTool }, canvas),
        locator: byKey({ canvas }, canvas),
        screenshot: vi
          .fn()
          .mockResolvedValueOnce(await strokePng(false))
          .mockResolvedValue(await strokePng(true)),
      });

      await setupExportTest(page, createTestInfoMock());

      expect(surface.screenshot).toHaveBeenCalledTimes(2);
      expect(surface.screenshot).toHaveBeenCalledWith({ clip: redrawClip(box) });
      // Literal pin: a 500x500 box is taller than the document's aspect, so the document is
      // fitted to the width at `scale = 0.625` with a vertical letterbox of 62.5px. The line
      // therefore lands at canvas y 98.56, and the polled region is derived from that. The
      // old fixed 100,100 region sat BELOW the line here, so the wait passed without the
      // stroke ever reaching the backing store.
      const startOffset = documentToCanvasOffset(box, EXPORT_LINE_START.x, EXPORT_LINE_START.y);
      // The line's canvas span is (287.474333 - 123.203285) * 0.625 = 102.67, so the region is
      // ceil(102.67) + 40 = 143 wide and 40 tall, set 20px above and left of the line.
      expect(surface.screenshot).toHaveBeenCalledWith({
        clip: {
          x: 12 + Math.floor(startOffset.x) - 20,
          y: 8 + Math.floor(startOffset.y) - 20,
          width: 143,
          height: 40,
        },
      });
      expect(surface.waitForTimeout).toHaveBeenCalledWith(CANVAS_REDRAW_POLL_INTERVAL_MS);
    });

    it('throws when the canvas has no bounding box', async () => {
      const canvas = createLocatorMock({ boundingBox: vi.fn().mockResolvedValue(null) });
      const drawTool = createLocatorMock();
      const { surface, page } = createPageMock({
        getByTestId: byKey({ 'workspace-canvas': canvas, 'tool-button-draw': drawTool }, canvas),
        locator: byKey({ canvas }, canvas),
      });

      await expect(setupExportTest(page, createTestInfoMock())).rejects.toThrow('Canvas not found');
      expect(surface.mouse.down).not.toHaveBeenCalled();
    });

    it('rejects without drawing when the workspace canvas is not visible', async () => {
      const box: Box = { x: 0, y: 0, width: 500, height: 500 };
      const canvas = createLocatorMock({
        boundingBox: vi.fn().mockResolvedValue(box),
        isVisible: vi.fn().mockResolvedValue(false),
      });
      const drawTool = createLocatorMock();
      const { surface, page } = createPageMock({
        getByTestId: byKey({ 'workspace-canvas': canvas, 'tool-button-draw': drawTool }, canvas),
        locator: byKey({ canvas }, canvas),
      });

      await expect(setupExportTest(page, createTestInfoMock())).rejects.toThrow(/visible/);
      expect(drawTool.click).not.toHaveBeenCalled();
      expect(surface.mouse.move).not.toHaveBeenCalled();
    });
  });

  describe('exportAndVerify', () => {
    function createSaveDialogPage(
      options: {
        download?: DownloadSurface;
        saveDialogCount?: number;
        evaluate?: PageSurface['evaluate'];
      } = {}
    ): { surface: PageSurface; page: Page; dialog: Record<string, LocatorSurface>; download: DownloadSurface } {
      const fileMenuButton = createLocatorMock();
      const saveMenuButton = createLocatorMock();
      const filenameInput = createLocatorMock();
      const formatSelect = createLocatorMock();
      const submitButton = createLocatorMock();
      // Count 0 is the truth on a page the dialog has already unmounted from, which
      // is the state `exportAndVerify` reaches before it reads the file back.
      const saveDialog = createLocatorMock({ count: vi.fn().mockResolvedValue(options.saveDialogCount ?? 0) });
      const download = options.download ?? createDownloadMock(`${EXPORT_FILENAME}${PNG_FORMAT.extension}`);
      const { surface, page } = createPageMock({
        getByTestId: byKey(
          {
            'header-file-menu-button': fileMenuButton,
            'header-file-save-button': saveMenuButton,
            'save-dialog-filename-input': filenameInput,
            'save-dialog-format-select': formatSelect,
            'save-dialog-submit-button': submitButton,
            'save-dialog': saveDialog,
          },
          fileMenuButton
        ),
        waitForEvent: vi.fn().mockResolvedValue(download),
        ...(options.evaluate ? { evaluate: options.evaluate } : {}),
      });
      return {
        surface,
        page,
        dialog: { fileMenuButton, saveMenuButton, filenameInput, formatSelect, submitButton, saveDialog },
        download,
      };
    }

    it('saves the export, confirms the dialog closed and compares the pixels', async () => {
      const { surface, page, dialog, download } = createSaveDialogPage();
      const target = path.join(DOWNLOAD_DIRECTORY, `${EXPORT_FILENAME}${PNG_FORMAT.extension}`);

      const result = await exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock());

      expect(dialog.fileMenuButton.click).toHaveBeenCalled();
      expect(dialog.saveMenuButton.click).toHaveBeenCalled();
      expect(dialog.filenameInput.fill).toHaveBeenCalledWith(EXPORT_FILENAME);
      expect(dialog.formatSelect.selectOption).toHaveBeenCalledWith({ label: PNG_FORMAT.label });
      expect(dialog.submitButton.click).toHaveBeenCalled();
      expect(surface.waitForEvent).toHaveBeenCalledWith('download', { timeout: DOWNLOAD_TIMEOUT_MS });
      expect(surface.waitForEvent).toHaveBeenCalledWith('download', { timeout: DOWNLOAD_TIMEOUT_MS_LITERAL });
      expect(mocks.matchers.toBeNull).toHaveBeenCalled();
      expect(mocks.matchers.toBe).toHaveBeenCalledWith(PNG_FORMAT.extension);
      expect(download.saveAs).toHaveBeenCalledWith(target);
      // The dialog is located by its testid, never by its title. `getByRole('heading',
      // { name: 'Save File As...' })` matches the dialog only while that title is both a
      // heading and spelled exactly this; render it as a `<div>` or reword it and the
      // locator matches nothing, `toHaveCount(0)` passes forever with the dialog open,
      // and this assertion goes vacuous without a single line of the export flow changing.
      expect(surface.getByTestId).toHaveBeenCalledWith('save-dialog');
      expect(mocks.mockExpect).toHaveBeenCalledWith(dialog.saveDialog);
      expect(mocks.matchers.toHaveCount).toHaveBeenCalledWith(0);
      expect(surface.getByRole).not.toHaveBeenCalled();
      // And it is read after the submit, so it is observing a dialog that was open
      // and closed rather than one that was never there.
      expect(dialog.submitButton.click.mock.invocationCallOrder[0]).toBeLessThan(
        dialog.saveDialog.count.mock.invocationCallOrder[0]
      );
      expect(vi.mocked(readFile)).toHaveBeenCalledWith(target);
      expect(mocks.matchers.toBeGreaterThan).toHaveBeenCalledWith(MIN_EXPORT_BYTES);
      expect(surface.evaluate).toHaveBeenCalledTimes(1);
      const [compare, payload] = surface.evaluate.mock.calls[0];
      expect(typeof compare).toBe('function');
      expect(payload).toEqual(pixelPayload(PNG_FORMAT));
      expect(payload.mime).toBe('image/png');
      expect(mocks.matchers.toBe).toHaveBeenCalledWith(true);
      expect(result).toBe(target);
    });

    it.each([
      ['accepts an identical export', IDENTICAL_EXPORT, { ok: true }],
      ['rejects an export shifted by half its width', SHIFTED_EXPORT, { ok: false, reason: 'pixels-differ' }],
      ['accepts an export differing by exactly the per-channel tolerance', WITHIN_TOLERANCE_EXPORT, { ok: true }],
      [
        'rejects a fully transparent export as carrying no drawing',
        ALPHA_ONLY_EXPORT,
        { ok: false, reason: 'export-blank' },
      ],
    ] satisfies Array<[string, StubImage, PixelComparisonResult]>)(
      'pixel comparator %s',
      async (_label, exported, expected) => {
        const { surface, page } = createSaveDialogPage();
        await exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock());
        const [compare, payload] = surface.evaluate.mock.calls[0];

        stubCompareEnvironment({
          [SOURCE_DATA_URL]: IDENTICAL_EXPORT,
          [EXPORTED_PNG_DATA_URL]: exported,
        });

        // `toMatchObject`, not `toEqual`: `export-blank` carries a `detail` naming the two
        // ink counts, and asserting its exact shape here would make adding that detail a
        // breaking change. Its content is asserted separately, below.
        await expect(compare(payload)).resolves.toMatchObject(expected);
      }
    );

    /**
     * WHY THE INK GUARD EXISTS, as a number rather than a claim.
     *
     * The transparent export above has exactly the source's RGB everywhere, so the
     * differing-CHANNEL budget the export oracle used to consist of could not see it at
     * all: zero of the 196,608 colour channels differ, and the budget is 50,000. This test
     * counts them, so the claim in `MIN_EXPORT_INK_RATIO`'s docstring is falsifiable —
     * if a future change made the comparator read alpha as a colour channel, the count
     * here would move and so would the case above.
     */
    it('a fully transparent export differs from its source in zero colour channels, and the guard is what rejects it', async () => {
      const { surface, page } = createSaveDialogPage();
      await exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock());
      const [compare, payload] = surface.evaluate.mock.calls[0];

      stubCompareEnvironment({
        [SOURCE_DATA_URL]: IDENTICAL_EXPORT,
        [EXPORTED_PNG_DATA_URL]: ALPHA_ONLY_EXPORT,
      });

      let differing = 0;
      for (let index = 0; index < IDENTICAL_EXPORT.pixels.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          if (
            Math.abs(IDENTICAL_EXPORT.pixels[index + channel] - ALPHA_ONLY_EXPORT.pixels[index + channel]) >
            CHANNEL_DELTA_TOLERANCE
          ) {
            differing += 1;
          }
        }
      }
      expect(differing, 'the colour budget alone would have passed this export').toBe(0);
      expect(differing).toBeLessThan(payload.threshold);
      await expect(compare(payload)).resolves.toMatchObject({ ok: false, reason: 'export-blank' });
    });

    it('rejects an export that dropped most of a small mark, which the channel budget cannot see', async () => {
      const { surface, page } = createSaveDialogPage();
      await exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock());
      const [compare, payload] = surface.evaluate.mock.calls[0];

      // A SPARSE mark, which is the shape that matters. The ink guard exists because a mark
      // small enough that removing it moves few colour channels defeats a budget expressed
      // in channels: on the real 800x600 fixture the line covers 1,911 of 480,000 pixels, so
      // erasing it entirely is 5,733 differing channels against a budget of 50,000. Here the
      // mark is 40x40 and 1,200 of its 1,600 pixels are missing, which is 3,600 channels —
      // an order of magnitude inside the budget, and a 75% loss of the drawing.
      const source = sparseMark(40);
      const eroded = sparseMark(10);

      let differing = 0;
      for (let index = 0; index < source.pixels.length; index += 4) {
        for (let channel = 0; channel < 3; channel += 1) {
          if (Math.abs(source.pixels[index + channel] - eroded.pixels[index + channel]) > CHANNEL_DELTA_TOLERANCE) {
            differing += 1;
          }
        }
      }
      expect(differing, 'this much lost ink must be invisible to the channel budget').toBeLessThan(payload.threshold);

      stubCompareEnvironment({ [SOURCE_DATA_URL]: source, [EXPORTED_PNG_DATA_URL]: eroded });
      const result = (await compare(payload)) as { ok: boolean; reason?: string; detail?: string };
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('export-blank');
      expect(result.detail).toContain('100 inked pixels');
    });

    it('names the ink counts in the blank-export failure, so the report says which side is empty', async () => {
      const { surface, page } = createSaveDialogPage();
      await exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock());
      const [compare, payload] = surface.evaluate.mock.calls[0];

      stubCompareEnvironment({
        [SOURCE_DATA_URL]: IDENTICAL_EXPORT,
        [EXPORTED_PNG_DATA_URL]: ALPHA_ONLY_EXPORT,
      });

      const result = (await compare(payload)) as { ok: boolean; detail?: string };
      expect(result.detail).toContain('0 inked pixels');
      expect(result.detail).toContain(`${COMPARE_IMAGE_SIZE}x${COMPARE_IMAGE_SIZE}`);
    });

    it('pixel comparator decodes the export with the format mime type', async () => {
      const { surface, page } = createSaveDialogPage();
      await exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock());
      const [compare, payload] = surface.evaluate.mock.calls[0];

      const requestedSources = stubCompareEnvironment({
        [SOURCE_DATA_URL]: IDENTICAL_EXPORT,
        [EXPORTED_PNG_DATA_URL]: IDENTICAL_EXPORT,
      });

      await expect(compare(payload)).resolves.toEqual({ ok: true });
      expect(requestedSources).toEqual([SOURCE_DATA_URL, EXPORTED_PNG_DATA_URL]);
    });

    it('pixel comparator reports an unavailable canvas context as its own failure, not a pixel mismatch', async () => {
      const { surface, page } = createSaveDialogPage();
      await exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock());
      const [compare, payload] = surface.evaluate.mock.calls[0];

      stubCompareEnvironment(
        { [SOURCE_DATA_URL]: IDENTICAL_EXPORT, [EXPORTED_PNG_DATA_URL]: IDENTICAL_EXPORT },
        { contextAvailable: false }
      );

      await expect(compare(payload)).resolves.toEqual({ ok: false, reason: 'context-unavailable' });
    });

    it('pixel comparator rejects when the export cannot be decoded', async () => {
      const { surface, page } = createSaveDialogPage();
      await exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock());
      const [compare, payload] = surface.evaluate.mock.calls[0];

      stubCompareEnvironment({ [SOURCE_DATA_URL]: IDENTICAL_EXPORT });

      await expect(compare(payload)).rejects.toThrow('Browser cannot decode exported image');
    });

    it('accepts a download whose suggested file name uses upper-case extension characters', async () => {
      const upperCaseName = `${EXPORT_FILENAME}.PNG`;
      const { page } = createSaveDialogPage({ download: createDownloadMock(upperCaseName) });

      const result = await exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock());

      expect(mocks.matchers.toBe).toHaveBeenCalledWith(PNG_FORMAT.extension);
      expect(result).toBe(path.join(DOWNLOAD_DIRECTORY, upperCaseName));
    });

    it('verifies the container in Node for a format the browser cannot decode, without touching the browser', async () => {
      const download = createDownloadMock(`${EXPORT_FILENAME}${TIFF_FORMAT.extension}`);
      const { surface, page, dialog } = createSaveDialogPage({ download });
      const target = path.join(DOWNLOAD_DIRECTORY, `${EXPORT_FILENAME}${TIFF_FORMAT.extension}`);
      // Restored in a `finally` rather than left to the next test: `beforeEach` only
      // CLEARS mock calls, so a `mockResolvedValue` set here outlives the test and the
      // ICO byte comparisons further down would compare a TIFF against a stub keyed on
      // the PNG's base64.
      const restore = vi.mocked(readFile).getMockImplementation();
      vi.mocked(readFile).mockResolvedValue((await containerTiff(CONTAINER_IMAGE_SIZE)) as Buffer<ArrayBuffer>);
      try {
        const result = await exportAndVerify(
          page,
          TIFF_FORMAT,
          await drawnSourceDataUrl(),
          DOWNLOAD_DIRECTORY,
          createTestInfoMock()
        );

        expect(dialog.formatSelect.selectOption).toHaveBeenCalledWith({ label: TIFF_FORMAT.label });
        expect(mocks.matchers.toBe).toHaveBeenCalledWith(TIFF_FORMAT.extension);
        expect(download.saveAs).toHaveBeenCalledWith(target);
        expect(vi.mocked(readFile)).toHaveBeenCalledWith(target);
        expect(mocks.matchers.toBeGreaterThan).toHaveBeenCalledWith(MIN_EXPORT_BYTES);
        // The browser never decoded this format and never will; that is the whole reason
        // `verification: 'container'` exists.
        expect(surface.evaluate).not.toHaveBeenCalled();
        expect(result).toBe(target);
      } finally {
        vi.mocked(readFile).mockImplementation(restore ?? (async () => mocks.exportedFile));
      }
    });

    it('rejects a container export that carries no drawing, without reaching the browser', async () => {
      const download = createDownloadMock(`${EXPORT_FILENAME}${TIFF_FORMAT.extension}`);
      const { surface, page } = createSaveDialogPage({ download });
      // A structurally PERFECT TIFF of blank canvas. On the real fixture it is 1,921,000
      // bytes, and it clears the `> 100` byte floor by four orders of magnitude. It is the
      // exact case that used to pass, because a byte-length floor and a file extension
      // were the whole of TIFF's verification.
      const blank = await containerTiff(CONTAINER_IMAGE_SIZE, { blank: true });
      const restore = vi.mocked(readFile).getMockImplementation();
      vi.mocked(readFile).mockResolvedValue(blank as Buffer<ArrayBuffer>);
      try {
        await expect(
          exportAndVerify(page, TIFF_FORMAT, await drawnSourceDataUrl(), DOWNLOAD_DIRECTORY, createTestInfoMock())
        ).rejects.toThrow('TIFF: the TIFF raster carries 0 inked pixels');
      } finally {
        vi.mocked(readFile).mockImplementation(restore ?? (async () => mocks.exportedFile));
      }
      expect(surface.evaluate).not.toHaveBeenCalled();
    });

    it('rejects when the save dialog is still open after submitting', async () => {
      const { page, download } = createSaveDialogPage({ saveDialogCount: 1 });

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow('expected count 0, received 1');

      expect(download.saveAs).toHaveBeenCalled();
    });

    it('rejects without touching the filesystem when the download never arrives', async () => {
      const { surface, page, dialog, download } = createSaveDialogPage();
      surface.waitForEvent.mockRejectedValue(new Error('download event timed out'));

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow('download event timed out');

      expect(dialog.submitButton.click).toHaveBeenCalled();
      expect(download.saveAs).not.toHaveBeenCalled();
      expect(vi.mocked(readFile)).not.toHaveBeenCalled();
    });

    it('rejects without saving when the browser reports a download failure', async () => {
      const { page, download } = createSaveDialogPage({
        download: createDownloadMock(`${EXPORT_FILENAME}${PNG_FORMAT.extension}`, 'canceled'),
      });

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow(`${PNG_FORMAT.label}: download failed`);

      expect(download.saveAs).not.toHaveBeenCalled();
      expect(vi.mocked(readFile)).not.toHaveBeenCalled();
    });

    it('rejects when the downloaded file does not carry the format extension', async () => {
      const { page, download } = createSaveDialogPage({
        download: createDownloadMock(`${EXPORT_FILENAME}.jpg`),
      });

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow(`expected ${JSON.stringify(PNG_FORMAT.extension)}`);

      expect(download.saveAs).not.toHaveBeenCalled();
    });

    it('rejects when the browser reports no filename for the download', async () => {
      const { page, download } = createSaveDialogPage({ download: createDownloadMock('') });

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow(`expected ${JSON.stringify(PNG_FORMAT.extension)}, received ""`);

      expect(download.saveAs).not.toHaveBeenCalled();
    });

    it('rejects when the save dialog exposes no filename field', async () => {
      const { page, dialog, download } = createSaveDialogPage();
      dialog.filenameInput.fill.mockRejectedValue(new Error('filename input is missing'));

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow('filename input is missing');

      expect(dialog.submitButton.click).not.toHaveBeenCalled();
      expect(download.saveAs).not.toHaveBeenCalled();
    });

    it('rejects before downloading when the format argument is missing', async () => {
      const { surface, page, download } = createSaveDialogPage();
      const missingFormat: ExportFormat | undefined = undefined;

      await expect(
        exportAndVerify(page, missingFormat!, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow(TypeError);

      expect(surface.waitForEvent).not.toHaveBeenCalled();
      expect(download.saveAs).not.toHaveBeenCalled();
    });

    it('rejects without reading the file when saving the download fails', async () => {
      const { page, download } = createSaveDialogPage();
      download.saveAs.mockRejectedValue(new Error('EACCES: permission denied'));

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow('EACCES: permission denied');

      expect(vi.mocked(readFile)).not.toHaveBeenCalled();
    });

    it('rejects when the exported file is empty', async () => {
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.alloc(0));
      const { page, download } = createSaveDialogPage();

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow(`${PNG_FORMAT.label} file should not be empty`);

      expect(download.saveAs).toHaveBeenCalled();
    });

    it('rejects a BLANK export, which the byte-length check and the pixel comparison both accept', async () => {
      // 776 bytes, so it clears the byte-length floor; and the COLOUR budget would accept it
      // too — at `CHANGED_CHANNEL_THRESHOLD_GENERAL` a blank differs from a sparse drawing in far
      // fewer than 50,000 of the channels, so an oracle that counts DIFFERENCED channels cannot
      // see it. What rejects it is the visible-ink oracle, which counts inked pixels.
      //
      // So the comparison must really run here, and that is why this test does not stub
      // `evaluate`. A stub answering `ok: true` would pass, because under this schema the ink
      // verdict IS the comparison's own rather than a separate guard in front of it.
      const blank = await blankExportedFile();
      vi.mocked(readFile).mockResolvedValueOnce(blank);
      const { page } = createSaveDialogPage({
        // The comparator is INVOKED here, against the stubbed globals below, rather than
        // answered from a canned verdict — which is what makes this a test of the oracle
        // instead of a test of the plumbing.
        evaluate: vi.fn(async (compare, payload) => compare(payload)),
      });

      stubCompareEnvironment({
        [SOURCE_DATA_URL]: IDENTICAL_EXPORT,
        // Built from the bytes the byte-length check just accepted, so the stub cannot drift
        // away from the file being verified.
        [`data:image/png;base64,${blank.toString('base64')}`]: BLANK_EXPORT,
      });

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow(`${PNG_FORMAT.label}: the export carries none of the drawing`);
    });

    it('rejects with the environment cause when the browser gives no canvas context to compare in', async () => {
      const { page } = createSaveDialogPage({
        evaluate: vi.fn().mockResolvedValue({ ok: false, reason: 'context-unavailable' }),
      });

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow(`${PNG_FORMAT.label}: the browser provided no 2d canvas context to compare the export against`);
    });

    it('rejects with the colour cause when the exported pixels differ from the source', async () => {
      const { page } = createSaveDialogPage({
        evaluate: vi.fn().mockResolvedValue({ ok: false, reason: 'pixels-differ' }),
      });

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow(`${PNG_FORMAT.label}: pixels differ too much from source`);
    });

    it('attaches the exported bytes only when the pixel comparison failed', async () => {
      const passing = createTestInfoMock();
      const { page: passingPage } = createSaveDialogPage({ evaluate: vi.fn().mockResolvedValue({ ok: true }) });

      await exportAndVerify(passingPage, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, passing);

      expect(passing.attach).not.toHaveBeenCalled();

      const failing = createTestInfoMock();
      const { page: failingPage } = createSaveDialogPage({
        evaluate: vi.fn().mockResolvedValue({ ok: false, reason: 'pixels-differ' }),
      });

      await expect(
        exportAndVerify(failingPage, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, failing)
      ).rejects.toThrow(`${PNG_FORMAT.label}: pixels differ too much from source`);

      expect(failing.attach).toHaveBeenCalledTimes(1);
      expect(failing.attach).toHaveBeenCalledWith(`${PNG_FORMAT.label}-pixel-comparison-failed`, {
        body: mocks.exportedFile,
        contentType: 'image/png',
      });
    });
  });

  /**
   * P3 — AVIF is a slower encoder than PNG but uses the same 30s download timeout
   * as every other format. `submitSaveDialogForDownload` accepts a `timeoutMs`
   * override, but `exportAndVerify` never passes one — so AVIF gets no headroom
   * even though its encoder can take longer than the 1px-wide black line the
   * fixture produces. This test pins the current behaviour: the default timeout
   * is `DOWNLOAD_TIMEOUT_MS` for every format, and a caller can override it through
   * the dedicated parameter.
   */
  describe('submitSaveDialogForDownload', () => {
    function createSubmitPage(format = PNG_FORMAT): { surface: PageSurface; page: Page; download: DownloadSurface } {
      const submitButton = createLocatorMock();
      const download = createDownloadMock(`${EXPORT_FILENAME}${format.extension}`);
      const { surface, page } = createPageMock({
        getByTestId: byKey({ 'save-dialog-submit-button': submitButton }, submitButton),
        waitForEvent: vi.fn().mockResolvedValue(download),
      });
      return { surface, page, download };
    }

    it('waits for the download with the default DOWNLOAD_TIMEOUT_MS for AVIF', async () => {
      // AVIF is listed as `browser-pixels` in the format table, so it goes through
      // the same `submitSaveDialogForDownload` path as PNG. Its encoder is
      // measurably slower (libavif vs libpng), but the helper gives it the same
      // 30s budget — a potential flakiness source on a loaded CI runner.
      const { surface, page, download } = createSubmitPage(AVIF_FORMAT);

      await submitSaveDialogForDownload(page, AVIF_FORMAT);

      expect(surface.waitForEvent).toHaveBeenCalledWith('download', { timeout: DOWNLOAD_TIMEOUT_MS });
      expect(download.failure).toHaveBeenCalled();
      expect(download.suggestedFilename).toHaveBeenCalled();
      expect(download.saveAs).not.toHaveBeenCalled();
    });

    it('accepts a custom timeoutMs override for slower formats', async () => {
      // The parameter exists and is forwarded; a caller could pass 60_000 for AVIF
      // if the default ever proves too tight in practice. This pins that the
      // override reaches `waitForEvent` and not just the default.
      const customTimeout = 60_000;
      const { surface, page, download } = createSubmitPage(AVIF_FORMAT);

      await submitSaveDialogForDownload(page, AVIF_FORMAT, { timeoutMs: customTimeout });

      expect(surface.waitForEvent).toHaveBeenCalledWith('download', { timeout: customTimeout });
      expect(download.failure).toHaveBeenCalled();
      expect(download.suggestedFilename).toHaveBeenCalled();
    });

    it('propagates a download timeout as a rejected promise', async () => {
      const { surface, page } = createSubmitPage(AVIF_FORMAT);
      surface.waitForEvent.mockRejectedValueOnce(new Error('download event timed out'));

      await expect(submitSaveDialogForDownload(page, AVIF_FORMAT)).rejects.toThrow('download event timed out');
    });
  });

  describe('setupIcoTest', () => {
    function createIcoPage(box: Box | null): {
      surface: PageSurface;
      page: Page;
      newImage: Record<string, LocatorSurface>;
      prompt: Record<string, LocatorSurface>;
      canvas: LocatorSurface;
    } {
      const fileMenuButton = createLocatorMock();
      const newImageButton = createLocatorMock();
      const widthInput = createLocatorMock();
      const heightInput = createLocatorMock();
      const newImageSubmit = createLocatorMock();
      const drawTool = createLocatorMock();
      // The unsaved-changes prompt the app shows instead of a native `confirm()`.
      // `count: 0` is the truth on the page `acceptDiscardPrompt` leaves behind — the same
      // convention `createSaveDialogPage` uses for `save-dialog` — and it is what makes the
      // helper's closing "the prompt is gone" check pass rather than silently skip.
      const confirmDialog = createLocatorMock({ count: vi.fn().mockResolvedValue(0) });
      const discardButton = createLocatorMock();
      const cancelButton = createLocatorMock();
      const canvas = createLocatorMock({
        boundingBox: vi.fn().mockResolvedValue(box),
        // The ICON document, not the export fixture's: `setupIcoTest` reads the backing
        // store to learn the size it maps the stroke through, and the shared default hands
        // out the 800x600 export canvas. Reading 800x600 here mapped the icon's 256x256
        // stroke through a fit for the wrong document.
        evaluate: vi.fn(async (fn: (element: unknown) => unknown) =>
          (fn as (element: { width: number; height: number; toDataURL: () => string }) => unknown)({
            width: ICON_CANVAS_SIZE,
            height: ICON_CANVAS_SIZE,
            toDataURL: () => SOURCE_DATA_URL,
          })
        ),
      });
      const { surface, page } = createPageMock({
        getByTestId: byKey(
          {
            'header-file-menu-button': fileMenuButton,
            'header-file-new-button': newImageButton,
            'confirm-dialog': confirmDialog,
            'confirm-dialog-confirm-button': discardButton,
            'confirm-dialog-cancel-button': cancelButton,
            'new-image-width-input': widthInput,
            'new-image-height-input': heightInput,
            'new-image-dialog-submit-button': newImageSubmit,
            'workspace-canvas': canvas,
            'tool-button-draw': drawTool,
          },
          canvas
        ),
        locator: byKey({ canvas }, canvas),
      });
      return {
        surface,
        page,
        newImage: { fileMenuButton, newImageButton, widthInput, heightInput, newImageSubmit },
        prompt: { confirmDialog, discardButton, cancelButton },
        canvas,
      };
    }

    /**
     * The redraw region `setupIcoTest` polls, derived from the MAPPED stroke. It replaced
     * the shared `CANVAS_REDRAW_CLIP`, whose fixed 100,100 300x100 box-relative region does
     * not cover a stroke at box row 291 of a 583-tall box — the wait would poll a region
     * the stroke never touched, which is what a dark pixel elsewhere in that region can
     * satisfy without the stroke having reached the backing store.
     */
    function iconRedrawClip(box: Box, documentSize = { width: ICON_CANVAS_SIZE, height: ICON_CANVAS_SIZE }): Box {
      const start = documentToCanvasOffset(box, ICON_STROKE.startX, ICON_STROKE.centerY, documentSize);
      const end = documentToCanvasOffset(box, ICON_STROKE.endX, ICON_STROKE.centerY, documentSize);
      return {
        x: box.x + Math.floor(start.x) - 20,
        y: box.y + Math.floor(start.y) - 20,
        width: Math.ceil(end.x - start.x) + 40,
        height: 40,
      };
    }

    /** The client coordinates `setupIcoTest` should stroke between, in DOCUMENT space. */
    function mappedStroke(box: Box, documentSize = { width: ICON_CANVAS_SIZE, height: ICON_CANVAS_SIZE }) {
      return {
        start: documentToCanvasOffset(box, ICON_STROKE.startX, ICON_STROKE.centerY, documentSize),
        end: documentToCanvasOffset(box, ICON_STROKE.endX, ICON_STROKE.centerY, documentSize),
      };
    }

    it('creates a 256px icon canvas, strokes it with the icon stroke offsets and returns the data url', async () => {
      const box: Box = { x: 24, y: 36, width: ICON_CANVAS_SIZE, height: ICON_CANVAS_SIZE };
      const { surface, page, newImage, canvas } = createIcoPage(box);

      const result = await setupIcoTest(page);

      expect(surface.goto).toHaveBeenCalledWith('/', { waitUntil: 'domcontentloaded' });
      expect(newImage.fileMenuButton.click).toHaveBeenCalled();
      expect(newImage.newImageButton.click).toHaveBeenCalled();
      expect(newImage.widthInput.fill).toHaveBeenCalledWith(String(ICON_CANVAS_SIZE));
      expect(newImage.heightInput.fill).toHaveBeenCalledWith(String(ICON_CANVAS_SIZE));
      expect(newImage.newImageSubmit.click).toHaveBeenCalled();
      expect(mocks.mockExpect).toHaveBeenCalledWith(canvas);
      const stroke = mappedStroke(box);
      expect(surface.mouse.move.mock.calls).toEqual([
        [box.x + stroke.start.x, box.y + stroke.start.y],
        [box.x + stroke.end.x, box.y + stroke.end.y, { steps: ICON_STROKE.steps }],
      ]);
      expect(surface.mouse.down).toHaveBeenCalled();
      expect(surface.mouse.up).toHaveBeenCalled();
      expect(surface.screenshot).toHaveBeenCalledWith({ clip: iconRedrawClip(box) });
      expect(canvas.evaluate).toHaveBeenCalled();
      expect(result).toBe(SOURCE_DATA_URL);
    });

    /**
     * THE REGRESSION PIN for the icon stroke, and the reason the offsets are document
     * pixels.
     *
     * `ICON_STROKE` used to be applied as CANVAS-BOX offsets on a 974x583 box holding a
     * 256x256 document, through a fit of `scale = 2.27734375, offsetX = 195.5`. Box
     * offset 60 is document x `(60 - 195.5) / 2.27734375 = -59.499` and box offset 196 is
     * document x `+0.220`, so the whole stroke sat to the LEFT of the document's left
     * edge and the icon it produced carried 63 inked pixels instead of 1,446.
     *
     * Both halves of that are asserted here. `inside` is the property the fixture needs;
     * `outside` is the arithmetic that made the box-relative reading fail, so restoring it
     * is a red on the `outside` line and not a silent pass.
     */
    it('maps the icon stroke through the app fit, so the mark lands inside the 256x256 document', async () => {
      const box: Box = { x: 56, y: 100, width: 974, height: 583 };
      const { surface, page } = createIcoPage(box);
      const documentSize = { width: ICON_CANVAS_SIZE, height: ICON_CANVAS_SIZE };
      const fit = containFit(box, documentSize);

      await setupIcoTest(page);

      // The box-relative reading, for the record. `x` is the document column it addressed.
      const boxRelative = {
        startX: (ICON_STROKE.startX - fit.offsetX) / fit.scale,
        endX: (ICON_STROKE.endX - fit.offsetX) / fit.scale,
      };
      expect(boxRelative.startX).toBeLessThan(0);
      expect(boxRelative.endX).toBeLessThan(1);

      // What was drawn instead, inverted back to document columns.
      const [first, second] = surface.mouse.move.mock.calls;
      const documentOf = (client: number, origin: number, offset: number) => (client - origin - offset) / fit.scale;
      expect(documentOf(first[0], box.x, fit.offsetX)).toBe(ICON_STROKE.startX);
      expect(documentOf(second[0], box.x, fit.offsetX)).toBe(ICON_STROKE.endX);
      for (const client of [first[1], second[1]]) {
        const documentY = documentOf(client, box.y, fit.offsetY);
        expect(documentY).toBe(ICON_STROKE.centerY);
        expect(documentY).toBeGreaterThanOrEqual(0);
        expect(documentY).toBeLessThanOrEqual(ICON_CANVAS_SIZE);
      }
      for (const client of [first[0], second[0]]) {
        const documentX = documentOf(client, box.x, fit.offsetX);
        expect(documentX).toBeGreaterThanOrEqual(0);
        expect(documentX).toBeLessThanOrEqual(ICON_CANVAS_SIZE);
      }
    });

    it('answers the in-app unsaved-changes prompt with Discard, between File > New and the first field', async () => {
      const box: Box = { x: 24, y: 36, width: ICON_CANVAS_SIZE, height: ICON_CANVAS_SIZE };
      const { surface, page, newImage, prompt } = createIcoPage(box);

      await setupIcoTest(page);

      // `File > New` asks before discarding a document that has unsaved changes, and
      // `src/App.tsx` seeds a blank image on boot, so the prompt is shown on the first
      // click of a fresh page. It used to be a native `confirm()` answered by a
      // `page.once('dialog', …)` handler; it is now the app's own modal
      // (`src/components/ConfirmDialog`), so the answer is a click on `Discard`.
      expect(mocks.mockExpect, 'the prompt is WAITED FOR, not clicked on sight').toHaveBeenCalledWith(
        prompt.confirmDialog,
        expect.any(String)
      );
      expect(prompt.discardButton.click).toHaveBeenCalledTimes(1);
      // The decline path is a different button and it must not be the one taken — the same
      // half of the old pin that `expect(dialog.dismiss).not.toHaveBeenCalled()` made.
      expect(prompt.cancelButton.click, 'the prompt is answered Discard, not Cancel').not.toHaveBeenCalled();

      // The ORDER is the pin, and it is two-sided. Discard cannot be clicked before the
      // menu item has asked, and the first field cannot be filled before the New Image
      // dialog has replaced the prompt — so neither of these two inversions can pass.
      expect(prompt.discardButton.click.mock.invocationCallOrder[0]).toBeGreaterThan(
        newImage.newImageButton.click.mock.invocationCallOrder[0]
      );
      expect(prompt.discardButton.click.mock.invocationCallOrder[0]).toBeLessThan(
        newImage.widthInput.fill.mock.invocationCallOrder[0]
      );

      // …and the helper then waits for the prompt to LEAVE, which is the assertion the
      // auto-dismissed native dialog could not make: a count of 0 on the prompt itself,
      // read after the answer rather than before it.
      expect(mocks.matchers.toHaveCount).toHaveBeenCalledWith(0);
      expect(mocks.matchers.toHaveCount.mock.invocationCallOrder[0]).toBeGreaterThan(
        prompt.discardButton.click.mock.invocationCallOrder[0]
      );

      // No native dialog handler is installed any more, and that is the assertion now
      // standing where the registration used to be asserted. `once` was scoped rather
      // than global precisely so an UNEXPECTED `confirm`/`prompt` would surface instead of
      // being swallowed; Playwright auto-dismisses an unhandled one, which the app reads as
      // "declined", so a surprise prompt cannot be accepted away by anything and stops
      // this helper at the very next step. A blanket handler is what would swallow it, and
      // pinning its ABSENCE is what keeps that from being reintroduced.
      expect(surface.once, 'no native dialog handler may be installed').not.toHaveBeenCalled();
      expect(surface.on, 'no native dialog handler may be installed').not.toHaveBeenCalled();
    });

    /**
     * The export is a function of the DOCUMENT, not of the frame — the same property
     * `setupExportTest` gets from `EXPORT_LINE_START`/`EXPORT_LINE_END`, and the one whose
     * absence the ICO fixture was quietly living with.
     *
     * The old assertion here was "not the canvas box centre", which is vacuous for an
     * icon: 128 IS the centre row of a 256-tall document, and at a box whose height binds
     * the fit it is also the centre row of the box. Two different boxes are compared
     * instead, and the claim is that both address the same document columns.
     */
    it('maps the same document stroke to different client coordinates at two canvas sizes', async () => {
      const wide: Box = { x: 10, y: 20, width: 512, height: 400 };
      const narrow: Box = { x: 10, y: 20, width: 320, height: 400 };
      const widePage = createIcoPage(wide);
      const narrowPage = createIcoPage(narrow);

      await setupIcoTest(widePage.page);
      await setupIcoTest(narrowPage.page);

      const documentColumnOf = (box: Box, client: number) => {
        const fit = containFit(box, { width: ICON_CANVAS_SIZE, height: ICON_CANVAS_SIZE });
        return (client - box.x - fit.offsetX) / fit.scale;
      };
      const wideStart = widePage.surface.mouse.move.mock.calls[0][0];
      const narrowStart = narrowPage.surface.mouse.move.mock.calls[0][0];
      expect(narrowStart, 'a narrower box really did move the stroke').not.toBe(wideStart);
      expect(documentColumnOf(wide, wideStart)).toBe(ICON_STROKE.startX);
      expect(documentColumnOf(narrow, narrowStart)).toBe(ICON_STROKE.startX);
    });

    it('throws when the icon canvas has no bounding box', async () => {
      const { surface, page } = createIcoPage(null);

      await expect(setupIcoTest(page)).rejects.toThrow('ICO canvas not found');
      expect(surface.mouse.down).not.toHaveBeenCalled();
    });

    it('rejects without drawing when the icon canvas is not visible', async () => {
      const box: Box = { x: 0, y: 0, width: ICON_CANVAS_SIZE, height: ICON_CANVAS_SIZE };
      const { surface, page, canvas } = createIcoPage(box);
      canvas.isVisible.mockResolvedValue(false);

      await expect(setupIcoTest(page)).rejects.toThrow(/visible/);
      expect(surface.mouse.move).not.toHaveBeenCalled();
    });
  });

  describe('exportIcoAndVerify', () => {
    function createIcoExportPage(
      options: {
        failure?: string | null;
        saveDialogCount?: number;
        evaluate?: PageSurface['evaluate'];
      } = {}
    ): { surface: PageSurface; page: Page; dialog: Record<string, LocatorSurface>; download: DownloadSurface } {
      const fileMenuButton = createLocatorMock();
      const saveMenuButton = createLocatorMock();
      const filenameInput = createLocatorMock();
      const formatSelect = createLocatorMock();
      const submitButton = createLocatorMock();
      // Same testid, same count-0 truth as the `exportAndVerify` fixture: the ICO flow
      // ends with a dialog that has unmounted, and the helper now has to say so.
      const saveDialog = createLocatorMock({ count: vi.fn().mockResolvedValue(options.saveDialogCount ?? 0) });
      const download = createDownloadMock(`${ICON_EXPORT_FILENAME}${icoFormat.extension}`, options.failure ?? null);
      const { surface, page } = createPageMock({
        getByTestId: byKey(
          {
            'header-file-menu-button': fileMenuButton,
            'header-file-save-button': saveMenuButton,
            'save-dialog-filename-input': filenameInput,
            'save-dialog-format-select': formatSelect,
            'save-dialog-submit-button': submitButton,
            'save-dialog': saveDialog,
          },
          fileMenuButton
        ),
        waitForEvent: vi.fn().mockResolvedValue(download),
        ...(options.evaluate ? { evaluate: options.evaluate } : {}),
      });
      return {
        surface,
        page,
        dialog: { fileMenuButton, saveMenuButton, filenameInput, formatSelect, submitButton, saveDialog },
        download,
      };
    }

    it('saves the ICO export and compares it with the ICO pixel threshold', async () => {
      const { surface, page, dialog, download } = createIcoExportPage();
      const target = path.join(DOWNLOAD_DIRECTORY, `${ICON_EXPORT_FILENAME}${icoFormat.extension}`);

      const result = await exportIcoAndVerify(page, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, testInfo);

      expect(dialog.fileMenuButton.click).toHaveBeenCalled();
      expect(dialog.saveMenuButton.click).toHaveBeenCalled();
      expect(dialog.filenameInput.fill).toHaveBeenCalledWith(ICON_EXPORT_FILENAME);
      expect(dialog.formatSelect.selectOption).toHaveBeenCalledWith({ label: icoFormat.label });
      expect(surface.waitForEvent).toHaveBeenCalledWith('download', { timeout: DOWNLOAD_TIMEOUT_MS });
      expect(surface.waitForEvent).toHaveBeenCalledWith('download', { timeout: DOWNLOAD_TIMEOUT_MS_LITERAL });
      expect(mocks.matchers.toBe).toHaveBeenCalledWith(icoFormat.extension);
      expect(download.saveAs).toHaveBeenCalledWith(target);
      // The ICO flow used to end on the download alone, with nothing proving the save
      // dialog had gone. It does the same job as `exportAndVerify`, so it makes the
      // same assertion, against the same testid.
      expect(surface.getByTestId).toHaveBeenCalledWith('save-dialog');
      expect(mocks.mockExpect).toHaveBeenCalledWith(dialog.saveDialog);
      expect(surface.getByRole).not.toHaveBeenCalled();
      expect(vi.mocked(readFile)).toHaveBeenCalledWith(target);
      expect(mocks.matchers.toBeGreaterThan).toHaveBeenCalledWith(MIN_EXPORT_BYTES);
      expect(surface.evaluate).toHaveBeenCalledTimes(1);
      const [compare, payload] = surface.evaluate.mock.calls[0];
      expect(typeof compare).toBe('function');
      expect(payload).toEqual(
        exportPixelPayload(SOURCE_DATA_URL, EXPORTED_BASE64, icoFormat.extension, CHANGED_CHANNEL_THRESHOLD_ICO)
      );
      expect(result).toBe(target);
    });

    it.each([
      ['accepts an identical icon', IDENTICAL_EXPORT, { ok: true }],
      ['rejects an icon shifted by half its width', SHIFTED_EXPORT, { ok: false, reason: 'pixels-differ' }],
    ] satisfies Array<[string, StubImage, PixelComparisonResult]>)(
      'ICO pixel comparator %s',
      async (_label, exported, expected) => {
        const { surface, page } = createIcoExportPage();
        await exportIcoAndVerify(page, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, testInfo);
        const [compare, payload] = surface.evaluate.mock.calls[0];

        const requestedSources = stubCompareEnvironment({
          [SOURCE_DATA_URL]: IDENTICAL_EXPORT,
          [EXPORTED_ICO_DATA_URL]: exported,
        });

        await expect(compare(payload)).resolves.toEqual(expected);
        expect(requestedSources).toEqual([SOURCE_DATA_URL, EXPORTED_ICO_DATA_URL]);
      }
    );

    it('ICO pixel comparator reports an unavailable canvas context as its own failure', async () => {
      const { surface, page } = createIcoExportPage();
      await exportIcoAndVerify(page, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, testInfo);
      const [compare, payload] = surface.evaluate.mock.calls[0];

      stubCompareEnvironment(
        { [SOURCE_DATA_URL]: IDENTICAL_EXPORT, [EXPORTED_ICO_DATA_URL]: IDENTICAL_EXPORT },
        { contextAvailable: false }
      );

      await expect(compare(payload)).resolves.toEqual({ ok: false, reason: 'context-unavailable' });
    });

    it('rejects when the save dialog is still open after the ICO download', async () => {
      // Without the dialog-closed assertion this resolves, and the pixel comparison
      // runs against an export whose dialog is still covering the document.
      const { page, download } = createIcoExportPage({ saveDialogCount: 1 });

      await expect(exportIcoAndVerify(page, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, testInfo)).rejects.toThrow(
        'expected count 0, received 1'
      );

      expect(download.saveAs).toHaveBeenCalled();
      expect(vi.mocked(readFile)).not.toHaveBeenCalled();
    });

    it('rejects without saving when the ICO download failed', async () => {
      const { page, download } = createIcoExportPage({ failure: 'canceled' });

      await expect(exportIcoAndVerify(page, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, testInfo)).rejects.toThrow(
        `${icoFormat.label}: download failed`
      );

      expect(download.saveAs).not.toHaveBeenCalled();
    });

    it('rejects when the saved ICO file is empty', async () => {
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.alloc(0));
      const { page } = createIcoExportPage();

      await expect(exportIcoAndVerify(page, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, testInfo)).rejects.toThrow(
        'ICO file should not be empty'
      );
    });

    it('rejects without reading the file when saving the ICO download fails', async () => {
      const { page, download } = createIcoExportPage();
      download.saveAs.mockRejectedValue(new Error('ENOSPC: no space left on device'));

      await expect(exportIcoAndVerify(page, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, testInfo)).rejects.toThrow(
        'ENOSPC: no space left on device'
      );

      expect(vi.mocked(readFile)).not.toHaveBeenCalled();
    });

    it('rejects with the environment cause when the browser gives no canvas context to compare in', async () => {
      const { page } = createIcoExportPage({
        evaluate: vi.fn().mockResolvedValue({ ok: false, reason: 'context-unavailable' }),
      });

      await expect(exportIcoAndVerify(page, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, testInfo)).rejects.toThrow(
        `${icoFormat.label}: the browser provided no 2d canvas context to compare the export against`
      );
    });

    it('rejects when the ICO pixels differ from the source', async () => {
      const { page } = createIcoExportPage({
        evaluate: vi.fn().mockResolvedValue({ ok: false, reason: 'pixels-differ' }),
      });

      await expect(exportIcoAndVerify(page, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, testInfo)).rejects.toThrow(
        'ICO: pixels differ too much from source'
      );
    });
  });

  describe('verifyPsdInPhotopea', () => {
    // `verifyPsdInPhotopea` reads the exported file's own header to learn the size it
    // expects the loaded document to have, so every test here needs real PSD bytes.
    // Restored afterwards: the module-level mock hands out `mocks.exportedFile` for the
    // byte comparisons elsewhere, and a leaked override would quietly change those.
    beforeEach(() => {
      vi.mocked(readFile).mockResolvedValue(PSD_FILE);
    });

    afterEach(() => {
      vi.mocked(readFile).mockImplementation(async () => mocks.exportedFile);
    });

    function createPhotopeaPage(options: { fileInputCount?: number; nameMatches?: number } = {}): {
      surface: PageSurface;
      page: Page;
      startButton: LocatorSurface;
      fileInput: LocatorSurface;
      nameLocator: LocatorSurface;
    } {
      const startButton = createLocatorMock();
      const fileInput = createLocatorMock({ count: vi.fn().mockResolvedValue(options.fileInputCount ?? 1) });
      const nameLocator = createLocatorMock({ count: vi.fn().mockResolvedValue(options.nameMatches ?? 1) });
      const { surface, page } = createPageMock({
        getByRole: byRole({ 'button:Start using Photopea': startButton }, startButton),
        getByText: vi.fn(() => nameLocator),
        locator: byKey({ 'input[type="file"]': fileInput }, fileInput),
      });
      return { surface, page, startButton, fileInput, nameLocator };
    }

    it('opens Photopea, starts the editor and uploads the PSD', async () => {
      const { surface, page, startButton, fileInput } = createPhotopeaPage();

      await verifyPsdInPhotopea(page, PSD_PATH);

      expect(surface.goto).toHaveBeenCalledWith(PHOTOPEA_URL, {
        waitUntil: 'domcontentloaded',
        timeout: PHOTOPEA_NAVIGATION_TIMEOUT_MS,
      });
      expect(startButton.click).toHaveBeenCalled();
      expect(surface.waitForFunction).toHaveBeenCalled();
      expect(surface.locator).toHaveBeenCalledWith('input[type="file"]');
      expect(fileInput.setInputFiles).toHaveBeenCalledWith(PSD_PATH);
    });

    it('asserts the file input is unique on the locator that is not capped at one match', async () => {
      const { page, fileInput } = createPhotopeaPage();

      await verifyPsdInPhotopea(page, PSD_PATH);

      // `.first()` caps the match set at one element, so `toHaveCount(1)` on the result
      // can only ever tell zero from one — the opposite of asserting uniqueness. The
      // mock's `.first()` reproduces that cap, so these two assertions distinguish the
      // locators that the defect was about; `mocks.matchers.toHaveCount` was pinned to
      // `(1)` alone, which is satisfied by the defective shape as well.
      expect(fileInput.first).not.toHaveBeenCalled();
      expect(mocks.mockExpect).toHaveBeenCalledWith(fileInput);
      expect(mocks.matchers.toHaveCount).toHaveBeenCalledWith(1);
      // The file goes to the same locator that was counted, not to a different one.
      expect(fileInput.setInputFiles).toHaveBeenCalledWith(PSD_PATH);
    });

    it.each([
      ['rejects when the page has no file input at all', 0],
      ['accepts exactly one file input', 1],
      ['rejects when the page has two file inputs', 2],
    ])('%s', async (_label, count) => {
      const { page, fileInput } = createPhotopeaPage({ fileInputCount: count });

      const run = verifyPsdInPhotopea(page, PSD_PATH);

      if (count === 1) {
        await expect(run).resolves.toBeUndefined();
      } else {
        // The two-file-input case is the load-bearing one: `.first()` caps it at one
        // match, so under the old code the upload would have gone to whichever input
        // came first and this test would have passed.
        await expect(run).rejects.toThrow(`expected count 1, received ${count}`);
      }
      expect(fileInput.setInputFiles).toHaveBeenCalledTimes(count === 1 ? 1 : 0);
    });

    it('identifies the loaded document by an exact name and by the size in the PSD header', async () => {
      const { surface, page, nameLocator } = createPhotopeaPage();

      await verifyPsdInPhotopea(page, PSD_PATH);

      // Not `page.locator('body')` and a substring: photopea.com is a third-party page
      // whose own chrome — a menu label, an advertisement, a recent-files entry — can
      // contain `drawing`, so a whole-page substring match passes with nothing loaded.
      expect(surface.getByText).toHaveBeenCalledWith(EXPORT_FILENAME, { exact: true });
      expect(surface.locator).not.toHaveBeenCalledWith('body');
      expect(mocks.mockExpect).toHaveBeenCalledWith(nameLocator);
    });

    it('accepts the document once the exact name is rendered at least once', async () => {
      const { page } = createPhotopeaPage({ nameMatches: 2 });

      // Photopea may render the name in more than one place, so the claim is existence
      // rather than a count of exactly one.
      await expect(verifyPsdInPhotopea(page, PSD_PATH)).resolves.toBeUndefined();
    });

    it('rejects when no element renders the document name at all', async () => {
      const { page, fileInput } = createPhotopeaPage({ nameMatches: 0 });

      await expect(verifyPsdInPhotopea(page, PSD_PATH)).rejects.toThrow('not.toHaveCount');

      expect(fileInput.setInputFiles).toHaveBeenCalledWith(PSD_PATH);
    });

    it('waits for a canvas whose backing store is the width and height in the PSD header', async () => {
      const { surface, page } = createPhotopeaPage();

      await verifyPsdInPhotopea(page, PSD_PATH);

      const [pageFunction, documentSize, options] = surface.waitForFunction.mock.calls[2];
      // The expected size comes from the file this function was handed, not from a
      // constant here, so it follows the document if its size ever changes.
      expect(documentSize).toEqual(EXPORTED_DOCUMENT_SIZE);
      expect(options).toEqual({ timeout: PHOTOPEA_DOCUMENT_TIMEOUT_MS_LITERAL });

      vi.stubGlobal('document', {
        querySelectorAll: () => [{ width: 512, height: 64 }, { ...EXPORTED_DOCUMENT_SIZE }],
      });
      expect(pageFunction(documentSize)).toBe(true);
      vi.stubGlobal('document', { querySelectorAll: () => [{ width: 512, height: 64 }] });
      expect(pageFunction(documentSize)).toBe(false);
      vi.stubGlobal('document', {
        querySelectorAll: () => [{ width: EXPORTED_DOCUMENT_SIZE.width, height: EXPORTED_DOCUMENT_SIZE.height - 1 }],
      });
      expect(pageFunction(documentSize)).toBe(false);
    });

    it('expects the document name derived from the psd path, not the export dialog default', async () => {
      const { surface, page } = createPhotopeaPage();

      await verifyPsdInPhotopea(page, '/tmp/export-unit/harbour-at-dusk.psd');

      expect(surface.getByText).toHaveBeenCalledWith('harbour-at-dusk', { exact: true });
      // A hardcoded 'drawing' would pass the first test above and fail this one.
      expect(surface.getByText).not.toHaveBeenCalledWith(EXPORT_FILENAME, expect.anything());
    });

    it('drops the extension and keeps interior dots when deriving the document name', async () => {
      const { surface, page } = createPhotopeaPage();

      await verifyPsdInPhotopea(page, '/tmp/export-unit/2026.09.27.sheet.psd');

      expect(surface.getByText).toHaveBeenCalledWith('2026.09.27.sheet', { exact: true });
    });

    it('takes the document size from the file, so a renamed export keeps its own dimensions', async () => {
      const { surface, page } = createPhotopeaPage();
      vi.mocked(readFile).mockResolvedValue(psdHeader(1024, 768));

      await verifyPsdInPhotopea(page, '/tmp/export-unit/panorama.psd');

      expect(surface.waitForFunction.mock.calls[2][1]).toEqual({ width: 1024, height: 768 });
    });

    it('rejects before navigating when the file is not a PSD', async () => {
      const { surface, page } = createPhotopeaPage();
      vi.mocked(readFile).mockResolvedValue(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));

      await expect(verifyPsdInPhotopea(page, '/tmp/export-unit/not-a-psd.psd')).rejects.toThrow('Not a PSD');

      expect(surface.goto).not.toHaveBeenCalled();
    });

    it('rejects before navigating when the file is too short to carry a PSD header', async () => {
      const { surface, page } = createPhotopeaPage();
      vi.mocked(readFile).mockResolvedValue(Buffer.from('8BPS'));

      await expect(verifyPsdInPhotopea(page, '/tmp/export-unit/truncated.psd')).rejects.toThrow('Not a PSD');

      expect(surface.goto).not.toHaveBeenCalled();
    });

    it('passes every readiness budget as waitForFunction options, not as the evaluation argument', async () => {
      const { surface, page } = createPhotopeaPage();

      await verifyPsdInPhotopea(page, PSD_PATH);

      expect(surface.waitForFunction).toHaveBeenCalledTimes(3);
      const [[, readyArg, readyOptions], [, apiArg, apiOptions], [, documentArg, documentOptions]] =
        surface.waitForFunction.mock.calls;
      expect(readyArg).toBeUndefined();
      expect(readyOptions).toEqual({ timeout: CANVAS_READY_TIMEOUT_MS });
      expect(apiArg).toBeUndefined();
      expect(apiOptions).toEqual({ timeout: PHOTOPEA_API_TIMEOUT_MS });
      // The third wait is the one that needs a value from Node, and it has to be passed
      // as the argument: a page function is evaluated in the browser, where a closure
      // over the expected size would silently be `undefined`.
      expect(documentArg).toEqual(EXPORTED_DOCUMENT_SIZE);
      expect(documentOptions).toEqual({ timeout: PHOTOPEA_DOCUMENT_TIMEOUT_MS_LITERAL });
    });

    it('accepts an editor canvas above the minimum size and rejects anything smaller', async () => {
      const { surface, page } = createPhotopeaPage();

      await verifyPsdInPhotopea(page, PSD_PATH);

      const [readyWhenCanvasIsLarge] = surface.waitForFunction.mock.calls[0];
      vi.stubGlobal('document', { querySelectorAll: () => [{ width: 512, height: 512 }] });
      expect(readyWhenCanvasIsLarge()).toBe(true);
      vi.stubGlobal('document', { querySelectorAll: () => [{ width: 512, height: 64 }] });
      expect(readyWhenCanvasIsLarge()).toBe(false);
      vi.stubGlobal('document', { querySelectorAll: () => [] });
      expect(readyWhenCanvasIsLarge()).toBe(false);
    });

    it('accepts the internal api from either the pea global or the app marker element', async () => {
      const { surface, page } = createPhotopeaPage();

      await verifyPsdInPhotopea(page, PSD_PATH);

      const [readyWhenApiIsExposed] = surface.waitForFunction.mock.calls[1];
      vi.stubGlobal('window', { pea: {} });
      vi.stubGlobal('document', { querySelector: () => null });
      expect(readyWhenApiIsExposed()).toBe(true);
      vi.stubGlobal('window', {});
      vi.stubGlobal('document', { querySelector: () => ({}) });
      expect(readyWhenApiIsExposed()).toBe(true);
      vi.stubGlobal('window', {});
      vi.stubGlobal('document', { querySelector: () => null });
      expect(readyWhenApiIsExposed()).toBe(false);
    });

    it('tolerates a Photopea build that never exposes its internal api', async () => {
      const { surface, page, fileInput } = createPhotopeaPage();
      surface.waitForFunction
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('waitForFunction: Timeout 10000ms exceeded'));

      await verifyPsdInPhotopea(page, PSD_PATH);

      expect(surface.waitForFunction).toHaveBeenCalledTimes(3);
      expect(fileInput.setInputFiles).toHaveBeenCalledWith(PSD_PATH);
    });

    it('rejects without starting the editor when the Photopea page fails to load', async () => {
      const { surface, page, startButton, fileInput } = createPhotopeaPage();
      surface.goto.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'));

      await expect(verifyPsdInPhotopea(page, PSD_PATH)).rejects.toThrow('net::ERR_CONNECTION_REFUSED');

      expect(startButton.click).not.toHaveBeenCalled();
      expect(fileInput.setInputFiles).not.toHaveBeenCalled();
    });

    it('rejects without uploading when the editor canvas never appears', async () => {
      const { surface, page, fileInput } = createPhotopeaPage();
      surface.waitForFunction.mockRejectedValueOnce(new Error('waitForFunction: Timeout 60000ms exceeded'));

      await expect(verifyPsdInPhotopea(page, PSD_PATH)).rejects.toThrow('waitForFunction: Timeout 60000ms exceeded');

      expect(fileInput.setInputFiles).not.toHaveBeenCalled();
    });

    it('rejects when the PSD upload fails', async () => {
      const { page, fileInput, nameLocator } = createPhotopeaPage();
      fileInput.setInputFiles.mockRejectedValue(new Error('ENOENT: no such file or directory'));

      await expect(verifyPsdInPhotopea(page, PSD_PATH)).rejects.toThrow('ENOENT: no such file or directory');

      expect(nameLocator.count).not.toHaveBeenCalled();
    });
  });

  /**
   * The two specs are Playwright tests, so nothing in this Node project can call them
   * and their behaviour cannot be exercised here. What can be pinned is their shape,
   * because both defects were structural: the ICO spec ran the whole export fixture and
   * discarded all of it, and the PSD skip carried 25 lines of rationale resting on a
   * premise that is no longer true. Both are read as source, because both are source.
   */
  describe('export spec shape', () => {
    const readSource = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

    it('does not run the export fixture in the ICO spec, which discards every step of it', () => {
      // Comments are stripped first: the spec explains why the fixture is gone, and
      // naming it there is the point, while calling or importing it is the defect.
      const code = readSource('ico.spec.ts').replace(/^\s*\/\/.*$/gm, '');
      const source = readSource('ico.spec.ts');

      // `setupIcoTest` opens its own 256x256 document, so `setupExportTest` drew the
      // export line, encoded a source data URL and navigated a second time only for
      // the ICO flow to throw all of it away and keep the download directory.
      expect(code).not.toMatch(/\bsetupExportTest\b/);
      expect(code).toMatch(/\bsetupIcoTest\b/);
      // The directory is prepared through the one function that CLEARS it. Hand-rolling
      // `mkdir` is what this replaced: a directory left behind in a reused `outputDir`
      // could satisfy a later read with a stale download.
      expect(code).toMatch(/\bprepareExportDownloadDirectory\b/);
      expect(code).not.toMatch(/\bmkdir\b/);
      expect(source).toContain('visual-regression.spec.ts');
    });

    it('reduces the PSD skip block to a short reason and a pointer at the full rationale', () => {
      const source = readSource('photopea.spec.ts');
      const beforeTheTest = source.slice(0, source.indexOf('test.skip'));
      const skipComment = beforeTheTest
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('//'));

      expect(skipComment.length).toBeLessThanOrEqual(6);
      expect(skipComment.join('\n')).toContain('consent modal');
      expect(skipComment.join('\n')).toContain('verifyPsdInPhotopea');
      expect(skipComment.join('\n')).toContain('./helpers');
      // The old block recommended "psd.js / psd-tools" and rested on there being no PSD
      // library available, which stopped being true when ag-psd became a root dependency.
      expect(source).not.toContain('psd.js');
      expect(source).not.toContain('psd-tools');
    });

    it('keeps the full PSD rationale on the helper, with the stale premise corrected', () => {
      const source = readSource('helpers.ts');

      expect(source).toContain('ag-psd@^31.0.2');
      expect(source).toContain('is a root dependency');
      expect(source).not.toContain('psd-tools');
    });
  });

  /**
   * The container oracle, which is the WHOLE content check for the two formats no browser
   * decodes.
   *
   * Before this existed, `exportAndVerify` made exactly two assertions for a `container`
   * format: `byteLength > 100`, and the file extension. On the 800x600 fixture a blank
   * export measures 1,921,000 bytes as a TIFF and 67,408 as a PSD, so every test below
   * describes a file that PASSED under that rule.
   */
  describe('exportByteVerifiers', () => {
    const CONTAINER_TIFF_FORMAT: ExportFormat = { label: 'TIFF', extension: '.tiff', verification: 'container' };
    const PSD_FORMAT: ExportFormat = {
      label: 'Photoshop PSD (layers)',
      extension: '.psd',
      verification: 'container',
    };

    const verifyTiff = (file: Buffer, sourceDataUrl: string) =>
      verifyExportContainer(CONTAINER_TIFF_FORMAT, file, sourceDataUrl);
    const verifyPsd = (file: Buffer, sourceDataUrl: string) => verifyExportContainer(PSD_FORMAT, file, sourceDataUrl);

    it('rejects a container format with no registered verifier rather than skipping it', async () => {
      const unregistered: ExportFormat = { label: 'WebP', extension: '.webp', verification: 'container' };
      await expect(verifyExportContainer(unregistered, Buffer.alloc(0), await drawnSourceDataUrl())).rejects.toThrow(
        'WebP: no container verifier is registered for .webp'
      );
    });

    it('rejects a source data URL with no base64 payload, rather than measuring nothing', async () => {
      await expect(verifyTiff(await containerTiff(CONTAINER_IMAGE_SIZE), 'data:image/png')).rejects.toThrow(
        'TIFF: the source canvas data URL has no base64 payload'
      );
    });

    /**
     * The byte order is read in FOUR places — the mark, the IFD offset, the entry count and
     * every entry's tag — so a verifier that handled only one of them would pass every
     * little-endian file it had ever been shown. Each is asserted to have been read, by
     * requiring the walk to get PAST all of them: the failure a big-endian file produces
     * must be the decode step and nothing before it.
     *
     * The decode is not asserted here, and this does not claim it. libvips rejects a
     * hand-built uncompressed TIFF, so the raster step in big-endian order is covered by
     * `structured-formats.spec.ts`, against the real encoder — whose output is big-endian.
     */
    it('walks a big-endian TIFF all the way to its raster, and only then fails', async () => {
      const file = bigEndianTiff(CONTAINER_IMAGE_SIZE, CONTAINER_IMAGE_SIZE, 0);
      expect(file.subarray(0, 4).toString('hex'), 'a real export is MM\\0*').toBe('4d4d002a');

      const failure = await verifyTiff(file, await drawnSourceDataUrl()).then(
        () => null,
        (error: Error) => error.message
      );

      // Not the mark, not the IFD offset, not the entry count, not a missing tag: the walk
      // read all of them correctly in this byte order and got to the raster.
      expect(failure).not.toContain('is not a TIFF');
      expect(failure).not.toContain('declares its first IFD at byte');
      expect(failure).not.toContain('IFD entries');
      expect(failure).not.toContain('is missing the');
      expect(failure).toContain('the TIFF raster');
    });

    it('rejects a big-endian file whose mark is corrupted, exactly as it does a little-endian one', async () => {
      const file = bigEndianTiff(CONTAINER_IMAGE_SIZE, CONTAINER_IMAGE_SIZE, 0);
      file.write('MM', 0, 'latin1');
      file[2] = 0x99;

      await expect(verifyTiff(file, await drawnSourceDataUrl())).rejects.toThrow(
        'TIFF: is not a TIFF: expected the II*\\0 or MM\\0* byte-order mark, read 4d4d992a'
      );
    });

    it('rejects a big-endian file whose IFD is empty, reading the count in that order too', async () => {
      const file = bigEndianTiff(CONTAINER_IMAGE_SIZE, CONTAINER_IMAGE_SIZE, 0);
      file.writeUInt16BE(0, 8);

      await expect(verifyTiff(file, await drawnSourceDataUrl())).rejects.toThrow(
        'TIFF: declares 0 IFD entries, fewer than the 5 a decodable image needs'
      );
    });

    it('accepts a TIFF whose raster carries the drawing', async () => {
      await expect(
        verifyTiff(await containerTiff(CONTAINER_IMAGE_SIZE), await drawnSourceDataUrl())
      ).resolves.toBeUndefined();
    });

    it('rejects a TIFF with the wrong byte-order mark', async () => {
      const file = await containerTiff(CONTAINER_IMAGE_SIZE);
      file.write('XY', 0, 'latin1');

      await expect(verifyTiff(file, await drawnSourceDataUrl())).rejects.toThrow(
        'TIFF: is not a TIFF: expected the II*\\0 or MM\\0* byte-order mark'
      );
    });

    it('rejects a TIFF that is shorter than a header', async () => {
      await expect(verifyTiff(Buffer.alloc(3), await drawnSourceDataUrl())).rejects.toThrow('TIFF: is not a TIFF');
    });

    it('rejects a TIFF whose IFD declares no entries', async () => {
      const file = await containerTiff(CONTAINER_IMAGE_SIZE);
      const { littleEndian, offset } = tiffIfd(file);
      writeTiffU16(file, littleEndian, offset, 0);

      await expect(verifyTiff(file, await drawnSourceDataUrl())).rejects.toThrow(
        'TIFF: declares 0 IFD entries, fewer than the 5 a decodable image needs'
      );
    });

    it('rejects a TIFF whose IFD points outside the file', async () => {
      const file = await containerTiff(CONTAINER_IMAGE_SIZE);
      const { littleEndian } = tiffIfd(file);
      writeTiffU32(file, littleEndian, 4, file.length + 1024);

      await expect(verifyTiff(file, await drawnSourceDataUrl())).rejects.toThrow(
        'TIFF: declares its first IFD at byte'
      );
    });

    it('rejects a TIFF whose IFD entries do not fit in the file', async () => {
      const file = await containerTiff(CONTAINER_IMAGE_SIZE);
      const { littleEndian, offset } = tiffIfd(file);
      const count = littleEndian ? file.readUInt16LE(offset) : file.readUInt16BE(offset);
      writeTiffU16(file, littleEndian, offset, 0xfff0);

      await expect(verifyTiff(file, await drawnSourceDataUrl())).rejects.toThrow(
        `TIFF: declares ${count === 0xfff0 ? count : 0xfff0} IFD entries, which do not fit in the`
      );
    });

    it('rejects a TIFF whose IFD omits the tags that describe a raster', async () => {
      const file = await containerTiff(CONTAINER_IMAGE_SIZE);
      const { littleEndian, offset } = tiffIfd(file);
      // Retag the first entry — ImageWidth — with an id nothing reads, without moving
      // anything, so the directory is intact but no longer names an image.
      writeTiffU16(file, littleEndian, offset + 2, 0x8888);

      await expect(verifyTiff(file, await drawnSourceDataUrl())).rejects.toThrow(
        'TIFF: its IFD is missing the ImageWidth tag'
      );
    });

    /**
     * THE CASE THAT MATTERS. A structurally perfect TIFF of blank canvas: a real
     * byte-order mark, a full 10-entry directory naming width, length, samples and strip
     * byte counts, and a raster that decodes to the right dimensions. Every header check
     * above passes, and on the real fixture it is 1,921,000 bytes — four orders of magnitude
     * clear of the `> 100` floor that used to be the only assertion this format had.
     */
    it('rejects a TIFF of blank canvas, which a header check cannot see', async () => {
      const file = await containerTiff(CONTAINER_IMAGE_SIZE, { blank: true });
      expect(file.byteLength).toBeGreaterThan(MIN_EXPORT_BYTES);

      await expect(verifyTiff(file, await drawnSourceDataUrl())).rejects.toThrow(
        'TIFF: the TIFF raster carries 0 inked pixels'
      );
    });

    it('rejects a TIFF of the wrong size', async () => {
      await expect(
        verifyTiff(await containerTiff(CONTAINER_IMAGE_SIZE * 2), await drawnSourceDataUrl())
      ).rejects.toThrow(
        `TIFF: the TIFF raster decodes to ${CONTAINER_IMAGE_SIZE * 2}x${CONTAINER_IMAGE_SIZE * 2}, not the source canvas's ${CONTAINER_IMAGE_SIZE}x${CONTAINER_IMAGE_SIZE}`
      );
    });

    it('rejects a TIFF whose raster cannot be decoded', async () => {
      const file = await containerTiff(CONTAINER_IMAGE_SIZE);
      await expect(verifyTiff(file.subarray(0, 4), await drawnSourceDataUrl())).rejects.toThrow('TIFF: is not a TIFF');
    });

    it('accepts a PSD carrying the drawn document', async () => {
      await expect(verifyPsd(containerPsd(), await drawnSourceDataUrl())).resolves.toBeUndefined();
    });

    it.each([
      ['a wrong signature', { signature: '8BPX' }, 'does not start with the 8BPS signature'],
      ['a wrong version', { version: 2 }, 'declares PSD version 2, not 1'],
      ['no channels', { channels: 0 }, 'declares 0 channels'],

      ['no layer and mask section', { layerAndMaskLength: 0 }, 'carries no layer and mask section'],
      [
        'a layer section that overruns the file',
        { layerAndMaskLength: 1_000_000 },
        // A regex, because the byte count is a function of the fixture and the label is
        // followed by it: `Photoshop PSD (layers): is 324 bytes, too short to hold ...`.
        /is \d+ bytes, too short to hold the layer and mask section it declares/,
      ],
      ['too few layers', { layerCount: 1 }, 'declares 1 layers, fewer than the 2 the drawn document has'],
      [
        'no drawing layer',
        {
          layerCount: 2,
          layers: [{ name: 'Blank 1' }, { name: 'shape 3' }] as Array<{ name: string }>,
        },
        'has no layer named "draw 2"; its layers are "Blank 1", "shape 3"',
      ],
    ] satisfies Array<[string, PsdOptions, string | RegExp]>)(
      'rejects a PSD with %s',
      async (_label, options, expected) => {
        const want = typeof expected === 'string' ? `Photoshop PSD (layers): ${expected}` : expected;
        await expect(verifyPsd(containerPsd(options), await drawnSourceDataUrl())).rejects.toThrow(want);
      }
    );

    it('rejects a drawing layer whose channels all declare zero bytes', async () => {
      // The rectangles stay real and only the channel LENGTHS are zeroed, so the
      // "carries no channel image data" check is the one that has to fire. Writing the file
      // with `skipLayerImageData` instead would also erase the raster, and the degenerate
      // rectangle would be reported first — which would make this test pass for the wrong
      // reason.
      const file = containerPsd();
      const drawing = psdRecordTops(file)[1];
      const channelCount = file.readUInt16BE(drawing + 16);
      for (let channel = 0; channel < channelCount; channel += 1) {
        file.writeUInt32BE(0, drawing + 18 + channel * 6 + 2);
      }

      await expect(verifyPsd(file, await drawnSourceDataUrl())).rejects.toThrow(
        'Photoshop PSD (layers): layer "draw 2" carries no channel image data'
      );
    });

    /**
     * A degenerate rectangle and one that leaves the document cannot be asked of
     * `writePsd` — it derives each layer's bounds from the raster it is handed — so the
     * bytes are patched after the write, at the offsets the same walk
     * `readPsdLayerRecords` performs. Each is a structural claim, so the failure names the
     * rectangle rather than anything about pixels.
     */
    it('rejects a PSD whose drawing layer has a degenerate rectangle', async () => {
      const file = containerPsd();
      const drawing = psdRecordTops(file)[1];
      file.writeInt32BE(2, drawing + 8); // bottom
      file.writeInt32BE(2, drawing); // top

      await expect(verifyPsd(file, await drawnSourceDataUrl())).rejects.toThrow(
        'Photoshop PSD (layers): layer "draw 2" has a degenerate 4x0 rectangle'
      );
    });

    it('rejects a PSD whose drawing layer lies outside the document', async () => {
      const file = containerPsd();
      const drawing = psdRecordTops(file)[1];
      file.writeInt32BE(99, drawing + 12); // right

      await expect(verifyPsd(file, await drawnSourceDataUrl())).rejects.toThrow(
        `Photoshop PSD (layers): layer "draw 2" spans (0,0)-(99,${CONTAINER_IMAGE_SIZE}), outside the ${CONTAINER_IMAGE_SIZE}x${CONTAINER_IMAGE_SIZE} document`
      );
    });

    /**
     * The PSD's SECOND pass, and the last hole `comparePixels: false` left open.
     *
     * The structural checks above all pass on this file: the signature, the section length,
     * the layer count, the name "draw 2", a non-degenerate rectangle inside the document,
     * and four channels with data in them. What it does not carry is a mark — the drawing
     * layer's raster is paper-coloured. Before the raster pass existed, this file passed the
     * whole of the PSD verifier, which is why the raster pass is here and not optional.
     */
    it('rejects a structurally valid PSD whose layers carry no drawing', async () => {
      // Every structural claim holds on this file: the signature, the section length, the
      // layer count, the name "draw 2", a non-degenerate rectangle inside the document, and
      // channels with data in them. What it does not carry is a mark — the drawing layer's
      // raster is paper-coloured. Before the raster pass existed this file passed the whole
      // of the PSD verifier, which is why the pass is here and not optional.
      const file = containerPsd({
        layerCount: 2,
        layers: [
          { name: 'Blank 1', fill: 255 },
          { name: 'draw 2', fill: 255 },
        ],
      });

      await expect(verifyPsd(file, await drawnSourceDataUrl())).rejects.toThrow(
        'Photoshop PSD (layers): its layers carry 0 inked pixels against the source'
      );
    });

    it('rejects a PSD whose drawing layer kept only a fraction of the mark', async () => {
      // The drawing layer is a quarter of the document's area rather than the whole of it.
      // The layer NAMES and the counts still hold, so only the ink ratio can see this.
      const file = containerPsd({
        layerCount: 2,
        layers: [
          { name: 'Blank 1', fill: 255 },
          { name: 'draw 2', fill: 0, right: CONTAINER_IMAGE_SIZE, bottom: CONTAINER_IMAGE_SIZE / 4 },
        ],
      });

      await expect(verifyPsd(file, await drawnSourceDataUrl())).rejects.toThrow(
        'Photoshop PSD (layers): its layers carry 4 inked pixels against the source'
      );
    });

    /**
     * The COMPOSITE, which is the document and was the one raster nothing looked at.
     *
     * The layer rasters and the flat composite are separate claims about the same bytes, and
     * the exporter writes both itself — `src/contexts/psd-utils.ts` hands `writePsd` the
     * flattened document canvas alongside the children. So a PSD can pass every layer check
     * above and still open as an empty image, because the composite every reader renders first
     * is blank. That is a false green of exactly the kind the raster pass was added to stop,
     * one level down.
     */
    it('rejects a PSD whose layers carry the drawing and whose flat composite does not', async () => {
      // Structurally perfect, and the drawing layer is solid black across the document, so the
      // whole layer oracle passes. The composite is paper-white: the file's layers are right and
      // its picture of the document is empty.
      const file = containerPsd({
        layerCount: 2,
        layers: [
          { name: 'Blank 1', fill: 255 },
          { name: 'draw 2', fill: 0 },
        ],
        compositeFill: 255,
      });

      await expect(verifyPsd(file, await drawnSourceDataUrl())).rejects.toThrow(
        'Photoshop PSD (layers): its flat composite carries 0 inked pixels against the source'
      );
    });

    it('accepts a PSD whose layers and flat composite both carry the drawing', async () => {
      // The other half, because an oracle nothing can satisfy is not an oracle. `containerPsd`'s
      // default leaves `writePsd` to synthesise a composite, so the inked one is stated.
      const file = containerPsd({
        layerCount: 2,
        layers: [
          { name: 'Blank 1', fill: 255 },
          { name: 'draw 2', fill: 0 },
        ],
        compositeFill: 0,
      });

      await expect(verifyPsd(file, await drawnSourceDataUrl())).resolves.toBeUndefined();
    });

    /**
     * P2 — a PSD whose draw layer is marked HIDDEN still passes verification.
     *
     * `verifyPsdExport` checks that the layer named "draw 2" exists, has channel
     * data, and carries ink — but it never reads the layer's visibility flag. In
     * the PSD spec that flag lives in the layer record's `flags` byte (bit 1,
     * 0x02). When set, Photoshop hides the layer; the pixels are still there on
     * disk but a reader respecting the flag renders them invisible.
     *
     * The verifier does not respect it either way, so a file whose draw layer is
     * hidden still passes. This is a latent wrong-pass: the composite may carry
     * the drawing (because ag-psd flattens before honouring visibility) while a
     * layer-level read shows nothing. This test pins the current behaviour —
     * the hidden flag is not checked — so a future fix must update this
     * assertion rather than silently accepting another class of defect.
     */
    it('accepts a PSD whose draw layer is flagged hidden, because visibility is not checked', async () => {
      const file = containerPsd();
      // The draw layer is the second record (index 1). Its flags byte sits at
      // recordTop + 18 + channelCount * 6 + 10, following the four int32 rect
      // fields, the uint16 channel count, the channel info array, the 4-byte
      // blend-mode signature, the 4-byte blend-mode key, 1 byte opacity and 1
      // byte clipping — so the flags byte is 10 bytes into the post-channel tail.
      const drawRecordTop = psdRecordTops(file)[1];
      const channelCount = file.readUInt16BE(drawRecordTop + 16);
      const flagsOffset = drawRecordTop + 18 + channelCount * 6 + 10;
      const currentFlags = file.readUInt8(flagsOffset);
      file.writeUInt8(currentFlags | 0x02, flagsOffset);
      expect(file.readUInt8(flagsOffset) & 0x02).toBe(0x02);

      // The file still passes: name, channel data, dimensions and rasters are all intact.
      await expect(verifyPsd(file, await drawnSourceDataUrl())).resolves.toBeUndefined();
    });

    it('rejects a PSD whose layer rasters cannot be decoded at all', async () => {
      // The channel data declares a compression word ag-psd does not accept. Every
      // structural check passes, so this is the only thing left that can reject it — which
      // is the point: a PSD whose bytes say the right things but carry no readable raster
      // must not pass.
      const file = containerPsd();
      // The drawing layer's first channel begins with a two-byte compression word; 9 is
      // not a compression scheme, so the raster cannot be decoded.
      file.writeUInt16BE(9, psdChannelDataAt(file, 1, 0));

      const failure = await verifyPsd(file, await drawnSourceDataUrl()).then(
        () => null,
        (error: Error) => error.message
      );
      expect(failure).not.toBeNull();
      expect(failure).not.toContain('8BPS');
      expect(failure).not.toContain('IFD');
      expect(failure).toMatch(/its layers (could not be decoded|carry \d+ inked pixels)/);
    });

    /**
     * THE OTHER CASE THAT MATTERS, and the second of the two formats that used to pass
     * unconditionally. A real zero-layer export declares 0 in its layer count, is 67,408
     * bytes on the fixture, and passed the `> 100` floor and the extension check.
     */
    it('rejects a zero-layer PSD, which a byte-length floor cannot see', async () => {
      const file = containerPsd({ layerCount: 0, layers: [] });
      expect(file.byteLength).toBeGreaterThan(MIN_EXPORT_BYTES);

      await expect(verifyPsd(file, await drawnSourceDataUrl())).rejects.toThrow(
        'Photoshop PSD (layers): declares 0 layers, fewer than the 2 the drawn document has'
      );
    });

    /**
     * P3 — the byte-length gate is one-sided: `file.byteLength > 100` is checked,
     * but there is no upper bound. `ag-psd`'s reader honours the offset fields in
     * the header and stops decoding where the declared structure ends, so trailing
     * bytes are silently ignored. This pins that a PSD padded to an absurd size
     * still passes every check — a latent correctness and resource issue if a
     * corrupt or malicious exporter ever produced a file with a bogusly small
     * header and megabytes of padding.
     */
    it('accepts a PSD padded to an absurd byte length, because the ceiling is not checked', async () => {
      const valid = containerPsd();
      const pad = Buffer.alloc(1024 * 1024, 0);
      const padded = Buffer.concat([valid, pad]);
      expect(padded.byteLength).toBe(valid.byteLength + 1024 * 1024);

      await expect(verifyPsd(padded, await drawnSourceDataUrl())).resolves.toBeUndefined();
    });

    it('rejects a PSD too short to hold a header', async () => {
      await expect(verifyPsd(Buffer.alloc(12), await drawnSourceDataUrl())).rejects.toThrow(
        'Photoshop PSD (layers): is 12 bytes, too short to hold a PSD header'
      );
    });

    it('rejects a truncated PSD with a message that names the layer table', async () => {
      const file = containerPsd();

      // Cut into the layer records, not into the trailing composite: a real PSD ends with
      // a flattened image, so a 40-byte cut lands in padding and the file still parses.
      await expect(verifyPsd(file.subarray(0, file.length - 200), await drawnSourceDataUrl())).rejects.toThrow(
        /Photoshop PSD \(layers\): .*(layer record|declares \d+ layers|too short)/
      );
    });

    it('rejects a container export whose source canvas carries no drawing either', async () => {
      // Both sides blank. The guard is a comparison, so a fixture that never drew anything
      // is rejected too rather than passing vacuously — which is the state `setupIcoTest`
      // was in before its stroke was mapped into the document.
      await expect(
        verifyTiff(await containerTiff(CONTAINER_IMAGE_SIZE, { blank: true }), await blankSourceDataUrl())
      ).rejects.toThrow('TIFF: the TIFF raster carries 0 inked pixels');
    });
  });

  describe('prepareExportDownloadDirectory', () => {
    it('clears and recreates the export directory under the test output dir', async () => {
      const info = createTestInfoMock();
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(rm).mockResolvedValue(undefined);

      const result = await prepareExportDownloadDirectory(info);

      expect(rm).toHaveBeenCalledWith(DOWNLOAD_DIRECTORY, { recursive: true, force: true });
      expect(mkdir).toHaveBeenCalledWith(DOWNLOAD_DIRECTORY, { recursive: true });
      expect(result).toBe(DOWNLOAD_DIRECTORY);
    });
  });
});

/**
 * P3 — 10 orphaned committed baselines. `visual-regression.spec.ts` reads exactly one
 * baseline per browser-verified format through `baselineFile()` — `drawing<ext>.png` in a
 * platform subdirectory — and nothing else under `export-baselines/` is referenced by any
 * code. The 10 orphaned files (8 raw exports, `drawing-icon.ico.png`, and
 * `source-baseline.png`) were deleted, and this guard reads the directory live so a
 * `git checkout` or a future stray write cannot bring them back silently.
 *
 * The 2.1 MB was `drawing.bmp` alone, whose 1.9 MB was most of the waste — but any orphan
 * is a maintenance hazard because a reader cannot tell committed-baseline from stray file
 * without the same directory scan this test does.
 */
describe('committed export baselines have no orphans', () => {
  const BASELINE_ROOT = path.resolve(
    import.meta.dirname,
    '..',
    'visual-regression.spec.ts-snapshots',
    'export-baselines'
  );

  /** The files `visual-regression.spec.ts` actually reads: `drawing<ext>.png` per OS subdir. */
  const EXPECTED_BASELINE_NAMES = browserVerifiedFormats.map((format) => `drawing${format.extension}.png`);

  it('the baseline directory contains only platform subdirectories, no stray files', () => {
    if (!existsSync(BASELINE_ROOT)) {
      throw new Error(
        `the export-baselines directory is missing at ${BASELINE_ROOT} — the committed baselines were deleted or moved`
      );
    }
    const entries = readdirSync(BASELINE_ROOT, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && !entry.name.startsWith('.'));

    expect(files, 'stray files at the baseline root would be orphans again').toEqual([]);
  });

  it('every platform subdir contains exactly the browser-verified baselines', () => {
    if (!existsSync(BASELINE_ROOT)) {
      throw new Error(
        `the export-baselines directory is missing at ${BASELINE_ROOT} — the committed baselines were deleted or moved`
      );
    }
    const platforms = readdirSync(BASELINE_ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    expect(platforms, 'the baseline directory has no platform subdirectories').not.toHaveLength(0);
    for (const platform of platforms) {
      const dir = path.join(BASELINE_ROOT, platform.name);
      if (!existsSync(dir)) {
        throw new Error(
          `${platform.name}/ disappeared between readdirSync and readdirSync — a TOCTOU race that should not pass silently`
        );
      }

      const files = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
        .map((entry) => entry.name);

      expect(files, `${platform.name}/ contains files not read by the spec`).toEqual(
        expect.arrayContaining(EXPECTED_BASELINE_NAMES)
      );
      expect(files.length).toBe(EXPECTED_BASELINE_NAMES.length);
    }
  });
});
