import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { deadNumbers } from '../lib/agent-board/handoff-import.mjs';

/**
 * This file's budget, and why it is the 15s floor rather than the 5s default.
 *
 * One process, once, when a module-level helper evaluates: `git ls-files '*.md'`. That is the
 * sibling `docs-index.test.mjs`'s exact enumeration, its exact spawn, and its exact 15s floor
 * (`docs-index.test.mjs:9-21`) — ~30ms against a 5s default, so the default is not the binding
 * constraint. The declaration exists because `suite-budgets.test.mjs` derives the set of suites
 * that spawn a process and refuses to let one arrive without a budget, and a guard that can be
 * satisfied by writing a number is a guard nobody reads.
 */
vi.setConfig({ testTimeout: 15_000 });

/**
 * `AGENTS.md` is the one file every agent is guaranteed to read, so a stale fact in it is not
 * a typo — it is a false constraint handed to whoever opens the repository next. An
 * architecture gate written as "DO NOT do X while `someFunction()` does Y" outlives the
 * function it names, and then it is worse than absent: an agent either obeys a rule with no
 * premise or, having found the premise false, stops trusting the rest of the section.
 *
 * This was not hypothetical. `AGENTS.md` carried "DO NOT start single-writer cutover while
 * `saveLayerCanvas()` promotes cached canvases outside reducer publication", and
 * `saveLayerCanvas` has zero occurrences anywhere under `src/`: `HANDOFF.md` records deleting
 * it, and the hazard it named was closed by publishing presentation caches through
 * `PUBLISH_RUNTIME_PRESENTATION`, a typed action the reducer applies. Every other document in
 * the repository had already corrected the sentence; `AGENTS.md` was the last copy still
 * asserting it.
 *
 * The check is on the IDENTIFIER, never on a line number. A `file.ts:NNN` off by three is a
 * review finding — it moves on every diff, and a test failing on it would train people to
 * regenerate citations instead of re-deriving them. A backticked call naming a symbol the
 * program does not contain is a different failure: it cannot be re-derived onto anything, and
 * the sentence holding it is making a claim about code that is not there.
 *
 * SCOPE, and it is deliberately uneven across the three legs below. The retired-symbol leg reads
 * every MAINTAINED document in the repository; the call-form and handoff-section legs read
 * `AGENTS.md` alone. That is a measurement, not an oversight:
 *
 * - The retired-symbol leg is a list of names the program does not contain, so a document
 *   mentions one only by asserting it exists. Widening it costs 2 exclusions and catches the
 *   defect this file missed: `AGENTS.md` was fixed while `.skills/photoshop-tool-creation.md`
 *   and `docs/TOOLS-TOO-HARD.md` kept the identical false sentence, which is exactly the
 *   inconsistency a reader sees when only one of three copies is corrected.
 * - The call-form leg widened to every document reports 21 names that are not defects:
 *   `boundingBox()`, `toBeHidden()` and `getDevicePixelRatio()` are Playwright and DOM API, not
 *   repository code, and `snapshotPath()`, `baselineFile()` and `isRegenerableIgnored()` live in
 *   `e2e/` and `scripts/`, which this leg's corpus does not read. Clearing them would need
 *   either an `ALLOWED_WITHOUT_SOURCE` list that is a second copy of "names that are not ours",
 *   or a corpus widened past `src/` — and widening the corpus is worse than useless here:
 *   `scripts/lib/worktree-inventory/curated.mjs` names `saveLayerCanvas` in a historical string,
 *   so adding `scripts/` makes `declaredInSource('saveLayerCanvas')` true and switches the guard
 *   off by accident. The corpus stays `src/` and this leg stays scoped.
 * - The handoff-section leg widened reports 96 `§N` references that are not citations into
 *   `HANDOFF.md` at all: `TEXT_TOOL_REQUIREMENTS.md` and `docs/LAYERS-PANEL.md` use `§` for a
 *   numbered clause of their own prose. Its own doc comment already records that the rule cannot
 *   tell the two apart, so widening it would manufacture failures rather than find them.
 *
 * "Maintained" is not a judgement call made here. It is `git ls-files '*.md'` minus the generated
 * document and the point-in-time reports `docs/README.md` names, and the test below asserts this
 * file's exclusion list against that index so neither can drift.
 *
 * Lives in `scripts/__tests__/` for the reason `tool-descriptions.test.mjs` gives: `src/` is
 * the browser program and its TypeScript project declares no Node types, so a test under it
 * reaching for `node:fs` does not compile. Only Node built-ins are used here, which is what
 * keeps this file environment-agnostic under the root jsdom project.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const sourceFilesUnder = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFilesUnder(full));
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
};

const SOURCE_CORPUS = sourceFilesUnder(resolve(REPO_ROOT, 'src'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

/**
 * A backticked call form: `` `name()` ``. That is the shape an architecture gate uses to name
 * the thing whose behaviour it conditions on, which is why it is the shape worth checking. A
 * bare backticked identifier is not matched: `history-replay.ts`, `PUBLISH_RUNTIME_PRESENTATION`
 * and `swarm` are names of things that exist and are cited without a call, so matching them
 * would make this a different and far noisier test.
 */
const CALL_FORM = /`([A-Za-z_$][A-Za-z0-9_$]*)\(\)`/g;

const declaredInSource = (name) => new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(SOURCE_CORPUS);

/**
 * Escape hatch, empty on purpose. Each entry needs a reason in its own words, because an entry
 * with no reason is the same unfalsifiable flag `curated.mjs` is warned about — it reads as an
 * exception somebody already checked. If a legitimate case appears, say what the symbol is and
 * where it lives, in the entry.
 */
const ALLOWED_WITHOUT_SOURCE = new Set([]);

const staleCallForms = (markdown) =>
  [...markdown.matchAll(CALL_FORM)]
    .map((match) => match[1])
    .filter((name) => !ALLOWED_WITHOUT_SOURCE.has(name) && !declaredInSource(name));

const readAgentsMd = () => readFileSync(resolve(REPO_ROOT, 'AGENTS.md'), 'utf8');

/**
 * Every tracked markdown file, by `git ls-files` and not by walking the tree.
 *
 * Enumeration is the load-bearing half of the widening, and it is why this is git rather than a
 * list written out here. A hand-written list of the documents to check reopens precisely the hole
 * this extension closes: the guard read `AGENTS.md` alone, so two other tracked documents kept the
 * same false claim for as long as `AGENTS.md` held it, and the first document added after this
 * commit would be absent from a hand-written list for the same reason — present in the tree,
 * silently unchecked. `tracked` rather than `present` for the adjacent reason: a scratch file in
 * the working tree is not a document anyone is held to, and a walk would make the verdict depend
 * on who happened to be working here.
 *
 * `execFileSync` rather than `execSync`, so nothing in this path is a shell string. A `git`
 * failure throws here rather than yielding an empty list, which is the failure mode a silent
 * `catch` would hide: an empty corpus passes every assertion below.
 *
 * The same expression, for the same reason, is `docs-index.test.mjs`'s `trackedMarkdown`, and
 * `docs/README.md` records that this file is read from disk.
 */
const trackedMarkdown = () =>
  execFileSync('git', ['ls-files', '*.md'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((path) => path.replace(/\\/g, '/'))
    .sort();

/**
 * The generated markdown file, and the reason it is not read.
 *
 * `docs/TOOLS.md` is produced from `src/tools/descriptions/` by `npm run docs:tools` and a test
 * asserts it byte-equals the generator's output (`docs-index.test.mjs` names both). A failure here
 * therefore cannot be fixed by editing the document — `docs/DOCUMENTATION.md`: "A generated file
 * is not edited... Edit the source or the generator." Excluding it is not leniency toward a file
 * with false claims in it; it is refusing to hand an agent a red whose only apparent fix the rules
 * forbid. Declared rather than derived because no derivation can find it: the index lists it in
 * its Contract table as generated, which is not a table of documents nobody maintains.
 */
const GENERATED_DOCUMENTS = new Map([
  [
    'docs/TOOLS.md',
    'Generated by `npm run docs:tools`. Its sources are the `src/tools/descriptions/*.notes.md`, ' +
      'which this leg reads directly, so its content is checked where it is authored rather than ' +
      'in the artefact. Editing it by hand is forbidden by `docs/DOCUMENTATION.md`.',
  ],
]);

/**
 * The point-in-time reports, DERIVED from the index rather than listed here.
 *
 * All three documents that still name `saveLayerCanvas` outside the two that were corrected are in
 * this set, and every mention in them is TRUE: `AUDIT-STASHED-DOCS.md` records the claim as false,
 * `MIGRATION_NEXT_STEPS_SUNDAY.md` records the deletion, and `docs/next-target-useLayer.md` maps a
 * `commitDirtyTool` that no longer exists. A retired symbol named as deleted is not a claim that
 * it exists, which is the only claim this leg forbids.
 *
 * So "which documents are not maintained" has one home, `docs/README.md`, and a second list
 * written out here would be a second answer free to drift from the first — the same defect this
 * leg exists to catch, one level up. The set is read from the index instead.
 *
 * ## The TABLE ROWS, and why not a substring of the section
 *
 * The section is bounded at the next `##` heading first. Unbounded it also contains the frozen-
 * paths list further down the index, which names `docs/TOOLS.md` and `HANDOFF.md`.
 *
 * And the rows are matched as table rows rather than by basename anywhere in the section, because
 * the section's own closing prose cites `HANDOFF.md` by name: a basename scan would read the
 * repository's largest defect document as not maintained and drop it from the corpus silently.
 * That is the trap `docs-index.test.mjs` documents for its own basename fallback, and the test
 * below asserts `HANDOFF.md` IS checked for exactly that reason.
 *
 * Fails CLOSED: a missing heading or an unparseable table throws. A reader that found neither
 * would return an empty set, and an empty set excludes nothing — so the defect this leg exists to
 * catch would be back in every document while this file reported green.
 */
const NOT_MAINTAINED_ROW = /^\|[ \t]*(?:\[`([^`]+)`\]\([^)]+\)|`([^`]+)`)[ \t]*\|/gm;

/**
 * A row's first cell, resolved to a repository-relative path.
 *
 * The index lives in `docs/`, so it writes that directory's own files by BARE NAME —
 * `save-settings-inconsistency.md`, not `docs/save-settings-inconsistency.md` — and anything above
 * it as `../name`. Stripping the prefix and calling it resolved is what produced two untracked
 * paths, which then failed the accounting assertion below rather than quietly excluding a real
 * document: `docs/` is the base for a bare name and the root is the base for a `../` one.
 *
 * It is a resolution, not a lookup, so it can be wrong — a bare name for a ROOT file would resolve
 * into `docs/` where nothing is tracked. The accounting assertion below is what catches that: it
 * requires every excluded path to be a tracked document, so a misresolution reds instead of
 * excluding a document nobody can see was excluded.
 */
const fromIndexSpelling = (spelling) =>
  spelling.startsWith('../') ? spelling.slice(3) : `docs/${spelling.replace(/^docs\//, '')}`;

function indexPointInTimeDocuments() {
  const headingText = '## Not maintained here';
  const index = readFileSync(resolve(REPO_ROOT, 'docs/README.md'), 'utf8');
  const heading = index.indexOf(headingText);
  if (heading === -1) throw new Error(`docs/README.md has no "${headingText}" section`);
  const rest = index.slice(heading + headingText.length);
  const nextSection = rest.search(/\n## /);
  const section = nextSection === -1 ? rest : rest.slice(0, nextSection);
  const rows = [...section.matchAll(NOT_MAINTAINED_ROW)]
    .map((match) => fromIndexSpelling(match[1] ?? match[2]))
    .filter((path) => path.endsWith('.md'));
  if (!rows.length) throw new Error(`docs/README.md "${headingText}" table has no rows this reader can see`);
  return new Set(rows);
}

const DOCUMENTS_NOT_CHECKED = new Map([
  ...GENERATED_DOCUMENTS,
  ...[...indexPointInTimeDocuments()].map((path) => [
    path,
    'A point-in-time report, excluded because `docs/README.md` lists it as not maintained rather ' +
      'than as a document in the hierarchy.',
  ]),
]);

/**
 * The maintained documents, as `{ path, text }` so a failure names the file that carries it.
 *
 * The path is part of the finding because the widening makes it necessary: one retired symbol can
 * now live in any of 39 documents, and `expect(staleRetiredSymbols(joined)).toEqual([])` would
 * report the same symbol without reporting which file to open.
 */
const readMaintainedDocuments = () =>
  trackedMarkdown()
    .filter((path) => !DOCUMENTS_NOT_CHECKED.has(path))
    .map((path) => ({ path, text: readFileSync(resolve(REPO_ROOT, path), 'utf8') }));

/**
 * Every retired-symbol hit, prefixed by the document that made it.
 *
 * The mapping, not the filter, is the extension: `staleRetiredSymbols` already reports whatever a
 * string contains, so reading more documents is all it takes to reach them.
 */
const staleRetiredSymbolsByDocument = (documents) =>
  documents.flatMap(({ path, text }) => staleRetiredSymbols(text).map((finding) => `${path}: ${finding}`));

/**
 * The mirror of `staleCallForms`, for the half of the sentence that no longer names anything.
 *
 * `saveLayerCanvas` is a better example of the failure than the file's first draft suggested,
 * and the reason is the shape of the drift. The first draft of the corrected sentence was
 * "`AGENTS.md` was the last copy still asserting it" — so the `saveLayerCanvas()` call form was
 * removed and the *call-form* leg above went quiet. But the sentence went on making the same
 * false claim in prose, under a new name: "a canvas-promotion helper that no longer exists", plus
 * a citation to a `HANDOFF.md` section that never recorded the deletion. Dropping the identifier
 * satisfied `CALL_FORM` and left the false constraint exactly where it was, which is the failure
 * this whole file exists to catch. An identifier check cannot be the only one: a gate may name
 * its subject in words.
 *
 * So this is a name list, not a pattern, and it is the mirror of `ALLOWED_WITHOUT_SOURCE` rather
 * than a second copy of it: that set exempts a symbol from the source check, this one forbids
 * one outright. `saveLayerCanvas` qualifies because `declaredInSource` is false for it, so ANY
 * mention in a MAINTAINED document is a claim about code that is not in the tree — there is no
 * form of the sentence that is currently true. An entry here needs the same reason an
 * `ALLOWED_WITHOUT_SOURCE` entry needs, and for the same reason: an unexplained entry reads as a
 * flag somebody already checked.
 */
const RETIRED_GATE_SYMBOLS = new Map([
  [
    'saveLayerCanvas',
    'Deleted from `src/`, where it has zero occurrences. `HANDOFF.md` §19 recorded it as dead ' +
      'and §19 is itself on the deleted list, so there is no live record to re-point at: naming ' +
      'this symbol in a maintained document is a claim about an export the program does not contain.',
  ],
]);

/**
 * Every occurrence of a forbidden symbol, with the reason it is forbidden.
 *
 * Matched as a bare word, NOT as a call form, which is the whole difference from the leg above:
 * the call form stopped matching the moment the identifier was backticked into prose, and that is
 * the drift this function is here to survive.
 */
const staleRetiredSymbols = (markdown) =>
  [...RETIRED_GATE_SYMBOLS]
    .filter(([name]) => new RegExp(`\\b${name}\\b`).test(markdown))
    .map(([name, reason]) => `${name} — ${reason}`);

/**
 * The section numbers `HANDOFF.md` currently has, read from its own headings.
 *
 * `## 15a.` and `## 32.` both match because the suffixed form is a live entry in its own right —
 * `HANDOFF.md` §77 is the entry about the suffixed-retirement bug, so a parser that dropped the
 * suffix would retire `15` along with `15a` and resurrect a deleted number. The suffix is
 * therefore part of the number, not decoration on it.
 */
const HANDOFF_HEADING = /^##\s+(\d+[a-z]?)\./gm;

const liveHandoffNumbers = (handoff) => new Set([...handoff.matchAll(HANDOFF_HEADING)].map((match) => match[1]));

/**
 * A `§N` reference: the form `AGENTS.md` uses to point at a numbered handoff entry.
 *
 * Scoped to a bare integer because that is the only form present, and the only form that can be
 * checked: a `§` reference naming another document (`docs/TOOLS.md` §5) is a citation into prose
 * rather than into `HANDOFF.md`'s numbering, and a rule that could not tell the two apart would
 * be a rule whose failure could not be read. The file currently carries none of either, so the
 * rule cannot be producing a false positive today — and the detector leg below is what keeps that
 * from being an accident rather than a measurement.
 */
const SECTION_REF = /§(\d+[a-z]?)\b/g;

/**
 * `HANDOFF.md` section references that resolve to nothing an agent can read.
 *
 * A DELETED number is the worse case and is reported as its own failure, because the two need
 * different fixes and reading them as one is how the original defect survived: a number that was
 * deleted looks exactly like a number that was never written, so both get called "stale" and the
 * reader is left to guess whether repointing it is possible. It is not — `HANDOFF.md` forbids
 * prose tombstones (`HANDOFF.md:11-17` calls one "the tombstone the lifecycle rule forbids"), and
 * the numbers-only deleted list is the only record that exists. So a deleted reference is
 * removed, never repointed.
 *
 * `deadNumbers` is imported rather than re-derived: it is the same parser the board uses to keep
 * a retired number from being re-filed as new work (`handoff-import.mjs` `deadNumbers`), and a
 * second parser here would be a second answer to the same question.
 */
const staleHandoffRefs = (markdown, handoff) => {
  const live = liveHandoffNumbers(handoff);
  const dead = new Set(deadNumbers(handoff).map(String));
  return [...markdown.matchAll(SECTION_REF)]
    .map((match) => match[1])
    .filter((number) => !live.has(number))
    .map((number) =>
      dead.has(number)
        ? `§${number} — retired. HANDOFF.md lists it as deleted, so the entry it named is gone ` +
          `and the fix is to drop the reference, not to repoint it.`
        : `§${number} — no such section. HANDOFF.md has no heading numbered ${number} and does ` +
          `not list it as deleted.`
    );
};

describe("AGENTS.md's architecture claims resolve against the program", () => {
  it('cites no backticked call that the program does not contain', () => {
    expect(staleCallForms(readAgentsMd())).toEqual([]);
  });

  it('detects a call form the program does not contain', () => {
    // The guard on the guard. Asserting the real document is clean proves nothing on its own:
    // if `src/` moved, or the extension filter stopped matching, every identifier would look
    // absent and the test above would pass for the wrong reason — the exact failure this file
    // exists to prevent, one level up. So the detector is exercised on a known-bad input and a
    // known-good one, which is the only way to know it can fail at all.
    expect(staleCallForms('run `saveLayerCanvas()` and `PUBLISH_RUNTIME_PRESENTATION`')).toEqual(['saveLayerCanvas']);
    expect(staleCallForms('run `PUBLISH_RUNTIME_PRESENTATION`')).toEqual([]);
  });

  it('names no retired symbol in any maintained document', () => {
    expect(staleRetiredSymbolsByDocument(readMaintainedDocuments())).toEqual([]);
  });

  it('reaches the documents that carried the claim when the guard read only AGENTS.md', () => {
    // The guard on the guard, and the reason this leg is widened while the two below it are not.
    // Both documents here asserted the deleted symbol in prose after `AGENTS.md` had been
    // corrected, and every assertion in this file passed — the leg read one file. Asserting the
    // corpus CONTAINS them is what distinguishes "the guard is wider" from "the guard is green":
    // if the exclusion list grew by accident, or the enumeration stopped returning anything, the
    // empty `toEqual([])` above still passes and this does not.
    const paths = readMaintainedDocuments().map(({ path }) => path);
    expect(paths).toContain('AGENTS.md');
    expect(paths).toContain('.skills/photoshop-tool-creation.md');
    expect(paths).toContain('docs/TOOLS-TOO-HARD.md');
    // A scope of one file is the regression itself, so it is asserted as a bound rather than left
    // to be noticed: the corpus is every tracked document minus the ones the index excludes.
    expect(paths.length).toBe(trackedMarkdown().length - DOCUMENTS_NOT_CHECKED.size);
    expect(paths.length).toBeGreaterThan(20);

    // The detector fires on a retired symbol in a document that is not `AGENTS.md`, and says which.
    const findings = staleRetiredSymbolsByDocument([
      { path: 'docs/TOOLS-TOO-HARD.md', text: 'run `saveLayerCanvas()`' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('docs/TOOLS-TOO-HARD.md');
    expect(findings[0]).toContain('saveLayerCanvas');
  });

  it('accounts for every tracked document, and excludes only what the index excludes', () => {
    const tracked = trackedMarkdown();
    const checked = new Set(readMaintainedDocuments().map(({ path }) => path));

    // Every tracked document is either read or excluded — nothing unaccounted for, which is the
    // hole a new document would fall into if the corpus were a list rather than a subtraction.
    expect(checked.size + DOCUMENTS_NOT_CHECKED.size).toBe(tracked.length);
    expect([...DOCUMENTS_NOT_CHECKED.keys()].filter((path) => checked.has(path))).toEqual([]);
    // Every excluded path is genuinely tracked, so a stale row in the index table cannot silently
    // put a path in the corpus that is not there.
    expect([...DOCUMENTS_NOT_CHECKED.keys()].filter((path) => !tracked.includes(path))).toEqual([]);
    // Every exclusion carries a reason. An unexplained one is the unfalsifiable flag this file's
    // own `ALLOWED_WITHOUT_SOURCE` comment is written against.
    expect([...DOCUMENTS_NOT_CHECKED].filter(([, reason]) => !reason.trim()).map(([p]) => p)).toEqual([]);

    // The set is DERIVED from `docs/README.md`, so it follows the index instead of drifting from
    // it — and these three are what a basename scan of that section would wrongly sweep up with
    // them: the section's closing prose cites `HANDOFF.md`, and the next section names both
    // `docs/TOOLS.md` and the handoff documents. Dropping any of these from the corpus would
    // restore the exact hole this widening closed, silently, with every assertion above green.
    expect(checked.has('HANDOFF.md')).toBe(true);
    expect(checked.has('AGENTS.md')).toBe(true);
    expect(checked.has('docs/DOCUMENTATION.md')).toBe(true);
    expect(DOCUMENTS_NOT_CHECKED.has('HANDOFF.md')).toBe(false);
    expect(DOCUMENTS_NOT_CHECKED.has('docs/DOCUMENTATION.md')).toBe(false);
    // The generated file IS excluded, and for the reason that makes the exclusion legitimate:
    // `docs/DOCUMENTATION.md` forbids the hand edit a failure there would otherwise demand.
    expect([...GENERATED_DOCUMENTS.keys()]).toEqual(['docs/TOOLS.md']);
    expect(checked.has('docs/TOOLS.md')).toBe(false);

    // The derivation reads real rows: the table exists and is not empty, and each derived path is
    // a tracked document. An empty set excludes nothing, which would turn this guard off entirely
    // rather than make it noisy.
    const derived = [...indexPointInTimeDocuments()];
    expect(derived.length).toBeGreaterThan(5);
    for (const path of derived) expect(tracked).toContain(path);
  });

  it('detects a retired symbol however the sentence is written', () => {
    // Three wordings of the same false claim, because the sentence was rewritten twice and each
    // rewrite slipped past a different check. The call form is what the leg above catches; the
    // backticked bare name and the un-backticked prose form are what it does not, and the second
    // is what the corrected paragraph was caught doing.
    expect(staleRetiredSymbols('run `saveLayerCanvas()`')).toHaveLength(1);
    expect(staleRetiredSymbols('run `saveLayerCanvas`')).toHaveLength(1);
    expect(staleRetiredSymbols('gated on a canvas-promotion helper, which was saveLayerCanvas')).toHaveLength(1);
    // A live symbol is not a hit, and neither is a name that merely contains the string.
    expect(staleRetiredSymbols('`saveLayerCanvasRegistry` and `PUBLISH_RUNTIME_PRESENTATION`')).toEqual([]);
  });

  it('cites no handoff section that is not a live heading', () => {
    expect(staleHandoffRefs(readAgentsMd(), readFileSync(resolve(REPO_ROOT, 'HANDOFF.md'), 'utf8'))).toEqual([]);
  });

  it('distinguishes a retired handoff section from one that never existed', () => {
    const handoff = readFileSync(resolve(REPO_ROOT, 'HANDOFF.md'), 'utf8');
    const live = [...liveHandoffNumbers(handoff)];
    expect(live).not.toContain('127');

    // A live section resolves and is not reported. `126` and `128` are its live neighbours: 127
    // is the gap between them, which is what makes the pair worth asserting — a parser that
    // stopped matching `## N.` headings at all would report the neighbours too.
    expect(staleHandoffRefs('see §126 and §128', handoff)).toEqual([]);
    // The retired one, and one that never existed, are both reported and named differently,
    // because only the second can be fixed by repointing.
    const retired = staleHandoffRefs('see §127', handoff);
    expect(retired).toHaveLength(1);
    expect(retired[0]).toContain('§127');
    expect(retired[0]).toContain('retired');
    const absent = staleHandoffRefs('see §9999', handoff);
    expect(absent).toHaveLength(1);
    expect(absent[0]).toContain('no such section');
  });
});
