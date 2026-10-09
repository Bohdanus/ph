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

## Engineering Rules

- Use tablet viewport fixtures for touch tests, not iPhone-sized viewports.
- Exercise both CSS-pixel and Retina/high-DPI paths where canvas or pointer math is involved.
- Keep the Tools rail pinned to the left edge and the Layers/History dock pinned to the right edge.
  Only the right dock width and its internal vertical separator are resizable; neither dock is
  draggable left or right.
- Do not add phone-only behavior to satisfy a test. Update the requirement or document an explicit
  override first.
