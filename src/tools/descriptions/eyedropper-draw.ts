import type { ToolDescription } from './types.ts';

export const eyedropperDrawDescriptions: Record<'eyedropper' | 'color-sampler' | 'draw' | 'ruler', ToolDescription> = {
  eyedropper: {
    photoshopName: 'Eyedropper Tool',
    summary:
      'Samples a color from the composited canvas at the pointer position and writes it to the foreground or background swatch; no drag preview, no history entry.',
    purpose:
      'The Eyedropper reads a color from the composited workspace canvas and sets it as the foreground color (click) or background color (Alt-click). The sampled color is not added to the Swatches panel in this app. Sample Size sets the averaging footprint: Point Sample reads the exact center pixel, and 3×3 through 101×101 Average read the arithmetic mean of an odd-sided square clipped at the document frame. Adobe documents a drag gesture where the color box updates live; this app samples only on pointer-down, so a drag uses the first pixel, not the release pixel. Holding Alt from any painting tool temporarily activates the Eyedropper at its current Sample Size, sampling to the foreground color.',
    options: [
      {
        control: 'Sample Size',
        detail:
          'Sets the sampling footprint. Adobe enumerates seven entries: Point Sample (1×1), 3 by 3 Average, 5 by 5 Average, 11 by 11 Average, 31 by 31 Average, 51 by 51 Average, 101 by 101 Average. No Median entries. The menu order and labels match Adobe. The app seeds Point Sample. The footprint is an odd-sided square centred on the click, clipped at the document frame rather than shifted inward, reduced by an arithmetic mean with per-channel rounding.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Eyedropper/Eyedropper.tsx:22',
      },
      {
        control: 'Sample',
        detail:
          'Chooses which layers a sample is read from: All Layers, Current Layer, Current & Below, and the No Adjustments variants. Adobe enumerates that menu and states no default. Earlier versions expressed this as a Sample All Layers checkbox. The app renders no control for it. The `sampleAllLayers` field persists in settings (seeded `false` at `src/tools/settings.ts:265`), no control writes it, and a click that finds it `true` refuses loudly with `eyedropper-sample-all-layers-unsupported` rather than silently sampling the composite. The tool always samples the composited workspace canvas.',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Alt',
        action:
          'Sets the sampled color as the background color instead of the foreground color. This is a click-only modifier in this app — there is no drag preview, so the sample is taken at pointer-down and the background swatch updates once.',
      },
    ],
    shortcuts: [
      {
        keys: 'I',
        action:
          'Selects the Eyedropper. Holding I temporarily switches to it (spring-loaded) while another tool is active.',
      },
      {
        keys: 'Shift+I',
        action:
          'Cycles the tools that share the letter: Eyedropper, Color Sampler, Ruler, Note and Count. The app cycles its three implemented members (Eyedropper, Color Sampler and Ruler); Note and Count are absent.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/components/Main/EyedropperToolArea.tsx:59',
      'src/components/Main/EyedropperToolArea.tsx:102',
      'src/components/Main/EyedropperToolArea.tsx:133',
      'src/components/ToolbarsRight/Eyedropper/Eyedropper.tsx:22',
      'src/tools/eyedropper.ts:7',
      'src/tools/eyedropper.ts:34',
      'src/tools/toolProcessors.ts:82',
      'src/tools/toolsMap.ts:148',
      'toolbar-mapping.ts:64',
    ],
    appNotes:
      'The app implements the tool without a processor: it is a member of `PIXEL_FREE_TOOLS`, so it rasterizes nothing, has no `commit` kind, and its `toolsMap` entry carries only an icon and an options bar. A click dispatches `SET_COLOR` or `SET_BACKGROUND_COLOR` and nothing else — no history entry, not undoable (same class as zoom, panel move, tool switch). Three behaviors diverge from Photoshop: (1) Drag gesture: the app only has `handlePointerDown` wired to `onPointerDown`; no `onPointerMove` or `onPointerUp` handlers exist, so the sample is taken at pointer-down alone, no live preview during drag, and a drag samples the first pixel not the release pixel. (2) Sample All Layers: no control rendered; the `sampleAllLayers` field persists in settings but no control writes it, and `true` triggers a loud refusal (`eyedropper-sample-all-layers-unsupported`). (3) Swatches panel: the sampled color is not added to any swatches panel (the app has no Swatches panel). The composited read samples the workspace canvas (all visible layers composited), not the active layer alone. Alpha is dropped because the foreground/background swatches are `<input type="color">` which cannot express alpha. A click outside the frame dispatches nothing.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/eyedropper-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/adjust-color/choose-colors/set-foreground-and-background-colors.html',
      'https://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html',
    ],
  },

  'color-sampler': {
    photoshopName: 'Color Sampler Tool',
    summary:
      'Places up to four numbered markers with RGB/hex readouts. Drag to move; Alt-click or drag off-canvas to delete. Clear removes all markers.',
    purpose:
      'The Color Sampler places persistent markers that report color values at fixed document locations. Up to four markers can exist simultaneously (Adobe documents four; some third-party observations say ten — the conflict is recorded in `src/tools/colorSampler.ts`). Click places a marker; dragging a marker moves it; dragging a marker outside the document frame deletes it; Alt-clicking a marker deletes it (the scissors cursor is not drawn — the app has no cursor registry). The Clear button removes all markers at once and is disabled when none exist. Sample Size sets the averaging footprint identically to the Eyedropper. The `Sample` dropdown (All Layers / Current Layer / Current & Below / No Adjustments variants) is not rendered; the app always reads the composited canvas. The `Change the display of the sample values` color-space switcher is not rendered (the app has no Info panel). Markers persist in a module store (`color-sampler-store.ts`), not in `StoreContext`, because a measurement is not a document fact. Readouts are frozen at placement — they do not track edits — because the app has no invalidation seam for pixel changes; a live readout would go stale on every edit. Readouts report RGB channels and hex only; no Lab, XYZ, or CMYK conversion exists.',
    options: [
      {
        control: 'Sample Size',
        detail:
          'Sets the footprint each marker reads, identical to the Eyedropper: Point Sample (1×1), 3 by 3 Average, 5 by 5 Average, 11 by 11 Average, 31 by 31 Average, 51 by 51 Average, 101 by 101 Average. The app renders all seven with Adobe labels and seeds Point Sample. The block is clipped at the frame edge rather than shifted inward.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/ColorSampler/ColorSampler.tsx:64',
      },
      {
        control: 'Clear',
        detail:
          'Removes every sampler at once. The button is disabled while no sampler exists. Implemented in `ColorSamplerToolArea` via `removeColorSampler` on the store.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/ColorSampler/ColorSampler.tsx:108',
      },
      {
        control: 'Sample',
        detail:
          "Photoshop's layer-source dropdown — All Layers, Current Layer, Current & Below and the No Adjustments variants. The app renders no control for it and reads the composited canvas for every marker (the Eyedropper's `All Layers` end). Recorded rather than omitted so the gap is visible.",
        status: 'missing',
      },
      {
        control: 'Change the display of the sample values',
        detail:
          'The per-marker colour-space switcher. Adobe documents its function in the Info panel; no source for the options-bar label itself. The app has no Info panel, so it renders no switcher and reports RGB and hex only, both direct readings of the sampled pixel.',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Alt',
        action:
          'Deletes the marker under the pointer. The scissors cursor is not drawn (the app has no cursor registry), but the gesture is implemented. Checked on pointer-down before drag so a deletion takes precedence over a move.',
      },
      {
        keys: 'Shift',
        action:
          'With the Eyedropper selected, Shift-click places a sampler and Shift+Alt-click deletes one. Both gestures live in `EyedropperToolArea` because `ColorSamplerToolArea` is not mounted while the Eyedropper holds the tile.',
      },
    ],
    shortcuts: [
      {
        keys: 'I',
        action:
          'Selects Eyedropper if no member of the Eyedropper/Color Sampler/Ruler group is selected; otherwise keeps the current group member.',
      },
      {
        keys: 'Shift+I',
        action:
          'Cycles the tools that share the letter: Eyedropper, Color Sampler, Ruler, Note and Count. The app cycles its three implemented members (Eyedropper, Color Sampler and Ruler); Note and Count are absent.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/components/Main/ColorSamplerToolArea.tsx:166',
      'src/components/Main/ColorSamplerToolArea.tsx:210',
      'src/components/Main/ColorSamplerToolArea.tsx:152',
      'src/components/Main/ColorSamplerToolArea.tsx:51',
      'src/components/Main/EyedropperToolArea.tsx:114',
      'src/components/ToolbarsRight/ColorSampler/ColorSampler.tsx:49',
      'src/components/ToolbarsRight/ColorSampler/ColorSampler.tsx:64',
      'src/tools/colorSampler.ts:137',
      'src/tools/colorSampler.ts:68',
      'src/tools/color-sampler-store.ts:69',
      'src/tools/toolProcessors.ts:110',
      'src/tools/toolsMap.ts:154',
      'toolbar-mapping.ts:81',
    ],
    appNotes:
      'The tool is a pixel-free tool — it has no entry in `toolProcessors.ts` and dispatches nothing. Adobe\'s one-line summary is a readout ("displays color values for up to four areas"), so placing a marker changes no pixel, creates no history state, and needs no durable operation. Six behaviors diverge from Photoshop: (1) Cap is four (Adobe docs say four; Julieanne Kost and two third-party observations say ten — recorded in `colorSampler.ts`). (2) Refusal at cap is loud, not a silent replacement — no source describes Photoshop replacing the oldest marker. (3) Readouts are RGB and hex only, frozen at placement (no Info panel, no invalidation seam). (4) `Sample` dropdown absent; always reads composite. (5) `Change display` absent; no color-space switcher. (6) Scissors cursor absent; no cursor registry. The marker glyph is a crosshair (drawn dark then light for contrast over any background); Adobe sources disagree on the glyph (crosshair vs target icon) and no Adobe sentence describes it. The hit radius for grab/delete is 8 document pixels (`COLOR_SAMPLER_HIT_RADIUS`), an app decision; Adobe states the gesture but publishes no tolerance. A document resize drops all samplers (`syncColorSamplerFrameSize`).',
    sources: [
      'https://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html',
      'https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/painting-tools-overview.html',
      'https://helpx.adobe.com/photoshop/using/image-information.html',
      'https://helpx.adobe.com/photoshop/using/tool-techniques/eyedropper-tool.html',
      'https://helpx.adobe.com/photoshop/using/show-or-hide-non-printing.html',
      'https://developer.adobe.com/photoshop/uxp/ps_reference/classes/colorsampler',
      'https://jkost.com/blog/2018/03/the-eyedropper-color-samplers-and-info-panel-in-photoshop-cc.html',
    ],
  },

  draw: {
    photoshopName: "No Photoshop tool — this app's own tool (nearest Photoshop: Brush tool)",
    summary:
      "This app's own freehand stroke tool (OVR-2 override): a drag becomes a new layer of ink, drawn with Pen, Dashed Pen, or Spray renderers.",
    purpose:
      'Draw is the app-only OVR-2 override: Photoshop has no Draw tool, but this app deliberately keeps one. This bar documents its local behavior rather than claiming Photoshop parity. A drag accumulates pointer samples into a stroke; the stroke is drawn in the foreground color; the finished stroke is committed as a new layer (each mark is a separately undoable, separately deletable object). A Pen Type dropdown picks one of three renderers — Pen (solid round-capped stroke), Dashed Pen (dashed stroke with configurable Dash and Gap), Spray (soft radial gradients with Flow controlling deposit rate). Size, Opacity, and Spray Flow shape all three; Dash and Gap are Dashed Pen only. A live preview at the end of the bar draws the current settings. A user coming from Photoshop should reach for the Brush tool for the solid stroke. This app has no dedicated Airbrush toggle; Spray Flow builds deposits while the pointer is held. There is no Photoshop equivalent to a dashed freehand ink stroke. No keyboard shortcut is declared (OVR-2); the tool is reachable by pointer only.',
    options: [
      {
        control: 'Brush Preset picker',
        detail:
          "Opens the brush tip chooser, and lets the current preset's Size and Hardness be changed without reopening the Brush panel. The app has no brush tips, so there is no picker and no hardness.",
        status: 'missing',
      },
      {
        control: 'Size',
        detail:
          "The diameter of the brush tip, in pixels. Photoshop's Size runs from 1 to 5000 px; the app's slider runs from 0.5 to 500 in steps of 0.5.",
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Draw/Draw.tsx:172',
      },
      {
        control: 'Mode',
        detail:
          "The blend mode the stroke's paint composites with. Default: Normal. Declared on args but no Draw-bar control writes it; the value is always absent.",
        status: 'missing',
      },
      {
        control: 'Opacity',
        detail:
          'The transparency of the color applied. As a stroke passes over an area the color does not exceed this level until the button is released; a further stroke adds more. Adobe states no default; the app seeds 90% for Pen and Dashed Pen, 50% for Spray.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Draw/Draw.tsx:234',
      },
      {
        control: 'Flow',
        detail:
          'The rate at which spray deposits build while the pointer is held, independently of Opacity. The app exposes a 1–100% Flow slider for Spray only; one tap remains visible at any Flow. Adobe states no default for it.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Draw/Draw.tsx:257',
      },
      {
        control: 'Airbrush',
        detail:
          'A toggle that keeps the brush laying down color while the pointer is held still. The Draw bar has no dedicated Airbrush toggle; its Spray Flow control does build deposits during a stationary hold, but Spray is selected from the Pen Type dropdown.',
        status: 'missing',
      },
      {
        control: 'Smoothing',
        detail:
          'How much intelligent smoothing is applied to the stroke, 0 to 100. Adobe names the Brush, Pencil, Mixer Brush and Eraser as the tools it applies to. The app declares `smoothing` on the draw args but no Draw-bar control writes it, so the value is always absent.',
        status: 'missing',
      },
      {
        control: 'Pen Type',
        detail:
          'App-only dropdown with three renderers: Pen (solid round-capped), Dashed Pen (dashed with Dash/Gap), Spray (soft radial gradients). Not a Photoshop control.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Draw/Draw.tsx:140',
      },
      {
        control: 'Dash',
        detail: 'Dashed Pen only: the length of each dash in pixels. No Photoshop counterpart.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Draw/Draw.tsx:188',
      },
      {
        control: 'Gap',
        detail: 'Dashed Pen only: the gap between dashes in pixels. No Photoshop counterpart.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Draw/Draw.tsx:201',
      },
    ],
    modifiers: [],
    shortcuts: [],
    implementation: 'implemented',
    implementationRefs: [
      'src/components/ToolbarsRight/Draw/Draw.tsx:20',
      'src/components/Main/DrawToolArea.tsx:112',
      'src/util/draw.ts:216',
      'src/tools/draw.ts:6',
      'src/tools/toolProcessors.ts:153',
      'src/tools/settings.ts:53',
      'toolbar-mapping.ts:116',
    ],
    appNotes:
      "No Photoshop provenance is claimed and none is invented: the Tools panel has no freehand-annotation or pen-stroke tool, and this app's Draw tile sits in the tonal group where Photoshop has no tool at all (OVR-2). The nearest Photoshop tools are the Pen tool family (path work) and the Brush (freehand paint). The `shortcut` field on a toolbar entry is display-only and binds nothing; its only consumers are the tile tooltip and the `<kbd>` in the flyout. Key bindings live in a separate hand-written table. This tool declares no shortcut. Adobe's published default-keyboard-shortcut reference gives no letter for a Draw tool, so there is no Adobe binding this app is surrendering; the letters are occupied by this app's own keymap — `W`/`Shift+W` select Object Selection, `B`/`Shift+B` select the Brush group — so there is no free key to declare. It was previously badged `B`, which was wrong twice: `B` belongs to the Brush in Photoshop, and in this app `B` is bound to the brush group with `Shift+B` cycling it, so pressing `B` selected the Brush and could never select this tool. The badge is gone rather than reassigned because a declared shortcut the app does not implement is a falsehood the rail prints. Photoshop's spring-loaded switch is also absent: no key selects this tool, so holding a letter cannot reach it either. The `Mode` and `Smoothing` fields are declared on args but unreachable from this bar — no draw control writes either, the default args set neither, and a draw stroke's layer is forced to Normal by the blend-mode gate that admits only the paint tools. Three of the Brush bar's controls diverge rather than match: Size capped at 500 vs 5000, Opacity seeded per-pen vs 100%, and no Flow on Pen/Dashed Pen (Spray Flow is a different control). Each stroke commits via `createLayerFromTool` (new layer), unlike Photoshop's Brush which paints into the active layer.",
    sources: [
      'https://helpx.adobe.com/photoshop/using/painting-tools.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/create-smoother-more-polished-brush-strokes-with-stroke-smoothing.html',
      'https://helpx.adobe.com/ee/photoshop/how-to/color-management-basics.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html',
      'https://helpx.adobe.com/photoshop/using/default-keyboard-shortcuts.html',
    ],
  },

  ruler: {
    photoshopName: 'Ruler Tool',
    summary:
      'Measures position, distance and angle with a nonprinting line; Shift constrains to 45°. Alt-drag an endpoint to add a protractor leg.',
    purpose:
      'The Ruler measures distances and angles on the canvas without changing pixels. Drag a line from one point to another; the options bar reports the starting location (X, Y), horizontal and vertical distances (W, H), angle relative to the axis (A), and total length (D1). The line is a nonprinting overlay — it creates no history state, cannot be undone, and disappears when dragged out of the frame or cleared. Shift constrains the drag to 45° increments. Alt-drag (Option-drag on macOS) from within 8 document pixels of either endpoint pulls a second leg (D2) turning the measurement into a protractor; the angle (A) then reads the angle between the two legs. The double-click alternative ("double-click the line and drag") is not implemented because Adobe does not specify which end pivots. The measurement scale (Image > Analysis > Set Measurement Scale) is not implemented — the app has no Analysis menu. There is no Info panel; the options bar is the only surface for readouts. The ruler line survives a tool switch (Adobe: "If your document has an existing measuring line, selecting the Ruler tool causes it to be displayed").',
    options: [
      {
        control: 'X, Y',
        detail:
          'The starting location of the measurement (the pointer-down point). The app reads the pointer-down point directly, so a drag that ends up and to the left of where it started reports the start it was given.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Ruler/Ruler.tsx:42',
      },
      {
        control: 'W, H',
        detail:
          'The horizontal and vertical distances traveled from the x and y axes. Both are unsigned magnitudes in the app (a drag up-left reports the same W, H as down-right); Adobe prints them as unsigned distances too.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Ruler/Ruler.tsx:44',
      },
      {
        control: 'A',
        detail:
          "The angle measured relative to the axis, in degrees. Exempt from document units per Adobe. With a protractor present, the bar re-reads A as the angle between the two legs (Adobe's own reuse of the same letter).",
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Ruler/Ruler.tsx:46',
      },
      {
        control: 'D1',
        detail:
          'The total length traveled, reported in document pixels (the app has no Units & Rulers preference). A measurement scale would rescale this number, not the geometry.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Ruler/Ruler.tsx:47',
      },
      {
        control: 'D2',
        detail:
          'The second leg of a protractor. Present only after an Alt-drag has pulled a leg from an existing line; absent before that, not reported as zero.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Ruler/Ruler.tsx:50',
      },
      {
        control: 'Clear',
        detail:
          'Removes the measuring line. Adobe describes two ways: drag it outside the image area, or press Clear. The app implements both; the button is disabled while no line exists.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Ruler/Ruler.tsx:64',
      },
      {
        control: 'Use Measurement Scale',
        detail:
          "A checkbox Adobe's Ruler page does not document and this app does not render. The scale itself is an Image > Analysis menu command; the app has no Analysis submenu. Recorded so the gap is visible.",
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Shift',
        action:
          'Constrains the measuring line to 45-degree increments — the drag is rotated onto the nearest multiple of 45° while keeping its length and direction of travel.',
      },
      {
        keys: 'Alt',
        action:
          'Pulls a second leg out of an existing measuring line (protractor). The drag must start within 8 document pixels of either end (`RULER_ENDPOINT_HIT_RADIUS`), an app decision; Adobe states the gesture but not the radius. Without a radius, every Alt-drag anywhere would be a protractor.',
      },
    ],
    shortcuts: [
      {
        keys: 'I',
        action:
          'Selects Eyedropper if no member of the Eyedropper/Color Sampler/Ruler group is selected; otherwise keeps the current group member.',
      },
      {
        keys: 'Shift+I',
        action:
          'Cycles the tools that share the letter: Eyedropper, Color Sampler, Ruler, Note and Count. The app cycles its three implemented members (Eyedropper, Color Sampler and Ruler); Note and Count are absent.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/components/Main/RulerToolArea.tsx:203',
      'src/components/Main/RulerToolArea.tsx:237',
      'src/components/Main/RulerToolArea.tsx:246',
      'src/components/Main/RulerToolArea.tsx:118',
      'src/components/ToolbarsRight/Ruler/Ruler.tsx:31',
      'src/tools/ruler.ts:120',
      'src/tools/ruler.ts:77',
      'src/tools/ruler-measurement-store.ts:44',
      'src/tools/toolProcessors.ts:103',
      'src/tools/toolsMap.ts:153',
      'toolbar-mapping.ts:79',
    ],
    appNotes:
      'The tool is a pixel-free tool (`PIXEL_FREE_TOOLS`), so it has no entry in `toolProcessors.ts` and dispatches nothing — no history, no durable operation. Adobe calls the line "nonprinting" and gives its removals as drag-out or Clear, neither of which is an undo. Four behaviors diverge from Photoshop: (1) Protractor has one of Adobe\'s two gestures: Alt-drag is implemented; double-click-and-drag is not (Adobe does not specify which end pivots). (2) Measurement scale is missing with its `Image > Analysis` menu. (3) No Info panel; options bar is the only readout surface (Adobe names both). (4) Endpoint tolerance for protractor is 8 document pixels (`RULER_ENDPOINT_HIT_RADIUS`), an app decision; Adobe states the gesture but no radius. The line survives a tool switch and lives in a module store (`ruler-measurement-store.ts`), not `StoreContext`. The rule is drawn at 1 CSS px at every contain fit (`RULE_WIDTH_CSS`), dark edge then light face for contrast over any background. `isInsideFrame` uses `<=` on the frame bounds so a line exactly on the edge is kept.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/positioning-ruler-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html',
      'https://helpx.adobe.com/photoshop/using/default-keyboard-shortcuts.html',
      'https://helpx.adobe.com/photoshop/using/viewing-images.html',
    ],
  },
};
