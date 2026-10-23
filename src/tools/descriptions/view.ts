import type { ToolDescription } from './types.ts';

type ViewToolName = 'hand' | 'zoom' | 'rotate-view';

export const viewDescriptions: Record<ViewToolName, ToolDescription> = {
  hand: {
    photoshopName: 'Hand Tool',
    summary: 'Pans the canvas view without moving or changing the document pixels.',
    purpose:
      'The Hand tool moves the viewport over an image that is larger than the window. It changes only the presentation of the canvas, so panning never creates a History entry or changes exported pixels. Hold Space while another non-Type tool is active for Photoshop’s temporary Hand behavior.',
    options: [
      {
        control: 'Fit On Screen',
        detail: 'Restores the default centered view so the whole image fits the workspace.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:8',
      },
      {
        control: '100%',
        detail: 'Returns the view to a centered 100% scale without rotating the document.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:13',
      },
    ],
    modifiers: [
      { keys: 'Space', action: 'Temporarily pans with the Hand tool while another non-Type tool is active.' },
    ],
    shortcuts: [{ keys: 'H', action: 'Selects the Hand tool.' }],
    implementation: 'implemented',
    implementationRefs: [
      'src/components/Main/ViewToolArea.tsx:65',
      'src/contexts/view-state.ts:29',
      'src/components/Main/Main.tsx:453',
    ],
    appNotes:
      'Panning is transient and is not sent through the processor or history paths. Flick momentum, Pan All Windows, and the Overscroll preference are not implemented.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/hand-tool.html',
      'https://helpx.adobe.com/photoshop/using/touch-gestures.html',
    ],
  },
  zoom: {
    photoshopName: 'Zoom Tool',
    summary: 'Magnifies or reduces the canvas around the pointer without changing document pixels.',
    purpose:
      'The Zoom tool changes the displayed scale of the canvas and keeps the clicked point under the pointer. Click to zoom in, hold Alt or Option to zoom out, and drag horizontally for a scrubby zoom. View scale is transient and never becomes a document edit or History entry.',
    options: [
      {
        control: 'Zoom',
        detail: 'Magnifies up to 3200%, with a one-pixel minimum; at 100%, one image pixel maps to one monitor pixel.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:31',
      },
      {
        control: 'Fit On Screen',
        detail: 'Resets the view to the centered contain-fit scale.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:8',
      },
      {
        control: '100%',
        detail: 'Centers the image at one image pixel per physical display pixel, accounting for display density.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:13',
      },
    ],
    modifiers: [{ keys: 'Alt/Option', action: 'Reverses a click or scrubby drag from zoom-in to zoom-out.' }],
    shortcuts: [{ keys: 'Z', action: 'Selects the Zoom tool.' }],
    implementation: 'implemented',
    implementationRefs: [
      'src/components/Main/ViewToolArea.tsx:73',
      'src/components/ToolbarsRight/View/View.tsx:26',
      'src/hooks/usePointerPosition.ts:354',
    ],
    appNotes:
      'The view percentage stays stable when the workspace is resized or moved between displays with different pixel density; pan and zoom remain outside document history. The lower bound follows document size so the shorter edge reaches one physical display pixel, an aspect-ratio interpretation of Adobe’s documented one-pixel minimum. Animated zoom, marquee zoom, and wheel preferences are not implemented.',
    sources: [
      'https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/zoom-images.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/high-density-monitor-support-and-per-monitor-scaling.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/zoom-tool.html',
      'https://helpx.adobe.com/photoshop/using/viewing-images.html',
    ],
  },
  'rotate-view': {
    photoshopName: 'Rotate View Tool',
    summary: 'Rotates the canvas presentation around the viewport without transforming the image.',
    purpose:
      'The Rotate View tool turns the displayed canvas so a retoucher can work at a comfortable angle. The image data remains unchanged and the rotation is not recorded in History. Drag horizontally to rotate, press Escape or Reset View to return to zero degrees, and double-click the tool surface to reset.',
    options: [
      {
        control: 'Rotation Angle',
        detail: 'Sets the displayed angle from -180 to 180 degrees.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:51',
      },
      {
        control: 'Reset View',
        detail: 'Returns the displayed rotation to zero without changing pixels.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:59',
      },
    ],
    modifiers: [],
    shortcuts: [
      { keys: 'R', action: 'Selects the Rotate View tool.' },
      { keys: 'Esc', action: 'Resets the view angle to zero while Rotate View is active.' },
    ],
    implementation: 'implemented',
    implementationRefs: [
      'src/components/Main/ViewToolArea.tsx:69',
      'src/components/ToolbarsRight/View/View.tsx:45',
      'src/components/Common/AppKeyboardShortcuts.tsx:502',
    ],
    appNotes:
      'Rotation is a CSS presentation transform and remains outside document history. Graphics-processor capability checks, compass overlay, Shift snapping, and Rotate All Windows are not implemented.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/rotate-view-tool.html',
      'https://helpx.adobe.com/photoshop/using/viewing-images.html',
    ],
  },
};
