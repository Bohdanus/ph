/**
 * The Photoshop options bars for the tools whose panels are still placeholders. The
 * chips are the real control names, not invented ones, so the eventual panel has a
 * checklist to build against and the toolbar reads correctly in the meantime.
 *
 * A key here and a `placeholderTool(title, key)` call in `src/tools/toolsMap.ts` are one
 * unit, and the pair has to move together: `PlaceholderTool` indexes this record, so
 * deleting a key while a call still names it crashes the bar at render, and shipping a
 * real panel while its key survives leaves a dead entry nobody notices until the next
 * rename.
 */
export const placeholderToolGroups: Record<string, readonly string[]> = {
  // `color-replacement` used to sit here, naming Tolerance, Limits, Sampling and Anti-alias as
  // prose on a TODO card. It is a real options bar now
  // (`src/components/ToolbarsRight/ColorReplacement/ColorReplacement.tsx`) and all four are live
  // controls, so a placeholder listing them would be a card advertising another tool's bar.
  //
  // The `brush` and `pencil` groups the colour-replacement branch also added here are NOT
  // carried over: that branch was written before the paint tools traded their placeholders for
  // `src/components/ToolbarsRight/Paint/Paint.tsx`, and `toolsMap` wires them to the real
  // components. A group with no `placeholderTool(title, key)` call is dead config, and
  // `ToolbarPlaceholder.test.tsx` reports exactly that.
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
