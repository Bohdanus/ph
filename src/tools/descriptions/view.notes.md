# View Tools Research

## Confirmed

- Adobe describes the Hand Tool as a viewport panning tool and documents `H` as its selection shortcut.
- Adobe documents holding Space to access temporary Hand behavior while working with another tool, with Type called out as an exception by Adobe’s interaction guidance.
- Adobe describes Zoom as changing the displayed view rather than the image data. Click zooms toward the pointer; Alt/Option reverses the direction.
- Adobe describes Rotate View as a non-destructive canvas presentation change. Dragging rotates the view, and Reset View returns the angle to zero.
- View changes do not create pixel history entries. The implementation therefore keeps pan, zoom, and rotation in transient view state rather than `ToolProcessorDefinition`, `HistoryItem`, or durable replay.

## Scope implemented here

- Hand drag updates transient `panX` and `panY`; double-click resets the view.
- Zoom click and horizontal scrubby drag update transient `zoom` while preserving the pointer anchor.
- Rotate View horizontal drag and its options-bar slider update transient `rotation`; Escape, Reset View, and double-click reset it.
- The canvas presentation and overlay canvases share the same CSS transform.
- `usePointerPosition` applies the inverse transform before returning document-space coordinates, so existing pixel tools continue to paint and select the intended document point.

## Unverified or deferred

- Flick panning momentum, Pan All Windows, Overscroll preferences, animated zoom, wheel-zoom preferences, the compass overlay, graphics-processor gating, Shift angle snapping, and Rotate All Windows are not implemented.
- Desktop Photoshop’s maximum zoom differs across Adobe pages and releases; this implementation deliberately caps the control at 1600% until a product-specific limit is selected.

## Sources

- <https://helpx.adobe.com/photoshop/using/tool-techniques/hand-tool.html>
- <https://helpx.adobe.com/photoshop/using/tool-techniques/zoom-tool.html>
- <https://helpx.adobe.com/photoshop/using/tool-techniques/rotate-view-tool.html>
- <https://helpx.adobe.com/photoshop/using/viewing-images.html>
- <https://helpx.adobe.com/photoshop/using/touch-gestures.html>
