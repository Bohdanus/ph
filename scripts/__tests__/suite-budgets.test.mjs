/**
 * The three `scripts/` suites declare a per-file `testTimeout`, and this is the
 * tripwire that says so.
 *
 * ## Why this needs a test at all
 *
 * Those suites drive the real board CLI. What a test costs in them is process
 * spawn count, not computation, and a cold board call is ~60-80ms from a shell.
 * Vitest's 5s default is therefore not a budget those files can live inside: the
 * slowest measured span in `e2e-run.test.mjs` was 7.1s across three isolated runs
 * on this machine, and the slowest in `agent-board.test.mjs` was 4.5s. A budget
 * at or below the work it is timing produced five failures in `npm run test` with
 * no code change anywhere, and every one of them was a red that had to be
 * explained before anything else could be trusted.
 *
 * The fix is one `vi.setConfig({ testTimeout })` per file. That is a NUMBER, and a
 * number in a test file is exactly the kind of thing that gets tidied away by a
 * later reader who has no way to see what it is holding open — "that looks large"
 * is a good enough reason to lower a timeout, and lowering it puts the five
 * failures straight back. So the value is pinned here, where the reason for it is
 * also written down.
 *
 * ## Why it reads the SOURCE and not an import
 *
 * The budget is a `vi.setConfig` side effect. Nothing exports it, so an import
 * cannot see it, and a test that imported the suites for their values would see
 * only the default — which is the thing being guarded. This reads the text, the
 * same way the sibling `declares no key twice` guard reads `curated.mjs` for a
 * duplicate key that only exists in the source: a JS object literal is last-wins,
 * so the duplicate is invisible to `Object.keys()`, and a test that cannot see the
 * file reports green on it.
 *
 * The floor is deliberately expressed as a multiple of Vitest's own default
 * rather than as an absolute. An absolute millisecond count in a guard is a
 * figure that goes stale the moment a test gets slower for a good reason; a
 * multiple survives that, and it is the property that actually matters — that
 * these files are not back inside the default.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Built from `import.meta.dirname`, never from `import.meta.url`: Vitest gives this
 * module an `http://localhost/…` URL whose `pathname` does not exist on disk. The
 * sibling suites carry the same note, and the failure mode is a read that throws
 * for a reason unrelated to the thing under test.
 */
const HERE = import.meta.dirname;

/**
 * Vitest's default `testTimeout`, pinned because it cannot be read.
 *
 * `configDefaults` from `vitest/config` is the obvious source and it does not carry
 * the key: in the installed version `configDefaults.testTimeout` is `undefined`
 * (the object publishes `teardownTimeout` and `slowTestThreshold`, not this), so
 * importing it yields `NaN` and every comparison below passes vacuously. That is
 * not a hypothetical — it is what the first run of this file did, and the only
 * reason it showed up as a red rather than a green is that the assertions compare
 * against `DEFAULT_TIMEOUT * MINIMUM_FACTOR` rather than against nothing.
 *
 * To re-derive it after a major bump, do not read it from the source: put a
 * deliberately tiny `vi.setConfig({ testTimeout: 1 })` in one of the three suites,
 * run a test in it, and take the millisecond count out of the reported
 * "Test timed out in Nms". Then put the real value back.
 */
const DEFAULT_TIMEOUT = 5000;

/**
 * The floor is a multiple of the default, not an absolute count: see the header.
 * Three is chosen because it is the smallest multiple that leaves room for a
 * machine meaningfully slower than the one these numbers were measured on, while
 * still being tight enough that a reader restoring the default notices.
 */
const MINIMUM_FACTOR = 3;

const BUDGETED = ['agent-board.test.mjs', 'e2e-run.test.mjs', 'worktree-inventory.test.mjs'];

/**
 * The declared budget, or null when the file does not declare one.
 *
 * Fails CLOSED on a line it cannot positively recognise, for the reason the
 * curated-key reader does: a reader that skips what it does not understand reports
 * green on a file it could not read, which is the one outcome this guard exists to
 * prevent. So an unrecognised `testTimeout` line is reported as no budget, and the
 * test below fails.
 */
function readDeclaredBudget(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const matches = [...withoutComments.matchAll(/vi\.setConfig\(\{\s*testTimeout:\s*([0-9_]+)\s*\}\)/g)];
  if (matches.length > 1) {
    return { error: `declares testTimeout ${matches.length} times, so which one applies is ambiguous` };
  }
  if (matches.length === 0) return null;
  return { ms: Number(matches[0][1].replace(/_/g, '')) };
}

describe('the scripts suites declare a budget their own work fits inside', () => {
  it('names every suite that spawns the board CLI', () => {
    // If a fourth spawn-heavy suite is added and left on the default, this list is
    // where it has to be added. It is asserted rather than discovered so that
    // adding a suite is a decision instead of an omission.
    expect(BUDGETED, 'every file in scripts/__tests__/ that drives a real process').toEqual(
      expect.arrayContaining(['agent-board.test.mjs', 'e2e-run.test.mjs', 'worktree-inventory.test.mjs'])
    );
  });

  for (const file of BUDGETED) {
    it(`${file} declares a budget at least ${MINIMUM_FACTOR}x Vitest's default`, () => {
      const source = readFileSync(join(HERE, file), 'utf8');
      const declared = readDeclaredBudget(source);

      expect(declared?.error, declared?.error ?? '').toBeUndefined();
      expect(
        declared,
        `${file} declares no vi.setConfig({ testTimeout }), so it runs on Vitest's ` +
          `${DEFAULT_TIMEOUT}ms default — which is at or below the span this file's own slowest ` +
          'test has been measured at. That is what produced five failures in npm run test with no ' +
          'code change. Add the budget, and the reason for it, in the same place.'
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
    const source = readFileSync(join(HERE, 'worktree-inventory.test.mjs'), 'utf8');
    const overrides = [...source.matchAll(/\},\s*([0-9_]+)\s*\);/g)].map((m) => Number(m[1].replace(/_/g, '')));

    expect(overrides.length, 'worktree-inventory.test.mjs kept its per-test declarations').toBeGreaterThan(0);
    for (const ms of overrides) {
      expect(ms, 'a per-test declaration must not be silently lowered under the file budget').toBeGreaterThan(
        DEFAULT_TIMEOUT * MINIMUM_FACTOR
      );
    }
  });
});

/**
 * The reader itself, on inputs nobody has to go and edit a tracked file to produce.
 *
 * These exist because the fail-closed property is otherwise untestable. The checks
 * above use `readDeclaredBudget` to decide whether a file has a budget, so a reader
 * that FABRICATED one — returning a plausible number where it found nothing — makes
 * every one of them pass. That mutation was injected and the suite stayed green:
 * the guard was reporting on the reader rather than on the files. Asserting the
 * reader directly is the only place the property can actually be pinned, because
 * here the expected value is written down rather than derived from the reader.
 */
describe('the budget reader fails closed', () => {
  it('reports no budget for a file that declares none, rather than a plausible one', () => {
    expect(readDeclaredBudget("import { it } from 'vitest';\nit('x', () => {});\n")).toBeNull();
  });

  it('does not read a testTimeout it did not recognise', () => {
    // A rename, a different call shape, or a value built at runtime. Returning null
    // here is what makes the guard say "this file has no budget" instead of guessing.
    expect(readDeclaredBudget('vi.setConfig({ testTimeout: someComputedValue });')).toBeNull();
    expect(readDeclaredBudget('setConfig({ testTimeout: 30_000 });')).toBeNull();
  });

  it('refuses a file that declares two budgets, because which one applies is ambiguous', () => {
    const two = 'vi.setConfig({ testTimeout: 30_000 });\nvi.setConfig({ testTimeout: 60_000 });';
    expect(readDeclaredBudget(two)?.error ?? 'no error reported').toMatch(/2 times/);
  });

  it('reads a real declaration, and ignores the same text inside a comment', () => {
    expect(readDeclaredBudget('vi.setConfig({ testTimeout: 30_000 });')).toEqual({ ms: 30_000 });
    // The budget's own justifying comment quotes the call. A reader that scanned the
    // raw text would find the quoted copy as well as the live one and report the
    // file as declaring two budgets — which is why the comment strips them first.
    const withComment = [
      '/**',
      ' * Set this with vi.setConfig({ testTimeout: 99_000 }) and the suite is fine.',
      ' */',
      'vi.setConfig({ testTimeout: 30_000 });',
    ].join('\n');
    expect(readDeclaredBudget(withComment)).toEqual({ ms: 30_000 });
  });
});
