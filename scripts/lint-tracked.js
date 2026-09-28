/**
 * Lints the files this repository owns, and nothing else.
 *
 * WHY NOT `eslint .` AND `prettier --check .`
 * -------------------------------------------
 * Those two take the *filesystem* as their scope. In this repository that
 * includes 121 worktrees under `.kilo/`, plus whatever a previous build, test
 * or e2e run left on disk. They were skipped only incidentally: `.gitignore:34`
 * lists `.kilo` and Prettier 3's default `--ignore-path` is
 * `[.gitignore, .prettierignore]`, so nothing had to say it. That is a
 * hand-maintained ignore list implied by a prettier default, and
 * `.prettierignore` existed for the same reason — seven of its eight entries
 * existed to stop `prettier --check .` reading generated output that
 * `npm run format` would then *rewrite*. It is a standing cost of a
 * filesystem-scoped command, and it is never finished.
 *
 * The scope here is `git ls-files`, so the answer is exactly the tracked set.
 * Generated output is gitignored and therefore absent. Worktrees are untracked
 * and therefore absent. A stray untracked file cannot fail a check it is not
 * part of, and `prettier --write` cannot clobber a file the repository does not
 * own. `.prettierignore` is gone for the same reason: nothing it listed is
 * tracked.
 *
 * WHAT IS DELIBERATELY NEVER LINTED
 * ---------------------------------
 * The two globs lists below are that rule, written down. `.prettierignore` and
 * the `ignores` block in `eslint.config.js` used to be where it lived, which is
 * why neither was complete.
 *
 * This is the same rule on both sides of the gate. `lint:check` walks every
 * tracked file of these types; `.husky/pre-commit` lints the staged subset of
 * exactly these types through lint-staged. Files outside them — the tracked
 * images, the one `.txt`, the dotfiles — are not linted, and that is intended,
 * not a gap.
 *
 * @example node scripts/lint-tracked.js                 check everything
 * @example node scripts/lint-tracked.js --write         prettier --write only
 * @example node scripts/lint-tracked.js --eslint-only   eslint only, cached
 * @example node scripts/lint-tracked.js --eslint-only --fix
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Files ESLint owns. No JS config covers `.js`, and none is wanted: see below. */
const ESLINT_GLOBS = ['*.ts', '*.tsx'];

/**
 * Files Prettier owns. A strict superset of ESLINT_GLOBS: `.md`, `.json`,
 * `.yml`, `.scss` and the config files are formatted but never linted, because
 * no ESLint config covers them and adding one breaks Markdown and SCSS commits.
 *
 * `*.html` is deliberately absent. `index.html` is tracked and hand-maintained,
 * but it carries a Google Tag Manager snippet pasted in by a human and by
 * whatever injects it later; Prettier rewrites that block, and its HTML
 * attribute style disagrees with the rest of the file. This is a named
 * exception with a reason, which is what `.prettierignore`'s `index.html` entry
 * was, minus the seven generated-output band-aids that sat beside it.
 */
const PRETTIER_GLOBS = [
  ...ESLINT_GLOBS,
  '*.js',
  '*.jsx',
  '*.mjs',
  '*.cjs',
  '*.scss',
  '*.css',
  '*.json',
  '*.jsonc',
  '*.md',
  '*.yml',
  '*.yaml',
];

/**
 * `git ls-files -z` so a path with a space or a glob metacharacter survives.
 *
 * The `existsSync` filter is load-bearing, not defensive noise. `git ls-files`
 * reads the index, and a file that has been deleted in the working tree but not
 * yet staged is still in the index — so it comes back here, and Prettier exits
 * non-zero on a path that does not exist, failing the check over a file nobody
 * has. A deleted file has no formatting.
 */
function tracked(globs) {
  const result = spawnSync('git', ['ls-files', '-z', '--', ...globs], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error('git ls-files failed; is this a git checkout?');
  }
  return result.stdout.split('\0').filter((file) => file !== '' && existsSync(file));
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status === 0 ? 0 : 1;
}

/**
 * Every tracked file is passed as an argument rather than piped. The tracked
 * set is a few hundred paths at around 90 characters each, which is a few tens
 * of KB of argv — well inside macOS `ARG_MAX` of 1 MB and Linux's 2 MB. If the
 * repository grows enough for that to stop being true, the fix is to chunk,
 * not to reach for xargs: xargs' argument limit is the thing being avoided
 * here.
 */
function main() {
  const flags = new Set(process.argv.slice(2));
  const eslintOnly = flags.has('--eslint-only');
  const prettierOnly = flags.has('--write');
  const cache = flags.has('--fix') || !prettierOnly ? ['--cache'] : [];

  // Both checks run even when the first one fails, so one invocation reports
  // every problem instead of making you re-run to find the second half.
  let failed = 0;

  if (!prettierOnly) {
    const files = tracked(ESLINT_GLOBS);
    if (files.length === 0) throw new Error('no tracked ESLint files; refusing to pass an empty list');
    failed |= run('eslint', [...cache, ...(flags.has('--fix') ? ['--fix'] : []), ...files]);
  }

  if (!eslintOnly) {
    const files = tracked(PRETTIER_GLOBS);
    if (files.length === 0) throw new Error('no tracked Prettier files; refusing to pass an empty list');
    failed |= run('prettier', [prettierOnly ? '--write' : '--check', ...files]);
  }

  process.exitCode = failed;
}

main();
