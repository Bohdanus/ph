Photoshop clone. The toolbar is a Photoshop clone — HARD REQUIREMENT.

## Worktrees

- Make tracked edits and run Git/npm commands only in `.kilo/worktrees/`; `main` is read-only except for landing.
- Before any other Git command, run `git worktree list --porcelain`, choose the `refs/heads/main` worktree, and create a task branch. Verify the new checkout with `git rev-parse --show-toplevel`.
- Create the worktree before editing or starting subagents.
- Commits require a `Chat: <native-session-id>` trailer; merges into `main` require `Branch: <source-branch>`. Resolve chat IDs with `npm run session:id -- "distinctive phrase"`.
- Follow [`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md) for landing, recovery, and disposal.

## Product Boundary

Support desktop and tablet/touch devices, including Retina/high-DPI. Do not add phone layouts or phone-specific interactions.

## Agents And Reviews

- Use `task` for research and `agent_manager` only for visible sessions/worktrees. Give each subagent an absolute worktree path and exclusive write set.
- Pass `model` and `provider` together. Free sessions must not launch GPT subagents or perform Git operations; the coordinator owns branch, merge, commit, reset, and disposal work.
- See [MODELS.md](MODELS.md) for model/provider guidance.
- Photoshop behavior, UX, and non-trivial algorithms require Adobe or other primary-source research. Non-trivial changes require a fresh read-only review; cross-module or high-risk changes require two. See [`docs/ORCHESTRATION.md#the-task-lifecycle`](docs/ORCHESTRATION.md#the-task-lifecycle) and [`docs/CODE-REVIEW.md`](docs/CODE-REVIEW.md).

## Browser And Validation

- Never open a browser. Use `npm run test:e2e` for headless E2E and `npm run probe:console` for one page load. Do not add browser MCPs or weaken console/theme gates.
- Run npm commands only in a worktree. Use `npm run tsc` for typechecking and `npm run build` for production builds; do not use `npx tsc --noEmit` as project validation.
- E2E specs use `./fixtures/extended-test`, not `@playwright/test`. Do not spread `useRect` return groups onto DOM elements.

## Coordination And Cleanup

- Before takeover, harvest, or cleanup, verify the worktree, run `npm run repo:state`, inspect status, and read the relevant handoff. Cleanup also requires `node scripts/worktree-inventory.mjs` and `npm run branches:orphan`.
- Never run `node scripts/worktree-inventory.mjs -- --quiet`; use documented inventory commands and check their exit status. Use `npm run swarm` for repository ownership, not session-only board tools.
- `board_post` caps the FORMATTED message at **4096 bytes**, not the body at 4096 characters: the budget is **3800 ASCII characters**, or 1200 if any may be non-ASCII. Put longer evidence in a file and reference it from the board. Details live in [`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md).
- Never merge into dirty `main`, stage another agent's paths, or use `git stash`. Dispose only with `npm run dispose -- <name>` after proving ownership, confirming descendant agents are dead, checking the live overlay, and previewing `npm run swarm -- doctor --dry-run`.
- A task is complete only when reviewed work is landed/released or a durable handoff marks it `blocked`, `unproven`, or `obsolete`.

## Gates And Documentation

- Commit runs lint-staged, then typecheck/build; push runs the full suite. Never weaken gates or casually re-record baselines. See [`docs/TESTING.md#gates`](docs/TESTING.md).
- Do not cite line numbers in prose or human-written source comments; use identifiers, test titles, files, headings, or `§N`. Do not edit generated `docs/TOOLS.md`.
- Keep `HANDOFF.md`, `.kilo/plans/`, and `e2e/OPEN_PROBLEMS.md` problem-focused, not changelogs. Remove fixed, verified entries. Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`HANDOFF.md`](HANDOFF.md) §1 before crossing replay/durable boundaries.
