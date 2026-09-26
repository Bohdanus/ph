import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LayersTab from '../LayersTab.tsx';
import type { Layer, LayersRecord } from '@/contexts/layer-types.ts';
import { createMockLayer } from '@/__tests__/fixtures/layer.ts';

vi.mock('../../Icons/EyeIcon.tsx', () => ({
  EyeIcon: ({ open }: { open: boolean }) => <span data-testid="eye-icon" data-open={open} />,
}));

vi.mock('../../Icons/TrashIcon.tsx', () => ({
  TrashIcon: () => <span data-testid="trash-icon" />,
}));

vi.mock('../../Icons/DragHandleIcon.tsx', () => ({
  DragHandleIcon: () => <span data-testid="drag-handle" draggable="true" />,
}));

const mockLayers: LayersRecord = {
  'layer-1': createMockLayer({ id: 'layer-1', name: 'Background', order: 0, isBedrock: true }),
  'layer-2': createMockLayer({ id: 'layer-2', name: 'Layer 2', order: 1 }),
  'layer-3': createMockLayer({ id: 'layer-3', name: 'Top Layer', order: 2 }),
};

const mockStore = {
  layers: mockLayers,
  activeLayerId: 'layer-2',
};

const { useStore, useLayers, layerMocks } = vi.hoisted(() => {
  const mocks = {
    toggleVisibility: vi.fn(),
    removeLayer: vi.fn(),
    moveLayerAfter: vi.fn(),
    setActiveLayer: vi.fn(),
    updateLayer: vi.fn(),
  };
  return { useStore: vi.fn(), useLayers: vi.fn(() => mocks), layerMocks: mocks };
});

vi.mock('@/contexts/StoreContext.tsx', () => ({
  useStore,
}));

vi.mock('@/contexts/useLayer.ts', () => ({
  useLayers,
}));

vi.mock('@/contexts/layer-utils.ts', () => ({
  getSortedLayersArray: (layers: LayersRecord) => Object.values(layers).sort((a: Layer, b: Layer) => a.order - b.order),
}));

function getLayerDivs() {
  const items = screen.getAllByRole('listitem');
  return items.map((item) => item.querySelector('div[title="Drag to reorder"]')!);
}

describe('LayersTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useStore.mockReturnValue([mockStore, vi.fn()]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders "No layers yet" when layers is empty', () => {
    useStore.mockReturnValue([{ ...mockStore, layers: {} }, vi.fn()]);
    render(<LayersTab />);
    expect(screen.getByText('No layers yet.')).toBeInTheDocument();
  });

  it('renders all layers in reverse order (top first)', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    expect(layerDivs).toHaveLength(3);
    expect(layerDivs[0]).toHaveTextContent('Top Layer');
    expect(layerDivs[1]).toHaveTextContent('Layer 2');
    expect(layerDivs[2]).toHaveTextContent('Background');
  });

  it('highlights active layer', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    expect(layerDivs[1]).toHaveClass('bg-white');
  });

  it('shows eye icon open for visible layers', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    const eyeIcons = layerDivs.map((div) => div.querySelector('[data-testid="eye-icon"]'));
    expect(eyeIcons[0]).toBeInTheDocument();
    expect(eyeIcons[0]).toHaveAttribute('data-open', 'true');
    expect(eyeIcons[1]).toBeInTheDocument();
    expect(eyeIcons[1]).toHaveAttribute('data-open', 'true');
    expect(eyeIcons[2]).toBeInTheDocument();
    expect(eyeIcons[2]).toHaveAttribute('data-open', 'true');
  });

  it('shows eye icon closed for hidden layers', () => {
    const hiddenLayers = {
      ...mockLayers,
      'layer-2': createMockLayer({ id: 'layer-2', name: 'Layer 2', visible: false }),
    };
    useStore.mockReturnValue([{ ...mockStore, layers: hiddenLayers }, vi.fn()]);
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    const eyeIcon = layerDivs[1].querySelector('[data-testid="eye-icon"]');
    expect(eyeIcon).toBeInTheDocument();
    expect(eyeIcon).toHaveAttribute('data-open', 'false');
  });

  it('toggles visibility on eye button click', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    const eyeButton = layerDivs[0].querySelector('button');
    act(() => {
      fireEvent.click(eyeButton!);
    });
    expect(layerMocks.toggleVisibility).toHaveBeenCalledTimes(1);
    expect(layerMocks.toggleVisibility).toHaveBeenCalledWith('layer-3');
  });

  it('calls setActiveLayer on layer click', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    act(() => {
      fireEvent.click(layerDivs[0]);
    });
    expect(layerMocks.setActiveLayer).toHaveBeenCalledTimes(1);
    expect(layerMocks.setActiveLayer).toHaveBeenCalledWith('layer-3');
  });

  it('removes layer on trash click', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    const trashButton = layerDivs[0].querySelector('button[aria-label="Remove layer"]');
    act(() => {
      fireEvent.click(trashButton!);
    });
    expect(layerMocks.removeLayer).toHaveBeenCalledTimes(1);
    expect(layerMocks.removeLayer).toHaveBeenCalledWith('layer-3');
  });

  it('stops propagation on trash click', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    const trashButton = layerDivs[0].querySelector('button[aria-label="Remove layer"]');
    act(() => {
      fireEvent.click(trashButton!);
    });
    expect(layerMocks.removeLayer).toHaveBeenCalledWith('layer-3');
    expect(layerMocks.setActiveLayer).not.toHaveBeenCalled();
  });

  it('stops propagation on eye button click', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    const eyeButton = layerDivs[0].querySelector('button');
    act(() => {
      fireEvent.click(eyeButton!);
    });
    expect(layerMocks.toggleVisibility).toHaveBeenCalledWith('layer-3');
    expect(layerMocks.setActiveLayer).not.toHaveBeenCalled();
  });

  it('shows layer name in span', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    const nameSpan = layerDivs[0].querySelector('span.truncate');
    expect(nameSpan).toBeInTheDocument();
    expect(nameSpan).toHaveTextContent('Top Layer');
  });

  it('applies correct container classes', () => {
    render(<LayersTab />);
    const list = screen.getByRole('list');
    const container = list.parentElement!;
    expect(container.classList.contains('flex')).toBe(true);
    expect(container.classList.contains('flex-col')).toBe(true);
    expect(container.classList.contains('gap-2')).toBe(true);
    expect(container.classList.contains('h-full')).toBe(true);
  });

  it('keeps remove control available for a bedrock layer', () => {
    useStore.mockReturnValue([
      { ...mockStore, layers: { bedrock: createMockLayer({ id: 'bedrock', name: 'Background', isBedrock: true }) } },
      vi.fn(),
    ]);
    render(<LayersTab />);
    const [bedrockRow] = getLayerDivs();
    expect(bedrockRow).toHaveTextContent('Background');
    expect(bedrockRow.querySelector('button[aria-label="Remove layer"]')).toBeInTheDocument();
  });

  it('shows drag handle icon', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    const dragHandles = layerDivs.map((div) => div.querySelector('[data-testid="drag-handle"]'));
    expect(dragHandles[0]).toBeInTheDocument();
    expect(dragHandles[1]).toBeInTheDocument();
    expect(dragHandles[2]).toBeInTheDocument();
  });

  it('shows trash icon for each layer', () => {
    render(<LayersTab />);
    const layerDivs = getLayerDivs();
    const trashButtons = layerDivs.map((div) => div.querySelector('button[aria-label="Remove layer"]'));
    expect(trashButtons[0]).toBeInTheDocument();
    expect(trashButtons[1]).toBeInTheDocument();
    expect(trashButtons[2]).toBeInTheDocument();
  });
});
