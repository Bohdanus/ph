import { describe, expect, it, vi } from 'vitest';
import { MAX_CREATABLE_DOCUMENT_PIXELS } from '../raster-utils.ts';
import { encodeSvg, MAX_SVG_SOURCE_BYTES } from '../svg-utils.ts';

function canvasOf(width: number, height: number, dataUrl = 'data:image/png;base64,pixels') {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const toDataURL = vi.spyOn(canvas, 'toDataURL').mockReturnValue(dataUrl);
  return { canvas, toDataURL };
}

describe('SVG encoding', () => {
  it('wraps the flattened canvas PNG in a valid SVG image', async () => {
    const { canvas } = canvasOf(12, 8);

    const blob = encodeSvg(canvas);

    expect(blob.type).toBe('image/svg+xml');
    await expect(blob.text()).resolves.toContain('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"');
    await expect(blob.text()).resolves.toContain('data:image/png;base64,pixels');
  });

  it('produces a well-formed document with a viewBox, an image element and a closing tag', async () => {
    const { canvas } = canvasOf(12, 8);

    const svg = await encodeSvg(canvas).text();

    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8" viewBox="0 0 12 8">' +
        '<image href="data:image/png;base64,pixels" width="12" height="8" /></svg>'
    );
    expect(svg.match(/<svg\b/g)).toHaveLength(1);
    expect(svg.match(/<\/svg>/g)).toHaveLength(1);
    expect(svg).not.toContain('<script');
  });

  it('always flattens to a PNG data URL regardless of the canvas format argument', () => {
    const { canvas, toDataURL } = canvasOf(4, 4);

    encodeSvg(canvas);

    expect(toDataURL).toHaveBeenCalledExactlyOnceWith('image/png');
  });

  it('rejects canvases whose PNG encoder returns the browser failure sentinel', () => {
    const { canvas, toDataURL } = canvasOf(8, 8, 'data:,');

    expect(() => encodeSvg(canvas)).toThrow('SVG image could not encode the canvas as a PNG data URL');
    expect(toDataURL).toHaveBeenCalledExactlyOnceWith('image/png');
  });

  it('rejects flattened exports larger than the import source-byte limit', () => {
    const oversizedPngDataUrl = `data:image/png;base64,${'A'.repeat(MAX_SVG_SOURCE_BYTES)}`;
    const { canvas } = canvasOf(1, 1, oversizedPngDataUrl);

    expect(() => encodeSvg(canvas)).toThrow(`Maximum is ${MAX_SVG_SOURCE_BYTES} bytes`);
  });

  it('allows canvases at the 100 MP document ceiling', () => {
    const { canvas, toDataURL } = canvasOf(10_000, 10_000);

    expect(encodeSvg(canvas).type).toBe('image/svg+xml');
    expect(toDataURL).toHaveBeenCalledExactlyOnceWith('image/png');
  });

  it('rejects oversized canvases before reading back pixels', () => {
    const { canvas, toDataURL } = canvasOf(MAX_CREATABLE_DOCUMENT_PIXELS + 1, 1);

    expect(() => encodeSvg(canvas)).toThrow(
      `SVG image is too large to save (${MAX_CREATABLE_DOCUMENT_PIXELS + 1}×1). Maximum is ${MAX_CREATABLE_DOCUMENT_PIXELS} pixels.`
    );
    expect(toDataURL).not.toHaveBeenCalled();
  });

  it.each([
    { width: 1, height: 1 },
    { width: 1, height: 64 },
    { width: 64, height: 1 },
    { width: 800, height: 600 },
  ])('carries $width x $height through the width, height, viewBox and image attributes', async ({ width, height }) => {
    const { canvas } = canvasOf(width, height);

    const svg = await encodeSvg(canvas).text();

    expect(svg).toContain(`width="${width}"`);
    expect(svg).toContain(`height="${height}"`);
    expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
    expect(svg).toContain(`<image href="data:image/png;base64,pixels" width="${width}" height="${height}" />`);
  });

  it('embeds the data URL verbatim without XML-escaping it', async () => {
    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const { canvas } = canvasOf(2, 2, dataUrl);

    const svg = await encodeSvg(canvas).text();

    expect(svg).toContain(`href="${dataUrl}"`);
    // The base64 data URL is embedded verbatim, without XML entity escaping.
    expect(svg).not.toContain('&amp;');
    expect(svg).not.toContain('&quot;');
  });

  it('accepts SVG source exactly at the byte limit', () => {
    // MAX_SVG_SOURCE_BYTES is the limit for the entire SVG document
    // The SVG template adds: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"><image href="' + dataUrl + '" width="1" height="1" /></svg>'
    // Which is about 150 bytes of overhead. So the data URL must leave room for that.
    const svgOverhead =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"><image href="" width="1" height="1" /></svg>'
        .length;
    const dataUrlLimit = MAX_SVG_SOURCE_BYTES - svgOverhead - 'data:image/png;base64,'.length;
    const exactlyAtLimit = `data:image/png;base64,${'A'.repeat(Math.max(0, dataUrlLimit))}`;
    const { canvas } = canvasOf(1, 1, exactlyAtLimit);

    const blob = encodeSvg(canvas);

    expect(blob.type).toBe('image/svg+xml');
    expect(blob.size).toBe(MAX_SVG_SOURCE_BYTES);
  });

  it('rejects a non-square canvas whose total area exceeds the pixel ceiling', () => {
    const height = Math.max(1, Math.floor(Math.sqrt(MAX_CREATABLE_DOCUMENT_PIXELS)));
    const width = Math.floor(MAX_CREATABLE_DOCUMENT_PIXELS / height) + 1;
    const { canvas, toDataURL } = canvasOf(width, height);

    expect(() => encodeSvg(canvas)).toThrow(
      `SVG image is too large to save (${width}×${height}). Maximum is ${MAX_CREATABLE_DOCUMENT_PIXELS} pixels.`
    );
    expect(toDataURL).not.toHaveBeenCalled();
  });

  it('verifies blob content is well-formed SVG with correct MIME type', async () => {
    const { canvas } = canvasOf(16, 16);

    const blob = encodeSvg(canvas);

    expect(blob.type).toBe('image/svg+xml');
    const text = await blob.text();
    expect(text).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(text).toContain('width="16"');
    expect(text).toContain('height="16"');
    expect(text).toContain('viewBox="0 0 16 16"');
    expect(text).toContain('<image href="data:image/png;base64,pixels" width="16" height="16" />');
  });
});
