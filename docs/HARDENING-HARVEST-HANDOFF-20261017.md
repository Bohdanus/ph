# Hardening Harvest Handoff

Date: 2026-10-17

## Scope

This handoff records the hardening-cron and dirty-worktree sweep. No further
hardening implementation should begin until the remaining worktrees are
reclassified from a fresh inventory and the active layers-documentation writer
has released its worktree.

## Landed Work

- `37c1b02eb` merged `merge/cron-salvage-20261017` into `main`.
- The salvage contains the reviewed HANDOFF parser/import guard, replay
  diagnostics for invalid layer sources, mobile/overlay accessibility fixes,
  and stateful `drawLayer` coverage.
- Post-merge typecheck, build, lint, and focused tests passed.
- Full unit and E2E runs retain documented baseline failures unrelated to the
  landed salvage; compare against the parent before attributing failures.
- The stale `layer-lifecycle` automatic merge was aborted in its own worktree
  after owner/session, lock, and index checks proved it abandoned.

## Cleanup Completed

The documented disposer archived or removed these worktrees while preserving
branches or patch archives where appropriate:

- Absorbed clean history/model/tool worktrees from the first harvest sweep.
- `next-improvements-20261014`
- `presentation-liveness-invariant`
- `test-hardening`
- `history-migration-20261014`
- `models-terra-openai-20261015`
- `history-migration-hardening-20261015`
- Invalid `hardening-cron-20261016-0900`

Orphaned `AUTO_MERGE` refs in `1110`, `1310`, and the nested handoff worktree
were cleared only after confirming no `MERGE_HEAD`, no unmerged index entries,
no session owner, and no swarm claim/lock. Dirty files were not reset.

## Remaining Worktrees

The last authoritative inventory reported 42 worktrees, with no ready-to-land
or ordinary disposal candidates, one at-risk worktree, 39 derived-live
worktrees, two undecided worktrees, and 20 holding uncommitted work.

### Preserve and hold

- `overnight-main-landing` / `test/levels-landing`: large staged composite
  owned by the layers-documentation writer. Never reset, commit, or dispose
  this checkout from a cleanup chat.
- `worktree-inventory-root-path-20261016`: inventory-authority fix remains
  unlanded and needs its missing CLI `--check`/`--release-reads` integration
  coverage before any future merge decision.
- `hardening-cron-20261016-0100` through `-2010`: stale overlapping snapshots.
  The 0700 review classified them as docs-only, duplicate, or unsafe except
  for selected slices that were reimplemented and landed. Do not merge their
  snapshots wholesale.
- `history-types-edge`, `layer-create-edge`, `layers-dispatch-edge`,
  `text-comp-edge`, `text-logic-edge`, and `integration-toolbar-land`: content
  is already present on `main`; archive only after the live overlay clears.
- `inventory-reclaim-20261015`: blocked because current `PanelLayout.setDockSide`
  is an intentional no-op and the product rule pins panels right. Do not land.
- `handoff-96-open-problems-path` and `impartial-thistle`: undecided; inspect
  ownership and ignored/untracked content before any action.

### Branch-only refs

`npm run branches:orphan` still reports dozens of branch-only refs. The prior
Luna audit classified them as absorbed, obsolete/contract-violating, gated
durable-boundary work, or recoverable only by fresh-main reimplementation.
Do not delete branch refs merely because their worktree is gone. Preserve the
classification and review each recoverable branch before any cherry-pick.

## Scheduler State

- This chat has no scheduled cron task.
- The historical cross-session cron ID cannot be inspected or deleted from a
  different owning session; the current session has no task with that ID.
- Do not create a replacement cron from this chat.

## Terra/Luna Reviews

- Terra review sessions that hit usage limits were recovered only when a
  concise verdict was possible. One recovered verdict held inventory-authority
  coverage because `--check` and `--release-reads` lacked linked-worktree
  integration tests.
- Luna reviewed the salvage and dirty-worktree classifications. Use Luna for
  future ordinary reviews; reserve direct OpenAI Terra for genuinely critical
  durable-boundary or ownership decisions.

## Next Chat Procedure

1. Run `npm run repo:state`, `node scripts/worktree-inventory.mjs`,
   `npm run swarm -- doctor --dry-run --json`, and `npm run branches:orphan`.
2. Confirm the layers-documentation writer and all review descendants are
   finished before disposing any `in-use` worktree.
3. Preview `npm run dispose -- <name> --keep-branch --dry-run` for every stale
   candidate. Never use `--no-live-writers`, force removal, reset, checkout, or
   stash.
4. Archive dirty snapshots with `--keep-branch` only after their unique payload
   is preserved or explicitly classified obsolete.
5. Do not begin new hardening implementation until cleanup reaches a stable
   inventory and the remaining at-risk/undecided work has a named decision.
