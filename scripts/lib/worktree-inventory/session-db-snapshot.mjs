/**
 * Build a short-lived, bounded audit database from the live Kilo session DB.
 *
 * The live database is too large to copy: a full online backup delays every
 * inventory result until all pages have been copied. The inventory only needs
 * recent sessions and their recent parts, so copy that projection instead.
 * Source reads are individual statements with no surrounding transaction; the
 * event loop yields between batches so Kilo writers can make progress.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { boundSessionSinceMs } from './session-audit-limits.mjs';

const SNAPSHOT_PREFIX = 'worktree-inventory-session-';
const SESSION_BATCH_SIZE = 250;

const yieldToWriter = () => new Promise((resolve) => setImmediate(resolve));

const SESSION_COLUMNS = [
  'id',
  'parent_id',
  'directory',
  'title',
  'agent',
  'slug',
  'tokens_input',
  'tokens_output',
  'time_created',
  'time_updated',
  'time_archived',
];

function createSnapshotDatabase(snapshotPath) {
  const db = new DatabaseSync(snapshotPath);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      directory TEXT,
      title TEXT,
      agent TEXT,
      slug TEXT,
      tokens_input INTEGER,
      tokens_output INTEGER,
      time_created INTEGER,
      time_updated INTEGER,
      time_archived INTEGER
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX part_session_idx ON part (session_id);
  `);
  return db;
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(',');
}

function sessionValues(row) {
  return SESSION_COLUMNS.map((column) => row[column]);
}

function readRecentSessions(source, sinceMs) {
  const byId = new Map();
  const rows = source
    .prepare(
      `SELECT ${SESSION_COLUMNS.join(', ')}
         FROM session
        WHERE time_created >= ? OR time_updated >= ?`
    )
    .all(sinceMs, sinceMs);

  for (const row of rows) byId.set(row.id, row);
  return byId;
}

/**
 * Find sessions whose part activity is recent even when the session row itself
 * was not updated. `part` has no time index, but it is append-oriented, so a
 * descending rowid walk reaches the recent tail without a full table scan.
 * Every batch is a separate statement and the walk stops once the tail is old.
 */
async function readRecentPartSessionIds(source, sinceMs) {
  const sessionIds = new Set();
  let beforeRowid = null;
  for (;;) {
    const rows = source
      .prepare(
        `SELECT rowid AS row_id, session_id, time_created, time_updated
           FROM part
          ${beforeRowid === null ? '' : 'WHERE rowid < ?'}
          ORDER BY rowid DESC
          LIMIT ${SESSION_BATCH_SIZE}`
      )
      .all(...(beforeRowid === null ? [] : [beforeRowid]));
    if (rows.length === 0) break;

    for (const row of rows) {
      if (row.time_created >= sinceMs || row.time_updated >= sinceMs) sessionIds.add(row.session_id);
    }
    const oldest = rows[rows.length - 1];
    if (oldest.time_created < sinceMs && oldest.time_updated < sinceMs) break;
    beforeRowid = oldest.row_id;
    await yieldToWriter();
  }
  return sessionIds;
}

async function includeParentSessions(source, byId) {
  let pending = [...byId.values()].map((row) => row.parent_id).filter(Boolean);
  while (pending.length > 0) {
    const wanted = pending.filter((id) => !byId.has(id));
    pending = [];
    for (let i = 0; i < wanted.length; i += SESSION_BATCH_SIZE) {
      const batch = wanted.slice(i, i + SESSION_BATCH_SIZE);
      const rows = source
        .prepare(
          `SELECT ${SESSION_COLUMNS.join(', ')}
             FROM session
            WHERE id IN (${placeholders(batch.length)})`
        )
        .all(...batch);
      for (const row of rows) {
        byId.set(row.id, row);
        if (row.parent_id && !byId.has(row.parent_id)) pending.push(row.parent_id);
      }
      await yieldToWriter();
    }
  }
}

async function copySessions(snapshot, sessions) {
  const insert = snapshot.prepare(
    `INSERT INTO session (${SESSION_COLUMNS.join(', ')}) VALUES (${placeholders(SESSION_COLUMNS.length)})`
  );
  snapshot.exec('BEGIN');
  try {
    for (const row of sessions.values()) insert.run(...sessionValues(row));
    snapshot.exec('COMMIT');
  } catch (error) {
    snapshot.exec('ROLLBACK');
    throw error;
  }
}

async function copyRecentParts(source, snapshot, sessionIds, sinceMs) {
  if (sessionIds.length === 0) return;
  const insert = snapshot.prepare(
    'INSERT INTO part (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)'
  );

  for (let i = 0; i < sessionIds.length; i += SESSION_BATCH_SIZE) {
    const batch = sessionIds.slice(i, i + SESSION_BATCH_SIZE);
    const rows = source
      .prepare(
        `SELECT id, session_id, time_created, time_updated, data
           FROM part
          WHERE session_id IN (${placeholders(batch.length)})
            AND (time_created >= ? OR time_updated >= ?)`
      )
      .all(...batch, sinceMs, sinceMs);
    snapshot.exec('BEGIN');
    try {
      for (const row of rows) insert.run(row.id, row.session_id, row.time_created, row.time_updated, row.data);
      snapshot.exec('COMMIT');
    } catch (error) {
      snapshot.exec('ROLLBACK');
      throw error;
    }
    await yieldToWriter();
  }
}

/**
 * Copy only the bounded session/part projection needed by both inventory audits.
 * A failed snapshot returns `null`; callers must not fall back to the live path.
 */
export async function createSessionDbSnapshot(dbPath, { sinceMs, nowMs = Date.now() } = {}) {
  if (typeof dbPath !== 'string' || dbPath.length === 0) return null;

  const boundedSinceMs = boundSessionSinceMs(sinceMs, nowMs);
  let source;
  let directory;
  let snapshot;
  try {
    source = new DatabaseSync(dbPath, { readOnly: true });
    directory = await mkdtemp(join(tmpdir(), SNAPSHOT_PREFIX));
    const snapshotPath = join(directory, 'kilo.db');
    snapshot = createSnapshotDatabase(snapshotPath);

    const sessions = readRecentSessions(source, boundedSinceMs);
    for (const id of await readRecentPartSessionIds(source, boundedSinceMs)) {
      if (sessions.has(id)) continue;
      const row = source.prepare(`SELECT ${SESSION_COLUMNS.join(', ')} FROM session WHERE id = ?`).get(id);
      if (row) sessions.set(row.id, row);
    }
    await includeParentSessions(source, sessions);
    await copySessions(snapshot, sessions);
    await copyRecentParts(source, snapshot, [...sessions.keys()], boundedSinceMs);
    snapshot.close();
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
      snapshot?.close();
    } catch {
      // Cleanup below is the useful failure path.
    }
    try {
      source?.close();
    } catch {
      // The failed read is already represented by the null result.
    }
    if (directory) await rm(directory, { recursive: true, force: true });
    return null;
  }
}
