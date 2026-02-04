export const isLightColor = (color: string): boolean => {
  const hex = color.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Using the relative luminance formula for perceived brightness:
  // 0.299*R + 0.587*G + 0.114*B
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

  // Threshold of 128 (middle of 0-255) is standard for light/dark determination.
  return luminance > 128;
};
