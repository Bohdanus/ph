# Features

What this app can do, system-wide, measured against Photoshop.

**This is not a per-tool document.** That is [`TOOLS.md`](TOOLS.md) — generated,
54 tool-level sections, one per implemented tool or Adobe command, with an options-bar
table and Adobe citations. Four of the 54 are not Tools-panel tools — the Shape group
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

| Area              | Status      | The gap in one line                                                                                          |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| Document model    | `partial`   | One document, no colour mode, no Image Size                                                                  |
| Open / import     | `partial`   | No PSB, RAW, HEIF, PDF; 8-bit RGB PSD only                                                                   |
| Export            | `partial`   | No PDF/HEIF/HDR; PSD writer drops groups, text and masks                                                     |
| Selection         | `divergent` | Compound contours with derived masks, not a persistent alpha channel; no full selection commands or channels |
| Layers            | `partial`   | No groups, masks, clipping or adjustment layers; no separate Fill opacity                                    |
| History           | `partial`   | Linear panel exists; no state limit, snapshots, non-linear history or History Brush                          |
| Panels            | `partial`   | Two panels. Photoshop has seventeen                                                                          |
| Menu bar          | `divergent` | Six hosts including custom Tools; View has Zoom In/Out, Fit on Screen and 100%                               |
| View / navigation | `partial`   | Pan, zoom, fit and rotate work; no canvas rulers or guides                                                   |
| Keyboard          | `partial`   | 65 keyboard bindings/handlers against Photoshop's ~200 defaults                                              |
| Colour management | `partial`   | Current pixel pipeline is 8-bit sRGB; no ICC, CMYK or 16/32-bit document modes                               |
| Export options    | `partial`   | JPEG quality is the only user-controllable option                                                            |
| Tablet touch      | `partial`   | Tablet-sized touch shell; Retina/high-DPI matters; handheld phone layouts are out of scope                   |
| Non-destructive   | `divergent` | A retained per-layer operation stack, not smart objects                                                      |

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
there is deliberately no `dpi` field). The source mode of a grayscale PSD is not
retained when it is converted to RGB on import (see Import), so mode-scoped Photoshop
behaviour cannot be reproduced after import.

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
handler. The initial starter document is clean on first load, so the first File > New
or File > Open does not ask users to discard work they have not made. A new blank document
created through File > New is marked unsaved immediately, even before its first edit.

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

**This app:** `Selection` has one authoritative geometry per committed selection
(`general-types.ts`). Ordinary selections store compound contour paths. Highly
fragmented Magic Wand and Quick Selection results store a cropped, row-major,
one-bit-per-pixel mask when their exposed boundary exceeds the safe vector budget;
those records have no point paths. Both forms preserve disconnected regions and
holes. Marching ants use contour paths for vector selections and a cached raster
edge image for mask-backed selections (`useSelectionAnts.ts`). Clipboard and
copy-to-layer derive alpha from either form through `copySelectionToCanvas()`;
Fill, Eraser and Clone Stamp use `createSelectionAlphaMask()` to clip pixel
operations. Feather is still a copy parameter, not a modification of the stored
selection.

Rectangular, elliptical, and single-row/column marquee drags stay captured when
the pointer leaves the canvas and commit on a valid release; `pointercancel`
aborts the gesture.

Magic Wand, Quick Selection, and Magnetic Lasso sample the composited canvas on
the logical document-pixel grid, including on high-DPI displays. They support
documents up to 16,777,216 pixels for pixel sampling; larger documents remain
openable but these three tools do not start, and their options bars show the
limit. The 100,000,000-pixel document ceiling is higher because canvas loading
and selection's multi-buffer algorithms have different memory budgets.

**Status:** `divergent`

**Gap:** No general New / Add / Subtract / Intersect controls across selection
tools, no Invert, no Modify (Feather / Expand / Contract), no Save or Load
Selection, no Quick Mask, and no Channels panel (`PanelLayout.tsx` — `PanelId`
admits only `history` and `layers`). Quick Selection alone offers Add and
Subtract. Fill, Eraser and Clone Stamp consume derived masks; Brush, Draw and
the other paint tools do not apply selection coverage.

The stored selection is not Photoshop's general 8-bit alpha channel. The packed
mask is binary and used only for high-complexity Magic Wand and Quick Selection
results; other selections remain vector paths. There is no partial coverage in
the stored geometry, Quick Mask, channel editing, selection-channel save/load,
or the full set of Photoshop selection operations. The Magic Wand Smooth control
simplifies vector-backed contours; the high-complexity mask path keeps the exact
matched pixels and therefore does not apply that contour simplification. Quick
Selection rasterizes an active selection by destination pixel-center membership
before Add or Subtract, so fractional positioning and antialiased edge coverage are
quantized to binary membership when the brush edits the selection.

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
(`LayersTab.tsx` — its `layers-list` rows). Desktop rows also render a 48x32 `LayerThumbnail`
through the shared `drawLayerSource()` presentation path; the tablet drawer currently has no preview.
Selecting a matching tool layer hydrates its arguments, and selecting text can re-enter text editing
(`textLayerEditTarget()` / `beginTextLayerEdit()`), including for retained affine operations. Layers
with filter operations remain outside that overlay path. Desktop and tablet expose opacity, the
supported blend-mode menu, and one full-layer lock control; desktop also exposes `Layer from
Background` for the lone backing layer.

**Status:** `partial`

**Gap:** No groups or nesting, no layer masks, no clipping masks, no adjustment
or smart-object layers. The blend-mode menu supports a subset of Photoshop's modes, and the single
`locked` flag implements a strict full-layer lock rather than Photoshop's four independent lock
protections. Locked layers have no Move Tool transform box, and a hit on one is selection-only with
a prohibited cursor. Photoshop's separate Fill opacity and preset drop-down remain absent. See
[`LAYERS-PANEL.md`](LAYERS-PANEL.md#92-layer-editability-and-rasterization-gates).

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
(`PanelLayout.tsx` — `PanelId`). They remain pinned to the window edges, resize by
width and shared split, collapse to icons and roll up (`PanelLayout.tsx` — the setters `PanelLayoutProvider` returns,
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

**Photoshop:** File, Edit, Image, Layer, Type, Select, Filter, View, Window and
Help. Adobe says Photoshop's legacy 3D features were removed as of July 2024
([Manage layers and groups](https://helpx.adobe.com/photoshop/using/layers.html)).

**This app:** six menu hosts — `file`, `tools`, `image`, `edit`, `view`, `window`
(`DesktopHeader.tsx` — the six hosts `menuHostRefs` addresses). File has New, Open,
Save. Tools lists every rail tool. Image carries one submenu, `Adjustments`, holding
Adobe's item list with **three enabled** — `Brightness/Contrast`, `Desaturate` and
`Invert` — and nineteen **disabled** (`DesktopHeader.tsx` — `ADJUSTMENTS_ITEMS`); a disabled item
records a capability
the app does not have rather than faking it. Edit holds one item, `Free Transform`,
which is where Adobe puts it (`DesktopHeader.tsx` — `handleFreeTransform`). Window
has Reset Workspace. View has `Zoom In`, `Zoom Out`, `Fit on Screen` and `100%`;
the latter uses the active workspace fit and device-pixel ratio.

**Status:** `divergent`

**Gap:** The Layer, Type, Select, Filter and Help menus do not exist, and
Image and Edit remain partial — Image has no Mode, Image Size, Canvas Size, Crop,
Trim or Canvas Rotation, and Edit has nothing but Free Transform. So Undo, Cut, Copy,
Paste, Image Size, Canvas Size, Layer Mask, Clipping Mask, Group, Merge, Select All,
Deselect (both on the keyboard only), Modify, the Filter gallery, Rulers, Guides and
Print are unreachable from the menu bar — several are unreachable entirely. Legacy
3D is not listed as a gap because Adobe removed those features.

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
than the screen. View changes do not enter history or durable replay. Photoshop's three
screen modes are modelled as shell state (`ScreenMode.tsx` — `chromeVisibility()`): Full Screen
With Menu Bar hides the status bar, and Full Screen hides every region and asks the browser for
fullscreen, keeping the in-window hide when the browser refuses.

**Status:** `partial`

**Gap:** Flick panning, animated zoom preferences, the Rotate View compass,
multi-window sync, canvas rulers, guides, snap and the grid overlay remain absent.
View exposes Zoom In, Zoom Out, Fit on Screen and 100%. Zoom In/Out follow the existing
1.25/0.8 relative step; Photoshop's Zoom tool uses preset percentage steps
([Zoom images in Photoshop](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/zoom-images.html)),
so exact step parity remains open. Hand, Zoom and Rotate View surfaces support wheel pan and
Ctrl/Meta+wheel zoom while a View tool is active; those wheel gestures do not apply
while another tool is selected. Two-finger touch pans and pinches the canvas while a
single touch remains with the active tool. Shift constrains Rotate View to 15-degree
increments. The implementation deliberately caps the options-bar zoom control at
1600% pending a product-specific desktop maximum.

`absent`, not `platform`. Every one of these is a browser's ordinary business.

## Keyboard

**Photoshop:** about 200 default bindings.

**This app:** 65 `useKeyDownShortcut` call sites: 50 in
`AppKeyboardShortcuts.tsx`; six in three small command modules — `SelectionShortcuts.tsx`
(two), `AdjustmentShortcuts.tsx` (one) and `ScreenModeShortcuts.tsx` (three); eight in the two
polygon tool areas
(`PolygonClickToolArea.tsx` and `FeatherMagneticLassoToolArea.tsx` — four
`useKeyDownShortcut` registrations each), and one `Escape` in `FontSelect`'s font popup.
These are hook call sites, not a count of unique key chords; modifiers and enabled states share the
same registration path.

**Status:** `partial`

**Present:** V, M, L, W, C, I, J, S, T, P, U, G, B, E, O, H, Z, R; temporary Hand while holding
Space (except while editing text or a document gesture is open); `Ctrl+Z`, `Shift+Ctrl+Z`,
`Ctrl+Y`, `Ctrl+C`, `Ctrl+V`, `Ctrl+J`, `Cmd/Ctrl+T`, `Ctrl+S`; `Ctrl/Cmd+0` (Fit on Screen),
`Ctrl/Cmd+1` (100%), `Ctrl/Cmd++` / `=` (Zoom In) and `Ctrl/Cmd+-` / `_` (Zoom Out); `Ctrl+A` (Select All, replacing any
selection), `Ctrl+D` (Deselect) and `Ctrl+I` (`Image > Adjustments > Invert` on the active
non-bedrock layer, clipped by the active selection); `Tab` to hide or show the Tools panel,
options bar and panels; `F` / `Shift+F` to cycle Standard, Full Screen With Menu Bar and Full
Screen; `Esc` to leave Full Screen; `[` and `]` for brush size; `0` and `1`
for opacity; and `Shift+Alt+D` / `Shift+Alt+S` for the Sponge's Desaturate and
Saturate, which are tool-conditional — the same `Alt+Shift+S` is Shadows on the Dodge
and the Burn, so the Sponge must be the active tool; `X` and `D` for Switch Foreground and
Background Colors and Default Foreground and Background Colors.

Every `Ctrl+` chord above is also `Cmd+` on macOS. `Ctrl+S` is bound because the app's
only save is Save As, which is what `File > Save` opens
(`useFile.tsx` — its `proposedName` of `"<name> (copy)"`), so Adobe's
`Cmd+S`/`Cmd+Shift+S` pair has one destination here rather than two.

**Gap:** `A` is unbound — Automatic Select. `Ctrl+Shift+I` (Select > Inverse) is unbound; the
app has no inverse-selection operation. `Ctrl+I` refuses the bedrock layer, as every raster tool
does, where Photoshop inverts a Background layer. `Shift+Tab` (panels only) is unbound, and `Tab`
does nothing in Full Screen, where Photoshop shows the panels over the image.

## Colour management

**Photoshop:** RGB, CMYK, Lab, Greyscale, Multichannel and Duotone; 8, 16 and
32-bit; embedded and working ICC profiles; proofing setups.

**This app:** 8-bit sRGB RGBA on every surface. `src/util/color.ts` is 24 lines of
UI-contrast helpers and nothing else. There is no ICC handling anywhere in `src/`.
PSD import hard-rejects anything but 8-bit and RGB/greyscale
(`psd-utils.ts` — `loadPsd()`), and PSD export quantises opacity to one byte
(`psd-utils.ts` — `savePsd()`).

**Status:** `partial` for the colour-space and bit-depth half.

The app requests default 2D canvas contexts, which use 8-bit unsigned channel data
in sRGB. The HTML canvas standard also defines explicit `display-p3` and `float16`
context settings; this app does not request them. Their browser support and behavior
must be checked for each supported runtime before the editor can rely on them
([HTML Standard: canvas](https://html.spec.whatwg.org/multipage/canvas.html)).

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

## Tablet Touch (Not Handheld Phone)

**Hard boundary:** this product supports desktop and tablet-sized touch devices, including Retina/high-DPI
tablets. It does **not** support handheld phone layouts such as iPhone-sized screens. "Mobile" component
names are historical and mean the tablet touch surface here; they are not a phone product.

**Photoshop:** a touch-optimised workspace with one-finger draw, two-finger pan and
pinch-zoom.

**This app:** a tablet touch shell (`App.tsx` — the `MobileShell` it mounts) —
header with menu, undo,
redo, layers drawer and Export (`MobileHeader.tsx` — its `mobile-header`
region),
a tool sheet carrying the active tool's options
(`MobileToolSheet.tsx` — its `mobile-tool-options` panel), a bottom bar whose
tiles come
from the same `toolbarMap` as desktop so they cannot drift
(`mobile-tools.ts` — `mobileToolGroups`, derived from `toolbarMap`), and a layers
drawer
(`MobileLayersDrawer.tsx`). Canvas input uses Pointer Events: one touch stays with the
selected tool, while a second touch cancels its in-flight gesture and starts canvas
navigation (`useCanvasTouchNavigation.ts`).

**Status:** `partial`

**Gap:** Two-finger pan and pinch zoom now work on the canvas, and one remaining finger
continues as a hand pan. A third touch pauses navigation until every touch is lifted.
Flick panning and a two-finger rotation gesture remain absent. Text editing keeps its
own touch handling and does not start canvas navigation.

**Retina/High-DPI Status:** Pointer mapping is DPR-correct (tested at 3×). Paint tools are DPR-proof — all geometry paths are document-pixel invariant. Option-bar thumbnails and display surfaces (workspace canvas and overlays) use DPR-scaled backing stores while retaining document-pixel coordinates. Export remains decoupled from display resolution, and the marching-ants clear path uses logical frame bounds.

**Priority:** tablet touch and Retina/high-DPI behavior are supported product surfaces. Handheld phone
layouts and phone-only gestures remain explicitly out of scope.

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

| Capability          | In a browser                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Print               | `window.print()` — a real API                                                                             |
| Zoom and pan        | Transforms, wheel navigation and two-finger touch pan/pinch are implemented; flick inertia remains absent |
| Wider gamut         | `getContext('2d', { colorSpace: 'display-p3' })`                                                          |
| Off-thread work     | `OffscreenCanvas` in a worker — used for working surfaces, never in a worker                              |
| Transferable pixels | `ImageBitmapTransfer` — zero occurrences in `src/`                                                        |
| Font loading        | `document.fonts` and `FontFace`                                                                           |

The last two are notable because `OffscreenCanvas` already appears throughout
`src/util/` and `src/tools/` — the project has chosen synchronous main-thread
raster work, which is a performance decision, not a platform constraint.
