import { describe, expect, it } from 'vitest';
import {
  CURSOR_MAP,
  DEFAULT_TOOL,
  HANDLE_SIZE,
  HIDE_LAYER_ACTION,
  LAYER_TRANSPARENCY_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  OPEN_DOCUMENT_ACTION,
  REMOVE_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  SELECTION_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SET_LAYER_OPACITY_ACTION,
  SHOW_LAYER_ACTION,
  TEXT_PADDING,
  TOOL_ACTION,
  type ActionType,
} from '../constants.ts';
import type { ToolName } from '../../contexts/tool-types.ts';

describe('action type constants', () => {
  const actions: Record<string, ActionType> = {
    OPEN_DOCUMENT_ACTION,
    NEW_LAYER_ACTION,
    SELECTION_ACTION,
    TOOL_ACTION,
    SHOW_LAYER_ACTION,
    HIDE_LAYER_ACTION,
    RENAME_LAYER_ACTION,
    SET_LAYER_OPACITY_ACTION,
    LAYER_TRANSPARENCY_ACTION,
    REORDER_ACTION,
    MERGE_ACTION,
    REMOVE_ACTION,
    SET_DOCUMENT_FRAME_ACTION,
  };

  it('declares a distinct, non-empty, lowercase value for every action', () => {
    const values = Object.values(actions);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) {
      expect(value.length).toBeGreaterThan(0);
      expect(value).toBe(value.toLowerCase());
    }
  });

  it('does not reuse one action name for two different constants', () => {
    expect(TOOL_ACTION).not.toBe(SELECTION_ACTION);
    expect(SHOW_LAYER_ACTION).not.toBe(HIDE_LAYER_ACTION);
    expect(REORDER_ACTION).not.toBe(MERGE_ACTION);
    expect(REMOVE_ACTION).not.toBe(MERGE_ACTION);
  });
});

describe('CURSOR_MAP', () => {
  it('covers every resize handle plus the interior', () => {
    expect(Object.keys(CURSOR_MAP).sort()).toEqual(
      ['bottom', 'bottom-left', 'bottom-right', 'inside', 'left', 'right', 'top', 'top-left', 'top-right'].sort()
    );
  });

  it('moves the pointer inside the shape', () => {
    expect(CURSOR_MAP.inside).toBe('move');
  });

  it('uses ns-resize for the vertical edges and ew-resize for the horizontal edges', () => {
    expect(CURSOR_MAP.top).toBe('ns-resize');
    expect(CURSOR_MAP.bottom).toBe('ns-resize');
    expect(CURSOR_MAP.left).toBe('ew-resize');
    expect(CURSOR_MAP.right).toBe('ew-resize');
  });

  // A corner handle's cursor names the diagonal the pointer travels along, so the
  // handle's own corner must be one end of that diagonal:
  //   top-left -> NW<->SE -> nwse-resize        top-right -> NE<->SW -> nesw-resize
  //   bottom-left -> SW<->NE -> nesw-resize     bottom-right -> SE<->NW -> nwse-resize
  // `src/util/constants.ts:5-15` already pairs every corner with the diagonal it
  // lies on. The previous `it.fails` expectations for the top corners asserted the
  // mirror-image diagonal, so they were documenting a defect that does not exist
  // and would have "failed fixed" the moment someone corrected a working cursor.
  it('uses nesw-resize for the corners on the anti-diagonal', () => {
    expect(CURSOR_MAP['bottom-left']).toBe('nesw-resize');
    expect(CURSOR_MAP['top-right']).toBe('nesw-resize');
  });

  it('uses nwse-resize for the corners on the main diagonal', () => {
    expect(CURSOR_MAP['bottom-right']).toBe('nwse-resize');
    expect(CURSOR_MAP['top-left']).toBe('nwse-resize');
  });
});

describe('handle and padding constants', () => {
  it('uses a positive square hit target', () => {
    expect(HANDLE_SIZE).toBe(12);
  });

  it('uses a positive text padding', () => {
    expect(TEXT_PADDING).toBe(5);
  });
});

describe('DEFAULT_TOOL', () => {
  it('names a tool that exists in the tool registry', () => {
    const toolNames: readonly string[] = [
      'reposition',
      'blur',
      'color',
      'levels',
      'transform',
      'crop',
      'draw',
      'shape',
      'text',
      'polygonal-lasso',
      'freehand-lasso',
      'feather-magnetic-lasso',
      'magic-wand',
      'rectangular-selection',
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
    ];

    const name: ToolName = DEFAULT_TOOL;
    expect(toolNames).toContain(name);
  });
});
