// import { EXP_K } from './constants.ts';
//
// export function exp0_1(val: number) {
//   val = val / 100;
//   const res = Math.pow(2, 4 * val);
//   return res;
// }

import type { ResizeCb } from '../components/ToolbarsRight/types.ts';
import type { BitmapSource } from '../contexts/general-types.ts';

export function exp1_1(val: number, k: number = 2) {
  val = val / 100;
  const res = Math.exp(k * val);
  return res;
}

export function writeImageToCanvas(
  image: BitmapSource,
  canvas: HTMLCanvasElement,
  callback?: ResizeCb
): CanvasRenderingContext2D {
  canvas.width = image.width;
  canvas.height = image.height;

  const ctx = canvas.getContext('2d');
  ctx!.drawImage(image, 0, 0);

  callback?.(image.width, image.height);

  return ctx!;
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
