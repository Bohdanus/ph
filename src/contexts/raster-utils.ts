/**
 * The largest document this app can create: NewImageDialog caps both axes at 10,000 px.
 */
export const MAX_CREATABLE_DOCUMENT_PIXELS = 100_000_000;

export type PixelDimensions = { width: number; height: number };

export function assertWithinDocumentPixelBudget(dimensions: PixelDimensions, label = 'Image'): void {
  const { width, height } = dimensions;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`${label} has invalid dimensions`);
  }
  if (width * height > MAX_CREATABLE_DOCUMENT_PIXELS) {
    throw new Error(`${label} is too large (${width}×${height}). Maximum is ${MAX_CREATABLE_DOCUMENT_PIXELS} pixels.`);
  }
}

export type RgbaImageData = {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
};

export function getCanvasImageData(canvas: HTMLCanvasElement): ImageData {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to read canvas pixels');
  }
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

export function loadImageSource(source: string, errorMessage = 'Failed to load image'): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(errorMessage));
    image.src = source;
  });
}

export function imageDataToImage(imageData: RgbaImageData, errorMessage: string): Promise<HTMLImageElement> {
  if (!imageData.width || !imageData.height) {
    return Promise.reject(new Error('Image has invalid dimensions'));
  }

  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext('2d');
  if (!context) {
    return Promise.reject(new Error('Unable to create a canvas for image decoding'));
  }

  const target = context.createImageData(imageData.width, imageData.height);
  target.data.set(imageData.data);
  context.putImageData(target, 0, 0);
  return loadImageSource(canvas.toDataURL('image/png'), errorMessage);
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to create PNG blob from canvas'));
      }, 'image/png');
    } catch (error) {
      reject(error);
    }
  });
}
