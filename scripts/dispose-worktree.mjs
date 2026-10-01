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
 * only ever reached with a clean tree — where it correctly writes nothing. It is
 * a function for a caller that has already decided, not a stage of this program.
 * An earlier version of this file claimed it as the thing that made removal safe
 * after a human decision; that was a description of an intention, and the
 * document below repeated it as a guarantee. The refusal is the guarantee.
 *
 * THE ORDER OF OPERATIONS IS THE POINT
 * ------------------------------------
 * Anchor, then salvage, then remove the worktree, then delete the branch with
 * `-d`. The anchor (`refs/keep/disposed/<name>`) means no `git gc` can make a
 * disposed branch unreachable, which converts "irreversible" into "reversible
 * with one command" at the cost of a single ref. `git branch -d` refuses an
 * unmerged branch, and that refusal is the whole guard on the last step.
 *
 * NOT A SUBSTITUTE FOR READING THE INVENTORY
 * -------------------------------------------
 * This program enforces that the answer is the generated `action`; it does not
 * decide what the answer is. A worktree the inventory calls `at-risk` because a
 * curated finding protects it stays exactly where it is.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readBoard } from './lib/worktree-inventory/board.mjs';
import { resolveSessionDb } from './lib/worktree-inventory/chats.mjs';
import { ACTION, LIVE_WINDOW_MS } from './lib/worktree-inventory/classify.mjs';
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
const REFUSALS = {
  'unknown-worktree': (t) =>
    `No worktree named "${t}" in \`git worktree list\`. Name it exactly as \`git worktree list\` does.`,
  'main-worktree': () =>
    'This is the main checkout. It is never a deletion candidate — it is the landing site every other session resolves paths through.',
  detached: () => 'HEAD is detached, so there is no branch to delete and no name to anchor. Resolve the branch first.',
  'no-branch': () => 'This worktree reports no branch, so there is nothing safe to delete after the worktree goes.',
  locked: (reason) =>
    `This worktree is \`git worktree lock\`ed${reason ? ` (${reason})` : ''}, so somebody marked it as not-to-be-touched by hand. Unlock it yourself if that is stale; do not force past it.`,
  prunable: (reason) =>
    `\`git worktree list\` still reports this worktree but ${reason}. Its directory is gone or its administrative entry is stale, so there is nothing to salvage and no state to verify. Run \`git worktree prune\`, then re-generate the inventory.`,
  'no-tip': () =>
    'Git cannot read a tip commit for this worktree, so there is nothing to anchor and no proof of what would be removed.',
  'board-unavailable': (detail) =>
    `The board database could not be read (${detail}), so the claims, file locks and live agents that would say whether this worktree is in use are all unknown. An absent signal is not an unowned worktree — restore the board, or ask the operator.`,
  'sessions-unavailable': (detail) =>
    `The Kilo session database could not be read (${detail}), so a chat with this worktree as its \`directory\` cannot be ruled out. An absent signal is not an absent chat.`,
  'derived-live-writer': (ids) =>
    `The inventory records this worktree as derived-live: ${ids} wrote a file in it inside the live window. \`classify.mjs\` reports \`live\` as false only when \`--no-live-writers\` suppressed it, so the \`dispose\` beside it is a suppression, not a clearance.`,
  'inventory-missing': () =>
    'WORKTREES.json is absent. Run `node scripts/worktree-inventory.mjs` first — a disposal with no inventory is a guess.',
  'inventory-stale': (age, generatedAt) =>
    `WORKTREES.json was generated ${Math.round(age / 60000)} min ago (${generatedAt}), over the ${MAX_INVENTORY_AGE_MS / 60000} min limit. Re-run \`node scripts/worktree-inventory.mjs\` and read the new verdict; a decision about a live worktree is exactly the one that goes stale.`,
  'not-in-inventory': () =>
    'The inventory has no entry for this worktree, so its action is unknown. Regenerate, or add a curated entry if it is a real finding.',
  'action-not-dispose': (action) =>
    `The inventory says \`action: "${action}"\`, not \`"${ACTION.DISPOSE}"\`. Per docs/ORCHESTRATION.md that is not a deletion candidate — \`in-use\` means leave it alone, \`land\` means merge it, \`at-risk\` means save it, \`undecided\` means do not remove it.`,
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
  'dirty-tree-unreadable': (detail) =>
    `\`git status\` failed on this worktree (${detail}), so its cleanliness is UNKNOWN rather than clean. This program will not read an unreadable tree as an empty one; restore the worktree's git state, or ask the operator.`,
  'ignored-content': (count, paths) =>
    `The working tree holds ${count} gitignored path(s) that no command rebuilds, so they exist in no commit, no ref and no reflog: ${paths.slice(0, 8).join(', ')}${paths.length > 8 ? `, +${paths.length - 8} more` : ''}. \`git status\` does not list these, which is why a tree holding only them reads as clean. Commit them with \`git add -f\`, or move them out, before removing the directory.`,
  'ambiguous-name': (target, paths) =>
    `"${target}" is the basename of ${paths.length} worktrees, so the name does not identify one: ${paths.join(', ')}. Pass the full path — git refuses to create two worktrees at the same path, so a path is unique where a basename is not.`,
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
 * Deliberately NOT on this list: \`.serena/\`, \`.vscode/*\`, \`*.local\`,
 * \`playwright/.auth\`, \`test-results/\`, \`playwright-report/\`. They are ignored,
 * which is a statement about version control and not about whether they are
 * worth anything — an auth state and a session index are both real work, and the
 * inventory flagged \`.serena/\` alone as a reason a worktree was never free.
 */
const REGENERABLE_IGNORED = [
  { prefix: 'node_modules/', rebuild: 'npm ci' },
  { prefix: 'dist/', rebuild: 'npm run build' },
  { prefix: 'dist-ssr/', rebuild: 'npm run build' },
  { prefix: 'coverage/', rebuild: 'npm run test -- --coverage' },
  { prefix: 'coverage-e2e/', rebuild: 'npm run test:e2e:unit:coverage' },
  { prefix: 'test-results/', rebuild: 'npm run test:e2e' },
  { prefix: 'playwright-report/', rebuild: 'npm run test:e2e' },
  { prefix: 'blob-report/', rebuild: 'npm run test:e2e' },
  { prefix: 'playwright/.cache/', rebuild: 'npm run test:e2e' },
  { prefix: '.vite/', rebuild: 'npm run dev' },
  { prefix: '.vitest/', rebuild: 'npm run test' },
  { prefix: '.kilo/', rebuild: 'this worktree is disposable; nothing in it is committed anywhere' },
  { prefix: '.eslintcache', rebuild: 'npm run lint:check' },
  { prefix: 'tsconfig.tsbuildinfo', rebuild: 'npm run tsc' },
  { prefix: 'WORKTREES.json', rebuild: 'node scripts/worktree-inventory.mjs' },
];

/**
 * True when no command rebuilds this ignored path.
 *
 * A \`*.log\` file is on neither side of this: it is not in the list, so it counts
 * as content, and that is the intended reading — a log is the record of what a
 * dead session was doing when it died, and it is the one ignored file class a
 * cleanup sweep most often throws away by accident.
 */
export function isRegenerableIgnored(path) {
  return REGENERABLE_IGNORED.some((entry) => path === entry.prefix || path.startsWith(entry.prefix));
}

/** The ignored paths a disposal would destroy, with the command for each that rebuilds one. */
export function nonRegenerableIgnored(paths) {
  return paths.filter((path) => !isRegenerableIgnored(path));
}

/** The rebuild command for an ignored path, or null when nothing rebuilds it. */
export function rebuildCommand(path) {
  const entry = REGENERABLE_IGNORED.find((e) => path === e.prefix || path.startsWith(e.prefix));
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
  inventory,
  board,
  sessions,
  maxAgeMs = MAX_INVENTORY_AGE_MS,
} = {}) {
  const failures = [];
  const refuse = (code, ...args) => failures.push({ code, message: REFUSALS[code] ? REFUSALS[code](...args) : code });

  if (!gitState?.found) {
    refuse('unknown-worktree', target);
    return { ok: false, failures, record: null };
  }
  if (gitState.isPrimary) refuse('main-worktree');
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
    else refuse('not-in-inventory');
  } else {
    const age = nowMs - inventory.generatedAtMs;
    if (!Number.isFinite(age) || age > maxAgeMs) refuse('inventory-stale', age, inventory.generatedAt);
    if (!inventory.record) refuse('not-in-inventory');
    else {
      if (inventory.record.action !== ACTION.DISPOSE) refuse('action-not-dispose', inventory.record.action);
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
    refuse('dirty-tree-unreadable', gitState.statusError);
  }

  if ((gitState.modified ?? 0) + (gitState.untracked ?? 0) > 0) {
    refuse('dirty-tree', gitState.modified, gitState.untracked, gitState.dirtyPaths ?? []);
  }

  // The content `git status` cannot see, minus what a command rebuilds.
  if ((gitState.ignoredWork ?? []).length > 0) {
    refuse('ignored-content', gitState.ignoredWork.length, gitState.ignoredWork);
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

  return { ok: failures.length === 0, failures, record: inventory?.record ?? null };
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
  } catch {
    return { found: false };
  }
  if (!Array.isArray(entries) || entries.length === 0) return { found: false, known: [] };

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
  let modified = 0;
  let untracked = 0;
  let dirtyPaths = [];
  let statusError = null;
  let ignoredPaths = [];
  try {
    tip = run(absolutePath, ['rev-parse', 'HEAD']).stdout.trim();
  } catch {
    tip = null;
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
    const ignored = run(absolutePath, ['ls-files', '--others', '--ignored', '--exclude-standard']).stdout;
    ignoredPaths = ignored.split('\0').filter(Boolean);
  } catch (err) {
    // `modified` and `untracked` stay 0, which is what made a prunable worktree
    // read as clean. They are not reported as clean: `tip === null` and
    // `prunableReason` are separate refusals, and `no-tip` catches the rest.
    // `statusError` is READ, not merely recorded — it used to be written at three
    // places and consumed at none, so a `git status` that failed for any reason
    // left the counts at zero and every gate above read that as clean.
    dirtyPaths = [];
    statusError = String(err?.message ?? err).split('\n')[0];
  }

  const ignoredWork = nonRegenerableIgnored(ignoredPaths);

  return {
    found: true,
    name: basename(absolutePath),
    absolutePath,
    branch: match.detached ? '(detached)' : (match.branch ?? '(unknown)'),
    detached: Boolean(match.detached),
    locked: match.locked ?? false,
    prunableReason: match.prunableReason ?? null,
    tip,
    isPrimary: commonDir !== '' && gitDir === commonDir,
    commonDir,
    modified,
    untracked,
    dirtyPaths,
    statusError,
    ignoredPaths,
    ignoredWork,
  };
}

/**
 * The inventory's verdict for one worktree, plus how old that verdict is.
 *
 * `WORKTREES.json` is untracked and gitignored on purpose, so it describes one
 * machine at one moment and a fresh clone has none. Both states are refusals
 * with different messages, because "absent" and "stale" call for different
 * next steps.
 */
function readInventory(cwd, gitState, { nowMs = Date.now(), path = join(cwd, 'WORKTREES.json') } = {}) {
  if (!existsSync(path)) return { ok: false, reason: 'missing', path };
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { ok: false, reason: 'unreadable', path };
  }
  const generatedAtMs = Date.parse(doc.generatedAt);
  const record =
    (doc.worktrees ?? []).find((w) => realpathIfExists(w.absolutePath ?? w.path) === gitState.absolutePath) ?? null;
  return {
    ok: true,
    reason: null,
    path,
    generatedAt: doc.generatedAt ?? null,
    generatedAtMs: Number.isNaN(generatedAtMs) ? NaN : generatedAtMs,
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
  run(cwd, ['update-ref', ref, gitState.tip]);
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
  const dir = join(gitState.commonDir, 'worktree-salvage', gitState.name);
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
    ]).stdout;
    const worth = ignored
      .split('\0')
      .filter(Boolean)
      .filter((path) => !isRegenerableIgnored(path));
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
function firstLine(err) {
  return (
    String(err?.message ?? err)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(1)
      .join(' ')
      .slice(0, 200) || 'unknown error'
  );
}

/**
 * The removal itself. No `--force` parameter exists on this function, so no
 * caller can pass one.
 *
 * `git branch -d` rather than `-D`: it refuses an unmerged branch, and that
 * refusal is the guard. The anchor above means a branch kept by that refusal is
 * still recoverable either way, so there is nothing to gain by forcing it and a
 * work to lose.
 */
export function dispose(cwd, gitState, { run = defaultRun, fs = defaultFs, tar = defaultTar } = {}) {
  const steps = [];
  const ref = anchor(cwd, gitState, { run });
  if (ref) steps.push(`anchored ${gitState.tip} at ${ref}`);

  const saved = salvage(cwd, gitState, { run, fs, tar });
  if (saved) steps.push(`salvaged ${saved.written.join(', ')} to ${saved.dir}`);
  if (saved?.failed?.length) steps.push(`SALVAGE INCOMPLETE — ${saved.failed.join('; ')}`);

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
    return { steps, branchDeleted: false, worktreeRemoved: false, anchorRef: ref, salvage: saved };
  }

  let branchDeleted = false;
  try {
    run(cwd, ['branch', '-d', gitState.branch]);
    branchDeleted = true;
    steps.push(`deleted branch ${gitState.branch}`);
  } catch (err) {
    steps.push(
      `KEPT branch ${gitState.branch}: git refused \`-d\`, so it is unmerged (${firstLine(err)}). Its commits remain at ${ref ?? 'no anchor'}.`
    );
  }
  return { steps, branchDeleted, worktreeRemoved: true, anchorRef: ref, salvage: saved };
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

const USAGE = `Usage: node scripts/dispose-worktree.mjs <worktree> [--dry-run] [--max-age-minutes <n>]

  <worktree>   a path or a name as \`git worktree list\` prints it.

Refuses unless the generated inventory calls this worktree \`action: "dispose"\`,
no board claim, lock or live agent names it, no session has it as its directory
inside the live window, and its working tree is clean. Anchors the branch at
${KEEP_REF_PREFIX}<name> and salvages uncommitted work before removing anything.

There is no --force. A dirty tree is a finding to report, not an obstacle.
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
  const target = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--max-age-minutes');
  if (!target) {
    process.stderr.write(USAGE);
    return 3;
  }

  const cwd = process.cwd();
  const nowMs = Date.now();
  const gitState = readGitState(cwd, target);
  if (!gitState.found) {
    // An ambiguous name is NOT "no worktree named X". It is several, and
    // reporting that as absence would send the caller off to re-read a list that
    // already contains the answer.
    if (gitState.ambiguous) {
      process.stderr.write(
        `dispose: refusing "${gitState.target}" — it names ${gitState.candidates.length} worktrees.\n  ${gitState.candidates.join('\n  ')}\n\nPass the full path. Nothing was changed.\n`
      );
      return 3;
    }
    process.stderr.write(
      `dispose: no worktree "${target}". Known:\n${(gitState.known ?? []).map((n) => `  ${n}`).join('\n')}\n`
    );
    return 1;
  }

  const inventory = readInventory(cwd, gitState, { nowMs });
  const ownership = collectOwnership(cwd, gitState, { nowMs });
  const verdict = preflight({
    target,
    nowMs,
    gitState,
    inventory,
    board: ownership.board,
    sessions: ownership.sessions,
    maxAgeMs,
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
      `dispose: ${gitState.name} (${gitState.branch}) is clear to dispose.\n  would anchor ${gitState.tip} at ${ref ?? 'nothing — the ref name is invalid'}\n  would remove ${gitState.absolutePath}\n  would git branch -d ${gitState.branch}\n`
    );
    return 0;
  }

  const result = dispose(cwd, gitState);
  for (const step of result.steps) process.stdout.write(`  ${step}\n`);
  if (!result.worktreeRemoved) {
    process.stderr.write('dispose: nothing was deleted.\n');
    return 2;
  }
  process.stdout.write(
    `dispose: ${gitState.name} disposed. The inventory is now stale; re-run \`node scripts/worktree-inventory.mjs\`.\n`
  );
  return result.branchDeleted ? 0 : 2;
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
  const hash = createHash('sha256')
    .update(String(source ?? ''))
    .digest('hex')
    .slice(0, 9);
  return `-g${hash}`;
}

if (process.argv[1] && realpathIfExists(process.argv[1]) === realpathIfExists(new URL(import.meta.url).pathname)) {
  process.exitCode = main(process.argv);
}
