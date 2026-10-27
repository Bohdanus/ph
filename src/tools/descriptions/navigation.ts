import type { ToolDescription } from './types.ts';

/**
 * The navigation family.
 *
 * Navigation and measuring: the tools that change where you are looking rather than what the
 * document contains. Adobe's Hand tool and its Rotate View companion are the two members — they
 * share one rail tile, as they do in Photoshop. The Zoom tool, Frame, Slice, Ruler, Note and
 * Count are absent and are catalogued in `docs/TOOLS-INVENTORY.md`, whose contract is that every
 * row there is missing from `src/contexts/tool-types.ts`.
 *
 * It is its own module rather than a row in `eyedropper-draw.ts` because it shares nothing
 * with that family but the accident of both being small. `HANDOFF.md` §74 names the
 * measurement band — Color Sampler, Ruler, Note, Count — as the next cheapest architectural
 * addition precisely because they are pixel-free like the Eyedropper, so this module is where
 * they land.
 *
 * Research notes, and the claims this file could not source, are in `navigation.notes.md`.
 */
export const navigationDescriptions: Record<'hand' | 'rotate-view', ToolDescription> = {
  hand: {
    photoshopName: 'Hand Tool',
    summary: 'Drag to move the image around the window without changing the zoom level.',
    purpose:
      'The Hand tool repositions the view of the image inside the document window, and nothing else — it moves no pixels, records no history state, and leaves the zoom level exactly as it was. Adobe scopes it to the magnified case: the tool exists to reach the parts of a zoomed image that are off screen. It is the ordinary way to navigate once an image is larger than the window, and it is the one navigation tool that does not change magnification.',
    options: [
      {
        control: 'Fit On Screen',
        detail:
          "Scales the view so the whole image is visible in the window, keeping its aspect ratio. Adobe's Hand page documents the tool's activation and its drag and does not enumerate the bar, so this control is the one the app's own research recorded from Adobe's viewing-images page rather than from an audited options bar.",
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Hand/Hand.tsx:33',
      },
    ],
    modifiers: [],
    shortcuts: [
      { keys: 'H', action: 'Selects the Hand tool, and it stays selected until another tool is chosen.' },
      {
        keys: 'Space',
        action:
          'While held, temporarily switches to the Hand tool from whichever tool is active. Releasing it restores that tool, and the selected tool never changes.',
      },
      { keys: 'Cmd+0', action: 'Fit on Screen — the same command the double-click performs.' },
    ],
    implementation: 'implemented',
    implementationRefs: [
      'src/components/Main/HandToolArea.tsx:40',
      'src/hooks/useTemporaryHand.ts:97',
      'src/util/view-transform.ts:175',
      'src/util/view-transform.ts:228',
      'src/hooks/document-view.ts:172',
      'src/hooks/useViewTransform.ts:26',
      'src/components/ToolbarsRight/Hand/Hand.tsx:25',
      'toolbar-mapping.ts:151',
    ],
    appNotes:
      'The tool itself behaves as Adobe documents, and one thing it depends on is narrower than Photoshop. There is no Zoom tool: the magnification behind the Hand is reached only from Ctrl+0 (Fit), Ctrl+1 (Actual Pixels), Ctrl++ and Ctrl+- (stepped), a wheel gesture and the options bar. Adobe reaches the same states through a Zoom tool with Scrubby Zoom and zoom presets, a Navigator panel and its own flyout beside this one, and this app has none of those, so the Hand is a standalone tile rather than the first half of a Hand/Zoom pair. A pan is not clamped, which is Adobe behaviour and this app matches it: a drag takes the image as far as the pointer goes, at every zoom, and the image may be pulled onto the pasteboard and out of the window entirely. Fit On Screen is therefore a recovery path as much as a convenience, and it is reachable three ways — Ctrl+0, Ctrl+1, and double-clicking the Hand tile, which is the Adobe gesture for it. Adobe scopes the Hand to the magnified case ("part of the image is out of view") because that is when panning is useful, not because it is refused when it is not. The spring-loaded Spacebar also refuses to arm while a document-committing drag is already in flight, so Space pressed mid brush-stroke pans nothing; Adobe moves the in-progress marquee in that case and pans the view under a brush. That divergence is deliberate and is recorded for the operator in docs/OVERRIDES.md, which this repository does not write.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/hand-tool.html',
      'https://www.nobledesktop.com/shortcuts/photoshopcc2017/pc',
    ],
  },

  'rotate-view': {
    photoshopName: 'Rotate View Tool',
    summary: 'Turn the view of the canvas without turning the image inside it.',
    purpose:
      'The Rotate View tool changes the angle at which the canvas is viewed, and does not rotate or transform the image: the pixels, the layer and the export are untouched, so a tilted view is a way of looking at the document rather than an edit to it. Adobe positions it as the second member of the Hand tool’s own group, reached by holding the Hand and selecting it, and this app puts the two on one rail tile with `R` and `Shift+H` as the two ways in. It is the tool for working on a rotated composition — checking a diagonal edge, reading a tilted line of text — where turning the image itself would mean a transform the user would have to undo.',
    options: [
      {
        control: 'Rotation Angle',
        detail:
          'A numeric field carrying the current angle in degrees, which the user can type into as well as read from while dragging. Adobe names the field and says to "enter rotation numerically in the Rotation Angle field in the Options Bar".',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/RotateView/RotateView.tsx:62',
      },
      {
        control: 'Reset View',
        detail:
          'Returns the view to its normal orientation. Adobe names the control and says to "Select Reset View … to return to normal orientation", so here it sets the ANGLE ONLY: the pan and the zoom are deliberately left where the user put them, because orientation and framing are two different things and a control that quietly re-fitted as well would be a second command wearing this one name.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/RotateView/RotateView.tsx:46',
      },
    ],
    modifiers: [
      {
        keys: 'Shift',
        action:
          'Snaps a rotate drag to 15° steps. THIRD-PARTY SOURCED, not confirmed against an Adobe page, and the app applies it to the DRAG only — an angle typed into the Rotation Angle field is taken as typed.',
      },
    ],
    shortcuts: [
      { keys: 'R', action: 'Selects the Rotate View tool.' },
      { keys: 'Shift+H', action: 'Cycles between the Hand and Rotate View, which share one tile.' },
    ],
    implementation: 'implemented',
    implementationRefs: [
      'src/components/Main/RotateViewToolArea.tsx:42',
      'src/components/ToolbarsRight/RotateView/RotateView.tsx:29',
      'src/util/view-transform.ts:103',
      'src/hooks/document-view.ts:233',
      'toolbar-mapping.ts:166',
    ],
    appNotes:
      'Two things about the mechanism rather than the behaviour. First, Adobe’s research row for this tool notes that it "requires OpenGL"; this app turns the view with a CSS transform on the existing .zoom-container, which the browser composites, so the result on screen is the same by a different route and there is no WebGL here. Second, the Rotation Angle field is bounded to -180..180 and wraps, and that range is a judgement call rather than an Adobe value: the research records the field and Reset View from Adobe’s page but not the bounds it accepts, and an unbounded field lets a typed 3600 produce an orientation indistinguishable from 0 while the displayed number disagrees with the screen. The rotation origin is the centre of the window, which is also the centre of the document at Fit; Adobe’s pivot is not established by the research. The drag is RELATIVE — it applies the change in the pointer’s angle from where the drag began — so a view that is already tilted is tilted further rather than snapped to point at the cursor, and a second drag continues from the first. As with the Hand, the spring-loaded Spacebar refuses to arm while a document-committing drag is in flight, so Space pressed mid rotation rotates nothing; that divergence is recorded for the operator in docs/OVERRIDES.md, which this repository does not write.',
    sources: ['https://helpx.adobe.com/photoshop/using/tool-techniques/rotate-view-tool.html'],
  },
};
