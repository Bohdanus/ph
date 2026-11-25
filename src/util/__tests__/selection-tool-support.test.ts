import { describe, expect, it } from 'vitest';
import { preservesSelectionOnToolSwitch } from '../selection-tool-support.ts';

describe('preservesSelectionOnToolSwitch', () => {
  it.each([
    'polygonal-lasso',
    'rectangular-selection',
    'paint-bucket',
    'magic-eraser',
    'eraser',
    'clone-stamp',
    'patch',
    'eyedropper',
    'hand',
  ] as const)('keeps a selection for %s', (toolName) => {
    expect(preservesSelectionOnToolSwitch(toolName)).toBe(true);
  });

  it.each(['brush', 'draw', 'blur', 'smudge', 'gradient', 'reposition', 'crop'] as const)(
    'does not keep a selection for unsupported pixel tool %s',
    (toolName) => {
      expect(preservesSelectionOnToolSwitch(toolName)).toBe(false);
    }
  );
});
