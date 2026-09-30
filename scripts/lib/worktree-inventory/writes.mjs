/**
 * Who WROTE in each worktree, over all of history — the part the chat audit
 * cannot answer.
 *
 * WHY THIS IS NOT `session.directory`
 * ----------------------------------
 * `chats.mjs` attributes a chat to a worktree by the directory the chat was
 * OPENED in. That is the only signal the session table carries, and it is wrong
 * in both directions at once:
 *
 * - A chat opened in the main checkout and then driven into a task worktree is
 *   recorded against the main checkout for its whole life, so the worktree it
 *   spent the afternoon editing has no chat on it at all.
 * - A chat opened in a worktree that was later deleted still points at a
 *   directory that no longer exists, and its writes vanish with it.
 *
 * Both are why the inventory could report `chats: { count: 0 }` for a worktree
 * with a week of commits on it. History that is dropped cannot be excavated, so
 * this module reads the actual write calls out of the `part` table instead: the
 * tools that change a file, the path each one names, and the time it happened.
 *
 * WHY THIS IS UNWINDOWED
 * ----------------------
 * `auditChats` bounds itself by `--window-hours` on purpose, because classifying
 * every session ever run is not the question it answers. The question here is
 * the opposite one — "who touched this worktree, ever" — so there is no window
 * and no `sinceMs`. The two views are expected to disagree, and the disagreement
 * is the finding: a worktree with commits and no recent chat but a long write
 * history is a worktree somebody built and walked away from.
 *
 * WHY ONLY COMPLETED CALLS COUNT
 * ------------------------------
 * A tool call recorded with `state.status = 'error'` changed nothing. Measured on
 * this repository: 438 `edit`, 71 `write` and 58 `apply_patch` calls that failed.
 * Counting them would put a number in the file that overstates what was written,
 * and the number is the thing an operator trusts.
 */

import { DatabaseSync } from 'node:sqlite';

/**
 * The tools that change a file, and the JSON path each uses to name it.
 *
 * `edit` and `write` carry a `filePath` input. `apply_patch` does not — it
 * carries a `patchText` whose header lines name the files, so it is parsed
 * separately rather than being silently skipped. Skipping it would have dropped
 * 537 real writes in this repository.
 */
export const WRITE_TOOLS = Object.freeze(['edit', 'write', 'apply_patch']);

/** The directory this repository keeps its worktrees in. */
const WORKTREE_DIR_SEGMENT = '.kilo/worktrees/';

/**
 * macOS reports the same directory two ways.
 *
 * `git worktree list` prints `/private/var/folders/…` while a tool call recorded
 * months earlier names `/var/folders/…`, and they are the same directory. Both
 * sides are normalised to the `/private` form so a prefix match compares like
 * with like; without it a `/tmp` worktree silently matches nothing.
 */
function normalisePath(p) {
  if (process.platform !== 'darwin') return p;
  return p.startsWith('/private/') ? p : `/private${p}`;
}

/**
 * A write is attributed to the LONGEST registered worktree path that contains
 * it, and to the main checkout only when nothing shorter claims it.
 *
 * Longest-prefix matters because the main checkout contains every worktree: a
 * file at `<root>/.kilo/worktrees/x/src/a.ts` is under the root, and matching
 * the root first would file every worktree's writes under main.
 *
 * `match` returns the path AS THE CALLER SPELLED IT, not the normalised form it
 * matched on. Callers look records up by the worktree's own path from
 * `git worktree list`, and git spells an in-repo worktree `/Users/…` while the
 * macOS-normalised form is `/private/Users/…` — returning the normalised key
 * would miss every worktree in the repository and silently attribute the lot to
 * whatever prefix did match.
 */
export function buildPathIndex(root, worktreePaths = []) {
  const originals = [...new Set([root, ...worktreePaths])];
  const original = new Map(originals.map((p) => [normalisePath(p), p]));
  const entries = [...original.keys()].sort((a, b) => b.length - a.length);
  return {
    entries,
    /** The registered directory containing `p`, or `null` if none does. */
    match(p) {
      const n = normalisePath(p);
      for (const entry of entries) {
        if (n === entry || n.startsWith(`${entry}/`)) return original.get(entry);
      }
      return null;
    },
  };
}

/**
 * The worktree a path belongs to BY NAME, whether or not it is still registered.
 *
 * This is the archaeology case. A worktree that was deleted takes its
 * registration with it, so a later longest-prefix match against the surviving
 * set falls through to the main checkout and files the dead worktree's writes
 * under main — the exact misattribution this module exists to remove. The
 * `.kilo/worktrees/<name>/` segment survives in the recorded path, so the name
 * can still be recovered.
 */
export function worktreeNameFromPath(p, root) {
  const n = normalisePath(p);
  // The separator is explicit rather than assumed: the root arrives here with
  // no trailing slash, so concatenating the segment onto it built the marker
  // `<root>.kilo/worktrees/` — which matches nothing, and silently sent every
  // write to a deleted worktree to the main checkout instead.
  const marker = `${normalisePath(root)}/${WORKTREE_DIR_SEGMENT}`;
  if (!n.startsWith(marker)) return null;
  const rest = n.slice(marker.length);
  const slash = rest.indexOf('/');
  const name = slash === -1 ? rest : rest.slice(0, slash);
  return name || null;
}

/**
 * A short, stable bucket for a write that belongs to no known worktree.
 *
 * Kept deliberately coarse — five path segments — because the useful signal is
 * "this project, which is not a worktree of ours" and not the individual file.
 * The count is never dropped either way: an unmapped write is still a write, and
 * the total is reported so the buckets cannot quietly under-report.
 */
function unmappedBucket(p) {
  const parts = normalisePath(p).split('/').filter(Boolean);
  return `/${parts.slice(0, 4).join('/')}`;
}

/**
 * The file names in an `apply_patch` payload.
 *
 * The header lines are `*** Update File: <path>`, `*** Add File: <path>`,
 * `*** Delete File: <path>` and `*** Move to: <path>`, each at the start of a
 * line. Anchoring on the line start is what keeps a path inside the patch BODY
 * — a context line can contain the same text — from being counted as a target.
 */
export function patchTargetPaths(patchText) {
  if (typeof patchText !== 'string') return [];
  const out = [];
  const re = /^\*\*\* (?:Update|Add|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm;
  let m;
  while ((m = re.exec(patchText)) !== null) {
    const p = (m[1] ?? m[2] ?? '').trim();
    if (p.startsWith('/')) out.push(p);
  }
  return out;
}

function openDb(dbPath) {
  try {
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
}

/**
 * The sessions to consider, and the parent chain that rolls a subagent's write
 * up to the chat a human would recognise.
 *
 * Scoped to one project when the database can say which project that is, and to
 * every session when it cannot. The scoping is an OPTIMISATION, never a
 * correctness requirement: attribution is by absolute path, so a write is
 * attributed correctly whichever project the writing session belonged to, and a
 * database without a `project_directory` table still produces a correct answer
 * over a larger set.
 */
function readSessions(db, root) {
  const cols = db
    .prepare('SELECT * FROM session LIMIT 0')
    .columns()
    .map((c) => c.name);
  const hasProject = cols.includes('project_id');

  let scopeSql = '';
  const scopeArgs = [];
  if (hasProject) {
    let projectId = null;
    try {
      const row = db
        .prepare('SELECT project_id FROM project_directory WHERE directory = ? LIMIT 1')
        .get(normalisePath(root));
      projectId = row?.project_id ?? null;
    } catch {
      projectId = null;
    }
    if (projectId) {
      scopeSql = ' WHERE project_id = ?';
      scopeArgs.push(projectId);
    }
  }

  const rows = db
    .prepare(`SELECT id, parent_id, directory, title, agent, time_created, time_updated FROM session${scopeSql}`)
    .all(...scopeArgs);

  const byId = new Map();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      parentId: r.parent_id ?? null,
      directory: r.directory,
      title: r.title,
      agent: r.agent,
      timeCreated: r.time_created,
      timeUpdated: r.time_updated,
    });
  }
  return byId;
}

/**
 * Walk a session up to the top-level chat that owns it.
 *
 * A subagent is not a chat anybody opened, and it inherits the parent's
 * directory, so attributing its writes to itself would inflate the owner count
 * with ids no human can act on. The walk is bounded by the number of sessions so
 * a cycle in the data cannot hang the generator.
 */
export function rootSessionId(id, byId) {
  let cur = byId.get(id);
  let hops = 0;
  while (cur?.parentId && byId.has(cur.parentId) && hops < 64) {
    cur = byId.get(cur.parentId);
    hops += 1;
  }
  return cur?.id ?? id;
}

/**
 * Every completed write this project has ever made, grouped by the directory it
 * landed in.
 *
 * The `part` table is unindexed on the JSON fields this needs, so a naive scan
 * over 428k rows cost 15s. Loading the in-scope session ids into a temporary
 * table first lets the existing `part_session_idx` prune the rows, which halved
 * it to 13.5s. The two `apply_patch` variants live in the SAME statement as the
 * `filePath` ones because a second pass over the same rows costs another 13.5s
 * for no new information. The result is still a full-table JSON extraction; it is
 * a one-shot generator, not a hot path, and the alternative — no write history at
 * all — is the thing being fixed.
 */
function readWrites(db, sessionIds) {
  const out = [];
  if (sessionIds.length === 0) return out;

  db.exec('CREATE TEMP TABLE scoped_session (id TEXT PRIMARY KEY)');
  const insert = db.prepare('INSERT OR IGNORE INTO scoped_session (id) VALUES (?)');
  for (const id of sessionIds) insert.run(id);

  const rows = db
    .prepare(
      `SELECT p.session_id AS session_id, p.time_created AS at,
              json_extract(p.data, '$.state.input.filePath') AS file_path,
              CASE WHEN json_extract(p.data, '$.tool') = 'apply_patch'
                   THEN json_extract(p.data, '$.state.input.patchText') END AS patch_text
         FROM part p
         JOIN scoped_session s ON s.id = p.session_id
        WHERE json_extract(p.data, '$.type') = 'tool'
          AND json_extract(p.data, '$.tool') IN ('edit','write','apply_patch')
          AND json_extract(p.data, '$.state.status') = 'completed'`
    )
    .all();

  for (const row of rows) {
    const paths = row.file_path ? [row.file_path] : patchTargetPaths(row.patch_text);
    if (paths.length > 0) out.push({ sessionId: row.session_id, at: row.at, paths });
  }
  return out;
}

const MAX_FILES_PER_CHAT = 60;

/**
 * Roll raw write calls up into the per-directory record the inventory needs.
 *
 * `writeCalls` counts CALLS, not files: one chat rewriting the same file forty
 * times did forty writes, and a caller deciding whether work is still in flight
 * needs the call count, not the file count.
 */
export function buildWriteRecords(writes, { root, index, byId }) {
  const records = new Map();
  // The root contributes no name to this set, which is exactly why it needs no
  // special case: `worktreeNameFromPath` returns null for the main checkout.
  const registeredNames = new Set(index.entries.map((p) => worktreeNameFromPath(p, root)).filter(Boolean));

  /**
   * Where one written file belongs.
   *
   * The worktree NAME is resolved before the path prefix on purpose. Every
   * worktree lives UNDER the main checkout, so a longest-prefix match would
   * otherwise claim every write to a deleted worktree for the main checkout —
   * and a plain prefix match would do it even without the longest part. Asking
   * the path's own `.kilo/worktrees/<name>/` segment first is the only order
   * that keeps a dead worktree's writers attached to the dead worktree.
   */
  const attribute = (p) => {
    const name = worktreeNameFromPath(p, root);
    if (name) {
      return registeredNames.has(name)
        ? { key: index.match(p), path: p }
        : { key: `gone:${name}`, path: `${normalisePath(root)}/${WORKTREE_DIR_SEGMENT}${name}` };
    }
    const hit = index.match(p);
    return hit ? { key: hit, path: hit } : null;
  };

  const recordFor = (key, path) => {
    let r = records.get(key);
    if (!r) {
      r = { key, path, writeCalls: 0, subagentWriteCalls: 0, chats: new Map() };
      records.set(key, r);
    }
    return r;
  };

  let unmapped = 0;
  const unmappedByBucket = new Map();

  for (const w of writes) {
    const rootId = rootSessionId(w.sessionId, byId);
    const owner = byId.get(rootId) ?? { id: rootId, directory: null, title: null, agent: null };
    const isSubagent = w.sessionId !== rootId;

    for (const p of w.paths) {
      const where = attribute(p);
      if (!where) {
        unmapped += 1;
        const bucket = unmappedBucket(p);
        unmappedByBucket.set(bucket, (unmappedByBucket.get(bucket) ?? 0) + 1);
        continue;
      }

      const r = recordFor(where.key, where.path);
      r.writeCalls += 1;
      if (isSubagent) r.subagentWriteCalls += 1;

      let c = r.chats.get(rootId);
      if (!c) {
        c = {
          id: rootId,
          title: owner.title ?? null,
          agent: owner.agent ?? null,
          openedIn: owner.directory ?? null,
          openedHere: owner.directory ? normalisePath(owner.directory) === normalisePath(where.path) : false,
          writeCalls: 0,
          subagentWriteCalls: 0,
          firstWriteAt: w.at,
          lastWriteAt: w.at,
          files: new Set(),
        };
        r.chats.set(rootId, c);
      }
      c.writeCalls += 1;
      if (isSubagent) c.subagentWriteCalls += 1;
      if (w.at < c.firstWriteAt) c.firstWriteAt = w.at;
      if (w.at > c.lastWriteAt) c.lastWriteAt = w.at;
      c.files.add(p);
    }
  }

  return { records, unmapped, unmappedByBucket };
}

const iso = (ms) => (typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null);

/**
 * The per-worktree `writeHistory` object.
 *
 * `writingNow` and `currentWriterChatIds` are what the ownership model reads.
 * `derivedWriterChatIds` is kept BESIDE them, never instead of them, so a
 * suppression is auditable: the reader can see what the database said and that
 * something overrode it, rather than finding an empty array with no explanation.
 */
export function summariseWrites(record, { nowMs, liveWindowMs, suppressed = false }) {
  const chats = [...(record?.chats.values() ?? [])]
    .map((c) => {
      const files = [...c.files].sort();
      return {
        id: c.id,
        title: c.title,
        agent: c.agent,
        openedIn: c.openedIn,
        openedHere: c.openedHere,
        writeCalls: c.writeCalls,
        subagentWriteCalls: c.subagentWriteCalls,
        firstWriteAt: iso(c.firstWriteAt),
        lastWriteAt: iso(c.lastWriteAt),
        fileCount: files.length,
        files: files.slice(0, MAX_FILES_PER_CHAT),
        filesTruncated: files.length > MAX_FILES_PER_CHAT,
      };
    })
    .sort((a, b) => (a.lastWriteAt < b.lastWriteAt ? 1 : a.lastWriteAt > b.lastWriteAt ? -1 : 0));

  const lastWriteAtMs = chats.reduce((n, c) => Math.max(n, Date.parse(c.lastWriteAt ?? 0) || 0), 0);
  const derived = chats
    .filter((c) => lastWriteAtMs > 0 && nowMs - (Date.parse(c.lastWriteAt) || 0) < liveWindowMs)
    .map((c) => c.id);

  return {
    writingNow: suppressed ? false : derived.length > 0,
    currentWriterChatIds: suppressed ? [] : derived,
    derivedWriterChatIds: derived,
    suppressed,
    lastWriteAt: iso(lastWriteAtMs),
    lastWriteAtMs: lastWriteAtMs || null,
    lastWriterChatId: chats[0]?.id ?? null,
    chatCount: chats.length,
    writeCalls: record?.writeCalls ?? 0,
    subagentWriteCalls: record?.subagentWriteCalls ?? 0,
    chats,
  };
}

/** An empty history, so a worktree nobody ever wrote in still carries the shape. */
export function emptyWriteHistory({ nowMs, liveWindowMs, suppressed = false }) {
  return summariseWrites(null, { nowMs, liveWindowMs, suppressed });
}

/**
 * Read every write this project has made and attribute it to a directory.
 *
 * Returns the same `available: false` shape the other readers use when the
 * database is missing, so a machine with no Kilo history still gets a complete
 * inventory with an empty history on every worktree and a `dataSources` entry
 * saying why.
 */
export function auditWrites({ dbPath, root, worktreePaths = [], nowMs, liveWindowMs }) {
  const empty = {
    available: false,
    dbPath,
    totalWriteCalls: 0,
    sessionCount: 0,
    byWorktree: new Map(),
    goneWorktrees: [],
    unmappedWriteCalls: 0,
    unmappedBuckets: [],
  };
  const db = openDb(dbPath);
  if (!db) return empty;

  try {
    const byId = readSessions(db, root);
    const writes = readWrites(db, [...byId.keys()]);
    const index = buildPathIndex(root, worktreePaths);
    const { records, unmapped, unmappedByBucket } = buildWriteRecords(writes, { root, index, byId });

    const goneWorktrees = [...records.entries()]
      .filter(([key]) => key.startsWith('gone:'))
      .map(([key, r]) => {
        const h = summariseWrites(r, { nowMs, liveWindowMs });
        return {
          name: key.slice('gone:'.length),
          writeCalls: h.writeCalls,
          chatCount: h.chatCount,
          chatIds: h.chats.map((c) => c.id),
          lastWriteAt: h.lastWriteAt,
        };
      })
      .sort((a, b) => b.writeCalls - a.writeCalls);

    return {
      available: true,
      dbPath,
      totalWriteCalls: [...records.values()].reduce((n, r) => n + r.writeCalls, 0) + unmapped,
      sessionCount: byId.size,
      byWorktree: records,
      goneWorktrees,
      unmappedWriteCalls: unmapped,
      unmappedBuckets: [...unmappedByBucket.entries()]
        .map(([bucket, n]) => ({ bucket, writeCalls: n }))
        .sort((a, b) => b.writeCalls - a.writeCalls),
    };
  } finally {
    db.close();
  }
}
