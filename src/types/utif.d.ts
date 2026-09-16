declare module 'utif' {
  type TiffImageDirectory = {
    width?: number;
    height?: number;
    [key: string]: unknown;
  };

  type UTIF = {
    decode: (buffer: ArrayBuffer) => TiffImageDirectory[];
    decodeImage: (buffer: ArrayBuffer, ifd: TiffImageDirectory) => void;
    toRGBA8: (ifd: TiffImageDirectory) => Uint8Array;
    encodeImage: (
      rgba: ArrayBuffer | ArrayBufferView,
      width: number,
      height: number,
      metadata?: TiffImageDirectory
    ) => ArrayBuffer;
  };

  const UTIF: UTIF;
  export default UTIF;
}
