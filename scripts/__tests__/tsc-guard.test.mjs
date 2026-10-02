import { describe, it, expect, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * This file's budget, and the reason it is not Vitest's default 5s.
 *
 * Like the other spawn-heavy suites here, this one is bounded by what it launches rather
 * than by anything it computes: `tscRun` below is a `spawnSync` of the real `tsc` binary,
 * and the tests that matter most — the ones proving the guard refuses `--noCheck` and
 * still reaches a real compiler — cannot be faked, because a fake compiler exiting 0 is
 * exactly what they exist to catch.
 *
 * Measured, the slowest span in this file is 2.2s (`still type-checks a real project in
 * build mode`), against a 5s default: a budget at 44% of the value of the work it is
 * timing. Unlike the sibling suites, that number also GROWS — the slow test runs
 * `tsc -b` over this repository, so every file added to the project makes it slower, and a
 * budget set today is a budget that erodes. 20s is roughly nine times today's worst case,
 * chosen for a cost that rises with the repository rather than a fixed one.
 *
 * What is deliberately NOT claimed: any contention factor. A full 266-file run was
 * measured against the sibling suites and came out FASTER per test than the small-file
 * run, so "a full run is N times slower" is not a thing this suite can currently support.
 *
 * A BUDGET, not a threshold: it cannot turn a failing assertion green, it only decides
 * how long a test may run before the harness reports it, and no assertion below changed.
 * Its cost is that a genuinely hung compiler takes 20s to be reported.
 *
 * `scripts/__tests__/suite-budgets.test.mjs` is the tripwire for this line, and it
 * DERIVES which suites in that directory need a budget rather than being told — which is
 * how this file came to be included after being missed once.
 */
vi.setConfig({ testTimeout: 20_000 });

/**
 * The guard is only as good as its own installation, so these tests check two
 * different things and both matter:
 *
 *  1. the RULES — which invocations are refused — with no process and no
 *     project, so the decision table is testable in milliseconds;
 *  2. the INSTALLATION — that the file `npx tsc` actually resolves to is the
 *     guard and not npm's plain symlink.
 *
 * (2) is the one that cannot be asserted by reading the source. npm deletes the
 * link on `rebuild`, `update`, `dedupe`, `prune` and `audit fix` without
 * re-running `prepare`, so the guard can be absent while everything in the tree
 * still looks correct. A test that only covered the rules would stay green
 * through exactly that, and the trap would be silently reopened.
 */

const GUARD = join(import.meta.dirname, '..', 'tsc-guard.mjs');
const INSTALLER = join(import.meta.dirname, '..', 'install-tsc-guard.mjs');
const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * The bin directory that would actually answer `tsc` from inside this checkout.
 *
 * Walks ancestors the way npm does rather than assuming `node_modules` is right
 * here, because most worktrees in this repository have no `node_modules` of
 * their own and resolve the parent checkout's instead. Asserting on a path that
 * does not exist in a worktree would fail the test for a reason that has nothing
 * to do with the guard.
 */
function resolveBinDir() {
  let dir = REPO_ROOT;
  for (;;) {
    const candidate = join(dir, 'node_modules', '.bin');
    if (existsSync(join(candidate, 'tsc'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const BIN_DIR = resolveBinDir();
const TSC_BIN = BIN_DIR ? join(BIN_DIR, 'tsc') : null;

/**
 * The checkout that OWNS the resolved bin directory.
 *
 * Not always this one. When a worktree has no `node_modules` of its own the
 * ancestor walk lands in the parent checkout, and then the guard that will
 * actually run, the compiler it delegates to, and the file `npx` resolves are
 * all the PARENT's. Comparing this checkout's guard against the parent's bin
 * entry fails on two files that are both correct — a review found exactly that,
 * red in 36 of this repository's 59 worktrees, every one of which has a working
 * guard. So expectations are derived from the OWNER, not from here.
 */
const OWNER_ROOT = BIN_DIR ? resolve(BIN_DIR, '..', '..') : null;
const OWNER_GUARD = OWNER_ROOT ? join(OWNER_ROOT, 'scripts', 'tsc-guard.mjs') : null;

/** The real compiler, reached past the guard on purpose, by two tests. */
const REAL_COMPILER = OWNER_ROOT ? join(OWNER_ROOT, 'node_modules', 'typescript', 'bin', 'tsc') : null;

/**
 * Whether the resolved bin directory belongs to THIS checkout.
 *
 * `resolveBinDir` walks up, because most worktrees here have no `node_modules`
 * of their own and resolve the parent checkout's — which is the correct answer
 * for every read-only assertion, since it is the link npm and npx would use.
 *
 * It is the WRONG answer for anything that writes. A test that plants a broken
 * link at an ancestor's `.bin/tsc` edits a checkout this session does not own,
 * and the repair cannot reach it either: `install()` resolves its own REPO_ROOT,
 * so a worktree's installer will not repair the parent's bin. That happened
 * here — a momentarily-dangling worktree link sent `resolveBinDir` walking, the
 * test planted into the shared main checkout, and main was left with no working
 * `tsc` at all until an install repaired it.
 */
const OWNS_BIN_DIR = BIN_DIR !== null && BIN_DIR.startsWith(`${REPO_ROOT}/`);

function runBin(args) {
  return spawnSync(process.execPath, [TSC_BIN, ...args], { encoding: 'utf8', cwd: REPO_ROOT });
}

describe('the tsc guard: which invocations it refuses', () => {
  it('refuses the invocation that type-checks nothing', async () => {
    const { decide } = await import(GUARD);
    // The whole reason this exists: no arguments, and the --noEmit spelling an
    // agent reaches for. Both read as a typecheck and check zero files.
    for (const argv of [[], ['--noEmit'], ['-p', 'tsconfig.json'], ['--pretty', 'false']]) {
      expect(decide(argv).action, `tsc ${argv.join(' ')} must not be allowed to report a pass`).toBe('reject');
    }
  });

  it('allows build mode in every spelling, anywhere in the argument list', async () => {
    const { decide, isBuildMode } = await import(GUARD);
    // `-b` last, because `tsc -b --listFiles` is what CI runs and `tsc --build`
    // is the long form; a guard that only tested argv[0] would refuse both.
    for (const argv of [
      ['-b'],
      ['--build'],
      ['-b', '--listFiles'],
      ['--listFiles', '-b'],
      ['-b', 'tsconfig.app.json'],
    ]) {
      expect(isBuildMode(argv), `tsc ${argv.join(' ')} is the authoritative check`).toBe(true);
      expect(decide(argv).action).toBe('delegate');
    }
  });

  it('allows build mode however TypeScript spells it, which is case-insensitively', async () => {
    const { decide, isBuildMode } = await import(GUARD);
    // A review found `-b`/`--build` asserted as "the only two spellings", which
    // is false: TypeScript matches its own options case-insensitively, and the
    // real compiler exits 0 on `tsc -B` and on `--Build`. The guard was refusing
    // real build commands - the opposite failure, but a failure.
    for (const flag of ['-b', '-B', '--build', '--Build', '--BUILD']) {
      expect(isBuildMode([flag, 'tsconfig.node.json']), `tsc ${flag} is a real build`).toBe(true);
      expect(decide([flag, 'tsconfig.node.json']).action).toBe('delegate');
    }
  });

  it('still allows the flags that print something, so the documented evidence still reproduces', async () => {
    const { decide } = await import(GUARD);
    // `docs/TESTING.md` quotes `--showConfig` as the proof that the root project
    // is empty. A guard that blocked it would make that evidence unreproducible
    // and teach the wrong lesson; none of these type-check a file, and all of
    // them print, so none can be mistaken for a green result.
    for (const argv of [['--showConfig', '-p', 'tsconfig.json'], ['--help'], ['--version'], ['-v']]) {
      expect(decide(argv).action, `tsc ${argv.join(' ')} prints, it does not check`).toBe('delegate');
    }
  });

  it('refuses --noCheck, which is a build that type-checks nothing', async () => {
    const { decide } = await import(GUARD);
    // Found by a review, and the same shape as the `--all` hole one level down:
    // `--noCheck` is a BUILD-mode flag, so it can never reach the inspection
    // whitelist, and `tsc -b --noCheck` exits 0 having checked nothing. The
    // real-compiler control for it is the test below.
    for (const argv of [
      ['-b', '--noCheck'],
      ['--build', '--noCheck'],
      ['-b', '--force', '--noCheck'],
    ]) {
      expect(decide(argv).action, `tsc ${argv.join(' ')} must not report a pass it never checked`).toBe('reject');
    }
  });

  it('refuses --all, which reads like "show options" and type-checks nothing', async () => {
    const { decide } = await import(GUARD);
    // Added because a review found this whitelisted on the strength of its name:
    // `tsc --all` prints nineteen kilobytes of compiler options and exits 0
    // having checked no file, which is the guard's own threat model reached
    // through the guard. `tsc -b --all` is TS5094, so nothing real is lost.
    expect(decide(['--all']).action, 'exits 0 and checks nothing, so it must not be a way through').toBe('reject');
    expect(decide(['--all', '--watch']).action).toBe('reject');
  });

  it('names a command that works, so a refusal is a redirect', async () => {
    const { run } = await import(GUARD);
    const err = [];
    const codes = [];
    const result = run(['--noEmit'], { err: { write: (chunk) => err.push(chunk) }, exit: (code) => codes.push(code) });
    expect(result.delegated).toBe(false);
    expect(codes, 'a refusal must fail the command, not warn and continue').toEqual([1]);
    const text = err.join('');
    expect(text, 'it says the whole run checked nothing').toMatch(/ZERO files/);
    expect(text, 'it names the authoritative command').toContain('npm run tsc');
    expect(text, 'and the narrow one, so nothing legitimate is lost').toContain('npx tsc -b tsconfig.app.json');
  });
});

describe('the tsc guard: it is actually installed', () => {
  it('finds a bin directory, and says plainly when it cannot', () => {
    // Not a skip: a checkout with no `node_modules` anywhere above it has no
    // `tsc` to guard, and every test below would be measuring nothing. Failing
    // here names that as the reason, which a silent skip would not. An earlier
    // version's comment promised to "skip" while the assertion failed, which is
    // the gap this wording closes.
    expect(
      BIN_DIR,
      'no node_modules/.bin/tsc in this checkout or any ancestor — run `npm install`, and the tests below are meaningless until you do'
    ).not.toBeNull();
  });

  it('is the file npx tsc resolves to, not the plain npm symlink', () => {
    // THE tripwire. This is the assertion that turns "the guard was silently
    // removed by npm rebuild" from a red herring into a red test.
    //
    // Compared against the OWNER's guard, not this checkout's: in a worktree
    // with no `node_modules` those are two different, both-correct files, and
    // comparing them made this red in 36 of 59 worktrees.
    expect(lstatSync(TSC_BIN).isSymbolicLink(), 'the guard is a link into scripts/, not a generated copy').toBe(true);
    expect(realpathSync(TSC_BIN), 'and it points at the reviewed guard, byte for byte').toBe(realpathSync(OWNER_GUARD));
  });

  it('exits non-zero and says why, so a zero-file check cannot read as a pass', () => {
    const result = runBin([]);
    expect(result.status, 'a bare tsc must fail rather than exit 0 on nothing').not.toBe(0);
    expect(result.stderr).toMatch(/ZERO files/);
    expect(result.stderr, 'and it names the command that works instead').toContain('npm run tsc');
  });

  it('refuses --noEmit through the real bin, which is the spelling agents use', () => {
    const result = runBin(['--noEmit']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/refusing to run without build mode/);
  });

  it('refuses --all, and refuses it because the real compiler really does exit 0', () => {
    // The end-to-end version of the decision-table test above, and the control
    // that keeps the rule honest. It runs the REAL compiler — deliberately past
    // the guard, which is the only way to observe it — over a throwaway project
    // holding a genuine type error. If a future TypeScript makes `--all` really
    // type-check, this goes red and the rule above can be relaxed with evidence
    // rather than on a reading of the flag's name.
    const dir = mkdtempSync(join(tmpdir(), 'tsc-all-probe-'));
    try {
      writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { noEmit: true, strict: true }, include: ['bad.ts'] })
      );
      writeFileSync(join(dir, 'bad.ts'), 'export const bad: number = "not a number";\n');

      const real = spawnSync(process.execPath, [REAL_COMPILER, '--all', '-p', dir], { encoding: 'utf8' });
      expect(real.status, 'the real compiler exits 0 on a broken project, which is the hole').toBe(0);
      expect(real.stdout + real.stderr, 'and never mentions the error, so it checked nothing').not.toMatch(/TS\d+/);

      // And the guard, asked the same question, says no.
      expect(runBin(['--all']).status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses --noCheck through the real bin, proven against a planted type error', () => {
    // The end-to-end control for the decision-table rule above, and the reason
    // that rule exists: `-b --noCheck` is a REAL build-mode invocation, so the
    // decision table is the only thing standing between it and a caller. Without
    // a real error to check, "it refuses" and "it checked nothing anyway" look
    // identical, which is the whole failure being guarded against.
    const dir = mkdtempSync(join(tmpdir(), 'tsc-nocheck-probe-'));
    try {
      writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { noEmit: true, strict: true }, include: ['bad.ts'] })
      );
      writeFileSync(join(dir, 'bad.ts'), 'export const bad: number = "not a number";\n');

      const real = spawnSync(process.execPath, [REAL_COMPILER, '-b', '--noCheck', dir], { encoding: 'utf8' });
      expect(real.status, 'the real compiler exits 0 on a broken project, which is the hole').toBe(0);
      expect(real.stdout + real.stderr, 'and never mentions the error, so it checked nothing').not.toMatch(/TS\d+/);

      // The same project, asked properly, does fail - so the error is real.
      const honest = spawnSync(process.execPath, [REAL_COMPILER, '-b', dir], { encoding: 'utf8' });
      expect(honest.status, 'and the same build without --noCheck catches it').not.toBe(0);

      // And the guard, asked the --noCheck question, says no.
      expect(runBin(['-b', '--noCheck']).status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still reaches the real compiler in build mode', () => {
    // Delegation is the half that must not regress: a guard that refused
    // everything would pass every test above while making the repository
    // untypecheckable. `--help` under build mode prints the compiler's own
    // version banner, so this proves the hand-off end to end without running a
    // full typecheck.
    const result = runBin(['-b', '--help']);
    expect(result.status, 'build mode is handed off, not blocked').toBe(0);
    expect(result.stdout, 'and it is the REAL compiler answering').toMatch(/The TypeScript Compiler/);
  });

  it('still type-checks a real project in build mode', () => {
    // The narrow escape hatch, proven rather than asserted in prose. The node
    // project is two config files, so this is a genuine end-to-end typecheck in
    // well under a second.
    const result = runBin(['-b', 'tsconfig.node.json']);
    expect(result.status, 'npx tsc -b <project> remains a real check').toBe(0);
  });

  it('propagates a real failure, so the delegation above is not a rubber stamp', () => {
    // The non-vacuity control for the two tests above. A guard that spawned the
    // compiler and then always exited 0 would pass every delegation assertion in
    // this file while turning every typecheck into a green lie — the exact shape
    // of the bug, one level down. Asking the real compiler about a project that
    // does not exist is a failure it must produce on its own.
    const result = runBin(['-b', 'tsconfig.does-not-exist.json']);
    expect(result.status, 'a failing build must stay failing through the guard').not.toBe(0);
    // TypeScript writes its diagnostics to stdout, not stderr — checked here
    // rather than assumed, because asserting on stderr alone passed 13 of 14
    // tests and failed here for a reason that had nothing to do with the guard.
    expect(result.stdout + result.stderr, "and it is the real compiler's error, not the guard's").toMatch(/TS5083/);
  });
});

describe('the tsc guard installer', () => {
  /**
   * The precondition every writing test shares.
   *
   * A test that plants a link at an ancestor's `.bin/tsc` edits a checkout this
   * session does not own, and the repair cannot follow: `install()` resolves its
   * own REPO_ROOT. Asserted rather than assumed, so a checkout that loses its own
   * link fails loudly instead of quietly taking a branch that would edit
   * somebody else's.
   */
  function requireOwnership() {
    if (OWNS_BIN_DIR) return true;
    expect(
      existsSync(join(REPO_ROOT, 'node_modules', '.bin', 'tsc')),
      'this checkout does not own its bin entry, so there is nothing here it may write'
    ).toBe(false);
    return false;
  }

  it('is idempotent, so `npm install` can be run any number of times', async () => {
    if (!requireOwnership()) return;
    const { install } = await import(INSTALLER);
    const first = install();
    expect(first.installed, 'the guard must install in a checkout that has TypeScript').toBe(true);
    const second = install();
    expect(second).toEqual({ installed: true, changed: false });
  });

  it('repairs npm plain symlink, which is the whole documented recovery path', async () => {
    // The review's blocking finding. `alreadyGuarded()` is the only predicate
    // between "npm clobbered the link" and "`npm install` repairs it", and a
    // mutation that made it answer `true` unconditionally left every test in
    // this file green while the installer silently refused to fix anything. A
    // green suite over a broken recovery path is worse than no test at all: it
    // tells an agent the repair works when it does not.
    //
    // The planted link RESOLVES and is npm's own - the exact state `npm rebuild`
    // leaves. The dangling test below covers a different link that
    // `alreadyGuarded` rejects for a different reason, which is why it never
    // reached this branch.
    if (!requireOwnership()) return;
    const { install } = await import(INSTALLER);
    try {
      rmSync(TSC_BIN, { force: true });
      symlinkSync('../typescript/bin/tsc', TSC_BIN);

      expect(realpathSync(TSC_BIN), 'the planted link is a real, working, plain npm symlink').toBe(
        realpathSync(REAL_COMPILER)
      );
      expect(install(), 'so the installer must not report nothing to do').toEqual({ installed: true, changed: true });
      expect(realpathSync(TSC_BIN), 'and it must actually put the guard back').toBe(realpathSync(GUARD));
    } finally {
      install();
    }
  });

  it('replaces a dangling link rather than leaving one npm would skip', async () => {
    // Planted for real. An earlier version of this test called `install()` on a
    // healthy link, so it never reached the branch it was named for and
    // survived a mutant that deleted that branch outright.
    //
    // A dangling link is the failure worth pinning: `npx` decides a bin exists
    // with `stat().isFile()`, so a link that does not resolve is invisible to
    // it and it reaches for a package named `tsc` on the registry.
    //
    // What this does NOT cover, stated rather than hidden: the installer's own
    // `!resolvesToAFile()` branch, which fires when a link IT just wrote fails
    // to resolve. A correct relative target cannot produce that, so it is a
    // defensive last resort with no reachable trigger from a test.
    if (!requireOwnership()) return;
    const { install } = await import(INSTALLER);
    try {
      rmSync(TSC_BIN, { force: true });
      symlinkSync('../scripts/tsc-guard.mjs', TSC_BIN);

      expect(
        existsSync(TSC_BIN),
        "the planted link does not resolve, and existsSync follows symlinks, so this is npm's own answer"
      ).toBe(false);

      install();

      expect(realpathSync(TSC_BIN), 'and the installer leaves a link that resolves, to the guard').toBe(
        realpathSync(GUARD)
      );
    } finally {
      // Repaired even when the assertions above fail. Without this a red run
      // leaves the checkout's own `tsc` dangling and the next run fails in five
      // unrelated places, which reads as a broken guard rather than as one test
      // asserting a deliberately broken link.
      install();
    }
  });

  it('is wired into prepare, so an install is what installs it', async () => {
    const { readFileSync } = await import('node:fs');
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(manifest.scripts.prepare).toContain('install-tsc-guard.mjs');
  });
});
