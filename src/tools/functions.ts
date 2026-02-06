// import { EXP_K } from './constants.ts';
//
// export function exp0_1(val: number) {
//   val = val / 100;
//   const res = Math.pow(2, 4 * val);
//   return res;
// }

import type { ResizeCb } from '../components/ToolbarsRight/types.ts';

export function exp1_1(val: number, k: number = 2) {
  val = val / 100;
  const res = Math.exp(k * val);
  return res;
}

export function writeImageToCanvas(
  image: HTMLImageElement | ImageBitmap | null,
  canvas: HTMLCanvasElement | null,
  callback?: ResizeCb
) {
  if (!image || !canvas) return null;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    // ctx.reset();
    canvas.width = image.width;
    canvas.height = image.height;
    ctx.drawImage(image, 0, 0);

    callback?.(image.width, image.height);
  }
}

// function base64ToUint8Array(base64) {
//   const binary = atob(base64);
//   const bytes = new Uint8Array(binary.length);
//
//   for (let i = 0; i < binary.length; i++) {
//     bytes[i] = binary.charCodeAt(i);
//   }
//
//   return bytes;
// }
//
// function base64ToBlob(base64, type = 'image/png') {
//   const bytes = base64ToUint8Array(base64);
//   return new Blob([bytes], { type });
// }
