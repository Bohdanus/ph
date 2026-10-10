#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve the Kilo session ID (`ses_…`) for the current chat, for use as a
 * `Chat:` commit trailer (see docs/CHAT-ID.md).
 *
 * Usage:
 *   node scripts/find-session-id.mjs [phrase]
 *
 * Strategy:
 *   1. If <phrase> is given, search message text for it (case-insensitive).
 *   2. Otherwise, fall back to the most recent top-level session.
 *
 * Design goals:
 *   - Quick: one read-only SQLite query, exits immediately.
 *   - Robust: built-in `node:sqlite` only — no dependency on node_modules.
 *   - Safe: opens the database read-only; emits no writes.
 *   - Accessible: committed to the repo, one command from any worktree.
 *
 * Output: prints the session ID to stdout (capturable in `$(...)` or backticks).
 *   Multiple matches and metadata go to stderr so stdout stays clean.
 */
const dbPath = join(homedir(), '.local', 'share', 'kilo', 'kilo.db');

const phrase = process.argv[2];

function openReadonly(path) {
  const db = new DatabaseSync(path, { readonly: true });
  db.exec('PRAGMA query_only = 1;');
  return db;
}

function find(db, phrase) {
  if (phrase) {
    const stmt = db.prepare(`
      SELECT DISTINCT s.id, s.title, s.directory, s.parent_id,
             datetime(s.time_updated / 1000, 'unixepoch') AS updated
      FROM session s
      JOIN message m ON m.session_id = s.id
      JOIN part p ON p.message_id = m.id
      WHERE s.parent_id IS NULL
        AND json_extract(p.data, '$.type') = 'text'
        AND lower(json_extract(p.data, '$.text')) LIKE :phrase
      ORDER BY s.time_updated DESC
      LIMIT 5
    `);
    return stmt.all({ phrase: `%${phrase.toLowerCase()}%` });
  }

  const stmt = db.prepare(`
    SELECT s.id, s.title, s.directory, s.parent_id,
           datetime(s.time_updated / 1000, 'unixepoch') AS updated
    FROM session s
    WHERE s.parent_id IS NULL
    ORDER BY s.time_updated DESC
    LIMIT 5
  `);
  return stmt.all();
}

let db;
try {
  db = openReadonly(dbPath);
} catch {
  console.error(`find-session-id: cannot open ${dbPath}`);
  process.exit(1);
}

const rows = find(db, phrase);
const ambiguous = phrase && rows.length > 1;
db.close();

if (rows.length === 0) {
  console.error('find-session-id: no matching Kilo session found');
  process.exit(1);
}

const best = rows[0];
console.log(best.id);

if (process.env.FIND_SESSION_VERBOSE === '1' || ambiguous) {
  for (const r of rows) {
    console.error(`  ${r.id}  ${r.title}  ${r.directory}  ${r.updated}`);
  }
  if (ambiguous) {
    console.error(
      'find-session-id: multiple matches — using most recent. ' + 'Set FIND_SESSION_VERBOSE=1 to list all.'
    );
  }
}
