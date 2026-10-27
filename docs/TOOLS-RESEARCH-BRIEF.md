# Research brief — per-tool Photoshop descriptions

This is the brief every family research agent in this effort read. It is written down rather
than pasted eight times so that all eight files were produced under identical rules, and so
that a ninth family can be added later without re-deriving them.

## What is being built

`src/tools/descriptions/<family>.ts` — one entry per `ToolName`, typed against
`src/tools/descriptions/types.ts`. The eight family modules merge in
`src/tools/descriptions/index.ts` into a `Record<ToolName, ToolDescription>`, so a family that
omits a tool is a TypeScript error. The record backs the toolbar tooltip, and a generator
(`scripts/generate-tool-docs.mjs`, `npm run docs:tools`) writes `docs/TOOLS.md` from it, so
the prose in the docs cannot drift from the prose in the app.

`src/tools/descriptions/<family>.notes.md` — the human-readable half of the same research:
per-tool prose, the provenance for each Photoshop claim, and an explicit `Unverified` list.
The generator inlines these into `docs/TOOLS.md`, which is why they are `.md` and not fields:
a claim that could not be sourced must not look like a sourced one.

`src/tools/descriptions/tooltips.ts` — **generated, and the only part of this that ships.**
The toolbar reads one field: a one-line summary and an implementation verdict. It is written by
`npm run docs:tools` from the family modules above rather than maintained by hand, because
hand-maintaining it would be a second place to edit every summary. The split is not cosmetic:
measured on the branch that introduced it, importing the full record from the tooltip added
215 kB raw / 58 kB gzipped to the main bundle, a 34% increase, to render one line per tool. The
generated projection costs 7 kB raw / 2.6 kB gzipped. A test asserts the committed file matches
what the generator produces, so it cannot be hand-edited into disagreement.

## The rule that matters most

**A description without a source is a rumour.** Every Photoshop claim in these files traces to
a URL that was actually opened, listed in that tool's `sources` array. If you cannot source a
claim, it does not go in the data file — it goes in the notes file under `## Unverified`, with
the URL that came closest. An empty `sources` array fails the test suite.

## Research protocol

- Use `websearch` with `livecrawl: 'preferred'`. This is verified, not folklore: `webfetch` on
  `helpx.adobe.com` returns HTTP 403 on essentially every path, and the Wayback availability API
  reports no useful snapshots, so the live search crawler is the only route to Adobe's user-guide
  text. `webfetch` on `developer.adobe.com` **does** work and is where exact parameter names,
  ranges and defaults live.
- Trust order: Adobe's official help and developer reference > Adobe Community and Adobe blogs >
  Wikipedia and original papers > independent third parties. A third-party blog is a last resort
  and is labelled as one.
- Verify 2+ independent sources per load-bearing claim. Never invent a URL and never fabricate a
  quote. If a source cannot be opened, it is not a source.
- Note the version. Photoshop 2024–2026 is the target; where a control, default or behaviour is
  version-dependent — the Blur tool is ~2023+, the Curvature Pen is 2018, Polygon Star modes moved
  in 22.0 — say which version you are describing, in the `detail` text and in the notes.

## The code half, and why it is not optional

Each control in the options table carries a `status`: `present`, `partial`, `missing` or `inert`.
That column is the part a pure-docs research pass cannot produce, and it is where the errors live:

- A control declared in `src/tools/settings.ts` but rendered by no component is **`inert`**, not
  `present`. This is the single most common false "the app already has it" claim in this repo,
  and it is why `inert` is a distinct value.
- A control rendered but wired to a different range, a different default, or no behaviour at all
  is **`partial`**, and `appRef` must point at the wiring, not at the label.
- Check **both** `src/tools/settings.ts` and `src/components/ToolbarsRight/<Tool>/` before
  declaring anything `missing`. A control can exist in one and not the other.

`implementationRefs` must cite declared identifiers in the working tree — a function or
method in call form (`materializeDocument()`), a dispatched string literal (`'legacy-tool'`),
a test title (`it('...')`), or the file alone when the claim covers the whole file —
re-derived against the tree in this worktree, not copied from the research corpus below
(which was written against an older revision) and not from `.skills/photoshop-tool-creation.md`
(whose line-numbered citations have moved). **A citation you did not re-derive is a citation
that is wrong.** Line-number citations are banned in tracked documents per
`docs/DOCUMENTATION.md` §Citations.

## What already exists — read before re-researching

`/Users/bkalynovskyi/ph/.kilo/plans/ps-research/` — 11 files, ~265 KB. Gitignored, so it exists
only in the **main** checkout; a worktree has none of it. Read it from `/Users/bkalynovskyi/ph`.

| File                                   | What it is for                                                                                                                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-photoshop-reference.md`            | The behaviour spec across 7 tool families, every claim cited, plus §10 the corrections log: 17 disproved premises and 18 unresolved items. **Read §10 before you trust any Photoshop claim in it.**                                                  |
| `00-tool-inventory.md`                 | Every registered tool vs Photoshop. Its universe is the registry, so it structurally could not surface a missing tool.                                                                                                                               |
| `02-implementation-plan.md`            | 10 phases with `file:line` anchors. Its anchors are against an older revision.                                                                                                                                                                       |
| `03-ui-chrome-spec.md`                 | Theme, typography, the control vocabulary, **§5 "Options-bar contents per tool"**, and an explicit §10 "Unverified — do not present as fact" section.                                                                                                |
| `04-blend-modes-and-brush-spec.md`     | All 27 blend modes with formulas, the compositing equation, Opacity-vs-Flow math, brush tip and dab rendering, airbrush, smoothing, auto-erase, colour replacement. §2 and §8 make the blend-mode and `color-replacement` rows implementation-grade. |
| `05-selection-mask-migration.md`       | The selection keystone: combination-mode design, marching squares, per-test impact table. Start here for any selection work.                                                                                                                         |
| `06-adjustments-and-color-pipeline.md` | sRGB/XYZ/Lab matrices, real Levels, Brightness/Contrast, Black & White + Tint, Hue/Saturation, engine-independent Gaussian blur.                                                                                                                     |
| `07-test-harness-and-migration.md`     | Canvas-mock capability report and the established test conventions.                                                                                                                                                                                  |
| `RESEARCH-BRIEF.md`                    | The constraints the original research ran against, and what it **disproved**. Its `## 10. Open questions / unknowns` and `## Rules for accuracy about the current code` are the two sections to read first.                                          |

Four corrections from §10 of `01-photoshop-reference.md` that change what a description may
assert — these are already reflected below, and repeating them is a defect:

1. "The Polygon Tool is click-to-place-vertices" → **it is drag-defined**, inscribing a regular
   n-gon. Do not describe it as a click tool.
2. "The Triangle Tool draws a regular inscribed triangle" → **it is a drag-defined _isosceles_**,
   and Shift means equilateral, not aspect-snap.
3. "The Blur Tool is Illustrator-only" → **Photoshop has a Blur tool** (Tools panel, ~2023+).
4. "Black & White has 10 colour ranges" → **it has 6 sextants**. The 9-range CMYK model is
   Selective Color.

And one boundary, from §10 of `01-photoshop-reference.md` — "No browser was executed." Every
support claim in that corpus derives from caniuse / MDN BCD / the WebKit bug tracker, not from
runtime measurement.

`/Users/bkalynovskyi/ph/.skills/photoshop-tool-creation.md` — a 4,689-line playbook whose
`## Photoshop shape tools` section is a fully worked research digest and the canonical example of
the expected density. Its `## The tool backlog` and `## Appendix A — the trap list` sections are
worth reading before writing prose.

## House rules for the writing

- **British or American spelling — pick one and be consistent inside a file.** The repo's prose
  is American. Match it.
- `summary` is one sentence, at most ~140 characters. It is what the tooltip shows, and a
  tooltip that wraps to four lines is a defect. `purpose` carries the detail.
- Describe **Photoshop's** tool in `summary`/`purpose`. The app's divergence goes in `appNotes`
  and in the per-control `status`. Mixing the two produces a description that is true of neither.
- No file-scope or line-number claims in prose that will go stale. `implementationRefs` is
  the place for a citation, and the notes file is the place for a sentence about one.
- Do not add comments to the data files. A citation belongs in `implementationRefs`, which is
  data, not a comment that drifts from it.

## Deliverables per family

1. `src/tools/descriptions/<family>.ts` — imports the types from `./types.ts`, exports one
   `const <family>Descriptions: Record<'<key1>' | '<key2>' | ..., ToolDescription>`, keys exactly
   the `ToolName`s assigned to that family. `npx prettier --write` on this file.
2. `src/tools/descriptions/<family>.notes.md` — the same tools in prose, with the full option
   tables, a `## Sources` list per tool, and a `## Unverified` list that is never empty by
   convention. `npx prettier --write` on this file.

Do not create, edit or delete any other file. Do not run `npm run test`, `npm run tsc`,
`npm run build`, `npm run test:e2e` or any Playwright command — the coordinator runs the gates
once, over all eight families at the same time, and eight concurrent `tsc -b` runs over one
`tsconfig.tsbuildinfo` in one worktree will corrupt it.
