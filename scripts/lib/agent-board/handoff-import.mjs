/**
 * The parsing half of `swarm import`: the three hand-maintained Markdown
 * handoff documents in, a list of board items out.
 *
 * WHY THE DOCUMENTS STAY THE SOURCE OF TRUTH
 * ------------------------------------------
 * They carry reasoning, provenance and review verdicts that a board row with a
 * status column cannot, and they carry a numbering scheme that survives editing:
 * item 12 is item 12 whether it sits above or below item 11. `origin` is built
 * from that number and the document's basename and nothing else, so a re-run
 * after the document grew an item files only the new item, and a re-run after an
 * item was deleted files nothing at all. A line number, an offset or a hash of
 * the body would move on every edit and would file duplicates.
 *
 * WHY A TOLERANT PARSER AND NOT A GENERATOR
 * -----------------------------------------
 * The input is prose, and prose has shapes the parser has to survive rather than
 * impose: numbered and unnumbered headings, item markers in the middle of a
 * paragraph, fenced code that contains lines beginning with `#`, and a section
 * that lists finished items instead of marking them. Every tolerance below is
 * documented on the constant that implements it, because a reader who finds a
 * document shape that parsed wrong has to be able to tell which rule decided it.
 *
 * WHY IT NEVER THROWS
 * -------------------
 * The import runs unattended over files that agents rewrite by hand, so a
 * malformed document has to yield fewer items rather than an exception: a crash
 * on one bad heading in one document would take the other two down with it.
 */

/**
 * @typedef {'history' | 'test' | 'e2e'} Scope
 *
 * @typedef {Object} ImportItem
 * @property {string} origin    stable across re-runs: `<basename>#<number>`, or
 *   `<basename>#<slug>` for an item the document gave no number
 * @property {string} title     one line, no heading markers, no leading number
 * @property {string} body      the item's own prose, heading markers stripped
 *   and trimmed
 * @property {string[]} files   backticked repository paths in title and body
 *
 * @typedef {Object} ParseResult
 * @property {Scope|null} scope the document's scope label, or `null` when the
 *   file is not one of the three mapped documents — the parser still runs
 *   rather than guessing a label the board would then filter on
 * @property {ImportItem[]} items
 * @property {number[]} dead    the item numbers the document records as finished
 * @property {number[]} duplicateNumbers numbered headings that share an origin
 * @property {{origin: string, number: number, line: number, heading: string}[]} ambiguousRetirements
 *   numbered headings whose status suffix could be prose or a retirement marker
 * @property {{line: number, level: number, text: string}[]} letterSuffixedHeadings
 *   numbered-looking headings whose letter suffix has no supported origin grammar
 */

/**
 * Scope label per document, keyed by the repository-relative path. The board
 * routes work by scope, and the routing is a property of the document rather
 * than of its contents: `HANDOFF.md` is scoped to history/replay and document
 * state even when an entry under it happens to be about a tool.
 */
export const SCOPE_BY_FILE = {
  'HANDOFF.md': 'history',
  'TEST-FLAKES.md': 'test',
  'e2e/OPEN_PROBLEMS.md': 'e2e',
};

/**
 * A body longer than this is truncated on a word boundary. The longest real
 * entry runs several thousand characters of tables and shell transcripts; the
 * board needs the problem and the named files, not a verbatim archive, and the
 * document is one command away for anyone who wants the rest.
 */
const BODY_LIMIT = 4000;

/**
 * A path is only interesting to a reader deciding whether to claim the item if
 * it is one of the files the item is about. Twelve is above every real entry's
 * distinct count, so the cap only ever fires on a paste accident.
 */
const FILE_LIMIT = 12;

/** `origin` fallback length, in characters of slug. */
const SLUG_LIMIT = 40;

/**
 * Extensions that make a backticked span a source file rather than prose.
 *
 * The asset extensions are here for the same reason as the source ones: the
 * handoff documents cite a baseline PNG and an AVIF fixture as the evidence for
 * a defect, and a path the board cannot name is a path the board cannot lock.
 */
const EXTENSION =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|scss|css|yml|yaml|txt|png|avif|jpg|jpeg|gif|webp|ico|wasm|svg)$/i;

/**
 * ATX heading, up to six levels. The lazy body plus the optional trailing `#`
 * run is what strips a closing `##` without eating a `#` that belongs to the
 * text (`## C# notes`), because the closing run has to reach end of line.
 */
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;

/**
 * Fenced code. A `#` inside a fence is a shell comment, not a heading, and a
 * real document carries fences whose first line is a comment — treating it as an
 * h1 would truncate the item that owns the fence at the fence.
 */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * How these documents record a finished item: a heading that says so. The
 * alternation is deliberately the seven words the documents actually use. A
 * looser net (a bare `dead`, or `close`) would swallow live entries — one real
 * heading ends in the word "dead" and means it as prose.
 *
 * The word must be the LAST one in the heading, which is what makes it a marker
 * rather than a mention. It cannot be an anywhere-match: at `eba42f8` the loose
 * net `/deleted|closed|done|resolved|fixed|landed|superseded/i` matched six of
 * the 111 real headings, of which exactly one was a retirement and five were
 * live prose. **Two** of those five said the word inside a hyphenated compound
 * (`dialog-closed`, twice) — not three, which is what an earlier revision of
 * this comment claimed from the same tree, because its third example,
 * `"3 FIXED"`, is not hyphenated at all.
 *
 * The three documents' own headings, as measured on the corpus rather than
 * remembered: **on `main` at `0d64d75` the corpus is 97 headings, the loose net
 * matches five of them, and the narrow one matches exactly one** — the genuine
 * retirement, `### Items 5, 7, 9, … — deleted`. The tree is named because the
 * number is a property of a moment, not of this rule: the **92** an earlier
 * revision of this comment quoted was the merge-base figure, and it is the whole
 * defect the other counts here are dated to avoid. This branch's own new entry
 * takes the corpus to 98 on the merged tree without moving a single verdict.
 * The four live ones are
 * `### The self-anchored move: a converter defect, deliberately not fixed here`
 * (`HANDOFF.md:368`), `## 69. An eraser gesture abandoned by switching tools …`
 * (`HANDOFF.md:1508`), `## 76. A closure check reported "3 FIXED" …`
 * (`HANDOFF.md:1788`) and `## 77. … and a suffixed retirement retires its
 * PARENT` (`HANDOFF.md:1821`). §69 and §77 are the cases with no boundary at
 * all — `abandoned` contains `done` and `suffixed` contains `fixed`, both
 * inside an ordinary word rather than after a hyphen — and they are the two the
 * corpus actually has. The hyphenated severities that motivated the rule were
 * moved out of the corpus by `77c3663`, so a count taken from that tree is
 * history and the counts above are not.
 *
 * §76 cost a whole item as well, and it is the reason the anchoring is worth an
 * argument at all: the loose net found `fixed`, `retiredNumbersIn` then
 * harvested the `3` out of `"3 FIXED"`, the section was marked retired, and the
 * entry was never opened as an item at all — a real defect dropped out of the
 * import with nothing in the output saying so.
 *
 * THE RESIDUAL RISK IS TWO-SIDED, AND THIS RULE DOES NOT MAKE IT ONE-SIDED
 * -----------------------------------------------------------------------
 * An earlier revision of this comment argued that under-matching is loud
 * (a false LIVE row a reader sees on `swarm ready`) while over-matching is
 * always a silent loss, and concluded the risk was "deliberately one-sided and
 * deliberately loud". **That was false, and it was false for the very headings
 * the rule is about.** `assemble` consumes a dead heading with `continue` and
 * never opens it as an item, so a NUMBERED heading this rule retires vanishes
 * from `items` exactly the way one it fails to recognise becomes a visible row.
 * Measured, both directions, both silent for a numbered heading:
 *
 *     ## 31. The dialog-closed assertion is fixed   ->  dead=[31]  items=[]
 *     ## 9.  — deleted .                           ->  dead=[]   items=[#9]
 *
 * The first is a live entry retired with nothing in the parse result to say so.
 * The second is the visible false row. The only difference is which way the
 * heading points, and a NUMBERED heading that genuinely ends in a status word —
 * `## 5. Whatever — resolved` — is indistinguishable from one that merely does.
 * Narrowing trades one silent class for a smaller one; it does not remove it.
 *
 * What anchoring does buy is the empirical half, which is the half that holds:
 * over all 97 real headings on `main` at `0d64d75` the narrow rule matches exactly
 * the one heading the
 * loose one also reads as a retirement, so the loose rule's other four are the
 * wrong verdicts and none of them is a retirement this rule has lost. It is
 * also brittle at the punctuation boundary in a way worth knowing about — the
 * tolerated trailing set is a fixed, named list, so `— deleted.` retires and
 * `— deleted .` (one space) does not, and a tab, an asterisk or a second space
 * all read as LIVE. `scripts/__tests__/handoff-import.test.mjs` pins each of
 * those, so the asymmetry is on the record rather than discovered by a heading
 * somebody happened to write.
 */
const DEAD_HEADING = /(?:^|[\s\-–—(\[])(?:deleted|closed|done|resolved|fixed|landed|superseded)\b[)\].,;:!?'"’”]*$/i;

/**
 * A leading item number, with or without its dot and with or without the `Item`
 * keyword. `## 12 Something`, `## 12. Something` and `## Item 12 — Something`
 * are all the same heading. A heading with no leading digit is not an item, and
 * a number is never invented for one: an invented number would collide two
 * entries into one `origin` and silently drop one of them.
 */
const NUMBERED = /^(?:item\s+)?#?(\d+)\b/i;

/** A numbered heading whose leading list contains an unsupported letter suffix. */
const LETTER_SUFFIXED_NUMBERED =
  /^(?:items?\s+)?(?:#?\d+[a-z]+(?:\s*,\s*#?\d+)*|#?\d+(?:\s*,\s*#?\d+)*\s*,\s*#?\d+[a-z]+)/i;

/**
 * A numbered heading ending in a status word is a retirement only when the
 * heading itself is an explicit list, not when it also has an item title.
 */
const RETIREMENT_LIST_PREFIX =
  /^(?:items?\s+)?\d{1,6}(?:(?:\s*,\s*|\s*[-–—]\s*)\d{1,6})*(?:\s*,\s*(?:\.{3}|…))?[.,\s]*(?:\.{3}|…)?$/i;

/**
 * A leading severity tag, as in `## P2 — an empty CDP capture ...`. This is the
 * item marker the documents that do not number their entries use, and it has to
 * be recognised or every entry in such a document is skipped: the requirement is
 * that a leading uppercase tag of letters then digits, followed by a separator,
 * which leaves prose headings ("Known defects that are PINNED", "Worktree
 * hygiene") as the section headers they are.
 */
const SEVERITY = /^[A-Z]{1,4}\d{1,3}\b[ \t]*(?:—|–|[-:.]|\s|$)/;

/**
 * An item marker inside prose: the word `Item` and a number in a bold run, the
 * same word in a code span, or a bare bold number carrying its dot. The dot is
 * what distinguishes the third form from a bolded figure in prose — the
 * documents bold the counts they are making a point about, and `**59**
 * worktrees` is a fact, not an entry. Not global: one marker per line, because
 * a line can only start one item, and a second marker on the same line stays
 * body text.
 */
const INLINE_ITEM = /\*\*item\s+(\d+)\s*\*\*|\*\*(\d+)\.\s*\*\*|`item\s+(\d+)`/i;

/** A backticked span, for the `files` list. */
const BACKTICK_SPAN = /`+([^`\n]+?)`+/g;

/** A path the board can act on has no whitespace in it. */
const WHITESPACE = /\s/;

/**
 * Files at the repository root, which have no `/` in them.
 *
 * The general rule is that a path contains a separator, which is what keeps
 * prose out of the file list. It also drops the handful of names at the root
 * that a swarm most needs to lock — `vitest.config.ts` is cited with a line
 * number by two of these documents, and it changes the behaviour of every test
 * in the repository. The list is deliberately short and named, not a pattern
 * that would let `draw.ts` in a sentence become a path.
 */
const ROOT_FILE =
  /^(?:index|package|package-lock|tsconfig(?:\.[\w.]+)?|vitest(?:\.[\w.]+)?|vite(?:\.[\w.]+)?|playwright(?:\.[\w.]+)?|postcss|eslint|node|AGENTS|HANDOFF|TEST-FLAKES|README)\b[^/]*\.(?:ts|tsx|js|jsx|mjs|json|jsonc|html|md)$/i;

/**
 * A severity tag inside a heading, removed before its numbers are harvested as
 * item numbers. `## Fixed — ... (was P2, a real race)` must not make item 2
 * dead; the `2` belongs to the severity scale, not to an entry.
 */
const SEVERITY_TOKEN = /\bP\d{1,3}(?:\s*[-–—]\s*\d{1,3})?/gi;

/**
 * A number, or an inclusive range, as written in a heading's list of finished
 * items. Ranges are real (`21-29`, `37-42`), and reading a range as its two
 * endpoints would leave the entries between them live.
 */
const NUMBER_OR_RANGE = /(\d{1,6})\s*(?:[-–—]\s*(\d{1,6}))?/g;

/** A letter-suffixed number is not a valid retirement-list number. */
const LETTER_SUFFIXED_NUMBER = /(?:^|[^\d])\d{1,6}[A-Za-z]+\b/;

/**
 * A range wider than this is treated as its endpoints rather than expanded. It
 * exists to bound a single malformed heading, not to describe a real entry
 * range, and the documents' widest is `21-29`.
 */
const RANGE_LIMIT = 1000;

/** A rule between two entries. It is layout, not prose, and never body text. */
const HORIZONTAL_RULE = /^(?:\*{3,}|_{3,}|-{3,})$/;

/**
 * Reads a document once and returns its structure: headings with their level,
 * inline item markers with their column, and the lines themselves.
 *
 * Fenced regions are skipped for detection but not for the body, because a
 * reproduction command inside an item is part of that item.
 */
function scan(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const records = [];
  let fence = null;

  for (let line = 0; line < lines.length; line += 1) {
    const source = lines[line];
    const fenceMatch = FENCE.exec(source);

    if (fence !== null) {
      if (fenceMatch && fenceMatch[1][0] === fence) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1][0];
      continue;
    }

    const heading = HEADING.exec(source);
    if (heading) {
      records.push({ kind: 'heading', line, level: heading[1].length, text: heading[2].trim() });
      continue;
    }

    const inline = INLINE_ITEM.exec(source);
    if (inline) {
      records.push({
        kind: 'inline',
        line,
        from: inline.index,
        to: inline.index + inline[0].length,
        number: Number(inline[1] ?? inline[2] ?? inline[3]),
      });
    }
  }

  return { lines, records };
}

/** A status-suffixed numbered title is ambiguous unless its prefix is only a list. */
function ambiguousRetirementNumber(record) {
  if (record.kind !== 'heading' || !DEAD_HEADING.test(record.text)) return null;
  const numbered = NUMBERED.exec(record.text);
  if (!numbered) return null;

  const withoutSeverities = record.text.replace(SEVERITY_TOKEN, ' ');
  const marker = DEAD_HEADING.exec(withoutSeverities);
  const prefix = marker
    ? withoutSeverities
        .slice(0, marker.index)
        .trim()
        .replace(/[\s\-–—]+$/, '')
        .trim()
    : '';
  if (RETIREMENT_LIST_PREFIX.test(prefix)) return null;

  return Number(numbered[1]);
}

/**
 * The item numbers the document records as finished, sorted and deduplicated.
 *
 * Explicit retirement lists are collected (`## Items 5, 7, 9 — deleted`, or a
 * bare number list). A numbered heading with a descriptive title and a trailing
 * status word is instead reported as ambiguous: it could be a live title or an
 * individual retirement, and silently choosing either would lose information.
 */
/**
 * The item numbers a dead heading retires.
 *
 * Extracted so `assemble` can ask one question per heading — does this heading
 * actually LIST retired items? — rather than re-deriving it. A section that
 * lists numbers is a section about retired items, and its prose mentions them
 * without being them. A heading that merely contains a dead word, like
 * `## Fixed — a real P2 race in the adapter`, is a section about something else,
 * and treating it as a retirement list deleted every entry beneath it.
 */
function retiredNumbersIn(record) {
  if (record.kind !== 'heading' || !DEAD_HEADING.test(record.text)) return [];
  if (ambiguousRetirementNumber(record) !== null) return [];
  const withoutSeverities = record.text.replace(SEVERITY_TOKEN, ' ');
  if (LETTER_SUFFIXED_NUMBER.test(withoutSeverities)) return [];
  const numbers = new Set();
  for (const match of withoutSeverities.matchAll(NUMBER_OR_RANGE)) {
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);

    if (to < from || to - from > RANGE_LIMIT) {
      numbers.add(from);
      if (match[2] !== undefined) numbers.add(to);
      continue;
    }
    for (let value = from; value <= to; value += 1) numbers.add(value);
  }
  return [...numbers].sort((a, b) => a - b);
}

function deadNumbersIn(records) {
  const numbers = new Set();
  for (const record of records) {
    for (const value of retiredNumbersIn(record)) numbers.add(value);
  }
  return [...numbers].sort((a, b) => a - b);
}

/**
 * The item's title: one line, with the numbering and the separator that follows
 * it removed, so `## 12. \`rasterize-layer\` has no writer anywhere` titles as the
 * sentence rather than as the address. A severity tag is kept, because it is
 * content rather than address. When stripping would leave nothing, the
 * unstripped text is used, so a title is never empty.
 */
function titleOf(text) {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const stripped = collapsed
    .replace(/^(?:item\s+)?#?\d+\s*[.)]?\s*/i, '')
    .replace(/^[-–—:]+\s*/, '')
    .trim();
  return stripped === '' ? collapsed : stripped;
}

/**
 * Truncates on a word boundary. The `limit / 2` floor keeps a space found
 * immediately after the cut from collapsing the body to nothing.
 */
function cap(text, limit) {
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit);
  const boundary = clipped.lastIndexOf(' ');
  return (boundary > limit / 2 ? clipped.slice(0, boundary) : clipped).trimEnd();
}

/**
 * The body is the item's own text up to the next marker, and it stops at any
 * heading at the same or a higher level because that heading belongs to whatever
 * comes next — a deeper heading is the item's own sub-structure. The rules
 * between two entries are dropped as layout.
 */
function bodyOf(lines, open, endLine, endColumn) {
  const kept = [];

  for (let line = open.startLine; line < endLine; line += 1) {
    const from = line === open.startLine ? open.startColumn : 0;
    const part = lines[line].slice(from);
    if (!HORIZONTAL_RULE.test(part.trim())) kept.push(part.replace(/[ \t]+$/, ''));
  }
  if (endColumn > 0 && endLine < lines.length) kept.push(lines[endLine].slice(0, endColumn).trimEnd());

  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();

  return cap(kept.join('\n').trim(), BODY_LIMIT);
}

/**
 * Repository paths named in backticks. Absolute paths are dropped: they name the
 * machine a document was written on, not the checkout the board describes, and a
 * path outside the repository is not something an agent can claim. A span with
 * whitespace in it is dropped for the same reason of looking at the result: a
 * backticked shell command that happens to end in a source extension is a
 * command, and a repository path with a space in it does not occur.
 */
function filesOf(text) {
  const found = [];
  const seen = new Set();

  for (const match of text.matchAll(BACKTICK_SPAN)) {
    // `src/util/draw.ts:6-9` is a citation of a file, not a path. The handoff
    // documents cite that way almost exclusively, and dropping them on the
    // extension test left two thirds of the imported items with no file at all
    // — which is the one thing the board needs them for, because a named file
    // is a file it can lock.
    const cited = match[1].trim().replace(/[,;:.!]+$/, '');
    const candidate = cited.replace(/:\d+(?:[-–]\d+)*$/, '');
    if (WHITESPACE.test(candidate)) continue;
    if (candidate.startsWith('/')) continue;
    if (!candidate.includes('/') && !ROOT_FILE.test(candidate)) continue;
    if (!EXTENSION.test(candidate) || seen.has(candidate)) continue;

    seen.add(candidate);
    found.push(candidate);
    if (found.length === FILE_LIMIT) break;
  }

  return found;
}

function slugOf(title, run) {
  const base = title
    .slice(0, SLUG_LIMIT)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base === '') return run > 1 ? `item-${run}` : 'item';
  return run > 1 ? `${base}-${run}` : base;
}

/**
 * Builds the item and its `origin`.
 *
 * A repeated number in one document is a document defect. The first occurrence
 * remains parseable, but the duplicate is reported and the planner refuses to
 * file either ambiguous entry. Two entries that slug identically get a run
 * suffix instead, because a slug is derived from prose and two entries can
 * legitimately open the same way.
 */
function makeItem(base, number, rawTitle, body, seen, runs) {
  const title = titleOf(rawTitle);
  const files = filesOf(`${title}\n${body}`);

  if (number === null) {
    const run = (runs.get(slugOf(title, 1)) ?? 0) + 1;
    runs.set(slugOf(title, 1), run);
    const origin = `${base}#${slugOf(title, run)}`;
    if (seen.has(origin)) return null;
    seen.add(origin);
    return { origin, title, body, files };
  }

  const origin = `${base}#${number}`;
  if (seen.has(origin)) return null;
  seen.add(origin);
  return { origin, title, body, files };
}

/**
 * Walks the scan and pairs each marker with the text that belongs to it. An
 * item is open from its marker until the next marker, so the number a document
 * assigns is the only thing that has to survive an edit for the import to stay
 * idempotent.
 */
function assemble(base, { lines, records }) {
  const items = [];
  const duplicateNumbers = new Set();
  const ambiguousRetirements = [];
  const letterSuffixedHeadings = [];
  const seen = new Set();
  const runs = new Map();
  let ambient = 1;
  let open = null;
  let inDeadSection = false;

  const close = (endLine, endColumn) => {
    if (!open) return;
    if (open.number !== null && seen.has(`${base}#${open.number}`)) duplicateNumbers.add(open.number);
    const item = makeItem(base, open.number, open.title, bodyOf(lines, open, endLine, endColumn), seen, runs);
    if (item) items.push(item);
    open = null;
  };

  for (const record of records) {
    if (record.kind === 'heading') {
      ambient = record.level;

      if (LETTER_SUFFIXED_NUMBERED.test(record.text)) {
        close(record.line, 0);
        inDeadSection = false;
        letterSuffixedHeadings.push({ line: record.line + 1, level: record.level, text: record.text });
        continue;
      }

      const ambiguousNumber = ambiguousRetirementNumber(record);
      if (ambiguousNumber !== null) {
        close(record.line, 0);
        inDeadSection = false;
        ambiguousRetirements.push({
          origin: `${base}#${ambiguousNumber}`,
          number: ambiguousNumber,
          line: record.line + 1,
          heading: record.text,
        });
        open = {
          number: ambiguousNumber,
          title: record.text,
          level: record.level,
          startLine: record.line + 1,
        };
        continue;
      }

      if (DEAD_HEADING.test(record.text)) {
        close(record.line, 0);
        // Only a heading that LISTS retired items closes the section to inline
        // markers. `### Items 5, 7, 9 — deleted` is a section about retired
        // items and its prose mentions them; `## Fixed — a real P2 race` is a
        // section about a race, and suppressing the entries under it deleted
        // them. The dead word alone is not enough.
        inDeadSection = retiredNumbersIn(record).length > 0;
        continue;
      }
      // Any other heading ends the dead section, including one that opens no
      // item: the next live entry may legitimately be marked inline.
      inDeadSection = false;

      const number = NUMBERED.exec(record.text);
      if (number) {
        close(record.line, 0);
        open = { number: Number(number[1]), title: record.text, level: record.level, startLine: record.line + 1 };
        continue;
      }

      if (SEVERITY.test(record.text)) {
        close(record.line, 0);
        open = { number: null, title: record.text, level: record.level, startLine: record.line + 1 };
        continue;
      }

      if (open && record.level <= open.level) close(record.line, 0);
      continue;
    }

    /**
     * An inline marker inside a section the document has already deleted is not
     * an item. `HANDOFF.md` lists what it retired exactly this way —
     * `### Items 5, 7, 9 … — deleted` followed by prose that says
     * `- **Item 18** and **item 19** turned a dropped runtime publication…` —
     * and those became board issues whose titles were the sentence they were
     * mentioned in. Worse than noise: first-occurrence-wins gave the phantom the
     * number, so a genuinely reopened `## 7.` later in the document was the
     * duplicate that got dropped.
     */
    if (inDeadSection) continue;

    const line = lines[record.line];
    const remainder = titleOf(line.slice(record.to));
    close(record.line, record.from);
    open = {
      number: record.number,
      title: remainder === '' ? `Item ${record.number}` : remainder,
      level: ambient,
      startLine: record.line,
      startColumn: record.to,
    };
  }

  close(lines.length, 0);
  return {
    items,
    duplicateNumbers: [...duplicateNumbers].sort((a, b) => a - b),
    ambiguousRetirements,
    letterSuffixedHeadings,
  };
}

function scopeOf(file) {
  if (Object.prototype.hasOwnProperty.call(SCOPE_BY_FILE, file)) return SCOPE_BY_FILE[file];
  for (const [key, scope] of Object.entries(SCOPE_BY_FILE)) {
    if (file.endsWith(`/${key}`)) return scope;
  }
  return null;
}

/**
 * The item numbers `text` records as finished, sorted and deduplicated.
 *
 * Exported on its own because the documents state this in two places that mean
 * the same thing: a heading that says the entry is done, and a heading that
 * lists the numbers of entries that are. A caller reading one document to decide
 * whether an issue imported from another is still live needs the second form
 * without a second parse.
 *
 * @param {string} text the raw document
 * @returns {number[]}
 */
export function deadNumbers(text) {
  return deadNumbersIn(scan(text).records);
}

/**
 * Parses one handoff document into board items.
 *
 * Bad input yields fewer items, never an exception: `text` that is empty, null
 * or not a string produces no items, and a `file` outside `SCOPE_BY_FILE` is
 * parsed with a `null` scope rather than refused, so a new document can be tried
 * before it is given a scope.
 *
 * @param {{file?: string, text?: string}} input
 * @returns {ParseResult}
 */
export function parseHandoffDoc({ file = '', text = '' } = {}) {
  const path = String(file);
  const parsed = scan(text);
  const base = path.split('/').filter(Boolean).pop() || 'unknown.md';
  const { items, duplicateNumbers, ambiguousRetirements, letterSuffixedHeadings } = assemble(base, parsed);

  return {
    scope: scopeOf(path),
    items,
    dead: deadNumbersIn(parsed.records),
    duplicateNumbers,
    ambiguousRetirements,
    letterSuffixedHeadings,
  };
}

/**
 * The dedupe half of the import: what to file, and what to leave alone.
 *
 * Four things keep an item out of `create`: its origin is already known, its
 * number is explicitly dead, its origin is duplicated, or its heading has an
 * ambiguous retirement marker. The Markdown remains the durable record; the
 * board indexes only entries the parser can classify safely.
 *
 * A dead item lands in neither bucket. `skip` means "already known", and a dead
 * origin is not known to the board; the numbers are reported separately on the
 * parse result so a caller can account for what the document retired.
 *
 * @param {ParseResult[]|ParseResult} results one or more parse results
 * @param {Set<string>|string[]} known origins already in the board
 * @returns {{create: ImportItem[], skip: string[]}}
 */
export function planImport(results, known) {
  const documents = Array.isArray(results) ? results : results ? [results] : [];
  /**
   * `known` may be a Set/array of origins, or a Map/Record of origin → title.
   * The title is what separates "this document's item 2 is the item I already
   * have" from "this document's item 2 is a DIFFERENT item and mine is stale" —
   * and `origin` is a number, so an upstream renumbering or replacement leaves
   * the board holding the right-looking key beside the wrong defect, in `ready`,
   * claimable. Classifying on the origin alone made that indistinguishable from
   * an ordinary re-run, and the drift check downstream never ran.
   */
  const titles =
    known instanceof Map
      ? known
      : known && typeof known === 'object' && !Array.isArray(known) && !(known instanceof Set)
        ? new Map(Object.entries(known))
        : null;
  const already = new Set(known instanceof Set ? known : Array.isArray(known) ? known : titles ? titles.keys() : []);
  const create = [];
  const skip = [];
  const drift = [];
  const planned = new Set();
  const ambiguousOrigins = new Set(
    documents.flatMap((document) => (document?.ambiguousRetirements ?? []).map((entry) => entry.origin))
  );

  for (const document of documents) {
    const dead = new Set((document?.dead ?? []).map(Number).filter(Number.isInteger));
    const duplicates = new Set((document?.duplicateNumbers ?? []).map(Number).filter(Number.isInteger));

    for (const item of document?.items ?? []) {
      if (ambiguousOrigins.has(item.origin)) continue;
      const number = /#(\d+)$/.exec(String(item.origin));
      if (number && duplicates.has(Number(number[1]))) continue;
      if (number && dead.has(Number(number[1]))) continue;
      if (planned.has(item.origin)) {
        skip.push(item.origin);
        continue;
      }
      if (already.has(item.origin)) {
        const knownTitle = titles?.get(item.origin);
        if (knownTitle !== undefined && knownTitle !== item.title) drift.push(item.origin);
        else skip.push(item.origin);
        continue;
      }
      planned.add(item.origin);
      create.push(item);
    }
  }

  return { create, skip, drift };
}
