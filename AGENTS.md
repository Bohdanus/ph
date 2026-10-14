Photoshop clone. The toolbar is a Photoshop clone — HARD REQUIREMENT.

## Worktree First

- All tracked-file edits and all Git/npm commands run in a worktree under `.kilo/worktrees/`.
  `main` is read-only except for landing; never repair another checkout.
- From the startup directory, the only Git command allowed before selecting a worktree is
  `git worktree list --porcelain`. Find the `refs/heads/main` worktree, create a task branch there,
  then run `git rev-parse --show-toplevel`; it must print a path under `.kilo/worktrees/`.
- Create the worktree before the first edit or subagent fan-out. Every commit has a
  `Chat: <native-session-id>` trailer; every merge into `main` has `Branch: <source-branch>`.
  Resolve the chat ID with `npm run session:id -- "distinctive phrase"`.
- The full landing, recovery, and disposal procedure is [`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md).

## Product Boundary

Support desktop and tablet/touch devices, including Retina/high-DPI. Do not add phone layouts or
phone-specific interaction models.

## Agents

- Use `task` for ordinary research; use `agent_manager` only for visible sessions/worktrees.
  Give every subagent the absolute worktree path and an exclusive write set. One writer per file.
- Pass `model` and `provider` together. A free session must never launch a GPT subagent. Free
  models never perform Git operations; the coordinator performs branch, merge, commit, reset, and
  disposal work.
- Laguna is preferred and rate-limited. If unavailable, use Step 3.7 Flash for narrow execution;
  use Nemotron or Dots3 only for summaries/light exploration. Resolve pairs with `agent_manager_models`.
- Photoshop behavior, UX, and non-trivial algorithms require external Adobe/primary-source research
  before implementation. Non-trivial changes require a fresh read-only review before landing;
  cross-module or high-risk changes require two. See [`docs/ORCHESTRATION.md#the-task-lifecycle`](docs/ORCHESTRATION.md#the-task-lifecycle)
  and [`docs/CODE-REVIEW.md`](docs/CODE-REVIEW.md).

## Browser And Commands

- Never open a browser. E2E is headless via `npm run test:e2e`; use `npm run probe:console` for one
  page load. Never add browser MCPs or weaken console/gate checks.
- Run npm commands only in a worktree. `npm run tsc` is the trustworthy typecheck; `npm run build`
  is the production build. Do not use `npx tsc --noEmit` as project validation.
- E2E specs use `./fixtures/extended-test`, not `@playwright/test`; its automatic console/theme
  fixtures are gates. `useRect` return groups must not be spread onto DOM elements.

## Coordination Rules

- Before takeover, harvest, or cleanup: verify the worktree, run `npm run repo:state`, inspect
  status, and read the relevant handoff. For cleanup also run `node scripts/worktree-inventory.mjs`
  and `npm run branches:orphan`; inventory does not see branch-only refs.
- Never run the malformed `node scripts/worktree-inventory.mjs -- --quiet`; it is rejected. Use
  the documented inventory commands and read their exit status. Repository ownership uses
  `npm run swarm`, not Kilo's session-only `board_read`/`board_post`.
- `board_post` caps the formatted message at **4096 bytes**; budget about **3800 ASCII** or **1200**
  multibyte characters. Put longer evidence in a file and reference it from the board. Details live
  in [`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md).
- Never merge into dirty shared `main`, stage another agent's paths, or use `git stash`. Dispose
  only through `npm run dispose -- <name>` after proving the owner and every descendant subagent
  are dead, checking the live overlay, and previewing `npm run swarm -- doctor --dry-run`.
- A task is complete only when reviewed work is landed/released or a durable handoff marks it
  `blocked`, `unproven`, or `obsolete`. Detailed lifecycle rules live in
  [`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md).

## Gates And Documentation

- The gates are defined in [`docs/TESTING.md#gates`](docs/TESTING.md#gates): commit runs lint-staged,
  then typecheck/build; push runs the full suite. Never weaken a gate or re-record baselines casually.
- Do not cite line numbers in prose. Use identifiers, test titles, files, headings, or `§N`; the
  citation test covers this rule. `docs/TOOLS.md` is generated and must not be edited.
- `HANDOFF.md`, `.kilo/plans/`, and `e2e/OPEN_PROBLEMS.md` are problem-focused, not changelogs.
  Remove a fixed, verified entry. Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
  [`HANDOFF.md`](HANDOFF.md) §1 before crossing replay/durable boundaries.
