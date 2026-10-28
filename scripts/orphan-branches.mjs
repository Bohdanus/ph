#!/usr/bin/env node
/**
 * Unmerged branches whose worktree is gone.
 *
 * WHY THIS IS NOT THE WORKTREE INVENTORY
 * --------------------------------------
 * Every other instrument in this repository is per-WORKTREE: `worktree-inventory.mjs`
 * enumerates worktrees, `npm run repo:state` reads one worktree's git markers, `npm run
 * dispose` acts on a named one, `npm run swarm --release-merged` acts on one. The thing that
 * actually goes stale is a BRANCH, and a branch is visible for exactly as long as somebody still
 * holds its worktree. The moment that session ends — a chat that dies, an agent that finishes, a
 * worktree that gets disposed — the branch goes dark, keeps its commits, and starts reporting
 * conflicts against a `main` it can no longer be merged into without a human deciding to.
 *
 * `git branch --no-merged` appears in no other script here, so that decision is currently only
 * ever made by remembering.
 *
 * MEASURED at `main` b16a8368: 58 unmerged branches, 58 with no worktree, 50 already conflicting
 * with main, a median 460 commits behind, holding 192 commits main does not have. Re-derive with
 * `node scripts/orphan-branches.mjs` and the figures move with main, which is the point.
 *
 * WHAT IT DOES NOT DECIDE. Nothing here lands, rebases, archives or deletes a branch. The report
 * carries the three numbers a decision needs — how far behind, how many conflicts, how many
 * commits main lacks — and a branch is retired by a person or by an agent that has read this.
 * A report that also acted would be a second `dispose` with none of `dispose`'s inventory, locks
 * and board checks, which is exactly the class of tool this repository keeps paying for.
 *
 * EXIT STATUS: 0 when it produced a report, 1 when it could not look. The same rule as
 * `npm run repo:state`, because a report that answered "it could not read the worktree list" with
 * exit 0 is the surface a person trusts most.
 */
import { execFileSync } from 'node:child_process';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const pad = (value, width) => String(value).padEnd(width);

/**
 * Branches whose tip `base` does not contain, with no worktree holding them.
 *
 * `--no-merged` is the definition of unmerged: git itself decides, so this cannot drift from
 * `git branch --merged` the way a merge-base comparison written by hand would.
 *
 * A branch WITH a worktree is excluded, because `worktree-inventory.mjs` already reports it with
 * an action attached, and printing it here too would be two homes for one branch.
 */
export function collectOrphanBranches({ cwd, base = 'main' } = {}) {
  const root = cwd ?? process.cwd();
  const merged = new Set();
  for (const line of git(['worktree', 'list', '--porcelain'], root).split('\n')) {
    if (!line.startsWith('branch refs/heads/')) continue;
    merged.add(line.slice('branch refs/heads/'.length).trim());
  }

  const listing = git(['branch', '--no-merged', base, '--format=%(refname:short)%09%(committerdate:iso-strict)'], root)
    .split('\n')
    .filter(Boolean);

  const rows = [];
  for (const line of listing) {
    const [name, date] = line.split('\t');
    if (!name || merged.has(name)) continue;
    rows.push(describeBranch(root, { name, date, base }));
  }
  // Conflicts first, because a branch nobody can merge is a different problem from a branch
  // nobody has looked at; then how far behind, because that is the cost of looking late.
  rows.sort((a, b) => b.conflicts - a.conflicts || b.behind - a.behind || (a.name < b.name ? -1 : 1));
  return rows;
}

/**
 * Three numbers, each one command, each one the number an agent would otherwise compute by hand.
 *
 * `conflicts` counts the paths git says it cannot merge, from BOTH of its conflict phrasings —
 * `Merge conflict in <path>` and the `deleted in <x> and modified in <y>` form. Reading only the
 * first undercounts, which is the mistake that made a whole class of merge damage look smaller
 * than it was until an independent reviewer re-measured it.
 */
function describeBranch(root, { name, date, base }) {
  const behind = count(root, ['rev-list', '--count', `${name}..${base}`]);
  const ahead = count(root, ['rev-list', '--count', `${base}..${name}`]);
  return { name, base, lastCommit: (date ?? '').slice(0, 10), behind, ahead, conflicts: conflicts(root, name, base) };
}

function conflicts(root, name, base) {
  let out = '';
  try {
    out = git(['merge-tree', '--write-tree', base, name], root);
  } catch (err) {
    // Exit 1 means "conflicted", and git still prints the tree and the messages.
    out = String(err?.stdout ?? '');
    if (out === '') return -1; // could not compute, and -1 must not be mistaken for zero
  }
  const lines = out.split('\n').filter((l) => l.startsWith('CONFLICT ('));
  const paths = new Set();
  for (const line of lines) {
    const merge = /: Merge conflict in (.+)$/.exec(line);
    if (merge) {
      paths.add(merge[1].trim());
      continue;
    }
    const deleteConflict = /: (.+?) (?:deleted in|added in) /.exec(line);
    if (deleteConflict) paths.add(deleteConflict[1].trim());
  }
  return paths.size;
}

function count(root, args) {
  return Number(git(args, root).trim() || 0);
}

export function report(rows, { base = 'main' } = {}) {
  if (rows.length === 0) return `orphan-branches: none. Every branch \`${base}\` does not contain has a worktree.`;
  const lines = [
    `orphan-branches — ${rows.length} branch(es) \`${base}\` does not contain, with no worktree holding them.`,
    'Behind is how far main has moved; ahead is how many commits main lacks; conflicts is what git cannot merge.',
    '',
  ];
  for (const r of rows) {
    const conflicts = r.conflicts < 0 ? '?' : String(r.conflicts);
    lines.push(
      `  ${pad(r.name, 46)} ${pad(conflicts, 4)} conflicts  ${pad(r.behind, 6)} behind  ` +
        `${pad(r.ahead, 4)} ahead  last commit ${r.lastCommit}`
    );
  }
  lines.push('');
  lines.push(
    '  Nothing here is retired by this command. Read `docs/ORCHESTRATION.md#landing` before landing or disposing one.'
  );
  return lines.join('\n');
}

export function main(argv, { cwd = process.cwd() } = {}) {
  const base = valueOf(argv, '--base') ?? 'main';
  const rows = collectOrphanBranches({ cwd, base });
  const json = argv.includes('--json');
  const max = valueOf(argv, '--limit');
  const shown = max ? rows.slice(0, Number(max)) : rows;
  const payload = json
    ? { base, count: rows.length, branches: shown }
    : `${report(shown, { base })}\n\n  ${rows.length} total.`;
  process.stdout.write(`${json ? JSON.stringify(payload) : payload}\n`);
  return 0;
}

function valueOf(argv, flag) {
  const at = argv.indexOf(flag);
  return at === -1 ? null : (argv[at + 1] ?? null);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`orphan-branches: could not read this repository — ${err.message}\n`);
    process.exit(1);
  }
}
