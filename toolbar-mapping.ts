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
 * Sparse Photoshop-inspired toolbar map.
 *
 * Each nested array is one flyout menu. Unsupported Photoshop tools are
 * intentionally omitted rather than represented by placeholder values.
 */
export const toolbarMap = [
  // Selection tools
  [
    [{ label: 'Select & Move', name: 'reposition', shortcut: 'V' }],
    [{ label: 'Rectangular Selection', name: 'rectangular-selection', shortcut: 'M' }],
    [
      { label: 'Freehand Lasso', name: 'freehand-lasso', shortcut: 'L' },
      { label: 'Polygonal Lasso', name: 'polygonal-lasso' },
      { label: 'Magnetic Lasso', name: 'feather-magnetic-lasso', shortcut: 'Shift+L' },
    ],
    [{ label: 'Magic Wand', name: 'magic-wand', shortcut: 'W' }],
  ],
  // Crop tools
  [[{ label: 'Crop', name: 'crop', shortcut: 'C' }]],
  // App-only tools stay together in the middle of the toolbar.
  [
    [
      { label: 'Colors', name: 'color' },
      { label: 'Levels', name: 'levels' },
      { label: 'Transform', name: 'transform' },
    ],
  ],
  // Painting tools
  [[{ label: 'Draw', name: 'draw', shortcut: 'B' }], [{ label: 'Blur', name: 'blur' }]],
  // Type and shape tools
  [
    [{ label: 'Text', name: 'text', shortcut: 'T' }],
    [
      { label: 'Rectangle Tool', name: 'shape', shortcut: 'U', figure: 'rectangle' },
      { label: 'Ellipse Tool', name: 'shape', figure: 'oval' },
      { label: 'Square Tool', name: 'shape', figure: 'square' },
      { label: 'Circle Tool', name: 'shape', figure: 'circle' },
      { label: 'Line Tool', name: 'shape', figure: 'line' },
    ],
  ],
] as const satisfies readonly (readonly ToolbarToolGroup[])[];

export const availableTools: readonly ToolName[] = [
  'reposition',
  'rectangular-selection',
  'freehand-lasso',
  'polygonal-lasso',
  'feather-magnetic-lasso',
  'magic-wand',
  'crop',
  'draw',
  'shape',
  'text',
  'color',
  'blur',
  'levels',
  'transform',
];

export const extraTools = ['color', 'levels', 'transform'] as const satisfies readonly ToolName[];
