import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import * as citationPatterns from '../lib/citations/resolve.mjs';
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
 * every MAINTAINED document in the repository; the call-form leg checks `AGENTS.md` against app
 * source and `HANDOFF.md` against app source plus the specific script and E2E files it cites. The
 * handoff-section leg reads `AGENTS.md` alone. That is a measurement, not an oversight:
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
 *   off by accident. `AGENTS.md` stays scoped to `src/`; `HANDOFF.md` adds only its specifically
 *   cited source files, so non-app calls can be checked without importing historical strings.
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

const HANDOFF_CALL_SOURCES = [
  'scripts/lib/agent-board/db.mjs',
  'scripts/lib/worktree-inventory/git.mjs',
  'e2e/helpers/canvas-helpers.ts',
  'e2e/global-setup.ts',
  'e2e/export/helpers.ts',
  'e2e/crop-history.spec.ts',
  'e2e/accessibility.spec.ts',
  'scripts/dispose-worktree.mjs',
  'scripts/resolve-citations.mjs',
  'scripts/lib/agent-board/identity.mjs',
  'scripts/lib/worktree-inventory/writes.mjs',
];
const HANDOFF_SOURCE_CORPUS = [
  SOURCE_CORPUS,
  ...HANDOFF_CALL_SOURCES.map((path) => readFileSync(resolve(REPO_ROOT, path), 'utf8')),
].join('\n');

/**
 * A backticked call form: `` `name()` ``. That is the shape an architecture gate uses to name
 * the thing whose behaviour it conditions on, which is why it is the shape worth checking. A
 * bare backticked identifier is not matched: `history-replay.ts`, `PUBLISH_RUNTIME_PRESENTATION`
 * and `swarm` are names of things that exist and are cited without a call, so matching them
 * would make this a different and far noisier test.
 */
const CALL_FORM = /`([A-Za-z_$][A-Za-z0-9_$]*)\(\)`/g;

const declaredInSource = (name, sourceCorpus = SOURCE_CORPUS) =>
  new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(sourceCorpus);

/**
 * Escape hatch, empty on purpose. Each entry needs a reason in its own words, because an entry
 * with no reason is the same unfalsifiable flag `curated.mjs` is warned about — it reads as an
 * exception somebody already checked. If a legitimate case appears, say what the symbol is and
 * where it lives, in the entry.
 */
const ALLOWED_WITHOUT_SOURCE = new Set([]);

const staleCallForms = (markdown, sourceCorpus = SOURCE_CORPUS) =>
  [...markdown.matchAll(CALL_FORM)]
    .map((match) => match[1])
    .filter((name) => !ALLOWED_WITHOUT_SOURCE.has(name) && !declaredInSource(name, sourceCorpus));

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
  [
    '.kilo/plans/test-hardening-plan.md',
    'Internal hardening plan in .kilo/plans/; not a maintained document and contains ' +
      'line-number citations to existing tests for reference. The .kilo/plans/ directory ' +
      'is excluded from docs/README.md index.',
  ],
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
 *
 * ## The git-ref exemption, and why it is a correction rather than a hole
 *
 * A mention inside a GIT REF is not a claim about the program. `fix/saveLayerCanvas-citations` is a
 * branch that exists — `git rev-parse` resolves it — and a document that names it is reporting a fact
 * about the repository, in the same way that naming `HANDOFF.md` names a file. The reason string
 * above asserts that "naming this symbol in a maintained document is a claim about an export the
 * program does not contain", and that is FALSE for a ref: the sentence "`docs/citation-anchors` and
 * `fix/saveLayerCanvas-citations` are the same two commits" is true today and stays true after those
 * branches are deleted. So this exemption makes the detector match its own stated principle rather
 * than loosening it, and the defect class the leg exists for is untouched: an assertion that the
 * program HAS the export is still reported, in every form.
 *
 * The discriminator is a SLASH inside the same whitespace-free token, because that is what separates a
 * ref from an identifier in this repository's own naming: every branch that carries a retired symbol
 * is namespaced (`fix/…`, `docs/…`), and no bare identifier contains one. Requiring the whole token
 * rather than a lookaround is deliberate — a lookaround for "a slash anywhere nearby" would exempt
 * "`saveLayerCanvas` is gated on `src/util/x.ts`", which is exactly the false constraint this file
 * was written to catch.
 */
/**
 * Whether EVERY mention of a retired symbol sits inside a git ref.
 *
 * "Every", not "any", and that is the whole safety property. An earlier version returned on the first
 * ref it found, so a document that named the branch AND made a claim in prose — `fix/saveLayerCanvas-citations`
 * is a branch, and saveLayerCanvas promotes it` — came back exempt, and the one sentence in it that
 * asserts the program has the export is exactly what this leg exists to catch. An exemption has to be
 * earned by the whole document, because the document is what is being judged.
 */
const isGitRef = (markdown, name) => {
  const mentions = [...markdown.matchAll(new RegExp(`\\b${name}\\b`, 'g'))];
  if (!mentions.length) return false;
  const isBoundary = (ch) => ch === undefined || /[\s`]/.test(ch);
  return mentions.every(({ index }) => {
    // Widen from the mention to the token around it. A ref has no whitespace in it, so the token is
    // found by walking outwards to the nearest boundary rather than by guessing a fixed width.
    let start = index;
    let end = index + name.length;
    while (!isBoundary(markdown[start - 1])) start -= 1;
    while (!isBoundary(markdown[end])) end += 1;
    return markdown.slice(start, end).includes('/');
  });
};

const staleRetiredSymbols = (markdown) =>
  [...RETIRED_GATE_SYMBOLS]
    .filter(([name]) => new RegExp(`\\b${name}\\b`).test(markdown) && !isGitRef(markdown, name))
    .map(([name, reason]) => `${name} — ${reason}`);

/**
 * The sections `HANDOFF.md` currently has, read from its own headings.
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
 * reader is left to guess whether repointing it is possible. It is not — `HANDOFF.md` calls a
 * prose stand-in "the tombstone the lifecycle rule forbids", and the numbers-only deleted list is
 * the only record that exists. So a deleted reference is removed, never repointed.
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

/**
 * A `file.ext:NNN` citation: a line number in a document.
 *
 * The pattern lives in `scripts/lib/citations/resolve.mjs` and is IMPORTED here rather than written
 * out again, which is the fix for a drift this file used to carry. The gate listed 20 extensions and
 * the migration sweep listed 13, so `svg`, `png`, `html`, `wasm`, `avif`, `webp` and `jpg` citations
 * were invisible to the tool that builds the worklist — and the drift ran the dangerous way, with
 * the sweep reporting CLEAN on a document this gate rejects. A gate and the tool that feeds it must
 * agree on what a citation is; two hand-written lists cannot be relied on to, and this one had
 * already diverged.
 *
 * What the pattern must keep out is unchanged and is the reason the extension list exists: requiring
 * a known extension followed by COLON and DIGITS keeps `node:fs`, `node:path` and
 * `http://localhost:5173` out — the shapes a looser `\w+:\d+` would report, and the first two of
 * which appear in this very repository's import lines. `.md` is IN the list on purpose:
 * `docs/README.md` citing `HANDOFF.md:99` drifts exactly as much as `HANDOFF.md:99` does, and
 * excluding prose targets would exempt the documents with the most citations in them.
 *
 * A RANGE (`file.ts:12-20`) and a comma list are caught by the same match, because the pattern only
 * needs the first number; the reported string stops there, which is enough to name the line for a
 * human to go and look at.
 */
const { LINE_NUMBER_CITATION, withoutFencedCode } = citationPatterns;

/**
 * A fenced code block's contents, removed.
 *
 * This is the ONE exemption from the ban, and it is exemption-by-quotation rather than
 * exemption-by-path. A `HANDOFF.md` entry whose SUBJECT is a drifted line-number citation cannot be
 * stated without the number — "every `history-replay.ts` line citation past `:89` is off by twenty"
 * is a claim ABOUT the citation, so deleting the number deletes the finding.
 *
 * A fence is the honest container for that, and it is checkable in a way an exemption list is not: a
 * reader runs the grep and sees only what is quoted, and the quote is visibly a quotation. An
 * `ALLOWED` entry naming an occurrence is the shape `AGENTS.md` warns about — an assertion nobody
 * can falsify, which reads as checked and is not.
 *
 * Fenced blocks are stripped rather than inspected, so a fence cannot be used to smuggle a real
 * citation past the check either: the ban is on prose, and prose is what is left after the strip.
 * An unterminated fence strips to the end of the document, which is the safe direction — a document
 * that forgets its closing fence loses the check on everything after it, and the failure to notice
 * is a fence that is trivially visible.
 *
 * The two passes are why there are two: `$` under the `m` flag also matches BEFORE a newline, so a
 * single pattern closed by `$` terminates on the opening fence's own line end. The paired form runs
 * first and the leftover form second, so the unterminated case is a consequence of what the first
 * pass did not match rather than a branch of the same pattern.
 *
 * The implementation is imported from `scripts/lib/citations/resolve.mjs` rather than written here,
 * for the same reason the citation pattern is: the gate and the migration sweep have to strip the
 * same bytes, or the sweep hands reviewers worklist items — fenced quotations — whose correct
 * resolution is to change nothing.
 */

/**
 * The distinct numbered citations in a string, deduplicated, with fences removed.
 *
 * A named function rather than a `.test()` on the global pattern, and that is a correctness point
 * rather than a style one: `/g` makes `test()` stateful through `lastIndex`, so a `.test()` loop
 * over several documents skips every second match and reports a corpus that is half clean without
 * anything looking wrong.
 */
const lineNumberCitationsIn = (text) => [
  ...new Set([...withoutFencedCode(text).matchAll(LINE_NUMBER_CITATION)].map((m) => m[0])),
];

/**
 * A BARE continuation — `` `:476` `` with no filename — is the same banned form with the file
 * carried over from the citation beside it.
 *
 * Two patterns rather than one because the two shapes really are different text: `file.ext:‹line›`
 * names its own file, and a bare `:‹line›` does not. The enforcement leg checks both, because a
 * document that states the rule has to state it completely — a reader who learns the form from
 * `AGENTS.md` will write the bare form when the file was named a clause earlier, and a gate that only
 * matched the self-naming shape would let that through in the one document that must not contain it.
 *
 * What this does NOT do is extend the remainder leg below, which reports the migration's outstanding
 * work. It cannot: `docs/OVERRIDES.md` carries two bare continuations, that file is the operator's to
 * write, and `AGENTS.md` forbids an agent from editing it. The finding is recorded in `HANDOFF.md`
 * rather than papered over here, so the limitation is a to-do item and not a quiet gap.
 */
const BARE_CONTINUATION = /`:(?:\d+(?:-\d+)?(?:,:\d+(?:-\d+)?)*)`/g;

const bannedNumbersIn = (text) => [
  ...new Set([
    ...[...withoutFencedCode(text).matchAll(LINE_NUMBER_CITATION)].map((m) => m[0]),
    ...[...withoutFencedCode(text).matchAll(BARE_CONTINUATION)].map((m) => m[0]),
  ]),
];

/**
 * The documents whose numbered citations are forbidden, and the rule behind the list.
 *
 * Coverage is BY DOCUMENT and it only grows, which is the whole design. The alternative — a
 * per-occurrence exemption list, or a corpus of everything with the outstanding numbers excused —
 * is the shape this file's own `ALLOWED_WITHOUT_SOURCE` comment warns about at one level down: an
 * entry nobody can falsify, which reads as checked and is not. Here the exempt side is a PATH,
 * and a path is checkable in a way an occurrence is not: a reader can run
 * `rg '\.\w+:\d+' <path>` and see the residue, or count the paths still missing from this map
 * and see exactly what the migration has left. Adding a document is the visible, reviewed act of
 * migrating it.
 *
 * The assertion below pins the property that makes the growth honest: every document NOT in this
 * map that still carries a numbered citation is reported, so the remainder cannot go unrecorded,
 * and no document can be dropped from the map to make the count smaller.
 */
const LINE_NUMBER_GATED = new Set(['AGENTS.md', 'docs/DOCUMENTATION.md', 'docs/README.md', 'HANDOFF.md']);

/**
 * Every numbered citation in the gated documents, prefixed by the document that made it.
 *
 * Deduplicated per document, because a document that opens a finding with the same mistake twenty
 * times should read as one thing to fix rather than twenty findings to triage.
 */
const lineNumberCitationsByDocument = (documents) =>
  documents
    .filter(({ path }) => LINE_NUMBER_GATED.has(path))
    .flatMap(({ path, text }) => bannedNumbersIn(text).map((citation) => `${path}: ${citation}`));

/**
 * The maintained documents that still carry a numbered citation, and are therefore not gated yet.
 *
 * Reported rather than merely counted, so the migration's remainder is a list in a failing
 * assertion instead of a number in a comment that goes stale. This is the answer to "is the
 * migration done", and it is an answer that can only be true.
 */
const ungatedDocumentsWithLineNumbers = (documents) =>
  documents
    .filter(({ path }) => !LINE_NUMBER_GATED.has(path))
    .filter(({ text }) => bannedNumbersIn(text).length > 0)
    .map(({ path }) => path);

describe("maintained guidance's code claims resolve against the program", () => {
  it('cites no backticked call that the program does not contain in AGENTS.md or HANDOFF.md', () => {
    expect(staleCallForms(readAgentsMd())).toEqual([]);
    expect(staleCallForms(readFileSync(resolve(REPO_ROOT, 'HANDOFF.md'), 'utf8'), HANDOFF_SOURCE_CORPUS)).toEqual([]);
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

    // The git-ref exemption, and the four things it must NOT buy. Every one of these is a claim that
    // the program contains the export, which is the whole defect class this leg exists for, so each
    // has to stay a hit even though a ref elsewhere in the same document would be exempt.
    expect(staleRetiredSymbols('`fix/saveLayerCanvas-citations` is a branch')).toHaveLength(0);
    expect(staleRetiredSymbols('`docs/citation-anchors` and `fix/saveLayerCanvas-citations`')).toHaveLength(0);
    // A ref AND a real claim in one document: the ref is exempt, the claim is not, so this is a hit.
    // An exemption that silenced the whole document would be the hole, not the fix.
    expect(
      staleRetiredSymbols('`fix/saveLayerCanvas-citations` is a branch, and saveLayerCanvas promotes it')
    ).toHaveLength(1);
    // A file path near a bare mention is not a ref — this is the sentence the guard was written for.
    expect(staleRetiredSymbols('saveLayerCanvas writes into `src/util/layer-renderer.ts`')).toHaveLength(1);
    expect(staleRetiredSymbols('`saveLayerCanvas` is gated on `src/contexts/reducer.ts`')).toHaveLength(1);
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

    // A live section resolves and is not reported. `135` and `146` are live, with
    // `136-145` retired between them — which is what makes the assertion worth
    // having: a parser that stopped matching `## N.` headings would report them too.
    expect(staleHandoffRefs('see §135 and §146', handoff)).toEqual([]);
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

  it('cites no line number in a gated document', () => {
    expect(lineNumberCitationsByDocument(readMaintainedDocuments())).toEqual([]);
  });

  it('catches a BARE continuation in a gated document, not only the self-naming form', () => {
    // Untested enforcement is not enforcement, and this leg is the only one that can fail on the
    // documents that STATE the rule. `bannedNumbersIn` exists because `LINE_NUMBER_CITATION` needs a
    // filename and a bare `:476` has none — so the shape a reader writes when the file was named a
    // clause earlier was invisible in the three documents that must model the rule correctly.
    // `:480`-`:486` is TWO backticked tokens, so it is two citations, not one range — each token is
    // its own coordinate and either can hide a different one. `:480-486` inside ONE token is a
    // genuine range and stays one entry.
    const bare = 'The guard at `:476` fails, and so does the span `:480-486`.';
    expect(lineNumberCitationsByDocument([{ path: 'AGENTS.md', text: bare }])).toEqual([
      'AGENTS.md: `:476`',
      'AGENTS.md: `:480-486`',
    ]);
    const split = 'The guard at `:480`-`:486` fails.';
    expect(lineNumberCitationsByDocument([{ path: 'AGENTS.md', text: split }])).toEqual([
      'AGENTS.md: `:480`',
      'AGENTS.md: `:486`',
    ]);
    // Both shapes together, and a fenced one still exempt. The self-naming form reports without its
    // backticks — `LINE_NUMBER_CITATION` matches the coordinate, not the quoting — while the bare
    // form necessarily includes them, because the backtick IS what makes `:34` a citation.
    const mixed = 'See `AGENTS.md:12` and `:34`, but not this:\n```\n`AGENTS.md:56`\n```\n';
    expect(lineNumberCitationsByDocument([{ path: 'AGENTS.md', text: mixed }])).toEqual([
      'AGENTS.md: AGENTS.md:12',
      'AGENTS.md: `:34`',
    ]);
  });

  it('detects a line-number citation, and not the shapes that only look like one', () => {
    // The guard on the guard, for the leg above. Each pair is one thing that must be caught and
    // one neighbour that must not, because a detector for this leg is easy to write so that it
    // either misses prose targets or reports the repository's own import lines.
    //
    // Caught: the three forms documents actually use. A range and a comma list are caught by the
    // first number, which is the whole of what is needed to name the line to a human.
    expect(lineNumberCitationsIn('at `history-adapter.ts:172`')).toEqual(['history-adapter.ts:172']);
    expect(lineNumberCitationsIn('`materialization.ts:316-323`')).toEqual(['materialization.ts:316']);
    expect(lineNumberCitationsIn('`reducer.ts:88`, then `reducer.ts:91`')).toEqual(['reducer.ts:88', 'reducer.ts:91']);
    // A prose target is a citation too. `docs/README.md` citing `HANDOFF.md:99` drifts exactly as
    // much as `HANDOFF.md:99` does.
    expect(lineNumberCitationsIn('HANDOFF.md:99')).toEqual(['HANDOFF.md:99']);

    // Not caught: the shapes that carry a colon and a number without citing a line. `node:fs` and
    // `node:path` are this repository's own import specifiers, and a URL's port is not a line.
    expect(lineNumberCitationsIn("import { readFileSync } from 'node:fs'")).toEqual([]);
    expect(lineNumberCitationsIn('see http://localhost:5173/ for the dev server')).toEqual([]);
    // A version, a timestamp and a specifier all carry a dot and a colon and are not citations.
    expect(lineNumberCitationsIn('vite 7.0:1 shipped at 20:00')).toEqual([]);
    // A deduplicated repeat is one thing to fix, not five.
    expect(lineNumberCitationsIn('a.ts:1 and again a.ts:1 and again a.ts:1')).toEqual(['a.ts:1']);
    // A fence is the ONE exemption, and it is exemption by quotation: `HANDOFF.md` carries entries
    // whose subject IS a drifted citation, and a finding about `:89` cannot be stated without it.
    expect(lineNumberCitationsIn('```\nhistory-replay.ts:89 is off by twenty\n```\nand `other.ts:4` too')).toEqual([
      'other.ts:4',
    ]);
    // The fence buys nothing to smuggle with: prose after it is still checked.
    expect(lineNumberCitationsIn('```\nsafe\n```\n\nthen `a.ts:1` here')).toEqual(['a.ts:1']);
    // An unterminated fence is the failure to notice, and it strips to the end.
    expect(lineNumberCitationsIn('```\nstill open\n`a.ts:1` after')).toEqual([]);
  });

  it('reports the maintained documents that still carry a numbered citation', () => {
    // The migration's remainder, as a failing assertion rather than a number in a comment. This
    // test is EXPECTED to fail for as long as documents are unmigrated, which is stated here
    // rather than left to be discovered: it is the to-do list, and it shrinks by migration.
    //
    // It reads BOTH shapes, via `bannedNumbersIn`, which is what it stopped NOT doing once the last
    // bare continuation in a maintained document was migrated. The bare form had a reason to be
    // exempt here that no longer exists: it went red on `docs/OVERRIDES.md`, and that file is the
    // operator's, so the fix had to be theirs before the widening could be honest. It also flags a
    // TCP port as a coordinate — nothing in the syntax separates them — which is why
    // `.skills/hard-merge.md` now says "port 5173" rather than quoting a bare `:5173`.
    expect(ungatedDocumentsWithLineNumbers(readMaintainedDocuments())).toEqual([]);
  });

  it('reports a bare continuation in an unGATED document too, not only a filename', () => {
    // The guard on the guard for the widening above. Asserting the corpus is clean proves nothing
    // on its own: if `bannedNumbersIn` stopped matching the bare form, this assertion would still
    // pass for the wrong reason — which is exactly how the bare form survived a green gate for the
    // whole life of the rule.
    expect(ungatedDocumentsWithLineNumbers([{ path: 'docs/FEATURES.md', text: 'the guard at `:476` fails' }])).toEqual([
      'docs/FEATURES.md',
    ]);
    expect(
      ungatedDocumentsWithLineNumbers([{ path: 'docs/FEATURES.md', text: 'the guard at `settings.ts:476` fails' }])
    ).toEqual(['docs/FEATURES.md']);
    // A fenced one is still quotation, on this leg as on the gated one.
    expect(ungatedDocumentsWithLineNumbers([{ path: 'docs/FEATURES.md', text: '```\n`:476`\n```\n' }])).toEqual([]);
  });

  it('gates a real document, and the gated set is every path it claims to be', () => {
    // The scope of this leg is the thing that can rot silently, because the leg above passes on an
    // EMPTY gated set: a map from document to rule that no document is in enforces nothing at all
    // and reports green. So the set is asserted to be non-empty, to name real tracked documents,
    // and to contain the two documents that state the rule itself.
    const tracked = new Set(trackedMarkdown());
    const gated = [...LINE_NUMBER_GATED];
    expect(gated.length).toBeGreaterThan(0);
    expect(gated.filter((path) => !tracked.has(path))).toEqual([]);
    expect(gated).toContain('AGENTS.md');
    expect(gated).toContain('docs/DOCUMENTATION.md');
    expect(gated).toContain('HANDOFF.md');
    // The spec is gated, which is the property that makes the rule's own table an enforcement
    // problem instead of a special case: `docs/DOCUMENTATION.md` writes the banned form with a
    // placeholder for exactly this reason.
    expect(lineNumberCitationsIn(readFileSync(resolve(REPO_ROOT, 'docs/DOCUMENTATION.md'), 'utf8'))).toEqual([]);
    // And the leg reads the gated set, not the whole corpus: a document outside it is reported by
    // the migration test above instead, which is the difference between "not migrated yet" and
    // "clean".
    expect(lineNumberCitationsByDocument([{ path: 'docs/FEATURES.md', text: '`useHistory.ts:141`' }])).toEqual([]);
    expect(lineNumberCitationsByDocument([{ path: 'AGENTS.md', text: '`useHistory.ts:141`' }])).toEqual([
      'AGENTS.md: useHistory.ts:141',
    ]);
  });
});
