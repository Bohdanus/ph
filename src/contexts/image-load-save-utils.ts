import type { ImageUploadResponse } from './useFile.tsx';
import { resolveImageFormat, withFileExtension } from '../constants/imageFormats.ts';

const TIFF_MIME_TYPES = new Set(['image/tif', 'image/tiff', 'image/x-tiff']);
const BROWSER_IMAGE_EXTENSIONS = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;

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

export async function loadDocumentFile(file: File): Promise<ImageUploadResponse> {
  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (
    /\.psd$/i.test(file.name) ||
    String.fromCharCode(...signature) === '8BPS' ||
    file.type === 'image/vnd.adobe.photoshop'
  ) {
    const { loadPsd } = await import('./psd-utils.ts');
    return { fileName: file.name, document: await loadPsd(await file.arrayBuffer()) };
  }
  if (isTiffFile(file, signature)) {
    const { loadTiffFile } = await import('./tiff-utils.ts');
    return { fileName: file.name, image: await loadTiffFile(file) };
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

export const loadImageFile = (file: File): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    if (!file || (!file.type.startsWith('image/') && !BROWSER_IMAGE_EXTENSIONS.test(file.name))) {
      reject(new Error('Not an image file'));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        resolve(img);
      };
      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };
      img.src = e.target?.result as string;
    };
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    reader.readAsDataURL(file);
  });
};

export async function saveImageToDisk(
  canvas: HTMLCanvasElement,
  fileName: string,
  format: string,
  quality?: number
): Promise<void> {
  const imageFormat = resolveImageFormat(format);
  if (imageFormat.encoding === 'tiff') {
    const { encodeTiff } = await import('./tiff-utils.ts');
    const blob = await encodeTiff(canvas);
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
