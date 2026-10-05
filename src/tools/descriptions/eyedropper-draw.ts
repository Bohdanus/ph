import type { ToolDescription } from './types.ts';

export const eyedropperDrawDescriptions: Record<'eyedropper' | 'draw' | 'ruler', ToolDescription> = {
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
        action:
          'Cycles the tools that share the letter: Eyedropper, Color Sampler, Ruler, Note and Count. The app cycles the two of the five it has, the Eyedropper and the Ruler.',
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
      'The app implements the tool without a processor: it is the sole member of the pixel-free set, so it rasterizes nothing, has no `commit` kind, and its `toolsMap` entry carries only an icon and an options bar. A click dispatches a color change and nothing else, so the app records no history entry for a sample and a sample is not undoable — the same class as a zoom, a panel move or a tool switch. `Sample Size` is the one control this bar matches rather than diverges on: all seven of Adobe’s entries are rendered with Adobe’s own labels in Adobe’s order, and the sample itself is Photoshop’s behaviour — an odd-sided square centred on the click, clipped at the canvas edge rather than shifted inward, reduced by an arithmetic mean. Three behaviors diverge. The drag is the first of them: the app’s only handler is `handlePointerDown` (`src/components/Main/EyedropperToolArea.tsx:59`), wired only to `onPointerDown` (`:137`) with no move or up handler anywhere in the file, so the sample is taken at the pointer-down position alone, no color box previews as the pointer travels, and a drag samples its first pixel rather than the one under the pointer at release. `Sample All Layers` is the second: nothing is rendered for it at all. The permanently unchecked, permanently disabled checkbox this bar used to carry is gone — a box that reads as a switch and cannot be used is worse than an absent one — and `src/components/ToolbarsRight/Eyedropper/__tests__/Eyedropper.test.tsx:77` pins that no such control exists. The field itself survives, seeded `false` at `src/tools/settings.ts:226`, and no control anywhere in the app writes it — the only `patchToolArgs` call in this bar writes `sampleSize` (`Eyedropper.tsx:15`) — so the settings state persists and drives nothing, and a click that found it set refuses loudly with a named reason rather than silently sampling the composited canvas and presenting it as the whole document’s (`EyedropperToolArea.tsx:65`). The composited read is the third: the sample always comes from the composited workspace canvas, and no setting narrows it to one layer, because that needs a composite that excludes adjustment-layer corrections. **The Alt modifier is not among the divergences** — it is implemented, and as Adobe states it: `EyedropperToolArea.tsx:133` dispatches `SET_BACKGROUND_COLOR` when `event.altKey` is held and `SET_COLOR` otherwise, so the sampled colour reaches the background swatch on Alt (Windows) or Option (macOS) exactly as in Photoshop, with no platform branch because the modifier is `altKey` on both. The app omits one of Photoshop’s `I` behaviors. There is no spring-loaded switch: `I` selects the tool outright and the keyboard hook has no key-up listener at all, so there is no temporary mode and no return on release. `Shift+I` now cycles the tile, which is the last of the divergences this record used to carry and the only one that was ever about the app rather than about Photoshop: `measurementGroup` in `AppKeyboardShortcuts.tsx` holds the two tools this app has in Adobe’s `I` family, with a `shift: true` twin beside the plain registration, and it replaced a pair of identical `i` registrations of which the second had been dead code on `useKeyboardEvents`’ last-registered-wins. Three of the five tools Photoshop cycles to are still absent — Color Sampler, Note and Count — and they are absent from the cycle rather than listed in it, because a name the app cannot select would make `Shift+I` land on the inert surface. The sampling-ring toggle is deliberately absent from the census above rather than overlooked. Adobe’s two current pages that describe this bar, the tool page and the set-colors page, name only `Sample Size` and `Sample`, so the ring is not a proven gap and is not filed as `missing`; the name is unconfirmed in 27.x, with third-party sources calling it `Show Sampling Ring` and Adobe’s own CS5 help mentioning only "a color sampler ring for the Eyedropper tool" without naming a control. The app has no ring either way, since the ring is a cursor and this repo has no cursor registry at all.',
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
      'toolbar-mapping.ts:116',
    ],
    appNotes:
      'No Photoshop provenance is claimed and none is invented: the Tools panel has no freehand-annotation or pen-stroke tool, and this app’s Draw tile sits in the tonal group where Photoshop has no tool at all. The nearest Photoshop tools are the Pen tool family, for path work, and the Brush, for freehand paint. The `shortcut` field on a toolbar entry is display-only and binds nothing: its only consumers are the tile tooltip and the <kbd> in the flyout, and the key bindings live in a separate hand-written table. This tool declares no shortcut. Adobe’s published default-keyboard-shortcut reference gives no letter for a Draw tool, so there is no Adobe binding this app is surrendering; the letters are occupied by this app’s own keymap instead — `W` and `Shift+W` both select the Object Selection tool, and `B` and `Shift+B` both select the Brush — so there is no free key to declare for this tool. It was previously badged `B`, which was wrong twice over — `B` belongs to the Brush in Photoshop, and in this app `B` is bound to the brush group (brush, pencil, color replacement, eraser) with `Shift+B` cycling it, so pressing `B` selected the Brush and could never select this tool. The badge is gone rather than reassigned because a declared shortcut the app does not implement is a falsehood the rail prints, and reassigning it is a product decision about which tool wins the chord. So this tool is reachable by pointer only. Photoshop’s spring-loaded switch is also absent: no key in the table selects this tool, so holding a letter cannot reach it either. The two fields the Photoshop paint bar exposes as Mode and Smoothing are declared on the draw args but unreachable from this bar — no draw control writes either, the default args set neither, and a draw stroke’s layer is forced to Normal by the blend-mode gate that admits only the paint tools. Two app-only controls, Dash and Gap, have no Photoshop counterpart in the paint bar. Three of the Brush bar’s controls diverge rather than go missing. Size is `partial` on its range alone: the slider starts at 0.5 px where Photoshop starts at 1 and stops at 500 px where Photoshop reaches 5000. Opacity is `partial` for the same kind of reason, and the build-up rule is the part that diverges: the value is measured and applied correctly, but a draw stroke is one `beginPath`/`stroke()` over the whole path at the tool’s alpha, so where a stroke crosses itself the color does not compound within that stroke, and Adobe’s rule is that the color does not exceed the set level however many times the pointer crosses the same pixels until the button is released. And the airbrush toggle is `missing` rather than approximate: the Draw bar renders Pen Type, Size, Dash, Gap, Opacity and a preview, and nothing that builds color up under a held button. The Spray pen type is the nearest thing and it diverges twice over — it is reached from the Pen Type dropdown rather than a toggle, and it stamps one soft gradient per sampled point along the drag, so it builds while the pointer is moving and a press that is then held still adds nothing after the single dot it already laid down. The bracket keys Photoshop binds to resize the tip reach no tool here, because this tool is the one the binding could serve and is not in its table: `[` and `]` are registered, but only for the tools `tipSizeField` names — brush, pencil, color replacement, eraser, smudge, dodge, burn and clone stamp — and this tool’s Size writes the same `lineWidth` field the brush uses while being absent from that list, so the two keys are inert for it rather than unbound. And Photoshop’s Shift-constrains-a-freehand-stroke-to-a-straight-line has no implementation here either — the draw area reads no modifier at all, so a Shift-held drag produces the identical freehand path.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/painting-tools.html',
      'https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/create-smoother-more-polished-brush-strokes-with-stroke-smoothing.html',
      'https://helpx.adobe.com/ee/photoshop/how-to/color-management-basics.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html',
      'https://helpx.adobe.com/photoshop/using/default-keyboard-shortcuts.html',
      'https://bruceblinn.com/1-Photography/UsingPhotoshopCS3.pdf',
      'https://www.thedigitalprocess.com/selecting-color-in-photoshop/',
      'https://clippingpathstudio.com/photoshop-toolbar/',
      'https://offshoreclipping.com/blog/photoshop-cc-toolbar-tools/',
    ],
  },
  ruler: {
    photoshopName: 'Ruler Tool',
    summary:
      'Measures a distance on the canvas: drag a nonprinting line and the options bar reports X, Y, W, H, the angle and the length, with Shift snapping to 45 degrees.',
    purpose:
      'The Ruler answers a question about the image that no other tool answers: how far apart two things are. You drag a line from one point to another and the measurement appears in the options bar and the Info panel — the starting location, the horizontal and vertical distances traveled, the angle relative to the axis, and the total length traveled. The line is a nonprinting overlay: it measures the document and is never part of it, so it creates no history state, cannot be undone, and disappears when you drag it out of the image or clear it. A line already on the canvas is edited in place rather than replaced: drag it by its body to move it, drag either end to resize it, and a press that never moves is a click, which changes nothing. Holding Shift constrains the line to 45-degree increments, which is how a straight edge or a repeated offset is laid out rather than eyeballed. Alt-drag (Windows) or Option-drag (Mac OS) from one end of an existing line pulls a second leg out of it, turning the measurement into a protractor: the bar then also reports the second leg as D2 and re-reads the angle as the angle between the two legs. It shares the I key with the Eyedropper, the Color Sampler, the Note tool and the Count tool, and Shift+I cycles between them.',
    options: [
      {
        control: 'X, Y',
        detail:
          'The starting location of the measurement, which is where the drag began rather than either end of it. The app reads the pointer-down point directly, so a drag that ends up and to the left of where it started reports the start it was given.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Ruler/Ruler.tsx:84',
      },
      {
        control: 'W, H',
        detail:
          'The horizontal and vertical distances traveled from the x and y axes. Both are magnitudes in the app, so a drag up and to the left reports the same W and H as the drag down and to the right; Adobe prints them as unsigned distances too.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Ruler/Ruler.tsx:86',
      },
      {
        control: 'A',
        detail:
          'The angle measured relative to the axis, in degrees. It is the one readout Adobe exempts from the document unit: "All measurements except the angle are calculated in the unit of measure currently set in the Units & Rulers preference dialog box." With a protractor present the bar re-reads it as the angle between the two legs, which is Adobe\'s own reuse of the same letter.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Ruler/Ruler.tsx:88',
      },
      {
        control: 'D1',
        detail:
          'The total length traveled. The app reports it in document pixels, which is the unit available while the app has no Units & Rulers preference; a measurement scale would rescale this number and not the geometry.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Ruler/Ruler.tsx:89',
      },
      {
        control: 'D2',
        detail:
          'The second leg of a protractor, and the only readout that appears and disappears with a gesture: it is present once an Alt/Option-drag has pulled a leg out of an existing line and absent before that, rather than reported as zero.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Ruler/Ruler.tsx:93',
      },
      {
        control: 'Clear',
        detail:
          'Removes the measuring line, which Adobe describes as one of two ways to remove it: "To remove the line, drag it outside the image area or press the Clear button". The app implements both, and the button is greyed while there is no line because there is nothing for it to remove.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Ruler/Ruler.tsx:112',
      },
      {
        control: 'Use Measurement Scale',
        detail:
          'A checkbox Adobe\'s Ruler page does not document and this app does not render. The measurement scale itself is an Image > Analysis menu command — "Select Image > Analysis > Set Measurement Scale > Custom", where the Pixel Length and Logical Length are typed — and the app has no Analysis submenu, so the scale does not exist to be switched on. Recorded rather than omitted so the gap is visible.',
        status: 'missing',
      },
    ],
    modifiers: [
      {
        keys: 'Shift',
        action:
          'Constrains the measuring line to 45-degree increments — "Hold down the Shift key to constrain the tool to 45° increments" — which rotates the drag onto the nearest multiple while keeping its length and its direction of travel.',
      },
      {
        keys: 'Alt',
        action:
          'Pulls a second leg out of an existing measuring line and turns the measurement into a protractor: "To create a protractor from an existing measuring line, Alt-drag (Windows) or Option-drag (Mac OS) at an angle from one end of the measuring line". The drag has to start within eight pixels of one end of the line, which is the app\'s tolerance and not Adobe\'s: Adobe states the gesture and not the radius, and without one every Alt-drag anywhere on the canvas would be a protractor. Either end may be the vertex, and which one it was does not move the origin — X and Y keep reporting the point the line was drawn from, because the alternative — swapping the two endpoints to make `end` the vertex — re-reads two of the seven numbers the moment the protractor is pulled from the near end.',
      },
    ],
    shortcuts: [
      {
        keys: 'I',
        action: 'Selects the Ruler, or the Eyedropper when that is already the selected tool of this tile.',
      },
      {
        keys: 'Shift+I',
        action:
          'Cycles the tools that share the letter: Eyedropper, Color Sampler, Ruler, Note and Count. The app cycles the two it has and leaves the other three out of the cycle rather than landing on tools that do not exist.',
      },
    ],
    implementation: 'partial',
    implementationRefs: [
      'src/components/Main/RulerToolArea.tsx:408',
      'src/components/Main/RulerToolArea.tsx:423',
      'src/components/Main/RulerToolArea.tsx:506',
      'src/components/Main/RulerToolArea.tsx:575',
      'src/components/Main/RulerToolArea.tsx:190',
      'src/components/Main/RulerToolArea.tsx:277',
      'src/components/ToolbarsRight/Ruler/Ruler.tsx:73',
      'src/tools/ruler.ts:190',
      'src/tools/ruler.ts:131',
      'src/tools/ruler.ts:268',
      'src/tools/ruler-measurement-store.ts:106',
      'src/tools/toolProcessors.ts:103',
      'src/tools/toolsMap.ts:153',
      'toolbar-mapping.ts:79',
    ],
    appNotes:
      "The tool is implemented as a pixel-free tool, and that classification is the reason its history behaviour is not a bug. Adobe calls the measuring line a nonprinting line and gives its removals as dragging it out of the image and pressing Clear, neither of which is an undo, so there is no history state to record and no durable operation to replay: the tool has no entry in `toolProcessors.ts` at all and is declared in `PIXEL_FREE_TOOLS` beside the Eyedropper, whose pixel-free status is established rather than assumed. Adobe never states the history rule outright for this tool, so the app-side answer is `HANDOFF.md` §74 naming the Ruler one of the measurement-band tools that commit no pixels and need no durable operation. Four behaviors diverge. The protractor has one gesture of Adobe's two: the Alt/Option-drag is implemented and the double-click half — \"or double-click the line and drag\" — is not, because Adobe does not say which end of the line the double-clicked leg pivots on and a second gesture that guessed would be worse than the first alone. The measurement scale is missing, as its own control above records, and it is missing with its `Image > Analysis` menu rather than as a checkbox without one. There is no Info panel, so the options bar is the only place the readouts exist; Adobe names both. And the endpoint tolerance for the protractor is eight document pixels, an app decision stated in `src/tools/ruler.ts` rather than presented as Adobe's, because a gesture with no radius at all would make every Alt-drag a protractor and leave no way to start a new measurement; the same radius bounds the drag that MOVES a line by its body, so the two gestures are one contiguous target and the nearer endpoint wins where they meet. What is implemented is all four of Adobe's own gestures — measure, resize, move and protractor — both modifiers, both removals, and all seven readouts. The press that starts a gesture is refused outside the document frame, because the tool area is the whole workspace and a line begun on the pasteboard would report a negative X or Y for a point the user cannot see; a press INSIDE the frame that never moves is a click and changes nothing, so a click neither destroys a line nor leaves a zero-length one that would capture the next drag. The line survives a tool switch, which is Adobe's own sentence rather than an app convenience — \"If your document has an existing measuring line, selecting the Ruler tool causes it to be displayed\" — so it lives in a module store rather than in the tool area, and it is dropped when the DOCUMENT changes or when the frame does — its size and its origin, because the two fail differently: size alone could not tell two documents apart and the app's own Blank seed is a fixed size, so a line measured on one image would otherwise survive being replaced by another of the same size and be reported over it, while a size alone cannot see the same-size crop that moves the frame's origin, and a measurement is in frame coordinates, so every pixel it names would then be reporting against coordinates the crop had removed. The angle convention is the screen one: 0 degrees along positive x and increasing clockwise, because y grows downward on the overlay and that is how a protractor on the screen reads.",
    sources: [
      'https://helpx.adobe.com/photoshop/using/positioning-ruler-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html',
      'https://helpx.adobe.com/photoshop/using/default-keyboard-shortcuts.html',
      'https://helpx.adobe.com/photoshop/using/viewing-images.html',
    ],
  },
};
