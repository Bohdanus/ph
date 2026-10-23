import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { execFileSync } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

/**
 * This file's budget, and the reason it is not Vitest's default 5s.
 *
 * It spawns exactly one process: `git ls-files '*.md'`, once, when the describe body
 * evaluates. That is roughly 30ms against a 5s default — about 0.6% — so the default
 * is not actually the binding constraint and no slow-machine escape hatch is needed.
 * The declaration exists because `suite-budgets.test.mjs` derives the set of suites that
 * spawn a process and refuses to let one of them arrive without a budget, and a guard
 * that can be satisfied by writing a number is a guard nobody reads. It is set to the
 * 15s floor rather than to something tighter because a tighter budget here would be a
 * threshold pretending to be a measurement.
 */
vi.setConfig({ testTimeout: 15_000 });

/**
 * `docs/README.md` is the index — the one place a reader can find out which document owns
 * which fact. An index that omits a document is not a stale index, it is a document with no
 * owner: `docs/TOOLS-INVENTORY.md` grew to 340 lines while the index still claimed to list
 * "every tracked document in this repository", and nothing noticed, because nothing reads
 * the index against the tree.
 *
 * This is the check that would have caught it, and it is deliberately mechanical. A prose
 * assertion about coverage is not what fails here — the index is a table of names, so the
 * test is a set comparison between tracked markdown and the names the index prints.
 *
 * The allow-list below is the interesting part. A tracked markdown file has exactly three
 * legitimate states: the index names it, the index explicitly excludes it as not maintained,
 * or it is absent. The third is a defect. Anything added to the allow-list needs a reason
 * recorded next to it, because an allow-list entry with no reason is the same unfalsifiable
 * flag `agents-citations.test.mjs` keeps its escape hatch empty to avoid.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const INDEX_PATH = 'docs/README.md';

/**
 * Files the index deliberately does not list one by one, and why. Keep this list short and
 * keep each reason specific to that file — "it is old" is not a reason, it is a category.
 */
const ALLOWED_UNLISTED = new Map([
  [
    'docs/handoffs/ps-transform-geometry-review-and-merge.md',
    'covered by the docs/handoffs/ directory row, which states the ' +
      '<branch>-<topic>.md naming convention. One row per merged branch would make the ' +
      'index unbounded, and the set grows by exactly one line in HANDOFF.md at a time.',
  ],
  [
    '.kilo/plans/test-hardening-plan.md',
    'internal hardening plan tracked in .kilo/plans/; not a public document and not ' +
      'linked from docs/README.md. The .kilo/plans/ directory row covers the directory as a whole.',
  ],
  [
    'docs/FREE-COMPUTE.md',
    'broad dated research library, intentionally not linked from routine agent entry points ' +
      '(AGENTS.md, README.md, MODELS.md does not link it either) so it does not pollute ' +
      'orchestrator context. MODELS.md is the canonical daily policy; this file is a lookup ' +
      'reference for provider terms, quotas, and failure observations.',
  ],
]);

const trackedMarkdown = () =>
  execFileSync('git', ['ls-files', '*.md'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((path) => path.replace(/\\/g, '/'));

const readIndex = () => readFileSync(resolve(REPO_ROOT, INDEX_PATH), 'utf8');

/**
 * How the index refers to a given tracked path.
 *
 * The index mixes two spellings — `docs/`-relative for its own directory and `../`-relative
 * for anything above it — and both are legitimate. A bare basename also counts, but ONLY
 * inside the not-maintained table, which prints filenames with no path because its rows are
 * prose about documents nobody should follow links to.
 *
 * Basename matching is deliberately not allowed anywhere else. Four tracked files are called
 * `README.md`, so a global basename match reports the index as covering all of them the
 * moment it names one — which is how an allow-list entry can outlive the condition that
 * created it without anything failing.
 */
const mentions = (index, repoRelativePath) => {
  const basename = repoRelativePath.slice(repoRelativePath.lastIndexOf('/') + 1);
  const fromDocsDir = repoRelativePath.startsWith('docs/')
    ? repoRelativePath.slice('docs/'.length)
    : `../${repoRelativePath}`;
  if ([repoRelativePath, fromDocsDir].some((spelling) => index.includes(spelling))) return true;

  const table = index.slice(index.indexOf('## Not maintained here'));
  return table.length > 0 && table.includes(basename);
};

describe('the documentation index accounts for every tracked markdown file', () => {
  const index = readIndex();
  const unlisted = trackedMarkdown().filter((path) => !mentions(index, path));

  it('has an index to check', () => {
    expect(index).toContain('# Documents');
  });

  it('names every tracked markdown file, or excludes it on purpose', () => {
    const unexpected = unlisted.filter((path) => !ALLOWED_UNLISTED.has(path));
    expect(
      unexpected,
      `docs/README.md does not account for ${unexpected.length} tracked markdown file(s). ` +
        'Add a row with its one job, or an ALLOWED_UNLISTED entry in ' +
        'scripts/__tests__/docs-index.test.mjs with the reason that file is exempt.'
    ).toEqual([]);
  });

  it('carries no allow-list entry for a file that is in fact indexed', () => {
    // An allow-list entry outlives the condition that created it, and then it silently
    // stops testing anything — the file gets a row, the entry stays, and the next author
    // trusts a check that no longer runs.
    const stale = [...ALLOWED_UNLISTED.keys()].filter((path) => !unlisted.includes(path));
    expect(stale, 'ALLOWED_UNLISTED holds paths the index now names').toEqual([]);
  });

  it('has a reason on every allow-list entry', () => {
    const unreasoned = [...ALLOWED_UNLISTED].filter(([, reason]) => !reason.trim()).map(([p]) => p);
    expect(unreasoned).toEqual([]);
  });
});

/**
 * `docs/README.md` is an index, and `docs/DOCUMENTATION.md` says so: "The index is not a
 * home. README.md names documents; it does not carry their content." The index grew a
 * ten-line restatement of the precedence ladder anyway, which is harmless once and becomes
 * a second, drifting copy of the rule the second time anyone edits it.
 *
 * This is checked as a heading rather than a phrase list, because the failure mode is the
 * section reappearing under a different title. It also catches the heading being renamed
 * rather than removed, which is how it usually comes back.
 */
describe('the index names the rule instead of restating it', () => {
  it('carries no section of its own on the precedence ladder', () => {
    const headings = [...readIndex().matchAll(/^#{2,3}[ \t]+(.+)$/gm)].map((m) => m[1].trim());
    const restatements = headings.filter((heading) =>
      /ladder|precedence|what photoshop does|source of truth/i.test(heading)
    );
    expect(restatements, 'docs/DOCUMENTATION.md owns the ladder. Point at it; do not carry a section here.').toEqual(
      []
    );
  });
});

/**
 * `docs/TOOLS.md` is generated, and `tool-descriptions.test.mjs` enforces byte equality, so
 * it is already protected. The other frozen paths in `docs/README.md` are not: moving any of
 * the three handoff documents breaks `SCOPE_BY_FILE`, which is a data file, and moving
 * `docs/TOOLS.md` breaks a hardcoded path plus that byte-equality test.
 *
 * A data-file lookup key is invisible from the file it names, which is what makes this
 * worth asserting.
 */
describe('the frozen documentation paths stay where they are', () => {
  const HANDOFF_REGISTRY = 'scripts/lib/agent-board/handoff-import.mjs';
  const GENERATOR = 'scripts/generate-tool-docs.mjs';

  const registryKeys = () => {
    const source = readFileSync(resolve(REPO_ROOT, HANDOFF_REGISTRY), 'utf8');
    const block = source.match(/SCOPE_BY_FILE\s*=\s*\{([^}]*)\}/s);
    if (!block) throw new Error(`SCOPE_BY_FILE not found in ${HANDOFF_REGISTRY}`);
    return [...block[1].matchAll(/'([^']+\.md)'/g)].map((m) => m[1]);
  };

  it('keeps the three handoff documents at the paths the board routes on', () => {
    expect(registryKeys().sort()).toEqual(['HANDOFF.md', 'TEST-FLAKES.md', 'e2e/OPEN_PROBLEMS.md']);
    for (const path of registryKeys()) {
      expect(
        () => readFileSync(resolve(REPO_ROOT, path)),
        `${path} is a SCOPE_BY_FILE key in ${HANDOFF_REGISTRY} but is not on disk`
      ).not.toThrow();
    }
  });

  it('keeps the generated tool doc at the path the generator writes', () => {
    const source = readFileSync(resolve(REPO_ROOT, GENERATOR), 'utf8');
    expect(source).toContain("'docs/TOOLS.md'");
    expect(() => readFileSync(resolve(REPO_ROOT, 'docs/TOOLS.md'))).not.toThrow();
  });
});

/**
 * The not-maintained table exists so that a reader who stumbles on a stale point-in-time
 * report learns it is stale. If the table's own wording drifts, it stops doing that — and it
 * is the one place in the index where prose carries the whole job, since there are no links
 * to follow.
 */
describe('the not-maintained table still says what its rows are', () => {
  it('states that the files below it are not current', () => {
    const index = readIndex();
    const heading = index.indexOf('## Not maintained here');
    expect(heading, 'the not-maintained section is missing from the index').toBeGreaterThan(-1);
    const section = index.slice(heading);
    // Matched against the prose with whitespace collapsed: Prettier rewraps these paragraphs,
    // so an emphasis run split across a line break is the normal state of this text, not an
    // accident. A regex that only accepts the unwrapped spelling fails on a reformat.
    const prose = section.replace(/\s+/g, ' ');
    // The emphasis wraps BOTH words, so the opening `**` precedes `not`. Matching
    // `not **current**` instead reads a state this text is not in.
    expect(prose).toMatch(/\*\*not\s+current\*\*/i);
    expect(prose).toMatch(/point-in-time/i);
  });
});

/**
 * Guards the readdirSync import above from being dropped, which would otherwise be a silent
 * no-op failure mode only reachable by deleting a line nobody is looking at.
 */
describe('this file can still see the tree', () => {
  it('reads a directory it needs', () => {
    expect(readdirSync(resolve(REPO_ROOT, 'docs')).length).toBeGreaterThan(0);
  });
});
