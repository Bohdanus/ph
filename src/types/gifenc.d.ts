declare module 'gifenc' {
  type GifColor = number[];
  type GifPixelData = Uint8Array | Uint8ClampedArray;

  type QuantizeOptions = {
    format?: 'rgb565' | 'rgb444' | 'rgba4444';
    clearAlpha?: boolean;
    clearAlphaColor?: number;
    clearAlphaThreshold?: number;
    oneBitAlpha?: boolean | number;
  };

  type GifEncoder = {
    finish: () => void;
    bytes: () => Uint8Array;
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      options?: {
        palette?: GifColor[];
        transparent?: boolean;
        transparentIndex?: number;
      }
    ) => void;
  };

  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): GifEncoder;
  export function quantize(rgba: GifPixelData, maxColors: number, options?: QuantizeOptions): GifColor[];
  export function applyPalette(rgba: GifPixelData, palette: GifColor[], format?: string): Uint8Array;
}
