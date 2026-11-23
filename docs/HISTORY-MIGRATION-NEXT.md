# History Migration Next Steps

This is the restart guide for the durable-history migration. `docs/HISTORY-MIGRATION.md` remains the
architecture map; this file records the live gates and the next bounded proof slice. Historical
measurements retain their run timestamps. Use the latest continuation reconciliation below,
including its newest incremental subsection, for current refs, ownership, and follow-up scope. This
guide is authoritative for live refs and ownership; the continuation plan remains the source for
architecture boundaries and cutover gates, while its dated status section remains historical.

## Latest continuation reconciliation — 2026-11-23 01:10 UTC

### Candidate, main drift, ownership, and authority

The candidate branch `task/history-migration-raster-quarter-turn-20261122` contains code-only commit
`81bef88e5f1da2221b61fc89785c98a657e6aad5`, with the required chat trailer; the current
documentation checkpoint is committed separately after it. The code commit's parent
`67ddf33ceae42ecffa49c95cda781d66b548ee58` merges the prior migration candidate with the
local-main sync branch; the two parents are `abdc35647385f83cf69b18f2a01f4b6f71118f94` and
`f58826fdcc73b1b31cc56f8a437bd1b9b7bb59e7`. The designated local `main` worktree is clean at
`076f630f1c5e6ca74e57e012e607b34b5a2b6f5c`. The last-fetched local `origin/main` tracking ref is
`e6b6183e4c507ed6dd18dbf2b5d267926b348ab6`; graph checks confirm both local `main` and that tracking
ref are ancestors of the candidate. Local `main...origin/main` is 46 ahead / 2 behind, with merge
base `e31679a888261612e5efabe7bb3ce8d822a51479`. The startup fetch is the only fetch issued by
this coordinator in this continuation; no later fetch or push command was run. These are local ref
and operation-history facts, not a new live remote check. The candidate is not landed.

Issue `ph-111` owns `.kilo/plans/history-migration-continuation-20261027.md`, `HANDOFF.md`,
`docs/HISTORY-MIGRATION-NEXT.md`, `docs/HISTORY-MIGRATION.md`, `e2e/OPEN_PROBLEMS.md`, and
`e2e/crop-history.spec.ts`. The last owner-claim check at 00:00:33 UTC recorded an expiry of
01:30:33 UTC; refresh ownership and locks before any takeover or landing. The code commit changes
only `e2e/crop-history.spec.ts`; there are no production renderer, export, admission, or authority
changes. `HistoryItem[]` and `replayHistory()` remain logical undo/redo authority. The prior 22:33
board snapshot showed `ph-93` open and unclaimed; refresh its owner, worktree, handoff, and locks
before starting that separate slice.

### Latest focused proof and its limits

The focused Chrome command was
`npm run test:e2e -- e2e/crop-history.spec.ts --grep 'multi-step frame transitions retain byte parity|two raster layers keep exact rendered parity through a foreground affine and fractional quarter-turn frame'`,
run `2026-11-23T00-27-50-020Z-14186` on the tree recorded by `81bef88`. It ran two tests: the
two-raster fractional quarter-turn test passed; the mixed-source exact composite test failed at
`integer frame fixture retained affine blank-affine`. The mixed-source assertion remains
zero-tolerance and reports 8 channel bytes across 6 pixels, maximum channel delta 255. The eight
`legacy→durable` samples are `(28,7,a,79→76)`, `(34,8,a,70→69)`, `(39,9,g,255→0)`,
`(39,9,a,3→0)`, `(26,16,g,255→0)`, `(26,16,a,3→0)`, `(31,17,a,70→69)`, and
`(37,18,a,79→76)`. `npm run tsc` passed after the final test-code edits. No Linux, Windows, or
macOS mirror run was performed.

At stage `layer transform 1`, the diagnostic uses a 64×64 frame and paint layer `paint` at visible
legacy index 1. Direct-versus-cached prefixes for `blank`, `blank-semi`, and `vector` are exact;
the first 8-byte / 6-pixel difference appears when `paint` is included and remains unchanged at
`text`. Within the HTML pair, both variants use production `drawLayersToCanvas` staging and
publish. Within the Offscreen pair, both use `drawLayer` on fresh same-size `OffscreenCanvas`
surfaces. Only the selected paint source is forced through its cached bitmap in the cached variant.
HTML-versus-Offscreen comparisons are separate descriptive metrics, not the causal A/B comparison;
they are zero for both direct and cached outputs at each prefix.

The full-prefix HTML direct buffer equals the actual legacy buffer at 0 differing bytes, and the
full-prefix HTML cached buffer equals the durable buffer at 0 differing bytes. Those full-buffer
matches map the direct-versus-cached delta to the same legacy-versus-durable mismatch required by
the exact assertion; the zero values do not contradict its failure. This localizes the measured
path-dependent difference to the direct-versus-cached choice at the paint prefix in this fixture. It
does not identify the first internal Canvas write or explain why differing samples at `y=7..18` lie
above the recorded Draw clip and cached destination `[36,59) × [20,45)`. It does not establish the
expected Canvas or Photoshop result, a browser defect, or a user-visible product regression. The
diagnostic is a fixture-specific result, not a broader Draw-branch guarantee.

### Review and chat-history reconciliation

Seven fresh bounded reviews through the exact Kilo Nemotron 3 Ultra `:free` route returned non-empty
text, `finish_reason=stop`, and `cost=0`; the runner attempted one Kilo request each and no OpenRouter
request. They reviewed comparison semantics, checkpoint claims, ordered gates, local chat-scan
scope, direct/cached output mapping, and the PH-93 sequence. Their concerns were checked against
`drawLayerSource()` in `src/contexts/layer-renderer.ts`, the test harness, the test artifact, and the
read-only store queries. The cross-pipeline measurements are not used as causal evidence; full-buffer
identities support the narrower mapping above; the fact that changed samples are outside the Draw
rectangle remains a limitation, not a contradiction to the prefix result. One proposed checkpoint
draft used ambiguous lock-expiry wording and described mirror verification as local; both phrases
have been corrected. One extra free completion's runner metadata was not captured, so its output is
excluded from the verified review count. All model results remain leads, not source or product
authority. No Terra agent was launched.

The incremental local history query of sessions updated since 00:04 UTC found 15 migration-worktree
Kilo sessions by 01:10; 14 completed reviews have verified free-route metadata (seven from the prior
checkpoint and seven just summarized), while the remaining completion's runner metadata is
unverified and excluded.
The seven session IDs from the earlier batch are `ses_dfa492c66ffeC0jlvQjdiZsp8g`,
`ses_dfa44f3b2ffeaXov7jFG3FO3pp`, `ses_dfa41561affeAzXf6InQzdCQvh`,
`ses_dfa3f38f9ffemR9kFfOnsHBZ5D`, `ses_dfa3a1f6bffekX773VeFCcFiud`,
`ses_dfa367661ffeNMvCE1plhvKKe1`, and `ses_dfa335ff5ffeMWtG9r4qRmRLW7`. The six verified
follow-up review IDs are `ses_dfa21127dffealxuEahX7nJaIE`,
`ses_dfa1e08ccffei8A4zA5EO0WT48`, `ses_dfa1c8c15ffeIHm67gZ3o1GYl8`,
`ses_dfa1baedbffe3X15pJHzsc7JjW`, `ses_dfa1ac585ffegtSmu7Yf0VgOLy`, and
`ses_dfa19693dffe4s8qywKbQbaFtC`. The latest documentation audit is
`ses_dfa0e0e5effeLQgh9Lx9rNZRPt`. The unverified completion is
`ses_dfa25d055ffe7wVvkzuxwox8XI`. These sessions are coordinator-generated review prompts, not
independent user migration decisions.

The local Codex `state_5.sqlite` backfill reports `complete`; its 00:04–01:10 UTC `/ph` metadata
delta contains the active migration thread `01a1791a-beaf-7eb2-8c7c-e10b483cf962`, its existing
Luna child review `01a205c5-8863-7ac0-9132-4d2a6ac3023d`, and an unrelated tools-hardening thread
`01a1e542-adcd-7573-ba33-bb07c3f97f34`. The unrelated thread's index title and first-user-message
preview were present in the query result; no full transcript or implementation was read. The
interactive root thread's branch metadata says `task/mirror-sync-hardening-20261122`; the migration
changes were made only in the verified `task/history-migration-raster-quarter-turn-20261122`
worktree. The stable Copilot Chronicle database returned zero `/ph` sessions in the same window.
No remote or synced chats, other VS Code profiles, or other Agent Host history are covered. Earlier
primary-source research on GIMP, Krita, MyPaint, and Pinta remains architecture context only; none
supplies a Photoshop pixel oracle for this case.

The final documentation audit suggested the restart-plan phrase “snapshot below” could be read as
referring to the new checkpoint. The wording now names the historical live-status snapshot. Its
claims that the current checkpoint lacked `ph-111` ownership, PH-93 status, and separate gates were
checked against the complete docs and are not supported; those details are present in the current
reconciliation and ordered next steps.

### Ordered next steps and exit criteria

1. Keep the retained-affine `blank-affine` mixed-source composite gate blocked. Do not change
   production rendering, export, fixture inputs, the zero-tolerance assertion, admission, or history
   authority based on this diagnostic. The existing per-layer assertions pass for the tested fixture;
   that does not close broader source coverage or runtime/export gates.
2. Stop same-fixture micro-probing. Resume the investigation only when independent evidence can test
   a concrete mechanism or product oracle, such as a source-supported first differing Canvas write
   that survives an uninstrumented exact-parity control, or a version-specific Photoshop result.
   State competing hypotheses and predicted outcomes before any new probe. Do not substitute
   GIMP/Krita, Skia, or WebGL output for Photoshop behavior.
3. The local composite gate is green only when every tested cursor in the unchanged fixture has
   exactly zero differing bytes. After a local exact pass, run `e2e/crop-history.spec.ts` through
   the mirror once per platform:

   ```sh
   npm run test:e2e:mirror -- --spec e2e/crop-history.spec.ts --platform linux
   npm run test:e2e:mirror -- --spec e2e/crop-history.spec.ts --platform windows
   npm run test:e2e:mirror -- --spec e2e/crop-history.spec.ts --platform macos
   ```

   The mirror CLI selects a spec file, not an individual test name; confirm the target composite
   assertion has zero differing bytes on each platform before advancing. Keep the broader
   per-layer matrix, source lifecycle, runtime projection, PNG/PSD export, production renderer, and
   history-authority cutover as separate gates.

4. After the local composite gate and all three required mirror runs are green, revalidate PH-93's
   current owner, worktree, path locks, and producer handoff before taking over or editing its
   paths. Do not displace an existing owner without explicit handoff or the documented
   full-process-tree liveness proof. The lifecycle investigation can then proceed with legacy
   authority intact; keep `ownership-unproven`, source admission, production rendering, and export
   unchanged until PH-93's own producer integration, source identity/lease, failure/interleaving,
   navigation-fallback, canvas, PNG, and PSD proofs pass.
5. Do not land this candidate while the exact composite assertion is red. After the local and
   required mirror gates are green, review and pin the exact tree, run required focused checks and
   scoped repository/ownership checks, confirm path locks and landing occupancy, and use the
   owner-tracked landing wrapper. Do not fetch from `origin` or push the source branch during this
   continuation. The required mirror runs in step 3 are a later, separate gate and must use the
   documented mirror workflow, which refreshes mirror state and pushes the committed candidate to
   the mirror before testing its exact SHA.

### Incremental documentation and chat audit — 2026-11-23 01:34 UTC

The mirror instructions now identify the exact supported invocation: run
`e2e/crop-history.spec.ts` separately with `--platform linux`, `--platform windows`, and
`--platform macos`. The wrapper selects a spec file rather than a test name. Step 5 now limits the
current no-sync instruction to `origin` and source-branch pushes, and explicitly separates it from
the later mirror wrapper's documented mirror refresh and push. No mirror job, source fetch, or push
was run during this documentation update. The local exact composite gate remains red; no test or
production code changed.

The live board read at 01:33:28 UTC confirms `ph-111` is still claimed by this branch and worktree;
its claim and all six path-lock rows expire at 02:18:28 UTC. A preceding `swarm doctor --dry-run`
reported the earlier lease as expired, but no release sweep was run; the board renewed the claim by
current-session presence. The follow-up path check reported no competing reservation. A full
`repo:state --json` read returned exit 1 with `ok: true` because of foreign in-progress operations,
including `MERGE_HEAD` in `stale-marquee-archive-20261122`; none were touched. This broad scan is not
a landing decision: if the candidate later clears its exact gates, use the documented scoped
`npm run repo:state -- --for-landing task/history-migration-raster-quarter-turn-20261122` check and
preserve unrelated worktrees.

Three bounded reviews used the exact Kilo Nemotron 3 Ultra `:free` route with high reasoning. Each
returned non-empty text, `finish_reason=stop`, one Kilo request, and cost zero. Review
`ses_dfa04c1e1ffearlqfOiIER2CRH` found no concrete issue in the evidence wording. Review
`ses_dfa02f3d7ffeevCLDYKsRDKOlo` caught the ambiguity between the current source-sync hold and the
future mirror push; that wording is corrected above. Its PH-93 warning and explicit-platform
reminder were already covered by the conditional revalidation step and the three enumerated platform
values; its landing-wrapper check matched repository procedure. Review
`ses_dfa014b07ffeJHihSi26jCShN3` reported truncated-file and broken-relative-link concerns. Local
checks showed that its HANDOFF excerpt was clipped at the prompt boundary, both links resolve from
their Markdown file locations, the plan labels its 2026-11-14 snapshot historical and requires a
live recheck, and the historical PH-93 board snapshot is followed by an explicit current-state
revalidation gate. Those claims were not changed. Reviews are leads, not authority.

The final complete-doc audit `ses_df9faf9daffeeiJ12Yd6McFNhZ` found no concrete issue. It checked the
current checkpoint, explicit mirror commands against the actual parser, the open-problem record,
and linked summaries; it used one Kilo request, returned non-empty text with `finish_reason=stop`,
and reported cost zero.

The read-only Kilo metadata delta from 01:10 to 01:31 UTC contains these four coordinator review
sessions and seven unrelated tools-hardening review sessions in a different worktree; the latter
transcripts were not opened. The local Codex delta contains this active migration thread and an
unrelated tools-hardening thread; no additional migration implementation or authority decision was
found. The active Codex thread still records branch metadata `task/mirror-sync-hardening-20261122`,
while the migration files remain in the verified migration worktree. The stable Copilot Chronicle
store returned no `/ph` sessions in this interval. Since the earlier 00:04 UTC query, Kilo has 19
migration-worktree sessions: 18 with verified free-completion metadata and one non-empty response
whose runner metadata remains unverified. These are coordinator review prompts, not independent
user decisions.
Remote or synced chats, other VS Code profiles, and other Agent Host history remain outside the
search.

## Prior continuation reconciliation — 2026-11-22 22:33 UTC

### Incremental reconciliation — 2026-11-22 23:23 UTC

This refreshes Git, chat, and review status only. The exact pixel evidence below remains the focused
Chrome run at 21:33 UTC; no E2E test was rerun in this continuation.

The designated `main` worktree remains clean at
`abdc35647385f83cf69b18f2a01f4b6f71118f94`, matching this candidate's base. Local graph checks show
that `beae809ad8f2db01debe940bda79c2740a750e24` is 18 commits behind `abdc`, and
`99988eed4d187defe59ed2f38aeb1e64a3581099` is 16 commits behind; neither is a newer main fix.
Commit `6a1b3a28e21d4a36e1b6b12ef2d89eeb5148509d` is already an ancestor of `abdc`. The committed
vector-triangle vertical-mirror plus fractional 90-degree frame test is present in the base tree.
`docs/HISTORY-MIGRATION.md` records its focused local pass (`2026-11-22T00-51-10-210Z-39556`, one
test) and typecheck/lint/build results at 00:51 UTC. Those are historical run records, not a rerun
here, cross-platform evidence, or an independent Photoshop oracle. This closes a separate internal
matrix cell; it does not affect the unresolved retained-affine blank composite.

The older `task/history-migration-continuation-20261121` worktree at `beae809` has an uncommitted
change to `docs/HISTORY-MIGRATION.md` and an untracked `.task-tmp/`. The `verify/history-paint-main-20261122`
worktree at `99988eed` has uncommitted changes to `e2e/crop-history.spec.ts`. Both paths overlap
this task's documentation or test scope. Their owners and liveness were not established, so preserve
both worktrees and do not absorb or edit their files without an owner handoff. Their refs are older
than this candidate; their dirty files are not evidence that a fix reached `main`.

The local `origin/main` tracking ref remains `e6b6183e4c507ed6dd18dbf2b5d267926b348ab6`; this
continuation did not fetch or query the live remote. Since 22:33 UTC, read-only Kilo metadata shows
four `free-completion` entries in this migration worktree, twelve `read-only-research` entries in
tools-hardening, six `free-completion` entries plus one separate code task in the root worktree, and
two `free-completion` entries in a stale-archive worktree. The migration-worktree entries include
the bounded reviews and chat-search prompts recorded here; other worktree contents were not read.
Copilot's stable Chronicle query found zero local `/ph` sessions updated since 22:33 UTC. The
scoped Codex index shows this active migration thread, two children of the tools-hardening thread,
and a separate `Review and merge branch drift work` thread on the root task branch. That thread's
transcript was not read, and no edits from it were adopted.

A term-filtered, read-only Kilo content query since 2026-11-21 found 57 matching user-message
sessions, all `free-completion` agent sessions in this candidate (37), `origin-main-sync-20261122`
(8), and the older migration worktree (12). They are model-review prompts, not independent
user-authored migration conversations. The free chat-search summary mislabeled sampled prompt
wrappers as system-only snippets and did not surface reliable migration evidence; local message
metadata confirmed the mismatch, so that summary is rejected. These scoped queries did not verify a
new independent migration decision. Remote/synced chats, other VS Code profiles, and all Agent Host
history remain outside this coverage.

### Candidate, authority, and ownership

Candidate `task/history-migration-raster-quarter-turn-20261122` and the designated local `main`
worktree are both at `abdc35647385f83cf69b18f2a01f4b6f71118f94`; local `main` is clean. The candidate
has six uncommitted paths: this restart guide, the history migration map, `HANDOFF.md`, the continuation
plan, `e2e/OPEN_PROBLEMS.md`, and test-only diagnostics in `e2e/crop-history.spec.ts`. No production
renderer, export, or history-authority code changed. The already-fetched `origin/main` tracking ref
is still `e6b6183e4c507ed6dd18dbf2b5d267926b348ab6`; local `main` is 44 commits ahead and 2 behind,
with merge base `e31679a888261612e5efabe7bb3ce8d822a51479`. This is local tracking-ref evidence, not
a new remote check; there was no second fetch or push. Issue `ph-111` remains claimed by this
worktree, and its six path locks were renewed at 21:36 UTC. `ph-93` remains open and unclaimed.
`HistoryItem[]` and `replayHistory()` remain logical undo/redo authority; durable replay remains a
staged presentation projection with independent source, ownership, frame, failure, and export gates.

### Latest exact proof

The local focused headless Google Chrome run `2026-11-22T21-33-15-841Z-97111` still fails
`multi-step frame transitions retain byte parity across text, vector, blank, and paint sources` at
`integer frame fixture retained affine blank-affine`. The exact composite assertion remains
zero-tolerance: 8 channel bytes differ across 6 pixels, with maximum channel delta 255. Samples are
`(28,7,a,79→76)`, `(34,8,a,70→69)`, `(39,9,g,255→0)`, `(39,9,a,3→0)`,
`(26,16,g,255→0)`, `(26,16,a,3→0)`, `(31,17,a,70→69)`, and `(37,18,a,79→76)`. This is a local
focused run, not a Linux/Windows/macOS mirror result. The full stack's direct HTML output equals the
actual legacy output at 0 differing bytes; its cached output equals the durable output at 0 bytes.
Per-layer bounds and pixel gates still pass at the failing cursor. The first mixed-source composite
failure remains the same six pixels.

The additional accumulation-path control now runs on both HTML canvas and OffscreenCanvas surfaces.
It keeps the 64×64 frame and ordered backdrop, changing only the opaque source-over affine blank's
draw route: render it on a separate transparent frame surface, then composite it once with a
full-frame `drawImage`, or draw it into the accumulated destination in order. Both backdrop-only
outputs read back identically (0 bytes/pixels), and sequential direct/cached outputs reproduce their
respective production baselines exactly (0/0). On both canvas types, the final full-frame readbacks
after adding each paint-route variant differ by the same 8 bytes across 6 pixels between these
equal-byte backdrops for the direct route; cached-route readbacks do not change (0/0). Sequential
direct-versus-cached remains 8/6, while separate-path direct-versus-cached is exact (0/0). The HTML
direct/cached prefixes agree exactly with corresponding Offscreen prefixes. All differing samples
have `y=7..18`, below the recorded rectangles' `y=20` start; although sample columns `x=36..39`
overlap the rectangle's horizontal span, none of the sample coordinates intersects the bounded
trace's Draw clip or cached destination `[36,59) × [20,45)`. This establishes a path-dependent
final readback in this diagnostic, but does not show that the Draw stroke wrote those samples,
identify the responsible write, establish hidden pixel-state equality, determine the intended
Canvas or Photoshop result, or prove a browser or user-visible defect.

The completed `drawImage`-clone control in runs `2026-11-22T21-10-59-402Z-62475` and
`2026-11-22T21-23-53-867Z-81415` found exact source-versus-original-backdrop and clone-round-trip
pixels (0/0), cached-on-clone versus original cached output (0/0), and direct-versus-cached on fresh
clones (0/0); direct-on-clone versus original direct output remained 8/6. Its temporary helper has
been removed after collecting those results. Do not repeat this control, the synthetic backdrop
matrix, lower-layer subset reduction, pixel-copy round-trip, or bounded Canvas-call trace.

### Review and cross-chat reconciliation

Twelve bounded Nemotron 3 Ultra reviews completed for this checkpoint: four through Kilo and eight
through OpenRouter. Each counted response was non-empty, reported `finish_reason=stop`, and had exact
cost zero. Two OpenRouter reviews required a larger-token retry after an initial length-ended
response; only each complete stop response was counted. A later Kilo session in this migration
worktree had zero token counts and only empty synthetic/ignored startup text, so it is not counted
as a completion. The reviews are leads, not proof. One review proposed
a context-state leak because it missed the `drawLayer()` `save()`/`finally restore()` boundary and
the direct Draw branch's own state boundary; current source disproves that claim. Its
`CanvasRenderingContext2D` cast concern is not a demonstrated defect: this run exercised HTML and
Offscreen surfaces with matching measured outputs. Another review called the exact difference a
proven production defect and recommended changing rendering; that conclusion is unsupported because
the experiment identifies path sensitivity but not a first differing production write or a primary
product oracle. Another review suggested Skia/WebGL as an external pixel oracle; that is not adopted
as a Photoshop oracle. The HTML Standard's [Canvas section](https://html.spec.whatwg.org/multipage/canvas.html)
describes user-agent implementation choices such as deferred bitmap updates and oversampling for
antialiasing, and says some image-filtering algorithms are not mandated. Inference: the standard
does not select the byte-exact result for this mixed direct-stroke/cached-image sequence. This gap
does not establish that either route conforms or violates the standard. No production change
follows from these reviews.

Four more bounded Nemotron 3 Ultra reviews completed after the 22:33 UTC snapshot: one through
OpenRouter and three through Kilo. All four were non-empty, `finish_reason=stop`, and cost zero. The
running total is 16 completed reviews (seven Kilo, nine OpenRouter). The Git reconciliation review's
claims were verified against refs and worktree state. The quarter-turn test review found no concrete
test-logic defect and reiterated that legacy/durable equality is only internal parity; the committed
test closes one vector/mirror/fractional-frame cell, not product correctness. The 22:57 Kilo
Nemotron strategy review (`ses_dfa860528ffe5a2r4vlI4B57Mz`) proposed a hybrid
affine-materialize/direct-composite probe, but its predicted matches were not supported by the
measured path or source. The changed samples fall outside the traced Draw rectangle; that excludes
geometric intersection with that bounded rectangle only and does not locate the first differing
write or prove which stage a hybrid would isolate. Do not treat the proposal as a valid next
experiment.

A fourth bounded documentation review objected that the three statements above were unsupported by
its supplied evidence. Its prompt omitted the candidate path list, the preceding exact trace results,
and the strategy review response. Local status and source checks confirm both shared paths are in
this candidate's diff, the prior section gives the sample/rectangle coordinates, and the cited Kilo
session contains the proposed hybrid. The test and current-blocker relationship is independently
visible in the base test and 21:33 result above. This is a prompt-scope limitation, not new product
evidence or a reason to change the recorded conclusions.

A bounded primary-source check of two open-source editors found that GIMP documents GEGL as a
graph/data-flow image-processing framework with buffer-backed operation inputs and outputs
([GIMP Developer](https://developer.gimp.org/resource/writing-a-filter/architecture-install/)).
Krita's `Node.cpp` exposes pixel reads from a node's paint device separately from projection reads,
and its export path uses the projection
([Krita source](https://github.com/KDE/krita/blob/master/libs/libkis/Node.cpp)). These sources
describe different editor architectures; they do not define Photoshop semantics or byte-level
output, and they do not explain this Canvas path difference. They add context only and do not
justify another experiment.

The final free documentation review flagged the coordinate ranges as potentially misleading because
`x=36..39` overlaps the trace rectangle horizontally. Local coordinate comparison confirmed that
all differing samples have `y=7..18`, strictly above the rectangle's `y=20` boundary, so no sample
intersects the recorded 2D rectangle. The wording now states both ranges explicitly; the
cross-chat counts, local-state snapshot, and distinction between local per-layer proof and mirror
proof were checked directly against their respective local sources.

The incremental read-only Kilo metadata query for updates since 21:44 UTC returned 21 local
`/ph` sessions: 20 in the separate tools-hardening worktree and one `free-completion` session in
this migration worktree created at 21:55 UTC. The latter has zero token counts and its only
assistant text is empty, synthetic, and ignored; it contains no usable review, implementation, or
authority decision. The Codex `state_5.sqlite` backfill is complete; the scoped delta contains the
active migration thread and one separate tools-hardening thread. The stable Copilot Chronicle query
returned zero local `/ph` sessions updated after 21:44 UTC. These incremental results found no new
migration implementation or authority decision in the queried stores. They do not cover remote or
synced profiles, other VS Code profiles, or all Agent Host history. The earlier 656/657-session
Kilo sweeps each reviewed 30 bounded excerpts and were not exhaustive.

### Ordered next steps and exit criteria

1. Keep the mixed-source composite gate blocked. Do not change production rendering, export,
   migration authority, fixture data, or the exact assertion; do not call the residual a known
   acceptable limitation.
2. Stop same-fixture micro-probing. The GIMP/Krita sources and Canvas Standard do not resolve the
   Photoshop result; do not substitute Skia, WebGL, GIMP, or Krita output as the product oracle.
   Resume only when new independent evidence can test a concrete mechanism or oracle, such as a
   Photoshop-grounded result for this sequence or a minimal Canvas operation whose first differing
   write survives an uninstrumented exact-parity control. Any proposed probe must state which
   competing explanations it separates before implementation. The suggested hybrid
   affine-materialize/direct-composite probe is not accepted: the current evidence does not support
   its outcome predictions, and it would reuse this fixture without identifying the first differing
   write.
3. The composite gate is green only when this unchanged fixture and all its tested transition
   cursors report `differingBytes === 0` under the exact assertion. After a local focused run is
   green, run the focused test on Linux, Windows, and macOS. Require zero differing bytes on each
   platform before advancing; per-layer, export, PNG/PSD, and authority-cutover gates remain
   separate and closed until their own proof passes.
4. Only after the composite gate is green, resume typed text-source ownership in `HANDOFF.md` §1
   after owner handoff or documented full process-tree liveness proof. Prove producer integration,
   runtime bitmap/`tmpCanvas` identity and lease lifetime, failure/interleaving, navigation fallback,
   and production canvas/PNG/PSD behavior before changing `ownership-unproven`.
5. Do not land this candidate while the exact assertion is red. A later landing requires fresh review
   of the exact tree, typecheck, lint, scoped repository state, active path locks, landing occupancy,
   and parent/tree pins through the owner-tracked landing wrapper.

## Latest continuation reconciliation — 2026-11-22 20:48 UTC

### Candidate, authority, and lease

Candidate `task/history-migration-raster-quarter-turn-20261122` and the designated local `main`
worktree remain at `abdc35647385f83cf69b18f2a01f4b6f71118f94`. The candidate contains migration docs,
`e2e/OPEN_PROBLEMS.md`, and test-only diagnostics in `e2e/crop-history.spec.ts`; no production
renderer, export, or history-authority code changed. The startup fetch's local `origin/main` pin is
still `e6b6183e4c507ed6dd18dbf2b5d267926b348ab6` (44 local commits ahead, 2 tracking-ref commits
behind, merge base `e31679a888261612e5efabe7bb3ce8d822a51479`). It is not a live remote check. There
was no additional fetch or push. Issue `ph-111` owns the six changed paths; after the dry-run
reported its lease expired, the candidate path and Git mapping were rechecked and the issue was
reclaimed for 90 minutes. `HistoryItem[]` and `replayHistory()` remain logical authority; durable
replay remains staged behind its source, ownership, frame, failure, and export gates.
The board cross-check confirms `ph-71` is closed and verified; the separate `ph-93` text-source
lifecycle issue is open and unclaimed. Do not start that follow-on slice until the exact mixed-source
composite gate is green, then refresh its producer handoff, worktree, locks, and liveness.

### Exact call trace and limits

Focused headless run `2026-11-22T20-20-54-431Z-48893` still fails
`multi-step frame transitions retain byte parity across text, vector, blank, and paint sources` at
`integer frame fixture retained affine blank-affine`: 8 channel bytes over 6 pixels, maximum channel
delta 255. The zero-tolerance assertion is unchanged. The trace wraps only the selected Offscreen
context calls and scalar drawing-state assignments used by the Draw route. Its instrumented direct
and cached output each match the corresponding uninstrumented output at 0 differing bytes.

The direct Draw route records `rect(36,20,23,25)`, `clip()`, `translate(36,20)`, a path from
`(5,5)` to `(18,20)`, and one `stroke()`. At stroke time the transform is `[1,0,0,1,36,20]`, alpha is
1, compositing is `source-over`, filter is `none`, line width is 5, cap/join are round, and the dash
is empty. Its centerline is at document coordinates `(41,25)` through `(54,40)`, inside the clip
rect `[36,59) × [20,45)`. The cached route records one
`drawImage(OffscreenCanvas 23×25,36,20,23,25)` with identity transform, alpha 1, source-over,
`filter=none`, and smoothing disabled. All differing samples have `y=7..18`, below the recorded
rectangles' `y=20` start; although `x=36..39` overlaps the horizontal span, none intersects the
direct clip or cached destination rectangle recorded by this bounded trace. The
trace does not cover every possible write or establish which operation affected those pixels.

The [HTML Standard's Canvas section](https://html.spec.whatwg.org/multipage/canvas.html) defines the
clip region as drawing state, requires strokes to be subject to that clip, and defines `drawImage`
through a destination rectangle transformed onto the output bitmap. It does not specify exact
antialiasing bytes. The trace narrows the observed behavior but does not identify the first responsible
write, distinguish a fixture/oracle issue from a browser-backed rendering path, or establish a
browser defect, Photoshop result, or user-visible regression. The historical after-layer sentinel
reset pixels with `putImageData`, then used a full-frame fill that was reported to cover all pixels;
this only shows no residual clip restricted that later fill. It does not test whether the temporary
clip restricted the Draw stroke. The `clipSentinelAfterLayerDraw` helper is not in the current test.
The [HTML Standard's Canvas section](https://html.spec.whatwg.org/multipage/canvas.html) describes
antialiasing as an implementation technique and permits user-agent filtering choices for `drawImage`;
it does not supply byte-exact expected pixels for this direct Draw versus cached-bitmap comparison.
That is a limit of this oracle, not evidence that the observed difference conforms or matches
Photoshop. Do not make a production compatibility change from these results.

### Chat and branch reconciliation

Two bounded local free-model chat sweeps searched 656 and 657 indexed sessions respectively and
evaluated 30 excerpts each. Both Nemotron 3 Ultra requests completed through Kilo with reported cost
zero. Their timelines surfaced the 18:33 frame-origin question, the 18:47 reduction suggestion, the
18:55 blank-layer finding, and older branch reviews. The frame origin, subset reduction, synthetic
backdrops, pixel-copy control, and exact call sequences are now verified locally. The sweep's claim
that “blending accumulation order” is the cause is not established; it also incorrectly described
the direct and cached routes as the same Canvas operations. A separate free trace review correctly
recommended stopping at the unresolved write boundary, but its statement that the proxy captured
every Canvas method/property was broader than the implementation: the test captures a selected
bounded method/property set. Treat model summaries as leads.

Local ref comparison rejects the old overnight and mirror cross-platform branches as migration
candidates. `task/overnight-crop-history-20261030` at `ac3487d9489c79c3249bc17eee5dcd56a86c9f2d`
has 36 commits not in local `main` and 1,270 local-main-only commits from merge base
`67e4ceb8bf81a0ecdc5cfabba4f3412ddfea2eb6`; its crop-history spec is 3,827 lines compared with
10,372 in current main. Its renderer diff omits the current eligible direct Draw branch and changes
canvas cleanup/restoration safeguards. The local mirror ref
`remotes/mirror/task/crop-history-cross-platform-20261029` at `97b80395bf01c782e3878cf6b8db3bc35bf4391f`
has 6 branch-only and 1,272 main-only commits from merge base
`db0c4f666b2d10e7de74b839ba81d6d40bef227c`; it is not an ancestor of current main. These are local
ref measurements, not live remote checks. Do not salvage either old branch without a new requirement
and complete current-source review.

### Open-source editor research boundary

The official [GIMP undo overview](https://developer.gimp.org/core/specifications/undo/) documents
image actions, grouped actions, and clearing redo after a new action; [GIMP's GEGL architecture
guide](https://developer.gimp.org/resource/writing-a-filter/architecture-install/) describes its
graph-based image-processing model. [Krita's Undo History docker](https://docs.krita.org/en/reference_manual/dockers/undo_history.html)
documents cursor navigation and cumulative stroke grouping. [MyPaint's layer source](https://github.com/mypaint/mypaint/blob/master/lib/layer/data.py)
describes snapshots stored in undo commands and permits independent or copy-on-write data copies.
[Pinta's user guide](https://www.pinta-project.com/user-guide/overview/) documents a history window
that lists operations and lets users navigate undo/redo. These sources show architectural choices
around history grouping, snapshots, and rendering. They are comparative references only; they do not
set Photoshop behavior, app authority ordering, or a browser Canvas byte oracle.

### Independent review outcome

The free Kilo Nemotron code review returned `stop` at reported cost zero. Its surface-leak,
microtask-order, unbounded-loop, and missing-type-interface claims were checked against the source:
the diagnostic is enabled for one fixed fixture cursor, its three lower layers yield seven subsets,
its helpers return pixel arrays and serialized trace values rather than canvas references, and the
Canvas calls it wraps are synchronous. The diagnostic return shape is inferred and passed `tsc`.
The review's maintainability preferences about fixture configuration and hoisting small helpers are
not correctness blockers. No production cause or actionable code fix was established by that review.

A separate free documentation review initially confused the 20:33 checkpoint in
`HISTORY-MIGRATION.md` with a checkpoint in this restart guide. The local section search rejected
that claim; checking the board did find the live HANDOFF's `ph-71` wording was stale. The board shows
`ph-71` closed and `ph-93` open/unclaimed, so `HANDOFF.md` and the continuation plan's restart link
were corrected. A fresh review of those exact documentation diffs found no actionable contradictions.

### Ordered next steps

1. Keep the exact mixed-source composite assertion blocked. Do not add a tolerance, change the
   fixture to hide the affine green source, or edit production rendering/history/export code.
2. Mark this application-level call-trace branch complete: its output matches the uninstrumented
   controls, but all differing samples have `y=7..18`, below the recorded rectangles' `y=20`
   start. Although `x=36..39` overlaps the horizontal span, none intersects the recorded 2D
   rectangles. The trace does not cover every possible
   write. Do not
   repeat the same call trace, synthetic backdrop matrix, layer-subset reducer, or pixel-copy control.
   Resume this diagnosis only with new evidence that can distinguish the backing/output path or the
   fixture/oracle; preserve the exact failing run and current source contracts while blocked.
3. Keep legacy `HistoryItem[]`/`replayHistory()` as logical undo/redo authority. Source, frame-change,
   per-layer/export, PNG/PSD, and undo/redo cutover gates remain closed.
4. After exact mixed-source parity is green, run the focused Linux, Windows, and macOS matrix. Then
   resume the typed text-source lifecycle slice in `HANDOFF.md` §1 only after its owner handoff or
   documented full process-tree liveness proof, and pass its identity/lease, failure, navigation,
   canvas, PNG, and PSD gates before changing `ownership-unproven`.
5. Do not land while the exact composite assertion is red. A later landing still requires a fresh
   review of the exact candidate, typecheck, lint, scoped repo state, current path locks and landing
   occupancy, and pinned parent/tree verification through the owner-tracked wrapper.

## Latest continuation reconciliation — 2026-11-22 19:53 UTC

### Current candidate and authority

The candidate is `task/history-migration-raster-quarter-turn-20261122` at
`abdc35647385f83cf69b18f2a01f4b6f71118f94`. The designated local `main` worktree was clean at the
same pin. The last `origin/main` fetch for this continuation remains the startup fetch recorded
below; its local tracking ref is `e6b6183e4c507ed6dd18dbf2b5d267926b348ab6` (44 local commits ahead,
2 tracking-ref commits behind, merge base `e31679a888261612e5efabe7bb3ce8d822a51479`). This is not
a live remote check. No second fetch or push occurred.

Issue `ph-111` owns this test-only diagnosis and the four paths listed on the issue. The candidate
still changes only the migration docs, `e2e/OPEN_PROBLEMS.md`, and `e2e/crop-history.spec.ts`; no
production renderer, export, or history-authority code changed. There has been no landing.
`HistoryItem[]` and `replayHistory()` remain logical undo/redo authority; durable replay remains
staged behind source, ownership, frame, failure, and export gates.

### Latest exact proof and what it isolates

Focused run `2026-11-22T19-50-41-900Z-5926` still fails
`multi-step frame transitions retain byte parity across text, vector, blank, and paint sources` at
`integer frame fixture retained affine blank-affine`: 8 channel bytes across 6 pixels, maximum
channel delta 255. The values and locations match run `2026-11-22T19-21-37-747Z-59946`. The exact
zero-tolerance assertion remains unchanged.

The actual ordered backdrop is not transparent. Its first layer is source `blank`, color `#00ff00`,
opacity 1, bounds `{x:28,y:8,width:10,height:10}`, with enabled retained affine `blank-affine`.
Enumerating the seven non-empty subsets of the original three lower layers shows the same 8-byte,
6-pixel delta only for subsets containing this `blank` layer; `blank` alone reproduces it. The
`blank-semi` and `vector` subsets are exact. The differing samples surround the transformed green
pixels and lie outside the Draw layer bounds `{x:36,y:20,width:23,height:25}`. At those samples the
direct path raises existing green alpha from 76 to 79 or 69 to 70, and writes green `[0,255,0,3]`
over two transparent pixels; the cached path preserves the backdrop values.

The synthetic transparent, opaque, and semi-transparent backdrops all give exact direct/cached
parity. Copying the exact accumulated blank-layer RGBA through `getImageData`/`putImageData` also
round-trips byte-for-byte and makes direct/cached exact. On the original accumulated context the
delta remains; cached rendering on that same context equals the pixel-copy cached output. This
localizes the difference to the direct Draw route after the affine blank layer has been drawn, but
does not identify the responsible Canvas operation or explain why direct Draw changes samples
outside its layer bounds.

The sampled context properties remain equal before and after both paths: identity transform, alpha
1, source-over, filter `none`, smoothing enabled, default stroke/fill, line width 1, butt cap, miter
join, and empty dash. The historical after-layer sentinel reset pixels with `putImageData`, then used
a full-frame fill whose reported coverage was all 4,096 pixels. That shows no residual clip
restricted the later fill; it does not test whether the intended temporary clip restricted the stroke
while it ran. Its old output field was `clipSentinelAfterLayerDraw`; the helper is not in the current
test. Do not infer a context-state leak, browser defect, Photoshop mismatch, or product-visible
regression from these observations.
Legacy remains the logical presentation authority and frame-change admission remains closed.

### Cross-chat reconciliation and limits

The recent Kilo free reviews are bounded leads, not renderer evidence. The 18:33 review asked for
frame-origin verification; the current frame is `{x:0,y:0,width:64,height:64}`, so the six sample
coordinates map directly to document pixels. Later reviews' reduced-backdrop suggestion has been
tested against synthetic backdrops, original-layer subsets, and the exact pixel-copy control. A
18:55 review incorrectly described `blank` as transparent and treated a blending-order explanation
as a finding; current fixture source proves the green affine layer is present, and the exact
mechanism remains unresolved.

The earlier Copilot Chronicle-only result (19 sessions, no `/ph` match) was incomplete for VS Code
Agent-host history. This continuation queried the configured Agent-host registry and 47 matching
`/ph` parent-session databases spanning 2026-10-06 through 2026-11-20. Four databases contained
history/crop-related local turns. The Oct 30 `Project review and merge tasks` parent includes
historical source-backed-history and crop reviews, but its 23 stored child turns are all `failed`
(mostly model 502s, plus unsupported-model/quota errors), so they provide no completed independent
review report. The Nov 20 `Review Kilo Chat Sweep` session has no migration-related local turn. These
records do not reveal a newer implementation or a completed review missed by the Chronicle search.
Synced/remote Copilot stores and other VS Code profiles remain outside this local scan.

### Ordered next steps

1. Keep the mismatch blocked and the exact assertion intact. Do not add a tolerance, change the
   fixture to hide the green affine source, or edit production code. The latest probe has isolated
   the direct-versus-cached route over one specific accumulated backdrop, but not the first differing
   Canvas operation.
2. If continuing this diagnosis, keep only the affine green `blank` layer and the producer-valid
   Draw layer. Add a test-only call trace for the direct branch (`clip`, translation, Draw context
   setup, path construction, and stroke) and the cached branch (`getLayerBitmap`, evaluated draw, and
   `drawImage`). Capture call arguments without inserting pixel readbacks between production calls;
   retain an uninstrumented exact-parity control because readback/copy itself changes the result.
   Report the first operation whose bounded output can be compared without removing the mismatch.
   If that control still does not isolate a responsible stage, stop and leave this gate blocked.
3. Only propose a production compatibility change after the first differing write and intended
   renderer contract are established from current source and a primary source. Preserve the existing
   Draw preview/commit assertion in `e2e/check-dpr.spec.ts`, per-layer and export evidence, legacy
   logical authority, and every closed source, frame, PNG/PSD, and undo/redo cutover gate.
4. After exact mixed-source parity is green, run the focused matrix on Linux, Windows, and macOS.
   Then return to the typed text-source lifecycle slice in `HANDOFF.md` §1 only after its owner
   handoff or documented full process-tree liveness proof; its integration, lease/identity, failure,
   navigation, canvas, PNG, and PSD gates must pass before changing `ownership-unproven`.
5. Do not land while the exact composite assertion is red. Before a later landing, rerun the focused
   proof, typecheck, lint, scoped repo state, path locks, landing occupancy, and exact parent/tree
   pins through the owner-tracked wrapper.

## Latest continuation reconciliation — 2026-11-22 18:21 UTC

### Current candidate and scope

The candidate remains `task/history-migration-raster-quarter-turn-20261122` at
`abdc35647385f83cf69b18f2a01f4b6f71118f94`; the designated local `main` worktree is at the same
pin. This continuation did not fetch again. The last fetched `origin/main` tracking pin remains
`e6b6183e4c507ed6dd18dbf2b5d267926b348ab6`; the local comparison remains 44 commits ahead and 2
behind with merge base `e31679a888261612e5efabe7bb3ce8d822a51479`. These are local tracking-ref
measurements, not a fresh remote check.

The four candidate paths are still the migration docs, `e2e/OPEN_PROBLEMS.md`, and
`e2e/crop-history.spec.ts`; no production `src/` file changed. Board issue `ph-111` owns these paths
and remains claimed for the controlled test-only diagnosis. There has been no landing.

### Latest exact proof

Focused run `2026-11-22T18-02-05-055Z-51088` still fails the exact assertion at
`integer frame fixture retained affine blank-affine`: 8 channel bytes across 6 pixels, maximum
channel delta 255. The samples remain `(28,7,a,79→76)`, `(34,8,a,70→69)`, `(39,9,g,255→0)`,
`(39,9,a,3→0)`, `(26,16,g,255→0)`, `(26,16,a,3→0)`, `(31,17,a,70→69)`, and
`(37,18,a,79→76)`.

The corrected probe rerenders each identical visible-layer prefix through production
`drawLayersToCanvas()` on a fresh HTML canvas, changing only whether the eligible paint layer uses
the direct Draw source or its cached bitmap. Before the paint layer, all three prefixes are exact:
`blank`, `blank-semi`, and `vector`. The first difference appears after `paint` and remains after
`text`. The direct full-stack render equals the actual legacy output (0 differing bytes); the
cached full-stack render equals the durable output (0 differing bytes); direct versus cached differs
by the same 8 bytes across 6 pixels. This validates the probe against the real legacy compositor,
unlike the earlier hand-built direct-render attempt.

Before the composite assertion, `assertMixedLayerParity()` also passes for every materialized layer
at each retained-affine cursor, including the paint layer's HTML and Offscreen frame comparisons and
premultiplied tight-bitmap comparison. The failing paint source has the producer-valid 23×25 bounds
and matching source/layer dimensions, Draw `alpha=1`, `penType='pen'`, source-over blend, no enabled
operations, no temporary canvas, and default layer opacity 1. This rules out the earlier invalid
fixture, a standalone paint-layer raster mismatch, layer opacity below 1, and later text rendering
as explanations for these six pixels. The evidenced boundary is narrower: selecting direct versus
cached Draw rendering changes the result only when that layer is added over the already rendered
lower-layer prefix. The precise Canvas rounding or accumulated-blend mechanism is not established.

The old `2026-11-22T16-08-23-700Z-97050` hand-built direct-path comparison is superseded as root
cause evidence: its manual direct surface did not equal the real legacy compositor. Preserve that
run as a failed probe only. Do not infer a Canvas defect, a Photoshop pixel result, or a user-visible
regression from the corrected A/B; legacy presentation remains logical authority and frame-change
admission remains closed.

### Source and chat reconciliation

Git source history shows the eligible direct Draw branch was introduced by
`89e348237c` (`Fix Draw HiDPI commit rendering`), which also added
`e2e/check-dpr.spec.ts`'s `committing a Draw stroke preserves the live HiDPI preview pixels` test.
That establishes an existing app contract to preserve during migration, not a Photoshop-specific
pixel oracle. Adobe's [Brush and Pencil tool documentation](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/paint-with-brush-or-pencil-tool.html)
describes tool opacity during a stroke; Adobe's [layer opacity and blending documentation](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/apply-layer-effects/set-layer-opacity-and-blending-modes.html)
describes overall layer opacity and pixel blending with underlying layers. These primary sources
separate paint and layer controls but do not decide the exact byte result of this browser compositor.
The existing GIMP, Krita, MyPaint, and Pinta references remain architecture comparisons only.

The bounded local Kilo/Codex chat search covered at most 500 sessions per source, updated since
2026-11-15, under `/Users/bkalynovskyi/ph`; it returned three matches but no newer independent
implementation or next-step plan. The matching Kilo E2E review corroborates the fixture's producer
formula; its unrelated Invert concerns were rejected by current source checks. A separate Kilo docs
review flagged a candidate-pin gap, but the 16:45 checkpoint already reconciles `18d4daf2c` through
`5c970cdf0` to `abdc35647`. The local Codex index is complete and has 760 project threads; recent
hits are this active thread and an unrelated tools-hardening thread. Its earlier
`Plan further history migration` thread remains a planning reference, not new implementation
evidence. The current stable Copilot Chronicle still has no `/ph` session (19 local sessions were
inspected); other VS Code profiles and synced/remote stores were not searched. Free-model outputs
were treated as leads and checked against source.

### Ordered next steps

1. Reduce the controlled case to one backdrop layer and one eligible Draw layer, keeping Draw alpha
   and layer opacity at 1, source-over blend, and no operations. Compare direct and cached paths over
   transparent, opaque, and semitransparent backdrops on HTML and Offscreen destinations. Record the
   backdrop and output RGBA at the six known coordinates. Keep the full mixed-source fixture as the
   integration gate; exact parity remains zero-tolerance.
2. Trace the reduced case through `drawLayerSource()`, the Draw processor, `materializeLayer()`, and
   `composeDurableDocument()`. Distinguish source raster bytes from the subsequent source-over write
   into an occupied destination. Recheck the direct branch's HiDPI preview/commit contract before
   changing it.
3. Choose a compatibility change only after the reduced case identifies the first differing write
   and the product contract is explicit. Any staged durable fix must preserve the current legacy
   composite and the `check-dpr` exact-pixel assertion, keep materialized layer/export records
   separately verified, and leave source admission, frame-change admission, PNG/PSD authority, and
   undo/redo cutover closed. If the evidence instead requires changing the legacy renderer, stage
   that as a separate Photoshop-behavior decision and retain its preview/commit gate.
4. After the mixed-source gate is green, run the focused proof on Linux, Windows, and macOS. Then
   resume the typed text-source lifecycle slice from `HANDOFF.md` §1 only after its owner handoff or
   documented full process-tree liveness proof. Do not land while the exact composite assertion is
   red; do not fetch again or push during this continuation.

## Latest continuation reconciliation — 2026-11-22 16:45 UTC

### Current candidate and main drift

The task candidate is `task/history-migration-raster-quarter-turn-20261122` in
`.kilo/worktrees/history-migration-raster-quarter-turn-20261122`, fast-forwarded
to local `main=abdc35647385f83cf69b18f2a01f4b6f71118f94`. The clean designated
main worktree is at the same pin. The two commits since the prior candidate
pin `5c970cdf0bf4f6c9de4a800ef688868821bf8a57` changed E2E timeout tooling and
updated `e2e/OPEN_PROBLEMS.md`; no history implementation or crop-history spec
changed. The last fetched `origin/main` tracking ref is
`e6b6183e4c507ed6dd18dbf2b5d267926b348ab6`, with no second fetch; it may have
advanced remotely since that snapshot. The current local comparison is 44 ahead
and 2 behind, merge base `e31679a888261612e5efabe7bb3ce8d822a51479`.

The candidate reflog reconciles the earlier 11:19 checkpoint at
`18d4daf2c55376d6bac12bbe5c3b3360ac65e62b`: it later fast-forwarded to 5c970
at 13:37 UTC, then to abdc356 at 16:17 UTC. Thus 5c970 was the immediate
predecessor to the latest sync; the earlier 18d4 pin was a valid historical
snapshot.

The candidate contains test and documentation changes only. The scoped
`repo:state -- --for-landing task/history-migration-raster-quarter-turn-20261122`
passed with 12 unrelated findings left untouched. No landing has occurred.

### Latest proof status

The mixed-source fixture now uses a producer-valid Draw `pos` and localized
stroke points derived from `DrawToolArea`; each per-layer comparison uses a
fresh frame surface. On this candidate, exact composite run
`2026-11-22T16-41-21-236Z-49094` still fails at the retained-affine
`blank-affine` cursor with 8 differing channel bytes across 6 pixels (maximum
channel delta 255). The corrected source bitmap and fresh per-layer HTML and
Offscreen comparisons are exact in the diagnostic. The 16:45 checkpoint also reported that the
separate raster affine plus fractional quarter-turn matrix passed in run
`2026-11-22T16-41-42-652Z-49716`; no artifact for that run is present in this worktree, so retain
it only as an unverified historical report and do not use it as current proof.

`npm run tsc` passed. `npm run lint:check` exited 0 with 127 warnings and no
errors; Prettier reported all four changed files formatted. The full E2E suite
and production build were not run.

The bounded diagnostic traces the first composite-prefix difference to the
paint-source accumulation path: direct Draw and cached bitmap routes are exact
on a fresh surface, but differ by 8 bytes under the accumulated context. This
does not prove a Canvas engine defect or a user-visible regression because
legacy presentation remains authoritative. Keep exact-zero assertions and
leave production adapter changes gated on a minimal, reproducible first-stage
diagnostic. The full technical evidence and exact historical run distinction
are in the [2026-11-22 migration checkpoint](HISTORY-MIGRATION.md#continuation-checkpoint--2026-11-22-1645-utc).

### Branch and chat reconciliation

The local mirror refs for `task/crop-history-cross-platform-20261029` and
`task/overnight-crop-history-20261030` are `97b80395b` and `ac3487d94`. The
first branch tip is not an ancestor of current main, but its drag-cancel
prevention handler is present in main through `6f9aaf535`; do not equate that
landed behavior with the old branch tip being fully merged. The current DAG
cannot tell whether the old branch was merged and later rewritten. The overnight
branch is checked out clean in a live worktree, has no stale/missing-worktree
holding, and is not proven ownerless. The old compositor omits the final
post-conversion currentness assertion, owned-bitmap cleanup in the catch path,
and the produced-bitmap invariant check; its frame-overlap copy uses
`drawImage` where current main uses `getImageData`/`putImageData`. Both trees
contain the direct-affine source helpers. The old tree removes three
`toOwnedBitmap` tests for canvas input, fallback, and error propagation. Its
crop-history E2E file has 29 test declarations versus 34 in current main; their
case bodies have not been audited one by one. Do not merge or reclaim it based
on October chat summaries.

Kilo's October 30 audit (`ses_e71e39819ffe59ps2H2bfyk2Zk`) says the crop
drag work was landed and the overnight branch remained unmerged; current Git
supports the landed handler behavior and the overnight branch's current
non-ancestry, but cannot resolve whether history was rewritten after landing.
Its child branch review did not finish. A free Nemotron review treated
non-ancestry as proof that the crop work was never merged and missed that both
trees contain the direct-affine helpers; exact `git show`, `git blame`, and
source comparison corrected those claims. The Luna 6 review recorded in the
12:16 checkpoint covered that earlier candidate only; no Luna review was
launched in this free-only continuation. Codex's local index has no dedicated
old-branch thread, and Copilot's current stable local store has no exact
branch-name hit. These are local-only
searches; remote/synced Codex or Copilot history and other VS Code profiles
were not inspected. Treat model and chat reports as leads.

The free open-source-editor scan covered GIMP, Krita, MyPaint, and Pinta, an
expansion of the earlier 11:19 survey of GIMP, Pinta, and MyPaint. Their
documents describe different undo grouping, snapshot, graph, and canvas
rendering choices. They provide architecture comparisons, not Photoshop
behavior, an explanation for this browser discrepancy, or a substitute for
the app's exact parity and lifecycle gates.

### Ordered next steps

1. Build a minimal deterministic case at the paint-layer accumulation boundary.
   Render the same producer-valid source through legacy direct `drawLine()`
   and cached `drawImage()` on the same accumulated destination; capture exact
   HTML and Offscreen pixels and identify the first changed bytes.
2. Check the samples and Canvas state against current source before editing
   production. Keep the parity assertion exact. Do not add a tolerance or
   change the production adapter until the failing stage is reproducible and
   its intended behavior is supported by Photoshop or another primary source.
3. Keep the passing affine × fractional-quarter-turn control and exact frame,
   matrix, bounds, composite, and per-layer assertions. After closing the
   mixed-source mismatch, run the focused proof on Linux, Windows, and macOS;
   the older 88-byte mirror result is historical, not a current pass.
4. Keep `HistoryItem[]` and `replayHistory()` as logical undo/redo authority.
   Source admission, PNG/PSD export authority, and durable cutover remain
   closed. Continue the typed text-source lifecycle slice from `HANDOFF.md`
   §1 only after its owner handoff or documented full process-tree liveness
   proof, then prove integration, refusal/failure, navigation, canvas, PNG,
   and PSD behavior before changing `ownership-unproven`.
5. Do not land this candidate while the exact mixed-source assertion is red.
   Before a later landing, rerun typecheck, lint, focused proof, scoped repo
   state, path locks, landing occupancy, and candidate pins; use the documented
   owner-tracked wrapper and verify the final tree and both parents. Do not
   fetch again or push during this continuation.

## Latest continuation reconciliation — 2026-11-21 23:31 UTC

### Current refs, ownership, and landing state

The designated local `main` worktree is
`/Users/bkalynovskyi/ph/.kilo/worktrees/landing-main-recovered-20261112` at
`40910ef2a9b991627c29f7cc7aba484479bd84ab`. The review worktree is
`/Users/bkalynovskyi/ph/.kilo/worktrees/history-migration-current-20261115-2` on
`task/history-migration-current-20261115-2`, based on that pin. The current candidate contains five
intended changes: three tests and two documentation files; no production history source changed.

The one `origin/main` fetch was performed at the start of this continuation. At that point
`origin/main=e31679a888261612e5efabe7bb3ce8d822a51479`, an ancestor of local `main`, and the local
comparison was `origin/main...main = 0 19`. After the start snapshot, the shared tracking ref
advanced. At 2026-11-21 23:11 UTC, both `refs/remotes/origin/main` and read-only `git ls-remote
--heads origin main` reported `e6b6183e4c507ed6dd18dbf2b5d267926b348ab6`; no second fetch was
performed. The current local comparison is `main...origin/main = 19 2`.

The post-start remote delta `e31679a..e6b6183` is 17 files (+552/−107), comprising `21169dd0c` and
its merge `e6b6183e4`. It adds retained-live-lock handling in the agent board and updates
orchestration/release guidance. Its only migration-adjacent path is
`src/contexts/__tests__/image-load-save-utils.signatures.test.ts`, where one test timeout changed to
15 seconds. It changes no history production source, migration document or plan, `HANDOFF.md`, or
`e2e/crop-history.spec.ts`. Keep that separate process/tooling delta out of this narrow candidate;
review and sync it in a separate operation. Do not push.

The task branch was fast-forwarded to local `main` pin `40910ef2a9b991627c29f7cc7aba484479bd84ab`
before edits. At 23:12 UTC, `main:landing -- status` reported the designated landing checkout free.
The scoped `repo:state -- --for-landing task/history-migration-current-20261115-2` gate exited 0;
six unrelated worktree-operation findings remain reported and untouched. `swarm check` found no file
locks on this candidate's five paths. The open `ph-93` text-source issue is a reference, with no
active claim or file locks; it is the later proof slice, not this candidate's owner.

Local `main` contains the layer insertion-order feature (`e90e4ea2c`, `9d6e146e7`, with its
supporting layer actions in `cd3a7236c`). The history row retains `insertAfterLayerId`; legacy
replay and durable conversion/replay both use it. `orderImmediatelyAfter()` throws when that anchor
is absent. The rest of the durable-history boundary is unchanged: `HistoryItem[]` remains logical
authority, durable replay remains staged presentation/export with legacy fallback, and the existing
identity, coverage, freshness, lease, preview, failure, and exact-parity gates stay closed.

### Current proof slice and verified behavior

The insertion-order change added two cases that were not in the prior replay proof matrix:

1. A disabled earlier reorder before an enabled create that points at a layer by
   `insertAfterLayerId`. Both full folds skip the disabled reorder, then derive the create from the
   same current layer set. This is supported by source inspection, not inferred from the earlier
   Terra report. The new parity case requires exact legacy/durable results at every cursor, the
   explicit cursor-1 order `layer-a, layer-b, layer-c`, tip order
   `layer-a, inserted, layer-b, layer-c`, and a disabled durable reorder operation.
2. Disabling a create that a later enabled create still uses as its insertion anchor. The history
   panel eye action reaches `useHistory.toggleDisabled()`. Legacy replay throws on the missing
   anchor before `APPLY_HISTORY_REPLAY`, so no changed timeline, cursor, or layer state is dispatched.
   The catch logs the error and dispatches `SET_DURABLE_STATUS` with an unavailable diagnostic for
   the dependent target row. The real reducer preserves legacy history/runtime fields while clearing
   the durable projection; the hook and StoreContext tests pin those separate boundaries. This does
   not select a cascade, skip, or append-at-top policy for this product-specific case.

This proof slice changes tests and documentation only. It does not publish the failed toggle,
change converter or presentation policy, or relax any ownership/admission gate. The missing-anchor
case remains an explicit UX contract question: the visible refusal should be made understandable,
and the product behavior for disabling a referenced create should be chosen before changing replay
semantics.

### Cross-chat reconciliation and limits

The local Kilo database scan covered 7,973 sessions under `/Users/bkalynovskyi/ph`, including 1,097
updated since 2026-11-15. The bounded recent text query found 14 matching sessions. The 2026-11-20
`ses_e0517b221ffe7TydYLpm2PLkEH` History/Replay review reiterates the staged authority contract and
the typed text-source ownership slice; it is review text, not implementation or runtime evidence.
The `ses_e068661e0ffeBUzlojr4nvHinB` test inventory reports 48 `useHistory.test.tsx` cases but does
not cover the insertion-anchor toggle sequence. Other recent matches were loose-end batches or
unrelated crop-history reviews. The older `ses_e23419c89ffe16oXioMbLaX7SJ` PH-71/PH-93 audit agrees
with the documented order: close the bounded diagnostic first, then continue source ownership.
Kilo results are leads; source and tests above decide the current behavior.

The Codex state index reports `backfill_state=complete`; its current-project index contains 72
threads updated since 2026-11-15. The recent rollout-content scan found this active root
`01a1791a-beaf-7eb2-8c7c-e10b483cf962` and no newer independent history-migration implementation.
The older planning root `01a17f24-9224-7aa0-a412-3afafa09f797` asks for a durable next-step plan and
implementation from current main; that plan is this document's text-source ownership sequence.
Codex searches covered local indexed rollouts only, not remote or synced history.

Copilot Chronicle has 19 local sessions and none mapped to this exact project path; the matching
workspace-storage journals contain only root records with empty request arrays, and the global
Copilot transcript folder is empty. Agent Host has a 2026-11-05 parent session
`copilotcli:/3dae0b34-2298-4d9e-ba96-34a461ee811d` on
`audit/stale-harvest-followup-20261103` with 16 history-related subagent titles. The parent has 23
persisted local-turn rows, all with `failed` status. Six of the 16 history-related titles map to
persisted local-turn rows and all six have `state=error`; one retained tool-call parts but no
assistant response text. The other ten titles have no persisted local-turn row. These titles provide
no usable review findings. The current session cache adds no migration evidence. Remote/synced
sessions and other VS Code profiles were not inspected; no absence claim extends to those stores.

### Open-source editor references

The [GIMP undo-system overview](https://developer.gimp.org/core/specifications/undo/) describes
image actions with undo data, grouped actions, and clearing redo when a new action is pushed. The
[GIMP manual](https://docs.gimp.org/3.0/en/gimp-concepts-undo.html) describes image-scoped history
that is not saved in XCF. The [Krita Undo History docker](https://docs.krita.org/en/reference_manual/dockers/undo_history.html)
supports moving to a prior state and cumulative stroke grouping; its [Snapshot docker](https://docs.krita.org/en/reference_manual/dockers/snapshot_docker.html)
stores a separate document snapshot and discards the undo stack when switching snapshots. These
references reinforce keeping timeline navigation, grouped edits, and document snapshots as
separate contracts. They do not define this app's per-row disabled-entry behavior.

### Validation and review history

At 2026-11-21 22:58 UTC, the focused validation passed 3 files and 101 tests; `npm run tsc`,
`npm run build`, and `npm run lint:check` passed. Lint reported 127 warnings and no errors;
formatting and `git diff --check` passed. These commands ran in the task worktree. No history
production source or admission/authority gate changed.

Four free Nemotron 3 Ultra reviews were completed on two successive candidate drafts. All usable
outputs were non-empty, `finish_reason=stop`, and reported `cost=0`; Kilo was skipped due its
recorded HTTP 429 cooldown, so all completed calls used the exact OpenRouter
`nvidia/nemotron-3-ultra-550b-a55b:free` route. The first draft review used 13,809 prompt and 2,876
completion tokens across two OpenRouter requests (the 4,096-token response hit `length` and the
runner retried at 6,144). It alleged a cursor-1 gap and possibly absent disabled operation; local
normalizers and converter disproved those claims. We made the test more explicit with expected order
at baseline, cursor 1, and tip, and required the durable row with an exact operation kind. The next
parity review used 16,669 prompt and 3,597 completion tokens and found no actionable issue, though
one explanatory sentence incorrectly attributed the missing-anchor throw to durable conversion; the
source shows it comes from legacy replay before durable conversion. The toggle/reducer review used
14,996 prompt and 4,711 completion tokens and found no actionable issue. The documentation review
used 14,685 prompt and 6,649 completion tokens; its branch/worktree and completed-step findings were
fixed, and its case-specific assertion finding was fixed with a declared expected disabled entry.
Its recommendation to remove the detailed Copilot scan counts was not adopted because these are
reproducible coverage details with explicit failure/no-output limits, not positive review findings.
These are model leads; each technical claim above was checked against source, tests, or the scan
record. Two final exact-tree reviews were completed on the refined tests and the documentation as it
stood before the mid-run origin update was recorded. The test review used the exact OpenRouter
`nvidia/nemotron-3-ultra-550b-a55b:free` route, returned non-empty text with `finish_reason=stop`,
reported `cost=0`, and used 21,547 prompt and 7,458 completion tokens in one OpenRouter request (no
Kilo request). It found no actionable test issue and confirmed the exact cursor matrix, non-vacuous
disabled-entry assertion, actual legacy replay failure path, and unchanged gates. The docs review
used the same route, returned non-empty text with `finish_reason=stop`, reported `cost=0`, and used
16,522 prompt and 5,018 completion tokens in one OpenRouter request (no Kilo request). It found no
actionable documentation issue in that reviewed version.

After adding the mid-run drift record, two separately prompted, tool-free reviews used the same
exact OpenRouter Nemotron `:free` route. Review one returned non-empty text with
`finish_reason=stop`, reported `cost=0`, used 5,512 prompt and 11,056 completion tokens, and
attempted two OpenRouter requests (the initial 8,192-token response hit `length`; the runner retried
at 12,288). It flagged both new links as having malformed heading anchors. I ran
`github-slugger@2.0.0` against the exact heading locally; it emitted
`latest-continuation-reconciliation--2026-11-21-2331-utc`, exactly matching both targets, so those
findings were false positives and no anchor change was needed. Review two returned non-empty text
with `finish_reason=stop`, reported `cost=0`, used 5,154 prompt and 4,994 completion tokens in one
OpenRouter request, and found no actionable issue. Both calls skipped Kilo due its recorded HTTP 429
cooldown. The two substantive updates—the post-start remote drift and restart sequence—were covered
by these exact-tree reviews. The review-ledger note itself was added afterward and checked locally
against saved runner outputs and the slugger result. Remaining pre-landing work is pin, ownership,
and scoped-gate revalidation.

### Ordered next steps

1. Recheck the worktree mappings, clean designated `main`, local `main` and candidate pins, current
   swarm path locks, and the scoped `repo:state -- --for-landing
task/history-migration-current-20261115-2` gate (require exit 0). Confirm the landing wrapper is
   free. Stage only the five documented candidate paths; commit with `Chat:
01a1791a-beaf-7eb2-8c7c-e10b483cf962`, then land locally through the pinned `main:landing`
   wrapper with the required `Branch: task/history-migration-current-20261115-2` trailer. Verify
   both parents, landed tree, and clean local `main`. Do not push. If the shared remote advances
   again, record and review that drift separately instead of silently widening this candidate.
2. Keep the referenced-anchor toggle fail-closed. Decide and document its user-facing refusal before
   any behavior change; never silently drop the dependent layer or treat a missing anchor as top
   insertion.
3. After this proof slice lands, resume open issue `ph-93` in a fresh worktree from the then-current
   approved local `main`. Recheck the issue and producer ownership first. Trace `commitDirtyTool` →
   `replaceLayerSource` → `REPLACE_LAYER_SOURCE_ACTION`; prove append and navigation fallback,
   bitmap/tmpCanvas identity and resource lifetime, stale/refused work, draw failures and preview
   interleaving, plus exact production canvas, PNG, and PSD pixels. Keep `ownership-unproven` closed
   until the proof passes; do not infer disposable ownership for the immutable text action.
4. Continue the fractional-frame matrix as a separate gate. Preserve exact-zero comparisons for
   runtime, PNG, PSD layers, and PSD composite; do not promote refused adapter measurements or
   change frame publication from those diagnostics.
5. Treat whole-document replacement teardown and any durable logical undo/redo authority cutover as
   later architectural work. Revisit cutover only after every surface has explicit identity,
   coverage, freshness, lease, preview, failure, and fallback proofs.

## Historical continuation reconciliation — 2026-11-14 18:03 UTC (superseded)

The designated local `main` worktree `.kilo/worktrees/landing-main-recovered-20261112` is clean at
`326d517478baeba0c4a28cccea2262a7e3e61bbc`, after the local main landing completed. The main delta
from `422f28a67f784eab8ecdb0232b3503df52d80d2f` changes 55 files. Its only history-specific change
is `src/contexts/__tests__/durable-export-adapter-parity.test.tsx`: an unmatched durable layer stays
on the legacy export selector, durable composition is not called, and the unused composite is not
released. No history production source or `e2e/crop-history.spec.ts` changed in that delta. The
focused adapter test passed all 15 cases after sync.

This candidate was synced to the new main pin in commit
`53cecaa5fe7faa5fe29234f3829bb707000e333f` (first parent
`f49813c1f7e2b190990dc99649cdd9d737b496a2`, second parent
`326d517478baeba0c4a28cccea2262a7e3e61bbc`, tree
`fa454a0ee5c3edf32d4b60a3704ca2a330957554`). The synced crop-history spec exited 0 in run
`2026-11-14T17-48-15-161Z-42927`; the sync commit hook passed lint-staged, typecheck, and build.
Refresh the final candidate tip/tree and landing preconditions after the docs update. The main delta
is already in the candidate; do not sync it again unless local `main` moves.

Live remote heads remain `origin/main=d0aa7bbf4037c2c98ebea80c9eef3aebb75b38e2` and
`mirror/main=108cc5d6477487ece41d89f9d85b5650d2144c6b`. The current local comparison is
`main...origin/main = 9 2` and `main...mirror/main = 37 0`. Origin's two unique commits change
worktree/process tooling, not migration source or tests. Do not merge or push the divergent remote
history here.

The bounded local refresh found no independent migration implementation or authority change in the
searched records. In the fixed 17:33–17:53 UTC window, Kilo had five `/ph` sessions; the only
non-synthetic, non-ignored text match was the coordinator's free-completion review prompt
`ses_e24df45f3ffevrLKjjMWfvDh17`. A broader query since 16:43 counted 26 sessions and seven
distinct session IDs with matching text, using `history migration`, `durable history`,
`crop-history`, `HistoryItem[]`, `replayHistory`, `retained operation`, and
`REPLACE_LAYER_SOURCE_ACTION`; those results were candidate reviews or unrelated crop-history
references. Two later Kilo sessions, “Parallel e2e test hardening cron” and “Explore: PSD/TIFF
baseline gaps in visual-regression.spec.ts,” contained no matching terms.

Codex `state_5.sqlite` had two `/ph` thread rows in the fixed window; the candidate-review child and
a CI-review child had no history terms in their user/assistant rollout text. The active root
`01a1791a-beaf-7eb2-8c7c-e10b483cf962` updated at 17:56:40 UTC, outside that window, and is this
conversation. A later metadata query showed no separate migration root; it did not scan every
rollout. Copilot Chronicle had zero `/ph` sessions in the fixed window. One free Kilo Nemotron
response was non-empty and reported $0, but the local record did not expose its finish reason; it
was used as a lead, not complete review evidence. These store-specific results do not cover
remote/synced Codex history or remote/inaccessible Copilot sessions.

The next implementation remains the separate typed text-source ownership lifecycle slice described
below. Keep the `ownership-unproven` gate closed until its append/navigation integration, runtime
identity and lease lifecycle, failure/interleaving, and production canvas/PNG/PSD proofs pass.
`ph-71` is limited to the diagnostic fixture in this candidate; land it before starting the
follow-on slice, which needs a separate task and owner.

## Current Contract

- `DurableConversionStatus` is `current | partial | unavailable`.
- `partial` means the converter saw an entry-level error diagnostic. It is diagnostic-only:
  `convertLegacyHistorySafely()` returns no durable document and no cursor map.
- `unavailable` is reserved for conversion exceptions or infrastructure failures.
- `stale` remains the StoreContext runtime-divergence state.
- `normalizeDurableProjection()`, navigation, export, reorder, append, history-panel projection,
  and tool hydration admit only `current` durable state.
- Non-reconverting reducer transitions preserve every non-current status; they cannot turn `partial`
  or `unavailable` into `stale`.
- `layer transparency` remains a legacy diagnostic label but is no longer a legal `ActionType`:
  there is no writer, durable translator, or replay arm for it.
- A duplicate history id is classified against legacy replay: enabled duplicates that change, or
  lack a canonical no-op proof against, the legacy snapshot produce an error diagnostic and
  `partial` status. Proven idempotent/absent-layer duplicates and disabled duplicates remain
  warning-only. Operations without an explicit no-op proof are conservatively treated as potentially
  state-changing.
- `convertLegacyHistorySafely()` requires `documentId` for legacy arrays so successful asset
  conversions cannot create an unreachable random registry owner; durable-document pass-through
  still derives its identity from the document.
- A blocking enabled-entry diagnostic returns `partial` with no publishable document or cursor map.
  The converter may expose an exact prefix through `safePrefix`, whose assets use an independent
  owner and whose `release()` must be called by the diagnostic consumer. StoreContext releases it
  immediately and keeps partial state out of every exact projection path.
- Empty legacy timelines accept append cursor `0`; the append validator rejects only negative,
  non-integer, or out-of-range positions. The first crop/edit can therefore produce a `current`
  durable document without an opening baseline row.
- Legacy `HistoryItem[]` remains logical authority. Durable navigation is a staged presentation
  projection with legacy fallback, not a completed undo/redo authority cutover. Supported committed
  eligible append/reorder transitions also compose a durable presentation in the background, but keep
  the already-visible legacy selector active while composition runs so transient previews are not
  blocked. Image/blank layer creates can request that presentation after asset finalization only if
  the preceding active cursor prefix passes the existing ownership and frame gates; their own
  navigation cursor remains on the legacy fallback. Shape Tool creates convert to typed vector
  entries but remain unpublished behind the `NEW_LAYER_ACTION` ownership gate. Other tool-source
  creates, later source-backed edits, source replacements, merge and frame-changing commits retain
  their gates.

The default active UI prefix remains gated: `App.tsx` boots a blank document through
`setBlankImage()`, and `useLayer.ts` stores its initial blank layer as a `NEW_LAYER_ACTION` that the
ownership gate treats as unproven. Imported-raster baselines are gated as well. A narrow alternate
route is now verified in headless UI tests: disable the default blank History row, then either paste
a deterministic raster or add a transparent blank layer from the tablet Layers drawer. Both
appends paint from the durable cursor and preserve exact empty/composite/layer pixels in the canvas,
PNG, and PSD. Undo/redo keeps exact canvas pixels; redo uses the complete `ownership-unproven`
legacy fallback while the root stays disabled. This proves only the user-disabled-root prefix. The
default active prefix, imported-raster starts, later source-backed edits, and frame-changing commits
remain gated. Do not broaden the exception to bypass the active-prefix gate.

A Shape Tool create is also characterized on that disabled-root route. Its durable conversion is
current, but the append presentation remains unpublished and the canvas uses legacy paint because
its typed vector source is outside the image/blank exception. The headless test compares the
transparent baseline, visible rectangle, PNG, and PSD composite/layer pixels against an independent
pixel oracle, then checks exact undo/redo; redo reports `ownership-unproven`. This pins the gate,
not vector eligibility.

## Main checkpoints and renderer evidence

The 69d checkpoint below is the earlier 14:33 snapshot; the later continuation reconciliations
record the current refs and candidate base. On 2026-11-14, the designated local `main` worktree at
`.kilo/worktrees/landing-main-recovered-20261112` advanced from
`21be39289f688d40c562fc614049cdca73856450` through `4d0d33130dcbbbdd406ee4ed735da1cefa853553`
to `69d22e89a3d8b4e6921834cf98083a5f241f2fa8`. The task worktree was fast-forwarded to `69d22e89a`
before this continuation's final focused run. The `4d0d33130..69d22e89a` diff changes only
`scripts/__tests__/agent-board.test.mjs`, `scripts/__tests__/find-session-id.test.mjs`,
`scripts/__tests__/free-web-research.test.mjs`, and `scripts/lib/agent-board/db.mjs`; it does not
change history source, migration docs, or `e2e/crop-history.spec.ts`. The earlier merge from
`21be392` to `4d0d33130` changed only `docs/TOOLS.md` and `src/tools/descriptions/shape.ts`. The
earlier ten-commit fast-forward from `52cf9e614` to `21be392` touched
only `scripts/__tests__/agent-board.test.mjs`, `scripts/__tests__/free-model-pool-external.test.mjs`,
`scripts/__tests__/test-write-boundaries.test.mjs`, `scripts/free-model-pool.mjs`, and
`scripts/lib/agent-board/db.mjs`; no migration docs, crop-history tests, durable-history source, or
renderer code changed. The existing migration commits remain in main, including `0535f48d5`
(transformed-raster diagnostics), `7cc7cdc28` (out-of-bounds crop samples), `4ecce4b6d`
(premultiplied frame diagnostics), and `fd2915557` (premultiplied mirror readout). No newer
migration implementation was found in the checked history/export-parity or crop-history DPR2
branches; their checks are recorded with the chat-history reconciliation below. Live `git ls-remote`
checks during this continuation returned both `origin/main` and `mirror/main` at `69d22e89a`; the
task worktree fetched and fast-forwarded to that pin. No push was performed. The designated local
`main` worktree is clean at the same commit.

The historical `7cf69dca` affine-parity commit is not an ancestor of current main. Its behavior has
evolved in the current compositor: `3ccccba0` introduced direct affine raster composition and
`6f9aaf53` extended that route to raster and vector sources with bitmap cleanup. The exact recovered
fractional mixed-source fixture now passes byte-identical composites at all three transitions in
the tested browser environment. It uses angles `37`, `0`, and `-17` with fractional frames
`{x:4.25,y:4.5,width:55.75,height:55.5}`,
`{x:5.125,y:6.25,width:53.5,height:51.875}`, and
`{x:6.75,y:6.125,width:49.875,height:49.5}`. The old first-transition mismatch at `(5, 26)` with
legacy red/alpha `188/122` and durable `190/121` is not reproduced for this recovered fixture. Mark
that observation resolved only for these inputs and this environment; the root cause, other frame
matrices, and cross-platform parity remain unproven.

The transformed-raster opacity/blend fixture uses opacity `0.58` and `multiply`. Its premultiplied
tight pixels, bounds, dimensions, opacity, and blend metadata match in the HTML and OffscreenCanvas
comparisons at the affine and fractional-frame cursors. On macOS, 12 straight-alpha readback bytes
differ by one at each cursor; the exact premultiplied comparison remains zero. Drawing the production
Invert processor's returned OffscreenCanvas into a fresh HTMLCanvas readback yields identical bytes
for legacy and durable inputs through both source canvas paths. This pins the downstream draw/read
boundary, not raw processor backing-store identity. The direct durable composite also matches the
legacy composite exactly. The focused E2E compares runtime projection,
`durableExportRecords()`/`renderExportCanvas()`, decoded PNG, PSD layer rasters, and PSD composite.
The normal admission predicate refuses the retained `apply-affine-transform` case at the affine
cursor and the retained frame-transform case after the fractional frame. These manually invoked,
refused adapter outputs are not selected for product rendering or export. An earlier local Chrome
run recorded 42 runtime/export/PNG bytes at the affine cursor and 46 after the fractional frame,
with PSD differences of 0 at the affine cursor and 8 composite/7 background-layer/0 foreground-layer
bytes after the frame. Continuation run `2026-11-14T08-19-01-147Z-1961` reports runtime/export/PNG
differences of 42 bytes across 38 pixels at the affine cursor and 42 bytes across 39 pixels after
the fractional frame. The cause of the difference between the 42/46-byte earlier capture and this
42/42-byte run is unknown; do not combine the runs or treat one as explaining the other. Keep these
run-specific observations separate; neither establishes a product-output defect. The earlier 146-byte
isolated-layer comparison over transparency is not a valid blend-mode oracle.

That current run also paints both paths over the fixture's opaque `#5070a0` backdrop. HTMLCanvas and
OffscreenCanvas each report 42 differing bytes across 38 pixels at the affine cursor and 42 across
39 pixels after the fractional frame; all differing bytes are RGB. Its controls report normal
composite `111/90` then `94/74` bytes/pixels, opacity-only `43/38` then `66/60`, and multiply-only
`71/61` then `79/64`. The different control counts show that opacity and blend affect the differential;
they do not identify its cause.

The same run mirrors `savePsd()`'s `drawLayerSource()` rasterization before `writePsd()` and checks
the decoded PSD separately. Integer layer bounds match between paths. Both pre-encode layers are
exact at the affine cursor. After the fractional frame, the foreground remains exact, while the
background raster differs by 11 channel bytes across 4 pixels (maximum channel delta 43); the
decoded PSD background layer reports the same 11/4 result, and the PSD composite differs by 13 bytes
across 4 pixels. The fractional background raster uses PSD-local bounds `left=-19`, `top=-21`,
`89x89`; the foreground uses `left=0`, `top=5`, `50x38`. A new same-backing experiment renders the
background into one `89x89` canvas and applies explicit `51x46`, `89x46`, `51x89`, and `89x89` clip
rectangles. The original local Chrome run found the four common-backing clip outputs byte-identical
for both legacy and durable sources across all 2,346 original-frame pixels. For legacy, comparing
the native-size surfaces to their corresponding common-backing clips gives 11 bytes/4 pixels
(maximum delta 43) for the baseline and width-only cases, 5 bytes/2 pixels (maximum delta 1) for
height-only, and zero for the
combined `89x89` case. The native width-only surface itself matches the frame baseline; the native
height-only surface differs by 10 bytes/5 pixels, and the combined native surface differs by 11/4.
Durable is exact for every comparison. In this fixture, explicit clip size did not reproduce the
legacy changes; the physical backing dimensions do, especially backing height. This localizes the
first observed difference to the refused `drawLayerSource()` rasterization into differently sized
canvases, but does not explain why the browser raster output depends on those dimensions. The
mismatch is present before encoding; it is not a confirmed product-path failure. The original local
focused run passed one test. Its physical backing-size matrix compares each result over the same
2,346 original-frame pixels. The legacy raw and rounded-`ImageData`-premultiplied results are:

The explicit-clip result is browser-specific too. Linux Chrome mirror CI run `43634393828` checked
source `8abd737bb0d182729f56ca71f5b0f3cb203e0024` and found 18 differing bytes across 7 pixels
(maximum channel delta 28) between the legacy width-only clip (`89x46`) and baseline clip (`51x46`),
both rendered on the same `89x89` backing. The differing frame-local cells were `(49,1)`, `(49,2)`,
`(50,2)`, `(50,3)`, `(50,4)`, `(1,45)`, and `(50,45)`.
This is a refused-path diagnostic control. The observed differences occur at or near the original-
frame edges; this control does not identify why. Record its exact deltas and coverage, but do not
require cross-platform equality.
The product runtime, export, PNG, PSD-layer, and PSD-composite checks retain their separate exact
parity and admission assertions.

| Backing size | Legacy raw bytes/pixels/max | Legacy premultiplied bytes/pixels/max | Durable raw/premultiplied |
| ------------ | --------------------------: | ------------------------------------: | ------------------------: |
| 51×46        |                       0/0/0 |                                 0/0/0 |              0/0/0; 0/0/0 |
| 89×46        |                       0/0/0 |                                 0/0/0 |              0/0/0; 0/0/0 |
| 51×47        |                       8/3/2 |                                 4/3/1 |              0/0/0; 0/0/0 |
| 89×47        |                       3/1/1 |                                 1/1/1 |              0/0/0; 0/0/0 |
| 51×51        |                      8/3/17 |                                 4/3/1 |              0/0/0; 0/0/0 |
| 89×51        |                      7/2/17 |                                 3/2/1 |              0/0/0; 0/0/0 |
| 51×89        |                     10/5/43 |                                 6/5/1 |              0/0/0; 0/0/0 |
| 89×89        |                     11/4/43 |                                 6/4/1 |              0/0/0; 0/0/0 |

The first legacy difference in matrix order appears when height grows from 46 to 47 at width 51:
frame-local pixel `(2, 0)` / document `(9.25, 8.5)` changes from raw RGBA `[80,112,161,224]` to
`[80,112,159,224]`; the premultiplied readback changes from `[70,98,141,224]` to
`[70,98,140,224]`. Across widths 51 vs. 89, raw/premultiplied deltas at heights 46, 47, 51, and
89 are `0/0`, `5/3`, `1/1`, and `5/2` bytes respectively. Raw width-height interaction deltas at
heights 47, 51, and 89 are 5/2/max-2, 1/1/max-2, and 5/2/max-1. Durable results remain exact in
all eight sizes and interactions. These are run measurements, not platform-specific assertions or
proof of the browser's internal surface representation. The extra backing row is associated with
the first observed difference; the rasterization cause remains unknown. Keep exact zero bytes on every surface if these records are admitted; retained
operations remain outside runtime and export admission, hidden layers force legacy PSD records, and
export checks actual materialized bounds before selecting durable records. No frame-changing commit
or logical history authority changed.

## Direct drawImage reproduction — 2026-11-14

Focused Chrome run `2026-11-14T12-04-20-540Z-28065` passed the
`e2e/crop-history.spec.ts` test “an affine raster keeps composite opacity and blend mode exact”
after the trace was tightened to select the first differing cell from a full-frame comparison and
to require exact replay fidelity.
For the legacy source, the 51×46 versus 51×47 comparison covers all 2,346 frame pixels and finds
8 differing channel bytes across 3 pixels, maximum delta 2. Its first differing frame-local cell is
`(2, 0)` / document `(9.25, 8.5)`: `[80,112,161,224]` becomes `[80,112,159,224]`. The durable source
has zero differing bytes at these sizes and is recorded as `no difference`, not assigned a synthetic
first-difference cell. HTMLCanvas and OffscreenCanvas report the same result.

The legacy trace captures the same 64×64 `ImageBitmap` and identical five-argument call
`drawImage(bitmap, 0, 0, 64, 64)` at both backing sizes. Its destination rectangle is `(0,0,64,64)`;
the context transform is approximately `(a=.857167, b=-.515038, c=.515038, d=.857167,
e=-18.620644, f=12.748785)`, with filter `none`, smoothing disabled, alpha `1`, and
`source-over`, image-smoothing quality `low`, and transparent zero-offset shadow settings. The first
differing pixel center maps to source coordinate `(24.4125, 0.3787)`.
The measured in-bounds source texels around it are `[80,112,160,255]`; the read does not include
out-of-bounds source texels.

The control replays the captured source, numeric arguments, transform, filter, smoothing, alpha, and
composite mode onto fresh 51×46 and 51×47 HTMLCanvas and OffscreenCanvas surfaces. For both backing
sizes, the direct replay matches its corresponding `drawLayerSource()` trace across all 2,346 pixels
with zero differing bytes. The direct pair therefore reproduces the same 8-byte/3-pixel legacy
difference on both canvas types; the durable pair remains exact. This isolates the observed
height-associated change to the captured Canvas 2D `drawImage` operation with these inputs. It does
not identify the browser's internal sampling or backing-store rule. The output copy to a common-size
canvas also preserves the already-rendered pixels and does not create the difference.

The same run's refused-adapter comparison reports 42 runtime, export-canvas, and decoded-PNG channel
bytes at the affine cursor (38 pixels, maximum delta 1) and 42 after the fractional frame (39 pixels,
maximum delta 1). PSD is exact at the affine cursor. After the fractional frame, the PSD composite
differs by 13 bytes across 4 pixels (maximum delta 43), the background PSD layer and pre-encode
raster each differ by 11 bytes across 4 pixels (maximum delta 43), and the foreground layer remains
exact. The normal admission predicate still refuses the retained operations. These are run-specific
measurements of manually invoked adapters, not product-output failures.

**Completed control:** add a one-pixel transparent border around the captured source and make
an `ImageBitmap` from that padded surface so the source type remains the same. For the original
`drawImage(source, dx, dy, dw, dh)` call, compute `scaleX=dw/sourceWidth` and
`scaleY=dh/sourceHeight`, then use destination rectangle `(dx-scaleX, dy-scaleY,
dw+2*scaleX, dh+2*scaleY)` for one-pixel padding. For the current 64×64 source/call this is
`(-1,-1,66,66)`. Before drawing, verify that the padded bitmap's visible interior matches the
original pixel-for-pixel and every new border pixel is transparent. Replay the same captured source
type, transform, filter, smoothing quality, alpha, composite mode, and shadow state at 51×46 and
51×47. Run the original unpadded control in the same evaluation and read all outputs through the
same `getImageData` path; compare the selected sample and all 2,346 frame pixels. Record deltas
without requiring a browser-specific output value. This deliberately changes source bounds and
rectangles; keep it separate from the exact-input reproduction above. The mapped sample is near the
original source's top edge, while its readback neighborhood contains no out-of-bounds source texels.

### Captured results — 2026-11-14

Focused Chrome run `2026-11-14T14-33-54-271Z-53382` passed the
`e2e/crop-history.spec.ts` test “an affine raster keeps composite opacity and blend mode exact” and
captured
the padding diagnostics for HTMLCanvas and OffscreenCanvas. Every output comparison covers all 2,346
frame pixels. The original 64×64 `ImageBitmap` and padded 66×66 `ImageBitmap` have byte-identical
64×64 interiors (16,384 bytes, zero differences); all 260 added border pixels have alpha zero. The
original five-argument destination is `(0,0,64,64)`. The mapped padded call uses
`(-1,-1,66,66)`, preserving the interior's document mapping exactly.

| Control                                                                              | Compared with the original five-argument draw at 51×46 and 51×47 | Difference between 51×46 and 51×47                                                |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Padded 66×66 source, five-argument call at mapped `(-1,-1,66,66)`                    | 28 bytes across 11 pixels at each size; max channel delta 170    | Exact: zero bytes                                                                 |
| Padded source interior `(1,1,64,64)`, nine-argument call to `(0,0,64,64)`            | 8 bytes across 2 pixels at each size                             | 1 byte / 1 pixel, max delta 2, at document `(9.25,8.5)`                           |
| Original 64×64 source `(0,0,64,64)`, nine-argument call to `(0,0,64,64)`             | Exact at each size                                               | 8 bytes across 3 pixels, max delta 2, matching the original backing-height result |
| Padded full source `(0,0,66,66)`, nine-argument call to original `(0,0,64,64)`       | 76 bytes across 19 pixels at each size                           | Exact: zero bytes                                                                 |
| Padded full source with mapped expanded geometry `(-1,-1,66,66)`, nine-argument call | Exact to the padded five-argument result at each size            | Exact: zero bytes                                                                 |

The exact original-source nine-argument replay matches its five-argument replay, so overload choice
alone does not explain the padding result. The padded-interior replay still differs when the
byte-identical visible source rectangle moves from `(0,0)` on the original bitmap to `(1,1)` on the
larger bitmap. This associates the remaining difference with the changed bitmap bounds/source
coordinates, but does not distinguish transparent neighboring texels from other bounds or
coordinate effects. The full-padded-source control at the original destination changes visible
content mapping and is not an equivalent-content comparison. The matched expanded-geometry control
shows that the five- and nine-argument overloads agree for that changed input; it does not identify
the browser's internal sampling or backing-store rule. These are HTMLCanvas/OffscreenCanvas
measurements in this Chrome run, not browser-specific assertions.

After removing the temporary diagnostic log and adding runtime guards for the trace's `unknown`
metadata, focused Chrome run `2026-11-14T14-44-43-452Z-3075` passed again and `npm run tsc` passed.
The output-capture run above is the measurement source; this final run verifies the test without
temporary logging.

**Completed edge-extension control:** Chrome run `2026-11-14T15-01-54-291Z-63465` passed
`e2e/crop-history.spec.ts` test “an affine raster keeps composite opacity and blend mode exact.” It
compared the transparent-border, all-edge, and right-edge-only
66×66 `ImageBitmap` sources using the same nine-argument source rectangle `(1,1,64,64)`, destination
`(0,0,64,64)`, captured context, both 51×46 and 51×47 backing sizes, and all 2,346 frame pixels.
HTMLCanvas and OffscreenCanvas results matched.

The table columns answer separate comparisons: the per-size column compares each control with the
original-source baseline at that same backing size, while the final column compares one control
across the 51×46 and 51×47 backing sizes. The 8-byte/2-pixel delta from transparent padding at each
fixed size is distinct from the 8-byte/3-pixel height delta for the original-source control.

The 64×64 source interior, all-edge border, and right-only border were each verified byte-for-byte
against the expected construction. The right-only bitmap extends exactly 64 border pixels and
leaves 196 transparent; the all-edge bitmap extends 260 border pixels. At both backing sizes, the
right-only output exactly matches the all-edge output and the original-source nine-argument replay.
Both edge-extended outputs differ from transparent padding by 8 bytes across 2 pixels at each
backing size. The 51×46 versus 51×47 output still differs by 8 bytes across 3 pixels, maximum channel
delta 2. For the separate 89×89 source control, all-edge and right-only outputs match transparent
padding and original-source replay exactly at both heights; the height comparison is also exact.
After removing the temporary edge-output log, focused run `2026-11-14T15-25-40-663Z-92127` passed
the same `e2e/crop-history.spec.ts` affine-opacity/blend test and `npm run tsc` passed. The 15:01
capture supplies the output measurements; the final run checks the test without that temporary log.

This run shows that changing only the right border changes output for the 64×64 fixture and that the
right-only result reproduces the all-edge/original-source result there. It does not identify the
browser mechanism, generalize to other source bounds, or explain the fractional-frame PSD difference.
The test validates source construction and complete comparison buffers; output byte counts remain
run diagnostics, not platform-specific assertions. Do not change production rendering, durable
admission, or the exact runtime, PNG, PSD-layer, and PSD-composite gates from this result.

**Added frame-matrix point:** Chrome run `2026-11-14T16-43-18-983Z-99538` passed one focused E2E for
a 23-degree crop with fractional frame `{x:8.25,y:9.5,width:47.75,height:43.25}` and two positioned
raster layers (`background` and a 16×16 `center-patch`). The test requires byte-identical legacy and
durable composites, exact materialized bounds and sizes, and zero HTMLCanvas/OffscreenCanvas frame
and tight-bitmap pixel differences. It does not exercise the refused runtime/export adapters, PNG,
PSD, other source types, or other angles; it closes only this fixture. Keep the wider frame matrix
open and do not infer export or authority eligibility from it. The test name explicitly limits the
claim to two positioned raster layers.

The source-bound diagnostic is complete under the current `ph-71` claim. The next implementation
slice is a separately owned text-source lifecycle proof after this diagnostic is reviewed and
landed: trace one product-reachable in-place text-layer edit through `commitDirtyTool` (`useLayer.ts`)
→ `replaceLayerSource` → typed `REPLACE_LAYER_SOURCE_ACTION`. Refresh the producer's live owner and
handoff before editing. The current StoreContext gate rejects this action as `ownership-unproven`,
but existing StoreContext coverage uses a generic replacement history item; it does not prove
append/navigation fallback for a valid typed text edit.

First add StoreContext integration coverage that passes the valid typed edit through append and
asserts no durable compose, the legacy selector, and exact current legacy pixels. Append presentation
must equal `EMPTY_DURABLE_PRESENTATION` (`status: 'unpublished', cursor: null, reason: null`); do not
require a navigation outcome at append time. Then invoke navigation,
undo, redo, and disabled-entry navigation and assert the returned/published
`legacy-fallback` with `ownership-unproven` and exact legacy output. Add a product E2E for the
reachable text edit, undo/redo, and production export. Compare production canvas, PNG, and PSD
layer/composite pixels byte-for-byte against an independent input oracle.

Track old/new runtime `bitmap` and `tmpCanvas` identity/generation and identify the actual disposable
materialization lease, if any. Assert acquisition/reachability, no early release, and exactly-once
cleanup after the last reachable owner is removed across append, navigation, disabled entries,
redo-branch truncation, and document close; do not invent lease renewal/expiry semantics. Give stale
or refused work, failed final drawing, and preview interleaving explicit pass/fail assertions. The
immutable typed text action does not register a raster asset. Keep whole-document replacement on
its separate document-teardown contract and the broader fractional-frame matrix independent. This
slice ends with admission closed; any eligibility change requires a separate reviewed change and
complete surface/failure proof.

## Loose Ends

1. **Authority cutover.** Legacy `HistoryItem[]` remains logical authority. Durable navigation is a
   staged presentation projection, and eligible committed append/reorder presentation composes in
   the background. A new image/blank layer create may request composition after asset finalization
   only if the prior active prefix passes the ownership and frame gates; its own navigation cursor
   and later appends still use the complete legacy fallback. Other source-backed commits and
   frame-changing commits remain on the complete legacy path. A typed vector Shape Tool create is
   characterized but remains unpublished; it does not widen the image/blank exception.
   The image/blank exception is reachable only after disabling the default blank History row, as
   the raster-paste and tablet blank-layer tests now prove. The default active new-document prefix
   and imported-raster starts remain gated; keep those paths unproven until their baseline ownership
   is resolved explicitly.
   Live previews also keep the complete legacy layer base until they clear;
   the preview tests pin that interleaving behavior but do not make preview a durable authority
   surface. Keep the existing identity, coverage, freshness, lease, fallback, and failure gates.
2. **Presentation parity.** Keep runtime and export byte-parity admission conservative. The recovered
   fractional mixed-source fixture passes exact per-layer checks and exact composites at its three
   transitions; it closes only those inputs and does not establish the cause of the older `(5, 26)`
   mismatch or the wider frame matrix. The opacity `0.58`/`multiply` fixture has exact premultiplied
   materialization and direct-composite results. macOS straight-alpha readback differences remain
   diagnostic; the production Invert processor's returned raster also matches after a fresh-canvas
   readback. The fixture records refused runtime/export adapters, decoded PNG, PSD layer rasters, and
   PSD composite pixels. An earlier local Chrome run's 42/46 runtime/export/PNG differences and the
   fractional-frame PSD differences are not product-path failures because admission refuses those records and the app
   retains legacy rendering/export. The observed draw operation and backing-height change are now
   localized by the exact-input and backing-size controls, but the browser sampling mechanism remains
   unknown, as does whether it explains the fractional-frame PSD difference. Keep the gate closed;
   resolve those causal questions before changing production code.
   The fixture records differing-pixel document coordinates, RGBA/alpha, aggregate bounds,
   source/backdrop samples, and exact runtime/export/PNG/PSD surface bounds. Its opacity-only and
   multiply-only controls run at both the affine cursor and fractional frame. The opaque-backdrop
   control compares legacy `drawLayer()` with a durable materialized-bitmap composite; its counts are
   a path differential, not a shared-renderer resampling oracle. The [Linux mirror run
   for commit `0535f48d`](https://github.com/Bohdanus/ph/actions/runs/42987298464) reproduces refused
   adapter differences: runtime/export/PNG differ by 118 channel bytes (91 pixels, maximum delta 1)
   at the affine cursor and 86 bytes (69 pixels, maximum delta 1) after the fractional frame. PSD is
   exact at the affine cursor; after the fractional frame its composite differs by 51 bytes across
   15 pixels, the background layer by 39 bytes across 15 pixels, and the foreground layer is exact.
   The measured layer bounds agree. At the reported source/backdrop samples, raw source and backdrop
   values agree; tight-bitmap premultiplied pixels and the fresh-canvas Invert result are exact. The
   raw frame surfaces differ at the affine cursor (101 bytes/91 pixels) and after the fractional
   frame (94 bytes/82 pixels). Focused Linux mirror run
   [`43208568731`](https://github.com/Bohdanus/ph/actions/runs/43208568731) tested exact source
   commit `1adbd46075e3d038d15c2769038aa4cc163ccdb2`; all 30 tests passed with no skips, retries, or
   unexpected results. Both HTMLCanvas and OffscreenCanvas report the same byte and pixel counts
   after premultiplication: 101/91 at the affine cursor and 94/82 after the fractional frame. The
   raw comparison reports zero non-edge pixels, but that Linux run predates the premultiplied
   alpha-neighborhood classifier. Its first eight premultiplied samples at each stage have equal
   alpha and a one-unit channel difference; the Linux run does not establish whether its remaining
   differing pixels lie on alpha boundaries. Materialized bounds match exactly; tight-bitmap
   premultiplied comparisons and fresh-canvas Invert readbacks report zero differences for both
   canvas types. In the 2026-11-14 macOS/Chrome run, HTMLCanvas and OffscreenCanvas each report 101
   differing premultiplied channel bytes across 81 pixels at the affine cursor and 96 bytes across
   76 pixels after the fractional frame. The per-channel counts are affine `r=21, g=24, b=34, a=22`,
   then fractional `r=29, g=23, b=18, a=26`. The broad eight-neighbor alpha heuristic marks all
   81/76 differing pixels as boundary-related and zero as non-boundary-related in this Mac run.
   This is not geometric-edge proof: the heuristic unions either image's partial-alpha neighborhood,
   can include unrelated alpha transitions, excludes center alpha 0/255, and ignores neighbors
   outside the frame. Do not apply the Mac classification to the older Linux counts. Both runs keep
   exact admission closed; the platform counts remain separate.
   The opaque-backdrop, PSD pre-encode, axis-extent, common-backing clip, eight-size physical backing
   comparison, first-difference trace, direct `drawImage` replay, transparent/source-bound,
   original-source overload, and edge-extension controls are recorded above. Do not repeat those
   probes without a new discriminating hypothesis. The edge run shows a right-border contribution in
   one 64×64 fixture but leaves the browser mechanism and fractional-frame PSD difference unresolved;
   it does not support a production rendering or admission change. Keep runtime, PNG, PSD layer, and
   PSD composite equality as separate exact-zero gates, and keep `SET_DOCUMENT_FRAME_ACTION` out of
   durable publication.
3. **Selection baseline.** `deriveSelectionBaseline()` must remain unbounded over the whole
   timeline. The selection undo tests are load-bearing tripwires.
4. **Status UI coverage.** Dev status, ErrorBoundary fallback, and structured diagnostics now
   accept `partial`; keep the exhaustive status record test when adding states.

## Recommended Sequence

Continue using the canonical migration gates in Loose Ends §2. The physical backing-size sweep,
first-difference trace, exact-input `drawImage` reproduction, transparent/source-bound controls,
original-source overload, and all-edge/right-edge-only border comparison are complete. The
recommended next implementation slice is one product-reachable in-place text-layer edit through
`commitDirtyTool` (`useLayer.ts`) → `replaceLayerSource` → typed `REPLACE_LAYER_SOURCE_ACTION` under
step 4's independent source-backed ownership gate. Refresh the producer's owner/handoff and prove
its `ownership-unproven` fallback before editing. Keep whole-document replacement on its separate
teardown contract. The broader frame-parity matrix remains open and unordered with this ownership
work.

1. Keep `safePrefix` diagnostic-only and release its independent owner at every consumer boundary;
   never let `partial` satisfy an exact projection gate.
2. Preserve the now-tested refusal behavior: `resetHistoryTo.durable.test.tsx` proves a refused final
   durable draw restores the StoreProvider timeline. Keep preview rendering on the complete legacy
   layer base while append composition is pending or accepted, then reveal the durable base only
   after the preview clears; `useLayer.render.test.tsx` pins accepted and refused append cases, and
   `e2e/undo-redo.spec.ts` pins live Brush preview pixels while durable status is current.
3. Keep the transformed-raster opacity/blend fixture diagnostic-only. The exact-input `drawImage`,
   transparent/source-bound, original-source overload, and edge-extension controls are complete and
   recorded in §2. The right-only result matches all-edge extension and original-source replay for
   the 64×64 fixture, while the 89×89 fixture is exact against transparent padding; neither result
   identifies the remaining fractional-frame PSD mismatch or the browser mechanism. The existing
   E2E already compares direct legacy drawing with tight-bitmap placement into a transparent frame,
   copied frame-grid pixels with the materialized tight bitmap, and PSD pre-encode with decoded
   layer/composite output; do not describe those controls as unmeasured. Keep runtime, PNG, PSD layer,
   and PSD composite equality as separate exact gates.

   Do not change production rendering until these comparisons identify the first divergent boundary.
   If the evidence shows direct source drawing is required, consider a narrowly scoped durable
   presentation record that retains a leased immutable source and its affine operations while
   keeping the materialized bitmap for layer and export consumers. That design would need explicit
   source identity and generation, full visible-layer coverage, cancellation and stale-result
   rejection, one-time release on replacement or failure, and whole-document legacy fallback when
   any source cannot be resolved. Prove runtime, PNG, PSD layer, and PSD composite pixels
   independently with exact equality before considering admission. Do not allocate a full-document
   bitmap per layer.

   Keep the broader fractional-frame matrix open across open angles, additional retained-affine
   combinations, text styling/rotation, blank opacity variants, and fractional materialized bounds
   for each source family. Keep `SET_DOCUMENT_FRAME_ACTION` out of durable publication until that
   matrix is explicit; add cursor checks without changing publication, cursor, or lease ownership.
   Frame parity and source-backed import/replacement ownership remain independent gates.

4. Keep the image/blank create exception scoped to the current append. It may request background
   composition after asset finalization only when the preceding active cursor prefix passes the
   ownership and frame gates. The create's own navigation cursor and later appends remain on the
   current legacy fallback until the broader source-ownership proof is explicit. Preserve the shared
   bitmap lifetime proofs in `src/contexts/__tests__/layer-presentation.test.ts` and
   `src/contexts/__tests__/StoreContext.retirement.test.tsx`: a cross-document bitmap remains live
   until its last owner releases it, and same-id replacement retires against the replacement record.
   Continue source-backed import/replacement ownership and parity as the other independent gate; keep
   unsupported-source refusal explicit and do not use either gate's differential to promote broader
   surfaces.
5. Only after every surface has explicit identity, coverage, freshness, lease, preview, and fallback
   proofs, decide whether durable replay can become logical undo/redo authority. Retire boundary
   tests for deleted coordination modules only in the same architectural change that replaces their
   contract.

## Investigation Lessons

- Reconcile every agent report against current source. Several audit claims about dead materializer
  paths, missing blend-mode handling, and append asset reconciliation were stale in this tree.
- A rejected conversion must not publish a cursor map derived from a stale suffix. Withholding the
  map is safer than claiming a partial timeline is exact.
- A type union change requires tracing reducers, export/navigation gates, diagnostics UI, fixtures,
  and exhaustive tests. The `partial` addition touched all of those surfaces.
- Duplicate-id handling must distinguish resolver-only skips from omitted edits. Keeping the fold
  advanced preserves legacy suffix derivation, but an enabled omitted operation cannot remain
  `current` merely because the raw converter can continue.
- Conditional follow-up from `HANDOFF.md` §94, not an immediate gate: durable replay applies a frame
  operation's `next` and does not read stored `previous`. If a replay consumer starts reading
  `previous`, track the last durable-reachable frame separately and update the named diagnostics
  tests; do not remove the deliberate fold advance in `legacyHistoryToDurable()`.
- Operations without a canonical snapshot no-op proof are conservatively treated as state-changing
  when duplicated. That may withhold a durable shadow, but it cannot publish a false-current render;
  add operation-specific proofs before relaxing the gate.
- Do not implement a full durable authority cutover as a cleanup of legacy code. It is an
  architectural migration requiring independent parity and ownership evidence.
- Open-source editor history designs are comparative patterns, not Photoshop requirements or an
  ordering decision for this migration. [GIMP's image undo code](https://github.com/GNOME/gimp/blob/master/app/core/gimpimage-undo.c)
  transfers entries between separate undo and redo stacks and groups weak operations.
  [Krita's undo-store interface](https://raw.githubusercontent.com/KDE/krita/master/libs/command/kis_undo_store.h)
  separates command storage from adapter behavior, including
  [strokes whose command has already executed](https://raw.githubusercontent.com/KDE/krita/master/libs/image/kis_post_execution_undo_adapter.h).
  [darktable's pixelpipe guide](https://github.com/darktable-org/darktable/blob/master/dev-doc/pixelpipe_architecture.md)
  describes rebuilding module state by replaying history through its cursor. These examples support
  keeping timeline state, command execution, and preview presentation explicit, but do not define
  this app's gates.
  Other primary-source implementations differ on redo-tail and failure ordering:
  [miniPaint's action state](https://github.com/viliusle/miniPaint/blob/master/src/js/core/base-state.js)
  executes a new action before pruning redo, while
  [Pinta's document history](https://github.com/PintaProject/Pinta/blob/master/Pinta.Core/Classes/DocumentHistory.cs)
  prunes before appending; [LazPaint's image history](https://github.com/bgrabitmap/lazpaint/blob/master/lazpaint/image/uimage.pas)
  clears its history when replay fails, whereas
  [Pikado's snapshot history](https://github.com/koneb71/pikado/blob/main/src/core/history.js)
  advances its cursor before restoring a snapshot. These differences are implementation analogies,
  not Photoshop requirements or a contract for this migration. Keep the repository's branch,
  replay-failure, rollback, and ownership tests as the authority for local behavior.

## Prior Validation Evidence

Implementation commit `04f95264ed20aef5168e602409b9fd253120e4ed` (tree
`8fff8d49d892febd6fabe55f128d9dd7fa33a10e4`) was validated on the local macOS checkout after
rebasing onto `main` at `b5df9dbc272e208dc04768259228e13abdad33fb`.

- Focused durable export/projection unit tests: 4 files, 68 passed.
- `npm run test:e2e:unit`: 22 files, 1,564 passed and 12 expected failures.
- Focused Chrome E2E: 2 passed (recovered fractional frame transitions and affine raster opacity/blend),
  run `2026-11-07T02-06-40-691Z-35133`.
- `npm run tsc`, `npm run build`, `npm run lint:check`, and `git diff --check` passed. Lint reported
  78 warnings and no errors; the changed implementation and E2E files pass focused ESLint checks.
- No Linux or Windows mirror run was performed. Local browser results do not prove cross-platform or
  Photoshop pixel parity, and the wider frame matrix remains open.

## Continuation Validation — 2026-11-07

This continuation was rebased onto local `main` at `30e32ccf6efba0536525ac66a8e71e04a97889ab`.
`bd5f3d29f` adds refused-adapter diagnostics; `8c842c4fe` changes the frame and tight-raster
alpha-boundary allowances to exact zero. No production source file changed.

- Focused Chrome E2E in `e2e/crop-history.spec.ts` for retained affine/frame parity and opacity/blend
  adapter diagnostics: 2 passed, run `2026-11-07T09-54-49-011Z-42015`. The adapter diagnostic
  reproduced 42 runtime/export/PNG channel differences at the affine cursor and 46 after the
  fractional frame; PSD had 0 composite/layer differences at the affine cursor, then 8 composite, 7
  background-layer, and 0 foreground-layer differences after the fractional frame. The admission
  predicate refused both cursors.
- Full `npm run test:e2e -- e2e/crop-history.spec.ts`: 19 passed, 11 failed, run
  `2026-11-07T09-49-22-961Z-26277`. The failures are toolbar-helper interactions outside the changed
  parity assertions: seven expected `tool-overflow-tile` controls were hidden, and four clicks timed
  out waiting for `tool-button-draw` or `tool-button-text`. The strict retained-layer and opacity/blend
  tests passed in the separate focused run. A full run of the same spec at base `30e32ccf6`
  reproduced the same 19 passed, 11 failed, and the same 11 failing test titles, run
  `2026-11-07T10-08-37-864Z-2500`. This confirms those toolbar-helper failures predate this candidate;
  the full spec is still not green and should be tracked separately, but they are not regressions from
  the exact-parity test changes.
- `npm run tsc`, `npm run build`, and `npm run lint:check` passed. Lint reported 78 warnings and no
  errors; Prettier formatting passed. No Linux/Windows mirror or independent Photoshop oracle was
  run. These are local macOS/Chrome results only.

## Review Findings and Dispositions

The post-sync implementation review covered commit `04f95264ed20aef5168e602409b9fd253120e4ed`
and tree `8fff8d49d892febd6fabe55f128d9dd7fa33a10e4`, based on local main `b5df9dbc`:

- The prior Luna 6 review found that export checked replay layers individually but did not require an
  exact replay/legacy layer set. This was fixed before the reviewed commit: export now falls back when
  either set has a missing or extra layer, with PNG and PSD regression cases. Luna's fresh post-sync
  follow-up found no further actionable issue and confirmed the bounds and hidden-layer PSD fallbacks.
- Four complete exact-zero OpenRouter completions reviewed the immediately preceding source tree
  `78a91e0d7721914167750a6cfecf5c82d0d4271e`: Nemotron 3 Ultra checked export admission; Liquid LFM
  2.5 checked export and E2E/docs; Cohere North Mini Code checked runtime/export freshness and
  resource release. Rebase changed no history, export, renderer, or E2E source files; the imported
  main delta only removed a stale note from `docs/FREE-COMPUTE.md`. All four returned
  `finish_reason=stop` and reported `$0` cost. A separate post-sync free attempt ended with empty or
  length-limited output and is excluded from review evidence.
- The free reviews proposed possible hidden-layer loss, a bounds-test mismatch, and composite leak or
  double-release paths. Source and tests show these are blocked: PSD with hidden replay layers uses
  legacy records, replay/legacy visibility and metadata mismatches refuse admission, the bounds test
  starts with matching legacy/materialized bounds before changing the composite, and the save handler
  releases composites in `finally` with idempotent release guards. The E2E/docs review restated the
  intentionally open runtime/export and wider frame-matrix proof; those remain explicit next steps.
- Codex had no Kilo CLI or verifiable free subagent launcher in this session, so the free reviews used
  the repository's tool-free completion runner rather than tool-using Kilo subagents. Incomplete model
  responses were not review evidence.
- A prior Luna 6 docs review correctly caught that the 42/46-byte runtime/export observations were
  presented too strongly while they were still exploratory. The current E2E diagnostic now
  reproduces those counts only by manually invoking adapters that production admission refuses; the
  docs distinguish those diagnostics from the live legacy-fallback product path. The root cause is
  still unknown, and the detailed runtime/PNG/PSD isolation sequence below remains open.

The actionable export layer-set finding is resolved. Keep the transformed-raster runtime/PNG/PSD
parity proof, broader frame matrix, and source-backed ownership as independent remaining gates.

## Chat-history reconciliation

The local-only scan was refreshed on 2026-11-14 against Kilo's current SQLite store, Codex's
`state_5.sqlite` index and selected rollout JSONL files, Copilot Chronicle's normalized
`session-store.db`, and Copilot Agent Host session databases. Search terms covered `/Users/bkalynovskyi/ph`
and `history migration`, `durable history`, `crop-history`, `premultiplied`, `affine frame`, and
`history authority`. Transcript text and model summaries were treated as leads and checked against
the live refs, source, tests, and migration docs. This is a bounded local scan, not proof that no
other conversation exists.

- Kilo's `ses_e83e2f95fffekfXcQ5FRRtAKCP` (“Continue history migration”, Oct. 27) records the
  one-alpha per-layer mismatch at `(36, 26)` and shared frame-surface reuse that addressed that
  exact case; broader frame coverage remained open. `ses_e4a86735affeprODxyceMw78v6` (“Integrate
  opencode into free compute machinery”, Nov. 7–8) contains the failed cross-platform crop-history
  run and refused opacity/blend adapter observations, without an authority-order decision.
  `ses_e31495b30ffevxkBRHjL4Y3CpD` (Nov. 12) is Photoshop tool-documentation work. Recent Kilo
  records `ses_e28649794ffeo0sj6cCywsUj4Y` (“Migration state review”) and
  `ses_e6708ccb1ffeUuAzKBcd77rF80` (“E2E test hardening with subagents”) contain generated state
  summaries and durable reset unit-test work, respectively; neither supplies a newer migration
  authority decision. The free plan `ses_e27d6a3f1ffefrFGpSatjKLjKi` recommended width-only and
  height-only extent controls, now present in the E2E. The free review `ses_e27dd927dffeZeOYCdcowHKgTO`
  raised claims about removed helpers, `drawImage` arguments, and frame assertions that were checked
  against current source and found stale or misread.
- The broad Kilo/Codex/Chronicle chat-search returned 500 Kilo sessions (the configured cap), 37
  Codex sessions, zero `/ph` Copilot Chronicle sessions, and 30 excerpts. Its Nemotron 3 Ultra
  `:free` Kilo synthesis completed with `finish_reason=stop`, reported `$0` cost, and used 32,965
  input, 1,783 output, and 3,520 reasoning tokens. It repeated a stale main pin, mischaracterized
  already-implemented axis controls as future work, and asserted review issues that local source
  checks did not confirm. Treat that synthesis as a retrieval aid, not review or branch authority;
  the Kilo cap also means the scan is not exhaustive.
- Codex's current continuation is `01a1791a-beaf-7eb2-8c7c-e10b483cf962`. The historical plan
  `01a17f24-9224-7aa0-a412-3afafa09f797` has a Nov. 13 metadata update, but its last substantive
  migration content is Nov. 7. `01a1b828-1d74-7c72-ae2f-a3b20b696b87` preserves the Nov. 7 frame
  diagnostic; `01a18993-03cd-7e00-9188-f51dcff8532d` contains earlier mixed work. The Nov. 12
  tool-documentation conversation `01a1cc81-4a3b-7d41-948d-c44c6ff25325` is not a migration-order
  decision. No additional authority-order decision was found in the searched local Codex records.
- Copilot Chronicle had no `/ph` migration session. Its eight local content matches for history,
  crop, or durable terms belong to `drguz69/lightshopy.com` and date Sep. 16–21, 2026. The separate
  Agent Host scan checked 715 parent/descendant databases (180,203,520 bytes) and found 14 matching
  local-turn records across nine files; these are failed task/review prompts, with no successful
  assistant answer or migration decision. A more recent index candidate
  `copilotcli:/46d32923-26fa-4bf5-97a3-b5cb13226047` had no `/ph` workspace path in its metadata or
  edits; its parent and 12 child databases contained 12 local turns, including five failed
  `crop-history` child prompts, and no successful answer or new migration decision. Copilot's local
  records are incomplete for Agent Host and do not prove that no discussion occurred elsewhere.

### Fresh continuation scan — 2026-11-14 11:16 UTC

The current Codex state index reports `backfill_state=complete`. Its newest relevant result is the
same long-running `01a1791a-beaf-7eb2-8c7c-e10b483cf962` (“Continue history migration”), indexed at
11:06 UTC; the separate `01a17f24-9224-7aa0-a412-3afafa09f797` (“Plan further history migration”)
was indexed at Nov. 13 23:49 UTC and contains older migration decisions. No newer independent
Codex migration thread was found. The current continuation is the active user conversation, not an
independent migration result.

The recent Kilo records add proposals and reviews, not an authority-order change. `ses_e27d6a3f1ffefrFGpSatjKLjKi`
(03:45 UTC) proposed a PSD-bound origin/extent control; those controls and the later physical-size
matrix are already recorded above. `ses_e26d3ba31ffeZUfyqbMqHrLCx7` (08:28 UTC) reviewed the E2E
diagnostics. Source checks confirmed that `frameChannels` is in the enclosing test scope and
`savePsd()` itself calls `drawLayerSource()` for its integer-bound raster. The review's alleged
negative unpaired-strip count misread `comparedPixels`: it counts all outside-frame cells, while the
function reports nontransparent cells separately. Its opaque-backdrop path asymmetry is a valid
interpretation limit: legacy draws the source layer while the durable control composites a
materialized bitmap, so those counts are a path differential, not a shared-renderer parity oracle.
The both-axes guard applies to this fixture's 89×89 bounds; the independent physical-size matrix
contains width-only and height-only cases. The remaining review claims did not establish a product
defect. `ses_e26ea64cfffe9PWtTMQn7lUHes` (08:03 UTC) is a model-generated summary that claimed exact
parity for every control; that conflicts with the run artifacts and is not evidence. `ses_e27bbc317ffeyzJyIgwqfNt2KN`
(04:15 UTC) is a relevance-ranking response over excerpts, not a migration decision.

A refreshed read-only query of Copilot Chronicle's normalized `session-store.db` again found zero
sessions with `/ph` in `cwd` or `repository`. This does not extend the separate Agent Host scan or
prove that no Copilot discussion exists outside these local stores. No newer Kilo, Codex, or Copilot
record changes logical `HistoryItem[]` authority, the retained-operation admission gates, or the
diagnostic-only status of these renderer measurements.

The Codex host exposed no free task/agent-manager tool. A tool-free `free-model-pool` synthesis was
attempted at 11:17 UTC and returned no answer: Kilo was skipped under its cooldown through
11:56:18.279 UTC, OpenRouter's live daily counter was exhausted (`1006/1000`, zero remaining), and
OpenCode `mimo-v2.6-flash-free` returned HTTP 429 `provider.free-limit`. No output from that attempt
was used as evidence; do not retry those exhausted sources in this run. Groq was not eligible because
the required Free-plan opt-in and key are absent in this environment.

The prior and refreshed local records add no authority-order change. They distinguish the earlier `(36, 26)`
per-layer case from the later `(5, 26)` mixed-source observation; the latter's root cause remains
unknown. Current source and main history remain authoritative. The refused opacity/blend adapters are
an open parity investigation, not a confirmed product export defect.

### Continuation reconciliation — 2026-11-14 12:04 UTC

The designated local `main` advanced from `4d0d33130` to `69d22e89a`. The live `origin/main` and
`mirror/main` heads matched `69d22e89a`; the fast-forward delta modifies only the agent-board,
session-ID, and web-research test files plus `scripts/lib/agent-board/db.mjs`. The candidate was
fast-forwarded to that tree before the final focused E2E. No migration source, migration docs, or
crop-history test changed in that main delta.

A new read-only local-history query covering records updated since the 11:16 scan found no recent
Kilo session matching migration terms, either in `/ph` workspaces or elsewhere in the current Kilo
SQLite store. The Codex state index returned only the active `01a1791a-beaf-7eb2-8c7c-e10b483cf962`
continuation, not an independent migration chat. Copilot Chronicle had no `/ph` sessions or matching
turns after the scan boundary. The prior Agent Host database sweep was not repeated; its incomplete
coverage limitation still applies.

The separate `history-migration-reconcile-20261114` worktree remains dirty at `ef8baf59`. Its
modified migration guide still lists the physical backing-size sweep as the next action, while its
E2E diff contains older diagnostic instrumentation. The current candidate already records that
sweep, the first-difference trace, and the direct `drawImage` reproduction. A fresh read-only review
found no unique production or source-backed-test evidence in that worktree; its next-step note is
stale against current main and this candidate. Preserve the dirty worktree and do not harvest it.

After the Kilo cooldown expired at `11:56:18 UTC`, three sequential tool-denying Kilo
Nemotron-3-Ultra free completions reviewed the transparent-padding control design. All returned
`finish_reason=stop` and `$0` reported cost. They converged on exact visible-mapping math, byte-exact
verification of the padded interior, a transparent-border check, and the same source/readback path
for padded and unpadded controls. One response incorrectly used backing dimensions as the draw scale;
that is rejected because the captured source and destination are both 64×64 in user space. Other
filter-radius and sampling-rule suggestions are not treated as facts; the experiment records its
changed inputs and does not claim a browser mechanism. These completions are design leads, not source
evidence or code review. OpenRouter remained exhausted, OpenCode was not retried after its
`provider.free-limit`, and Groq Free opt-in/API key were absent from the runner environment; no
Groq probe ran. The Codex host has no free task/agent-manager tool. Three fresh Luna read-only reviews
and focused follow-ups were also used; their first-difference and replay-fidelity findings were
reproduced locally and fixed. These diagnostics change neither logical replay authority nor product
admission.

### Historical continuation reconciliation — 2026-11-14 14:40 UTC (superseded)

The designated local `main` worktree is clean at `108cc5d6477487ece41d89f9d85b5650d2144c6b`;
live `git ls-remote` checks report both `origin/main` and `mirror/main` at the same SHA. The current
task branch is still based on `69d22e89a3d8b4e6921834cf98083a5f241f2fa8` and must be synchronized
before landing. The `69d22e89a..108cc5d6` delta changes only the CI workflows
`capture-linux-baselines.yml`, `ci.yml`, and `focused-e2e.yml`, plus
`free-model-pool.test.mjs`, `test-write-boundaries.test.mjs`, and `free-model-pool.mjs`. It does not
change migration source, migration docs, `e2e/crop-history.spec.ts`, or renderer code. A fresh
`repo:state --json` scan found two unrelated in-progress `AUTO_MERGE` operations in
`dirty-landing-cross-validated-20261113` and `unit-test-hardening-20261113`; preserve both. A
repository-wide report is not the scoped landing decision: before landing, rerun
`npm run repo:state -- --for-landing task/history-migration-continuation-20261114` and
`npm run main:landing -- status`, and leave those unrelated operations untouched. `ph-71` remains
claimed by this task branch; the six scoped paths have no foreign file holder.

The local history scans found no newer independent migration implementation or authority decision:

- **Kilo:** the local database contains 6,667 sessions; a read-only search of recent user/assistant
  text was capped at 100 matching sessions and covered records since Nov. 7. The latest substantive
  padding-design critique found was `ses_e261109eaffeL1ky7lZEJvLN0Q` (Nov. 14, 12:01 UTC). Later
  records around 13:50–13:54 include `ses_e25aa9f22ffeaJiLN8mvtW3sQl`, whose prompt omitted the
  later padding observation and still proposed alpha-boundary classification as next. Treat that
  sequencing as stale; no local Kilo transcript recorded the actual padding output captured by this
  E2E. The bounded search does not cover other Kilo stores.
- **Codex:** `state_5.sqlite` reports `backfill_state=complete`; the active root
  `01a1791a-beaf-7eb2-8c7c-e10b483cf962` is the latest substantive migration conversation. Its
  13:03 UTC padding observation was chat-reported until focused Chrome run
  `2026-11-14T14-33-54-271Z-53382` captured the control results recorded in §2. The separate
  planning chat `01a17f24-9224-7aa0-a412-3afafa09f797` contains migration work through Nov. 7; its
  later index timestamp is metadata. The Nov. 8–10 origin audit `01a1bc27-1187-7050-87bd-f94c47c801f0`
  is adjacent context, not a newer implementation. The local rollout search found no archived
  session directory; remote/synced Codex history was not searched.
- **Copilot:** the local Chronicle database has 19 sessions and 45 turns, with no `/ph` migration
  session. The two chat-session journals mapped to `/ph` replay to empty request lists. The local
  Agent Host database has 89 Copilot CLI session rows and 915 chat metadata objects but no mirrored
  turn rows; its available local records add no migration decision. Remote chats and inaccessible
  `ahp-chat://` resources were not queried. These bounds support only “no newer local Copilot
  decision found,” not a global absence claim.

Across these stores, no later conversation changes `HistoryItem[]`/`replayHistory()` logical
authority, retained-operation admission, or the frame-publication gate. At the 14:40 checkpoint the
edge-extended-border comparison was still next; the 15:01 run captured it, and its result is recorded
in §2. The browser sampling mechanism remains unproven. Reviews used Luna read-only subagents in
this continuation. The previous live checks found exact-free Kilo/OpenRouter inference unavailable;
no model output substitutes for captured local test evidence.

### Historical continuation reconciliation — 2026-11-14 16:43 UTC (superseded)

**Live refs and drift.** The designated local `main` worktree
`.kilo/worktrees/landing-main-recovered-20261112` is clean at
`422f28a67f784eab8ecdb0232b3503df52d80d2f`. This candidate is at
`69d22e89a3d8b4e6921834cf98083a5f241f2fa8`, an ancestor of local `main` with 8 commits behind and
0 ahead; its six dirty paths are the scoped diagnostic/docs candidate and must be preserved while
syncing `main` into the branch before landing. The 4 commits in `108cc5d6477487ece41d89f9d85b5650d2144c6b..422f28a67f784eab8ecdb0232b3503df52d80d2f` change only `.husky/post-merge`, `docs/ORCHESTRATION.md`, and main-landing/merge-release tooling and tests. They do not change history source, renderer, E2E, or migration docs.

Live remote heads are `origin/main=d0aa7bbf4037c2c98ebea80c9eef3aebb75b38e2` and
`mirror/main=108cc5d6477487ece41d89f9d85b5650d2144c6b`. Their common base with local `main` is
`108cc5d`; `git rev-list --left-right --count main...origin/main` is `4 30`. The remote-only
history-relevant change is `d15adb877202398448c14335c13f06634e056f0a`, a test-only hardening of
`src/contexts/__tests__/durable-export-adapter-parity.test.tsx`. It adds assertions for exclusion of
the unmatched legacy layer, blocked durable composition, the opposite serialization path, and
release behavior on refusal. Local `main` already has the production export guard and its earlier
fallback test but not these additional assertions. No history production or `crop-history` change
was found in the remote delta. Do not merge all 30 remote commits or push as part of this local
landing; use the designated local `main` pin and its pinned landing wrapper.

**Current proof and migration boundary.** The new 23-degree fractional-crop test is one
compositor/frame-matrix point and does not exercise runtime/export/PNG/PSD or change admission. Its
initial Chrome run `2026-11-14T16-23-44-434Z-51411` preceded a title clarification; the final focused
run `2026-11-14T16-43-18-983Z-99538` passed the renamed test. Both runs are evidence for the same
fixture, not two matrix points. Its exact fixture limits are recorded above. The
backing-size, source-bound, border, and alpha-neighborhood evidence remains diagnostic. The selected
product path still falls back to legacy rendering for retained operations; `HistoryItem[]` and
`replayHistory()` remain logical authority, and retained-operation/frame-publication gates remain
closed.

The live `ph-71` claim covers diagnostic parity only. It must not be expanded to source ownership.
After `ph-71` is reviewed and landed, create or claim a separate text-source ownership task. The
active `REPLACE_LAYER_SOURCE_ACTION` gate is `ownership-unproven`. Current StoreContext coverage uses
a generic replacement-action entry; it does not yet prove the fallback for a valid typed text edit.
The next task must test that producer-level append/navigation decision and track old/new runtime
`bitmap`/`tmpCanvas` identity/generation plus any disposable durable materialization lease. The
immutable typed text action does not register a raster asset. The complete acceptance matrix is in
HANDOFF §1 and the current continuation plan above; whole-document replacement and the broader
frame matrix remain separate slices.

**Other chats and search limits.** The refreshed local Kilo/Codex search did not establish a newer
independent migration implementation. The 13:53 Kilo evidence-audit completion
`ses_e25aa9f22ffeaJiLN8mvtW3sQl` was based on the then-current `main=108cc5d` and recommended an
alpha-boundary classification as the next bounded diagnostic. The current candidate contains that
diagnostic classifier and its exact synthetic accounting check; the later local browser captures and
source-bound controls supersede the audit's proposed ordering. Its warnings against treating free
summaries as proof remain valid. A new Kilo search since 14:40 returned search/completion helper
sessions rather than migration work; the separate Kilo root `ses_e2680acabffeIFAeTuw4675oOT` is an
E2E-hardening run whose user request explicitly forbids product changes, not a migration decision.
The search summaries are leads, not proof of absence.

The current Codex root `01a1791a-beaf-7eb2-8c7c-e10b483cf962` is this continuation; its local state
index is complete and shows no separate newer migration root after the cutoff. The earlier planning
thread `01a17f24-9224-7aa0-a412-3afafa09f797` and the Nov. 8–10 origin audit remain historical
context. A read-only query of local Copilot Chronicle found no `/ph` session; remote/synced sessions,
other user-data profiles, and inaccessible chat resources were not searched. The dirty
`history-migration-reconcile-20261114` worktree at `ef8baf59` is 31 commits behind and an ancestor of
current local `main`; its three uncommitted paths are the two migration docs and
`e2e/crop-history.spec.ts`. Its browser diagnostics and next-step note are older. A read-only
identifier comparison found all 30 named tests and all 38 named functions in that worktree's E2E
file in this candidate, with no reconcile-only test/function/const names; this does not claim every
function body is byte-identical. Preserve the dirty worktree and do not treat its stale next-step
note as current. The separate `history-migration-continuation-20261115` worktree is clean at
`108cc5d`, 4 commits behind local `main`, with no additional implementation. Unrelated dirty test
branches and foreign merge markers remain untouched. Full `repo:state --json` at 16:44 UTC scanned
229 worktrees and returned `ok: true` with exit 1 because of three foreign in-progress `AUTO_MERGE`
markers in `codex-owner-liveness-20261114`, `dirty-landing-cross-validated-20261113`, and
`unit-test-hardening-20261113`; it reported no destructive `MERGE_HEAD`. Preserve those operations
and decide this landing only with the scoped `--for-landing` check.

The prior broad open-source editor survey remains comparative only. A fresh check of [GIMP's undo
overview](https://developer.gimp.org/core/specifications/undo/), [Krita's undo-history
docker](https://docs.krita.org/en/reference_manual/dockers/undo_history.html), and [Aseprite's undo
history documentation](https://github.com/aseprite/docs/blob/main/undo-history.md) confirms that
grouping, cursor navigation, and optional non-linear redo behavior vary between editors. These
patterns motivate branch and lifecycle tests but do not set Photoshop behavior or this app's
contract; repository and Photoshop-grounded requirements remain authoritative.

Free chat-search output on this refresh returned helper/scaffolding sessions and was not accepted as
review evidence. The live OpenRouter quota check at `2026-11-14T16:21:20Z` reported
`used=1006/1000`, `remaining=0`; no OpenRouter inference was used. The exact Kilo
`nvidia/nemotron-3-ultra-550b-a55b:free` route was available for free summarization.

**Independent review reconciliation.** Three Luna read-only follow-ups agreed that the renderer
diagnostics remain non-authoritative and found no actionable E2E defect. The source-contract review
identified the valid typed-edit StoreContext gap and clarified that the typed text action owns no
raster asset; both details are now explicit above. The planning review correctly separated this
source lifecycle slice from `ph-71` and identified the 23-degree test as a single matrix point. It
also questioned ancestry; the live Git proof resolves that claim: candidate `69d22e89a` is an ancestor
of local `main=422f28a67`, 8 behind and 0 ahead.

The planning review also noted that the 16:23 and 16:43 run IDs are the initial and final runs of
that same test. This reconciliation now treats them as one frame-matrix point and uses the 16:43 run
as the final passing run; the title clarification did not expand the fixture or its claims. The
source-contract review confirmed that append presentation stays empty/unpublished and the explicit
`legacy-fallback / ownership-unproven` result belongs to navigation, undo, and redo. The next-slice
acceptance text states those outcomes separately.

A fresh Luna 6 documentation review found four clarity gaps, now corrected: it reconciled the two
23-degree run IDs as one fixture, named the exact `EMPTY_DURABLE_PRESENTATION` shape in the append
assertion, and clarified that operation-level source-edit support does not prove the producer's
StoreContext ownership lifecycle. It also narrowed the open diagnostic question from an unspecified
first-difference boundary to the still-unknown browser sampling mechanism and whether it explains
the fractional-frame PSD difference. Its read-only follow-up found no remaining inconsistency. A
separate Luna E2E review found no assertion or scope defect in the renamed two-layer test; it confirms
the exact composite, frame bounds, and per-layer pixels without claiming export or admission parity.

A second free Kilo Nemotron review found that the plan's phrase “a second test” could blur the 16:23
and 16:43 run IDs. The live status now spells out that they are initial/final runs of one fixture and
names the final test. Its other requested checks found no contradiction in the 42/46 versus 42/42
run-specific counts, the padding comparison axes, current ref ancestry, local chat-search limits, or
the next source-lifecycle gate.

The Luna source review found that the normal, opacity-only, and blend-only test controls inherited
the main fixture's full projected-output flag, so they repeated export/PNG/PSD and backing diagnostics
that their runtime-composite comparison does not consume. The controls now capture only runtime
pixels and dimensions, disable the unused invert/backdrop diagnostics, and skip their per-layer
comparison surfaces; the main fixture retains the full refused-adapter and PSD/backing evidence. A
first post-refactor focused run `2026-11-14T17-07-41-349Z-52216` caught a missing `expectedSize` on
the shared cursor result. The result now carries the exact frame pixel size to both control arrays.
The focused Chrome run `2026-11-14T17-10-30-734Z-58675` passed one test after the dimension fix.
After the commit hook's required Prettier reflow, focused Chrome run
`2026-11-14T17-18-00-204Z-1299` passed one test and `npm run tsc` passed. The full E2E suite was
not run.

Five free Kilo Nemotron reviews in this continuation returned non-empty text with
`finish_reason=stop`, `cost=0`, and one Kilo request each; OpenRouter remained exhausted. The free
model outputs were treated as leads: full-source Luna review and the focused E2E rejected several
partial-diff concerns and reproduced/fixed the missing-dimension defect before the passing rerun.

Four independent free Kilo reviews used the exact `nvidia/nemotron-3-ultra-550b-a55b:free` model;
each returned non-empty text, `finish_reason=stop`, `cost=0`, with one Kilo request and no OpenRouter
attempt. The ref review found the pin account internally consistent and suggested naming the common
base explicitly, which is reflected above. The source-slice review prompted the typed-action fallback
assertions and product E2E requirement now recorded above. The E2E review confirmed that the new
test supports only its one exact frame/layer fixture; its name now says “two positioned raster
layers,” and no wider matrix or export claim is made. The chat-history review found the bounded,
local-only wording calibrated. These model reviews remain leads; the coordinator checked their
claims against source, live refs, Kilo/Codex/Copilot metadata, and the focused browser run.

## Current continuation plan

The implementation slices and acceptance gates remain governed by the
[durable-history continuation plan](../.kilo/plans/history-migration-continuation-20261027.md).
The current-state audit and its resolved/open findings are recorded in
[History Migration Audit — 2026-11-07](HISTORY-MIGRATION-AUDIT-20261107.md).

The latest refs, ancestry, proof status, cross-chat reconciliation, and cross-editor source
boundaries are in
[Latest continuation reconciliation — 2026-11-23 01:10 UTC](#latest-continuation-reconciliation--2026-11-23-0110-utc).
The exact mixed-source composite assertion is still red on this candidate, so do not land it yet.
After resolving that gate, proceed to typed text-source ownership in `HANDOFF.md` §1 only after
the documented owner handoff or full-tree liveness proof. Keep `ownership-unproven` closed until
integration, lifecycle, failure, navigation, and production canvas/PNG/PSD proofs pass. Durable
replay remains staged until every presentation surface has explicit identity, coverage, freshness,
lease, preview, failure, and fallback proofs.
