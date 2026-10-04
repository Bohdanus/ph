# Merge integrity audit

A point-in-time record of what the concurrent-branch work left unresolved, measured against
`main` @ `fe275099`. It is a **report, not a home**: actionable defects live in
[`HANDOFF.md`](HANDOFF.md) and [`e2e/OPEN_PROBLEMS.md`](e2e/OPEN_PROBLEMS.md), and each item below
says which, if any. Nothing here is a changelog and nothing here should be cited as the state of the
code — re-derive from the tree.

Every command in this file is one that was actually run, and its output is what was observed.

## 1. Four git operations are still open in other worktrees

**This is the whole hazard class in one place.** A worktree with `MERGE_HEAD` set or a rebase in
progress holds resolution state that no commit records, no branch names, and `git status` in the main
checkout cannot see.

| worktree                     | branch                             | state                      | unmerged paths |
| ---------------------------- | ---------------------------------- | -------------------------- | -------------- |
| `sweep-land`                 | `integration/sweep-land`           | `MERGE_HEAD` set           | **5**          |
| `migration-review-sweep`     | detached                           | `rebase-merge` in progress | **12**         |
| `header-menu-structure`      | `fix/header-menu-structure`        | `MERGE_HEAD` set           | 0              |
| `damage-followup-2026-10-04` | `audit/damage-followup-2026-10-04` | `MERGE_HEAD` set           | 0              |

```bash
find .git/worktrees -maxdepth 2 \( -name MERGE_HEAD -o -name rebase-merge \) -print
```

**Why the two rows with 0 unmerged paths still matter.** A merge whose conflicts were all resolved
but never committed reports a clean tree. `git merge --abort` throws the resolution away;
`git commit` lands whatever the working tree holds. Both are one command away and neither is
discoverable from the main checkout.

**Why `sweep-land` is the dangerous one.** Its conflicts are resolved _in the working tree but not
staged_, so `git diff --name-only --diff-filter=U` reports 5 while `git status` shows the resolution
as ordinary modifications. `git commit -a` would therefore commit the resolution — or, if the
resolution took one side, commit a whole-file takeover that compiles and passes every gate while
discarding the other branch's committed work.

**Fix.** Decide each worktree individually. Where the resolution carries value, stage it explicitly
(`git add -- <paths>`, never `git add -A`) and commit it after reading the diff; where it does not,
`git merge --abort` or `git rebase --abort`. Do not resolve or repair any of them from the main
checkout.

## 2. An orphan branch carries HANDOFF numbers that main now owns

`docs/handoff-reconcile-landed-and-new` holds `## 190.` through `## 205.`. `main` now carries live
`## 202.`, `## 203.` and `## 205.` through `## 229.`, and `204` is in the deleted-numbers registry.
So three of its numbers are live entries belonging to something else, and one is a tombstone.

**Why a collision is silent rather than loud.** `scripts/lib/agent-board/handoff-import.mjs`'s
`makeItem` is first-occurrence-wins, so a colliding merge keeps main's entry and drops the incoming
one without a conflict, a marker, or a failing gate.

It also carries a live defect filed under the tombstoned number: seven selection bars label a deselect
`Clear` where Adobe says `Deselect`. The entry text is still true; only its number is wrong.

**Fix.** Re-derive the branch's entries on fresh numbers from `main`. Do not merge it as-is, and do
not renumber it inside its own worktree — the collision is with `main`, so the resolution has to be
made against `main`.

## 3. No gate detects duplicate HANDOFF section numbers

Today's collisions passed `tsc`, `build`, the full suite and the e2e unit suite. Nothing in the
repository asserts that live `## N.` headings are unique, ascending, or disjoint from the deleted
registry.

This is the check that was run by hand during this audit, and it is cheap:

```bash
rg -o --no-filename '^## [0-9]+\.' HANDOFF.md | rg -o '[0-9]+' > /tmp/live.txt
sort /tmp/live.txt | uniq -d                 # duplicates — must print nothing
awk 'NR>1 && $1<=p {print p" -> "$1} {p=$1}' /tmp/live.txt   # ordering — must print nothing
```

**Fix.** Add both as assertions in `scripts/__tests__/`, next to the existing handoff-import and
citation gates. This is the one item on this list that prevents a whole class rather than one instance.

## 4. The primary checkout is exempt from the rule its own test states

`scripts/__tests__/worktree-inventory.test.mjs` requires that a worktree holding work that is in no
commit, with nothing curated about it, be reported **at-risk**. When four files sat staged in the
shared main checkout, `classify()` instead reported:

```
ph (curated: NONE): ahead=0 onMain=true dirty=4 untracked=0 -> status=landed recommendation=keep
```

which is the opposite, and it took the suite red. The trigger was incidental — any session leaving
uncommitted work in the shared checkout reproduces it — but the disagreement is real: the test asserts
a rule for _every_ worktree and the implementation exempts the primary one.

**Fix.** Decide which is true and encode it. Either the primary checkout is exempt and the test says
so explicitly, or it is at-risk when dirty. Today the two disagree.

## 5. A comment miscounts the file it describes

`scripts/__tests__/suite-budgets.test.mjs` says "Two tests in `worktree-inventory.test.mjs` … declare
`60_000`". `worktree-inventory.test.mjs` contains 22 occurrences of `60_000`, and three tests call
`liveInventory()` against the live fleet.

**Why it is more than cosmetic.** Those three tests are the ones that read the real worktree
population, so the comment is the only thing telling a reader why a live-fleet read is legitimate. A
count that is wrong by one understates the coupling.

**Fix.** Correct the number.

## 6. Merge metadata that cannot be parsed

`c9ec5292` carries literal `\n` two-character sequences in its commit message rather than newlines, and
has no `Chat:` trailer. `AGENTS.md` requires the trailer, and the `Branch:` trailer every merge into
`main` must carry is unparseable from that message.

**Fix.** Re-commit the change with real newlines and the trailer. Do not amend published history.

## 7. Branches that must not be landed

Recorded so nobody re-derives them:

| branch                                                                                                                  | why not                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fix/append-boundary-preconditions`                                                                                     | head `5` was dropped when its base moved to `17be38f4`; superseded duplicate of `history/migration-s0-s1-2026-10-04`                                             |
| `fix/paste-document-space`                                                                                              | the exact inverse of the landed paste fix — asserts `{35, 30}` where the code now produces `{47, 37}`                                                            |
| `test/infra-suite-hardening`                                                                                            | tip tree is byte-identical to its merge base; merging yields an empty commit                                                                                     |
| `docs/review-architecture-fixes-2026-10-04`, `docs/review-e2e-fixes-2026-10-04`, `docs/review-handoff-fixes-2026-10-04` | patch-id identical to commits already on `main`                                                                                                                  |
| `docs/citation-anchors`                                                                                                 | its own commit message says SUPERSEDED, do not land                                                                                                              |
| `refactor/store-safe-high-roi-task`, `refactor/history-shadow-immutability-task`                                        | hold commits already on `main` under different shas (`682f1119`→`a190ed4e`, `17c71ce2`→`487a1922`, `2f071bcc`/`7f193c16`→`84d77de5`); they can never be "landed" |

## 8. Three test blocks from `a05607c8` are still unasserted

`a05607c8` landed 19 of its 22 test blocks. Three were dropped in the merge and nothing replaced them:

- **empty-fold layer order** — a document whose fold leaves one layer gets order `1`, not `0`;
- **merge naming** — two layers that merge onto the same name get `dupe1` / `dupe2`;
- **ellipsify** — a long middle segment abbreviates to `src/…/out.png`.

The runtime rule for the first two lives in `createLayerSource` in `src/contexts/layer-utils.ts`;
`ellipsify` lives in `src/util/string.ts` and is covered for the string helper but not for the layer
name that uses it.

**Fix.** Re-derive the three cases against `createLayerSource` rather than restoring the dropped
blocks, so they test the rule that production uses. This is the same correction that was applied to
the parity oracle: the test had carried its own second copy of the naming rule and drifted from it.

## What was resolved, for contrast

Not problems, recorded so the absence is not mistaken for neglect: the history parity oracle now calls
`createLayerSource` instead of a hand-written duplicate; the paste centring expression and its three
re-pointed assertions agree with the coordinate contract; the two dead replay coordination modules are
deleted with their tests and their citations retired; a post-publication failure is contained instead
of dispatched twice; and the two frozen-entry-reuse implementations were reconciled onto one API.
