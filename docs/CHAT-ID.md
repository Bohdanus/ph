# Chat ID and commit trailers

Every commit has a `Chat` trailer identifying the session that produced it. Use the ID from the
agent host running this conversation; IDs from different hosts are not interchangeable.

## Copilot SDK in VS Code

Read the current session metadata using the host's `get_current_session` tool. Use its `session`
value verbatim, including the host prefix. For example, a value like
`copilotcli:/7befb061-b313-497b-8694-97929d9054e4` produces:

```text
Chat: copilotcli:/7befb061-b313-497b-8694-97929d9054e4
```

The Copilot session URI is not a Kilo `ses_…` ID. There is no reliable mapping from that URI to a
Kilo session row; searching `kilo.db` for a prompt phrase can return an older, unrelated Kilo chat.
Do not substitute a search result or fabricate a `ses_` value when the current host provides a
different identifier.

## Kilo sessions

Use the `ses_…` value returned by the Kilo session host. If it is not exposed directly, a read-only
search of Kilo's database can help locate candidates by a distinctive phrase from the current task.
Return enough context to verify the match; do not blindly take the first row:

### Using the `session:id` helper (recommended)

```sh
npm run session:id -- "distinctive current task phrase"
# or from any worktree:
# node scripts/find-session-id.mjs "distinctive current task phrase"
```

The helper opens `~/.local/share/kilo/kilo.db` read-only (using the built-in `node:sqlite` module, so it
needs no `node_modules`), searches top-level sessions for the phrase, and prints the most recent match's
ID to stdout. Verify the match by running with `FIND_SESSION_VERBOSE=1`:

```sh
npm run session:id -- "distinctive current task phrase" 2>&1
```

When no phrase is given, the helper falls back to the most recent top-level session across all
repositories (use `FIND_SESSION_VERBOSE=1` to verify the directory). If the database cannot be opened
or no session matches, the helper exits non-zero with a message on stderr.

Phrase searches are time-bounded to the last 7 days by default (override with
`FIND_SESSION_DAYS=N`); this keeps the query fast on multi-gigabyte databases where a full scan
can take tens of seconds. Passing no phrase skips the time bound, since the no-phrase query only
reads the small `session` table.

If the helper is unavailable, fall back to a manual read-only search:

```sh
sqlite3 -readonly "$HOME/.local/share/kilo/kilo.db" "
  SELECT s.id, s.title, s.directory,
         datetime(s.time_updated / 1000, 'unixepoch') AS updated
  FROM session s
  JOIN message m ON m.session_id = s.id
  JOIN part p ON p.message_id = m.id
  WHERE s.parent_id IS NULL
    AND s.time_updated >= (strftime('%s','now')-604800)*1000
    AND json_extract(p.data, '$.type') = 'text'
    AND lower(json_extract(p.data, '$.text')) LIKE '%distinctive%current%task%phrase%'
  ORDER BY s.time_updated DESC
  LIMIT 10;
"
```

The `s.time_updated` filter limits the scan to sessions from the last 7 days
(adjust `604800` seconds as needed); without it the query scans the entire
`part` table and can take tens of seconds on a large database.

Confirm the candidate's title, repository directory, and timestamps match the current chat. If the
current session is absent or multiple candidates remain, do not guess; use the session host's
identifier or ask the operator how this environment wants it recorded.

Kilo swarm commands may use a Kilo `ses_…` ID as `--agent`. The agent board otherwise identifies
work by branch, not by session ID; a Copilot URI is not a Kilo run ID.

## Codex CLI or Desktop sessions

Prefer the current thread/session ID exposed by the Codex host. When the host does not expose it,
Codex's local rollout log is a reliable fallback if this process can read the same `CODEX_HOME`.
The default directory is `~/.codex`; if `CODEX_HOME` is set, use that directory instead. Codex
stores dated `sessions/YYYY/MM/DD/rollout-<timestamp>-<thread-id>.jsonl` files. The first JSONL
record is `session_meta`, whose payload contains the thread ID (`id`, and in some versions also
`session_id`). The filename shape and metadata record are defined in the
[OpenAI Codex rollout tests](https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/common/rollout.rs).

Search for a distinctive phrase from this chat. `rg -l` prints matching paths only, not transcript
content; start with today's directory, then search the whole sessions directory if needed:

```sh
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
TODAY="$(date +%Y/%m/%d)"
rg -l -F --glob 'rollout-*.jsonl' -- "distinctive phrase from this chat" "$CODEX_HOME_DIR/sessions/$TODAY"
# If no file matches, search all date folders (the session may have started yesterday):
rg -l -F --glob 'rollout-*.jsonl' -- "distinctive phrase from this chat" "$CODEX_HOME_DIR/sessions"
```

Select the matching file for the current repository and time. Read only its first line and emit the
metadata ID, without printing the transcript:

```sh
SESSION_FILE="/path/printed/by/rg/rollout-....jsonl"
head -n 1 "$SESSION_FILE" | node -e '
let line = "";
process.stdin.on("data", (chunk) => (line += chunk));
process.stdin.on("end", () => {
  const record = JSON.parse(line);
  if (record.type !== "session_meta") throw new Error("first record is not session_meta");
  const payload = record.payload ?? {};
  const id = payload.session_id ?? payload.id;
  if (typeof id !== "string" || !id) throw new Error("session metadata has no ID");
  console.log(id);
});
'
```

Check that the emitted ID matches the UUID suffix in the filename and that the file's date,
repository, and timestamp match this chat. The ID goes in the trailer verbatim:

```text
Chat: <codex-thread-id>
```

Do not use `npm run session:id` for Codex; it queries Kilo's database. Do not `cat`, `less`, or
otherwise print a rollout file: it contains private conversation history. If this host has no
accessible Codex rollout or session API, use an explicitly operator-approved fallback label, not
a guessed native ID. For this operator, create one `codex-<UTC timestamp>` label (for example,
`codex-$(date -u +%Y%m%dT%H%M%SZ)`) and reuse it for every commit in that chat; this is a
synthetic fallback, not a Codex-native ID.
