/**
 * `handoff-id.mjs` — the mint a new entry's id comes from.
 *
 * The parser's own tests pin that a sha id is READ. These pin that it can be
 * MINTED, which is the half that has to be reproducible: a helper that printed a
 * different id for the same title on a second run would make two sessions
 * disagree about one entry, and would make the collision this scheme exists to
 * remove reappear as a different collision.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * The worktree root, which is two levels above this file. `import.meta.url`
 * cannot be the base of that walk: the root Vitest project runs in jsdom, and
 * jsdom rewrites `import.meta.url` to an http form `readFileSync` refuses.
 */
function findRoot() {
  for (const start of [import.meta.dirname, process.cwd()]) {
    if (typeof start !== 'string') continue;
    const candidate = resolve(start, '..', '..');
    if (existsSync(join(candidate, 'HANDOFF.md'))) return candidate;
  }
  throw new Error('cannot locate the worktree root that holds HANDOFF.md');
}

/**
 * Each test here is one or two `node` spawns, so what this file costs is spawn
 * count rather than computation. It runs in about 1.6s on the machine the numbers
 * were taken on, which is well inside Vitest's default; the declaration exists
 * because `suite-budgets.test.mjs` derives the set of suites that spawn a process
 * and refuses to let one arrive without a budget. It is set to the 15s floor
 * rather than to something tighter because a tighter number here would be a
 * threshold pretending to be a measurement.
 */
vi.setConfig({ testTimeout: 15_000 });

const root = findRoot();
const script = join(root, 'scripts', 'handoff-id.mjs');

/**
 * Runs the helper and returns its stdout, trimmed.
 *
 * @param {string[]} args
 * @returns {string}
 */
function mint(...args) {
  return execFileSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' }).trim();
}

describe('handoff-id', () => {
  it('mints a seven-character lowercase hex id', () => {
    expect(mint('A brand new problem with a long title')).toMatch(/^[0-9a-f]{7}$/);
  });

  it('mints the same id for the same title, so two sessions agree', () => {
    const title = 'The same entry described the same way';
    expect(mint(title)).toBe(mint(title));
  });

  it('normalises case and runs of whitespace, so one title is one id', () => {
    const plain = mint('The crop commits on Enter but not on Escape');
    expect(mint('  The   crop COMMITS on Enter but not on Escape  ')).toBe(plain);
  });

  it('mints different ids for different titles', () => {
    expect(mint('One problem about the crop')).not.toBe(mint('Another problem about the crop'));
  });

  it('reads the title from stdin, so a title needs no shell escaping', () => {
    const title = 'A title with `backticks`, $VAR and "quotes" in it';
    const piped = execFileSync(process.execPath, [script], {
      cwd: root,
      encoding: 'utf8',
      input: `${title}\n`,
    }).trim();

    expect(piped).toMatch(/^[0-9a-f]{7}$/);
  });

  it('refuses an empty title with usage and a non-zero exit', () => {
    // An empty title would mint the id of the empty string, which every
    // no-title entry would then share.
    expect(() => mint()).toThrow();
  });

  it('reports the id a title already holds rather than minting a second one', () => {
    /**
     * §242's real title, read from the document rather than copied, so a
     * retitled entry fails this test instead of silently passing on a stale
     * string.
     */
    const handoff = readFileSync(join(root, 'HANDOFF.md'), 'utf8');
    const title = /^##\s+242\.\s+(.+)$/m.exec(handoff)?.[1];
    expect(title, 'HANDOFF.md still carries entry 242').toBeTruthy();

    /**
     * The reported id is the document's, `242`, and the helper says on stderr
     * that it kept it. Reporting rather than overwriting is the whole point: a
     * second id for one title would file the entry as new work on the board.
     */
    const stdout = execFileSync(process.execPath, [script, title], { cwd: root, encoding: 'utf8' }).trim();
    expect(stdout).toBe('242');
  });
});
