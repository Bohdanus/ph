import type { ToolDescription } from './types.ts';

export const eyedropperDrawDescriptions: Record<'eyedropper' | 'draw', ToolDescription> = {
  eyedropper: {
    photoshopName: 'Eyedropper Tool',
    summary:
      'Samples a color from anywhere in the image and makes it the foreground color, previewing as you drag and confirming on release.',
    purpose:
      'The Eyedropper reads pixels and hands the result to the color controls, so a color that is already in the image can be matched exactly instead of guessed. A plain click sets the foreground color; Alt-click (Windows) or Option-click (macOS) sets the background color, and the sampled color is also added to the Swatches panel. Sample Size sets the footprint: Point Sample reads the precise value of the one pixel clicked, and the average settings read the mean of a square of pixels around it. A click is not the whole gesture: you can drag the Eyedropper along an area of the image and release once you get the desired color, and the foreground or background color box changes dynamically as you drag along. Separately, and not as part of that gesture shape, holding Alt or Option from any painting tool reaches the Eyedropper temporarily and samples the foreground color at the Eyedropper’s current Sample Size.',
    options: [
      {
        control: 'Sample Size',
        detail:
          'Sets the sampling footprint, and Adobe enumerates the whole menu: Point Sample "Reads the exact value of the clicked pixel", and 3 by 3 / 5 by 5 / 11 by 11 / 31 by 31 / 51 by 51 / 101 by 101 Average "Reads the average color value within the selected pixel area". There are no Median entries in it. Adobe lists the menu without saying which entry ships selected, and states no default for it; the app seeds Point Sample.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Eyedropper/Eyedropper.tsx:22',
      },
      {
        control: 'Sample',
        detail:
          'Chooses which layers a sample is read from: All Layers, Current Layer, Current & Below, and the No Adjustments variants. Adobe enumerates that menu and states no default for it. Earlier versions expressed this as a `Sample All Layers` checkbox. The app renders no control for it at all, and its `sampleAllLayers` field persists in settings and is refused loudly on click.',
        status: 'inert',
        appRef: 'src/tools/settings.ts:226',
      },
    ],
    modifiers: [
      {
        keys: 'Alt',
        action:
          'Sets the sampled color as the background color instead of the foreground color — "Select a new background color by holding Alt (Windows) or Option (macOS) and clicking the desired area in the image." The drag form works the same way: held through a drag, the background color box changes dynamically as you drag along and the sample is confirmed on release.',
      },
    ],
    shortcuts: [
      { keys: 'I', action: 'Selects the Eyedropper, or temporarily switches to it while held.' },
      {
        keys: 'Shift+I',
        action: 'Cycles the tools that share the letter: Eyedropper, Color Sampler, Ruler, Note and Count.',
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
      'The app implements the tool without a processor: it is the sole member of the pixel-free set, so it rasterizes nothing, has no `commit` kind, and its `toolsMap` entry carries only an icon and an options bar. A click dispatches a color change and nothing else, so the app records no history entry for a sample and a sample is not undoable — the same class as a zoom, a panel move or a tool switch. `Sample Size` is the one control this bar matches rather than diverges on: all seven of Adobe’s entries are rendered with Adobe’s own labels in Adobe’s order, and the sample itself is Photoshop’s behaviour — an odd-sided square centred on the click, clipped at the canvas edge rather than shifted inward, reduced by an arithmetic mean. Three behaviors diverge. The drag is the first of them: the app’s only handler is `handlePointerDown` (`src/components/Main/EyedropperToolArea.tsx:59`), wired only to `onPointerDown` (`:137`) with no move or up handler anywhere in the file, so the sample is taken at the pointer-down position alone, no color box previews as the pointer travels, and a drag samples its first pixel rather than the one under the pointer at release. `Sample All Layers` is the second: nothing is rendered for it at all. The permanently unchecked, permanently disabled checkbox this bar used to carry is gone — a box that reads as a switch and cannot be used is worse than an absent one — and `src/components/ToolbarsRight/Eyedropper/__tests__/Eyedropper.test.tsx:77` pins that no such control exists. The field itself survives, seeded `false` at `src/tools/settings.ts:226`, and no control anywhere in the app writes it — the only `patchToolArgs` call in this bar writes `sampleSize` (`Eyedropper.tsx:15`) — so the settings state persists and drives nothing, and a click that found it set refuses loudly with a named reason rather than silently sampling the composited canvas and presenting it as the whole document’s (`EyedropperToolArea.tsx:65`). The composited read is the third: the sample always comes from the composited workspace canvas, and no setting narrows it to one layer, because that needs a composite that excludes adjustment-layer corrections. **The Alt modifier is not among the divergences** — it is implemented, and as Adobe states it: `EyedropperToolArea.tsx:133` dispatches `SET_BACKGROUND_COLOR` when `event.altKey` is held and `SET_COLOR` otherwise, so the sampled colour reaches the background swatch on Alt (Windows) or Option (macOS) exactly as in Photoshop, with no platform branch because the modifier is `altKey` on both. The app omits two of Photoshop’s `I` behaviors. There is no spring-loaded switch: `I` selects the tool outright and the keyboard hook has no key-up listener at all, so there is no temporary mode and no return on release. And there is no `Shift+I` cycle either — `I` is registered twice for the same single-tool tile (`src/components/Common/AppKeyboardShortcuts.tsx:330` and `:476`), neither registration declares a `shift: true` twin, and the hook matches a declared `shift` exactly (`src/hooks/useKeyboardEvents.tsx:72`), so a shifted `I` falls through to the plain registration and re-selects the Eyedropper instead of cycling; the comment at `AppKeyboardShortcuts.tsx:472` says that omission is deliberate, on the grounds that a single-tool tile has nothing to cycle. None of the four tools Photoshop cycles to with it — Color Sampler, Ruler, Note and Count — exists in the app’s tool registry at all, so there are no members to cycle through even if the twin were added. The sampling-ring toggle is deliberately absent from the census above rather than overlooked. Adobe’s two current pages that describe this bar, the tool page and the set-colors page, name only `Sample Size` and `Sample`, so the ring is not a proven gap and is not filed as `missing`; the name is unconfirmed in 27.x, with third-party sources calling it `Show Sampling Ring` and Adobe’s own CS5 help mentioning only "a color sampler ring for the Eyedropper tool" without naming a control. The app has no ring either way, since the ring is a cursor and this repo has no cursor registry at all (`HANDOFF.md` §51 (`HANDOFF.md:1080`)).',
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/eyedropper-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/adjust-color/choose-colors/set-foreground-and-background-colors.html',
      'https://helpx.adobe.com/photoshop/using/painting-tools.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html',
      'https://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html',
      'https://video.pie-menu.com/adobe-photoshop-cheat-sheet.pdf',
      'https://www.manualsdir.com/manuals/753896/adobe-photoshop-cs4.html?page=126',
      'https://adobe.manymanuals.com/software/photoshop-cs4/user-manual-35148/127',
      'https://ptgmedia.pearsoncmg.com/images/9780789744470/samplepages/0789744473.pdf',
      'https://photogravity.eu/wp-content/uploads/2018/02/Photoshop-CS5-Help.pdf',
      'https://bruceblinn.com/1-Photography/UsingPhotoshopCS3.pdf',
      'https://www.photoshopforphotographers.com/CC_2013/Help_guide/tp/Eyedropper_tool.html',
      'https://enviragallery.com/guide-to-the-eyedropper-tool-in-photoshop/',
      'https://jkost.com/blog/2018/03/the-eyedropper-color-samplers-and-info-panel-in-photoshop-cc.html',
      'https://editpsdfile.com/blog/photoshop-keyboard-shortcuts',
      'https://www.oreilly.com/library/view/photoshop-r-cs4-bible/9780470345177/9780470345177_tools.html',
      'https://clippingpathstudio.com/photoshop-toolbar/',
      'https://offshoreclipping.com/blog/photoshop-cc-toolbar-tools/',
    ],
  },

  draw: {
    photoshopName: 'No Photoshop tool — this app’s own tool (nearest Photoshop: Brush tool)',
    summary:
      'This app’s own freehand stroke tool, not a Photoshop tool: a drag becomes a new layer of ink, drawn with a pen, a dashed pen or a spray.',
    purpose:
      'There is no Photoshop tool called Draw, in this app or in Adobe’s Tools panel, so there is no Adobe behavior to describe and none is invented here. What the tool does is this app’s own: a drag pushes one raw pointer coordinate per move onto the stroke, the stroke is drawn as a bezier curve through those coordinates in the foreground color, and the finished stroke is committed as a new layer, so every mark is a separate object that is separately undone and separately deleted. A Pen Type dropdown picks one of three renderers — a solid round-capped stroke, a dashed stroke, and a spray of soft radial gradients — and Size, Opacity and, for the dashed pen only, Dash and Gap shape it. A live preview at the end of the bar draws the current settings, so a stroke can be judged before it is committed. A user coming from Photoshop should reach for the Brush tool for the solid stroke, and should know that this app renders no airbrush control on any tool, so the Spray pen is the nearest thing here to the Brush’s airbrush; there is no Photoshop equivalent to a dashed freehand ink stroke.',
    options: [
      {
        control: 'Brush Preset picker',
        detail:
          'Opens the brush tip chooser, and lets the current preset’s Size and Hardness be changed without reopening the Brush panel. The app has no brush tips, so there is no picker and no hardness.',
        status: 'missing',
      },
      {
        control: 'Size',
        detail:
          'The diameter of the brush tip, in pixels. Photoshop’s Size runs from 1 to 5000 px; the app’s slider runs from 0.5 to 500 in steps of 0.5.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Draw/Draw.tsx:149',
      },
      {
        control: 'Mode',
        detail: 'The blend mode the stroke’s paint composites with. Default: Normal.',
        status: 'inert',
        appRef: 'src/tools/draw.ts:43',
      },
      {
        control: 'Opacity',
        detail:
          'The transparency of the color applied. As a stroke passes over an area the color does not exceed this level until the button is released; a further stroke adds more. Adobe’s own words are "Opacity of 100 percent is opaque", which is a value rather than a default, and Adobe states no default for the control. The app seeds a lower default per pen — 90% for the solid and dashed pens, 50% for the spray.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Draw/Draw.tsx:211',
      },
      {
        control: 'Flow',
        detail:
          'The rate at which color is laid down as the pointer moves, so together with Opacity it sets how fast paint builds up under a held button. Adobe states no default for it.',
        status: 'missing',
      },
      {
        control: 'Airbrush',
        detail:
          'A toggle that keeps the brush laying down color while the pointer is held still, so a stationary stroke builds up to Opacity instead of stopping at one pass. This app renders no airbrush control at any point in the Draw bar.',
        status: 'missing',
      },
      {
        control: 'Smoothing',
        detail:
          'How much intelligent smoothing is applied to the stroke, 0 to 100: "Set a value between 0 and 100 to control how much smoothing is applied. Lower values apply minimal correction. Higher values result in stronger smoothing but may slightly delay the stroke preview." Adobe names the Brush, Pencil, Mixer Brush and Eraser as the tools it applies to. The app declares the field on the draw args and no Draw-bar control writes it, so the value is always absent.',
        status: 'inert',
        appRef: 'src/tools/draw.ts:38',
      },
    ],
    modifiers: [],
    shortcuts: [
      { keys: '[', action: 'Decreases brush Size.' },
      { keys: ']', action: 'Increases brush Size.' },
    ],
    implementation: 'implemented',
    implementationRefs: [
      'src/components/ToolbarsRight/Draw/Draw.tsx:14',
      'src/components/Main/DrawToolArea.tsx:143',
      'src/util/draw.ts:85',
      'src/tools/draw.ts:6',
      'src/tools/toolProcessors.ts:153',
      'src/tools/settings.ts:39',
      'toolbar-mapping.ts:102',
    ],
    appNotes:
      'No Photoshop provenance is claimed and none is invented: the Tools panel has no freehand-annotation or pen-stroke tool, and this app’s Draw tile sits in the tonal group where Photoshop has no tool at all. The nearest Photoshop tools are the Pen tool family, for path work, and the Brush, for freehand paint. The `shortcut` field on a toolbar entry is display-only and binds nothing: its only consumers are the tile tooltip and the <kbd> in the flyout, and the key bindings live in a separate hand-written table. That table is where the `B` goes. `B` is bound to the brush group — brush, pencil, color replacement, eraser — and `Shift+B` cycles it, so pressing `B` selects the Brush and can never select this tool. The `B` badged on the Draw Tool is therefore wrong twice over: the letter belongs to the Brush in Photoshop, and in this app the letter is taken by the Brush as well, leaving this tool reachable by pointer only. Photoshop’s spring-loaded switch is also absent: no key in the table selects this tool, so holding a letter cannot reach it either. The two fields the Photoshop paint bar exposes as Mode and Smoothing are declared on the draw args but unreachable from this bar — no draw control writes either, the default args set neither, and a draw stroke’s layer is forced to Normal by the blend-mode gate that admits only the paint tools. Two app-only controls, Dash and Gap, have no Photoshop counterpart in the paint bar. Three of the Brush bar’s controls diverge rather than go missing. Size is `partial` on its range alone: the slider starts at 0.5 px where Photoshop starts at 1 and stops at 500 px where Photoshop reaches 5000. Opacity is `partial` for the same kind of reason, and the build-up rule is the part that diverges: the value is measured and applied correctly, but a draw stroke is one `beginPath`/`stroke()` over the whole path at the tool’s alpha, so where a stroke crosses itself the color does not compound within that stroke, and Adobe’s rule is that the color does not exceed the set level however many times the pointer crosses the same pixels until the button is released. And the airbrush toggle is `missing` rather than approximate: the Draw bar renders Pen Type, Size, Dash, Gap, Opacity and a preview, and nothing that builds color up under a held button. The Spray pen type is the nearest thing and it diverges twice over — it is reached from the Pen Type dropdown rather than a toggle, and it stamps one soft gradient per sampled point along the drag, so it builds while the pointer is moving and a press that is then held still adds nothing after the single dot it already laid down. The bracket keys Photoshop binds to resize the tip reach no tool here, because this tool is the one the binding could serve and is not in its table: `[` and `]` are registered, but only for the tools `tipSizeField` names — brush, pencil, color replacement, eraser, smudge, dodge, burn and clone stamp — and this tool’s Size writes the same `lineWidth` field the brush uses while being absent from that list, so the two keys are inert for it rather than unbound. And Photoshop’s Shift-constrains-a-freehand-stroke-to-a-straight-line has no implementation here either — the draw area reads no modifier at all, so a Shift-held drag produces the identical freehand path.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/painting-tools.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/create-smoother-more-polished-brush-strokes-with-stroke-smoothing.html',
      'https://helpx.adobe.com/ee/photoshop/how-to/color-management-basics.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html',
      'https://bruceblinn.com/1-Photography/UsingPhotoshopCS3.pdf',
      'https://www.thedigitalprocess.com/selecting-color-in-photoshop/',
      'https://clippingpathstudio.com/photoshop-toolbar/',
      'https://offshoreclipping.com/blog/photoshop-cc-toolbar-tools/',
    ],
  },
};
