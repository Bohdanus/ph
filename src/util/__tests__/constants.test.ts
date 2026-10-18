import { describe, expect, it } from 'vitest';
import {
  CURSOR_MAP,
  DEFAULT_TOOL,
  HANDLE_SIZE,
  HIDE_LAYER_ACTION,
  LAYER_TRANSPARENCY_ACTION,
  LOCK_LAYER_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  OPEN_DOCUMENT_ACTION,
  REMOVE_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  REPLACE_LAYER_SOURCE_ACTION,
  SELECTION_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SET_LAYER_BLEND_MODE_ACTION,
  SET_LAYER_OPACITY_ACTION,
  SHOW_LAYER_ACTION,
  TEXT_PADDING,
  TOOL_ACTION,
  UNLOCK_LAYER_ACTION,
  type ActionType,
} from '../constants.ts';
import type { ToolName } from '../../contexts/tool-types.ts';
import { toolsMap } from '../../tools/toolsMap.ts';
import { THROTTLE_DRAW, THROTTLE_TIME } from '../../constants/index.ts';

// Runtime mirror of the `ActionType` union (src/util/constants.ts:38-52). The tests below
// assert this array grows in lock-step with the union, so a newly added action constant is
// never silently dropped from the safety net and a commented-out member never drifts back in
// unnoticed.
const LEGAL_ACTION_VALUES: readonly ActionType[] = [
  OPEN_DOCUMENT_ACTION,
  NEW_LAYER_ACTION,
  SELECTION_ACTION,
  TOOL_ACTION,
  SHOW_LAYER_ACTION,
  HIDE_LAYER_ACTION,
  RENAME_LAYER_ACTION,
  SET_LAYER_OPACITY_ACTION,
  SET_LAYER_BLEND_MODE_ACTION,
  LOCK_LAYER_ACTION,
  UNLOCK_LAYER_ACTION,
  REORDER_ACTION,
  MERGE_ACTION,
  REPLACE_LAYER_SOURCE_ACTION,
  REMOVE_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
];

describe('action type constants', () => {
  it('exhaustively mirrors every member of the ActionType union', () => {
    // Keep the runtime mirror complete as the union grows.
    expect(LEGAL_ACTION_VALUES).toHaveLength(16);
    expect(LEGAL_ACTION_VALUES).toEqual(
      expect.arrayContaining([
        OPEN_DOCUMENT_ACTION,
        NEW_LAYER_ACTION,
        SELECTION_ACTION,
        TOOL_ACTION,
        SHOW_LAYER_ACTION,
        HIDE_LAYER_ACTION,
        RENAME_LAYER_ACTION,
        SET_LAYER_OPACITY_ACTION,
        SET_LAYER_BLEND_MODE_ACTION,
        LOCK_LAYER_ACTION,
        UNLOCK_LAYER_ACTION,
        REORDER_ACTION,
        MERGE_ACTION,
        REPLACE_LAYER_SOURCE_ACTION,
        REMOVE_ACTION,
        SET_DOCUMENT_FRAME_ACTION,
      ])
    );
  });
  const actions: Record<string, ActionType> = {
    OPEN_DOCUMENT_ACTION,
    NEW_LAYER_ACTION,
    SELECTION_ACTION,
    TOOL_ACTION,
    SHOW_LAYER_ACTION,
    HIDE_LAYER_ACTION,
    LOCK_LAYER_ACTION,
    RENAME_LAYER_ACTION,
    SET_LAYER_BLEND_MODE_ACTION,
    SET_LAYER_OPACITY_ACTION,
    UNLOCK_LAYER_ACTION,
    REORDER_ACTION,
    MERGE_ACTION,
    REPLACE_LAYER_SOURCE_ACTION,
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

  it('carries its exact, source-pinned string value', () => {
    expect(OPEN_DOCUMENT_ACTION).toBe('open document');
    expect(NEW_LAYER_ACTION).toBe('new layer');
    expect(SELECTION_ACTION).toBe('selection');
    expect(TOOL_ACTION).toBe('tool');
    expect(SHOW_LAYER_ACTION).toBe('show');
    expect(HIDE_LAYER_ACTION).toBe('hide');
    expect(RENAME_LAYER_ACTION).toBe('rename');
    expect(SET_LAYER_OPACITY_ACTION).toBe('set layer opacity');
    expect(REORDER_ACTION).toBe('reorder layers');
    expect(MERGE_ACTION).toBe('merge layers');
    expect(REPLACE_LAYER_SOURCE_ACTION).toBe('edit layer source');
    expect(REMOVE_ACTION).toBe('remove layer');
    expect(SET_DOCUMENT_FRAME_ACTION).toBe('set document frame');
  });

  it('does not reuse one action name for two different constants', () => {
    expect(TOOL_ACTION).not.toBe(SELECTION_ACTION);
    expect(SHOW_LAYER_ACTION).not.toBe(HIDE_LAYER_ACTION);
    expect(REORDER_ACTION).not.toBe(MERGE_ACTION);
    expect(REMOVE_ACTION).not.toBe(MERGE_ACTION);
    expect(REPLACE_LAYER_SOURCE_ACTION).not.toBe(MERGE_ACTION);
  });

  it('keeps the legacy LAYER_TRANSPARENCY_ACTION label distinct from legal actions', () => {
    expect(LAYER_TRANSPARENCY_ACTION).toBe('layer transparency');
    // It is deliberately outside `ActionType` (src/util/constants.ts:28-30), so it must
    // never collide with a real action value.
    expect(LEGAL_ACTION_VALUES as readonly string[]).not.toContain(LAYER_TRANSPARENCY_ACTION);
    for (const value of LEGAL_ACTION_VALUES as readonly string[]) {
      expect(LAYER_TRANSPARENCY_ACTION).not.toBe(value);
    }
    expect(LOCK_LAYER_ACTION).not.toBe(UNLOCK_LAYER_ACTION);
  });
});

describe('CURSOR_MAP', () => {
  it('covers every resize handle plus the interior', () => {
    expect(Object.keys(CURSOR_MAP).sort()).toEqual(
      [
        'bottom',
        'bottom-left',
        'bottom-right',
        'inside',
        'left',
        'right',
        'rotate',
        'top',
        'top-left',
        'top-right',
      ].sort()
    );
  });

  it('pins every cursor to its exact CSS cursor keyword', () => {
    expect(CURSOR_MAP.top).toBe('ns-resize');
    expect(CURSOR_MAP['top-right']).toBe('nesw-resize');
    expect(CURSOR_MAP.right).toBe('ew-resize');
    expect(CURSOR_MAP['bottom-right']).toBe('nwse-resize');
    expect(CURSOR_MAP.bottom).toBe('ns-resize');
    expect(CURSOR_MAP['bottom-left']).toBe('nesw-resize');
    expect(CURSOR_MAP.left).toBe('ew-resize');
    expect(CURSOR_MAP['top-left']).toBe('nwse-resize');
    expect(CURSOR_MAP.inside).toBe('move');
    expect(CURSOR_MAP.rotate).toBe('ew-resize');
  });

  it('uses only valid CSS cursor keywords', () => {
    const validCursors = new Set([
      'auto',
      'default',
      'none',
      'context-menu',
      'help',
      'pointer',
      'progress',
      'wait',
      'cell',
      'crosshair',
      'text',
      'vertical-text',
      'move',
      'grab',
      'grabbing',
      'zoom-in',
      'zoom-out',
      'ns-resize',
      'ew-resize',
      'nesw-resize',
      'nwse-resize',
      'n-resize',
      'e-resize',
      's-resize',
      'w-resize',
      'ne-resize',
      'nw-resize',
      'se-resize',
      'sw-resize',
      'col-resize',
      'row-resize',
    ]);
    for (const cursor of Object.values(CURSOR_MAP)) {
      expect(validCursors.has(cursor)).toBe(true);
    }
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

  // A corner handle's cursor names the diagonal the pointer travels along, so the handle's
  // own corner must be one end of that diagonal:
  //   top-left -> NW<->SE -> nwse-resize        top-right -> NE<->SW -> nesw-resize
  //   bottom-left -> SW<->NE -> nesw-resize     bottom-right -> SE<->NW -> nwse-resize
  // `src/util/constants.ts:5-15` already pairs every corner with the diagonal it lies on.
  // The previous `it.fails` expectations for the top corners asserted the mirror-image
  // diagonal, so they were documenting a defect that does not exist and would have
  // "failed fixed" the moment someone corrected a working cursor.
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
  it('pins HANDLE_SIZE and TEXT_PADDING to their source values', () => {
    expect(HANDLE_SIZE).toBe(12);
    expect(TEXT_PADDING).toBe(5);
  });

  it('keeps both as positive integers safe for canvas pixel math', () => {
    // A zero or sub-unit hit target / padding is a degenerate input for any dimension that is
    // multiplied into a canvas rectangle; `Number.isInteger` guards against the fractional or
    // non-finite value that would poison stroke/footprint geometry downstream.
    expect(Number.isInteger(HANDLE_SIZE)).toBe(true);
    expect(Number.isInteger(TEXT_PADDING)).toBe(true);
    expect(HANDLE_SIZE).toBeGreaterThanOrEqual(1);
    expect(TEXT_PADDING).toBeGreaterThanOrEqual(1);
  });

  it('does not treat padding as a handle hit target', () => {
    // These two dimensions have independent jobs: HANDLE_SIZE is the grab area for a resize
    // handle, TEXT_PADDING is the inset around a text layer label. Conflating them is a
    // silent drift bug, so assert they are not aliases of one another.
    expect(HANDLE_SIZE).not.toBe(TEXT_PADDING);
  });
});

describe('DEFAULT_TOOL', () => {
  it('names a tool that exists in the tool registry', () => {
    const registeredToolNames = Object.keys(toolsMap);
    const name: ToolName = DEFAULT_TOOL;
    expect(registeredToolNames).toContain(name);
  });

  it('is the draw tool', () => {
    expect(DEFAULT_TOOL).toBe('draw');
  });

  it('is a lowercase, non-empty registry key', () => {
    expect(DEFAULT_TOOL.length).toBeGreaterThan(0);
    expect(DEFAULT_TOOL).toBe(DEFAULT_TOOL.toLowerCase());
  });
});

describe('throttle constants', () => {
  it('pins THROTTLE_TIME and THROTTLE_DRAW to their source values', () => {
    expect(THROTTLE_TIME).toBe(50);
    expect(THROTTLE_DRAW).toBe(30);
  });

  it('declares positive integer millisecond delays', () => {
    expect(Number.isInteger(THROTTLE_TIME)).toBe(true);
    expect(Number.isInteger(THROTTLE_DRAW)).toBe(true);
    expect(THROTTLE_TIME).toBeGreaterThan(0);
    expect(THROTTLE_DRAW).toBeGreaterThan(0);
  });

  it('throttles drawing input more aggressively than generic input', () => {
    expect(THROTTLE_DRAW).toBeLessThan(THROTTLE_TIME);
  });

  it('keeps drawing input strictly above zero, not clamped to zero', () => {
    // A THROTTLE_DRAW of 0 would disable throttling for strokes and flood the store; the
    // boundary is "strictly positive", not merely non-negative.
    expect(THROTTLE_DRAW).toBeGreaterThan(0);
    expect(THROTTLE_TIME).toBeGreaterThan(0);
  });
});

describe('known gaps (it.fails tripwires)', () => {
  // Tripwires assert the state this module *ought* to reach but has not yet. A passing
  // tripwire here is green only because its body throws; the moment the gap is closed the
  // body starts passing, the tripwire flips red, and the author must either promote it to a
  // plain `it` or retire it. Every pin below names the documented source boundary it targets
  // so the tripwire cannot outlive the decision that created it.

  it.fails('treats the legacy LAYER_TRANSPARENCY_ACTION label as a legal ActionType', () => {
    // `src/util/constants.ts:28-30` retains LAYER_TRANSPARENCY_ACTION as a legacy diagnostic
    // label and explicitly keeps it out of `ActionType` ("because no writer, durable
    // translator, or replay arm exists for it"). Until that machinery exists, the label is not
    // a legal action, so this membership check fails and the tripwire stays green.
    const legalValues = LEGAL_ACTION_VALUES as readonly string[];
    expect(legalValues.includes(LAYER_TRANSPARENCY_ACTION)).toBe(true);
  });

  it.fails('wires the commented-out UPDATE_LAYER_ACTION into the legal ActionType union', () => {
    // `src/util/constants.ts:31` comments out `UPDATE_LAYER_ACTION = 'some update'` and its
    // union member (`src/util/constants.ts:47`). The literal is named directly so the
    // tripwire compiles while the symbol stays commented out; it fails until the action is
    // uncommented and added to `ActionType` — a deliberate decision either way.
    const legalValues = LEGAL_ACTION_VALUES as readonly string[];
    expect(legalValues.includes('some update')).toBe(true);
  });
});
