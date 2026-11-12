import type { ToolDescription } from './types.ts';

type ViewToolName = 'hand' | 'zoom' | 'rotate-view';

export const viewDescriptions: Record<ViewToolName, ToolDescription> = {
  hand: {
    photoshopName: 'Hand Tool',
    summary:
      'Pans the canvas; double-click or Fit On Screen restores contain-fit. No flick momentum, Pan All Windows or Overscroll.',
    purpose:
      "The Hand tool moves the viewport over an image that is larger than the window. It changes only the presentation of the canvas, so panning never creates a History entry or changes exported pixels. Hold Space while another non-Type tool is active for Photoshop's temporary Hand behavior. Double-clicking the Hand surface resets the view to the default centered contain-fit (Fit On Screen). The app also provides a 100% button that centers the image at one image pixel per physical display pixel, accounting for display density.",
    options: [
      {
        control: 'Fit On Screen',
        detail:
          'Restores the default centered view so the whole image fits the workspace (contain-fit). Implemented as a button that dispatches `DEFAULT_VIEW_STATE`.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:32',
      },
      {
        control: '100%',
        detail:
          'Returns the view to a centered 100% scale without rotating the document. At 100%, one image pixel maps to one monitor pixel (accounting for device pixel ratio). Implemented as a button that sets zoom to the 1:1 magnification.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:38',
      },
      {
        control: 'Zoom level display',
        detail:
          'The app adds a live percentage readout and +/- step buttons to the Hand bar; Photoshop places its zoom controls on the Zoom tool bar rather than this Hand-bar control.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:77',
      },
    ],
    modifiers: [
      {
        keys: 'Space',
        action:
          'Temporarily pans with the Hand tool while another non-Type tool is active (spring-loaded). Implemented globally in `AppKeyboardShortcuts.tsx`.',
      },
    ],
    shortcuts: [
      { keys: 'H', action: 'Selects the Hand tool.' },
      { keys: 'Space (hold)', action: 'Spring-loaded Hand tool from any non-Type tool. Implemented globally.' },
      { keys: 'Double-click', action: 'Resets view to Fit On Screen (contain-fit). Implemented on the Hand surface.' },
    ],
    implementation: 'implemented',
    implementationRefs: [
      'src/components/Main/ViewToolArea.tsx:95',
      'src/contexts/view-state.ts:29',
      'src/components/Main/Main.tsx:453',
      'src/components/ToolbarsRight/View/View.tsx:55',
    ],
    appNotes:
      "Panning is transient and is not sent through the processor or history paths. The view state (`panX`, `panY`, `zoom`, `rotation`, `fitScaleCompensation`, `minimumZoomOverride`) lives in `StoreContext` and is updated directly by the tool area and options bar. Flick momentum, Pan All Windows, and the Overscroll preference are not implemented. The Hand bar includes zoom step buttons (+/-) and a live zoom readout that Photoshop's Hand bar does not have (Photoshop puts zoom controls on the Zoom tool's bar). The 100% button on the Hand bar centers at 1:1 magnification; the Fit On Screen button restores the contain-fit. The lower bound follows document size so the shorter edge reaches one physical display pixel — an aspect-ratio interpretation of Adobe's documented one-pixel minimum. Animated zoom, marquee zoom, and wheel preferences are not implemented.",
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/hand-tool.html',
      'https://helpx.adobe.com/photoshop/using/touch-gestures.html',
    ],
  },
  zoom: {
    photoshopName: 'Zoom Tool',
    summary:
      'Click or scrub to zoom around the pointer; Ctrl/Cmd+wheel zooms and unmodified wheel pans. No animated or marquee zoom.',
    purpose:
      "The Zoom tool changes the displayed scale of the canvas and keeps the clicked point under the pointer. Click to zoom in, hold Alt or Option to zoom out, and drag horizontally for a scrubby zoom. View scale is transient and never becomes a document edit or History entry. The options bar provides a continuous zoom slider (0–VIEW_ZOOM_SLIDER_STEPS), a live zoom readout, Fit On Screen, and 100% buttons. The lower bound follows document size so the shorter edge reaches one physical display pixel — an aspect-ratio interpretation of Adobe's documented one-pixel minimum.",
    options: [
      {
        control: 'Zoom',
        detail:
          "Continuous zoom slider ranging from the document minimum zoom (shorter edge = 1 physical pixel) up to 3200% (32x). The slider maps non-linearly to magnification via `viewZoomToSliderPosition` / `sliderPositionToViewZoom`. The readout shows the current percentage. Photoshop's bar has a similar slider and a text field for typing an exact percentage.",
        status: 'present',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:136',
      },
      {
        control: 'Fit On Screen',
        detail: 'Resets the view to the centered contain-fit scale. Implemented as a button.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:32',
      },
      {
        control: '100%',
        detail:
          'Centers the image at one image pixel per physical display pixel, accounting for display density. Implemented as a button.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:38',
      },
    ],
    modifiers: [
      {
        keys: 'Alt/Option',
        action:
          'Reverses a click or scrubby drag from zoom-in to zoom-out. Implemented: `alternate` flag on gesture reads `event.altKey`.',
      },
      { keys: 'Ctrl/Cmd + wheel', action: 'Zooms around the cursor. Implemented in `onWheel` handler.' },
    ],
    shortcuts: [
      { keys: 'Z', action: 'Selects the Zoom tool.' },
      { keys: 'Click', action: 'Zoom in (1.25x step) at the click point.' },
      { keys: 'Alt/Option + Click', action: 'Zoom out (0.8x step) at the click point.' },
      { keys: 'Drag horizontally', action: 'Scrubby zoom (continuous zoom proportional to drag distance).' },
      { keys: 'Ctrl/Cmd + Wheel', action: 'Zoom around cursor.' },
      { keys: 'Wheel', action: 'Pan (when Zoom tool is active and no modifier).' },
    ],
    implementation: 'implemented',
    implementationRefs: [
      'src/components/Main/ViewToolArea.tsx:108',
      'src/components/ToolbarsRight/View/View.tsx:89',
      'src/hooks/usePointerPosition.ts:354',
    ],
    appNotes:
      "The view percentage stays stable when the workspace is resized or moved between displays with different pixel density; pan and zoom remain outside document history. The zoom slider uses a non-linear mapping to magnification (`VIEW_ZOOM_SLIDER_STEPS` = 1000 steps) with a dynamic minimum zoom that ensures the shorter document edge reaches at least one physical display pixel. The slider interaction freezes the minimum zoom floor (`interactionMinimumZoom`) during drag/keyboard interaction so the slider doesn't jump when the floor changes. The minimum zoom floor is derived from `minimumSliderZoomForCurrentView` which accounts for document frame size, current magnification, and any `minimumZoomOverride` from prior crops. Animated zoom, marquee zoom (drag a box to zoom to it), and wheel preferences (zoom on scroll without modifier) are not implemented. Double-click on the Zoom surface does not reset (only Hand and Rotate View do).",
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/zoom-images.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/high-density-monitor-support-and-per-monitor-scaling.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/zoom-tool.html',
      'https://helpx.adobe.com/photoshop/using/viewing-images.html',
    ],
  },
  'rotate-view': {
    photoshopName: 'Rotate View Tool',
    summary:
      'Rotates the canvas view; Shift snaps to 15°. Esc, Reset View or double-click returns to 0°. No compass, GPU checks or Rotate All Windows.',
    purpose:
      'The Rotate View tool turns the displayed canvas so a retoucher can work at a comfortable angle. The image data remains unchanged and the rotation is not recorded in History. Drag around the workspace centre to rotate; the rotation angle is measured from the viewport center. Press Escape or click Reset View to return to zero degrees. Double-click the tool surface also resets. The options bar provides a numeric angle input (-180 to 180) and a Reset View button.',
    options: [
      {
        control: 'Rotation Angle',
        detail:
          'Sets the displayed angle from -180 to 180 degrees. A numeric input with `step="any"`. The value is normalized to (-180, 180] with -180 mapped to 180. Implemented in `RotateView` component.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:185',
      },
      {
        control: 'Reset View',
        detail:
          'Returns the displayed rotation to zero without changing pixels. Implemented as a button that sets `rotation: 0`.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:195',
      },
    ],
    modifiers: [
      {
        keys: 'Shift',
        action:
          'Snaps a rotate drag to 15° increments. Implemented: `event.shiftKey ? Math.round(rotation / 15) * 15 : rotation`.',
      },
    ],
    shortcuts: [
      { keys: 'R', action: 'Selects the Rotate View tool.' },
      {
        keys: 'Shift+H',
        action: 'Cycles between the Hand and Rotate View tools. Implemented in `AppKeyboardShortcuts.tsx`.',
      },
      {
        keys: 'Esc',
        action:
          'Resets the view angle to zero while Rotate View is active. Implemented in `ViewToolArea` (double-click also resets).',
      },
      { keys: 'Double-click', action: 'Resets the view angle to zero. Implemented on the Rotate View surface.' },
    ],
    implementation: 'implemented',
    implementationRefs: [
      'src/components/Main/ViewToolArea.tsx:99',
      'src/components/ToolbarsRight/View/View.tsx:174',
      'src/components/Common/AppKeyboardShortcuts.tsx:502',
    ],
    appNotes:
      'Rotation is a CSS presentation transform (`transform: rotate(${rotation}deg)`) applied to the workspace canvas and remains outside document history. The rotation is measured from the viewport center, not the document center. The angle is normalized to the range (-180, 180] with -180 mapped to 180. Graphics-processor capability checks, a compass overlay, and Rotate All Windows are not implemented. The Shift constraint (15° increments) applies during the drag gesture, not to the numeric input. The tool surface cursor is `cursor-grab` when idle, `cursor-grabbing` when dragging.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/rotate-view-tool.html',
      'https://helpx.adobe.com/photoshop/using/viewing-images.html',
    ],
  },
};
