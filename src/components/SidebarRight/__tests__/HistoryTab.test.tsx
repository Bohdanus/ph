import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HistoryTab from '../HistoryTab.tsx';
import type { HistoryItem } from '@/contexts/history-types.ts';
import { NEW_LAYER_ACTION, RENAME_LAYER_ACTION, TOOL_ACTION, HIDE_LAYER_ACTION } from '@/util/constants.ts';
import { createMockHistoryItem } from '@/__tests__/fixtures/history.ts';

vi.mock('../../Icons/EyeIcon.tsx', () => ({
  EyeIcon: ({ open }: { open: boolean }) => <span data-testid="eye-icon" data-open={open} />,
}));

const mockHistory: HistoryItem[] = [
  createMockHistoryItem({ id: 'hist-1', actionName: RENAME_LAYER_ACTION, args: { name: 'Layer 1' } }),
  createMockHistoryItem({ id: 'hist-2', actionName: TOOL_ACTION, args: { toolName: 'brush' } }),
  createMockHistoryItem({ id: 'hist-3', actionName: HIDE_LAYER_ACTION }),
];

const mockStore = {
  history: mockHistory,
  historyIndex: 1,
  layers: {
    'layer-1': {
      id: 'layer-1',
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      isBedrock: false,
      order: 0,
      pos: { x: 0, y: 0, width: 100, height: 100 },
    },
  },
  activeLayerId: 'layer-1',
  totalSize: { width: 100, height: 100 },
  selections: [],
  activeSelectionId: null,
  branchRevision: 0,
  hasUnsavedChanges: false,
  deletedLayers: {},
  canvasRef: { current: null },
};

const { useStore } = vi.hoisted(() => ({
  useStore: vi.fn(),
}));

const { useHistory } = vi.hoisted(() => ({
  useHistory: vi.fn(),
}));

vi.mock('@/contexts/StoreContext.tsx', () => ({
  useStore,
}));

vi.mock('@/contexts/useHistory.ts', () => ({
  useHistory,
  getHistoryItemTitle: (item: HistoryItem) => {
    if (item.actionName === RENAME_LAYER_ACTION) return (item.args as { name?: string })?.name || 'Rename';
    if (item.actionName === TOOL_ACTION) return `Tool: ${(item.args as { toolName?: string })?.toolName || 'unknown'}`;
    if (item.actionName === HIDE_LAYER_ACTION) return 'Hide Layer';
    if (item.actionName === NEW_LAYER_ACTION) return (item.args as { name?: string })?.name || 'New Layer';
    return item.actionName;
  },
}));

describe('HistoryTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.mockReturnValue([mockStore, vi.fn()]);
    useHistory.mockReturnValue({
      resetHistoryTo: vi.fn(),
      toggleDisabled: vi.fn(),
    });
  });

  it('renders "No history yet" when history is empty', () => {
    useStore.mockReturnValue([{ ...mockStore, history: [], historyIndex: -1 }, vi.fn()]);
    render(<HistoryTab />);
    expect(screen.getByText('No history yet.')).toBeInTheDocument();
  });

  it('renders history items in reverse order (newest first)', () => {
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Hide Layer');
    expect(items[1]).toHaveTextContent('Tool: brush');
    expect(items[2]).toHaveTextContent('Layer 1');
  });

  it('highlights current history item', () => {
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    expect(items[1]).toHaveClass('bg-white');
  });

  it('shows disabled items with opacity', () => {
    const disabledHistory = [
      createMockHistoryItem({ id: 'hist-1', disabled: true }),
      createMockHistoryItem({ id: 'hist-2' }),
    ];
    useStore.mockReturnValue([{ ...mockStore, history: disabledHistory, historyIndex: 1 }, vi.fn()]);
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    // items[0] = hist-2 (originalIndex 1), active -> opacity-100
    // items[1] = hist-1 (originalIndex 0), disabled -> opacity-45
    expect(items[1]).toHaveClass('opacity-45');
    expect(items[0]).not.toHaveClass('opacity-45');
  });

  it('shows inactive items with opacity-50', () => {
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    // items[0] = hist-3 (originalIndex 2), not active (2 > 1) -> opacity-50
    // items[2] = hist-1 (originalIndex 0), active (0 <= 1) -> opacity-100
    expect(items[0]).toHaveClass('opacity-50');
    expect(items[2]).toHaveClass('opacity-100');
  });

  it('calls resetHistoryTo on item click', () => {
    const resetHistoryTo = vi.fn();
    useHistory.mockReturnValue({ resetHistoryTo, toggleDisabled: vi.fn() });
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    fireEvent.click(items[0]);
    expect(resetHistoryTo).toHaveBeenCalledWith(2);
  });

  it('toggles disabled state on eye button click', () => {
    const toggleDisabled = vi.fn();
    useHistory.mockReturnValue({ resetHistoryTo: vi.fn(), toggleDisabled });
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    const eyeButton = items[0].querySelector('button');
    fireEvent.click(eyeButton!);
    expect(toggleDisabled).toHaveBeenCalledWith('hist-3');
  });

  it('shows eye icon open for enabled items', () => {
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    const eyeIcons = items.map((item) => item.querySelector('[data-testid="eye-icon"]'));
    expect(eyeIcons[0]).toBeInTheDocument();
    expect(eyeIcons[0]).toHaveAttribute('data-open', 'true');
    expect(eyeIcons[1]).toBeInTheDocument();
    expect(eyeIcons[1]).toHaveAttribute('data-open', 'true');
    expect(eyeIcons[2]).toBeInTheDocument();
    expect(eyeIcons[2]).toHaveAttribute('data-open', 'true');
  });

  it('shows eye icon closed for disabled items', () => {
    const disabledHistory = [createMockHistoryItem({ id: 'hist-1', disabled: true })];
    useStore.mockReturnValue([{ ...mockStore, history: disabledHistory, historyIndex: 0 }, vi.fn()]);
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    const eyeIcon = items[0].querySelector('[data-testid="eye-icon"]');
    expect(eyeIcon).toBeInTheDocument();
    expect(eyeIcon).toHaveAttribute('data-open', 'false');
  });

  it('stops propagation on eye button click', () => {
    const resetHistoryTo = vi.fn();
    useHistory.mockReturnValue({ resetHistoryTo, toggleDisabled: vi.fn() });
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    const eyeButton = items[0].querySelector('button');
    fireEvent.click(eyeButton!);
    expect(resetHistoryTo).not.toHaveBeenCalled();
  });

  it('shows current state indicator', () => {
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    expect(items[1]).toHaveTextContent('👈');
  });

  it('applies correct styling classes', () => {
    render(<HistoryTab />);
    const container = screen.getByRole('list').parentElement!;
    expect(container).toHaveClass('flex');
    expect(container).toHaveClass('flex-col');
    expect(container).toHaveClass('gap-2');
    expect(container).toHaveClass('h-full');
  });

  it('applies correct list item classes for active item', () => {
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    expect(items[1]).toHaveClass('bg-white');
    expect(items[1]).toHaveClass('border-gray-200');
  });

  it('applies correct list item classes for inactive items', () => {
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveClass('bg-transparent');
    expect(items[2]).toHaveClass('bg-transparent');
  });

  it('handles single history item', () => {
    const singleHistory = [createMockHistoryItem({ id: 'hist-1' })];
    useStore.mockReturnValue([{ ...mockStore, history: singleHistory, historyIndex: 0 }, vi.fn()]);
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('Layer 1');
  });

  it('shows tooltip on list items', () => {
    render(<HistoryTab />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveAttribute('title', 'Click to go back to this state');
  });
});
