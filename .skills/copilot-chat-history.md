---
name: copilot-chat-history
description: Locate and query GitHub Copilot Chat sessions from Chronicle SQLite and JSONL stores. Read-only, local-first.
---

# Copilot Chat History

Use this skill to find, search, summarize, or export historical GitHub Copilot Chat conversations. Do not authenticate to GitHub or access remote hosts unless explicitly authorized.

## Safety

- Open every database read-only with `sqlite3 -readonly`; never run `INSERT`, `UPDATE`, `DELETE`, `VACUUM`, migrations, or repair commands during a search.
- Copilot databases may use WAL. If a writer is active, query the live database read-only or stop the writer before making a forensic copy. A copy must include the `.db`, `.db-wal`, and `.db-shm` files together.
- Treat transcripts as sensitive. Redact tokens, API keys, credentials, connection strings, private URLs, and secrets before showing or exporting results.
- Search only the documented user-data roots and the workspace roots relevant to the request. Do not scan an entire home directory by default.
- `state.vscdb` and session indexes are routing metadata. Prefer the normalized session database or transcript files for conversation content.

## Critical: What Chronicle Tracks (and What It Doesn't)

**Chronicle (`session-store.db`) ONLY tracks VS Code Copilot Chat sessions** — sessions started inside VS Code with the GitHub Copilot Chat extension active. It does NOT track:

- Kilo/kilocode sessions (separate SQLite at `~/.local/share/kilo/kilo.db`)
- Sessions from other AI coding agents (Cursor, Windsurf, etc.)
- VS Code sessions where Copilot Chat was not opened

Always verify the workspace has Chronicle entries before assuming a session exists there.

## Discover the Stores

### Current Chronicle Store (SQLite) — v0.35+ (Agent Sessions Integrated)

The current Copilot Chat extension uses a normalized SQLite store with FTS5:

```
VS Code stable:
  macOS:   ~/Library/Application Support/Code/User/globalStorage/github.copilot-chat/session-store.db
  Linux:   ~/.config/Code/User/globalStorage/github.copilot-chat/session-store.db
  Windows: %APPDATA%\Code\User\globalStorage\github.copilot-chat\session-store.db

VS Code Remote SSH:
  ~/.vscode-server/data/User/globalStorage/github.copilot-chat/session-store.db
```

Also check `Code - Insiders`, VSCodium, and user-data-profile variants by replacing `Code/User` with the applicable product/profile path.

**Always inspect schema first** — the store is versioned and columns change:

```bash
copilot_db="~/Library/Application Support/Code/User/globalStorage/github.copilot-chat/session-store.db"
sqlite3 -readonly "$copilot_db" ".tables"
sqlite3 -readonly "$copilot_db" ".schema"
```

Observed schema includes (varies by version):

- `sessions` — metadata: `id`, `cwd`, `repository`, `host_type`, `branch`, `summary` (raw JSON), `agent_name`, `agent_description`, `created_at`, `updated_at`
- `turns` — conversation turns: `id`, `session_id`, `turn_index`, `user_message`, `assistant_response`, `timestamp`
- `session_files` — files touched per session
- `session_refs` — external references (PRs, issues, commits)
- `checkpoints` — compaction checkpoints with sections
- `search_index` — FTS5 virtual table: `content`, `session_id`, `source_type`, `source_id`
- `schema_version` — single-row table with version integer

**Important caveats** (tracked in VS Code issue #312292):

- `sessions.cwd`, `sessions.agent_name`, `sessions.agent_description` are often empty strings locally
- `sessions.summary` contains raw JSON blobs, not plain text
- `turns.assistant_response` is frequently empty; prefer `turns.user_message` + FTS5 `search_index`
- `session_files` and `session_refs` are often empty
- **FTS5 `search_index` coverage is incomplete** — observed as low as 45 rows across 19 sessions; many sessions have zero indexed content
- `agent_name` distinguishes "GitHub Copilot Chat" vs agent sessions (e.g., "GitHub Copilot Agent")

### Chronicle Commands (preferred query surface)

Before raw SQLite inspection, prefer Chronicle commands in the chat input:

| Command                     | Description                                                                     |
| --------------------------- | ------------------------------------------------------------------------------- |
| `/chronicle:search <query>` | Search sessions by keyword, file path, or PR/issue reference                    |
| `/chronicle:standup`        | Summarize recent coding sessions into a standup report (last 24h default)       |
| `/chronicle:tips`           | Analyze recent session history and suggest ways to use Copilot more effectively |
| `/chronicle:cost-tips`      | Identify opportunities to reduce token usage and Copilot cost                   |
| `/chronicle:reindex`        | Rebuild the local session index and sync session data to your account           |

Relevant settings:

- `github.copilot.chat.localIndex.enabled` (default `true`) — enable local session tracking (prerequisite for sync)
- `chat.sessionSync.enabled` (default `true`) — sync sessions to GitHub account
- `chat.sessionSync.excludeRepositories` — repository patterns to exclude from sync

### File Stores (fallback when Chronicle DB absent/incomplete)

**Priority order — check each until you find content:**

1. **Extension Transcripts (BEST — readable event stream)**  
   `<User>/globalStorage/github.copilot-chat/transcripts/*.jsonl`  
   Newer event-stream format written at the user-global level (not per-workspace). Events: `session.start`, `user.message`, `assistant.message`, `tool.execution_start`, `tool.execution_complete`, `assistant.turn_start`, `assistant.turn_end`. The `data` object contains content.
   **Known issue:** Many extensions and tools don't read this format — it may be silently ignored by older tooling.

2. **chatSessions Delta Journals (append-only, must replay)**  
   `<User>/workspaceStorage/<hash>/chatSessions/*.jsonl`  
   **Format:** `kind: 0` (root), `kind: 1` (set), `kind: 2` (append), `kind: 3` (delete).  
   **Known issue (VS Code #295813, Feb 2026, Copilot Chat v0.37.6):** Often persist only `kind: 0` with empty `requests: []` — subsequent conversation turns are NOT written to disk. Check the last `kind: 0` entry's `requests.length` before assuming content exists.

3. **Legacy/Other**  
   `<User>/globalStorage/emptyWindowChatSessions/*.jsonl`  
   `<User>/globalStorage/transferredChatSessions/*.json`  
   `<User>/workspaceStorage/<hash>/chatEditingSessions/<sessionId>/contents/` — edit operations, not conversation

`<User>` = `~/Library/Application Support/Code/User` (macOS), `~/.config/Code/User` (Linux), `%APPDATA%\Code\User` (Windows).  
**Always read `workspace.json` first** to map hash → folder: `{"folder": "file:///path/to/repo"}`.  
**Known session-loss issues:**

- **VS Code #298602 (March 2026):** After VS Code/Copilot Chat updates, recent sessions may vanish from `globalStorage/github.copilot-chat` entirely. Check `state.vscdb` for orphaned session indexes.
- **VS Code #305818 (March 2026):** Renamed/moved workspaces generate a new `workspaceStorage/<hash>`, orphaning prior sessions. The old hash's `chatSessions/` files (and any older `GitHub.copilot-chat/transcripts/` under that hash) remain readable on disk.

## Query Chronicle SQLite

### List Sessions

```sql
SELECT
  id,
  cwd,
  repository,
  branch,
  agent_name,
  summary,
  created_at,
  updated_at
FROM sessions
ORDER BY updated_at DESC
LIMIT 50;
```

Search metadata with a parameterized `LIKE` or `instr(lower(...), lower(?))` predicate. Include `cwd`, `repository`, `branch`, `agent_name`, and `summary` (note: often empty or JSON). Filter by `agent_name = 'GitHub Copilot Chat'` to exclude agent sessions.

### Search Conversation Turns (basic)

```sql
SELECT
  s.id AS session_id,
  s.cwd,
  s.repository,
  s.branch,
  t.turn_index,
  t.user_message,
  t.assistant_response,
  t.timestamp
FROM sessions AS s
JOIN turns AS t ON t.session_id = s.id
WHERE instr(
  lower(coalesce(t.user_message, '') || ' ' || coalesce(t.assistant_response, '')),
  lower('TERM')
) > 0
ORDER BY s.updated_at DESC, t.turn_index;
```

**Note:** `assistant_response` is often empty. Prefer the FTS5 search below, but be aware of its limited coverage.

### Full-Text Search via FTS5 (use with caution — incomplete coverage)

```sql
SELECT
  s.id AS session_id,
  s.cwd,
  s.repository,
  s.branch,
  si.content,
  si.source_type,
  si.source_id,
  bm25(search_index) AS rank
FROM search_index AS si
JOIN sessions AS s ON s.id = si.session_id
WHERE search_index MATCH 'TERM'
ORDER BY rank
LIMIT 20;
```

The `search_index` table indexes: turn content (`source_type='turn'`), checkpoint sections (`checkpoint_overview`, `checkpoint_history`, `checkpoint_work_done`, `checkpoint_technical`, `checkpoint_files`, `checkpoint_next_steps`), and workspace artifacts (`source_type='workspace_artifact'`).

**Verified limitation:** FTS5 may index only a fraction of sessions. In testing, 19 sessions yielded only 45 indexed rows. Always cross-check with `turns` table if FTS5 returns no results.

### Search Files and References

```sql
SELECT
  s.id AS session_id,
  s.cwd,
  s.repository,
  f.file_path,
  f.tool_name,
  f.turn_index,
  f.first_seen_at
FROM sessions AS s
JOIN session_files AS f ON f.session_id = s.id
WHERE instr(lower(coalesce(f.file_path, '')), lower('TERM')) > 0
ORDER BY s.updated_at DESC, f.first_seen_at DESC;
```

```sql
SELECT
  s.id AS session_id,
  s.cwd,
  s.repository,
  r.ref_type,
  r.ref_value,
  r.turn_index
FROM sessions AS s
JOIN session_refs AS r ON r.session_id = s.id
WHERE instr(lower(coalesce(r.ref_value, '')), lower('TERM')) > 0
ORDER BY s.updated_at DESC;
```

Inspect `.schema session_refs` and `.schema checkpoints` before querying those tables because their fields can change between Copilot extension versions.

## Replay Copilot JSONL Journals

Use this read-only parser when `session-store.db` is absent, incomplete, or older than the available journals. It replays the `kind` operations and prints only matching turns. Set `TERM` to the search phrase and pass one journal path at a time.

```bash
term='TERM'
python3 - "/path/to/session.jsonl" "$term" <<'PY'
import json
import pathlib
import sys
from copy import deepcopy

path = pathlib.Path(sys.argv[1])
term = sys.argv[2].casefold()

def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from strings(child)

def parent(root, keys, create=False):
    current = root
    for key in keys[:-1]:
        if isinstance(current, dict):
            if create and key not in current:
                current[key] = {}
            current = current.get(key)
        elif isinstance(current, list):
            try:
                index = int(key)
            except (TypeError, ValueError):
                return None, None
            if create:
                while len(current) <= index:
                    current.append({})
            if index >= len(current):
                return None, None
            current = current[index]
        else:
            return None, None
        if current is None:
            return None, None
    return current, keys[-1] if keys else None

def apply(root, entry):
    kind = entry.get("kind")
    keys = entry.get("k", [])
    if isinstance(keys, str):
        keys = [keys]
    value = entry.get("v")
    if kind == 0:
        return deepcopy(value) if isinstance(value, dict) else root
    if not keys:
        return root
    current, key = parent(root, keys, kind in (1, 2))
    if current is None or key is None:
        return root
    if kind == 1:
        if isinstance(current, dict):
            current[key] = deepcopy(value)
        elif isinstance(current, list):
            try:
                current[int(key)] = deepcopy(value)
            except (TypeError, ValueError, IndexError):
                pass
    elif kind == 2:
        if isinstance(current, dict):
            old = current.get(key)
            current[key] = (old if isinstance(old, list) else []) + [deepcopy(value)]
        elif isinstance(current, list):
            try:
                current[int(key)].append(deepcopy(value))
            except (TypeError, ValueError, IndexError):
                pass
    elif kind == 3:
        if isinstance(current, dict):
            current.pop(key, None)
        elif isinstance(current, list):
            try:
                current.pop(int(key))
            except (TypeError, ValueError, IndexError):
                pass
    return root

state = {}
for line in path.read_text(encoding="utf-8-sig").splitlines():
    if not line.strip():
        continue
    try:
        state = apply(state, json.loads(line))
    except json.JSONDecodeError:
        continue

requests = state.get("requests", []) if isinstance(state, dict) else []
if not isinstance(requests, list):
    requests = []
for index, request in enumerate(requests):
    if not isinstance(request, dict):
        continue
    text = "\n".join(
        chunk
        for field in ("message", "response")
        for chunk in strings(request.get(field))
    )
    if term and term not in text.casefold():
        continue
    print(json.dumps({
        "file": str(path),
        "session_id": state.get("sessionId") or path.stem,
        "title": state.get("customTitle") or state.get("title") or state.get("label") or "",
        "created": state.get("creationDate"),
        "turn": index,
        "text": text,
    }, ensure_ascii=False))
PY
```

**Watch for:** `requests: []` — the delta journal recorded a session start but no conversation turns. This is common; the transcript store in `globalStorage/github.copilot-chat/transcripts/` is more reliable.

### Replay Extension Transcript JSONL (preferred — readable events)

For extension transcripts (`<globalStorage>/github.copilot-chat/transcripts/*.jsonl`), search the event payload:

```bash
jq -R -r --arg q 'TERM' '
  select(ascii_downcase | contains($q | ascii_downcase))
' "/path/to/transcript.jsonl"
```

Event types: `session.start`, `user.message`, `assistant.message`, `assistant.turn_start`, `assistant.turn_end`, `tool.execution_start`, `tool.execution_complete`. Extract `data.content`, `data.toolRequests`, etc. For structured extraction, use a Python script filtering by `type`.

## Report Results

For each relevant result, report:

- Source: Copilot Chronicle DB, Copilot JSONL (delta journal), or Copilot transcript
- Session ID, title or summary, workspace/cwd, repository, branch, and date
- The matching user/assistant text or a concise summary
- Whether the result came from a normalized table, FTS5, a replayed journal, or a transcript
- Any ambiguity, missing transcript, stale workspace hash, or unreadable/corrupt record
- **Chronicle-specific:** note if `agent_name` indicates a Copilot Agent session vs regular Chat, and whether FTS5 had coverage for that session

Do not dump entire databases or unrelated sessions. If a session is missing from the UI but its files remain on disk, search orphaned `workspaceStorage` hashes and legacy stores before concluding that it was deleted.

**Key diagnostic:** If Chronicle has no sessions for a workspace you know had Copilot Chat activity, check:

1. `globalStorage/github.copilot-chat/transcripts/` — newer event-stream format, may have content Chronicle missed
2. `workspaceStorage/<hash>/chatSessions/` — replay delta journal, but watch for empty `requests`
3. Whether the workspace was opened in a different VS Code profile/window (different hash)
4. Whether the user used a different tool (Kilo, Cursor, etc.) — Chronicle only tracks VS Code Copilot Chat
5. If sessions vanished after an update: check `state.vscdb` for orphaned session indexes (VS Code #298602)

## References

- VS Code session history and Chronicle: https://code.visualstudio.com/docs/agents/run/sessions/session-history
- VS Code chat-session storage implementation: https://github.com/microsoft/vscode/blob/main/extensions/copilot/src/platform/chronicle/node/sessionStore.ts
- Copilot transcript writer: https://github.com/microsoft/vscode/blob/main/extensions/copilot/src/extension/chat/vscode-node/sessionTranscriptService.ts
- Engram (VS Code Copilot Chat indexer): https://github.com/aasis21/engram
