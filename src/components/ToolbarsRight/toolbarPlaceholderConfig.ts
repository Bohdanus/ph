export const placeholderToolGroups: Record<string, readonly string[]> = {
  brush: ['Brush Preset Picker', 'Blend Mode', 'Opacity', 'Flow', 'Airbrush', 'Smoothing', 'Symmetry'],
  pencil: ['Brush Preset Picker', 'Blend Mode', 'Opacity', 'Auto Erase', 'Smoothing', 'Symmetry'],
  // `color-replacement` used to sit here, naming Tolerance, Limits, Sampling and Anti-alias as
  // prose on a TODO card. It is a real options bar now
  // (`src/components/ToolbarsRight/ColorReplacement/ColorReplacement.tsx`) and all four are live
  // controls, so a placeholder listing them would be a card advertising another tool's bar.
  pen: ['Tool Mode', 'Fill', 'Stroke', 'Make Selection', 'Path Operations', 'Alignment', 'Auto Add/Delete'],
  'freeform-pen': ['Tool Mode', 'Fill', 'Stroke', 'Magnetic', 'Curve Fit'],
  'curvature-pen': ['Tool Mode', 'Fill', 'Stroke', 'Magnetic', 'Curve Fit'],
  rectangle: [
    'Tool Mode',
    'Fill',
    'Stroke',
    'Stroke Width',
    'Stroke Style',
    'W/H',
    'Path Operations',
    'Alignment',
    'Radius',
  ],
  'custom-shape': ['Tool Mode', 'Fill', 'Stroke', 'W/H', 'Shape Picker', 'Path Operations'],
};
