import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

function resolvedAbsolutePath(path) {
  const absolute = resolve(path);
  let current = absolute;
  const suffix = [];
  while (true) {
    try {
      return join(realpathSync(current), ...suffix.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return absolute;
      suffix.push(basename(current));
      current = parent;
    }
  }
}

function normalizedAbsolutePath(path) {
  const resolved = resolvedAbsolutePath(path);
  return resolved.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
}

function sameExistingWindowsPath(left, right) {
  if (process.platform !== 'win32') return false;
  try {
    const leftStats = statSync(left, { bigint: true });
    const rightStats = statSync(right, { bigint: true });
    const leftKind = leftStats.isDirectory() ? 'directory' : leftStats.isFile() ? 'file' : null;
    const rightKind = rightStats.isDirectory() ? 'directory' : rightStats.isFile() ? 'file' : null;
    // Node exposes the volume and filesystem-specific inode. Require both values and
    // matching object kinds so unsupported filesystems cannot turn unknown identity
    // into a match or a file into its parent directory.
    return (
      leftKind !== null &&
      leftKind === rightKind &&
      leftStats.dev !== 0n &&
      rightStats.dev !== 0n &&
      leftStats.ino !== 0n &&
      leftStats.dev === rightStats.dev &&
      leftStats.ino === rightStats.ino
    );
  } catch {
    return false;
  }
}

/** Stable grouping key for a path in one filesystem inventory pass. */
export function pathIdentityKey(path) {
  if (typeof path !== 'string' || !path) return null;
  const normalized = normalizedAbsolutePath(path);
  if (process.platform === 'win32') {
    try {
      const stats = statSync(path, { bigint: true });
      const kind = stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : null;
      if (kind && stats.dev !== 0n && stats.ino !== 0n) return `${kind}:${stats.dev}:${stats.ino}`;
    } catch {
      // Keep an exact resolved path key when filesystem identity is unavailable.
    }
  }
  return `path:${normalized}`;
}

/** Compare existing file or directory identity without assuming path spellings match. */
export function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
  if (normalizedAbsolutePath(left) === normalizedAbsolutePath(right)) return true;
  return sameExistingWindowsPath(left, right);
}

/**
 * Return a POSIX-separated relative path only when target is inside root.
 * Existing symlinks in either path are resolved before containment is checked, and
 * missing descendants are appended to the nearest resolved ancestor.
 * Existing Windows directories are matched by filesystem identity when their
 * short-name, long-name, case, or separator spellings differ. If identity cannot
 * be established, the function refuses the path.
 */
export function relativePathInside(root, target) {
  if (typeof root !== 'string' || typeof target !== 'string' || !root || !target) return null;

  const rootPath = resolve(root);
  const rootKey = normalizedAbsolutePath(root);
  const targetKey = normalizedAbsolutePath(target);
  if (rootKey === targetKey) return '';

  const rootPrefix = rootKey.endsWith('/') ? rootKey : `${rootKey}/`;
  if (targetKey.startsWith(rootPrefix)) return targetKey.slice(rootPrefix.length);

  let current = resolvedAbsolutePath(target);
  const descendants = [];
  while (true) {
    if (samePath(rootPath, current)) return descendants.reverse().join('/');
    const parent = dirname(current);
    if (parent === current) return null;
    descendants.push(basename(current));
    current = parent;
  }
}
