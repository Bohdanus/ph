import { describe, expect, it } from 'vitest';

import {
  publishSelectionDragPreview,
  readSelectionDragPreview,
  clearSelectionDragPreview,
  type SelectionDragPreview,
} from '../selection-drag-preview.ts';
import type { Selection } from '../../contexts/general-types.ts';

describe('selection-drag-preview', () => {
  beforeEach(() => {
    clearSelectionDragPreview();
  });

  it('readSelectionDragPreview returns null initially', () => {
    expect(readSelectionDragPreview()).toBeNull();
  });

  it('publishSelectionDragPreview sets a follow preview', () => {
    const mockSelection: Selection = {
      id: 'test-selection',
      points: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      ],
      isActive: true,
      pos: { x: 0, y: 0, width: 10, height: 10 },
    };
    const preview: SelectionDragPreview = { kind: 'follow', selection: mockSelection };

    publishSelectionDragPreview(preview);
    expect(readSelectionDragPreview()).toEqual(preview);
  });

  it('publishSelectionDragPreview sets a marquee preview', () => {
    const preview: SelectionDragPreview = { kind: 'marquee' };

    publishSelectionDragPreview(preview);
    expect(readSelectionDragPreview()).toEqual(preview);
  });

  it('clearSelectionDragPreview resets to null', () => {
    publishSelectionDragPreview({ kind: 'marquee' });
    expect(readSelectionDragPreview()).toEqual({ kind: 'marquee' });

    clearSelectionDragPreview();
    expect(readSelectionDragPreview()).toBeNull();
  });

  it('publishSelectionDragPreview overwrites previous value', () => {
    const preview1: SelectionDragPreview = { kind: 'marquee' };
    const mockSelection: Selection = {
      id: 'test-selection',
      points: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      ],
      isActive: true,
      pos: { x: 0, y: 0, width: 10, height: 10 },
    };
    const preview2: SelectionDragPreview = { kind: 'follow', selection: mockSelection };

    publishSelectionDragPreview(preview1);
    expect(readSelectionDragPreview()).toEqual(preview1);

    publishSelectionDragPreview(preview2);
    expect(readSelectionDragPreview()).toEqual(preview2);
  });

  it('readSelectionDragPreview returns live reference', () => {
    const preview: SelectionDragPreview = { kind: 'marquee' };
    publishSelectionDragPreview(preview);

    const result1 = readSelectionDragPreview();
    const result2 = readSelectionDragPreview();
    expect(result1).toBe(result2);
  });
});
