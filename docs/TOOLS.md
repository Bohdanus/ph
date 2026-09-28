# Tools

Every tool in this editor, described against Adobe Photoshop.

<!-- GENERATED FILE - DO NOT EDIT. Source: src/tools/descriptions/*.ts -->
<!-- Regenerate with `npm run docs:tools`; a test fails if this file is stale. -->

The prose below is generated from `src/tools/descriptions/`, which is the single source of
truth. Each tool carries what Photoshop does with it, what this editor does with it, and the
option controls Photoshop puts in its options bar with each one’s status here — `present`,
`partial`, `inert` (declared in the settings but rendered by no component) or `missing`.
Every Photoshop claim is sourced; the per-family notes files carry the long-form research and
the list of what could not be verified.

The toolbar tooltip shows the one-line summary and, for a tool this editor does not fully
implement, a status line.

## Selection

Long-form research, provenance and unverified claims: [`src/tools/descriptions/selection.notes.md`](../src/tools/descriptions/selection.notes.md).

### Rectangular Marquee Tool

`rectangular-selection` · **M**

Drag a rectangular selection; Shift makes it a square, Alt grows it outward from the press point.

The Rectangular Marquee tool makes the simplest selection in Photoshop: drag corner to corner and the area inside the animated border is selected. It is the tool for pixel-exact rectangular work — a swatch, a rectangular adjustment region, a crop of flat geometry — and every other selection tool is a variation on it. Its options bar carries the four selection combination modes, a Feather radius, and a Style dropdown that can lock the drag to a fixed ratio or a fixed size. Because a selection is a pixel channel, the combination modes and the feather are properties of the selection itself, not of the shape you drew.

**Options bar**

| Control                                       | Photoshop                                                                                                                                                                                                                                                                                                                                                                               | In this app |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| New / Add To / Subtract From / Intersect With | Four buttons that set how the next drag combines with the selection already on the canvas: replace it, union with it, subtract it, or keep only the overlap. They are options-bar state rather than a separate object, and Shift, Alt/Option and Shift+Alt/Option held during the drag set the same four modes.                                                                         | `missing`   |
| Feather                                       | Softens the border over a radius in pixels, default 0, and must be set before the selection is made. The scripting API takes the same value as 0 to 1000 pixels on this tool, and exposes an antiAlias flag defaulting to true for the same call even though the marquee bar does not show an Anti-alias box.                                                                           | `missing`   |
| Style                                         | Normal, Fixed Ratio or Fixed Size. Normal takes its proportions from the drag; Fixed Ratio locks the drag to a height-to-width ratio entered as two decimal fields; Fixed Size ignores the drag and takes its height and width from two pixel fields. In Normal the numeric fields are greyed out.                                                                                      | `missing`   |
| Width and Height                              | The two fields behind Fixed Ratio and Fixed Size. Fixed Ratio accepts decimals and is a pair, not a single ratio number, so a 2:1 box is entered as 2 in one field and 1 in the other. Fixed Size takes whole pixels, and both styles accept document units such as inches or centimetres alongside pixels.                                                                             | `missing`   |
| Select and Mask                               | A button on the options bar of every selection tool that opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush for soft edges such as hair, a plain Brush for manual touch-ups, and Radius, Smooth, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document. | `missing`   |

**Modifiers**

- **Shift** — Constrains the drag to a square. The mouse button must be released before Shift, or the constraint is lost.
- **Alt** — Draws the marquee outward from the press point instead of between two corners.
- **Shift+Alt** — Constrains to a square drawn outward from the center.

**Shortcuts**

- `M` — Selects the marquee tools; repeated presses cycle between the rectangular and the elliptical marquee.

**In this app:** `partial` — The tool draws, commits and copies a rectangle, and its options bar renders only a static sentence plus Copy, Paste and Clear. It declares no settings of its own at all, so all five Photoshop controls in the table above are absent rather than inert. The Shift square constraint is not read during the drag: useRect reads Shift, Ctrl and Cmd in exactly one place — `src/hooks/useRect.ts:97` — and that is when a handle of an already-committed rectangle is being resized, where it locks the aspect ratio to the current one rather than constraining to 1:1. The `M` key and Shift+M reach this tool and cycle the two marquees, and the app carries no single-row or single-column marquee, so the group behind that key holds the two tools the app actually ships and not the four Adobe documents. Nothing here can feather an existing selection, inverse it, or grow it: there is no Select-menu surface anywhere in the application.

Implementation:

- `src/tools/rectangularSelection.ts:4`
- `src/tools/settings.ts:124`
- `src/components/ToolbarsRight/RectangularSelection/RectangularSelection.tsx:32`
- `src/hooks/useRect.ts:97`
- `toolbar-mapping.ts:41`

Sources:

- <https://helpx.adobe.com/photoshop/using/selecting-marquee-tools.html>
- <https://helpx.adobe.com/photoshop/using/tool-techniques/rectangular-marquee-tool.html>
- <https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html>
- <https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/define-feathered-edges.html>
- <https://developer.adobe.com/photoshop/uxp/2022/ps_reference/classes/selection/>

---

### Elliptical Marquee Tool

`elliptical-selection`

Drag an elliptical selection; Shift makes a circle, Alt draws from the center, Style locks ratio or size.

The Elliptical Marquee tool is the Rectangular Marquee with one addition: an Anti-alias checkbox, which is the only marquee tool that offers it, because a curved edge is the only one that visibly stair-steps. Drag corner to corner for an ellipse, hold Shift for a circle, hold Alt for one that grows from its center. It shares the Rectangular Marquee’s Style dropdown, so a circle of a fixed diameter or an ellipse of a fixed ratio can be stamped with a single click. This description is of Photoshop 2023 through 2026; the control set has not changed in that window.

**Options bar**

| Control                                       | Photoshop                                                                                                                                                                                                                                                                                                                                                                               | In this app                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| New / Add To / Subtract From / Intersect With | Four buttons that set how the next drag combines with the selection already on the canvas. They are options-bar state, and Shift, Alt/Option and Shift+Alt/Option held during the drag set the same four modes.                                                                                                                                                                         | `missing`                                                                                  |
| Feather                                       | Softens the border over a radius in pixels, default 0, and must be set before the selection is made.                                                                                                                                                                                                                                                                                    | `missing`                                                                                  |
| Anti-alias                                    | On by default. Smooths the stair-stepped edge of a curve with intermediate coverage values. The scripting API exposes an antiAlias flag defaulting to true on the same call that takes the feather, so the default is the documented one even on a tool whose bar hides the box.                                                                                                        | `missing`                                                                                  |
| Style                                         | Normal, Fixed Ratio or Fixed Size. Normal takes its proportions from the drag; Fixed Ratio locks the drag to a height-to-width ratio; Fixed Size ignores the drag entirely and takes its height and width from two pixel fields, so a single click is a complete gesture.                                                                                                               | `partial` — `src/components/ToolbarsRight/EllipticalSelection/EllipticalSelection.tsx:96`  |
| Width and Height                              | The two fields behind Fixed Ratio and Fixed Size. Fixed Ratio is a pair of decimal fields, so a box twice as wide as it is high is entered as 2 and 1; Fixed Size takes whole pixels. Both accept document units such as inches or centimetres alongside pixels.                                                                                                                        | `partial` — `src/components/ToolbarsRight/EllipticalSelection/EllipticalSelection.tsx:130` |
| Select and Mask                               | A button on the options bar of every selection tool that opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush for soft edges such as hair, a plain Brush for manual touch-ups, and Radius, Smooth, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document. | `missing`                                                                                  |

**Modifiers**

- **Shift** — Constrains the drag to a circle.
- **Alt** — Draws the marquee outward from the press point instead of between two corners.
- **Shift+Alt** — Constrains to a circle drawn outward from the center.

**Shortcuts**

- `M` — Selects the marquee tools; repeated presses cycle between the rectangular and the elliptical marquee.

**In this app:** `partial` — The tool is the most complete of the selection family and the only one whose options bar has any Photoshop control on it, but the Style it renders is not Photoshop’s Style in two ways. Fixed Ratio is a single Ratio field rather than Photoshop’s pair of decimal Width and Height fields, so the app cannot express a ratio the way Photoshop states one and its slider floor is 0.05, not a pair of 1s. Fixed Size renders plain pixel number inputs, so the document-unit entry Photoshop accepts cannot be typed. The three geometry behaviours that matter are correct and shared with the pure helpers: Shift is read as constrainToCircle, Alt as fromCentre, and the committed polygon is a sagitta-bounded inscribed ring rather than a true ellipse. The ellipse commits under a borrowed source-tool identifier because the selection union in the app’s own types has no elliptical member, which is why the committed ellipse carries no draggable anchor handles.

Implementation:

- `src/tools/ellipticalSelection.ts:155`
- `src/tools/ellipticalSelection.ts:51`
- `src/tools/settings.ts:207`
- `src/components/ToolbarsRight/EllipticalSelection/EllipticalSelection.tsx:94`
- `src/components/Main/EllipticalSelectionToolArea.tsx:172`
- `toolbar-mapping.ts:42`

Sources:

- <https://helpx.adobe.com/photoshop/using/tool-techniques/elliptical-marquee-tool.html>
- <https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html>
- <https://helpx.adobe.com/photoshop/using/selecting-marquee-tools.html>
- <https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/define-feathered-edges.html>
- <https://developer.adobe.com/photoshop/uxp/2022/ps_reference/classes/selection/>

---

### Lasso Tool

`freehand-lasso` · **L**

Drag a freehand selection border that goes exactly where the cursor goes and closes itself on release.

The Lasso tool draws a selection border by following the pointer with no correction of any kind: wherever you drag is where the selection is. That makes it the right tool for cleaning up an edge another tool got roughly right, and the wrong one for a first attempt at a precise boundary. Releasing the mouse closes the border, and Photoshop bridges a small gap between the end point and the start point rather than leaving the region open. It produces a selection only, never a reusable path; converting a selection into a path is a separate command, and the path direction is the other way round.

**Options bar**

| Control                                       | Photoshop                                                                                                                                                                                                                                                                                                                                                                               | In this app |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| New / Add To / Subtract From / Intersect With | Four buttons that set how the next drag combines with the selection already on the canvas. They are options-bar state, and Shift, Alt/Option and Shift+Alt/Option held during the drag set the same four modes.                                                                                                                                                                         | `missing`   |
| Feather                                       | Softens the border over a radius in pixels, default 0, and must be set before the selection is made. This is the same control the marquee tools carry, and the same feather that Select > Modify > Feather applies afterwards.                                                                                                                                                          | `missing`   |
| Anti-alias                                    | On by default, and documented as selected by default on this tool. Smooths the jagged edge a freehand trace leaves behind.                                                                                                                                                                                                                                                              | `missing`   |
| Select and Mask                               | A button on the options bar of every selection tool that opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush for soft edges such as hair, a plain Brush for manual touch-ups, and Radius, Smooth, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document. | `missing`   |

**Modifiers**

- **Shift** — Sets the drag to Add to Selection for the duration of the gesture.
- **Alt** — Sets the drag to Subtract From Selection.
- **Alt** — Held after the drag has started, converts the trailing segment to a straight edge between the two points; releasing the mouse while it is held leaves the border open.
- **Shift+Alt** — Sets the drag to Intersect With Selection.
- **Space** — Temporarily switches to the Hand tool so the image can be panned mid-trace.

**Shortcuts**

- `L` — Selects the lasso tools; repeated presses cycle between the freehand, polygonal and magnetic variants.
- `Return` — Selects the tool and moves focus to the Feather field in the options bar, so a feather can be typed before the next trace.
- `Delete` — Erases recently drawn straight segments during a trace.

**In this app:** `partial` — The tool traces a closed loop and commits it, and its bar renders Copy, Paste and Clear beside a single toggle. That toggle is the app’s own control and has no Photoshop counterpart: it is labelled Mode in the bar but switches between Outline and Fill, which changes how the committed border is painted rather than how a new gesture combines with the existing selection. The app therefore has no Photoshop control on this bar at all, and no combination modes. The LassoToolArgs type carries alpha, lineWidth, color and fill, none of which Photoshop puts on this tool’s bar. None of the modifiers above is read: the freehand lasso is drawn by the same PolygonClickToolArea as the polygonal one, and neither that component nor anything else on the lasso path consults a modifier key, so the Shift/Alt/Shift+Alt rows describe Photoshop only. The Return row is not bound either — the app registers Escape, Enter, Backspace and Delete on this tool’s own gesture and nothing else (`src/components/Main/PolygonClickToolArea.tsx:914`), so the focus-the-Feather-field binding and the mid-trace Space-to-Hand binding above are Photoshop bindings with no counterpart here, while the Delete row is bound to the same registration that pops the last point of the trace.

Implementation:

- `src/tools/polygonSelection.ts:3`
- `src/tools/settings.ts:99`
- `src/components/ToolbarsRight/Lasso/FreehandLasso.tsx:46`
- `toolbar-mapping.ts:45`

Sources:

- <https://helpx.adobe.com/photoshop/using/selecting-lasso-tools.html>
- <https://helpx.adobe.com/photoshop/using/tool-techniques/lasso-tool.html>
- <https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html>
- <https://helpx.adobe.com/photoshop/web/edit-images/make-selections/create-selections-with-lasso-tool.html>
- <https://www.adobe.com/products/photoshop/lasso-tool.html>

---

### Polygonal Lasso Tool

`polygonal-lasso`

Click to lay straight-edged anchors around a shape, then click the first anchor, double-click, or press Enter to close.

The Polygonal Lasso tool draws a selection border out of straight segments, which is the right tool for anything with corners: a building edge, a piece of type, a flat geometric shape. You do not hold the mouse button down; you click to add a corner anchor, move, and click again. Closing the border is explicit and has four ways in: click the starting anchor, Ctrl-click on Windows or Command-click on Mac OS, double-click, or press Enter or Return, the last of which closes with a segment the tool finds rather than a straight one. Clicking the mouse down and dragging instead of clicking lays a curved segment, and holding Alt/Option while dragging draws a freehand segment between two clicked points. This description is of Photoshop 2023 through 2026.

**Options bar**

| Control                                       | Photoshop                                                                                                                                                                                                                                                                                                                                                                               | In this app |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| New / Add To / Subtract From / Intersect With | Four buttons that set how the next set of anchors combines with the selection already on the canvas. They are options-bar state, and Shift, Alt/Option and Shift+Alt/Option held during the gesture set the same four modes.                                                                                                                                                            | `missing`   |
| Feather                                       | Softens the border over a radius in pixels, default 0, and must be set before the selection is made.                                                                                                                                                                                                                                                                                    | `missing`   |
| Anti-alias                                    | On by default, and documented as selected by default on the lasso tools. Has no visible effect on straight segments, and smooths the freehand segments Alt-drag can insert.                                                                                                                                                                                                             | `missing`   |
| Select and Mask                               | A button on the options bar of every selection tool that opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush for soft edges such as hair, a plain Brush for manual touch-ups, and Radius, Smooth, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document. | `missing`   |

**Modifiers**

- **Alt** — Held while dragging, draws a freehand segment between the last anchor and the next one; releasing Alt and the mouse button returns the tool to straight segments.
- **Alt** — Double-clicking while Alt is held closes the border with a straight segment rather than a magnetic one.
- **Shift** — Draws a straight line at a multiple of 45°, held as you move to select the next segment.
- **Shift** — Sets the gesture to Add to Selection.
- **Alt** — Set as the combination mode, sets the gesture to Subtract From Selection.
- **Shift+Alt** — Sets the gesture to Intersect With Selection.

**Shortcuts**

- `L` — Selects the lasso tools; repeated presses cycle between the freehand, polygonal and magnetic variants.
- `Return` — Closes the border with a segment the tool finds, or moves focus to the Feather field when no border is open.
- `Delete` — Erases the most recently drawn straight segments, one at a time.

**In this app:** `partial` — The click-to-add-anchor gesture, the double-click close, the right-click close, the Enter close, the Delete anchor removal and the Escape abort are all implemented, which makes this the most faithful of the seven. Its options bar, however, is the thinnest component in the family: forty lines rendering one app-invented Outline/Fill toggle and a hint sentence, and — unlike the freehand and magnetic lasso bars beside it — no Copy, Paste or Clear buttons. It shares LassoToolArgs with the freehand lasso, so none of the four Photoshop controls in the table above has a field to live in. None of the modifiers above is read either. The component that draws this tool (`src/components/Main/PolygonClickToolArea.tsx`, which serves the freehand lasso too) consults no modifier key at all, so every one of those rows — the 45° constraint, the Alt-drag freehand segment, the Alt-double-click straight close, and the three combination modes — describes Photoshop and is not implemented here. Of the shortcuts above, `Enter` and `Delete` are bound on this tool’s own gesture (`src/components/Main/PolygonClickToolArea.tsx:922` and `:944`); `Enter` is the key the app registers for the close that the table above calls Return, while the row’s second half, focus moving to a Feather field when no border is open, is not bound, because this bar has no Feather field to focus. Feathering is where the app is narrowest: no selection tool’s bar carries a Feather field except the magnetic lasso’s, re-making a selection with this tool applies no feather of any kind, and with no `Select > Modify > Feather` and no Refine Edge a committed border can never be softened after the fact. The magnetic lasso is the family’s only feathered path, and even there the value is written into the selection’s metadata at commit and read back when the selection is copied (`src/util/selection.ts:728`), so it softens the copied mask and not the selection the ants are drawn from.

Implementation:

- `src/tools/polygonSelection.ts:3`
- `src/tools/settings.ts:91`
- `src/components/ToolbarsRight/Lasso/PolygonalLasso.tsx:16`
- `src/components/Main/PolygonClickToolArea.tsx:915`
- `toolbar-mapping.ts:46`

Sources:

- <https://helpx.adobe.com/photoshop/using/selecting-lasso-tools.html>
- <https://helpx.adobe.com/photoshop/using/tool-techniques/polygonal-lasso-tool.html>
- <https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html>
- <https://www.photoshopessentials.com/basics/selections/polygonal-lasso-tool>
- <https://helpx.adobe.com/photoshop/web/edit-images/make-selections/create-selections-with-lasso-tool.html>

---

### Magnetic Lasso Tool

`feather-magnetic-lasso` · **Shift+L**

Click a starting point and the border snaps to the strongest image edge within Width as you move the pointer.

The Magnetic Lasso tool is an edge detector you drive by hand. You click once to set a fastening point, then move the pointer along the object and the live segment snaps to the strongest edge it can find within the detection Width, laying down extra fastening points at the Frequency interval to anchor what it has already traced. A click adds a manual fastening point where the automatic ones guessed wrong, and closing on the start point finishes the loop. It is the fastest way to select a well-defined object against a high-contrast background, and it is unavailable on 32-bits-per-channel images. This description is of Photoshop 2023 through 2026.

**Options bar**

| Control                                       | Photoshop                                                                                                                                                                                                                                                                                                                                                                               | In this app                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| New / Add To / Subtract From / Intersect With | Four buttons that set how the next trace combines with the selection already on the canvas. They are options-bar state, and Shift, Alt/Option and Shift+Alt/Option held during the trace set the same four modes.                                                                                                                                                                       | `missing`                                                                     |
| Feather                                       | Softens the border over a radius in pixels, default 0, and must be set before the selection is made.                                                                                                                                                                                                                                                                                    | `partial` — `src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:252` |
| Anti-alias                                    | On by default. Smooths the traced edge with intermediate coverage values where it is copied out.                                                                                                                                                                                                                                                                                        | `present` — `src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:331` |
| Width                                         | The detection width in pixels, entered as a value rather than chosen from a list. The tool detects edges only within that distance of the pointer, and Caps Lock swaps the pointer for a circle of exactly that size. The left and right bracket keys change it by one pixel while the tool is tracing.                                                                                 | `present` — `src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:265` |
| Contrast                                      | The lasso’s sensitivity to edges, entered as a percentage from 1% to 100%. A higher value detects only edges that contrast sharply with their surroundings; a lower value detects lower-contrast edges. The comma and period keys change it while the tool is tracing.                                                                                                                  | `partial` — `src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:278` |
| Frequency                                     | The rate at which the lasso sets fastening points, from 0 to 100. Adobe states it as "A higher value anchors the selection border in place more quickly"; that a higher value also lays fastening points down more densely is the third-party reading this description’s inversion finding rests on, not Adobe’s wording.                                                               | `partial` — `src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:291` |
| Stylus Pressure                               | A checkbox that narrows the detection width as stylus pressure increases, so the tool is more precise where you press harder. Shown only when a tablet is in use.                                                                                                                                                                                                                       | `missing`                                                                     |
| Select and Mask                               | A button on the options bar of every selection tool that opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush for soft edges such as hair, a plain Brush for manual touch-ups, and Radius, Smooth, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document. | `missing`                                                                     |

**Modifiers**

- **Alt** — Draws a freehand segment instead of a snapping one; released, the tool resumes snapping.
- **Alt** — Double-clicking while Alt is held closes the border with a straight segment rather than a magnetic one.
- **Shift** — Sets the trace to Add to Selection.
- **Alt** — Set as the combination mode, sets the trace to Subtract From Selection.
- **Shift+Alt** — Sets the trace to Intersect With Selection.

**Shortcuts**

- `L` — Selects the lasso tools; repeated presses cycle between the freehand, polygonal and magnetic variants.
- `Caps Lock` — Replaces the pointer with a circle the width of the detection area, while the tool is selected but not in use.
- `[` — Decreases the detection Width by one pixel while tracing; with Shift, drops it to the minimum.
- `]` — Increases the detection Width by one pixel while tracing; with Shift, raises it to the maximum.
- `,` — Decreases Contrast while tracing; with Shift, drops it to the minimum.
- `.` — Increases Contrast while tracing; with Shift, raises it to the maximum.
- `Return` — Closes the border, or moves focus to the Feather field when no border is open.
- `Delete` — Removes the most recent fastening point.

**In this app:** `partial` — The magnetic machinery is real: Width, Contrast and Snap feed a gradient-snapping edge detector, Frequency gates automatic fastening points, Smooth simplifies the traced path, and Feather and Anti-alias reach the copied alpha mask through the selection’s metadata. Three things diverge. Frequency is inverted — the app stores it as a maximum path length in pixels and its own help text says lower values add more anchors, where Photoshop’s 0–100 rate is documented as "A higher value anchors the selection border in place more quickly" and, on the third-party reading that a higher value also lays fastening points down more densely, means the opposite thing to the app. Contrast allows 0% where Photoshop’s documented range starts at 1%. And Feather means the same thing here as on the marquee tools but is capped at 100 pixels, applies to the copied mask rather than to the selection, and has no Select > Modify > Feather behind it. Three of the app’s controls have no Photoshop counterpart at all: Snap, which the toolbar’s own help text describes as cursor pull toward a detected edge, Smooth, and the Preview feather outline. Alt is the one modifier this tool actually reads, and only as `magneticEnabled: !event.altKey` (`src/components/Main/FeatherMagneticLassoToolArea.tsx:449`), so the freehand-segment row above is real and the Alt-double-click straight close, the Add/Subtract/Intersect rows and the Shift key are not read anywhere. Of the shortcuts above, the bracket and comma/period keys, `Caps Lock` and the feather-focus half of `Return` are not bound in the app — the global table in `src/components/Common/AppKeyboardShortcuts.tsx` holds the complete set, and none of them is in it — while `Enter` and `Delete` are bound on this tool’s own gesture (`src/components/Main/FeatherMagneticLassoToolArea.tsx:542` and `:564`). The app’s toolbar badge for this tool reads Shift+L, which is the app’s own binding for one item in a flyout rather than a Photoshop shortcut — in Photoshop all three lasso tools share L and are cycled by repeated presses.

Implementation:

- `src/tools/featherMagneticLasso.ts:4`
- `src/tools/settings.ts:107`
- `src/components/ToolbarsRight/Lasso/FeatherMagneticLasso.tsx:223`
- `src/components/Main/FeatherMagneticLassoToolArea.tsx:183`
- `src/components/Main/FeatherMagneticLassoToolArea.tsx:467`
- `src/util/selection.ts:728`
- `toolbar-mapping.ts:47`

Sources:

- <https://helpx.adobe.com/photoshop/using/selecting-lasso-tools.html>
- <https://helpx.adobe.com/photoshop/using/tool-techniques/magnetic-lasso-tool.html>
- <https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html>
- <https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/define-feathered-edges.html>
- <https://www.photoshopessentials.com/basics/selections/magnetic-lasso-tool>
- <https://www.lifewire.com/magnetic-lasso-tool-in-adobe-photoshop-4077747>
- <http://www.jkost.com/pdf/photoshop/cs3/PSTips&Tech.pdf>

---

### Magic Wand Tool

`magic-wand` · **W**

Click a color to select every pixel within Tolerance of it — only the adjacent ones, or the whole image if Contiguous is off.

The Magic Wand tool selects by color and tone rather than by shape: one click takes every pixel whose value falls within Tolerance of the pixel you clicked. With Contiguous on, that flood is limited to the connected region around the click; with it off, the same color range is taken everywhere in the image, which is how a sky repeated in a reflection is caught in one click. It is at its best on large flat areas such as a plain background, and it is widely reported as unavailable on Bitmap and 32-bits-per-channel images — an exclusion Adobe states for the Magnetic Lasso, not for this tool. Each click within one tool session adds to or subtracts from the selection, so the same tolerance can be dialled in and re-clicked until the region is right. It shares its keyboard key and its Tools-panel flyout with the Quick Selection tool, and the two are the two ways to take the same contiguous region: the Wand takes it by color similarity from a single click, the Quick Selection takes it by following an image edge with a brush, which is why the Wand is better on a flat area and the brush is better on a soft one. This description is of Photoshop 2025 through 2026.

**Options bar**

| Control                                       | Photoshop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | In this app                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| New / Add To / Subtract From / Intersect With | Four buttons that set how the next click combines with the selection already on the canvas. Holding Shift/Option or Alt/Option while clicking sets the same modes for that click.                                                                                                                                                                                                                                                                                                                             | `missing`                                                             |
| Sample Size                                   | Sets how much of the image is sampled to influence selection sensitivity — point sample, or a 3 by 3 or 5 by 5 neighbourhood of the clicked pixel. A wider sample averages out noise in the sampled color at the cost of picking up more of its surroundings.                                                                                                                                                                                                                                                 | `missing`                                                             |
| Tolerance                                     | The range of selected color values, from 0 (narrow, exact match only) to 255 (broad). Adobe states the range and no default; the 32 default is a third-party claim, and one of the pages carrying it is Adobe’s Photoshop Elements documentation, which is a different product. A low value selects colors very similar to the pixel you click; a higher value selects a broader range either side of it.                                                                                                     | `partial` — `src/components/ToolbarsRight/MagicWand/MagicWand.tsx:54` |
| Anti-alias                                    | On by default, per the third-party and Elements pages that state it — Adobe’s current page describes the effect without naming a default. Smooths the stair-stepped edge a pixel-accurate selection leaves behind.                                                                                                                                                                                                                                                                                            | `missing`                                                             |
| Contiguous                                    | On by default, on the same third-party and Elements authority rather than an Adobe desktop sentence. When selected, only adjacent areas of similar color are taken; when deselected, every pixel using the same colors is selected throughout the entire image.                                                                                                                                                                                                                                               | `missing`                                                             |
| Sample All Layers                             | Reported off by default, which is a CS5-era third-party claim and not an Adobe sentence. When selected, colors are sampled from all the visible layers; when deselected, only the active layer is sampled.                                                                                                                                                                                                                                                                                                    | `missing`                                                             |
| Select and Mask                               | A button on the options bar of every selection tool that opens the Select and Mask workspace, where the result is refined with a Refine Edge Brush for soft edges such as hair, a plain Brush for manual touch-ups, and Radius, Smooth, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document. The Wand's own page ends by naming it: "Select Select and Mask to further refine or preview the selection as a mask." | `missing`                                                             |

**Modifiers**

- **Shift** — Clicking with Shift held adds the clicked region to the current selection for that click.
- **Alt** — Clicking with Alt held subtracts the clicked region from the current selection for that click.
- **Shift+Alt** — Clicking with both held keeps only the overlap between the clicked region and the current selection.

**Shortcuts**

- `W` — Selects the quick selection and Magic Wand tools; repeated presses cycle between them.

**In this app:** `partial` — The click, the flood and the commit all work, and the options bar reports the live selected-pixel count, which Photoshop’s bar does not. None of the modifiers above is read: the component that draws this tool (`src/components/Main/MagicWandToolArea.tsx`) takes the click position, `tolerance` and `smoothing` and consults no modifier key, so the Shift-adds, Alt-subtracts and Shift+Alt-intersects rows describe Photoshop and have no implementation here. And only Tolerance corresponds to a Photoshop control, and it is a different control: a 0–100 slider defaulting to 28 where Photoshop runs 0–255 from 32, so the app cannot reach the top two thirds of Photoshop’s color range and its default is not Photoshop’s. The bar’s second slider, Smooth, has no Photoshop counterpart and is not anti-aliasing — it simplifies the traced boundary polygon, so raising it rounds off the staircase rather than blending it. Contiguous is not merely absent from the bar: the selection util carries the flag and takes the contiguous branch unless it is explicitly false, and the tool area never passes it, so the behaviour is permanently on and cannot be reached. Sample All Layers is absent and effectively always on, because the tool always samples the merged document canvas rather than the active layer. The two follow-ups that make the wand usable in a real workflow, Refine Edge and Select Similar, do not exist in the app at all.

Implementation:

- `src/tools/magicWand.ts:3`
- `src/tools/settings.ts:119`
- `src/components/ToolbarsRight/MagicWand/MagicWand.tsx:52`
- `src/components/Main/MagicWandToolArea.tsx:55`
- `src/util/magicWand.ts:31`
- `toolbar-mapping.ts:52`

Sources:

- <https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/select-areas-by-color-with-the-magic-wand-tool.html>
- <https://helpx.adobe.com/photoshop/using/tool-techniques/magic-wand-tool.html>
- <https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html>
- <https://helpx.adobe.com/ph_fil/photoshop/how-to/select-by-color-magic-wand.html>
- <https://helpx.adobe.com/ca/photoshop-elements/using/making-selections.html>
- <https://www.photoshopessentials.com/basics/selections/magic-wand-tool>
- <https://www.adobe.com/products/photoshop/refine-edge.html>

---

### Quick Selection Tool

`quick-selection`

Brush over an object and the selection grows along the image edges you cross; brush again to add, Alt-drag to subtract.

The Quick Selection tool is a brush that paints a selection. You drag over the object and the region grows outward from under the cursor, comparing color, tone and texture, and stops where it finds a defined edge in the image. That is the whole difference from the Magic Wand, which also takes a contiguous region but does it with a single click and no edge following: the Wand selects by color similarity, the Quick Selection selects by following an edge with a brush. Because the brush is the mechanism, its diameter is the accuracy control — the smaller it is, the less the tool is allowed to reason about at once and the tighter the result, which is why a soft edge wants a small brush. Adobe describes it as selecting "based on similar tones and image edges", so it is edge following with a color prior rather than a pure boundary tracer. It carries only three selection modes rather than four — New, Add to and Subtract from, with no Intersect — and it switches itself to Add to Selection after the first stroke so that brushing is cumulative by default. This description is of Photoshop 2025 through 2026.

**Options bar**

| Control                      | Photoshop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | In this app                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Tool presets                 | The preset picker every Photoshop tool carries, for saving and recalling this tool's whole option-bar state. It is the leftmost item on the bar.                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `missing`                                                                        |
| New / Add to / Subtract from | Three buttons, and three only. Every other selection tool carries four — New, Add to, Subtract from and Intersect with — but this one stops at Subtract from, so there is no way to intersect a quick selection with an existing one. The tool switches itself to Add to Selection after the first stroke, and holding Alt/Option while brushing temporarily selects Subtract from Selection.                                                                                                                                                                                                        | `partial` — `src/components/ToolbarsRight/QuickSelection/QuickSelection.tsx:138` |
| Size                         | The brush diameter, taken from the brush preset picker that also carries Hardness, Spacing, Angle and Roundness. The brush is the whole mechanism: the region grows outward from under the cursor and stops where the image edge is, so the brush diameter sets how much of the image the tool is allowed to reason about, and a smaller brush gives a more accurate result — which is why it is the control a user reaches for at a soft edge. Photoshop exposes size and hardness directly in the options bar and lets the left and right bracket keys resize the cursor while the tool is active. | `partial` — `src/components/ToolbarsRight/QuickSelection/QuickSelection.tsx:104` |
| Select and Mask              | Opens the Select and Mask workspace, where the quick selection is refined: a Refine Edge Brush for soft edges such as hair or fur, a plain Brush to add and remove by hand, and Radius, Smart Radius, Smooth, Feather, Contrast, Shift Edge and Decontaminate Colors in the Properties panel, then output as a selection, a layer mask, a new layer or a new document. This tool’s own page ends by naming it: "Select Select and Mask to refine the selection further."                                                                                                                             | `missing`                                                                        |
| Sample All Layers            | When selected, the selection is made from all the visible layers instead of only the currently selected layer, so a subject on one layer can be selected against a background on another.                                                                                                                                                                                                                                                                                                                                                                                                            | `missing`                                                                        |
| Auto-Enhance                 | Named Enhance Edge in the 2025 documentation and Auto-Enhance in Adobe's 2022 tutorial, which is where the older label appears. It reduces the roughness and blockiness the raw edge detection leaves, flows the selection further toward the image edges, and applies part of the edge refinement that Select and Mask does by hand — at the cost of the tool taking noticeably longer to run.                                                                                                                                                                                                      | `missing`                                                                        |

**Modifiers**

- **Alt** — Brushing with Alt held subtracts from the selection for the duration of the stroke; releasing it returns the tool to Add to Selection.
- **Alt** — Held while dragging horizontally, changes the brush size — the same gesture Photoshop binds on every brush tool.

**Shortcuts**

- `W` — Selects the quick selection and Magic Wand tools; repeated presses cycle between them.
- `[` — Decreases the brush size; with Shift, drops it to the minimum.
- `]` — Increases the brush size; with Shift, raises it to the maximum.

**In this app:** `partial` — The stroke, the re-seeding along the path and the marching-ants preview are all implemented, and the arc-length re-seeding is a better answer than one seed per pointer event. Neither modifier above is read: the component that draws this tool (`src/components/Main/QuickSelectionToolArea.tsx`) grows the region from the pointer position, the brush size and the mode and consults no modifier key, so neither Alt-subtracts nor the Alt-drag size gesture exists here. That last one is worth reading as a defect the bar advertises: its own hint text promises the user "Shift and Alt drag on the canvas" (`src/components/ToolbarsRight/QuickSelection/QuickSelection.tsx:99`), and neither half of that sentence is honoured, so the bar makes a promise on screen that the gesture does not keep. The `[` and `]` rows are Photoshop's Photoshop-wide brush keys and are not bound either — the global table in `src/components/Common/AppKeyboardShortcuts.tsx` is the app's complete set and holds no bracket, so the brush size can only be changed from the bar's own slider. The region grow underneath, though, is not an edge detector: each seed hands the seed pixel to the same flood fill the Magic Wand uses, with Contiguous forced on, so a stroke selects a color range around every dab rather than following the image edge the way Photoshop's does. That is why the bar carries a Tolerance slider at all — Photoshop's Quick Selection has no such control, and the two are the same mechanism under different names. The mode dropdown offers only Add and Subtract, so there is no way to start a fresh selection and no Intersect, and Sample All Layers, Select and Mask, Auto-Enhance and the tool-preset picker are all absent — Sample All Layers because the stroke reads the merged composite canvas, and the rest because there is no implementation. The committed selection also has no route into Quick Mask mode, which is how Photoshop converts a selection into an editable mask: paint the tool's result, and there is no route from a selection to a layer mask at all, the only mask the app can produce being the bitmap its Copy button renders. The region is committed as a single traced contour, so a grown region with an enclosed hole is refused rather than committed, and the committed selection carries no brush hardness, spacing, angle or roundness and no live size and opacity keys. On the keyboard, the app badges the Magic Wand with W — the same key Photoshop binds, on the same flyout, because the two tools share it — and the Quick Selection tile carries no badge of its own.

Implementation:

- `src/tools/quickSelection.ts:8`
- `src/tools/quickSelection.ts:144`
- `src/tools/quickSelection.ts:79`
- `src/tools/settings.ts:214`
- `src/components/ToolbarsRight/QuickSelection/QuickSelection.tsx:102`
- `src/components/Main/QuickSelectionToolArea.tsx:123`
- `toolbar-mapping.ts:53`

Sources:

- <https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/paint-a-selection-with-quick-selection-tool.html>
- <https://helpx.adobe.com/photoshop/using/tool-techniques/quick-selection-tool.html>
- <https://helpx.adobe.com/ph_fil/photoshop/how-to/use-quick-selection-tool.html>
- <https://www.adobe.com/learn/photoshop/web/selection-tools-basics>
- <https://helpx.adobe.com/photoshop/web/edit-images/make-selections/automate-selections-with-quick-selection-tool.html>
- <https://asktimgrey.com/2021/04/07/controlling-the-quick-selection-tool>
- <https://helpx.adobe.com/ph_fil/photoshop/how-to/make-precise-selections-in-select-mask.html>
- <https://helpx.adobe.com/photoshop/using/create-temporary-quick-mask.html>
- <https://helpx.adobe.com/photoshop/desktop/make-selections/refine-modify-selections/refine-your-selection-and-mask.html>
- <https://helpx.adobe.com/photoshop/desktop/make-selections/get-started-selections/selection-tools-overview.html>
- <https://www.photoshopessentials.com/basics/selections/quick-selection-tool>
- <https://cod.pressbooks.pub/photoshopmastery1250/chapter/selections>

---

## Painting and erasing

Long-form research, provenance and unverified claims: [`src/tools/descriptions/paint.notes.md`](../src/tools/descriptions/paint.notes.md).

### Brush Tool

`brush` · **B**

Paints the foreground color onto the layer in strokes: Opacity caps a single stroke, Flow builds it up, and the tip is stamped at Spacing intervals.

The Brush is Photoshop’s general painting tool. Click and drag to lay down a stroke of the foreground color on the active layer. The options bar carries the tip, the blend Mode, Opacity, Flow, Airbrush and stroke Smoothing; the Brush panel behind it carries the tip’s Spacing, shape dynamics, scattering and texture. Opacity is a per-stroke ceiling — a stroke never exceeds the set level however many times the pointer crosses the same pixels, and a new stroke re-applies it. Flow is the per-dab build-up inside that ceiling, so one slow pass with low Flow is lighter than the same pass at 100%, and a low Flow with a low Spacing builds up faster where dabs overlap.

**Options bar**

| Control                         | Photoshop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | In this app                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Brush Preset Picker             | The tip thumbnail and the chevron beside it. Clicking it opens a popout from which the tip’s Size and Hardness can be changed temporarily, plus an Angle/Roundness drag widget, a settings gear, a New Preset button and a grid of tip thumbnails. There is no separate top-bar Hardness control in current Photoshop; Hardness lives here and in the Brush Settings panel. The Tool Preset Picker is a separate control at the far left of the bar — see its own row — so the settings-snapshot picker this app renders is not standing in for it. | `partial` — `src/components/ToolbarsRight/Paint/Paint.tsx:123` |
| Tool Preset Picker              | A dropdown at the far left of the options bar, beside the tool icon, that saves and recalls a whole options-bar state for the active tool. Adobe’s own current documentation places it explicitly: "You can also select the Tool Presets dropdown menu next to the tool at the upper-left of the Options bar", with a Create New Tool Preset icon on it. It is also the only per-tool reset on the bar, offering Reset Tool and Reset All Tools — which is what makes it the escape hatch from per-tool stickiness.                                 | `missing`                                                      |
| Size                            | The tip diameter in pixels, 1 to 5000.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `partial` — `src/components/ToolbarsRight/Paint/Paint.tsx:105` |
| Mode                            | The blend mode the stroke composites with, offering the 27 layer blend modes plus Dissolve, Behind and Clear. Default Normal.                                                                                                                                                                                                                                                                                                                                                                                                                       | `partial` — `src/components/ToolbarsRight/Paint/Paint.tsx:117` |
| Opacity                         | A label with a numeric field, scrubbable by dragging the label, 0 to 100 percent. Default 100. A hard ceiling for one stroke, not a per-dab rate. The app seeds its Brush at 90 percent, not Photoshop’s 100.                                                                                                                                                                                                                                                                                                                                       | `present` — `src/components/ToolbarsRight/Paint/Paint.tsx:109` |
| Flow                            | A label with a numeric field, scrubbable by dragging the label, 0 to 100 percent. Default 100. The per-dab build-up rate inside the Opacity ceiling.                                                                                                                                                                                                                                                                                                                                                                                                | `missing`                                                      |
| Airbrush                        | A toggle that keeps stamping while the pointer is stationary, so a stroke that stops still darkens up to Opacity. With it on, the number keys drive Flow and Shift with them drives Opacity, the reverse of the normal binding.                                                                                                                                                                                                                                                                                                                     | `missing`                                                      |
| Always Use Pressure for Opacity | A toggle that forces stylus pressure to drive opacity regardless of the numeric field and of the tip’s own Transfer settings.                                                                                                                                                                                                                                                                                                                                                                                                                       | `missing`                                                      |
| Always Use Pressure for Size    | A toggle that forces stylus pressure to drive tip size regardless of the tip’s Shape Dynamics. On by default for the Hard Round class of presets and off for most others.                                                                                                                                                                                                                                                                                                                                                                           | `missing`                                                      |
| Smoothing                       | A numeric field, 0 to 100 percent, beside a gear. Default 10. The amount of stroke smoothing, and the only control on the bar the Pencil and the Eraser share with the Brush. The gear beside it opens Smoothing Options.                                                                                                                                                                                                                                                                                                                           | `partial` — `src/util/draw.ts:96`                              |
| Smoothing Options               | The gear beside Smoothing. Four independent checkboxes — Pulled String Mode, Stroke Catch-up, Catch-up on Stroke End and Adjust for Zoom — with defaults Stroke Catch-up on, Adjust for Zoom on, and the other two off. Checking Pulled String Mode greys out the two catch-up modes.                                                                                                                                                                                                                                                               | `missing`                                                      |
| Symmetry                        | A butterfly button. Offers Vertical, Horizontal, Dual Axis, Diagonal, Wavy, Circle, Spiral, Parallel Lines, Radial (2 to 12 segments) and Mandala (3 to 10 segments), so every dab is mirrored live. Present for the Brush, the Pencil and the Eraser only.                                                                                                                                                                                                                                                                                         | `missing`                                                      |
| Toggle the Brush Settings panel | The button at the far right of the bar. Opens the Brush Settings panel, where Brush Tip Shape, Shape Dynamics, Scattering, Texture, Dual Brush, Color Dynamics, Transfer, Brush Pose, Noise, Wet Edges, Airbrush, Smoothing and Protect Texture live.                                                                                                                                                                                                                                                                                               | `missing`                                                      |

**Modifiers**

- **Alt** — Temporarily switches to the Eyedropper for the duration of the press, so a color can be sampled from the canvas without leaving the Brush.
- **Shift** — Constrains the stroke to a straight line: click once, then Shift-click a second point and the stroke is drawn between the two.

**Shortcuts**

- `B` — Selects the Brush Tool.
- `[` — Decreases the tip size.
- `]` — Increases the tip size.
- `0` — Sets Opacity to 100 percent while the Brush is active.
- `1` — Sets Opacity to 10 percent while the Brush is active.

**In this app:** `partial` — A real painting tool, and the closest of the seven: a drag paints the foreground colour, one mouse-up is one history state, and Opacity behaves as Photoshop’s per-stroke ceiling because the stroke is a single alpha-weighted pass over the whole path, though the bar seeds it at 90 percent where Photoshop’s is 100. The divergences are structural. There is no Flow and therefore no within-stroke build-up; there is no tip, so no Hardness, Spacing, angle, roundness, shape dynamics, scattering or texture; there is no Airbrush, no stylus pressure, no symmetry and no Brush Settings panel. Mode offers sixteen canvas compositing operations rather than Photoshop’s thirty-plus, and it is applied to the layer the stroke creates rather than to the stroke’s own pixels. Size is capped at 500 px, not 5000, because a stroke is rasterized into a canvas padded by the full tip width and committed as its own layer. Smoothing is real but a different algorithm: it pulls each sampled interior point toward the midpoint of its neighbours, whereas Photoshop’s is a trailing anchor over the raw input stream, so the app has no catch-up and no pulled-string slack. The largest divergence is not in the bar at all — a brush stroke is committed by creating a NEW layer rather than by painting the active one. One caveat on the bindings above: `B` is the app’s only one. `AppKeyboardShortcuts.tsx` is the complete global table and registers no bracket, no digit and no Alt or Shift override for any paint tool, so `[`, `]`, `0`, `1` and both modifiers above are Photoshop’s own and this app binds none of them — there is no Alt eyedropper swap and no Shift straight-line constraint on a stroke.

Implementation:

- `src/tools/toolProcessors.ts:255`
- `src/components/ToolbarsRight/Paint/Paint.tsx:136`
- `src/components/Main/DrawToolArea.tsx:143`
- `src/tools/brush.ts:101`
- `src/contexts/layer-utils.ts:146`
- `src/tools/settings.ts:125`
- `src/components/Common/AppKeyboardShortcuts.tsx:240`

Sources:

- <https://helpx.adobe.com/photoshop/using/painting-tools.html>
- <https://asktimgrey.com/2023/09/01/flow-versus-opacity-for-brushes>
- <https://photoshopcafe.com/use-flow-opacity-photoshop-brushes>
- <https://community.wacom.com/en-us/guide-to-photoshop-brushes-pt-1/>
- <https://flylib.com/books/en/4.462.1.114/1/>
- <https://asktimgrey.com/2017/03/21/pencil-brush-shape/>
- <https://web.archive.org/web/20201111235536/https:/helpx.adobe.com/photoshop/using/whats-new/2018.html>
- <https://helpx.adobe.com/photoshop/using/paint-symmetry.html>
- <https://www.tipsquirrel.com/5-awesome-icon-buttons-might-know-photoshop/>
- <https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/create-tool-preset.html>
- <http://www.jkost.com/pdf/photoshop/cs3/PSTips&Tech.pdf>
- <https://community.adobe.com/questions-712/changing-brush-size-shortcuts-ctrl-alt-second-click-and-drag-1167556>

---

### Pencil Tool

`pencil`

Paints hard-edged, non-antialiased foreground lines, with an Auto Erase option that paints background over foreground at the stroke’s start.

The Pencil is a Brush whose tip is always hard-edged, so its strokes never blend into the pixels underneath and never take a soft falloff however far the tip’s hardness is reduced. It is the tool for pixel-level work, icons and hard-edged graphics, and it shares the Brush’s slot in the Tools panel. Its one genuinely own control is Auto Erase, which is decided once when the drag begins: if the cursor is over the foreground color at that moment the stroke paints background color, and if it is over anything else the stroke paints foreground color. Crossing the other color mid-stroke does not switch modes.

**Options bar**

| Control                         | Photoshop                                                                                                                                                                                                                                                                                                                                                                                                                                  | In this app                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Brush Preset Picker             | The tip thumbnail and its chevron, opening a popout whose Size and Hardness change the tip temporarily, plus an Angle/Roundness widget, a settings gear, a New Preset button and a grid of tips. The Pencil offers hard-edged tips only, so its Hardness is fixed. The Tool Preset Picker is a separate control at the far left of the bar — see its own row — so the settings-snapshot picker this app renders is not standing in for it. | `partial` — `src/components/ToolbarsRight/Paint/Paint.tsx:123` |
| Size                            | The tip diameter in pixels, 1 to 5000.                                                                                                                                                                                                                                                                                                                                                                                                     | `partial` — `src/components/ToolbarsRight/Paint/Paint.tsx:105` |
| Mode                            | The blend mode the stroke composites with, offering the 27 layer blend modes plus Dissolve, Behind and Clear. Default Normal.                                                                                                                                                                                                                                                                                                              | `partial` — `src/components/ToolbarsRight/Paint/Paint.tsx:117` |
| Opacity                         | A label with a numeric field, scrubbable by dragging the label, 0 to 100 percent. Default 100. A hard ceiling for one stroke. The app seeds its Pencil at 90 percent, not Photoshop’s 100.                                                                                                                                                                                                                                                 | `present` — `src/components/ToolbarsRight/Paint/Paint.tsx:109` |
| Auto Erase                      | A checkbox, unique to the Pencil. Off by default. When on, a drag that begins over the foreground color erases to the background color, and a drag that begins over anything else paints the foreground color — decided at mouse-down, not per sample.                                                                                                                                                                                     | `missing`                                                      |
| Smoothing                       | A numeric field, 0 to 100 percent, beside a gear. Default 10. One of only four tools that carry it, with the Brush, the Mixer Brush and the Eraser.                                                                                                                                                                                                                                                                                        | `partial` — `src/util/draw.ts:96`                              |
| Smoothing Options               | The gear beside Smoothing: Pulled String Mode, Stroke Catch-up, Catch-up on Stroke End and Adjust for Zoom.                                                                                                                                                                                                                                                                                                                                | `missing`                                                      |
| Symmetry                        | A butterfly button offering Vertical, Horizontal, Dual Axis, Diagonal, Wavy, Circle, Spiral, Parallel Lines, Radial and Mandala. Present for the Brush, the Pencil and the Eraser only.                                                                                                                                                                                                                                                    | `missing`                                                      |
| Toggle the Brush Settings panel | The button at the far right of the bar, opening the Brush Settings panel.                                                                                                                                                                                                                                                                                                                                                                  | `missing`                                                      |

**Modifiers**

- **Alt** — Temporarily switches to the Eyedropper for the duration of the press.
- **Shift** — Constrains the stroke to a straight line from the last stroke point.

**Shortcuts**

- `N` — Selects the Pencil Tool.

**In this app:** `partial` — The app renders the Pencil through the same bar factory as the Brush, with its own three synthetic presets, and its stroke is one round-capped pass of the same painter. That reproduces the hard edge, so the two agree on the one property that distinguishes them, but it is a hard edge by construction rather than by a hard tip: a round cap is aliased because the canvas rasterizes it that way, and there is no tip model that could be made soft. The Pencil’s one own feature, Auto Erase, is absent entirely — there is no background color in the app’s tool state, so the checkbox has nothing to decide between, and no component renders it. Mode offers sixteen canvas operations and is applied to the layer the stroke creates, not to the stroke’s pixels; Size is capped at 500 px rather than 5000, and the shared bar seeds Opacity at 90 percent where Photoshop’s is 100. The `Alt` and `Shift` modifiers above are Photoshop’s own and the app binds neither: `AppKeyboardShortcuts.tsx` is the complete global table, it registers no Alt override and no Shift constraint for any paint tool, and `altKey` in a pointer handler is read only by the shape, the magnetic lasso, the elliptical selection and the clone stamp. The Pencil has no keyboard shortcut of its own here: it is reached by cycling the Brush tile with Shift+B, where Photoshop binds it to N. As with the Brush, each stroke creates a new layer rather than painting the active one.

Implementation:

- `src/tools/toolProcessors.ts:263`
- `src/components/ToolbarsRight/Paint/Paint.tsx:136`
- `src/components/Main/DrawToolArea.tsx:143`
- `src/tools/settings.ts:142`
- `src/components/Common/AppKeyboardShortcuts.tsx:18`

Sources:

- <https://helpx.adobe.com/photoshop/using/painting-tools.html>
- <https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/auto-erase-with-the-pencil-tool.html>
- <https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=337>
- <https://www.oreilly.com/library/view/photoshop-elements-8/9780596809188/ch12s04.html>
- <https://www.dummies.com/article/the-new-partial-sketch-photoshop-elements-feature-259266>
- <https://asktimgrey.com/2025/08/08/pencil-versus-brush/>
- <https://asktimgrey.com/2017/03/21/pencil-brush-shape/>
- <https://flylib.com/books/en/4.462.1.114/1/>
- <https://helpx.adobe.com/photoshop/using/paint-symmetry.html>

---

### Color Replacement Tool

`color-replacement`

Recolors the pixels it paints over with the foreground color while keeping their luminosity and texture, rather than covering them.

The Color Replacement Tool substitutes one color for another in a stroke, keeping the luminosity and the texture of what was underneath — Adobe describes its default options bar as maintaining a color’s luminosity and saturation while replacing its hue. It works by painting through a Hue/Saturation/Color/Luminosity blend mode rather than compositing on top, so the foreground color should be left in Color mode. Sampling decides which color is the target — resampled continuously under the cursor, locked to the first click, or taken from the background swatch — and Limits decides how far the replacement spreads from the cursor. It is not a selection tool: there are no marching ants, and unlike the Paint Bucket it replaces color as you drag rather than flooding a whole connected region in one click.

**Options bar**

| Control             | Photoshop                                                                                                                                                                                                                                                                                                               | In this app                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Tool Preset Picker  | The leftmost button on the bar, applying a whole saved options-bar state in one action.                                                                                                                                                                                                                                 | `missing`                                                               |
| Brush Preset Picker | The tip thumbnail and its chevron, opening a popout whose Size and Hardness change the tip temporarily, plus an Angle/Roundness widget, a settings gear, a New Preset button and a grid of tips.                                                                                                                        | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:13` |
| Size                | The tip diameter in pixels, 1 to 5000.                                                                                                                                                                                                                                                                                  | `missing`                                                               |
| Mode                | The blend mode that decides which component of the pixel is transferred. Hue, Saturation, Color and Luminosity are the ones that make the tool a replacement rather than a paint; Adobe says to keep it set to Color, and the default options bar does.                                                                 | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:13` |
| Opacity             | The strength of the replacement, 0 to 100 percent. Default 100.                                                                                                                                                                                                                                                         | `missing`                                                               |
| Sampling            | Three small icons. Continuous resamples the color under the crosshair as you drag; Once locks the color of the first click for the whole stroke; Background Swatch replaces only areas containing the current background color. Adobe does not state which is the default.                                              | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:13` |
| Limits              | A dropdown. Contiguous replaces colors contiguous with the pixel under the pointer; Discontiguous replaces the sampled color wherever it occurs under the pointer; Find Edges replaces connected areas containing the sampled color while preserving the sharpness of shape. Adobe does not state which is the default. | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:13` |
| Tolerance           | A slider, 0 to 255, entered as a percentage. A low value replaces only colors very similar to the pixel clicked; a higher value widens the range. Adobe does not document a default; a widely-cited third-party value is 30 percent.                                                                                    | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:13` |
| Anti-aliased        | A checkbox giving the deposited color anti-aliased edges. On by default.                                                                                                                                                                                                                                                | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:13` |

**In this app:** `partial` — Not a placeholder, and the bar is exactly what used to make it look like one. Its options bar IS a PlaceholderTool — six disabled chips naming Brush Preset Picker, Blend Mode, Sampling, Limits, Tolerance and Anti-alias render where the real controls belong, and none of them reads or writes anything — but the tool itself is routed into the same live gesture surface as the Brush, the Pencil and the Draw, and it has a `raster` commit and a real replayable processor, so a drag deposits a visible, undoable, replayable layer. That combination is why the verdict is `partial` and not `placeholder`: a placeholder options bar coexists here with a live gesture that paints the wrong pixels. Two of those chips do not even carry their own control’s name: the chip for `Mode` reads `Blend Mode`, and the chip for `Anti-aliased` reads `Anti-alias`, so those two rows are `inert` on a label that is nearly the control’s name rather than on an exact one. What the tool paints is a spray-can stroke with `source-over` compositing, and its color is not the foreground color: this bar is a PlaceholderTool with no `useCurrentTool`, so nothing here ever writes the store’s foreground into the tool’s args, and the stroke uses the `#000000` its args are seeded with. That is the opposite of the tool’s contract on three counts — it covers texture and luminosity where Photoshop preserves them, it replaces nothing at all, and the user has no way to change the color it lays down. Nothing in the tool’s state corresponds to any of the six chips either: there is no tolerance, no sampling mode, no limits mode and no anti-alias flag, and the app has no background color for Background Swatch to name. The `blendMode` field its args do carry seeds to Normal and is read only for a layer a paint tool creates, so the Color blend mode that makes this tool a replacement is unreachable. It also has no keyboard shortcut of its own: the app reaches it only by cycling the Brush tile with Shift+B, where Photoshop binds it separately.

Implementation:

- `src/tools/toolsMap.ts:116`
- `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:13`
- `src/tools/toolProcessors.ts:276`
- `src/tools/settings.ts:159`
- `src/tools/draw.ts:71`
- `src/components/ToolbarsRight/Paint/Paint.tsx:64`
- `src/components/Common/AppKeyboardShortcuts.tsx:18`

Sources:

- <https://www.photoshopessentials.com/photo-editing/photoshop-color-replacement-tool-tutorial>
- <https://adobe.manymanuals.com/software/photoshop-cs4/user-manual-35148/215>
- <https://helpx.adobe.com/photoshop/using/painting-tools.html>
- <https://www.photoshopessentials.com/photo-editing/color-replacement-tool/>
- <https://www.creativebloq.com/how-to/photoshop-colour-change>
- <https://design.tutsplus.com/tutorials/how-to-use-the-color-replacement-tool-in-photoshop--cms-39825>
- <https://flylib.com/books/en/4.462.1.114/1/>

---

### Eraser Tool

`eraser` · **E**

Removes pixels to transparency along a stroke, in Brush, Pencil or Block mode, with per-stroke Opacity, per-dab Flow and Erase to History.

The Eraser removes pixels under a dragged tip, writing transparency on a layer and the background color on a Background layer or one whose transparency is locked. Its Mode chooses the tip: Brush is a soft round tip with adjustable hardness, Pencil is hard-edged, and Block is a fixed-size square with no opacity control at all. Opacity is a per-stroke ceiling as on the Brush, while Flow is the per-dab rate that builds erasure up within that ceiling. Erase to History turns the same drag into a restore, painting the area back to whichever state or snapshot is set in the History panel.

**Options bar**

| Control             | Photoshop                                                                                                                                                                                                   | In this app                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Mode                | A dropdown of Brush, Pencil and Block. Brush erases with adjustable softness and opacity; Pencil erases with hard edges; Block erases in a fixed-size square shape with no opacity control.                 | `partial` — `src/components/ToolbarsRight/Eraser/Eraser.tsx:56` |
| Brush Preset Picker | The tip thumbnail and its chevron, opening a popout whose Size and Hardness change the tip temporarily, plus a settings gear and a grid of tips. Block mode uses a square and no preset.                    | `missing`                                                       |
| Size                | The tip diameter in pixels, 1 to 1000.                                                                                                                                                                      | `partial` — `src/components/ToolbarsRight/Eraser/Eraser.tsx:36` |
| Hardness            | A slider, 0 to 100 percent, in the Brush and Pencil modes. Pencil mode is fixed at 100. Block mode has no hardness.                                                                                         | `missing`                                                       |
| Opacity             | A label with a numeric field, 0 to 100 percent. Default 100. 100 erases pixels completely, lower erases partially. Not available in Block mode, and Adobe removes the control there rather than greying it. | `present` — `src/components/ToolbarsRight/Eraser/Eraser.tsx:43` |
| Flow                | A label with a numeric field, 0 to 100 percent. Default 100. How quickly the erasure is applied, so repeated passes over one area build up to the Opacity ceiling.                                          | `inert` — `src/components/ToolbarsRight/Eraser/Eraser.tsx:100`  |
| Airbrush            | A toggle that keeps erasing while the pointer is stationary, so a stopped stroke keeps cutting toward Opacity. Brush mode only.                                                                             | `missing`                                                       |
| Erase to History    | A checkbox. With a state or snapshot set in the History panel, a drag paints the area back to that state instead of erasing it. Holding Alt while dragging turns this mode on temporarily.                  | `missing`                                                       |
| Symmetry            | A butterfly button offering Vertical, Horizontal, Dual Axis, Diagonal, Wavy, Circle, Spiral, Parallel Lines, Radial and Mandala. Present for the Brush, the Pencil and the Eraser only.                     | `missing`                                                       |

**Modifiers**

- **Alt** — While dragging, temporarily switches the stroke to Erase to History, restoring the area to the state or snapshot set in the History panel.

**Shortcuts**

- `E` — Selects the Eraser Tool.

**In this app:** `partial` — The Eraser edits the active layer in place by subtracting alpha, which is the right model, and it produces exactly one history state per stroke because the commit is the pointer-up. Its Mode list is Photoshop-shaped but not Photoshop-capable: the `brush` option is rendered with Adobe’s real label and is `disabled` on the DOM node, because a soft tip needs a stamped-dab engine and this renderer issues one `stroke()` per stroke, which has no falloff — so a Brush eraser would silently render as Pencil. Hardness is absent for the same reason, and the app’s Pencil and Block modes are the hard edge and the square. Size is capped at 500 px rather than 1000. Opacity is present and works as Photoshop’s per-stroke ceiling, and the control is correctly withheld in Block mode. Flow is the notable finding: the bar renders Photoshop’s real `Flow` label at Photoshop’s 1–100 range and a hardcoded 100 percent value, but the input carries `disabled` and writes nothing, because Flow is a per-dab alpha ramp and a single `stroke()` cannot honour one. Airbrush and Erase to History are absent, and so is the Alt-drag temporary Erase to History gesture.

Implementation:

- `src/tools/toolsMap.ts:121`
- `src/tools/eraser.ts:39`
- `src/tools/eraser.ts:79`
- `src/components/Main/EraserToolArea.tsx:169`
- `src/components/ToolbarsRight/Eraser/Eraser.tsx:47`
- `src/tools/settings.ts:176`
- `src/components/Common/AppKeyboardShortcuts.tsx:355`

Sources:

- <https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/erase-parts-of-an-image-with-the-eraser-tool.html>
- <https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=335>
- <https://www.mediacollege.com/adobe/photoshop/tool/eraser.html>
- <https://www.underwaterphotography.com/photoshop/photoshop/1_12_3_1.html>
- <https://www.glensmith.co.uk/photoshop/eraser>
- <https://helpx.adobe.com/photoshop/using/paint-symmetry.html>
- <https://flylib.com/books/en/4.462.1.114/1/>

---

### Magic Eraser Tool

`magic-eraser`

Erases every pixel similar to the one you click, to transparency, in a single click, bounded by Tolerance, Anti-alias and Contiguous.

The Magic Eraser is the Paint Bucket run in reverse: one click erases every pixel whose color falls within Tolerance of the pixel clicked, rather than a dragged tip erasing a stroke. It works like the Magic Wand without the preview, which is its whole cost — there is no marching ants, so the region it will remove is visible only in the History panel afterwards. Tolerance sets how far a color may differ and still count, Contiguous limits the erase to the region connected to the click rather than every match in the layer, Anti-alias smooths the boundary, and Opacity sets how completely the matched pixels are cleared. On a layer whose transparency is locked the matched pixels change to the background color instead of becoming transparent; on a Background layer Photoshop converts it to a normal layer first and then clears the matched pixels to transparency.

**Options bar**

| Control           | Photoshop                                                                                                                                                                                                                          | In this app                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Tolerance         | A slider, 0 to 255. A low tolerance erases only pixels within a very narrow range of the clicked pixel; a high tolerance erases within a broader range. Adobe does not document a default; a widely-cited third-party value is 32. | `present` — `src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:34` |
| Anti-aliased      | A checkbox that smooths the edges of the erased area. On by default.                                                                                                                                                               | `inert` — `src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:80`   |
| Contiguous        | A checkbox. On (the default) erases only pixels contiguous to the one clicked; off erases every similar pixel in the layer.                                                                                                        | `present` — `src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:38` |
| Sample All Layers | A checkbox. On samples the erased colors from the merged data of all visible layers rather than from the active layer alone.                                                                                                       | `missing`                                                                 |
| Opacity           | A label with a numeric field, 0 to 100 percent. Default 100. 100 erases the selected pixels completely; lower erases partially, leaving some of the color visible.                                                                 | `present` — `src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:44` |

**In this app:** `partial` — A working flood-based eraser: one click, one atomic commit, a hard 0–255 tolerance on Adobe’s scale rather than the Magic Wand’s 0–100, a default of 32 that matches the value third parties report as Adobe’s own, 4-connected Contiguous as a real 4-neighbor scan, and an Opacity that scales the alpha removed per pixel so a partial erase is a partial erase. It shares its args type with the Paint Bucket and both run the same mask code, which is why Contiguous and Tolerance are genuinely wired for both. Anti-aliased is the finding: it renders with Photoshop’s real label and Photoshop’s real checked state, but the input carries `disabled` and the flood fill’s test is a hard threshold producing a boolean mask, so there is no coverage to anti-alias. Sample All Layers is absent, and the tool is structurally active-layer-only — `FillToolArea` reads the active layer’s own raster and refuses the Bedrock layer outright, so there is no merged data to sample. As in Photoshop there is no preview of the region about to be removed, and the tool has no keyboard shortcut of its own: the app’s fill shortcut group contains the Paint Bucket and the Gradient only.

Implementation:

- `src/tools/toolsMap.ts:122`
- `src/tools/fill.ts:163`
- `src/util/floodFill.ts:76`
- `src/components/Main/FillToolArea.tsx:91`
- `src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:48`
- `src/tools/settings.ts:184`

Sources:

- <https://helpx.adobe.com/photoshop/using/tool-techniques/magic-eraser-tool.html>
- <https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/change-similar-pixels-with-the-magic-eraser-tool.html>
- <https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=335>
- <https://www.glensmith.co.uk/photoshop/magic-eraser>
- <https://www.ephotozine.com/article/introduction-to-photoshop-s-magic-eraser-tool-18410>
- <https://www.photoshopforphotographers.com/CC_2013/Help_guide/tp/Magic_eraser.html>
- <https://www.teachucomp.com/the-magic-eraser-tool-in-photoshop-elements-instructions/>
- <https://community.adobe.com/questions-712/why-does-the-magic-eraser-tool-delete-everything-1055165>

---

### Paint Bucket Tool

`paint-bucket` · **G**

Fills the contiguous area of similar color you click with the foreground color or a pattern, in one click, at a chosen Mode and Opacity.

The Paint Bucket fills the whole connected region of similar color around the click in a single click. Tolerance decides how far a pixel’s color may differ from the clicked pixel and still be filled, Contiguous limits the fill to the region connected to the click rather than every match in the layer, Anti-alias smooths the boundary, and Fill chooses the foreground color or a pattern. Mode and Opacity composite the fill, so a fill is a real layer edit rather than a paste. It shares a Tools-panel slot with the Gradient tool. Unlike the Magic Eraser it fills rather than clears, and unlike the Color Replacement tool it floods a whole region from one click instead of recoloring as you drag.

**Options bar**

| Control      | Photoshop                                                                                                                                                                                          | In this app                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Fill         | A dropdown choosing Foreground or Pattern; choosing Pattern enables a second dropdown from which a pattern is picked. Default Foreground.                                                          | `partial` — `src/components/ToolbarsRight/MagicEraser/PaintBucket.tsx:51` |
| Mode         | The blend mode for the fill, offering the 27 layer blend modes plus Dissolve, Behind and Clear. Default Normal.                                                                                    | `missing`                                                                 |
| Opacity      | A label with a numeric field, 0 to 100 percent. Adobe states that lower values create more transparent fills. Default 100.                                                                         | `present` — `src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:44` |
| Tolerance    | A slider, 0 to 255. Lower values such as 10 to 20 fill only similar colors; values of 100 or more fill a broader range. Adobe does not document a default; a widely-cited third-party value is 32. | `present` — `src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:34` |
| Anti-aliased | A checkbox that smooths the edges of the filled area. On by default.                                                                                                                               | `inert` — `src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:80`   |
| Contiguous   | A checkbox. On (the default) fills only pixels contiguous to the click; off fills all similar pixels in the image.                                                                                 | `present` — `src/components/ToolbarsRight/MagicEraser/MagicEraser.tsx:38` |
| All Layers   | A checkbox. On fills based on the merged color data of all visible layers rather than the active layer alone, which is what lets the bucket fill an empty layer from the artwork beneath it.       | `missing`                                                                 |

**Shortcuts**

- `G` — Selects the Paint Bucket Tool; with the Gradient Tool active, Shift+G cycles back to it.

**In this app:** `partial` — One click, one atomic commit on the active layer, with the foreground color read off the live store at the moment of the click rather than mirrored into the args, and the fill composited as a real source-over so a 50 percent fill over transparent pixels is half coverage of clean red rather than half-black — that is the one place where this implementation is more correct than a naive lerp. Tolerance, Contiguous and Opacity are genuinely wired and share the fill code with the Magic Eraser. Three controls diverge. Pattern renders `disabled` under the real `Fill` label: there is no pattern registry, no tile and no processor branch that could read one, so it is present in the DOM and inert rather than absent. Anti-aliased is the shared fill bar’s `disabled` checkbox, inert for the same hard-threshold reason as the Magic Eraser’s. Mode is absent outright and cannot be added cheaply: the tool’s args type declares no blend mode, and the fill is applied to the active layer’s pixels rather than to a new layer, so a blend mode would be a per-pixel composite against a destination the processor does not address. All Layers is absent, and the tool reads only the active layer’s raster. As in Photoshop the commit is the click, with no drag gesture and no multi-region sequence.

Implementation:

- `src/tools/toolsMap.ts:123`
- `src/tools/fill.ts:129`
- `src/tools/fill.ts:151`
- `src/components/Main/FillToolArea.tsx:154`
- `src/components/Main/FillToolArea.tsx:160`
- `src/components/ToolbarsRight/MagicEraser/PaintBucket.tsx:35`
- `src/tools/settings.ts:193`
- `src/components/Common/AppKeyboardShortcuts.tsx:314`

Sources:

- <https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/fill-paint-bucket-tool.html>
- <https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=359>
- <https://www.underwaterphotography.com/photoshop/photoshop/1_12_8_0.html>
- <https://www.mediacollege.com/adobe/photoshop/tool/paint-bucket.html>
- <https://www.glensmith.co.uk/photoshop/paint-bucket>
- <https://www.photoshopbuzz.com/how-to-use-paint-bucket-tool/>
- <https://shotkit.com/paint-bucket-photoshop/>

---

### Clone Stamp Tool

`clone-stamp` · **S**

Copies pixels from an Alt-clicked source point and paints them under the cursor, in Aligned or Independent mode, with a soft or hard tip.

The Clone Stamp copies pixels from one part of an image and paints them into another. Alt-click (Option-click on macOS) sets the source point; release the modifier and drag to lay the copy down. Aligned, which is the default, fixes the offset at the displacement of the first stroke after the Alt-click and holds it for every later stroke, so a pattern continues across a series of strokes; with it off, every stroke restarts from the original sampling point, which is what makes repeatedly stamping one patch of clean skin work. Sample chooses whether the source is read from the active layer alone, from the active layer and those below it, or from all visible layers, and Ignore Adjustment Layers keeps adjustment layers out of a merged sample. The tool is a copy rather than a paint, so it carries the source’s own color and alpha and needs no foreground color at all. A stroke that overlaps the area it is copying from can read back what it has just laid down, which is why the documented technique when the source is close to the target is to clone a little, release, and start again.

**Options bar**

| Control                         | Photoshop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | In this app                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Brush Preset Picker             | The tip thumbnail and its chevron, opening a popout whose Size and Hardness change the tip temporarily, plus a settings gear and a grid of tips. Current Photoshop has no separate top-bar Size or Hardness for this tool — both live here and in the Brush Settings panel — so in this app the two sliders it renders directly on the bar are the app’s own addition. The Tool Preset Picker is a separate control at the far left of the bar, beside the tool icon, with a Create New Tool Preset icon on it; Adobe’s own current documentation places it explicitly: "You can also select the Tool Presets dropdown menu next to the tool at the upper-left of the Options bar." | `missing`                                                                |
| Mode                            | The blend mode the copied pixels composite with, offering the 27 layer blend modes plus Dissolve, Behind and Clear. Default Normal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `missing`                                                                |
| Opacity                         | A label with a numeric field, 0 to 100 percent. Default 100. The strength of each stamped copy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `present` — `src/components/ToolbarsRight/CloneStamp/CloneStamp.tsx:110` |
| Flow                            | A label with a numeric field, 0 to 100 percent. Default 100. The per-dab build-up rate, identical in meaning to the Brush tool’s, so repeated passes over one area build the copy up toward Opacity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `missing`                                                                |
| Always Use Pressure for Opacity | A toggle forcing stylus pressure to drive the opacity of each stamped copy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `missing`                                                                |
| Aligned                         | A checkbox, on by default. On, the source and destination stay locked together and the offset is the displacement of the first stroke after the Alt-click, held until the next Alt-click. Off, every stroke restarts from the original sampling point, so the sampling position is fixed and only the destination moves.                                                                                                                                                                                                                                                                                                                                                            | `partial` — `src/tools/cloneStamp.ts:89`                                 |
| Sample                          | A dropdown. Current Layer samples only the active layer; Current & Below samples the active layer and the visible layers beneath it; All Layers samples from all visible layers. Default Current Layer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `missing`                                                                |
| Ignore Adjustment Layers        | An icon immediately to the right of the Sample menu, off by default. On, it samples from all visible layers except adjustment layers, so a retouch is not baked with the color of whatever adjustment happens to sit above it.                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `missing`                                                                |
| Always Use Pressure for Size    | A toggle forcing stylus pressure to drive the tip size.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `missing`                                                                |
| Toggle the Clone Source panel   | The button at the far right of the bar. Opens the Clone Source panel, which holds up to five sampling sources, each with its own flip, rotate, scale and opacity, plus a Show Overlay checkbox that draws the sampled source live under the brush.                                                                                                                                                                                                                                                                                                                                                                                                                                  | `missing`                                                                |

**Modifiers**

- **Alt** — Click, at pointer-down, to set the clone source point. The decision is made at pointer-down, so a drag that began as a plain press keeps cloning even if the modifier is released mid-stroke, and a press that began with the modifier down never starts a stroke.

**Shortcuts**

- `S` — Selects the Clone Stamp Tool.

**In this app:** `partial` — The most nearly complete of the seven, and the only one whose Alt gesture is implemented. Alt-click sets the source at pointer-down and paints nothing; the source and the stroke are both rebased into the active layer’s frame, which is safe precisely because the processor only ever uses their difference. With no source set the gesture is refused outright — not-allowed cursor, no stroke, no history entry — rather than accepted and committed as a no-op that would make undo appear to do nothing. The copy is a genuine copy: a soft-edged tip and a straight-alpha source-over per texel, carrying the source texel’s own alpha so a clone out of a transparent region leaves the destination transparent rather than painting it opaque black, with every read indexed into an immutable copy of the raster and every write into the buffer, so no dab can sample a texel a previous dab laid down. That read-back is taken once per stroke and not per dab for a second reason worth naming: the live preview re-runs the processor on every pointer move but always against the store’s own pre-stroke raster, never the previous frame’s preview, and the commit re-runs it once more over the whole path before publishing. Aligned is the one control that is wired and still diverges, and the divergence is worth stating precisely because the checkbox is real and the arithmetic beneath it is not Adobe’s. Adobe fixes the offset at the displacement of the first stroke after the Alt-click and holds it for every later stroke; the app recomputes the offset from the current gesture’s own first point on every invocation, so the offset is constant within a stroke — which matches — and re-anchors at the start of each new one, which is exactly the drift the mode exists to remove. Unaligned is not the other half of Adobe’s pair either: Adobe keeps the sampling point fixed at the Alt-click and moves only the destination, while the app measures from the gesture’s current end, so the read point slides backwards as the drag progresses. Both arms are one subtraction, so this is a missing anchor rather than a wrong formula, and the fix is a stored offset on the args rather than new pixel code. Size, Hardness and Opacity are all wired and the tip is borrowed from the shared brush engine, so a soft Clone edge is the same soft edge the other paint tools stamp. Eight of the ten controls are absent because the args type declares no field for any of them: Brush Preset Picker, Mode, Flow, both pressure toggles, Sample, Ignore Adjustment Layers and the Clone Source panel. Ignore Adjustment Layers has nothing to ignore in this app even in principle — a layer source is blank, an image, a tool or an affine transform, and Levels, Color, Transform and Blur are destructive operations on a raster rather than layers sitting above a clone target. Mode is the one that would change visible behavior: the tool is a raster commit on the active layer, so a blend mode is a composite against the layer beneath and the one primitive here takes no mode. Size is capped at 500 px rather than 5000. The layer gate refuses the Bedrock layer but does not check the layer’s lock flag, so a locked layer still accepts a cloned stroke — and that lock round-trips to PSD as composite and position protection, which means a layer can be protected in a saved file and freely overwritten in the editor. The scope of that is worth stating precisely: `layer.locked` is only ever set true by importing a PSD, and no panel in this app renders a lock control or a lock icon, so there is no in-app route to a locked layer and nothing on screen to contradict the flag.

Implementation:

- `src/tools/toolsMap.ts:95`
- `src/components/Main/CloneStampToolArea.tsx:343`
- `src/components/Main/CloneStampToolArea.tsx:210`
- `src/tools/cloneStamp.ts:89`
- `src/tools/cloneStamp.ts:210`
- `src/contexts/useLayer.ts:557`
- `src/components/ToolbarsRight/CloneStamp/CloneStamp.tsx:118`
- `src/tools/settings.ts:250`
- `src/components/Common/AppKeyboardShortcuts.tsx:362`

Sources:

- <https://helpx.adobe.com/photoshop/desktop/repair-retouch/heal-clone/retouch-images-with-the-clone-stamp-tool.html>
- <https://helpx.adobe.com/photoshop/using/tool-techniques/clone-stamp-tool.html>
- <https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/create-tool-preset.html>
- <https://adobe.manymanuals.com/software/photoshop-cs4/user-manual-35148/209>
- <https://www.manualsdir.com/manuals/753896/adobe-photoshop-cs4.html?page=211>
- <https://www.properproof.com/digital/Photoshop/photoshop_cs3s_clone_tool_adds_ignore_adjustment_layers_option.html>
- <https://www.underwaterphotoshop.com/power-of-the-clone/>
- <https://jkost.com/blog/2021/12/10-tips-for-the-clone-stamp-and-healing-brush-tools-in-photoshop.html>
- <https://photoshopcafe.com/cs3/CS3.htm>
- <https://www.photoshopforphotographers.com/CC_2013/Help_guide/tp/Clone_stamp_tool.html>
- <https://www.webpages.uidaho.edu/larc246/toolBarPages/cloneStamp.htm>
- <https://www.glensmith.co.uk/photoshop/clone-stamp>
- <https://www.psdvault.com/basics/photoshop-clone-stamp-tool/>
- <https://www.tipsquirrel.com/5-awesome-icon-buttons-might-know-photoshop/>
- <https://graphicdesign.stackexchange.com/questions/21866/why-does-the-clone-stamp-tool-seem-to-be-misaligned>

---

## Focus and tone

Long-form research, provenance and unverified claims: [`src/tools/descriptions/focus.notes.md`](../src/tools/descriptions/focus.notes.md).

### Blur Tool

`blur`

Paints blur under the brush, softening hard edges and reducing detail wherever you drag; the effect builds up pass by pass.

The Blur tool reduces local contrast and smooths detail in the areas you paint it over, so one pass is subtle and repeated passes are not. It shares a Tools-panel slot, a single options bar, and a tip with the Sharpen and Smudge tools: the bar carries a brush preset with its Size and Hardness, a Mode, a Strength percentage that seeds at 50% and which Adobe's own guidance says to keep low, and Sample All Layers, which is what makes the effect paintable onto a blank layer above the stack for non-destructive work. It is a different thing from Filter > Blur and from the Blur Gallery, which run a Gaussian, Box, Lens, Motion, Radial, Smart, Surface or Tilt-Shift, Iris or Field blur over a whole selection or layer in one command with no brush and no per-stroke build-up.

**Options bar**

| Control             | Photoshop                                                                                                                                                                                                                                                                                                                                              | In this app |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| Brush Preset Picker | The tip the blur is painted with, carrying its Size and Hardness. Photoshop exposes the whole preset library here; Size and Hardness are the preset's two live parameters, and a soft tip is what lets a stroke blend into its surroundings instead of standing out against them.                                                                      | `missing`   |
| Mode                | The blend mode the blurred result is composited with, rather than drawn at Normal. On the Blur tool the list is restricted to the modes that make sense for a blur, including Normal, Darken, Lighten, Hue, Saturation, Color and Luminosity; a mode that shifts hue or saturation does not blur colour the way the others do.                         | `missing`   |
| Strength            | The percentage of the blurred result blended in per pass, 0-100% and 50% by default. It is the per-stroke build-up rate, not a radius: at 100% one pass is the full blur, and at a low value the same stroke has to be repeated to get there. Adobe and the CS-era documentation both describe 10-30% as the subtle setting and 50% or more as strong. | `missing`   |
| Sample All Layers   | Off by default. With it on, the blur samples the composite of every visible layer, so painting on a blank layer above the stack produces a separable, opacity-adjustable result; with it off the tool reads only the active layer. The blur is written into whichever layer is active either way.                                                      | `missing`   |

**In this app:** `partial` — The app's blur is a whole-layer FILTER, not a paint tool, and the two are not the same thing. Its options bar is a single Blur Radius slider plus an Undo Blur button; there is no brush, no Size, no Hardness, no Mode, no Strength and no Sample All Layers, because the bar's only argument is a radius in pixels that the processor hands straight to the canvas blur filter. There is no gesture surface at all: `Main`'s tool-area dispatch has no `blur` branch, so the canvas area for blur falls through to `DummyToolArea`, the inert `display: none` surface every unrouted tool gets. That is a different component from the Sharpen's: the Sharpen mounts a `SharpenToolArea` of its own, which also renders `display: none` and is documented as the deliberate absence of a gesture. Two components with the same rendering, not one. So nothing can be painted, and the whole active layer is previewed as soon as the slider moves: the bar routes through `tempUpdateLayer`, which publishes a preview layer and no history entry, and the entry is written later by the dirty-tool commit on tool switch, on export or in `mergeAllLayers`. That makes it the closest thing this editor has to Filter > Blur > Gaussian Blur - a true Gaussian, with the canvas blur filter as its kernel - wearing Photoshop's Blur tool's name. Every one of the four controls above is therefore absent rather than incomplete, and the missing `Flow` recorded in the notes is absent for the same reason: the app has no per-dab and per-stroke opacity pair to express one with.

Implementation:

- `src/tools/blur.ts:11`
- `src/tools/settings.ts:47`
- `src/components/ToolbarsRight/Blur/Blur.tsx:101`
- `src/components/ToolbarsRight/Blur/Blur.tsx:121`
- `src/components/Main/SharpenToolArea.tsx:33`
- `src/tools/toolProcessors.ts:118`

Sources:

- <https://helpx.adobe.com/photoshop/using/tool-techniques/blur-tool.html>
- <https://helpx.adobe.com/photoshop/desktop/whats-new/photoshop-on-desktop-release-notes.html>
- <https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=210>
- <https://www.oreilly.com/library/view/adobe-photoshop-cs2/9780240520025/20_Chapter17.html>
- <https://flylib.com/books/en/2.190.1.43/1/>
- <https://www.bwillcreative.com/how-to-use-the-blur-tool-in-photoshop/>
- <https://www.dummies.com/article/technology/software/adobe-products/photoshop/using-the-blur-tool-to-soften-image-areas-in-photoshop-elements-9-205964/>
- <https://www.adobe.com/products/photoshop/smooth-edges.html>

---

### Sharpen Tool

`sharpen`

Paints extra edge contrast where you drag, so a soft area reads sharper without sharpening the rest of the image at all.

The Sharpen tool increases local contrast at edges, and therefore the apparent sharpness, only in the areas you brush. It shares one options bar and one tip with the Blur and Smudge tools, and what separates it from the Blur is the direction of the local change: the Blur smooths, the Sharpen exaggerates the difference between neighbouring pixels over a wider radius, with a falloff that behaves like an unsharp mask rather than a flat average. Its bar carries a brush preset, a Mode, a Strength percentage, Sample All Layers and Protect Detail. It is not the Filter > Sharpen family: those are one-shot commands with no brush and no per-stroke build-up, and Sharpen More in particular is simply the Sharpen filter with a larger fixed amount and no controls of its own.

**Options bar**

| Control             | Photoshop                                                                                                                                                                                                                                                                                                                                                                         | In this app |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Brush Preset Picker | The tip the sharpening is painted with, carrying its Size and Hardness. A small hard tip over one edge and a large soft tip over a whole face are two different jobs, and the tool has no other way to express that choice.                                                                                                                                                       | `missing`   |
| Mode                | The blend mode the sharpened result is composited with as you brush. On a dark edge Luminosity or Color keeps the sharpening from dragging the hue with it, which is why the mode is worth setting per area rather than once.                                                                                                                                                     | `missing`   |
| Strength            | How much sharpening each pass contributes, 0-100% and 50% by default. It is a per-stroke build-up rate on a filtered copy of the pixels under the brush, not a kernel radius; the effect accumulates with repeated passes over the same place, and at 10-20% it is subtle where at 50% or more it degrades quickly.                                                               | `missing`   |
| Sample All Layers   | Off by default. With it on, the tool sharpens using the composite of every visible layer, so on a blank layer above the stack the sharpening is a separable, opacity-adjustable layer rather than a destructive change to the pixels underneath.                                                                                                                                  | `missing`   |
| Protect Detail      | Documented by Adobe for the Sharpen tool in Photoshop Elements, where it "ensures minimized pixelated artifacts while enhancing and sharpening" and is on by default. No 2024+ Adobe desktop page was found, so whether it is still on the current desktop bar is unverified; the third-party walkthroughs that mention it do so conditionally, as something you "sometimes" get. | `missing`   |

**In this app:** `partial` — What the app ships under this name is the Filter > Sharpen > Unsharp Mask filter, not the tool. The options bar is Amount (0-500%, 50% by default) and Radius (0-100 px, 1 px by default) - the Unsharp Mask's own control names, not the tool's - and there is no brush, no Strength, no Mode, no Sample All Layers and no Protect Detail. There is no gesture either: the Sharpen's canvas area renders display:none by design, so nothing can be brushed. The layer is previewed when a slider moves rather than committed by it: the bar routes through `tempUpdateLayer`, which publishes a preview layer and no history entry, and the entry is written later by the dirty-tool commit on tool switch, on export or in `mergeAllLayers`. The kernel is a two-pass separable BOX blur subtracted from the source, which is an unsharp mask over a box kernel rather than over Photoshop's Gaussian; the file says so. That matters more for this tool than for the filter, because the addendum's own account of the three focus tools is that they are distinguished precisely by kernel behaviour - the Blur smooths, the Sharpen uses a wider radius with unsharp-like falloff rather than a box blur. The kernel class is not the gap here, because the app does have the box kernel and says so in caps. What is missing is Photoshop's Gaussian: a real unsharp mask subtracts a Gaussian-blurred copy, whose response decays smoothly away from an edge, while a box window responds flatly across its whole width and stops dead at the edge. At small radii the two are nearly interchangeable; at a wide one the app's Sharpen hardens a band of the full window width with a step at its boundary, where Photoshop tapers. So the Blur and the Sharpen here differ in radius and in magnitude, not in the shape of the kernel's response - which is exactly the distinction the addendum says separates them, and the app does not reproduce it. The one genuine strength here is over the pixels underneath: the blur runs on premultiplied colour with alpha unsharp-masked on its own scale, so a transparent hole does not bleed a ring into the opaque side - a halo Photoshop's own USM does not go out of its way to avoid either.

Implementation:

- `src/tools/sharpen.ts:243`
- `src/tools/sharpen.ts:90`
- `src/tools/settings.ts:232`
- `src/components/ToolbarsRight/Sharpen/Sharpen.tsx:125`
- `src/components/ToolbarsRight/Sharpen/Sharpen.tsx:143`
- `src/components/Main/SharpenToolArea.tsx:46`
- `src/tools/toolProcessors.ts:225`

Sources:

- <https://helpx.adobe.com/photoshop/desktop/whats-new/photoshop-on-desktop-release-notes.html>
- <https://insider.kelbyone.com/living-on-the-edge-an-exploration-of-the-sharpening-tools-in-photoshop-by-scott-valentine/>
- <https://www.macphun.com/hans/how-to/how-to-sharpen-your-image-in-photoshop>
- <https://helpx.adobe.com/nz/photoshop/using/filter-effects-reference.html>
- <https://www.manualsdir.com/manuals/753896/adobe-photoshop-cs4.html?page=221>
- <https://kalyankrishna4886.wordpress.com/wp-content/uploads/2013/09/adobe-photoshop-elements-reference-help-tutorial.pdf>
- <https://thelinuxcode.com/how-i-use-photoshops-blur-and-sharpen-tools-without-ruining-detail/>

---

### Smudge Tool

`smudge`

Drags the pixels under the brush along the stroke, picking up colour where the stroke begins and pushing it where you pull.

The Smudge tool simulates a finger through wet paint: it picks up the colour where the stroke starts and pushes it in the direction you drag, blending what it carries into what it passes over. It is the only one of the three focus tools that transports rather than transforms, which is why it is the only one that needs Sample All Layers, the only one with Finger Painting, and the only one where sampling the wrong pixels shows up as a visible smear. Alongside the brush preset and Mode the bar has a Strength percentage - where 100% is described as effectively infinite, carrying one colour the whole length of the drag - plus Finger Painting, which starts each stroke with the foreground colour instead of the colour under the pointer.

**Options bar**

| Control             | Photoshop                                                                                                                                                                                                                                                                                                                                                                                                                                            | In this app                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Brush Preset Picker | The tip the smudge is carried with, carrying its Size and Hardness. The smudge is the size of the fingertip, so the preset is a statement about scale rather than about texture.                                                                                                                                                                                                                                                                     | `partial` — `src/components/ToolbarsRight/Smudge/Smudge.tsx:138` |
| Mode                | The blend mode the carried colour is composited with, Normal by default. Darken and Lighten are the useful ones here: they smear only the pixels that are darker or lighter than the colour the stroke started on, which is how a smudge is used to push a background out from behind a subject.                                                                                                                                                     | `missing`                                                        |
| Strength            | The percentage of the carried colour blended per dab, 0-100% and 50% by default. A Strength of 100% is described as equivalent to infinity: it carries the colour sampled at the start of the drag all the way to the release, at which point the smudge is effectively painting. Below 100% the carried colour fades and picks up the new colour under the brush as it goes.                                                                        | `present` — `src/components/ToolbarsRight/Smudge/Smudge.tsx:168` |
| Finger Painting     | Off by default, and called "dipping" in older versions of Photoshop. With it on, the stroke first applies a drop of the foreground colour and blends it into the image, then smudges that through as if a finger had been dipped in paint; the Strength setting then specifies how much foreground colour is applied, so at 100% the Smudge becomes the Brush. With it off, the colour under the pointer at the start of the stroke is used instead. | `missing`                                                        |
| Sample All Layers   | Off by default, and called "Use All Layers" before CS2. With it on, the tool grabs colour from every visible layer and smudges it into the current layer. The layers underneath are not modified either way, which is what makes the recommended workflow - a new empty layer with the box ticked - non-destructive.                                                                                                                                 | `missing`                                                        |

**Modifiers**

- **Alt** — Reverses the Finger Painting setting for the length of the drag: if the box is off, Alt-dragging dips the tool into the foreground colour; if Finger Painting is on, Alt-dragging smudges normally.

**In this app:** `partial` — This is the closest match in the family. The processor reads each covered pixel from the untouched source raster at the texel one dab-behind along the drag, never from the buffer it is writing, so colour travels exactly one segment per dab instead of compounding into a single streak; the falloff is the shared brush engine's tipAlphaAt, so the smudge's soft edge is the same edge the Brush, Eraser, Dodge, Burn and Clone Stamp stamp. Strength is a genuine 0-100% per-dab coverage seeded at 50% as in Photoshop. The transport semantics are right, and the app matches Photoshop's layering rule without being told to: the stroke edits the active layer, which is exactly what Sample All Layers does not change. Four controls are missing rather than wrong. Mode has nowhere to live because no control anywhere in the app edits a layer's blend mode: `Layer.blendMode` is a data field the paint tool's own Mode select writes and the PSD importer sets, and a grep for `blendMode` across `src/components/` finds only that select - the Layers panel has no blend-mode control at all. Finger Painting needs an args field of its own before it can be a control, and it is a per-dab source selection rather than a setting on the same axis as the other three. Sample All Layers would need the composite, and the processor is handed one layer's bitmap. The Brush Preset Picker is partial rather than absent because this editor has one tip shape and no presets, though Size and Hardness - the preset's two live parameters - are both there. Alt is not bound to Finger Painting. There is no build-up while the button is held: the shared stroke hook appends a point to the drag on a pointer move and there is no timer and no dwell accumulation anywhere in it, so holding the brush still deposits nothing, and one stroke is one undo entry. That is the same absence this file calls the tool's defining interaction on the Dodge and the Burn, and it is why this tool is filed `partial` on the same bar rather than `implemented` - not because the drag misbehaves, which it does not, but because the interaction the tool exists for is not there.

Implementation:

- `src/tools/smudge.ts:149`
- `src/tools/smudge.ts:123`
- `src/tools/settings.ts:233`
- `src/components/ToolbarsRight/Smudge/Smudge.tsx:138`
- `src/components/ToolbarsRight/Smudge/Smudge.tsx:153`
- `src/components/Main/SmudgeToolArea.tsx:62`
- `src/tools/toolProcessors.ts:231`

Sources:

- <https://www.adobe.com/products/photoshop/blend-colors.html>
- <https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=210>
- <https://flylib.com/books/en/2.817.1.103/1/>
- <https://flylib.com/books/en/2.816.1.11/1/>
- <https://helpx.adobe.com/si/photoshop-elements/using/painting-overview.html>

---

### Gradient Tool

`gradient`

Fills a selection or layer with a gradient you define by dragging: the click sets the first colour stop, the release the second.

The Gradient tool fills the current layer, or the selection when there is one, with a smooth blend between two or more colours. Where you click is where the first stop sits and where you release is where the second sits, so the drag sets the length and the angle of the gradient at once, and the gradient clamps to its ends beyond the drag rather than fading to transparent - which is why a short drag fills everything. The bar runs from a tool-preset picker and the gradient swatch through the five gradient types, a blend Mode, an Opacity, the Dither, Transparency and Reverse checkboxes and a Method dropdown, and every one of those controls belongs to the tool itself rather than to a brush. From 24.5 the bar also offers a Tool Mode dropdown that picks between the live gradient and the older destructive Classic gradient, and the live gradient can be corrected after the fact by dragging its handles on the canvas.

**Options bar**

| Control                    | Photoshop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | In this app                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Tool Mode                  | A dropdown to the right of the gradient swatch that picks between "Gradient" and "Classic gradient". It exists only in 24.5 and later, and it is not cosmetic: the choice changes which options follow it. The classic tool is destructive and must be reapplied after Dither or Reverse changes; the live one writes an editable gradient instead.                                                                                                                                                                                                                                          | `missing`                                                            |
| Gradient preset picker     | The gradient swatch at the left of the bar. Clicking it opens the Gradient Editor, where the stops, their locations, their colours, their opacity stops and their midpoints are edited and the preset saved; its dropdown arrow opens the presets library instead. It is two controls in one swatch, and the two do different things.                                                                                                                                                                                                                                                        | `missing`                                                            |
| Gradient Type              | Five buttons: Linear, a straight ramp from the start point to the end point; Radial, a circle from the start point at its centre to the end point at its outer edge; Angle, a sweep in the direction the drag points; Reflected, a linear ramp mirrored about the start point; and Diamond, a rhombus radiating from it. Linear is the default, and Angle, Reflected and Diamond are the three most often left off a smaller implementation.                                                                                                                                                 | `partial` — `src/components/ToolbarsRight/Gradient/Gradient.tsx:13`  |
| Mode                       | The blend mode the gradient is composited with, Normal by default, which is how a gradient is used to tint or to knock back whatever is beneath it rather than to replace it.                                                                                                                                                                                                                                                                                                                                                                                                                | `missing`                                                            |
| Opacity                    | The opacity of the whole gradient, 0-100% and 100% by default. It scales the fill and is not a third stop: the gradient keeps its own alpha ramp, and this multiplies it.                                                                                                                                                                                                                                                                                                                                                                                                                    | `present` — `src/components/ToolbarsRight/Gradient/Gradient.tsx:129` |
| Dither                     | On by default. It adds noise at the boundaries of each colour in the interpolation so transitions appear smoother, which is what stops an 8-bit ramp from showing visible banding. On a live gradient the setting is live, so ticking it updates the existing gradient immediately.                                                                                                                                                                                                                                                                                                          | `missing`                                                            |
| Transparency               | Enables the gradient pattern transparency. It is not available on the new Gradient tool at all - the checkbox belongs to the Classic gradient only - and with it off the opacity stops in the gradient are ignored.                                                                                                                                                                                                                                                                                                                                                                          | `missing`                                                            |
| Reverse                    | Off by default. Swaps the gradient ends, so the colour that was at the first stop moves to the second. As with Dither it is live on a live gradient and requires reapplying the gradient on the Classic tool.                                                                                                                                                                                                                                                                                                                                                                                | `missing`                                                            |
| Method                     | The interpolation method: Perceptual, which is the default and interpolates in the OKLab colour space so the ramp looks natural to the eye; Linear, which interpolates in linear colour space; and Classic, the interpolation Photoshop used for decades, kept for backwards compatibility. Perceptual became the default in 23.0, so gradients made in 22.x or earlier render differently in 23.0 and later unless this is set back to Classic.                                                                                                                                             | `missing`                                                            |
| On-canvas gradient handles | Not an options-bar control but the tool defining editing surface, and the load-bearing one. After the drag, two round handles mark the gradient ends and a small diamond between them sets the midpoint, all draggable straight on the canvas; dragging a handle re-aims the gradient, dragging the diamond changes where the transition falls, holding Command while dragging a handle moves the whole gradient line rather than one end, and pressing Delete removes the stop under the pointer. Photoshop added these on-canvas controls together with an automatic live preview in 24.5. | `missing`                                                            |

**Modifiers**

- **Shift** — Constrains the drag to multiples of 45 degrees, so a linear gradient lands on a square angle.
- **Cmd** — Held while dragging an on-canvas gradient handle, moves the whole gradient line rather than re-aiming one end of it.

**Shortcuts**

- `G` — Selects the Gradient tool, but only on the second press: a plain G selects the Paint Bucket, and it is Shift+G that cycles the pair. The Gradient tile declares no shortcut letter of its own, while the Paint Bucket's declares G.
- `[` — Cycles backwards through the gradient styles.
- `]` — Cycles forwards through the gradient styles.
- `,` — Selects the previous gradient preset.
- `.` — Selects the next gradient preset.
- `Delete` — Removes the stop under the pointer from the on-canvas gradient line. A gradient cannot be reduced below two stops.

**In this app:** `partial` — The fill itself is right: the drag sets both endpoints, the projection clamps to the ends rather than fading to transparent, and a linear ramp puts the exact mean of the two stops at the midpoint of the axis. Everything around it is thinner than the bar. The bar has four controls where Photoshop has eleven, and Gradient Type offers only Linear and Radial - Angle, Reflected and Diamond have no representation in a fixed from/to pair, which is also why the app's Radial holds its end colour past the circle through the second stop where Photoshop mirrors. Dither, Reverse and the Method dropdown are all missing, and Method is the most consequential omission of the three: the app interpolates the two stops as plain per-channel RGB, which is closest to the Classic behaviour that Photoshop stopped defaulting to in 23.0, so every gradient this editor paints is one Method dropdown away from a different ramp. The Tool Mode dropdown is missing too, so there is no live/classic choice at all - the app is permanently the destructive one, and even a Dither checkbox would have had to be reapplied by hand. Transparency is absent, which happens to match the modern tool rather than the Classic one, but for the wrong reason: there is no alpha ramp at all. The preset picker and the Gradient Editor are gone, so there are no multi-stop gradients, no per-stop opacity or position, no midpoints, and no gradient styles. The two stops are two colour inputs in the bar rather than a picker, and they are the tool's only gradient state - there is no Foreground-to-Background preset and nothing to reset to. The load-bearing gap is the on-canvas handles: the tool area accepts the overlay context and never draws to it, and from/to are written only by the drag, so once the fill is committed its geometry cannot be changed at all without painting a second gradient over it. Photoshop's live-preview gradient, added in 24.5, is not a refinement of that - it is the difference between a fill and an editable object. Nothing is bound to Shift or Cmd, and the four preset keys are bound nowhere in the app: `[`, `]`, `,` and `.` are registered on no keyboard handler at all, and the only `Delete` bindings belong to the two lasso tool areas, so no key removes a gradient stop. The bar's four controls are not the ones Photoshop sequences, so a user arriving from Photoshop finds neither the Order nor the Method.

Implementation:

- `src/components/ToolbarsRight/Gradient/Gradient.tsx:13`
- `src/components/ToolbarsRight/Gradient/Gradient.tsx:116`
- `src/components/ToolbarsRight/Gradient/Gradient.tsx:129`
- `src/components/ToolbarsRight/Gradient/Gradient.tsx:146`
- `src/tools/gradient.ts:132`
- `src/tools/settings.ts:221`
- `src/components/Main/GradientToolArea.tsx:40`
- `src/components/Main/GradientToolArea.tsx:95`
- `src/tools/toolProcessors.ts:219`

Sources:

- <https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/apply-gradient-fill.html>
- <https://helpx.adobe.com/photoshop/using/tool-techniques/gradient-tool.html>
- <https://www.teachucomp.com/how-to-use-the-gradient-tool-in-photoshop-instructions/>
- <https://www.teachucomp.com/how-to-edit-a-gradient-adjustment-in-photoshop-instructions/>
- <https://taylorhieber.co/how-to-use-the-improved-gradient-interpolations-in-adobe-photoshop/>
- <https://www.adobe.com/learn/photoshop/web/blend-two-images-gradient>
- <https://community.adobe.com/announcements-710/photoshop-24-5-is-now-available-1154445>
- <https://www.photoshopessentials.com/photo-effects/fade-an-image-to-color-in-photoshop-faster-with-live-gradients/>
- <https://luminousworks.substack.com/p/grokking-gradients>
- <https://glensmith.co.uk/photoshop/gradient-tool>
- <https://digital-photography-school.com/photoshop-gradient-tool/>

---

### Dodge Tool

`dodge` · **O**

Lightens the tonal range you choose as you paint, the way holding back paper under a finger brightens a print.

The Dodge tool comes from the darkroom: a printer holds light back under a finger to lighten that part of the print, and this is the digital version. Dragging it lightens the pixels it passes over, and it keeps doing so for as long as the button is held, so the effect is built by dwelling rather than by painting more. It is a tone operation gated by a tonal range, which is what separates it from the Sponge tool in the same flyout - the Sponge is a chroma operation with a Saturate/Desaturate mode and neither a Range nor an Exposure. Exposure is the only intensity control on the bar: there is no Opacity and no Flow, unlike the paint tools. The bar also offers Airbrush, which makes the build-up automatic while the brush rests, and Protect Tones, which is on by default and keeps the lightening from shifting hue or clipping the ends of the range.

**Options bar**

| Control             | Photoshop                                                                                                                                                                                                                                                                                                                  | In this app                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Brush Preset Picker | The tip the dodge is painted with, carrying its Size and Hardness. A large soft tip with a low Exposure is how a dodge is built gradually; a small hard one is how a catchlight is placed.                                                                                                                                 | `partial` — `src/components/ToolbarsRight/Tonal/Tonal.tsx:156` |
| Mode                | The blend mode the dodge is composited with, a short list of three that the control cycles through. The three differ in how fast the highlights reach white, which is the difference between a dodge that lifts a shadow and one that blows it out.                                                                        | `missing`                                                      |
| Range               | Which tonal range the stroke is allowed to touch: Shadows, Midtones or Highlights, with Midtones as the default. Choosing the range is what makes the same tool usable on a face without taking the specular highlights with it, and it is why the Dodge and Burn are tone operations while the Sponge beside them is not. | `present` — `src/components/ToolbarsRight/Tonal/Tonal.tsx:126` |
| Exposure            | How strongly each pass lightens, as a percentage, 0-100% with 50% as the default, and the only intensity control on the bar. A low value with repeated passes is the intended workflow; a high one in a single pass is how a dodge turns into a blown highlight.                                                           | `present` — `src/components/ToolbarsRight/Tonal/Tonal.tsx:139` |
| Protect Tones       | On by default. A boolean that changes which pixels the stroke will touch: it helps maintain colour and prevents clipping in the highlights and shadows, which is the same work Adobe's older bar called Protect Skin Tone.                                                                                                 | `missing`                                                      |
| Airbrush            | Off by default. With it on, the effect keeps building on its own wherever the brush rests, without needing a new stroke - the automatic version of what holding the button still otherwise does, and the reason the tool is a "toning tool" that can build up "on the fly".                                                | `missing`                                                      |

**Shortcuts**

- `O` — Selects the Dodge tool; the letter is shared with the Burn and Sponge tools in the same flyout.
- `Shift+O` — Cycles through the tools that share the O shortcut, which reaches the Burn tool without leaving the canvas.

**In this app:** `partial` — Range and Exposure are both real and both wired: Range writes a field the processor reads, and Exposure drives a per-pixel amount rather than a display-only value, with the band's power driven by the exposure so a high value narrows the band instead of dragging a hard edge across the picture. The band itself is a quadratic falloff in Rec.709 luma of the encoded sRGB the editor stores, split at a flat luma 128. That is a defensible reading of what the tool does - Photoshop also scales stored channel values towards 255 - but it is a single hard split against a real tonal scale, and the three Photoshop bands are not equal halves of the range. The bar also matches Photoshop in a negative that is easy to get wrong: there is no Opacity and no Flow, only Exposure, which is why `DodgeBurnToolArgs` has no opacity or spacing field and takes both from the shared engine's defaults. Four controls are missing. Mode has no args field, and a select here would be a control whose value the processor never read. Protect Tones is a real omission and the component says so: there is no field for it, so a checkbox would read as on while doing nothing. Airbrush is missing for the same reason. The Brush Preset Picker is partial rather than absent because Size and Hardness, the preset's two live parameters, are both present and clamped to 1-500 px and 0-100%. The largest behavioural gap is not a control: there is NO BUILD-UP. Each stroke commits once, at the slider's full Exposure value in a single pass, because a one-shot commit has to be a pure function of its args, which is also what makes the registry's replay reproduce it exactly. Holding the button still does nothing, so the tool's defining interaction is absent - and Airbrush, which exists precisely to make that build-up automatic when you cannot hold still, is missing for the same reason. Dodge and Burn deliberately share one options component, so a change to this control set cannot land on one tool and miss the other.

Implementation:

- `src/tools/dodgeBurn.ts:125`
- `src/tools/dodgeBurn.ts:177`
- `src/tools/dodgeBurn.ts:90`
- `src/tools/settings.ts:234`
- `src/components/ToolbarsRight/Tonal/Tonal.tsx:126`
- `src/components/ToolbarsRight/Tonal/Tonal.tsx:139`
- `src/components/ToolbarsRight/Tonal/Tonal.tsx:156`
- `src/components/Main/DodgeToolArea.tsx:50`
- `toolbar-mapping.ts:93`
- `src/tools/toolProcessors.ts:237`

Sources:

- <https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/dodge-or-burn-image-areas.html>
- <https://fstoptraining.com/dodge-burn-tools/>
- <https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=211>
- <https://www.webpages.uidaho.edu/larc246/toolBarPages/dodge.htm>
- <https://flylib.com/books/en/2.816.1.11/1/>
- <https://www.dummies.com/article/technology/software/adobe-products/photoshop/using-the-dodge-and-burn-tools-in-photoshop-elements-9-205974/>

---

### Burn Tool

`burn`

Darkens the tonal range you choose as you paint, the way letting more light onto a print deepens its shadows.

The Burn tool is the Dodge tool measured from the other end: instead of holding light back, you let more of it onto the print, which deepens that part of the image. Dragging darkens the pixels it passes over, and it keeps darkening for as long as the button is held. Range confines the work to Shadows, Midtones or Highlights, and Exposure - the bar's only intensity control, with no Opacity and no Flow - sets how hard each pass works. Airbrush makes the build-up automatic while the brush rests, and Protect Tones is on by default and keeps the darkening from raising saturation or clipping the shadows and highlights.

**Options bar**

| Control             | Photoshop                                                                                                                                                                                                                                                            | In this app                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Brush Preset Picker | The tip the burn is painted with, carrying its Size and Hardness. A large soft tip with a low Exposure builds a burn gradually; a small hard one places a precise one.                                                                                               | `partial` — `src/components/ToolbarsRight/Tonal/Tonal.tsx:156` |
| Mode                | The blend mode the burn is composited with, a short list of three that the control cycles through. The default is the harshest of the three and clips fastest, which is why it is the one that needs the lowest Exposure.                                            | `missing`                                                      |
| Range               | Which tonal range the stroke is allowed to touch: Shadows, Midtones or Highlights, with Midtones as the default. Restricting a burn to the shadows is what keeps it from muddying the midtones it was not aimed at.                                                  | `present` — `src/components/ToolbarsRight/Tonal/Tonal.tsx:126` |
| Exposure            | How strongly each pass darkens, as a percentage, 0-100% with 50% as the default, and the only intensity control on the bar. Low values with repeated passes are the intended workflow; a high one in a single pass closes the shadows up.                            | `present` — `src/components/ToolbarsRight/Tonal/Tonal.tsx:139` |
| Protect Tones       | On by default. A boolean that changes which pixels the stroke will touch: without it a burn raises the saturation of what it darkens as well as darkening it, and it can clip the ends of the range. This is the control Adobe's older bar called Protect Skin Tone. | `missing`                                                      |
| Airbrush            | Off by default. With it on, the darkening keeps building wherever the brush rests, without needing a new stroke.                                                                                                                                                     | `missing`                                                      |

**Shortcuts**

- `Shift+O` — Cycles from the Dodge tool to the Burn tool, which share the O shortcut; press it again to reach the Sponge tool.

**In this app:** `partial` — The same processor as the Dodge, with the endpoint swapped: the burn's rule is c' = c - c * amount against the dodge's c' = c + (255 - c) * amount, and the module is explicit that burn is not the inverse of dodge. Range and Exposure are both wired to real per-pixel work through the same band function, and the band is a quadratic falloff in Rec.709 luma of the encoded sRGB the editor stores - a defensible reading, since Photoshop also scales stored channel values towards 0, but a single hard split at luma 128 where the three real tonal bands are not equal halves of the range. Mode, Protect Tones and Airbrush are all missing for the same reason as on the Dodge: `DodgeBurnToolArgs` has no field to hold them, and a control that renders a value the processor never reads is the failure this bar is written against. The Brush Preset Picker is partial because Size and Hardness are present. The defining gap is again the absence of build-up while the button is held - one stroke, one commit, at the slider's full Exposure value in a single pass - which is a deliberate choice to keep the commit a pure function of its args so the registry replays it exactly, and which costs the tool the behaviour it exists for. This tool and the Dodge share one options component by design, so the control set cannot drift between them.

Implementation:

- `src/tools/dodgeBurn.ts:394`
- `src/tools/dodgeBurn.ts:125`
- `src/tools/dodgeBurn.ts:177`
- `src/tools/settings.ts:242`
- `src/components/ToolbarsRight/Tonal/Tonal.tsx:126`
- `src/components/ToolbarsRight/Tonal/Tonal.tsx:139`
- `src/components/Main/BurnToolArea.tsx:56`
- `src/tools/toolProcessors.ts:243`

Sources:

- <https://helpx.adobe.com/photoshop/desktop/repair-retouch/adjust-light-tone/dodge-or-burn-image-areas.html>
- <https://fstoptraining.com/dodge-burn-tools/>
- <https://www.manualsdir.com/manuals/753900/adobe-photoshop-cs3.html?page=211>
- <https://flylib.com/books/en/2.816.1.11/1/>
- <https://www.lenscraft.co.uk/photo-editing-tutorials/tutorial-mastering-the-photoshop-dodge-and-burn-tool/>
- <https://www.dummies.com/article/technology/software/adobe-products/photoshop/using-the-dodge-and-burn-tools-in-photoshop-elements-9-205974/>

---

## Shapes

Long-form research, provenance and unverified claims: [`src/tools/descriptions/shape.notes.md`](../src/tools/descriptions/shape.notes.md).

### Rectangle Tool

`rectangle` · **U**

Drag-defined rectangle or square with an optional corner radius, drawn as a shape layer, path, or filled pixels.

The Rectangle tool draws a four-sided figure from two drag corners, and Shift holds it square while Alt/Option draws it from its centre outward. Radius rounds the corners before you draw, and the shape it produces is a Live Shape whose four corner radii can afterwards be set independently — Alt/Option-drag the on-canvas radius control to break one corner out of the link. The separate Rounded Rectangle tool was removed in Photoshop 22.3 because the Radius field on this tool subsumes it. Clicking the canvas with no drag opens a Create Rectangle dialog so an exact width, height and corner radius can be typed instead of dragged.

**Options bar**

| Control                               | Photoshop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | In this app                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Mode                                  | The three-button drawing-mode group: Shape creates a filled shape layer, Path creates a vector path with no pixels, and Pixels rasterizes the shape straight into the current layer. Shape is the default.                                                                                                                                                                                                                                                                                                                                                                                  | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:129` |
| Fill                                  | The interior colour of the shape, as a swatch offering None, Solid Color, Gradient or Pattern. Fill and Stroke are independent: a shape can have a fill and no stroke, or the reverse.                                                                                                                                                                                                                                                                                                                                                                                                      | `partial` — `src/tools/shape.ts:144`                             |
| Stroke                                | The colour of the outline, as a second swatch with the same None / Solid Color / Gradient / Pattern choices. Set it to None to draw a fill with no outline.                                                                                                                                                                                                                                                                                                                                                                                                                                 | `partial` — `src/tools/shape.ts:143`                             |
| Stroke width                          | Thickness of the stroke in pixels. Photoshop adds a 1 px black stroke by default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:153` |
| Stroke type                           | Opens the Stroke Options panel, which sets the line style (Solid, Dashed or Dotted, plus a custom dash array under More Options), the stroke Align (Inside, Center or Outside), the end Caps (Butt, Round, Square) and the corner joins (Miter, Round, Bevel). Centered alignment and a solid line are the defaults.                                                                                                                                                                                                                                                                        | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:219` |
| Weight                                | Thickness in pixels of the on-screen path outline shown while dragging. It is a display aid only, not the stroke: it never prints and never appears in a saved image.                                                                                                                                                                                                                                                                                                                                                                                                                       | `missing`                                                        |
| Opacity                               | Pixel mode only: transparency of the rasterized shape, 1–100%. Shape and Path modes expose no Opacity slider, because a shape layer and a path have no opacity of their own.                                                                                                                                                                                                                                                                                                                                                                                                                | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:284` |
| Mode                                  | Pixel mode only: the blend mode the rasterized shape composites with, from the full layer blend-mode list. Shape and Path modes have no blend mode.                                                                                                                                                                                                                                                                                                                                                                                                                                         | `missing`                                                        |
| Anti-alias                            | Pixel mode only: smooths the shape edges when rasterizing. Photoshop applies it automatically, so it has no meaningful unchecked state in practice.                                                                                                                                                                                                                                                                                                                                                                                                                                         | `missing`                                                        |
| Path Operations                       | How a new shape combines with the shapes already on the selected vector mask: New Shape Layer, Combine Shapes, Subtract Front Shape, Intersect Shape Areas, or Exclude Overlapping Shapes, with Merge Shape Components available afterwards. The subtract entry is labelled Subtract Front Shape in Adobe Community and Subtract From Shape Area in Adobe’s 2022 wording; no single Adobe page opened here enumerates the whole set.                                                                                                                                                        | `missing`                                                        |
| Path Arrangement                      | Stacking order of the shapes on a vector mask: bring to front, bring forward, send backward, send to back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `missing`                                                        |
| Path Alignment                        | Align and distribute the path components of the selected vector mask against one another.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `missing`                                                        |
| Set additional shape and path options | The gear at the right of the bar. Holds the on-screen Path Options (path colour and width), the Live Shapes controls, the Import Shapes command and the per-tool geometry options such as Unconstrained, Square, Circle, Fixed Size, Proportional, From Center and Equilateral. The per-tool settings Adobe documents in the Contextual Task Bar are not in it.                                                                                                                                                                                                                             | `missing`                                                        |
| Shape W&H                             | Exact width and height for the next shape. The app does ask for them, but it asks with two sequential `window.prompt` calls — Width, then Height — rather than a dialog, so there is no Corner Radius field and no From Center anywhere in that path, and a dismissed prompt or a value of zero or less commits nothing at all.                                                                                                                                                                                                                                                             | `partial` — `src/components/Main/ShapeToolArea.tsx:181`          |
| Radius                                | Rounds the shape corners in pixels, default 0 px. Adobe documents the control on the Rectangle tool ("Radius of rounded corners: Manually set the radius…") and on the Triangle tool ("specify Width, Height, and Corner Radius"); the Ellipse and Line tools have no rounded corners. The Rectangle tool keeps four independent radii and the Triangle tool a single value that rounds every corner at once. Whether the Polygon tool offers it is third-party only — no Adobe page listing the Polygon tool’s bar was found — so the polygon half of that gap is a judgment, not a match. | `present` — `src/tools/shape.ts:216`                             |

**Modifiers**

- **Shift** — Constrains the drag to a square drag box, which is a square for the Rectangle tool and a circle for the Ellipse tool.
- **Alt** — Draws from the centre outward, so the press point is the middle of the shape rather than one corner.
- **Space** — Repositions the shape while the drag is still in progress, without changing its size.

**Shortcuts**

- `U` — Selects the shapes tool group. The five geometric figures share one app tool name and differ only by their figure, so U keeps whichever of them is active rather than forcing the rectangle; the Custom Shape tool carries its own tool name, and U from there lands on the rectangle. Nothing happens until an image is open.

**In this app:** `partial` — The drag geometry, Shift, Alt and the corner radius all behave as they do in Photoshop, and the radius is clamped to half the shorter side exactly as a rounded rectangle must be. That is the whole of what is right, and the divergences below are why the verdict is `partial` and not `implemented`. The three the group carries apply to the Rectangle verbatim: Path mode does not create a path, Pixels mode is byte-identical to Shape mode, and the options bar shares one colour with the rest of the app rather than carrying its own Fill and Stroke swatches, so the fill is whatever the global background colour currently is and there is no way to turn the stroke off at all. The Rectangle adds two divergences of its own, and the first is a default rather than a gap: it seeds a 5 px stroke where Photoshop seeds 1 px, so an untouched rectangle is drawn five times as heavy as Photoshop would draw it. The Radius slider runs 0–250 px with no numeric entry, and only the rectangle gets a radius — the app gates the whole control on this figure. Fill and Stroke are on the bar, then, and `partial` in the table above is the honest reading of them: what the app renders is a single wired `Filled` checkbox over its one shared colour, and it is the separate swatches with their None / Solid / Gradient / Pattern menu that are missing, not the controls. The mode group, the stroke width, the stroke type, the opacity and the W/H prompt each diverge from Photoshop’s control in the same way, and the path weight, the pixel-mode blend mode, the anti-alias control, the three path-operation rows and the gear are absent outright. A click with no drag asks for width and then height through two `window.prompt` calls rather than a dialog, so the Create Rectangle dialog’s corner-radius field and its From Center field have no counterpart here.

Implementation:

- `src/tools/toolProcessors.ts:325`
- `src/tools/shape.ts:201`
- `src/tools/shape.ts:71`
- `src/components/ToolbarsRight/Figures/Shape.tsx:165`
- `src/tools/settings.ts:265`

Sources:

- <https://helpx.adobe.com/photoshop/using/modify-shapes.html>
- <https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/>
- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html>
- <https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/>
- <https://jkost.com/blog/2021/07/working-with-the-shape-tools-in-photoshop.html>

---

### Ellipse Tool

`ellipse`

Drag-defined ellipse or circle drawn as a shape layer, a work path, or a filled pixel region.

The Ellipse tool inscribes an ellipse in the drag box; Shift holds it a circle, and Alt/Option draws it from its centre outward. It has no Corner Radius, because an ellipse has no corners, and the field does not appear in the bar. No desktop Adobe page enumerating the Ellipse tool’s bar was found, so that this matches Photoshop is a judgment rather than a documented match. The result is a Live Shape whose width, height and angle stay editable in the Properties panel. Clicking without dragging opens a Create Ellipse dialog for exact dimensions.

**Options bar**

| Control                               | Photoshop                                                                                                                                                                                                                                                                                                                                                                                                                            | In this app                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Mode                                  | The three-button drawing-mode group: Shape creates a filled shape layer, Path creates a vector path with no pixels, and Pixels rasterizes the shape straight into the current layer. Shape is the default.                                                                                                                                                                                                                           | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:129` |
| Fill                                  | The interior colour of the shape, as a swatch offering None, Solid Color, Gradient or Pattern. Fill and Stroke are independent: a shape can have a fill and no stroke, or the reverse.                                                                                                                                                                                                                                               | `partial` — `src/tools/shape.ts:144`                             |
| Stroke                                | The colour of the outline, as a second swatch with the same None / Solid Color / Gradient / Pattern choices. Set it to None to draw a fill with no outline.                                                                                                                                                                                                                                                                          | `partial` — `src/tools/shape.ts:143`                             |
| Stroke width                          | Thickness of the stroke in pixels. Photoshop adds a 1 px black stroke by default.                                                                                                                                                                                                                                                                                                                                                    | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:153` |
| Stroke type                           | Opens the Stroke Options panel, which sets the line style (Solid, Dashed or Dotted, plus a custom dash array under More Options), the stroke Align (Inside, Center or Outside), the end Caps (Butt, Round, Square) and the corner joins (Miter, Round, Bevel). Centered alignment and a solid line are the defaults.                                                                                                                 | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:219` |
| Weight                                | Thickness in pixels of the on-screen path outline shown while dragging. It is a display aid only, not the stroke: it never prints and never appears in a saved image.                                                                                                                                                                                                                                                                | `missing`                                                        |
| Opacity                               | Pixel mode only: transparency of the rasterized shape, 1–100%. Shape and Path modes expose no Opacity slider, because a shape layer and a path have no opacity of their own.                                                                                                                                                                                                                                                         | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:284` |
| Mode                                  | Pixel mode only: the blend mode the rasterized shape composites with, from the full layer blend-mode list. Shape and Path modes have no blend mode.                                                                                                                                                                                                                                                                                  | `missing`                                                        |
| Anti-alias                            | Pixel mode only: smooths the shape edges when rasterizing. Photoshop applies it automatically, so it has no meaningful unchecked state in practice.                                                                                                                                                                                                                                                                                  | `missing`                                                        |
| Path Operations                       | How a new shape combines with the shapes already on the selected vector mask: New Shape Layer, Combine Shapes, Subtract Front Shape, Intersect Shape Areas, or Exclude Overlapping Shapes, with Merge Shape Components available afterwards. The subtract entry is labelled Subtract Front Shape in Adobe Community and Subtract From Shape Area in Adobe’s 2022 wording; no single Adobe page opened here enumerates the whole set. | `missing`                                                        |
| Path Arrangement                      | Stacking order of the shapes on a vector mask: bring to front, bring forward, send backward, send to back.                                                                                                                                                                                                                                                                                                                           | `missing`                                                        |
| Path Alignment                        | Align and distribute the path components of the selected vector mask against one another.                                                                                                                                                                                                                                                                                                                                            | `missing`                                                        |
| Set additional shape and path options | The gear at the right of the bar. Holds the on-screen Path Options (path colour and width), the Live Shapes controls, the Import Shapes command and the per-tool geometry options such as Unconstrained, Square, Circle, Fixed Size, Proportional, From Center and Equilateral. The per-tool settings Adobe documents in the Contextual Task Bar are not in it.                                                                      | `missing`                                                        |
| Shape W&H                             | Exact width and height for the next shape. The app does ask for them, but it asks with two sequential `window.prompt` calls — Width, then Height — rather than a dialog, so there is no Corner Radius field and no From Center anywhere in that path, and a dismissed prompt or a value of zero or less commits nothing at all.                                                                                                      | `partial` — `src/components/Main/ShapeToolArea.tsx:181`          |

**Modifiers**

- **Shift** — Constrains the drag to a square drag box, which is a square for the Rectangle tool and a circle for the Ellipse tool.
- **Alt** — Draws from the centre outward, so the press point is the middle of the shape rather than one corner.
- **Space** — Repositions the shape while the drag is still in progress, without changing its size.

**Shortcuts**

- `U` — Selects the shapes tool group. The five geometric figures share one app tool name and differ only by their figure, so U keeps whichever of them is active rather than forcing the rectangle; the Custom Shape tool carries its own tool name, and U from there lands on the rectangle. Nothing happens until an image is open.

**In this app:** `partial` — The geometry matches: the ellipse is drawn as a real ctx.ellipse from the half-extents of the drag box, and Shift produces a true circle rather than a square-boxed oval. That is the whole of what is right, and the divergences below are why the verdict is `partial` and not `implemented`. The three the group carries apply to the Ellipse verbatim: Path mode does not create a path, Pixels mode is byte-identical to Shape mode, and the options bar shares one colour with the rest of the app rather than carrying its own Fill and Stroke swatches, so the fill is whatever the global background colour currently is and there is no way to turn the stroke off at all. The Ellipse then carries the same wrong default as every other figure, a 5 px stroke where Photoshop seeds 1 px, and keeps a cornerRadius: 0 key in its persisted defaults for a control its own bar withholds. Withholding Radius is the app’s rectangle-only gate, and that is a judgment about Photoshop rather than a documented match, since the only evidence for it is a third-party page and no desktop Adobe page enumerating the Ellipse tool’s bar was found. The bar itself is the shared one — the Ellipse gets no control of its own, so the options bar names it and shows the same five controls every figure gets: tool mode, thickness, the dashed toggle and its dash and gap sliders, the Filled checkbox, the opacity slider, and the live preview. That is the same set the rectangle has minus the radius, so the same reading applies to each: fill and stroke are on the bar as a wired Filled checkbox over one shared colour rather than as Photoshop’s two swatches, the mode group, the stroke type, the opacity and the W/H prompt each diverge from Photoshop’s control, and the path weight, the pixel-mode blend mode, the anti-alias control, the three path-operation rows and the gear are absent outright. A click with no drag asks for width and then height through two `window.prompt` calls, not a Create Ellipse dialog, and takes no From Center.

Implementation:

- `src/tools/toolProcessors.ts:326`
- `src/tools/shape.ts:225`
- `src/tools/shape.ts:71`
- `src/components/ToolbarsRight/Figures/Shape.tsx:13`
- `src/tools/settings.ts:272`

Sources:

- <https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/>
- <https://helpx.adobe.com/photoshop/using/draw-and-edit-shapes-web.html>
- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html>
- <https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/>

---

### Line Tool

`line`

Drag-defined straight line or arrow, drawn as a shape layer, a work path, or a filled pixel region.

The Line tool drags a single straight segment between two points, and Shift snaps the segment to the nearest multiple of 45 degrees so it lands on a compass bearing. Its colour is the Stroke, not the Fill, because a line is an open path with a stroke and no interior to fill. The Arrowheads panel adds Start and End toggles, with Width, Length and Concavity to size them; Adobe documents it as a section of the Contextual Task Bar (Window > Contextual Task Bar), not a field in the options bar. The end caps are Butt, Round or Square.

**Options bar**

| Control                               | Photoshop                                                                                                                                                                                                                                                                                                                                                                                                                            | In this app                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Mode                                  | The three-button drawing-mode group: Shape creates a filled shape layer, Path creates a vector path with no pixels, and Pixels rasterizes the shape straight into the current layer. Shape is the default.                                                                                                                                                                                                                           | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:129` |
| Fill                                  | The interior colour of the shape, as a swatch offering None, Solid Color, Gradient or Pattern. Fill and Stroke are independent: a shape can have a fill and no stroke, or the reverse.                                                                                                                                                                                                                                               | `partial` — `src/tools/shape.ts:144`                             |
| Stroke                                | The colour of the outline, as a second swatch with the same None / Solid Color / Gradient / Pattern choices. Set it to None to draw a fill with no outline.                                                                                                                                                                                                                                                                          | `partial` — `src/tools/shape.ts:143`                             |
| Stroke width                          | Thickness of the stroke in pixels. Photoshop adds a 1 px black stroke by default.                                                                                                                                                                                                                                                                                                                                                    | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:153` |
| Stroke type                           | Opens the Stroke Options panel, which sets the line style (Solid, Dashed or Dotted, plus a custom dash array under More Options), the stroke Align (Inside, Center or Outside), the end Caps (Butt, Round, Square) and the corner joins (Miter, Round, Bevel). Centered alignment and a solid line are the defaults.                                                                                                                 | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:219` |
| Weight                                | Thickness in pixels of the on-screen path outline shown while dragging. It is a display aid only, not the stroke: it never prints and never appears in a saved image.                                                                                                                                                                                                                                                                | `missing`                                                        |
| Opacity                               | Pixel mode only: transparency of the rasterized shape, 1–100%. Shape and Path modes expose no Opacity slider, because a shape layer and a path have no opacity of their own.                                                                                                                                                                                                                                                         | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:284` |
| Mode                                  | Pixel mode only: the blend mode the rasterized shape composites with, from the full layer blend-mode list. Shape and Path modes have no blend mode.                                                                                                                                                                                                                                                                                  | `missing`                                                        |
| Anti-alias                            | Pixel mode only: smooths the shape edges when rasterizing. Photoshop applies it automatically, so it has no meaningful unchecked state in practice.                                                                                                                                                                                                                                                                                  | `missing`                                                        |
| Path Operations                       | How a new shape combines with the shapes already on the selected vector mask: New Shape Layer, Combine Shapes, Subtract Front Shape, Intersect Shape Areas, or Exclude Overlapping Shapes, with Merge Shape Components available afterwards. The subtract entry is labelled Subtract Front Shape in Adobe Community and Subtract From Shape Area in Adobe’s 2022 wording; no single Adobe page opened here enumerates the whole set. | `missing`                                                        |
| Path Arrangement                      | Stacking order of the shapes on a vector mask: bring to front, bring forward, send backward, send to back.                                                                                                                                                                                                                                                                                                                           | `missing`                                                        |
| Path Alignment                        | Align and distribute the path components of the selected vector mask against one another.                                                                                                                                                                                                                                                                                                                                            | `missing`                                                        |
| Set additional shape and path options | The gear at the right of the bar. Holds the on-screen Path Options (path colour and width), the Live Shapes controls, the Import Shapes command and the per-tool geometry options such as Unconstrained, Square, Circle, Fixed Size, Proportional, From Center and Equilateral. The per-tool settings Adobe documents in the Contextual Task Bar are not in it.                                                                      | `missing`                                                        |
| Shape W&H                             | Exact width and height for the next shape. The app does ask for them, but it asks with two sequential `window.prompt` calls — Width, then Height — rather than a dialog, so there is no Corner Radius field and no From Center anywhere in that path, and a dismissed prompt or a value of zero or less commits nothing at all.                                                                                                      | `partial` — `src/components/Main/ShapeToolArea.tsx:181`          |
| Caps                                  | Appearance of the two ends of the segment: Butt, Round or Square. Offered for any stroked path, and prominent for the Line tool.                                                                                                                                                                                                                                                                                                     | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:189` |
| Arrowheads                            | Start and End toggles that put an arrowhead on either or both ends of the line, sized by Width, Length and Concavity. Adobe places the panel in the Arrowheads section of the Contextual Task Bar (Window > Contextual Task Bar) with the tool selected; it is never a field in the options bar, and the Concavity default could not be sourced to a current Adobe page.                                                             | `missing`                                                        |

**Modifiers**

- **Alt** — Draws from the centre outward, so the press point is the middle of the shape rather than one corner.
- **Space** — Repositions the shape while the drag is still in progress, without changing its size.

**Shortcuts**

- `U` — Selects the shapes tool group. The five geometric figures share one app tool name and differ only by their figure, so U keeps whichever of them is active rather than forcing the rectangle; the Custom Shape tool carries its own tool name, and U from there lands on the rectangle. Nothing happens until an image is open.

**In this app:** `partial` — The segment itself is correct, and the app is right not to square a line, but the one modifier that defines this tool is the one it declines to implement: normalizeShapeGeometry explicitly skips the Shift constraint for the line figure, so a Shift-drag keeps its free angle and can never snap to 45 degrees. Shift is therefore absent from the `modifiers` table above rather than listed as one — in this app it changes nothing about a line drag — while Alt, which the app does implement, is listed. Arrowheads are absent outright — drawShape strokes a bare moveTo/lineTo pair, with no start or end cap geometry — which is why a line here can never become an arrow. The Cap select the app renders for this figure offers Photoshop’s three cap styles but only the Line figure gets one, where Photoshop offers caps for any stroked path.

Implementation:

- `src/tools/toolProcessors.ts:329`
- `src/tools/shape.ts:176`
- `src/tools/shape.ts:79`
- `src/components/ToolbarsRight/Figures/Shape.tsx:186`
- `src/tools/settings.ts:293`

Sources:

- <https://helpx.adobe.com/photoshop/using/line-tool.html>
- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/draw-an-arrow.html>
- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html>
- <https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/>
- <https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/>

---

### Triangle Tool

`triangle`

Drag-defined triangle with its apex at the top-centre of the drag box; hold Shift while dragging to constrain it to an equilateral triangle.

The Triangle tool, added in Photoshop 2021 (v22), draws a three-sided figure whose apex sits at the top-centre of the drag box and whose base spans its bottom. Adobe states the drag and the Shift constraint but never the resulting geometry, so reading that box as an isosceles triangle rather than a regular one is this description’s inference, not Adobe’s wording. Shift while dragging is the equilateral constraint — it forces the height to √3⁄2 of the width — and it is not a square-drag aspect snap. Alt/Option draws from the centre, and a single Radius control rounds all three corners together, because this tool has no per-corner radius handles. The tool is a shortcut for the Polygon tool at three sides, not a separate shape vocabulary.

**Options bar**

| Control                               | Photoshop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | In this app                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Mode                                  | The three-button drawing-mode group: Shape creates a filled shape layer, Path creates a vector path with no pixels, and Pixels rasterizes the shape straight into the current layer. Shape is the default.                                                                                                                                                                                                                                                                                                                                                                                  | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:129` |
| Fill                                  | The interior colour of the shape, as a swatch offering None, Solid Color, Gradient or Pattern. Fill and Stroke are independent: a shape can have a fill and no stroke, or the reverse.                                                                                                                                                                                                                                                                                                                                                                                                      | `partial` — `src/tools/shape.ts:144`                             |
| Stroke                                | The colour of the outline, as a second swatch with the same None / Solid Color / Gradient / Pattern choices. Set it to None to draw a fill with no outline.                                                                                                                                                                                                                                                                                                                                                                                                                                 | `partial` — `src/tools/shape.ts:143`                             |
| Stroke width                          | Thickness of the stroke in pixels. Photoshop adds a 1 px black stroke by default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:153` |
| Stroke type                           | Opens the Stroke Options panel, which sets the line style (Solid, Dashed or Dotted, plus a custom dash array under More Options), the stroke Align (Inside, Center or Outside), the end Caps (Butt, Round, Square) and the corner joins (Miter, Round, Bevel). Centered alignment and a solid line are the defaults.                                                                                                                                                                                                                                                                        | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:219` |
| Weight                                | Thickness in pixels of the on-screen path outline shown while dragging. It is a display aid only, not the stroke: it never prints and never appears in a saved image.                                                                                                                                                                                                                                                                                                                                                                                                                       | `missing`                                                        |
| Opacity                               | Pixel mode only: transparency of the rasterized shape, 1–100%. Shape and Path modes expose no Opacity slider, because a shape layer and a path have no opacity of their own.                                                                                                                                                                                                                                                                                                                                                                                                                | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:284` |
| Mode                                  | Pixel mode only: the blend mode the rasterized shape composites with, from the full layer blend-mode list. Shape and Path modes have no blend mode.                                                                                                                                                                                                                                                                                                                                                                                                                                         | `missing`                                                        |
| Anti-alias                            | Pixel mode only: smooths the shape edges when rasterizing. Photoshop applies it automatically, so it has no meaningful unchecked state in practice.                                                                                                                                                                                                                                                                                                                                                                                                                                         | `missing`                                                        |
| Path Operations                       | How a new shape combines with the shapes already on the selected vector mask: New Shape Layer, Combine Shapes, Subtract Front Shape, Intersect Shape Areas, or Exclude Overlapping Shapes, with Merge Shape Components available afterwards. The subtract entry is labelled Subtract Front Shape in Adobe Community and Subtract From Shape Area in Adobe’s 2022 wording; no single Adobe page opened here enumerates the whole set.                                                                                                                                                        | `missing`                                                        |
| Path Arrangement                      | Stacking order of the shapes on a vector mask: bring to front, bring forward, send backward, send to back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `missing`                                                        |
| Path Alignment                        | Align and distribute the path components of the selected vector mask against one another.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `missing`                                                        |
| Set additional shape and path options | The gear at the right of the bar. Holds the on-screen Path Options (path colour and width), the Live Shapes controls, the Import Shapes command and the per-tool geometry options such as Unconstrained, Square, Circle, Fixed Size, Proportional, From Center and Equilateral. The per-tool settings Adobe documents in the Contextual Task Bar are not in it.                                                                                                                                                                                                                             | `missing`                                                        |
| Shape W&H                             | Exact width and height for the next shape. The app does ask for them, but it asks with two sequential `window.prompt` calls — Width, then Height — rather than a dialog, so there is no Corner Radius field and no From Center anywhere in that path, and a dismissed prompt or a value of zero or less commits nothing at all.                                                                                                                                                                                                                                                             | `partial` — `src/components/Main/ShapeToolArea.tsx:181`          |
| Radius                                | Rounds the shape corners in pixels, default 0 px. Adobe documents the control on the Rectangle tool ("Radius of rounded corners: Manually set the radius…") and on the Triangle tool ("specify Width, Height, and Corner Radius"); the Ellipse and Line tools have no rounded corners. The Rectangle tool keeps four independent radii and the Triangle tool a single value that rounds every corner at once. Whether the Polygon tool offers it is third-party only — no Adobe page listing the Polygon tool’s bar was found — so the polygon half of that gap is a judgment, not a match. | `missing`                                                        |

**Modifiers**

- **Shift** — Constrains the triangle to equilateral, forcing the height to √3⁄2 of the width.
- **Alt** — Draws from the centre outward, so the press point is the middle of the shape rather than one corner.
- **Space** — Repositions the shape while the drag is still in progress, without changing its size.

**Shortcuts**

- `U` — Selects the shapes tool group. The five geometric figures share one app tool name and differ only by their figure, so U keeps whichever of them is active rather than forcing the rectangle; the Custom Shape tool carries its own tool name, and U from there lands on the rectangle. Nothing happens until an image is open.

**In this app:** `partial` — The geometry is wrong in the specific way the premise correction warns about. The app inscribes a regular three-sided polygon in the drag box, so a wide drag yields a squat isosceles-looking triangle only by accident, and Shift squares the drag box instead of forcing equilateral — for a 3-gon inscribed in a square box, that is not h = √3⁄2 · w. Because the figure is built by the shared triangle/polygon branch, its Radius field is both absent from the bar and unimplemented in the renderer, so its corners can never be rounded. The Shift behaviour is version-dependent in wording only: the equilateral constraint has been the tool’s Shift since 2021 (v22), and later versions add the persistent Equilateral checkbox to the gear menu.

Implementation:

- `src/tools/toolProcessors.ts:327`
- `src/tools/shape.ts:181`
- `src/tools/shape.ts:186`
- `src/tools/shape.ts:79`
- `src/tools/settings.ts:279`

Sources:

- <https://helpx.adobe.com/photoshop/using/triangle-tool.html>
- <https://jkost.com/blog/2020/10/adobe-announces-updates-to-photoshop-2021-v22.html>
- <https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/>
- <https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/>
- <https://helpx.adobe.com/photoshop/using/modify-shapes.html>

---

### Polygon Tool

`polygon`

Drag-defined polygon of any number of sides, with the side count set before the draw; the star of a given point count is a separate tool.

The Polygon tool is drag-defined, not a click-to-place-vertices tool: Adobe says to click and drag on the canvas, and the ordinary reading of that is a regular n-gon inscribed in the drag box — the regularity is this description’s inference, not Adobe’s wording. Sides sets the n before the draw and defaults to 5. The star is not this tool’s to draw in the current release: Adobe’s tools list puts a separate Star tool in the same shapes group, and the star attributes — the number of points, the Inner Radius that sets the depth of the indents and the Outer Radius that sets the length of the spikes — are documented on that tool, in the Contextual Task Bar and the Properties panel. Shift constrains proportions, Alt/Option draws from the centre — though a polygon is already centred in its drag box — and Control/Cmd while dragging rotates it. A single Radius control rounds every corner at once. The result is a Live Shape whose side count stays editable in the Properties panel.

**Options bar**

| Control                               | Photoshop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | In this app                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Mode                                  | The three-button drawing-mode group: Shape creates a filled shape layer, Path creates a vector path with no pixels, and Pixels rasterizes the shape straight into the current layer. Shape is the default.                                                                                                                                                                                                                                                                                                                                                                                  | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:129` |
| Fill                                  | The interior colour of the shape, as a swatch offering None, Solid Color, Gradient or Pattern. Fill and Stroke are independent: a shape can have a fill and no stroke, or the reverse.                                                                                                                                                                                                                                                                                                                                                                                                      | `partial` — `src/tools/shape.ts:144`                             |
| Stroke                                | The colour of the outline, as a second swatch with the same None / Solid Color / Gradient / Pattern choices. Set it to None to draw a fill with no outline.                                                                                                                                                                                                                                                                                                                                                                                                                                 | `partial` — `src/tools/shape.ts:143`                             |
| Stroke width                          | Thickness of the stroke in pixels. Photoshop adds a 1 px black stroke by default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:153` |
| Stroke type                           | Opens the Stroke Options panel, which sets the line style (Solid, Dashed or Dotted, plus a custom dash array under More Options), the stroke Align (Inside, Center or Outside), the end Caps (Butt, Round, Square) and the corner joins (Miter, Round, Bevel). Centered alignment and a solid line are the defaults.                                                                                                                                                                                                                                                                        | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:219` |
| Weight                                | Thickness in pixels of the on-screen path outline shown while dragging. It is a display aid only, not the stroke: it never prints and never appears in a saved image.                                                                                                                                                                                                                                                                                                                                                                                                                       | `missing`                                                        |
| Opacity                               | Pixel mode only: transparency of the rasterized shape, 1–100%. Shape and Path modes expose no Opacity slider, because a shape layer and a path have no opacity of their own.                                                                                                                                                                                                                                                                                                                                                                                                                | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:284` |
| Mode                                  | Pixel mode only: the blend mode the rasterized shape composites with, from the full layer blend-mode list. Shape and Path modes have no blend mode.                                                                                                                                                                                                                                                                                                                                                                                                                                         | `missing`                                                        |
| Anti-alias                            | Pixel mode only: smooths the shape edges when rasterizing. Photoshop applies it automatically, so it has no meaningful unchecked state in practice.                                                                                                                                                                                                                                                                                                                                                                                                                                         | `missing`                                                        |
| Path Operations                       | How a new shape combines with the shapes already on the selected vector mask: New Shape Layer, Combine Shapes, Subtract Front Shape, Intersect Shape Areas, or Exclude Overlapping Shapes, with Merge Shape Components available afterwards. The subtract entry is labelled Subtract Front Shape in Adobe Community and Subtract From Shape Area in Adobe’s 2022 wording; no single Adobe page opened here enumerates the whole set.                                                                                                                                                        | `missing`                                                        |
| Path Arrangement                      | Stacking order of the shapes on a vector mask: bring to front, bring forward, send backward, send to back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `missing`                                                        |
| Path Alignment                        | Align and distribute the path components of the selected vector mask against one another.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `missing`                                                        |
| Set additional shape and path options | The gear at the right of the bar. Holds the on-screen Path Options (path colour and width), the Live Shapes controls, the Import Shapes command and the per-tool geometry options such as Unconstrained, Square, Circle, Fixed Size, Proportional, From Center and Equilateral. The per-tool settings Adobe documents in the Contextual Task Bar are not in it.                                                                                                                                                                                                                             | `missing`                                                        |
| Shape W&H                             | Exact width and height for the next shape. The app does ask for them, but it asks with two sequential `window.prompt` calls — Width, then Height — rather than a dialog, so there is no Corner Radius field and no From Center anywhere in that path, and a dismissed prompt or a value of zero or less commits nothing at all.                                                                                                                                                                                                                                                             | `partial` — `src/components/Main/ShapeToolArea.tsx:181`          |
| Sides                                 | Number of sides the drag produces, default 5. The star’s indent control is not on this tool’s bar in the current release: Adobe lists a separate Star tool in the same group, and carries the point count and the inner and outer radii there.                                                                                                                                                                                                                                                                                                                                              | `missing`                                                        |
| Radius                                | Rounds the shape corners in pixels, default 0 px. Adobe documents the control on the Rectangle tool ("Radius of rounded corners: Manually set the radius…") and on the Triangle tool ("specify Width, Height, and Corner Radius"); the Ellipse and Line tools have no rounded corners. The Rectangle tool keeps four independent radii and the Triangle tool a single value that rounds every corner at once. Whether the Polygon tool offers it is third-party only — no Adobe page listing the Polygon tool’s bar was found — so the polygon half of that gap is a judgment, not a match. | `missing`                                                        |

**Modifiers**

- **Shift** — Constrains proportions while the shape is drawn; the constraint is off by default in the gear menu.
- **Alt** — Draws from the centre outward, so the press point is the middle of the shape rather than one corner.
- **Space** — Repositions the shape while the drag is still in progress, without changing its size.

**Shortcuts**

- `U` — Selects the shapes tool group. The five geometric figures share one app tool name and differ only by their figure, so U keeps whichever of them is active rather than forcing the rectangle; the Custom Shape tool carries its own tool name, and U from there lands on the rectangle. Nothing happens until an image is open.

**In this app:** `partial` — The load-bearing premise is right here: the app builds a regular n-gon in the drag box, so the drag-defined model is already correct and the side count is 5 by default, matching Photoshop — though the regularity itself is an inference from Adobe's drag instruction rather than something Adobe states. Everything after that is missing. The side count is a hardcoded three-way ternary — figure === 'triangle' ? 3 : 5 — so there is no Sides field and no way to draw a hexagon; and the star is not this tool's to draw in the current release, so there is nothing here to compare a star Ratio against. That same hardcoding is why the `[` and `]` rows Photoshop gives this tool are gone from the table above: they change a side count that does not exist at runtime, and no bracket key is bound anywhere in the app, so there was nothing to record but the Photoshop behaviour. The Radius field is withheld from the bar for this figure, matching the app's rectangle-only gate but not Photoshop, which third-party sources say offers it. Shift squares the drag box rather than constraining the polygon's own proportions, and the Control-drag rotation the Polygon tool has over every other figure is not implemented — which is why `Control` is absent from the `modifiers` table above: in this app holding it while drawing a polygon changes nothing.

Implementation:

- `src/tools/toolProcessors.ts:328`
- `src/tools/shape.ts:186`
- `src/tools/shape.ts:189`
- `src/components/ToolbarsRight/Figures/Shape.tsx:165`
- `src/tools/settings.ts:286`

Sources:

- <https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/>
- <https://www.photoshopessentials.com/basics/shapes/photoshop-shape-essentials/>
- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-star-shapes.html>
- <https://jkost.com/blog/2021/07/working-with-the-shape-tools-in-photoshop.html>
- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html>

---

### Custom Shape Tool

`custom-shape`

Draws a preset vector graphic from Photoshop's shape library, or one you define from a path.

The Custom Shape tool draws any of the vector presets in Photoshop’s shape library — a library that includes the Leaf Trees, Wild Animals, Boats and Flowers groups, with the full set reached through Legacy Shapes and More in the Shapes panel. Those four were the default loaded groups in a 2020 account, and Adobe Community threads from 2019–2021 report that the picker changed and moved them behind Legacy Shapes and More, so what a current install shows on first launch is not established here. Third-party accounts, not Adobe’s own documentation, say this is the only shape tool whose Shift constraint preserves the drawn shape’s own aspect ratio rather than squaring the drag box, so a recognisable graphic comes out undistorted. Its Path Operations menu is where the boolean work happens: New Shape Layer, Combine Shapes, Subtract Front Shape — which Adobe’s 2022 wording calls Subtract From Shape Area — Intersect Shape Areas, Exclude Overlapping Shapes, and Merge Shape Components, which converts the live shape into a plain path and warns you that it can no longer be edited component by component. No single Adobe page enumerates that whole set. Any path — drawn with the Pen tool, made from a shape layer, or produced by converting text to a path — becomes a new preset through Edit ▸ Define Custom Shape, and Preset Manager saves and loads the result as a `.csh` file.

**Options bar**

| Control                               | Photoshop                                                                                                                                                                                                                                                                                                                                                                                                                            | In this app                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Mode                                  | The three-button drawing-mode group: Shape creates a filled shape layer, Path creates a vector path with no pixels, and Pixels rasterizes the shape straight into the current layer. Shape is the default.                                                                                                                                                                                                                           | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:28` |
| Fill                                  | The interior colour of the shape, as a swatch offering None, Solid Color, Gradient or Pattern. Fill and Stroke are independent: a shape can have a fill and no stroke, or the reverse.                                                                                                                                                                                                                                               | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:28` |
| Stroke                                | The colour of the outline, as a second swatch with the same None / Solid Color / Gradient / Pattern choices. Set it to None to draw a fill with no outline.                                                                                                                                                                                                                                                                          | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:28` |
| Stroke width                          | Thickness of the stroke in pixels. Photoshop adds a 1 px black stroke by default.                                                                                                                                                                                                                                                                                                                                                    | `missing`                                                               |
| Stroke type                           | Opens the Stroke Options panel, which sets the line style (Solid, Dashed or Dotted, plus a custom dash array under More Options), the stroke Align (Inside, Center or Outside), the end Caps (Butt, Round, Square) and the corner joins (Miter, Round, Bevel). Centered alignment and a solid line are the defaults.                                                                                                                 | `missing`                                                               |
| Weight                                | Thickness in pixels of the on-screen path outline shown while dragging. It is a display aid only, not the stroke: it never prints and never appears in a saved image.                                                                                                                                                                                                                                                                | `missing`                                                               |
| Opacity                               | Pixel mode only: transparency of the rasterized shape, 1–100%. Shape and Path modes expose no Opacity slider, because a shape layer and a path have no opacity of their own.                                                                                                                                                                                                                                                         | `missing`                                                               |
| Mode                                  | Pixel mode only: the blend mode the rasterized shape composites with, from the full layer blend-mode list. Shape and Path modes have no blend mode.                                                                                                                                                                                                                                                                                  | `missing`                                                               |
| Anti-alias                            | Pixel mode only: smooths the shape edges when rasterizing. Photoshop applies it automatically, so it has no meaningful unchecked state in practice.                                                                                                                                                                                                                                                                                  | `missing`                                                               |
| Shape Picker                          | Opens the shape library as a grid of thumbnails, grouped by theme, with a fly-out that reaches Preset Manager, the Reset Shapes command and the Legacy Shapes and More set. Shift while dragging is reported to draw the preset at its own aspect ratio, on third-party authority.                                                                                                                                                   | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:28` |
| Shape W&H                             | Exact width and height for the next shape. The app puts this name on the chip list, but nothing reads it: this tool has no canvas gesture, so the pair of `window.prompt` calls the other six figures get never runs for it.                                                                                                                                                                                                         | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:28` |
| Path Operations                       | How a new shape combines with the shapes already on the selected vector mask: New Shape Layer, Combine Shapes, Subtract Front Shape, Intersect Shape Areas, or Exclude Overlapping Shapes, with Merge Shape Components available afterwards. The subtract entry is labelled Subtract Front Shape in Adobe Community and Subtract From Shape Area in Adobe’s 2022 wording; no single Adobe page opened here enumerates the whole set. | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:28` |
| Path Arrangement                      | Stacking order of the shapes on a vector mask: bring to front, bring forward, send backward, send to back.                                                                                                                                                                                                                                                                                                                           | `missing`                                                               |
| Path Alignment                        | Align and distribute the path components of the selected vector mask against one another.                                                                                                                                                                                                                                                                                                                                            | `missing`                                                               |
| Set additional shape and path options | The gear at the right of the bar. Holds the on-screen Path Options (path colour and width), the Live Shapes controls, the Import Shapes command and the per-tool geometry options such as Unconstrained, Square, Circle, Fixed Size, Proportional, From Center and Equilateral. The per-tool settings Adobe documents in the Contextual Task Bar are not in it.                                                                      | `missing`                                                               |

**Modifiers**

- **Shift** — Draws the preset at its own original width-to-height ratio instead of filling the drag box — a third-party account, not a sentence from Adobe’s current documentation.
- **Alt** — Draws from the centre outward, so the press point is the middle of the shape rather than one corner.
- **Space** — Repositions the shape while the drag is still in progress, without changing its size.

**Shortcuts**

- `U` — Selects the shapes tool group. The five geometric figures share one app tool name and differ only by their figure, so U keeps whichever of them is active rather than forcing the rectangle; the Custom Shape tool carries its own tool name, and U from there lands on the rectangle. Nothing happens until an image is open.

**In this app:** `placeholder` — Registered, selectable, and a dead button. The processor row declares commit: 'unimplemented' and wires the shared unimplemented rasterizer, the tools map renders PlaceholderTool with a TODO badge, and the only state the settings hold is the tool name — no shape preset, no fill, no geometry. The placeholder panel does list Photoshop’s real control names for this bar, so the six chips a user sees are the genuine Photoshop set rather than placeholders for placeholders: Tool Mode, Fill, Stroke, W/H, Shape Picker, Path Operations. That is why those six rows read `inert` and not `missing` — the names are on screen and nothing is wired behind any of them, which is the exact shape the `inert` status exists for. The three rows that were `partial` above are also `missing` rather than partial, but for the opposite reason: Stroke width, Stroke type and Opacity have no chip in this tool's list at all, and the real shape bar that carries them never renders here, because this tool is absent from the canvas dispatch that gives the other six figures their gesture surface. It is a `display: none` area, so the three modifiers named above — Shift, Alt and Space — are bound to nothing either, and the app’s Shift constraint, which squares the drag box for every figure except the line, has no drag to apply to. Subtract needs a multi-subpath model with a fill rule, which a single convex outline cannot express, so the boolean operations are not a bar toggle away; they are a data-model decision first.

Implementation:

- `src/tools/toolProcessors.ts:333`
- `src/tools/toolProcessors.ts:109`
- `src/tools/toolsMap.ts:161`
- `src/components/Main/Main.tsx:67`
- `src/tools/settings.ts:300`
- `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:28`

Sources:

- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/draw-custom-shapes.html>
- <https://www.photoshopessentials.com/basics/how-to-draw-custom-shapes-in-photoshop/>
- <https://www.adobe.com/products/photoshop/shapes.html>
- <https://tonton-pixel.codeberg.page/photoshop-file-formats/custom-shapes-file-format.html>
- <https://www.makeuseof.com/photoshop-path-operations-add-subtract-intersect-exclude/>
- <https://www.pcworld.com/article/399355/photoshop-shapes-what-they-are-and-how-to-use-them.html>
- <https://community.adobe.com/questions-712/where-do-i-get-photoshop-custom-shapes-it-needs-csh-files-1137992>
- <https://glensmith.co.uk/photoshop/custom-shape-tool>

---

### Shape Tool

`shape`

Draws a vector shape, a path, or a filled pixel region, and stamps it onto its own shape layer.

The Shape tool is the group every geometric figure hangs off in the Tools panel: press U and you get the rectangle, hold U and the fly-out offers the triangle, ellipse, line, polygon and custom shape — and, in the current release, a separate star. Whichever figure is active, the three-button Mode group at the left of the options bar decides what a drag commits — a filled shape layer with a vector mask, a work path with no pixels at all, or a rasterized region painted straight into the active layer. Fill and Stroke are set independently of each other and of the drawing mode, so the same rectangle can be a solid block, a hairline outline, or an outline over a gradient. The drawn shape stays a Live Shape, so its fill, stroke, corner radius and dimensions remain editable from the Properties panel long after the drag.

**Options bar**

| Control                               | Photoshop                                                                                                                                                                                                                                                                                                                                                                                                                            | In this app                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Mode                                  | The three-button drawing-mode group: Shape creates a filled shape layer, Path creates a vector path with no pixels, and Pixels rasterizes the shape straight into the current layer. Shape is the default.                                                                                                                                                                                                                           | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:129` |
| Fill                                  | The interior colour of the shape, as a swatch offering None, Solid Color, Gradient or Pattern. Fill and Stroke are independent: a shape can have a fill and no stroke, or the reverse.                                                                                                                                                                                                                                               | `partial` — `src/tools/shape.ts:144`                             |
| Stroke                                | The colour of the outline, as a second swatch with the same None / Solid Color / Gradient / Pattern choices. Set it to None to draw a fill with no outline.                                                                                                                                                                                                                                                                          | `partial` — `src/tools/shape.ts:143`                             |
| Stroke width                          | Thickness of the stroke in pixels. Photoshop adds a 1 px black stroke by default.                                                                                                                                                                                                                                                                                                                                                    | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:153` |
| Stroke type                           | Opens the Stroke Options panel, which sets the line style (Solid, Dashed or Dotted, plus a custom dash array under More Options), the stroke Align (Inside, Center or Outside), the end Caps (Butt, Round, Square) and the corner joins (Miter, Round, Bevel). Centered alignment and a solid line are the defaults.                                                                                                                 | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:219` |
| Weight                                | Thickness in pixels of the on-screen path outline shown while dragging. It is a display aid only, not the stroke: it never prints and never appears in a saved image.                                                                                                                                                                                                                                                                | `missing`                                                        |
| Opacity                               | Pixel mode only: transparency of the rasterized shape, 1–100%. Shape and Path modes expose no Opacity slider, because a shape layer and a path have no opacity of their own.                                                                                                                                                                                                                                                         | `partial` — `src/components/ToolbarsRight/Figures/Shape.tsx:284` |
| Mode                                  | Pixel mode only: the blend mode the rasterized shape composites with, from the full layer blend-mode list. Shape and Path modes have no blend mode.                                                                                                                                                                                                                                                                                  | `missing`                                                        |
| Anti-alias                            | Pixel mode only: smooths the shape edges when rasterizing. Photoshop applies it automatically, so it has no meaningful unchecked state in practice.                                                                                                                                                                                                                                                                                  | `missing`                                                        |
| Path Operations                       | How a new shape combines with the shapes already on the selected vector mask: New Shape Layer, Combine Shapes, Subtract Front Shape, Intersect Shape Areas, or Exclude Overlapping Shapes, with Merge Shape Components available afterwards. The subtract entry is labelled Subtract Front Shape in Adobe Community and Subtract From Shape Area in Adobe’s 2022 wording; no single Adobe page opened here enumerates the whole set. | `missing`                                                        |
| Path Arrangement                      | Stacking order of the shapes on a vector mask: bring to front, bring forward, send backward, send to back.                                                                                                                                                                                                                                                                                                                           | `missing`                                                        |
| Path Alignment                        | Align and distribute the path components of the selected vector mask against one another.                                                                                                                                                                                                                                                                                                                                            | `missing`                                                        |
| Set additional shape and path options | The gear at the right of the bar. Holds the on-screen Path Options (path colour and width), the Live Shapes controls, the Import Shapes command and the per-tool geometry options such as Unconstrained, Square, Circle, Fixed Size, Proportional, From Center and Equilateral. The per-tool settings Adobe documents in the Contextual Task Bar are not in it.                                                                      | `missing`                                                        |
| Shape W&H                             | Exact width and height for the next shape. The app does ask for them, but it asks with two sequential `window.prompt` calls — Width, then Height — rather than a dialog, so there is no Corner Radius field and no From Center anywhere in that path, and a dismissed prompt or a value of zero or less commits nothing at all.                                                                                                      | `partial` — `src/components/Main/ShapeToolArea.tsx:181`          |

**Modifiers**

- **Shift** — Constrains the drag to a square drag box, which is a square for the Rectangle tool and a circle for the Ellipse tool.
- **Alt** — Draws from the centre outward, so the press point is the middle of the shape rather than one corner.
- **Space** — Repositions the shape while the drag is still in progress, without changing its size.

**Shortcuts**

- `U` — Selects the shapes tool group. The five geometric figures share one app tool name and differ only by their figure, so U keeps whichever of them is active rather than forcing the rectangle; the Custom Shape tool carries its own tool name, and U from there lands on the rectangle. Nothing happens until an image is open.
- `Shift+U` — Cycles to the next tool in the shapes tool group, through the four the app’s cycle holds: rectangle, ellipse, line and Custom Shape. The Triangle and the Polygon are in the rail’s flyout but not in the cycle, and an unlisted figure does not skip ahead — Shift+U from either of them restarts at the rectangle instead of advancing.

**In this app:** `partial` — The processor is live and every drag commits a layer, so nothing here is a placeholder, but the group diverges from Photoshop in three ways worth naming. Path mode does not create a path: the mode only suppresses the fill inside the rasterizer, so a Path-mode shape still rasterizes to a layer with a stroke. Pixels mode is byte-identical to Shape mode, because everything is already a raster. And the options bar shares one colour with the rest of the app rather than carrying its own Fill and Stroke swatches, so the fill is whatever the global background colour currently is and there is no way to turn the stroke off at all.

Implementation:

- `src/tools/toolProcessors.ts:158`
- `src/tools/shape.ts:239`
- `src/tools/shape.ts:71`
- `src/components/ToolbarsRight/Figures/Shape.tsx:20`
- `src/tools/toolsMap.ts:62`

Sources:

- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html>
- <https://helpx.adobe.com/photoshop/using/modify-shapes.html>
- <https://helpx.adobe.com/photoshop/using/draw-and-edit-shapes-web.html>
- <https://www.photoshopessentials.com/basics/how-to-draw-shapes-with-the-shape-tools/>
- <https://www.photoshopessentials.com/basics/how-to-draw-custom-shapes-in-photoshop/>

---

## Pen and path

Long-form research, provenance and unverified claims: [`src/tools/descriptions/pen.notes.md`](../src/tools/descriptions/pen.notes.md).

### Pen Tool

`pen` · **P**

Draws precise vector paths from click-placed anchor points, with draggable direction handles for the curves between them.

The Pen tool builds a path of straight and curved segments by clicking to place anchor points and dragging to pull out the direction handles that shape each curve. It draws no pixels: Path mode creates a work path in the Paths panel, which draws nothing on the canvas and can be stroked, filled or loaded as a selection later. The drawing mode group decides which of those you get — Shape makes a filled, stroked shape layer, Path makes the work path, Pixels rasterizes straight onto the current layer. Every path-construction decision the tool makes is a decision about vector geometry, which is why it stays sharp at any zoom and survives scaling that would blur a painted line.

**Options bar**

| Control                   | Photoshop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | In this app                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Mode                      | The three-button drawing-mode group at the left of the bar, and the control that decides what the rest of the bar shows. The current Pen settings page tabulates the values as Shape, Path and Pixels, and Adobe’s older drawing page names the same three buttons Shape Layers, Paths and Fill Pixels. Shape creates a shape layer with a vector mask; Path creates a work path that can be stroked or filled later; Pixels creates a rasterized shape directly on the current layer. The Fill, Stroke and Stroke width controls exist in Shape mode; the Operation, Path arrangement and Path alignment controls exist in Path mode. The app names this chip "Tool Mode". | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14` |
| Fill                      | Fill color: a swatch that sets the color, pattern or gradient used to fill the shape, and can be set to None. Shape mode only. Double-clicking the swatch opens the color menu.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14` |
| Stroke                    | Stroke color: a swatch setting the color of the shape outline, with a width and a stroke type (solid, dashed or dotted, with Inside/Center/Outside alignment, Butt/Round/Square caps and a corner treatment). Shape mode only.                                                                                                                                                                                                                                                                                                                                                                                                                                              | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14` |
| Operation                 | Path mode only. The path area option that decides how the component you are about to draw combines with the components already in the path: Add To Path Area, Subtract From Path Area, Intersect Path Areas, or Exclude Overlapping Path Areas. A shape tool may hold Shift to temporarily pick Add and Alt (Windows) or Option (macOS) to temporarily pick Subtract. The app labels this "Path Operations".                                                                                                                                                                                                                                                                | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14` |
| Path Operations           | The Path Selection tool’s drop-down of the same four overlap modes, named Combine Shapes, Subtract From Shape Area, Intersect Shape Areas and Exclude Overlapping Shape Areas, plus Merge Shape Components, which fuses every overlapping component into one. It acts on an existing path component rather than on the one being drawn, so the Pen family shares the vocabulary without owning the control.                                                                                                                                                                                                                                                                 | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14` |
| Path alignment            | Align and distribute path components, the same way the alignment controls work for layers: align selected components, or distribute at least three. The app labels this "Alignment".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14` |
| Path arrangement          | The stacking order used when several paths are present, so that a later path draws over an earlier one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `missing`                                                               |
| Path thickness (Weight)   | Sets the width in pixels of the on-canvas line that represents the path. A display aid only: it has no effect on a stroke applied later, and on the pen family it lives in the Set additional pen and path options flyout, where newer releases label it Weight.                                                                                                                                                                                                                                                                                                                                                                                                            | `missing`                                                               |
| Selection… / Mask / Shape | The group at the right end of the bar that converts the path you have already drawn: Selection… loads it as a selection through the Make Selection dialog (which is where feathering and anti-aliasing are set), Mask turns it into a vector mask, and Shape fills it into a new shape layer. These act on the current path, not on the next one you draw. The app names this chip "Make Selection".                                                                                                                                                                                                                                                                        | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14` |
| Auto Add/Delete           | A checkbox, on by default, that makes the Pen tool morph as you move over an existing path: over a segment it becomes the Add Anchor Point tool, over an anchor point it becomes the Delete Anchor Point tool. It also stops selecting an anchor point from changing the shape of the path. Deselect it to start a new path on top of an existing one.                                                                                                                                                                                                                                                                                                                      | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14` |
| Rubber Band               | Live preview of the segment you are about to commit, drawn between the pointer and the pending anchor point as you move, so you can see the path before you click. Lives in the Set additional pen and path options flyout at the right of the bar.                                                                                                                                                                                                                                                                                                                                                                                                                         | `missing`                                                               |

**Modifiers**

- **Shift** — Constrains the segment being placed to 45-degree angles.
- **Alt** — Converts a smooth point to a corner point when you click it, and unhinges a direction handle from its opposite so you can set the two independently while dragging a curve.

**Shortcuts**

- `P` — Selects the Pen tool, or keeps whichever Pen-family tool is already active — with the Freeform Pen or the Curvature Pen selected, P selects that one rather than jumping back to the Pen. Nothing happens until an image is open.
- `Shift+P` — Cycles through the tools nested in the Pen group.
- `Ctrl+Enter` — Loads the current path as a selection, the same as the Load path as a selection button at the bottom of the Paths panel.
- `Ctrl+Alt` — Activates the Convert Point tool temporarily while the Direct Selection tool is selected, when the pointer is over an anchor point.

**In this app:** `placeholder` — Not implemented. The processor exists but is the shared stub that returns a null bitmap, and its commit kind is unimplemented, so a drag over the canvas produces no layer, no history state and no durable operation. The app registers this tool, but it has no options bar of its own: the panel it renders is the shared amber placeholder with a TODO badge, and every control below is that placeholder chip rather than a working control. The tool carries a single state key, its own name, so there is no setting behind any chip to be out of range. Selecting the tool changes nothing on the canvas — there is no path layer, no anchor point and no stroke to place. It has no gesture surface either. The canvas dispatch turns a tool name into an interaction mode and names none of the six Pen tools in any of its branches, so all six mount the dummy tool area — a `display: none` div — instead of a canvas handler. There is no drag for a modifier to change and no path for a key to act on, which is why none of the modifiers or shortcuts above is bound: the app registers no `Escape` for this family, and the only four `Escape` handlers bound to a tool anywhere in it belong to the lasso (twice), the font picker and the transform box. The app does bind the letter P and Shift+P cycling for the Pen group — and those two keys are the whole of the Pen's Photoshop chrome here, along with a tool-preset entry for the tool. Neither of the two shortcuts the bar above names that act on a path, `Ctrl+Enter` and `Ctrl+Alt`, is bound anywhere in the app.

Implementation:

- `src/tools/toolProcessors.ts:299`
- `src/tools/toolProcessors.ts:109`
- `src/tools/toolsMap.ts:127`
- `src/components/ToolbarsRight/ToolbarPlaceholder.tsx:8`
- `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14`
- `src/tools/settings.ts:259`
- `src/contexts/tool-types.ts:57`
- `src/util/settings.ts:81`
- `src/components/Main/Main.tsx:195`
- `src/components/Common/AppKeyboardShortcuts.tsx:387`
- `src/components/ToolbarsRight/__tests__/ToolbarPlaceholder.test.tsx:33`
- `src/tools/__tests__/tool-processors.test.ts:336`

Sources:

- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/overview-of-pen-tool-settings.html>
- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/draw-paths-with-the-pen-tool.html>
- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html>
- <https://helpx.adobe.com/photoshop/using/editing-paths.html>
- <https://helpx.adobe.com/photoshop/using/paths.html>
- <https://helpx.adobe.com/photoshop/using/tool-techniques/pen-tool.html>
- <https://helpx.adobe.com/photoshop/using/drawing.html>
- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html>
- <https://www.adobe.com/products/photoshop/pen-tool.html>

---

### Freeform Pen Tool

`freeform-pen`

Draws a path freehand, placing anchor points and fitting bezier handles to the stroke as you drag instead of clicking them one at a time.

The Freeform Pen takes a single drag and turns it into a path, so it is the tool for tracing something by hand rather than plotting it. The raw trail is simplified on release into as few anchor points as fit it, mixing straight corner points with curved ones. Turn on Magnetic and the trail stops following your hand and starts following the image: the live segment snaps to the strongest edge within Width, and fastening points are dropped along the border to anchor what you have already traced. It is the one Pen-family tool you can pick up in a photograph and use immediately, and the one to reach for when the precision of the standard Pen is more than the job needs.

**Options bar**

| Control                   | Photoshop                                                                                                                                                                                                                                                                                                                                                  | In this app                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Mode                      | The same three-button drawing-mode group as the standard Pen — Shape, Path, Pixels — and the control that decides what the rest of the bar shows. The app names this chip "Tool Mode".                                                                                                                                                                     | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14` |
| Fill                      | Fill color for the shape. Shape mode only.                                                                                                                                                                                                                                                                                                                 | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14` |
| Stroke                    | Stroke color, width and type for the shape outline. Shape mode only.                                                                                                                                                                                                                                                                                       | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14` |
| Curve Fit                 | A single numeric field, 0.5 to 10 pixels, that sets the tolerance the fitted path is simplified to: a low value follows your hand closely and yields a dense, spiky path with many anchor points, a high value yields a coarse one with few. It is one number, not a menu of fit styles. Enter it from the inverted-arrow flyout beside the shape buttons. | `missing`                                                               |
| Magnetic                  | The checkbox that turns edge snapping on. With it off the tool is a plain freehand pen; with it on, the last active segment snaps to the strongest edge in the image, using the same Width / Contrast / Frequency / Stylus Pressure controls the Magnetic Lasso documents. The cursor carries a magnet while it is active.                                 | `missing`                                                               |
| Align Edges               | The neighboring control in the same flyout, which straightens a traced segment against the edge it snapped to. It is unavailable while the Freeform Pen is the active tool.                                                                                                                                                                                | `missing`                                                               |
| Selection… / Mask / Shape | The group at the right end of the bar that converts the path you have already drawn into a selection, a vector mask or a shape layer. The app names this chip "Make Selection".                                                                                                                                                                            | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14` |
| Rubber Band               | Live preview of the pending path segment. Lives in the Set additional pen and path options flyout.                                                                                                                                                                                                                                                         | `missing`                                                               |

**Shortcuts**

- `P` — Selects the Pen tool, or keeps the Freeform Pen if it is the Pen-family tool already active. P never selects the Freeform Pen from another tool — from anywhere outside the three pens it is the Pen tool that comes up.
- `Shift+P` — Cycles through the tools nested in the Pen group.

**In this app:** `placeholder` — Not implemented, and the placeholder config is itself wrong for this tool in a way a test pins. The chip list the Freeform Pen actually renders is the standard Pen's — the config entry written for the Freeform Pen, with its Magnetic and Curve Fit chips, is dead configuration that no tool reaches, and a test asserts that it stays dead. So the two controls that are this tool's entire reason for existing are the two it does not even name in its bar. The app registers this tool, but it has no options bar of its own: the panel it renders is the shared amber placeholder with a TODO badge, and every control below is that placeholder chip rather than a working control. The tool carries a single state key, its own name, so there is no setting behind any chip to be out of range. Selecting the tool changes nothing on the canvas — there is no path layer, no anchor point and no stroke to place. It has no gesture surface either. The canvas dispatch turns a tool name into an interaction mode and names none of the six Pen tools in any of its branches, so all six mount the dummy tool area — a `display: none` div — instead of a canvas handler. There is no drag for a modifier to change and no path for a key to act on, which is why none of the modifiers or shortcuts above is bound: the app registers no `Escape` for this family, and the only four `Escape` handlers bound to a tool anywhere in it belong to the lasso (twice), the font picker and the transform box.

Implementation:

- `src/tools/toolProcessors.ts:303`
- `src/tools/toolProcessors.ts:109`
- `src/tools/toolsMap.ts:131`
- `src/components/ToolbarsRight/ToolbarPlaceholder.tsx:8`
- `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:15`
- `src/tools/settings.ts:260`
- `src/contexts/tool-types.ts:58`
- `src/util/settings.ts:82`
- `src/components/Main/Main.tsx:195`
- `src/components/ToolbarsRight/__tests__/ToolbarPlaceholder.test.tsx:150`
- `src/components/Common/AppKeyboardShortcuts.tsx:32`

Sources:

- <https://www.adobe.com/products/photoshop/pen-tool.html>
- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/overview-of-pen-tool-settings.html>
- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html>
- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html>
- <https://helpx.adobe.com/photoshop/using/paths.html>

---

### Curvature Pen Tool

`curvature-pen`

Draws smooth curved paths from plain clicks, computing the curve for you so there are no direction handles to manage at all.

The Curvature Pen is Illustrator’s Curvature tool ported into Photoshop, and it exists to remove the part of the standard Pen people find hardest. You click to place points; Photoshop fits the curve through them and keeps fitting as you add more, so a path is a sequence of smooth points and you never see, drag or think about a bezier handle. You shape it by pushing and pulling whole segments, and you switch one point between straight and curved with a double-click. Because the fit is continuous it will not give you the deliberately angular corner the standard Pen can, nor the deliberately flat run of a long handle; it is for the organic outline, and the standard Pen for everything else. It arrived in Photoshop CC 2018 (19.0) and is the newest tool in this family.

**Options bar**

| Control                   | Photoshop                                                                                                                                                                                                                                         | In this app                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Mode                      | The same three-button drawing-mode group as the standard Pen — Shape, Path, Pixels — and the control that decides what the rest of the bar shows. The app names this chip "Tool Mode".                                                            | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14` |
| Fill                      | Fill color for the shape, and it is set to None for the tracing workflow the tool is usually used in. Shape mode only.                                                                                                                            | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14` |
| Stroke                    | Stroke color, width and type for the shape outline, also set to None for pure path tracing. Shape mode only.                                                                                                                                      | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14` |
| Path thickness (Weight)   | The gear icon in the options bar opens the Path Options flyout, where the width and color of the on-canvas line representing the path are set. A display aid only: it changes nothing about the path and has no effect on a stroke applied later. | `missing`                                                               |
| Align Edges               | The neighboring control in that flyout, which straightens a segment against the edge it snapped to. It is reported as unavailable while the Curvature Pen is the active tool.                                                                     | `missing`                                                               |
| Selection… / Mask / Shape | The group at the right end of the bar that converts the path you have already drawn into a selection, a vector mask or a shape layer. The app names this chip "Make Selection".                                                                   | `inert` — `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14` |
| Rubber Band               | Live preview of the pending path, so the curve Photoshop is about to fit is visible before you click.                                                                                                                                             | `missing`                                                               |

**Shortcuts**

- `P` — Selects the Pen tool, or keeps the Curvature Pen if it is the Pen-family tool already active. P never selects the Curvature Pen from another tool — from anywhere outside the three pens it is the Pen tool that comes up.
- `Shift+P` — Cycles through the tools nested in the Pen group.
- `Esc` — Stops drawing the current path.

**In this app:** `placeholder` — Not implemented, and the placeholder config is wrong for this tool the same way it is wrong for the Freeform Pen: the chip list this tool renders is the standard Pen's, and the config entry written for the Curvature Pen is dead configuration that no tool reaches. That entry also lists Magnetic and Curve Fit, which are the Freeform Pen's controls and not this tool's. The app registers this tool, but it has no options bar of its own: the panel it renders is the shared amber placeholder with a TODO badge, and every control below is that placeholder chip rather than a working control. The tool carries a single state key, its own name, so there is no setting behind any chip to be out of range. Selecting the tool changes nothing on the canvas — there is no path layer, no anchor point and no stroke to place. It has no gesture surface either. The canvas dispatch turns a tool name into an interaction mode and names none of the six Pen tools in any of its branches, so all six mount the dummy tool area — a `display: none` div — instead of a canvas handler. There is no drag for a modifier to change and no path for a key to act on, which is why none of the modifiers or shortcuts above is bound: the app registers no `Escape` for this family, and the only four `Escape` handlers bound to a tool anywhere in it belong to the lasso (twice), the font picker and the transform box. `Esc` is named above as Photoshop’s way of stopping a path, and the app binds no `Escape` for this tool or any other in the family: its four `Escape` handlers belong to the lasso (twice), the font picker and the transform box.

Implementation:

- `src/tools/toolProcessors.ts:308`
- `src/tools/toolProcessors.ts:109`
- `src/tools/toolsMap.ts:136`
- `src/components/ToolbarsRight/ToolbarPlaceholder.tsx:8`
- `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:16`
- `src/tools/settings.ts:261`
- `src/contexts/tool-types.ts:59`
- `src/util/settings.ts:83`
- `src/components/Main/Main.tsx:195`
- `src/components/ToolbarsRight/__tests__/ToolbarPlaceholder.test.tsx:150`
- `src/components/Common/AppKeyboardShortcuts.tsx:32`

Sources:

- <https://helpx.adobe.com/ph_fil/photoshop/how-to/draw-edit-curves-curvature-tool.html>
- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/draw-lines-curves/shape-path-and-pixel-mode-options.html>
- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html>
- <https://helpx.adobe.com/photoshop/using/editing-paths.html>
- <https://www.photoshopessentials.com/basics/use-curvature-pen-tool-photoshop-cc-2018>
- <https://photoshoptrainingchannel.com/photoshop-cc-2018-tutorials>
- <https://www.creativebloq.com/news/photoshop-to-launch-new-curvature-pen-tool>
- <https://www.adobe.com/products/photoshop/pen-tool.html>

---

### Add Anchor Point Tool

`add-anchor-point`

Inserts an anchor point into an existing path exactly where you click on a segment.

The Add Anchor Point tool subdivides a path. It only means anything against a path that already exists and is selected in the Paths panel, which is why it is a Tools-panel entry rather than a mode of the Pen: the standard Pen reaches the same result on its own when Auto Add/Delete is on, and this tool is the explicit version for when you want to add a point without switching tools mid-drag. Clicking a segment inserts a point there; dragging while you click reshapes the path as you add, so you can bend the line and place the new point in one gesture. The point it adds is a smooth point with direction handles, which is why the segments either side of it can change shape rather than merely being cut in two.

_Photoshop gives this tool no options bar of its own._

**In this app:** `placeholder` — Not implemented. Photoshop documents no options-bar control specific to this tool — selecting it shows the Pen group's bar, so every control on it belongs to the Pen and none is the Add Anchor Point tool's own — which is why its options table is empty. What the app does render is the standard Pen's chip list, on a panel with a TODO badge, over a tool whose registered processor is the same shared stub that returns a null bitmap the whole Pen family uses, over state that is nothing but its own name, and over no Paths panel to select a path in. The app's SidebarLeft gives this tool the same pen-nib icon as the Pen itself, so the three anchor-point tools are visually indistinguishable from it. It has no gesture surface either. The canvas dispatch turns a tool name into an interaction mode and names none of the six Pen tools in any of its branches, so all six mount the dummy tool area — a `display: none` div — instead of a canvas handler. There is no drag for a modifier to change and no path for a key to act on, which is why none of the modifiers or shortcuts above is bound: the app registers no `Escape` for this family, and the only four `Escape` handlers bound to a tool anywhere in it belong to the lasso (twice), the font picker and the transform box. The keyboard is the other half of the gap. The app binds exactly two keys for this family: `P`, which selects the Pen tool or keeps whichever of the three pens is already active, and `Shift+P`, which cycles that same three. The rail’s Pen flyout lists six tools, so the cycle covers three of the six and the three path-modification tools — Add Anchor Point, Delete Anchor Point and Convert Point — are unreachable from any key in the app.

Implementation:

- `src/tools/toolProcessors.ts:313`
- `src/tools/toolProcessors.ts:109`
- `src/tools/toolsMap.ts:141`
- `src/components/ToolbarsRight/ToolbarPlaceholder.tsx:8`
- `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14`
- `src/tools/settings.ts:262`
- `src/contexts/tool-types.ts:60`
- `src/util/settings.ts:84`
- `src/components/Main/Main.tsx:195`
- `src/components/SidebarLeft/toolIcons.tsx:77`

Sources:

- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html>
- <https://helpx.adobe.com/photoshop/using/editing-paths.html>

---

### Delete Anchor Point Tool

`delete-anchor-point`

Removes the anchor point you click from an existing path, and the two segments around it re-solve.

The Delete Anchor Point tool takes a point out of a path that already exists and is selected in the Paths panel. The consequence is the interesting part: the two segments that met at the removed point do not simply join end to end, they are re-fitted across the new span, so deleting a point from a curve usually changes the curve and can smooth out the kink that point was holding. It is the counterpart to the Add Anchor Point tool and, like it, mostly exists so the Pen family is not a three-tool round trip for every edit; the standard Pen reaches it on its own when Auto Add/Delete is on. Note the trap Adobe calls out: the keyboard Delete key is not this tool. It removes the point and the segments joined to it, splitting the path in two.

_Photoshop gives this tool no options bar of its own._

**In this app:** `placeholder` — Not implemented. Photoshop documents no options-bar control specific to this tool — selecting it shows the Pen group's bar, so every control on it belongs to the Pen and none is the Delete Anchor Point tool's own — which is why its options table is empty. What the app does render is the standard Pen's chip list, on a panel with a TODO badge, over a tool whose registered processor is the same shared stub that returns a null bitmap the whole Pen family uses, over state that is nothing but its own name, and over no Paths panel to select a path in. The app's SidebarLeft gives this tool the same pen-nib icon as the Pen itself. It has no gesture surface either. The canvas dispatch turns a tool name into an interaction mode and names none of the six Pen tools in any of its branches, so all six mount the dummy tool area — a `display: none` div — instead of a canvas handler. There is no drag for a modifier to change and no path for a key to act on, which is why none of the modifiers or shortcuts above is bound: the app registers no `Escape` for this family, and the only four `Escape` handlers bound to a tool anywhere in it belong to the lasso (twice), the font picker and the transform box. The keyboard is the other half of the gap. The app binds exactly two keys for this family: `P`, which selects the Pen tool or keeps whichever of the three pens is already active, and `Shift+P`, which cycles that same three. The rail’s Pen flyout lists six tools, so the cycle covers three of the six and the three path-modification tools — Add Anchor Point, Delete Anchor Point and Convert Point — are unreachable from any key in the app.

Implementation:

- `src/tools/toolProcessors.ts:318`
- `src/tools/toolProcessors.ts:109`
- `src/tools/toolsMap.ts:146`
- `src/components/ToolbarsRight/ToolbarPlaceholder.tsx:8`
- `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14`
- `src/tools/settings.ts:263`
- `src/contexts/tool-types.ts:61`
- `src/util/settings.ts:85`
- `src/components/Main/Main.tsx:195`
- `src/components/SidebarLeft/toolIcons.tsx:78`

Sources:

- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html>
- <https://helpx.adobe.com/photoshop/using/editing-paths.html>

---

### Convert Point Tool

`convert-point`

Converts an anchor point between corner and smooth, with or without independent direction lines.

The Convert Point tool changes the type of a point on a path that already exists and is selected in the Paths panel, and a single drag does three different things depending on what you grabbed. Drag away from a corner point and direction lines appear, making it a smooth point whose handles you then shape. Click a smooth point and it becomes a corner point with no direction lines, so the segments either side leave it independently. Drag one of a smooth point’s direction points and the point stays smooth but the two handles are unhinged, so they can point in different directions — which is what produces an S-curve. The Pen reaches all three with Alt held, and with the Direct Selection tool selected, Ctrl+Alt (Windows) or Command+Option (macOS) over an anchor point reaches this tool without leaving that tool.

_Photoshop gives this tool no options bar of its own._

**Shortcuts**

- `Ctrl+Alt` — Activates the Convert Point tool temporarily while the Direct Selection tool is selected and the pointer is over an anchor point.

**In this app:** `placeholder` — Not implemented. Photoshop documents no options-bar control specific to this tool — selecting it shows the Pen group's bar, so every control on it belongs to the Pen and none is the Convert Point tool's own — which is why its options table is empty. What the app does render is the standard Pen's chip list, on a panel with a TODO badge, over a tool whose registered processor is that same shared null-bitmap stub and over state that is nothing but its own name. This is also one of the tools the durable document refuses: converting a history item that names it is rejected as an unsupported feature rather than silently replayed. It has no gesture surface either. The canvas dispatch turns a tool name into an interaction mode and names none of the six Pen tools in any of its branches, so all six mount the dummy tool area — a `display: none` div — instead of a canvas handler. There is no drag for a modifier to change and no path for a key to act on, which is why none of the modifiers or shortcuts above is bound: the app registers no `Escape` for this family, and the only four `Escape` handlers bound to a tool anywhere in it belong to the lasso (twice), the font picker and the transform box. `Ctrl+Alt` is named above as the way to reach this tool from the Direct Selection tool, and the app registers no Alt-bearing keybinding at all: the four tools that read `altKey` are the shape tool, the elliptical marquee, the clone stamp and the magnetic lasso, none of which is in this family. The keyboard is the other half of the gap. The app binds exactly two keys for this family: `P`, which selects the Pen tool or keeps whichever of the three pens is already active, and `Shift+P`, which cycles that same three. The rail’s Pen flyout lists six tools, so the cycle covers three of the six and the three path-modification tools — Add Anchor Point, Delete Anchor Point and Convert Point — are unreachable from any key in the app.

Implementation:

- `src/tools/toolProcessors.ts:323`
- `src/tools/toolProcessors.ts:109`
- `src/tools/toolsMap.ts:151`
- `src/components/ToolbarsRight/ToolbarPlaceholder.tsx:8`
- `src/components/ToolbarsRight/toolbarPlaceholderConfig.ts:14`
- `src/tools/settings.ts:264`
- `src/contexts/tool-types.ts:62`
- `src/util/settings.ts:86`
- `src/components/Main/Main.tsx:195`
- `src/components/SidebarLeft/toolIcons.tsx:79`
- `src/contexts/__tests__/history-adapter.tool-conversion.test.ts:242`

Sources:

- <https://helpx.adobe.com/photoshop/desktop/draw-shapes-paths/create-shapes/drawing-tools-overview.html>
- <https://helpx.adobe.com/photoshop/using/editing-paths.html>
- <https://helpx.adobe.com/illustrator/using/tool-techniques/pen-tool.html>

---

## Type and crop

Long-form research, provenance and unverified claims: [`src/tools/descriptions/type-crop.notes.md`](../src/tools/descriptions/type-crop.notes.md).

### Crop Tool

`crop` · **C**

Frames a new boundary for the photo; nothing is committed until you confirm, and Esc restores the old framing.

A crop sets a new boundary for the document. Selecting the Crop tool shows a crop box you can drag out, resize by its handles, and rotate by dragging outside a corner; dragging inside the box moves the image while the box stays where it is, and dragging outside repositions the box without moving the image. Nothing is committed until you confirm with Enter, Return, the check mark, or a double-click inside the box, and Esc restores the framing you had before. Photoshop treats the crop as non-destructive until that commit, and it is only irreversible once the commit happens with Delete Cropped Pixels on. This describes Photoshop 2024-2026, where Straight Crop is the tool's default mode and Perspective Crop is a separate tool in the same flyout rather than a mode of this one.

**Options bar**

| Control                                      | Photoshop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | In this app                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Aspect ratio menu                            | The leftmost control, holding Ratio, W x H x Resolution, Original Ratio, 1 : 1 (Square), 4 : 5 (8 : 10), 5 : 7, 2 : 3 (4 : 6), 16 : 9 and Front Image, plus New Crop Preset to save the current values and Delete Crop Preset to remove a saved one. Adobe names the first entry Ratio, not "Free", and defines it as cropping freely without a fixed ratio; clearing the two Width and Height fields is what returns the tool to unconstrained.                                                       | `partial` — `src/components/ToolbarsRight/Crop/Crop.tsx:61` |
| Swap Width and Height values                 | The double-arrow button beside the Width and Height fields, which swaps them and so changes the crop orientation without changing its size. Adobe states it directly: "To swap Width and Height values, click the Swap icon in the options bar." The older `Rotate Crop Box` button it replaced is gone, and the `X` key does the same swap.                                                                                                                                                           | `missing`                                                   |
| Straighten / Curve / Content-Aware / Default | The row of crop variants under the ratio menu. Straighten takes a dragged reference line and rotates the image inside the box to match it; Curve is the adjustable form; Content-Aware is the fill variant; Default returns to an unrotated crop. Holding Ctrl (Windows) or Command (Mac OS) reaches Straighten without visiting the bar.                                                                                                                                                              | `missing`                                                   |
| Fill                                         | What the area the crop adds outside the photo is filled with: None, Content-Aware Fill, Background, Foreground Color, Black, 50% Gray or White. Choosing Content-Aware Fill is what lets the crop box extend past the image edge and synthesize the gap instead of leaving it transparent; it requires Use Classic Mode to be off.                                                                                                                                                                     | `missing`                                                   |
| Delete Cropped Pixels                        | Decides whether a committed crop is reversible. On, it permanently removes everything outside the crop; off, the pixels are kept and the canvas simply shrinks. Adobe states the setting only as "Permanently removes areas outside the crop, but allows editing when turned off" — the on-by-default state, the Background layer being demoted so Photoshop can hold the hidden pixels, the Image > Reveal All route back and the resulting file growth are third-party observations, not Adobe text. | `missing`                                                   |
| Show Cropped Area                            | Displays the cropped-out area as a shaded overlay inside the crop box.                                                                                                                                                                                                                                                                                                                                                                                                                                 | `missing`                                                   |
| Enable Crop Shield                           | Applies a color overlay outside the crop area, with a customizable color and opacity. The shield darkens the parts of the canvas the crop will discard.                                                                                                                                                                                                                                                                                                                                                | `partial` — `src/hooks/useRect.ts:167`                      |
| Use Classic Mode                             | Reverts the tool to the legacy behavior from before Creative Cloud 2019, in which the crop box itself rotates; the modern mode rotates the image inside a stationary box.                                                                                                                                                                                                                                                                                                                              | `missing`                                                   |
| Auto Center Preview                          | Keeps the image centered in the document while the crop area is being adjusted.                                                                                                                                                                                                                                                                                                                                                                                                                        | `missing`                                                   |
| Overlay                                      | Chooses the composition guide drawn inside the crop box. Rule of Thirds is the default; the full set is Rule of Thirds, Grid, Diagonal, Triangle, Golden Ratio and Golden Spiral, and O cycles through them.                                                                                                                                                                                                                                                                                           | `missing`                                                   |
| Grid                                         | Draws a uniform grid of a chosen number of divisions inside the crop box, for aligning to a subject rather than to a composition rule.                                                                                                                                                                                                                                                                                                                                                                 | `missing`                                                   |
| Done / Cancel                                | The check mark and the cancel cross below the crop box. Done commits the crop, which is also Enter (Windows) or Return (Mac OS) and a double-click inside the box; Cancel discards it, which is also Esc.                                                                                                                                                                                                                                                                                              | `partial` — `src/components/ToolbarsRight/Crop/Crop.tsx:79` |

**Modifiers**

- **Shift** — Constrains the crop box to the proportions it already has while a handle is dragged, instead of letting the drag set them freely.
- **Alt** — Draws and resizes the crop box outward from its center, so the opposite edge moves as well.
- **Alt+Shift** — Constrains the proportions and draws from the center at the same time.

**Shortcuts**

- `C` — Select the Crop tool.

**In this app:** `partial` — The app's crop edits the document frame rather than a tool layer. applyDocumentCrop trims the rect to the canvas, converts it into the next documentFrame, and dispatches a SET_DOCUMENT_FRAME_ACTION history entry, so the document shrinks at once and everything outside the new frame stops rendering. The layer positions and sources are untouched, so the discarded pixels are still held in the layer bitmaps, and the history entry carries the previous frame, so undo brings the area back. That is Photoshop's Delete Cropped Pixels OFF case — the canvas shrinks, the pixels are kept — not the ON case, which permanently removes them. What the app genuinely lacks is the setting itself, which it can neither offer nor invert, and the Image > Reveal All menu item, which does not exist anywhere in the app. The rect may be dragged past the image edge, yet trimRect clamps it to the document, so extending a crop cannot add canvas the way Photoshop's Fill control does. Dragging inside the crop box moves the box rather than the image: useRect translates the rect for its inside edge, and CropToolArea never passes a layer under the pointer, so the branch that would pick up the layer never runs. The pending rect is not written through to the persisted settings: the crop arm of the settings saver omits the rect and the pre-ratio rect before persisting, so the aspect ratio survives a tool switch and the draft does not, and switching away from the Crop tool and back discards the draft. That is closer to Photoshop's cancel-on-Escape than to its commit-on-switch. On modifiers, Shift does lock the current aspect ratio, but it is honoured for any modifier the browser reports rather than Shift alone, and there is no Alt from-center drag, so the Alt and Alt+Shift rows of the table above are aspirational. C is the only crop key. The crop tile holds a single entry, so Shift+C re-selects the Crop tool rather than cycling a flyout, and Perspective Crop, Slice and Slice Select are not in the tool registry at all. O and Shift+O are bound to the Dodge and Burn tonal group, so pressing either while cropping switches to another tool instead of cycling an overlay, and there is no overlay control to cycle. No X key is bound anywhere in the app. Backspace and Delete are bound only in the two lasso tool areas, and Enter and Escape only in those same two areas and in the font popup, so the crop registers no key handler of its own and the framing is committed or dropped with the panel's Apply and Clear buttons alone. Ctrl on Windows, or Command on Mac OS, is read by the app for the opposite purpose: it locks the current aspect ratio, which is the behaviour the Shift row describes, and it never invokes a Straighten tool. Finally, the app draws one crop overlay, not two: the mask fills the whole canvas with a fixed 0.7 black and then clears the crop rect, which is a single treatment outside the box, so it can stand in for Enable Crop Shield alone. Photoshop's Show Cropped Area shades the discarded image inside the box, and nothing in the app draws that.

Implementation:

- `src/tools/crop.ts:26`
- `src/components/ToolbarsRight/Crop/Crop.tsx:61`
- `src/components/Main/CropToolArea.tsx:21`
- `src/hooks/useRect.ts:89`
- `src/hooks/useRect.ts:145`
- `src/hooks/useRect.ts:255`
- `src/util/rect.ts:36`
- `src/contexts/useLayer.ts:612`
- `src/tools/settings.ts:62`
- `src/tools/toolProcessors.ts:145`
- `toolbar-mapping.ts:59`

Sources:

- <https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-tool-options.html>
- <https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/crop-photos.html>
- <https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/apply-content-aware-fill-while-cropping-images.html>
- <https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/crop-straighten/transform-perspective-while-cropping.html>
- <https://helpx.adobe.com/photoshop/using/tool-techniques/crop-tool.html>
- <https://helpx.adobe.com/photoshop/using/crop-straighten-photos.html>
- <https://helpx.adobe.com/photoshop-elements/using/cropping.html>
- <https://helpx.adobe.com/in/photoshop/using/new-shortcuts-cs6.html>
- <https://helpx.adobe.com/ph_fil/photoshop/how-to/content-aware-crop-fill.html>
- <https://www.adobe.com/products/photoshop/crop-image.html>
- <https://www.photoshopessentials.com/basics/photoshop-crop-tool-tips-and-tricks>
- <https://creativepro.com/essential-tips-for-cropping-images-photoshop>
- <https://design.tutsplus.com/tutorials/10-things-you-should-know-about-the-crop-tool--psd-34592>

---

### Horizontal Type Tool

`text` · **T**

Creates live, resolution-independent type as a heading, a wrapped paragraph, or type flowing along a path.

Photoshop's Type tools create live, vector-based type: glyph outlines re-rendered from the font, so a type layer stays resolution-independent and editable until you deliberately rasterize it. Clicking places point type, whose lines are independent and never wrap; dragging a bounding box places paragraph type, whose lines wrap and reflow as you resize the box. Type can also flow along an open or closed work path, or fill the inside of a closed shape. Paragraph settings — alignment, justification, indents and hyphenation — apply to paragraph type only, because with point type each line is its own paragraph. The anti-aliasing pull-down is no longer on the type options bar; it is reached from the Character panel, the layer's properties and the Type menu instead. When exactly it left the bar is community-reported only and is not asserted here.

**Options bar**

| Control                                          | Photoshop                                                                                                                                                                                                                                                                                                                                                                                                                        | In this app                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Tool preset                                      | A picker of saved type-tool presets at the far left of the bar, so a whole set of type settings can be recalled at once.                                                                                                                                                                                                                                                                                                         | `missing`                                                    |
| Text Orientation                                 | The second button in the bar, a T with a direction marker, that switches new type between horizontal and vertical; Layer > Type > Horizontal/Vertical and Change Text Orientation in the Character panel menu do the same to an existing layer, flipping the whole layer regardless of what is selected.                                                                                                                         | `missing`                                                    |
| Font family                                      | A combo box showing every font available to Photoshop in a WYSIWYG list, each entry rendered in its own face so the list previews the fonts.                                                                                                                                                                                                                                                                                     | `partial` — `src/components/ToolbarsRight/Text/Text.tsx:123` |
| Font Style                                       | A combo box over the styles the chosen family actually has — Regular, Italic, Bold, Bold Italic and family-specific variants — with Faux Bold and Faux Italic synthesized when the family lacks them.                                                                                                                                                                                                                            | `partial` — `src/components/ToolbarsRight/Text/Text.tsx:189` |
| Size                                             | The type size, entered in points by default and accepting a unit suffix (pt, px, mm, in, pica). 1 pt is 1/72 in. The value sets the em size, not the cap height.                                                                                                                                                                                                                                                                 | `partial` — `src/components/ToolbarsRight/Text/Text.tsx:136` |
| Anti-Alias                                       | Five presets — None, Sharp (type appears at its sharpest), Crisp (somewhat sharp), Strong (heavier) and Smooth (smoother) — that control how the glyph edges are rendered into pixels. It is no longer on the type options bar, and is reached from the Character panel, the layer’s properties and the Layer > Type menu instead; when it left the bar is community-reported only, and no Adobe page states a version boundary. | `missing`                                                    |
| Text color                                       | A color swatch that opens the Color Picker and sets the type fill, also reachable by Alt+Backspace for the foreground color and Ctrl+Backspace for the background color. Selecting characters rather than the layer limits the change to those characters.                                                                                                                                                                       | `missing`                                                    |
| Align Text Left / Center Text / Align Text Right | A row of three buttons that set paragraph alignment, defaulting to Align Text Left. Justify Last Left, Justify Last Centered, Justify Last Right and Justify All live in the Paragraph panel.                                                                                                                                                                                                                                    | `present` — `src/components/ToolbarsRight/Text/Text.tsx:175` |
| Toggle the type on a path                        | A T on a baseline that appears once a work path is selected, moving the type layer onto that path so its characters follow the path as a baseline.                                                                                                                                                                                                                                                                               | `missing`                                                    |
| Create Work Path                                 | Turns the type layer's glyph outlines into a work path in the Paths panel, from which the text can be selected, filled, stroked, or used as a container for more type.                                                                                                                                                                                                                                                           | `missing`                                                    |
| Warp Text                                        | A T over a curved line that opens the Warp Text dialog: a Style list (Arc, Arc Lower, Arc Upper, Arch, Bulge and more), a Horizontal/Vertical orientation, and Bend plus Horizontal Distortion and Vertical Distortion sliders. Choosing None in the dialog unwraps the layer.                                                                                                                                                   | `missing`                                                    |
| Toggle the Character and Paragraph panels        | The last button in the bar, which brings the Character and Paragraph panels to the front of the panel group so the settings that are not on the bar can be reached.                                                                                                                                                                                                                                                              | `missing`                                                    |
| Commit / Cancel                                  | The check mark and the cancel cross, which appear only while a type layer is in edit mode. The check mark also fires on the numeric keypad's Enter and on Ctrl+Enter (Windows) or Command+Return (Mac OS); Esc commits by default and can be switched to cancel under Preferences > Type.                                                                                                                                        | `partial` — `src/components/ToolbarsRight/Text/Text.tsx:210` |

**Shortcuts**

- `T` — Select the Type tool.

**In this app:** `partial` — The app's type layer is baked pixels, not live type. renderText paints the string into a 2D context with fillText, and the text processor hands back a single OffscreenCanvas, so what reaches the Layers panel is a bitmap; the layer renderer re-runs a tool's creator only for the six shape tools, and text is not on that list, so its retained args are never re-rendered. Enlarging a text layer therefore rescales those pixels where a Photoshop type layer re-renders at the new size. There is no text box either: the app grows the rect to the widest line instead of wrapping, so a long line runs to the canvas edge rather than reflowing, and every newline is a hard break. Text is typed into a textarea in the right-hand panel rather than onto the canvas, so there is no caret, no text selection and no per-character formatting; the draft is committed by Apply or implicitly by switching tools, and the commit creates a raster layer. There is no colour control on this bar at all: the type fill is slaved to the global foreground swatch in the left rail, which this panel only mirrors into the tool args and the overlay, so the colour is a whole-app choice rather than a per-type-layer one. Font size is a CSS pixel range of 8-500 rather than points, the font list is fourteen hard-coded families rather than the system enumeration, and leading is a unitless multiplier of the font size where Photoshop's is an absolute baseline-to-baseline distance in points. T is the only type key, and only while the textarea does not hold focus — the panel focuses it as soon as the tool is selected, and a shortcut that does not opt into inputs is refused while a field is focused, so a T pressed mid-edit types a letter rather than reselecting the tool. The type tile holds a single entry, so Shift+T re-selects the same tool instead of cycling a flyout. Nothing binds Ctrl+Enter, Enter or Esc to a type commit or cancel: Enter inside the focused textarea takes the textarea's own newline, and the one Escape handler the type tool would have had is commented out; the only live Escape near this bar belongs to the font popup, where it reverts the pending family and closes the list.

Implementation:

- `src/tools/text.ts:22`
- `src/tools/text.ts:66`
- `src/components/ToolbarsRight/Text/Text.tsx:26`
- `src/components/Main/TextToolArea.tsx:24`
- `src/tools/settings.ts:77`
- `src/tools/toolProcessors.ts:159`
- `src/contexts/useLayer.ts:345`
- `src/contexts/layer-renderer.ts:32`
- `src/util/rect.ts:116`
- `toolbar-mapping.ts:107`

Sources:

- <https://helpx.adobe.com/photoshop/using/creating-type.html>
- <https://helpx.adobe.com/photoshop/using/editing-text.html>
- <https://helpx.adobe.com/photoshop/using/tool-techniques/horizontal-type-tool.html>
- <https://helpx.adobe.com/photoshop/using/formatting-characters.html>
- <https://helpx.adobe.com/photoshop/using/formatting-paragraphs.html>
- <https://helpx.adobe.com/photoshop/using/line-character-spacing.html>
- <https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/add-text-along-paths-or-inside-shapes.html>
- <https://helpx.adobe.com/photoshop/desktop/text-typography/text-on-paths-shapes/warp-and-unwarp-text.html>
- <https://helpx.adobe.com/photoshop/using/layers.html>
- <https://www.adobe.com/learn/photoshop/web/rasterize-type-shape-layer>
- <https://www.adobe.com/products/photoshop/rasterize.html>
- <https://community.adobe.com/bug-reports-711/p-bring-back-font-anti-aliasing-pulldown-in-the-type-tool-bar-658044>
- <https://theiviaxx.github.io/photoshop-docs/Photoshop/AntiAlias.html>
- <http://www.underwaterphotography.com/photoshop/photoshop/1_16_3_4.html>
- <http://www.photoshopforphotographers.com/CC_2013/Help_guide/tp/Character_palette.html>
- <https://www.dummies.com/article/technology/software/adobe-products/photoshop/text-options-for-photoshop-cc-163691>

---

## Move, transform and adjustments

Long-form research, provenance and unverified claims: [`src/tools/descriptions/transform.notes.md`](../src/tools/descriptions/transform.notes.md).

### Move Tool

`reposition` · **V**

Photoshop's Move tool (V) drags layers, selections and artboards around the document, and hosts the transform box Free Transform hangs off.

The Move tool is how content gets placed. Select it, press on a layer, a selection or an artboard, and drag: the layer follows the pointer and settles when the button comes up, so a single drag is a single undo step. It is also the entry point to everything geometric — with Show Transform Controls checked, the same bounding box appears and dragging its handles scales, skews and rotates the layer, which is exactly the state Cmd+T enters. Auto-Select makes the tool pick the layer under the pointer instead of requiring a trip to the Layers panel, and Alt-dragging a layer moves a duplicate of it rather than the original.

**Options bar**

| Control                    | Photoshop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | In this app |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| Tool Preset Picker         | The tool icon at the far left of the options bar with a flyout arrow. Clicking it lists that tool’s saved presets; Control-clicking it (Command-clicking on macOS) opens a two-item menu — Reset Tool, which returns the current tool’s options to their defaults, and Reset All Tools, which does the same for every tool. It is the escape hatch for the fact that a tool’s options are the ones you last used, not the ones it shipped with.                                                                                                        | `missing`   |
| Auto-Select                | Checkbox that, when on, resolves the target by hit test: the tool selects the topmost layer that actually has pixels under the cursor, rather than moving whichever layer happens to be active. It is off by default, and with it off you must select the layer first.                                                                                                                                                                                                                                                                                 | `missing`   |
| Auto-Select: Group / Layer | Menu beside the Auto-Select checkbox choosing what the hit test resolves to. Layer takes the individual layer under the pointer; Group takes the whole layer group that layer belongs to, so a click anywhere on a grouped child moves the group.                                                                                                                                                                                                                                                                                                      | `missing`   |
| Show Transform Controls    | Checkbox that puts the transform bounding box and its handles on the currently selected layer without putting the tool into transform mode — the handles simply appear. Dragging one of them is what starts the transform, and it is the same handle-driven state Cmd+T opens; the bar swaps to the numeric transform fields while a handle is held. A layer with no pixels, an artboard or a text layer are the cases where Photoshop shows the box anyway.                                                                                           | `missing`   |
| Align                      | Six buttons, enabled once two or more layers or groups are selected: Top Edges, Vertical Centers, Bottom Edges, Left Edges, Horizontal Centers and Right Edges. Each moves the selected layers so the named edge or center coincides with the extreme of the selection, or with the selection border. Photoshop expresses that choice as two menu targets rather than a bar control — Layer > Align against the selected layers, Layer > Align Layers To Selection against the selection border — and no Adobe page names a bar control for making it. | `missing`   |
| Distribute                 | The distribute row, enabled only at three or more selected layers: the same six edge and center commands to space the layers evenly between the outermost two, plus the Horizontally and Vertically spacing buttons. The two outermost layers are treated as fixed and only the ones between them move.                                                                                                                                                                                                                                                | `missing`   |
| Width                      | Numeric text box, in percent, for the layer width. It replaces the Auto-Select controls while a transform is active, and carries a Link icon that is on by default since Photoshop 21.0.                                                                                                                                                                                                                                                                                                                                                               | `missing`   |
| Height                     | Numeric text box, in percent, for the layer height, paired with Width through the Link icon so a corner drag scales proportionally.                                                                                                                                                                                                                                                                                                                                                                                                                    | `missing`   |

**Modifiers**

- **Alt** — Drag a duplicate of the layer or selection instead of the original, leaving the source layer where it was. Printed by Adobe as Alt on Windows and Option on macOS.
- **Shift** — Constrain the drag to a single axis, so a sloppy diagonal snaps to purely horizontal or purely vertical movement.
- **Shift** — Click a layer in the canvas or the Layers panel to add it to the current selection rather than replacing it. Adjacent layers need only Shift-click; noncontiguous layers need Ctrl-click (Command-click on macOS).
- **Arrow keys** — Nudge the active layer by one pixel when nothing is selected on it, or the selection itself by one pixel when there is.
- **Shift+Arrow keys** — Nudge by ten pixels instead of one.

**Shortcuts**

- `V` — Select the Move tool. Tapping the key selects it; holding it springs the Move tool onto the currently active tool for as long as the key is down, and releasing returns to the tool you were on. Spring-loaded switching is a preference (Preferences > Tools > Spring-loaded Tool Shortcuts) and is on by default. The exception list is the Hand, Slice, Slice Select, Pen and Path Selection tools, which never spring-load.

**In this app:** `partial` — The app's Move tool moves and resizes, and the whole gesture is one committed history entry, but almost nothing of Photoshop's bar survives, and what does survive is not merely narrower than Photoshop's: the one canvas overlay the app draws is a resize rectangle where Photoshop draws a transform box, and two of Photoshop's controls are behaviours this app has with nothing on screen to turn them off. That overlay is a divergence rather than a gap, and it is why the verdict is `partial` and not `implemented`. Neither the Auto-Select checkbox nor the Group/Layer menu beside it is rendered, and a search of `src/` and `e2e/` finds no control for either: the tool always resolves the layer under the pointer by hit test and always makes it active, which is Auto-Select: Layer with that state permanently on and the group mode removed — so a grouped child cannot be dragged out of its group, and a click that lands on a transparent part of a layer finds whatever is underneath instead of nothing. There is no Show Transform Controls checkbox either, and the difference is more than cosmetic, because the overlay that does render is a plain resize rectangle drawn by the shared useRect hook — four painted corner handles sitting on eight draggable edges, no rotation zone at all outside the box, no numeric W/H, no reference point — so the geometric half of the tool, which is where Free Transform normally lives, is absent from the Move tool entirely. The align and distribute rows, the Alt-drag duplicate, the Shift axis constraint, the Shift-click-to-extend and the arrow-key nudge are all missing, which together mean the app can place one layer but cannot line several up. A third divergence is the refusal, which is not a missing feature: the app refuses a press on a bedrock layer, and it does not consult the locked flag that its own layer model carries, so a layer marked locked is still draggable. The keyboard is a divergence too, and it is a strange one because the badge looks right. The Move tile declares V in the toolbar mapping, and the app does bind V — but the badge is not what binds it, and the letter-key layer is a separate hand-written table rather than anything derived from the toolbar. Spring-loaded switching does not exist here at all: the handler switches the tool on keydown and nothing listens for the keyup, so holding V cannot borrow the Move tool for one gesture and hand it back. Auto-Align is a different matter, because it is not this tool's control to lose: in Photoshop it is the Edit > Auto-Align Layers command, a dialog with a Projection choice, and the app has no equivalent of it at all. The panel the app does render is its own: the active layer's name, a Merge all button and a hint, none of which Photoshop's Move bar has.

Implementation:

- `src/components/Main/MoveToolArea.tsx:85`
- `src/components/Main/MoveToolArea.tsx:132`
- `src/components/Main/MoveToolArea.tsx:176`
- `src/components/Main/MoveToolArea.tsx:197`
- `src/tools/reposition.ts:12`
- `src/tools/toolProcessors.ts:113`
- `src/components/ToolbarsRight/Move/Reposition.tsx:12`
- `src/components/Common/AppKeyboardShortcuts.tsx:216`
- `src/components/SidebarLeft/SidebarLeft.tsx:258`
- `src/components/SidebarLeft/SidebarLeft.tsx:431`
- `src/contexts/useCurrentTool.tsx:62`
- `toolbar-mapping.ts:39`

Sources:

- <https://helpx.adobe.com/photoshop/using/tool-techniques/move-tool.html>
- <https://helpx.adobe.com/photoshop/using/moving-stacking-locking-layers.html>
- <https://helpx.adobe.com/photoshop/using/free-transformations-images-shapes-paths.html>
- <https://helpx.adobe.com/photoshop/desktop/create-manage-layers/create-layer-compositions/align-content-of-layers-and-groups.html>
- <https://helpx.adobe.com/photoshop/desktop/create-manage-layers/create-layer-compositions/align-image-layers.html>
- <https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/move-reference-point-for-transformations.html>
- <https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html>
- <https://helpx.adobe.com/photoshop-elements/desktop/keyboard-shortcuts/keys-selecting-moving-objects.html>
- <https://helpx.adobe.com/photoshop-elements/using/keys-transforming-selections.html>
- <https://helpx.adobe.com/photoshop-elements/using/moving-copying-selections.html>
- <https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/history-panel-overview.html>
- <https://helpx.adobe.com/ie/photoshop/using/aligning-layers.html>
- <http://www.photoshopforphotographers.com/3101-1901/Help_guide/tp/Move_tool.html>
- <https://jkost.com/blog/2023/01/10-little-known-tips-for-working-with-tools-in-photoshop.html>

---

### Colors

`color`

Photoshop's name for it is **Black and White — the Image > Adjustments command, not a Tools panel Tool**.

Photoshop's Black and White converts a color image to monochrome with six independent hue-sextant sliders, optionally tinted with a tone color.

Black and White is not a desaturation — it is a weighted mix, and the six sliders are the weights. Each of the six sextants of the color wheel, Reds, Yellows, Greens, Cyans, Blues and Magentas, gets its own control over how bright that family of hues becomes in the result, so a landscape can have a dark sky and a bright sky in the same conversion, and skin can be lifted without touching the greens. Every slider starts at a value that reproduces a conventional conversion, and dragging one away from that value is the whole technique. Ticking Tint lays a uniform tone color over the monochrome so it reads as toned rather than neutral, which is how a sepia or a split-tone is made from a color original without going back to it.

**Options bar**

| Control                  | Photoshop                                                                                                                                                                                                                       | In this app                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Preset                   | Menu of predefined grayscale mixes and of any mix the user has saved, with Save Black & White Preset alongside it.                                                                                                              | `missing`                                                       |
| Auto                     | Sets a grayscale mix based on the values in the image itself.                                                                                                                                                                   | `missing`                                                       |
| Tint                     | Checkbox that lays a uniform tone color over the monochrome result, which is what turns a neutral conversion into a toned or sepia one.                                                                                         | `missing`                                                       |
| Tint Color               | The color swatch beside the Tint checkbox. Choosing it opens the Color Picker, and the tone applied is called Tint Color.                                                                                                       | `missing`                                                       |
| Color sliders            | Six sliders, one per sextant of the color wheel, in the order Reds, Yellows, Greens, Cyans, Blues, Magentas. Each sets how bright that family of hues renders in the monochrome. Adobe ships them at 40, 60, 40, 60, 20 and 80. | `missing`                                                       |
| Reset                    | The reset icon that returns the sliders to their default values, and more generally the panel control that returns the adjustment to its original settings.                                                                     | `partial` — `src/components/ToolbarsRight/Colors/Color.tsx:183` |
| On-image adjustment icon | The icon that can be dragged off the panel and onto the image, dropping a target marker so a single sextant can be adjusted on the picture itself and the change re-evaluated under the cursor.                                 | `missing`                                                       |

**In this app:** `partial` — Black and White is an Image > Adjustments command, or an adjustment layer — not a toolbar tool — so the app's Colors entry occupies a slot Photoshop's toolbar does not have. None of Photoshop's seven controls is reproduced, and the three sliders that are rendered are not Black and White controls: there is no sextant weighting anywhere in the app, so no per-hue decision can be made and the conversion is a flat luminance desaturation rather than a mix. The grayscale slider is the nearest thing to the whole panel and it is the one control that cannot stand in for it, because a hue-weighted mix and a luminance average differ the moment any of the six families is pushed. Sepia is not the Tint checkbox either: Tint lays a uniform tone color over a conversion whose mix you still control, and applying sepia is a second filter stage that tints the whole image rather than replacing its channel weights, so the two can be combined and the result is not the same look. Saturation belongs to no part of Black and White; it is a Hue/Saturation control, and the fact that this app has one is a leftover from the identity question this tool's shape was chosen to answer. Presets, Auto, the on-image adjustment icon and the six sliders are all absent, and the Reset button that is present does not behave as Photoshop's does: it is disabled unless an uncommitted preview is live, and it restores that panel's own defaults rather than the sextant defaults, so a committed conversion can only be undone. As with Levels, the engine is a CSS filter string, and the surface it is assigned to is the visible canvas: the renderer builds an ordinary HTMLCanvasElement, sets ctx.filter from the layer's operations array and draws the layer stack into it. The OffscreenCanvas processors in src/tools/colors.ts are not on the editing, preview or commit path — color is registered as commit: 'layer-operation', so those paths append the operation and return before a pixel is produced — and the committed conversion is retained on the same terms as Levels, with the layer's own bitmap untouched and undo replaying the operation rather than a raster. The string is built once, so the renderer and the durable materializer cannot drift, and the test harness exposes filter as a writable property, so the emitted string is assertable; the jsdom mock still cannot rasterize it, so no test here shows what the filter looks like.

Implementation:

- `src/components/ToolbarsRight/Colors/Color.tsx:123`
- `src/components/ToolbarsRight/Colors/Color.tsx:110`
- `src/tools/colors.ts:12`
- `src/tools/functions.ts:60`
- `src/tools/settings.ts:48`
- `src/tools/toolProcessors.ts:125`
- `src/contexts/useLayer.ts:536`
- `src/contexts/useLayer.ts:345`
- `src/contexts/history-replay.ts:152`
- `src/contexts/layer-renderer.ts:16`
- `src/contexts/materialization.ts:78`
- `src/test/setup.ts:320`
- `toolbar-mapping.ts:62`

Sources:

- <https://helpx.adobe.com/photoshop/desktop/adjust-color/color-effects-techniques/convert-a-color-image-to-black-and-white.html>
- <https://helpx.adobe.com/photoshop/using/color-adjustments.html>
- <https://helpx.adobe.com/photoshop/using/color-monochrome-adjustments-using-channels.html>
- <https://www.photoshopessentials.com/photo-editing/black-and-white-cs3>
- <https://www.photoshopessentials.com/photo-effects/easy-selective-color-effect-with-photoshop>
- <https://glensmith.co.uk/photoshop/tools>
- <https://www.photoshopessentials.com/basics/photoshop-tools-toolbar-overview>

---

### Levels

`levels`

Photoshop's name for it is **Levels — the Image > Adjustments command, not a Tools panel Tool**.

Photoshop's Levels remaps an image's tonal range through a black point, a gamma midtone and a white point, per channel, read against a histogram.

Levels is the tonal correction tool: it stretches or compresses where the image's darkest and lightest pixels land, and bends the midtones independently of the ends, which is what separates it from a brightness or contrast slider. The histogram above the controls is the working surface — you read where the data actually sits, then move the three input sliders until the blacks reach the black point, the whites the white point, and the middle slider corrects the overall exposure without crushing either end. Every move can be scoped to one color channel, which is how a cast gets removed rather than merely desaturated. Applied from Image > Adjustments it works directly on the image layer and discards the information it overwrites; applied as an adjustment layer it stays editable forever.

**Options bar**

| Control                     | Photoshop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | In this app                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Preset                      | Menu of saved settings, with Save Preset alongside it. Levels is one of the seven adjustments that can be stored and re-applied.                                                                                                                                                                                                                                                                                                                                                                  | `missing`                                                        |
| Channel                     | Menu choosing the channel the adjustment applies to — RGB and the individual Red, Green and Blue channels, plus the channel combinations selected in the Channels panel. Defaults to RGB.                                                                                                                                                                                                                                                                                                         | `missing`                                                        |
| Histogram                   | The graph of how pixels are distributed across tonal levels, drawn over the three input sliders as their backing track. It is the guide, not a control: reading it is how you decide where the black and white points belong.                                                                                                                                                                                                                                                                     | `missing`                                                        |
| Input Levels: black point   | Leftmost input slider, on the 0 to 255 level domain Adobe states for the adjustment. It sits at level 0, which Adobe does not state as a default; what Adobe does state is that with the Output sliders in their default positions "moving the black input slider maps the pixel value to level 0". Dragging it right sets clipping: a black point at level 5, this description’s symmetric case to Adobe’s own 243 example on the white point, maps every pixel at level 5 and lower to level 0. | `missing`                                                        |
| Input Levels: midtone gamma | Middle input slider, which "adjusts the gamma in the image" rather than either extreme. It sits at 1.00 by default, which Adobe does not state; moving it left lightens the image and right darkens it, and the pivot is the midpoint level between the output sliders rather than the center of the range.                                                                                                                                                                                       | `missing`                                                        |
| Input Levels: white point   | Rightmost input slider, sitting at level 255 by default, which Adobe does not state as a default. Adobe does print the worked case on this slider: "if you move the white point slider to the left at level 243, Photoshop maps all pixels at level 243 and higher to level 255."                                                                                                                                                                                                                 | `missing`                                                        |
| Output Levels: black        | Left output slider, the level the black point maps to, and its default is Adobe’s: "By default, the Output sliders are at level 0, where the pixels are black, and level 255, where the pixels are white." The output pair is what the two input points are defined against, so moving it changes where black lands without touching where it is read from.                                                                                                                                       | `missing`                                                        |
| Output Levels: white        | Right output slider, default level 255, the level the white point maps to — the other half of Adobe’s stated Output-slider defaults.                                                                                                                                                                                                                                                                                                                                                              | `missing`                                                        |
| Auto                        | Button that clips a small fraction of the shadows and highlights in every channel and maps the remaining extremes to pure black and pure white, as a starting point to refine by hand. Adobe states both halves of it: the domain is 0 to 255, and "By default, the Auto option and the Auto Tone command clip the white and black pixels by 0.1% — that is, it ignores the first 0.1% of either extreme."                                                                                        | `missing`                                                        |
| Auto Options                | Menu command opening the Auto Color Correction Options dialog, which chooses the algorithm Auto runs and sets the shadow and highlight clipping percentages. Adobe’s guidance for those Clip boxes is that a value between 0.0% and 1% is recommended. Three of the four algorithms are Adobe-named — Enhance Monochromatic Contrast, Enhance Per Channel Contrast and Find Dark and Light Colors — and the fourth, Enhance Brightness and Contrast, is third-party only.                         | `missing`                                                        |
| Eyedroppers                 | Three eyedroppers — Set Black Point, Set Gray Point and Set White Point — that set each point by clicking the image. Using them discards any Levels adjustment already made, so Adobe advises using them first. The gray point one is for removing a color cast and is unavailable on grayscale images.                                                                                                                                                                                           | `missing`                                                        |
| Reset                       | Returns the adjustment to its original settings. Part of the adjustment panel rather than the tonal controls themselves, and listed here because it belongs to this adjustment.                                                                                                                                                                                                                                                                                                                   | `partial` — `src/components/ToolbarsRight/Levels/Levels.tsx:138` |

**Modifiers**

- **Alt** — Hold while dragging the black point or white point slider to see which areas are being clipped, instead of moving the slider. Adobe prints it as Alt on Windows and Option on macOS. Choosing Show Clipping For Black/White Points from the panel menu makes the same preview permanent.

**Shortcuts**

- `Cmd+L` — Apply the Levels command. Cmd+Shift+L applies it again with the previous settings, and Cmd+Option+L is Levels with the last settings used.

**In this app:** `partial` — Levels is an Image > Adjustments command, or an adjustment layer — not a toolbar tool — so the app's Levels entry occupies a slot Photoshop's toolbar does not have. Inside that slot nothing in Photoshop's Levels panel is reproduced, and the two sliders that are rendered are not Levels controls at all: Photoshop's Levels has no Brightness and no Contrast slider. What the app renders is CSS brightness() and contrast() over the encoded pixel values, both on an exponential curve re-anchored so the endpoints are exact, which means a flat linear multiply and a pivot at mid-gray in encoded space where Photoshop's curve is piecewise-linear through three control points with its midpoint at level 128. The Brightness slider is labelled and centred on a neutral of 0, and the re-anchoring makes that literal rather than approximate: 0 emits exactly brightness(100%), so the panel at its defaults applies nothing at all, and it is the slider's minimum of -100 that emits brightness(0%) and multiplies the whole layer to black — a range-wide multiply, where Photoshop's black point is a threshold that only remaps the pixels below it. There is no black point, no white point, no gamma midtone, no output pair, no histogram, no channel selector, no Auto, no Auto Options and no eyedroppers. Levels works on the document's encoded values rather than a linear-light space — Adobe draws exactly this contrast with Exposure, which does calculate in linear color space — and the app's filter is likewise in whatever space the canvas composite happens to be. A committed adjustment is retained rather than destroyed, and that is the half of the split the app gets right. A committed Levels adjustment is a layer operation, not a rewrite of pixels: the layer's own bitmap is never touched, the commit appends an operation to the layer's operations array and records one history entry, the renderer re-derives the filter from that array on every frame, and undo and redo replay the operation rather than a stored raster. What the app does not have is the other half of the split: the adjustment is not re-editable, so a committed one can only be taken back with undo, which is why the Reset button is gated on an uncommitted preview and restores the panel's own defaults rather than re-opening the adjustment. The engine for all of that is a CSS filter string assigned to ctx.filter on an ordinary HTMLCanvasElement 2D context — the canvas the user is actually looking at, which the renderer builds with document.createElement and draws the layer stack into. The OffscreenCanvas processors in src/tools/levels.ts are not on that path at all: levels and color are registered as commit: 'layer-operation', and the preview and commit paths append the operation and return before any pixel is produced, so those processors are never reached while editing, previewing or committing. The one surface that still applies the string to an OffscreenCanvas 2D context is the durable materializer, which prefers new OffscreenCanvas wherever one exists; no module outside src/contexts/**tests** imports it today, and the OffscreenCanvasRenderingContext2D.filter support Safari has never shipped is a property of that surface rather than of the canvas this tool edits on. The string is built in one place, so the renderer and that materializer cannot drift, and the test harness exposes filter as a real writable property, so the emitted string is assertable — though the jsdom mock still cannot rasterize it, so no assertion here proves what the filter looks like.

Implementation:

- `src/components/ToolbarsRight/Levels/Levels.tsx:99`
- `src/components/ToolbarsRight/Levels/Levels.tsx:86`
- `src/tools/levels.ts:12`
- `src/tools/functions.ts:66`
- `src/tools/settings.ts:49`
- `src/tools/toolProcessors.ts:131`
- `src/contexts/useLayer.ts:536`
- `src/contexts/useLayer.ts:345`
- `src/contexts/history-replay.ts:152`
- `src/contexts/layer-renderer.ts:18`
- `src/contexts/materialization.ts:84`
- `src/test/setup.ts:320`
- `toolbar-mapping.ts:63`

Sources:

- <https://helpx.adobe.com/photoshop/using/levels-adjustment.html>
- <https://helpx.adobe.com/photoshop/using/adjust-color-tone-levels-curves.html>
- <https://helpx.adobe.com/photoshop/using/making-quick-tonal-adjustments.html>
- <https://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html>
- <https://helpx.adobe.com/photoshop/using/color-adjustments.html>
- <https://helpx.adobe.com/ca/photoshop/web/edit-images/color--tone--and-lighting/modify-tones-with-levels-adjustment.html>
- <https://www.adobe.com/learn/photoshop/web/photoshop-improve-tones-levels>
- <https://morris-photographics.com/photoshop/shortcuts/downloads/PSCS3_Keyboard_Shortcuts_Mac.pdf>
- <https://glensmith.co.uk/photoshop/tools>
- <https://www.photoshopessentials.com/basics/photoshop-tools-toolbar-overview>

---

### Transform

`transform`

Photoshop's name for it is **Free Transform — the Edit > Transform command, not a Tools panel Tool**.

Photoshop's Free Transform (Cmd+T) scales, rotates, skews, distorts, warps or tilts a layer in one continuous drag on its bounding box.

Free Transform puts a bounding box around the active layer and lets one continuous operation change its size, angle and shape together, which is the point: rotating and rescaling an image in two steps resamples it twice. Every mode is a drag on that box, and the mode is chosen by right-click menu, by an options-bar button, or by holding a modifier so the box changes behavior mid-gesture. Nothing is written to the document until you commit, so a transform can be abandoned and undone as a unit.

**Options bar**

| Control                                      | Photoshop                                                                                                                                                                                                                                     | In this app                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Width                                        | Numeric text box, in percent, for the layer width. The paired Link icon is on by default since Photoshop 21.0, so a corner handle scales proportionally.                                                                                      | `partial` — `src/components/ToolbarsRight/Transform/Transform.tsx:253` |
| Height                                       | Numeric text box, in percent, for the layer height, linked to Width by the Link icon.                                                                                                                                                         | `partial` — `src/components/ToolbarsRight/Transform/Transform.tsx:268` |
| Maintain Aspect Ratio (Link)                 | Toggle between proportional and non-proportional scaling, on by default since Photoshop 21.0. Shift is bound to the same state and inverts it while held.                                                                                     | `missing`                                                              |
| Reference point location                     | A 3-by-3 grid of squares choosing the pivot, draggable in the document to move the transform origin. The reference point is hidden by default and must be shown from this control; transforms start from the object center until it is moved. | `missing`                                                              |
| Rotation                                     | Numeric text box, in degrees, for the rotation angle. The same angle is produced by dragging outside the bounding box, where Shift snaps to 15-degree increments.                                                                             | `partial` — `src/components/ToolbarsRight/Transform/Transform.tsx:182` |
| Skew H                                       | Numeric text box, in degrees, for horizontal skew.                                                                                                                                                                                            | `partial` — `src/components/ToolbarsRight/Transform/Transform.tsx:202` |
| Skew V                                       | Numeric text box, in degrees, for vertical skew.                                                                                                                                                                                              | `partial` — `src/components/ToolbarsRight/Transform/Transform.tsx:218` |
| Switch Between Free Transform And Warp Modes | Button that swaps the box for a warp mesh, after which a Warp pop-up menu offers the predefined warp styles and a square handle adjusts the chosen one.                                                                                       | `missing`                                                              |
| Commit                                       | The checkmark that applies the transform. Enter works too, and so does selecting a new tool, clicking a layer in the Layers panel, or clicking outside the canvas or the bounding box.                                                        | `partial` — `src/components/ToolbarsRight/Transform/Transform.tsx:303` |
| Cancel                                       | The cancel button that abandons the transform and restores the original shape and size. Esc does the same.                                                                                                                                    | `present` — `src/components/ToolbarsRight/Transform/Transform.tsx:306` |

**Modifiers**

- **Shift** — With a rotation drag outside the bounding box, constrain the angle to 15-degree increments. With a handle drag, toggle proportional scaling off and on, which is what Shift means since Photoshop 21.0.
- **Alt** — Distort relative to the center point of the bounding box, so the opposite handle moves at the same time in the opposite direction. Printed by Adobe as Alt on Windows and Option on macOS.
- **Cmd** — Distort freely by dragging a handle, in any direction, with no constraint. Printed by Adobe as Command on macOS and Control on Windows.
- **Cmd+Shift** — Skew: drag a side handle to slant that side while the opposite side stays parallel.
- **Cmd+Alt+Shift** — Perspective: drag a corner handle so the layer recedes toward one edge, the two sides no longer meeting at a right angle.

**Shortcuts**

- `Cmd+T` — Free Transform. Choosing the Move tool and checking Show Transform Controls enters the same state, which is how a pixel layer gets its box.
- `Cmd+Option+T` — Duplicate the layer or selection and enter Free Transform on the duplicate, leaving the original untouched.
- `Enter` — Commit the transform. Selecting another tool or another layer commits it too.

**In this app:** `partial` — Free Transform is a command, not a tool. The primary evidence is a negative one and it is a good one: a complete, version-stamped inventory of the Photoshop 2026 Tools panel lists every entry in the bar — Move, the marquees, the crop, the pen family, the type tools, the shape tools, Hand, Zoom — and has no Transform entry in it, while Photoshop reaches the operation through Edit > Transform > Free Transform or Cmd+T. Adobe's own routing agrees, sending a pixel layer to the Move tool with Show Transform Controls rather than to any transform tool. One counter-sentence exists on Adobe's marketing copy — "Select the Transform tool by pressing Ctrl + T (Cmd + T for Mac)" — but the very next clause of the same page is "You can also go to Edit > Free Transform": the page names the menu route itself, and uses "tool" for the interactive state rather than for a Tools-panel entry. The app registers it as a toolbar entry next to Colors and Levels, and none of the three has a Photoshop toolbar slot. That is a defensible choice, but it makes the panel in the options bar a different thing from Free Transform's bar, and the two should not be described as the same control set. What the app builds is a fixed-parameter panel for the Image > Transform operations — rotate 90 degrees left, 180 and 90 degrees right, a continuous rotation slider clamped to plus or minus 90, skew X and skew Y in plus or minus 45 degrees, scale X and Y in 10 to 300 percent, and horizontal and vertical flip — plus one projective operation the app calls Trapezoid, a percentage taper that narrows the top or the bottom of the layer about its horizontal centerline. Photoshop's nearest counterpart for that taper is the Perspective mode of Free Transform, reached by Cmd+Option+Shift-drag rather than by a slider, and it is mutually exclusive with every other parameter here: setting Trapezoid resets rotation, both skews and both scales to their defaults, and the processor refuses a trapezoid combined with any retained affine transform rather than composing them. The panel is not a live transform either. There is no bounding box, no handles, no reference point and no commit-on-click-outside; the sliders write a preview through the transient update path and the geometry is only committed, as one history entry, when the dirty tool is committed — on Apply, on tool switch or on export. Escape is the opposite of a commit route: it and the Cancel button both call the same cancel handler, which deletes the pending preview, resets the panel to its defaults and dispatches nothing, so what remains is the last committed state. Of Free Transform's own bindings, only Escape is wired; Enter does not commit, and there is no intra-transform undo. Warp, Distort and Perspective-as-a-drag have no implementation at all, and the composite order the app declares — scale, then rotation, then skew, all about the untransformed layer center — is fixed, where Photoshop composes handle drags in the order they happen.

Implementation:

- `src/components/ToolbarsRight/Transform/Transform.tsx:155`
- `src/components/ToolbarsRight/Transform/Transform.tsx:35`
- `src/contexts/affine-transform.ts:173`
- `src/contexts/affine-transform.ts:216`
- `src/tools/transform.ts:119`
- `src/tools/transform.ts:153`
- `src/tools/toolProcessors.ts:140`
- `src/contexts/useLayer.ts:345`
- `toolbar-mapping.ts:64`

Sources:

- <https://helpx.adobe.com/photoshop/using/free-transformations-images-shapes-paths.html>
- <https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/adjust-scale-rotation-and-perspective.html>
- <https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/apply-transformations.html>
- <https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/duplicate-objects-as-you-transform.html>
- <https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/move-reference-point-for-transformations.html>
- <https://helpx.adobe.com/photoshop-elements/using/keys-transforming-selections.html>
- <https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/manage-image-states.html>
- <https://jkost.com/blog/2019/06/new-free-transform-preference-in-photoshop.html>
- <https://morris-photographics.com/photoshop/shortcuts/downloads/PSCS3_Keyboard_Shortcuts_Mac.pdf>
- <https://glensmith.co.uk/photoshop/tools>
- <https://www.adobe.com/products/photoshop/resize-image.html>

---

## Eyedropper and draw

Long-form research, provenance and unverified claims: [`src/tools/descriptions/eyedropper-draw.notes.md`](../src/tools/descriptions/eyedropper-draw.notes.md).

### Eyedropper Tool

`eyedropper` · **I**

Samples a color from anywhere in the image and makes it the foreground color, on a click rather than a drag.

The Eyedropper reads pixels and hands the result to the color controls, so a color that is already in the image can be matched exactly instead of guessed. A plain click sets the foreground color; Alt-click (Windows) or Option-click (macOS) sets the background color, and the sampled color is also added to the Swatches panel. Sample Size sets the footprint: Point Sample reads the precise value of the one pixel clicked, and the average settings read the mean of a square of pixels around it. A click is the whole gesture — there is nothing to drag — and Alt or Option held from any painting tool reaches the tool temporarily. A sample changes no pixel, so it is not an edit and belongs with a zoom or a panel move rather than with anything that records a history state.

**Options bar**

| Control     | Photoshop                                                                                                                                                                                                                                                                                                                        | In this app                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Sample Size | Sets the sampling footprint, and Adobe enumerates the whole menu: Point Sample "Reads the exact value of the clicked pixel", and 3 by 3 / 5 by 5 / 11 by 11 / 31 by 31 / 51 by 51 / 101 by 101 Average "Reads the average color value within the selected pixel area". There are no Median entries in it. Default: Point Sample. | `partial` — `src/components/ToolbarsRight/Eyedropper/Eyedropper.tsx:23` |
| Sample      | Chooses which layers a sample is read from: All Layers, Current Layer, Current & Below, and the No Adjustments variants. Adobe enumerates that menu and states no default for it. Earlier versions expressed this as a `Sample All Layers` checkbox.                                                                             | `inert` — `src/components/ToolbarsRight/Eyedropper/Eyedropper.tsx:37`   |

**Modifiers**

- **Alt** — Sets the sampled color as the background color instead of the foreground color — "Select a new background color by holding Alt (Windows) or Option (macOS) and clicking the desired area in the image." These are click modifiers, not drag modifiers: the Eyedropper has no drag.

**Shortcuts**

- `I` — Selects the Eyedropper, or temporarily switches to it while held.
- `Shift+I` — Cycles the tools that share the letter: Eyedropper, Color Sampler, Ruler, Note and Count.

**In this app:** `implemented` — The app implements the tool without a processor: it is the sole member of the pixel-free set, so it rasterizes nothing, has no `commit` kind, and its `toolsMap` entry carries only an icon and an options bar. A click dispatches a color change and nothing else, so the app records no history entry for a sample and a sample is not undoable — the same class as a zoom, a panel move or a tool switch. Three behaviors diverge. Sample Size offers only Point Sample, 3 by 3 Average and 5 by 5 Average, where Photoshop lists a longer set. `Sample All Layers` renders as a permanently unchecked, permanently disabled checkbox with no change handler, so the sample source cannot be changed at all; the field is declared in settings and seeded false, no control in the app ever writes it — the only `patchToolArgs` call in this bar writes `sampleSize` — so it can never become true, and a click that found it set refuses loudly rather than silently sampling the active layer. And the sample is always read from the composited canvas, with no modifier that can redirect it to the background swatch or to a single layer. The app omits two of Photoshop’s `I` behaviors. There is no spring-loaded switch: `I` here selects the tool outright and there is no temporary mode. And there is no `Shift+I` cycle either — `I` is registered twice for the same single-tool tile and neither registration declares a `shift: true` twin, so a shifted `I` re-selects the Eyedropper instead of cycling, and none of the four tools Photoshop cycles to with it — Color Sampler, Ruler, Note and Count — exists in the app’s tool registry at all.

Implementation:

- `src/components/Main/EyedropperToolArea.tsx:46`
- `src/components/Main/EyedropperToolArea.tsx:57`
- `src/components/Main/EyedropperToolArea.tsx:121`
- `src/components/ToolbarsRight/Eyedropper/Eyedropper.tsx:21`
- `src/tools/eyedropper.ts:28`
- `src/tools/toolProcessors.ts:80`
- `src/tools/toolsMap.ts:126`
- `toolbar-mapping.ts:57`

Sources:

- <https://helpx.adobe.com/photoshop/using/tool-techniques/eyedropper-tool.html>
- <https://helpx.adobe.com/photoshop/desktop/adjust-color/choose-colors/set-foreground-and-background-colors.html>
- <https://helpx.adobe.com/photoshop/using/painting-tools.html>
- <https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html>
- <https://www.manualsdir.com/manuals/753896/adobe-photoshop-cs4.html?page=126>
- <https://adobe.manymanuals.com/software/photoshop-cs4/user-manual-35148/127>
- <https://ptgmedia.pearsoncmg.com/images/9780789744470/samplepages/0789744473.pdf>
- <https://photogravity.eu/wp-content/uploads/2018/02/Photoshop-CS5-Help.pdf>
- <https://bruceblinn.com/1-Photography/UsingPhotoshopCS3.pdf>
- <https://www.photoshopforphotographers.com/CC_2013/Help_guide/tp/Eyedropper_tool.html>
- <https://enviragallery.com/guide-to-the-eyedropper-tool-in-photoshop/>
- <https://jkost.com/blog/2018/03/the-eyedropper-color-samplers-and-info-panel-in-photoshop-cc.html>
- <https://editpsdfile.com/blog/photoshop-keyboard-shortcuts>
- <https://www.oreilly.com/library/view/photoshop-r-cs4-bible/9780470345177/9780470345177_tools.html>
- <https://clippingpathstudio.com/photoshop-toolbar/>
- <https://offshoreclipping.com/blog/photoshop-cc-toolbar-tools/>

---

### Draw Tool

`draw` · **B**

Photoshop's name for it is **No Photoshop tool — this app’s own tool (nearest Photoshop: Brush tool)**.

This app’s own freehand stroke tool, not a Photoshop tool: a drag becomes a new layer of ink, drawn with a pen, a dashed pen or a spray.

There is no Photoshop tool called Draw, in this app or in Adobe’s Tools panel, so there is no Adobe behavior to describe and none is invented here. What the tool does is this app’s own: a drag pushes one raw pointer coordinate per move onto the stroke, the stroke is drawn as a bezier curve through those coordinates in the foreground color, and the finished stroke is committed as a new layer, so every mark is a separate object that is separately undone and separately deleted. A Pen Type dropdown picks one of three renderers — a solid round-capped stroke, a dashed stroke, and a spray of soft radial gradients — and Size, Opacity and, for the dashed pen only, Dash and Gap shape it. A live preview at the end of the bar draws the current settings, so a stroke can be judged before it is committed. A user coming from Photoshop should reach for the Brush tool for the solid stroke, and should know that this app renders no airbrush control on any tool, so the Spray pen is the nearest thing here to the Brush’s airbrush; there is no Photoshop equivalent to a dashed freehand ink stroke.

**Options bar**

| Control                                | Photoshop                                                                                                                                                                                                                                                                          | In this app                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Brush Preset picker                    | Opens the brush tip chooser, and lets the current preset’s Size and Hardness be changed without reopening the Brush panel. The app has no brush tips, so there is no picker and no hardness.                                                                                       | `missing`                                                    |
| Size                                   | The diameter of the brush tip, in pixels. Photoshop’s Size runs from 1 to 5000 px; the app’s slider runs from 0.5 to 500 in steps of 0.5.                                                                                                                                          | `partial` — `src/components/ToolbarsRight/Draw/Draw.tsx:142` |
| Mode                                   | The blend mode the stroke’s paint composites with. Default: Normal.                                                                                                                                                                                                                | `inert` — `src/tools/draw.ts:43`                             |
| Opacity                                | The transparency of the color applied. As a stroke passes over an area the color does not exceed this level until the button is released; a further stroke adds more. Default: 100%. The app seeds a lower default per pen — 90% for the solid and dashed pens, 50% for the spray. | `present` — `src/components/ToolbarsRight/Draw/Draw.tsx:204` |
| Flow                                   | The rate at which color is laid down as the pointer moves, so together with Opacity it sets how fast paint builds up under a held button. Default: 100%.                                                                                                                           | `missing`                                                    |
| Enable airbrush-style build-up effects | A toggle that keeps the brush laying down color while the pointer is held still, so a stationary stroke builds up to Opacity instead of stopping at one pass. This app renders no airbrush control at any point in the Draw bar.                                                   | `missing`                                                    |

**Shortcuts**

- `[` — Decreases brush Size.
- `]` — Increases brush Size.

**In this app:** `implemented` — No Photoshop provenance is claimed and none is invented: the Tools panel has no freehand-annotation or pen-stroke tool, and this app’s Draw tile sits in the tonal group where Photoshop has no tool at all. The nearest Photoshop tools are the Pen tool family, for path work, and the Brush, for freehand paint. The `shortcut` field on a toolbar entry is display-only and binds nothing: its only consumers are the tile tooltip and the <kbd> in the flyout, and the key bindings live in a separate hand-written table. That table is where the `B` goes. `B` is bound to the brush group — brush, pencil, color replacement, eraser — and `Shift+B` cycles it, so pressing `B` selects the Brush and can never select this tool. The `B` badged on the Draw Tool is therefore wrong twice over: the letter belongs to the Brush in Photoshop, and in this app the letter is taken by the Brush as well, leaving this tool reachable by pointer only. Photoshop’s spring-loaded switch is also absent: no key in the table selects this tool, so holding a letter cannot reach it either. The two fields the Photoshop paint bar exposes as Mode and Smoothing are declared on the draw args but unreachable from this bar — no draw control writes either, the default args set neither, and a draw stroke’s layer is forced to Normal by the blend-mode gate that admits only the paint tools. Two app-only controls, Dash and Gap, have no Photoshop counterpart in the paint bar. Three of the Brush bar’s controls diverge rather than go missing. Size is `partial` on its range alone: the slider starts at 0.5 px where Photoshop starts at 1 and stops at 500 px where Photoshop reaches 5000. Opacity is wired and correct for what it measures, but its build-up story is not: a draw stroke is one `beginPath`/`stroke()` over the whole path at the tool’s alpha, so where a stroke crosses itself the color does not compound within that stroke, and because every stroke is committed as its own layer, a second stroke lays a second semi-transparent layer over the first rather than adding to the same one. And the airbrush toggle is `missing` rather than approximate: the Draw bar renders Pen Type, Size, Dash, Gap, Opacity and a preview, and nothing that builds color up under a held button. The Spray pen type is the nearest thing and it diverges twice over — it is reached from the Pen Type dropdown rather than a toggle, and it stamps one soft gradient per sampled point along the drag, so it builds while the pointer is moving and a press that is then held still adds nothing after the single dot it already laid down. The bracket keys Photoshop binds to resize the tip are absent too: no bracket key is bound anywhere in the app, so `[` and `]` do not change the brush size. And Photoshop’s Shift-constrains-a-freehand-stroke-to-a-straight-line has no implementation here either — the draw area reads no modifier at all, so a Shift-held drag produces the identical freehand path.

Implementation:

- `src/components/ToolbarsRight/Draw/Draw.tsx:13`
- `src/components/Main/DrawToolArea.tsx:110`
- `src/util/draw.ts:85`
- `src/tools/draw.ts:6`
- `src/tools/toolProcessors.ts:151`
- `src/tools/settings.ts:32`
- `toolbar-mapping.ts:96`

Sources:

- <https://helpx.adobe.com/photoshop/using/painting-tools.html>
- <https://helpx.adobe.com/ee/photoshop/how-to/color-management-basics.html>
- <https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html>
- <https://bruceblinn.com/1-Photography/UsingPhotoshopCS3.pdf>
- <https://www.thedigitalprocess.com/selecting-color-in-photoshop/>
- <https://clippingpathstudio.com/photoshop-toolbar/>
- <https://offshoreclipping.com/blog/photoshop-cc-toolbar-tools/>

---
