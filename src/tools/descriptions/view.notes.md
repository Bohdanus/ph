# View Tools Research

## Confirmed

- Adobe describes the Hand Tool as a viewport panning tool and documents `H` as its selection shortcut.
- Adobe documents holding Space to access temporary Hand behavior while working with another tool, with Type called out as an exception by Adobe’s interaction guidance.
- Adobe describes Zoom as changing the displayed view rather than the image data. The current desktop guide lists reductions down to a one-pixel view and magnification up to 3200%, defines 100% as one image pixel per monitor pixel, and documents preset click zoom, continuous click-and-hold, Scrubby Zoom drag, a percent field, and the Navigator slider.
- Adobe describes high-density monitor support and per-monitor UI scaling. This app uses `devicePixelRatio` at the image-pixel-to-monitor-pixel boundary so the 100% command remains one image pixel per physical display pixel.
- Adobe describes Rotate View as a non-destructive canvas presentation change. Dragging rotates the view, and Reset View returns the angle to zero.
- View changes do not create pixel history entries. The implementation therefore keeps pan, zoom, and rotation in transient view state rather than `ToolProcessorDefinition`, `HistoryItem`, or durable replay.

## Scope implemented here

- Hand drag updates transient `panX` and `panY`; double-click resets the view.
- The longer logarithmic slider maps physical display magnification to the fit-relative transform. Zoom click and horizontal scrubby drag use the same absolute bounds while preserving the pointer anchor.
- Rotate View horizontal drag and its options-bar slider update transient `rotation`; Escape, Reset View, and double-click reset it.
- The canvas presentation and overlay canvases share the same CSS transform.
- A StoreProvider observer preserves magnification across workspace resize, document-frame change, and display-density change.
- `usePointerPosition` applies the inverse transform before returning document-space coordinates, so existing pixel tools continue to paint and select the intended document point after zoom.

## Unverified or deferred

- Flick panning momentum, Pan All Windows, Overscroll preferences, animated zoom, wheel-zoom preferences, the compass overlay, graphics-processor gating, Shift angle snapping, and Rotate All Windows are not implemented.
- The app control matches Adobe’s documented 3200% maximum and floors at a fixed 10%, rather than Adobe’s one-pixel minimum.

## Sources

- <https://helpx.adobe.com/photoshop/using/tool-techniques/hand-tool.html>
- <https://helpx.adobe.com/photoshop/using/tool-techniques/zoom-tool.html>
- <https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/zoom-images.html>
- <https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/high-density-monitor-support-and-per-monitor-scaling.html>
- <https://helpx.adobe.com/photoshop/using/tool-techniques/rotate-view-tool.html>
- <https://helpx.adobe.com/photoshop/using/viewing-images.html>
- <https://helpx.adobe.com/photoshop/using/touch-gestures.html>
