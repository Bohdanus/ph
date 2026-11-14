import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, mkdtempSync, mkdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  codexRolloutState,
  inspectCodexChatTrailers,
  inspectCodexFamily,
  isCodexThreadId,
  readCodexRollout,
  resolveCodexStateDb,
} from '../lib/worktree-inventory/codex-family.mjs';

const ROOT = '01a18993-03cd-7e00-9188-f51dcff8532d';
const CHILD = '01a1da70-92f4-7dc3-b339-b92d27b14506';
const GRANDCHILD = '01a1da41-4435-7a02-bf0f-f8de1deb0449';
const SIBLING = '01a1da41-3386-7561-bd2d-d8cb4e6983a3';
const tempDirs = [];

function tempDir() {
  const path = mkdtempSync(join(tmpdir(), 'codex-family-test-'));
  tempDirs.push(path);
  return path;
}

function completeRollout() {
  return [
    { type: 'event_msg', payload: { type: 'task_started' } },
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'AgentMessage' } } },
    { type: 'event_msg', payload: { type: 'task_complete' } },
    { type: 'event_msg', payload: { type: 'token_count' } },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n');
}

function createCodexDb(directory, { backfill = 'complete' } = {}) {
  const path = join(directory, 'state_5.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE backfill_state (id INTEGER PRIMARY KEY, status TEXT NOT NULL);
    INSERT INTO backfill_state VALUES (1, '${backfill}');
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      attached_thread_parent_id TEXT
    );
    CREATE TABLE thread_spawn_edges (
      parent_thread_id TEXT NOT NULL,
      child_thread_id TEXT NOT NULL PRIMARY KEY,
      status TEXT NOT NULL
    );
  `);
  return { path, db };
}

function addThread(db, directory, id, { parent = null, text = completeRollout() } = {}) {
  const rollout = join(directory, `${id}.jsonl`);
  writeFileSync(rollout, text);
  db.prepare('INSERT INTO threads VALUES (?, ?, ?)').run(id, rollout, null);
  if (parent) db.prepare('INSERT INTO thread_spawn_edges VALUES (?, ?, ?)').run(parent, id, 'open');
  return rollout;
}

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('Codex Chat trailer ownership', () => {
  it('recognizes exact UUID thread IDs but leaves Kilo session trailers to the Kilo reader', () => {
    expect(isCodexThreadId(ROOT)).toBe(true);
    expect(isCodexThreadId('session:ses_e336c34a7ffeog4ekkAuKQy102')).toBe(false);
    expect(
      inspectCodexChatTrailers('/repo', 'abc123', {
        run: () => ({ stdout: 'session:ses_e336c34a7ffeog4ekkAuKQy102\n' }),
      }).status
    ).toBe('not-applicable');
  });

  it('reads Chat trailers from the exact tip without relying on the thread git branch', () => {
    const result = inspectCodexChatTrailers('/repo', 'tip-sha', {
      run: (_cwd, args) => {
        expect(args).toEqual(['show', '-s', '--format=%(trailers:key=Chat,valueonly)', 'tip-sha']);
        return { stdout: `${ROOT}\n` };
      },
      inspect: (id) => ({ status: 'active', chatId: id, rootThreadId: id, family: [] }),
    });
    expect(result).toMatchObject({ status: 'active', chatIds: [ROOT] });
  });

  it('walks ancestors, siblings, children, and grandchildren and ignores stale open edge status', () => {
    const directory = tempDir();
    const { path, db } = createCodexDb(directory);
    addThread(db, directory, ROOT);
    addThread(db, directory, CHILD, { parent: ROOT });
    addThread(db, directory, SIBLING, { parent: ROOT });
    addThread(db, directory, GRANDCHILD, { parent: CHILD });
    db.close();

    const result = inspectCodexFamily(CHILD, { dbPath: path });
    expect(result.status).toBe('complete');
    expect(result.rootThreadId).toBe(ROOT);
    expect(result.family.map((entry) => entry.id).sort()).toEqual([GRANDCHILD, ROOT, CHILD, SIBLING].sort());
  });

  it('counts a new root user turn after an older task_complete as active', () => {
    const directory = tempDir();
    const { path, db } = createCodexDb(directory);
    const resumed = [
      { type: 'event_msg', payload: { type: 'task_complete' } },
      { type: 'event_msg', payload: { type: 'thread_settings_applied' } },
      { type: 'event_msg', payload: { type: 'task_started' } },
      { type: 'turn_context', payload: {} },
      { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage' } } },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n');
    addThread(db, directory, ROOT, { text: resumed });
    db.close();

    const result = inspectCodexFamily(ROOT, { dbPath: path });
    expect(result.status).toBe('active');
    expect(result.family).toContainEqual(expect.objectContaining({ id: ROOT, status: 'active' }));
  });

  it('blocks when a family member starts work without a terminal completion', () => {
    const directory = tempDir();
    const { path, db } = createCodexDb(directory);
    addThread(db, directory, ROOT);
    addThread(db, directory, CHILD, {
      parent: ROOT,
      text: JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }),
    });
    db.close();

    const result = inspectCodexFamily(ROOT, { dbPath: path });
    expect(result.status).toBe('active');
    expect(result.family).toContainEqual(expect.objectContaining({ id: CHILD, status: 'active' }));
  });

  it('fails closed for missing thread rows, rollout files, malformed JSON, and incomplete backfill', () => {
    const directory = tempDir();
    const { path, db } = createCodexDb(directory);
    addThread(db, directory, ROOT);
    db.prepare('INSERT INTO thread_spawn_edges VALUES (?, ?, ?)').run(ROOT, CHILD, 'open');
    db.close();
    expect(inspectCodexFamily(ROOT, { dbPath: path }).status).toBe('unproven');

    const missing = tempDir();
    const missingDb = createCodexDb(missing);
    missingDb.db.prepare('INSERT INTO threads VALUES (?, ?, ?)').run(ROOT, join(missing, 'missing.jsonl'), null);
    missingDb.db.close();
    expect(inspectCodexFamily(ROOT, { dbPath: missingDb.path }).status).toBe('unproven');

    const malformed = tempDir();
    const malformedDb = createCodexDb(malformed);
    addThread(malformedDb.db, malformed, ROOT, { text: '{bad json' });
    malformedDb.db.close();
    expect(inspectCodexFamily(ROOT, { dbPath: malformedDb.path }).status).toBe('unproven');

    const pending = tempDir();
    const pendingDb = createCodexDb(pending, { backfill: 'running' });
    addThread(pendingDb.db, pending, ROOT);
    pendingDb.db.close();
    expect(inspectCodexFamily(ROOT, { dbPath: pendingDb.path }).status).toBe('unproven');
  });

  it('fails closed when the exact trailer ID is absent from the indexed Codex store', () => {
    const directory = tempDir();
    const { path, db } = createCodexDb(directory);
    db.close();
    expect(inspectCodexFamily(ROOT, { dbPath: path })).toMatchObject({ status: 'unproven', chatId: ROOT });
  });

  it('refuses rollout symlinks that resolve outside the Codex state directory', () => {
    const directory = tempDir();
    const external = tempDir();
    const { path, db } = createCodexDb(directory);
    const externalRollout = join(external, `${ROOT}.jsonl`);
    const linkedRollout = join(directory, `${ROOT}.jsonl`);
    writeFileSync(externalRollout, completeRollout());
    symlinkSync(externalRollout, linkedRollout);
    db.prepare('INSERT INTO threads VALUES (?, ?, ?)').run(ROOT, linkedRollout, null);
    db.close();

    expect(inspectCodexFamily(ROOT, { dbPath: path })).toMatchObject({
      status: 'unproven',
      family: [
        expect.objectContaining({ status: 'unproven', reason: expect.stringContaining('outside the state directory') }),
      ],
    });
  });

  it('treats an uncompressed rollout that changes during its tail read as unproven', () => {
    const directory = tempDir();
    const { path, db } = createCodexDb(directory);
    const rollout = addThread(db, directory, ROOT);
    db.close();
    const initial = statSync(rollout, { bigint: true });
    let calls = 0;
    const result = inspectCodexFamily(ROOT, {
      dbPath: path,
      read: (rolloutPath, codexHome) =>
        readCodexRollout(rolloutPath, codexHome, {
          fstat: () => {
            calls += 1;
            return calls === 1 ? initial : { ...initial, size: initial.size + 1n };
          },
        }),
    });
    expect(result.status).toBe('unproven');
    expect(result.family[0].reason).toContain('changed while its tail was being read');
  });

  it('caps compressed rollout output and treats decompression overflow as unproven', () => {
    const directory = tempDir();
    const { path, db } = createCodexDb(directory);
    const rollout = join(directory, `${ROOT}.jsonl.zst`);
    writeFileSync(rollout, 'compressed fixture');
    db.prepare('INSERT INTO threads VALUES (?, ?, ?)').run(ROOT, rollout, null);
    db.close();

    const decompress = (command, args, options) => {
      expect(command).toBe('zstd');
      expect(args[0]).toBe('-dc');
      expect(args[1]).toMatch(/\.jsonl\.zst$/);
      expect(options).toMatchObject({
        maxBuffer: 64 * 1024 * 1024,
        timeout: 15_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, stdout: Buffer.from(completeRollout()) };
    };
    const complete = inspectCodexFamily(ROOT, {
      dbPath: path,
      read: (rolloutPath, codexHome) => readCodexRollout(rolloutPath, codexHome, { decompress }),
    });
    expect(complete.status).toBe('complete');

    const changesDuringRead = () =>
      readCodexRollout(rollout, directory, {
        decompress: () => {
          appendFileSync(rollout, 'changed');
          return { status: 0, stdout: Buffer.from(completeRollout()) };
        },
      });
    expect(changesDuringRead).toThrow('Codex rollout changed while it was being decompressed');

    const overflow = inspectCodexFamily(ROOT, {
      dbPath: path,
      read: (rolloutPath, codexHome) =>
        readCodexRollout(rolloutPath, codexHome, {
          decompress: () => ({
            error: Object.assign(new Error('stdout maxBuffer length exceeded'), { code: 'ENOBUFS' }),
            status: null,
            stdout: Buffer.alloc(0),
          }),
        }),
    });
    expect(overflow.status).toBe('unproven');
  });

  it('chooses the most recently updated Codex state database in CODEX_HOME', () => {
    const directory = tempDir();
    mkdirSync(join(directory, 'sessions'));
    writeFileSync(join(directory, 'state_3.sqlite'), '');
    writeFileSync(join(directory, 'state_12.sqlite'), '');
    expect(
      resolveCodexStateDb({
        env: { CODEX_HOME: directory },
        home: '/unused',
        stat: (path) => ({ isFile: () => true, mtimeMs: path.endsWith('state_3.sqlite') ? 20 : 10 }),
      })
    ).toEqual({
      path: join(directory, 'state_3.sqlite'),
      error: null,
    });
  });
});

describe('codexRolloutState', () => {
  it('requires a task_complete after the newest start and user event', () => {
    expect(codexRolloutState(completeRollout()).status).toBe('complete');
    expect(codexRolloutState(JSON.stringify({ type: 'event_msg', payload: { type: 'turn_complete' } })).status).toBe(
      'complete'
    );
    expect(codexRolloutState(JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } })).status).toBe(
      'active'
    );
    const resumed = `${completeRollout()}\n${JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage' } } })}`;
    expect(codexRolloutState(resumed).status).toBe('active');
  });

  it('keeps post-terminal assistant work active, including an unfinished AgentMessage', () => {
    const afterTaskComplete = [
      { type: 'event_msg', payload: { type: 'task_complete' } },
      { type: 'event_msg', payload: { type: 'item_started', item: { type: 'AgentMessage' } } },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n');
    const assistantResponse = [
      { type: 'event_msg', payload: { type: 'task_complete' } },
      { type: 'response_item', payload: { role: 'assistant', type: 'message' } },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n');
    const assistantResponseWithoutType = [
      { type: 'event_msg', payload: { type: 'task_complete' } },
      { type: 'response_item', payload: { role: 'assistant' } },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n');
    expect(codexRolloutState(afterTaskComplete).status).toBe('active');
    expect(codexRolloutState(assistantResponse).status).toBe('active');
    expect(codexRolloutState(assistantResponseWithoutType).status).toBe('active');
  });
});
