import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectOrphanBranches, main, report } from '../orphan-branches.mjs';

vi.setConfig({ testTimeout: 20_000 });

/**
 * A repository with three unmerged branches: one whose worktree still exists, one whose
 * worktree is gone, and one already merged.
 */
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'orphan-branches-')));
  const g = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  // Absolute only: `write(join(orphan, name))` would be joined twice and ENOENT.
  const write = (path, body) => writeFileSync(path, body);
  g('init', '--initial-branch=main', '--quiet');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  write(join(root, 'base.txt'), 'base\n');
  g('add', '-A');
  g('commit', '--quiet', '-m', 'base');

  const orphan = join(root, 'orphan-wt');
  g('worktree', 'add', '--quiet', '-b', 'orphan', orphan);
  write(join(orphan, 'orphan.txt'), 'orphan\n');
  execFileSync('git', ['add', '-A'], { cwd: orphan, stdio: 'ignore' });
  execFileSync('git', ['commit', '--quiet', '-m', 'orphan commit'], { cwd: orphan, stdio: 'ignore' });
  execFileSync('git', ['worktree', 'remove', orphan], { cwd: root, stdio: 'ignore' });

  const held = join(root, 'held-wt');
  g('worktree', 'add', '--quiet', '-b', 'held', held);
  write(join(held, 'held.txt'), 'held\n');
  execFileSync('git', ['add', '-A'], { cwd: held, stdio: 'ignore' });
  execFileSync('git', ['commit', '--quiet', '-m', 'held commit'], { cwd: held, stdio: 'ignore' });

  write(join(root, 'base.txt'), 'main moves\n');
  g('add', '-A');
  g('commit', '--quiet', '-m', 'main moves on');
  return root;
}

describe('a branch nobody holds', () => {
  it('reports an unmerged branch with no worktree and skips one that has it', () => {
    const root = fixture();
    try {
      const rows = collectOrphanBranches({ cwd: root, base: 'main' });
      // The branch whose worktree was removed is the whole point: it is invisible to
      // worktree-inventory, repo-state and dispose, all of which are per-worktree.
      expect(rows.map((r) => r.name)).toEqual(['orphan']);
      expect(rows[0].ahead).toBe(1);
      expect(rows[0].conflicts).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('counts a conflicting path from BOTH of git phrasings', () => {
    // `modify/delete` prints "deleted in X and modified in Y", never "Merge conflict in".
    // A regex that reads only the first phrasing undercounts the class that has no marker.
    const root = fixture();
    try {
      const g = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
      const orphan = join(root, 'orphan2-wt');
      g('worktree', 'add', '--quiet', '-b', 'orphan2', orphan);
      // Every one of these runs INSIDE the worktree. Run against `root` they land on main, and
      // the fixture then asserts nothing at all — which is exactly what the first version of this
      // test did, and why it passed vacuously on a branch that had no commit on it.
      const inOrphan = (...args) => execFileSync('git', args, { cwd: orphan, stdio: 'ignore' });
      rmSync(join(orphan, 'base.txt'), { force: true });
      inOrphan('add', '-A');
      inOrphan('commit', '--quiet', '-m', 'branch deletes base.txt');
      // `--force`: the branch deleted a tracked file, so the worktree is dirty and `remove`
      // alone refuses. The point of the fixture is the branch outliving its worktree, which is
      // what a `rm -rf` would fake by leaving the worktree REGISTERED.
      g('worktree', 'remove', '--force', orphan);
      writeFileSync(join(root, 'base.txt'), 'main edits it\n');
      g('add', '-A');
      g('commit', '--quiet', '-m', 'main edits base.txt');

      const rows = collectOrphanBranches({ cwd: root, base: 'main' });
      const orphan2 = rows.find((r) => r.name === 'orphan2');
      expect(orphan2).toBeTruthy();
      expect(orphan2.conflicts).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('says so plainly when there is nothing to report', () => {
    expect(report([], { base: 'main' })).toMatch(/^orphan-branches: none\./);
  });

  it('prints valid JSON for the machine-readable report', () => {
    const root = fixture();
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(main(['--json', '--limit', '1'], { cwd: root })).toBe(0);
      expect(JSON.parse(String(write.mock.calls[0][0]))).toMatchObject({
        base: 'main',
        count: 1,
        branches: [{ name: 'orphan' }],
      });
    } finally {
      write.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('states that it retires nothing', () => {
    const text = report([{ name: 'x', base: 'main', lastCommit: '2026-10-05', behind: 3, ahead: 1, conflicts: 2 }], {
      base: 'main',
    });
    // A report that also acted would be a second `dispose` with none of dispose's checks.
    expect(text).toMatch(/Nothing here is retired by this command/);
    expect(text).toMatch(/x\s+2\s+conflicts\s+3\s+behind/);
  });

  it('keeps total count separate from limited JSON branches', () => {
    const root = fixture();
    try {
      const g = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
      const extra = join(root, 'extra-wt');
      g('worktree', 'add', '--quiet', '-b', 'orphan-extra', extra);
      writeFileSync(join(extra, 'extra.txt'), 'extra\n');
      execFileSync('git', ['add', '-A'], { cwd: extra, stdio: 'ignore' });
      execFileSync('git', ['commit', '--quiet', '-m', 'orphan-extra commit'], { cwd: extra, stdio: 'ignore' });
      g('worktree', 'remove', extra);
      const rows = collectOrphanBranches({ cwd: root, base: 'main' });
      expect(rows).toHaveLength(2);

      const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      try {
        expect(main(['--json', '--limit', '1'], { cwd: root })).toBe(0);
        expect(JSON.parse(String(write.mock.calls[0][0]))).toEqual({
          base: 'main',
          count: rows.length,
          branches: rows.slice(0, 1),
        });
      } finally {
        write.mockRestore();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
