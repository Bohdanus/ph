# Features

What this app can do, system-wide, measured against Photoshop.

**This is not a per-tool document.** That is [`TOOLS.md`](TOOLS.md) — generated,
44 sections, one per tool or per Adobe command the rail carries, with an options-bar
table and Adobe citations. Four of the 44 are not Tools-panel tools — the Shape group
placeholder, Free Transform, Levels and Black & White are named for what Adobe calls
them. This
page is the capability level: documents, formats, selection, layers, history,
panels, menus, view, input, colour. A tool's status is one row of
[`TOOLS.md`](TOOLS.md), not of this file.

## The product requirement

This app is a Photoshop clone. Wherever Photoshop has a behaviour, this app
replicates it — same tool, same control, same modifier, same default, same
keyboard letter.

Two consequences, both load-bearing:

- **A capability Photoshop has is a gap here**, and gaps are recorded, not
  rationalised away. A large `absent` count below is a statement about what is
  unbuilt, not about scope.
- **Where this app behaves differently from Photoshop and no entry exists in
  [`OVERRIDES.md`](OVERRIDES.md), this app is wrong.** The precedence ladder in
  [`DOCUMENTATION.md`](DOCUMENTATION.md) puts Adobe above every document in this
  repository, and the operator's register is the only thing above Adobe.

## Status vocabulary

| Status      | Meaning                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `have`      | Behaves as Photoshop does                                                                      |
| `partial`   | Some of the capability exists; the gap is named                                                |
| `divergent` | Exists, but behaves differently from Photoshop                                                 |
| `absent`    | Not built                                                                                      |
| `platform`  | The browser platform cannot do this without a decoder or engine the project would have to ship |
| `decision`  | Deliberately not built; recorded in [`TOOLS-TOO-HARD.md`](TOOLS-TOO-HARD.md)                   |

**`platform`, `decision` and `absent` are different claims and are counted
separately below.** They collapse into "impossible" the moment nobody is
distinguishing them, and `absent` — which is a backlog item — is the one that
gets lost. A claim of impossibility that names no platform mechanism is not a
platform limit.

## Summary

| Area              | Status      | The gap in one line                                                                 |
| ----------------- | ----------- | ----------------------------------------------------------------------------------- |
| Document model    | `partial`   | One document, no colour mode, no Image Size                                         |
| Open / import     | `partial`   | No PSB, RAW, HEIF, PDF; 8-bit RGB PSD only                                          |
| Export            | `partial`   | No PDF/HEIF/HDR; PSD writer drops groups, text and masks                            |
| Selection         | `divergent` | A shape list, not an alpha channel — so no Combine, Invert, Modify or channels      |
| Layers            | `partial`   | No groups, masks, clipping or adjustment layers; opacity is model-only              |
| History           | `partial`   | Linear panel exists; no state limit, snapshots, non-linear history or History Brush |
| Panels            | `partial`   | Two panels. Photoshop has seventeen                                                 |
| Menu bar          | `divergent` | Five menus; Edit holds one item and Image one submenu                               |
| View / navigation | `partial`   | The Ruler measures; no pan, no canvas rulers, no guides                             |
| Keyboard          | `partial`   | 45 bindings against Photoshop's ~200                                                |
| Colour management | `platform`  | 8-bit sRGB only; no ICC, no CMYK, no 16/32-bit                                      |
| Export options    | `partial`   | JPEG quality is the only user-controllable option                                   |
| Mobile            | `partial`   | A full mobile shell, minus pinch-zoom — because there is no zoom at all             |
| Non-destructive   | `divergent` | A retained per-layer operation stack, not smart objects                             |

## Documents

**Photoshop:** canvas size, resolution, colour mode, a background-layer choice at
New time, and many documents open at once in tabs.

**This app:** the canvas is a `DocumentFrame` — a `Pos` —
`document-frame.ts` — `DocumentFrame` — plus a `Size` from
`general-types.ts` — `Size`. New offers presets, a DPI field shown only for
physical-unit presets (`NewImageDialog.tsx` — the `dpiInput` field),
background colour and opacity, and pixel dimensions clamped to 1–10000
(`NewImageDialog.tsx` — the `widthInput` and `heightInput` `min`/`max`
pairs). Opening a
file replaces the whole document and mints a new `documentId`
(`useApp.ts` — `setImageFromUpload()`).

**Status:** `partial`

**Gap:** One document at a time. No colour mode or bit depth. No Image Size or
Canvas Size dialog. DPI is a one-shot conversion at New time and is never stored on
the document (`NewImageDialog.tsx` — `NewImageDialogProps`, whose comment records why
there is deliberately no `dpi` field).

### Unsaved changes

**Photoshop:** replacing or unloading a modified document asks first, and the prompt
offers to save before discarding.

**This app:** one predicate, `hasDiscardableWork`
(`src/util/document-dirty.ts`), and one owner of it,
`UnsavedChangesProvider` (`src/contexts/UnsavedChangesContext.tsx`). The predicate is
three terms, because the store's own `hasUnsavedChanges` sees only one of them: what is
already on the timeline; a text box typed into but not yet placed, which lives in
`currentArgs` until a tool commit moves it; and an in-flight tool transaction, which
lives in `previewLayers` and dispatches nothing at all for the whole gesture. Every
replacement surface — File > New, File > Open, the mobile drawer, and the window file
drop, the only one a bare gesture reaches on a populated document — calls
`confirmDiscard(reason)`, which resolves `true` without a widget when there is nothing
to discard and otherwise renders `ConfirmDialog`
(`src/components/ConfirmDialog/ConfirmDialog.tsx`), the app's first generic two-button
modal. Tab close, reload and navigation are the same predicate against a `beforeunload`
handler.

**Status:** `partial`

**Gap:** Two, and the first is a product decision rather than a defect.

- The prompt offers **Discard** and **Cancel**. There is no **Save**, because the app's
  only save is Save As to a new file — it proposes `"<name> (copy)"`
  (`useFile.tsx` — the `proposedName` it hands `SaveDialog`) — so a Save button
  would have to open a file picker
  and then resume a New or Open. Which of the two is right is a product call; see
  `HANDOFF.md`.
- The unload prompt's wording is the browser's, not the app's. `beforeunload` can only
  ask for a prompt, not supply one; Chrome, Safari and Firefox each supply their own
  text, and none of it is translatable from here.

## Import

**Photoshop:** PSD and PSB, PDF, EPS/AI, camera RAW, HEIF/HEIC, BMP, DICOM, GIF,
TIFF, WebP, AVIF.

**This app:** `loadDocumentFile` (`image-load-save-utils.ts` — `loadDocumentFile()`)
sniffs the first 64 bytes and dispatches — PSD, TIFF, BMP, AVIF, ICO, GIF and SVG
to their own codecs, and
everything else through the browser's own `<img>` decoder, which covers
JPEG, PNG and WebP.

**Status:** `partial`

**Gap:** No PSB, no 16- or 32-bit, no CMYK PSD (`psd-utils.ts` — `loadPsd()`'s header
guards); a greyscale PSD is converted to RGB with a warning (also `loadPsd()`).

### Platform limits on import

| Format      | Why                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------- |
| Camera RAW  | No browser API decodes RAW. Opening one requires shipping a decoder this project does not carry |
| HEIF / HEIC | `decodeImageData` is not universally available, and no engine here does it                      |
| PDF         | A browser renders a PDF in a plugin surface, not as pixels this app can read                    |
| DICOM       | No browser API; same as RAW                                                                     |

These are stated as limits of the platform, not as backlog items. They are in this
table so nobody re-derives them, and so nobody uses them to excuse the formats
below that a browser handles perfectly well today.

## Export

**Photoshop:** PSD/PSB plus PNG, JPEG, TIFF, GIF, WebP, AVIF, PDF, EPS, DICOM and
HDR, each with its own options.

**This app:** `saveImageToDisk` (`image-load-save-utils.ts` — `saveImageToDisk()`)
writes PNG, JPEG and WebP through `canvas.toBlob`, and dispatches TIFF,
BMP, GIF, AVIF, ICO and SVG to their encoders. PSD is written
separately (`psd-utils.ts` — `savePsd()`).

**Status:** `partial`

**Gap:** No PDF, HEIF, HDR or DICOM output — PDF and DICOM for the platform
reasons above. The PSD writer drops groups, editable text, masks and effects
(`SaveDialog.tsx` — its `format === 'psd'` notice), and groups in an imported PSD
are flattened (`psd-utils.ts` — `visit()`). SVG export is a raster wrapped in
an `<svg><image>` element (`imageFormats.ts` — `IMAGE_FORMATS`'s SVG entry labels
it "SVG
(flattened)"), not vector output.

## Selection

**Photoshop:** a selection is an 8-bit-per-pixel alpha channel. It combines (New /
Add / Subtract / Intersect), inverts, modifies (Feather / Expand / Contract),
refines, saves to and loads from a named channel, and is viewed in a Channels panel.

**This app:** a selection is **a polygon point list with a bounding box**, not a
pixel channel — `general-types.ts` — `Selection`. Seven selection tools write
it (`toolProcessors.ts` — the selection entries carrying `creator: true`).
Marching ants read the points
(`useAnts.ts`, `useSelectionAnts.ts`, `usePolylineAnts.ts`). An alpha
mask does exist, but only as a derived copy for clipboard and copy-to-layer
(`selection.ts` — `createFeatheredAlphaMask()`), reached from
`copySelectionToCanvas()` and
nowhere else. Feather is a parameter on that copy, not a modification of the
selection.

**Status:** `divergent`

**Gap:** No Combine (Add / Subtract / Intersect), no Invert, no Modify (Feather /
Expand / Contract), no Save or Load Selection, no Quick Mask, no Channels panel
(`PanelLayout.tsx` — `PanelId` admits only `history` and `layers`). **A
selection does not clip a stroke**: no tool in `src/tools/` reads `selections`.

That last one is the largest single selection gap and it is a model problem, not
a missing control — a shape list cannot mask pixels. Fixing it means the selection
becomes a channel, which is the same change Photoshop's data model makes.

## Layers

**Photoshop:** raster, vector-shape, type, adjustment, smart-object and group
layers, each with opacity, fill opacity, blend mode, per-property locks, layer
masks, clipping masks and Blend If.

**This app:** `LayerSource` has three discriminants — `blank`, `image`, `tool`
(`layer-types.ts` — the `LayerSource` union). Both Type and a shape commit as a
source (`toolProcessors.ts` — its `shape` and `text` entries, `commit: 'source'`
on each), but only the six
tools in `vectorToolNames` (`layer-renderer.ts`) are re-rendered from
their args at draw time; Type is not among them, so `getLayerBitmap` falls through to
the layer's own bitmap (`layer-renderer.ts` — `getLayerBitmap()`), which replay
materialises (`history-replay.ts` — `replayHistory()`). Sixteen Photoshop blend
modes map to canvas composite operations (`psd-utils.ts` — its `blendModes` map),
and opacity and blend mode are applied at draw time
(`layer-renderer.ts` — `drawLayer()`). The layer record is flat, a
`Record<LayerId, Layer>` (`layer-types.ts` — the `Layer` record and the
`LayersRecord` map) with no `parentId`, and the panel offers visibility, reorder,
rename and delete
(`LayersTab.tsx` — its `layers-list` rows).

**Status:** `partial`

**Gap:** No groups or nesting, no layer masks, no clipping masks, no adjustment
or smart-object layers. **No panel control for blend mode or locking** — those
fields exist in the model and round-trip through PSD, but nothing in the UI sets
them. Desktop opacity has a basic slider; its Adobe-documented preset drop-down
is still absent because the preset values are unverified.

## History

**Photoshop:** a History panel with named states, configurable History States (default 50,
maximum 1,000), snapshots, optional non-linear history, and the History Brush. See
<https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/history-panel-overview.html>
and <https://helpx.adobe.com/photoshop/using/performance-preferences.html>.

**This app:** a linear `HistoryItem[]` with a cursor
(`history-types.ts` — `HistoryItem`, carried in a `HistoryTimeline` whose
`cursor` indexes it), unbounded
— append truncates the redo tail and pushes, with no cap anywhere
(`history-timeline.ts` — `updateHistoryTimeline()`'s append arm). A History panel
exists
(`HistoryTab.tsx`) with click-to-rewind and a
per-step disabled toggle, plus Undo/Redo in the header
(`HistoryControls.tsx` — its `undo-button` and `redo-button`).

**Status:** `partial`

**Gap:** The app has no configurable History States limit, snapshots, non-linear-history option or
History Brush. Its linear cursor and redo-tail truncation are the portions that match Photoshop.

**Note, because it is the opposite of what the code looks like:** entries store
_args_, never pixels, and undo re-runs the tool processors from index zero
(`history-replay.ts` — `replayHistory()`). See
[`ARCHITECTURE.md`](ARCHITECTURE.md#two-history-systems).

## Panels

**Photoshop:** Layers, Channels, Paths, History, Properties, Adjustments, Color,
Swatches, Styles, Character, Paragraph, Brush presets, Navigator, Info, Histogram,
Actions, Measurement Log — dockable, with panel groups.

**This app:** exactly two dockable panels, `PanelId = 'history' | 'layers'`
(`PanelLayout.tsx` — `PanelId`). They dock, drag-reorder, resize, collapse to
icons and roll up (`PanelLayout.tsx` — the setters `PanelLayoutProvider` returns,
plus `PanelGroup.tsx`), and Window has Reset Workspace
(`DesktopHeader.tsx` — its `handleResetWorkspace`).

**Status:** `partial`

**Gap:** No Properties, Adjustments, Channels, Paths, Character, Paragraph, Brush
presets, Swatches, Styles, Navigator, Info or Histogram panel. The rail carries
the foreground/background swatches
(`SidebarLeft.tsx` — its `color-pickers` cluster); the closest analogues to
Color and Character are the Desaturate command's three sliders and the Type options bar,
which are options bars, not panels.

## Menu bar

**Photoshop:** File, Edit, Image, Layer, Type, Select, Filter, 3D, View, Window,
Help.

**This app:** five menus — `file`, `tools`, `image`, `edit`, `window`
(`DesktopHeader.tsx` — the five hosts `menuHostRefs` addresses). File has New, Open,
Save. Tools lists every rail tool. Image carries one submenu, `Adjustments`, holding
Adobe's item list with **two enabled** — `Brightness/Contrast` and `Desaturate` — and
twenty **disabled** (`DesktopHeader.tsx` — `ADJUSTMENTS_ITEMS`); a disabled item
records a capability
the app does not have rather than faking it. Edit holds one item, `Free Transform`,
which is where Adobe puts it (`DesktopHeader.tsx` — `handleFreeTransform`). Window
has Reset Workspace.

**Status:** `divergent`

**Gap:** The Layer, Type, Select, Filter, 3D, View and Help menus do not exist, and
Image and Edit are each a stub — Image has no Mode, Image Size, Canvas Size, Crop,
Trim or Canvas Rotation, and Edit has nothing but Free Transform. So Undo, Cut, Copy,
Paste, Image Size, Canvas Size, Layer Mask, Clipping Mask, Group, Merge, Select All,
Deselect, Modify, the Filter gallery, Zoom, Fit Screen, Rulers, Guides and Print are
unreachable from the menu bar — several are unreachable entirely.

Undo and Redo exist as buttons (`HistoryControls.tsx` — its `undo-button` and
`redo-button`)
and are bound to `Ctrl+Z` / `Shift+Ctrl+Z`
(`AppKeyboardShortcuts.tsx` — the two `key: 'z'` `useKeyDownShortcut`
registrations); they are missing
from the menu, not from the app.

## View and navigation

**Photoshop:** zoom in and out, fit on screen, wheel zoom, space-drag and
Hand-tool panning, rotate view, rulers, guides, snap, a grid overlay, and
screen-mode switching.

**This app:** contain-fit remains the base scale — `scale = min(scaleX, scaleY)`
with centring offsets (`contain-fit.ts` — `containFit()`, which
`usePointerPosition`'s `calculateDimensions()` calls). The Hand, Zoom and Rotate
View tools now keep transient `ViewState` (`src/contexts/view-state.ts`) and
apply the same presentation transform to the canvas and overlays (`Main.tsx` —
`renderContent()`). `usePointerPosition` inverts that transform before returning
document-space coordinates, so pixel tools continue to target the document rather
than the screen. View changes do not enter history or durable replay.

**Status:** `partial`

**Gap:** Flick panning, wheel and animated zoom preferences, pinch/two-finger
gestures, the Rotate View compass, angle snapping and multi-window sync remain
absent. The implementation deliberately caps the options-bar zoom control at
1600% pending a product-specific desktop maximum.

`absent`, not `platform`. Every one of these is a browser's ordinary business.

## Keyboard

**Photoshop:** about 200 default bindings.

**This app:** 45. Thirty-six registrations in
`AppKeyboardShortcuts.tsx`, eight in the two polygon tool areas
(`PolygonClickToolArea.tsx` and `FeatherMagneticLassoToolArea.tsx` — four
`useKeyDownShortcut` registrations each), and one `Escape` in `FontSelect`'s font popup.

**Status:** `partial`

**Present:** V, M, L, W, C, I, J, S, T, P, U, G, B, E, O; `Ctrl+Z`, `Shift+Ctrl+Z`,
`Ctrl+Y`, `Ctrl+C`, `Ctrl+V`, `Ctrl+J`, `Ctrl+S`; `[` and `]` for brush size; `0` and `1`
for opacity; and `Shift+Alt+D` / `Shift+Alt+S` for the Sponge's Desaturate and
Saturate, which are tool-conditional — the same `Alt+Shift+S` is Shadows on the Dodge
and the Burn, so the Sponge must be the active tool.

Every `Ctrl+` chord above is also `Cmd+` on macOS. `Ctrl+S` is bound because the app's
only save is Save As, which is what `File > Save` opens
(`useFile.tsx` — its `proposedName` of `"<name> (copy)"`), so Adobe's
`Cmd+S`/`Cmd+Shift+S` pair has one destination here rather than two.

**Gap:** `A`, `H`, `Z`, `X` and bare `D` are unbound — Automatic Select, Hand, Zoom,
Swap Colours and Default Colours. `D` is bound only as `Shift+Alt+D`, and only while
the Sponge is active. `Ctrl+A`, `Ctrl+D`, `Ctrl+I` and
`Ctrl+Shift+I` — Select All, Deselect, Invert — are unbound, which follows from the
selection model above rather than from the keyboard layer. `Tab`, `F`,
`Ctrl++`, `Ctrl+-` and `Ctrl+0` are unbound, and Space does not pan.

## Colour management

**Photoshop:** RGB, CMYK, Lab, Greyscale, Multichannel and Duotone; 8, 16 and
32-bit; embedded and working ICC profiles; proofing setups.

**This app:** 8-bit sRGB RGBA on every surface. `src/util/color.ts` is 24 lines of
UI-contrast helpers and nothing else. There is no ICC handling anywhere in `src/`.
PSD import hard-rejects anything but 8-bit and RGB/greyscale
(`psd-utils.ts` — `loadPsd()`), and PSD export quantises opacity to one byte
(`psd-utils.ts` — `savePsd()`).

**Status:** `platform` for the colour-space and bit-depth half.

`getContext('2d')` gives 8-bit RGBA, and that is a platform boundary rather than a
choice. Wider-gamut and float surfaces are appearing in browsers, and none is used
here.

**Status:** `absent` for the profile half. Shipping and honouring an ICC profile is
something a browser application can do; it has not been done.

## Export options

**Photoshop:** a dialog per format — JPEG quality, chroma subsampling, progressive
and metadata; PNG compression and interlacing; WebP and AVIF quality; TIFF
compression; GIF colours and dither.

**This app:** a format dropdown and **one** slider. JPEG quality, 0.1–1.0, default
0.92, shown only for JPEG and passed only for JPEG
(`SaveDialog.tsx` — its format select and `jpegQuality` slider, seeded from
`imageFormats.ts`'s `DEFAULT_JPEG_QUALITY`),
reaching `canvas.toBlob`
through `supportsQuality`, which is true for JPEG alone
(`imageFormats.ts` — `IMAGE_FORMATS`). AVIF quality is hard-coded at 80 in the
encoder (`avif-utils.ts` — `encodeAvif()`).

**Status:** `partial`

**Gap:** No PNG compression, subsampling, progressive, interlacing, bit-depth or
metadata option; no WebP, AVIF, GIF or TIFF encoder settings.

## Mobile

**Photoshop:** a touch-optimised workspace with one-finger draw, two-finger pan and
pinch-zoom.

**This app:** a full mobile shell (`App.tsx` — the `MobileShell` it mounts) —
header with menu, undo,
redo, layers drawer and Export (`MobileHeader.tsx` — its `mobile-header`
region),
a tool sheet carrying the active tool's options
(`MobileToolSheet.tsx` — its `mobile-tool-options` panel), a bottom bar whose
tiles come
from the same `toolbarMap` as desktop so they cannot drift
(`mobile-tools.ts` — `mobileToolGroups`, derived from `toolbarMap`), and a layers
drawer
(`MobileLayersDrawer.tsx`). Canvas input goes
through Pointer Events with single-pointer capture, so drawing works on touch
(`usePointerPosition.ts` — `isPointerDownValid()`).

**Status:** `partial`

**Gap:** No pinch-zoom and no two-finger pan — inherited from the absence of zoom
and pan entirely, not a mobile-specific omission.

**MOBILE AND TABLET ARE VERY LOW PRIORITY, SKIP ALL MOBILE ISSUES UNLESS ASKED EXPLICITLY BY OPERATOR**

## Non-destructive editing

**Photoshop:** smart objects, adjustment layers, Smart Filters, Generative Fill,
Content-Aware Fill, Neural Filters.

**This app:** no smart objects — a placed layer imports as a raster with an
explicit warning (`psd-utils.ts` — `visit()`), and there is no `LayerSource`
arm for one. No adjustment layers. No generative, content-aware or neural code in
`src/`. The Pen family and Custom Shape are unimplemented placeholders
(`toolProcessors.ts` — their `commit: 'unimplemented'` entries), so there are no path
layers either.

**What it does have** is a genuine, if narrow, non-destructive mechanism: a
per-layer retained operation stack — `FilterLayerOperation | AffineLayerOperation`
(`layer-types.ts` — the `LayerOperation` union) — re-rendered as a CSS `ctx.filter`
string on
every draw (`getPresentationFilter` in `presentation-evaluator.ts`, assigned to
`ctx.filter` by `drawEvaluatedPresentation()`). A layer can be re-blurred,
re-levelled or
re-coloured without rasterising.

**Status:** `divergent`

### Platform limits on filters

**Capability:** Blur, Colors and Levels — every adjustment this app mints by
re-rendering a `CanvasRenderingContext2D.filter` string. The first is a tool; the
other two are `Image ▸ Adjustments` commands.

`CanvasRenderingContext2D.filter` is **not Baseline**. caniuse records Safari
`3.1 - 17.6: Not supported`, and MDN's own page states that the feature "is not
Baseline because it does not work in some of the most widely-used browsers." No
CSS filter kernel exists to fall back on: the property is the whole mechanism.

**On such a browser this app REFUSES the edit and logs the refusal** rather than
applying it as a no-op. The refusal is loud precisely because the alternative
looks like success: a silent no-op would present and then record the unchanged
bitmap as if it were the edit, and no replay could reproduce those pixels.
Photoshop applies a real kernel on every platform, so the divergence is visible,
not silent.

**Status:** `platform` for the Safari half. Everywhere else these three behave as
Photoshop does, and the absence of a CPU-side implementation is not recorded here —
that is a backlog item, not a limit.

## What is not a platform limit

Recorded so that the `platform` status above stays honest. All of these are
ordinary browser capabilities that this app simply does not use yet:

| Capability          | In a browser                                                                 |
| ------------------- | ---------------------------------------------------------------------------- |
| Print               | `window.print()` — a real API                                                |
| Zoom and pan        | Transforms and pointer capture; the app has neither implemented              |
| Wider gamut         | `getContext('2d', { colorSpace: 'display-p3' })`                             |
| Off-thread work     | `OffscreenCanvas` in a worker — used for working surfaces, never in a worker |
| Transferable pixels | `ImageBitmapTransfer` — zero occurrences in `src/`                           |
| Font loading        | `document.fonts` and `FontFace`                                              |

The last two are notable because `OffscreenCanvas` already appears throughout
`src/util/` and `src/tools/` — the project has chosen synchronous main-thread
raster work, which is a performance decision, not a platform constraint.
