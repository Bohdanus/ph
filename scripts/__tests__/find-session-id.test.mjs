import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb, find } from '../find-session-id.mjs';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function createDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      directory TEXT,
      title TEXT,
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      time_created INTEGER,
      time_updated INTEGER,
      time_archived INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (message_id) REFERENCES message(id)
    );
  `);
  return db;
}

function addSession(db, id, { parentId = null, at = NOW - 1 * DAY } = {}) {
  db.prepare(
    `INSERT INTO session (id, parent_id, directory, title, tokens_input, tokens_output,
                            time_created, time_updated, time_archived)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?, NULL)`
  ).run(id, parentId, `/repo/${id}`, id, at, at);
}

function addMessage(db, id, sessionId, { at = NOW - 1 * DAY } = {}) {
  db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)').run(
    id,
    sessionId,
    at,
    at,
    JSON.stringify({ type: 'text', role: 'user', text: '' })
  );
}

function addPart(db, id, messageId, sessionId, data, { at = NOW - 1 * DAY } = {}) {
  db.prepare(
    'INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, messageId, sessionId, at, at, JSON.stringify(data));
}

describe('find-session-id', () => {
  describe('openDb', () => {
    it('returns a read-only database for an existing path', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fsi-test-'));
      const dbPath = join(dir, 'test.db');
      const db = new DatabaseSync(dbPath);
      db.exec('CREATE TABLE session (id TEXT)');
      db.close();

      const opened = openDb(dbPath);
      expect(opened).not.toBeNull();

      expect(() => {
        opened.exec('CREATE TABLE fail (x TEXT)');
      }).toThrow();

      opened.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('returns null for a non-existent path', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fsi-test-'));
      const missingPath = join(dir, 'does-not-exist.db');
      expect(openDb(missingPath)).toBeNull();
      rmSync(dir, { recursive: true, force: true });
    });

    it('returns null for a directory path', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fsi-test-'));
      expect(openDb(dir)).toBeNull();
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('find with phrase', () => {
    it('returns sessions whose text parts contain the phrase', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fsi-test-'));
      const dbPath = join(dir, 'test.db');
      const db = createDb(dbPath);

      addSession(db, 'ses_aaa', { at: NOW - 2 * DAY });
      const msg = 'msg-aaa';
      addMessage(db, msg, 'ses_aaa', { at: NOW - 2 * DAY });
      addPart(db, 'part-aaa-1', msg, 'ses_aaa', { type: 'text', text: 'implement the review feature' });

      addSession(db, 'ses_bbb', { at: NOW - 1 * DAY });
      const msg2 = 'msg-bbb';
      addMessage(db, msg2, 'ses_bbb', { at: NOW - 1 * DAY });
      addPart(db, 'part-bbb-1', msg2, 'ses_bbb', { type: 'text', text: 'fix the LAND worktree bug' });

      const opened = openDb(dbPath);
      expect(opened).not.toBeNull();

      const results = find(opened, 'review');
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('ses_aaa');

      const results2 = find(opened, 'worktree');
      expect(results2.length).toBe(1);
      expect(results2[0].id).toBe('ses_bbb');

      opened.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('returns multiple matches up to a limit of 5, most recent first', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fsi-test-'));
      const dbPath = join(dir, 'test.db');
      const db = createDb(dbPath);

      for (let i = 0; i < 7; i++) {
        const id = `ses_${String(i).padStart(3, '0')}`;
        addSession(db, id, { at: NOW - (7 - i) * DAY });
        const msgId = `msg-${i}`;
        addMessage(db, msgId, id, { at: NOW - (7 - i) * DAY });
        addPart(db, `part-${i}`, msgId, id, { type: 'text', text: 'shared phrase here' });
      }

      const opened = openDb(dbPath);
      expect(opened).not.toBeNull();

      const results = find(opened, 'shared phrase');
      expect(results.length).toBe(5);
      expect(results[0].id).toBe('ses_006');
      expect(results[4].id).toBe('ses_002');

      opened.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('is case-insensitive', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fsi-test-'));
      const dbPath = join(dir, 'test.db');
      const db = createDb(dbPath);

      addSession(db, 'ses_test', { at: NOW - 1 * DAY });
      const msgId = 'msg-test';
      addMessage(db, msgId, 'ses_test', { at: NOW - 1 * DAY });
      addPart(db, 'part-1', msgId, 'ses_test', { type: 'text', text: 'Implement Review Feature' });

      const opened = openDb(dbPath);
      expect(opened).not.toBeNull();

      const results = find(opened, 'IMPLEMENT review');
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('ses_test');

      opened.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('does not match non-text parts', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fsi-test-'));
      const dbPath = join(dir, 'test.db');
      const db = createDb(dbPath);

      addSession(db, 'ses_text', { at: NOW - 1 * DAY });
      const msgId = 'msg-text';
      addMessage(db, msgId, 'ses_text', { at: NOW - 1 * DAY });
      addPart(db, 'part-tool', msgId, 'ses_text', { type: 'tool', text: 'review data' });

      const opened = openDb(dbPath);
      expect(opened).not.toBeNull();

      const results = find(opened, 'review');
      expect(results.length).toBe(0);

      opened.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('escapes LIKE wildcards in the phrase', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fsi-test-'));
      const dbPath = join(dir, 'test.db');
      const db = createDb(dbPath);

      addSession(db, 'ses_underscore', { at: NOW - 1 * DAY });
      const msgId = 'msg-us';
      addMessage(db, msgId, 'ses_underscore', { at: NOW - 1 * DAY });
      addPart(db, 'part-1', msgId, 'ses_underscore', { type: 'text', text: 'find _ exact _ patterns' });

      addSession(db, 'ses_other', { at: NOW - 2 * DAY });
      const msgId2 = 'msg-other';
      addMessage(db, msgId2, 'ses_other', { at: NOW - 2 * DAY });
      addPart(db, 'part-2', msgId2, 'ses_other', { type: 'text', text: 'findXexactX patterns' });

      const opened = openDb(dbPath);
      expect(opened).not.toBeNull();

      const results = find(opened, 'find _ exact');
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('ses_underscore');

      opened.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('does not return subagent sessions (children)', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fsi-test-'));
      const dbPath = join(dir, 'test.db');
      const db = createDb(dbPath);

      addSession(db, 'ses_parent', { parentId: null, at: NOW - 1 * DAY });
      const msgParent = 'msg-parent';
      addMessage(db, msgParent, 'ses_parent', { at: NOW - 1 * DAY });
      addPart(db, 'part-parent', msgParent, 'ses_parent', { type: 'text', text: 'matching phrase' });

      addSession(db, 'ses_child', { parentId: 'ses_parent', at: NOW - 1 * DAY });
      const msgChild = 'msg-child';
      addMessage(db, msgChild, 'ses_child', { at: NOW - 1 * DAY });
      addPart(db, 'part-child', msgChild, 'ses_child', { type: 'text', text: 'matching phrase' });

      const opened = openDb(dbPath);
      expect(opened).not.toBeNull();

      const results = find(opened, 'matching phrase');
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('ses_parent');

      opened.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('returns empty array when no sessions match', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fsi-test-'));
      const dbPath = join(dir, 'test.db');
      const db = createDb(dbPath);

      addSession(db, 'ses_a', { at: NOW - 1 * DAY });
      const msgId = 'msg-a';
      addMessage(db, msgId, 'ses_a', { at: NOW - 1 * DAY });
      addPart(db, 'part-a', msgId, 'ses_a', { type: 'text', text: 'unrelated content' });

      const opened = openDb(dbPath);
      expect(opened).not.toBeNull();

      const results = find(opened, 'nonexistent phrase');
      expect(results.length).toBe(0);

      opened.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('handles phrases containing percent signs', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fsi-test-'));
      const dbPath = join(dir, 'test.db');
      const db = createDb(dbPath);

      addSession(db, 'ses_pct', { at: NOW - 1 * DAY });
      const msgId = 'msg-pct';
      addMessage(db, msgId, 'ses_pct', { at: NOW - 1 * DAY });
      addPart(db, 'part-1', msgId, 'ses_pct', { type: 'text', text: '100% done matching' });

      const opened = openDb(dbPath);
      expect(opened).not.toBeNull();

      const results = find(opened, '100% done');
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('ses_pct');

      opened.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('handles phrases containing backslash', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fsi-test-'));
      const dbPath = join(dir, 'test.db');
      const db = createDb(dbPath);

      addSession(db, 'ses_back', { at: NOW - 1 * DAY });
      const msgId = 'msg-back';
      addMessage(db, msgId, 'ses_back', { at: NOW - 1 * DAY });
      addPart(db, 'part-1', msgId, 'ses_back', { type: 'text', text: 'path\\to\\file' });

      const opened = openDb(dbPath);
      expect(opened).not.toBeNull();

      const results = find(opened, 'path\\to\\file');
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('ses_back');

      opened.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('find without phrase (latest query)', () => {
    it('returns the most recent top-level session', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fsi-test-'));
      const dbPath = join(dir, 'test.db');
      const db = createDb(dbPath);

      addSession(db, 'ses_older', { at: NOW - 2 * DAY });
      addSession(db, 'ses_newest', { at: NOW - 1 * DAY });
      addSession(db, 'ses_middle', { at: NOW - 1.5 * DAY });

      const opened = openDb(dbPath);
      expect(opened).not.toBeNull();

      const results = find(opened, '');
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('ses_newest');

      opened.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('does not return child sessions', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fsi-test-'));
      const dbPath = join(dir, 'test.db');
      const db = createDb(dbPath);

      addSession(db, 'ses_parent', { parentId: null, at: NOW - 1 * DAY });
      addSession(db, 'ses_child', { parentId: 'ses_parent', at: NOW - 0.5 * DAY });

      const opened = openDb(dbPath);
      expect(opened).not.toBeNull();

      const results = find(opened, '');
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('ses_parent');

      opened.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('returns empty array when sessions table is empty', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fsi-test-'));
      const dbPath = join(dir, 'test.db');
      const db = createDb(dbPath);

      const opened = openDb(dbPath);
      expect(opened).not.toBeNull();

      const results = find(opened, '');
      expect(results.length).toBe(0);

      opened.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });
  });
});
