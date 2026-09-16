import type { ImageUploadResponse } from './useFile.tsx';

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
  return { fileName: file.name, image: await loadImageFile(file) };
}

export function downloadBlob(blob: Blob, fileName: string, extension: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileName.replace(/\.(psd|png|jpe?g|webp)$/i, '')}.${extension}`;
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
    if (!file || !file.type.startsWith('image/')) {
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

export async function saveImageToDisk(canvas: HTMLCanvasElement, fileName: string, format: string): Promise<void> {
  const extension = format.replace(/^image\//, '');
  return new Promise((resolve, reject) => {
    // Create a blob from the canvas and trigger download
    canvas.toBlob((blob) => {
      if (blob) {
        try {
          downloadBlob(blob, fileName, extension);
          resolve();
        } catch (error) {
          reject(error);
        }
      } else {
        reject(new Error('Failed to create blob from canvas'));
      }
    }, `image/${extension}`);
  });
}
