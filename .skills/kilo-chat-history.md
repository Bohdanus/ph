---
name: kilo-chat-history
description: Locate and query Kilo chat sessions from local SQLite database and legacy JSON stores. Read-only, local-first.
---

# Kilo Chat History

Use this skill to find, search, summarize, resume, or export historical Kilo conversations. Do not authenticate to cloud services or access remote hosts unless explicitly authorized.

## Safety

- Open every database read-only with `sqlite3 -readonly`; never run `INSERT`, `UPDATE`, `DELETE`, `VACUUM`, migrations, or repair commands during a search.
- Kilo databases may use WAL. If a writer is active, query the live database read-only or stop the writer before making a forensic copy. A copy must include the `.db`, `.db-wal`, and `.db-shm` files together.
- Treat transcripts as sensitive. Redact tokens, API keys, credentials, connection strings, private URLs, and secrets before showing or exporting results.
- Search only the documented user-data roots and the workspace roots relevant to the request. Do not scan an entire home directory by default.

## Discover the Store

### Current Store

Use the selected database path first:

```bash
kilo db path
```

Set local variable for examples:

```bash
kilo_db=$(kilo db path 2>/dev/null || printf '%s\n' "${XDG_DATA_HOME:-$HOME/.local/share}/kilo/kilo.db")
```

Fallbacks, in order:

```
"${XDG_DATA_HOME:-$HOME/.local/share}/kilo/kilo.db"
"$HOME/.local/share/kilo/kilo.db"
```

Run the lookup on the machine where Kilo runs. For VS Code Remote SSH, run it on the remote host. `KILO_DB`, `XDG_DATA_HOME`, development channels, and isolated environments can change the path.

Inspect the schema before relying on column names because the store is versioned:

```bash
sqlite3 -readonly "$kilo_db" ".tables"
sqlite3 -readonly "$kilo_db" ".schema session" ".schema message" ".schema part" ".schema session_message" ".schema session_input" ".schema todo"
```

### Current Schema (observed locally, compatible with source at commit 0f55066d)

The local database contains these tables:

- `session` — session metadata including `agent`, `model`, `title`, `directory`, `time_created`, `time_updated`
- `message` — one row per message, `data` JSON column
- `part` — one row per message part, `data` JSON column
- `session_message` — projected session events (type, seq, data JSON)
- `session_input` — user prompts with `prompt`, `delivery`, `admitted_seq`, `promoted_seq`
- `todo` — per-session todo items
- `permission` — project permissions
- `project` — project metadata

The source at commit `0f55066d` defines `SessionTable`, `MessageTable`, `PartTable`, `SessionMessageTable`, `TodoTable`, `PermissionTable`. The local installation also has `session_input` (added by migration `20260622202450_simplify_session_input`). Always run `.tables` and `.schema` to confirm.

### Legacy Stores

Older Kilo Code/Roo-derived extension sessions may exist as one directory per task:

```
VS Code stable:
  macOS:   ~/Library/Application Support/Code/User/globalStorage/kilocode.kilo-code/tasks/
  Linux:   ~/.config/Code/User/globalStorage/kilocode.kilo-code/tasks/
  Windows: %APPDATA%\Code\User\globalStorage\kilocode.kilo-code\tasks\

VS Code Remote SSH:
  ~/.vscode-server/data/User/globalStorage/kilocode.kilo-code/tasks/

Legacy CLI:
  ~/.kilocode/cli/global/tasks/
  ~/.kilocode/cli/workspaces/
```

A task directory can contain `api_conversation_history.json`, `ui_messages.json`, `history_item.json`, and/or `task_metadata.json`. The API history is the most useful transcript source. `history_item.json` or `task_metadata.json` supplies title, timestamp, and workspace metadata when present.

## Query Current Database

### List Recent Sessions

```sql
SELECT
  id,
  title,
  directory,
  agent,
  json_extract(model, '$.id') AS model_id,
  datetime(time_created / 1000, 'unixepoch') AS created,
  datetime(time_updated / 1000, 'unixepoch') AS updated
FROM session
ORDER BY time_updated DESC
LIMIT 50;
```

Use `kilo session list --all --search <title>` for title search across local workspaces. That command searches titles, not message content.

### Search Text Content

Use a parameterized SQL client when possible. For a quick read-only SQLite query, escape single quotes by doubling them and substitute the term in both `lower(...)` calls:

```sql
SELECT
  s.id AS session_id,
  s.title,
  s.directory,
  datetime(s.time_updated / 1000, 'unixepoch') AS updated,
  json_extract(m.data, '$.role') AS role,
  json_extract(p.data, '$.text') AS text
FROM session AS s
JOIN message AS m ON m.session_id = s.id
JOIN part AS p ON p.message_id = m.id
WHERE json_valid(p.data)
  AND json_extract(p.data, '$.type') = 'text'
  AND coalesce(json_extract(p.data, '$.synthetic'), 0) = 0
  AND coalesce(json_extract(p.data, '$.ignored'), 0) = 0
  AND instr(
    lower(coalesce(json_extract(p.data, '$.text'), '')),
    lower('TERM')
  ) > 0
ORDER BY s.time_updated DESC, m.time_created, p.time_created;
```

If the text-part query finds nothing, broaden only as needed to `session_input.prompt`, file parts, and tool-error parts. File parts can expose `filename`, `url`, `source.path`, or `source.name`; tool parts can expose `state.error`. Do not include successful tool output unless the user asks for it.

### Read Session via session_message (chronological projected events)

```sql
SELECT
  type,
  seq,
  datetime(time_created / 1000, 'unixepoch') AS created,
  data
FROM session_message
WHERE session_id = 'SESSION_ID'
ORDER BY seq;
```

### Search session_input Prompts

```sql
SELECT
  prompt,
  delivery,
  admitted_seq,
  datetime(time_created / 1000, 'unixepoch') AS created
FROM session_input
WHERE session_id = 'SESSION_ID'
  AND instr(lower(prompt), lower('TERM')) > 0
ORDER BY admitted_seq;
```

## Read or Resume a Selected Session

```bash
kilo --session <session-id>
kilo run --session <session-id> "Summarize where we stopped"
kilo export <session-id>
```

Use `kilo export --sanitize` when exporting data that may contain secrets. Do not write an export file unless the user asks for an export.

## Search Legacy JSON

First inspect metadata without dumping the transcript:

```bash
jq '{id, ts, task, workspace, workspacePath, model}' \
  history_item.json task_metadata.json 2>/dev/null
```

Search the API history for a term and print only matching turns:

```bash
jq -r --arg q 'TERM' '
  .[]?
  | select((.content // "" | tostring | ascii_downcase | contains($q | ascii_downcase)))
  | [.role, (.content // "" | tostring)]
  | @tsv
' api_conversation_history.json
```

`ui_messages.json` uses an event-oriented shape. Search it only when `api_conversation_history.json` is absent or incomplete, and summarize rather than dumping raw events.

## Report Results

For each relevant result, report:

- Source: Kilo current DB or Kilo legacy JSON
- Session ID, title, workspace/directory, agent, model, and date
- The matching user/assistant text or a concise summary
- Whether the result came from a normalized table, a projected event, or a legacy file
- Any ambiguity, missing transcript, or unreadable/corrupt record

Do not dump entire databases or unrelated sessions. If a session is missing from the UI but its files remain on disk, search orphaned legacy stores before concluding that it was deleted.

## References

- Kilo session history and SQLite search: https://kilo.ai/docs/code-with-ai/agents/session-history
- Kilo CLI reference: https://kilo.ai/docs/code-with-ai/platforms/cli-reference
- Kilo session schema source (commit 0f55066d): https://github.com/Kilo-Org/kilocode/blob/0f55066d/packages/opencode/src/session/session.sql.ts
