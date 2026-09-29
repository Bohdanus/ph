/**
 * The hand-written half of the inventory: what each worktree is FOR, which
 * handoff and board issues it tracks, and — where a human found something git
 * cannot see — what an operator must know before deleting it.
 *
 * WHY THIS IS A SOURCE FILE AND NOT GENERATED
 * -------------------------------------------
 * The mechanical half is regenerated on every run and would be worthless if a
 * human could not add the one fact that matters: that a worktree which looks
 * empty is holding the only copy of a finding. A generator cannot know that
 * `ps-tool-playbook` contains the sole record of a live AGENTS.md defect, or
 * that a board issue filed forty minutes ago has already gone stale. Those are
 * judgements, and this file is where they are written down so that a
 * regeneration preserves them instead of erasing them.
 *
 * DO NOT PUT A COUNT IN A SUMMARY
 * --------------------------------
 * An earlier draft of this file said "32 paths uncommitted" for `ps-pixel-tools`
 * and "12 commits behind" for `repair-dialogs-text`. Both were wrong within
 * hours, and nothing could catch them: a curator cannot keep a number current
 * across 78 worktrees, and a wrong number in a document whose whole purpose is
 * to be trusted is worse than no number. `dirty`, `untracked`, `ahead` and
 * `behind` are already on every generated record. Describe WHAT is here and
 * leave the arithmetic to the generator.
 *
 * `mustNotPrune` IS A TRIPWIRE, NOT A SUGGESTION
 * ----------------------------------------------
 * Setting it makes the inventory refuse to call a worktree prunable even when
 * git reports it as landed and clean. It exists for the case that has already
 * cost this repository real work: a branch at an old main commit with 0
 * commits ahead, reporting itself as merged, while the working tree holds
 * files that exist on no ref at all.
 *
 * `landed` is ASSERTED AGAINST GIT, NOT BELIEVED
 * ----------------------------------------------
 * It records a human's claim that the work is on main. The suite re-derives
 * the same fact from `git merge-base --is-ancestor` and fails when they
 * disagree, because an earlier version of this file asserted `landed: true` for
 * a worktree git reported as holding uncommitted work — and nothing noticed,
 * since no test read the field.
 *
 * A new entry needs only `name` plus whatever is known. Unknown fields are
 * `null` in the output, never guessed.
 */

export const CURATED = {
  /* ---------------------------------------------------------------- board */
  'agent-board': {
    summary:
      'The swarm board itself: scripts/agent-board.mjs and its node:sqlite storage under the common git directory.',
    note: 'The board work itself is on main. A later `wip(salvage)` commit (3f1d0e2) sits on this branch on top of that, carrying an uncommitted board-schema migration test suite that was on no ref when the owning worktree was swept. It does not pass as it stands — one of the 74 tests in `agent-board.test.mjs` fails on this branch — so the claim is retracted rather than asserted. Landing it is a real fix, not a deletion.',
  },
  'board-file-index': {
    summary:
      'One-commit board fix: a file named by an open issue now counts as held, so two agents cannot edit the same file.',
  },
  /* ------------------------------------------------- unit-test review 2026-09-28 */
  'test-review-vacuous': {
    summary:
      'Unit tests that could not fail: zero-assertion tests in useRect and Transform, a type-only test in layer-presentation, a status-union tautology in StoreContext.durable-boundary, an invented-key test in ToolbarPlaceholder, and a title that promised a name assertion LayersTab.store never made. The four empty tests are deleted and the rest now assert production behaviour.',
    note: 'The branch that removed tests that asserted nothing added three assertions that also asserted nothing, which its own review caught; those were then made falsifiable. Every strengthening was proven by breaking the expected value and pasting the red output.',
  },
  'test-review-harness': {
    summary:
      'A guard for the four AGENTS.md test traps — one setup file, e2e/** out of the root project, e2e/** out of app coverage, and scripts/**/*.test.mjs on the vmThreads pool — none of which any test enforced. harness-integrity.test.ts had no filesystem access at all, so editing vitest.config.ts failed nothing in the repo.',
    note: 'harness-integrity.test.ts itself shipped three expect() calls with no matcher chained, so the guard written to catch dead assertions had three; a review found them by AST scan and by breaking the config, and they are now asserted. `environment: jsdom` cannot be asserted from inside the root project because breaking it stops the file loading — the omission is a real limit, not an oversight.',
  },
  'test-review-leaks': {
    summary:
      'Test-isolation leaks: module-scope state restored on the line after the assertion rather than in a hook, global spies that outlived a failing assertion, jsdom prototype accessors deleted instead of restored, a shared documentElement classList, and a counter inside a vi.mock factory. Also the missing drawImage geometry assertion in clipboard, and an explicit clearMocks in vitest.config.ts.',
    note: 'The suite already depended on Vitest 5 defaulting clearMocks to true — 10 tests fail without it — but vitest.config.ts never said so, and the ~40 vi.clearAllMocks() call sites in the repo were no-ops. Stating the default makes the convention true by declaration rather than by an unstated framework version.',
  },
  'test-review-titles': {
    summary:
      'Tests whose title stated the opposite of their assertion: a reconcile test named "does not reconcile", three document-frame titles asserting the opposite of their bodies, and six durable-append mismatch cases collapsed to toBeTruthy(). Also a hollow materialization test, an unbounded release assertion, and the untested RightPanelVisibility default context.',
    note: 'The old toBeTruthy() had hidden a real gap: the "a foreign id" case was never a foreign id, so the id guard at history-append.ts:483 had zero coverage because the schema-version guard fired first. Fixing the fixture was what exposed the guard.',
  },
  'test-review-parser': {
    summary:
      "Regression tests for the handoff importer's end-anchored DEAD_HEADING, which main already landed: the separator forms, the prose-substring-is-live direction, trailing punctuation after a marker, and the inline **Item N** marker case.",
    note: "main fixed this defect independently in eba42f8 while this branch was in review, so only the additive test coverage landed — main's own two tests cover the §70 shape and nothing else. The letter-suffix half (`## 15a.` producing no item, and a suffixed retirement retiring its PARENT) was reverted as half-finished and is filed in HANDOFF.md instead: it introduces an origin shape that collides with the board's slug namespace and leaves an unguarded /#(\\d+)$/ in the test.",
  },
  'board-signal': {
    summary:
      'Two-commit board improvement: `ready` reports priority and the files at issue, and locking moves from a column into an object.',
    liveNote:
      'scripts/agent-board.mjs was being edited while this inventory was first generated; git may show the tree clean by now.',
  },
  'gates-e2e-truth': {
    summary:
      'Drops the dead Playwright browser-cache step from CI and retires the e2e handoff entry that removal retired.',
    landed: true,
  },

  /* --------------------------------------------------------------- paint */
  'brush-toolbar': {
    summary: 'Photoshop-shaped options bar (size, hardness, spacing) for the brush and pencil.',
    landed: true,
  },
  'fix-clip-gate': {
    summary:
      'An e2e guard that fails loudly when the viewport truncates a capture clip, instead of silently accepting it.',
    issues: [
      {
        ref: 'e2e/OPEN_PROBLEMS.md#P2-viewport-box-vs-page-relative-clip',
        title: 'boundingBox() is viewport-relative; a CDP capture clip is page-relative',
      },
    ],
  },
  'fix-color-replacement': {
    summary:
      'Builds the Color Replacement tool as a colour-substitution pass. Superseded by fix/spray-then-color-replacement, which merges it with the spray fix.',
    issues: [
      { ref: 'HANDOFF.md#58', title: 'brush/pencil/color-replacement all take the legacy-tool route' },
      { ref: 'HANDOFF.md#50', title: 'blend-mode gate scoped to brush, pencil, color-replacement' },
    ],
  },
  'fix-file-menu': {
    summary:
      'Three independent desktop-shell fixes: close the File menu when the discard prompt is declined, return null from calculateNewRect, and document the NewImageDialog onCreate contract.',
    note: 'Verify each of the three commits separately before landing; the tip subject is a docs commit and understates the branch.',
  },
  'fix-oracle': {
    summary: 'Layout-independent export oracle, including the helpers and the document-mapping unit test.',
    issues: [
      {
        ref: 'e2e/OPEN_PROBLEMS.md#P2-export-line-is-document-space',
        title: 'the export line is specified in document space',
      },
    ],
    note: 'A later `wip(salvage)` commit captured what was on no ref, so the work is on a ref now: this branch is ahead of main and not on it, and the working tree is clean. An earlier version of this entry said the work was uncommitted and that git called the branch merged; neither was true, and the flag that claim carried is retracted.',
  },
  'fix-oracle-axes': {
    summary:
      "Publishes the app's computed contain fit onto a DOM node and makes the export oracle layout-proof on both axes. Branched from integration/e2e-campaign-final, not from main.",
    issues: [
      {
        ref: 'e2e/OPEN_PROBLEMS.md#P2-drawline-applies-no-contain-scale',
        title: 'drawLine applies no contain scale, so its arguments are not document coordinates',
      },
    ],
    note: 'Overlaps fix/layout-independent-oracle, which holds the same work uncommitted. Resolve before landing either.',
  },
  'fix-paint-overlay': {
    summary:
      'Clears the tool overlay when a tool area unmounts, so a pending animation frame cannot paint into a dead region.',
    issues: [{ ref: 'HANDOFF.md#61', title: 'three overlay painters leave a pending animation frame across unmount' }],
  },
  'fix-spray': {
    summary: 'Gives the spray pen a real dab instead of a grey blur.',
    issues: [{ ref: 'HANDOFF.md#48', title: 'eraser is hard-edged; the fix is a stamp loop with per-dab alpha' }],
  },
  'fix-spray-cr': {
    summary:
      'Merges the spray-dab fix with the Color Replacement tool onto main. The only branch carrying both, and the one to take the colour-replacement work from.',
    issues: [
      { ref: 'HANDOFF.md#48', title: 'stamp loop / dab accumulator is the named fix' },
      { ref: 'HANDOFF.md#58', title: 'color-replacement takes the legacy-tool route' },
    ],
    note: 'The colour-replacement work that used to live only in this working tree is now committed here, so the earlier mustNotPrune flag is retracted. An earlier note said the tree was dirty and on no ref; git says it is clean and that file has two commits.',
  },
  'flake-paintbucket': {
    summary:
      'Names the two steps a paint-bucket e2e flake could not distinguish, turning an unnamed flake into a diagnosable one.',
    issues: [
      {
        ref: 'e2e/OPEN_PROBLEMS.md#P2-cached-canvas-box',
        title: 'a cached canvas box addresses a different pixel after a tool switch',
      },
    ],
  },
  'agents-doc-corrections': {
    summary:
      'Corrections to AGENTS.md and the worktree-inventory comments, from a code review of AGENTS.md against the tree. The structural orphan under "The board is cross-session" and the board-to-swarm regression it introduced; the toolbar section, which listed a shipped Color Replacement options bar as a PlaceholderTool and understated the hand-copied tool lists by fourfold; the mergeChecked semantics, which the document and the code comment both got wrong; the npx tsc --noEmit explanation, which named a missing exclude that does not exist; and the drifted enumerations (orphaned, the curated code sample, the at-risk third source). Adds mergeChecked to the --check watched list.',
    note: 'Short-lived documentation work. Safe to drop once the branch is an ancestor of main; the only non-AGENTS.md change that outlives the prose is the mergeChecked entry in scripts/worktree-inventory.mjs.',
  },
  'e2e-truth': {
    summary:
      'A documentation-truth pass over e2e/README.md, e2e/OPEN_PROBLEMS.md, e2e/global-setup.ts and TEST-FLAKES section 8, correcting claims a review found false against the tree: the spec and helper counts in the README tree block, two README bullets that attributed a pattern to a spec that does not follow it, the per-spec count in the headless guard comment, a deleted-entry check, and a cluster of drifted file:line citations. Its distinct value was largely taken by main while the branch was in review: main deleted the same stale Text-toolbar entry, cut OPEN_PROBLEMS by more than half its entries, and replaced the README count block with an explicit "keep no counts here" decision. NOT LANDED, and landing it now would re-introduce counts main deliberately removed.',
    note: 'Superseded, not wrong. The three findings that were still unique at review time were the rotted cdp-helpers and canvas-helpers citation clusters (main re-derived its own against a larger tree, so neither side’s line numbers can be taken verbatim across the merge) and one citation that moved rather than resolved. A reviewer wanting the residual must re-derive every number against current main; there is nothing here that contradicts the tree. The branch is ahead of main and not on it, so the inventory already refuses to prune it and no flag is owed on top of that.',
  },
  'concise-agents-guidance': {
    summary:
      'AGENTS.md restructured into a thin root plus three linked files: docs/TESTING.md (gates, tsc, test, lint, e2e, CI, headed-browser ban), docs/ORCHESTRATION.md (worktrees, the swarm board, the WORKTREES.json inventory, dead-agent recovery) and docs/PHOTOSHOP-UX.md (Tools-rail clone requirement and the five open violations). The worktree, merge, stash, claim, lease and disposal rules are preserved in the linked file, not deleted.',
    note: 'Documentation only, and the branch is ahead of main and not on it, so the inventory already refuses to prune it. No curated preservation flag is owed on top of that; add one only if the work turns out to exist on no ref.',
  },
  'polygon-marching-ants': {
    summary:
      'Polygon-selection marching ants: the ants component, the selection-ants hook, a new usePolylineAnts module and its tests, and edits to the lasso, magic wand and click tool areas.',
    note: 'A later `wip(salvage)` commit captured what was on no ref, so the work is on a ref now: this branch is ahead of main and not on it, and the working tree is clean. An earlier version of this entry said the work was uncommitted and that git called the branch merged; neither was true, and the flag that claim carried is retracted.',
  },
  'ps-pixel-tools': {
    summary:
      'Eraser, Magic Eraser, Paint Bucket and Clone Stamp as four tool areas plus toolbars, with their tools and tests.',
    issues: [
      { ref: 'HANDOFF.md#48', title: 'eraser is hard-edged; Flow and Airbrush are dead controls' },
      { ref: 'HANDOFF.md#49', title: 'bucket and magic eraser leave a hard edge; mask is a threshold' },
      { ref: 'HANDOFF.md#50', title: 'bucket has no blend mode; gate excludes paint-bucket' },
    ],
    note: 'The eraser family is the live target for #48/#49/#50. A later `wip(salvage)` commit captured what was on no ref, so the work is on a ref now: this branch is ahead of main and not on it, and the working tree is clean. An earlier version of this entry said the work was uncommitted and that git called the branch merged; neither was true, and the flag that claim carried is retracted.',
  },
  'no-scrollbars': {
    summary:
      'The app must paint no scrollbar on its outer chrome or the left tool rail, across a mac-desktop and iPad viewport matrix. Adds e2e/no-document-overflow.spec.ts, a `scrollbar-none` utility, and corrections to the measured rail geometry written into comments and handoff prose.',
    note: 'The load-bearing finding is that a scrollbar cannot be asserted in this headless Chrome at all: scrollbars are zero-width overlays there, so a gutter or edge-screenshot assertion would pass forever. The spec asserts content overflow instead, and pins the detector with a deliberate 4000px overflow first. An earlier version of this entry claimed the change was uncommitted and on no ref; it was not — the branch is on main and the tree is clean, so the rule and its comment are in commits and no flag is owed.',
  },
  'ps-brush-engine': {
    summary:
      'Typed-array brush tip, stroke buffer, stabilizer and airbrush, plus a blend-mode seam keyed on the value rather than the tool name.',
    issues: [
      { ref: 'HANDOFF.md#50', title: 'ps/brush-engine carries a copy of the blend-mode seam; drop rather than merge' },
    ],
    note: 'HANDOFF.md#50 states this branch is now redundant with main and should be dropped rather than merged.',
  },
  'ps-brush-stabilizer-aafa2a36cfa134d5': {
    summary: 'A brush stabilizer and an airbrush dwell emitter, rebased twice onto main-line commits.',
    issues: [{ ref: 'HANDOFF.md#48', title: 'airbrush absent; needs a per-stroke build-up accumulator' }],
  },
  'ps-brush-tip-core-72c775ad4e905a94': {
    summary:
      'A brush tip LUT and a two-stage flow/opacity stroke buffer — the dab primitive HANDOFF.md#48 asks for. The most directly wanted of the three unmerged brush branches.',
    issues: [
      {
        ref: 'HANDOFF.md#48',
        title: 'fix is a tip bitmap with falloff from Hardness and Flow accumulating per stroke',
      },
    ],
  },
  'ps-tool-expansion': {
    summary:
      'Shared pixel, flood-fill, brush-tip and paint-stroke foundations plus 11 new Photoshop tools wired into toolbar, canvas and options bar. Already on main.',
    landed: true,
    issues: [
      { ref: 'HANDOFF.md#49', title: "item 49's files are mid-migration on this branch" },
      {
        ref: 'FOCUSED-REVIEW-2026-09-28.md#5',
        title: 'flood-fill split-brain: two implementations, three colliding exports',
      },
    ],
  },
  'ps-tool-merge': {
    summary:
      'The landed merge of ps/tool-expansion onto main, adopting main’s responsive and history work plus the export-constant fix.',
    landed: true,
    issues: [
      { ref: 'FOCUSED-REVIEW-2026-09-28.md#5', title: 'flood-fill split-brain, now a statement about code on main' },
    ],
    note: 'FOCUSED-REVIEW §5 calls this the largest unmerged branch, by file count. That is stale: the merge is on main.',
  },
  'ps-tools-spine': {
    summary:
      'A blend-mode seam keyed on value, a gradient tool, a rounded-rectangle shape and the missing eraser-family icons.',
    issues: [
      { ref: 'HANDOFF.md#50', title: 'the committed seam is redundant with main; the uncommitted set is not' },
      { ref: 'HANDOFF.md#48', title: 'stamp loop / dab accumulator is the named fix' },
    ],
    note: 'A split decision: #50 says drop the committed seam, but the gradient tool, the rounded-rectangle shape and the eraser-family icons are on this branch only. An earlier version of this note called the last two untracked and on no ref; the working tree is clean and everything here is committed.',
  },

  /* ------------------------------------------------- wip preservation */
  'photoshop-fidelity': {
    summary:
      'A preservation snapshot of 23 previously uncommitted files as one wip(preservation) commit. Preservation, not reviewed work.',
    issues: [{ ref: 'HANDOFF.md#worktree-hygiene', title: 'the wip/* branches are preservation, not a review' }],
    note: 'Carries 12 modified production files on the history/durable-replay path.',
  },
  'ps-integration': {
    summary: 'A preservation snapshot of 34 previously uncommitted files as one wip(preservation) commit.',
    issues: [{ ref: 'HANDOFF.md#worktree-hygiene', title: 'wip/* preservation (34 files captured)' }],
    note: 'Its e2e/ half reads process.env.E2E_PORT where all 19 cleanup/* branches use PLAYWRIGHT_PORT. Merging as written breaks them.',
  },
  'ps-shape-geometry': {
    summary:
      'A preservation snapshot of 2 previously uncommitted files as one wip(preservation) commit. The smallest wip branch.',
    issues: [{ ref: 'HANDOFF.md#worktree-hygiene', title: 'wip/* preservation (2 files captured)' }],
  },
  'ps-ux-chrome': {
    summary:
      'A preservation snapshot of 42 previously uncommitted files as one wip(preservation) commit — the largest wip capture, and the worktree HANDOFF.md describes as having been misread as safe to delete.',
    issues: [{ ref: 'HANDOFF.md#worktree-hygiene', title: 'wip/* preservation (42 files captured)' }],
  },
  'fix-history-adapter-safety-tests': {
    summary:
      'Unit-test hardening of history-adapter, snapshotted as one wip(preservation) commit capturing a single test file.',
    issues: [{ ref: 'HANDOFF.md#worktree-hygiene', title: 'the wip/* branches are preservation, not a review' }],
  },
  'fix-layerstab-tests': {
    summary:
      'LayersTab unit-test hardening as one wip(preservation) commit: four new LayersTab suites, a shared fixture, a vitest config and scratch iterations.',
    issues: [
      { ref: 'AUDIT-STASHED-DOCS.md#22', title: 'LayersTab.test.tsx asserted mock payloads over a frozen store' },
      { ref: 'TEST_ISSUES.md#2.2', title: 'LayersTab.test.tsx asserts mock payloads over a frozen store' },
    ],
    note: 'Read four of the seven captured files as scratch iterations, not finished suites.',
  },
  'fix-replay-coordinator-tests': {
    summary:
      'Unit-test hardening of replay-coordinator, snapshotted as one wip(preservation) commit capturing a single test file.',
    issues: [{ ref: 'HANDOFF.md#worktree-hygiene', title: 'the wip/* branches are preservation, not a review' }],
  },
  'fix-useapp-psd-tests': {
    summary:
      'useApp PSD-import unit-test hardening, snapshotted as one wip(preservation) commit capturing a single test file.',
    issues: [
      { ref: 'TEST_ISSUES.md#3.6', title: 'useApp.psd.test.ts — the PSD bitmap-immutabilization path never runs' },
      {
        ref: 'AUDIT-STASHED-DOCS.md#3',
        title: 'records §3.6 as fixed, so this capture may duplicate work already on main',
      },
    ],
  },
  'fix-userect-tests': {
    summary:
      'useRect hook unit-test hardening, snapshotted as one wip(preservation) commit: the useRect suite, shared harness files and a fixture directory.',
    issues: [
      { ref: 'TEST_ISSUES.md#3.1', title: 'useRect — an inverted initialRect breaks the aspect lock' },
      {
        ref: 'AUDIT-STASHED-DOCS.md#3',
        title: 'records §3.1 as fixed, so this capture may duplicate work already on main',
      },
    ],
    note: 'Captures src/test/setup.ts and vite.config.ts, which will conflict with main on landing.',
  },
  'fix-unit-tests': {
    summary:
      'The one test-hardening branch with real commits: closing the gaps the merged suite was asserting around, and stopping a departed layer’s cache from being closed or stranded. Despite the name, five of its ten files are production.',
    issues: [
      { ref: 'HANDOFF.md#16', title: 'an invalid document frame converts with no diagnostic — fixed on this branch' },
      {
        ref: 'HANDOFF.md#17',
        title: 'duplicate durable entry id has no second line of defence — fixed on this branch',
      },
      { ref: 'MIGRATION_NEXT_STEPS_SUNDAY.md#5.1', title: 'P0 — already fixed on fix/unit-tests, do not redo this' },
    ],
    note: 'The only holder of the #16 and #17 fixes, and its commits are not on main, so `git branch -D` would lose work that exists on no other ref. A branch that is not on main is already refused by the inventory, so no flag is owed on top of that.',
  },

  /* ---------------------------------------------------------------- e2e */
  'e2e-1-export-oracle': {
    summary: 'Campaign shard 1 of 5, meant to make the export specs prove the app’s contain-fit mapping.',
    note: 'A later `wip(salvage)` commit captured what was on no ref, so the work is on a ref now: this branch is ahead of main and not on it, and the working tree is clean. An earlier version of this entry said the work was uncommitted and that git called the branch merged; neither was true, and the flag that claim carried is retracted.',
  },
  'e2e-2-draw-specs': {
    summary: 'Campaign shard 2 of 5, meant to write the drawing spec.',
    issues: [
      {
        ref: 'e2e/OPEN_PROBLEMS.md#P2-buildclip-redraw-clip',
        title: 'an explicit redraw clip is in page coordinates and a canvas-relative one passes for the wrong reason',
      },
    ],
    note: 'A later `wip(salvage)` commit captured what was on no ref, so the work is on a ref now: this branch is ahead of main and not on it, and the working tree is clean. An earlier version of this entry said the work was uncommitted and that git called the branch merged; neither was true, and the flag that claim carried is retracted.',
  },
  'e2e-3-layers-levels': {
    summary:
      'Campaign shard 3 of 5, named for the layers and levels specs. Its production changes are the layers panel and the layer renderer, alongside the specs.',
    note: 'A later `wip(salvage)` commit captured what was on no ref, so the work is on a ref now: this branch is ahead of main and not on it, and the working tree is clean. An earlier version of this entry said the work was uncommitted and that git called the branch merged; neither was true, and the flag that claim carried is retracted.',
  },
  'e2e-4-flyout-keyboard': {
    summary:
      'Campaign shard 4 of 5, meant for flyout and keyboard specs. The board records its files as the campaign’s content rather than flyout work.',
    note: 'A later `wip(salvage)` commit captured what was on no ref, so the work is on a ref now: this branch is ahead of main and not on it, and the working tree is clean. An earlier version of this entry said the work was uncommitted and that git called the branch merged; neither was true, and the flag that claim carried is retracted.',
  },
  'e2e-5-history-undo': {
    summary: 'Campaign shard 5 of 5, meant to cover the history panel and undo/redo.',
    issues: [
      {
        ref: 'e2e/OPEN_PROBLEMS.md#P2-cached-canvas-box',
        title: 'a cached canvas box addresses a different pixel after a tool switch',
      },
    ],
    note: 'A later `wip(salvage)` commit captured what was on no ref, so the work is on a ref now: this branch is ahead of main and not on it, and the working tree is clean. An earlier version of this entry said the work was uncommitted and that git called the branch merged; neither was true, and the flag that claim carried is retracted.',
  },
  'e2e-campaign-int': {
    summary:
      'The campaign’s integration branch: six shard branches merged, then main, then cherry-picked repairs for the export oracle, flyout open condition, tool overlay, text rect, spray dab and Color Replacement.',
    note: 'Carries a leftover cherry-pick sequencer whose bookkeeping contradicts the completed pick at the tip. Resolve it before landing.',
  },
  'e2e-validate': {
    summary:
      'The campaign’s first integration attempt, ending in a conflicted merge of e2e/harness-handoff. Never merged and superseded by integration/e2e-campaign-final, but not a subset of it.',
    note: 'Merges four shard branches the final integration does not, and shares no ancestry with it after their separate creations from main.',
  },
  'repair-dialogs-text': {
    summary:
      'Despite its name, no dialogs or text repair: the repairs were committed on the integration branch, not here. It tracks `integration/e2e-campaign-final` but is not level with it, and against `main` it carries the whole campaign chain.',
    note: 'The branch is not a fast-forward of the integration branch, so anything committed to that branch since is missing here. The repairs its name promises are on the integration branch only.',
  },
  'repair-undo-redo': {
    summary:
      'Single-commit repair of the rotted undo/redo spec premise, citations and two non-asserting assertions. The commit was cherry-picked onto the integration branch, so this branch itself is still unlanded.',
    issues: [
      {
        ref: 'e2e/OPEN_PROBLEMS.md#P2-cached-canvas-box',
        title: 'a cached canvas box addresses a different pixel after a tool switch',
      },
    ],
  },

  'e2ewt-adjustments': {
    summary:
      'Adds an adjustments spec and rewrites the levels spec to assert real sampled pixel values along the standard test stroke.',
  },
  'e2ewt-document-dialogs': {
    summary:
      'Covers the New Image and Save dialogs through the document, with test hooks in the dialogs and in layer-utils, plus two new HANDOFF items.',
    note: 'Two HANDOFF items exist only in this branch’s own renumbered copy of HANDOFF.md; main’s copy has neither defect, so a bare HANDOFF.md ref would misresolve.',
  },
  'e2ewt-file-roundtrip': {
    summary: 'Exercises File > Open and Save end to end, with a committed split-half PNG fixture and its generator.',
  },
  'e2ewt-harness-handoff': {
    summary:
      'Records two defects in the e2e harness: a screenshot clip that silently truncates and reads as clean, and a devicePixelRatio assertion that cannot fail.',
  },
  'e2ewt-layers-panel': {
    summary:
      'Covers the Layers panel and gives LayersTab real data-testids so rows are addressable without matching History rows.',
    note: 'Half of this is a production source change: main’s LayersTab has no data-testid at all.',
  },
  'e2ewt-paint-tools': {
    summary:
      'Asserts paint-tool pixels and records two P1s: brush, pencil and Color Replacement ignore the foreground colour, and Color Replacement accumulates a low-contrast haze.',
    note: 'Main has a different, larger e2e/paint-tools.spec.ts with the same filename, so a naive land conflicts. Neither P1 is recorded in main’s documents.',
  },
  'e2ewt-selection-gestures': {
    summary:
      'Covers selection gestures and records two defects: a marquee overlay that survives the tool switch that deselects it, and a white-on-white shape fill.',
    note: 'Neither recorded defect appears in main’s documents, and the branch’s own copy of Main.tsx conflicts with the responsive rewrite on main, so the record survives only here.',
  },
  'e2ewt-spec-defect-fixes': {
    summary:
      'Repairs four defective spec assertions and a re-hardened long-press delay across check-dpr, sidebar-keyboard, sidebar-flyout, export formats and the toolbar helpers.',
    note: 'Salvage rather than land wholesale: main still carries two of the defects, but has since moved past the other two.',
  },
  'e2ewt-text-tool': {
    summary:
      'Covers the Text tool’s Apply gate, commit and Clear, and records a P2: the Text toolbar supplies the rectangle Apply’s gate asks for, so undragged text commits at the document origin.',
  },
  'e2ewt-undo-redo': {
    summary:
      'The suite’s first undo/redo coverage, backed by a new history-helpers module and its unit test. None of the three files exist on main.',
  },

  /* ------------------------------------------------------------- flyout */
  'fix-flyout-clip': {
    summary:
      'Ports the tool flyout and tooltip out of the left rail’s CSS clip, with the AGENTS.md note that toBeVisible cannot see a clipped popover.',
    landed: true,
    issues: [{ ref: 'ph-55', title: 'SidebarLeft flyout: main is fixed and green' }],
  },
  'fix-flyout-clipping': {
    summary: 'An empty branch created from main and never committed to; superseded by the toolbar-flyout-clipping fix.',
    landed: true,
  },
  'fix-flyout-hit': {
    summary:
      'Stops the flyout’s portal wrapper eating clicks and losing z-order, plus tests closing two review gaps in AnchoredOverlay.',
    landed: true,
    issues: [{ ref: 'ph-55', title: 'SidebarLeft flyout: main is fixed and green' }],
    note: 'ph-55 claims these files are uncommitted. That claim is stale: the patch is committed and the tree is clean.',
  },
  'fix-flyout-longpress': {
    summary:
      'Opens the tool flyout in e2e on aria-expanded rather than a 350ms sleep, removing the long-press race flake.',
    issues: [{ ref: 'ph-55', title: 'SidebarLeft flyout: main is fixed and green' }],
    note: 'The one fix-flyout-* branch that still holds landable work. ph-55 reports it as merged; it is one commit ahead of main.',
  },
  'harden-flyout': {
    summary:
      'A rail-layout guard that closes the flyout on breakpoint crossings, plus a comment-only ToolTooltip edit.',
    issues: [{ ref: 'ph-55', title: 'SidebarLeft flyout: main is fixed and green' }],
    note: 'Highest risk in its batch: the sibling worktree holds a committed version of the same guard, and the two differ, so one of them is a decision rather than a merge. An earlier version of this note said the guard existed only in this working tree; it is committed here.',
  },
  'harden-flyout-overlay': {
    summary:
      'Tier 1 AnchoredOverlay hardening: a detached-anchor guard in reposition, flyout close at both breakpoints with focus return to the tile, and a new hardening test suite.',
    landed: true,
    issues: [{ ref: 'ph-55', title: 'SidebarLeft flyout: main is fixed and green' }],
    note: 'This branch is now ON main: 0 ahead, 1 behind. An earlier note here claimed three unmerged commits and a test file that exists nowhere else; both were wrong — the test file is tracked on main. Corrected after review.',
  },
  'fix-layout-overflow': {
    summary:
      'Stops the left toolbar’s min-content height from flooring the 1fr grid row it sits in, by giving the grid items their own scrolling.',
    note: 'Its fix appears to have already landed by another route; main’s index.scss carries the same comment and declarations.',
  },
  'fix-overlay-teardown': {
    summary:
      'Cancels the pending animation frame and clears the shared overlay canvas when a tool area unmounts, so an abandoned stroke does not stay painted.',
    issues: [
      { ref: 'HANDOFF.md#61', title: 'three overlay painters leave a pending animation frame across unmount' },
      { ref: 'ph-28', title: 'the board issue tracking the same defect' },
    ],
  },

  /* ------------------------------------------------------------ history */
  'history-append-layer-ops-main': {
    summary: 'A re-creation of the layer-property append-boundary slice against main.',
    note: 'A later `wip(salvage)` commit captured what was on no ref, so the work is on a ref now: this branch is ahead of main and not on it, and the working tree is clean. An earlier version of this entry said the work was uncommitted and that git called the branch merged; neither was true, and the flag that claim carried is retracted.',
  },
  'history-append-readiness': {
    summary:
      'Makes non-history selection actions stop invalidating the durable shadow — a readiness precondition for the single-writer append boundary.',
  },
  'history-presentation-lifecycle': {
    summary:
      'Retires presentation-owned bitmaps once their layer record disappears, addressing the liveness-gap invariant recorded as unstated.',
    issues: [
      { ref: 'HANDOFF.md#63', title: "the presentation scope's liveness set assumes an invariant it does not enforce" },
    ],
  },
  'history-reorder-boundary': {
    summary:
      'The reorder append-boundary slice: real layer-property oracles, conversion/replay agreement on a dangling reorder anchor, and the store owning the reorder pre-state.',
    landed: true,
    issues: [
      { ref: 'HANDOFF.md#15', title: '`reorder-layers` is published; a self-anchored move is a real converter defect' },
    ],
  },
  'history-selection-append-support': {
    summary:
      'Carries a durable set-selection entry through the append boundary so a selection change publishes instead of reconverting the whole timeline.',
    issues: [
      { ref: 'HANDOFF.md#31', title: 'the selection baseline lookup must stay unbounded over the whole timeline' },
    ],
  },
  'history-selection-baseline-parity': {
    summary:
      'Extracts one shared selection-baseline rule so legacy replay and durable conversion derive an identical snapshot. The strongest single-issue match of the unmerged set.',
    issues: [
      { ref: 'HANDOFF.md#31', title: 'the selection baseline lookup must stay unbounded over the whole timeline' },
    ],
  },
  'history-selection-creation-writer': {
    summary:
      'Makes selection changes undoable through the single-writer boundary, editing the magic-wand and rectangular tool areas.',
    issues: [
      { ref: 'HANDOFF.md#31', title: 'the selection baseline lookup must stay unbounded over the whole timeline' },
      { ref: 'HANDOFF.md#32', title: 'every selection change now appears as a "Selection" row in the History panel' },
    ],
  },
  'history-selection-creation-writer-2': {
    summary:
      'A competing second attempt at the selection creation writer, including a new test. Not a duplicate of its siblings — the three share one commit but hold three different working trees.',
    note: 'A later `wip(salvage)` commit captured what was on no ref, so the work is on a ref now: this branch is ahead of main and not on it, and the working tree is clean. An earlier version of this entry said the work was uncommitted and that git called the branch merged; neither was true, and the flag that claim carried is retracted.',
  },
  'history-selection-deselect-writer': {
    summary: 'A third selection-writer attempt aimed at deselect.',
    note: 'A later `wip(salvage)` commit captured what was on no ref, so the work is on a ref now: this branch is ahead of main and not on it, and the working tree is clean. An earlier version of this entry said the work was uncommitted and that git called the branch merged; neither was true, and the flag that claim carried is retracted.',
  },
  'history-selection-gesture-writer': {
    summary:
      'A fourth selection-writer attempt aimed at per-pointer gesture updates, covering both tool-area suites and adding a new test.',
    note: 'A later `wip(salvage)` commit captured what was on no ref, so the work is on a ref now: this branch is ahead of main and not on it, and the working tree is clean. An earlier version of this entry said the work was uncommitted and that git called the branch merged; neither was true, and the flag that claim carried is retracted.',
  },
  'reorder-durable-append': {
    summary:
      'Publishes a reorder through the append boundary, then compares durable layer ORDER rather than just the set. Three unmerged commits plus a fourth drafted and never landed.',
    issues: [
      { ref: 'HANDOFF.md#15', title: '`reorder-layers` is published; a self-anchored move is a real converter defect' },
    ],
    liveNote:
      'A complete fourth commit message sits in COMMIT_EDITMSG with the branch tip unmoved, and the tree is dirty past that commit.',
  },

  /* ---------------------------------------------------------------- docs */
  'ps-tool-playbook': {
    summary:
      'Adds a tool-creation playbook and files a HANDOFF entry reporting that the single-writer cutover gate in AGENTS.md names a behaviour saveLayerCanvas no longer has.',
    issues: [
      {
        ref: 'docs/ps-tool-playbook HANDOFF.md',
        title: 'the single-writer cutover gate in AGENTS.md names a behaviour saveLayerCanvas no longer has',
      },
    ],
    note: 'That entry exists only on this branch and the defect it describes is still live on main. The playbook text itself is superseded by .skills/photoshop-tool-creation.md.',
  },
  'responsive-design-plan': {
    summary:
      'A responsive-design review and implementation for mobile and tablet: a plan document, a new Mobile component suite, a useBreakpoint hook, and App/index.scss changes.',
    note: 'A later `wip(salvage)` commit captured what was on no ref, so the work is on a ref now: this branch is ahead of main and not on it, and the working tree is clean. An earlier version of this entry said the work was uncommitted and that git called the branch merged; neither was true, and the flag that claim carried is retracted.',
  },

  /* ------------------------------------------- newer worktrees, no notes */
  'e2e-coverage-2': {
    summary:
      'Broad e2e coverage tranche spanning keyboard, layers, history, dialogs, adjustments, shapes and the mobile shell, plus corrections to two false explanations in a toolbar test.',
  },
  'migration-docs-cleanup': {
    summary:
      'A documentation branch for the migration-status cleanup, sitting on a main commit with nothing of its own and a clean tree.',
    landed: true,
  },
  'tool-truth': {
    summary:
      'Corrects the tool descriptions so each one says what the tool actually does, rather than what its name suggests.',
  },
  'board-entrypoint': {
    // This entry previously claimed `landed: true` and described a worktree that
    // no longer existed, asserting a merge that never happened: main carried none
    // of it. The contradiction test only checks entries against worktrees that
    // exist, so a false claim about a deleted worktree raised nothing. A later
    // worktree of the same name then made it checkable, and it failed.
    //
    // The lesson is the one `landed` exists to enforce: a curated entry is a
    // claim about git, and a claim nothing re-derives is just prose.
    //
    // It is `true` again because it is now true — `npm run board` was merged as
    // `npm run swarm`, the worktree is removed, and the branch is an ancestor of
    // main. The entry is KEPT rather than deleted, matching every other landed
    // worktree here: a landed-and-removed worktree is history, and the claim is
    // only worth keeping while something re-derives it.
    summary:
      "Landed: the board command is `swarm` (it was `board`, which is also the name of Kilo's unrelated built-in tool), and `ready` ranks by priority, then live-before-imported, then startable-before-contended.",
    landed: true,
  },
  // A test-pin tranche: one worktree per subsystem, each pinning behaviour that
  // currently has no test. All sit on the same merge commit and are unmerged.
  'durable-replay-pins': {
    summary: 'Pins durable-replay behaviour that currently has no test asserting it.',
  },
  'harness-integrity-pins': {
    summary:
      'Pins the test harness invariants themselves, including the context factory that a prior audit showed returns a different object per call.',
  },
  'integration-test-pins': {
    summary:
      'Integration branch merging the eight test-pin branches for a single cross-branch gate run; held no work of its own, and the handoff section numbering collision was resolved here.',
  },
  'hooks-pins': {
    summary: 'Pins the commit-gate hooks, which were the subject of the silent-no-gate bug in 89 of 118 worktrees.',
  },
  'main-tool-area-pins': {
    summary: 'Pins Main and the tool areas, whose overlay painters were the subject of the unmount-frame defect.',
  },
  'selection-pixel-pins': {
    summary: 'Pins selection pixel behaviour.',
  },
  'store-history-pins': {
    summary: 'Pins StoreContext and history behaviour that no test currently covers.',
  },
  'tools-registry-pins': {
    summary: 'Pins the tool registry, where a pixel-free tool is not a typecheck error.',
  },
  'ui-shell-pins': {
    summary: 'Pins UI shell behaviour.',
  },
  'swarm-file-index': {
    summary: 'The durable issue_files index on the board, so a file named by an open issue counts as held.',
  },
  'swarm-lease': {
    summary: 'A board worktree on lease behaviour, sitting on the merge that landed the brush-tip-core branch.',
    note: 'The worktree and its branch are both gone, so there is nothing here left to protect and the entry survives only as a record of what the worktree was for. The lease semantics it was about are still the open board item — read that from the board, not from this line.',
  },
  'swarm-units': {
    summary:
      'The board worktree on health units: a hold is one event per command while a release is one per file, so the previous health summed incompatible units and reported the encoding as if it were behaviour.',
  },
  'chat-audit': {
    summary:
      'Reads every agent transcript in a 30-hour window and records what each one actually delivered, so the inventory answers whether work is finished instead of inferring it from turn shape.',
  },
  'e2e-swarm-lock': {
    summary:
      'Serializes Playwright runs across agents: scripts/e2e-run.mjs takes the swarm lock e2e/.swarm-e2e-runner, allocates a free port per run and gives each run its own output directory, and the scripts that run a suite route through it. Makes playwright.config.ts server reuse opt-in and rewrites the e2e docs, AGENTS.md, TEST-FLAKES 10/11 and .skills/photoshop-tool-creation.md to match.',
    note: 'Adds a wrapper the commit gate and CI do not run. The e2e job still calls npx playwright test directly, because a CI job owns its checkout and collects artifacts from the shared test-results/.',
  },
  'e2e-own-server': {
    summary:
      'An e2e run starts its OWN dev server, and that is the guarantee: playwright.config.ts sets reuseExistingServer: false as a literal with --strictPort, and scripts/e2e-run.mjs allocates a port, verifies it is bindable, records it, and refuses PLAYWRIGHT_REUSE_EXISTING_SERVER and PLAYWRIGHT_BASE_URL. The swarm lock on e2e/.swarm-e2e-runner is demoted to an ADVISORY queue: it serializes when it can, and a run that cannot have it logs and starts anyway. Also skips e2e/viewport-drawing.spec.ts by operator decision (TEST-FLAKES 12, still open).',
    note: 'Rewrites the e2e contract in docs/TESTING.md, docs/ORCHESTRATION.md, e2e/README.md, TEST-FLAKES 10, and .skills/photoshop-tool-creation.md. Deliberately does not touch AGENTS.md: the operator is replacing it with a short root plus links, and edits there would be killed.',
  },
  'fix-e2e-findings': {
    // The SECOND worktree to land on this directory name, and the second time a
    // curated entry outlived the worktree it described. The first entry here said
    // `landed: true` about a worktree that moved 33 e2e findings into the ledger
    // and was then removed; its branch is gone, so the claim was untestable. This
    // worktree took the same name, the entry attached to it, and the contradiction
    // test correctly reported that a live, unlanded branch was not on main.
    //
    // The directory name is the identity the generator uses, so a recycled name
    // silently re-points an entry at unrelated work. Renaming the worktree would
    // have hidden it; the test is what made the collision visible, which is the
    // only reason it is worth keeping.
    //
    // So: this entry is rewritten to describe the work actually in this worktree,
    // and `landed` is not claimed until the branch really is an ancestor of main.
    summary:
      'Implements the transferred e2e findings: the DPI-relative stroke thresholds, the baseline re-record mode, the assertions that could not fail, and the pins that resisted their own fix.',
    issues: [
      {
        ref: 'e2e/OPEN_PROBLEMS.md#transferred-findings--external-review-of-the-pre-migration-tree',
        title:
          'the 33 findings transferred in 4d47904: 31 fixed and deleted from the ledger, 2 re-recorded and still open',
      },
    ],
  },
  'e2e-findings-tail': {
    // The tail of the work `fix-e2e-findings` already landed: the findings its
    // adversarial review produced after the fixes merged, which the orchestrator
    // session died before acting on. The branch is on main, so whatever the
    // session did not do was finished by someone else afterwards.
    summary:
      'Finishes the transferred e2e findings: the per-axis capture scale in getStrokeAnalysis, the throw its JSDoc never stated, the zero-width defence pinned by a test that carries ink, the external oracle’s load-bearing check, and the ledger’s own arithmetic. It also corrects the review’s own divisor, which had been wrong about its own count.',
    issues: [
      {
        ref: 'e2e/OPEN_PROBLEMS.md#transferred-findings--external-review-of-the-pre-migration-tree',
        title:
          'the review tail left four unaddressed findings and a section header that counted two entries below it and found three',
      },
    ],
    note: 'Two accounts of this branch disagreed about how many of the review’s findings were behavioural rather than comment/precision defects, and neither figure can be re-derived from git, so neither is asserted here. Read the branch and its handoff section instead.',
  },
  'handoff-citation-rotation': {
    summary:
      'Rotates the line-numbered citations in the handoff documents after they were invalidated by file growth, and corrects one false claim in section 1.',
    issues: [
      { ref: 'HANDOFF.md#worktree-hygiene', title: 'growing a file silently invalidates every file.ts:NNN below it' },
    ],
  },
  'review-findings': {
    summary: 'Carries the review findings for the 2026-09-28 focused review across the components those findings name.',
    note: 'The worktree is gone and its branch is on main, so the findings are on main and not on no ref — the opposite of what this entry used to say.',
  },
  'text-tool-requirements': {
    summary:
      'A documentation branch holding the text tool’s requirements, sitting on the merged reorder slice. No commits of its own.',
    mustNotPrune: true,
    note: 'Its own content is on no ref, so the branch looking already-merged is a fact about the base commit, not about this work.',
  },
  'tool-descriptions': {
    summary:
      'A researched Photoshop description for every tool, plus a correction to the stale e2e pass count in AGENTS.md.',
  },
  'fix-flyout-comment-errors': {
    summary:
      'Test-comment accuracy for the flyout specs: two false explanations corrected, a duplicated assertion dropped, the expanded-wait timeout pinned as a floor rather than a literal, and the line citations this diff moved re-derived.',
    landed: true,
  },

  /* ----------------- tool-description revalidation: one worktree per family */
  // Eight parallel audits, each re-checking its slice of the tool descriptions
  // against Adobe's own documentation and against the running code. They are
  // siblings of `tool-descriptions`, not replacements for it: that branch wrote
  // the descriptions, these check them.
  //
  // These entries are HISTORY. The integration branch merged all eight onto
  // main, a follow-up commit fixed the blocking findings an independent review
  // of the merge found, and the worktrees and their branches were then removed.
  // The branches are gone, so there is nothing here for the `landed` test to
  // re-derive, and the entries are kept for the same reason
  // `board-entrypoint` is: a landed-and-removed worktree says what the work was
  // for, and the next agent who wonders where the per-family notes came from
  // gets an answer.
  //
  // Both sides of the merge that produced this file described the same eight
  // worktrees. This side's version records that the campaign has since been
  // merged and deleted; the other named the slice of the tool set each worktree
  // held. Both are kept, because they do not overlap: the family lists are the
  // only place here that says which tools were in which slice, and the removal
  // is the only thing that says the branches are gone. Where the other side said
  // the families "land via audit/tool-desc-revalidation" and the branches are
  // still open, that part is stale.
  'desc-eyedropper-draw': {
    summary:
      'The eyedropper-and-draw half of the tool-description revalidation, re-derived from Adobe’s own pages rather than from the name of the tool, together with the notes beside the descriptions.',
  },
  'desc-focus': {
    summary:
      'The focus family’s half of the tool-description revalidation — blur, sharpen, smudge, dodge, burn, gradient — including the finding its own review raised.',
  },
  'desc-paint': {
    summary:
      'The paint family’s half of the tool-description revalidation — brush, pencil, colour replacement, eraser, magic eraser, paint bucket, clone stamp — over both the descriptions and the notes beside them.',
  },
  'desc-pen': {
    summary:
      'The pen family’s half of the tool-description revalidation — pen, freeform, curvature and the anchor-point tools — including the finding its own review raised.',
  },
  'desc-selection': {
    summary:
      'The selection family’s half of the tool-description revalidation, including the finding its own review raised.',
  },
  'desc-shape': {
    summary:
      'The shape family’s half of the tool-description revalidation — the shape group and its figures — including the finding its own review raised.',
  },
  'desc-transform': {
    summary:
      'The transform family’s half of the tool-description revalidation — reposition, transform, levels, colour — over both the descriptions and the notes beside them.',
  },
  'desc-type-crop': {
    summary:
      'The type-and-crop family’s half of the tool-description revalidation, over both the descriptions and the notes beside them.',
  },
  'tool-desc-integration': {
    summary:
      'The integration branch for the tool-description revalidation: every family branch merged, the generated tooltips and the TOOLS table regenerated from the corrected record, the AGENTS.md rail claim corrected against Adobe’s own page, and the shortcut collisions filed as handoff items. Landed on main, and the worktree and branch were then removed.',
    note: 'No `landed` claim: the branch was deleted after the merge, so nothing re-derives it. The uncommitted AGENTS.md and docs/TOOLS.md edits it held at the last reading are the open question here — the merge reached main without them.',
  },

  /* ------------------------------------------------- Photoshop-gap branches */
  'eyedropper-crop': {
    summary:
      'Four small Photoshop gaps across the eyedropper, the text tool and crop, each pinned by a test that fails without it. It does not close its handoff entry, which needs a render pipeline it does not attempt.',
  },
  'paint-easy': {
    summary:
      'Three paint defects with three tests: the eraser opening on a hard edge instead of a soft tip, Photoshop’s paint keyboard shortcuts, and the locked-layer guard.',
    issues: [{ ref: 'HANDOFF.md#48', title: 'eraser is hard-edged; Flow and Airbrush are dead controls' }],
  },
  'selection-easy': {
    summary:
      'Four Photoshop-fidelity defects across the selection tools: the marquee’s modifiers doing nothing on a fresh drag, the wand’s Contiguous option, and the lasso’s Frequency option.',
    issues: [
      { ref: 'HANDOFF.md#31', title: 'the selection baseline lookup must stay unbounded over the whole timeline' },
    ],
  },

  /* ------------------------------------------------- e2e truth and guards */
  'e2e-shell': {
    summary: 'The responsive-shell assertions, with the review findings applied and the branch merged onto main.',
    landed: true,
  },
  'e2e-vacuous': {
    summary:
      'Six e2e assertions that could not fail, each replaced with one that can and each proven by a product mutation the previous version passed.',
  },
  'e2e-warmup': {
    summary:
      'A dev-server warm-up in global setup, with the blockers and the honesty fixes a review raised and the failure modes written down.',
    landed: true,
  },
  'cleanup-stale-curated': {
    summary:
      'Deletes the curated entries for four fix worktrees that have landed and been removed, and regenerates the inventory without them. Each of the four said in its own note that it should be deleted with the worktree it described; the worktrees are gone, so the entries were prose about branches that no longer exist.',
    note: 'This entry describes the worktree that wrote it, and that worktree goes when this change lands — at which point this entry should be deleted with it, the same rule the four entries it replaced carried.',
  },
  'tools-too-hard': {
    summary:
      'The TOO HARD register: each Photoshop capability too hard for this architecture recorded with what Adobe does, what the app does, why the gap is out of reach here, and what it offers instead — plus the gaps that are the operator’s call rather than an engineering one.',
  },

  /* ---------------- worktrees that really do hold work git cannot see ----- */
  // The one shape this table exists for, and the only one that earns
  // `mustNotPrune`: a branch git already calls disposable, carrying edits that
  // are in no commit on it. Every entry under this heading was re-derived with
  // `git rev-list --left-right --count main...<branch>`,
  // `git merge-base --is-ancestor`, and `git -C <path> status --porcelain`
  // before the claim was written, because the previous version of this section
  // asserted that shape for entries whose branches were ahead of main and
  // whose trees were clean — the opposite of what it said.
  'rail-drop-draw': {
    summary:
      'The invented Draw tool removed from the rail and the registry, together with the description and settings work that removal forces across the tool areas, the e2e specs that switched away from it, and the pen spec it deletes.',
    mustNotPrune: true,
    note: 'The whole deletion and everything it touches is uncommitted, the Draw tool’s own files among them staged for removal, while the branch tip is a main commit — so git reports this as merged and clean and the only copy of the removal is the working tree.',
  },
  'shape-truth': {
    summary:
      'The shape tools against Adobe’s own behaviour: the Polygon tool’s Sides field normalized for the draw loop and the figures’ options bars, with tests for each.',
    mustNotPrune: true,
    note: 'The shape settings, the draw loop and their tests are uncommitted and on no ref, while the branch tip is a main commit, so git reports this as merged and clean.',
  },
  'toolbar-overflow': {
    summary:
      'The left rail fits its tiles to the space it has and moves the ones that do not fit into a Photoshop-style three-dots tile, with one column as the default. A pure planner, a DOM-measuring fit store reached by ref callbacks, the tile itself, and the e2e specs it de-fragilised off hard-coded rail widths.',
    note: "Do NOT record a width or a viewport height here \u2014 that is the thing this branch removed. The three-dots menu needs a `max-h` and scrolls: `AnchoredOverlay` clamps a flyout's position and never its size, so a menu as tall as its contents in a `position: fixed` wrapper is unreachable below the fold.",
  },
  'hard-merge-skill': {
    summary:
      'A hard-merge skill: the procedure for merging two branches that independently implemented overlapping features, recovered from the toolbar/panel-docks conflict it was written for. Requirements recovered from the chat transcripts, conflicts arbitrated against Adobe and the web platform, a documented questions-file protocol, and the four post-merge sweeps that catch a silently wrong merge.',
    note: 'Documents only — .skills/hard-merge.md, its loader, and the skill registry rows in AGENTS.md. The research it encodes is not in this worktree: the transcripts it was derived from live in the machine-local Kilo database, and the merge commits it quotes are already on main.',
  },
  'swarm-watch-tail': {
    summary:
      'Makes `swarm watch` mean what a reader expects from a log: an unnamed call tails the last page and says which page it printed, and an explicit --since reads forward to the end of the log instead of stopping after one page.',
    mustNotPrune: true,
    note: 'The board script and its database module are also edited in the working tree, uncommitted, and this branch is ahead of main rather than sitting on a main commit. An earlier version of this note said the opposite of both, which is why every claim in this section is now re-derived before it is written.',
  },

  /* ------- worktrees whose danger git already sees: entry, but no flag ----- */
  // These were flagged `mustNotPrune` on a premise that was false when written
  // and is false now. The flag is the claim that the work here is on no ref;
  // where the branch is ahead of main and the tree is clean, git already
  // refuses to prune, and a flag on top of that protects nothing while
  // asserting something untrue. The entry stays: it still says what the
  // worktree is for.
  'retina-dpr': {
    summary:
      'A canvas-resolution investigation, carried in a plan document rather than in code: what the report called a paint-algorithm bug is answered as already correct, with the geometry pipeline shown to have no step that could introduce a device-pixel count.',
    note: 'The investigation is committed and the tree is clean. An earlier version of this entry claimed the plan was an untracked file, and there is no untracked file here; the flag that claim carried is retracted with it.',
  },
  'panel-docks': {
    summary:
      'Photoshop-style draggable panel workspace: a new PanelLayout context owning the dock width, the History/Layers split, panel order, roll-up and which edge the dock is on; a shared useDockDrag pointer primitive; a resizable, reorderable, roll-up-able right dock; a tools rail that re-docks to the opposite edge by drag; and a Window > Reset Workspace. Board issue ph-72.',
    note: 'Two sessions curated this key independently and the merge kept both, where the second silently discarded the first. Defaults are chosen so the first render is pixel-identical to the fixed layout it replaces (250px dock, 20/80 split, History above Layers, dock on the right), which is what keeps the e2e shell arithmetic valid.',
  },
  'chat-damage-audit': {
    summary:
      'An audit of what the agent transcripts say about damaged work, reading the chats rather than inferring it from their shape.',
  },
  'tsc-guard': {
    summary:
      'Makes a typecheck that checked nothing impossible to mistake for a pass: node_modules/.bin/tsc becomes scripts/tsc-guard.mjs, which refuses any invocation that is not build mode and names the two commands that do work. A tripwire test fails when npm has restored its plain symlink, and kilo.jsonc denies the command at the permission layer.',
    mustNotPrune: true,
    note: 'The guard itself is a symlink inside node_modules, which is gitignored and cannot be committed: the work that matters is the tracked guard, its installer, its tests and the prepare wiring, and npm regenerates the link from those. Losing this branch loses the refusal, and the trap it closes is a zero-file exit 0 that reads as a clean typecheck.',
  },
};

/** Curated entry for a worktree name, or `undefined` when none is written. */
export function curatedFor(name) {
  return CURATED[name];
}
