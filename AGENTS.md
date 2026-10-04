Photoshop clone production-grade photo editor

## Worktree FIRST

Every tracked-file change happens in its own worktree and branch. `main` is for reading
and merging. The exceptions are listed in [`docs/ORCHESTRATION.md#worktrees`](docs/ORCHESTRATION.md#worktrees).

```bash
git rev-parse --show-toplevel
# `git worktree list` puts the main checkout first; keep $MAIN absolute.
MAIN="$(git worktree list --porcelain | head -1 | cut -d' ' -f2-)"
git worktree add -b <prefix>/<slug> "$MAIN/.kilo/worktrees/<slug>"
```

`main-worktree-guard.mjs` refuses commits made from `main`, but only after the edit;
create the worktree before writing. Every commit carries a `Chat: ses_<id>` trailer.
Every merge into `main` also carries `Branch: <source-branch>`; keep the subject unchanged.
No gate supplies these values, so resolve the chat id before the first commit. It is also
the swarm identity used by `npm run swarm -- --agent ses_…`.

There is no `kilo` CLI. Find the id in the session store with a phrase you typed, matching
words rather than a multi-line literal:

```bash
sqlite3 -readonly ~/.local/share/kilo/kilo.db "SELECT s.id FROM session s
  JOIN message m ON m.session_id=s.id JOIN part p ON p.message_id=m.id
  WHERE s.parent_id IS NULL AND json_extract(p.data,'\$.type')='text'
    AND lower(json_extract(p.data,'\$.text')) LIKE '%a%phrase%you%typed%'
  ORDER BY s.time_updated DESC LIMIT 1;"
```

## Subagents

### Delegation

- Use `task` for ordinary research and `agent_manager` only when visible sessions or worktrees are requested.
- Never exceed 15 simultaneous subagents/processes; this project fans out in waves of three.
- A task subagent inherits the working directory. Give it the absolute worktree path and never let two agents edit the same file.

### Model policy

- Use `agent_manager_models` to choose a current model/provider pair and always pass both fields. Free sessions never launch GPT models; for example, `GPT Luna Latest` is `openrouter`-only while `GPT-5.6 Luna Fast` is `openai`-only.
- `agent_manager` inherits the current model unless both values are explicit; `explore` cannot run commands, so use `general` when execution is needed.
- GPT context cost doubles past 200k for GPT Luna and 270k for GPT Terra/Sol; keep those models below the thresholds.
- Findings need evidence. The formatted board message cap is 4096 bytes; its body has about 3840 bytes: 3800 ASCII characters or 1200 characters when non-ASCII may occur. Put longer findings in a file or swarm issue.

## Browser rule

Never open a browser window. E2E runs are headless; read [`docs/TESTING.md#never-open-a-browser-window`](docs/TESTING.md#never-open-a-browser-window)
before any Playwright command. The only operator-approved headed command is
`npm run test:e2e:headed`; never switch modes to hide a failure.

Use `npm run probe:console` for a headless page probe. It reports deduplicated console,
page, and request failures. Its only options are `--url`, `--viewport`, `--dsf`, `--allow`,
and `--out`; headless mode is hardcoded. Do not add a browser MCP server: it bypasses the
repository's browser protections.

## Commands

`npm run tsc` is the only trustworthy typecheck. `npx tsc --noEmit` checks the empty root
solution and can exit successfully without checking the projects; see [`docs/TESTING.md#running-commands`](docs/TESTING.md#running-commands).
Use `npm run test:e2e` for headless Playwright and `npm run probe:console` for one headless page load.

## Worktrees and dev servers

- `merge-takeover-guard.mjs` protects committed merges from silently replacing the other side's files. Fast-forwards reach `post-merge`, which cannot block; an unresolved conflict runs no guard until a commit; `--no-verify` bypasses it. [`docs/ORCHESTRATION.md#landing`](docs/ORCHESTRATION.md#landing) is the detailed source.
- Other sessions can change `main`; re-read status and diff before staging, and stage only your paths.
- Remove worktrees only with `npm run dispose -- <name>`; it checks inventory, board claims, locks, and session state.

## Test traps

E2E specs import `test` from `./fixtures/extended-test`, not `@playwright/test`. Its `auto`
fixtures enforce `consolePolice` and `pinnedTheme`; expected console messages require a
reasoned `ACCEPTED_CONSOLE_ERRORS` entry. Do not add skips, thresholds, or suppressions to
make a test pass. `useRect` must expose `pointerHandlers`, `rectHandles`, and `pointerState`
explicitly; spreading its whole return onto a DOM element creates invalid props.

## Gates

The local hook table and CI sequence live in [`docs/TESTING.md#gates`](docs/TESTING.md#gates).

| Command               | Runs from           | Contents                                                       |
| --------------------- | ------------------- | -------------------------------------------------------------- |
| `npm run gate:commit` | `.husky/pre-commit` | `lint-staged --fail-on-changes --no-stash`, then `gate:verify` |
| `npm run gate:verify` | —                   | `tsc` -> `build`                                               |
| `npm run test:staged` | **NOWHERE**         | manual `vitest related` command                                |
| `npm run gate:push`   | `.husky/pre-push`   | full app suite                                                 |

- The commit hook runs no app test; `test:staged` is manual, and the full app suite runs at `gate:push`. Whole-repository lint and formatting are CI-only.
- CI has independent `ci`, `e2e-unit`, and headless `e2e` jobs. It audits high-severity vulnerabilities but does not enforce dependency licences.
- Never weaken a gate with a skip, raised threshold, deleted assertion, or re-recorded baseline. A baseline is re-recorded only with `--update-snapshots=all`.
- Hooks dispatch from `<common-dir>/.git/hooks-gate/`, not each worktree's `.husky/_`; `HUSKY=0` bypasses them. A blocked commit may leave `.git/lint-staged_unstaged.patch`.
- Reference timings: `build` 1.7s, `test:e2e:unit` 1.1s, `tsc -b` 5s, `gate:commit` about 9s, `test:staged` 2.8s, and the full test about 7-14s.

## Known failures

The default headless run has no failing E2E tests and three declared skips. Read
[`docs/TESTING.md#e2e-failures`](docs/TESTING.md#e2e-failures) and
[`e2e/OPEN_PROBLEMS.md`](e2e/OPEN_PROBLEMS.md) before investigating a failure; its entries
are latent defects, not current failures.

A pin or `it.fails(...)` test is a tripwire for known broken behavior, not a skip. When the
defect is fixed, remove its pin in the same change. Read failure artifacts from disk; never
open a trace viewer or another browser window.

## Documentation

`docs/README.md` indexes the documents and their single jobs. The authority ladder is:
operator, then Adobe for Photoshop behavior, then this repository for code, then judgement.
The in-app documents are the source of truth for what code must do; code is the source of
what it does now. If a browser cannot implement a requirement, document that limitation.

One fact has one home: link instead of restating it. `docs/TOOLS.md` is generated; never edit it.

## Citations

Do not cite line numbers in prose. Cite a declared identifier in call form, a dispatched
string literal, a test title, a file, or a document heading/quote/`§N`. A range names one
enclosing unit, never two endpoints. This rule is enforced by
`scripts/__tests__/agents-citations.test.mjs`; do not weaken it with exclusions or thresholds.

Quotation in a fenced block is the only exemption. The check covers retired symbols in all
maintained documents. Line-number checks cover `AGENTS.md`, `docs/DOCUMENTATION.md`, and
`docs/README.md`; call-form and `§N` checks cover `AGENTS.md` alone. The exact scope is
deliberate and described in [`docs/DOCUMENTATION.md#citations`](docs/DOCUMENTATION.md#citations).

## Handoff documents

`HANDOFF.md`, `.kilo/plans/`, and `e2e/OPEN_PROBLEMS.md` are problem-focused and todo-oriented:
no changelogs, completion summaries, or status reports. Verify every claim against the tree;
each entry needs a validated problem, affected files, and an actionable fix. Fixed and verified deletes the entry.

## Architecture status

`HistoryItem[]` is the **PRODUCTION REPLAY AUTHORITY**. The durable document is mounted only
as a **navigation presentation cache**; it remains subordinate to legacy replay, while render,
export, and logical replay stay legacy-authoritative. Re-read the code,
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), and [`HANDOFF.md`](HANDOFF.md) §1 before
designing across this legacy/durable boundary.
