import type { ImageUploadResponse } from './useFile.tsx';
import { resolveImageFormat, withFileExtension } from '../constants/imageFormats.ts';
import { MAX_CREATABLE_DOCUMENT_PIXELS } from './raster-utils.ts';
import { MAX_SVG_SOURCE_BYTES } from './svg-utils.ts';

const TIFF_MIME_TYPES = new Set(['image/tif', 'image/tiff', 'image/x-tiff']);
const BMP_MIME_TYPES = new Set(['image/bmp', 'image/x-bmp', 'image/x-ms-bmp']);
const ICO_MIME_TYPES = new Set(['image/ico', 'image/x-icon', 'image/vnd.microsoft.icon']);
const BROWSER_IMAGE_EXTENSIONS = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;
const GIF_HEADER_BYTES = 13;
const SVG_DEFAULT_WIDTH = 300;
const SVG_DEFAULT_HEIGHT = 150;
const MAX_PNG_CHUNKS = 65_536;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const SVG_URL_PRESENTATION_ATTRIBUTES = new Set([
  'background-image',
  'clip-path',
  'cursor',
  'fill',
  'filter',
  'marker',
  'marker-end',
  'marker-mid',
  'marker-start',
  'mask',
  'mask-image',
  'stroke',
]);
const SVG_VECTOR_URL_PROPERTIES = new Set([
  'clip-path',
  'fill',
  'filter',
  'marker',
  'marker-end',
  'marker-mid',
  'marker-start',
  'mask',
  'mask-image',
  'stroke',
]);
const SVG_HREF_RESOURCE_ELEMENTS = new Set([
  'filter',
  'image',
  'lineargradient',
  'marker',
  'mask',
  'mpath',
  'pattern',
  'radialgradient',
  'textpath',
  'use',
]);
const HTML_RESOURCE_ATTRIBUTES = new Map([
  ['audio', new Set(['src'])],
  ['embed', new Set(['src'])],
  ['frame', new Set(['src'])],
  ['iframe', new Set(['src'])],
  ['img', new Set(['src', 'srcset'])],
  ['input', new Set(['src'])],
  ['link', new Set(['href'])],
  ['object', new Set(['data'])],
  ['script', new Set(['src'])],
  ['source', new Set(['src', 'srcset'])],
  ['track', new Set(['src'])],
  ['video', new Set(['poster', 'src'])],
]);

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
    for (let count = 0; count < 6 && /[\da-f]/i.test(source[index] ?? ''); count += 1) index += 1;
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

function cssFunctionTokenStart(source: string, startAt: number, names: ReadonlySet<string>): number | null {
  if (startAt > 0 && /[\w-]/.test(source[startAt - 1])) return null;

  let identifier = '';
  let index = startAt;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      const end = cssEscapeEnd(source, index);
      identifier += decodeCssEscapes(source.slice(index, end + 1));
      index = end + 1;
    } else if (/[a-z-]/i.test(character ?? '')) {
      identifier += character;
      index += 1;
    } else {
      break;
    }
    if (identifier.length > 32) return null;
  }

  return names.has(identifier.toLowerCase()) && source[index] === '(' ? index : null;
}

function cssUrlTokenStart(source: string, startAt: number): number | null {
  return cssFunctionTokenStart(source, startAt, new Set(['url']));
}

function cssFunctionEnd(source: string, opening: number): number | null {
  let depth = 1;
  let quote = '';
  let comment = false;
  for (let index = opening + 1; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (comment) {
      if (character === '*' && next === '/') {
        comment = false;
        index += 1;
      }
    } else if (quote) {
      if (character === '\\') index = cssEscapeEnd(source, index);
      else if (character === quote || /[\r\n\f]/.test(character ?? '')) quote = '';
    } else if (character === '/' && next === '*') {
      comment = true;
      index += 1;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '\\') index = cssEscapeEnd(source, index);
    else if (character === '(') depth += 1;
    else if (character === ')' && --depth === 0) return index;
  }
  return null;
}

function cssUrlTokenEnd(source: string, startAt: number): number | null {
  const opening = cssUrlTokenStart(source, startAt);
  return opening === null ? null : cssFunctionEnd(source, opening);
}

function cssFunctionUnsafeImageString(source: string, opening: number, end: number): string | undefined {
  let quote = '';
  let start = 0;
  for (let index = opening + 1; index < end; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quote) {
      if (character === '\\') index = cssEscapeEnd(source, index);
      else if (character === quote || /[\r\n\f]/.test(character ?? '')) {
        const value = decodeCssEscapes(source.slice(start, index)).trim();
        if (character === quote && (/^data:/i.test(value) || value.startsWith('#'))) return value;
        quote = '';
      }
    } else if (character === '/' && next === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      if (commentEnd < 0) return 'data:';
      index = commentEnd + 1;
    } else if (character === '"' || character === "'") {
      quote = character;
      start = index + 1;
    } else if (character === '\\') index = cssEscapeEnd(source, index);
  }
  return undefined;
}

function cssPropertyAt(source: string, targetIndex: number): string | undefined {
  let statementStart = 0;
  let colon = -1;
  let parentheses = 0;
  let brackets = 0;
  let quote = '';
  let comment = false;

  for (let index = 0; index < targetIndex; index += 1) {
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
    if (character === '/' && next === '*') {
      comment = true;
      index += 1;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '\\') index = cssEscapeEnd(source, index);
    else if (character === '(') parentheses += 1;
    else if (character === ')' && parentheses > 0) parentheses -= 1;
    else if (character === '[') brackets += 1;
    else if (character === ']' && brackets > 0) brackets -= 1;
    else if (parentheses === 0 && brackets === 0 && (character === ';' || character === '{' || character === '}')) {
      statementStart = index + 1;
      colon = -1;
    } else if (parentheses === 0 && brackets === 0 && character === ':' && colon < 0) colon = index;
  }

  if (colon < statementStart) return undefined;
  return decodeCssEscapes(stripCssComments(source.slice(statementStart, colon)))
    .trim()
    .toLowerCase();
}

function cssUrlIsNamespaceDeclaration(source: string, targetIndex: number): boolean {
  const boundary = Math.max(
    source.lastIndexOf('{', targetIndex),
    source.lastIndexOf('}', targetIndex),
    source.lastIndexOf(';', targetIndex)
  );
  return /^@namespace(?:\s|$)/i.test(stripCssComments(source.slice(boundary + 1, targetIndex)).trim());
}

function cssUrlReferencesData(source: string, propertyHint?: string, dataBaseInScope = false): boolean {
  const imageStringFunctions = new Set(['image-set', '-webkit-image-set', 'image']);
  let quote = '';
  let comment = false;
  for (let index = 0; index < source.length; index += 1) {
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
    if (character === '/' && next === '*') {
      comment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    const imageFunction = cssFunctionTokenStart(source, index, imageStringFunctions);
    if (imageFunction !== null) {
      const end = cssFunctionEnd(source, imageFunction);
      if (end === null) return true;
      const unsafeString = cssFunctionUnsafeImageString(source, imageFunction, end);
      if (unsafeString) {
        return true;
      }
      if (
        dataBaseInScope &&
        /^(?:image-set|-webkit-image-set|image)$/i.test(source.slice(index, imageFunction).trim())
      ) {
        return true;
      }
    }

    if (!isCssUrlToken(source, index)) {
      if (character === '\\') index = cssEscapeEnd(source, index);
      continue;
    }

    const opening = cssUrlTokenStart(source, index);
    const end = cssUrlTokenEnd(source, index);
    if (opening === null || end === null) return true;
    let reference = source.slice(opening + 1, end).trim();
    if (
      reference.length >= 2 &&
      ((reference.startsWith('"') && reference.endsWith('"')) || (reference.startsWith("'") && reference.endsWith("'")))
    ) {
      reference = reference.slice(1, -1);
    }
    reference = decodeCssEscapes(stripCssComments(reference, '')).trim();
    const property = propertyHint ?? cssPropertyAt(source, index);
    if (/^data:/i.test(reference) && cssUrlIsNamespaceDeclaration(source, index)) {
      index = end;
      continue;
    }
    if (
      !reference ||
      /^data:/i.test(reference) ||
      (dataBaseInScope && !/^[a-z][a-z0-9+.-]*:/i.test(reference) && !reference.startsWith('//'))
    ) {
      return true;
    }
    if (reference.startsWith('#')) {
      if (dataBaseInScope) return true;
      if (property && !SVG_VECTOR_URL_PROPERTIES.has(property)) return true;
    }
    index = end;
  }
  return false;
}

function isCssUrlToken(source: string, index: number): boolean {
  return cssUrlTokenStart(source, index) !== null;
}

function stripCssComments(source: string, replacement = ' '): string {
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
      result += replacement;
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

function hasUnsafeSvgResources(document: Document): boolean {
  const unnamespacedSvg = !document.documentElement.namespaceURI;
  const dataBaseScopes = new WeakMap<Element, boolean>();
  const pending: Array<{ element: Element; inherited: boolean }> = [
    { element: document.documentElement, inherited: false },
  ];
  while (pending.length > 0) {
    const { element, inherited } = pending.pop()!;
    const inDataBaseScope = inherited || /^data:/i.test((element.getAttributeNS(XML_NAMESPACE, 'base') ?? '').trim());
    dataBaseScopes.set(element, inDataBaseScope);
    for (const child of element.children) pending.push({ element: child, inherited: inDataBaseScope });
  }

  for (const element of document.querySelectorAll('*')) {
    const elementName = element.localName.toLowerCase();
    const dataBaseInScope = dataBaseScopes.get(element) ?? false;
    const isSvgElement = element.namespaceURI === SVG_NAMESPACE || (unnamespacedSvg && element.namespaceURI === null);
    if (isSvgElement && elementName === 'foreignobject') return true;
    if (isSvgElement && elementName === 'feimage') return true;
    if (element.namespaceURI === HTML_NAMESPACE) {
      const resourceAttributes = HTML_RESOURCE_ATTRIBUTES.get(elementName);
      if (
        resourceAttributes &&
        [...element.attributes].some((attribute) => {
          const name = attribute.localName.toLowerCase();
          if (!resourceAttributes.has(name)) return false;
          const value = attribute.value.trim();
          return !value || /^data:/i.test(value) || (name === 'srcset' && /data:/i.test(value));
        })
      ) {
        return true;
      }
    }

    const inlineStyle = element.getAttribute('style');
    if (inlineStyle && cssUrlReferencesData(inlineStyle, undefined, dataBaseInScope)) return true;

    if (!isSvgElement) continue;

    if (SVG_HREF_RESOURCE_ELEMENTS.has(elementName)) {
      const href = element.getAttribute('href') ?? element.getAttributeNS(XLINK_NAMESPACE, 'href');
      if (href !== null) {
        const value = href.trim();
        if (
          !value ||
          /^data:/i.test(value) ||
          (elementName === 'image' && value.startsWith('#')) ||
          (dataBaseInScope && !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith('//'))
        ) {
          return true;
        }
      }
    }

    for (const attribute of [...element.attributes]) {
      if (
        SVG_URL_PRESENTATION_ATTRIBUTES.has(attribute.localName.toLowerCase()) &&
        cssUrlReferencesData(attribute.value, attribute.localName.toLowerCase(), dataBaseInScope)
      ) {
        return true;
      }
    }

    if (['animate', 'animatecolor', 'animatemotion', 'animatetransform', 'set'].includes(elementName)) {
      const target = element.getAttribute('attributeName')?.trim();
      const separator = target?.indexOf(':') ?? -1;
      const targetLocalName = separator >= 0 ? target?.slice(separator + 1) : target;
      const normalizedTargetLocalName = targetLocalName?.toLowerCase();
      const targetPrefix = separator >= 0 ? target?.slice(0, separator) : undefined;
      const targetNamespace = targetPrefix ? element.lookupNamespaceURI(targetPrefix) : null;
      const targetsHref = targetLocalName === 'href' && (!targetPrefix || targetNamespace === XLINK_NAMESPACE);
      const values = ['by', 'from', 'to', 'values'].map((name) => element.getAttribute(name) ?? '');
      let targetElement = element.parentElement;
      const targetReference = element.getAttribute('href') ?? element.getAttributeNS(XLINK_NAMESPACE, 'href');
      if (targetReference && /^data:/i.test(targetReference.trim())) return true;
      if (targetReference?.startsWith('#')) {
        try {
          targetElement = document.getElementById(decodeURIComponent(targetReference.slice(1))) ?? targetElement;
        } catch {
          return true;
        }
      }
      if (targetsHref && values.some((value) => /^data:/i.test(value.trim()))) {
        return true;
      }
      if (
        targetsHref &&
        targetElement &&
        (targetElement.namespaceURI === SVG_NAMESPACE || (unnamespacedSvg && targetElement.namespaceURI === null)) &&
        ['image', 'feimage', 'use'].includes(targetElement.localName.toLowerCase()) &&
        values.some((value) => value.trim())
      ) {
        return true;
      }
      if (
        !targetPrefix &&
        (normalizedTargetLocalName === 'style' ||
          (normalizedTargetLocalName && SVG_URL_PRESENTATION_ATTRIBUTES.has(normalizedTargetLocalName))) &&
        values.some((value) => cssUrlReferencesData(value, normalizedTargetLocalName, dataBaseInScope))
      ) {
        return true;
      }
    }
  }

  return [...document.querySelectorAll('style')].some((style) =>
    cssUrlReferencesData(style.textContent ?? '', undefined, dataBaseScopes.get(style) ?? false)
  );
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

function pngCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngHeaderDimensions(header: Uint8Array): { width: number; height: number } | undefined {
  if (header.byteLength < 33 || !PNG_SIGNATURE.every((byte, index) => header[index] === byte)) return undefined;

  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(8, false) !== 13 || asciiAt(header, 12, 4) !== 'IHDR') return undefined;
  if (pngCrc32(header.subarray(12, 29)) !== view.getUint32(29, false)) return undefined;
  const bitDepth = header[24];
  const colorType = header[25];
  const validBitDepth =
    (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth)) ||
    (colorType === 2 && [8, 16].includes(bitDepth)) ||
    (colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) ||
    ((colorType === 4 || colorType === 6) && [8, 16].includes(bitDepth));
  if (!validBitDepth || header[26] !== 0 || header[27] !== 0 || header[28] > 1) return undefined;

  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function isCompleteStaticPng(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let chunkCount = 0;
  let hasImageData = false;

  while (offset + 12 <= bytes.byteLength && chunkCount < MAX_PNG_CHUNKS) {
    const length = view.getUint32(offset, false);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.byteLength) return false;
    const type = asciiAt(bytes, offset + 4, 4);
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') return false;
    if (type === 'IDAT') hasImageData = true;
    if (type === 'IEND') return length === 0 && hasImageData && chunkEnd === bytes.byteLength;
    offset = chunkEnd;
    chunkCount += 1;
  }

  return false;
}

function flattenedPngFromSvg(root: Element, width: number, height: number, sourceText: string): Blob | undefined {
  const rootAttributes = [...root.attributes].map((attribute) => attribute.name).sort();
  if (
    root.namespaceURI !== SVG_NAMESPACE ||
    root.localName !== 'svg' ||
    rootAttributes.join(',') !== 'height,viewBox,width,xmlns' ||
    root.getAttribute('xmlns') !== SVG_NAMESPACE
  ) {
    return undefined;
  }

  const rootWidth = root.getAttribute('width') ?? '';
  const rootHeight = root.getAttribute('height') ?? '';
  const parsedWidth = /^(?:[1-9]\d*)$/.test(rootWidth) ? Number(rootWidth) : undefined;
  const parsedHeight = /^(?:[1-9]\d*)$/.test(rootHeight) ? Number(rootHeight) : undefined;
  if (
    !Number.isSafeInteger(parsedWidth) ||
    !Number.isSafeInteger(parsedHeight) ||
    parsedWidth !== width ||
    parsedHeight !== height
  ) {
    return undefined;
  }

  const viewBox = (root.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox.length !== 4 || viewBox[0] !== 0 || viewBox[1] !== 0 || viewBox[2] !== width || viewBox[3] !== height) {
    return undefined;
  }

  if (root.childNodes.length !== 1 || root.firstChild?.nodeType !== 1) return undefined;
  const image = root.firstElementChild;
  if (!image || image.namespaceURI !== SVG_NAMESPACE || image.localName !== 'image' || image.childNodes.length !== 0) {
    return undefined;
  }
  const imageAttributes = [...image.attributes].map((attribute) => attribute.name).sort();
  if (
    imageAttributes.join(',') !== 'height,href,width' ||
    image.getAttribute('width') !== rootWidth ||
    image.getAttribute('height') !== rootHeight
  ) {
    return undefined;
  }

  const href = image.getAttribute('href') ?? '';
  const base64 = /^data:image\/png;base64,((?:[A-Za-z0-9+/]{4})+(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/i.exec(
    href
  )?.[1];
  if (!base64) return undefined;
  const canonicalSource = `<svg xmlns="${SVG_NAMESPACE}" width="${rootWidth}" height="${rootHeight}" viewBox="0 0 ${width} ${height}"><image href="${href}" width="${rootWidth}" height="${rootHeight}" /></svg>`;
  if (sourceText !== canonicalSource) return undefined;

  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const decodedLength = (base64.length / 4) * 3 - padding;
  if (!Number.isSafeInteger(decodedLength) || decodedLength < 33 || decodedLength > MAX_SVG_SOURCE_BYTES) {
    return undefined;
  }

  let headerBinary: string;
  try {
    headerBinary = atob(base64.slice(0, 44));
  } catch {
    return undefined;
  }
  if (headerBinary.length !== 33) return undefined;
  const header = Uint8Array.from(headerBinary, (character) => character.charCodeAt(0));
  const pngDimensions = pngHeaderDimensions(header);
  if (!pngDimensions) return undefined;
  const { width: pngWidth, height: pngHeight } = pngDimensions;
  if (pngWidth * pngHeight > MAX_CREATABLE_DOCUMENT_PIXELS) {
    throw new Error(
      `SVG embedded PNG is too large to open (${pngWidth}×${pngHeight}). Maximum is ${MAX_CREATABLE_DOCUMENT_PIXELS} pixels.`
    );
  }
  if (pngWidth !== width || pngHeight !== height) {
    throw new Error('SVG flattened PNG dimensions do not match the SVG canvas');
  }

  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return undefined;
  }
  if (binary.length !== decodedLength) return undefined;
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (!isCompleteStaticPng(bytes)) throw new Error('SVG flattened PNG must be a complete, non-animated PNG');
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([buffer], { type: 'image/png' });
}

async function rejectOversizedPng(file: File, existingHeader?: Uint8Array): Promise<void> {
  const header = existingHeader ?? new Uint8Array(await file.slice(0, 33).arrayBuffer());
  const dimensions = pngHeaderDimensions(header);
  if (!dimensions) throw new Error('PNG image has an invalid IHDR');
  const { width, height } = dimensions;
  if (width * height > MAX_CREATABLE_DOCUMENT_PIXELS) {
    throw new Error(
      `PNG image is too large to open (${width}×${height}). Maximum is ${MAX_CREATABLE_DOCUMENT_PIXELS} pixels.`
    );
  }

  let offset = 8;
  let chunkCount = 0;
  while (offset + 8 <= file.size && chunkCount < MAX_PNG_CHUNKS) {
    const chunkHeader = new Uint8Array(await file.slice(offset, offset + 8).arrayBuffer());
    if (chunkHeader.byteLength !== 8) throw new Error('PNG image has an invalid chunk sequence');
    const view = new DataView(chunkHeader.buffer, chunkHeader.byteOffset, chunkHeader.byteLength);
    const length = view.getUint32(0, false);
    const type = asciiAt(chunkHeader, 4, 4);
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') {
      throw new Error('Animated PNG images are not supported');
    }
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > file.size) throw new Error('PNG image has an invalid chunk sequence');
    if (type === 'IEND') {
      if (length !== 0) throw new Error('PNG image has an invalid IEND chunk');
      return;
    }
    offset = chunkEnd;
    chunkCount += 1;
  }

  throw new Error('PNG image has an invalid or excessive chunk sequence');
}

async function rejectOversizedSvg(file: File, mimeType: string): Promise<Blob | undefined> {
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
  if (root.localName.toLowerCase() !== 'svg' || (root.namespaceURI && root.namespaceURI !== SVG_NAMESPACE)) {
    throw new Error('SVG image has invalid XML dimensions');
  }
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

  const flattenedPng = flattenedPngFromSvg(root, width, height, text);
  if (flattenedPng) return flattenedPng;
  if (hasUnsafeSvgResources(document)) {
    throw new Error('SVG image uses an embedded resource that cannot be safely preflighted');
  }
  return undefined;
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
  const flattenedPng = isSvg ? await rejectOversizedSvg(file, svgMimeType) : undefined;
  if (!isSvg) {
    const pngHeader = new Uint8Array(await file.slice(0, 33).arrayBuffer());
    const hasPngSignature = PNG_SIGNATURE.every((byte, index) => pngHeader[index] === byte);
    const isPng = mimeEssence(svgMimeType) === 'image/png' || /\.png$/i.test(file.name) || hasPngSignature;
    if (isPng) await rejectOversizedPng(file, pngHeader);
  }

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
    const source = flattenedPng ?? (detectedMimeType ? new Blob([file], { type: detectedMimeType }) : file);
    reader.readAsDataURL(source);
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
