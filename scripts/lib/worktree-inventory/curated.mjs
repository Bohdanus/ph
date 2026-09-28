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
    landed: false,
    note: 'The board work itself is on main. A later `wip(salvage)` commit (3f1d0e2) sits on this branch on top of that, carrying an uncommitted board-schema migration test suite that was on no ref when the owning worktree was swept. It does not pass as it stands — one of the 74 tests in `agent-board.test.mjs` fails on this branch — so the claim is retracted rather than asserted. Landing it is a real fix, not a deletion.',
  },
  'board-file-index': {
    summary:
      'One-commit board fix: a file named by an open issue now counts as held, so two agents cannot edit the same file.',
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
    summary:
      'Layout-independent export oracle, including the helpers and the document-mapping unit test. No commits: the work is in the working tree only.',
    issues: [
      {
        ref: 'e2e/OPEN_PROBLEMS.md#P2-export-line-is-document-space',
        title: 'the export line is specified in document space',
      },
    ],
    mustNotPrune: true,
    note: 'The branch tip is a main commit, so git reports this as merged and clean. The five e2e paths are the entire work and exist on no ref.',
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
  'polygon-marching-ants': {
    summary:
      'Polygon-selection marching ants: the ants component, the selection-ants hook, a new usePolylineAnts module and its tests, and edits to the lasso, magic wand and click tool areas. The branch has no commits of its own.',
    mustNotPrune: true,
    note: 'git reports this as merged and 0 ahead because the branch sits on an old main commit. Seventeen paths exist on no ref.',
  },
  'ps-pixel-tools': {
    summary:
      'Eraser, Magic Eraser, Paint Bucket and Clone Stamp as four tool areas plus toolbars, with their tools and tests. The branch has no commits of its own; see `dirty` and `untracked` for what the working tree holds.',
    issues: [
      { ref: 'HANDOFF.md#48', title: 'eraser is hard-edged; Flow and Airbrush are dead controls' },
      { ref: 'HANDOFF.md#49', title: 'bucket and magic eraser leave a hard edge; mask is a threshold' },
      { ref: 'HANDOFF.md#50', title: 'bucket has no blend mode; gate excludes paint-bucket' },
    ],
    mustNotPrune: true,
    note: 'Reported as merged for the same reason as polygon-marching-ants: the tip is an old main commit. The eraser family is the live target for #48/#49/#50.',
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
    mustNotPrune: true,
    note: 'A split decision: #50 says drop the committed seam, but the uncommitted gradient tool, rounded-rectangle and eraser icons have no ref anywhere. The untracked eraser icons overlap ps-pixel-tools.',
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
    mustNotPrune: true,
    note: 'The only holder of the #16 and #17 fixes, and its commits are not on main, so `git branch -D` would lose work that exists on no other ref.',
  },

  /* ---------------------------------------------------------------- e2e */
  'e2e-1-export-oracle': {
    summary: 'Campaign shard 1 of 5, meant to make the export specs prove the app’s contain-fit mapping. Zero commits.',
    mustNotPrune: true,
    note: 'The export spec is untracked content on no ref, and the branch tip is an old main commit, so git reports 0 ahead and merged. Removing the worktree destroys the only copy.',
  },
  'e2e-2-draw-specs': {
    summary: 'Campaign shard 2 of 5, meant to write the drawing spec. Zero commits.',
    issues: [
      {
        ref: 'e2e/OPEN_PROBLEMS.md#P2-buildclip-redraw-clip',
        title: 'an explicit redraw clip is in page coordinates and a canvas-relative one passes for the wrong reason',
      },
    ],
    mustNotPrune: true,
    note: 'e2e/draw.spec.ts is untracked content on no ref, and the branch tip is an old main commit, so git reports 0 ahead and merged.',
  },
  'e2e-3-layers-levels': {
    summary:
      'Campaign shard 3 of 5, named for the layers and levels specs. Uncommitted work touches two production files, `LayersTab.tsx` and `layer-renderer.ts`, alongside the specs.',
    mustNotPrune: true,
    note: 'A leftover AUTO_MERGE ref records an abandoned merge here, so the worktree is not simply empty even though the branch itself carries no commits.',
  },
  'e2e-4-flyout-keyboard': {
    summary:
      'Campaign shard 4 of 5, meant for flyout and keyboard specs. The board records its uncommitted files as the campaign’s content rather than flyout work.',
    mustNotPrune: true,
    note: 'The board measured the branch as merged while holding uncommitted campaign content; the tip is an old main commit, and that content exists on no ref.',
  },
  'e2e-5-history-undo': {
    summary:
      'Campaign shard 5 of 5, meant to cover the history panel and undo/redo. The branch has no commits of its own.',
    issues: [
      {
        ref: 'e2e/OPEN_PROBLEMS.md#P2-cached-canvas-box',
        title: 'a cached canvas box addresses a different pixel after a tool switch',
      },
    ],
    mustNotPrune: true,
    note: 'e2e/history-panel.spec.ts exists only in this working tree and on no branch, and the tip is an old main commit.',
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
    mustNotPrune: true,
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
    mustNotPrune: true,
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
    mustNotPrune: true,
    note: 'Main has a different, larger e2e/paint-tools.spec.ts with the same filename, so a naive land conflicts. Neither P1 is recorded in main’s documents.',
  },
  'e2ewt-selection-gestures': {
    summary:
      'Covers selection gestures and records two defects: a marquee overlay that survives the tool switch that deselects it, and a white-on-white shape fill.',
    mustNotPrune: true,
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
      'A rail-layout guard that closes the flyout on breakpoint crossings, plus a comment-only ToolTooltip edit. Zero commits on the branch.',
    issues: [{ ref: 'ph-55', title: 'SidebarLeft flyout: main is fixed and green' }],
    mustNotPrune: true,
    note: 'Highest risk in its batch: the breakpoint guard exists only in this working tree. The sibling worktree holds a committed version of the same guard, and the two differ.',
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
    summary:
      'A re-creation of the layer-property append-boundary slice against main. The branch was created from main and never committed, so its output is three uncommitted files.',
    mustNotPrune: true,
    note: 'The work exists on no ref. HANDOFF.md names a different worktree for the same slice, whose work became 2dfc18e/2d985d4.',
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
    mustNotPrune: true,
    note: 'The branch tip is main’s own commit, so git reports it merged and 0 ahead, while the tool areas, the hook and a new test exist on no ref.',
  },
  'history-selection-deselect-writer': {
    summary: 'A third selection-writer attempt aimed at deselect.',
    mustNotPrune: true,
    note: 'The branch tip is main’s own commit, so git reports it merged and 0 ahead, while the deselect writer and its tool-area edits exist on no ref.',
  },
  'history-selection-gesture-writer': {
    summary:
      'A fourth selection-writer attempt aimed at per-pointer gesture updates, covering both tool-area suites and adding a new test.',
    mustNotPrune: true,
    note: 'The branch tip is main’s own commit, so git reports it merged and 0 ahead, while the gesture writer, both tool areas, their suites and a new test exist on no ref.',
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
    mustNotPrune: true,
    note: 'That entry exists only on this branch and the defect it describes is still live on main. The playbook text itself is superseded by .skills/photoshop-tool-creation.md.',
  },
  'responsive-design-plan': {
    summary:
      'A responsive-design review and implementation for mobile and tablet: a plan document, a new Mobile component suite, a useBreakpoint hook, and App/index.scss changes. The branch has no commits of its own.',
    mustNotPrune: true,
    note: 'Reports 0 ahead and merged while holding hours of uncommitted work — the exact shape HANDOFF.md warns about.',
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
  'fix-e2e-findings': {
    summary:
      'Moves e2e findings off their original branches and onto the documents, so the defects are recorded where an agent will read them.',
    landed: true,
  },
  'handoff-citation-rotation': {
    summary:
      'Rotates the line-numbered citations in the handoff documents after they were invalidated by file growth, and corrects one false claim in section 1.',
    issues: [
      { ref: 'HANDOFF.md#worktree-hygiene', title: 'growing a file silently invalidates every file.ts:NNN below it' },
    ],
  },
  'review-findings': {
    summary:
      'Carries the review findings for the 2026-09-28 focused review as uncommitted edits across the components those findings name.',
    mustNotPrune: true,
    note: 'The findings exist in no commit and on no ref. The branch tip is a main commit, so git reports it merged and 0 ahead.',
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
};

/** Curated entry for a worktree name, or `undefined` when none is written. */
export function curatedFor(name) {
  return CURATED[name];
}
