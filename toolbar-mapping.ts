import type { ToolName } from './src/contexts/tool-types.ts';
import type { FigureType } from './src/tools/shape.ts';

export type ToolbarTool = {
  label: string;
  name: ToolName;
  shortcut?: string;
  figure?: FigureType;
};

export type ToolbarToolGroup = readonly ToolbarTool[];

/**
 * The label half of a flyout item's `data-testid`.
 *
 * `SidebarLeft` mints `tool-flyout-item-${tool.name}-${slugifyToolLabel(tool.label)}`,
 * and the e2e helper has to build the same string, so this is the one definition of
 * the rule rather than a component-local helper plus a transcription of it.
 *
 * The transformation is deliberately narrower than a general slugifier: every run of
 * non-alphanumeric characters — including a leading or trailing one — becomes exactly
 * one `-`, and nothing is trimmed. `'  My Label  '` is `'-my-label-'` and `'Color & Tone'`
 * is `'color-tone'`, because those are the ids the application produces. Do not "tidy"
 * the edges or spell the ampersand out: a slug that differs from this one is a selector
 * that silently misses, and the unit test in `e2e/helpers/__tests__/toolbar-helpers.unit.test.ts`
 * compares the helper's independent copy against this function for every real label.
 */
export const slugifyToolLabel = (label: string): string => label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');

/**
 * Photoshop-inspired toolbar map in the canonical one-column order.
 *
 * Each nested array is one flyout menu. Unsupported Photoshop tools are
 * intentionally omitted rather than represented by placeholder values.
 * The two-column layout is derived from this order by SidebarLeft.
 */
export const toolbarMap = [
  [
    [{ label: 'Move Tool', name: 'reposition', shortcut: 'V' }],
    [
      { label: 'Rectangular Marquee Tool', name: 'rectangular-selection', shortcut: 'M' },
      { label: 'Elliptical Marquee Tool', name: 'elliptical-selection' },
      // The two 1-pixel marquees share this flyout and therefore carry no shortcut of
      // their own: Adobe's published default table assigns `M` to the Rectangular and
      // Elliptical Marquees only, and neither 1-pixel tool has a key. `Shift+M` still
      // reaches them, because the cycle is over the whole group (see `marqueeGroup` in
      // `AppKeyboardShortcuts.tsx`), which is a weaker and separately-labelled claim.
      { label: 'Single Row Marquee Tool', name: 'single-row-marquee' },
      { label: 'Single Column Marquee Tool', name: 'single-column-marquee' },
    ],
    [
      // All three lasso tools share `L` in Photoshop, and `Shift+L` is the cycling key rather
      // than a second binding on one member. So the letter belongs to the tile and only the
      // tile declares it, exactly as the marquee group above does. The cycling key itself is
      // recorded as the Photoshop shortcut in `src/tools/descriptions/selection.ts`, which is
      // where a key that belongs to the group rather than to a tool belongs.
      { label: 'Lasso Tool', name: 'freehand-lasso', shortcut: 'L' },
      { label: 'Polygonal Lasso Tool', name: 'polygonal-lasso' },
      { label: 'Magnetic Lasso Tool', name: 'feather-magnetic-lasso' },
    ],
    // The Quick Selection shares the Magic Wand's tile because Photoshop puts the two
    // adjacent, and the Wand is the tile's identity as the first entry.
    [
      { label: 'Magic Wand Tool', name: 'magic-wand', shortcut: 'W' },
      { label: 'Quick Selection Tool', name: 'quick-selection' },
    ],
    // The `I` family, which Photoshop cycles with `Shift+I`: "Eyedropper, Color Sampler, Ruler, Note,
    // and Count Tool I". Only the tile's FIRST entry declares `shortcut`, exactly as the tonal and
    // marquee groups above do, so the letter belongs to the tile and the Ruler is reached by the
    // cycle rather than by a second binding on the same key.
    //
    // The three members Photoshop cycles to that this app does not have are absent rather than
    // represented by placeholder values, per the rule the doc comment above states. Adobe prints no
    // order for the cycle, and the three that exist keep the Eyedropper first because it is the
    // tile's identity: a tile's name is its first entry, so leading with anything else would rename
    // the tile and move every `tool-button-eyedropper` selector with it. The Color Sampler sits
    // between the two because it is the one that reads a PIXEL, which is what makes it read as
    // belonging beside the Eyedropper rather than beside the Ruler.
    [
      { label: 'Eyedropper Tool', name: 'eyedropper', shortcut: 'I' },
      { label: 'Color Sampler Tool', name: 'color-sampler' },
      { label: 'Ruler Tool', name: 'ruler' },
    ],
  ],
  [[{ label: 'Crop Tool', name: 'crop', shortcut: 'C' }]],
  [
    // The Brush stays the tile's default tool, so the eraser-family tools are appended
    // rather than inserted: `renderToolGroup` derives the tile's default identity from the
    // first entry (`SidebarLeft.tsx:578`). Six entries is the same length as the Pen family
    // flyout below, so this is not an outlier.
    [
      { label: 'Brush Tool', name: 'brush', shortcut: 'B' },
      { label: 'Pencil Tool', name: 'pencil' },
      { label: 'Color Replacement Tool', name: 'color-replacement' },
      { label: 'Eraser Tool', name: 'eraser', shortcut: 'E' },
      // Photoshop binds the Magic Eraser to nothing, so it is declared without a shortcut rather
      // than given one that would collide with the Paint Bucket's `G`.
      { label: 'Magic Eraser Tool', name: 'magic-eraser' },
      { label: 'Paint Bucket Tool', name: 'paint-bucket', shortcut: 'G' },
    ],
    // Photoshop's Stamp flyout is its own tile immediately after the Brush group; the
    // pattern and patch stamps behind it are not implemented and stay out of the map.
    [{ label: 'Clone Stamp Tool', name: 'clone-stamp', shortcut: 'S' }],
    [
      { label: 'Blur Tool', name: 'blur' },
      { label: 'Sharpen Tool', name: 'sharpen' },
      { label: 'Smudge Tool', name: 'smudge' },
    ],
    // The Gradient gets its own tile rather than joining the erase-and-bucket flyout above,
    // so the existing six-entry group keeps the identity and order the e2e helpers drive it by.
    [{ label: 'Gradient Tool', name: 'gradient' }],
    [
      { label: 'Dodge Tool', name: 'dodge', shortcut: 'O' },
      { label: 'Burn Tool', name: 'burn' },
      // The third member of the same flyout, and in the order Adobe's own shortcut
      // references give it: Dodge, Burn, Sponge, each `O`, cycled with `Shift+O`. The
      // `shortcut` is left off the other two entries for the same reason it is left off
      // `burn` — only the tile's first entry carries the letter.
      { label: 'Sponge Tool', name: 'sponge' },
    ],
    // NO SHORTCUT, and the omission is the fix rather than an oversight. This entry
    // previously declared `shortcut: 'B'`, which is the Brush's own shortcut and which
    // `AppKeyboardShortcuts.tsx` binds to `selectBrushTool` on both `b` and `shift+b`. The
    // Draw tool is bound to no key at all, so the rail rendered a `B` badge on the Draw flyout
    // item (`SidebarLeft.tsx` draws `tool.shortcut` as a `<kbd>`, and passes it to
    // `ToolTooltip`) and pressing `B` selected the Brush. `SidebarLeft` is the only place a
    // declared shortcut reaches the user, so a declared shortcut the app does not implement is
    // a falsehood, exactly like a tooltip that promises an Esc key the tool has no handler for.
    //
    // There is no key to bind, because Adobe publishes none: Photoshop has no Draw tool, so the
    // previous version of this comment — which claimed Adobe binds it to `Shift+W` — was quoting
    // a binding that does not exist. `w` and `shift+w` both go to the Object Selection tool.
    // `toolbar-mapping.test.ts` pins that no two entries may claim the same shortcut, so the
    // fix cannot regress into a second collision, and `docs/OVERRIDES.md` OVR-2 is what keeps the
    // tile.
    [{ label: 'Draw Tool', name: 'draw' }],
  ],
  [
    [
      { label: 'Pen Tool', name: 'pen', shortcut: 'P' },
      { label: 'Freeform Pen Tool', name: 'freeform-pen' },
      { label: 'Curvature Pen Tool', name: 'curvature-pen' },
      { label: 'Add Anchor Point Tool', name: 'add-anchor-point' },
      { label: 'Delete Anchor Point Tool', name: 'delete-anchor-point' },
      { label: 'Convert Point Tool', name: 'convert-point' },
    ],
    [{ label: 'Horizontal Type Tool', name: 'text', shortcut: 'T' }],
    [
      { label: 'Rectangle Tool', name: 'shape', shortcut: 'U', figure: 'rectangle' },
      { label: 'Ellipse Tool', name: 'shape', figure: 'oval' },
      { label: 'Line Tool', name: 'shape', figure: 'line' },
      { label: 'Triangle Tool', name: 'shape', figure: 'triangle' },
      { label: 'Polygon Tool', name: 'shape', figure: 'polygon' },
      { label: 'Star Tool', name: 'shape', figure: 'star' },
      { label: 'Custom Shape Tool', name: 'custom-shape' },
    ],
  ],
] as const satisfies readonly (readonly ToolbarToolGroup[])[];

export const availableTools: readonly ToolName[] = [
  'brush',
  'pencil',
  'color-replacement',
  'pen',
  'freeform-pen',
  'curvature-pen',
  'add-anchor-point',
  'delete-anchor-point',
  'convert-point',
  'rectangle',
  'ellipse',
  'triangle',
  'polygon',
  'line',
  'custom-shape',
  'reposition',
  'draw',
  'shape',
  'text',
  'crop',
  'color',
  'blur',
  'levels',
  'transform',
  'rectangular-selection',
  'elliptical-selection',
  'single-row-marquee',
  'single-column-marquee',
  'freehand-lasso',
  'polygonal-lasso',
  'feather-magnetic-lasso',
  'magic-wand',
  'quick-selection',
  'eyedropper',
  'color-sampler',
  'ruler',
  'eraser',
  'magic-eraser',
  'clone-stamp',
  'paint-bucket',
  'gradient',
  'sharpen',
  'smudge',
  'dodge',
  'burn',
  'sponge',
];

/**
 * Tool ids with no Tools-rail entry, because Photoshop's Tools panel has none.
 *
 * `color`, `levels` and `transform` are `Image ▸ Adjustments` and `Edit ▸ Free Transform`
 * COMMANDS, and a command is not a tool. They were the sole members of a three-wide flyout
 * here until they were extracted; what hosts them now is
 * `src/components/DesktopHeader/DesktopHeader.tsx` — `Image ▸ Adjustments` carries the
 * first two and `Edit ▸ Free Transform` the third.
 *
 * Before that extraction this export was a declaration with no consumer at all, and it still
 * has none: `toolbar-mapping.test.ts` is its only importer. What that test pins is the
 * two-way relation with `toolbarMap` — nothing in `extraTools` may be a tile, and a rail
 * entry dropped without being recorded here fails it the other way.
 *
 * It is NOT the answer to "which registered tool is not a tile", because five more ids are
 * not tiles: `rectangle`, `ellipse`, `triangle`, `polygon` and `line`, reachable only as
 * values of the `shape` tile's `figure`. The test carves those five out by name, so adding
 * a sixth alias means adding it to that exemption too.
 */
export const extraTools = ['color', 'levels', 'transform'] as const satisfies readonly ToolName[];
