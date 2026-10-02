const segmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
});

export function charLength(str: string): number {
  return [...segmenter.segment(str)].length;
}

/**
 * The string split into its grapheme clusters, in order.
 *
 * `charLength`, `deleteCharAt` and `deleteLastChar` all index by cluster, so a caller that wants
 * to iterate a string the same way those three measure it needs the clusters themselves rather
 * than `[...str]`, which splits by code unit and separates a surrogate pair or a combining mark
 * from its base. The Type tool's manual tracking fallback draws one cluster at a time
 * (`src/tools/text.ts`), so a composed `é` or an emoji ZWJ sequence advances as one glyph there
 * and would advance as two here.
 */
export function graphemes(str: string): string[] {
  return [...segmenter.segment(str)].map((s) => s.segment);
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

export function ellipsify(str: string = '', maxLength: number = 20): string {
  if (str.length <= maxLength) return str;
  if (maxLength < 3) return '...'.slice(0, Math.max(0, maxLength));

  const budget = maxLength - 3;
  let end = 0;
  for (const seg of segmenter.segment(str)) {
    const next = seg.index + seg.segment.length;
    if (next > budget) break;
    end = next;
  }

  return str.slice(0, end) + '...';
}
