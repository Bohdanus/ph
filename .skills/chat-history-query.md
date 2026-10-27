---
name: chat-history-query
description: Locate and query old Kilo and GitHub Copilot Chat sessions from local SQLite, JSONL, and legacy JSON stores.
---

# Chat history query

Use this skill when asked to find, search, summarize, resume, or export historical Kilo or GitHub Copilot Chat conversations.

This skill is local-first. Do not authenticate to GitHub or Kilo cloud services, query another person's data, or access a remote host unless the user explicitly authorizes that scope.

## Choose a search surface

- For Kilo, prefer the History UI, `kilo session list --search`, or Kilo's local recall before opening SQLite. Title searches do not search message content.
- For GitHub Copilot Chat, prefer `/chronicle:search <query>` (or another Chronicle command) before raw SQLite inspection. Chronicle searches local and, when enabled and authorized, synced sessions.
- Use direct SQLite, JSONL, or legacy JSON inspection only when the normal surface is unavailable, incomplete, or the request requires a specific stored field.

## Safety

- Open every database read-only with `sqlite3 -readonly`; never run `INSERT`, `UPDATE`, `DELETE`, `VACUUM`, migrations, or repair commands during a search.
- Kilo and Copilot databases may use WAL. If a writer is active, query the live database read-only or stop the writer before making a forensic copy. A copy must include the `.db`, `.db-wal`, and `.db-shm` files together.
- Treat transcripts as sensitive. Redact tokens, API keys, credentials, connection strings, private URLs, and secrets before showing or exporting results.
- Search only the documented user-data roots and the workspace roots relevant to the request. Do not scan an entire home directory by default.
- `state.vscdb` and session indexes are routing metadata. Prefer the normalized session database or transcript files for conversation content.

## Discover the stores

### Kilo current store

Use the selected database path first:

```bash
kilo db path
```

Set local variables for the examples:

```bash
kilo_db=$(kilo db path 2>/dev/null || printf '%s\n' "${XDG_DATA_HOME:-$HOME/.local/share}/kilo/kilo.db")
case "$(uname -s)" in
  Darwin) code_user="$HOME/Library/Application Support/Code/User" ;;
  *) code_user="${XDG_CONFIG_HOME:-$HOME/.config}/Code/User" ;;
esac
copilot_db="$code_user/globalStorage/github.copilot-chat/session-store.db"
```

Fallbacks, in order:

```bash
"${XDG_DATA_HOME:-$HOME/.local/share}/kilo/kilo.db"
"$HOME/.local/share/kilo/kilo.db"
"$HOME/Library/Application Support/kilo/kilo.db"
```

Run the lookup on the machine where Kilo runs. For VS Code Remote SSH, run it on the remote host. `KILO_DB`, `XDG_DATA_HOME`, development channels, and isolated environments can change the path.

The current schema normally contains `session`, `project`, `message`, `part`, `session_message`, `session_input`, and `todo`:

```bash
sqlite3 -readonly "$kilo_db" ".tables"
```

### Kilo legacy stores

Older Kilo Code/Roo-derived extension sessions may still exist as one directory per task:

```text
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

### Copilot Chat current Chronicle store

The current Copilot Chat extension commonly uses a normalized SQLite store:

```text
VS Code stable:
  macOS:   ~/Library/Application Support/Code/User/globalStorage/github.copilot-chat/session-store.db
  Linux:   ~/.config/Code/User/globalStorage/github.copilot-chat/session-store.db
  Windows: %APPDATA%\Code\User\globalStorage\github.copilot-chat\session-store.db

VS Code Remote SSH:
  ~/.vscode-server/data/User/globalStorage/github.copilot-chat/session-store.db
```

Also check `Code - Insiders`, VSCodium, and user-data-profile variants by replacing `Code/User` with the applicable product/profile path. Inspect the schema before relying on column names because the store is versioned:

```bash
sqlite3 -readonly "$copilot_db" ".tables"
sqlite3 -readonly "$copilot_db" ".schema sessions" ".schema turns"
```

The observed Chronicle schema includes `sessions`, `turns`, `session_files`, `session_refs`, `checkpoints`, and search-index tables. `sessions` and `turns` are the preferred content source.

### Copilot Chat file stores

Older or parallel VS Code stores contain session journals and extension transcripts:

```text
<User>/workspaceStorage/<hash>/chatSessions/*.jsonl
<User>/workspaceStorage/<hash>/chatSessions/*.json
<User>/globalStorage/emptyWindowChatSessions/*.jsonl
<User>/globalStorage/transferredChatSessions/*.json
<User>/workspaceStorage/<hash>/GitHub.copilot-chat/transcripts/*.jsonl
<User>/workspaceStorage/<hash>/workspace.json
<User>/workspaceStorage/<hash>/state.vscdb
```

`<User>` is `~/Library/Application Support/Code/User` on macOS, `~/.config/Code/User` on Linux, and `%APPDATA%\Code\User` on Windows. Check `workspace.json` to map a hash to its original folder. A moved or deleted workspace can leave valid sessions in an old hash.

`chatSessions` files may be append-only delta journals rather than complete JSON documents:

- `kind: 0` sets the root session object.
- `kind: 1` sets a value at path `k`.
- `kind: 2` appends a value to the array at path `k`.
- `kind: 3` deletes a path.

Replay all lines before searching. A `kind: 0` record commonly contains `v.sessionId`, `v.creationDate`, and `v.requests`. The Copilot extension transcript JSONL is a more readable event stream when present, with events such as `session.start`, `user.message`, `assistant.message`, and tool events.

`chatEditingSessions` stores edit state and file-operation content, not the primary conversation transcript. Use it only when the request concerns edits made during a session.

## Query Kilo

### List recent sessions

```sql
SELECT
  id,
  title,
  directory,
  agent,
  model,
  datetime(time_created / 1000, 'unixepoch') AS created,
  datetime(time_updated / 1000, 'unixepoch') AS updated
FROM session
ORDER BY time_updated DESC
LIMIT 50;
```

Use `kilo session list --all --search <title>` for title search across local workspaces. That command searches titles, not message content.

### Search Kilo text content

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

### Read or resume a selected Kilo session

```bash
kilo --session <session-id>
kilo run --session <session-id> "Summarize where we stopped"
kilo export <session-id>
```

Use `kilo export --sanitize` when exporting data that may contain secrets. Do not write an export file unless the user asks for an export.

### Search legacy Kilo JSON

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

## Query Copilot Chat Chronicle SQLite

### List sessions

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

Search metadata with a parameterized `LIKE` or `instr(lower(...), lower(?))` predicate. Include `cwd`, `repository`, `branch`, `agent_name`, and `summary`.

### Search conversation turns

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

### Search files and references

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

Inspect `.schema session_refs` and `.schema checkpoints` before querying those tables because their fields can change between Copilot extension versions.

## Replay Copilot JSONL journals

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

For extension transcripts, inspect the event type first and search the event payload rather than assuming the core `chatSessions` schema:

```bash
jq -R -r --arg q 'TERM' '
  select(ascii_downcase | contains($q | ascii_downcase))
' "/path/to/transcript.jsonl"
```

## Report results

For each relevant result, report:

- Source: Kilo current DB, Kilo legacy JSON, Copilot Chronicle DB, or Copilot JSONL.
- Session ID, title or summary, workspace/cwd, repository, branch, and date.
- The matching user/assistant text or a concise summary.
- Whether the result came from a normalized table, a replayed journal, or a legacy file.
- Any ambiguity, missing transcript, stale workspace hash, or unreadable/corrupt record.

Do not dump entire databases or unrelated sessions. If a session is missing from the UI but its files remain on disk, search orphaned `workspaceStorage` hashes and legacy stores before concluding that it was deleted.

## References

- Kilo session history and SQLite search: https://kilo.ai/docs/code-with-ai/agents/session-history
- Kilo CLI reference: https://kilo.ai/docs/code-with-ai/platforms/cli-reference
- Kilo session schema: https://github.com/Kilo-Org/kilocode/blob/be0ea199/packages/opencode/src/session/session.sql.ts
- VS Code session history and Chronicle: https://code.visualstudio.com/docs/agents/run/sessions/session-history
- VS Code chat-session storage implementation: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/model/chatSessionStore.ts
- Copilot transcript writer: https://github.com/microsoft/vscode-copilot-chat/blob/main/src/extension/chat/vscode-node/sessionTranscriptService.ts
