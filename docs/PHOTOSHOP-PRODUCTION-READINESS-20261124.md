# Photoshop tools audit reconciliation — 2026-11-24

This note hardens the Kilo chat **Photoshop tools gap audit** against the current checkout. It is a
point-in-time reconciliation, not a second capability inventory. The current product contract is
owned by [`FEATURES.md`](FEATURES.md), [`TOOLS-TOO-HARD.md`](TOOLS-TOO-HARD.md),
[`PHOTOSHOP-UX.md`](PHOTOSHOP-UX.md), [`LAYERS-PANEL.md`](LAYERS-PANEL.md), and generated
[`TOOLS.md`](TOOLS.md).

## Scope and evidence

- Current source reviewed: `main` at `29bca7ca`, in task worktree `task/production-hardening-20261124`.
- The Kilo audit's initial code cross-check named `17cd7d04`; a later cross-reference used
  `e69f9c8c`. Neither is the current checkout. The audit worktree and its files were left
  untouched.
- Repository docs now contain more current, code-linked capability notes than the Kilo report.
  Use those as the source of truth; do not copy the audit's P1 labels or feature counts into a
  production plan without rechecking the owning code and existing open-problem record.

## Audit record defects

The Kilo summary calls the work **57 tools/features**, **57 gap documents**, and separately lists
52 tool-specific analyses, 5 feature analyses, and 4 summary/analysis documents. Those totals do
not reconcile: 52 + 5 + 4 is 61. The directory itself contains 58 Markdown files: 45 names end in
`-gaps.md`, and 13 are summaries, plans, mappings, or cross-checks. The progress JSON has 52
`completedTools` entries but 51 unique names (`transform` is repeated); `totalGapsFound` and
`currentToolIndex` are both zero. Treat 57 as the report's claimed analysis scope, not as a verified
document or implementation-gap count.

The report's blanket claim that all selection modifiers are missing is too broad. Current source
records Shift/Alt geometry for marquee tools and Add/Subtract behavior for Quick Selection, while
shared selection combination controls, Intersect, and Select and Mask remain incomplete. The
current details are in `TOOLS-TOO-HARD.md` under **Selection combination modes** and in the
generated selection entries in `TOOLS.md`.

The Kilo cross-reference says commit `b6e47f44` is absent from current main. It is an ancestor of
`3c72e686`; its commit subject is `fix(e2e): mask workspace backdrop from pixel checks`, and its
changes are test/helper hardening rather than an app-facing checkerboard repair. The current
`document-dialogs.spec.ts` also contains measured backdrop and letterbox checks. Keep the commit's
actual scope distinct from claims about the app's visual background.

## Current high-impact capabilities and gaps

| Capability                                 | Current disposition                                                                                                                                                                                                            | Current owner                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Selection combinations and Select and Mask | Partial/missing; some per-tool modifiers work, but there is no shared four-mode selection surface or refinement workspace.                                                                                                     | `TOOLS-TOO-HARD.md`, selection entries in `TOOLS.md`                                                   |
| Pen family and Custom Shape                | Six Pen-family tools and Custom Shape remain unimplemented placeholders.                                                                                                                                                       | `toolProcessors.ts`, `TOOLS-TOO-HARD.md`                                                               |
| Layer masks and adjustment layers          | Not modeled as layer types; destructive image adjustments do not provide non-destructive layers.                                                                                                                               | `FEATURES.md`, `LAYERS-PANEL.md`                                                                       |
| Transform parity                           | The app has transform commands and overlays, but not Photoshop's full interactive Free Transform behavior.                                                                                                                     | `TOOLS.md`, `TOOLS-TOO-HARD.md`, transform descriptions                                                |
| Background removal                         | Generative/neural removal is outside the current implementation.                                                                                                                                                               | `FEATURES.md`, `TOOLS-TOO-HARD.md`                                                                     |
| First-use document creation                | Working as designed: the app-created starter is clean, so the first File > New and File > Open proceed without a discard prompt. A blank document created through File > New is marked unsaved immediately, even before edits. | `App.tsx`, `useApp.ts`, `useLayer.ts`, `document-dialogs.spec.ts`, `photoshop-junior-workflow.spec.ts` |

This is enough to reject a broad **Photoshop replacement** production claim. A narrower raster
editor release would still need an explicit capability boundary, clear treatment of placeholder
tools, and scenario-level evidence for import, crop, retouch, history, and export.

## Recommended next slices

1. Keep new-user and early-intermediate journeys tied to implemented controls and executable E2E
   assertions. The title-card, layered-paint, and synthetic import/crop journeys are in
   [`ENTRY-LEVEL-WORKFLOWS.md`](ENTRY-LEVEL-WORKFLOWS.md).
2. Before claiming photo-editing readiness, add an integrated real-photo journey that crops a
   representative photograph, applies a supported retouch operation, uses Undo/Redo, and exports
   PNG/JPEG. The current crop scenario proves those mechanics on a deterministic synthetic fixture,
   not image-quality results on photographs.
3. Prioritize selection refinement and non-destructive layer workflows before adding advanced
   Photoshop-specific tools. Those are broader document-model changes and need scoped designs,
   Adobe-source review, and focused history/PSD tests.

## Primary references

- Adobe, [Crop photos](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-photos.html)
- Adobe, [Add text](https://helpx.adobe.com/photoshop/desktop/text-typography/get-started-with-text/add-text.html)
- Adobe, [Save images in JPEG format](https://helpx.adobe.com/photoshop/desktop/save-and-export/save-files/save-in-jpeg-format.html)
- Adobe, [Save images as PNG and GIF](https://helpx.adobe.com/photoshop/desktop/save-and-export/save-files/save-in-png-and-gif-formats.html)
