# Crop tool behavior requirements

This is the acceptance contract for the Crop tool. Adobe documentation is the source of truth
for Photoshop behavior. Requirements marked **App contract** are explicit product requirements
for this clone; they are not claims about undocumented Photoshop behavior.

## Photoshop behavior established by Adobe

- The Crop tool displays an adjustable boundary. Dragging an edge or corner handle resizes the
  crop area; dragging inside moves the crop box. Enter/Return or Done applies the pending crop.
  [Crop photos](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-photos.html)
- **Delete Cropped Pixels** controls whether applying a crop permanently removes the outside
  areas. With it off, Photoshop preserves hidden areas and can recover them with **Image > Reveal
  All** or by extending the Crop tool beyond the image edge. This option is unavailable for a
  Background-only document. [Crop tool options](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html),
  [Non-destructive editing techniques](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/create-layer-compositions/non-destructive-editing-techniques.html)
- With **Delete Cropped Pixels unchecked**, Adobe's crop tutorial explicitly demonstrates
  reselecting Crop after other work: the cropped-away pixels return to view so the crop can be
  changed. Its Rule of Thirds overlay uses horizontal and vertical guides at thirds. [Crop and
  resize images](https://helpx.adobe.com/ro/photoshop/how-to/image-resizing-basics.html)
- **Show Cropped Area** and **Crop Shield** are visual options: Adobe describes shaded cropped-out
  areas and a configurable color overlay outside the crop. They do not define whether pixels are
  retained; that is controlled by Delete Cropped Pixels. [Crop tool options](https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html)

The pixel-retention behavior is conditional in Photoshop. Do not describe hidden-pixel recovery as
unconditional Photoshop behavior when Delete Cropped Pixels is enabled.

## App contract

The app has no Delete Cropped Pixels toggle or Reveal All command. Its crop commits a document-frame
change while retaining layer source pixels in the live document model, so it implements the
non-destructive case as its default behavior.

- For the **axis-aligned crop flow covered by this task**, after applying a crop, making other edits,
  and selecting Crop again, all retained source pixels outside the current document frame must be
  visible under the crop's dim overlay. The preview must include the original pixels rather than a
  flattened crop result.
- Resizing an edge or corner or moving the crop box changes only the pending crop bounds. It must
  not translate, scale, or otherwise move the layer pixels, the canvas contents, or the workspace
  view.
- The selected crop's border, handles, and 3×3 Rule of Thirds grid must stay aligned with the same
  resized bounds during the drag and after release. Re-entering Crop uses the same rendering path
  and visual treatment as the first selection.
- Applying the crop changes the document frame without resampling the layer pixels or changing the
  current apparent workspace zoom. It must not automatically fit the document to the screen. This
  is an app contract; the Adobe pages above do not specify post-apply viewport zoom behavior.
- In the axis-aligned flow, widening the crop back to the earlier source bounds and applying it
  must recover the unchanged original pixels exactly. Pixels beyond all retained source bounds
  remain transparent, per [OVR-1](OVERRIDES.md).
- Crop chrome must follow pointer updates promptly. The retained-pixel preview's backing allocation
  stays fixed while the pending rectangle is resized; the full layer stack is not recomposed for
  every pointer movement.

The current live retained-pixel overlay is only implemented for zero-angle crops. Rotated crop
commits have separate pixel/history coverage, but a rotated crop's re-entry preview is not covered
by this task and must not be described as verified Photoshop parity.

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
