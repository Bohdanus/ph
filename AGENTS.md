Photoshop clone

#️ CRITICAL: ALL WORK HAPPENS IN WORKTREE — NEVER IN THE MAIN CHECKOUT

**Every command you run — git, tests — MUST run inside worktree directory under `.kilo/worktrees/`.**

The main checkout is **READ-ONLY**.
Running `git status`, `git rev-parse`, `npm test` - will break.

**Before editing tracked files or running project commands, verify you are in your worktree:**

```bash
git rev-parse --show-toplevel
# MUST print a path under .kilo/worktrees/
```

Every tracked-file change happens in worktree. `main` is for reading
and merging. The exceptions are listed in [`docs/ORCHESTRATION.md#worktrees`](docs/ORCHESTRATION.md#worktrees).
If a task starts outside a worktree, the setup commands below are the only git
commands to run before creating one.

```bash
# Find the checkout actually on main; the first listed worktree can be a bare repo.
MAIN="$(git worktree list --porcelain | awk '
  /^worktree / { path = substr($0, 10) }
  /^branch refs\/heads\/main$/ { print path; found = 1; exit }
  END { if (!found) exit 1 }
')" || { printf 'Could not find a worktree on refs/heads/main\n' >&2; exit 1; }

# Pick a task-specific slug that is not already a branch or directory.
SLUG=task-specific-name
BRANCH="fix/$SLUG"
TARGET="$MAIN/.kilo/worktrees/$SLUG"
if git show-ref --verify --quiet "refs/heads/$BRANCH" || [ -e "$TARGET" ]; then
  printf 'Branch or worktree path already exists; choose another SLUG\n' >&2
  exit 1
fi
git worktree add -b "$BRANCH" "$TARGET"
```

Every commit must carry a `Chat: <native-session-id>` trailer; resolve it as described in
[`docs/CHAT-ID.md`](docs/CHAT-ID.md). Do not infer or translate one host's session ID into another.
Every merge into `main` must carry `Branch: <source-branch>`.
Resolve the session ID before the first commit. `ses_…` is the Kilo format; it is accepted by
the Kilo swarm command when needed, but swarm identity otherwise defaults to the branch.

## Subagents

- Use `task` for ordinary research and `agent_manager` only when visible sessions or worktrees are requested.
- **A task subagent inherits the caller's working directory.** You MUST give it the absolute worktree path in the prompt. Never let two agents edit the same file.

- **NEVER OMIT `model` AND `provider`.** A FREE SESSION MUST NEVER LAUNCH A GPT SUBAGENT. NO EXCEPTION. A GPT session may launch GPT subagents.
- A name and a provider are a pair the catalog decides, so no single provider is correct for a family: `GPT Luna Latest` is `openrouter`-only while `GPT-5.6 Luna Fast` is `openai`-only. `agent_manager_models` is that catalog.
- GPT context cost doubles past 200k for GPT Luna and 270k for GPT Terra/Sol; keep those models below the thresholds.
- `agent_manager` inherits the current model unless both values are explicit, so a main turn on a paid model spawns paid worktrees; `explore` cannot run commands, so use `general` when execution is needed.
- Findings need evidence. The formatted board message cap is 4096 bytes; its body has about 3840 bytes: 3800 ASCII characters or 1200 characters when non-ASCII may occur. Put longer findings in a file or swarm issue.

### Free-model Git restriction

Nemotron and every other free model can misbehave when handling Git. NEVER assign free-model agents Git operations, branch or worktree creation/deletion, rebases, merges, commits, resets, or conflict resolution. Deny free-model agents Git work; perform Git operations in the coordinator or a trusted non-free agent.

## Browser rule

Never open a browser window. E2E runs are headless; read [`docs/TESTING.md#never-open-a-browser-window`](docs/TESTING.md#never-open-a-browser-window)
before any Playwright command. The only operator-approved headed command is
`npm run test:e2e:headed`; never switch modes to hide a failure.

Use `npm run probe:console` for a headless page probe. It reports deduplicated console,
page, and request failures. Its only options are `--url`, `--viewport`, `--dsf`, `--allow`,
and `--out`; headless mode is hardcoded. Do not add a browser MCP server: it bypasses the
repository's browser protections.

## Commands

**ALL git/npm COMMANDS MUST RUN IN YOUR WORKTREE.**

`npm run tsc` is the only trustworthy typecheck. `npx tsc --noEmit` checks the empty root
solution and can exit successfully without checking the projects; see [`docs/TESTING.md#running-commands`](docs/TESTING.md#running-commands).
Use `npm run test:e2e` for headless Playwright and `npm run probe:console` for one headless page load.

## Worktrees and dev servers

- Run slow inventory commands asynchronously; wait for that run to finish before relying on its report. See [`docs/ORCHESTRATION.md#the-list-of-worktrees-worktreesjson`](docs/ORCHESTRATION.md#the-list-of-worktrees-worktreesjson).
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
| `npm run test:staged` | nowhere             | manual `vitest related` command                                |
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

A CI E2E result marked flaky is a failed run even if a retry passed; investigate it rather
than treating it as green. See [`docs/TESTING.md#ci`](docs/TESTING.md#ci) for the retry policy.

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

## Free subagent models

| Model                   | Provider | Variant  | Notes                                            |
| ----------------------- | -------- | -------- | ------------------------------------------------ |
| Nemotron 3 Ultra (free) | kilo     | high     | Best quality; thorough                           |
| Dots3-Note Preview      | kilo     | thinking | Alternative, good for review and summaries, fast |
| Step 3.7 Flash          | kilo     | high     | Fast, accurate                                   |

Rate-limited (avoid): Poolside Laguna S 2.1, LiquidAI LFM2.5-2.6B.
