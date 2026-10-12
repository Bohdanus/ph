export const HANDLE_SIZE = 12;

export const TEXT_PADDING = 5;

export const CURSOR_MAP = {
  top: 'ns-resize',
  'top-right': 'nesw-resize',
  right: 'ew-resize',
  'bottom-right': 'nwse-resize',
  bottom: 'ns-resize',
  'bottom-left': 'nesw-resize',
  left: 'ew-resize',
  'top-left': 'nwse-resize',
  inside: 'move',
  rotate: 'ew-resize',
};

export const DEFAULT_TOOL = 'draw';

export const NEW_LAYER_ACTION = 'new layer';
export const OPEN_DOCUMENT_ACTION = 'open document';
export const SELECTION_ACTION = 'selection';
export const TOOL_ACTION = 'tool';
export const SHOW_LAYER_ACTION = 'show';
export const HIDE_LAYER_ACTION = 'hide';
export const RENAME_LAYER_ACTION = 'rename';
export const SET_LAYER_OPACITY_ACTION = 'set layer opacity';
export const LAYER_TRANSPARENCY_ACTION = 'layer transparency'; // todo this is not triggered not recorded nor replayed yet
// export const UPDATE_LAYER_ACTION = 'some update'; // fallback, and maybe never used
export const REORDER_ACTION = 'reorder layers';
export const MERGE_ACTION = 'merge layers';
export const REPLACE_LAYER_SOURCE_ACTION = 'edit layer source';
export const REMOVE_ACTION = 'remove layer';
export const SET_DOCUMENT_FRAME_ACTION = 'set document frame';

export type ActionType =
  | typeof OPEN_DOCUMENT_ACTION
  | typeof NEW_LAYER_ACTION
  | typeof SELECTION_ACTION
  | typeof TOOL_ACTION
  | typeof SHOW_LAYER_ACTION
  | typeof HIDE_LAYER_ACTION
  | typeof RENAME_LAYER_ACTION
  | typeof SET_LAYER_OPACITY_ACTION
  | typeof LAYER_TRANSPARENCY_ACTION
  // | typeof UPDATE_LAYER_ACTION
  | typeof REORDER_ACTION
  | typeof MERGE_ACTION
  | typeof REPLACE_LAYER_SOURCE_ACTION
  | typeof REMOVE_ACTION
  | typeof SET_DOCUMENT_FRAME_ACTION;
