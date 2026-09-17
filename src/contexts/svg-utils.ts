export function encodeSvg(canvas: HTMLCanvasElement): Blob {
  const { width, height } = canvas;
  const dataUrl = canvas.toDataURL('image/png');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image href="${dataUrl}" width="${width}" height="${height}" /></svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}
