/**
 * Make a short-lived online backup of the live Kilo session database.
 *
 * The session database is an operational SQLite database. Running the inventory
 * queries against it directly keeps a read transaction open while JSON payloads
 * are scanned, which can block the Kilo writer on rollback-journal databases and
 * starve checkpoints on WAL databases. SQLite's online backup API copies pages
 * in small steps while other connections continue to mutate the source.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const SNAPSHOT_PREFIX = 'worktree-inventory-session-';
const SNAPSHOT_RATE = 1;

/**
 * Copy a live session database to a private temporary file.
 *
 * A failed snapshot returns `null`; callers must not fall back to querying the
 * live path, because a partial safety improvement is still a live-db lock.
 */
export async function createSessionDbSnapshot(dbPath) {
  if (typeof dbPath !== 'string' || dbPath.length === 0) return null;

  let source;
  let directory;
  try {
    source = new DatabaseSync(dbPath, { readOnly: true });
    directory = await mkdtemp(join(tmpdir(), SNAPSHOT_PREFIX));
    const snapshotPath = join(directory, 'kilo.db');
    await backup(source, snapshotPath, { rate: SNAPSHOT_RATE });
    source.close();

    let cleaned = false;
    return {
      dbPath: snapshotPath,
      sourcePath: dbPath,
      async cleanup() {
        if (cleaned) return;
        cleaned = true;
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch {
    try {
      source?.close();
    } catch {
      // The failed open/backup is already represented by the null result.
    }
    if (directory) await rm(directory, { recursive: true, force: true });
    return null;
  }
}
