export const DEFAULT_JPEG_QUALITY = 0.92;

export const IMAGE_FORMATS = [
  {
    value: 'image/png',
    label: 'PNG',
    extension: 'png',
    mimeType: 'image/png',
    encoding: 'canvas',
    supportsQuality: false,
  },
  {
    value: 'image/jpeg',
    label: 'JPEG',
    extension: 'jpeg',
    mimeType: 'image/jpeg',
    encoding: 'canvas',
    supportsQuality: true,
  },
  {
    value: 'image/webp',
    label: 'WebP',
    extension: 'webp',
    mimeType: 'image/webp',
    encoding: 'canvas',
    supportsQuality: false,
  },
  {
    value: 'image/tiff',
    label: 'TIFF',
    extension: 'tiff',
    mimeType: 'image/tiff',
    encoding: 'tiff',
    supportsQuality: false,
  },
  {
    value: 'image/bmp',
    label: 'BMP',
    extension: 'bmp',
    mimeType: 'image/bmp',
    encoding: 'bmp',
    supportsQuality: false,
  },
  {
    value: 'image/gif',
    label: 'GIF (static)',
    extension: 'gif',
    mimeType: 'image/gif',
    encoding: 'gif',
    supportsQuality: false,
  },
  {
    value: 'image/avif',
    label: 'AVIF',
    extension: 'avif',
    mimeType: 'image/avif',
    encoding: 'avif',
    supportsQuality: false,
  },
  {
    value: 'image/x-icon',
    label: 'ICO',
    extension: 'ico',
    mimeType: 'image/x-icon',
    encoding: 'ico',
    supportsQuality: false,
  },
  {
    value: 'image/svg+xml',
    label: 'SVG (flattened)',
    extension: 'svg',
    mimeType: 'image/svg+xml',
    encoding: 'svg',
    supportsQuality: false,
  },
] as const;

export const PSD_FORMAT = {
  value: 'psd',
  label: 'Photoshop PSD (layers)',
} as const;

export type ImageFormat = (typeof IMAGE_FORMATS)[number]['value'];

type ResolvedImageFormat = {
  value: string;
  label: string;
  extension: string;
  mimeType: string;
  encoding: 'canvas' | 'tiff' | 'bmp' | 'gif' | 'avif' | 'ico' | 'svg';
  supportsQuality: boolean;
};

const OUTPUT_EXTENSION_PATTERN = /\.(?:psd|png|jpe?g|webp|tiff?|bmp|gif|avif|ico|svg)$/i;

export function resolveImageFormat(format: string): ResolvedImageFormat {
  const normalized = format.trim().toLowerCase();
  const match = IMAGE_FORMATS.find(
    ({ value, extension }) =>
      value === normalized ||
      extension === normalized ||
      (extension === 'jpeg' && (normalized === 'jpg' || normalized === 'image/jpg')) ||
      (extension === 'tiff' && (normalized === 'tif' || normalized === 'image/tif' || normalized === 'image/x-tiff')) ||
      (extension === 'bmp' && (normalized === 'image/x-bmp' || normalized === 'image/x-ms-bmp')) ||
      (extension === 'ico' &&
        (normalized === 'image/ico' || normalized === 'image/vnd.microsoft.icon' || normalized === 'icon')) ||
      (extension === 'svg' && normalized === 'image/svg')
  );

  if (match) return match;

  const extension = normalized.replace(/^image\//, '').replace(/^\./, '') || 'png';
  return {
    value: format,
    label: format,
    extension,
    mimeType: normalized.startsWith('image/') ? normalized : `image/${extension}`,
    encoding: 'canvas',
    supportsQuality: false,
  };
}

export function withFileExtension(fileName: string, extension: string): string {
  const normalizedName = fileName.trim() || 'image';
  const normalizedExtension = extension
    .trim()
    .toLowerCase()
    .replace(/^image\//, '')
    .replace(/^\./, '');
  return `${stripOutputFileExtension(normalizedName)}.${normalizedExtension}`;
}

export function stripOutputFileExtension(fileName: string): string {
  return fileName.replace(OUTPUT_EXTENSION_PATTERN, '');
}
