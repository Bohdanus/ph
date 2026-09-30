import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

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
});
