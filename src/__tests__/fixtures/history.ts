import type { HistoryItem, NewHistoryItem } from '@/contexts/history-types.ts';
import {
  NEW_LAYER_ACTION,
  RENAME_LAYER_ACTION,
  TOOL_ACTION,
  MERGE_ACTION,
  OPEN_DOCUMENT_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
} from '@/util/constants.ts';
import type { LayersRecord } from '@/contexts/layer-types.ts';
import type { Size as GeneralSize } from '@/contexts/general-types.ts';
import type { BlankLayerSource, ImageLayerSource, ToolLayerSource } from '@/contexts/layer-types.ts';

export const createMockHistoryItem = (overrides: Partial<HistoryItem> = {}): HistoryItem => ({
  id: 'hist-1',
  layerId: 'layer-1',
  actionName: NEW_LAYER_ACTION,
  args: { name: 'Layer 1' },
  disabled: false,
  ...overrides,
});

export const createMockHistory = (count: number = 2): HistoryItem[] => {
  const history: HistoryItem[] = [];
  for (let i = 0; i < count; i++) {
    history.push(
      createMockHistoryItem({
        id: `hist-${i + 1}`,
        layerId: `layer-${i + 1}`,
        actionName: i === 0 ? NEW_LAYER_ACTION : RENAME_LAYER_ACTION,
        args: i === 0 ? undefined : { name: `Layer ${i + 1}` },
      })
    );
  }
  return history;
};

export const createNewHistoryItem = (overrides: Partial<NewHistoryItem> = {}): NewHistoryItem => ({
  layerId: 'layer-1',
  actionName: RENAME_LAYER_ACTION,
  args: { name: 'Renamed' },
  ...overrides,
});

export const createLayerSourceHistoryItem = (overrides: Partial<HistoryItem> = {}): HistoryItem => ({
  ...createMockHistoryItem(),
  layerSource: {
    kind: 'blank',
    color: '#ffffff',
    opacity: 1,
    isBedrock: true,
    size: { width: 128, height: 64 },
  } as BlankLayerSource,
  ...overrides,
});

export const createToolHistoryItem = (toolName: string, overrides: Partial<HistoryItem> = {}): HistoryItem => ({
  ...createMockHistoryItem(),
  actionName: TOOL_ACTION,
  args: { toolName },
  layerSource: {
    kind: 'tool',
    args: { toolName },
    pos: { x: 0, y: 0, width: 100, height: 100 },
  } as ToolLayerSource,
  ...overrides,
});

export const createImageHistoryItem = (bitmap: ImageBitmap, overrides: Partial<HistoryItem> = {}): HistoryItem => ({
  ...createMockHistoryItem(),
  actionName: NEW_LAYER_ACTION,
  layerSource: {
    kind: 'image',
    bitmap,
    isBedrock: true,
    size: { width: bitmap.width, height: bitmap.height },
  } as ImageLayerSource,
  ...overrides,
});

export const createMergeHistoryItem = (overrides: Partial<HistoryItem> = {}): HistoryItem => ({
  ...createMockHistoryItem(),
  actionName: MERGE_ACTION,
  ...overrides,
});

export const createOpenDocumentHistoryItem = (
  layers: LayersRecord,
  size: GeneralSize,
  overrides: Partial<HistoryItem> = {}
): HistoryItem => ({
  ...createMockHistoryItem(),
  actionName: OPEN_DOCUMENT_ACTION,
  documentSource: { layers, size },
  ...overrides,
});

export const createSelectionHistoryItem = (
  previousSelections: unknown,
  nextSelections: unknown,
  overrides: Partial<HistoryItem> = {}
): HistoryItem => ({
  ...createMockHistoryItem(),
  id: 'selection-clear',
  layerId: 'selection',
  actionName: 'selection',
  args: {
    previousSelectionState: previousSelections,
    nextSelectionState: nextSelections,
  },
  ...overrides,
});

export const createCropHistoryItem = (
  frame: { x: number; y: number; width: number; height: number },
  overrides: Partial<HistoryItem> = {}
): HistoryItem => ({
  ...createMockHistoryItem(),
  actionName: SET_DOCUMENT_FRAME_ACTION,
  args: { frame },
  ...overrides,
});
