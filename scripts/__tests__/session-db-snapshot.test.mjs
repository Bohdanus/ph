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

  it('lets a concurrent writer proceed between one-page backup steps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-snapshot-writer-test-'));
    const sourcePath = join(dir, 'source.db');
    const source = new DatabaseSync(sourcePath);
    source.exec('CREATE TABLE records (value TEXT)');
    const insert = source.prepare('INSERT INTO records VALUES (?)');
    source.exec('BEGIN');
    for (let i = 0; i < 200_000; i += 1) insert.run(String(i));
    source.exec('COMMIT');
    source.close();

    const writer = new DatabaseSync(sourcePath);
    let writerResult;
    const writerTurn = new Promise((resolve) => {
      setTimeout(() => {
        try {
          writer.exec("INSERT INTO records VALUES ('concurrent')");
          writerResult = { ok: true };
        } catch (error) {
          writerResult = { ok: false, error: error.message };
        }
        resolve();
      }, 0);
    });

    const snapshot = await createSessionDbSnapshot(sourcePath);
    await writerTurn;
    writer.close();

    expect(snapshot).not.toBeNull();
    expect(writerResult).toEqual({ ok: true });
    await snapshot.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });
});
