# Merge integrity audit

A point-in-time record of what the concurrent-branch work left unresolved, measured against `main`
after the three history/store landings. It is a **report, not a home**: actionable defects live in
[`HANDOFF.md`](HANDOFF.md) and [`e2e/OPEN_PROBLEMS.md`](e2e/OPEN_PROBLEMS.md), and each item below
says which, if any. Nothing here is a changelog and nothing here should be cited as the state of the
code — re-derive from the tree, because two items on this list were resolved by other sessions while
it was being written.

Every command in this file is one that was actually run, and its output is what was observed.

## 1. Three git operations are still open in other worktrees

**This is the whole hazard class in one place.** A worktree with `MERGE_HEAD` set or a rebase in
progress holds resolution state that no commit records, no branch names, and `git status` in the main
checkout cannot see.

| worktree                 | branch                      | state                      | unmerged paths |
| ------------------------ | --------------------------- | -------------------------- | -------------- |
| `sweep-land`             | `integration/sweep-land`    | `MERGE_HEAD` set           | **5**          |
| `migration-review-sweep` | detached                    | `rebase-merge` in progress | **12**         |
| `header-menu-structure`  | `fix/header-menu-structure` | `MERGE_HEAD` set           | 0              |

```bash
find .git/worktrees -maxdepth 2 \( -name MERGE_HEAD -o -name rebase-merge \) -print
```

A fourth, `audit/damage-followup-2026-10-04`, was on this list when the audit was started and its
owner completed and landed the merge. It is here as the worked example of the fix, not as a problem.

**Why the row with 0 unmerged paths still matters.** A merge whose conflicts were all resolved but
never committed reports a clean tree. `git merge --abort` throws the resolution away;
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

## 2. An orphan branch collides with `main` on 117 of its 128 handoff numbers

`docs/handoff-reconcile-landed-and-new` is a whole-file rewrite of `HANDOFF.md`, not a patch to it:
it carries 128 `## N.` headings, and **117 of those numbers are live entries on `main`** — including
`1`, `10`, and every number from `101` through `205` that main still owns. `204` is in the
deleted-numbers registry.

```bash
sort -u <(rg -o --no-filename '^## [0-9]+\.' HANDOFF.md | rg -o '[0-9]+') > /tmp/live.txt
comm -12 /tmp/live.txt <(git show docs/handoff-reconcile-landed-and-new:HANDOFF.md \
  | rg -o '^## [0-9]+\.' | rg -o '[0-9]+' | sort -u)
```

**Why a collision is silent rather than loud.** `scripts/lib/agent-board/handoff-import.mjs`'s
`makeItem` is first-occurrence-wins, so a colliding merge keeps main's entry and drops the incoming
one without a conflict, a marker, or a failing gate. At 117 collisions the result is not a partially
merged document; it is main's document with the branch's few genuinely-new numbers grafted on.

The branch also carries a live defect filed under the tombstoned number 204: seven selection bars
label a deselect `Clear` where Adobe says `Deselect`. The entry text is still true; only its number
is wrong.

**Fix.** Extract the branch's genuinely-new entries and re-file them on fresh numbers from `main`.
Do not merge it as-is, and do not renumber it inside its own worktree — the collision is with `main`,
so the resolution has to be made against `main`.

## 3. No gate detects duplicate HANDOFF section numbers

Today's collisions passed `tsc`, `build`, the full suite and the e2e unit suite. Nothing in the
repository asserts that live `## N.` headings are unique, ascending, or disjoint from the deleted
registry. `handoff-import.test.mjs` derives its corpus from the document and would not notice.

This is the check that was run by hand during this audit, and it is cheap:

```bash
rg -o --no-filename '^## [0-9]+\.' HANDOFF.md | rg -o '[0-9]+' > /tmp/live.txt
sort /tmp/live.txt | uniq -d                            # duplicates — must print nothing
awk 'NR>1 && $1<=p {print p" -> "$1} {p=$1}' /tmp/live.txt   # ordering — must print nothing
```

**Fix.** Add both as assertions in `scripts/__tests__/`, next to the existing handoff-import and
citation gates. This is the one item on this list that prevents a whole class rather than one instance.

## 4. The primary checkout is exempt from the rule its own test states

`worktree-inventory.test.mjs`'s `it('protects that shape in a worktree NOBODY has written anything
down about')` requires that a worktree holding work that is in no commit, with nothing curated about
it, be reported **at-risk**. When four files sat staged in the shared main checkout, `classify()`
instead reported:

```
ph (curated: NONE): ahead=0 onMain=true dirty=4 untracked=0 -> status=landed recommendation=keep
```

which is the opposite, and it took the suite red. The trigger was incidental — any session leaving
uncommitted work in the shared checkout reproduces it — but the disagreement is real: the test asserts
a rule for _every_ worktree and the implementation exempts the primary one.

**Fix.** Decide which is true and encode it. Either the primary checkout is exempt and the test says
so explicitly, or it is at-risk when dirty. Today the two disagree.

## 5. Merge metadata that cannot be parsed

`c9ec5292` carries literal `\n` two-character sequences in its commit message rather than newlines,
and has no `Chat:` trailer:

```
Merge branch 'fix/merge-conflict-repair-2026-10-04' into main\n\nBranch: fix/merge-conflict-repair-2026-10-04
```

`AGENTS.md` requires the trailer, and the `Branch:` trailer every merge into `main` must carry is
unparseable from that message — so the merge cannot be traced back to its branch by tooling.

**Fix.** Re-commit the change with real newlines and the trailer. Do not amend published history.

## 6. Branches that must not be landed

Recorded so nobody re-derives them:

| branch                                                                                                                  | why not                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fix/append-boundary-preconditions`                                                                                     | head `5` was dropped when its base moved to `17be38f4`; superseded duplicate of `history/migration-s0-s1-2026-10-04`                                             |
| `fix/paste-document-space`                                                                                              | the exact inverse of the landed paste fix — asserts `{35, 30}` where the code now produces `{47, 37}`                                                            |
| `test/infra-suite-hardening`                                                                                            | tip tree is byte-identical to its merge base; merging yields an empty commit                                                                                     |
| `docs/review-architecture-fixes-2026-10-04`, `docs/review-e2e-fixes-2026-10-04`, `docs/review-handoff-fixes-2026-10-04` | patch-id identical to commits already on `main`                                                                                                                  |
| `docs/citation-anchors`                                                                                                 | its own commit message says SUPERSEDED, do not land                                                                                                              |
| `refactor/store-safe-high-roi-task`, `refactor/history-shadow-immutability-task`                                        | hold commits already on `main` under different shas (`682f1119`→`a190ed4e`, `17c71ce2`→`487a1922`, `2f071bcc`/`7f193c16`→`84d77de5`); they can never be "landed" |

## 7. Three test blocks from `a05607c8` are still unasserted

`a05607c8` landed 19 of its 22 test blocks. Three were dropped in the merge and nothing replaced them:

- **empty-fold layer order** — a document whose fold leaves one layer gets order `1`, not `0`;
- **merge naming** — two layers that merge onto the same name get `dupe1` / `dupe2`;
- **ellipsify** — a long middle segment abbreviates to `src/…/out.png`.

The runtime rule for the first two lives in `createLayerSource` in `src/contexts/layer-utils.ts`;
`ellipsify` lives in `src/util/string.ts` and is covered for the string helper but not for the layer
name that uses it.

**Fix.** Re-derive the three cases against `createLayerSource` rather than restoring the dropped
blocks, so they test the rule that production uses. This is the same correction that was applied to
the parity oracle: that test had carried its own second copy of the naming rule and drifted from it.

## What was resolved, for contrast

Not problems, recorded so the absence is not mistaken for neglect: the history parity oracle now calls
`createLayerSource` instead of a hand-written duplicate; the paste centring expression and its three
re-pointed assertions agree with the coordinate contract; the two dead replay coordination modules are
deleted with their tests and their citations retired; a post-publication failure is contained instead
of dispatched twice; the two frozen-entry-reuse implementations were reconciled onto one API; and
`suite-budgets.test.mjs`'s miscount of the live-fleet tests was corrected to three.

## Two findings this audit got wrong first

Recorded because the corrections are the useful part. An earlier draft claimed the orphan branch
collided on three numbers; a `comm` over two differently-sorted files produced a fabricated list, and
the real figure is 117 of 128. It also listed a fourth open merge and a miscounted comment that
another session had already fixed between the measurement and the write-up. Neither would have been
caught by anything except re-running the command against the tree immediately before landing — which
is the whole argument for items 1 and 3.
