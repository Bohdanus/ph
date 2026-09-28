import type { ToolDescription } from './types.ts';

export const eyedropperDrawDescriptions: Record<'eyedropper' | 'draw', ToolDescription> = {
  eyedropper: {
    photoshopName: 'Eyedropper Tool',
    summary:
      'Samples a color from anywhere in the image and makes it the foreground color, on a click rather than a drag.',
    purpose:
      'The Eyedropper reads pixels and hands the result to the color controls, so a color that is already in the image can be matched exactly instead of guessed. A plain click sets the foreground color; Alt-click (Windows) or Option-click (macOS) sets the background color, and the sampled color is also added to the Swatches panel. Sample Size sets the footprint: Point Sample reads the precise value of the one pixel clicked, and the average settings read the mean of a square of pixels around it. A click is the whole gesture — there is nothing to drag — and Alt or Option held from any painting tool reaches the tool temporarily. A sample changes no pixel, so it is not an edit and belongs with a zoom or a panel move rather than with anything that records a history state.',
    options: [
      {
        control: 'Sample Size',
        detail:
          'Sets the sampling footprint, and Adobe enumerates the whole menu: Point Sample "Reads the exact value of the clicked pixel", and 3 by 3 / 5 by 5 / 11 by 11 / 31 by 31 / 51 by 51 / 101 by 101 Average "Reads the average color value within the selected pixel area". There are no Median entries in it. Default: Point Sample.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Eyedropper/Eyedropper.tsx:23',
      },
      {
        control: 'Sample',
        detail:
          'Chooses which layers a sample is read from: All Layers, Current Layer, Current & Below, and the No Adjustments variants. Adobe enumerates that menu and states no default for it. Earlier versions expressed this as a `Sample All Layers` checkbox.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Eyedropper/Eyedropper.tsx:37',
      },
    ],
    modifiers: [
      {
        keys: 'Alt',
        action:
          'Sets the sampled color as the background color instead of the foreground color — "Select a new background color by holding Alt (Windows) or Option (macOS) and clicking the desired area in the image." These are click modifiers, not drag modifiers: the Eyedropper has no drag.',
      },
    ],
    shortcuts: [
      { keys: 'I', action: 'Selects the Eyedropper, or temporarily switches to it while held.' },
      {
        keys: 'Shift+I',
        action: 'Cycles the tools that share the letter: Eyedropper, Color Sampler, Ruler, Note and Count.',
      },
    ],
    implementation: 'implemented',
    implementationRefs: [
      'src/components/Main/EyedropperToolArea.tsx:46',
      'src/components/Main/EyedropperToolArea.tsx:57',
      'src/components/Main/EyedropperToolArea.tsx:121',
      'src/components/ToolbarsRight/Eyedropper/Eyedropper.tsx:21',
      'src/tools/eyedropper.ts:28',
      'src/tools/toolProcessors.ts:80',
      'src/tools/toolsMap.ts:126',
      'toolbar-mapping.ts:57',
    ],
    appNotes:
      'The app implements the tool without a processor: it is the sole member of the pixel-free set, so it rasterizes nothing, has no `commit` kind, and its `toolsMap` entry carries only an icon and an options bar. A click dispatches a color change and nothing else, so the app records no history entry for a sample and a sample is not undoable — the same class as a zoom, a panel move or a tool switch. Three behaviors diverge. Sample Size offers only Point Sample, 3 by 3 Average and 5 by 5 Average, where Photoshop lists a longer set. `Sample All Layers` renders as a permanently unchecked, permanently disabled checkbox, so the sample source cannot be changed at all; the value is declared in settings, and a click that found it set refuses loudly rather than silently sampling the active layer. And the sample is always read from the composited canvas, with no modifier that can redirect it to the background swatch or to a single layer. The app also omits Photoshop’s spring-loaded switch: `I` here selects the tool outright and there is no temporary mode.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/tool-techniques/eyedropper-tool.html',
      'https://helpx.adobe.com/photoshop/desktop/adjust-color/choose-colors/set-foreground-and-background-colors.html',
      'https://helpx.adobe.com/photoshop/using/painting-tools.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html',
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
      'There is no Photoshop tool called Draw, in this app or in Adobe’s Tools panel, so there is no Adobe behavior to describe and none is invented here. What the tool does is this app’s own: a drag is resampled as a path, bezier-smoothed, and stroked in the foreground color, and the finished stroke is committed as a new layer, so every mark is a separate object that is separately undone and separately deleted. A Pen Type dropdown picks one of three renderers — a solid round-capped stroke, a dashed stroke, and a spray of soft radial gradients — and Size, Opacity and, for the dashed pen only, Dash and Gap shape it. A live preview at the end of the bar draws the current settings, so a stroke can be judged before it is committed. A user coming from Photoshop should reach for the Brush tool for the solid stroke and for the Brush’s airbrush option for the spray; there is no Photoshop equivalent to a dashed freehand ink stroke.',
    options: [
      {
        control: 'Brush Preset picker',
        detail:
          'Opens the brush tip chooser, and lets the current preset’s Size and Hardness be changed without reopening the Brush panel. The app has no brush tips, so there is no picker and no hardness.',
        status: 'missing',
      },
      {
        control: 'Size',
        detail: 'The diameter of the brush tip, in pixels.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Draw/Draw.tsx:142',
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
          'The transparency of the color applied. As a stroke passes over an area the color does not exceed this level until the button is released; a further stroke adds more. Default: 100%.',
        status: 'present',
        appRef: 'src/components/ToolbarsRight/Draw/Draw.tsx:204',
      },
      {
        control: 'Flow',
        detail:
          'The rate at which color is laid down as the pointer moves, so together with Opacity it sets how fast paint builds up under a held button. Default: 100%.',
        status: 'missing',
      },
      {
        control: 'Enable airbrush-style build-up effects',
        detail:
          'Turns the stroke into an airbrush: paint builds up as the button is held, and hardness, opacity and flow set how fast and how much is applied. Click the button to toggle it.',
        status: 'partial',
        appRef: 'src/components/ToolbarsRight/Draw/Draw.tsx:129',
      },
    ],
    modifiers: [
      { keys: 'Shift', action: 'Constrains the stroke to a straight line between the press and the release.' },
    ],
    shortcuts: [
      { keys: '[', action: 'Decreases brush Size.' },
      { keys: ']', action: 'Increases brush Size.' },
    ],
    implementation: 'implemented',
    implementationRefs: [
      'src/components/ToolbarsRight/Draw/Draw.tsx:13',
      'src/components/Main/DrawToolArea.tsx:110',
      'src/util/draw.ts:85',
      'src/tools/draw.ts:6',
      'src/tools/toolProcessors.ts:151',
      'src/tools/settings.ts:32',
      'toolbar-mapping.ts:96',
    ],
    appNotes:
      'No Photoshop provenance is claimed and none is invented: the Tools panel has no freehand-annotation or pen-stroke tool, and this app’s Draw tile sits in the tonal group where Photoshop has no tool at all. The nearest Photoshop tools are the Pen tool family, for path work, and the Brush, for freehand paint. The `shortcut` field on a toolbar entry is display-only and binds nothing: its only consumers are the tile tooltip and the <kbd> in the flyout, and the key bindings live in a separate hand-written table. That table is where the `B` goes. `B` is bound to the brush group — brush, pencil, color replacement, eraser — and `Shift+B` cycles it, so pressing `B` selects the Brush and can never select this tool. The `B` badged on the Draw Tool is therefore wrong twice over: the letter belongs to the Brush in Photoshop, and in this app the letter is taken by the Brush as well, leaving this tool reachable by pointer only. Photoshop’s spring-loaded switch is also absent: no key in the table selects this tool, so holding a letter cannot reach it either. The two fields the Photoshop paint bar exposes as Mode and Smoothing are declared on the draw args but unreachable from this bar — no draw control writes either, the default args set neither, and a draw stroke’s layer is forced to Normal by the blend-mode gate that admits only the paint tools. Two app-only controls, Dash and Gap, have no Photoshop counterpart in the paint bar.',
    sources: [
      'https://helpx.adobe.com/photoshop/using/painting-tools.html',
      'https://helpx.adobe.com/ee/photoshop/how-to/color-management-basics.html',
      'https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/spring-loaded-shortcuts.html',
      'https://bruceblinn.com/1-Photography/UsingPhotoshopCS3.pdf',
      'https://www.thedigitalprocess.com/selecting-color-in-photoshop/',
      'https://clippingpathstudio.com/photoshop-toolbar/',
      'https://offshoreclipping.com/blog/photoshop-cc-toolbar-tools/',
    ],
  },
};
