import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileLayersDrawer } from '../MobileLayersDrawer.tsx';
import { reorderLayers } from '../../../contexts/layer-utils.ts';
import { RENAME_LAYER_ACTION } from '../../../util/constants.ts';
import { claimDocumentGesture, isDocumentGestureOpen, resetDocumentGestures } from '../../../hooks/document-gesture.ts';

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
  documentFrame: { x: 120, y: 90, width: 800, height: 600 },
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

/**
 * Every `role="button"` between a control and the document. One of them is enough to make
 * the control presentational, so the list is the assertion: an empty one is the property.
 */
const fakeButtonAncestors = (control: HTMLElement) => {
  const found: HTMLElement[] = [];
  for (let el = control.parentElement; el !== null; el = el.parentElement) {
    if (el.getAttribute('role') === 'button') found.push(el);
  }
  return found;
};

// The gesture slot is module-level and outlives every mount, so a case that leaked
// a claim would refuse every later history interaction in this file, and one
// failure would read as a failure in all of them. Cleared on the way in AND on the
// way out, at FILE scope rather than inside a describe, because a hook registered
// in a describe only runs for that describe's own cases: scoped, the last case that
// claims would poison the next one. The gate suite below pins that the reset
// actually does it.
beforeEach(() => {
  resetDocumentGestures();
});

afterEach(() => {
  resetDocumentGestures();
});

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
    const pressed = within(layerList)
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-pressed') === 'true');
    // EXACTLY one, not "the first one found". A second pressed row announces the document as
    // having two active layers, and `find` would have reported the correct one while the defect
    // stood: the store here names a single `activeLayerId`, so two is never right.
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveAccessibleName('Upper');
  });

  it('keeps the row controls out of a fake button in BOTH tabs, because a button makes its descendants presentational', async () => {
    const user = userEvent.setup();
    storeStateMock.history = [
      { id: 'h0', actionName: 'new document', layerId: 'bottom' },
      { id: 'h1', actionName: 'rename', layerId: 'bottom' },
    ];
    storeStateMock.historyIndex = 1;

    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    // The old guard was `querySelectorAll('[role="button"]').filter((el) => el.querySelector('button'))`
    // over the default tab — and the default tab is LAYERS, which renders no
    // `role="button"` at all, so the filter was `[]` by construction and the history tab,
    // the one tab whose row WAS a fake button, was never rendered. The property is
    // per control instead: nothing above it may present itself as a button, or the control
    // is announced away.
    expect(fakeButtonAncestors(screen.getByRole('button', { name: 'Hide Lower' }))).toEqual([]);
    expect(fakeButtonAncestors(screen.getByRole('button', { name: 'Lower' }))).toEqual([]);

    await user.click(screen.getByRole('button', { name: /History \(2\)/ }));

    // The eye toggle is the control a `role="button"` row hid, and the title is the
    // keyboard-reachable rewind that replaced the row's own `role="button"` + `tabIndex`.
    expect(fakeButtonAncestors(screen.getAllByRole('button', { name: /history step/i })[0])).toEqual([]);
    const rewind = screen.getByRole('button', { name: 'new document' });
    expect(rewind.tagName).toBe('BUTTON');
    expect(rewind).not.toHaveAttribute('tabindex', '-1');
    expect(fakeButtonAncestors(rewind)).toEqual([]);
  });

  it('keeps the row controls from selecting the layer they sit in', async () => {
    const user = userEvent.setup();
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Hide Lower' }));
    expect(toggleVisibilityMock).toHaveBeenCalledWith('lower');

    await user.click(screen.getByRole('button', { name: 'Move Lower up' }));
    expect(setActiveLayerMock).not.toHaveBeenCalled();
  });

  it('creates an ordinary blank layer covering the document frame', async () => {
    const user = userEvent.setup();
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'New Layer' }));

    expect(createBlankLayerMock).toHaveBeenCalledWith({
      color: '#ffffff',
      opacity: 1,
      pos: { x: 120, y: 90, width: 800, height: 600 },
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

    // A row's only text is its title plus the `Current` badge — the eye toggle is named by
    // `aria-label`, not by content — so the title needs no stripping even though it is a
    // `<button>` now. The old strip-every-button clone read the title off the row and threw
    // the assertion away.
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent);

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
    // ONCE, not "at least once". The backdrop and the dialog both receive the same click by
    // bubbling, and a dialog-level close handler of its own would fire `onClose` a second time —
    // a double state update that surfaces as a drawer that flickers closed and re-renders its
    // opener's focus twice.
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/**
 * The keyboard gate (`useKeyboardEvents.tsx:134`) refuses document-mutating
 * shortcuts while a pointer gesture owns the document, and the Undo/Redo buttons
 * were closed off in the same change class afterwards (`HistoryControls.tsx`,
 * `MobileHeader.tsx`). The drawer's history tab is a third way into the same
 * `APPLY_HISTORY_REPLAY`, and all THREE of its entry points — a tap on a step,
 * Enter or Space on that step's own control, and the step's enable control —
 * reached it ungated.
 *
 * Inside a gesture's window the replay is destructive. `resetHistoryTo` replays
 * `selections` from the SAME `history` array, so `history.length` never moves and
 * the pending commit's `entries.slice(0, cursor + 1)` truncates the redo tail
 * with no other symptom; `toggleDisabled` loses the same tail and takes a
 * visibility flag with it.
 *
 * This drawer is the most exposed place in the app for it: a pointer mid-drag is
 * captured by the tool area, but nothing captures the hand that opens the drawer,
 * so a second finger tapping a history row while the first is still dragging is a
 * two-line repro rather than a theoretical race.
 *
 * The refusal belongs in these handlers, at the input layer: no dispatch, so
 * nothing appends, so nothing truncates. It deliberately does NOT come from a
 * `disabled` attribute either way — every case below claims the gesture AFTER
 * render, and `disabled` is read at render time, so a render-time read could not
 * see the claim at all, and a row disabled by a mid-gesture render would stay
 * disabled after the release. The "is still enabled" assertions are there so a
 * `disabled` solution cannot pass these cases.
 */
describe('MobileLayersDrawer document gesture gate', () => {
  const seedHistory = () => {
    storeStateMock.history = [
      { id: 'h0', actionName: 'new document', layerId: 'bottom' },
      { id: 'h1', actionName: 'rename', layerId: 'bottom' },
      { id: 'h2', actionName: 'reorder layers', layerId: 'bottom' },
    ];
    storeStateMock.historyIndex = 2;
  };

  const openHistoryTab = async () => {
    await userEvent.setup().click(screen.getByRole('button', { name: /History \(3\)/ }));
  };

  /**
   * The row div behind a given history step title: a plain `div`, the `li`'s own child,
   * since the row is no longer `role="button"` (it holds two real buttons, and a button's
   * descendants are presentational — see the tab-agnostic case in the suite above).
   */
  const historyRow = (title: string) => {
    const row = screen.getByText(title).closest('li')?.firstElementChild;
    if (!(row instanceof HTMLElement)) throw new Error(`no history row rendered for ${title}`);
    return row;
  };

  /**
   * The row's rewind control: the step title's own `<button>`, a sibling of the eye rather
   * than a child of a fake button. It is the row's keyboard path too, since Enter and Space
   * activate a native button themselves.
   */
  const rewindControl = (title: string) => screen.getByRole('button', { name: title });

  /** The row's own enable/disable control, which is a real `<button>` named by its label. */
  const eyeControl = (row: HTMLElement) => within(row).getByRole('button', { name: /history step/i });

  it('refuses to rewind from a history row while a document gesture is open, because the release-time commit would truncate the redo tail', async () => {
    seedHistory();
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);
    await openHistoryTab();

    // Claimed after render, which is the whole point: the slot raises no re-render,
    // so a `disabled` expression would not have seen this.
    claimDocumentGesture('shape-draw', 1);
    expect(isDocumentGestureOpen()).toBe(true);

    fireEvent.click(rewindControl('rename'));

    expect(resetHistoryToMock).not.toHaveBeenCalled();
  });

  it('refuses to rewind from a history row with Enter while a document gesture is open, because the keyboard path is the same dispatch', async () => {
    const user = userEvent.setup();
    seedHistory();
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);
    await openHistoryTab();

    claimDocumentGesture('freehand-lasso', 2);

    // Enter on a real button activates it natively, so the key path and the click path are
    // the same dispatch — and `fireEvent.keyDown` alone no longer reaches either, which is
    // why this drives the key the way a user does: focus the control, then press Enter.
    rewindControl('rename').focus();
    await user.keyboard('{Enter}');

    expect(resetHistoryToMock).not.toHaveBeenCalled();
  });

  it('refuses to toggle a history step enabled state while a document gesture is open, for the same reason', async () => {
    seedHistory();
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);
    await openHistoryTab();

    claimDocumentGesture('layer-transform', 3);
    fireEvent.click(eyeControl(historyRow('rename')));

    expect(toggleDisabledMock).not.toHaveBeenCalled();
    // `stopPropagation` runs before the gate, so a refused eye click stops here rather
    // than travelling on to rewind anything behind it.
    expect(resetHistoryToMock).not.toHaveBeenCalled();
  });

  it('leaves the rewind and enable controls enabled while a gesture is open, so the refusal is the handler and not an attribute', async () => {
    seedHistory();
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);
    await openHistoryTab();

    const row = historyRow('rename');
    claimDocumentGesture('eraser-stroke', 4);

    expect(eyeControl(row)).toBeEnabled();
    expect(rewindControl('rename')).toBeEnabled();
    expect(row).not.toHaveAttribute('disabled');
    expect(row).not.toHaveAttribute('aria-disabled');
  });

  it('rewinds with no gesture open, so the gate refuses only while a gesture owns the document', async () => {
    seedHistory();
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);
    await openHistoryTab();
    expect(isDocumentGestureOpen()).toBe(false);

    fireEvent.click(rewindControl('rename'));

    expect(resetHistoryToMock).toHaveBeenCalledTimes(1);
    expect(resetHistoryToMock).toHaveBeenCalledWith(1);
  });

  it('rewinds from Enter with no gesture open, so the gated key path still works', async () => {
    const user = userEvent.setup();
    seedHistory();
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);
    await openHistoryTab();
    expect(isDocumentGestureOpen()).toBe(false);

    rewindControl('rename').focus();
    await user.keyboard('{Enter}');

    expect(resetHistoryToMock).toHaveBeenCalledTimes(1);
    expect(resetHistoryToMock).toHaveBeenCalledWith(1);
  });

  it('rewinds from Space with no gesture open, because the title is a native button rather than a hand-rolled key handler', async () => {
    const user = userEvent.setup();
    seedHistory();
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);
    await openHistoryTab();

    rewindControl('rename').focus();
    await user.keyboard(' ');

    expect(resetHistoryToMock).toHaveBeenCalledTimes(1);
    expect(resetHistoryToMock).toHaveBeenCalledWith(1);
  });

  it('toggles with no gesture open, so the gate refuses only while a gesture owns the document', async () => {
    seedHistory();
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);
    await openHistoryTab();
    expect(isDocumentGestureOpen()).toBe(false);

    fireEvent.click(eyeControl(historyRow('rename')));

    expect(toggleDisabledMock).toHaveBeenCalledTimes(1);
    expect(toggleDisabledMock).toHaveBeenCalledWith('h1');
  });

  it('rewinds again once resetDocumentGestures drops the claim, so the gate is a window and not a latch', async () => {
    seedHistory();
    render(<MobileLayersDrawer isOpen={true} onClose={vi.fn()} />);
    await openHistoryTab();

    claimDocumentGesture('polygon-selection', 5);
    fireEvent.click(rewindControl('rename'));
    expect(resetHistoryToMock).not.toHaveBeenCalled();

    resetDocumentGestures();
    expect(isDocumentGestureOpen()).toBe(false);
    fireEvent.click(rewindControl('rename'));

    expect(resetHistoryToMock).toHaveBeenCalledTimes(1);
    expect(resetHistoryToMock).toHaveBeenCalledWith(1);
  });
});
