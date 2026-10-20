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
    expect(svg).not.toContain('&amp;');
    expect(svg).not.toContain('&quot;');
  });
});
