# Overnight Sweep Review & Audit — 2026-10-08

Review of the overnight sweep work and the `fix-doc-inconsistencies` worktree
against `main` at `c43a7c24`. Method: every staged file was compared
byte-for-byte against `main`, and every contested documentation claim was
checked against the source tree.

## 1. What the overnight sweep already landed on `main`

The overnight sweep merged a sequence of doc- and test-hardening branches into
`main`, with the substantive code in commit `999074f7` ("fix: preserve
coalesced tool option updates") — the Patch Tool diffusion fix
(`src/tools/patch.ts`, `src/tools/__tests__/patch.test.ts`) and the
CloneStamp/HealingBrush/SpotHealing coalescing fix, plus `PatchIcon.tsx` and
the SidebarLeft `patch: Icon` test-mocks. `main` (`c43a7c24`) is green:
`tsc`, `build`, citations (14), tool-processors (297), shape/paint-tools (196),
tool-descriptions (7) all pass. The dead branch `repair/index-after-pre-push-failure`
was **not** landed (its diff is stale; `main` already carries the `exact:true`
locator).

## 2. Audit of `fix-doc-inconsistencies`

The worktree diverged from `main` at `80843f6c`, so it was merged with `main`
(in-progress merge of `3528c777` into branch tip `5843d5e8`). Compared file-by-file
against `main`:

### 2.1 Redundancy — 81 of 88 files are identical to `main`

81 of the 88 staged files are byte-identical to `main`. They re-implement work
the overnight sweep already committed (`999074f7`, `c43a7c24`), including all
Patch Tool source, the toolbar coalescing edits, the four new chat-history
skill files, `AGENTS.md`, `HANDOFF.md` (the _main_ version), `.husky/pre-push`,
and the handoff-import ambiguity logic + tests. The worktree's own copies of
these were superseded by the merge.

### 2.2 Four docs are erroneous against the source (reverted to `main`)

Four staged docs contradict the actual code and were reverted to `main`'s
correct versions in the working tree:

1. **`docs/PHOTOSHOP-UX.md`** — claims "the flyout has six … `Star` is the
   missing one" and "Star is the best-documented absent rail entry." **False:**
   `toolbar-mapping.ts` (identical in this worktree and `main`) declares
   `{ label: 'Star Tool', name: 'shape', figure: 'star' }`, and the shape flyout
   carries seven entries — Rectangle, Ellipse, Line, Triangle, Polygon, Star,
   Custom Shape. `main`'s "seven … all present" is correct.
2. **`docs/TOOLS-INVENTORY.md`** — deletes the correct "Star is now implemented …
   `figure: 'star'` … `FigureType` includes `'star'`" paragraph. Star is a
   figure inside the `shape` tool, hence implemented; the worktree's "absent"
   re-labelling is misleading.
3. **`docs/ARCHITECTURE.md`** — moves the Sharpen `localStorage` citation from
   `HANDOFF.md` §138 to §98. §138 is "Two tool options bars justify their
   clamping with a `localStorage` round trip that no code performs" (the Sharpen
   claim); §98 is "The console log is the app's whole error channel" (unrelated).
   It also rewrites the `toolProcessors` count from "43 entries" to "24,"
   conflating the 43 `PixelToolName` keys of `Record<PixelToolName, …>` with the
   ~27 distinct processor functions; this does not match the documented `awk`
   counting recipe. `main`'s versions are correct.
4. **`docs/TOOLS-RESEARCH-BRIEF.md`** — changes the skill line count 4,690 →
   4,686. `wc -l` on `.skills/photoshop-tool-creation.md` is 4689, so 4,690
   (`main`) is the correct rounded figure and 4,686 stales it.

### 2.3 `HANDOFF.md` — correction to my own audit; §82 is legitimate, not redundant

My first pass compared the _merge result_ (which the merge auto-resolved to
`main`'s `HANDOFF.md`) to `main`, and wrongly concluded `HANDOFF.md` was
"redundant." **That was an error.** The _branch_ (`5843d5e8`) carries committed
content `main` does not, and the merge silently discarded it:

- A new entry **`## 82. The parser retires a LIVE numbered heading that ends
in a status word, silently`**, a measured defect filing on
  `scripts/lib/agent-board/handoff-import.mjs` (`DEAD_HEADING`/`assemble`) with
  measured rows, fixture test references
  (`handoff-import.test.mjs`), and an `it.fails` tripwire. It is evidence-based
  and references provenance commits (`a3f1dcc`, `bd137d0`, `eba42f8`) absent
  from `main`. This is **legitimate filed work**, not an erroneous doc.
- The branch also replaced `main`'s `### Items 0, 2-3, … 220, 222, … — deleted`
  machine-readable retirement heading with `### Items 127 — deleted`.

A prior session note claimed this worktree was "removing §82"; the diff shows the
opposite — it _adds_ §82. The branch note is stale; the branch content is the
ground truth. §82 is preserved in commit `5843d5e8` even though the merge result
currently holds `main`'s `HANDOFF.md`.

### 2.4 `docs/ORCHESTRATION.md` — borderline (heading bump + dropped statistic)

The branch tightens the "Find the trap you are in" lead
(drops the "97 of 3,244 sessions — 3.0% — have ever opened it" data point) and
promotes `### Landing` → `## Landing`, and removes a `.husky/pre-push` stale
block note. None of this is factually false, but the dropped statistic is
unverified and the heading promotion is unjustified, so it was reverted to
`main`'s version pending a deliberate decision.

### 2.5 `docs/README.md` — conflict resolved (the one genuine improvement)

`main` listed skills as an inline paragraph; the worktree's HEAD held a six-row
table that omitted the four chat-history skills. Resolved to a **ten-skill
table** (all four chat-history skills added, "one job" summaries taken from each
skill's `description` field), then normalised with `prettier --write`.

## 3. Verification

- `npm run tsc` — clean (the worktree's source is identical to green `main`).
- No conflict markers remain in `docs/`; `README.md` is prettier-formatted with
  all ten skill rows.

## 4. Merge state — BLOCKED by `merge-takeover-guard`, intentionally not forced

`git commit` to finish the merge is **refused** by
`merge-takeover-guard.mjs`:

> REFUSING this merge — 2 path(s) would drop committed work.
> `HANDOFF.md` [whole-file-takeover] … drops 109 line(s) the merged-into side had
> `docs/ORCHESTRATION.md` [whole-file-takeover] … drops 2 line(s)

The guard is correct: completing the merge takes `main`'s `HANDOFF.md` and
`docs/ORCHESTRATION.md` wholesale, silently discarding the branch's §82 defect
filing and ORCHESTRATION edits. I did **not** bypass with `--no-verify`; doing so
would silently drop §82. The branch's side is equally a wholesale takeover
(bypassing the other way would drop `main`'s retention-list edit), so neither
side can be taken without a deliberate **union**. That union for `HANDOFF.md`
(in particular, reconciling `main`'s `### Items 0, 2-3, … — deleted` heading
with the branch's §82 + `### Items 127 — deleted`) needs an editor's judgment,
not a merge strategy — it is out of scope for a quick wrap-up.

## 5. Current state of the worktree

- `docs/README.md` — resolved to the ten-skill table (staged).
- `docs/ARCHITECTURE.md`, `docs/PHOTOSHOP-UX.md`, `docs/TOOLS-INVENTORY.md`,
  `docs/TOOLS-RESEARCH-BRIEF.md`, `docs/ORCHESTRATION.md` — reverted to `main`
  in the working tree (staged).
- The merge is **uncommitted and gate-blocked** on `HANDOFF.md` and
  `docs/ORCHESTRATION.md`; §82 remains preserved in `5843d5e8`.
- 81 other staged files are byte-identical to `main` (merge no-ops for landing).

## 6. Recommendations

1. **Do not force the merge.** Reconcile `HANDOFF.md` (§82 + retention heading)
   and `docs/ORCHESTRATION.md` as a genuine union, then complete the merge.
2. When the union is done, landing `fix/doc-inconsistencies` onto `main` carries
   **only** `docs/README.md` (ten-skill table) plus this audit doc as net new
   content; everything else is already on `main`.
3. Clean up the stale `healing-brush-options-coalescing` worktree (base
   `101dce3f`) — a strict duplicate of the `999074f7` coalescing fix — via
   `npm run dispose` once its session is confirmed dead.
