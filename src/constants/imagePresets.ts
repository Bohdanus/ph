export const MM_PER_INCH = 25.4;

export type WidthUnit = 'mm' | 'in' | 'px';

export type ImagePreset = {
  id: string;
  label: string;
  unit: WidthUnit;
  // prefer mm for metric sizes, or inches for imperial
  widthMm?: number;
  heightMm?: number;
  widthIn?: number;
  heightIn?: number;
};

export const PRESETS: Record<string, Omit<ImagePreset, 'id'>> = {
  custom: { label: 'Custom', unit: 'px' },
  a3: { label: 'A3 (297 × 420 mm)', widthMm: 297, heightMm: 420, unit: 'mm' },
  a4: { label: 'A4 (210 × 297 mm)', widthMm: 210, heightMm: 297, unit: 'mm' },
  a5: { label: 'A5 (148 × 210 mm)', widthMm: 148, heightMm: 210, unit: 'mm' },
  'us-letter': { label: 'US Letter (8.5 × 11 in)', widthIn: 8.5, heightIn: 11, unit: 'in' },
  'us-legal': { label: 'US Legal (8.5 × 14 in)', widthIn: 8.5, heightIn: 14, unit: 'in' },
  'photo-4x6': { label: 'Photo 4 × 6 in', widthIn: 4, heightIn: 6, unit: 'in' },
};

export function mmToInches(mm: number): number {
  return mm / MM_PER_INCH;
}

export function inchesToPx(inches: number, dpi: number): number {
  return Math.round(inches * dpi);
}

export function mmToPx(mm: number, dpi: number): number {
  return inchesToPx(mmToInches(mm), dpi);
}

export function computePixelsFromPreset(preset: ImagePreset, dpi: number): { width: number; height: number } {
  let widthPx = 0;
  let heightPx = 0;

  if (preset.widthMm && preset.heightMm) {
    widthPx = mmToPx(preset.widthMm, dpi);
    heightPx = mmToPx(preset.heightMm, dpi);
  } else if (preset.widthIn && preset.heightIn) {
    widthPx = inchesToPx(preset.widthIn, dpi);
    heightPx = inchesToPx(preset.heightIn, dpi);
  }

  return { width: widthPx, height: heightPx };
}
