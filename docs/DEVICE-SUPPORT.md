# Device Support Boundary

This is a hard product requirement, not a responsive-design suggestion.

## Supported

- Desktop and laptop browsers.
- Tablet-sized touch devices, including iPad-class devices and Android tablets.
- Retina/high-DPI displays. Canvas backing-store sizing, pointer coordinates, previews, and exported
  pixels must remain correct at device pixel ratios above 1.

## Not Supported

- Handheld phone layouts, including iPhone-sized screens.
- Phone-specific navigation shells, bottom toolbars, phone-only gestures, or phone breakpoints.
- Treating a generic `mobile` component/file name as permission to implement handheld behavior.

The existing `Mobile*` component names are historical. When they are touched, interpret them as the
tablet touch surface unless a requirement explicitly says otherwise. Tablet touch work must preserve
the desktop tool and panel contract; it must not become a separate phone product.

## Retina/High-DPI Implementation Status

**Requirement:** All canvas backing stores, pointer coordinates, previews, and exported pixels must be correct at device pixel ratios above 1.

**Current Implementation (as of CANVAS-RESOLUTION-PLAN.md):**

| Area                                                                                        | Status                     | Notes                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Paint algorithms** (10 tools)                                                             | ✅ **DPR-proof**           | All geometry paths are DPR-invariant; pointer mapping is exact at any DPR (pinned by test). No `ctx.scale`/`setTransform` in paint paths.                                                     |
| **Pointer mapping**                                                                         | ✅ **Correct**             | `usePointerPosition` derives scale from layout pixels only; test at `devicePixelRatio = 3` passes.                                                                                            |
| **Export / persistence / clipboard**                                                        | ✅ **Decoupled & correct** | Export uses detached canvas at document resolution; display canvas scaling no longer affects export.                                                                                          |
| **Option-bar thumbnails** (Draw, Paint, Shape)                                              | ✅ **Fixed (D2a)**         | Backing store multiplied by `dpr`; `drawImage` at 1:1.                                                                                                                                        |
| **Overlay chrome** (marching ants, selection anchors)                                       | ✅ **Fixed (D3)**          | All four painters divide CSS px constants by contain-fit scale.                                                                                                                               |
| **Display surfaces** (workspace canvas, tool overlay, rect overlay, selection ants overlay) | ❌ **1× only (D2c open)**  | Backing stores are document pixels; CSS `object-contain` upscales by `scale × dpr`. Retouching cannot fix this — the resolution simply is not there. See `CANVAS-RESOLUTION-PLAN.md` Phase 4. |

**Fragile sites for D2c (display resolution increase):**

- `EyedropperToolArea.tsx`: clips sample window against `canvas.width`/`canvas.height` (would sample half-size physical region at 2×)
- `rect.ts:144` / `text.ts:75-80`: text tool measures on overlay context but bakes into layer-sized OffscreenCanvas (diverge at 2×)
- `useRect.ts:216`/`221`: clears with document `imageSize` but clamps with overlay backing store (different units that coincide only at 1×)

## Engineering Rules

- Use tablet viewport fixtures for touch tests, not iPhone-sized viewports.
- Exercise both CSS-pixel and Retina/high-DPI paths where canvas or pointer math is involved.
- Keep the Tools rail pinned to the left edge and the Layers/History dock pinned to the right edge.
  Only the right dock width and its internal vertical separator are resizable; neither dock is
  draggable left or right.
- Do not add phone-only behavior to satisfy a test. Update the requirement or document an explicit
  override first.
- **Thread the scale as a parameter; do not read `window.devicePixelRatio` at the point of use.** Jsdom tests cannot observe DPR; an injected ratio is testable and better design.
- **Never re-record an export baseline to accommodate display resolution changes.** Export dimensions are a correctness invariant (800×600 baseline must stay).
