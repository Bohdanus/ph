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

/**
 * A bare number in a per-test budget is the one constant that is free to write and
 * expensive to read: `test.setTimeout(90_000)` says nothing about what the 90 seconds is
 * paying for, so the budget cannot be judged against the work, and there was no way to
 * find the 52 of them other than grepping for three literals. They are named now, in
 * `../timeouts.ts`, and this test is what keeps the next one from being written inline.
 */
const INLINE_TIMEOUT =
  /test\.setTimeout\(\s*[\d_]+\s*\)|test\.describe\.configure\(\s*\{\s*timeout:\s*[\d_]+\s*\}\s*\)/g;

describe('per-test timeouts are named, not inlined', () => {
  const offenders = specFiles(E2E_DIR).filter((file) => INLINE_TIMEOUT.test(readFileSync(file, 'utf8')));

  it('no spec passes a bare numeric literal to a per-test budget', () => {
    // The file list rather than a count: a count is wrong the moment a spec is added,
    // and it would say nothing about which file to look in.
    expect(offenders.map((file) => file.slice(E2E_DIR.length))).toEqual([]);
  });

  it('still exports the budgets the specs import', () => {
    // The scan above passes trivially on an empty suite, and a renamed constant would
    // break the specs at compile time rather than here — so this asserts the two
    // most-used names resolve to the values the suite was passing inline before.
    expect(DEFAULT_TEST_TIMEOUT_MS).toBe(60_000);
    expect(PAINT_TOOLS_TEST_TIMEOUT_MS).toBe(120_000);
  });
});
