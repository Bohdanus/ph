/**
 * The gate pipeline is an artifact, and until now nothing tested it.
 *
 * WHAT WAS UNTESTED, SPECIFICALLY
 * -------------------------------
 * Three of the four git hooks have wiring assertions — `pre-merge-commit` in
 * `merge-takeover-guard-install.test.mjs`, `pre-commit` and `post-merge` in
 * `main-worktree-guard.test.mjs`. `pre-push` had NONE, and `pre-push` is the
 * hook that runs the entire test suite on every push. Dropping `'pre-push'` from
 * `HOOKS` in `scripts/install-git-hooks.js` would have left the file in `.husky/`
 * reading as protection while git ran nothing, and nothing in the repository
 * would have said so.
 *
 * And `.github/workflows/ci.yml` — the file that defines every remote gate, with
 * no local equivalent anywhere — was read by no test and no script. A deleted
 * job, a reintroduced `continue-on-error`, or a `npm run` naming a script that
 * no longer exists are all invisible to `npm run test`, because `npm run test` is
 * a different gate from the one that would catch them.
 *
 * WHY THE READS ARE TEXTUAL AND FAIL CLOSED
 * ------------------------------------------
 * There is no YAML parser in `dependencies` and adding one to test a file this
 * repository owns is not a trade worth making. So the readers here recognise a
 * specific shape and REPORT anything they do not recognise, rather than skipping
 * it: a reader that quietly skips what it cannot parse reports green on a file
 * it could not see, which is the exact failure this suite exists to prevent. Each
 * reader is exercised against injected text in the last describe block, so a
 * reader that starts ignoring what it used to catch is itself caught.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

/**
 * Mandatory for a suite that spawns: `scripts/__tests__/suite-budgets.test.mjs`
 * requires the declaration on a line of its own and requires this file to be
 * listed in its `BUDGETED` set, or the file runs on Vitest's 5000ms default.
 * This one spawns git once per test that asks for the hooks dir, so 20s is the
 * floor rather than a generous choice.
 */
vi.setConfig({ testTimeout: 20_000 });

const REPO_ROOT = realpathSync(join(import.meta.dirname, '..', '..'));
const HUSKY_DIR = join(REPO_ROOT, '.husky');
const WORKFLOWS_DIR = join(REPO_ROOT, '.github', 'workflows');
const CI_WORKFLOW = join(WORKFLOWS_DIR, 'ci.yml');
const INSTALL_HOOKS = join(REPO_ROOT, 'scripts', 'install-git-hooks.js');

/** `<git-common-dir>/hooks-gate`, which is what `core.hooksPath` points at. */
function hooksGateDir() {
  return realpathSync(
    execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  );
}

/**
 * Every hook this repository ships, DERIVED from the directory.
 *
 * Derived rather than listed, and that is the whole point of the first test
 * below: a hard-coded list compared against itself cannot fail, so a hook added
 * to `.husky/` and not wired would be invisible to a test that only checked the
 * names it already knew.
 */
/**
 * JS comments removed, so a rule about CODE cannot be satisfied or defeated by a
 * sentence about it — several of the rules in this file are discussed in the very
 * source they read.
 *
 * `https://` inside a comment is handled by stripping block comments and line
 * comments in one pass, before any string is considered: a `//` that follows a
 * `:` is a URL and is kept, because the alternative is to parse JavaScript.
 * Strings containing `/*` are the known limitation and there are none in the
 * files this reads.
 */
function stripJsComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function shippedHooks() {
  return (
    readdirSync(HUSKY_DIR)
      // `isFile()` and not a name filter. `readFileSync` on a directory throws
      // EISDIR, and a throw inside a `describe` body takes EVERY test in the file
      // with it — so one stray directory in `.husky/` (and `.husky/_`, which husky
      // itself creates, is exactly that shape) silently disabled the whole pipeline
      // check. Failing closed is right; taking the `ci.yml` assertions down with it
      // is not, and the two are separated by asking what kind of thing this is.
      .filter((name) => statSync(join(HUSKY_DIR, name)).isFile())
      .filter((name) => !name.startsWith('_') && name !== '.gitignore')
      .filter((name) => readFileSync(join(HUSKY_DIR, name), 'utf8').trim() !== '')
      .sort()
  );
}

/** Every workflow in the repository, DERIVED from the directory. */
function workflowFiles() {
  return readdirSync(WORKFLOWS_DIR)
    .filter((name) => /\.ya?ml$/.test(name))
    .filter((name) => statSync(join(WORKFLOWS_DIR, name)).isFile())
    .sort();
}

/**
 * The `HOOKS` array in `scripts/install-git-hooks.js`.
 *
 * Anchored to the declaration and required to be a single flat array of string
 * literals, because anything cleverer is a shape this reader would have to
 * understand and therefore has to be told about rather than guessed at. Returns
 * `{ names, error }`; `error` is set when the declaration is absent or is not
 * that shape, and the tests below assert on it.
 */
function readInstalledHookList(source) {
  const declared = source.match(/^\s*const HOOKS\s*=\s*(\[[^\]]*\])\s*;?\s*$/m);
  if (!declared) return { names: [], error: 'no `const HOOKS = [...]` declaration this reader recognises' };
  const names = [...declared[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
  const bare = declared[1].replace(/'[^']*'|"[^"]*"/g, '').replace(/[\s,\[\]]/g, '');
  if (bare !== '') {
    return { names, error: `the HOOKS array holds something other than string literals: \`${bare}\`` };
  }
  return { names, error: null };
}

/**
 * Whole-line `#` comments removed, because every reader below matches a KEY and
 * this file argues about those keys in prose.
 *
 * That is not a hypothetical: `ci.yml` says, in a comment, "It was
 * `continue-on-error: true` on the stated grounds that…", and the first version
 * of the reader that checks for that key reported the workflow as carrying a
 * `continue-on-error` — reading a sentence about a past state as the present
 * one. The same comment names `npm run test:e2e`, so the script-existence reader
 * was checking a command the workflow does not run. A guard that cannot tell a
 * comment from a declaration is worse than no guard, because it reports the five
 * failures as fixed.
 *
 * SCOPE, STATED rather than implied: a line whose first non-whitespace character
 * is `#` is dropped whole. A `#` inside a value, after content on the line, is
 * kept — which is right for this file, whose only `#` characters are in full-line
 * comments, and is a limitation rather than a solution if a `#` in a quoted
 * scalar ever starts a line. A reader that guessed at inline comments would
 * corrupt the values it is reading; this one leaves them alone.
 */
function withoutCommentLines(source) {
  // A `#` line inside a `run: |` BLOCK IS SHELL OR DATA, not a YAML comment, and
  // the first version deleted those. It was already live: `ci.yml` has a
  // multi-line `run:` whose first line is a comment, so 174 lines were being
  // removed from the file this suite reads. The two errors it invited are both
  // reachable — documentation inside a `run:` block disappears from every reader,
  // and a shell line that merely MENTIONS `exit 0` fails the gate.
  //
  // So a block scalar is tracked by its indentation and nothing inside it is
  // treated as a comment. `run: |` and `run: >` are the only keys in this
  // repository that introduce one, and a key this reader does not recognise is
  // still stripped, which is the safe direction for a prose comment.
  const lines = source.split('\n');
  const out = [];
  let blockIndent = null;
  for (const line of lines) {
    if (blockIndent !== null) {
      if (line.trim() === '' || line.length > blockIndent) {
        out.push(line);
        continue;
      }
      blockIndent = null;
    }
    const opens = /^(\s*)(?:run|script):\s*[|>][-+0-9]*\s*$/.exec(line);
    if (opens) {
      blockIndent = line.length;
      out.push(line);
      continue;
    }
    if (/^\s*#/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n');
}

/**
 * The job names in a workflow, by indentation.
 *
 * `jobs:` is at column 0 and each job key is at exactly two spaces, which is the
 * shape GitHub requires and the only one this reader accepts. Keys nested inside
 * a job are at four or more spaces and are NOT jobs, so they are not reported —
 * `steps:` and `with:` are ordinary content. What cannot go unreported is a
 * two-space key that is not a plain identifier, because that is a job this reader
 * would drop silently.
 *
 * A reformat that moves jobs to a different indentation therefore yields an EMPTY
 * set rather than a wrong one, and the empty set fails `names.length` in the test
 * above. That is the fail-closed path: a shape this reader cannot see becomes a
 * test failure rather than a green run over three jobs it happened to recognise.
 */
function readWorkflowJobs(source) {
  const lines = withoutCommentLines(source).split('\n');
  const jobsAt = lines.findIndex((l) => l === 'jobs:');
  if (jobsAt === -1) return { names: [], error: 'no `jobs:` key at column 0' };

  const names = [];
  const unreadable = [];
  for (const line of lines.slice(jobsAt + 1)) {
    if (/^\S/.test(line)) break; // left the jobs block
    if (line.trim() === '') continue;
    const twoSpaceKey = /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(line);
    if (twoSpaceKey) {
      names.push(twoSpaceKey[1]);
      continue;
    }
    // A two-space line that carries a colon but is not a plain identifier is a
    // job this reader cannot name, and dropping it is the failure worth a name.
    if (/^ {2}\S.*:/.test(line)) unreadable.push(line.trim());
  }
  return {
    names,
    error: unreadable.length ? `job keys this reader does not understand: ${unreadable.join(', ')}` : null,
  };
}

describe('every hook in .husky/ is wired, and installed where git will find it', () => {
  const shipped = shippedHooks();
  const { names: installed, error } = readInstalledHookList(readFileSync(INSTALL_HOOKS, 'utf8'));

  it('has a reader that understood the HOOKS declaration', () => {
    expect(error, `scripts/install-git-hooks.js ${error}`).toBeNull();
    expect(installed.length, 'HOOKS is empty, so no hook is installed at all').toBeGreaterThan(0);
  });

  it('installs every hook the repository ships, which is what used to be unchecked', () => {
    // THE test. `pre-push` was in this position with no assertion over it at all,
    // and it is the hook that runs the whole suite on every push.
    expect(
      shipped.filter((name) => !installed.includes(name)),
      `these hooks are tracked in .husky/ and read as protection, but scripts/install-git-hooks.js does ` +
        `not install them, so git runs nothing: ${shipped.filter((n) => !installed.includes(n)).join(', ')}`
    ).toEqual([]);
  });

  it('installs nothing that is not a tracked hook, which would run a missing file', () => {
    expect(
      installed.filter((name) => !shipped.includes(name)),
      'HOOKS names hooks that .husky/ does not contain, so the dispatcher would exit with "there is no ' +
        'gate to run" on every commit'
    ).toEqual([]);
  });

  for (const name of shipped) {
    it(`${name} is installed into the shared hooks-gate directory git runs from`, () => {
      // The assertion the gap was made of: the file existing in `.husky/` and
      // reading as protection is not the same as git finding it.
      const path = join(hooksGateDir(), 'hooks-gate', name);
      expect(() => realpathSync(path), `${name} is not installed at ${path}`).not.toThrow();
      // And it is a dispatcher for a hook that exists, not a stale copy.
      expect(readFileSync(path, 'utf8')).toContain(`.husky/${name}`);
    });
  }

  it('points core.hooksPath at that shared directory', () => {
    // Ask git, rather than trusting the file layout: `core.hooksPath` is what
    // makes the check above mean anything.
    const current = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    expect(current).not.toBe('');
    expect(current.endsWith('hooks-gate')).toBe(true);
  });
});

describe('the pre-push hook runs the full suite, and says what it costs', () => {
  const hook = readFileSync(join(HUSKY_DIR, 'pre-push'), 'utf8');

  it('runs the script the gates table names, not a private command', () => {
    const scripts = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).scripts;
    expect(hook).toMatch(/npm run (gate:push|test)\b/);
    // Whatever it runs has to exist, or the hook fails on every push and the
    // first anyone hears of it is a rejected push.
    const invoked = /npm run ([a-zA-Z0-9:_-]+)/.exec(hook);
    expect(invoked, 'the hook names no npm script').not.toBeNull();
    expect(scripts[invoked[1]], `package.json has no "${invoked[1]}" script`).toBeDefined();
  });

  it('does not swallow a failure, because a pre-push gate that reports is not a gate', () => {
    expect(hook).not.toMatch(/\|\|\s*true/);
    expect(hook).not.toMatch(/;\s*exit 0/);
    // `set -e` is what makes the npm exit code the hook's exit code.
    expect(hook).toMatch(/^set -e$/m);
  });

  it('does not read the operator machine, which is what made this gate a machine probe', () => {
    // THE REGRESSION GUARD for the change this suite came out of, and it is
    // written as an INVARIANT over STATEMENTS rather than as a pattern over
    // lines, because both narrower forms were demonstrated defeatable in review:
    //
    //   const cwd = process.cwd();  void listWorktrees(cwd);       // pattern version: caught
    //   const root = () => process.cwd(); void listWorktrees(root());   // line version: PASSED IT
    //   const root =\n  process.cwd();\nlistWorktrees(root);            // line version: PASSED IT
    //
    // A line-oriented rule cannot see a binding that is spread over two lines, and
    // it cannot see a function that returns the directory. So comments come out,
    // whitespace is normalised, and the unit of judgement is the STATEMENT.
    //
    // The rule: every statement that mentions `process.cwd()` must also mention
    // `dbPath`. That admits exactly the legitimate use — `readBoard(process.cwd(),
    // { …, dbPath })`, where the first argument is the repository root board
    // claims are keyed by and the DATA comes from a synthetic fixture or a path
    // that does not exist — and it rejects every way of laundering the directory
    // into a worktree read, because the laundering does not involve a database.
    const suite = stripJsComments(
      readFileSync(join(REPO_ROOT, 'scripts', '__tests__', 'worktree-inventory.test.mjs'), 'utf8')
    );
    // Split on `;` and NOT on braces: `readBoard(process.cwd(), { …, dbPath })`
    // carries its `dbPath` inside an object literal, and splitting on `{` tore that
    // literal in half and left `process.cwd()` alone in a statement with no
    // `dbPath` in it — nine false positives on the legitimate use. A `;` inside a
    // string literal is the known limitation, and its failure mode is a named false
    // positive rather than a silent pass.
    const statements = suite
      .replace(/\s+/g, ' ')
      .split(';')
      .map((x) => x.trim())
      .filter((x) => x.includes('process.cwd()'));
    // Two admitted shapes, and both are "a path in this repository or a fixture",
    // never "the worktrees on this machine":
    //   readBoard(process.cwd(), { …, dbPath })   dbPath names a synthetic fixture
    //   resolve(process.cwd(), 'scripts/…')        a COMMITTED file, for a test
    const admitted = (x) => /\bdbPath\b/.test(x) || /resolve\(\s*process\.cwd\(\)\s*,\s*'[^']+'/.test(x);
    const offenders = statements.filter((x) => !admitted(x));
    expect(
      offenders,
      'the inventory suite consults process.cwd() in a statement with no dbPath, so the directory it reads ' +
        'is the operator own and not a fixture. The worktrees this suite reads must be the ones it built: a ' +
        'machine read here is a push gate whose answer is a property of the operator rather than of the code, ' +
        'which is what made it red for a dirty main checkout and unreachable on a pull_request checkout'
    ).toEqual([]);
    // And the legitimate use is asserted to EXIST, so the rule above cannot be
    // satisfied by deleting every read: this is what stops it from becoming a
    // guard that passes because the thing it guards is gone.
    // Both admitted shapes are asserted to EXIST, so the rule cannot be satisfied
    // by deleting every read: that would turn a guard into one that passes because
    // the thing it guards is gone, which is the outcome this file exists to stop.
    expect(
      statements.length,
      'the inventory suite should still read a committed file and a synthetic database relative to the repo ' +
        'root, or the rule above is vacuous rather than satisfied'
    ).toBeGreaterThan(0);
    expect(
      statements.filter((x) => /\bdbPath\b/.test(x)).length,
      'no readBoard call with a synthetic dbPath remains, so the dbPath allowance is guarding nothing'
    ).toBeGreaterThan(0);
    expect(
      statements.filter((x) => /resolve\(\s*process\.cwd\(\)\s*,\s*'[^']+'/.test(x)).length,
      'no committed-file resolve remains, so the resolve allowance is guarding nothing'
    ).toBeGreaterThan(0);

    // The two helpers the old file read the live fleet through, by name, because
    // a reintroduction under the old name is the cheapest way back. NOT
    // `holdsWorkGitCannotSee`, which is the RULE rather than the read: it is
    // `ahead === 0 && mergedIntoMain && dirty + untracked > 0`, it is what both
    // fleet guards filter on, and deleting it would delete the subject.
    for (const retired of ['liveWorktreeFacts', 'liveInventory']) {
      expect(suite, `${retired} is back in the inventory suite`).not.toContain(retired);
    }
  });

  it('has no per-test timeout anywhere in the inventory suite, in any spelling', () => {
    // Also an invariant, and also demonstrated defeatable. The first version
    // matched `}, 60_000);` — the trailing-argument form only — and the second
    // matched `/\btimeout\s*:/`, which a computed key walks straight past:
    //
    //   it('x', { timeout: 60_000 }, fn)        // both versions: caught
    //   it('x', () => {}, 60_000)               // both versions: caught
    //   it('x', { ['timeout']: 60_000 }, fn)    // the regex version: PASSED IT
    //
    // So the rule is a TOKEN COUNT over comment-stripped, whitespace-normalised
    // source: the word `timeout` may appear exactly once in that file, and that
    // once is the single file-level `testTimeout` declaration. A per-test budget
    // is the shape a cost-that-grows takes, and nothing left in that file grows,
    // so any second occurrence is a regression whatever syntax carries it.
    const suite = stripJsComments(
      readFileSync(join(REPO_ROOT, 'scripts', '__tests__', 'worktree-inventory.test.mjs'), 'utf8')
    );
    const flat = suite.replace(/\s+/g, ' ');
    const tokens = [...flat.matchAll(/timeout/gi)].map((m) => m[0]);
    expect(
      tokens.length,
      `the inventory suite mentions \`timeout\` ${tokens.length} times; exactly one is allowed, the ` +
        'file-level testTimeout declaration. A per-test budget is sized against a cost that grows with ' +
        'something outside the repository, and that is how this suite was red on a machine and unreachable ' +
        'on a pull_request checkout.'
    ).toBe(1);
    expect(flat, 'the one permitted mention must be the file-level testTimeout declaration').toMatch(
      /vi\.setConfig\(\{\s*testTimeout:/
    );
  });
});

describe('the CI workflow is a gate, and every command in it exists', () => {
  const source = readFileSync(CI_WORKFLOW, 'utf8');
  const scripts = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).scripts;

  it('has readers that understood the workflow', () => {
    const jobs = readWorkflowJobs(source);
    expect(jobs.error, `ci.yml ${jobs.error}`).toBeNull();
    expect(jobs.names.length, 'ci.yml declares no jobs this reader can see').toBeGreaterThan(0);
  });

  it('runs the suite the local gates run, in a job of its own', () => {
    // A separate job, not a step: within one job a failed step aborts the rest,
    // and a step ordered after a failing one never runs while the workflow still
    // reads as if it were covered.
    const jobs = readWorkflowJobs(source);
    expect(jobs.names).toContain('ci');
    expect(jobs.names).toContain('e2e-unit');
    expect(jobs.names).toContain('e2e');
  });

  it('reads every workflow in the directory, because a second one is a gate too', () => {
    // `ci.yml` was the only workflow file, and it was the only one read. Adding a
    // second workflow carrying `continue-on-error: true` left this suite at 24
    // passed — a gate that opted out of gating, in a file whose whole job is to
    // notice that. Every reader below runs over every file for the same reason
    // `suite-budgets.test.mjs` derives its subject from the directory: a list of
    // names compared against itself cannot fail.
    const files = workflowFiles();
    expect(files.length, 'no workflow file was found, so every reader below is reading nothing').toBeGreaterThan(0);
    expect(files).toContain('ci.yml');
  });

  it('lets no job in ANY workflow opt out of failing', () => {
    for (const name of workflowFiles()) {
      const live = withoutCommentLines(readFileSync(join(WORKFLOWS_DIR, name), 'utf8'));
      expect(
        [...live.matchAll(/^\s*continue-on-error:\s*(\S+)/gm)].map((m) => m[1]),
        `${name} carries a continue-on-error, which makes the thing it names a report`
      ).toEqual([]);
      expect(live, `${name} swallows a failure with || true or exit 0`).not.toMatch(/\|\|\s*true/);
      expect(live, `${name} swallows a failure with || true or exit 0`).not.toMatch(/exit 0\b/);
    }
  });

  it('names only npm scripts that EXIST, across every workflow', () => {
    const scripts = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).scripts;
    const missing = [];
    let seen = 0;
    for (const name of workflowFiles()) {
      const invoked = [
        ...withoutCommentLines(readFileSync(join(WORKFLOWS_DIR, name), 'utf8')).matchAll(/npm run ([a-zA-Z0-9:_-]+)/g),
      ].map((m) => m[1]);
      expect(
        invoked.length,
        `${name} has no npm script this reader can see, so the reader is not reading it`
      ).toBeGreaterThan(0);
      seen += invoked.length;
      missing.push(...invoked.filter((s) => scripts[s] === undefined).map((s) => `${name}: ${s}`));
    }
    expect(missing, `workflows run scripts package.json does not define: ${missing.join(', ')}`).toEqual([]);
    expect(seen).toBeGreaterThan(0);
  });

  it('lets no job opt out of failing', () => {
    // `continue-on-error` on a job or a step is the difference between a gate and
    // a report, and it was present here once on the `e2e` job on a justification
    // that outlived the failures it described. Line-anchored, and read from the
    // comment-stripped source: the sentence in ci.yml that explains the history
    // of that key contains the key.
    const live = withoutCommentLines(source);
    expect(
      [...live.matchAll(/^\s*continue-on-error:\s*(\S+)/gm)].map((m) => m[1]),
      'a continue-on-error in ci.yml makes the thing it names a report'
    ).toEqual([]);
    // And the other two spellings of the same hole.
    expect(live).not.toMatch(/\|\|\s*true/);
    expect(live).not.toMatch(/exit 0\b/);
  });

  it('still runs the same gates under the same names, not merely scripts that exist', () => {
    // The existence check below is necessary and not sufficient: `npm run test --
    // some-one-file` names a script that exists, runs something much smaller, and
    // the existence check stays green. So the three steps whose CONTENT is the
    // gate are named here, and a change to any of them has to be made here too.
    //
    // A `Test` step that stops running the full suite is the exact regression this
    // whole suite was written to catch, and it is invisible to a script-existence
    // assertion.
    const steps = [...withoutCommentLines(source).matchAll(/^ {6}- name: (.+)$/gm)].map((m) => m[1].trim());
    const runOf = (name) => {
      const at = steps.indexOf(name);
      if (at === -1) return null;
      const rest = withoutCommentLines(source).split('\n');
      const from = rest.findIndex((l) => l === `      - name: ${name}`);
      const next = rest.findIndex((l, i) => i > from && /^ {6}- name: /.test(l));
      return rest
        .slice(from, next === -1 ? undefined : next)
        .map((l) => /^ {8}run: (.+)$/.exec(l)?.[1])
        .find(Boolean);
    };
    expect(steps.length, 'this reader saw no steps in the ci job').toBeGreaterThan(0);
    expect(runOf('Test'), 'the ci job has no step named Test').toMatch(/^npm run test\b/);
    expect(runOf('Build'), 'the ci job has no step named Build').toMatch(/^npm run build\b/);
    expect(runOf('Type-check'), 'the ci job has no step named Type-check').toMatch(/^npm run tsc\b/);
    expect(runOf('Lint'), 'the ci job has no step named Lint').toMatch(/^npm run lint:check\b/);
    // `--coverage` is a flag on the same suite, not a different suite, and
    // dropping it would silently stop the coverage report being produced.
    expect(runOf('Test')).toMatch(/--coverage/);
  });

  it('names only npm scripts that exist, so a renamed gate cannot pass as a green run', () => {
    const invoked = [...withoutCommentLines(source).matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)].map((m) => m[1]);
    expect(invoked.length, 'this reader saw no npm script at all, so it is not reading the workflow').toBeGreaterThan(
      0
    );
    const missing = invoked.filter((name) => scripts[name] === undefined);
    expect(missing, `ci.yml runs scripts package.json does not define: ${missing.join(', ')}`).toEqual([]);
  });

  it('triggers on a push to main, on a pull request to main, and on demand', () => {
    // The pull_request trigger is the one that was dead: the suite it ran read a
    // `main` ref a shallow PR checkout does not have. It is back in the suite
    // against a synthetic fleet, so the trigger works — and the trigger is only
    // worth having if it is here.
    const live = withoutCommentLines(source);
    expect(live).toMatch(/^ {2}push:\s*$/m);
    expect(live).toMatch(/^ {4}branches:\s*\[main\]\s*$/m);
    expect(live).toMatch(/^ {2}pull_request:\s*$/m);
    expect(live).toMatch(/workflow_dispatch:/);
  });

  it('keeps the token read-only and does not persist it', () => {
    const live = withoutCommentLines(source);
    expect(live).toMatch(/^permissions:\s*$/m);
    expect(live).toMatch(/^ {2}contents:\s*read\s*$/m);
    const checkouts = [...live.matchAll(/^\s*persist-credentials:\s*(\S+)/gm)].map((m) => m[1]);
    expect(checkouts.length, 'no checkout in this workflow').toBeGreaterThan(0);
    expect([...new Set(checkouts)]).toEqual(['false']);
  });
});

/**
 * The readers, against injected text.
 *
 * Without these, a reader that FABRICATED an answer — returned an empty job set, or
 * a plausible `HOOKS` array, from a file it could not parse — would make every
 * check above pass. That is not hypothetical: it is the failure mode of every
 * textual reader in this repository, and the only place it can be pinned is where
 * the expected value is written down rather than derived.
 */
describe('the pipeline readers fail closed', () => {
  it('reports no hooks rather than guessing, when the HOOKS declaration is not that shape', () => {
    expect(readInstalledHookList('const HOOKS = new Set(["a"]);\n').error).toMatch(/no `const HOOKS/);
    expect(readInstalledHookList('const OTHER = ["a"];\n').error).toMatch(/no `const HOOKS/);
    // A computed entry is reported rather than skipped.
    expect(readInstalledHookList('const HOOKS = [makeHook()];\n').error).toMatch(/other than string literals/);
  });

  it('reads a real HOOKS declaration, in either quoting style', () => {
    expect(readInstalledHookList("const HOOKS = ['pre-commit', 'pre-push'];").names).toEqual([
      'pre-commit',
      'pre-push',
    ]);
    expect(readInstalledHookList('const HOOKS = ["pre-commit"];').names).toEqual(['pre-commit']);
    expect(readInstalledHookList('  const HOOKS = [\n    "a",\n    "b",\n  ];').names).toEqual(['a', 'b']);
  });

  it('reports no jobs rather than an empty set, when there is no jobs block', () => {
    expect(readWorkflowJobs('name: CI\non:\n  push:\n').error).toMatch(/no `jobs:`/);
  });

  it('reports a two-space job key it cannot name, rather than dropping it', () => {
    // A nested key at six spaces is ordinary content and is not reported — that
    // was the first version's bug, and it reported `steps:` and `with:` from the
    // real workflow. A key at two spaces that is not a plain identifier IS a job
    // this reader would drop, and dropping it is the failure worth a name.
    const nested = readWorkflowJobs(['jobs:', '  ci:', '    runs-on: ubuntu-latest', '      steps:'].join('\n'));
    expect(nested.names).toEqual(['ci']);
    expect(nested.error).toBeNull();

    const quoted = readWorkflowJobs(['jobs:', '  "quoted job":', '    runs-on: ubuntu-latest'].join('\n'));
    expect(quoted.names).toEqual([]);
    expect(quoted.error).toMatch(/quoted job/);
  });

  it('stops at the end of the jobs block instead of reading later keys as jobs', () => {
    // `env:` at column 0 ends the block; a `deploy:` key after it is not a job
    // of this workflow and must not be counted as one.
    const jobs = readWorkflowJobs(['jobs:', '  ci:', '    runs-on: ubuntu-latest', 'env:', '  deploy:', ''].join('\n'));
    expect(jobs.names).toEqual(['ci']);
    expect(jobs.error).toBeNull();
  });

  it('ignores comment lines, which are not jobs', () => {
    const jobs = readWorkflowJobs(['jobs:', '  # a note', '  ci:', '    # another note'].join('\n'));
    expect(jobs.names).toEqual(['ci']);
    expect(jobs.error).toBeNull();
  });
});
