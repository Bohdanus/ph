# Crop tool behavior requirements

This is the acceptance contract for the Crop tool. Adobe documentation is the source of truth
for Photoshop behavior. Requirements marked **App contract** are explicit product requirements
for this clone; they are not claims about undocumented Photoshop behavior.

## Photoshop behavior established by Adobe

- The current desktop Crop photos page (last updated Feb 23, 2026) says the Crop tool displays an
  adjustable boundary, edge and corner handles resize it, dragging inside moves the crop box, and
  Enter/Return or Done applies it. Adobe's 2024 Crop tool page and its 2020 tutorial instead say an
  inside drag repositions the image. Adobe's Crop tool options page exposes **Use Classic Mode** as
  the legacy behavior, but the pages do not explicitly reconcile those gesture descriptions. This
  contract follows the current desktop page for inside-drag behavior; do not treat the older wording
  as a claim about the current default. [Current Crop photos](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-photos.html),
  [2024 Crop tool page](https://helpx.adobe.com/photoshop/using/tool-techniques/crop-tool.html),
  [2020 tutorial](https://helpx.adobe.com/ro/photoshop/how-to/image-resizing-basics.html),
  [Crop tool options](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html)
- **Delete Cropped Pixels** controls whether applying a crop permanently removes the outside
  areas. With it off, Photoshop preserves hidden areas and can recover them with **Image > Reveal
  All** or by extending the Crop tool beyond the image edge. This option is unavailable for a
  Background-only document. [Crop tool options](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html),
  [Non-destructive editing techniques](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/create-layer-compositions/non-destructive-editing-techniques.html)
- With **Delete Cropped Pixels unchecked**, Adobe's tutorial demonstrates applying a crop, doing
  other work, then selecting Crop and clicking the image; the cropped-away pixels return to view so
  the crop can be changed. The same tutorial describes the Rule of Thirds overlay. [Crop and resize
  images](https://helpx.adobe.com/ro/photoshop/how-to/image-resizing-basics.html)
- **Show Cropped Area** and **Crop Shield** are visual options: Adobe describes shaded cropped-out
  areas and a configurable color overlay outside the crop. They do not define whether pixels are
  retained; that is controlled by Delete Cropped Pixels. [Crop tool options](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html)
- Adobe's current Photoshop keyboard shortcut reference labels **Crop tool + Enter or Esc** as
  “Accept cropping or exit cropping.” It does not further define the meaning of “exit”; the app's
  cancel semantics are pinned separately in the contract below. [Photoshop keyboard shortcuts
  (PDF)](https://helpx.adobe.com/content/dam/help/en/photoshop/using/default-keyboard-shortcuts/photoshop-keyboard-shortcuts.pdf)

The pixel-retention behavior is conditional in Photoshop. Do not describe hidden-pixel recovery as
unconditional Photoshop behavior when Delete Cropped Pixels is enabled.

## App contract

The app has no Delete Cropped Pixels toggle or Reveal All command. Its crop commits a document-frame
change while retaining layer source pixels in the live document model, so it implements the
non-destructive case as its default behavior.

- For the **axis-aligned crop flow covered by this task**, after applying a crop, making other edits,
  and selecting Crop again, retained source content outside the current document frame must appear
  immediately under the crop's dim overlay. Photoshop's tutorial adds a click on the image after
  selecting Crop; the app contract deliberately reveals it on selection. The preview must be
  composed from the original layer sources rather than a flattened crop result. A large preview may
  be downsampled for display; the layer sources remain the authority for crop commits.
- Resizing an edge or corner or moving the crop box changes only the pending crop bounds. It must
  not translate, scale, or otherwise move the layer pixels, the canvas contents, or the workspace
  view.
- The selected crop's border, handles, and 3×3 Rule of Thirds grid must stay aligned with the same
  resized bounds during the drag and after release. The grid geometry and pixels, plus the crop
  outline pixels, must repaint within two animation frames after a pointer update. Re-entering Crop
  uses the same rendering path and visual treatment as the first selection.
- Applying the crop changes the document frame without resampling the layer pixels or changing the
  current apparent workspace zoom, within the app's existing effective zoom range of 10%–1600%. If
  preserving apparent scale would cross a zoom limit, the limit takes precedence. It must not
  automatically fit the document to the screen. This is an app contract; the Adobe pages above do
  not specify post-apply viewport zoom behavior.
- In the axis-aligned flow, widening the crop back to earlier source bounds and applying it must
  recover the unchanged original pixels exactly, provided the requested frame is within the app's
  crop commit limit. Pixels beyond all retained source bounds remain transparent, per
  [OVR-1](OVERRIDES.md).
- Pressing Escape with a pending crop cancels it without changing the document frame, layer pixels,
  or history, and leaves the Crop tool able to make and apply a later crop.
- Crop chrome must follow pointer updates promptly. The retained-pixel preview's backing allocation
  stays fixed while the pending rectangle is resized; the full layer stack is not recomposed for
  every pointer movement.

The current live retained-pixel overlay is only implemented for zero-angle crops. Rotated crop
commits have separate pixel/history coverage, but a rotated crop's re-entry preview is not covered
by this task and must not be described as verified Photoshop parity.

## Current implementation limits

- Crop commits are capped at 4096 pixels per side and 16,777,216 frame pixels for canvas memory
  safety. This is an app limit, not Photoshop behavior.
- The axis-aligned retained preview can span a union larger than one crop frame. Its backing store
  is reduced as needed, with each side capped at 4096 backing pixels and five renderer surfaces
  sharing a 16,777,216-pixel budget; the five include the visible masked preview. This only reduces
  the on-screen preview resolution; it does not resample layer sources or committed crop pixels. The
  scale is kept high enough to produce at least one backing pixel on each side, even when the device
  pixel ratio is lower than that minimum. Retained unions with an aspect ratio above 8192:1 cannot
  produce a non-zero preview backing store and are outside the live-preview guarantee.

The recovery guarantee applies while the live document retains the source layer data. Do not infer
save/reopen or flattened-export guarantees from this in-memory crop contract; those require their
own persistence tests.

## Regression evidence

`e2e/crop-history.spec.ts` owns the browser-level proof for the zero-angle flow. Its re-entry test
checks retained pixels under the dim overlay, attaches screenshots, then widens the crop and
byte-compares the recovered raster. Its resize and move test checks the resized 3×3 guide, border
and handles in screenshots, verifies that the preview backing allocation stays fixed, confirms
the crop geometry after pointer release, and byte-compares the document pixels plus workspace
canvas bounds while resizing and moving the crop box. The zoomed-canvas recrop test covers frame
alignment at a non-unit view zoom.
