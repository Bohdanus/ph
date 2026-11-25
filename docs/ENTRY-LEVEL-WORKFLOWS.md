# Entry-level workflows

These scenarios span a first useful session through early layer editing for new and returning
Photoshop users. They stay inside behavior the app currently implements and map each promise to
browser-level evidence. They are product requirements for the supported workflow, not claims of
full Photoshop parity.

## 1. Make a simple title card

**User goal:** Create a basic promotional graphic with a colored accent and a headline, keep a
layered working copy, and export a shareable image.

**Starting point:** A fresh app session with the untouched starter document open. It is clean, so
**File > New** opens directly without a discard confirmation. In the New Image dialog, enter **800**
for Width and **600** for Height, choose the background color and opacity, then click **OK**.
The blank document created through **File > New** is marked unsaved immediately, before the first
edit; the app-created starter document stays clean until you edit it. Save the new document when you
are ready to keep a working copy.

**Steps:**

1. Select Draw, choose a foreground color, and drag one accent stroke; the app creates a paint layer
   for the committed stroke.
2. Select Text, drag a text box, replace the placeholder with a short headline, and click **Commit**.
3. Open **File > Save**, choose **Photoshop (PSD)** in the format menu, name the working copy, and
   save it.
4. Open **File > Save** again, choose **PNG**, and save a copy for sharing.

**Acceptance:** The new document has the requested dimensions; the layer panel contains the
background, paint, and text layers; the PSD retains all three as raster layers; the PNG decodes at
800 × 600 and contains visible artwork. The text is not editable Type after PSD export.

**E2E:** `Beginner poster: create a custom canvas, add a headline, and export PSD and PNG` in
[`photoshop-junior-workflow.spec.ts`](../e2e/photoshop-junior-workflow.spec.ts). The longer workflow
in the same spec covers layer visibility, opacity, blend modes, a destructive Desaturate adjustment,
and PSD/JPEG/PNG exports. `document-dialogs.spec.ts`, `text-tool.spec.ts`, and `text-edit.spec.ts`
continue to own the detailed behavior of their individual controls.

## 2. Recover from a paint mistake

**User goal:** Remove an unwanted stroke, confirm the canvas returned to its prior appearance, and
redo it if needed.

**Steps:** Paint a stroke, use Undo once, then Redo once.

**Acceptance:** Undo removes the committed stroke; Redo restores the same pixels and layer state.

**E2E:** `undo takes the stroke off the canvas and redo puts the same pixels back` in
[`undo-redo.spec.ts`](../e2e/undo-redo.spec.ts). This behavior is covered directly; a combined
poster-and-recovery journey is a future integration test.

## 3. Crop and share an existing image

**User goal:** Reframe an imported picture, remove one small distraction, compare the retouch with
the previous version, and export the result.

**Starting point:** Start a fresh app session with the untouched starter document open. Choose
**File > Open** and select the photo; the starter is clean, so the file opens without a discard
confirmation.

**Steps:** Select Crop, adjust the frame, and commit. In the Layers panel, click **Layer from
Background** to make the imported image editable; this keeps its pixels. Select Spot Healing and
brush over a small distraction. Use Undo and Redo to compare the retouched and unretouched cropped
image. Save the result through **File > Save** and choose PNG.

**Acceptance:** The committed crop changes the document dimensions; **Layer from Background** keeps
the cropped pixels while making the image editable; Spot Healing changes the image; Undo restores
the exact cropped image and Redo restores the exact retouched image; the exported PNG has the cropped
dimensions and matches the visible canvas within the PNG pixel oracle.

**E2E:** `Beginner crop: import an image, crop it, undo and redo, then export PNG` in
[`photoshop-junior-workflow.spec.ts`](../e2e/photoshop-junior-workflow.spec.ts) imports the synthetic
red/blue fixture and checks crop frame history and representative export pixels.
`photoshop-photo-workflow.spec.ts` imports an attributed CC0 photograph and checks a crop, Spot
Healing edit, exact Undo/Redo pixels, and PNG dimensions and pixels. `crop-history.spec.ts` and
`file-roundtrip.spec.ts` continue to cover narrower cases.

## 4. Build and refine a layered illustration (entry-to-mid-level)

**User goal:** Separate a simple illustration into paint layers, compare it with and without a
layer, then tune the color and shadow layers before saving a working PSD.

**Steps:** Create a custom canvas through **File > New**. The new blank document is marked unsaved
immediately, so save a working copy when you are ready. Select Draw and paint a background and a few
foreground elements; each committed stroke gets its own layer. Use the eye button in the Layers
panel to hide and restore a layer, open the selected layer's opacity control to change its opacity,
and choose **Color** or **Multiply** from its blend mode menu for a tint and a shadow. Export a PSD
working copy and a PNG or JPEG through **File > Save**.

**Acceptance:** Visibility, opacity, and blend mode changes affect the composite; the PSD retains
the supported raster layers and their visibility, opacity, and blend modes; the exported image
matches the visible result. PSD export does not preserve editable text, groups, masks, or effects.
The app does not have layer masks or non-destructive adjustment layers, so keep edits on separate
paint layers.

**E2E:** `Complete workflow: new document, draw, layers, adjustments, export PSD and JPEG`,
`Workflow isolates content by toggling layer visibility`, and
`Workflow combines layer opacity and blend mode controls` in
[`photoshop-junior-workflow.spec.ts`](../e2e/photoshop-junior-workflow.spec.ts).

## 5. Paint inside a selection

**User goal:** Add color to one part of an image while protecting the surrounding pixels.

**Starting point:** Open a document with the Brush or Pencil tool available and an unlocked paint
layer selected. If the only layer is a locked Background, choose **New Layer** in Layers before
painting.

**Steps:** On the left tool rail, select **Rectangular Marquee Tool** (named **Rectangular
Selection** in the Tools menu) and keep **Style** set to **Normal**. Select an area, then choose
**Brush Tool** or **Pencil Tool** on the same rail and drag a stroke across the selection boundary.
Use the **Undo** and **Redo** buttons in the top toolbar to remove and restore the stroke. For a
soft-edge variation, choose **Polygonal Lasso**, leave its **Mode** at **Outline**, set **Feather**
above **0 px** in the right tool-options panel, click to add the polygon corners, and press Enter to
finish the selection. To check history after deselection, select **Rectangular Marquee Tool** and
click **Deselect** in its right panel for a rectangle; for a polygon, select **Lasso Tool** (named
**Freehand Lasso** in the Tools menu) and click **Deselect** in that tool's right panel. Then click
**Undo** once to restore the selection, **Undo** again to remove the paint, **Redo** to restore the
clipped paint, and **Redo** again to deselect.

**Acceptance:** The active selection remains visible after switching tools. The stroke preview and
committed pixels use matching selection coverage, including feathered edges. A stroke fully outside
the selection leaves pixels and history unchanged. With the selection active, Undo removes the
stroke without removing the selection and Redo restores the stroke. If the selection is cleared
first, Undo restores it before the stroke is undone; Redo reapplies the same clipped pixels before
the selection is cleared again.

**E2E:** `brush paints only inside the active selection and remains undoable` and
`pencil paints only inside the active selection and remains undoable`, both
`does not add history for a stroke outside the selection` cases, and
both `skips a diagonal stroke that misses a selection inside its bounds` cases,
`selection paint preview and commit stay clipped while zoomed in`,
`the selection rasterizer keeps selected pixels at the active backing scale`, and
`feathered selection edges keep matching preview and committed paint coverage` in
[`selection-paint.spec.ts`](../e2e/selection-paint.spec.ts).

Adobe's guides provide broader context: the [Selection tools overview](https://helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/selection-tools-overview.html)
and [Brush or Pencil painting guide](https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/paint-with-brush-or-pencil-tool.html).
This workflow and its tests cover Brush/Pencil painting through an existing selection.

## Deliberate scope boundary

Do not direct beginners into a workflow that depends on layer masks, non-destructive adjustment
layers, Select and Mask, an edge-following Object Selection tool, AI background removal, or Pen
paths. These capabilities are absent or explicitly incomplete in the current app. The live status
is recorded in [`FEATURES.md`](FEATURES.md), [`TOOLS-TOO-HARD.md`](TOOLS-TOO-HARD.md),
[`LAYERS-PANEL.md`](LAYERS-PANEL.md), and the generated per-tool inventory [`TOOLS.md`](TOOLS.md).

The title-card E2E uses an app-created document and synthetic artwork. The real-photo E2E covers one
CC0 landscape, one crop, one Spot Healing stroke, history, and PNG export. It does not establish
general photo-retouching quality, broad PSD interoperability, or Photoshop feature parity. PSD
round-trip support is limited to the documented raster-layer features.
