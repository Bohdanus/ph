const segmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
});

export function charLength(str: string): number {
  let count = 0;
  for (const _ of segmenter.segment(str)) count++;
  return count;
}

export function deleteLastChar(str: string): [string, number] {
  let lastIndex = 0;
  for (const s of segmenter.segment(str)) {
    lastIndex = s.index;
  }
  const result = str.slice(0, lastIndex);

  return [result, lastIndex - 1];
}

export function deleteCharAt(str: string, charIndex: number): string {
  let start = -1;
  let end = -1;
  let i = 0;

  for (const seg of segmenter.segment(str)) {
    if (i === charIndex) start = seg.index;
    if (i === charIndex + 1) end = seg.index;
    i++;
  }

  if (start === -1) return str;
  if (end === -1) end = str.length;

  return str.slice(0, start) + str.slice(end);
}
