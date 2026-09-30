/**
 * The spawn-heavy `scripts/` suites declare a per-file `testTimeout`, and this is the
 * tripwire that says so.
 *
 * ## Why this needs a test at all
 *
 * Those suites drive real processes — the board CLI, `git`, the TypeScript compiler — so
 * what a test costs in them is spawn count, not computation, and a cold board call is
 * ~60-80ms from a shell. Vitest's 5s default is therefore not a budget those files can
 * live inside. A budget at or below the work it is timing produced failures in
 * `npm run test` with no code change anywhere, and every one of them was a red that had
 * to be explained before anything else could be trusted.
 *
 * The fix is one `vi.setConfig({ testTimeout })` per file. That is a NUMBER, and a
 * number in a test file is exactly the kind of thing that gets tidied away by a later
 * reader who has no way to see what it is holding open — "that looks large" is a good
 * enough reason to lower a timeout, and lowering it puts the failures straight back. So
 * the value is pinned here, where the reason for it is also written down.
 *
 * ## Why it reads the SOURCE and not an import
 *
 * The budget is a `vi.setConfig` side effect. Nothing exports it, so an import cannot
 * see it, and a test that imported the suites for their values would see only the
 * default — which is the thing being guarded. This reads the text, the same way the
 * sibling `declares no key twice` guard reads `curated.mjs` for a duplicate key that
 * only exists in the source: a JS object literal is last-wins, so the duplicate is
 * invisible to `Object.keys()`, and a test that cannot see the file reports green on
 * it.
 *
 * ## Why the set of budgeted files is DERIVED, not listed
 *
 * The first version of this file held a hard-coded list and "asserted" it contained the
 * same three names the loop below it was already iterating. That test could not fail:
 * it compared a literal with itself, and it had no knowledge of which other files
 * existed. So when `tsc-guard.test.mjs` — which spawns the real `tsc` binary and has a
 * 2.2s test against a 5s budget — was missed, the guard had nothing to say about it.
 * `AGENTS.md` puts the same point as a rule: "A test that reads a _list_ rather than a
 * derivation cannot be shown to bite at all this way — that is a reason to derive the
 * set." So the set now comes from the directory.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Built from `import.meta.dirname`, never from `import.meta.url`: Vitest gives this
 * module an `http://localhost/…` URL whose `pathname` does not exist on disk. The
 * sibling suites carry the same note, and the failure mode is a read that throws for a
 * reason unrelated to the thing under test.
 */
const HERE = import.meta.dirname;

/**
 * Vitest's default `testTimeout`, pinned because it cannot be read.
 *
 * `configDefaults` from `vitest/config` is the obvious source and it does not carry the
 * key: in the installed version `configDefaults.testTimeout` is `undefined` (the object
 * publishes `teardownTimeout` and `slowTestThreshold`, not this), so importing it yields
 * `NaN` and every comparison below passes vacuously. That is not a hypothetical — it is
 * what the first run of this file did, and the only reason it showed up as a red rather
 * than a green is that the assertions compare against `DEFAULT_TIMEOUT * MINIMUM_FACTOR`
 * rather than against nothing.
 *
 * To re-derive it after a major bump, do not read it from the source: put a deliberately
 * tiny `vi.setConfig({ testTimeout: 1 })` in one of the suites, run a test in it, and
 * take the millisecond count out of the reported "Test timed out in Nms". Then put the
 * real value back.
 */
const DEFAULT_TIMEOUT = 5000;

/**
 * The floor is a multiple of the default, not an absolute count: see the header. Three
 * is the smallest multiple that leaves room for a machine meaningfully slower than the
 * one these numbers were measured on, while still being tight enough that a reader
 * restoring the default notices.
 */
const MINIMUM_FACTOR = 3;

/** The suites this guard knows about, kept so the derived set has something to equal. */
const BUDGETED = [
  'agent-board.test.mjs',
  'e2e-run.test.mjs',
  'main-worktree-guard.test.mjs',
  'tsc-guard.test.mjs',
  'worktree-inventory.test.mjs',
];

/**
 * What makes a suite here cost spawns rather than computation. Deliberately broad: the
 * point is to make an unbudgeted spawner impossible to add quietly, and a new suite that
 * spawns something cheap can carry a budget nobody minds.
 */
const SPAWNS_A_PROCESS = /\b(?:spawnSync|execFileSync|spawn|execFile)\s*\(/;

/**
 * Every suite in this directory that spawns a process, derived rather than declared.
 *
 * This file is excluded by name and not by the pattern: it reads files and would be the
 * one suite here whose cost is I/O rather than spawning, so leaving it in the pattern
 * would make it demand a budget of itself.
 */
function derivesSpawningSuites(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.test.mjs') && name !== 'suite-budgets.test.mjs')
    .filter((name) => SPAWNS_A_PROCESS.test(readFileSync(join(dir, name), 'utf8')))
    .sort();
}

/**
 * The declared budget, or null when the file has none this reader can see.
 *
 * MATCHES A WHOLE LINE, and that is the whole design. An earlier version stripped
 * comments and then matched the call anywhere in what was left, which failed in the
 * direction that matters: a trailing `//` comment, a string literal or a template
 * literal containing the text all read as a budget nobody had set, and a `/*` inside a
 * string ate the real declaration between it and the next `*/ `. Every one of those was
 * measured, not imagined. A real declaration is a statement on a line of its own, so
 * anchoring to the start and end of a line removes the false positives AND lets the
 * lossy comment-strippers go, which is how the `; /*` hazard disappeared.
 *
 * Fails CLOSED for the same reason the curated-key reader does: a reader that skips what
 * it does not understand reports green on a file it could not read, which is the one
 * outcome this guard exists to prevent. A shape it cannot recognise is reported as no
 * budget, and the test below fails with a message saying so.
 */
function readDeclaredBudget(source) {
  const matches = [...source.matchAll(/^[ \t]*vi\.setConfig\(\{\s*testTimeout:\s*([0-9_]+)\s*\}\)\s*;?[ \t]*$/gm)];
  if (matches.length > 1) {
    return { error: `declares testTimeout ${matches.length} times, so which one applies is ambiguous` };
  }
  if (matches.length === 0) return null;
  return { ms: Number(matches[0][1].replace(/_/g, '')) };
}

/** The shape a declaration has to have for this reader to see it. */
const REQUIRED_SHAPE = 'a line of its own reading exactly `vi.setConfig({ testTimeout: <digits> });`';

describe('the scripts suites declare a budget their own work fits inside', () => {
  it('knows about every suite here that spawns a process', () => {
    // DERIVED, so this is the test that makes a new spawner impossible to add quietly.
    // A hard-coded list compared against itself is what let `tsc-guard.test.mjs` be
    // missed: it spawns the real `tsc` binary and has a 2.2s test against a 5s budget.
    const spawning = derivesSpawningSuites(HERE);
    expect(
      spawning.filter((name) => !BUDGETED.includes(name)),
      `these suites spawn a process and so are bounded by spawn cost rather than by anything ` +
        `being computed, but none is listed in BUDGETED above: ${spawning
          .filter((name) => !BUDGETED.includes(name))
          .join(', ')}. Add it there and give it a budget, or change what it spawns.`
    ).toEqual([]);
    // And the list must not name a file that is gone, which would make the loop below
    // assert on a read that throws for an unrelated reason.
    expect(
      BUDGETED.filter((name) => !spawning.includes(name)),
      'BUDGETED names a suite that no longer spawns a process, so it would be asserting a budget nothing needs'
    ).toEqual([]);
  });

  for (const file of BUDGETED) {
    it(`${file} declares a budget at least ${MINIMUM_FACTOR}x Vitest's default`, () => {
      const source = readFileSync(join(HERE, file), 'utf8');
      const declared = readDeclaredBudget(source);

      expect(declared?.error, declared?.error ?? '').toBeUndefined();
      expect(
        declared,
        `${file} has no vi.setConfig({ testTimeout }) this guard can read. Either it has none, or the ` +
          `declaration is not ${REQUIRED_SHAPE}. Either way the file runs on Vitest's ` +
          `${DEFAULT_TIMEOUT}ms default, which is at or below the span its own slowest test has been ` +
          'measured at — and that is what put failures in npm run test with no code change.'
      ).not.toBeNull();

      expect(
        declared.ms,
        `${file} declares a ${declared.ms}ms budget, which is under ${MINIMUM_FACTOR}x Vitest's ` +
          `${DEFAULT_TIMEOUT}ms default. Either the work got cheaper — in which case re-measure it ` +
          'and say so in the comment — or the budget is back to being a coin flip.'
      ).toBeGreaterThanOrEqual(DEFAULT_TIMEOUT * MINIMUM_FACTOR);
    });
  }

  it('still lets a per-test argument override the file budget, so an expensive test can declare its own', () => {
    // The file budget is a floor for the ordinary case, not a ceiling. Two tests in
    // `worktree-inventory.test.mjs` read git in every worktree in the repository and
    // measure 21.5s, and they declare `60_000` individually; if the file budget ever
    // became a hard cap, those two would start failing in a way that looks like a
    // worktree-count problem.
    //
    // Checked across every budgeted suite, not just the one the two declarations happen
    // to live in: the first version looked at `worktree-inventory.test.mjs` alone, so a
    // low per-test override anywhere else would have gone unnoticed, which is the same
    // mistake as the hard-coded list above pointed at a different file.
    const overrides = BUDGETED.flatMap((file) =>
      [...readFileSync(join(HERE, file), 'utf8').matchAll(/\},\s*([0-9_]+)\s*\);/g)].map((m) => ({
        file,
        ms: Number(m[1].replace(/_/g, '')),
      }))
    );

    expect(overrides.length, 'the suites kept their per-test declarations').toBeGreaterThan(0);
    for (const { file, ms } of overrides) {
      expect(
        ms,
        `${file} carries a per-test ${ms}ms declaration, which is under ${MINIMUM_FACTOR}x Vitest's ` +
          `${DEFAULT_TIMEOUT}ms default. A per-test argument WINS over the file budget, so this one is ` +
          'what actually applies to that test.'
      ).toBeGreaterThanOrEqual(DEFAULT_TIMEOUT * MINIMUM_FACTOR);
    }
  });
});

/**
 * The reader itself, on inputs nobody has to go and edit a tracked file to produce.
 *
 * These exist because the fail-closed property is otherwise untestable. The checks above
 * use `readDeclaredBudget` to decide whether a file has a budget, so a reader that
 * FABRICATED one — returning a plausible number where it found nothing — makes every one
 * of them pass. That mutation was injected and the suite stayed green: the guard was
 * reporting on the reader rather than on the files. Asserting the reader directly is the
 * only place the property can be pinned, because here the expected value is written down
 * rather than derived from the reader.
 */
describe('the budget reader fails closed', () => {
  it('reports no budget for a file that declares none, rather than a plausible one', () => {
    expect(readDeclaredBudget("import { it } from 'vitest';\nit('x', () => {});\n")).toBeNull();
  });

  it('does not read a testTimeout it did not recognise', () => {
    // A rename, a different call shape, or a value built at runtime. Returning null here
    // is what makes the guard say "no readable budget" instead of guessing.
    expect(readDeclaredBudget('vi.setConfig({ testTimeout: someComputedValue });')).toBeNull();
    expect(readDeclaredBudget('setConfig({ testTimeout: 30_000 });')).toBeNull();
    expect(readDeclaredBudget('vi.setConfig({ testTimeout: 20_000, hookTimeout: 9_000 });')).toBeNull();
    expect(readDeclaredBudget('vi.setConfig({\n  testTimeout: 20_000,\n});')).toBeNull();
  });

  it('refuses a file that declares two budgets, because which one applies is ambiguous', () => {
    const two = 'vi.setConfig({ testTimeout: 30_000 });\nvi.setConfig({ testTimeout: 60_000 });';
    expect(readDeclaredBudget(two)?.error ?? 'no error reported').toMatch(/2 times/);
  });

  it('reads a real declaration, indented or not, semicolon or not', () => {
    expect(readDeclaredBudget('vi.setConfig({ testTimeout: 30_000 });')).toEqual({ ms: 30_000 });
    expect(readDeclaredBudget('  vi.setConfig({ testTimeout: 20_000 });')).toEqual({ ms: 20_000 });
    expect(readDeclaredBudget('vi.setConfig({ testTimeout: 15_000 })')).toEqual({ ms: 15_000 });
    expect(readDeclaredBudget('vi.setConfig({testTimeout: 25_000});')).toEqual({ ms: 25_000 });
  });

  it('is not fooled by the call appearing where no budget was set', () => {
    // Each of these read as a budget of 30_000 under the previous reader, which stripped
    // comments and then matched anywhere in what was left. A guard that can pass on a
    // file with no budget is worse than no guard, because it reports the five failures
    // as fixed.
    expect(readDeclaredBudget('const a = 1; // vi.setConfig({ testTimeout: 30_000 });')).toBeNull();
    expect(readDeclaredBudget("const s = 'vi.setConfig({ testTimeout: 30_000 });';")).toBeNull();
    expect(readDeclaredBudget('const s = `vi.setConfig({ testTimeout: 30_000 });`;')).toBeNull();
  });

  it('reads the live declaration even when a comment or a string carries /* and */', () => {
    // The lossy comment-stripper this reader no longer uses ate everything between a
    // `/*` in one string and a `*/` in another, taking a real declaration with it and
    // reporting a red for a file that was fine.
    const source = ['const s = "/*";', 'vi.setConfig({ testTimeout: 30_000 });', 'const t = "*/";', ''].join('\n');
    expect(readDeclaredBudget(source)).toEqual({ ms: 30_000 });
  });

  it('sees one declaration in a file that also explains itself in a JSDoc block', () => {
    // The budget's own justifying comment quotes the call. A reader that scanned raw text
    // would find the quoted copy as well as the live one and report the file as declaring
    // two budgets.
    const withComment = [
      '/**',
      ' * Set this with vi.setConfig({ testTimeout: 99_000 }) and the suite is fine.',
      ' */',
      'vi.setConfig({ testTimeout: 30_000 });',
    ].join('\n');
    expect(readDeclaredBudget(withComment)).toEqual({ ms: 30_000 });
  });
});
