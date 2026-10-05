import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  DEFAULT_TEST_TIMEOUT_MS,
  PAINT_TOOLS_TEST_TIMEOUT_MS,
  SEQUENTIAL_LAYER_TEST_TIMEOUT_MS,
  THIRD_PARTY_PAGE_TEST_TIMEOUT_MS,
} from '../timeouts';

const E2E_DIR = fileURLToPath(new URL('../../', import.meta.url));

/** Every Playwright spec under `e2e/`, at any depth. */
function specFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? specFiles(full) : full.endsWith('.spec.ts') ? [full] : [];
  });
}

/** The specs, named relative to `e2e/` so a failure says which file to open. */
function specNames(): string[] {
  return specFiles(E2E_DIR)
    .map((file) => file.slice(E2E_DIR.length))
    .sort();
}

/**
 * Every spec path, absolute — the single traversal both scans below are built from, so the
 * two of them cannot disagree about which files exist.
 */
const SPECS = specFiles(E2E_DIR);

const specSources = new Map(SPECS.map((file) => [file.slice(E2E_DIR.length), readFileSync(file, 'utf8')]));

/**
 * The same set, collected by a different traversal: one flat recursive `readdirSync`
 * instead of a hand-rolled recursion over `statSync`. An input that silently shrinks turns
 * the guard it feeds into a pass — a traversal that stopped descending would report no
 * offenders and the guard would be green for the rest of time. Two mechanisms have to
 * agree for this to pass, so neither one can rot alone.
 */
function specFilesIndependently(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.spec.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

/**
 * A bare number in a per-test budget is the one constant that is free to write and
 * expensive to read: `test.setTimeout(90_000)` says nothing about what the 90 seconds is
 * paying for, so the budget cannot be judged against the work, and there was no way to
 * find the 52 of them other than grepping for three literals. They are named now, in
 * `../timeouts.ts`, and this test is what keeps the next one from being written inline.
 *
 * No `g` flag, and that is load-bearing rather than incidental. `RegExp.prototype.test`
 * with `g` starts each call at `lastIndex` and resets it to 0 only on a MISS, so driving
 * it with `.test()` across a list of files makes the result depend on the byte offset of
 * the previous match: a file whose match ends before the previous offender's does is
 * never scanned at all, and `readdirSync` order is filesystem-dependent, so the same
 * tree passes on one machine and fails on another. With two agents re-introducing a
 * literal at the same time, exactly one offender would be caught. `.match()` on a
 * non-global regex has no such state.
 *
 * THE VALUE IS NOT SPELLED ONE WAY, and the first version of this pattern said it was.
 * `[\d_]+` matched `60_000` and nothing else, so three shapes of bare numeric literal
 * walked straight through a guard whose own comment claimed it failed on "a bare numeric
 * literal ... anywhere under `e2e/`". All three are in the corpus test below, with the
 * shape that defeats them named.
 */
const BARE_NUMBER = String.raw`\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?(?:\s+as\s+(?:const|number))?`;

/**
 * `test.setTimeout(<literal>)` — any spelling of the literal, and not only the whole
 * argument, since `test.setTimeout(60_000, 'for the third-party page load')` is the same
 * unnamed number with a comment attached.
 */
const INLINE_SET_TIMEOUT = String.raw`test\.setTimeout\(\s*${BARE_NUMBER}\s*[,)]`;

/**
 * `test.describe.configure({ timeout: <literal> })` where the timeout key is neither the
 * only key nor the last one. The old pattern required `}` immediately after the number,
 * so `test.describe.configure({ timeout: 60_000, mode: 'serial' })` passed — and that is
 * the exact shape Playwright's own documentation uses for serial mode, so it is the shape
 * the next person writing a budget would reach for.
 */
const INLINE_CONFIGURE_TIMEOUT = String.raw`test\.describe\.configure\(\s*\{[^}]*\btimeout\s*:\s*${BARE_NUMBER}\s*[,}]`;

const INLINE_TIMEOUT = new RegExp(`${INLINE_SET_TIMEOUT}|${INLINE_CONFIGURE_TIMEOUT}`);

/** Whether a file declares ANY per-test budget by name, or only literals. */
const HAS_NAMED_BUDGET =
  /test\.setTimeout\s*\(\s*[A-Z_]|test\.describe\.configure\s*\(\s*\{[^}]*\btimeout\s*:\s*[A-Z_]/;

/** Whether a file navigates the page from a before hook rather than from a test body. */
const NAVIGATES_FROM_BEFORE_HOOK = /test\.before(?:Each|All)\s*\(/;

const navigatesFromABeforeHook = (source: string): boolean =>
  NAVIGATES_FROM_BEFORE_HOOK.test(source) && /page\.goto\s*\(/.test(source);

/**
 * SPECS THAT NAVIGATE IN A BEFORE HOOK AND NAME NO PER-TEST BUDGET.
 *
 * The arm below is the blind spot the inline-literal guard cannot see. A file with NO budget
 * declares no literal either, so it is invisible to a guard that only bans literals — which is
 * exactly the shape that failed. `TEST-FLAKES.md` §13 records, for `sidebar-flyout.spec.ts`,
 * `Test timeout of 30000ms exceeded while running "beforeEach" hook, page.goto never
 * returning`, observed twice, with the assertions never executing. That file has one
 * `page.goto`, no `test.setTimeout`, and 25 declared tests, all of them paying Playwright's
 * bare 30s default for a navigation that runs before any of them.
 *
 * WHAT THIS LIST IS, precisely. It is every such spec in the tree today, DERIVED by scanning
 * `e2e/` rather than by guessing — `npm run test:e2e:unit` recomputes it from the files on
 * every run. It is NOT a claim that these specs provably do not need a budget; it is a claim
 * that `TEST-FLAKES.md` records no instance of the failure for them. Two of the fourteen are
 * separate for exactly that reason:
 *
 * - `sidebar-flyout.spec.ts` has the recorded 30s failure above. It is listed here rather
 *   than fixed because another agent owns that file, so the guard has to agree with the tree
 *   as it stands today. The fix belongs there, not here.
 * - `flyout-longpress-race.spec.ts` is recorded by `TEST-FLAKES.md`'s own file index
 *   (line 879) as a CPU-contention flake, which is a different mechanism from this one and
 *   is called out so the next reader does not read its entry here as the same finding. The
 *   index attributes it to §8, and §8's own title is "A third, NAMED observation — the
 *   paint-bucket contiguous test"; the attribution is the index's, and it disagrees with the
 *   section it names. That inconsistency is in `TEST-FLAKES.md`, not here, and correcting
 *   it is a change to a document this file does not own.
 *
 * The twelve others carry the same one-line reason: no recorded instance, so no named budget
 * yet. Adding a ninth reason without evidence would be inventing one.
 */
const UNBUDGETED_NAVIGATORS: readonly string[] = [
  'adjustments.spec.ts',
  'flyout-longpress-race.spec.ts',
  'levels.spec.ts',
  'mobile-shell.spec.ts',
  'paint-options.spec.ts',
  'paint-tool-pixels.spec.ts',
  'panel-workspace.spec.ts',
  'pen-types.spec.ts',
  'selection-gestures.spec.ts',
  'selection-tools.spec.ts',
  'sidebar-flyout.spec.ts',
  'sidebar-keyboard.spec.ts',
  'sidebar-layout.spec.ts',
  'single-row-column-marquee.spec.ts',
];

/** The one entry above that `TEST-FLAKES.md` §13 records losing on the bare default. */
const RECORDED_30S_TIMEOUT_OFFENDER = 'sidebar-flyout.spec.ts';

describe('per-test timeouts are named, not inlined', () => {
  const offenders = specNames().filter((name) => INLINE_TIMEOUT.test(specSources.get(name) ?? ''));

  it('no spec passes a bare numeric literal to a per-test budget', () => {
    // The file list rather than a count: a count is wrong the moment a spec is added,
    // and it would say nothing about which file to look in.
    expect(offenders).toEqual([]);
  });

  it('scans the whole spec set, not an empty one', () => {
    // Every arm below passes trivially on an empty file list, so the scan itself is pinned:
    // two files that are unambiguously in it, one of which carries a named budget and one of
    // which is the §13 offender. If `specFiles` ever stopped descending, these two fail and
    // every other assertion in this file starts lying.
    const scanned = specNames();

    expect(scanned).toContain('paint-tools.spec.ts');
    expect(scanned).toContain(RECORDED_30S_TIMEOUT_OFFENDER);
    expect(scanned.length).toBeGreaterThan(UNBUDGETED_NAVIGATORS.length);
  });

  it('still exports the budgets the specs import', () => {
    // The scan above passes trivially on an empty suite, and a renamed constant would
    // break the specs at compile time rather than here — so this asserts the two
    // most-used names resolve to the values the suite was passing inline before.
    expect(DEFAULT_TEST_TIMEOUT_MS).toBe(60_000);
    expect(PAINT_TOOLS_TEST_TIMEOUT_MS).toBe(120_000);
  });

  it('actually reads the specs, rather than passing on an empty scan', () => {
    // The scan above is green for an empty suite, a renamed extension and a traversal that
    // stopped descending, and every one of those is the guard being switched off rather
    // than satisfied. Two independent traversals have to agree, and the set has to be
    // non-empty.
    expect(SPECS.length).toBeGreaterThan(0);
    expect(SPECS.slice().sort()).toEqual(specFilesIndependently(E2E_DIR));
  });

  it('reaches the specs that spend a budget, so a widening there is visible', () => {
    // Named rather than counted, for the reason the repo applies elsewhere: a count rots
    // every time a spec is added. These three are the files whose budget is a named
    // constant, so they are also the files where "raise the timeout" is the tempting fix —
    // and the one place the guard can prove it is still looking at them.
    const names = SPECS.map((file) => file.slice(E2E_DIR.length));
    expect(names).toContain('layers.spec.ts');
    expect(names).toContain('paint-tools.spec.ts');
    expect(names).toContain(join('export', 'photopea.spec.ts'));
  });

  it('resolves every budget to the value the suite was passing inline before', () => {
    // A renamed constant breaks the specs at compile time rather than here, so this is the
    // only place the VALUES are pinned. Each one is the exact number the inline literals
    // used to be, and raising any of them is how a slow run gets laundered into a green
    // one: a budget that outlasts the work it pays for fails nothing, it just hides the
    // flake. `SEQUENTIAL_LAYER` and `THIRD_PARTY` were unpinned entirely before this.
    expect(DEFAULT_TEST_TIMEOUT_MS).toBe(60_000);
    expect(PAINT_TOOLS_TEST_TIMEOUT_MS).toBe(120_000);
    expect(SEQUENTIAL_LAYER_TEST_TIMEOUT_MS).toBe(90_000);
    expect(THIRD_PARTY_PAGE_TEST_TIMEOUT_MS).toBe(90_000);
  });

  it('orders the budgets so the longest is still below the two-minute mark', () => {
    // Not a threshold in place of a value: this is the relationship the comments on each
    // constant claim, and it is what makes the four numbers above readable as a policy
    // rather than as four independent choices. `THIRD_PARTY` and `SEQUENTIAL_LAYER`
    // sharing 90s is deliberate — they are not the same kind of test, so they do not get
    // one name — so the pair is asserted as equal rather than merely ordered.
    expect(DEFAULT_TEST_TIMEOUT_MS).toBeLessThan(SEQUENTIAL_LAYER_TEST_TIMEOUT_MS);
    expect(PAINT_TOOLS_TEST_TIMEOUT_MS).toBeGreaterThan(SEQUENTIAL_LAYER_TEST_TIMEOUT_MS);
    expect(SEQUENTIAL_LAYER_TEST_TIMEOUT_MS).toBe(THIRD_PARTY_PAGE_TEST_TIMEOUT_MS);
  });

  describe('the pattern the guard is built on', () => {
    // The guard is a regex over other people's files, so the regex is itself the piece with
    // no coverage. Each case below is a spec-shaped string that must be caught; a guard
    // whose pattern has drifted passes while the literal it exists to forbid is written.
    // The rows are the shapes a person actually types — whitespace inside the parens, a
    // sibling key, a trailing comma, a call nested inside a describe body — none of which
    // the tree happens to contain today.
    const CAUGHT: [string, string][] = [
      ['the original shape', 'test.setTimeout(90_000);'],
      ['no separators', 'test.setTimeout(90000);'],
      ['padded', 'test.setTimeout( 90_000 );'],
      ['a describe.configure with the timeout first', 'test.describe.configure({ timeout: 90_000 });'],
      ['a describe.configure with a sibling option first', 'test.describe.configure({ retries: 0, timeout: 90_000 });'],
      ['a describe.configure spread over lines', 'test.describe.configure({\n  retries: 0,\n  timeout: 90_000,\n});'],
      ['a trailing comma after the value', 'test.describe.configure({ timeout: 90_000, });'],
      ['a decimal budget', 'test.setTimeout(1.5);'],
      ['an exponent budget', 'test.setTimeout(1.5e5);'],
      ['inside a describe body', 'test("x", async () => {\n  test.setTimeout(90_000);\n});'],
    ];

    const ALLOWED: [string, string][] = [
      ['the named constant', 'test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);'],
      ['a named constant scaled', 'test.setTimeout(DEFAULT_TEST_TIMEOUT_MS * VIEWPORTS.length);'],
      ['a spec-local named budget', 'test.setTimeout(SAVE_DIALOG_TEST_TIMEOUT_MS);'],
      ['a configure with no timeout at all', 'test.describe.configure({ retries: 0 });'],
      ['a named configure timeout', 'test.describe.configure({ timeout: UNDO_REDO_TIMEOUT_MS });'],
      ['a helper named similarly', 'await setTimeoutForTest(90_000);'],
    ];

    it.each(CAUGHT)('catches %s', (_name, source) => {
      expect(INLINE_TIMEOUT.test(source)).toBe(true);
    });

    it.each(ALLOWED)('does not flag %s', (_name, source) => {
      // The false-positive half. A guard that also refused `DEFAULT_TEST_TIMEOUT_MS`
      // would be silenced by deleting it, which is the same weakening in the other
      // direction, and one that matched `setTimeoutForTest` would fail on every spec.
      expect(INLINE_TIMEOUT.test(source)).toBe(false);
    });

    it('flags a literal that only appears in a COMMENT, which is a false positive kept on purpose', () => {
      // The pattern is a raw text scan with no comment stripping, so
      // `// the old test.setTimeout(90_000) is gone` is reported as an offender. Every real
      // spec today passes only because none of them writes that sentence — the module
      // docstring in `../timeouts.ts` says it, and that file is not a spec.
      //
      // It is left as it is, and pinned, because the two ways to remove it are both
      // weakenings: stripping `//` to end-of-line truncates the rest of the line, so a
      // literal after a `'http://…'` string on the same line stops being scanned, and
      // skipping comment lines entirely is the same hole with more steps. A guard that
      // cries wolf over a comment is loud and harmless; a guard that misses a literal is
      // the outcome this whole file exists to prevent. So: a spec that explains a past
      // inline timeout has to rephrase, and the failure names the file.
      expect(INLINE_TIMEOUT.test('// the old test.setTimeout(90_000) is gone')).toBe(true);
      expect(INLINE_TIMEOUT.test('/** was test.describe.configure({ timeout: 90_000 }) */')).toBe(true);
    });
  });
});

/**
 * The corpus for the guard's own pattern, which it did not have.
 *
 * A guard that is only ever run against the current tree cannot tell a working pattern from
 * a broken one: the first version of `INLINE_TIMEOUT` matched `[\d_]+`, so every one of the
 * three `true` rows marked `defeats the old pattern` was a bare numeric literal walking
 * through a gate that claimed to stop all of them, and the suite was green throughout. Each
 * `false` row is a shape that must keep passing, so the widened arms cannot start matching
 * a named budget or an unrelated per-action `timeout:`.
 */
describe('the inline-literal pattern', () => {
  it.each([
    { source: 'test.setTimeout(60_000)', forbidden: 'the underscored form it was written for' },
    { source: 'test.setTimeout(60000)', forbidden: 'the plain form' },
    { source: 'test.setTimeout(6e4)', forbidden: 'exponent notation, which \\d[\\d_]* stopped at' },
    { source: 'test.setTimeout(90_000 as number)', forbidden: 'a TypeScript cast on a value in a TS codebase' },
    {
      source: 'test.setTimeout(60_000, "for the photopea page load")',
      forbidden: 'a literal that is not the only argument',
    },
    {
      source: "test.describe.configure({ timeout: 60_000, mode: 'serial' })",
      forbidden: "a second key after `timeout:` — Playwright's own serial-mode shape",
    },
    {
      source: "test.describe.configure({ mode: 'serial', timeout: 6e4 })",
      forbidden: 'a second key BEFORE `timeout:`',
    },
  ])('matches $source ($forbidden)', ({ source }) => {
    expect(INLINE_TIMEOUT.test(source)).toBe(true);
  });

  it.each([
    { source: 'test.setTimeout(DEFAULT_TEST_TIMEOUT_MS)', why: 'the point: a named budget' },
    { source: 'test.setTimeout(TIMEOUT_MS)', why: 'a named budget of any spelling' },
    { source: 'test.describe.configure({ timeout: DEFAULT_TEST_TIMEOUT_MS })', why: 'a named file-level budget' },
    { source: "test.describe.configure({ mode: 'serial' })", why: 'a configure call with no timeout in it' },
    { source: 'test.describe.configure({ timeout })', why: 'the shorthand, which has no colon to anchor on' },
    {
      source: 'await expect(canvas).toHaveScreenshot({ timeout: 5_000 })',
      why: 'a per-action timeout, a different thing',
    },
  ])('does not match $source ($why)', ({ source }) => {
    expect(INLINE_TIMEOUT.test(source)).toBe(false);
  });
});

/**
 * The second arm: a spec that navigates the page from a `beforeEach` and names no per-test
 * budget at all. See `UNBUDGETED_NAVIGATORS` for why this is a list and not a single name.
 */
describe('a before-hook navigation runs on some budget', () => {
  const unbudgeted = specNames().filter((name) => {
    const source = specSources.get(name) ?? '';
    return navigatesFromABeforeHook(source) && !HAS_NAMED_BUDGET.test(source);
  });

  it('no spec navigates in a before hook without being a recorded case', () => {
    // Not `toEqual([])`: this arm is green today by construction, because the recorded cases
    // cannot be fixed from this file — one of them belongs to another agent. What it forbids
    // is a NEW spec arriving in exactly the shape that produced a 30s `beforeEach` timeout.
    expect(unbudgeted.filter((name) => !UNBUDGETED_NAVIGATORS.includes(name))).toEqual([]);
  });

  it('records sidebar-flyout.spec.ts as the one with the observed 30s failure', () => {
    // Split out so the defect stays visible rather than being absorbed into a list of twelve
    // benign entries. When that file is given a named budget, this fails and the two lists
    // above must shrink with it — a fix cannot land without this test noticing.
    expect(unbudgeted).toContain(RECORDED_30S_TIMEOUT_OFFENDER);
  });

  it('names every unbudgeted before-hook navigator exactly once, and no more', () => {
    // The full-set equality. An addition fails here as well as above, so a new offender cannot
    // slip in by being added to the list without the list being the thing under review; and a
    // REMOVAL fails too, which is the signal that a listed spec has been fixed and its entry
    // should go with the fix rather than outlive it.
    expect([...unbudgeted].sort()).toEqual([...UNBUDGETED_NAVIGATORS].sort());
  });

  it('lists no spec twice', () => {
    expect(UNBUDGETED_NAVIGATORS.length).toBe(new Set(UNBUDGETED_NAVIGATORS).size);
  });
});
