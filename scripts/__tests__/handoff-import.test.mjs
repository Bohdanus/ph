/**
 * `handoff-import.mjs` against the three documents it exists to import.
 *
 * The fixtures in the second half pin shapes; the first half pins the real
 * files, because the parser's contract is "these three documents parse", and a
 * parser that passes every inline fixture while mis-numbering a real heading is
 * exactly the failure a fixture cannot see. So the real-document assertions are
 * properties of the output (shape, origin grammar, stability, nothing absolute)
 * plus a few exact ones, and a change to any of the three documents is allowed
 * to move the item count without failing: an exact count would be a tripwire on
 * somebody else's prose.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCOPE_BY_FILE, deadNumbers, parseHandoffDoc, planImport } from '../lib/agent-board/handoff-import.mjs';

/**
 * The worktree root, which is two levels above this file rather than three:
 * the file is `scripts/__tests__/handoff-import.test.mjs`.
 *
 * `import.meta.url` cannot be the base of that walk. The root Vitest project
 * runs in jsdom, and jsdom rewrites `import.meta.url` to the dev server's
 * `http://localhost:3000/@fs/…` form, which `readFileSync` refuses because it
 * is not a `file:` URL — so a relative `new URL(…, import.meta.url)` resolves
 * against the wrong base and fails with a scheme error that says nothing about
 * which path was wrong. `import.meta.dirname` is a real path in this runner, and
 * the project root is the documented fallback, so both are tried and the first
 * that actually holds `HANDOFF.md` wins.
 */
function findRoot() {
  for (const start of [import.meta.dirname, process.cwd()]) {
    if (typeof start !== 'string') continue;
    const candidate = resolve(start, '..', '..');
    if (existsSync(join(candidate, 'HANDOFF.md'))) return candidate;
  }
  throw new Error('cannot locate the worktree root that holds HANDOFF.md');
}

const ROOT = findRoot();

const DOCS = Object.keys(SCOPE_BY_FILE).map((file) => {
  const text = readFileSync(join(ROOT, file), 'utf8');
  return { file, text, parsed: parseHandoffDoc({ file, text }) };
});

const byFile = (file) => DOCS.find((doc) => doc.file === file);
const handoff = byFile('HANDOFF.md');
const flakes = byFile('TEST-FLAKES.md');
const openProblems = byFile('e2e/OPEN_PROBLEMS.md');

const ORIGIN_SHAPE = /^[\w.-]+\.md#\d+$|^[\w.-]+\.md#[a-z0-9-]+$/;
const KNOWN_EXTENSION =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|scss|css|yml|yaml|txt|png|avif|jpg|jpeg|gif|webp|ico|wasm|svg)$/i;
const DEAD_WORD = /deleted|closed|done|resolved|fixed|landed|superseded/i;

/**
 * The same short list the parser uses for a file at the repository root, restated
 * here so a change to one side that is not made on the other fails as a test
 * rather than silently widening what the board will lock.
 */
const ROOT_FILE_SHAPED =
  /^(?:index|package|package-lock|tsconfig(?:\.[\w.]+)?|vitest(?:\.[\w.]+)?|vite(?:\.[\w.]+)?|playwright(?:\.[\w.]+)?|postcss|eslint|node|AGENTS|HANDOFF|TEST-FLAKES|DEPENDENCIES|README)\b[^/]*\.(?:ts|tsx|js|jsx|mjs|json|jsonc|html|md)$/i;

/** The items a document still calls open: everything its dead set does not name. */
function liveItems(parsed) {
  return parsed.items.filter((item) => {
    const number = /#(\d+)$/.exec(item.origin);
    return !number || !parsed.dead.includes(Number(number[1]));
  });
}

function expectWellFormed(parsed) {
  for (const item of parsed.items) {
    expect(item.origin).toMatch(ORIGIN_SHAPE);
    expect(item.title.length).toBeGreaterThan(0);
    expect(item.title).not.toMatch(/^#/);
    expect(item.title).not.toMatch(/\n/);
    expect(item.body.length).toBeLessThanOrEqual(4000);
    expect(item.files.length).toBeLessThanOrEqual(12);

    for (const file of item.files) {
      expect(file.startsWith('/')).toBe(false);
      // A path the board can act on is either inside a directory or one of the
      // named files at the repository root; a bare word with an extension is
      // prose, and the parser must not offer it as something to lock.
      expect(file.includes('/') || ROOT_FILE_SHAPED.test(file)).toBe(true);
      expect(file).toMatch(KNOWN_EXTENSION);
      expect(file).not.toMatch(/\s/);
    }
  }
  expect(new Set(parsed.items.map((item) => item.origin)).size).toBe(parsed.items.length);
}

describe('the scope map', () => {
  it('names the scope of each of the three documents, and nothing else', () => {
    expect(SCOPE_BY_FILE).toEqual({
      'HANDOFF.md': 'history',
      'TEST-FLAKES.md': 'test',
      'e2e/OPEN_PROBLEMS.md': 'e2e',
    });
  });
});

describe('the three real documents', () => {
  it('each yields items, under its own scope', () => {
    for (const doc of DOCS) {
      expect(doc.parsed.scope, doc.file).toBe(SCOPE_BY_FILE[doc.file]);
      expect(doc.parsed.items.length, doc.file).toBeGreaterThan(0);
      expectWellFormed(doc.parsed);
    }
  });

  it('reads a numbered document as one item per number, in document order', () => {
    /**
     * Grammar and stability, never the documents' current contents. The file's own
     * docstring says a change to any of the three documents is allowed to move the item
     * count without failing this suite, and an earlier revision of this test broke that
     * promise: it transcribed an exact list of TEST-FLAKES origins, so adding `## 9.` to
     * TEST-FLAKES.md — the workflow AGENTS.md mandates — failed a parser test over a
     * document edit. Three assertions on the other side of this merge broke the same way,
     * over a dead-number array and two HANDOFF titles.
     *
     * The list below is DERIVED from the document rather than transcribed, which is
     * stricter and not looser: it is whatever the document actually says, so a parser
     * that mis-numbered a heading, skipped one, or reordered them still fails. Being
     * equal to the document's own heading sequence, it subsumes the ascending,
     * uniqueness and origin-shape properties the other side asserted separately: a list
     * built here is unique, ordered, and shaped `TEST-FLAKES.md#<number>` by
     * construction.
     *
     * The derivation accepts the `## Item 9` heading form as well as `## 9.`, because
     * the parser's own `NUMBERED` does, and a derivation narrower than the grammar it
     * validates is a tripwire on the next heading somebody writes that way.
     */
    const HEADING_NUMBER = /^#{1,6}[ \t]+(?:[Ii]tem[ \t]+)?(\d+)\b/gim;
    const headingNumbers = [...flakes.text.matchAll(HEADING_NUMBER)].map((match) => Number(match[1]));
    expect(headingNumbers.length).toBeGreaterThan(0);
    expect(flakes.parsed.items.map((item) => item.origin)).toEqual(
      headingNumbers.map((number) => `TEST-FLAKES.md#${number}`)
    );
  });

  it("keeps HANDOFF.md's own numbering, so every origin there is a number", () => {
    const origins = handoff.parsed.items.map((item) => item.origin);
    expect(origins.length).toBeGreaterThan(0);
    for (const origin of origins) expect(origin, origin).toMatch(/^HANDOFF\.md#\d+$/);
    // Ascending by number, and no number claimed twice — the two properties
    // that make an origin stable enough to key an import on.
    const numbers = origins.map((origin) => Number(origin.split('#')[1]));
    expect(new Set(numbers).size).toBe(numbers.length);
    expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
  });

  it('reads OPEN_PROBLEMS.md’s severity headings, which carry no number at all', () => {
    const items = openProblems.parsed.items;
    /**
     * Asserted as a SHAPE, not as the document's current text. This file
     * describes a live document that other work edits, and pinning a title here
     * made the test fail when somebody fixed the very P1 it named — a
     * documentation change, not a parser defect. What matters is that a
     * `P<n> — <problem>` heading yields an item with a slug origin, and that no
     * origin in this document is a number.
     */
    const severity = items.filter((item) => /^P\d{1,3}\s*[—–-]/.test(item.title));
    expect(severity.length).toBeGreaterThan(0);
    for (const item of severity) expect(item.origin).toMatch(/^OPEN_PROBLEMS\.md#[a-z0-9-]+$/);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.origin).not.toMatch(/#\d+$/);
  });

  it('records the numbers a deleted heading retires, and nothing else', () => {
    // Derived from the document, not pinned: the retired set moves every time
    // somebody lands a fix, and the property worth holding is that the parser's
    // dead set IS the set the document's own deleted headings name.
    expect(handoff.parsed.dead).toEqual(deadNumbers(handoff.text));
    expect(handoff.parsed.dead).toEqual(expect.arrayContaining([expect.any(Number)]));
    // Ascending and unique, so it can be compared and counted.
    expect(new Set(handoff.parsed.dead).size).toBe(handoff.parsed.dead.length);
    expect([...handoff.parsed.dead].sort((a, b) => a - b)).toEqual(handoff.parsed.dead);
    // A document that has not deleted anything retires nothing.
    expect(flakes.parsed.dead).toEqual([]);
    expect(openProblems.parsed.dead).toEqual([]);
  });

  it('parses the same text to the same result twice', () => {
    for (const doc of DOCS) {
      expect(parseHandoffDoc({ file: doc.file, text: doc.text }), doc.file).toEqual(doc.parsed);
    }
  });

  it('produces one item per numbered heading, and no item for a prose section', () => {
    /**
     * The grammar, counted from the raw document: as many items as there are
     * numbered headings, and no more. That is the property a parser can be
     * wrong about in both directions — a missed heading loses a defect, an
     * invented one files a section of prose as work — and it is checked without
     * naming a single heading, so editing any of the three documents cannot fail
     * it. (An earlier version asserted that every title starts with its number,
     * which is simply false: the number is stripped from the title.)
     */
    const countHeadings = (text, pattern) => [...text.matchAll(pattern)].length;
    for (const doc of [handoff, flakes]) {
      const headings = countHeadings(doc.text, /^#{1,6}[ \t]+(?:Item[ \t]+)?\d+\b/gim);
      expect(headings, doc.file).toBeGreaterThan(0);
      expect(doc.parsed.items.length, doc.file).toBe(headings);
    }
    const severities = countHeadings(openProblems.text, /^#{1,6}[ \t]+P\d{1,3}\b/gim);
    expect(severities, 'OPEN_PROBLEMS.md').toBeGreaterThan(0);
    expect(openProblems.parsed.items.length).toBe(severities);
  });
});

describe('planning the import', () => {
  const plan = planImport(
    DOCS.map((doc) => doc.parsed),
    []
  );

  it('creates every live item, and skips none of them', () => {
    expect(plan.create).toHaveLength(DOCS.reduce((total, doc) => total + liveItems(doc.parsed).length, 0));
    expect(plan.skip).toEqual([]);
    expect(new Set(plan.create.map((item) => item.origin)).size).toBe(plan.create.length);
    for (const item of plan.create) {
      expect(DOCS.flatMap((doc) => liveItems(doc.parsed).map((live) => live.origin))).toContain(item.origin);
    }
  });

  it('files an origin the board already holds as skipped, never as created', () => {
    const second = planImport([handoff.parsed], new Set(['HANDOFF.md#12']));
    expect(second.skip).toEqual(['HANDOFF.md#12']);
    expect(second.create.map((item) => item.origin)).not.toContain('HANDOFF.md#12');
    expect(second.create).toHaveLength(liveItems(handoff.parsed).length - 1);
  });

  it('never puts one origin in both buckets', () => {
    const created = new Set(plan.create.map((item) => item.origin));
    for (const origin of plan.skip) expect(created.has(origin), origin).toBe(false);
  });

  it('treats the same origin twice in one batch as one create and one skip', () => {
    const both = planImport([flakes.parsed, flakes.parsed], []);
    expect(both.create.map((item) => item.origin)).toEqual(flakes.parsed.items.map((item) => item.origin));
    expect(both.skip).toEqual(flakes.parsed.items.map((item) => item.origin));
  });

  it('does not file a number the document records as finished', () => {
    const created = plan.create.map((item) => item.origin);
    // Nothing the real document parsed may name a number in its own dead set.
    // This used to be non-trivially false: the prose inside
    // `### Items 5, 7, 9 … — deleted` produced phantoms for 7 and 18 that
    // planImport had to filter out, and first-occurrence-wins meant the
    // phantom owned the origin a reopened `## 7.` would need.
    for (const item of handoff.parsed.items) {
      const number = /#(\d+)$/.exec(item.origin)?.[1];
      if (!number) continue;
      expect(handoff.parsed.dead, `${item.origin} is in the document's dead set`).not.toContain(Number(number));
    }
    for (const origin of created) {
      // Scoped to this document: `TEST-FLAKES.md#5` is a different entry from
      // `HANDOFF.md#5`, and only the latter is judged against HANDOFF's dead
      // set.
      if (!origin.startsWith('HANDOFF.md#')) continue;
      const number = /#(\d+)$/.exec(origin)?.[1];
      if (!number) continue;
      expect(handoff.parsed.dead, `${origin} was filed`).not.toContain(Number(number));
    }
  });

  it('drops a live entry whose number the document has deleted', () => {
    const parsed = parseHandoffDoc({
      file: 'HANDOFF.md',
      text: '## 4. Retired but not yet removed\n\nAlpha.\n\n### Items 4 — deleted\n',
    });
    expect(parsed.items.map((item) => item.origin)).toEqual(['HANDOFF.md#4']);
    expect(planImport([parsed], []).create).toEqual([]);
    expect(planImport([parsed], []).skip).toEqual([]);
  });

  it('keeps the items under a live heading that merely contains a dead word', () => {
    /**
     * `## Fixed — a real P2 race in the adapter` contains "fixed" and is not a
     * list of retired items. Suppressing the inline markers under ANY dead-word
     * heading deleted both entries beneath it, which is the opposite of what
     * this suppression is for.
     */
    const parsed = parseHandoffDoc({
      file: 'HANDOFF.md',
      text:
        '## Fixed — a real P2 race in the adapter\n\n' +
        '- **Item 1** is about the raster cache.\n' +
        '- **Item 2** is about the replay coordinator.\n',
    });
    expect(parsed.items.map((item) => item.origin)).toEqual(['HANDOFF.md#1', 'HANDOFF.md#2']);
    // Nothing is retired, so planImport files both.
    expect(planImport([parsed], []).create.map((item) => item.origin)).toEqual(['HANDOFF.md#1', 'HANDOFF.md#2']);
  });

  it('keeps a live entry whose heading merely CONTAINS a dead word as a substring', () => {
    /**
     * The test above covers a heading that says the dead word. This one covers a
     * heading that merely spells it inside an ordinary word: "abandoned"
     * contains "done", "closed" and "fixed" are all common enough inside longer
     * words to be a hazard. `DEAD_HEADING` used to be a SUBSTRING net, so a live
     * item titled "A gesture abandoned by switching tools" was read as a heading
     * that LISTS retired items — and since a section that lists numbers is a
     * section about finished ones, `assemble` dropped the very entry it numbered.
     * The symptom was silent and off-screen: `board import` filed one item fewer
     * than the document has, with nothing but the count to notice it by.
     */
    for (const word of ['abandoned', 'understated', 'unresolvedly', 'supersededly', 'landowner']) {
      const parsed = parseHandoffDoc({
        file: 'HANDOFF.md',
        text: `## 7. A gesture ${word} by switching tools leaves its preview\n\nIt is still open.\n`,
      });
      expect(
        parsed.items.map((item) => item.origin),
        word
      ).toEqual(['HANDOFF.md#7']);
      expect(parsed.dead, word).toEqual([]);
    }
  });

  it('takes no item from the prose of a section the document has deleted', () => {
    // The shape HANDOFF.md uses: a deleted-items heading, then prose that
    // mentions the retired numbers while explaining what they were.
    const parsed = parseHandoffDoc({
      file: 'HANDOFF.md',
      text:
        '### Items 5, 7, 9, 13, 14 — deleted\n\n' +
        '- **Item 5** and **item 9** turned a dropped publication into an error.\n' +
        '- **Item 7** was the dangerous one.\n\n' +
        '## 8. A live item\n\nStill open.\n',
    });
    expect(parsed.items.map((item) => item.origin)).toEqual(['HANDOFF.md#8']);
    expect(parsed.dead).toEqual([5, 7, 9, 13, 14]);
  });

  it('lets a reopened item take back the number a deleted section mentioned', () => {
    const parsed = parseHandoffDoc({
      file: 'HANDOFF.md',
      text:
        '### Items 7 — deleted\n\n- **Item 7** was the dangerous one.\n\n' +
        '## 7. Item 7 is back after the migration\n\nReopened, and it is real.\n',
    });
    expect(parsed.items.map((item) => item.origin)).toEqual(['HANDOFF.md#7']);
    expect(parsed.items[0].title).toBe('Item 7 is back after the migration');
    // The dead set still names 7, so planImport holds it back — the operator
    // clears that when the document says the item is open again.
    expect(planImport([parsed], []).create).toEqual([]);
  });

  it('files nothing on a second run, because the first run is what is known', () => {
    const again = planImport(
      DOCS.map((doc) => doc.parsed),
      plan.create.map((item) => item.origin)
    );
    expect(again.create).toEqual([]);
    expect(again.skip).toHaveLength(plan.create.length);
  });

  it('accepts one result as readily as several, and nothing as readily as either', () => {
    expect(planImport(handoff.parsed, []).create).toEqual(liveItems(handoff.parsed));
    expect(planImport([], []).create).toEqual([]);
    expect(planImport(null, null).create).toEqual([]);
  });
});

describe('the document shapes the parser has to survive', () => {
  const parse = (body, file = 'HANDOFF.md') => parseHandoffDoc({ file, text: body });
  const origins = (body, file) => parse(body, file).items.map((item) => item.origin);

  it('reads a number with no dot after it, and with no keyword', () => {
    expect(origins('## 12 Something is wrong\n\nBody.\n')).toEqual(['HANDOFF.md#12']);
    expect(parse('## 12 Something is wrong\n').items[0].title).toBe('Something is wrong');
  });

  it('reads the `Item N` and `Item N — ` heading forms as the same item', () => {
    expect(origins('## Item 12 — Something\n')).toEqual(['HANDOFF.md#12']);
    expect(parse('## Item 12 — Something\n').items[0].title).toBe('Something');
  });

  it('does not invent a number for a heading that has none', () => {
    const parsed = parse('## Testing notes\n\nProse about the pool.\n\n## 3. A real item\n\nAlpha.\n');
    expect(parsed.items.map((item) => item.origin)).toEqual(['HANDOFF.md#3']);
    expect(parsed.items[0].body).toBe('Alpha.');
  });

  it('reads a bold item marker inside a paragraph, in all three forms', () => {
    expect(origins('Lead-in.\n\n- **Item 5** was the dangerous one.\n')).toEqual(['HANDOFF.md#5']);
    expect(origins('Lead-in.\n\n- **6.** and its second form\n')).toEqual(['HANDOFF.md#6']);
    expect(origins('Lead-in.\n\nThe `item 7` case.\n')).toEqual(['HANDOFF.md#7']);
    expect(parse('Lead-in.\n\n- **Item 5** was the dangerous one.\n').items[0].title).toBe('was the dangerous one.');
  });

  it('leaves a bolded figure alone, because a figure is not an entry', () => {
    const parsed = parse('## 8. Worktrees\n\n`git worktree list` returns **59** worktrees today.\n');
    expect(parsed.items.map((item) => item.origin)).toEqual(['HANDOFF.md#8']);
    expect(parsed.items[0].body).toMatch(/\*\*59\*\* worktrees/);
  });

  it('takes the body up to the next heading of the same or a higher level', () => {
    const parsed = parse('## 1. First\n\nAlpha.\n\n## Notes\n\nBeta.\n\n## 2. Second\n\nGamma.\n');
    expect(parsed.items.map((item) => item.title)).toEqual(['First', 'Second']);
    expect(parsed.items[0].body).toBe('Alpha.');
    expect(parsed.items[1].body).toBe('Gamma.');
  });

  it('keeps a deeper heading inside the item that owns it', () => {
    const parsed = parse('## 1. First\n\nAlpha.\n\n### Sub-heading\n\nBeta.\n\n## 2. Second\n');
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].body).toMatch(/Sub-heading/);
    expect(parsed.items[0].body).toMatch(/Beta\./);
    expect(parsed.items[0].body).not.toMatch(/Second/);
  });

  it('does not read a heading inside a fenced block as a heading', () => {
    const parsed = parse('## 1. First\n\nAlpha.\n\n```sh\n# in a worktree\nnpm test\n```\n\nBeta.\n\n## 2. Second\n');
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0].body).toMatch(/# in a worktree/);
    expect(parsed.items[0].body).toMatch(/Beta\./);
    expect(parsed.items[0].body).not.toMatch(/Second/);
  });

  it('retires every number a deleted heading lists, and files none of them', () => {
    const text = [
      '# Handoff',
      '',
      '## 1. First open item',
      '',
      'The file `src/a.ts` needs this.',
      '',
      '## 2. Second open item',
      '',
      'It depends on `src/b.ts`.',
      '',
      '## 3, 4. — deleted',
      '',
      'These two are already fixed.',
      '',
    ].join('\n');
    const parsed = parse(text);
    expect(parsed.items.map((item) => item.origin)).toEqual(['HANDOFF.md#1', 'HANDOFF.md#2']);
    expect(parsed.dead).toEqual([3, 4]);
    expect(deadNumbers(text)).toEqual([3, 4]);
    expect(planImport([parsed], []).create.map((item) => item.origin)).toEqual(['HANDOFF.md#1', 'HANDOFF.md#2']);
  });

  it('expands a range in a deleted heading, and leaves a severity tag out of it', () => {
    expect(deadNumbers('### Items 5, 7, 21-23 — deleted\n')).toEqual([5, 7, 21, 22, 23]);
    expect(deadNumbers('## Fixed — Enter did not reliably close the flyout (was P2, a real race)\n')).toEqual([]);
    expect(deadNumbers('## 9. An old thing — resolved\n')).toEqual([9]);
    expect(deadNumbers('## 1. Still open\n')).toEqual([]);
  });

  it('does not retire a number that only a live entry mentions in its prose', () => {
    const parsed = parse('## 9. Mentions item 4 in prose\n\nAlpha.\n\n## 10. Live\n\nBeta.\n');
    expect(parsed.dead).toEqual([]);
    expect(parsed.items).toHaveLength(2);
  });

  it('drops a dead entry that the document has not removed yet', () => {
    const parsed = parse('## 4. Retired but not yet removed\n\nAlpha.\n\n### Items 4 — deleted\n');
    expect(parsed.items.map((item) => item.origin)).toEqual(['HANDOFF.md#4']);
    expect(planImport([parsed], []).create).toEqual([]);
    expect(planImport([parsed], []).skip).toEqual([]);
  });

  it('takes repository paths from backticks, and nothing else', () => {
    const parsed = parse(
      '## 1. Paths\n\n`src/a.ts` and `src/b.tsx` and `src/a.ts` again, but not `/Users/me/src/c.ts`,\n' +
        'nor `npm run test` nor `docs/note.txt`.\n' +
        'A line citation is a path: `src/d.ts:12` is `src/d.ts`, and `e2e/pic.png` is a baseline.\n' +
        'A root file is a path: `vitest.config.ts:6-9` and `AGENTS.md`.\n' +
        'A bare word is not: `draw.ts` and `history-adapter.ts` stay out.\n'
    );
    expect(parsed.items[0].files).toEqual([
      'src/a.ts',
      'src/b.tsx',
      'docs/note.txt',
      'src/d.ts',
      'e2e/pic.png',
      'vitest.config.ts',
      'AGENTS.md',
    ]);
  });

  it('strips a line range off a citation without eating the extension', () => {
    const parsed = parse('## 1. Cited\n\n`src/util/draw.ts:6-9` and `e2e/helpers/cdp-helpers.ts:64-66`.\n');
    expect(parsed.items[0].files).toEqual(['src/util/draw.ts', 'e2e/helpers/cdp-helpers.ts']);
  });

  it('gives an unnumbered entry a slug origin derived from its own title', () => {
    const parsed = parse('## P2 — a first problem with a long title\n\nAlpha.\n', 'e2e/OPEN_PROBLEMS.md');
    expect(parsed.scope).toBe('e2e');
    expect(parsed.items[0].origin).toBe('OPEN_PROBLEMS.md#p2-a-first-problem-with-a-long-title');
    expect(parsed.items[0].title).toBe('P2 — a first problem with a long title');
  });

  it('reports a null scope for a file it does not map, and still parses it', () => {
    const parsed = parse('## 1. Anything\n\nAlpha.\n', 'docs/SOMETHING.md');
    expect(parsed.scope).toBeNull();
    expect(parsed.items[0].origin).toBe('SOMETHING.md#1');
  });

  it('caps a body at its limit, on a word boundary', () => {
    const parsed = parse(`## 1. Long\n\n${'word '.repeat(2000)}\n`);
    expect(parsed.items[0].body.length).toBeLessThanOrEqual(4000);
    expect(parsed.items[0].body.endsWith('word')).toBe(true);
  });

  it('caps the file list rather than letting it grow', () => {
    const paths = Array.from({ length: 30 }, (_, index) => `\`src/f${index}.ts\``).join(' ');
    const parsed = parse(`## 1. Many\n\n${paths}\n`);
    expect(parsed.items[0].files).toHaveLength(12);
    expect(parsed.items[0].files[0]).toBe('src/f0.ts');
  });

  it('yields nothing at all for a document with no items', () => {
    expect(parse('')).toEqual({ scope: 'history', items: [], dead: [] });
    expect(parse('# Handoff\n\nJust prose, and a `src/a.ts` citation.\n')).toEqual({
      scope: 'history',
      items: [],
      dead: [],
    });
  });

  it('does not throw on input that is not a document', () => {
    for (const value of [undefined, null, 0, 42, {}, [], '#', '#####', '##', '#'.repeat(2000), '```\nunclosed']) {
      expect(() => parseHandoffDoc({ file: 'HANDOFF.md', text: value }), String(value)).not.toThrow();
    }
    expect(() => parseHandoffDoc()).not.toThrow();
    expect(parseHandoffDoc()).toEqual({ scope: null, items: [], dead: [] });
  });

  it('reads CRLF line endings the same as LF', () => {
    expect(parse('## 1. First\r\n\r\nAlpha.\r\n')).toEqual(parse('## 1. First\n\nAlpha.\n'));
  });

  it('keeps a live heading that ends in a word which is not a dead word', () => {
    const live = [
      ['## 48. The eraser is hard-edged, and three controls are therefore dead', 1],
      ['## 53. Six selectable tools do nothing at all', 1],
      ['## 55. The `EXCLUDED-touched-by-prior-campaigns` manifest is not a safe boundary', 1],
      ['## 58. A single brush stroke makes the durable document un-materializable', 1],
      ['## Known defects that are PINNED — do not "fix" them casually', 0],
    ];
    for (const [heading, count] of live) {
      const parsed = parse(`${heading}\n\nAlpha.\n`);
      expect(DEAD_WORD.test(heading), heading).toBe(false);
      expect(parsed.dead, heading).toEqual([]);
      expect(parsed.items, heading).toHaveLength(count);
    }
  });
});
