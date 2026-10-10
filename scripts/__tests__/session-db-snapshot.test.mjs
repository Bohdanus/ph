import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSessionDbSnapshot } from '../lib/worktree-inventory/session-db-snapshot.mjs';

describe('createSessionDbSnapshot', () => {
  it('copies a live database and removes the snapshot after cleanup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-snapshot-test-'));
    const sourcePath = join(dir, 'source.db');
    const source = new DatabaseSync(sourcePath);
    source.exec("CREATE TABLE records (value TEXT); INSERT INTO records VALUES ('before')");
    source.close();

    const snapshot = await createSessionDbSnapshot(sourcePath);
    expect(snapshot).not.toBeNull();
    expect(snapshot.dbPath).not.toBe(sourcePath);
    expect(snapshot.sourcePath).toBe(sourcePath);
    expect(existsSync(snapshot.dbPath)).toBe(true);

    const copy = new DatabaseSync(snapshot.dbPath, { readOnly: true });
    expect(copy.prepare('SELECT value FROM records').get().value).toBe('before');
    copy.close();

    await snapshot.cleanup();
    expect(existsSync(snapshot.dbPath)).toBe(false);
    await snapshot.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null for a missing source instead of exposing the live path', async () => {
    expect(await createSessionDbSnapshot('/missing/kilo.db')).toBeNull();
  });
});
