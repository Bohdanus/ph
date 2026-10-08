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
const DEAD_WORD = /(?:^|[\s\-–—(\[])(?:deleted|closed|done|resolved|fixed|landed|superseded)\b[)\].,;:!?'"’”]*$/i;

/**
 * The same short list the parser uses for a file at the repository root, restated
 * here so a change to one side that is not made on the other fails as a test
 * rather than silently widening what the board will lock.
 */
const ROOT_FILE_SHAPED =
  /^(?:index|package|package-lock|tsconfig(?:\.[\w.]+)?|vitest(?:\.[\w.]+)?|vite(?:\.[\w.]+)?|playwright(?:\.[\w.]+)?|postcss|eslint|node|AGENTS|HANDOFF|TEST-FLAKES|README)\b[^/]*\.(?:ts|tsx|js|jsx|mjs|json|jsonc|html|md)$/i;

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

  it('reports duplicate numbers and does not import an ambiguous origin', () => {
    const text = ['## 79. First entry', '', 'First body.', '', '## 79. Second entry', '', 'Second body.'].join('\n');
    const parsed = parseHandoffDoc({ file: 'HANDOFF.md', text });

    expect([...text.matchAll(/^#{1,6}[ \t]+(?:Item[ \t]+)?\d+\b/gim)]).toHaveLength(2);
    expect(parsed.duplicateNumbers).toEqual([79]);
    expect(parsed.items.map((item) => item.origin)).toEqual(['HANDOFF.md#79']);
    expect(planImport([parsed], []).create).toEqual([]);
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
    // The origin is DERIVED, not hardcoded. It used to be `HANDOFF.md#12`, and §12 was deleted
    // by the lifecycle rule while this branch was open — which failed this test for a reason that
    // has nothing to do with what it is about. A fixture pinned to a section number is a fixture
    // that dies with the next deletion, and it dies by asserting something FALSE about the code
    // under test, which is the one failure mode a test must not have.
    //
    // What is under test is the routing, not the number: an origin the board already holds as
    // skipped must land in `skip` and never in `create`. Deriving a live origin keeps that
    // assertion exact and removes the coupling to which sections happen to exist today.
    const live = liveItems(handoff.parsed).map((item) => item.origin);
    expect(live.length).toBeGreaterThan(0);
    const held = live[0];
    const second = planImport([handoff.parsed], new Set([held]));
    expect(second.skip).toEqual([held]);
    expect(second.create.map((item) => item.origin)).not.toContain(held);
    expect(second.create).toHaveLength(live.length - 1);
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
     *
     * The first two rows are the REAL corpus cases, verbatim from the document,
     * and they are the only two the corpus has: `abandoned` in §69
     * (`HANDOFF.md:1508`) and `fixed` inside `suffixed` in §77
     * (`HANDOFF.md:1821`). The synthetic words after them are here so the rule is
     * pinned for shapes the corpus has not produced yet, but they are not what
     * the rule was written for and must not be read as if they were — a
     * docstring that called five invented words "the five real headings" is how
     * the two real ones went unpinned for a merge.
     */
    const real = [
      ['## 69. An eraser gesture abandoned by switching tools leaves its preview on the layer, with no history entry'],
      ['## 77. `## 15a.` yields no item, and a suffixed retirement retires its PARENT'],
    ];
    /**
     * Origins, not a length. `toHaveLength(1)` passes for a one-item parse whose
     * only item is `HANDOFF.md#NaN`, `HANDOFF.md#0`, or any other origin the
     * numbering got wrong — and every other test in this file asserts origins
     * precisely because that is the failure the board keys on. §77's own table
     * names `#NaN` as what `makeItem` produces for a suffixed heading, so a
     * length check here is checking the one thing this file exists to catch.
     */
    for (const [heading, origin] of [
      [real[0][0], 'HANDOFF.md#69'],
      [real[1][0], 'HANDOFF.md#77'],
    ]) {
      const parsed = parseHandoffDoc({ file: 'HANDOFF.md', text: `${heading}\n\nIt is still open.\n` });
      expect(DEAD_WORD.test(heading), heading).toBe(false);
      expect(parsed.dead, heading).toEqual([]);
      expect(
        parsed.items.map((item) => item.origin),
        heading
      ).toEqual([origin]);
      // And it is filed, not merely parsed: a live item the board would not
      // create is the other half of the same claim.
      expect(
        planImport([parsed], []).create.map((item) => item.origin),
        heading
      ).toEqual([origin]);
    }
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

  it('keeps an item whose title merely mentions a dead word, number and all', () => {
    /**
     * The shape that cost §76, which is the shape the documents actually use.
     * `retiredNumbersIn` harvests numbers out of a heading, so an anywhere-match
     * on "fixed" picked up the `3` in `"3 FIXED"` and proved to itself that the
     * heading was a list of retired items. The section was then closed without
     * ever being opened, which is not a suppression but a deletion: a real
     * defect left the import entirely.
     *
     * The number is §76's, not §70's. The entry was renumbered 70 → 76 while
     * this fixture kept saying 70, and §70 is now a different live entry; see
     * the LIVE-side test below for the same correction stated in full.
     */
    const parsed = parseHandoffDoc({
      file: 'HANDOFF.md',
      text:
        '## 76. A closure check reported "3 FIXED" for work that was already fixed before it ran\n\n' +
        'The checker counted work that was already done, so the count was never evidence.\n',
    });
    expect(parsed.items.map((item) => item.origin)).toEqual(['HANDOFF.md#76']);
    expect(parsed.dead).toEqual([]);
  });

  it('keeps a severity item whose title merely mentions a dead word', () => {
    // Three of the six dead-word headings in the three documents are severity
    // items that say "closed" as part of what they are about, not as a status.
    for (const heading of [
      '## P1 — the dialog-closed assertion is one rename from vacuous',
      '## P1 — the keyboard-flow test asserts the menu closed and nothing else',
      '## P2 — `exportIcoAndVerify` has no dialog-closed assertion',
    ]) {
      const parsed = parseHandoffDoc({
        file: 'e2e/OPEN_PROBLEMS.md',
        text: `${heading}\n\nOne rename from vacuous is still a defect.\n`,
      });
      expect(parsed.dead, heading).toEqual([]);
      expect(parsed.items, heading).toHaveLength(1);
      expect(parsed.items[0].title, heading).toContain('closed');
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
    expect(deadNumbers('## 9. An old thing — resolved\n')).toEqual([]);
    expect(parse('## 9. An old thing — resolved\n').ambiguousRetirements).toEqual([
      { origin: 'HANDOFF.md#9', number: 9, line: 1, heading: '9. An old thing — resolved' },
    ]);
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
    expect(parse('')).toEqual({
      scope: 'history',
      items: [],
      dead: [],
      duplicateNumbers: [],
      ambiguousRetirements: [],
    });
    expect(parse('# Handoff\n\nJust prose, and a `src/a.ts` citation.\n')).toEqual({
      scope: 'history',
      items: [],
      dead: [],
      duplicateNumbers: [],
      ambiguousRetirements: [],
    });
  });

  it('does not throw on input that is not a document', () => {
    for (const value of [undefined, null, 0, 42, {}, [], '#', '#####', '##', '#'.repeat(2000), '```\nunclosed']) {
      expect(() => parseHandoffDoc({ file: 'HANDOFF.md', text: value }), String(value)).not.toThrow();
    }
    expect(() => parseHandoffDoc()).not.toThrow();
    expect(parseHandoffDoc()).toEqual({
      scope: null,
      items: [],
      dead: [],
      duplicateNumbers: [],
      ambiguousRetirements: [],
    });
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

  /**
   * The marker rule, held from the DEAD side. Every form here is a heading the
   * documents could write — the separator and the parentheses are variations of
   * the one real shape, `### Items 5, 7, 9 … — deleted` — so a future heading
   * that retires a list is read as a retirement rather than as a section about
   * one. This half passes under the loose word-anywhere rule as well, which is
   * the point: it is what proves the fix did not simply delete the concept by
   * making `deadNumbers` return nothing.
   */
  it('reads explicit retirement lists and reports ambiguous numbered status headings', () => {
    const markers = [
      ['## 5. — resolved', [5]],
      ['### Items 1, 2 — deleted', [1, 2]],
      ['## 3, 4. — deleted', [3, 4]],
      ['## 9. - fixed', [9]],
      ['## 11. — closed', [11]],
      ['## 12. (done)', [12]],
      ['## 13. — deleted', [13]],
    ];
    for (const [heading, dead] of markers) {
      expect(deadNumbers(`${heading}\n`), heading).toEqual(dead);
    }
    // The one real retirement in all three documents, verbatim, still retires.
    expect(deadNumbers('### Items 5, 7, 9, 13, 14, 18, 19, 21-29, 33-35, 37-42, 44 — deleted\n')).toEqual([
      5, 7, 9, 13, 14, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29, 33, 34, 35, 37, 38, 39, 40, 41, 42, 44,
    ]);
    const ambiguous = parse('## 31. The dialog-closed assertion is fixed\n\nBody.\n');
    expect(ambiguous.dead).toEqual([]);
    expect(ambiguous.ambiguousRetirements).toHaveLength(1);
    expect(ambiguous.items.map((item) => item.origin)).toEqual(['HANDOFF.md#31']);
    expect(planImport([ambiguous], []).create).toEqual([]);
  });

  /**
   * The marker rule, held from the LIVE side, against the real headings a
   * word-anywhere rule retired. They are legitimate prose and must not be edited
   * to fit a parser, so they are reproduced here verbatim as fixtures.
   *
   * **"Verbatim" now means what it says, which it did not for a while.** The
   * three `P`-severity rows below were copied from `e2e/OPEN_PROBLEMS.md` when
   * this test was written; `77c3663` moved the last three transferred findings
   * out of that file, so `grep 'dialog-closed\|keyboard-flow\|vacuous'
   * e2e/OPEN_PROBLEMS.md` returns nothing and the rows are no longer corpus.
   * They stay, because the shape they pin — a SEVERITY heading with no number,
   * so `dead` cannot express a failure at all and only the item count can — is
   * the parser's contract rather than a quotation, and a parser that regressed
   * on it would fail with no corpus left to fail on. The two rows that ARE still
   * corpus carry their provenance in the comment beside them.
   *
   * Every one of these was silently dropped: `assemble` closed the heading, never
   * opened it as an item, and nothing in the parse result said so. The first
   * also retired a second, unrelated number — the `3` harvested out of the quoted
   * figure `"3 FIXED"` — which is why `dead` is asserted empty and not merely
   * "not containing 76".
   */
  it('keeps a LIVE entry whose title merely CONTAINS a status word mid-title', () => {
    /**
     * Still corpus, verbatim from `HANDOFF.md:1788`. The entry was RENUMBERED
     * 70 → 76 while this fixture said 70: §70 is now a different, live entry
     * ("A tool whose settings do not fit a shared arm…", `HANDOFF.md:1532`), so
     * a fixture on 70 asserted nothing anybody could check against the document
     * and shadowed a real entry number. The prose below is unchanged apart from
     * the number, because the defect is identical — it is the same entry.
     */
    const seventySix = parse(
      '## 76. A closure check reported "3 FIXED" for work that was already fixed before it ran\n\nBody.\n'
    );
    expect(seventySix.dead).toEqual([]);
    expect(seventySix.items.map((item) => item.origin)).toEqual(['HANDOFF.md#76']);
    expect(planImport([seventySix], []).create.map((item) => item.origin)).toEqual(['HANDOFF.md#76']);

    /**
     * A level-3 subheading inside an entry: still corpus, verbatim from
     * `HANDOFF.md:368`. It retires nothing, and it must not truncate the entry
     * that owns it either — `bodyOf` stops only at a heading of the same or a
     * higher level.
     *
     * This is NOT the shape at `HANDOFF.md:424`. That heading, `## 15a.`, is a
     * level-2 SIBLING of `## 15.`, not a subheading of it, and it is a different
     * shape with a different failure: it matches neither `NUMBERED` (no word
     * boundary between `5` and `a`) nor `SEVERITY`, so `assemble` falls through
     * to `if (open && record.level <= open.level) close(...)` and TRUNCATES item
     * 15 there. The sibling case is pinned separately below, because only the
     * subheading case is about the dead word.
     */
    const sub = parse(
      '## 15. `reorder-layers` is published\n\nIntro.\n\n' +
        '### The self-anchored move: a converter defect, deliberately not fixed here\n\nDetail.\n'
    );
    expect(sub.dead).toEqual([]);
    expect(sub.items.map((item) => item.origin)).toEqual(['HANDOFF.md#15']);
    expect(sub.items[0].body).toMatch(/self-anchored/);

    // The three `P`-severity entries, which go through the severity arm and have
    // no number at all — so `dead` cannot express the failure and only the item
    // count can. Transcribed, not corpus; see the block comment above.
    for (const title of [
      'P1 — the dialog-closed assertion is one rename from vacuous',
      'P1 — the keyboard-flow test asserts the menu closed and nothing else',
      'P2 — `exportIcoAndVerify` has no dialog-closed assertion',
    ]) {
      const parsed = parse(`## ${title}\n\nBody.\n`, 'e2e/OPEN_PROBLEMS.md');
      expect(parsed.dead, title).toEqual([]);
      expect(
        parsed.items.map((item) => item.title),
        title
      ).toEqual([title]);
      expect(planImport([parsed], []).create.length, title).toBe(1);
    }
  });

  /**
   * The level-2 sibling of a numbered heading, verbatim from `HANDOFF.md:424` —
   * §77's shape, and the one that is LIVE today, so it is pinned as a mechanism
   * rather than as a gap.
   *
   * `## 15a.` opens nothing, so its prose is unreachable from any item body and
   * nothing in the parse result reports that. This test holds the CURRENT
   * behaviour, which is the point: it is a filed §77 finding, not a decision,
   * and a future fix to `NUMBERED` is supposed to fail here and say why. The
   * title is the real one, so an agent reading the failure sees the document
   * text rather than a fixture number.
   */
  it('truncates the parent entry at a letter-suffixed level-2 sibling, as §77 records', () => {
    const parsed = parse(
      '## 15. `reorder-layers` is published; a self-anchored move is a real converter defect\n\n' +
        'Intro.\n\n' +
        '## 15a. A self-anchored reorder is refused, and the refusal is load-bearing\n\n' +
        'Retained as a tripwire. `reorderOrderAfterIntent` returns `null`.\n\n' +
        '## 16. An invalid document frame converts with no diagnostic\n\nBeta.\n'
    );
    expect(parsed.dead).toEqual([]);
    expect(parsed.items.map((item) => item.origin)).toEqual(['HANDOFF.md#15', 'HANDOFF.md#16']);
    // Item 15's body stops at the sibling, and the 15a prose is in no body.
    expect(parsed.items[0].body).toBe('Intro.');
    expect(parsed.items.map((item) => item.body).join('\n')).not.toMatch(/tripwire/);
  });

  /**
   * The WORSE half of §77, and the one that used to have no pin at all: the same
   * missing word boundary in the same place makes a **suffixed retirement retire
   * the parent section's number**.
   *
   * `deadNumbers` reaches the number through `NUMBER_OR_RANGE`, which has no
   * `\b` at all, so `## 15a. An old thing — deleted` harvests `15` and files the
   * live, open `HANDOFF.md#15` as **finished** by a heading that says `15a` is
   * done. This is silent corruption rather than silent loss: nothing is lost, a
   * still-open entry is suppressed, and the board says it is retired. The
   * truncation test above is the half that loses a section; this is the half that
   * closes one, and a fix that only widens `NUMBERED` to fix the loss does not
   * address this at all — which is the sentence §77 makes.
   *
   * `it.fails` marks the still-open §77 defect: the body below
   * asserts what a fixed parser returns, so it is red today and the `fails` is
   * what a fixer deletes. §77's own projection is the reason this cannot be an
   * ordinary test: no fix that gives `15a` its own origin can keep returning
   * `[15]` from `deadNumbers`, because the dead set is `number[]` end to end.
   */
  it.fails('does not retire the PARENT section number from a letter-suffixed retirement', () => {
    expect(deadNumbers('## 15a. An old thing — deleted\n')).toEqual([]);
    expect(deadNumbers('## 15a, 16. Old things — deleted\n')).toEqual([]);
  });

  /**
   * The same root cause read from the other side, and this one IS the current
   * behaviour and stays true whichever way §77 is fixed: a suffixed heading is
   * **never** a retirement, and the pinned table above proves the ungated form
   * cannot express one. So the corpus can never retire `15a`, and it can only
   * ever retire `15` — which is the corruption, isolated from the mechanism.
   */
  it('reads a suffixed retirement as retiring 15, never 15a, today', () => {
    // `NUMBER_OR_RANGE` has no word boundary, so the `15` comes out of `15a`.
    expect(deadNumbers('## 15a. An old thing — deleted\n')).toEqual([15]);
    expect(deadNumbers('## 15a, 16. Old things — deleted\n')).toEqual([15, 16]);
    // And the consequence is a SUPPRESSION, not a loss: a live item the board
    // already knows is then never created again.
    const parsed = parse('## 15. Still open\n\nBody.\n\n## 15a. An old thing — deleted\n\nGone.\n');
    expect(parsed.dead).toEqual([15]);
    expect(
      planImport([parsed], [{ origin: 'HANDOFF.md#15' }]).create.map((item) => item.origin),
      'the live 15 is suppressed by the document its own 15a says is deleted'
    ).toEqual([]);
  });

  /**
   * A marker is still the last WORD of a heading when punctuation follows it.
   *
   * The one real retirement in the corpus is `— deleted`, and a hand-written
   * heading that ends in a full stop is an ordinary thing to write: `## 5. —
   * deleted.` is a document saying exactly what it means. The trailing-punctuation
   * tolerance is a tolerance, not a behavioural widening: swept over all 110
   * headings in the three documents and all 54 fixture headings in this file, it
   * changes no verdict at all — a live title does not end in a full stop after a
   * status word, because the marker has to be the last thing in the heading for
   * this rule to fire in the first place.
   *
   * The last four rows are the half that matters: the marker must still be
   * LAST, so punctuation is absorbed but a following clause is not — and the
   * absorbed set is a fixed and named one. `…` is not in it, because an
   * ellipsis after the marker is the author continuing to write, not a sentence
   * ending.
   */
  it('reads a trailing full stop after a marker as punctuation, not as prose', () => {
    for (const [heading, dead] of [
      ['## 5. — deleted.', [5]],
      ['## 6. — deleted,', [6]],
      ['## 7. — deleted;', [7]],
      ['## 8. — deleted:', [8]],
      ['## 10. An old thing (done)…', []],
      // Absorbing trailing punctuation must not become "a marker anywhere at
      // the end of a sentence": a clause after it is prose again.
      ['## 11. — deleted (was P2)', []],
      ['## 12. — deleted and replaced by 4', []],
      ['## 13. Old thing. Deleted by the reviewer', []],
    ]) {
      expect(deadNumbers(`${heading}\n`), heading).toEqual(dead);
    }
    // And the document shape it recovers is a real retirement end to end: the
    // number is retired and the entry is not filed as open work.
    const parsed = parse('### Items 5 — deleted.\n\nBody.\n');
    expect(parsed.dead).toEqual([5]);
    expect(parsed.items).toEqual([]);
    expect(planImport([parsed], []).create).toEqual([]);
  });

  /**
   * ONE SPACE FLIPS A RETIREMENT INTO A FILED WORK ITEM, and that is on the
   * record here rather than in a deleted line.
   *
   * `a3f1dcc` added `['## 9. — deleted .', [9]]` to the table above. The merge
   * into main (`bd137d0`) removed it, on the reasoning that main's landed rule
   * correctly rejects that shape — which it does — and the merge was +146/-0, so
   * the removal left no trace. The judgement is sound: the corpus contains no
   * such heading, and over all 97 real headings on `main` at `0d64d75` the two
   * rules agree on every
   * verdict. What was lost is the knowledge that the shape reads as LIVE.
   *
   * The tolerated trailing set is a fixed, named list in `DEAD_HEADING`, and a
   * space is not in it — so `— deleted.` retires and `— deleted .` does not, and
   * neither does a tab, an asterisk, or a second space. That is a brittleness
   * worth keeping: widening the set to absorb a space is a behavioural change
   * that would re-read any live heading ending in a stray space as a retirement,
   * which is the worse direction. The rule stays as it is; this test is what
   * makes the boundary legible to the next agent instead of a surprise.
   */
  it('reads `— deleted .` as LIVE, and every other unlisted trailing mark with it', () => {
    for (const [heading, number] of [
      ['## 9. — deleted .', 9],
      ['## 9. — deleted  .', 9],
      ['## 9. — deleted\t.', 9],
      ['## 9. — deleted*', 9],
      ['## 9. — deleted**', 9],
    ]) {
      const parsed = parse(`${heading}\n\nBody.\n`);
      expect(deadNumbers(`${heading}\n`), heading).toEqual([]);
      expect(parsed.dead, heading).toEqual([]);
      // "Not dead" is not the failure mode worth pinning. The consequence is a
      // board row, so the row is what is asserted: LIVE means FILED.
      expect(
        parsed.items.map((item) => item.origin),
        heading
      ).toEqual([`HANDOFF.md#${number}`]);
      expect(
        planImport([parsed], []).create.map((item) => item.origin),
        heading
      ).toEqual([`HANDOFF.md#${number}`]);
    }
  });

  /**
   * The same rule on the arm the parser handles separately: a heading that does
   * not end in a marker must not close the section to inline `**Item 18**`
   * markers. Under the loose rule this heading's `9` was harvested as a
   * retirement AND the section was closed to inline markers, so `**Item 18**`
   * was suppressed and the document's own prose became nothing at all.
   *
   * `#9` is in the expected list because a live numbered heading DOES open an
   * item, and the inline marker closes it and opens the next one. Under the loose
   * rule the list is empty, not a different shape.
   */
  it('takes an inline item marker under a heading that merely mentions a status word', () => {
    const parsed = parse(
      '## 9. A heading that says fixed in passing and then keeps going\n\n' +
        '- **Item 18** turned a dropped publication into an error.\n'
    );
    expect(parsed.dead).toEqual([]);
    expect(parsed.items.map((item) => item.origin)).toEqual(['HANDOFF.md#9', 'HANDOFF.md#18']);
    expect(planImport([parsed], []).create.map((item) => item.origin)).toEqual(['HANDOFF.md#9', 'HANDOFF.md#18']);
  });

  /**
   * The other half of that rule, and the half `retiredNumbersIn`'s own docstring
   * calls out as a distinct case: a marker heading that carries NO NUMBERS.
   * `assemble` sets `inDeadSection` from `retiredNumbersIn(record).length > 0`,
   * not from the marker alone, so `## Done`, `## Resolved` and `## Closed` are
   * sections about something else and the inline markers under them stay live.
   *
   * It was untested, and it is the direction that matters for the two documents
   * that use severity or prose headings: a suppression keyed on the marker
   * rather than on the harvested numbers deletes every entry beneath such a
   * heading, silently, and a test that only covers `## Resolved`
   * would still be green.
   */
  it('keeps inline item markers under a marker heading that lists no numbers', () => {
    for (const heading of ['## Done', '## Resolved', '## Closed', '## Landed', '### Deleted']) {
      const parsed = parse(
        `${heading}\n\n` +
          '- **Item 1** is about the raster cache.\n' +
          '- **Item 2** is about the replay coordinator.\n'
      );
      expect(deadNumbers(`${heading}\n`), heading).toEqual([]);
      expect(parsed.dead, heading).toEqual([]);
      expect(
        parsed.items.map((item) => item.origin),
        heading
      ).toEqual(['HANDOFF.md#1', 'HANDOFF.md#2']);
      expect(
        planImport([parsed], []).create.map((item) => item.origin),
        heading
      ).toEqual(['HANDOFF.md#1', 'HANDOFF.md#2']);
    }
  });

  it('reports numbered headings whose status suffix could be prose or a retirement marker', () => {
    for (const [number, heading] of [
      [31, '## 31. The dialog-closed assertion is fixed'],
      [32, '## 32. The only rename that would make it real is done'],
      [34, '## 34. A shape nobody has written yet, and the trap is closed'],
    ]) {
      const parsed = parse(`${heading}\n\nIt is still open work.\n`);
      expect(parsed.dead, heading).toEqual([]);
      expect(parsed.ambiguousRetirements, heading).toEqual([
        { origin: `HANDOFF.md#${number}`, number, line: 1, heading: heading.slice(3) },
      ]);
      expect(
        parsed.items.map((item) => item.origin),
        heading
      ).toEqual([`HANDOFF.md#${number}`]);
      expect(planImport([parsed], []).create, heading).toEqual([]);
    }
  });

  /**
   * The half of the same finding that is TRUE on both sides of a fix, held in an
   * ordinary green test, and it is load-bearing for the pin above rather than
   * incidental: an `it.fails` passes whenever its body throws, so a pin whose body
   * fails for an unrelated reason — a bad import, a renamed export — reports green.
   * These two loops and the contrast are what make that impossible here.
   */
  it('reads a status word that is NOT last as prose, and a spaced marker as a live row', () => {
    // The same status word NOT at the end is the live case, and it is the only
    // thing separating the two: no structural difference exists between a
    // numbered heading that ends in a marker and one that does not.
    for (const [number, heading] of [
      [32, '## 32. The keyboard-flow test asserts the menu closed and nothing else'],
      [33, '## 33. The rename is landed upstream and nothing here depends on it'],
    ]) {
      const parsed = parse(`${heading}\n\nIt is still open work.\n`);
      expect(parsed.dead, heading).toEqual([]);
      expect(
        parsed.items.map((item) => item.origin),
        heading
      ).toEqual([`HANDOFF.md#${number}`]);
      expect(
        planImport([parsed], []).create.map((item) => item.origin),
        heading
      ).toEqual([`HANDOFF.md#${number}`]);
    }
    // The contrast, side by side, because the asymmetry is the whole finding:
    // the SAME rule in the other direction produces a row a reader can see.
    const visible = parse('## 9.  — deleted .\n\nBody.\n');
    expect(visible.dead).toEqual([]);
    expect(visible.items.map((item) => item.origin)).toEqual(['HANDOFF.md#9']);
  });
});
