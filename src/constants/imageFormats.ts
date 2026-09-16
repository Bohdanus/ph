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
  encoding: 'canvas' | 'tiff';
  supportsQuality: boolean;
};

const OUTPUT_EXTENSION_PATTERN = /\.(?:psd|png|jpe?g|webp|tiff?)$/i;

export function resolveImageFormat(format: string): ResolvedImageFormat {
  const normalized = format.trim().toLowerCase();
  const match = IMAGE_FORMATS.find(
    ({ value, extension }) =>
      value === normalized ||
      extension === normalized ||
      (extension === 'jpeg' && (normalized === 'jpg' || normalized === 'image/jpg')) ||
      (extension === 'tiff' && (normalized === 'tif' || normalized === 'image/tif' || normalized === 'image/x-tiff'))
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
