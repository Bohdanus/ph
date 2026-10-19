import type { ImageUploadResponse } from './useFile.tsx';
import { resolveImageFormat, withFileExtension } from '../constants/imageFormats.ts';
import { MAX_CREATABLE_DOCUMENT_PIXELS } from './raster-utils.ts';

const TIFF_MIME_TYPES = new Set(['image/tif', 'image/tiff', 'image/x-tiff']);
const BMP_MIME_TYPES = new Set(['image/bmp', 'image/x-bmp', 'image/x-ms-bmp']);
const ICO_MIME_TYPES = new Set(['image/ico', 'image/x-icon', 'image/vnd.microsoft.icon']);
const BROWSER_IMAGE_EXTENSIONS = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;
const GIF_HEADER_BYTES = 13;
const SVG_DEFAULT_WIDTH = 300;
const SVG_DEFAULT_HEIGHT = 150;
const MAX_SVG_SOURCE_BYTES = 64 * 1024 * 1024;

function asciiAt(signature: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...signature.subarray(offset, offset + length));
}

function mimeEssence(value: string): string {
  return value.split(';', 1)[0].trim().toLowerCase();
}

async function rejectOversizedGif(file: File): Promise<void> {
  const header = new Uint8Array(await file.slice(0, GIF_HEADER_BYTES).arrayBuffer());
  if (header.length < GIF_HEADER_BYTES) return;

  const signature = asciiAt(header, 0, 6);
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return;

  const width = header[6] | (header[7] << 8);
  const height = header[8] | (header[9] << 8);
  if (width * height > MAX_CREATABLE_DOCUMENT_PIXELS) {
    throw new Error(
      `GIF image is too large to open (${width}×${height}). Maximum is ${MAX_CREATABLE_DOCUMENT_PIXELS} pixels.`
    );
  }
}

function svgLengthInPixels(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === 'auto' || trimmed.endsWith('%')) return undefined;
  const match = /^\s*([+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|in|cm|mm|pt|pc|q)?\s*$/i.exec(value);
  if (!match) throw new Error(`SVG image has an unsupported intrinsic dimension: ${value.trim()}`);

  const length = Number(match[1]);
  if (!Number.isFinite(length) || length <= 0) {
    throw new Error(`SVG image has invalid intrinsic dimension: ${value.trim()}`);
  }
  const scale = ({ px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72, pc: 16, q: 96 / 101.6 } as const)[
    (match[2] ?? 'px').toLowerCase() as 'px' | 'in' | 'cm' | 'mm' | 'pt' | 'pc' | 'q'
  ];
  return length * scale;
}

function cssDimension(style: string, property: 'width' | 'height'): string | null {
  const declarations = cssDeclarations(stripCssComments(style)).filter((item) => item.property === property);
  return declarations.filter((item) => item.important).at(-1)?.value ?? declarations.at(-1)?.value ?? null;
}

function decodeCssEscapes(value: string): string {
  return value.replace(/\\([\da-f]{1,6})(?:\r\n|\s)?|\\([^\r\n])/gi, (_match, hex: string, escaped: string) => {
    if (!hex) return escaped;
    const codePoint = Number.parseInt(hex, 16);
    return codePoint === 0 || codePoint > 0x10ffff ? '\uFFFD' : String.fromCodePoint(codePoint);
  });
}

function cssEscapeEnd(source: string, backslashIndex: number): number {
  let index = backslashIndex + 1;
  if (/[\da-f]/i.test(source[index] ?? '')) {
    for (let count = 0; count < 5 && /[\da-f]/i.test(source[index] ?? ''); count += 1) index += 1;
    if (source[index] === '\r' && source[index + 1] === '\n') index += 2;
    else if (/\s/.test(source[index] ?? '')) index += 1;
  } else if (source[index] === '\r' && source[index + 1] === '\n') {
    index += 2;
  } else if (index < source.length) {
    index += 1;
  }
  return Math.max(backslashIndex, index - 1);
}

function cssDeclarations(style: string): Array<{ property: string; value: string; important: boolean }> {
  const declarations: Array<{ property: string; value: string; important: boolean }> = [];
  let start = 0;
  let quote = '';
  for (let index = 0; index <= style.length; index += 1) {
    const character = style[index];
    if (quote) {
      if (character === '\\') index = cssEscapeEnd(style, index);
      else if (character === quote || /[\r\n\f]/.test(character ?? '')) quote = '';
    } else if (character === '\\') index = cssEscapeEnd(style, index);
    else if (character === '"' || character === "'") quote = character;
    else if (character === ';' || index === style.length) {
      const declaration = style.slice(start, index);
      const colon = declaration.indexOf(':');
      if (colon >= 0) {
        const rawValue = declaration.slice(colon + 1).trim();
        const importantStart = cssImportantStart(rawValue);
        declarations.push({
          property: decodeCssEscapes(declaration.slice(0, colon)).trim().toLowerCase(),
          value: (importantStart === null ? rawValue : rawValue.slice(0, importantStart)).trim(),
          important: importantStart !== null,
        });
      }
      start = index + 1;
    }
  }
  return declarations;
}

function cssImportantStart(value: string): number | null {
  const stripped = stripCssComments(value);
  let quote = '';
  for (let index = 0; index < stripped.length; index += 1) {
    const character = stripped[index];
    if (quote) {
      if (character === '\\') index = cssEscapeEnd(stripped, index);
      else if (character === quote || /[\r\n\f]/.test(character)) quote = '';
      continue;
    }
    if (character === '\\') index = cssEscapeEnd(stripped, index);
    else if (character === '"' || character === "'") quote = character;
    else if (character === '!' && decodeCssEscapes(stripped.slice(index + 1).trim()).toLowerCase() === 'important') {
      return index;
    }
  }
  return null;
}

function cssUrlTokenEnd(source: string, startAt: number): number | null {
  let quote = '';
  for (let index = startAt + 4; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === '\\') index = cssEscapeEnd(source, index);
      else if (character === quote || /[\r\n\f]/.test(character ?? '')) quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '\\') index = cssEscapeEnd(source, index);
    else if (character === ')') return index;
  }
  return null;
}

function isCssUrlToken(source: string, index: number): boolean {
  return source.slice(index, index + 4).toLowerCase() === 'url(' && (index === 0 || !/[\w-]/.test(source[index - 1]));
}

function stripCssComments(source: string): string {
  source = source.replace(/\r\n?/g, '\n').replace(/\f/g, '\n');
  let result = '';
  let quote = '';
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quote) {
      result += character;
      if (character === '\\') {
        const escapeEnd = cssEscapeEnd(source, index);
        result += source.slice(index + 1, escapeEnd + 1);
        index = escapeEnd;
      } else if (character === quote || /[\r\n\f]/.test(character)) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
      result += character;
    } else if (character === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) break;
      result += ' ';
      index = end + 1;
    } else if (character === '\\') {
      const escapeEnd = cssEscapeEnd(source, index);
      result += source.slice(index, escapeEnd + 1);
      index = escapeEnd;
    } else {
      result += character;
    }
  }
  return result;
}

const CSS_SIZING_PROPERTIES = new Set([
  'width',
  'height',
  'min-width',
  'min-height',
  'inline-size',
  'block-size',
  'min-inline-size',
  'min-block-size',
  'aspect-ratio',
]);

function hasCssSizingDeclarations(body: string): boolean {
  let start = 0;
  let quote = '';
  for (let index = 0; index <= body.length; index += 1) {
    const character = body[index];
    if (quote) {
      if (character === '\\') index = cssEscapeEnd(body, index);
      else if (character === quote || /[\r\n\f]/.test(character ?? '')) quote = '';
      continue;
    }
    if (isCssUrlToken(body, index)) {
      const end = cssUrlTokenEnd(body, index);
      if (end === null) return true;
      index = end;
      continue;
    }
    if (character === '\\') index = cssEscapeEnd(body, index);
    else if (character === '"' || character === "'") quote = character;
    else if (character === ';' || index === body.length) {
      const declaration = body.slice(start, index);
      const colon = declaration.indexOf(':');
      if (colon >= 0 && CSS_SIZING_PROPERTIES.has(decodeCssEscapes(declaration.slice(0, colon)).trim().toLowerCase())) {
        return true;
      }
      start = index + 1;
    }
  }
  return false;
}

function nextCssRule(source: string, startAt: number): { prelude: string; body: string; next: number } | null {
  let start = startAt;
  let opening = -1;
  let quote = '';
  let comment = false;
  let delimiters = 0;

  for (let index = startAt; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (comment) {
      if (character === '*' && next === '/') {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === '\\') index = cssEscapeEnd(source, index);
      else if (character === quote || /[\r\n\f]/.test(character ?? '')) quote = '';
      continue;
    }
    if (isCssUrlToken(source, index)) {
      const end = cssUrlTokenEnd(source, index);
      if (end === null) return { prelude: '', body: '', next: source.length };
      index = end;
      continue;
    }
    if (character === '/' && next === '*') {
      comment = true;
      index += 1;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '\\') index = cssEscapeEnd(source, index);
    else if (character === '(' || character === '[') delimiters += 1;
    else if ((character === ')' || character === ']') && delimiters > 0) delimiters -= 1;
    else if (delimiters === 0 && (character === ';' || character === '}')) start = index + 1;
    else if (delimiters === 0 && character === '{') {
      opening = index;
      break;
    }
  }

  if (opening < 0) return null;
  let depth = 1;
  delimiters = 0;
  quote = '';
  comment = false;
  for (let index = opening + 1; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (comment) {
      if (character === '*' && next === '/') {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === '\\') index = cssEscapeEnd(source, index);
      else if (character === quote || /[\r\n\f]/.test(character ?? '')) quote = '';
      continue;
    }
    if (isCssUrlToken(source, index)) {
      const end = cssUrlTokenEnd(source, index);
      if (end === null) return { prelude: '', body: '', next: source.length };
      index = end;
      continue;
    }
    if (character === '/' && next === '*') {
      comment = true;
      index += 1;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '\\') index = cssEscapeEnd(source, index);
    else if (character === '(' || character === '[') delimiters += 1;
    else if ((character === ')' || character === ']') && delimiters > 0) delimiters -= 1;
    else if (delimiters === 0 && character === '{') depth += 1;
    else if (delimiters === 0 && character === '}' && --depth === 0) {
      return {
        prelude: source.slice(start, opening).trim(),
        body: source.slice(opening + 1, index),
        next: index + 1,
      };
    }
  }
  return { prelude: '', body: '', next: source.length };
}

function hasUnsupportedInlineSizing(style: string): boolean {
  return cssDeclarations(stripCssComments(style)).some(
    ({ property }) => CSS_SIZING_PROPERTIES.has(property) && property !== 'width' && property !== 'height'
  );
}

function hasCssImport(css: string): boolean {
  let quote = '';
  let comment = false;
  let depth = 0;
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    const next = css[index + 1];
    if (comment) {
      if (character === '*' && next === '/') {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === '\\') index = cssEscapeEnd(css, index);
      else if (character === quote || /[\r\n\f]/.test(character ?? '')) quote = '';
      continue;
    }
    if (character === '/' && next === '*') {
      comment = true;
      index += 1;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '\\') index = cssEscapeEnd(css, index);
    else if (character === '{') depth += 1;
    else if (character === '}' && depth > 0) depth -= 1;
    else if (character === '@' && depth === 0) {
      const start = index + 1;
      let end = start;
      while (end < css.length && (/[\w-]/.test(css[end]) || css[end] === '\\')) {
        if (css[end] === '\\') end = cssEscapeEnd(css, end);
        end += 1;
      }
      if (decodeCssEscapes(css.slice(start, end)).toLowerCase() === 'import') return true;
      index = end - 1;
    }
  }
  return false;
}

function stylesheetSizesRoot(css: string, root: Element, inheritedRoot = false): boolean {
  if (hasCssImport(css)) return true;
  let offset = 0;
  while (offset < css.length) {
    const rule = nextCssRule(css, offset);
    if (!rule) return false;
    if (!rule.prelude) return true;
    offset = rule.next;
    if (rule.prelude.startsWith('@')) {
      if (/^@media\s+not\s+all$/i.test(rule.prelude)) continue;
      if (inheritedRoot && hasCssSizingDeclarations(rule.body)) return true;
      if (stylesheetSizesRoot(rule.body, root, inheritedRoot)) return true;
    } else {
      let matchesRoot = inheritedRoot;
      try {
        matchesRoot ||= root.matches(rule.prelude);
      } catch {
        return true;
      }
      if (matchesRoot && hasCssSizingDeclarations(rule.body)) return true;
      if (stylesheetSizesRoot(rule.body, root, matchesRoot)) return true;
    }
  }
  return false;
}

function svgDimension(root: Element, property: 'width' | 'height'): number | undefined {
  const style = root.getAttribute('style') ?? '';
  const styled = cssDimension(style, property);
  const hasInlineDeclaration = styled !== null;
  const value = hasInlineDeclaration ? styled : root.getAttribute(property);
  return svgLengthInPixels(value);
}

function svgRootSizing(root: Element): { width: number; height: number } {
  const viewBox = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const aspect =
    viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0
      ? viewBox[2] / viewBox[3]
      : undefined;
  const width = svgDimension(root, 'width');
  const height = svgDimension(root, 'height');

  if (width !== undefined && height !== undefined) return { width, height };
  if (width !== undefined) return { width, height: aspect ? width / aspect : SVG_DEFAULT_HEIGHT };
  if (height !== undefined) return { width: aspect ? height * aspect : SVG_DEFAULT_WIDTH, height };
  if (aspect) {
    return aspect >= SVG_DEFAULT_WIDTH / SVG_DEFAULT_HEIGHT
      ? { width: SVG_DEFAULT_WIDTH, height: SVG_DEFAULT_WIDTH / aspect }
      : { width: SVG_DEFAULT_HEIGHT * aspect, height: SVG_DEFAULT_HEIGHT };
  }
  return { width: SVG_DEFAULT_WIDTH, height: SVG_DEFAULT_HEIGHT };
}

async function rejectOversizedSvg(file: File, mimeType: string): Promise<void> {
  if (file.size > MAX_SVG_SOURCE_BYTES) {
    throw new Error(`SVG source exceeds the ${MAX_SVG_SOURCE_BYTES} byte import limit`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isUtf16Le = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0x00);
  const isUtf16Be = (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0x00 && bytes[1] === 0x3c);
  const hasUtf8Bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const signatureEncoding = isUtf16Le ? 'utf-16le' : isUtf16Be ? 'utf-16be' : hasUtf8Bom ? 'utf-8' : undefined;
  const declaredEncoding = xmlDeclaredEncoding(bytes, isUtf16Le, isUtf16Be, hasUtf8Bom);
  const mimeEncoding = /(?:^|;)\s*charset\s*=\s*["']?([^;"']+)/i.exec(mimeType)?.[1]?.trim();
  const encoding = signatureEncoding ?? mimeEncoding ?? declaredEncoding ?? 'utf-8';
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`SVG image uses an unsupported or invalid text encoding: ${encoding}`);
  }
  const document = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = document.documentElement;
  if (root.localName.toLowerCase() !== 'svg') throw new Error('SVG image has invalid XML dimensions');
  const inlineStyle = root.getAttribute('style') ?? '';
  if (hasUnsupportedInlineSizing(inlineStyle)) {
    throw new Error('SVG image uses unsupported CSS sizing that cannot be safely preflighted');
  }
  const stylesheetSizing = [...document.querySelectorAll('style')].some((style) => {
    if (style.getAttribute('media')?.trim().toLowerCase() === 'not all') return false;
    return stylesheetSizesRoot(stripCssComments(style.textContent ?? ''), root);
  });
  const externalStylesheet =
    document.querySelector('style[href], link[rel~="stylesheet"]') !== null ||
    [...document.childNodes].some((node) => node.nodeType === 7 && node.nodeName.toLowerCase() === 'xml-stylesheet');
  if (stylesheetSizing || externalStylesheet) {
    throw new Error('SVG image uses stylesheet sizing that cannot be safely preflighted');
  }

  const { width, height } = svgRootSizing(root);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('SVG image has invalid intrinsic dimensions');
  }
  if (width * height > MAX_CREATABLE_DOCUMENT_PIXELS) {
    throw new Error(
      `SVG image is too large to open (${width}×${height}). Maximum is ${MAX_CREATABLE_DOCUMENT_PIXELS} pixels.`
    );
  }
}

function xmlDeclaredEncoding(
  bytes: Uint8Array,
  isUtf16Le: boolean,
  isUtf16Be: boolean,
  hasUtf8Bom: boolean
): string | undefined {
  const stride = isUtf16Le || isUtf16Be ? 2 : 1;
  const hasUtf16Bom = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  const start = hasUtf16Bom ? 2 : hasUtf8Bom ? 3 : 0;
  const charAt = (index: number) => {
    const offset = start + index * stride;
    if (offset + stride > bytes.length) return '';
    return String.fromCharCode(
      stride === 1
        ? bytes[offset]
        : isUtf16Le
          ? bytes[offset] | (bytes[offset + 1] << 8)
          : (bytes[offset] << 8) | bytes[offset + 1]
    );
  };
  if (Array.from('<?xml').some((character, index) => charAt(index) !== character)) return undefined;

  let index = 5;
  while (index < Math.floor((bytes.length - start) / stride)) {
    while (/\s/.test(charAt(index))) index += 1;
    if (charAt(index) === '?' && charAt(index + 1) === '>') return undefined;
    const nameStart = index;
    while (/[\w:.-]/.test(charAt(index))) index += 1;
    if (index === nameStart) {
      index += 1;
      continue;
    }
    const name = Array.from({ length: index - nameStart }, (_, offset) => charAt(nameStart + offset)).join('');
    while (/\s/.test(charAt(index))) index += 1;
    if (charAt(index) !== '=') continue;
    index += 1;
    while (/\s/.test(charAt(index))) index += 1;
    const quote = charAt(index);
    if (quote !== '"' && quote !== "'") continue;
    index += 1;
    const valueStart = index;
    while (index < Math.floor((bytes.length - start) / stride) && charAt(index) !== quote) index += 1;
    if (name === 'encoding') {
      return Array.from({ length: index - valueStart }, (_, offset) => charAt(valueStart + offset)).join('');
    }
    index += 1;
  }
  return undefined;
}

function validateDecodedImageDimensions(image: HTMLImageElement): void {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Image has invalid dimensions to open');
  }
  if (width * height > MAX_CREATABLE_DOCUMENT_PIXELS) {
    throw new Error(
      `Image is too large to open (${width}×${height}). Maximum is ${MAX_CREATABLE_DOCUMENT_PIXELS} pixels.`
    );
  }
}

function hasTiffSignature(signature: Uint8Array): boolean {
  return (
    signature.length >= 4 &&
    ((signature[0] === 0x49 &&
      signature[1] === 0x49 &&
      (signature[2] === 0x2a || signature[2] === 0x2b) &&
      signature[3] === 0x00) ||
      (signature[0] === 0x4d &&
        signature[1] === 0x4d &&
        signature[2] === 0x00 &&
        (signature[3] === 0x2a || signature[3] === 0x2b)))
  );
}

function isTiffFile(file: File, signature: Uint8Array): boolean {
  return (
    /\.(?:tif|tiff)$/i.test(file.name) || TIFF_MIME_TYPES.has(file.type.toLowerCase()) || hasTiffSignature(signature)
  );
}

function isBmpFile(file: File, signature: Uint8Array): boolean {
  return /\.bmp$/i.test(file.name) || BMP_MIME_TYPES.has(file.type.toLowerCase()) || asciiAt(signature, 0, 2) === 'BM';
}

function isGifFile(file: File, signature: Uint8Array): boolean {
  return /\.gif$/i.test(file.name) || file.type.toLowerCase() === 'image/gif' || asciiAt(signature, 0, 3) === 'GIF';
}

function isAvifFile(file: File, signature: Uint8Array): boolean {
  if (/\.avif$/i.test(file.name) || file.type.toLowerCase() === 'image/avif') return true;
  if (asciiAt(signature, 4, 4) !== 'ftyp') return false;
  for (let offset = 8; offset + 4 <= signature.length; offset += 4) {
    if (asciiAt(signature, offset, 4) === 'avif' || asciiAt(signature, offset, 4) === 'avis') return true;
  }
  return false;
}

function isIcoFile(file: File, signature: Uint8Array): boolean {
  return (
    /\.ico$/i.test(file.name) ||
    ICO_MIME_TYPES.has(file.type.toLowerCase()) ||
    (signature.length >= 4 && signature[0] === 0 && signature[1] === 0 && signature[2] === 1 && signature[3] === 0)
  );
}

function isSvgFile(file: File, signature: Uint8Array): boolean {
  if (/\.svg$/i.test(file.name) || mimeEssence(file.type) === 'image/svg+xml') return true;
  const utf16Le = (signature[0] === 0xff && signature[1] === 0xfe) || (signature[0] === 0x3c && signature[1] === 0x00);
  const utf16Be = (signature[0] === 0xfe && signature[1] === 0xff) || (signature[0] === 0x00 && signature[1] === 0x3c);
  const header = new TextDecoder(utf16Le ? 'utf-16le' : utf16Be ? 'utf-16be' : 'utf-8')
    .decode(signature)
    .replace(/^\uFEFF/, '')
    .trimStart()
    .toLowerCase();
  return (
    header.startsWith('<svg') ||
    (header.startsWith('<?xml') && (header.includes('<svg') || file.type.toLowerCase().startsWith('image/')))
  );
}

export async function loadDocumentFile(file: File): Promise<ImageUploadResponse> {
  const signature = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (/\.psd$/i.test(file.name) || asciiAt(signature, 0, 4) === '8BPS' || file.type === 'image/vnd.adobe.photoshop') {
    const { loadPsd } = await import('./psd-utils.ts');
    return { fileName: file.name, document: await loadPsd(await file.arrayBuffer()) };
  }
  if (isTiffFile(file, signature)) {
    const { loadTiffFile } = await import('./tiff-utils.ts');
    return { fileName: file.name, image: await loadTiffFile(file) };
  }
  if (isBmpFile(file, signature)) {
    const { loadBmpFile } = await import('./bmp-utils.ts');
    return { fileName: file.name, image: await loadBmpFile(file) };
  }
  if (isAvifFile(file, signature)) {
    const { loadAvifFile } = await import('./avif-utils.ts');
    return { fileName: file.name, image: await loadAvifFile(file) };
  }
  if (isIcoFile(file, signature)) {
    const { loadIcoFile } = await import('./ico-utils.ts');
    return { fileName: file.name, image: await loadIcoFile(file) };
  }
  if (isGifFile(file, signature)) {
    return { fileName: file.name, image: await loadImageFile(file, 'image/gif') };
  }
  if (isSvgFile(file, signature)) {
    const mimeType = mimeEssence(file.type) === 'image/svg+xml' ? file.type : 'image/svg+xml';
    return { fileName: file.name, image: await loadImageFile(file, mimeType) };
  }
  return { fileName: file.name, image: await loadImageFile(file) };
}

export function downloadBlob(blob: Blob, fileName: string, extension: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = withFileExtension(fileName, extension);
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export const loadImageFile = async (file: File, detectedMimeType?: string): Promise<HTMLImageElement> => {
  if (!file || (!detectedMimeType && !file.type.startsWith('image/') && !BROWSER_IMAGE_EXTENSIONS.test(file.name))) {
    throw new Error('Not an image file');
  }

  const isGif =
    detectedMimeType?.toLowerCase() === 'image/gif' ||
    file.type.toLowerCase() === 'image/gif' ||
    /\.gif$/i.test(file.name);
  if (isGif) await rejectOversizedGif(file);
  const svgMimeType = detectedMimeType ?? file.type;
  const isSvg = mimeEssence(svgMimeType) === 'image/svg+xml' || /\.svg$/i.test(file.name);
  if (isSvg) await rejectOversizedSvg(file, svgMimeType);

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          validateDecodedImageDimensions(img);
          resolve(img);
        } catch (error) {
          reject(error);
        }
      };
      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };
      img.src = e.target?.result as string;
    };
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    reader.readAsDataURL(detectedMimeType ? new Blob([file], { type: detectedMimeType }) : file);
  });
};

export async function saveImageToDisk(
  canvas: HTMLCanvasElement,
  fileName: string,
  format: string,
  quality?: number
): Promise<void> {
  const imageFormat = resolveImageFormat(format);
  if (imageFormat.encoding !== 'canvas') {
    let blob: Blob | undefined;
    switch (imageFormat.encoding) {
      case 'tiff': {
        const { encodeTiff } = await import('./tiff-utils.ts');
        blob = await encodeTiff(canvas);
        break;
      }
      case 'bmp': {
        const { encodeBmp } = await import('./bmp-utils.ts');
        blob = await encodeBmp(canvas);
        break;
      }
      case 'gif': {
        const { encodeGif } = await import('./gif-utils.ts');
        blob = await encodeGif(canvas);
        break;
      }
      case 'avif': {
        const { encodeAvif } = await import('./avif-utils.ts');
        blob = await encodeAvif(canvas);
        break;
      }
      case 'ico': {
        const { encodeIco } = await import('./ico-utils.ts');
        blob = await encodeIco(canvas);
        break;
      }
      case 'svg': {
        const { encodeSvg } = await import('./svg-utils.ts');
        blob = encodeSvg(canvas);
        break;
      }
    }
    if (!blob) throw new Error(`Unsupported image format: ${format}`);
    downloadBlob(blob, fileName, imageFormat.extension);
    return;
  }

  return new Promise((resolve, reject) => {
    // Create a blob from the canvas and trigger download
    const handleBlob = (blob: Blob | null) => {
      if (blob) {
        try {
          downloadBlob(blob, fileName, imageFormat.extension);
          resolve();
        } catch (error) {
          reject(error);
        }
      } else {
        reject(new Error('Failed to create blob from canvas'));
      }
    };

    try {
      const normalizedQuality =
        quality === undefined || !Number.isFinite(quality) ? undefined : Math.min(1, Math.max(0, quality));
      if (imageFormat.supportsQuality && normalizedQuality !== undefined) {
        canvas.toBlob(handleBlob, imageFormat.mimeType, normalizedQuality);
      } else {
        canvas.toBlob(handleBlob, imageFormat.mimeType);
      }
    } catch (error) {
      reject(error);
    }
  });
}
