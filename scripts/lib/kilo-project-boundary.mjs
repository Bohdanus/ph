import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

function isSameOrNestedPath(path, parent) {
  const remainder = relative(parent, path);
  return remainder === '' || (remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder));
}

export async function resolveStandardKiloDataPath(systemHome) {
  try {
    return await realpath(join(systemHome, '.local', 'share', 'kilo'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return undefined;
    throw error;
  }
}

export function ignoredKiloAuthProjectMarkers({ resolvedKiloData, resolvedSystemHome, resolvedStandardKiloData }) {
  const ignoredMarkersAt = new Map();
  const usesStandardKiloData =
    typeof resolvedStandardKiloData === 'string' && isSameOrNestedPath(resolvedKiloData, resolvedStandardKiloData);

  if (usesStandardKiloData) {
    // These are user-level settings; a Git marker at the account root remains a project boundary.
    ignoredMarkersAt.set(resolvedSystemHome, new Set(['.kilo', '.kilocode']));
  }
  if (usesStandardKiloData) ignoredMarkersAt.set(resolvedStandardKiloData, new Set(['.kilo']));
  return ignoredMarkersAt;
}

export async function hasProjectBoundaryAncestor(directory, { ignoredMarkersAt = new Map() } = {}) {
  let current = directory;
  while (true) {
    for (const marker of ['.git', '.kilo', '.kilocode']) {
      if (ignoredMarkersAt.get(current)?.has(marker)) continue;
      try {
        await lstat(join(current, marker));
        return true;
      } catch (error) {
        if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      }
    }
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}
