import UTIF from 'utif';

function loadImageSource(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to decode TIFF image'));
    image.src = source;
  });
}

export async function loadTiffFile(file: Blob): Promise<HTMLImageElement> {
  const buffer = await file.arrayBuffer();
  const pages = UTIF.decode(buffer);
  const page = pages[0];

  if (!page) {
    throw new Error('TIFF file contains no image pages');
  }

  UTIF.decodeImage(buffer, page);
  const { width, height } = page;
  if (!width || !height) {
    throw new Error('TIFF image has invalid dimensions');
  }

  const rgba = UTIF.toRGBA8(page);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to create a canvas for TIFF decoding');
  }

  const imageData = context.createImageData(width, height);
  imageData.data.set(rgba);
  context.putImageData(imageData, 0, 0);
  return loadImageSource(canvas.toDataURL('image/png'));
}

export async function encodeTiff(canvas: HTMLCanvasElement): Promise<Blob> {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to read canvas pixels for TIFF encoding');
  }

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const buffer = UTIF.encodeImage(data, canvas.width, canvas.height);
  return new Blob([buffer], { type: 'image/tiff' });
}
