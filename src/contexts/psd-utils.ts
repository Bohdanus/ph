import type { BlendMode, Layer as PsdLayer } from 'ag-psd';
import { v4 as uuidv4 } from 'uuid';

import type { Size } from './general-types.ts';
import type { LayersRecord } from './layer-types.ts';
import { drawLayerSource } from './layer-renderer.ts';
import { getLayerPresentationBounds } from './affine-transform.ts';
import { documentFrameFromSize, type DocumentFrame } from './document-frame.ts';

export interface PsdDocument {
  size: Size;
  layers: LayersRecord;
  warnings: string[];
}

const blendModes: Partial<Record<BlendMode, GlobalCompositeOperation>> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color dodge': 'color-dodge',
  'color burn': 'color-burn',
  'hard light': 'hard-light',
  'soft light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

// Bound both individual allocations and the total retained raster data.
const maxPixels = 64 * 1024 * 1024;

function validateSize({ width, height }: Size) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 30000 ||
    height > 30000 ||
    width * height > maxPixels
  )
    throw new Error('Unsupported PSD dimensions (1..30000 pixels per side, at most 64 megapixels)');
}

function canvas2d(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('PSD requires a 2D canvas context');
  return { canvas, ctx };
}

export async function loadPsd(buffer: ArrayBuffer): Promise<PsdDocument> {
  if (buffer.byteLength < 26) throw new Error('Invalid PSD header');
  const header = new DataView(buffer);
  if (header.getUint32(0) !== 0x38425053 || header.getUint16(4) !== 1) {
    throw new Error('Only PSD files are supported (not PSB)');
  }
  if (header.getUint16(22) !== 8) throw new Error('Only 8-bit PSD documents are supported');
  if (![1, 3].includes(header.getUint16(24))) throw new Error('Only RGB and grayscale PSD documents are supported');
  const size = { width: header.getUint32(18), height: header.getUint32(14) };
  validateSize(size);
  const { readPsd, getLayerImageData, getCompositeImageData } = await import('ag-psd');
  const layers: LayersRecord = {};
  const warnings: string[] = [];
  const psd = readPsd(buffer, {
    useRawData: true,
    skipThumbnail: true,
    skipLinkedFilesData: true,
    logMissingFeatures: true,
    log: (...messages: unknown[]) => warnings.push(`PSD reader: ${messages.join(' ')}`),
  });
  if (psd.colorMode === 1) warnings.push('Grayscale PSD converted to RGB.');
  let pixels = size.width * size.height;
  let count = 0;
  function visit(children: PsdLayer[], visible = true, opacity = 1, locked = false) {
    for (const source of children) {
      if (++count > 2000) throw new Error('PSD has too many layers (maximum 2000)');
      const name = source.name ?? 'Layer';
      const warn = (message: string) => warnings.push(`"${name}": ${message}`);
      for (const key of [
        'mask',
        'realMask',
        'vectorMask',
        'effects',
        'clipping',
        'adjustment',
        'vectorFill',
        'vectorStroke',
        'filterMask',
        'filterEffectsMasks',
        'userMask',
        'artboard',
        'knockout',
        'channelBlendingRestrictions',
        'animationFrames',
        'timeline',
      ] as const) {
        if (source[key]) warn(`${key} is unsupported and is not preserved; appearance may differ.`);
      }
      if (source.text) warn('Text is imported as a raster preview; editable text is not preserved.');
      if (source.placedLayer) warn('Smart object is imported as a raster preview; object data is not preserved.');
      const ranges = source.blendingRanges;
      if (
        ranges &&
        [
          ranges.compositeGrayBlendSource,
          ranges.compositeGraphBlendDestinationRange,
          ...ranges.ranges.flatMap((range) => [range.sourceRange, range.destRange]),
        ].some((range) => range.some((value, index) => value !== [0, 0, 255, 255][index]))
      ) {
        warn('Custom blending ranges (Blend If) are unsupported; appearance may differ.');
      }
      if (source.fillOpacity !== undefined && source.fillOpacity !== 1) {
        warn('Fill opacity is approximated as layer opacity; appearance may differ.');
      }
      const ownLock = !!source.transparencyProtected || Object.values(source.protected ?? {}).some(Boolean);
      if (ownLock) warn('Photoshop lock flags are represented by a single full-layer lock.');
      const nextVisible = visible && !source.hidden;
      const nextOpacity = opacity * (source.opacity ?? 1) * (source.fillOpacity ?? 1);
      const nextLocked = locked || ownLock;
      if (source.children) {
        warn('Group flattened to leaf layers; group isolation, blending and opacity fidelity are not preserved.');
        visit(source.children, nextVisible, nextOpacity, nextLocked);
        continue;
      }
      const width = (source.right ?? 0) - (source.left ?? 0);
      const height = (source.bottom ?? 0) - (source.top ?? 0);
      if (width < 0 || height < 0) throw new Error(`Invalid PSD layer dimensions: ${name}`);
      validateSize({ width: Math.max(1, width), height: Math.max(1, height) });
      pixels += Math.max(1, width) * Math.max(1, height);
      if (pixels > maxPixels) throw new Error('PSD exceeds the 64 megapixel total raster budget');
      const image = getLayerImageData(source);
      const { canvas, ctx } = canvas2d(image?.width || 1, image?.height || 1);
      if (image) {
        const data = ctx.createImageData(image.width, image.height);
        data.data.set(image.data);
        ctx.putImageData(data, 0, 0);
      } else {
        warn('No raster preview; kept as a transparent 1x1 layer.');
      }
      const blendMode = blendModes[source.blendMode ?? 'normal'];
      if (!blendMode) warn(`Blend mode "${source.blendMode}" is unsupported; using normal.`);
      const id = uuidv4();
      layers[id] = {
        id,
        name,
        bitmap: canvas,
        tmpCanvas: null,
        isBedrock: false,
        visible: nextVisible,
        opacity: nextOpacity,
        locked: nextLocked,
        blendMode: blendMode ?? 'source-over',
        order: Object.keys(layers).length,
        pos: { x: source.left ?? 0, y: source.top ?? 0, width: canvas.width, height: canvas.height },
        source: {
          kind: 'image',
          bitmap: canvas,
          name,
          pos: { x: source.left ?? 0, y: source.top ?? 0, width: canvas.width, height: canvas.height },
        },
        operations: [],
      };
    }
  }
  // ag-psd's reader/writer preserve PSD record order: bottom layer first.
  visit(psd.children ?? []);
  if (!Object.keys(layers).length) {
    const image = getCompositeImageData(psd);
    if (image) {
      const { canvas, ctx } = canvas2d(size.width, size.height);
      const data = ctx.createImageData(size.width, size.height);
      data.data.set(image.data);
      ctx.putImageData(data, 0, 0);
      const id = uuidv4();
      layers[id] = {
        id,
        name: 'Composite',
        bitmap: canvas,
        tmpCanvas: null,
        isBedrock: false,
        visible: true,
        opacity: 1,
        locked: false,
        blendMode: 'source-over',
        order: 0,
        pos: { x: 0, y: 0, ...size },
        source: { kind: 'image', bitmap: canvas, name: 'Composite', isBedrock: true, size: { ...size } },
        operations: [],
      };
      warnings.push('No leaf layers; imported the flattened composite image.');
    }
  }
  return { size, layers, warnings };
}

export async function savePsd(
  layers: LayersRecord,
  size: Size,
  documentFrame: DocumentFrame = documentFrameFromSize(size)
): Promise<ArrayBuffer> {
  validateSize(size);
  const sorted = Object.values(layers).sort((a, b) => a.order - b.order);
  if (sorted.length > 2000) throw new Error('PSD has too many layers (maximum 2000)');
  let pixels = size.width * size.height;
  const prepared = sorted.map((layer) => {
    if (![layer.pos.x, layer.pos.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 0x7fffffff - 30000)) {
      throw new Error(`Invalid PSD layer offset: ${layer.name}`);
    }
    if (![layer.pos.width, layer.pos.height].every((n) => Number.isFinite(n) && n > 0)) {
      throw new Error(`Invalid PSD layer dimensions: ${layer.name}`);
    }
    const presentation = getLayerPresentationBounds(layer);
    const localX = presentation.x - documentFrame.x;
    const localY = presentation.y - documentFrame.y;
    const left = Math.floor(localX);
    const top = Math.floor(localY);
    const width = Math.ceil(localX + presentation.width) - left;
    const height = Math.ceil(localY + presentation.height) - top;
    validateSize({ width, height });
    if (!Number.isFinite(layer.order) || !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) {
      throw new Error(`Invalid PSD layer order or opacity: ${layer.name}`);
    }
    const blendMode = (Object.keys(blendModes) as BlendMode[]).find((key) => blendModes[key] === layer.blendMode);
    if (!blendMode) throw new Error(`Unsupported PSD export blend mode: ${layer.blendMode}`);
    pixels += width * height;
    if (pixels > maxPixels) throw new Error('PSD exceeds the 64 megapixel total raster budget');
    return { layer, blendMode, left, top, width, height };
  });
  const { writePsd } = await import('ag-psd');
  const { canvas, ctx } = canvas2d(size.width, size.height);
  const children = prepared.map(({ layer, blendMode, left, top, width, height }): PsdLayer => {
    const source = layer.tmpCanvas ?? layer.bitmap;
    const raster = canvas2d(source ? width : 1, source ? height : 1);
    // Rasterize fractional editor geometry inside enclosing integer PSD bounds.
    if (source) {
      drawLayerSource(raster.ctx, layer, {
        x: layer.pos.x - documentFrame.x - left,
        y: layer.pos.y - documentFrame.y - top,
        width: layer.pos.width,
        height: layer.pos.height,
      });
    }
    // PSD stores opacity in one byte; composite uses the same quantized value.
    const opacity = Math.round(layer.opacity * 255) / 255;
    if (layer.visible) {
      ctx.globalAlpha = opacity;
      ctx.globalCompositeOperation = layer.blendMode;
      ctx.drawImage(raster.canvas, left, top);
    }
    return {
      name: layer.name,
      left,
      top,
      canvas: raster.canvas,
      hidden: !layer.visible,
      opacity,
      blendMode,
      transparencyProtected: layer.locked,
      protected: { transparency: false, composite: layer.locked, position: layer.locked },
    };
  });
  return writePsd({ ...size, canvas, children }, { trimImageData: false, noBackground: true });
}
