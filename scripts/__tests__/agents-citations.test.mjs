import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { deadNumbers } from '../lib/agent-board/handoff-import.mjs';

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
 * mention in `AGENTS.md` is a claim about code that is not in the tree — there is no form of the
 * sentence that is currently true. An entry here needs the same reason an
 * `ALLOWED_WITHOUT_SOURCE` entry needs, and for the same reason: an unexplained entry reads as a
 * flag somebody already checked.
 */
const RETIRED_GATE_SYMBOLS = new Map([
  [
    'saveLayerCanvas',
    'Deleted from `src/`, where it has zero occurrences. `HANDOFF.md` §19 recorded it as dead ' +
      'and §19 is itself on the deleted list, so there is no live record to re-point at: naming ' +
      'this symbol in `AGENTS.md` is a claim about an export the program does not contain.',
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

  it('names no symbol the program no longer contains', () => {
    expect(staleRetiredSymbols(readAgentsMd())).toEqual([]);
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
