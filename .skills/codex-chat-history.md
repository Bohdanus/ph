---
name: codex-chat-history
description: Locate and query OpenAI Codex CLI session history from local SQLite state database and JSONL rollout files. Read-only, local-first.
---

# Codex Chat History

Use this skill to find, search, summarize, or export historical OpenAI Codex CLI conversation sessions. Do not authenticate to OpenAI or access remote hosts unless explicitly authorized.

## Safety

- Open every database read-only with `sqlite3 -readonly`; never run `INSERT`, `UPDATE`, `DELETE`, `VACUUM`, migrations, or repair commands during a search.
- Codex databases use WAL mode. If a writer (Codex daemon) is active, query the live database read-only or stop the writer before making a forensic copy. A copy must include the `.sqlite`, `.sqlite-wal`, and `.sqlite-shm` files together.
- Treat transcripts as sensitive. Redact tokens, API keys, credentials, connection strings, private URLs, and secrets before showing or exporting results.
- Search only the documented `~/.codex` (or `$CODEX_HOME`) root and workspace paths relevant to the request. Do not scan an entire home directory by default.

## Discover the Stores

### Current State Database (SQLite)

Codex CLI maintains a SQLite metadata index indexed from rollout files. The database filename includes a version suffix (e.g., `state_5.sqlite`); the suffix increments when the schema changes:

```
macOS / Linux:  ~/.codex/state_N.sqlite   (or $CODEX_HOME/state_N.sqlite)
Windows:        %USERPROFILE%\.codex\state_N.sqlite
```

Companion WAL files: `state_N.sqlite-wal`, `state_N.sqlite-shm`.

Inspect schema first — the store is versioned and columns change between releases:

```bash
codex_db="$(printf '%s/state_5.sqlite' "${CODEX_HOME:-$HOME/.codex}")"
sqlite3 -readonly "$codex_db" ".tables"
sqlite3 -readonly "$codex_db" ".schema"
```

### Observed Schema (current as of Codex CLI 0.163+)

The state database contains these tables (built incrementally by migrations; exact columns vary by version):

- `threads` — one row per session (thread). Key columns: `id` (UUID), `rollout_path` (relative to `$CODEX_HOME`), `created_at`, `updated_at`, `recency_at` (epoch seconds), `created_at_ms`, `updated_at_ms`, `recency_at_ms` (epoch milliseconds), `source` (e.g. `cli`, `vscode`, `atlas`, `chatgpt`), `originator`, `creator_user_id`, `creator_account_id`, `model_provider`, `model`, `reasoning_effort`, `cwd`, `title`, `name`, `preview`, `cli_version`, `tokens_used`, `first_user_message`, `has_user_event` (0/1), `sandbox_policy`, `approval_mode`, `archived` (0/1), `archived_at`, `git_sha`, `git_branch`, `git_origin_url`, `memory_mode`, `history_mode` (`legacy` or `paginated`), `agent_nickname`, `agent_path`, `agent_role`, `thread_source`, `project_id`, `daybreak_enabled`, `thread_section_id` (FK to `thread_sections`), `section_position`, `section_entered_at_ms`
- `thread_spawn_edges` — parent/child relationships between forked/sub-agent threads: `parent_thread_id`, `child_thread_id`, `status`
- `thread_sections` — named groupings (e.g. Pinned): `id`, `name`, `appearance`
- `projects` — workspace project groupings: `id`, `name`, `metadata`, `position`, `created_at_ms`, `updated_at_ms`
- `project_roots` — project directory roots: `project_id` (FK), `position`, `path`
- `logs` — diagnostic event log: `ts`, `ts_nanos`, `level`, `target`, `message`, `module_path`, `file`, `line`, `thread_id`, `process_uuid`, `estimated_bytes`
- `stage1_outputs` — memory extraction intermediate results: `thread_id`, `source_updated_at`, `raw_memory`, `rollout_summary`, `generated_at`, `rollout_slug`, `usage_count`, `last_usage`, `selected_for_phase2`, `selected_for_phase2_source_updated_at`
- `backfill_state` — single-row table tracking SQLite index backfill status: `status`, `last_watermark`, `last_success_at`, `updated_at`
- `jobs` — background job ledger: `kind`, `job_key`, `status`, `worker_id`, `ownership_token`, `started_at`, `finished_at`, `lease_until`, `retry_at`, `retry_remaining`
- `agent_jobs` / `agent_job_items` — task-based agent job tracking
- `thread_dynamic_tools` — per-thread custom tool definitions

**Important caveats** (verified from source at commit `e4568a35`):

- `backfill_state.status` must read `complete` before relying on the index. If `pending` or `running`, the SQLite index is incomplete — fall back to scanning rollout files.
- `rollout_path` is relative to `$CODEX_HOME`. Prefix with `$CODEX_HOME` to get the absolute filesystem path.
- `threads.preview` and `threads.title` are extracted from the first user message (or thread goal) and may be empty for sessions with no user input.
- `threads.archived` uses integer 0/1, not SQLite booleans.
- `threads.history_mode` can be `legacy` (old format) or `paginated` (new format). Paginated is a one-way promotion.
- Sub-agent sessions have `source` containing `{"subagent":{...}}` JSON. Forked sessions have `forked_from_id` in the rollout's `SessionMeta` payload but the SQLite row only stores the thread's own metadata.
- The database file suffix (`state_5`) means the version may shift on schema upgrades — the old file may still contain data from a prior index.

### Rollout JSONL Files

Rollout files are the source of truth — the full conversation transcript, one JSON object per line. Stored under a date-partitioned hierarchy:

```
$CODEX_HOME/
├── sessions/
│   └── YYYY/
│       └── MM/
│           └── DD/
│               ├── rollout-<timestamp>-<thread-id>.jsonl      # plain
│               └── rollout-<timestamp>-<thread-id>.jsonl.zst  # compressed (Zstandard)
├── archived_sessions/
│   └── (same structure as sessions/)
├── session_index.jsonl   # id, thread_name, updated_at — append-only thread names
├── history.jsonl         # session_id, text, ts — your typed prompts only (no replies)
├── state_N.sqlite        # SQLite metadata index
├── state_N.sqlite-wal
├── state_N.sqlite-shm
└── configs/
    └── config.toml       # history.max_bytes limits history.jsonl size
```

Each rollout line has the envelope: `{"timestamp":"...","type":"...","payload":{...}}` (some lines also have `"ordinal":N`).

Line types: `session_meta` (line 1 — session ID, cwd, model, git, CLI version), `turn_context`, `response_item` (model responses, function calls), `event_msg` (user/agent messages, token counts, task start/end), `compacted` (history compaction summaries), `token_usage_record` (newer bookkeeping).

Search `event_msg` payload types: `user_message`, `agent_message`, `token_count`, `task_started`, `task_complete`, `turn_complete`, `item_completed`, `thread_goal_updated`, `thread_settings_applied`.

Tool calls and their outputs share a `call_id` across separate lines (`function_call` / `function_call_output`), not nested.

### Legacy / Alternative Stores

- `$CODEX_HOME/archived_sessions/YYYY/MM/DD/` — old archive path (pre-v0.136). Use `codex unarchive` to restore.
- `$CODEX_HOME/session_index.jsonl` — append-only thread-name mapping; scan from end to find newest name for a thread ID.
- `$CODEX_HOME/history.jsonl` — your prompts only; not useful for full transcripts.

### Cross-Platform Paths

| Platform   | `$CODEX_HOME` default       |
| ---------- | --------------------------- |
| macOS      | `~/.codex`                  |
| Linux      | `~/.codex`                  |
| Windows    | `%USERPROFILE%\.codex`      |
| Remote SSH | `~/.codex` (on remote host) |

If `CODEX_HOME` is set, use that instead. VS Code extension may use a different data root — check the extension's output directory.

## Query the SQLite State Database

Always check backfill state first:

```bash
sqlite3 -readonly "$codex_db" "SELECT status FROM backfill_state WHERE id = 1;"
```

If not `complete`, use the file-scan methods below instead of relying on the index.

### List Recent Sessions

```sql
SELECT
  id,
  cwd,
  title,
  preview,
  name,
  model,
  model_provider,
  reasoning_effort,
  cli_version,
  git_branch,
  git_sha,
  tokens_used,
  datetime(created_at, 'unixepoch') AS created,
  datetime(updated_at, 'unixepoch') AS updated,
  archived,
  CASE WHEN archived = 1 THEN datetime(archived_at, 'unixepoch') END AS archived_at
FROM threads
WHERE archived = 0
ORDER BY updated_at DESC, id DESC
LIMIT 50;
```

### Search by Title, Preview, or User Message

```sql
SELECT
  id,
  cwd,
  title,
  preview,
  first_user_message,
  model,
  datetime(updated_at, 'unixepoch') AS updated
FROM threads
WHERE archived = 0
  AND (
    instr(lower(coalesce(title, '')), lower('TERM')) > 0
    OR instr(lower(coalesce(preview, '')), lower('TERM')) > 0
    OR instr(lower(coalesce(first_user_message, '')), lower('TERM')) > 0
  )
ORDER BY updated_at DESC, id DESC
LIMIT 50;
```

### Search by Working Directory

```sql
SELECT
  id,
  title,
  preview,
  datetime(updated_at, 'unixepoch') AS updated,
  model
FROM threads
WHERE archived = 0
  AND cwd = 'NORMALIZED_CWD'
ORDER BY updated_at DESC
LIMIT 50;
```

**Note:** `cwd` is normalized (path comparison canonicalization applied). Use `codex` to get the exact path or check existing rows first: `SELECT DISTINCT cwd FROM threads LIMIT 20;`

### Search by Git Branch or Commit

```sql
SELECT
  id,
  cwd,
  title,
  git_branch,
  git_sha,
  git_origin_url,
  datetime(updated_at, 'unixepoch') AS updated
FROM threads
WHERE archived = 0
  AND (
    instr(lower(coalesce(git_branch, '')), lower('TERM')) > 0
    OR instr(lower(coalesce(git_sha, '')), lower('TERM')) > 0
  )
ORDER BY updated_at DESC
LIMIT 50;
```

### Find Forked / Sub-Agent Threads

```sql
SELECT
  e.parent_thread_id,
  t_child.id AS child_id,
  t_child.title,
  t_child.preview,
  e.status,
  datetime(t_child.updated_at, 'unixepoch') AS updated
FROM thread_spawn_edges AS e
JOIN threads AS t_child ON t_child.id = e.child_thread_id
WHERE instr(lower(coalesce(t_child.preview, '')), lower('TERM')) > 0
ORDER BY t_child.updated_at DESC
LIMIT 50;
```

### Search by Model or Provider

```sql
SELECT
  id,
  cwd,
  title,
  model,
  model_provider,
  reasoning_effort,
  datetime(updated_at, 'unixepoch') AS updated,
  tokens_used
FROM threads
WHERE archived = 0
  AND lower(coalesce(model_provider, '')) = lower('PROVIDER')
  AND lower(coalesce(model, '')) = lower('MODEL')
ORDER BY updated_at DESC
LIMIT 50;
```

### List Archived Sessions

```sql
SELECT
  id,
  cwd,
  title,
  preview,
  datetime(updated_at, 'unixepoch') AS updated,
  datetime(archived_at, 'unixepoch') AS archived_at
FROM threads
WHERE archived = 1
ORDER BY archived_at DESC
LIMIT 50;
```

## Search Rollout JSONL Files

When the SQLite index is incomplete, the backfill hasn't completed, or you need full conversation content, search the rollout files directly.

### List Sessions by Rollout File

```bash
find "${CODEX_HOME:-$HOME/.codex}/sessions" -name 'rollout-*.jsonl' |
  sort | tail -n 20 | while IFS= read -r f; do
    head -n 1 "$f" | jq -r '
      [.payload.timestamp, .payload.cwd, .payload.id, .payload.source, .payload.model_provider, .payload.cli_version] | @tsv
    ' | awk -v f="$f" '{print f "\t" $0}'
  done
```

**Note:** The first line is always `session_meta`. The timestamp in the payload uses ISO 8601 UTC, but the filename timestamp uses local time.

### Search All Sessions for Content

Codex has a built-in `/search` (v0.134+) that searches rollout files. For SQL/external search, use `rg` (ripgrep) or `grep` directly:

```bash
rg --fixed-strings --ignore-case --no-ignore --type-add 'rollout:*.jsonl' -t rollout 'TERM' \
  "${CODEX_HOME:-$HOME/.codex}/sessions/"
```

### Extract Prompts from a Single Rollout

```bash
jq -r '
  select(.type == "event_msg") | .payload
  | if .type == "user_message" then .message
    elif .type == "item_completed" and .item.type == "UserMessage"
      then (.item.content[]?.text // empty)
    else empty end
' FILE
```

Codex has recorded user messages in both shapes over time, so the filter checks for each. Reading `response_item` messages with `role` `user` also works, but those include system-injected context.

### Extract Assistant Responses

```bash
jq -r '
  select(.type == "event_msg") | .payload
  | if .type == "agent_message" then .message
    elif .type == "item_completed"
      then (.item | if .type == "AssistantMessage" then (.content[]?.text // empty) else empty end)
    else empty end
' FILE
```

### Extract Tool Calls and Outputs

```bash
jq -r '
  select(.type == "response_item") | .payload
  | if .type == "function_call" then .name
    elif .type == "function_call_output" then ("OUTPUT: " + .output)
    else empty end
' FILE
```

### Search Compressed Rollouts

Codex compresses old rollouts to `.jsonl.zst` (Zstandard). Search and decompress with `zstd`:

```bash
# Search a single compressed rollout
zstd -dc -q FILE.jsonl.zst | rg --fixed-strings --ignore-case 'TERM'

# Decompress for reading
zstd -d FILE.jsonl.zst -o FILE.jsonl
```

### Replay Compressed Rollout for Resume

When resuming a session, Codex transparently materializes (decompresses) a `.jsonl.zst` back to plain `.jsonl` for appending. To do this manually:

```bash
zstd -d FILE.jsonl.zst -o FILE.jsonl
```

## Read or Resume a Session

```bash
# Interactive selector — recent sessions in current directory
codex resume

# Skip the picker, resume most recent session here
codex resume --last

# Resume by thread ID (UUID)
codex resume <thread-id>

# Include sessions from all directories
codex resume --last --all

# Include non-interactive (codex exec) sessions
codex resume --include-non-interactive

# Resume a specific session with a follow-up prompt (headless)
codex exec resume --last "Continue where we left off"
```

Inside a running session:

- `/resume` — open the session picker without exiting
- `/status` — show the session ID
- `/fork` — fork the current session into a new thread
- `/archive` — archive the session (moves to `archived_sessions/`)
- `/search` — search local history (v0.134+)

### Resume from Archived Sessions

If a session was archived:

```bash
codex unarchive <thread-id>
codex resume <thread-id>
```

The `thread_id` is the UUID from the `id` column in the `threads` table or the filename of the rollout file.

## Locate Files for a Session

### Locate the State Database

The state database filename includes a version suffix that increments on schema changes. Find the latest:

```bash
ls -1t "${CODEX_HOME:-$HOME/.codex}"/state_*.sqlite 2>/dev/null | head -1
```

### Locate Rollout Files for a Thread ID

```bash
# From the SQLite index
sqlite3 -readonly "$codex_db" "SELECT rollout_path FROM threads WHERE id = 'THREAD_ID';"

# Or search the filesystem directly
find "${CODEX_HOME:-$HOME/.codex}/sessions" -name 'rollout-*-THREAD_ID.jsonl*' -o \
  -name 'rollout-*-THREAD_ID_*.jsonl*' 2>/dev/null
```

### Read a Thread Name from the Session Index

```bash
# session_index.jsonl is append-only; scan from the end for the newest entry
python3 -c "
import sys
path = '${CODEX_HOME:-$HOME/.codex}/session_index.jsonl'
name = None
for line in reversed(open(path)):
    import json
    entry = json.loads(line)
    if entry.get('id') == 'THREAD_ID':
        name = entry.get('thread_name')
        break
print(name or '')
"
```

## Report Results

For each relevant result, report:

- Source: State DB (SQLite), Rollout JSONL, Compressed rollout (`.zst`), or Session index (`session_index.jsonl`)
- Session ID (thread UUID), title/preview, working directory (cwd), model, and date
- The matching user/assistant text or a concise excerpt
- Whether the result came from the SQLite `threads` table, a replayed rollout file, or the session index
- If from a compressed rollout, note it was decompressed for reading
- Any ambiguity, missing backfill state, stale workspace hash, or unreadable/corrupt record
- Whether the session is archived (check `threads.archived`)

Do not dump entire databases or unrelated sessions. If a session is missing from the UI but its files remain on disk, check `session_index.jsonl` for name mappings and the `archived_sessions/` directory before concluding that it was deleted.

**Key diagnostic:** If the state database has no sessions for a thread ID you know existed, check:

1. The `backfill_state.status` — if not `complete`, the SQLite index is incomplete; fall back to scanning rollout files
2. Whether the session was archived (`archived = 1` in `threads` table)
3. Whether the rollout file exists on disk but was not indexed
4. Whether `CODEX_HOME` points to a different directory than expected
5. Whether the session was a sub-agent (check `thread_spawn_edges` and `source` JSON)

## Rollout Line Type Reference

| Type                 | First line? | Payload keys                                                                                       | Notes                                      |
| -------------------- | ----------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `session_meta`       | Yes         | `session_id`, `id`, `cwd`, `model_provider`, `cli_version`, `source`                               | First line always; `id` is the thread UUID |
| `turn_context`       | No          | `cwd`, `model`, `approval_policy`, `sandbox_policy`, `permission_profile`                          | Per-turn config snapshot                   |
| `response_item`      | No          | `type` (`Message`, `FunctionCall`, `FunctionCallOutput`), `call_id`, `name`, `arguments`, `output` | Tool calls/outputs paired by `call_id`     |
| `event_msg`          | No          | `type` (`user_message`, `agent_message`, `token_count`, `item_completed`, etc.), `message`, `info` | Conversation text lives here               |
| `compacted`          | No          | summary data from `/compact`                                                                       | History compaction summary                 |
| `token_usage_record` | No          | token counts                                                                                       | Newer bookkeeping format                   |

## References

- Codex CLI documentation: https://developers.openai.com/codex/cli
- Codex CLI session persistence (DeepWiki): https://deepwiki.com/openai/codex/3.5.2-rollout-persistence-and-replay
- Codex CLI session resumption (DeepWiki): https://deepwiki.com/openai/codex/4.4-session-resumption-and-forking
- Rollout persistence source: https://github.com/openai/codex/tree/main/codex-rs/rollout/src
- State DB migrations: https://github.com/openai/codex/tree/main/codex-rs/state/migrations
- Session index source: https://github.com/openai/codex/blob/main/codex-rs/rollout/src/session_index.rs
- Rollout search source: https://github.com/openai/codex/blob/main/codex-rs/rollout/src/search.rs
- `threads.rs` schema columns: https://github.com/openai/codex/blob/main/codex-rs/state/src/runtime/threads.rs
- `extract.rs` metadata extraction: https://github.com/openai/codex/blob/main/codex-rs/state/src/extract.rs
- Rollout filename parsing: https://github.com/openai/codex/blob/main/codex-rs/rollout/src/rollout_file_name.rs
