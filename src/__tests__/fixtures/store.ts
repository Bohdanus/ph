import type { DurableDocumentStatus, StoreDispatch } from '@/contexts/StoreContext.tsx';
import type { MigrationDiagnostic } from '@/contexts/history-adapter.ts';
import type { DurableDocument } from '@/contexts/history-model.ts';
import type { HistoryItem } from '@/contexts/history-types.ts';
import type { LayersRecord, LayerId } from '@/contexts/layer-types.ts';
import type { Size, Selection } from '@/contexts/general-types.ts';
import type { DocumentFrame } from '@/contexts/document-frame.ts';
import type { ToolArgs, ToolName } from '@/contexts/tool-types.ts';
import { createMockLayers } from './layer.ts';
import { createMockHistory } from './history.ts';

export interface MockStoreState {
  canvasRef?: { current: HTMLCanvasElement | null };
  toolOverlayRef?: { current: HTMLCanvasElement | null };
  rectOverlayRef?: { current: HTMLCanvasElement | null };
  containerRef?: { current: HTMLDivElement | null };
  textareaRef?: { current: HTMLTextAreaElement | null };
  canvasCtxRef?: { current: CanvasRenderingContext2D | null };
  currentArgs?: { current: ToolArgs };
  clearPreviewLayers?: () => void;
  promoteLayerPresentation?: (request: unknown) => void;
  previewLayers?: Record<LayerId, { layer: unknown; toolArgs?: ToolArgs }>;
  hasImage?: boolean;
  hasUnsavedChanges?: boolean;
  fileName?: string;
  totalSize?: Size;
  documentFrame?: DocumentFrame;
  toolName?: ToolName;
  isToolDirty?: boolean;
  layers?: LayersRecord;
  deletedLayers?: LayersRecord;
  activeLayerId?: LayerId | null;
  selections?: Selection[];
  activeSelectionId?: string | null;
  selectionDraft?: { status: string; sourceTool?: string };
  selectionCleared?: { status: string; version: number } | null;
  selectionClipboard?: unknown;
  history?: HistoryItem[];
  historyIndex?: number;
  documentId?: string;
  documentRevision?: number;
  branchRevision?: number;
  durableDocument?: DurableDocument | null;
  durableStatus?: DurableDocumentStatus;
  durableDiagnostics?: readonly MigrationDiagnostic[];
  color?: string;
  backgroundColor?: string;
}

export const createMockStoreState = (overrides: MockStoreState = {}): MockStoreState => ({
  canvasRef: { current: null },
  toolOverlayRef: { current: null },
  rectOverlayRef: { current: null },
  containerRef: { current: null },
  textareaRef: { current: null },
  canvasCtxRef: { current: null },
  currentArgs: { current: {} as ToolArgs },
  clearPreviewLayers: vi.fn(),
  promoteLayerPresentation: vi.fn(),
  previewLayers: {},
  hasImage: false,
  hasUnsavedChanges: false,
  fileName: '',
  totalSize: { width: 128, height: 64 },
  documentFrame: { x: 0, y: 0, width: 128, height: 64 },
  toolName: 'reposition' as ToolName,
  isToolDirty: false,
  layers: {},
  deletedLayers: {},
  activeLayerId: null,
  selections: [],
  activeSelectionId: null,
  selectionDraft: { status: 'idle' },
  selectionCleared: null,
  selectionClipboard: null,
  history: [],
  historyIndex: -1,
  documentId: 'test-doc',
  documentRevision: 0,
  branchRevision: 0,
  durableDocument: null,
  durableStatus: 'unavailable',
  durableDiagnostics: [],
  color: '#000000',
  backgroundColor: '#ffffff',
  ...overrides,
});

export const createMockStoreWithHistory = (
  history: HistoryItem[] = createMockHistory(),
  overrides: MockStoreState = {}
): MockStoreState =>
  createMockStoreState({
    history,
    historyIndex: history.length - 1,
    ...overrides,
  });

export const createMockStoreWithLayers = (
  layers: LayersRecord = createMockLayers(3),
  activeLayerId: LayerId | null = 'layer-2',
  overrides: MockStoreState = {}
): MockStoreState =>
  createMockStoreState({
    layers,
    activeLayerId,
    ...overrides,
  });

export const createFullMockStore = (overrides: MockStoreState = {}): MockStoreState => {
  const layers = createMockLayers(3);
  const history = createMockHistory(2);
  return createMockStoreState({
    layers,
    activeLayerId: 'layer-2',
    history,
    historyIndex: history.length - 1,
    ...overrides,
  });
};

export const createMockDispatch = (): StoreDispatch => vi.fn();
