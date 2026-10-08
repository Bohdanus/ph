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
        appRef: 'src/components/ToolbarsRight/View/View.tsx:1',
      },
      {
        control: '100%',
        detail: 'Returns the view to a centered 100% scale without rotating the document.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:1',
      },
    ],
    modifiers: [
      { keys: 'Space', action: 'Temporarily pans with the Hand tool while another non-Type tool is active.' },
    ],
    shortcuts: [{ keys: 'H', action: 'Selects the Hand tool.' }],
    implementation: 'implemented',
    implementationRefs: [
      'src/components/Main/ViewToolArea.tsx:1',
      'src/contexts/view-state.ts:1',
      'src/components/Main/Main.tsx:1',
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
        detail: 'Sets the displayed scale from 10% through 1600% in this implementation.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:1',
      },
      {
        control: 'Fit On Screen',
        detail: 'Resets the view to the centered contain-fit scale.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:1',
      },
      {
        control: '100%',
        detail: 'Centers the image at 100% display scale.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:1',
      },
    ],
    modifiers: [{ keys: 'Alt/Option', action: 'Reverses a click or scrubby drag from zoom-in to zoom-out.' }],
    shortcuts: [{ keys: 'Z', action: 'Selects the Zoom tool.' }],
    implementation: 'implemented',
    implementationRefs: [
      'src/components/Main/ViewToolArea.tsx:1',
      'src/components/ToolbarsRight/View/View.tsx:1',
      'src/hooks/usePointerPosition.ts:1',
    ],
    appNotes:
      'The pointer anchor, document coordinate inversion, and existing tool gestures follow the transient view transform. Animated zoom, marquee zoom, wheel preferences, and the 25600% desktop maximum are not implemented.',
    sources: [
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
        appRef: 'src/components/ToolbarsRight/View/View.tsx:1',
      },
      {
        control: 'Reset View',
        detail: 'Returns the displayed rotation to zero without changing pixels.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/View/View.tsx:1',
      },
    ],
    modifiers: [],
    shortcuts: [
      { keys: 'R', action: 'Selects the Rotate View tool.' },
      { keys: 'Esc', action: 'Resets the view angle to zero while Rotate View is active.' },
    ],
    implementation: 'implemented',
    implementationRefs: [
      'src/components/Main/ViewToolArea.tsx:1',
      'src/components/ToolbarsRight/View/View.tsx:1',
      'src/components/Common/AppKeyboardShortcuts.tsx:1',
    ],
    appNotes:
      'Rotation is a CSS presentation transform and remains outside document history. Graphics-processor capability checks, compass overlay, Shift snapping, and Rotate All Windows are not implemented.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/rotate-view-tool.html',
      'https://helpx.adobe.com/photoshop/using/viewing-images.html',
    ],
  },
};
