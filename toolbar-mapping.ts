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
 * Photoshop-inspired toolbar map in the canonical one-column order.
 *
 * Each nested array is one flyout menu. Unsupported Photoshop tools are
 * intentionally omitted rather than represented by placeholder values.
 * The two-column layout is derived from this order by SidebarLeft.
 */
export const toolbarMap = [
  [
    [{ label: 'Move Tool', name: 'reposition', shortcut: 'V' }],
    [{ label: 'Rectangular Marquee Tool', name: 'rectangular-selection', shortcut: 'M' }],
    [
      { label: 'Lasso Tool', name: 'freehand-lasso', shortcut: 'L' },
      { label: 'Polygonal Lasso Tool', name: 'polygonal-lasso' },
      { label: 'Magnetic Lasso Tool', name: 'feather-magnetic-lasso', shortcut: 'Shift+L' },
    ],
    [{ label: 'Magic Wand Tool', name: 'magic-wand', shortcut: 'W' }],
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
    [
      { label: 'Brush Tool', name: 'brush', shortcut: 'B' },
      { label: 'Pencil Tool', name: 'pencil' },
      { label: 'Color Replacement Tool', name: 'color-replacement' },
    ],
    [{ label: 'Blur Tool', name: 'blur' }],
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
  'freehand-lasso',
  'polygonal-lasso',
  'feather-magnetic-lasso',
  'magic-wand',
];

export const extraTools = ['color', 'levels', 'transform'] as const satisfies readonly ToolName[];
