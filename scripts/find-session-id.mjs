#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { resolveSessionDb } from './lib/worktree-inventory/chats.mjs';

/**
 * Resolve the Kilo session ID (`ses_…`) for the current chat, for use as a
 * `Chat:` commit trailer (see docs/CHAT-ID.md).
 *
 * Usage:
 *   node scripts/find-session-id.mjs [phrase]
 *
 * Strategy:
 *   1. If [phrase] is given, search message text for it (case-insensitive).
 *      Up to 5 matches are listed on stderr; the most recent wins.
 *   2. Otherwise, fall back to the single most recent top-level session.
 *
 * Design goals:
 *   - Quick: one read-only SQLite query, exits immediately.
 *   - Robust: built-in `node:sqlite` only — no dependency on node_modules.
 *     All DB calls are wrapped in try/catch for clean error messages.
 *   - Safe: opens the database read-only with `PRAGMA query_only = 1`.
 *   - Accessible: committed to the repo; invoke as `npm run session:id -- "phrase"`.
 *   - Testable: `find()` and `openDb()` are exported; entry point is guarded
 *     by `process.argv[1]` so the module can be imported by tests.
 *
 * Output: prints the session ID to stdout (capturable in `$(...)` or backticks).
 *   Multiple matches and metadata go to stderr so stdout stays clean.
 */

const dbPath = resolveSessionDb(homedir());

/**
 * Escape `%` and `_` (SQLite LIKE wildcards) and `\` in a search phrase so they
 * are treated as literals.  Combine with `ESCAPE '\'` in the SQL.
 */
function escapeLike(phrase) {
  return phrase.toLowerCase().replace(/[%_\\]/g, '\\$&');
}

/**
 * Open the session database read-only, or return `null` when it is absent.
 * Mirrors the `openDb` pattern in `lib/worktree-inventory/chats.mjs`.
 * A missing database is not an error — the caller decides how to handle it.
 */
export function openDb(path) {
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    db.exec('PRAGMA query_only = 1;');
    return db;
  } catch {
    return null;
  }
}

const PHRASE_QUERY = `
  SELECT DISTINCT s.id, s.title, s.directory, s.parent_id,
         datetime(s.time_updated / 1000, 'unixepoch') AS updated
  FROM session s
  JOIN message m ON m.session_id = s.id
  JOIN part p ON p.message_id = m.id
  WHERE s.parent_id IS NULL
    AND json_extract(p.data, '$.type') = 'text'
    AND lower(json_extract(p.data, '$.text')) LIKE :phrase ESCAPE '\\'
  ORDER BY s.time_updated DESC
  LIMIT 5
`;

const LATEST_QUERY = `
  SELECT s.id, s.title, s.directory, s.parent_id,
         datetime(s.time_updated / 1000, 'unixepoch') AS updated
  FROM session s
  WHERE s.parent_id IS NULL
  ORDER BY s.time_updated DESC
  LIMIT 1
`;

/**
 * Search the Kilo session database for matching top-level sessions.
 * When `phrase` is non-empty, joins `session`/`message`/`part` to find
 * sessions whose text parts contain the phrase (case-insensitive, LIKE).
 * When `phrase` is empty, returns the single most recent top-level session.
 * @returns {Array<{id:string,title:string,directory:string,parent_id:*,updated:string}>}
 */
export function find(db, phrase) {
  if (phrase) {
    const stmt = db.prepare(PHRASE_QUERY);
    return stmt.all({ phrase: `%${escapeLike(phrase)}%` });
  }
  const stmt = db.prepare(LATEST_QUERY);
  return stmt.all();
}

function main() {
  const phrase = process.argv[2] || '';

  const db = openDb(dbPath);
  if (!db) {
    console.error(`find-session-id: cannot open ${dbPath} (set KILO_DB to override).`);
    process.exit(1);
  }

  let rows;
  try {
    rows = find(db, phrase);
  } catch (e) {
    console.error(`find-session-id: query failed: ${e.message}`);
    process.exit(1);
  } finally {
    try {
      db.close();
    } catch {
      // best-effort close — results already captured
    }
  }

  if (rows.length === 0) {
    console.error('find-session-id: no matching Kilo session found');
    process.exit(1);
  }

  const best = rows[0];
  console.log(best.id);

  if (process.env.FIND_SESSION_VERBOSE === '1' || rows.length > 1) {
    for (const r of rows) {
      console.error(`  ${r.id}  ${r.title}  ${r.directory}  ${r.updated}`);
    }
    if (rows.length > 1) {
      console.error(
        'find-session-id: multiple matches — using most recent. ' + 'Set FIND_SESSION_VERBOSE=1 to list all.'
      );
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
