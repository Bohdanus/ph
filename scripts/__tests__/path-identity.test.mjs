import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pathIdentityKey, relativePathInside, samePath } from '../lib/path-identity.mjs';

vi.setConfig({ testTimeout: 15_000 });

const temporaryDirectories = [];

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'path-identity-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('filesystem path identity', () => {
  it('matches the current checkout as reported by Git and Node', () => {
    const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    expect(samePath(process.cwd(), gitRoot)).toBe(true);
    expect(relativePathInside(process.cwd(), gitRoot)).toBe('');
    expect(relativePathInside(process.cwd(), join(gitRoot, 'scripts', 'missing-test-file.mjs'))).toBe(
      'scripts/missing-test-file.mjs'
    );
  });

  it.skipIf(process.platform !== 'win32')('matches case variants of existing Windows paths', () => {
    const root = temporaryDirectory();
    const child = join(root, 'child');
    mkdirSync(child);

    expect(samePath(root, root.toUpperCase())).toBe(true);
    expect(pathIdentityKey(root)).toBe(pathIdentityKey(root.toUpperCase()));
    expect(relativePathInside(root.toUpperCase(), child)).toBe('child');
  });

  it('returns a relative path only for descendants of the same directory', () => {
    const root = temporaryDirectory();
    const child = join(root, 'child');
    const outside = temporaryDirectory();
    mkdirSync(child);
    writeFileSync(join(child, 'file.txt'), 'file');

    expect(samePath(root, root)).toBe(true);
    expect(samePath(root, child)).toBe(false);
    expect(samePath(join(child, 'file.txt'), join(child, 'file.txt'))).toBe(true);
    expect(samePath(root, join(child, 'file.txt'))).toBe(false);
    expect(pathIdentityKey(root)).toBe(pathIdentityKey(root));
    expect(pathIdentityKey(root)).not.toBe(pathIdentityKey(child));
    expect(relativePathInside(root, child)).toBe('child');
    expect(relativePathInside(root, join(child, 'file.txt'))).toBe('child/file.txt');
    expect(relativePathInside(root, join(root, 'not-created', 'yet.txt'))).toBe('not-created/yet.txt');
    expect(relativePathInside(root, join(root, 'missing', 'deep', 'file.txt'))).toBe('missing/deep/file.txt');
    expect(relativePathInside(root, outside)).toBeNull();
    expect(relativePathInside(child, root)).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('does not follow a directory symlink outside the root', () => {
    const root = temporaryDirectory();
    const outside = temporaryDirectory();
    const rootAlias = join(temporaryDirectory(), 'root-link');
    mkdirSync(join(root, 'child'));
    symlinkSync(outside, join(root, 'outside-link'), 'dir');
    symlinkSync(root, rootAlias, 'dir');

    expect(relativePathInside(root, join(root, 'outside-link', 'not-created.txt'))).toBeNull();
    expect(relativePathInside(rootAlias, join(root, 'child'))).toBe('child');
    expect(relativePathInside(rootAlias, join(rootAlias, 'child'))).toBe('child');
  });
});
