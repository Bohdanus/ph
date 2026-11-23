import { expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  hasProjectBoundaryAncestor,
  ignoredKiloAuthProjectMarkers,
  resolveStandardKiloDataPath,
} from '../lib/kilo-project-boundary.mjs';

it('ignores only canonical global Kilo markers for nested data and preserves project boundaries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kilo-auth-boundary-'));
  const systemHome = join(directory, 'account');
  const standardKiloData = join(systemHome, '.local', 'share', 'kilo');
  const nestedKiloData = join(standardKiloData, 'projects', 'example', 'kilo');

  try {
    await mkdir(nestedKiloData, { recursive: true });
    await mkdir(join(systemHome, '.kilo'), { recursive: true });
    await mkdir(join(systemHome, '.kilocode'), { recursive: true });
    await mkdir(join(standardKiloData, '.kilo'), { recursive: true });

    const ignoredMarkersAt = ignoredKiloAuthProjectMarkers({
      resolvedKiloData: nestedKiloData,
      resolvedSystemHome: systemHome,
      resolvedStandardKiloData: standardKiloData,
    });

    expect(ignoredMarkersAt.get(systemHome)).toEqual(new Set(['.kilo', '.kilocode']));
    expect(ignoredMarkersAt.get(standardKiloData)).toEqual(new Set(['.kilo']));
    await expect(hasProjectBoundaryAncestor(nestedKiloData, { ignoredMarkersAt })).resolves.toBe(false);

    await writeFile(join(systemHome, '.git'), 'project root');
    await expect(hasProjectBoundaryAncestor(nestedKiloData, { ignoredMarkersAt })).resolves.toBe(true);
    await rm(join(systemHome, '.git'));

    await writeFile(join(nestedKiloData, '.kilo'), 'nested project config');
    await expect(hasProjectBoundaryAncestor(nestedKiloData, { ignoredMarkersAt })).resolves.toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('does not treat a similarly prefixed project path as standard global Kilo data', () => {
  const systemHome = '/account';
  const standardKiloData = '/account/.local/share/kilo';
  const neighboringProject = '/account/.local/share/kilocode/project/kilo';
  const ignoredMarkersAt = ignoredKiloAuthProjectMarkers({
    resolvedKiloData: neighboringProject,
    resolvedSystemHome: systemHome,
    resolvedStandardKiloData: standardKiloData,
  });

  expect(ignoredMarkersAt.has(systemHome)).toBe(false);
  expect(ignoredMarkersAt.has(standardKiloData)).toBe(false);
});

it('does not ignore account-root project markers when auth uses noncanonical data', () => {
  const systemHome = '/account';
  const ignoredMarkersAt = ignoredKiloAuthProjectMarkers({
    resolvedKiloData: '/account/custom-data/kilo',
    resolvedSystemHome: systemHome,
    resolvedStandardKiloData: '/account/.local/share/kilo',
  });

  expect(ignoredMarkersAt.has(systemHome)).toBe(false);
});

it('recognizes standard global Kilo data through a symlink without ignoring project markers there', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kilo-auth-boundary-symlink-'));
  const systemHome = join(directory, 'account');
  const linkDirectory = join(systemHome, '.local', 'share');
  const storeDirectory = join(directory, 'global-store');
  const standardKiloData = join(storeDirectory, 'kilo');
  const nestedKiloData = join(standardKiloData, 'projects', 'example', 'kilo');

  try {
    await mkdir(join(systemHome, '.local'), { recursive: true });
    await mkdir(nestedKiloData, { recursive: true });
    await mkdir(join(systemHome, '.kilo'), { recursive: true });
    await mkdir(join(systemHome, '.kilocode'), { recursive: true });
    await mkdir(join(standardKiloData, '.kilo'), { recursive: true });
    await symlink(storeDirectory, linkDirectory, process.platform === 'win32' ? 'junction' : 'dir');

    const resolvedSystemHome = await realpath(systemHome);
    const resolvedKiloData = await realpath(nestedKiloData);
    const resolvedStandardKiloData = await resolveStandardKiloDataPath(resolvedSystemHome);
    expect(resolvedStandardKiloData).toBe(await realpath(standardKiloData));

    const ignoredMarkersAt = ignoredKiloAuthProjectMarkers({
      resolvedKiloData,
      resolvedSystemHome,
      resolvedStandardKiloData,
    });
    await expect(hasProjectBoundaryAncestor(resolvedKiloData, { ignoredMarkersAt })).resolves.toBe(false);

    await writeFile(join(storeDirectory, '.git'), 'project root');
    await expect(hasProjectBoundaryAncestor(resolvedKiloData, { ignoredMarkersAt })).resolves.toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
