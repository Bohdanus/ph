// import type { Ctx2D } from '../contexts/general-types.ts';

// function drawJustifiedText(ctx: Ctx2D, words: string[], x: number, y: number, maxWidth: number) {
//   let line = [];
//   let lineWidth = 0;
//
//   for (let word of words) {
//     const w = ctx.measureText(word + ' ').width;
//     if (lineWidth + w > maxWidth && line.length > 0) {
//       justifyLine(ctx, line, x, y, maxWidth, lineWidth);
//       y += 20; // line height
//       line = [];
//       lineWidth = 0;
//     }
//     line.push(word);
//     lineWidth += w;
//   }
//
//   // last line (usually left-aligned)
//   ctx.fillText(line.join(' '), x, y);
// }
//
// function justifyLine(ctx: Ctx2D, words: string[], x: number, y: number, maxWidth: number, lineWidth: number) {
//   const gaps = words.length - 1;
//   const extra = (maxWidth - lineWidth) / gaps;
//
//   let offset = x;
//   for (let i = 0; i < words.length; i++) {
//     const word = words[i];
//     ctx.fillText(word, offset, y);
//     offset += ctx.measureText(word + ' ').width + extra;
//   }
// }
