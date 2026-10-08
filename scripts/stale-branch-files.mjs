import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MAIN_REF = 'refs/heads/main';

function git(args, cwd, { binary = false } = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: binary ? null : 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitText(args, cwd) {
  return git(args, cwd).trim();
}

function treeBlob(commit, path, cwd) {
  const entries = git(['ls-tree', '-r', '-z', '--full-tree', commit, '--', `:(literal)${path}`], cwd, {
    binary: true,
  })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);

  for (const entry of entries) {
    const separator = entry.indexOf('\t');
    if (separator === -1 || entry.slice(separator + 1) !== path) continue;
    const [, type, object] = entry.slice(0, separator).split(' ');
    return type === 'blob' ? object : null;
  }
  return null;
}

function changedPaths(base, branch, cwd) {
  return git(['diff', '--name-only', '--no-renames', '--diff-filter=ACMRTUXB', '-z', base, branch, '--'], cwd, {
    binary: true,
  })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

export function inspectBranch({ cwd = process.cwd(), branchSha, mainRef = MAIN_REF } = {}) {
  if (!branchSha) throw new Error('a pushed commit is required');
  const branch = gitText(['rev-parse', '--verify', '--end-of-options', `${branchSha}^{commit}`], cwd);
  const main = gitText(['rev-parse', '--verify', '--end-of-options', `${mainRef}^{commit}`], cwd);
  const base = gitText(['merge-base', main, branch], cwd);
  const merges = gitText(['rev-list', '--first-parent', '--merges', `${base}..${branch}`], cwd);

  if (merges) return { mergeBase: base, skipped: 'first-parent merge', findings: [] };

  const findings = [];
  for (const path of changedPaths(base, branch, cwd)) {
    const branchBlob = treeBlob(branch, path, cwd);
    if (!branchBlob) continue;

    const baseBlob = treeBlob(base, path, cwd);
    if (branchBlob === baseBlob) continue;

    const ancestors = gitText(['log', '--format=%H', base, '--', `:(literal)${path}`], cwd)
      .split('\n')
      .filter((commit) => commit && commit !== base);

    for (const ancestor of ancestors) {
      if (treeBlob(ancestor, path, cwd) === branchBlob) {
        findings.push({ path, ancestor });
        break;
      }
    }
  }

  return { mergeBase: base, skipped: null, findings };
}

function parsePushInput(input) {
  return input
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const fields = line.trim().split(/\s+/);
      if (fields.length !== 4) throw new Error(`invalid pre-push ref record: ${line}`);
      const [localRef, localSha, remoteRef, remoteSha] = fields;
      return { localRef, localSha, remoteRef, remoteSha };
    });
}

export function runPrePush(input, { cwd = process.cwd(), stderr = process.stderr } = {}) {
  const zeroSha = /^0+$/;
  let failed = false;

  for (const { localRef, localSha } of parsePushInput(input)) {
    if (!localRef.startsWith('refs/heads/') || localRef === MAIN_REF || zeroSha.test(localSha)) continue;

    const { findings } = inspectBranch({ cwd, branchSha: localSha });
    for (const finding of findings) {
      stderr.write(
        `stale-branch-files: ${localRef} has ${JSON.stringify(finding.path)} matching ancestor ` +
          `${finding.ancestor.slice(0, 12)}, but not merge-base; verify this is intentional before pushing\n`
      );
      failed = true;
    }
  }

  return failed ? 1 : 0;
}

function main() {
  try {
    process.exitCode = runPrePush(readFileSync(0, 'utf8'));
  } catch (error) {
    process.stderr.write(`stale-branch-files: cannot verify pushed branches: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
