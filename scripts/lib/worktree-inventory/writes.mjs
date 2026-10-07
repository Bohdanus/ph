/**
 * Who WROTE in each worktree, who READ it, and who ran commands in it — over all
 * of history, derived from the tool calls themselves.
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
 * this module reads the actual calls out of the `part` table instead: the tool,
 * the path it named, and the time it happened.
 *
 * THREE SEPARATE STRUCTURES, AND WHY THEY ARE NOT MERGED
 * ------------------------------------------------------
 * - `writeHistory` — file-changing tools. PERMANENT. This is the record of who
 *   built what, and losing an entry loses an owner.
 * - `readHistory` — file-reading tools. RELEASABLE. Reading a worktree is
 *   interest, not authorship: a reviewer, an explorer and a debugging agent all
 *   read directories they never touched, and a reader list that only grows stops
 *   answering "who is looking at this" while still claiming to.
 * - `shellHistory` — commands run with a `workdir` inside the worktree.
 *
 * Keeping reads out of `writeHistory` is what makes the release possible. A
 * release that had to preserve writers by filtering a MERGED list would have to
 * remember which entries were which, permanently; two lists need no memory, and
 * a watermark moves forward through the reader list alone.
 *
 * WHY ONLY COMPLETED CALLS COUNT
 * ------------------------------
 * A tool call recorded with `state.status = 'error'` changed nothing. Measured on
 * this repository: 438 `edit`, 71 `write` and 58 `apply_patch` calls that failed.
 * Counting them would put a number in the file that overstates what was written,
 * and the number is the thing an operator trusts.
 *
 * WHY THE WRITE COUNT IS NOT COMPLETE, AND SAYS SO
 * -------------------------------------------------
 * A shell can change a file: `sed -i`, a heredoc, `>`, `git apply`. None of that
 * is visible in any tool's arguments, so `writeHistory` counts file-editing tool
 * calls and nothing else. On this repository 464 sessions ran 11,503 commands
 * with a workdir inside a worktree, and any of them could have written. Rather
 * than guess from command text, the shell calls are recorded in their own
 * structure, and `shellHistory.writeCapableCalls` states how much of the shell
 * traffic this file cannot account for. A count that reads as complete when it is
 * not is the defect; an admitted gap is a fact.
 */

import { DatabaseSync } from 'node:sqlite';

/** The directory this repository keeps its worktrees in. */
const WORKTREE_DIR_SEGMENT = '.kilo/worktrees/';

/**
 * Every tool this module looks at, read in ONE statement.
 */
export const WRITE_TOOLS = Object.freeze(['edit', 'write', 'apply_patch', 'notebook_edit']);
export const READ_TOOLS = Object.freeze(['read', 'grep', 'glob', 'semantic_search']);
export const SHELL_TOOLS = Object.freeze(['bash', 'background_process']);
const TRACKED_TOOLS = Object.freeze([...WRITE_TOOLS, ...READ_TOOLS, ...SHELL_TOOLS]);

/**
 * Which input field names the target, per tool.
 *
 * `read` uses `filePath`; `grep`, `glob`, `semantic_search` and `notebook_edit`
 * use `path`. Both spellings are selected for every row and matched per tool,
 * because selecting conditionally would need a second statement and therefore a
 * second full scan.
 */
const TARGET_FIELD = Object.freeze({
  edit: 'filePath',
  write: 'filePath',
  notebook_edit: 'path',
  read: 'filePath',
  grep: 'path',
  glob: 'path',
  semantic_search: 'path',
});

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
 * A call is attributed to the LONGEST registered worktree path that contains it,
 * and to the main checkout only when nothing shorter claims it.
 *
 * Longest-prefix matters because the main checkout contains every worktree: a
 * file at `<root>/.kilo/worktrees/x/src/a.ts` is under the root, and matching the
 * root first would file every worktree's calls under main.
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
 * registration with it, so a later longest-prefix match against the surviving set
 * falls through to the main checkout and files the dead worktree's calls under
 * main — the exact misattribution this module exists to remove. The
 * `.kilo/worktrees/<name>/` segment survives in the recorded path, so the name can
 * still be recovered.
 */
export function worktreeNameFromPath(p, root) {
  const n = normalisePath(p);
  // The separator is explicit rather than assumed: the root arrives here with no
  // trailing slash, so concatenating the segment onto it built the marker
  // `<root>.kilo/worktrees/` — which matches nothing.
  const marker = `${normalisePath(root)}/${WORKTREE_DIR_SEGMENT}`;
  if (!n.startsWith(marker)) return null;
  const rest = n.slice(marker.length);
  const slash = rest.indexOf('/');
  const name = slash === -1 ? rest : rest.slice(0, slash);
  return name || null;
}

/**
 * Make a recorded path absolute, or say that it cannot be.
 *
 * A tool may record a relative path: the working directory it ran in is the only
 * thing that gives the file a location, and it is not in the call. Resolving
 * against the session's own directory is right often enough to be worth doing,
 * and it is MARKED when used, because a guess is worse than an admission.
 * Anything that stays relative is bucketed under its own `relative:` key rather
 * than being run through the path index, which would read `src/a.ts` as
 * root-relative and file it under the main checkout.
 */
function absolutise(p, sessionDir) {
  if (typeof p !== 'string' || p === '') return { absolute: null, assumed: false };
  if (p.startsWith('/')) return { absolute: p, assumed: false };
  if (!sessionDir || !sessionDir.startsWith('/')) return { absolute: null, assumed: false };
  return { absolute: `${sessionDir.replace(/\/$/, '')}/${p}`, assumed: true };
}

/**
 * A short, stable bucket for a call that belongs to no known worktree.
 *
 * Deliberately coarse, because the useful signal is "this project, which is not a
 * worktree of ours" and not the individual file. The count is never dropped: an
 * unmapped call is still a call, and it is reported per kind so the totals cannot
 * quietly under-report or quietly mix three different things together.
 */
function unmappedBucket(p) {
  const parts = String(p).split('/').filter(Boolean);
  return `/${parts.slice(0, 4).join('/')}`;
}

/**
 * The file names in an `apply_patch` payload.
 *
 * The header lines are `*** Update File: <path>`, `*** Add File: <path>`,
 * `*** Delete File: <path>` and `*** Move to: <path>`, each at the start of a
 * line. Anchoring on the line start is what keeps a path inside the patch BODY —
 * a context line can contain the same text — from being counted as a target.
 *
 * Relative targets are kept, not filtered: the caller resolves them against the
 * session directory and records that it had to, whereas an absolute-only filter
 * dropped them on the floor and lost the writer.
 */
export function patchTargetPaths(patchText) {
  if (typeof patchText !== 'string') return [];
  const out = [];
  const re = /^\*\*\* (?:Update|Add|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm;
  let m;
  while ((m = re.exec(patchText)) !== null) {
    const p = (m[1] ?? m[2] ?? '').trim();
    if (p) out.push(p);
  }
  return out;
}

/**
 * Open the session database read-only, or return `null` when it is absent.
 */
function openDb(dbPath) {
  try {
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
}

/**
 * EVERY session, and the parent chain that rolls a subagent's call up to the chat
 * a human would recognise.
 *
 * There is deliberately NO `project_id` filter, and that is a correctness
 * requirement rather than an optimisation. Scoping to one project was tried and
 * measured on this repository: it silently dropped 30 sessions belonging to
 * another project that had made 774 completed writes into this checkout — 613
 * into the main checkout and 161 into worktrees. A writer absent from the write
 * history is the one failure this structure cannot have, so the read is
 * unfiltered. Attribution is a question about PATHS, and a path says nothing
 * about which project the session that wrote it belonged to.
 *
 * The filter this replaced was also dead: it looked the project up with
 * `normalisePath(root)`, which on macOS produces `/private/Users/…`, while
 * `project_directory` stores the unprefixed spelling — so the lookup matched zero
 * rows and every session was read anyway. That made the branch look exercised
 * while arming a silent 774-write failure the day the path spelling was "fixed".
 * Deleting it is the fix; repairing it was the trap.
 */
function readSessions(db) {
  const rows = db
    .prepare(`SELECT id, parent_id, directory, title, agent, time_created, time_updated FROM session`)
    .all();
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
 * directory, so attributing its calls to itself would fill the owner list with ids
 * no human can act on. The walk reads the WHOLE session table rather than any
 * filtered subset, so a subagent whose parent lives under a different project
 * still rolls up instead of being recorded as a chat of its own. Bounded, so a
 * cycle in the data cannot hang the generator.
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
 * Every completed call by a tracked tool, with whatever path it named.
 *
 * One statement for all of them: see `TRACKED_TOOLS`. The `apply_patch` payload is
 * selected behind a `CASE` so the large patch text is only materialised for the
 * 595 rows that need it.
 */
function readCalls(db, sessionIds) {
  const out = [];
  if (sessionIds.length === 0) return out;

  db.exec('CREATE TEMP TABLE scoped_session (id TEXT PRIMARY KEY)');
  const insert = db.prepare('INSERT OR IGNORE INTO scoped_session (id) VALUES (?)');
  for (const id of sessionIds) insert.run(id);

  const rows = db
    .prepare(
      `SELECT p.session_id AS session_id, p.time_created AS at,
              json_extract(p.data, '$.tool') AS tool,
              json_extract(p.data, '$.state.input.filePath') AS file_path,
              json_extract(p.data, '$.state.input.path') AS tool_path,
              json_extract(p.data, '$.state.input.workdir') AS workdir,
              CASE WHEN json_extract(p.data, '$.tool') = 'apply_patch'
                   THEN json_extract(p.data, '$.state.input.patchText') END AS patch_text
         FROM part p
         JOIN scoped_session s ON s.id = p.session_id
        WHERE json_extract(p.data, '$.type') = 'tool'
          AND json_extract(p.data, '$.state.status') = 'completed'
          AND json_extract(p.data, '$.tool') IN (${TRACKED_TOOLS.map(() => '?').join(',')})`
    )
    .all(...TRACKED_TOOLS);

  for (const row of rows) {
    out.push({
      sessionId: row.session_id,
      at: row.at,
      tool: row.tool,
      filePath: row.file_path,
      toolPath: row.tool_path,
      workdir: row.workdir,
      patchText: row.patch_text,
    });
  }
  return out;
}

const MAX_FILES_PER_CHAT = 60;

function emptyKind() {
  return { calls: 0, subagentCalls: 0, unlocatedCalls: 0, chats: new Map() };
}

function touchChat(kind, rootId, owner, at, path, worktreePath, isSubagent) {
  let c = kind.chats.get(rootId);
  if (!c) {
    c = {
      id: rootId,
      title: owner.title ?? null,
      agent: owner.agent ?? null,
      openedIn: owner.directory ?? null,
      // A record with no worktree — an unlocated read, or a relative path that
      // could not be resolved — has nothing to compare against, so `openedHere`
      // is false rather than a comparison against null.
      openedHere:
        owner.directory && worktreePath ? normalisePath(owner.directory) === normalisePath(worktreePath) : false,
      calls: 0,
      subagentCalls: 0,
      assumedCwd: 0,
      firstAt: at,
      lastAt: at,
      files: new Set(),
    };
    kind.chats.set(rootId, c);
  }
  c.calls += 1;
  if (isSubagent) c.subagentCalls += 1;
  if (at < c.firstAt) c.firstAt = at;
  if (at > c.lastAt) c.lastAt = at;
  if (path) c.files.add(path);
  return c;
}

/**
 * Turn raw calls into per-directory records carrying all three kinds.
 *
 * `calls` counts CALLS, not files: one chat rewriting the same file forty times
 * did forty writes, and a caller deciding whether work is still in flight needs
 * the call count, not the file count. NO list of chats is ever truncated — only
 * the `files` sample on a single chat is, and it says so — because a writer that
 * is not listed is a writer that is lost, and the list is the only thing this
 * structure is for.
 */
export function buildCallRecords(calls, { root, index, byId }) {
  const records = new Map();
  // The root contributes no name to this set, which is exactly why it needs no
  // special case: `worktreeNameFromPath` returns null for the main checkout.
  const registeredNames = new Set(index.entries.map((p) => worktreeNameFromPath(p, root)).filter(Boolean));

  /**
   * Where one recorded path belongs.
   *
   * The worktree NAME is resolved before the path prefix on purpose. Every
   * worktree lives UNDER the main checkout, so a longest-prefix match would
   * otherwise claim every call to a deleted worktree for the main checkout — and a
   * plain prefix match would do it even without the longest part. Asking the
   * path's own `.kilo/worktrees/<name>/` segment first is the only order that
   * keeps a dead worktree's history attached to the dead worktree.
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

  // Unmapped is PER KIND. A single counter summed into a write total reads as
  // complete when it is not, and mixing three kinds into one number makes the
  // arithmetic meaningless the moment the second kind exists.
  const unmapped = { write: 0, read: 0, shell: 0 };
  const unmappedByBucket = new Map();
  const noteUnmapped = (kind, raw) => {
    unmapped[kind] += 1;
    const bucket = `${kind}:${unmappedBucket(raw)}`;
    unmappedByBucket.set(bucket, (unmappedByBucket.get(bucket) ?? 0) + 1);
  };

  const recordFor = (key, path) => {
    let r = records.get(key);
    if (!r) {
      r = { key, path, write: emptyKind(), read: emptyKind(), shell: emptyKind() };
      records.set(key, r);
    }
    return r;
  };

  // One place that turns a call into a count, so the kind totals and the per-chat
  // counts cannot drift. The kind counter was dropped once while this was
  // rewritten, which left `attributedWriteCalls` at zero and made the reported
  // write total consist entirely of the UNMAPPED calls — a total that looked
  // plausible and was the wrong number.
  const count = (rec, tally) => {
    rec.calls += 1;
    if (tally.subagent) rec.subagentCalls += 1;
  };

  for (const call of calls) {
    const rootId = rootSessionId(call.sessionId, byId);
    const owner = byId.get(rootId) ?? { id: rootId, directory: null, title: null, agent: null };
    const isSubagent = call.sessionId !== rootId;
    const tally = { subagent: isSubagent };
    // The session that made the call, not its root: a subagent inherits the
    // parent's directory in the table but runs in the directory it was launched
    // into, and that is the one a relative path has to resolve against.
    const sessionDir = byId.get(call.sessionId)?.directory ?? null;

    /** Record one attributed call against a kind bucket. */
    const record = (rawPath, kind) => {
      const { absolute, assumed } = absolutise(rawPath, sessionDir);
      if (!absolute) {
        // A relative path with no absolute session directory to resolve it
        // against is still a real call. It gets its own `relative:` key rather
        // than going through the path index, which would read `src/a.ts` as
        // root-relative and file it under the main checkout.
        const r = recordFor(`relative:${rawPath}`, rawPath);
        count(r[kind], tally);
        touchChat(r[kind], rootId, owner, call.at, rawPath, null, isSubagent);
        return;
      }
      const where = attribute(absolute);
      if (!where) {
        noteUnmapped(kind, absolute);
        return;
      }
      const r = recordFor(where.key, where.path);
      count(r[kind], tally);
      const c = touchChat(r[kind], rootId, owner, call.at, absolute, where.path, isSubagent);
      if (assumed) c.assumedCwd += 1;
    };

    if (WRITE_TOOLS.includes(call.tool)) {
      if (call.tool === 'apply_patch') {
        for (const p of patchTargetPaths(call.patchText)) record(p, 'write');
      } else {
        record(TARGET_FIELD[call.tool] === 'filePath' ? call.filePath : call.toolPath, 'write');
      }
    } else if (READ_TOOLS.includes(call.tool)) {
      const target = TARGET_FIELD[call.tool] === 'filePath' ? call.filePath : call.toolPath;
      if (target) record(target, 'read');
      else {
        // A `grep` or `glob` that defaulted to the working directory records no
        // path at all — 4% of greps and 66% of globs. Those are real reads with
        // no location, so they are counted on the session's own record rather
        // than dropped: omitting them makes the read count a lie.
        const r = recordFor(`unlocated:${rootId}`, null);
        count(r.read, tally);
        touchChat(r.read, rootId, owner, call.at, null, null, isSubagent);
        r.read.unlocatedCalls += 1;
      }
    } else if (SHELL_TOOLS.includes(call.tool)) {
      // A shell call with no recorded `workdir` ran in the session's own
      // directory, which is in the table. Treating the absence as "nowhere" put
      // 40,658 calls on this repository into an unplaceable bucket that the
      // data could have placed; the fallback is only for a session whose
      // directory is itself unusable.
      const shellDir = call.workdir ?? sessionDir;
      if (!shellDir) {
        noteUnmapped('shell', '(no recorded workdir and no usable session directory)');
        continue;
      }
      const where = attribute(shellDir);
      if (!where) {
        noteUnmapped('shell', shellDir);
        continue;
      }
      const r = recordFor(where.key, where.path);
      count(r.shell, tally);
      const c = touchChat(r.shell, rootId, owner, call.at, shellDir, where.path, isSubagent);
      if (!call.workdir) c.assumedCwd += 1;
    }
  }

  return { records, unmapped, unmappedByBucket };
}

const iso = (ms) => (typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null);

/**
 * Roll one kind's records into the shape the document carries.
 *
 * `currentChatIds` is what the ownership model reads. `derivedChatIds` is kept
 * BESIDE it, never instead of it, so a suppression is auditable: the reader can
 * see what the database said and that something overrode it, rather than finding
 * an empty array with no explanation.
 */
function summariseKind(kind, { nowMs, liveWindowMs, suppressed = false, releasedBeforeMs = 0 }) {
  const all = [...(kind?.chats.values() ?? [])].map((c) => {
    const files = [...c.files].sort();
    return {
      id: c.id,
      title: c.title,
      agent: c.agent,
      openedIn: c.openedIn,
      openedHere: c.openedHere,
      calls: c.calls,
      subagentCalls: c.subagentCalls,
      // How many of this chat's paths were resolved against its own session
      // directory rather than read as absolute. Recorded because a resolved
      // guess is a different kind of evidence from a recorded path.
      assumedCwdPaths: c.assumedCwd,
      firstAt: iso(c.firstAt),
      lastAt: iso(c.lastAt),
      fileCount: files.length,
      files: files.slice(0, MAX_FILES_PER_CHAT),
      filesTruncated: files.length > MAX_FILES_PER_CHAT,
    };
  });

  const chats = all
    .filter((c) => (Date.parse(c.lastAt ?? 0) || 0) > releasedBeforeMs)
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
  const latest = chats.reduce((n, c) => Math.max(n, Date.parse(c.lastAt ?? 0) || 0), 0);

  const derived = chats
    .filter((c) => latest > 0 && nowMs - (Date.parse(c.lastAt) || 0) < liveWindowMs)
    .map((c) => c.id);

  return {
    calls: kind?.calls ?? 0,
    subagentCalls: kind?.subagentCalls ?? 0,
    // Calls that named no path at all, so no worktree can be named for them.
    // Carried on the record rather than dropped: a count that silently omits them
    // reads as a complete answer.
    unlocatedCalls: kind?.unlocatedCalls ?? 0,
    chatCount: chats.length,
    chats,
    lastAt: iso(latest),
    lastAtMs: latest || null,
    lastChatId: chats[0]?.id ?? null,
    activeNow: suppressed ? false : derived.length > 0,
    currentChatIds: suppressed ? [] : derived,
    derivedChatIds: derived,
    suppressed,
  };
}

/** The write history for one worktree. PERMANENT; never subject to a release. */
export function summariseWrites(kind, { nowMs, liveWindowMs, suppressed = false } = {}) {
  return summariseKind(kind, { nowMs, liveWindowMs, suppressed });
}

/**
 * The read history for one worktree, subject to a release watermark.
 *
 * A release drops readers whose last read predates `releasedBeforeMs` and keeps
 * every later one. The watermark only ever moves FORWARD, so a release is
 * permanent and needs no record of which entries it removed — which is the whole
 * reason readers live in their own structure.
 */
export function summariseReads(kind, { nowMs, liveWindowMs, releasedBeforeMs = 0 } = {}) {
  const s = summariseKind(kind, { nowMs, liveWindowMs, releasedBeforeMs });
  return { ...s, releasedBefore: iso(releasedBeforeMs) || null };
}

/** Shell calls run with a workdir here. Not a claim that anything was written. */
export function summariseShell(kind, { nowMs, liveWindowMs } = {}) {
  const s = summariseKind(kind, { nowMs, liveWindowMs });
  return { ...s, writeCapableCalls: s.calls };
}

export function emptyWriteHistory({ nowMs, liveWindowMs, suppressed = false } = {}) {
  return summariseWrites(null, { nowMs, liveWindowMs, suppressed });
}
export function emptyReadHistory({ nowMs, liveWindowMs, releasedBeforeMs = 0 } = {}) {
  return summariseReads(null, { nowMs, liveWindowMs, releasedBeforeMs });
}
export function emptyShellHistory({ nowMs, liveWindowMs } = {}) {
  return summariseShell(null, { nowMs, liveWindowMs });
}

const emptyResult = (dbPath) => ({
  available: false,
  dbPath,
  byWorktree: new Map(),
  goneWorktrees: [],
  totalWriteCalls: 0,
  attributedWriteCalls: 0,
  totalReadCalls: 0,
  totalShellCalls: 0,
  unmapped: { write: 0, read: 0, shell: 0 },
  unmappedBuckets: [],
});

/**
 * Read every call this machine has made against these paths and attribute it to a
 * directory.
 *
 * Returns the same `available: false` shape the other readers use when the
 * database is missing, so a machine with no Kilo history still gets a complete
 * inventory with an empty history on every worktree and a `dataSources` entry
 * saying why.
 */
export function auditWrites({ dbPath, root, worktreePaths = [], nowMs, liveWindowMs }) {
  const db = openDb(dbPath);
  if (!db) return emptyResult(dbPath);

  try {
    const byId = readSessions(db);
    const calls = readCalls(db, [...byId.keys()]);
    const index = buildPathIndex(root, worktreePaths);
    const { records, unmapped, unmappedByBucket } = buildCallRecords(calls, { root, index, byId });

    const goneWorktrees = [...records.entries()]
      .filter(([key]) => key.startsWith('gone:'))
      .map(([key, r]) => {
        const w = summariseWrites(r.write, { nowMs, liveWindowMs });
        const rd = summariseReads(r.read, { nowMs, liveWindowMs });
        return {
          name: key.slice('gone:'.length),
          writeCalls: w.calls,
          chatCount: w.chatCount,
          chatIds: w.chats.map((c) => c.id),
          lastWriteAt: w.lastAt,
          readCalls: rd.calls,
          readerChatIds: rd.chats.map((c) => c.id),
        };
      })
      .sort((a, b) => b.writeCalls - a.writeCalls);

    const sum = (kind) => [...records.values()].reduce((n, r) => n + r[kind].calls, 0);
    const attributedWriteCalls = sum('write');
    const result = {
      available: true,
      dbPath,
      byWorktree: records,
      goneWorktrees,
      attributedWriteCalls,
      totalWriteCalls: attributedWriteCalls + unmapped.write,
      totalReadCalls: sum('read') + unmapped.read,
      totalShellCalls: sum('shell') + unmapped.shell,
      unmapped,
      unmappedBuckets: [...unmappedByBucket.entries()]
        .map(([bucket, calls]) => ({ bucket, calls }))
        .sort((a, b) => b.calls - a.calls),
    };

    return result;
  } finally {
    db.close();
  }
}
