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
 * is the single path `npx tsc`, `tsc`, and `./node_modules/.bin/tsc` all resolve
 * through. There is no spelling of the trap that reaches the real compiler
 * without passing here first.
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
 * `-b` and `--build` are the only two spellings, and a real invocation puts the
 * flag ahead of the others (`tsc -b --listFiles`, which is what CI runs), so a
 * leading match would do. The whole list is scanned instead because that errs
 * toward allowing a build rather than refusing one: TypeScript itself treats a
 * trailing `-b` as an unknown option and errors (TS5023), so the loosest case
 * this accepts still fails in the compiler rather than reporting a pass.
 */
export function isBuildMode(argv) {
  return argv.includes('-b') || argv.includes('--build');
}

/**
 * Decides what this invocation is allowed to do.
 *
 * Exported and pure so the decision table is testable without spawning a process
 * and without a project on disk: the rules are the whole product, and a test that
 * had to run a real `tsc` to reach them would be a test about the environment.
 */
export function decide(argv) {
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
 */
export function run(argv, { out = process.stdout, err = process.stderr, exit = process.exit } = {}) {
  const decision = decide(argv);
  if (decision.action === 'delegate') {
    return { delegated: true, code: null };
  }
  err.write(REFUSAL);
  exit(1);
  return { delegated: false, code: 1 };
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
  const decision = decide(process.argv.slice(2));
  if (decision.action === 'reject') {
    process.stderr.write(REFUSAL);
    process.exit(1);
  }
  delegateToRealCompiler(process.argv.slice(2));
}
