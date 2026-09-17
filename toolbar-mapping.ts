// Toolbar mapping: Photoshop toolbar structure → Lightshopy app tools
// Format: [Photoshop Tool Name, Lightshopy ToolName | null]
// null = feature doesn't exist in current application

export const toolbarMap = [
  // Group 1: Selection & Move Tools
  [
    [
      ['Move Tool', 'reposition'],
      ['Artboard Tool', null],
    ],
    [
      ['Rectangular Marquee Tool', 'rectangular-selection'],
      ['Elliptical Marquee Tool', null],
      ['Single Row Marquee Tool', null],
      ['Single Column Marquee Tool', null],
    ],
    [
      ['Lasso Tool', 'freehand-lasso'],
      ['Polygonal Lasso Tool', 'polygonal-lasso'],
      ['Magnetic Lasso Tool', 'feather-magnetic-lasso'],
    ],
    [
      ['Object Selection Tool', null],
      ['Quick Selection Tool', null],
      ['Magic Wand Tool', 'magic-wand'],
    ],
  ],
  // Group 2: Crop & Slice Tools
  [
    [
      ['Crop Tool', 'crop'],
      ['Perspective Crop Tool', null],
      ['Slice Tool', null],
      ['Slice Select Tool', null],
    ],
    [
      ['Frame Tool', null],
    ],
  ],
  // Group 3: Measurement Tools
  [
    [
      ['Eyedropper Tool', 'color'],
      ['3D Material Eyedropper Tool', null],
      ['Color Sampler Tool', null],
      ['Ruler Tool', null],
      ['Note Tool', null],
      ['Count Tool', null],
    ],
  ],
  // Group 4: Retouching & Painting Tools
  [
    [
      ['Spot Healing Brush Tool', null],
      ['Remove Tool', null],
      ['Healing Brush Tool', null],
      ['Patch Tool', null],
      ['Content-Aware Move Tool', null],
      ['Red Eye Tool', null],
    ],
    [
      ['Brush Tool', 'draw'],
      ['Pencil Tool', null],
      ['Color Replacement Tool', null],
      ['Mixer Brush Tool', null],
    ],
    [
      ['Clone Stamp Tool', null],
      ['Pattern Stamp Tool', null],
    ],
    [
      ['History Brush Tool', null],
      ['Art History Brush Tool', null],
    ],
    [
      ['Eraser Tool', null],
      ['Background Eraser Tool', null],
      ['Magic Eraser Tool', null],
    ],
    [
      ['Gradient Tool', null],
      ['Paint Bucket Tool', null],
      ['3D Material Drop Tool', null],
    ],
    [
      ['Blur Tool', 'blur'],
      ['Sharpen Tool', null],
      ['Smudge Tool', null],
    ],
    [
      ['Dodge Tool', null],
      ['Burn Tool', null],
      ['Sponge Tool', null],
    ],
  ],
  // Group 5: Vector & Type Tools
  [
    [
      ['Pen Tool', null],
      ['Freeform Pen Tool', null],
      ['Curvature Pen Tool', null],
      ['Add Anchor Point Tool', null],
      ['Delete Anchor Point Tool', null],
      ['Convert Point Tool', null],
    ],
    [
      ['Horizontal Type Tool', 'text'],
      ['Vertical Type Tool', null],
      ['Vertical Type Mask Tool', null],
      ['Horizontal Type Mask Tool', null],
    ],
    [
      ['Path Selection Tool', null],
      ['Direct Selection Tool', null],
    ],
    [
      ['Rectangle Tool', 'shape'],
      ['Ellipse Tool', 'shape'],
      ['Triangle Tool', 'shape'],
      ['Polygon Tool', 'shape'],
      ['Line Tool', 'shape'],
      ['Custom Shape Tool', 'shape'],
    ],
  ],
  // Group 6: Navigation Tools
  [
    [
      ['Hand Tool', null],
      ['Rotate View Tool', null],
    ],
    [
      ['Zoom Tool', null],
    ],
  ],
] as const;

// Flat list of all available Lightshopy tools for reference
export const availableTools = [
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
] as const;

// Tools that exist in Lightshopy but don't have a direct Photoshop toolbar equivalent
export const extraTools = [
  'levels',    // Image adjustment, not a toolbar tool
  'transform', // Free Transform (Ctrl+T), menu command not toolbar
] as const;

export type ToolName = typeof availableTools[number];
export type PhotoshopToolName = string;
export type MappingEntry = [PhotoshopToolName, ToolName | null];