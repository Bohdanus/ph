# Features

What this app can do, system-wide, measured against Photoshop.

**This is not a per-tool document.** That is [`TOOLS.md`](TOOLS.md) — generated,
41 sections, one per tool, with an options-bar table and Adobe citations. This
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

| Area              | Status      | The gap in one line                                                            |
| ----------------- | ----------- | ------------------------------------------------------------------------------ |
| Document model    | `partial`   | One document, no colour mode, no Image Size                                    |
| Open / import     | `partial`   | No PSB, RAW, HEIF, PDF; 8-bit RGB PSD only                                     |
| Export            | `partial`   | No PDF/HEIF/HDR; PSD writer drops groups, text and masks                       |
| Selection         | `divergent` | A shape list, not an alpha channel — so no Combine, Invert, Modify or channels |
| Layers            | `partial`   | No groups, masks, clipping or adjustment layers; opacity is model-only         |
| History           | `have`      | Linear, unbounded, with a History panel                                        |
| Panels            | `partial`   | Two panels. Photoshop has seventeen                                            |
| Menu bar          | `divergent` | Adobe's ten in Adobe's order; Type, Select, Filter, View and Help are inert |
| View / navigation | `absent`    | No zoom, no pan, no rulers, no guides                                          |
| Keyboard          | `partial`   | 41 bindings against Photoshop's ~200                                           |
| Colour management | `platform`  | 8-bit sRGB only; no ICC, no CMYK, no 16/32-bit                                 |
| Export options    | `partial`   | JPEG quality is the only user-controllable option                              |
| Mobile            | `partial`   | A full mobile shell, minus pinch-zoom — because there is no zoom at all        |
| Non-destructive   | `divergent` | A retained per-layer operation stack, not smart objects                        |

## Documents

**Photoshop:** canvas size, resolution, colour mode, a background-layer choice at
New time, and many documents open at once in tabs.

**This app:** the canvas is a `DocumentFrame` — a `Pos` —
`src/contexts/document-frame.ts:3` — plus a `Size` from
`src/contexts/general-types.ts:2`. New offers presets, a DPI field shown only for
physical-unit presets (`src/components/NewImageDialog/NewImageDialog.tsx:126`),
background colour and opacity, and pixel dimensions clamped to 1–10000
(`:197-198`, `:216-217`). Opening a file replaces the whole document and mints a new
`documentId` (`src/hooks/useApp.ts:116-144`).

**Status:** `partial`

**Gap:** One document at a time. No colour mode or bit depth. No Image Size or
Canvas Size dialog. DPI is a one-shot conversion at New time and is never stored on
the document (`NewImageDialog.tsx:12-20`).

## Import

**Photoshop:** PSD and PSB, PDF, EPS/AI, camera RAW, HEIF/HEIC, BMP, DICOM, GIF,
TIFF, WebP, AVIF.

**This app:** `loadDocumentFile` (`src/contexts/image-load-save-utils.ts:68`)
sniffs the first 64 bytes and dispatches — PSD (`:70`), TIFF (`:74`), BMP (`:78`),
AVIF (`:82`), ICO (`:86`), GIF (`:90`) and SVG (`:93`) to their own codecs, and
everything else through the browser's own `<img>` decoder (`:96`), which covers
JPEG, PNG and WebP.

**Status:** `partial`

**Gap:** No PSB, no 16- or 32-bit, no CMYK PSD (`src/contexts/psd-utils.ts:64-67`);
a greyscale PSD is converted to RGB with a warning (`:80`).

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

**This app:** `saveImageToDisk` (`src/contexts/image-load-save-utils.ts:138`)
writes PNG, JPEG and WebP through `canvas.toBlob` (`:203-205`), and dispatches TIFF,
BMP, GIF, AVIF, ICO and SVG to their encoders (`:147-178`). PSD is written
separately (`src/contexts/psd-utils.ts:205`).

**Status:** `partial`

**Gap:** No PDF, HEIF, HDR or DICOM output — PDF and DICOM for the platform
reasons above. The PSD writer drops groups, editable text, masks and effects
(`src/components/SaveDialog/SaveDialog.tsx:119`), and groups in an imported PSD are
flattened (`src/contexts/psd-utils.ts:129-132`). SVG export is a raster wrapped in
an `<svg><image>` element (`src/constants/imageFormats.ts:70` labels it "SVG
(flattened)"), not vector output.

## Selection

**Photoshop:** a selection is an 8-bit-per-pixel alpha channel. It combines (New /
Add / Subtract / Intersect), inverts, modifies (Feather / Expand / Contract),
refines, saves to and loads from a named channel, and is viewed in a Channels panel.

**This app:** a selection is **a polygon point list with a bounding box**, not a
pixel channel — `src/contexts/general-types.ts:61-70`. Seven selection tools write
it (`src/contexts/tool-types.ts:40-48`). Marching ants read the points
(`src/hooks/useAnts.ts`, `useSelectionAnts.ts`, `usePolylineAnts.ts`). An alpha
mask does exist, but only as a derived copy for clipboard and copy-to-layer
(`src/util/selection.ts:705`), reached from `copySelectionToCanvas` (`:822`) and
nowhere else. Feather is a parameter on that copy, not a modification of the
selection.

**Status:** `divergent`

**Gap:** No Combine (Add / Subtract / Intersect), no Invert, no Modify (Feather /
Expand / Contract), no Save or Load Selection, no Quick Mask, no Channels panel
(`src/contexts/PanelLayout.tsx:89` admits only `history` and `layers`). **A
selection does not clip a stroke**: no tool in `src/tools/` reads `selections`.

That last one is the largest single selection gap and it is a model problem, not
a missing control — a shape list cannot mask pixels. Fixing it means the selection
becomes a channel, which is the same change Photoshop's data model makes.

## Layers

**Photoshop:** raster, vector-shape, type, adjustment, smart-object and group
layers, each with opacity, fill opacity, blend mode, per-property locks, layer
masks, clipping masks and Blend If.

**This app:** `LayerSource` has three discriminants — `blank`, `image`, `tool`
(`src/contexts/layer-types.ts:9-26`). Both Type and a shape commit as a source
(`src/tools/toolProcessors.ts:160-161`, `commit: 'source'` on each), but only the six
tools in `vectorToolNames` (`src/contexts/layer-renderer.ts:32`) are re-rendered from
their args at draw time; Type is not among them, so `getLayerBitmap` falls through to
the layer's own bitmap (`layer-renderer.ts:53`), which replay materialises
(`src/contexts/history-replay.ts:216`). Sixteen Photoshop blend modes map to
canvas composite operations (`src/contexts/psd-utils.ts:16-33`), and opacity and
blend mode are applied at draw time (`src/contexts/layer-renderer.ts:100-101`).
The layer record is flat (`layer-types.ts:71`) and the panel offers visibility,
reorder, rename and delete (`src/components/SidebarRight/LayersTab.tsx:174-263`).

**Status:** `partial`

**Gap:** No groups or nesting, no layer masks, no clipping masks, no adjustment
or smart-object layers. **No panel control for opacity, blend mode or locking** —
those fields exist in the model and round-trip through PSD, but nothing in the UI
sets them, so the Layers panel cannot express what the layer model can.

That opacity field is a live defect, not a scope note: `HANDOFF.md` §56 records
that the obvious writer is discarded by replay.

## History

**Photoshop:** a linear History States panel with named states, a per-step
visibility toggle, unlimited states, and History States snapshots.

**This app:** a linear `HistoryItem[]` with a cursor
(`src/contexts/useHistory.ts:34-35`, `src/contexts/history-types.ts:21-25`), unbounded
— append truncates the redo tail and pushes, with no cap anywhere
(`src/contexts/history-timeline.ts:31-32`). A History panel exists
(`src/components/SidebarRight/HistoryTab.tsx`) with click-to-rewind (`:74`) and a
per-step disabled toggle (`:88-98`), plus Undo/Redo in the header
(`src/components/HistoryControls/HistoryControls.tsx:43-62`).

**Status:** `have`

**Note, because it is the opposite of what the code looks like:** entries store
_args_, never pixels, and undo re-runs the tool processors from index zero
(`src/contexts/history-replay.ts:72`). See
[`ARCHITECTURE.md`](ARCHITECTURE.md#two-history-systems).

## Panels

**Photoshop:** Layers, Channels, Paths, History, Properties, Adjustments, Color,
Swatches, Styles, Character, Paragraph, Brush presets, Navigator, Info, Histogram,
Actions, Measurement Log — dockable, with panel groups.

**This app:** exactly two dockable panels, `PanelId = 'history' | 'layers'`
(`src/contexts/PanelLayout.tsx:89`). They dock, drag-reorder, resize, collapse to
icons and roll up (`src/contexts/PanelLayout.tsx:330-344`,
`src/components/SidebarRight/PanelGroup.tsx`), and Window has `Workspace ▸ Reset
Essentials`.

**Status:** `partial`

**Gap:** No Properties, Adjustments, Channels, Paths, Character, Paragraph, Brush
presets, Swatches, Styles, Navigator, Info or Histogram panel. The rail carries
the foreground/background swatches
(`src/components/SidebarLeft/SidebarLeft.tsx:1258-1292`); the closest analogues to
Color and Character are the Photo Filter command's three sliders and the Type options bar,
which are options bars, not panels.

## Menu bar

**Photoshop:** File, Edit, Image, Layer, Type, Select, Filter, View, Window, Help.
The macOS bar prefixes that with the application menu, `Photoshop`, and a `Plugins`
menu appears when a third-party plugin is installed. There is **no `3D` menu** — Adobe
removed the 3D features outright in 2020 — and no top-level `Analysis` menu, whose
commands sit at `Image ▸ Analysis`. There is **no `Tools` menu**: Photoshop exposes the
tool set through the Tools panel, its flyouts and the single-key bindings
(<https://helpx.adobe.com/photoshop/kb/3d-faq.html>,
<https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html>).

**This app:** Adobe's ten, in Adobe's order, and nothing else decides the list
(`src/components/DesktopHeader/DesktopHeader.tsx`, the `menus` array). File has New,
Open, Save. Edit opens with the history group — `Undo`, `Step Forward`, then a
disabled `Step Backward` — and carries `Free Transform` and a `Transform` submenu.
Image carries `Adjustments`, Adobe's item list with **two enabled** (`Brightness/Contrast`
and `Photo Filter`) and twenty disabled. Layer carries `Flatten Image`, the only
enabled row, over ten Adobe rows this app cannot run. Type, Select, Filter, View and
Help exist with Adobe's items in Adobe's order, every one disabled. Window carries
`Workspace ▸ Reset Essentials`, nested where Adobe nests it.

**Status:** `divergent`

**Gap:** Membership inside each host, not the structure. `File` has no `Close`,
`Save As`, `Place`, `Export` or `Print`. `Edit` has no `Cut`, `Copy`, `Paste`,
`Fill`, `Stroke`, `Content-Aware Fill` or `Puppet Warp`. `Image` has no `Mode`,
`Image Size`, `Canvas Size`, `Crop`, `Trim`, `Image Rotation` or `Analysis`. `Layer`
has no `New`, `Delete`, masks, `Create Clipping Mask`, `Group Layers`, `Arrange` or
`Merge Layers`. `Type`, `Select`, `Filter`, `View` and `Help` are inert in full, and the
category submenus — `Filter ▸ Blur`, `Type ▸ OpenType`, `View ▸ Proof Setup`,
`View ▸ Show` — are not rendered at all, because every one of their leaves is
unbuildable and Adobe publishes no stable order for them. `Window` has no `Arrange`,
no panel toggles and no open-document list.

So Undo, Cut, Copy, Paste, Image Size, Canvas Size, Layer Mask, Clipping Mask,
Group, Merge, Select All, Deselect, Modify, the Filter gallery, Zoom, Fit Screen,
Rulers, Guides and Print are unreachable from the menu bar — several are unreachable
entirely. Zoom is the load-bearing one: `docs/FEATURES.md`'s next section records that
the canvas cannot be magnified or panned at all, so every `View` row is inert for the
same reason.

A row the app cannot run renders `disabled` rather than being omitted, so the gap is
visible where a user looks for it. That is why `Select ▸ All` is on screen and greyed:
this app has selection tools and no selection commands, and an absent menu would hide
that in a document instead.

Tools are reachable the two ways Photoshop reaches them: the rail
(`src/components/SidebarLeft/SidebarLeft.tsx`, with its `role="menu"` flyouts) and the
single-key bindings (`src/components/Common/AppKeyboardShortcuts.tsx`).
`SidebarLeft/__tests__/toolbar-mapping.test.ts` pins that every registered tool is a
rail tile or is named in `toolbar-mapping.ts`'s `extraTools` — which is where the "no
tool is unreachable" guarantee lives now that there is no `Tools` menu to be complete.

Undo and Redo also exist as buttons (`src/components/HistoryControls/HistoryControls.tsx`)
and are bound to `Ctrl+Z` / `Shift+Ctrl+Z`
(`src/components/Common/AppKeyboardShortcuts.tsx`); the menu rows call the same
guarded commands through `src/hooks/useHistoryCommands.ts`, so a pointer gesture
cannot truncate the redo tail from any of the three surfaces.

## View and navigation

**Photoshop:** zoom in and out, fit on screen, wheel zoom, space-drag and
Hand-tool panning, rotate view, rulers, guides, snap, a grid overlay, and
screen-mode switching.

**This app:** the canvas is contain-fit and nothing else — `scale = min(scaleX,
scaleY)` with centring offsets (`src/hooks/usePointerPosition.ts:135`,
`src/util/contain-fit.ts:33-51`). The
zoom transform is commented out (`src/components/Main/Main.tsx:286`) and so is
the store's zoom state (`src/contexts/StoreContext.tsx:142-143`, `:1171-1174`).
There is no zoom or hand entry in the tool registry (`toolbar-mapping.ts:37-170`).

**Status:** `absent`

**Gap:** The image cannot be magnified or panned at all. This is the most
consequential absence in this document, because it makes three other areas worse
than their own status suggests: a fixed view means no detail work, and it is also
why mobile has no pinch-zoom — that gap is inherited, not native.

`absent`, not `platform`. Every one of these is a browser's ordinary business.

## Keyboard

**Photoshop:** about 200 default bindings.

**This app:** 41. Thirty-three registrations in
`src/components/Common/AppKeyboardShortcuts.tsx` and eight in the two polygon tool
areas (`src/components/Main/PolygonClickToolArea.tsx:922-958`,
`FeatherMagneticLassoToolArea.tsx:543-579`).

**Status:** `partial`

**Present:** V, M, L, W, C, I, J, S, T, P, U, G, B, E, O; `Ctrl+Z`, `Shift+Ctrl+Z`,
`Ctrl+Y`, `Ctrl+C`, `Ctrl+V`, `Ctrl+J`; `[` and `]` for brush size; `0` and `1`
for opacity.

**Gap:** `A`, `H`, `Z`, `X` and `D` are unbound — Automatic Select, Hand, Zoom,
Swap Colours and Default Colours. `Ctrl+A`, `Ctrl+D`, `Ctrl+I` and
`Ctrl+Shift+I` — Select All, Deselect, Invert — are unbound, which follows from the
selection model above rather than from the keyboard layer. `Tab`, `F`,
`Ctrl++`, `Ctrl+-` and `Ctrl+0` are unbound, and Space does not pan.

## Colour management

**Photoshop:** RGB, CMYK, Lab, Greyscale, Multichannel and Duotone; 8, 16 and
32-bit; embedded and working ICC profiles; proofing setups.

**This app:** 8-bit sRGB RGBA on every surface. `src/util/color.ts` is 24 lines of
UI-contrast helpers and nothing else. There is no ICC handling anywhere in `src/`.
PSD import hard-rejects anything but 8-bit and RGB/greyscale
(`src/contexts/psd-utils.ts:66-67`), and PSD export quantises opacity to one byte
(`:253`).

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
(`src/components/SaveDialog/SaveDialog.tsx:83-116`, `src/constants/imageFormats.ts:1`),
reaching `canvas.toBlob`
through `supportsQuality`, which is true for JPEG alone
(`src/constants/imageFormats.ts:18`). AVIF quality is hard-coded at 80 in the
encoder (`src/contexts/avif-utils.ts:40`).

**Status:** `partial`

**Gap:** No PNG compression, subsampling, progressive, interlacing, bit-depth or
metadata option; no WebP, AVIF, GIF or TIFF encoder settings.

## Mobile

**Photoshop:** a touch-optimised workspace with one-finger draw, two-finger pan and
pinch-zoom.

**This app:** a full mobile shell (`src/App.tsx:118`) — header with menu, undo,
redo, layers drawer and Export (`src/components/Mobile/MobileHeader.tsx:92-167`),
a tool sheet carrying the active tool's options
(`src/components/Mobile/MobileToolSheet.tsx:66-97`), a bottom bar whose tiles come
from the same `toolbarMap` as desktop so they cannot drift
(`src/components/Mobile/mobile-tools.ts:50-63`), and a layers drawer
(`src/components/Mobile/MobileLayersDrawer.tsx:134-320`). Canvas input goes
through Pointer Events with single-pointer capture, so drawing works on touch
(`src/hooks/usePointerPosition.ts:155-176`).

**Status:** `partial`

**Gap:** No pinch-zoom and no two-finger pan — inherited from the absence of zoom
and pan entirely, not a mobile-specific omission.

## Non-destructive editing

**Photoshop:** smart objects, adjustment layers, Smart Filters, Generative Fill,
Content-Aware Fill, Neural Filters.

**This app:** no smart objects — a placed layer imports as a raster with an
explicit warning (`src/contexts/psd-utils.ts:109`), and there is no `LayerSource`
arm for one. No adjustment layers. No generative, content-aware or neural code in
`src/`. The Pen family and Custom Shape are unimplemented placeholders
(`src/tools/toolProcessors.ts:343-375`), so there are no path layers either.

**What it does have** is a genuine, if narrow, non-destructive mechanism: a
per-layer retained operation stack — `FilterLayerOperation | AffineLayerOperation`
(`src/contexts/layer-types.ts:31-46`) — re-rendered as a CSS `ctx.filter` string on
every draw (`getLayerFilter` at `src/contexts/layer-renderer.ts:32`, assigned at
`:99`). A layer can be re-blurred, re-levelled or re-coloured without rasterising.

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
