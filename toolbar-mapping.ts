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
      { label: 'Lasso Tool', name: 'freehand-lasso', shortcut: 'L' },
      { label: 'Polygonal Lasso Tool', name: 'polygonal-lasso' },
      { label: 'Magnetic Lasso Tool', name: 'feather-magnetic-lasso', shortcut: 'Shift+L' },
    ],
    // The Quick Selection shares the Magic Wand's tile because Photoshop puts the two
    // adjacent, and the Wand is the tile's identity as the first entry.
    [
      { label: 'Magic Wand Tool', name: 'magic-wand', shortcut: 'W' },
      { label: 'Quick Selection Tool', name: 'quick-selection' },
    ],
    // Its own single-tool tile, so it gets no flyout of its own and stays directly after the
    // Magic Wand it reads its Sample Size from in Photoshop.
    [{ label: 'Eyedropper Tool', name: 'eyedropper', shortcut: 'I' }],
  ],
  [[{ label: 'Crop Tool', name: 'crop', shortcut: 'C' }]],
  [
    [
      { label: 'Colors', name: 'color' },
      { label: 'Levels', name: 'levels' },
      { label: 'Transform', name: 'transform' },
    ],
  ],
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
    ],
    [{ label: 'Draw Tool', name: 'draw', shortcut: 'B' }],
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
  'eraser',
  'magic-eraser',
  'clone-stamp',
  'paint-bucket',
  'gradient',
  'sharpen',
  'smudge',
  'dodge',
  'burn',
];

export const extraTools = ['color', 'levels', 'transform'] as const satisfies readonly ToolName[];
