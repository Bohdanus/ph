#!/usr/bin/env node
/**
 * Refuses to type-check nothing and call it a pass.
 * --------------------------------------------
 * The root `tsconfig.json` is a solution-style stub: `"files": []` plus three
 * `references`. That shape is correct and deliberate — the app, the Node config
 * files and the Playwright suite need different `lib` and `types`, so they are
 * three projects, and `tsc -b` is the command that walks the references.
 *
 * The cost of that shape is that plain `tsc` does NOT walk them. It reads the
 * root stub, finds zero input files, type-checks nothing, and exits 0. It is
 * indistinguishable from a clean typecheck: no output, no error, exit 0. A
 * developer or an agent that runs it has learned nothing about the code.
 *
 * WHY THIS IS A PROGRAM AND NOT A LINE IN A DOCUMENT
 * -------------------------------------------------
 * `AGENTS.md` and `docs/TESTING.md` both say "never gate on `npx tsc`". A weaker
 * model that has forgotten the file runs the command anyway, sees exit 0, and
 * reports a typecheck that never happened. Advice is only as strong as the
 * reader's memory, and this repository is built out of agents that routinely
 * read no instruction file at all.
 *
 * So the refusal lives where the wrong command actually executes. `npm install`
 * links THIS FILE to `node_modules/.bin/tsc` (see `install-tsc-guard.mjs`), which
 * is the single path every spelling of `tsc` resolves through — `npx tsc`, a bare
 * `tsc` on an npm script's PATH, `./node_modules/.bin/tsc`, and the `.bin` entry
 * a worktree without its own `node_modules` inherits from its parent.
 *
 * The limit, stated because it is real: naming the compiler's own file bypasses
 * all of it. `node node_modules/typescript/bin/tsc` reaches a bare `tsc` with no
 * bin link in the way, and a guard that claimed otherwise would be lying about
 * its own coverage. `kilo.jsonc` does not cover that spelling either. It takes
 * deliberately typing a path inside `node_modules`, and nothing an agent guesses.
 *
 * WHAT IS STILL ALLOWED, AND WHY IT IS NOT A WEAKNESS
 * --------------------------------------------------
 * Build mode accepts a single project as its argument, so the narrow check people
 * actually want — "did my change to the app break the app" — is `tsc -b` against
 * that one project and stays available. There is no legitimate reason to need
 * non-build mode here, which is what makes an unconditional refusal honest
 * rather than merely strict.
 */

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

/**
 * Flags that switch type checking OFF while still running the compiler.
 *
 * `--noCheck` is a build-mode flag, so the inspection whitelist below never sees
 * it: `tsc -b --noCheck` reaches a real compiler, the compiler checks nothing,
 * and the process exits 0. Measured against a project holding a real type error,
 * `-b` exits 1 and `-b --noCheck` exits 0 with no output — the guard's own threat
 * model, reached through the guard, which is the same shape as the `--all` hole a
 * review found and the reason this list exists.
 *
 * The cost of refusing it is nil: nobody type-checks by asking for no checking,
 * and the way to skip the compiler is to not run it.
 */
const NO_CHECK_FLAGS = new Set(['--noCheck']);

/**
 * Flags that print something and type-check nothing.
 *
 * `--showConfig` is here because this repository's own documentation quotes it as
 * the evidence for the trap (`docs/TESTING.md`), and a guard that made the
 * evidence unreproducible would be a guard that taught the wrong lesson.
 *
 * `--all` is deliberately NOT here, and its absence is the point. It reads like
 * "show all options" and prints nineteen kilobytes of them — but it exits 0
 * having type-checked nothing, which is the exact shape this guard exists to
 * destroy, and a review found it whitelisted on the strength of that reading.
 * `tsc -b --all` is an error (TS5094), so nothing legitimate is lost by refusing
 * it: the real build-everything spelling is plain `tsc -b`.
 */
const INSPECTION_FLAGS = new Set(['--showConfig', '--help', '-h', '--version', '-v']);

/**
 * Whether this invocation asks TypeScript to build the project graph.
 *
 * Matched case-insensitively because TypeScript matches its own options that
 * way: the real compiler exits 0 on `tsc -B tsconfig.app.json` and on
 * `--Build`, and a guard that refused those would be refusing a real build. A
 * review found `-b`/`--build` asserted as "the only two spellings", which is
 * false.
 *
 * The whole list is scanned rather than a leading position tested, because the
 * loosest case that admits errs toward ALLOWING a build: TypeScript treats a
 * trailing `-b` as an unknown option and errors (TS5023), so it still fails in
 * the compiler rather than reporting a pass.
 */
export function isBuildMode(argv) {
  return argv.some((arg) => arg.toLowerCase() === '-b' || arg.toLowerCase() === '--build');
}

/**
 * Decides what this invocation is allowed to do.
 *
 * Exported and pure so the decision table is testable without spawning a process
 * and without a project on disk: the rules are the whole product, and a test that
 * had to run a real `tsc` to reach them would be a test about the environment.
 *
 * Order matters and is not alphabetical: a build-mode invocation is checked for
 * `--noCheck` FIRST, because build mode is the arm that would otherwise wave a
 * no-checking build through.
 */
export function decide(argv) {
  if (argv.some((arg) => NO_CHECK_FLAGS.has(arg))) {
    return { action: 'reject' };
  }
  if (isBuildMode(argv)) {
    return { action: 'delegate' };
  }
  if (argv.some((arg) => INSPECTION_FLAGS.has(arg))) {
    return { action: 'delegate' };
  }
  return { action: 'reject' };
}

/**
 * The refusal. It names the two commands that do work, because an error that
 * only says "no" is an obstacle and an error that says what to run instead is a
 * redirect.
 */
const REFUSAL = `tsc: refusing to run without build mode.

The root tsconfig.json is a solution stub — "files": [] plus three project
references — so this invocation type-checks ZERO files and exits 0. A zero there
is not a typecheck, it is the absence of one.

  whole project   npm run tsc                 (tsc -b over app, node and e2e)
  one project     npx tsc -b tsconfig.app.json

Build mode takes a project as its argument, so the narrow check is never lost.
`;

/**
 * Runs the guard. Given its streams and its exit function, so the tests drive the
 * real surface in-process and assert on the same text an operator would read.
 *
 * The entry point below calls THIS rather than repeating the decision, so the
 * rules have one implementation. A review found an exported `run()` that only
 * the tests called while production re-implemented the same three lines inline —
 * the exact "a second code path a reader has to verify" this repository treats
 * as a defect.
 */
export function run(argv, { err = process.stderr, exit = process.exit } = {}) {
  const decision = decide(argv);
  if (decision.action === 'reject') {
    err.write(REFUSAL);
    exit(1);
    return { delegated: false, code: 1 };
  }
  return { delegated: true, code: null };
}

/**
 * The real compiler's bin, reached only from build mode.
 *
 * Resolved from this file's own location rather than from PATH, and never
 * through a `node_modules` search. A worktree with no `node_modules` of its own
 * reaches this file through the PARENT checkout's bin link, so the relative
 * `../node_modules/typescript` is the parent's — which is the TypeScript that
 * installed the link, and therefore the right one. `fileURLToPath` rather than
 * `URL.pathname`, which percent-encodes and would corrupt a checkout path
 * containing a space.
 */
function realCompilerBin() {
  return fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
}

/**
 * Hands off to the real compiler in its own process.
 *
 * A child process rather than an `import()` of `lib/tsc.js` on purpose. Loading
 * TypeScript for its side effect works today (`_tsc.js` calls
 * `executeCommandLine` at module scope, with no `require.main` guard), but it
 * makes the guard responsible for reproducing argv, stdio, watch-mode tty and
 * exit codes that a normal `tsc` invocation would have got for free. The wrapper
 * that exists to add a refusal should not also become the thing that changes how
 * the compiler is invoked.
 */
function delegateToRealCompiler(argv) {
  const child = spawnSync(process.execPath, [realCompilerBin(), ...argv], { stdio: 'inherit' });
  if (child.error) {
    process.stderr.write(`tsc: the guard could not run the real compiler: ${child.error.message}\n`);
    process.exit(1);
  }
  // A signalled child reports a null status; 1 is the honest "did not pass".
  process.exit(child.status ?? 1);
}

/**
 * Whether this file was executed rather than imported.
 *
 * Compared as realpaths on both sides, because the bin entry is a SYMLINK to
 * this file: `process.argv[1]` is the link while `import.meta.url` is the target,
 * so a plain string comparison reports false and the guard would sit there
 * imported-but-inert, which is the exact silent-pass failure it exists to stop.
 */
function invokedAsCommand() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedAsCommand()) {
  const argv = process.argv.slice(2);
  if (run(argv).delegated) {
    delegateToRealCompiler(argv);
  }
}
