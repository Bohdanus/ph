Photoshop clone, production-grade photo editor

## Work on WORKTREE

Every tracked-file change happens in worktree and branch. `main` is for reading
and merging. The exceptions are listed in [`docs/ORCHESTRATION.md#worktrees`](docs/ORCHESTRATION.md#worktrees).

```bash
git rev-parse --show-toplevel
# `git worktree list` puts the main checkout first; keep $MAIN absolute.
MAIN="$(git worktree list --porcelain | head -1 | cut -d' ' -f2-)"
git worktree add -b <prefix>/<slug> "$MAIN/.kilo/worktrees/<slug>"
```

`main-worktree-guard.mjs` refuses commits made from `main`, but only after the edit;
create the worktree before writing. Every commit carries a `Chat: ses_<id>` trailer.
Every merge into `main` also carries `Branch: <source-branch>`.
No gate supplies these values, so resolve chat id before the first commit. It is also
the swarm identity used by `npm run swarm -- --agent ses_…`.

Find the id in the session store with a phrase you typed, matching
words rather than a multi-line literal:

```bash
sqlite3 -readonly ~/.local/share/kilo/kilo.db "SELECT s.id FROM session s
  JOIN message m ON m.session_id=s.id JOIN part p ON p.message_id=m.id
  WHERE s.parent_id IS NULL AND json_extract(p.data,'\$.type')='text'
    AND lower(json_extract(p.data,'\$.text')) LIKE '%a%phrase%you%typed%'
  ORDER BY s.time_updated DESC LIMIT 1;"
```

## Subagents

- Use `task` for ordinary research and `agent_manager` only when visible sessions or worktrees are requested.
- A task subagent inherits the working directory. Give it the absolute worktree path and never let two agents edit the same file.
- **NEVER OMIT `model` AND `provider`.** A FREE SESSION MUST NEVER LAUNCH A GPT SUBAGENT. NO EXCEPTION.
- Specify provider. `GPT-5.6 Luna Fast` is `openai`-only. `agent_manager_models` is the catalog.
- GPT context cost doubles past 200k for GPT Luna and 270k for GPT Terra/Sol; keep those models below the thresholds!
- `agent_manager` inherits the current model unless both values are explicit, so a main turn on a paid model spawns paid worktrees; `explore` cannot run commands, so use `general` when execution is needed.
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

- `merge-takeover-guard.mjs` protects committed merges from silently replacing the other side's files, reports every path a merge resolution hand-edited after git had merged it cleanly, and refuses a resolution that dropped a test file BOTH sides still carry. Fast-forwards reach `post-merge`, which cannot block; an unresolved conflict runs no guard until a commit; `--no-verify` bypasses it. [`docs/ORCHESTRATION.md#landing`](docs/ORCHESTRATION.md#landing) is the detailed source.
- Other sessions can change `main`; re-read status and diff before staging, and stage only your paths.
- `npm run repo:state` reports every worktree with a merge, rebase or bisect in progress. Nothing else in the tree can see that state, and it lives in no commit, branch name or `git status`. Run it before a sweep or a landing. [`docs/ORCHESTRATION.md#what-git-is-doing-right-now`](docs/ORCHESTRATION.md#what-git-is-doing-right-now) is the detailed source.
- `npm run inventory:verify` is a REPORT about the worktrees on this machine, not a gate, and no hook or CI job runs it. The gated suite asserts the same rules over a fleet it builds, so run this one before a sweep or a landing instead of blocking a push on it; [`docs/TESTING.md#gates`](docs/TESTING.md#gates) is where the split is stated.
- Its exit code is its own verdict about this machine, and it is non-zero on a finding **and** on a check that could not run — a worktree holding work on no ref that could not be classified, facts git could not be read for, or a session audit that could not run — because "git could not be asked" is not "nothing is at risk". Read the exit line before acting on the number; `docs/TESTING.md` §Gates has the full set and every line the report can print.
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
- CI has independent `ci`, `e2e-unit`, and headless `e2e` jobs, and none of them may carry `continue-on-error`: all three are gates. It audits high-severity vulnerabilities but does not enforce dependency licences.
- Never weaken a gate with a skip, raised threshold, deleted assertion, or re-recorded baseline. A baseline is re-recorded only with `--update-snapshots=all`.
- Hooks dispatch from `<common-dir>/.git/hooks-gate/`, not each worktree's `.husky/_`; `HUSKY=0` bypasses them. A blocked commit may leave `.git/lint-staged_unstaged.patch`.
- Reference timings, each one a single command on one machine: `build` 1.7s, `test:e2e:unit` 1.1s, `tsc -b` 5s, `gate:commit` about 9s, `test:staged` 2.8s.
- **Quote a per-file measurement and say which machine it came from. A suite total is a statement about the machine as much as the tree.** `scripts/__tests__/worktree-inventory.test.mjs` measured at 9.62-9.72s over five consecutive isolated runs, all green at `168 passed`, on this machine at load average 4.4. A spread rather than a figure because the fleet it builds is real `git` worktrees and a busy host moves it; a single number for it would be a guess wearing a measurement's clothes.
- The same file, BEFORE it stopped reading the operator's own worktrees, took 61.47s of a 142.78s `npm run test` at 92 live worktrees. After: 340 files and 9100 tests in 47.94s, measured at the `pre-push` hook during the `git push` of `6b142f04`, with two further full-suite runs on a busier machine at 60.84s and 71.28s. The before/after pair is stated as the record it is, not as targets.

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

### Entry ids

**A NEW ENTRY GETS A SHA, NOT A NUMBER. MINT IT WITH `npm run handoff:id -- "<title>"`, PASTE THE
RESULT, AND NEVER RECOMPUTE IT.**

A number is a shared allocator with no owner: every session reads the same highest number and
claims it, so two sessions adding one entry each collide by construction and the merge arbitrates a
conflict over prose. A sha derived from the entry's own title needs no allocator. The parser reads
either form, so `## a1b2c3d. Title` and `## 242. Title` are both items and a document may hold both.

- **Retitling changes the id**, because the id is the hash of the title. A retitled entry reads as a
  new item on the board. Mint once, on creation.
- **The id is 7 lowercase hex characters.** `## Defaced shapes` is a prose heading, not an entry —
  an id must carry a digit. Do not invent a longer or mixed-case one; uppercase is normalised, but a
  non-hex token is not an id at all.
- **Numbers are not being removed.** An existing numbered entry stays numbered. Renumbering the
  document to convert it is a separate, larger change and is not required.
- Retiring an entry works for both forms: end the heading with a dead word, or list the id under a
  heading like `### Items 3, a1b2c3d — deleted`.

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
