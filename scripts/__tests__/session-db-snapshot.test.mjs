import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSessionDbSnapshot } from '../lib/worktree-inventory/session-db-snapshot.mjs';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function createSource(sourcePath) {
  const db = new DatabaseSync(sourcePath);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT, title TEXT,
      agent TEXT, slug TEXT, tokens_input INTEGER, tokens_output INTEGER,
      time_created INTEGER, time_updated INTEGER, time_archived INTEGER
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE INDEX part_session_idx ON part (session_id);
  `);
  return db;
}

function addSession(db, id, { parentId = null, at = NOW - 1 * DAY } = {}) {
  db.prepare(
    `INSERT INTO session
       (id, parent_id, directory, title, agent, slug, tokens_input, tokens_output,
        time_created, time_updated, time_archived)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, NULL)`
  ).run(id, parentId, `/repo/${id}`, id, null, id, at, at);
}

function addPart(db, id, sessionId, data, { created = NOW - 1 * DAY, updated = created } = {}) {
  db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?)').run(id, sessionId, created, updated, JSON.stringify(data));
}

describe('createSessionDbSnapshot', () => {
  it('copies only recent sessions, recent parts, and parent rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-snapshot-test-'));
    const sourcePath = join(dir, 'source.db');
    const source = createSource(sourcePath);
    addSession(source, 'recent');
    addSession(source, 'parent', { at: NOW - 30 * DAY });
    addSession(source, 'child', { parentId: 'parent' });
    addSession(source, 'old', { at: NOW - 30 * DAY });
    addPart(source, 'recent-part', 'recent', { type: 'tool' });
    addPart(source, 'child-part', 'child', { type: 'tool' });
    addPart(source, 'old-part', 'old', { type: 'tool' }, { created: NOW - 30 * DAY, updated: NOW - 30 * DAY });
    source.close();

    const snapshot = await createSessionDbSnapshot(sourcePath, { sinceMs: NOW - 3 * DAY, nowMs: NOW });
    expect(snapshot).not.toBeNull();
    expect(snapshot.sourcePath).toBe(sourcePath);
    expect(existsSync(snapshot.dbPath)).toBe(true);

    const copy = new DatabaseSync(snapshot.dbPath, { readOnly: true });
    expect(
      copy
        .prepare('SELECT id FROM session ORDER BY id')
        .all()
        .map((r) => r.id)
    ).toEqual(['child', 'parent', 'recent']);
    expect(
      copy
        .prepare('SELECT id FROM part ORDER BY id')
        .all()
        .map((r) => r.id)
    ).toEqual(['child-part', 'recent-part']);
    copy.close();

    await snapshot.cleanup();
    expect(existsSync(snapshot.dbPath)).toBe(false);
    await snapshot.cleanup();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('includes a part updated recently even when it was created earlier', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-snapshot-update-test-'));
    const sourcePath = join(dir, 'source.db');
    const source = createSource(sourcePath);
    addSession(source, 'session', { at: NOW - 30 * DAY });
    addPart(
      source,
      'updated-part',
      'session',
      { type: 'tool' },
      {
        created: NOW - 30 * DAY,
        updated: NOW - 1 * DAY,
      }
    );
    for (let i = 0; i < 1_500; i += 1) {
      addSession(source, `old-${i}`, { at: NOW - 30 * DAY });
      addPart(
        source,
        `old-part-${i}`,
        `old-${i}`,
        { type: 'tool' },
        {
          created: NOW - 30 * DAY,
          updated: NOW - 30 * DAY,
        }
      );
    }
    for (let i = 0; i < 10; i += 1) {
      addSession(source, `recent-${i}`);
      addPart(source, `recent-part-${i}`, `recent-${i}`, { type: 'tool' });
    }
    source.close();

    const snapshot = await createSessionDbSnapshot(sourcePath, { sinceMs: NOW - 3 * DAY, nowMs: NOW });
    const copy = new DatabaseSync(snapshot.dbPath, { readOnly: true });
    expect(copy.prepare("SELECT id FROM part WHERE id = 'updated-part'").get().id).toBe('updated-part');
    expect(copy.prepare("SELECT id FROM part WHERE id = 'old-part-1499'").get()).toBeUndefined();
    copy.close();
    await snapshot.cleanup();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('returns null for a missing source instead of exposing the live path', async () => {
    expect(await createSessionDbSnapshot('/missing/kilo.db', { sinceMs: NOW - DAY, nowMs: NOW })).toBeNull();
  });

  it('lets a concurrent writer proceed between bounded source reads', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtinv-snapshot-writer-test-'));
    const sourcePath = join(dir, 'source.db');
    const source = createSource(sourcePath);
    for (let i = 0; i < 600; i += 1) {
      addSession(source, `session-${i}`);
      addPart(source, `part-${i}`, `session-${i}`, { type: 'tool' });
    }
    source.close();

    const writer = new DatabaseSync(sourcePath);
    let writerResult;
    const writerTurn = new Promise((resolve) => {
      setTimeout(() => {
        try {
          addSession(writer, 'concurrent');
          writerResult = { ok: true };
        } catch (error) {
          writerResult = { ok: false, error: error.message };
        }
        resolve();
      }, 0);
    });

    const snapshotPromise = createSessionDbSnapshot(sourcePath, { sinceMs: NOW - 3 * DAY, nowMs: NOW });
    await writerTurn;
    expect(writerResult).toEqual({ ok: true });
    const snapshot = await snapshotPromise;
    writer.close();

    expect(snapshot).not.toBeNull();
    await snapshot.cleanup();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
});
