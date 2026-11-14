/**
 * Read-only ownership evidence for Codex sessions named by a commit's `Chat:`
 * trailer. The worktree inventory's Kilo histories cannot see this host's
 * sessions, so disposal rechecks the exact trailer on the current tip and walks
 * the Codex family before it removes the checkout.
 *
 * `thread_spawn_edges.status` is intentionally ignored: observed Codex stores
 * retain `open` for children whose rollout already contains `task_complete`.
 * Rollout event order is the completion evidence. Unknown formats fail closed.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, fstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAIL_LINES = 500;
const MAX_TAIL_BYTES = 16 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
const READ_BLOCK_BYTES = 64 * 1024;
const FILE_SNAPSHOT_FIELDS = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'];

function sameFileSnapshot(before, after) {
  return FILE_SNAPSHOT_FIELDS.every((field) => before[field] === after[field]);
}

export function isCodexThreadId(value) {
  return typeof value === 'string' && UUID.test(value.trim());
}

/** Select the most recently modified indexed Codex state database without reading its contents. */
export function resolveCodexStateDb({ env = process.env, home = homedir(), list = readdirSync, stat = statSync } = {}) {
  const codexHome = env.CODEX_HOME ? resolve(env.CODEX_HOME) : join(home, '.codex');
  let entries;
  try {
    entries = list(codexHome);
  } catch {
    return { path: join(codexHome, 'state_N.sqlite'), error: 'Codex state directory is unavailable' };
  }
  const candidates = entries
    .map((name) => ({ name, match: /^state_(\d+)\.sqlite$/.exec(name) }))
    .filter((entry) => entry.match)
    .map((entry) => {
      const path = join(codexHome, entry.name);
      const version = Number(entry.match[1]);
      try {
        const metadata = stat(path);
        return Number.isSafeInteger(version) && metadata.isFile() ? { path, version, mtimeMs: metadata.mtimeMs } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.version - a.version);
  if (candidates.length === 0)
    return { path: join(codexHome, 'state_N.sqlite'), error: 'Codex state database is missing' };
  return { path: candidates[0].path, error: null };
}

/**
 * Determine whether the newest task in one Codex rollout is terminal.
 * Task completion is only trusted if no later user turn, task start, turn
 * context, assistant response, or tool call followed it. Bookkeeping events do
 * not reopen a finished task. Once terminal, only explicitly recognized
 * bookkeeping may follow; a new or unknown event shape makes completion
 * unproven until another recognized terminal marker appears.
 */
export function codexRolloutState(text) {
  if (typeof text !== 'string' || text.length === 0) return { status: 'unproven', reason: 'empty rollout' };
  let latest = 'unproven';
  let terminalInvalidated = false;
  let parsedLines = 0;
  try {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      parsedLines += 1;
      const payload = event?.payload ?? {};
      if (
        event?.type === 'task_complete' ||
        event?.type === 'turn_complete' ||
        (event?.type === 'event_msg' && (payload.type === 'task_complete' || payload.type === 'turn_complete'))
      ) {
        latest = 'complete';
        terminalInvalidated = false;
      } else if (event?.type === 'task_started' || event?.type === 'turn_context') latest = 'active';
      else if (event?.type === 'event_msg') {
        if (payload.type === 'task_started' || payload.type === 'turn_context') latest = 'active';
        else if (
          payload.type === 'user_message' ||
          (payload.type === 'item_completed' && payload.item?.type === 'UserMessage') ||
          (payload.type === 'item_started' && payload.item?.type === 'UserMessage')
        )
          latest = 'active';
        else if (
          latest === 'complete' &&
          ['item_started', 'item_completed'].includes(payload.type) &&
          payload.item?.type === 'AgentMessage'
        ) {
          latest = 'active';
        } else if (latest === 'complete' && !['token_count', 'thread_settings_applied'].includes(payload.type)) {
          latest = 'unproven';
          terminalInvalidated = true;
        }
      } else if (event?.type === 'response_item') {
        if (payload.role === 'user') latest = 'active';
        else if (
          payload.role === 'assistant' ||
          payload.type === 'function_call' ||
          payload.type === 'custom_tool_call'
        )
          latest = 'active';
        else if (latest === 'complete') {
          latest = 'unproven';
          terminalInvalidated = true;
        }
      } else if (latest === 'complete' && event?.type !== 'token_usage_record') {
        latest = 'unproven';
        terminalInvalidated = true;
      }
    }
  } catch (error) {
    return { status: 'unproven', reason: `rollout JSON is invalid: ${error.message}` };
  }
  if (parsedLines === 0) return { status: 'unproven', reason: 'rollout has no events' };
  if (latest === 'complete') return { status: 'complete', reason: null };
  if (latest === 'active')
    return { status: 'active', reason: 'a new task or user/tool event follows the last terminal marker' };
  return {
    status: 'unproven',
    reason: terminalInvalidated
      ? 'an unrecognized event followed the last terminal marker'
      : 'no verified terminal task_complete event',
  };
}

function readTail(path, expectedSnapshot, fstat = fstatSync) {
  const fd = openSync(path, 'r');
  try {
    const initialSnapshot = fstat(fd, { bigint: true });
    if (!sameFileSnapshot(expectedSnapshot, initialSnapshot)) {
      throw new Error('Codex rollout changed before its tail was opened');
    }
    if (initialSnapshot.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('Codex rollout is too large to inspect safely');
    }
    let position = Number(initialSnapshot.size);
    let bytesRead = 0;
    let newlineCount = 0;
    const chunks = [];
    while (position > 0 && newlineCount <= TAIL_LINES && bytesRead <= MAX_TAIL_BYTES) {
      const count = Math.min(READ_BLOCK_BYTES, position);
      position -= count;
      const chunk = Buffer.allocUnsafe(count);
      const actual = readSync(fd, chunk, 0, count, position);
      if (actual !== count) throw new Error('Codex rollout changed while its tail was being read');
      chunks.push(chunk);
      bytesRead += count;
      for (let i = 0; i < count; i += 1) if (chunk[i] === 0x0a) newlineCount += 1;
    }
    if (bytesRead > MAX_TAIL_BYTES) throw new Error('Codex rollout tail exceeds the 16 MiB safety limit');
    if (!sameFileSnapshot(initialSnapshot, fstat(fd, { bigint: true }))) {
      throw new Error('Codex rollout changed while its tail was being read');
    }
    return tailText(Buffer.concat(chunks.reverse(), bytesRead));
  } finally {
    closeSync(fd);
  }
}

function tailText(buffer) {
  return buffer.toString('utf8').split(/\r?\n/).slice(-TAIL_LINES).join('\n');
}

export function readCodexRollout(path, codexHome, { decompress = spawnSync, stat = statSync, fstat = fstatSync } = {}) {
  if (!isAbsolute(path)) throw new Error('Codex rollout path is not absolute');
  const root = realpathSync(codexHome);
  const realPath = realpathSync(path);
  const pathFromRoot = relative(root, realPath);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error('Codex rollout resolves outside the state directory');
  }
  const initialSnapshot = stat(realPath, { bigint: true });
  if (!initialSnapshot.isFile()) throw new Error('Codex rollout is not a regular file');
  path = realPath;
  if (!path.endsWith('.zst')) return readTail(path, initialSnapshot, fstat);

  const result = decompress('zstd', ['-dc', path], {
    maxBuffer: MAX_DECOMPRESSED_BYTES,
    timeout: 15_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result?.error) throw result.error;
  if (result?.status !== 0)
    throw new Error(`zstd could not read the Codex rollout (exit ${result?.status ?? 'unknown'})`);
  if (!Buffer.isBuffer(result.stdout)) throw new Error('zstd did not return rollout bytes');
  if (!sameFileSnapshot(initialSnapshot, stat(realPath, { bigint: true }))) {
    throw new Error('Codex rollout changed while it was being decompressed');
  }
  return tailText(result.stdout.subarray(-MAX_TAIL_BYTES));
}

function failure(status, chatId, reason, extra = {}) {
  return { status, chatId, reason, family: [], ...extra };
}

/**
 * Inspect the complete transitive Codex family for an exact thread ID.
 * `status: complete` is the only clear result. Missing DB/schema/rows/edges or
 * transcript evidence is `unproven`; any unfinished member is `active`.
 */
export function inspectCodexFamily(
  chatId,
  {
    dbPath = resolveCodexStateDb().path,
    open = (path) => new DatabaseSync(path, { readOnly: true }),
    read = readCodexRollout,
  } = {}
) {
  if (!isCodexThreadId(chatId)) return failure('not-applicable', chatId, 'Chat trailer is not a Codex UUID');
  if (!dbPath || !existsSync(dbPath))
    return failure('unproven', chatId, 'Codex state database is missing or unavailable');

  let db;
  try {
    db = open(dbPath);
    const backfill = db.prepare('SELECT status FROM backfill_state WHERE id = 1').get();
    if (backfill?.status !== 'complete') {
      return failure('unproven', chatId, `Codex state backfill is ${backfill?.status ?? 'missing'}, not complete`);
    }

    const rows = db.prepare('SELECT id, rollout_path, attached_thread_parent_id FROM threads').all();
    const threads = new Map(rows.map((row) => [row.id, row]));
    const parents = new Map();
    const children = new Map();
    const addEdge = (parentId, childId) => {
      if (!parentId || !childId) return;
      if (!parents.has(childId)) parents.set(childId, new Set());
      if (!children.has(parentId)) children.set(parentId, new Set());
      parents.get(childId).add(parentId);
      children.get(parentId).add(childId);
    };

    for (const row of rows) addEdge(row.attached_thread_parent_id, row.id);
    const edges = db.prepare('SELECT parent_thread_id, child_thread_id FROM thread_spawn_edges').all();
    for (const edge of edges) addEdge(edge.parent_thread_id, edge.child_thread_id);

    if (!threads.has(chatId))
      return failure('unproven', chatId, 'Chat trailer does not resolve to an indexed Codex thread');

    const ancestors = new Set([chatId]);
    const upQueue = [chatId];
    const missing = new Set();
    while (upQueue.length > 0) {
      const current = upQueue.shift();
      for (const parent of parents.get(current) ?? []) {
        if (!threads.has(parent)) missing.add(parent);
        else if (!ancestors.has(parent)) {
          ancestors.add(parent);
          upQueue.push(parent);
        }
      }
    }

    const familyIds = new Set(ancestors);
    const downQueue = [...ancestors];
    while (downQueue.length > 0) {
      const current = downQueue.shift();
      for (const child of children.get(current) ?? []) {
        if (!threads.has(child)) missing.add(child);
        else if (!familyIds.has(child)) {
          familyIds.add(child);
          downQueue.push(child);
        }
      }
    }
    if (missing.size > 0) {
      return failure('unproven', chatId, `Codex family references missing thread rows: ${[...missing].join(', ')}`);
    }

    const roots = [...familyIds].filter((id) => (parents.get(id)?.size ?? 0) === 0);
    if (roots.length !== 1)
      return failure('unproven', chatId, `Codex family has ${roots.length} roots; expected exactly one`);

    const family = [];
    for (const id of familyIds) {
      const row = threads.get(id);
      if (typeof row.rollout_path !== 'string' || row.rollout_path.length === 0) {
        family.push({ id, status: 'unproven', reason: 'Codex thread has no rollout path' });
        continue;
      }
      let transcript;
      try {
        const rolloutPath = isAbsolute(row.rollout_path)
          ? row.rollout_path
          : resolve(dirname(dbPath), row.rollout_path);
        transcript = read(rolloutPath, dirname(dbPath));
      } catch (error) {
        family.push({ id, status: 'unproven', reason: error.message });
        continue;
      }
      const state = codexRolloutState(transcript);
      family.push({ id, status: state.status, reason: state.reason });
    }

    const active = family.filter((member) => member.status === 'active');
    const unproven = family.filter((member) => member.status === 'unproven');
    if (active.length > 0) {
      return {
        status: 'active',
        chatId,
        rootThreadId: roots[0],
        reason: 'Codex family has unfinished thread activity',
        family,
      };
    }
    if (unproven.length > 0) {
      return {
        status: 'unproven',
        chatId,
        rootThreadId: roots[0],
        reason: 'Codex family completion could not be verified',
        family,
      };
    }
    return { status: 'complete', chatId, rootThreadId: roots[0], reason: null, family };
  } catch (error) {
    return failure('unproven', chatId, `Codex state could not be read: ${error.message}`);
  } finally {
    try {
      db?.close();
    } catch {
      // The read-only evidence is already assembled; close errors cannot change it.
    }
  }
}

/** Read exact UUID Chat trailers from a commit and resolve their Codex families. */
export function inspectCodexChatTrailers(cwd, tip, { run = defaultRun, inspect = inspectCodexFamily } = {}) {
  let output;
  try {
    output = run(cwd, ['show', '-s', '--format=%(trailers:key=Chat,valueonly)', tip]).stdout ?? '';
  } catch (error) {
    return failure('unproven', null, `Chat trailer could not be read from ${tip}: ${error.message}`);
  }
  const ids = [
    ...new Set(
      output
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(isCodexThreadId)
    ),
  ];
  if (ids.length === 0) return { status: 'not-applicable', chatIds: [], family: [], reason: null };
  const families = ids.map((id) => inspect(id));
  const active = families.some((item) => item.status === 'active');
  const unproven = families.some((item) => item.status === 'unproven');
  const status = active ? 'active' : unproven ? 'unproven' : 'complete';
  return {
    status,
    chatIds: ids,
    family: families,
    reason: active
      ? 'one or more Codex families are unfinished'
      : unproven
        ? 'one or more Codex families are unverified'
        : null,
  };
}

function defaultRun(cwd, args) {
  return {
    stdout: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  };
}
