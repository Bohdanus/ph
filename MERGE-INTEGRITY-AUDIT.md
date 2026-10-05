# Merge integrity audit

A point-in-time record of what the concurrent-branch work left unresolved, measured against `main`
after the three history/store landings. It is a **report, not a home**: actionable defects live in
[`HANDOFF.md`](HANDOFF.md) and [`e2e/OPEN_PROBLEMS.md`](e2e/OPEN_PROBLEMS.md), and each item below
says which, if any. Nothing here is a changelog and nothing here should be cited as the state of the
code — re-derive from the tree, because two items on this list were resolved by other sessions while
it was being written.

Every command in this file is one that was actually run, and its output is what was observed.

## 1. One git operation is still open in another worktree

**This is the whole hazard class in one place.** A worktree with `MERGE_HEAD` set or a rebase in
progress holds resolution state that no commit records, no branch names, and `git status` in the main
checkout cannot see.

| worktree           | branch                        | state            | unmerged paths |
| ------------------ | ----------------------------- | ---------------- | -------------- |
| `land-header-menu` | `land/header-menu-2026-10-04` | `MERGE_HEAD` set | **3**          |

**One such worktree remains open; the three this audit first listed have since been resolved or
removed.**

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

## 2. An orphan branch collides with `main` on 112 of its 128 handoff numbers, and 11 of those are different entries

`docs/handoff-reconcile-landed-and-new` is a whole-file rewrite of `HANDOFF.md`, not a patch to it:
it carries 128 `## N.` headings, and **112 of those numbers are live entries on `main`**. 101 of the
112 are the _same_ entry on both sides, so only **11** are genuine subject-collisions. Every number the
branch alone carries — `47`, `67`, `73`, `87`, `88`, `89`, `91`, `92`, `112`, `128`, `175`, `191`,
`192`, `196`, `200` and `204` — is in this file's deleted-numbers registry, so **the branch holds no
entry that `main` lacks**.

```bash
comm -12 \
  <(rg -o --no-filename '^## [0-9]+\.' HANDOFF.md | rg -o '[0-9]+' | sort -u) \
  <(git show docs/handoff-reconcile-landed-and-new:HANDOFF.md | rg -o '^## [0-9]+\.' | rg -o '[0-9]+' | sort -u)
```

**Why a collision is silent rather than loud.** `scripts/lib/agent-board/handoff-import.mjs`'s
`makeItem` is first-occurrence-wins, so a colliding merge keeps main's entry and drops the incoming
one without a conflict, a marker, or a failing gate. At 11 collisions the result is not a partially
merged document; it is main's document, and the branch's 16 remaining numbers are tombstones that
merging would resurrect.

The branch also carries a live defect filed under the tombstoned number 204: seven selection bars
label a deselect `Clear` where Adobe says `Deselect`. That entry is no longer at risk of loss —
`HANDOFF.md` §230 now carries it on a number of its own.

**Fix.** Read the branch's 11 colliding entries and keep main's version of each; none of them is a
defect main is missing. **Do not merge it at all** — it would resurrect 16 tombstoned numbers. Its
whole-file-rewrite shape is the hazard, not its content.

## 3. HANDOFF numbering is gated; what is not gated is a suffixed heading

An earlier draft of this section claimed no gate detects duplicate `HANDOFF` section numbers, and
prescribed adding one. **That was wrong**, and adding the gate would have been redundant.
`scripts/__tests__/handoff-import.test.mjs` asserts all three properties against the real
`HANDOFF.md`, not a fixture:

| property                            | assertion                                                                 | why it is not blind                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| a duplicate `## N.`                 | `produces one item per numbered heading, and no item for a prose section` | it counts headings in the **raw text** and compares to the parser's item count, so a number `makeItem` drops makes the two diverge |
| ascending order                     | `keeps HANDOFF.md's own numbering, so every origin there is a number`     | asserts the parsed numbers are already sorted, and document order is preserved                                                     |
| live number in the deleted registry | `does not file a number the document records as finished`                 | asserts no parsed item's number is in the document's own dead set                                                                  |

Verified by injecting a live `## 47.` (a tombstoned number): it parses to one item keyed
`HANDOFF.md#47` while `47` is in the dead set, so the third assertion fails as intended. All three
properties are therefore enforced, and this section records no work.

Two assertions in the tree _look_ like duplicate detectors and are not, which is why this was
mislabelled for a while: `agents-citations.test.mjs`'s `liveHandoffNumbers` builds a `Set` from the
headings, which collapses a duplicate before any assertion reads it, and
`expect(new Set(parsed.items.map((item) => item.origin)).size).toBe(parsed.items.length)` holds by
construction because the parser already removed the duplicate. Neither is load-bearing.

**The one real gap is a suffixed heading.** The count test's pattern is `\d+\b`, which does not match
`## 15a.`, while the citation gate's `(\d+[a-z]?)` does. So a suffixed heading is excluded from the
count that would catch a duplicate, and `## 15a.` on this file produces **no board item at all** —
`NUMBERED` maps `15a` onto `15`, which live `## 15.` already claimed. Live entry `## 77.` is the
entry for that; it is not covered here.

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

| branch                                                                                                                  | why not                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fix/append-boundary-preconditions`                                                                                     | the branch exists at `75be2fa3`, but this row's own evidence does not: `17be38f4` is not a valid object in this repository and no branch named `history/migration-s0-s1-2026-10-04` exists, so neither the base it moved to nor the branch it duplicated can be checked. The do-not-land verdict stands on the head being a duplicate of the landed append work, not on the citation |
| `fix/paste-document-space`                                                                                              | the exact inverse of the landed paste fix — asserts `{35, 30}` where the code now produces `{47, 37}`                                                                                                                                                                                                                                                                                |
| `test/infra-suite-hardening`                                                                                            | tip tree is byte-identical to its merge base; merging yields an empty commit                                                                                                                                                                                                                                                                                                         |
| `docs/review-architecture-fixes-2026-10-04`, `docs/review-e2e-fixes-2026-10-04`, `docs/review-handoff-fixes-2026-10-04` | patch-id identical to commits already on `main`                                                                                                                                                                                                                                                                                                                                      |
| `docs/citation-anchors`                                                                                                 | its own commit message says SUPERSEDED, do not land                                                                                                                                                                                                                                                                                                                                  |
| `refactor/store-safe-high-roi-task`, `refactor/history-shadow-immutability-task`                                        | hold commits already on `main` under different shas (`682f1119`→`a190ed4e`, `17c71ce2`→`487a1922`, `2f071bcc`/`7f193c16`→`84d77de5`); they can never be "landed"                                                                                                                                                                                                                     |

## 7. Three test blocks from `a05607c8`, dropped by a merge, were restored by `15252a4a`

`a05607c8` added three `it()` blocks to `durable-replay.layer-operations.test.ts`; a merge dropped
all three, and `15252a4a` restored all three byte-identically on `main`:

- `create-layer numbers the first layer of an empty document at 1, not 0` — asserts order `1` and name
  `'Blank 1'` on a baseline carrying no layers;
- `merge-document names and places its result by the runtime rule, against the pre-merge stack` —
  asserts name `'Blank 2'` at order 2 against a pre-merge maximum of 1, and that only the result
  survives;
- `create-layer truncates a long image name through the runtime rule` — asserts `'x'.repeat(17)... 1`
  from a 40-character name.

**Fix.** None. `deriveLayerNameAndOrder` owns the derivation and both `createLayerSource` and the
converter read it, so the blocks cannot drift from it. `ellipsify` is covered for the helper in
`src/util/__tests__/string.test.ts` and for the layer name by the third block.

## What was resolved, for contrast

Not problems, recorded so the absence is not mistaken for neglect: the history parity oracle now calls
`createLayerSource` instead of a hand-written duplicate; the paste centring expression and its three
re-pointed assertions agree with the coordinate contract; the two dead replay coordination modules are
deleted with their tests and their citations retired; a post-publication failure is contained instead
of dispatched twice; the two frozen-entry-reuse implementations were reconciled onto one API; and
`suite-budgets.test.mjs`'s miscount of the live-fleet tests was corrected to three.

## Three findings this audit got wrong first

Recorded because the corrections are the useful part.

1. It claimed the orphan branch collided on three numbers; a `comm` over two differently-sorted files
   produced a fabricated list.
2. It then claimed `117` of `128`, which its own `comm` recipe does not produce — the real
   number-collision count is **112**, and the number a reader should act on is the **11** whose subject
   differs. 101 of the 112 are the same entry on both sides. Separately, it described the branch as
   holding "a few genuinely-new numbers"; there are none, and every one of its 16 remaining numbers
   is a tombstone.
3. It claimed no gate detects duplicate `HANDOFF` section numbers and prescribed adding one. Three
   assertions already enforce uniqueness, ascending order, and disjointness from the deleted registry;
   see §3. Two other assertions look like duplicate detectors and are not, which is what made the gap
   look real.

All three were caught by re-running each command against the tree immediately before landing, which is
the whole argument for §1.
