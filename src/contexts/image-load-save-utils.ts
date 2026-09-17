import type { ImageUploadResponse } from './useFile.tsx';
import { resolveImageFormat, withFileExtension } from '../constants/imageFormats.ts';

const TIFF_MIME_TYPES = new Set(['image/tif', 'image/tiff', 'image/x-tiff']);
const BMP_MIME_TYPES = new Set(['image/bmp', 'image/x-bmp', 'image/x-ms-bmp']);
const ICO_MIME_TYPES = new Set(['image/ico', 'image/x-icon', 'image/vnd.microsoft.icon']);
const BROWSER_IMAGE_EXTENSIONS = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;

function asciiAt(signature: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...signature.subarray(offset, offset + length));
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
  if (/\.svg$/i.test(file.name) || file.type.toLowerCase() === 'image/svg+xml') return true;
  const header = new TextDecoder()
    .decode(signature)
    .replace(/^\uFEFF/, '')
    .trimStart()
    .toLowerCase();
  return header.startsWith('<svg') || (header.startsWith('<?xml') && header.includes('<svg'));
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
    return { fileName: file.name, image: await loadImageFile(file, 'image/svg+xml') };
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

export const loadImageFile = (file: File, detectedMimeType?: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    if (!file || (!detectedMimeType && !file.type.startsWith('image/') && !BROWSER_IMAGE_EXTENSIONS.test(file.name))) {
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
