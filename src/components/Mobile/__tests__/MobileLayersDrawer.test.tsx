import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileLayersDrawer } from '../MobileLayersDrawer.tsx';
import { reorderLayers } from '../../../contexts/layer-utils.ts';
import { RENAME_LAYER_ACTION } from '../../../util/constants.ts';

const createBlankLayerMock = vi.hoisted(() => vi.fn());
const removeLayerMock = vi.hoisted(() => vi.fn());
const toggleVisibilityMock = vi.hoisted(() => vi.fn());
const setActiveLayerMock = vi.hoisted(() => vi.fn());
const updateLayerMock = vi.hoisted(() => vi.fn());
const moveLayerAfterMock = vi.hoisted(() => vi.fn());
const resetHistoryToMock = vi.hoisted(() => vi.fn());
const toggleDisabledMock = vi.hoisted(() => vi.fn());
const dispatchMock = vi.hoisted(() => vi.fn());

/**
 * Four layers with DISTINCT `order` values. The old fixture omitted `order`
 * entirely, so `getSortedLayersArray` sorted an array of four `undefined`s — a
 * no-op that made every reorder assertion pass while the anchors were wrong.
 * `Bottom 0 < Lower 1 < Upper 2 < Top 3` is also the ascending order the drawer
 * reverses, so index 0 of the rendered list is the top layer.
 */
const storeStateMock = vi.hoisted(() => ({
  layers: {} as Record<string, Record<string, unknown>>,
  activeLayerId: 'upper' as string | null,
  history: [] as Array<Record<string, unknown>>,
  historyIndex: 0,
  totalSize: { width: 800, height: 600 },
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeStateMock, dispatchMock],
}));

vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    createBlankLayer: createBlankLayerMock,
    removeLayer: removeLayerMock,
    toggleVisibility: toggleVisibilityMock,
    setActiveLayer: setActiveLayerMock,
    updateLayer: updateLayerMock,
    moveLayerAfter: moveLayerAfterMock,
  }),
}));

// `getHistoryItemTitle` is spread through from the real module. The old test
// replaced it with `(item) => item.actionName`, which is an identity function
// that hid the defect fix 2 is about: a `TOOL_ACTION` entry carries no
// `toolName` in its args, so the real function returns `undefined` and the entry
// is untitled.
vi.mock('../../../contexts/useHistory.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../contexts/useHistory.ts')>();
  return {
    ...actual,
    useHistory: () => ({
      resetHistoryTo: resetHistoryToMock,
      toggleDisabled: toggleDisabledMock,
      canUndo: () => true,
      canRedo: () => false,
      undo: vi.fn(),
      redo: vi.fn(),
    }),
  };
});

const makeLayer = (id: string, name: string, order: number) => ({
  id,
  name,
  order,
  visible: true,
  opacity: 1,
  locked: false,
  blendMode: 'source-over',
  isBedrock: order === 0,
  pos: { x: 0, y: 0, width: 800, height: 600 },
  operations: [],
  bitmap: null,
  tmpCanvas: null,
});

const freshLayers = () => ({
  bottom: makeLayer('bottom', 'Bottom', 0),
  lower: makeLayer('lower', 'Lower', 1),
  upper: makeLayer('upper', 'Upper', 2),
  top: makeLayer('top', 'Top', 3),
});

/**
 * The layer names in render order, which is top-of-stack first. Each row also
 * carries its visibility / rename / reorder controls, so a clone has those
 * removed before the row's own text is read.
 */
/**
 * Each row's name, in display order (top of the stack first).
 *
 * The name is the row's own selection control — a `<button aria-pressed>` — because the row
 * contains four action buttons and cannot itself be a button without making them
 * presentational. So the name is read from that control rather than from the row's leftover
 * text, which is the name button's content too.
 */
const renderedLayerNames = () =>
  screen
    .getAllByRole('listitem')
    .map((row) => row.querySelector<HTMLElement>('button[aria-pressed]')?.textContent ?? '');

/** The row div for a named layer: the `li`'s own child. */
const layerRow = (name: string) => {
  const item = screen.getByRole('button', { name }).closest('li');
  if (!item) throw new Error(`no layer row rendered for ${name}`);
  return item.firstElementChild as HTMLElement;
};

describe('MobileLayersDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeStateMock.layers = freshLayers();
    storeStateMock.activeLayerId = 'upper';
    storeStateMock.history = [];
    storeStateMock.historyIndex = 0;

    // Run the REAL reorder so the assertions describe the order a user ends up
    // looking at, not just the arguments the component passed. `reorderLayers`
    // mutates the record, so the mock mutates the store the component reads.
    moveLayerAfterMock.mockImplementation((layerToMoveId: string, afterWhichLayerId?: string | null) => {
      reorderLayers({ layers: storeStateMock.layers as never, layerToMoveId, afterWhichLayerId });
      // `reorderLayers` mutates in place and the component memoises on the record's
      // identity, so hand back a new record — the same thing a reducer publication
      // does for the real store.
      storeStateMock.layers = { ...storeStateMock.layers };
    });
  });

  it('renders the stack top-first and counts the layers', () => {
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Layers & History Drawer' })).toBeInTheDocument();
    expect(screen.getByText('Layers (4)')).toBeInTheDocument();
    expect(renderedLayerNames()).toEqual(['Top', 'Upper', 'Lower', 'Bottom']);
  });

  it('moves a layer up exactly one position', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Move Upper up' }));
    rerender(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    // The old anchor was `sortedLayers[index - 2]`, which is `undefined` for the
    // second row — and `moveLayerAfter(id, undefined)` means "move to the very
    // bottom", so this layer was buried under the whole stack.
    expect(renderedLayerNames()).toEqual(['Upper', 'Top', 'Lower', 'Bottom']);
  });

  it('moves a layer down exactly one position', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Move Upper down' }));
    rerender(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    // The old anchor was `sortedLayers[index + 1]`, which put `Upper` straight
    // back where it started: `moveLayerAfter` places the moved layer ABOVE its
    // target, so the neighbour had to be the row two places down.
    expect(renderedLayerNames()).toEqual(['Top', 'Lower', 'Upper', 'Bottom']);
  });

  it('disables "move up" on the topmost row only', () => {
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Move Top up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Upper up' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move Lower up' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move Bottom up' })).toBeEnabled();
  });

  it('disables "move down" on the last two rows, not just the last', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    // The last two rows have no row two places below them, and an undefined
    // target would send them to the bottom of the stack instead.
    expect(screen.getByRole('button', { name: 'Move Lower down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Bottom down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Top down' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move Upper down' })).toBeEnabled();

    // Guard against the guard itself regressing to a single row.
    await user.click(screen.getByRole('button', { name: 'Move Bottom down' }));
    rerender(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);
    expect(moveLayerAfterMock).not.toHaveBeenCalled();
    expect(renderedLayerNames()).toEqual(['Top', 'Upper', 'Lower', 'Bottom']);
  });

  it('reorders a four-deep stack in both directions without losing a layer', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);
    const redraw = () => rerender(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    // The topmost row cannot move up, so this click is a no-op by design.
    expect(screen.getByRole('button', { name: 'Move Top up' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move Top up' }));
    redraw();
    expect(renderedLayerNames()).toEqual(['Top', 'Upper', 'Lower', 'Bottom']);

    await user.click(screen.getByRole('button', { name: 'Move Top down' }));
    redraw();
    expect(renderedLayerNames()).toEqual(['Upper', 'Top', 'Lower', 'Bottom']);

    await user.click(screen.getByRole('button', { name: 'Move Top down' }));
    redraw();
    expect(renderedLayerNames()).toEqual(['Upper', 'Lower', 'Top', 'Bottom']);

    await user.click(screen.getByRole('button', { name: 'Move Top up' }));
    redraw();
    expect(renderedLayerNames()).toEqual(['Upper', 'Top', 'Lower', 'Bottom']);
  });

  it('offers an explicit rename control rather than a double-click gesture', async () => {
    const user = userEvent.setup();
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Rename Upper' }));

    const input = screen.getByRole('textbox', { name: 'Layer name for Upper' });
    await user.clear(input);
    await user.type(input, 'Highlights{Enter}');

    expect(updateLayerMock).toHaveBeenCalledWith('upper', { name: 'Highlights' }, RENAME_LAYER_ACTION);
  });

  it('does not write a history entry when a rename is cancelled', async () => {
    const user = userEvent.setup();
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Rename Upper' }));
    await user.clear(screen.getByRole('textbox', { name: 'Layer name for Upper' }));
    await user.keyboard('{Escape}');

    expect(updateLayerMock).not.toHaveBeenCalled();
  });

  it('has no layer-opacity control, because the old one produced untitled unreplayable history entries', () => {
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByText(/opacity/i)).toBeNull();
  });

  it('selects a layer by clicking the row, for pointer users', () => {
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    // The row is a plain div with a click handler and no role. It is a pointer
    // affordance, not a control: making it `role="button"` would make the four action
    // buttons inside it presentational and unreachable.
    const row = layerRow('Lower');
    expect(row).not.toHaveAttribute('role');
    expect(row).not.toHaveAttribute('tabindex');

    fireEvent.click(row);
    expect(setActiveLayerMock).toHaveBeenLastCalledWith('lower');
  });

  it('selects a layer from the keyboard through the name control', async () => {
    const user = userEvent.setup();
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    // A real, focusable button, so Enter and Space activate it natively and need no key
    // handling of their own. Focused directly rather than by tabbing, because the drawer
    // moves focus to the panel on open and the tab order around four action buttons per row
    // is not what this test is about.
    const nameControl = screen.getByRole('button', { name: 'Lower' });
    expect(nameControl.tagName).toBe('BUTTON');
    expect(nameControl).not.toHaveAttribute('tabindex', '-1');
    expect((nameControl as HTMLButtonElement).disabled).toBe(false);

    nameControl.focus();
    expect(document.activeElement).toBe(nameControl);

    await user.keyboard('{Enter}');
    expect(setActiveLayerMock).toHaveBeenLastCalledWith('lower');

    setActiveLayerMock.mockClear();
    await user.keyboard(' ');
    expect(setActiveLayerMock).toHaveBeenLastCalledWith('lower');
  });

  it('reports the active layer as the pressed state of its name control', () => {
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    // The state the row's removed `role="button"` used to carry now lives on a control
    // that assistive technology is not told to ignore.
    // Scoped to the layer list: the drawer also has pressed tab buttons, which are a
    // different control entirely.
    const layerList = screen.getByRole('list', { name: 'Layers' });
    const activeName = within(layerList)
      .getAllByRole('button')
      .find((b) => b.getAttribute('aria-pressed') === 'true');
    expect(activeName).toBeDefined();
    expect(activeName).toHaveAccessibleName(/Upper/i);
  });

  it('keeps the layer name control a sibling of the row actions, not nested in a fake button', () => {
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    // No element with role="button" may contain another button: a button's descendants are
    // presentational, so rename/reorder/visibility would be announced away.
    const nested = Array.from(document.querySelectorAll('[role="button"]')).filter((el) => el.querySelector('button'));
    expect(nested).toEqual([]);
  });

  it('keeps the row controls from selecting the layer they sit in', async () => {
    const user = userEvent.setup();
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Hide Lower' }));
    expect(toggleVisibilityMock).toHaveBeenCalledWith('lower');

    await user.click(screen.getByRole('button', { name: 'Move Lower up' }));
    expect(setActiveLayerMock).not.toHaveBeenCalled();
  });

  it('creates a blank layer at the document size', async () => {
    const user = userEvent.setup();
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'New Layer' }));

    expect(createBlankLayerMock).toHaveBeenCalledWith({
      color: '#ffffff',
      opacity: 1,
      size: { width: 800, height: 600 },
      isBedrock: true,
    });
  });

  it('removes the active layer only when there is more than one', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Delete active layer' }));
    expect(removeLayerMock).toHaveBeenCalledWith('upper');

    storeStateMock.layers = { bottom: makeLayer('bottom', 'Bottom', 0) };
    rerender(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Delete active layer' })).toBeNull();
  });

  it('titles history steps with the real getHistoryItemTitle, not an identity function', async () => {
    const user = userEvent.setup();
    storeStateMock.history = [
      { id: 'h0', actionName: 'new document', layerId: 'bottom' },
      // A `TOOL_ACTION` entry whose args are a patch rather than tool args: the real
      // title function returns `undefined` for it, which is exactly the corruption
      // the layer-opacity slider used to write.
      { id: 'h1', actionName: 'tool', layerId: 'bottom', args: { opacity: 0.5 } },
    ];
    storeStateMock.historyIndex = 1;

    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /History \(2\)/ }));

    const rows = screen.getAllByRole('listitem').map((row) => {
      const clone = row.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('button').forEach((button) => button.remove());
      return clone.textContent;
    });

    // Rendered newest first, so the `TOOL_ACTION` patch entry is row 0. The real
    // `getHistoryItemTitle` reads `args.toolName` for a `TOOL_ACTION` entry and
    // finds nothing on a patch, so the row has no title at all — which is the
    // corruption the removed layer-opacity slider used to write on every drag step.
    // The old test's identity stub printed the action name here and hid all of it.
    expect(rows[0]).toBe('Current');
    expect(rows[1]).toBe('new document');
  });

  it('titles a tool-sourced history step from its tool name', async () => {
    const user = userEvent.setup();
    storeStateMock.history = [
      { id: 'h0', actionName: 'new document', layerId: 'bottom' },
      {
        id: 'h1',
        actionName: 'tool',
        layerId: 'bottom',
        layerSource: { kind: 'tool', args: { toolName: 'color' }, pos: { x: 0, y: 0, width: 8, height: 8 } },
      },
    ];
    storeStateMock.historyIndex = 1;

    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /History \(2\)/ }));

    expect(screen.getByText('color')).toBeInTheDocument();
  });

  it('rewinds the timeline from a history row', async () => {
    const user = userEvent.setup();
    storeStateMock.history = [
      { id: 'h0', actionName: 'new document', layerId: 'bottom' },
      { id: 'h1', actionName: 'rename', layerId: 'bottom' },
      { id: 'h2', actionName: 'reorder layers', layerId: 'bottom' },
    ];
    storeStateMock.historyIndex = 2;

    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /History \(3\)/ }));
    await user.click(screen.getByRole('button', { name: /rename/ }));

    expect(resetHistoryToMock).toHaveBeenCalledWith(1);
  });

  it('renders nothing while closed, which is what keeps it out of the tab order', () => {
    const { container } = render(<MobileLayersDrawer isOpen={false} onClose={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('declares the modal and gives the panel a focus target', () => {
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    const panel = document.getElementById('mobile-layers-panel')!;
    expect(panel).toHaveAttribute('tabindex', '-1');
  });

  it('keeps every native control at least 44px on both axes', () => {
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    const controls = screen.getAllByRole('button').filter((control) => control.tagName === 'BUTTON');
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(control.className).toMatch(/min-h-11/);
      // The layer-name control is the one flexible member of a row: it is `flex-1` and
      // fills the width the four fixed controls leave it, so a `min-w-11` floor is not what
      // makes it 44px wide. It still needs the height floor like every other control.
      if (control.className.includes('flex-1')) continue;
      expect(control.className).toMatch(/min-w-11/);
    }
  });

  it('gives the flexible layer-name control a height floor and the full remaining width', () => {
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    const nameControl = screen.getByRole('button', { name: 'Lower' });
    expect(nameControl.className).toMatch(/min-h-11/);
    expect(nameControl.className).toMatch(/flex-1/);
  });

  it('closes from the backdrop', () => {
    const onClose = vi.fn();
    render(<MobileLayersDrawer isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByRole('dialog').firstElementChild!);
    expect(onClose).toHaveBeenCalled();
  });
});
