import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DEFAULT_TEST_TIMEOUT_MS, PAINT_TOOLS_TEST_TIMEOUT_MS } from '../timeouts';

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

const specSources = new Map(specFiles(E2E_DIR).map((file) => [file.slice(E2E_DIR.length), readFileSync(file, 'utf8')]));

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
