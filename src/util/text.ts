function drawJustifiedText(ctx, text, x, y, maxWidth) {
  const words = text.split(' ');
  let line = [];
  let lineWidth = 0;

  for (let word of words) {
    const w = ctx.measureText(word + ' ').width;
    if (lineWidth + w > maxWidth && line.length > 0) {
      justifyLine(ctx, line, x, y, maxWidth, lineWidth);
      y += 20; // line height
      line = [];
      lineWidth = 0;
    }
    line.push(word);
    lineWidth += w;
  }

  // last line (usually left-aligned)
  ctx.fillText(line.join(' '), x, y);
}

function justifyLine(ctx, words, x, y, maxWidth, lineWidth) {
  const gaps = words.length - 1;
  const extra = (maxWidth - lineWidth) / gaps;

  let offset = x;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    ctx.fillText(word, offset, y);
    offset += ctx.measureText(word + ' ').width + extra;
  }
}
