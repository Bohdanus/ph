#!/usr/bin/env node
/**
 * The only sanctioned way to remove a worktree and its branch.
 * -------------------------------------------------------------
 * `docs/ORCHESTRATION.md` states the rule this program enforces: `dispose` means
 * delete it, `in-use` means leave it alone, and the answer is the `action` field
 * of the generated inventory. On 2026-10-01 that rule was true as a table and
 * false as a practice, and the cost was two days of one chat's work.
 *
 * WHAT WENT WRONG, because every check below is one of the things that was skipped
 * ------------------------------------------------------------------------------
 * A sweep chat ran a hard-coded nine-item list of `git worktree remove` and
 * `git branch -D`. One entry was a worktree a live chat had created thirty
 * minutes earlier and was still running tests in. The sweep had decided it was
 * disposable because a merge commit on `main` carried that branch's NAME in its
 * subject — a fourteen-hour-old merge of an unrelated dead branch — and never
 * asked whether the live tip was an ancestor of `main`. It was not.
 *
 * Every signal that said `in-use` existed and went unread:
 *
 * - the inventory's own `action` for that worktree, which the sweep bypassed by
 *   hard-coding a list instead of reading the generated file;
 * - a live session in `kilo.db`, updated seconds earlier;
 * - two unreleased `file_locks` rows in the board naming the worktree path and
 *   the branch, released only after the owner landed its work.
 *
 * The pre-flight it DID run asked whether the tree was clean, which reads the
 * same for an abandoned worktree and a busy one. This program asks who owns it.
 *
 * WHY A PROGRAM AND NOT A RULE IN THE DOCUMENTATION
 * --------------------------------------------------
 * `main-worktree-guard.mjs` documents why: the agent that needs this rule is
 * mid-task, holding a list of nine paths, and will not re-read a document before
 * the destructive command. Every check here is therefore a question with a
 * machine answer, asked immediately before the irreversible step, and every
 * refusal names the file, row or field that produced it.
 *
 * WHY THERE IS NO `--force`
 * -------------------------
 * `git worktree remove` refuses a dirty worktree and prints the modified and
 * untracked paths — the cheapest inventory of uncommitted work in the
 * repository, delivered before the only irreversible step. The second half of
 * that incident was a chat re-running the identical command with `--force` six
 * seconds after that refusal. So this program does not accept the flag: a dirty
 * tree is a finding to report, not an obstacle to route around. Work that must
 * be preserved is preserved by refusing, and by `salvage()` below for the
 * caller who reaches it directly.
 *
 * WHY THE SALVAGE IS NOT A SAFETY NET YOU CAN RELY ON
 * ---------------------------------------------------
 * `preflight` refuses `dirty-tree` and `ignored-content` BEFORE `dispose()` runs,
 * and there is no `--force` and no override, so through this CLI `salvage()` is
 * only ever reached with a tree the refusal already cleared — where it correctly
 * writes nothing. It is a function for a caller that has already decided, not a
 * stage of this program.
 *
 * An earlier version of this file claimed salvage was the thing that made removal
 * safe after a human decision, and `docs/ORCHESTRATION.md` repeated it as a
 * guarantee. That was a description of an intention. It was also, for a while,
 * accidentally FALSE in the other direction: while the ignored-content gate was
 * parsing git's output with the wrong delimiter it reported one entry instead of
 * 394, so a tree holding only gitignored content passed the refusal and reached
 * `salvage()`. The salvage is what stopped that particular loss, by luck rather
 * than by design, because `dispose()` records `SALVAGE INCOMPLETE` as a step and
 * removes the worktree regardless. So: the refusal is the guarantee, the salvage
 * is a backstop, and a backstop that a tar error can defeat is not one to rely
 * on.
 *
 * THE ORDER OF OPERATIONS IS THE POINT
 * ------------------------------------
 * Anchor, then salvage, then remove the worktree, then delete the branch with
 * `-d`. The anchor (`refs/keep/disposed/<name>`) means no `git gc` can make a
 * disposed branch unreachable, which converts "irreversible" into "reversible
 * with one command" at the cost of a single ref. `git branch -d` refuses an
 * unmerged branch, and that refusal is the ordinary guard on the last step. A
 * generated `patchEquivalence: "absorbed"` disposal is the explicit exception:
 * it anchors first, then uses guarded `-D` because patch absorption does not
 * imply ancestry.
 *
 * NOT A SUBSTITUTE FOR READING THE INVENTORY
 * -------------------------------------------
 * This program enforces that the answer is the generated `action`; it does not
 * decide what the answer is. A worktree the inventory calls `at-risk` because a
 * curated finding protects it stays exactly where it is.
 */

import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readBoard } from './lib/worktree-inventory/board.mjs';
import { resolveSessionDb } from './lib/worktree-inventory/chats.mjs';
import { ACTION, LIVE_WINDOW_MS } from './lib/worktree-inventory/classify.mjs';
import { SCHEMA_VERSION } from './lib/worktree-inventory/assemble.mjs';
import {
  abortCommand,
  readOperations,
  resolveAdminDirFor,
  resolveCommonDir,
  resolveGitDir,
  unmergedPaths,
} from './lib/git-operation-state.mjs';
import { listWorktrees } from './lib/worktree-inventory/git.mjs';

/**
 * How old the inventory may be before the disposal is refused.
 *
 * `docs/ORCHESTRATION.md` says a `land` is "only as fresh as `generatedAt`" and
 * that the least trustworthy entries are the ones with no liveness signal at
 * all. A disposal is the decision that cannot be taken back, so it gets the
 * strict reading: the file must have been generated after the worktree was last
 * known to be untouched by its owner. Fifteen minutes is short enough to be
 * inside one working session and long enough to cover one generation of the
 * inventory, which measures ~150s wall on this repository at 99 worktrees.
 */
export const MAX_INVENTORY_AGE_MS = 15 * 60 * 1000;

/** Where the anchor and the salvage land. One directory, named per worktree. */
export const KEEP_REF_PREFIX = 'refs/keep/disposed/';

/**
 * The refusals, as data.
 *
 * Every one names the thing that produced it, because a refusal an operator
 * cannot act on is indistinguishable from a bug: the difference between "the
 * board holds two locks" and "the board was unavailable" is the difference
 * between waiting and proceeding.
 */
/**
 * The refusal messages, as data. Exported so a test can assert on the WORDS of a
 * refusal it cannot otherwise reach — `prunable` needs a registration shape no
 * `preflight` case builds, and a message that recommends an irreversible command is
 * exactly the kind of thing a reader should be able to check without constructing the
 * whole state around it.
 */
export const REFUSALS = {
  'unknown-worktree': (t) =>
    `No worktree named "${t}" in \`git worktree list\`. Name it exactly as \`git worktree list\` does.`,
  'main-worktree': () =>
    'This is the main checkout. It is never a deletion candidate — it is the landing site every other session resolves paths through.',
  detached: () => 'HEAD is detached, so there is no branch to delete and no name to anchor. Resolve the branch first.',
  'no-branch': () => 'This worktree reports no branch, so there is nothing safe to delete after the worktree goes.',
  locked: (reason) =>
    `This worktree is \`git worktree lock\`ed${reason ? ` (${reason})` : ''}, so somebody marked it as not-to-be-touched by hand. Unlock it yourself if that is stale; do not force past it.`,
  prunable: (reason) =>
    `\`git worktree list\` still reports this worktree but ${reason}. Its directory is gone or its administrative entry is stale. \`npm run repo:state\` first: if it reports an operation in progress for it, the administrative directory still holds resolution state and \`git worktree prune\` DELETES it with no reflog entry and nothing for \`git fsck\` to recover — carry that state out by hand before pruning. If it reports nothing, run \`git worktree prune\`, then re-generate the inventory.`,
  'no-tip': () =>
    'Git cannot read a tip commit for this worktree, so there is nothing to anchor and no proof of what would be removed.',
  'board-unavailable': (detail) =>
    `The board database could not be read (${detail}), so the claims, file locks and live agents that would say whether this worktree is in use are all unknown. An absent signal is not an unowned worktree — restore the board, or ask the operator.`,
  'sessions-unavailable': (detail) =>
    `The Kilo session database could not be read (${detail}), so a chat with this worktree as its \`directory\` cannot be ruled out. An absent signal is not an absent chat.`,
  'derived-live-writer': (ids) =>
    `The inventory records this worktree as derived-live: ${ids} wrote a file in it inside the live window. \`classify.mjs\` reports \`live\` as false only when \`--no-live-writers\` suppressed it, so the \`dispose\` beside it is a suppression, not a clearance.`,
  'inventory-missing': () =>
    'WORKTREES.json is absent or uses an unsupported schema. Run `node scripts/worktree-inventory.mjs` first — a disposal without a current inventory is a guess.',
  'inventory-version': (actual) =>
    `WORKTREES.json uses schema version ${actual ?? 'unknown'}, but this disposer requires version ${SCHEMA_VERSION}. Regenerate it before disposal.`,
  'inventory-stale': (offsetFromNowMs, generatedAt) => {
    const relativeTime = !Number.isFinite(offsetFromNowMs)
      ? 'at an invalid time'
      : offsetFromNowMs < 0
        ? `in ${Math.round(-offsetFromNowMs / 60000)} min`
        : `${Math.round(offsetFromNowMs / 60000)} min ago`;
    return `WORKTREES.json was generated ${relativeTime} (${generatedAt}), outside the ${MAX_INVENTORY_AGE_MS / 60000} min limit. Re-run \`node scripts/worktree-inventory.mjs\` and read the new verdict; a decision about a live worktree is exactly the one that goes stale.`;
  },
  'inventory-base-moved': (inventoryHead, currentHead) =>
    `The no-op merge proof was recorded against main ${inventoryHead ?? '(unknown)'}, but main is now ${currentHead ?? '(unknown)'}. Regenerate the inventory and re-evaluate the merge result before removing this branch.`,
  'inventory-evaluation-stale': (offsetFromNowMs, evaluationAt) => {
    const relativeTime = !Number.isFinite(offsetFromNowMs)
      ? 'at an invalid time'
      : offsetFromNowMs < 0
        ? `in ${Math.round(-offsetFromNowMs / 60000)} min`
        : `${Math.round(offsetFromNowMs / 60000)} min ago`;
    return `WORKTREES.json evaluated liveness ${relativeTime} (${evaluationAt}), outside the ${MAX_INVENTORY_AGE_MS / 60000} min limit. Re-run \`node scripts/worktree-inventory.mjs\` without \`--now\`; a pinned clock cannot authorize disposal.`;
  },
  'not-in-inventory': () =>
    'The inventory has no entry for this worktree, so its action is unknown. Regenerate, or add a curated entry if it is a real finding.',
  'inventory-not-prunable': () =>
    'The fresh inventory does not mark this record prunable. Regenerate it before disposal; an action-only record is not enough to justify deletion.',
  'action-not-dispose': (action) =>
    `The inventory says \`action: "${action}"\`, not \`"${ACTION.DISPOSE}"\` and not \`"${ACTION.LEGACY}"\`. Per docs/ORCHESTRATION.md that is not a deletion candidate — \`in-use\` means leave it alone, \`keep\` means leave it alone, \`land\` means merge it, \`at-risk\` means save it, \`undecided\` means do not remove it. A \`legacy\` action would have said the worktree is removable with the branch kept.`,
  'must-not-prune': () =>
    'A curated finding sets `mustNotPrune`, which vetoes `dispose` as well as `land`. It records work git cannot see in a clean tree.',
  'board-claim': (rows) =>
    `The board holds ${rows} live claim(s) on this worktree. An agent has declared it theirs; only the operator may stop a writing chat.`,
  'board-lock': (rows) =>
    `The board holds ${rows} live file lock(s) naming this worktree. Held locks are released by the agent that took them, not taken from it.`,
  'board-agent-live': (rows) =>
    `${rows} board agent(s) were seen in this worktree inside the last ${LIVE_WINDOW_MS / 60000} min.`,
  'live-session': (rows) =>
    `${rows} Kilo session(s) have this worktree as their directory and were active inside the last ${LIVE_WINDOW_MS / 60000} min. A session's \`directory\` is where it was OPENED, so its absence is not evidence of abandonment — only its presence is evidence of life.`,
  'dirty-tree': (modified, untracked, paths) =>
    `The working tree holds ${modified} modified and ${untracked} untracked path(s), so uncommitted work exists in no commit and no ref: ${paths.slice(0, 8).join(', ')}${paths.length > 8 ? `, +${paths.length - 8} more` : ''}. Commit it, carry it to a worktree as a patch, or let the inventory classify it — do not remove the directory.`,
  'dirty-tree-unreadable': (detail, command) =>
    `\`${command ?? 'git status'}\` failed on this worktree (${detail}), so what it would have reported is UNKNOWN rather than clean. This program will not read an unreadable tree as an empty one; restore the worktree's git state, or ask the operator.`,
  'ignored-content': (count, paths) =>
    `The working tree holds ${count} gitignored path(s) that no command rebuilds, so they exist in no commit, no ref and no reflog: ${paths.slice(0, 8).join(', ')}${paths.length > 8 ? `, +${paths.length - 8} more` : ''}. \`git status\` does not list these, which is why a tree holding only them reads as clean. Commit them with \`git add -f\`, or move them out, before removing the directory.`,
  'operation-in-progress': (detail, remedy, ownership, remedyless) =>
    `A git operation is in progress in this worktree, and removing the directory deletes the state files that are its only record: ${detail}. Nothing about it is in a commit, a ref or the reflog, so this is unrecoverable rather than merely inconvenient. ` +
    (remedy
      ? `Finish or abandon it deliberately — ${remedy} — and re-run this. If every conflict is already resolved, COMMIT it instead: the abort throws the resolution away, which is the one outcome this refusal exists to prevent. `
      : remedyless
        ? `Git has no command that abandons ${remedyless}, so there is nothing to run: finish or commit the resolution there, or reset the worktree by hand. `
        : `No operation marker is set, so no abort will clean this up — inspect \`git diff --name-only --diff-filter=U\` there and resolve or stage it by hand. `) +
    (ownership ?? ''),
  'operation-state-unreadable': (detail, command) =>
    `\`${command}\` failed while reading this worktree's git state (${detail}), so whether an operation is in progress is UNKNOWN rather than no. This program will not read an unreadable state as a clear one; restore the worktree's git state, or ask the operator.`,
  'operation-state-absent': () =>
    'No git operation state was supplied for this worktree, so the check that protects unrecoverable merge and rebase state never ran. An absent check is not a clear worktree. This is a bug in the caller, not a verdict about the tree.',
};

/**
 * Ignored paths this program treats as absent, because a command rebuilds them.
 *
 * THE GAP THIS CLOSES. \`git status --porcelain\` honours \`.gitignore\`, and so
 * does \`ls-files --others --exclude-standard\`, which is what \`salvage()\` reads.
 * So a worktree whose ONLY uncommitted content is gitignored reads CLEAN to the
 * dirty-tree gate and is ARCHIVED BY NOTHING — and \`git worktree remove\` deletes
 * it unconditionally. Reproduced on a scratch repo: a worktree holding a \`.env\`
 * and a \`dist/\` reported zero modified and zero untracked, and the tool printed
 * \`dispose: live disposed. EXIT=0\`; the secret was then gone from every ref and
 * from the object store, unrecoverable.
 *
 * WHY NOT SIMPLY REFUSE ON ANY IGNORED FILE. Because that refuses every
 * worktree in this repository. Measured on a real one at 53 ignored entries:
 * 33 under \`node_modules/\`, 18 under \`dist/\`, one \`tsconfig.tsbuildinfo\`, one
 * \`.kilo/\`. A guard with no exceptions is a guard nobody runs — and an earlier
 * review already shipped that mistake here, making the tool refuse on any absent
 * board until the happy path in a plain clone stopped working.
 *
 * SO THE ALLOWLIST IS THE EXCEPTION, AND EVERYTHING ELSE COUNTS AS DIRT. The
 * default is protection: a path not named here is treated as real work. Each
 * entry carries the command that rebuilds it, because an entry nobody can
 * regenerate is an entry that should not be here.
 *
 * \`.serena/\` IS on this list, and it was the seventh dead worktree before it was:
 * the index flagged \`.serena/\` alone as a reason it could never be free. It is
 * almost entirely machine-written — \`project.yml\` and \`project.local.yml\`
 * are regenerated by the MCP server on its next activation in that directory,
 * and \`cache/\` is a symbol index it rebuilds from source — so treating it as
 * content protected nothing and blocked a real cleanup. \`.serena/memories/\` is
 * the exception and is NOT rebuildable, so it carries an \`except\` list; see
 * PROTECTED_BENEATH.
 *
 * Deliberately NOT on this list: \`.vscode/*\`, \`*.local\`,
 * \`playwright/.auth\`, \`.DS_Store\`, and \`*.log\`. They are ignored, which is a
 * statement about version control and not about whether they are worth
 * anything — an auth state and a session index are both real work.
 *
 * An entry here that git does not actually ignore is dead weight: \`ls-files
 * --ignored\` can never report it, so it relaxes nothing. \`.husky/_\` was one,
 * removed after \`git check-ignore -v .husky/_\` reported it unignored — as
 * untracked-but-not-ignored it already trips \`dirty-tree\`, which is the correct
 * place for it.
 */
const REGENERABLE_IGNORED = [
  { prefix: 'node_modules', rebuild: 'npm ci' },
  { prefix: 'dist', rebuild: 'npm run build' },
  { prefix: 'dist-ssr', rebuild: 'npm run build' },
  { prefix: 'coverage', rebuild: 'npm run test -- --coverage' },
  { prefix: 'coverage-e2e', rebuild: 'npm run test:e2e:unit:coverage' },
  { prefix: 'test-results', rebuild: 'npm run test:e2e' },
  { prefix: 'playwright-report', rebuild: 'npm run test:e2e' },
  { prefix: 'blob-report', rebuild: 'npm run test:e2e' },
  { prefix: 'playwright/.cache', rebuild: 'npm run test:e2e' },
  { prefix: '.vite', rebuild: 'npm run dev' },
  { prefix: '.vitest', rebuild: 'npm run test' },
  { prefix: '.kilo', rebuild: 'this worktree is disposable; nothing in it is committed anywhere' },
  { prefix: '.eslintcache', rebuild: 'npm run lint:check' },
  { prefix: 'tsconfig.tsbuildinfo', rebuild: 'npm run tsc' },
  { prefix: 'WORKTREES.json', rebuild: 'node scripts/worktree-inventory.mjs' },
  {
    prefix: '.serena',
    rebuild:
      'the serena MCP server rewrites project.yml and reindexes the language server on its next activation in this directory',
    // `.serena/memories/` is where an agent writes notes to itself. They are on no
    // ref and no command rebuilds them, so a blanket `.serena` entry would make
    // the only surviving record of a dead session's thinking disposable.
    except: ['memories'],
  },
];

/**
 * Ignored paths that hold real work DESPITE sitting inside an allowlisted
 * directory, and must therefore be looked for on disk.
 *
 * WHY A DISK WALK AND NOT A PATH PREFIX. `ls-files --others --ignored
 * --exclude-standard --directory` — the exact invocation `readGitState` and
 * `salvage` both use, `--directory` being there so `node_modules` reports as one
 * entry rather than 18,901 files — COLLAPSES a fully ignored directory to its
 * own name. On a worktree holding only the three files serena writes, it
 * reports `.serena/` and not one of them. So a prefix check on the reported path
 * cannot see `.serena/memories/` even in principle: the entry that reached it
 * never named a memory. Verified on a real worktree — with and without a file
 * under `memories/`, the reported path is `.serena/` both times.
 *
 * WHICH MEANS THE NARROW ALLOWLIST IS NOT AVAILABLE. Allowlisting
 * `.serena/cache` and `.serena/project.yml` instead of `.serena` would relax
 * nothing at all, because neither can ever be the string git hands this program;
 * they would be dead weight in the sense the comment above already records for
 * `.husky/_`. The parent has to be the entry, and the exception has to be
 * resolved against the filesystem.
 *
 * SO AN EXCEPTION IS CHECKED BY WALKING IT, AND A FAILURE TO READ IS CONTENT.
 * An unreadable `memories/` counts as present, which is the fail-closed
 * direction and matches every other detection-fails-open-explicitly decision
 * here: this is policy, not detection.
 */
const PROTECTED_BENEATH = [
  ...REGENERABLE_IGNORED.filter((entry) => entry.except).flatMap((entry) =>
    entry.except.map((sub) => `${entry.prefix}/${sub}`)
  ),
  // A disposable checkout can itself contain a child worktree with live work.
  '.kilo/worktrees',
];

/**
 * True when no command rebuilds this ignored path.
 *
 * A \`*.log\` file is on neither side of this: it is not in the list, so it counts
 * as content, and that is the intended reading — a log is the record of what a
 * dead session was doing when it died, and it is the one ignored file class a
 * cleanup sweep most often throws away by accident.
 *
 * A path inside a `PROTECTED_BENEATH` exception is content even though its
 * parent directory is allowlisted, so this answers false for it. That is belt to
 * `protectedContentOnDisk`'s braces: it holds when git happens to report a
 * protected path by name, which it does not do when it collapses the directory.
 */
export function isRegenerableIgnored(path) {
  if (PROTECTED_BENEATH.some((prefix) => coversPath(prefix, path))) return false;
  return REGENERABLE_IGNORED.some((entry) => coversPath(entry.prefix, path));
}

/**
 * The protected paths that exist on disk inside an allowlisted directory.
 *
 * Returns repository-relative paths, so a caller can tar them, and returns them
 * ALL rather than stopping at the first: the refusal message is more useful with
 * the whole set, and one walk either way.
 *
 * Only paths that git reported as an ignored DIRECTORY are worth walking, which
 * is what keeps this off the hot path — `node_modules` is not a candidate, and
 * `ls-files` already enumerated it as one entry.
 */
export function protectedContentOnDisk(root, ignoredPaths) {
  const found = [];
  for (const path of ignoredPaths) {
    // git's `--directory` mode marks a collapsed directory with a trailing slash.
    // A file path has none, and cannot contain a nested subtree.
    if (!path.endsWith('/')) continue;
    // The match runs the OTHER way round from `coversPath`, and has to: git
    // reports the ANCESTOR `.serena/` and the prefix is `.serena/memories`, so
    // `coversPath(prefix, path)` is false for every collapsed directory and this
    // function would return nothing for the exact case it exists to handle.
    const collapsed = path.replace(/\/$/, '');
    for (const prefix of PROTECTED_BENEATH) {
      if (!coversPath(collapsed, prefix)) continue;
      const absolute = join(root, prefix);
      try {
        if (existsSync(absolute) && readdirSync(absolute).length > 0) found.push(`${prefix}/`);
      } catch {
        found.push(`${prefix}/`);
      }
    }
  }
  return found;
}

/**
 * Whether `prefix` covers `path` at a SEGMENT boundary.
 *
 * `startsWith` alone is how `dist-secrets/keys.txt` ended up treated as
 * regenerable output of `dist/` — a sibling directory one character away, and a
 * place a secret plausibly lives. The boundary is what keeps the allowlist an
 * allowlist: `dist` covers `dist` and `dist/assets/x.js`, and nothing else.
 *
 * The prefix is matched anywhere in the path, not only at the start, because git
 * matches these patterns at any depth and a worktree's `node_modules` is nested
 * inside the checkout that contains it.
 */
function coversPath(prefix, path) {
  let from = 0;
  for (;;) {
    const at = path.indexOf(prefix, from);
    if (at === -1) return false;
    const before = at === 0 ? '/' : path[at - 1];
    const after = path[at + prefix.length];
    if ((before === '/' || before === undefined) && (after === '/' || after === undefined)) return true;
    from = at + 1;
  }
}

/** The ignored paths a disposal would destroy, with the command for each that rebuilds one. */
export function nonRegenerableIgnored(paths) {
  return paths.filter((path) => !isRegenerableIgnored(path));
}

/** The rebuild command for an ignored path, or null when nothing rebuilds it. */
export function rebuildCommand(path) {
  if (PROTECTED_BENEATH.some((prefix) => coversPath(prefix, path))) return null;
  const entry = REGENERABLE_IGNORED.find((e) => coversPath(e.prefix, path));
  return entry ? entry.rebuild : null;
}

/**
 * Is an ownership source ABSENT, or is it present and unreadable?
 *
 * The distinction is the whole point, and it is why a missing `board.db` does not
 * make this program unusable: `board.mjs` documents a board that has never
 * existed as a NORMAL state — a fresh clone has no coordination database — and
 * degrades to an empty result for exactly that reason.
 *
 * - **Never existed.** Nothing has ever been recorded there, so zero rows is the
 *   TRUE answer and no signal is being missed. Available, and empty.
 * - **Present but unreadable or unqueryable.** Rows exist that this process
 *   cannot see. That is the incident: the board held two live file locks naming a
 *   worktree and nothing read them. Refuse.
 * - **Readable.** Whatever the reader returned is the answer, empty or not.
 *
 * Pure and exported so the rule can be tested on its own; the alternative is a
 * rule that only lives inside a database path no in-process test can reach.
 */
export function resolveAvailability({ dbPath, available, error = null }) {
  if (available) return { available: true, neverExisted: false, error: null };
  if (dbPath !== null && dbPath !== undefined && !existsSync(dbPath)) {
    return { available: true, neverExisted: true, error: null };
  }
  return { available: false, neverExisted: false, error: error ?? 'present but unreadable' };
}

/**
 * The decision. Pure, and every input injected, so the whole rule set is
 * testable without a repository, a board or a session database on disk — which
 * is what lets its suite stay inside the fast budget instead of spawning git.
 *
 * `gitState`, `inventory`, `board` and `sessions` are described by
 * {@link readGitState}, {@link readInventory} and {@link collectOwnership}.
 */
export function preflight({
  target,
  nowMs = Date.now(),
  gitState,
  operationState,
  inventory,
  board,
  sessions,
  maxAgeMs = MAX_INVENTORY_AGE_MS,
  preserveBranch = false,
} = {}) {
  const failures = [];
  const refuse = (code, ...args) => failures.push({ code, message: REFUSALS[code] ? REFUSALS[code](...args) : code });
  // Read ONCE, beside the inventory checks, and passed to `dispose()`. It is the
  // difference between removing a directory and removing a branch, and deriving
  // it twice from two reads of the same field is how the two halves stop
  // agreeing — the inventory is a regenerable file, so a second read after a
  // regeneration would be a second answer.
  const keepBranch = preserveBranch || inventory?.record?.action === ACTION.LEGACY;
  let deleteUnmergedBranch = false;
  let deleteReason = null;

  if (!gitState?.found) {
    refuse('unknown-worktree', target);
    return { ok: false, failures, record: null };
  }
  // The main checkout can be a linked worktree when the repository root is a
  // bare working directory. Protect the base branch independently of Git's
  // `isPrimary` marker so a stale inventory cannot classify it for removal.
  if (gitState.isPrimary || gitState.branch === 'main') refuse('main-worktree');
  if (gitState.detached) refuse('detached');
  // `readGitState` writes one of two parenthesised placeholders when
  // `git worktree list --porcelain` gave no `branch` line. They are matched by
  // identity rather than by shape: `(` is a LEGAL character in a branch name
  // (`git check-ref-format 'refs/heads/(weird)'` exits 0), so a shape test like
  // `/^[(]/` refuses a real branch and reports a state that does not exist. A
  // guard whose refusals are sometimes false trains its reader to discount them.
  if (PLACEHOLDER_BRANCHES.has(gitState.branch) || !gitState.branch) refuse('no-branch');
  // The two shapes `listWorktrees` parses that this guard used to discard. Both
  // describe a worktree in a state it must not delete, and both used to reach
  // git: a locked one produced an uncaught `fatal: cannot remove a locked working
  // tree; use 'remove -f -f'`, and a prunable one passed as CLEAN because a
  // failed `status --porcelain` is indistinguishable from an empty one.
  if (gitState.locked) refuse('locked', typeof gitState.locked === 'string' ? gitState.locked : null);
  if (gitState.prunableReason) refuse('prunable', gitState.prunableReason);
  if (!gitState.tip) refuse('no-tip');

  if (!inventory?.ok) {
    if (inventory?.reason === 'missing') refuse('inventory-missing');
    else if (inventory?.reason === 'version') refuse('inventory-version', inventory.version);
    else refuse('not-in-inventory');
  } else {
    const offsetFromNowMs = nowMs - inventory.generatedAtMs;
    if (!Number.isFinite(offsetFromNowMs) || offsetFromNowMs < 0 || offsetFromNowMs > maxAgeMs) {
      refuse('inventory-stale', offsetFromNowMs, inventory.generatedAt);
    }
    const evaluationOffsetMs = nowMs - inventory.evaluationAtMs;
    if (!Number.isFinite(evaluationOffsetMs) || evaluationOffsetMs < 0 || evaluationOffsetMs > maxAgeMs) {
      refuse('inventory-evaluation-stale', evaluationOffsetMs, inventory.evaluationAt);
    }
    if (!inventory.record) refuse('not-in-inventory');
    else {
      // `legacy` IS a disposal candidate, and the check that separates it from
      // `dispose` is the one below rather than this one. A legacy worktree is
      // clean by the branch that classified it, so everything here that protects
      // a live, dirty or in-flight worktree applies to it unchanged; the only
      // thing that differs is whether the BRANCH goes with the directory, and
      // `dispose()` answers that.
      const staleBranchRemoval = preserveBranch && inventory.record.action === ACTION.AT_RISK;
      if (
        inventory.record.action !== ACTION.DISPOSE &&
        inventory.record.action !== ACTION.LEGACY &&
        !staleBranchRemoval
      ) {
        refuse('action-not-dispose', inventory.record.action);
      }
      if (inventory.record.action === ACTION.DISPOSE && inventory.record.prunable !== true) {
        refuse('inventory-not-prunable');
      }
      const noOpMerge =
        inventory.record.action === ACTION.DISPOSE &&
        inventory.record.mergedIntoMain === false &&
        inventory.record.patchEquivalence !== 'absorbed' &&
        inventory.record.mergeResultMatchesBase === true;
      const noOpMergeBaseMatches =
        inventory.base === 'main' && typeof inventory.mainHead === 'string' && inventory.mainHead === gitState.mainHead;
      if (noOpMerge && !noOpMergeBaseMatches) {
        refuse('inventory-base-moved', inventory.mainHead, gitState.mainHead);
      }
      deleteUnmergedBranch =
        inventory.record.action === ACTION.DISPOSE &&
        inventory.record.mergedIntoMain === false &&
        (inventory.record.patchEquivalence === 'absorbed' || (noOpMerge && noOpMergeBaseMatches));
      if (deleteUnmergedBranch) {
        deleteReason = inventory.record.patchEquivalence === 'absorbed' ? 'patch-absorbed' : 'merge-tree-no-op';
      }
      if (inventory.record.mustNotPrune) refuse('must-not-prune');
      // The liveness arm this guard used to re-derive from two channels that
      // structurally cannot see the chat in question, while the signal was
      // already in the record it had read. `classify.mjs` forces `live` to false
      // under `--no-live-writers` and keeps `derivedLive` beside it, so
      // `action: "dispose"` and a live write history can legitimately appear
      // together — the first is a suppression, not a clearance.
      const derived = inventory.record.writeHistory?.derivedChatIds ?? [];
      if (inventory.record.derivedLive === true || derived.length > 0) {
        refuse('derived-live-writer', derived.length > 0 ? derived.join(', ') : 'a chat');
      }
    }
  }

  // Re-read the tree rather than trusting the inventory's snapshot: the whole
  // incident is a verdict generated at 23:38 acted on at 00:44. A worktree can
  // be committed to, or made dirty, in the interval between the two.
  //
  // The unreadable case comes FIRST, because it is the one that makes the check
  // below meaningless: a `git status` that failed leaves the counts at zero, and
  // zero is what a clean tree reports. Checking dirtiness against counts that a
  // failure could have produced is how an unreadable tree became a clean one.
  if (gitState.statusError) {
    // NAMES THE COMMAND THAT FAILED, because the try block covers `status` AND
    // `ls-files`. Reporting every failure as "`git status` failed" produced the
    // self-contradicting `git status failed (Command failed: git ls-files ...)`.
    const command = String(gitState.failedCommand ?? '').match(/git (status|ls-files)\b/)?.[1] ?? 'git status';
    refuse('dirty-tree-unreadable', gitState.statusError, `git ${command}`);
  }

  if (!preserveBranch && (gitState.modified ?? 0) + (gitState.untracked ?? 0) > 0) {
    refuse('dirty-tree', gitState.modified, gitState.untracked, gitState.dirtyPaths ?? []);
  }

  // The content `git status` cannot see, minus what a command rebuilds.
  if ((gitState.ignoredWork ?? []).length > 0) {
    refuse('ignored-content', gitState.ignoredWork.length, gitState.ignoredWork);
  }

  // An operation in progress is the content NO probe in this file can see, and
  // `readGitState` cannot see it either: it reads porcelain status, which
  // reports a `UU` path as an ordinary modification and reports a bisect as
  // nothing at all. So this state reaches the dirty-tree check above as either a
  // count that happens to be zero or a count that means something else.
  //
  // It is checked HERE, after the tree has been found and its branch and tip
  // confirmed, because it is the only check that can be the last one before
  // `git worktree remove` deletes `.git/worktrees/<name>/` — and that directory
  // is the ONLY place a merge's conflict list and `MERGE_HEAD` exist. Removing a
  // worktree mid-merge destroys resolution work with no reflog entry and nothing
  // for `git fsck` to recover, which makes this a precondition and not a warning.
  //
  // The unreadable case refuses for the same reason `dirty-tree-unreadable` does,
  // and it is checked in the same order: a state this program could not read is
  // not a state it may report as clear.
  const state = operationState;
  if (state === undefined || state === null) {
    // FAIL CLOSED on an absent SIGNAL, which is the rule the board and session
    // checks above already follow for the same reason: a missing input is not an
    // empty answer. Skipping this check when the caller forgot it would leave the
    // one piece of state that is unrecoverable if destroyed as the one piece of
    // state that can be missed by omission.
    refuse('operation-state-absent');
  } else if (state.readError) {
    refuse('operation-state-unreadable', state.readError, 'git diff --name-only --diff-filter=U');
  } else if (state.operations.length > 0 || state.unmerged.length > 0) {
    const named = state.operations.map((o) => `${o.operation} (${o.marker}${o.value ? ` -> ${o.value}` : ''})`);
    const unmerged = state.unmerged.length > 0 ? [`${state.unmerged.length} unmerged path(s) in the index`] : [];
    // No remedy name when there is no command to name. `git merge --abort` does nothing
    // for an unresolvable index with no operation behind it, and a squash has no abandon
    // command at all; a refusal that names a command which cannot work is the same defect
    // as a report that calls such a state clean. Those two are different sentences, so
    // they are told apart here: `remedyless` names the operation git cannot abandon, and
    // is null when there is no marker at all. `repo-state-gate.mjs` must advise the same
    // way about the same state.
    const remedy = state.operations.map(abortCommand).filter(Boolean).join(' / ');
    const remedyless =
      remedy === '' && state.operations.length > 0
        ? state.operations
            .filter((o) => abortCommand(o) === null)
            .map((o) => `a ${o.operation}`)
            .join(' or ')
        : null;
    refuse(
      'operation-in-progress',
      [...named, ...unmerged].join(', '),
      remedy,
      liveSignal(board, sessions),
      remedyless
    );
  }

  // Ownership, from three independent sources. ANY of them means somebody is
  // there. This is the check the sweep's `git status --porcelain` probe could
  // not make, and it is the one that would have saved the worktree.
  //
  // AN UNAVAILABLE SOURCE IS A REFUSAL, NOT AN EMPTY SET. `readBoard` and the
  // session reader both degrade to empty rather than throwing — a documented and
  // correct contract for a generator — which meant a missing board.db and a
  // missing kilo.db each produced zero rows, and zero rows looked exactly like an
  // unowned worktree. Measured before this check existed: with both databases
  // absent and a valid `dispose` record present, this program printed "is clear
  // to dispose", exited 0, and would have removed it.
  if (board?.available === false) refuse('board-unavailable', board.error ?? board.dbPath ?? 'no board database');
  if (sessions?.available === false)
    refuse('sessions-unavailable', sessions.error ?? sessions.dbPath ?? 'no session database');
  if ((board?.claims?.length ?? 0) > 0) refuse('board-claim', board.claims.length);
  if ((board?.fileLocks?.length ?? 0) > 0) refuse('board-lock', board.fileLocks.length);
  if ((board?.liveAgents?.length ?? 0) > 0) refuse('board-agent-live', board.liveAgents.length);
  if ((sessions?.live?.length ?? 0) > 0) refuse('live-session', sessions.live.length);

  return {
    ok: failures.length === 0,
    failures,
    record: inventory?.record ?? null,
    keepBranch,
    deleteUnmergedBranch,
    deleteReason,
    expectedBaseHead: inventory?.mainHead ?? null,
  };
}

/**
 * The two values `readGitState` writes when porcelain gave no `branch` line.
 *
 * Matched by identity, and a closed set rather than a shape, for the reason in
 * `preflight`: `(` is legal in a branch name.
 */
export const PLACEHOLDER_BRANCHES = new Set(['(detached)', '(unknown)']);

/**
 * Everything about the target that git can answer, and nothing it cannot.
 *
 * `git worktree list --porcelain` is the only enumeration; a target is matched
 * on its resolved realpath, because macOS reports `/private/var/...` for a path
 * reached through `/var` and a string comparison would miss it.
 *
 * PARSED BY `listWorktrees`, NOT BY A SECOND LOOP HERE
 * ---------------------------------------------------
 * This used to hand-roll its own porcelain parser over three fields and discard
 * the rest. `scripts/lib/worktree-inventory/git.mjs` already parses six on the
 * same output, including `locked` and `prunableReason` — the two that describe a
 * worktree this program must refuse to touch, and the two whose absence made it
 * crash on a locked tree and pass a prunable one as clean. Two parsers of one git
 * format will drift when git adds a field; a strict subset is a scheduled bug.
 */
export function readGitState(cwd, target, { run = defaultRun, list = listWorktrees } = {}) {
  let entries;
  try {
    entries = list(cwd);
  } catch (err) {
    return { found: false, listError: firstLine(err) };
  }
  if (!Array.isArray(entries)) return { found: false, listError: 'git worktree list returned invalid data' };
  if (entries.length === 0) return { found: false, listError: 'git worktree list returned no worktrees' };

  const wanted = realpathIfExists(resolve(cwd, target));
  let match = entries.find((e) => realpathIfExists(e.path) === wanted);
  // A bare NAME is what the inventory, the curated table and every document use,
  // and resolving it against cwd is wrong whenever cwd is itself a worktree: from
  // inside `.kilo/worktrees/task`, `task` resolves to a path that cannot exist.
  // So a name with no separator falls back to matching the basename.
  //
  // WHICH MUST NOT BE `find`. Git refuses to create two worktrees at the same
  // PATH, so a path is unique; it says nothing about a BASENAME, and this repo
  // registers worktrees under `.kilo/worktrees/` AND under the temp directory,
  // where `a` and `b` can both hold a `verify`. `Array.find` returned the first
  // and disposed it while printing `dispose: gamma disposed. EXIT=0` — the wrong
  // worktree, reported as success. More than one match is now its own answer,
  // because a name that identifies two things identifies neither.
  if (!match && !target.includes('/')) {
    const byName = entries.filter((e) => basename(e.path) === target);
    if (byName.length > 1) {
      return {
        found: false,
        ambiguous: true,
        target,
        candidates: byName.map((e) => e.path),
        known: entries.map((e) => basename(e.path)),
      };
    }
    match = byName[0];
  }
  if (!match) return { found: false, known: entries.map((e) => basename(e.path)) };

  const absolutePath = match.path;
  let commonDir = '';
  let gitDir = '';
  try {
    commonDir = realpathSync(
      run(absolutePath, ['rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.trim()
    );
    gitDir = realpathSync(run(absolutePath, ['rev-parse', '--absolute-git-dir']).stdout.trim());
  } catch {
    /* detection failure is reported as "not primary" below, which is the fail-open
       direction and matches main-worktree-guard.mjs: policy fails closed, detection
       fails open, and the two are different questions. */
  }

  let tip = null;
  let mainHead = null;
  let modified = 0;
  let untracked = 0;
  let dirtyPaths = [];
  let statusError = null;
  let failedCommand = null;
  let ignoredPaths = [];
  try {
    tip = run(absolutePath, ['rev-parse', 'HEAD']).stdout.trim();
  } catch {
    tip = null;
  }
  try {
    mainHead = run(cwd, ['rev-parse', '--verify', 'main^{commit}']).stdout.trim() || null;
  } catch {
    mainHead = null;
  }
  try {
    const status = run(absolutePath, ['status', '--porcelain']).stdout;
    const lines = status.split('\n').filter(Boolean);
    dirtyPaths = lines.map((l) => l.slice(3));
    modified = lines.filter((l) => !l.startsWith('??')).length;
    untracked = lines.filter((l) => l.startsWith('??')).length;
    // The half of "clean" that `git status` cannot see. `--ignored` adds the
    // gitignored paths, and they are then split by whether a command rebuilds
    // them: a tree holding only `dist/` and `node_modules/` is empty of work,
    // while a tree holding only `.env` is a secret on no ref at all.
    const ignored = run(absolutePath, [
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '-z',
      '--directory',
    ]).stdout;
    ignoredPaths = ignored.split('\0').filter(Boolean);
  } catch (err) {
    // `modified` and `untracked` stay 0, which is what made a prunable worktree
    // read as clean. They are not reported as clean: `tip === null` and
    // `prunableReason` are separate refusals, and `no-tip` catches the rest.
    // `statusError` is READ, not merely recorded — it used to be written at three
    // places and consumed at none, so a `git status` that failed for any reason
    // left the counts at zero and every gate above read that as clean.
    // `dirtyPaths` is NOT cleared here. The counts above are only zero when
    // `status` itself threw; when `ls-files` threw after `status` succeeded they
    // hold the real numbers, and blanking the list produced a refusal reading
    // "holds 1 modified and 1 untracked path(s) ... : " with nothing after the
    // colon, which names a count and no evidence for it.
    statusError = firstLine(err);
    failedCommand = String(err?.message ?? err).split('\n')[0];
  }

  // `ignoredPaths` is what git reported; `protectedContentOnDisk` is what a
  // collapsed `.serena/` actually holds. Both halves are content, because git's
  // collapse is a display convenience and not a statement about the contents.
  const ignoredWork = [...nonRegenerableIgnored(ignoredPaths), ...protectedContentOnDisk(absolutePath, ignoredPaths)];

  return {
    found: true,
    name: basename(absolutePath),
    absolutePath,
    branch: match.detached ? '(detached)' : (match.branch ?? '(unknown)'),
    detached: Boolean(match.detached),
    locked: match.locked ?? false,
    prunableReason: match.prunableReason ?? null,
    tip,
    mainHead,
    isPrimary: commonDir !== '' && gitDir === commonDir,
    commonDir,
    modified,
    untracked,
    dirtyPaths,
    statusError,
    failedCommand,
    ignoredPaths,
    ignoredWork,
  };
}

/**
 * WHERE THE INVENTORY IS, which is not where this program was invoked.
 *
 * `WORKTREES.json` describes EVERY worktree in the repository, so exactly one
 * copy is the right one: the main checkout's. `.gitignore` says so explicitly —
 * the rule is `/WORKTREES.json`, anchored to the root, precisely so that each
 * worktree does not accumulate its own stale copy of a repository-wide document.
 *
 * Reading `join(cwd, 'WORKTREES.json')` therefore found nothing wherever the work
 * actually happens. Measured: from `.kilo/worktrees/dispose-guard`, with a valid
 * 66-worktree inventory sitting in the main checkout and a target it classifies
 * `action: "dispose"`, every disposal refused `WORKTREES.json is absent` — and
 * the refusal's own advice is to run the generator, which writes a second copy
 * into the worktree, which is the thing the `.gitignore` rule exists to prevent.
 * A guard that cannot be run from a worktree is a guard nobody runs.
 *
 * Prefer the worktree that has `main` checked out. The common directory's
 * parent is usually that checkout, but a bare common repository can be a
 * separate worktree entry; in that case its inventory may be stale.
 * Fall back to the common-dir parent when no `main` worktree is registered,
 * then to `cwd` for a caller outside a repository.
 */
export function locateInventory(cwd, { run = defaultRun, exists = existsSync } = {}) {
  let mainRoot = null;
  try {
    const worktrees = run(cwd, ['worktree', 'list', '--porcelain']).stdout;
    mainRoot = worktrees
      .split(/\r?\n\r?\n/)
      .map((entry) => ({
        path: entry.match(/^worktree (.+)$/m)?.[1],
        isMain: entry.split(/\r?\n/).includes('branch refs/heads/main'),
      }))
      .find((entry) => entry.path && entry.isMain)?.path;
  } catch {
    /* no registered main worktree; try the common directory */
  }
  if (mainRoot) {
    const candidate = join(mainRoot, 'WORKTREES.json');
    return exists(candidate) ? candidate : join(cwd, 'WORKTREES.json');
  }
  try {
    const commonDir = realpathIfExists(
      run(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.trim()
    );
    if (commonDir) {
      // `--git-common-dir` is the `.git` DIRECTORY; its parent is the checkout.
      const commonRoot = dirname(commonDir);
      const candidate = join(commonRoot, 'WORKTREES.json');
      if (exists(candidate)) return candidate;
    }
  } catch {
    /* not a repository, or git could not answer; `cwd` below is the fallback */
  }
  return join(cwd, 'WORKTREES.json');
}

/**
 * Resolve a directory Git no longer registers, limited to one real directory
 * directly inside the repository's worktree storage.
 */
export function resolveOrphanDirectory(
  cwd,
  target,
  { inventoryPath = locateInventory(cwd), run = defaultRun, lstat = lstatSync, realpath = realpathSync } = {}
) {
  let repositoryRoot = dirname(inventoryPath);
  if (!existsSync(inventoryPath)) {
    let commonDir;
    try {
      commonDir = run(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.trim();
    } catch (err) {
      return {
        found: false,
        reason: 'repository-root-unreadable',
        path: cwd,
        error: firstLine(err),
      };
    }
    if (!commonDir) {
      return { found: false, reason: 'repository-root-unreadable', path: cwd };
    }
    const canonicalCommonDir = realpathIfExists(commonDir);
    repositoryRoot = basename(canonicalCommonDir) === '.git' ? dirname(canonicalCommonDir) : canonicalCommonDir;
  }

  const worktreesRoot = resolve(repositoryRoot, '.kilo', 'worktrees');
  const candidate = isAbsolute(target) || target.includes('/') ? resolve(cwd, target) : resolve(worktreesRoot, target);

  let rootStat;
  try {
    rootStat = lstat(worktreesRoot);
  } catch (err) {
    return {
      found: false,
      reason: err?.code === 'ENOENT' ? 'worktrees-root-missing' : 'worktrees-root-unreadable',
      path: worktreesRoot,
      error: firstLine(err),
    };
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    return { found: false, reason: 'worktrees-root-not-directory', path: worktreesRoot };
  }

  let candidateStat;
  try {
    candidateStat = lstat(candidate);
  } catch (err) {
    const reason = err?.code === 'ENOENT' ? 'missing' : err?.code === 'ENOTDIR' ? 'not-directory' : 'unreadable';
    return { found: false, reason, path: candidate, error: firstLine(err) };
  }
  if (!candidateStat.isDirectory() || candidateStat.isSymbolicLink()) {
    return { found: false, reason: 'not-directory', path: candidate };
  }

  let canonicalRoot;
  let absolutePath;
  try {
    canonicalRoot = realpath(worktreesRoot);
    absolutePath = realpath(candidate);
  } catch (err) {
    return { found: false, reason: 'unreadable', path: candidate, error: firstLine(err) };
  }

  const relativePath = relative(canonicalRoot, absolutePath);
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return { found: false, reason: 'outside-worktrees', path: candidate, worktreesRoot: canonicalRoot };
  }
  if (relativePath.split(sep).length !== 1) {
    return { found: false, reason: 'not-direct-child', path: candidate, worktreesRoot: canonicalRoot };
  }

  return {
    found: true,
    name: basename(absolutePath),
    absolutePath,
    worktreesRoot: canonicalRoot,
  };
}

/**
 * Inspect an unregistered directory without following links or walking
 * regenerable output trees. Unknown content is reported as work and refuses
 * disposal; collapsed allowlisted directories still use the protected-path
 * exceptions enforced for registered worktrees.
 */
export function inspectOrphanContent(root, { lstat = lstatSync, readdir = readdirSync } = {}) {
  let entries;
  try {
    entries = readdir(root);
  } catch (err) {
    return {
      regenerablePaths: [],
      protectedPaths: [],
      errors: [`${root}: ${firstLine(err)}`],
    };
  }

  const regenerablePaths = [];
  const protectedPaths = [];
  const errors = [];
  const directories = [];
  for (const name of entries.sort()) {
    const path = name;
    let stat;
    try {
      stat = lstat(join(root, path));
    } catch (err) {
      protectedPaths.push(path);
      errors.push(`${path}: ${firstLine(err)}`);
      continue;
    }
    if (stat.isSymbolicLink()) {
      protectedPaths.push(path);
    } else if (stat.isDirectory()) {
      const directoryPath = `${path}/`;
      directories.push(directoryPath);
      (isRegenerableIgnored(directoryPath) ? regenerablePaths : protectedPaths).push(directoryPath);
    } else if (stat.isFile() && isRegenerableIgnored(path)) {
      regenerablePaths.push(path);
    } else {
      protectedPaths.push(path);
    }
  }

  protectedPaths.push(...protectedContentOnDisk(root, directories));
  return {
    regenerablePaths: [...new Set(regenerablePaths)].sort(),
    protectedPaths: [...new Set(protectedPaths)].sort(),
    errors,
  };
}

/**
 * The operations in progress in one worktree, and whether that could be read.
 *
 * A separate reader from `readGitState` because it answers a different question
 * about a different directory. `readGitState` reads the worktree's porcelain
 * status, which answers "what is in the files". This reads the worktree's GIT
 * DIRECTORY, which answers "what is git doing" — and the two disagree in the
 * direction that matters: a merge whose conflicts are all resolved has a clean
 * index and an empty porcelain, and a bisect has both, while its `BISECT_LOG`
 * and its detached `HEAD` are the only evidence it is running.
 *
 * `readError` is kept as a FIELD rather than thrown, because the caller's
 * decision differs from a thrown error's: an unreadable state is a refusal with
 * its own message naming the command, exactly as `dirty-tree-unreadable` is. A
 * reader that cannot answer must not be indistinguishable from one that answered
 * "nothing in progress".
 *
 * BOTH injected readers are guarded, not one. `preflight` is a pure decision
 * function with no try/catch of its own, so an unguarded throw here escapes it as
 * a stack trace — which is the outcome this refusal exists to replace. An earlier
 * version guarded `unmergedPaths` and left `readOperations` bare, which is
 * untestable as well as unreachable: `readOperations` cannot throw, so nothing
 * could have shown the asymmetry to be a hole.
 */
export function readOperationState(
  absolutePath,
  { gitDirOf = resolveGitDir, readOps = readOperations, unmergedOf = unmergedPaths, fallbackGitDir = null } = {}
) {
  // `fallbackGitDir` exists for the shape that matters most. A worktree whose DIRECTORY
  // is gone cannot be asked anything, so `gitDirOf` — which runs git inside it — answers
  // null, and an earlier version returned `operations: []` with a `readError` while the
  // administrative directory beside it still held the merge. That is the exact state
  // `git worktree prune` destroys, and the `prunable` refusal was meanwhile telling the
  // operator there was "nothing to salvage and no state to verify". So the git directory
  // is matched by content when the directory is unavailable; see `resolveAdminDirFor`.
  const gitDir = gitDirOf(absolutePath) ?? fallbackGitDir;
  if (gitDir === null) {
    return {
      gitDir: null,
      operations: [],
      unmerged: [],
      readError: 'git rev-parse --absolute-git-dir failed and no administrative directory claims this worktree',
    };
  }
  let operations;
  try {
    operations = readOps(gitDir);
  } catch (error) {
    return { gitDir, operations: [], unmerged: [], readError: error?.message ?? String(error) };
  }
  let unmerged = [];
  let unmergedError = null;
  try {
    unmerged = unmergedOf(absolutePath);
  } catch (error) {
    // Not a `readError` when the OPERATIONS were read: a merge whose index cannot be
    // diffed because its directory is gone is still a merge in progress, and reporting
    // only the read failure would hide the finding this whole check exists to produce.
    unmergedError = error?.message ?? String(error);
    if (operations.length === 0) return { gitDir, operations, unmerged: [], readError: unmergedError };
  }
  return { gitDir, operations, unmerged, readError: null, unmergedError };
}

/**
 * Who else is in this worktree, in one sentence, from the sources already in hand.
 *
 * The `operation-in-progress` refusal names a command that DISCARDS work, and the
 * operator's first question about that command is whether anybody is standing there.
 * `board` and `sessions` are already arguments to `preflight`, so the facts are already
 * computed — an earlier version of this refusal ran ahead of every ownership check and
 * dropped them, so the advice to consider `git merge --abort` arrived with no hint that
 * a live session was mid-merge in it. On the repository this was written for, that gap
 * is the difference between a safe abort and destroying a session's in-flight work.
 *
 * STATES THE WINDOW, because "recorded in this worktree RIGHT NOW" was a review finding
 * against this sentence: every one of these sources is a recency window —
 * `LIVE_WINDOW_MS` for agents, the same window for sessions — so "right now" asserted a
 * strength the data does not have, and the refusal printed beside it states the same
 * fact correctly. The refusal now carries the number instead.
 *
 * Returns null when nothing is live, so the refusal does not gain a sentence claiming
 * nobody is there: that is an ABSENCE of evidence, and stating it as evidence is how a
 * reader concludes a worktree is safe when it is only unobserved.
 */
function liveSignal(board, sessions) {
  const parts = [];
  const claims = board?.claims?.length ?? 0;
  const locks = board?.fileLocks?.length ?? 0;
  const agents = board?.liveAgents?.length ?? 0;
  const live = sessions?.live?.length ?? 0;
  if (claims > 0) parts.push(`${claims} board claim(s)`);
  if (locks > 0) parts.push(`${locks} board file lock(s)`);
  if (agents > 0) parts.push(`${agents} live board agent(s)`);
  if (live > 0) parts.push(`${live} live session(s)`);
  if (parts.length === 0) return null;
  return `Others are recorded in this worktree inside the last ${LIVE_WINDOW_MS / 60000} min: ${parts.join(', ')}. Establish who they are before you abort anything.`;
}

/**
 * The inventory's verdict for one worktree, plus how old that verdict is.
 *
 * `WORKTREES.json` is untracked and gitignored on purpose, so it describes one
 * machine at one moment and a fresh clone has none. Both states are refusals
 * with different messages, because "absent" and "stale" call for different
 * next steps.
 */
export function readInventory(cwd, gitState, { nowMs = Date.now(), path = locateInventory(cwd) } = {}) {
  if (!existsSync(path)) return { ok: false, reason: 'missing', path };
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { ok: false, reason: 'unreadable', path };
  }
  if (doc?.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, reason: 'version', version: doc?.schemaVersion ?? null, path };
  }
  const generatedAtMs = Date.parse(doc.generatedAt);
  const evaluationAt = doc.ownership?.asOf ?? null;
  const evaluationAtMs = Date.parse(evaluationAt);
  const record =
    (doc.worktrees ?? []).find(
      (w) => realpathIfExists(w.absolutePath ?? w.path) === realpathIfExists(gitState.absolutePath)
    ) ?? null;
  return {
    ok: true,
    reason: null,
    path,
    base: doc.base ?? null,
    mainHead: doc.mainHead ?? null,
    generatedAt: doc.generatedAt ?? null,
    generatedAtMs: Number.isNaN(generatedAtMs) ? NaN : generatedAtMs,
    evaluationAt,
    evaluationAtMs: Number.isNaN(evaluationAtMs) ? NaN : evaluationAtMs,
    record,
  };
}

/**
 * Who owns this worktree, from the two sources that know and one that cannot.
 *
 * The board is read through `readBoard`, which is read-only and degrades to an
 * empty result rather than throwing — an unavailable board must not read as an
 * unowned worktree, so `available: false` is surfaced and the CLI says so.
 *
 * The session database is queried for sessions whose `directory` is this
 * worktree. That field is where a session was OPENED, so a session that was
 * opened in the main checkout and then driven here is invisible to it; the
 * board's `agents` table is what covers that case, which is why both are
 * counted and either refuses.
 */
function collectOwnership(cwd, gitState, { nowMs = Date.now(), liveWindowMs = LIVE_WINDOW_MS } = {}) {
  const absolute = gitState.absolutePath;
  const board = readBoard(cwd, { nowMs });
  // ABSENT IS NOT UNREADABLE, AND THE DISTINCTION IS THE WHOLE POINT
  // --------------------------------------------------------------
  // `readBoard` reports `available: false` for both "there is no board.db" and
  // "board.db is there and I could not read it". Refusing on the first made the
  // tool unusable on every clone — `board.mjs` documents a missing board as a
  // NORMAL state, not a failure, which is why it degrades to empty rather than
  // throwing.
  //
  // They are different situations. A board that has never existed has recorded no
  // claims, no locks and no agents, so zero rows is the TRUE answer and there is
  // no signal being missed. A board that EXISTS and cannot be read is carrying
  // rows this process cannot see — which is the incident: the board held two live
  // file locks naming that worktree and nothing looked at them.
  const boardRows = {
    ...resolveAvailability({ dbPath: board.dbPath ?? null, available: board.available, error: board.error }),
    // `readBoard` always reports which file it tried, including when it could
    // not open it, so an unavailable board names ITS OWN path. The previous
    // fallback printed the Kilo session database in a sentence about the board,
    // sending an operator to the wrong file.
    dbPath: board.dbPath ?? null,
    claims: board.claims.get(absolute) ?? [],
    fileLocks: board.fileLocks.get(absolute) ?? [],
    liveAgents: (board.agents.get(absolute) ?? []).filter((a) => a.live),
  };

  // A TARGETED QUERY, NOT `auditChats`
  // ----------------------------------
  // This used to call `auditChats` and then read one number off it —
  // `sessions.live.length` — discarding the `lastReason`/`toolErrors`/
  // `creditsFailures` work that dominates its cost. Measured on this machine:
  // 22 seconds, returning 5 irrelevant sessions, because `chats.mjs` runs four
  // unindexed `part` queries (`SCAN part`, ~457k rows) where `time_created >= ?`
  // is only a post-filter, so narrowing `sinceMs` cannot bound them. The
  // `session` table is 2,257 rows and indexed on `directory`, and the whole
  // question is "does any chat have this directory and a recent `time_updated`".
  // `auditChats` remains the generator's, where its breadth is the point.
  //
  // Wrapped because a guard that crashes is a guard that gets bypassed: an agent
  // meeting a stack trace reaches for `git worktree remove`, which is the exact
  // thing this exists to stop. So an absent session database reports
  // `available: false`, which `preflight` now treats as a refusal rather than as
  // zero rows.
  const sessions = readSessionsIn(gitState.absolutePath, { nowMs, liveWindowMs });
  return { board: boardRows, sessions };
}

/** The ownership and content checks for a directory without a Git worktree. */
export function orphanPreflight({ ownership, content, preserveBranch = false } = {}) {
  const failures = [];
  const refuse = (code, ...args) => failures.push({ code, message: REFUSALS[code](...args) });
  if (preserveBranch) {
    failures.push({ code: 'orphan-no-branch', message: 'An unregistered directory has no branch to keep.' });
  }
  if (!ownership?.board || ownership.board.available !== true) {
    refuse(
      'board-unavailable',
      ownership?.board?.error ?? ownership?.board?.dbPath ?? 'board ownership was not available'
    );
  }
  if (!ownership?.sessions || ownership.sessions.available !== true) {
    refuse(
      'sessions-unavailable',
      ownership?.sessions?.error ?? ownership?.sessions?.dbPath ?? 'session ownership was not available'
    );
  }
  if ((ownership?.board?.claims?.length ?? 0) > 0) refuse('board-claim', ownership.board.claims.length);
  if ((ownership?.board?.fileLocks?.length ?? 0) > 0) {
    refuse('board-lock', ownership.board.fileLocks.length);
  }
  if ((ownership?.board?.liveAgents?.length ?? 0) > 0) {
    refuse('board-agent-live', ownership.board.liveAgents.length);
  }
  if ((ownership?.sessions?.live?.length ?? 0) > 0) refuse('live-session', ownership.sessions.live.length);
  if (!content) {
    failures.push({ code: 'orphan-content-unreadable', message: 'The directory contents were not inspected.' });
  } else {
    for (const error of content.errors ?? []) {
      failures.push({ code: 'orphan-content-unreadable', message: `Could not inspect content: ${error}` });
    }
    if ((content.protectedPaths?.length ?? 0) > 0) {
      failures.push({
        code: 'orphan-content',
        message: `The directory contains content not on the regenerable allowlist: ${content.protectedPaths.join(', ')}`,
      });
    }
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Sessions whose `directory` is this worktree and that were updated recently.
 *
 * Returns `available: false` rather than an empty list when the database cannot
 * be read, because the two mean opposite things and only one of them permits a
 * deletion.
 */
function readSessionsIn(absolutePath, { nowMs, liveWindowMs, open = defaultSessionOpen, dbPath = resolveSessionDb() }) {
  // Same absent-versus-unreadable rule as the board, for the same reason: a
  // session database that has never existed has never recorded a session, so no
  // chat can be live in this worktree and zero rows is the true answer.
  if (!existsSync(dbPath)) return { ...resolveAvailability({ dbPath, available: false }), dbPath, live: [] };
  let db;
  try {
    db = open(dbPath);
  } catch (err) {
    return {
      ...resolveAvailability({ dbPath, available: false, error: String(err?.message ?? err) }),
      dbPath,
      live: [],
    };
  }
  if (!db) return { ...resolveAvailability({ dbPath, available: false }), dbPath, live: [] };
  try {
    const rows = db
      .prepare('SELECT id, title, time_updated FROM session WHERE directory = ? AND time_updated >= ?')
      .all(absolutePath, nowMs - liveWindowMs);
    return {
      available: true,
      neverExisted: false,
      dbPath,
      error: null,
      live: rows.map((r) => ({
        id: r.id,
        title: r.title,
        idleMs: nowMs - Number(r.time_updated),
      })),
    };
  } catch (err) {
    return { available: false, neverExisted: false, live: [], error: String(err?.message ?? err), dbPath };
  } finally {
    try {
      db.close();
    } catch {
      /* a close failure cannot change the answer already computed */
    }
  }
}

/** The session database, opened read-only. A broken open is a refusal, not a throw. */
function defaultSessionOpen(dbPath) {
  return new DatabaseSync(dbPath, { readOnly: true });
}

/**
 * Make a disposed branch reachable forever, before anything is deleted.
 *
 * `git gc` prunes commits reachable from no ref, and a disposed branch is by
 * definition reachable from none. One ref per disposal is a few bytes and turns
 * the irreversible step into a recoverable one:
 * `git branch fix/x refs/keep/disposed/<name>`.
 *
 * Unconditional, and before the removal — not after noticing a loss. The sweep
 * that caused this anchored two branches out of nine it destroyed, by hand.
 *
 * THE REF NAME IS A SLUG OF THE BRANCH, NOT THE DIRECTORY NAME
 * ----------------------------------------------------------
 * git refuses a ref containing a space, `~`, `^`, `:` or `*`, so interpolating a
 * worktree directory's basename verbatim made the guard crash on a perfectly
 * ordinary checkout: `fatal: update_ref failed for ref 'refs/keep/disposed/wt
 * space': refusing to update ref with bad name`. A crash is a bypass. The branch
 * is the better source anyway — it is what the anchor has to name — and
 * `refs/keep/harvested/*` already exists here with `-` standing in for `/`.
 * Anything still invalid after slugging is refused rather than attempted.
 */
function anchor(cwd, gitState, { run = defaultRun } = {}) {
  if (!gitState.tip) return null;
  const source = gitState.branch && !PLACEHOLDER_BRANCHES.has(gitState.branch) ? gitState.branch : gitState.name;
  const slug = refSlug(source);
  if (!slug) return null;
  // The suffix is resolved through the INJECTED runner and the caller's cwd, so a
  // dry run and the real disposal agree on the ref name, and a suite that
  // injects its runner does not spawn a real `git` to find that out.
  const ref = `${KEEP_REF_PREFIX}${slug}${anchorDisambiguation(cwd, slug, source, gitState.tip, run)}`;
  try {
    run(cwd, ['check-ref-format', ref]);
  } catch {
    return null;
  }
  // CREATE-IF-ABSENT, so the read above and this write are one atomic step in
  // git rather than two steps in this process.
  //
  // The empty old-value is the whole mechanism: `git update-ref <ref> <new> ''`
  // succeeds only if `<ref>` does not exist, and exits 128 if it does. Without
  // it this was a read-then-write with a window between them, and the comment on
  // `anchorDisambiguation` claimed a cross-process guarantee the code could not
  // deliver. Proven on a scratch repo with two concurrent processes: both read
  // "the slug is free", both wrote the BARE ref, and the loser's commit was gone
  // from every ref — with `dispose` reporting a successful anchor for both.
  try {
    run(cwd, ['update-ref', ref, gitState.tip, '']);
  } catch {
    // Lost the race, or the ref appeared between the read and here. Fall back to
    // a name derived from this tip, which cannot be the one that just won, and
    // write that unconditionally — there is nothing left to collide with,
    // because a losing tip has never been an anchor.
    const fallback = `${ref}-g${createHash('sha256').update(`${source} ${gitState.tip}`).digest('hex').slice(0, 9)}`;
    try {
      run(cwd, ['check-ref-format', fallback]);
    } catch {
      return null;
    }
    run(cwd, ['update-ref', fallback, gitState.tip]);
    return fallback;
  }
  return ref;
}

/**
 * Write everything uncommitted to somewhere that outlives the directory.
 *
 * `git diff HEAD --binary` covers tracked modifications and is binary-safe;
 * `git diff` alone would mangle an image and produce a patch that does not
 * apply, which is worse than no salvage. Untracked files are archived with
 * `tar`, because no diff mentions a file git does not track.
 *
 * This exists for a caller that reaches `dispose()` directly, which is what the
 * tests do. Through the CLI it is unreachable with anything to write, because
 * `preflight` refuses a dirty or ignored-content tree first and nothing
 * overrides that. Gitignored paths are archived here too, and separately, because
 * `--exclude-standard` above omits them by design and a `.env` is on no ref and
 * in no diff — so nothing else in this function would ever carry it.
 */
function salvage(cwd, gitState, { run = defaultRun, fs = defaultFs, tar = defaultTar } = {}) {
  if (!gitState.commonDir) return null;
  // The salvage directory is named by the worktree's FULL PATH, slugged, not by
  // its basename. Two worktrees with the same basename are a real shape here —
  // this repository registers worktrees under `.kilo/worktrees/` and under the
  // temp directory, which is why `readGitState` refuses an ambiguous bare name —
  // and keying salvage by basename had the second one overwrite the first's
  // archive with `mkdirSync(recursive: true)`. The exact collision class this
  // program added a refusal for, reproduced inside itself.
  const dir = join(
    gitState.commonDir,
    'worktree-salvage',
    `${refSlug(gitState.absolutePath)}-${refSlug(gitState.name)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  // Failures are REPORTED, not swallowed. `git tar` does not exist — verified:
  // `git: 'tar' is not a git command` — so the previous version silently produced
  // no archive at all and returned a `written` list that read as a successful
  // partial salvage. A list of what was written, next to a list of what was not,
  // is the difference between a salvage and a rumour of one.
  const failed = [];

  try {
    const patch = run(gitState.absolutePath, ['diff', 'HEAD', '--binary']).stdout;
    if (patch.trim()) {
      fs.writeFileSync(join(dir, 'tracked.patch'), patch);
      written.push('tracked.patch');
    }
  } catch (err) {
    failed.push(`tracked.patch: ${firstLine(err)}`);
  }

  try {
    const untracked = run(gitState.absolutePath, ['ls-files', '--others', '--exclude-standard', '-z']).stdout;
    if (untracked.trim()) {
      // `tar`, not `git tar`. The runner is git-only; archiving is the one step
      // that is not a git subcommand, so it gets its own runner rather than a
      // prefix that does not exist.
      tar(gitState.absolutePath, join(dir, 'untracked.tar'), untracked);
      written.push('untracked.tar');
    }
  } catch (err) {
    failed.push(`untracked.tar: ${firstLine(err)}`);
  }

  // The gitignored half, which `--exclude-standard` above deliberately omits —
  // and its omission is why this archive exists separately. A `.env` is on no
  // ref and in no diff, so nothing else here would ever carry it.
  try {
    const ignored = run(gitState.absolutePath, [
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '-z',
      // `--directory` as in `readGitState`, for the same reason and the same
      // reason it was missing here was a bug: without it this enumerates every
      // FILE under `node_modules/` — 18,901 of them on a real worktree — only to
      // filter all of them out one entry later.
      '--directory',
    ]).stdout;
    const reported = ignored.split('\0').filter(Boolean);
    // The same two halves `readGitState` counts: what git named, plus what a
    // collapsed allowlisted directory holds. Archiving the reported paths alone
    // would tar `run.log` and skip `.serena/memories/` for the reason that
    // reaches this function at all.
    const worth = [
      ...new Set([
        ...reported.filter((path) => !isRegenerableIgnored(path)),
        ...protectedContentOnDisk(gitState.absolutePath, reported),
      ]),
    ];
    if (worth.length) {
      tar(gitState.absolutePath, join(dir, 'ignored.tar'), worth.map((p) => `${p}\0`).join(''));
      written.push('ignored.tar');
    }
  } catch (err) {
    failed.push(`ignored.tar: ${firstLine(err)}`);
  }

  if (failed.length) return { dir, written, failed };
  return written.length ? { dir, written, failed } : null;
}

/** `tar -cf <archive> --null -T -`, fed the NUL-separated path list on stdin. */
function defaultTar(cwd, archive, input) {
  execFileSync('tar', ['-cf', archive, '--null', '-T', '-'], { cwd, input, stdio: ['pipe', 'ignore', 'pipe'] });
}

/** git's first line of a failure, which is the part that says what went wrong. */
/**
 * git's first line of a failure, which is the part that says what went wrong.
 *
 * `slice(1)` DROPPED that line, which is the opposite of what the name says and
 * made every single-line error report `unknown error` — including a real
 * observed one, `SALVAGE INCOMPLETE — ignored.tar: unknown error`, for a failure
 * whose actual message was on the first line. The module's own design note holds
 * that output an operator cannot act on is indistinguishable from a bug, and
 * this was manufacturing exactly that.
 */
function firstLine(err) {
  const message = String(err?.message ?? err)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ');
  if (!message) return 'unknown error';
  // A node child_process failure prefixes the real line with
  // `Command failed: <cmd>` — keep the command AND what it said.
  return message.slice(0, 200) || 'unknown error';
}

/**
 * The removal itself. No `--force` parameter exists on this function, so no
 * caller can pass one.
 *
 * `git branch -d` rather than `-D` for ordinary disposal: it refuses an
 * unmerged branch, and that refusal is the guard. Two independently verified
 * cases may use `-D` only after an anchor exists: patch absorption, and a
 * conflict-free merge whose result tree equals the exact main snapshot. The
 * latter rechecks main before removal and before branch deletion.
 */
export function dispose(
  cwd,
  gitState,
  {
    run = defaultRun,
    fs = defaultFs,
    tar = defaultTar,
    keepBranch = false,
    deleteUnmergedBranch = false,
    deleteReason = null,
    expectedBaseHead = null,
  } = {}
) {
  const steps = [];
  // NO ANCHOR WHEN THE BRANCH SURVIVES. The anchor exists so a deleted branch is
  // still reachable; a branch that is deliberately kept is already reachable,
  // and writing `refs/keep/disposed/<slug>` for it would put a ref that reads as
  // evidence of a disposal next to a branch that was never disposed. The
  // asymmetry is the point: `disposed/` means "this was removed and this is the
  // only copy", and it must keep meaning that.
  const ref = keepBranch ? null : anchor(cwd, gitState, { run });
  if (ref) steps.push(`anchored ${gitState.tip} at ${ref}`);
  else if (keepBranch) steps.push(`no anchor ref: the branch ${gitState.branch} is being kept`);
  else {
    steps.push(`KEPT worktree ${gitState.absolutePath}: could not create a recovery anchor`);
    return {
      steps,
      branchDeleted: false,
      worktreeRemoved: false,
      anchorRef: null,
      salvage: null,
      branchKept: false,
    };
  }

  const noOpMergeBaseIsCurrent = () => {
    if (deleteReason !== 'merge-tree-no-op') return true;
    try {
      return run(cwd, ['rev-parse', '--verify', 'main^{commit}']).stdout.trim() === expectedBaseHead;
    } catch {
      return false;
    }
  };
  if (!noOpMergeBaseIsCurrent()) {
    steps.push(
      `KEPT worktree ${gitState.absolutePath}: main moved or became unreadable after the no-op merge proof; branch remains anchored at ${ref}`
    );
    return {
      steps,
      branchDeleted: false,
      worktreeRemoved: false,
      anchorRef: ref,
      salvage: null,
      branchKept: true,
    };
  }

  const saved = salvage(cwd, gitState, { run, fs, tar });
  // NAMES WHAT, or says there was nothing. `salvaged  to /path` — an empty join
  // printed directly above a `SALVAGE INCOMPLETE` line — read as a truncated
  // sentence rather than as "the salvage produced no files".
  if (saved && saved.written?.length) steps.push(`salvaged ${saved.written.join(', ')} to ${saved.dir}`);
  else if (saved) steps.push(`salvaged nothing to ${saved.dir} (no patch and no archive had content)`);
  if (saved?.failed?.length) steps.push(`SALVAGE INCOMPLETE — ${saved.failed.join('; ')}`);
  if (saved?.failed?.length) {
    steps.push(`KEPT worktree ${gitState.absolutePath}: salvage was incomplete`);
    return {
      steps,
      branchDeleted: false,
      worktreeRemoved: false,
      anchorRef: ref,
      salvage: saved,
      branchKept: keepBranch,
    };
  }

  const hasDirtyWork = (gitState.modified ?? 0) + (gitState.untracked ?? 0) > 0;
  if (keepBranch && hasDirtyWork) {
    if (!saved || saved.written?.length === 0) {
      steps.push(`KEPT worktree ${gitState.absolutePath}: dirty files were not archived`);
      return {
        steps,
        branchDeleted: false,
        worktreeRemoved: false,
        anchorRef: ref,
        salvage: saved,
        branchKept: true,
      };
    }
    try {
      run(gitState.absolutePath, ['reset', '--hard', 'HEAD']);
      run(gitState.absolutePath, ['clean', '-fd']);
      const remaining = run(gitState.absolutePath, ['status', '--porcelain']).stdout;
      if (remaining.trim()) throw new Error('working tree remains dirty after archive cleanup');
      steps.push('cleared tracked and untracked files after verifying their archive');
    } catch (err) {
      steps.push(`KEPT worktree ${gitState.absolutePath}: unable to clear archived edits (${firstLine(err)})`);
      return {
        steps,
        branchDeleted: false,
        worktreeRemoved: false,
        anchorRef: ref,
        salvage: saved,
        branchKept: true,
      };
    }
  }

  if (!noOpMergeBaseIsCurrent()) {
    steps.push(
      `KEPT worktree ${gitState.absolutePath}: main moved or became unreadable before removal; branch remains anchored at ${ref}`
    );
    return {
      steps,
      branchDeleted: false,
      worktreeRemoved: false,
      anchorRef: ref,
      salvage: saved,
      branchKept: true,
    };
  }

  // Catching git's refusal rather than propagating it. An uncaught throw here
  // produced a stack trace AFTER the anchor ref had already been written — an
  // orphan ref plus a crash, and the crash is what gets the guard bypassed.
  // git's message for a locked worktree literally reads "use 'remove -f -f' to
  // override", which is the flag this program exists to deny, so it is reported
  // as text an operator reads rather than as an exception an agent routes around.
  try {
    run(cwd, ['worktree', 'remove', gitState.absolutePath]);
    steps.push(`removed worktree ${gitState.absolutePath}`);
  } catch (err) {
    steps.push(`KEPT worktree ${gitState.absolutePath}: ${firstLine(err)}`);
    steps.push(`nothing was deleted; its branch is still anchored at ${ref ?? 'no anchor'}`);
    return {
      steps,
      branchDeleted: false,
      worktreeRemoved: false,
      anchorRef: ref,
      salvage: saved,
      branchKept: keepBranch,
    };
  }

  let branchDeleted = false;
  if (keepBranch) {
    // THE WHOLE POINT OF THE STATUS, IN ONE BRANCH OF ONE FUNCTION. A legacy
    // worktree's directory goes and its branch stays: git holds a branch with no
    // worktree, so this costs a ref and saves the checkout, its `node_modules`
    // and its `dist/`.
    steps.push(`KEPT branch ${gitState.branch}: the branch-preserving disposal mode leaves its ref in place`);
  } else {
    if (!noOpMergeBaseIsCurrent()) {
      steps.push(
        `KEPT branch ${gitState.branch}: main moved or became unreadable after worktree removal; its commits remain at ${ref}`
      );
      return { steps, branchDeleted, worktreeRemoved: true, anchorRef: ref, salvage: saved, branchKept: true };
    }
    try {
      const deleteFlag = deleteUnmergedBranch ? '-D' : '-d';
      run(cwd, ['branch', deleteFlag, gitState.branch]);
      branchDeleted = true;
      if (deleteUnmergedBranch) {
        steps.push(
          `deleted ${deleteReason === 'merge-tree-no-op' ? 'net-no-op merge' : 'patch-absorbed'} branch ${gitState.branch} with guarded \`-D\` after anchoring its recovery ref`
        );
      } else steps.push(`deleted branch ${gitState.branch}`);
    } catch (err) {
      steps.push(
        `KEPT branch ${gitState.branch}: git refused \`${deleteUnmergedBranch ? '-D' : '-d'}\`, so it is unmerged (${firstLine(err)}). Its commits remain at ${ref ?? 'no anchor'}.`
      );
    }
  }
  return { steps, branchDeleted, worktreeRemoved: true, anchorRef: ref, salvage: saved, branchKept: keepBranch };
}

function realpathIfExists(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** The one command runner, so every effect is injectable. */
function defaultRun(cwd, args, { input } = {}) {
  return {
    stdout: execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      input,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    }),
  };
}

/** The real filesystem, as an object so a caller can substitute one. */
const defaultFs = { mkdirSync, writeFileSync };

const USAGE = `Usage: node scripts/dispose-worktree.mjs <worktree> [--dry-run] [--keep-branch] [--max-age-minutes <n>]

  <worktree>   a registered worktree, or an unregistered directory directly under
               the repository's .kilo/worktrees/ containing only regenerable content.

For a registered worktree, refuses unless the generated inventory calls it
\`action: "dispose"\` or \`action: "legacy"\`, or \`--keep-branch\` explicitly selects
 an \`at-risk\` worktree. No board claim, lock or live agent may name it, no session
may have it as its directory inside the live window, and ignored content or Git
operations in progress always refuse removal.

If Git no longer registers the directory, the fallback only accepts a real
direct child of the repository's \`.kilo/worktrees/\`. Every entry must be explicitly
regenerable, no board or session may own it, and \`--keep-branch\` is inapplicable.
Unknown content is reported and preserved.
Ordinary disposal anchors the branch at
${KEEP_REF_PREFIX}<name>. Branch-preserving disposal archives uncommitted work
before removing the directory and leaves the branch ref untouched.

There is no --force. Without \`--keep-branch\`, a dirty tree is a finding to report,
not an obstacle.

\`action: "legacy"\` removes the WORKTREE and keeps the BRANCH: git holds a branch
with no worktree, so the directory, its node_modules and its dist/ go while the
ref survives. No anchor ref is written, because the branch is the copy being
kept. See docs/ORCHESTRATION.md.

\`--keep-branch\` explicitly permits a freshly inventoried \`action: "at-risk"\`
worktree to be removed while retaining its branch. Tracked edits
and untracked files are archived under the common git directory first. It still
refuses live ownership, unreadable state, ignored content, operations in
progress, \`mustNotPrune\`, and \`undecided\` worktrees. Review with \`--dry-run\` first.
`;

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args.includes('--force')) {
    process.stderr.write(
      'dispose: there is no --force. A dirty tree is a finding; commit it, carry it as a patch, or leave it.\n'
    );
    return 3;
  }
  let maxAgeMs = MAX_INVENTORY_AGE_MS;
  const ageIndex = args.indexOf('--max-age-minutes');
  if (ageIndex !== -1) {
    const parsed = Number(args[ageIndex + 1]);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      process.stderr.write('dispose: --max-age-minutes needs a positive number.\n');
      return 3;
    }
    // Clamped, not merely parsed. The flag exists to let a caller be STRICTER than
    // the documented rule while a regeneration is in flight; uncapped, it silently
    // voided the guarantee `docs/ORCHESTRATION.md` states as "less than 15 minutes
    // old" — verified: a 9-hour-old inventory was refused by default and accepted
    // with `--max-age-minutes 600`. Loosening a documented invariant needs a
    // different command, not a bigger number to the same one.
    const ceiling = MAX_INVENTORY_AGE_MS / 60000;
    if (parsed > ceiling) {
      process.stderr.write(
        `dispose: --max-age-minutes ${parsed} exceeds the ${ceiling} min freshness rule. Re-run \`node scripts/worktree-inventory.mjs\` instead; if the inventory genuinely cannot be regenerated, that is an operator decision, not a flag.\n`
      );
      return 3;
    }
    maxAgeMs = parsed * 60000;
  }
  const dryRun = args.includes('--dry-run');
  const preserveBranch = args.includes('--keep-branch');
  const target = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--max-age-minutes');
  if (!target) {
    process.stderr.write(USAGE);
    return 3;
  }

  const cwd = process.cwd();
  const nowMs = Date.now();
  const gitState = readGitState(cwd, target);
  if (!gitState.found) {
    if (gitState.listError) {
      process.stderr.write(
        `dispose: cannot establish whether "${target}" is registered because \`git worktree list\` failed: ${gitState.listError}\n`
      );
      return 1;
    }
    // An ambiguous name is NOT "no worktree named X". It is several, and
    // reporting that as absence would send the caller off to re-read a list that
    // already contains the answer.
    if (gitState.ambiguous) {
      process.stderr.write(
        `dispose: "${gitState.target}" is the basename of ${gitState.candidates.length} worktrees, so the name does not identify one:\n  ${gitState.candidates.join('\n  ')}\n\nPass the full path. Git refuses to create two worktrees at the same PATH, so a path is unique where a basename is not. Nothing was changed.\n`
      );
      return 3;
    }
    const orphan = resolveOrphanDirectory(cwd, target);
    if (!orphan.found) {
      const descriptions = {
        missing: 'the path does not exist',
        'not-directory': 'the path is not a directory',
        'outside-worktrees': 'the path is outside the repository .kilo/worktrees/ directory',
        'not-direct-child': 'the path is not a direct child of .kilo/worktrees/',
        'worktrees-root-missing': 'the repository .kilo/worktrees/ directory does not exist',
        'worktrees-root-not-directory': 'the repository .kilo/worktrees/ path is not a real directory',
        'worktrees-root-unreadable': 'the repository .kilo/worktrees/ directory cannot be read',
        'repository-root-unreadable': 'the repository root cannot be located',
        unreadable: `the path cannot be inspected${orphan.error ? `: ${orphan.error}` : ''}`,
      };
      process.stderr.write(
        `dispose: no registered worktree "${target}", and the orphan fallback refused it: ${
          descriptions[orphan.reason] ?? orphan.reason
        }${orphan.error ? ` (${orphan.error})` : ''}.\n`
      );
      return 1;
    }
    if (preserveBranch) {
      process.stderr.write('dispose: an unregistered directory has no branch to keep.\n');
      return 3;
    }

    const ownership = collectOwnership(cwd, orphan, { nowMs });
    const content = inspectOrphanContent(orphan.absolutePath);
    const verdict = orphanPreflight({ ownership, content });
    for (const path of content.regenerablePaths) {
      process.stdout.write(`  found regenerable content: ${path}\n`);
    }
    for (const failure of verdict.failures) {
      process.stderr.write(`  - ${failure.message}\n`);
    }
    if (!verdict.ok) {
      process.stderr.write(`dispose: refusing unregistered directory ${orphan.absolutePath}.\nNothing was changed.\n`);
      return 1;
    }
    if (dryRun) {
      process.stdout.write(`dispose: ${orphan.absolutePath} is safe to remove.\n  would remove orphan directory\n`);
      return 0;
    }
    try {
      rmSync(orphan.absolutePath, { recursive: true, force: false });
    } catch (err) {
      process.stderr.write(`dispose: could not remove ${orphan.absolutePath}: ${firstLine(err)}\n`);
      return 2;
    }
    process.stdout.write(`dispose: removed unregistered directory ${orphan.absolutePath}.\n`);
    return 0;
  }

  const inventory = readInventory(cwd, gitState, { nowMs });
  const ownership = collectOwnership(cwd, gitState, { nowMs });
  const verdict = preflight({
    target,
    nowMs,
    gitState,
    // The fallback is what lets this read the state of a worktree whose own
    // directory is gone: matched against the administrative directories by content,
    // because there is no directory left to run git in. See `readOperationState`.
    operationState: readOperationState(gitState.absolutePath, {
      fallbackGitDir: resolveAdminDirFor(resolveCommonDir(cwd), gitState.absolutePath),
    }),
    inventory,
    board: ownership.board,
    sessions: ownership.sessions,
    maxAgeMs,
    preserveBranch,
  });

  // Availability is a refusal in its own right now, so the failures list already
  // names whichever source was unreadable and where it looked. The note that used
  // to live here is gone with the fail-open it was papering over.
  if (!verdict.ok) {
    process.stderr.write(`dispose: refusing ${gitState.name} (${gitState.branch}).\n\n`);
    for (const f of verdict.failures) process.stderr.write(`  - ${f.message}\n`);
    process.stderr.write('\nNothing was changed. Read the inventory, or ask the operator.\n');
    return 1;
  }

  if (dryRun) {
    const ref = anchorRefFor(gitState);
    process.stdout.write(
      verdict.keepBranch
        ? `dispose: ${gitState.name} (${gitState.branch}) is clear to remove, and the branch will be KEPT.\n  would archive tracked edits and untracked files under the common git directory\n  would remove ${gitState.absolutePath}\n  would NOT run git branch -d ${gitState.branch}\n`
        : `dispose: ${gitState.name} (${gitState.branch}) is clear to dispose.\n  would anchor ${gitState.tip} at ${ref ?? 'nothing — the ref name is invalid'}\n  would remove ${gitState.absolutePath}\n  would git branch ${verdict.deleteUnmergedBranch ? '-D' : '-d'} ${gitState.branch}${verdict.deleteReason === 'merge-tree-no-op' ? ' (merge result equals the recorded main tree)' : verdict.deleteReason === 'patch-absorbed' ? ' (all non-merge patches are already on the base)' : ''}\n`
    );
    return 0;
  }

  const result = dispose(cwd, gitState, {
    keepBranch: verdict.keepBranch,
    deleteUnmergedBranch: verdict.deleteUnmergedBranch,
    deleteReason: verdict.deleteReason,
    expectedBaseHead: verdict.expectedBaseHead,
  });
  for (const step of result.steps) process.stdout.write(`  ${step}\n`);
  if (!result.worktreeRemoved) {
    process.stderr.write('dispose: nothing was deleted.\n');
    return 2;
  }
  process.stdout.write(
    result.branchKept
      ? `dispose: ${gitState.name} worktree removed, branch ${gitState.branch} kept. The inventory is now stale; re-run \`node scripts/worktree-inventory.mjs\`.\n`
      : `dispose: ${gitState.name} disposed. The inventory is now stale; re-run \`node scripts/worktree-inventory.mjs\`.\n`
  );
  // A kept branch is not a failed deletion, so it must not report exit 2 — that
  // code means "git refused" and is what a caller reads as "nothing was done".
  // The worktree is gone and the branch survived, which is the whole request.
  return result.branchDeleted || result.branchKept ? 0 : 2;
}

/**
 * The ref `anchor()` would create, for the dry-run line.
 *
 * Duplicated rather than exported from `anchor()` because calling `anchor()`
 * would WRITE the ref, and a `--dry-run` that mutates the repository is not a dry
 * run. The slug rule lives in `refSlug()` for that reason.
 */
function anchorRefFor(gitState, { run = defaultRun, cwd = process.cwd() } = {}) {
  const source = gitState.branch && !PLACEHOLDER_BRANCHES.has(gitState.branch) ? gitState.branch : gitState.name;
  const slug = refSlug(source);
  return slug ? `${KEEP_REF_PREFIX}${slug}${anchorDisambiguation(cwd, slug, source, gitState.tip, run)}` : null;
}

/**
 * The ref-name slug rule, in one place so the dry run and `anchor()` agree.
 *
 * NOT INJECTIVE, and that is the point of `anchorDisambiguation`. `/`, a space
 * and a run of anything else all collapse to one `-`, and `-` is itself a legal
 * branch character, so `feat/marble`, `feat marble` and `feat-marble` all slug
 * to `feat-marble`. The anchor is the ONLY recovery point for a disposed branch,
 * so two collisions mean the second disposal overwrites the first's — and
 * `git branch recover refs/keep/disposed/feat-marble` hands back the wrong
 * commit, which is worse than handing back nothing.
 */
function refSlug(source) {
  return (
    String(source ?? '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^[.-]+|[.-]+$/g, '') || ''
  );
}

/**
 * The suffix that makes a slug unique, or '' when the slug is already free.
 *
 * A HASH, not a counter: it does not depend on what this process has seen, so
 * two disposals in two processes cannot both conclude the slug is free. `-g<hash>`
 * is 9 hex characters of the exact branch name, which is enough that a
 * deliberate collision is not what anyone is defending against.
 */
/**
 * The suffix that makes a slug unique, or '' when the slug is already free.
 *
 * ONLY A HINT, and `anchor()` does not trust it. This reads the ref and decides;
 * the write that follows is create-if-absent, so a loser of the race is refused
 * by git and falls back to a tip-derived name. The claim that a HASH "does not
 * depend on what this process has seen, so two disposals in two processes cannot
 * both conclude the slug is free" was true of the hash and false of the function:
 * a read followed by an unconditional write is a race whatever the hash is
 * derived from. The hash stays because it produces a good NAME; the atomicity
 * comes from `update-ref <ref> <new> ''`.
 *
 * `refSlug` is NOT injective, which is why any suffix exists at all: '/', a space
 * and a run of anything else all collapse to one '-', and '-' is legal in a
 * branch name, so `feat/marble`, `feat marble` and `feat-marble` all slug to
 * `feat-marble`. The anchor is the ONLY recovery point for a disposed branch, so
 * two collisions mean the second overwrites the first's.
 */
function anchorDisambiguation(cwd, slug, source, tip, run) {
  if (!slug) return '';
  const ref = `${KEEP_REF_PREFIX}${slug}`;
  let current = null;
  try {
    current = run(cwd, ['rev-parse', '--verify', '--quiet', ref]).stdout.trim();
  } catch {
    current = null;
  }
  // A free slug stays bare, so the common case writes the same ref it always
  // did and no recovery path anyone has written down moves.
  if (!current) return '';
  // Re-anchoring the SAME COMMIT re-anchors it: the ref already points where it
  // is about to point, and there is nothing to protect. The comparison is
  // against the tip, not the branch name — `rev-parse --verify` resolves a ref
  // to a commit, so comparing it to `source` would never be equal and would
  // suffix every re-anchor of a branch that had been disposed once already.
  if (tip && current === tip) return '';
  // HASHED OVER THE TIP, NOT THE NAME. Hashing the branch name fixed two
  // different names that slug alike and left the reachable case open: dispose
  // `feat/marble` at 457bfd4, let `git branch -d` refuse because the branch is
  // unmerged, advance it, and dispose it again at a4d9306. Same name, same
  // hash, so the second disposal OVERWROTE the first's only recovery point and
  // a4d9306 became unreachable from any anchor. The tip is what tells two
  // anchors of one branch apart, and it is the value the ref already points at.
  const hash = createHash('sha256')
    .update(`${source ?? ''} ${tip ?? ''}`)
    .digest('hex')
    .slice(0, 9);
  return `-g${hash}`;
}

if (process.argv[1] && realpathIfExists(process.argv[1]) === realpathIfExists(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv);
}
