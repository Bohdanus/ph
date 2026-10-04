import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PanelGroup, { type PanelGroupProps } from '../PanelGroup.tsx';

/**
 * One panel group in the dock: a tab bar you drag by, and a body.
 *
 * Unlike the sibling `SidebarRight.test.tsx` this suite mocks nothing. `PanelGroup` reaches no
 * store and no editor hook — its only hook is `useDockDrag`, and that one is used REAL rather than
 * mocked, because everything the component promises is expressed in the payloads the drag reports
 * (`onDragStart`'s event, `onDrag`'s delta, `onDragEnd`'s `cancelled`) and in what the header row
 * looks like while the hook's gesture is live. A stub would only prove the stub was called.
 */

/** Distinct from the panel title, so "the children are still rendered" cannot pass on the title. */
const BODY_MARKER = 'layer body marker';

type Props = PanelGroupProps;

const setup = (overrides: Partial<Props> = {}) => {
  const callbacks = {
    onToggleRolledUp: vi.fn(),
    onDragStart: vi.fn(),
    onDrag: vi.fn(),
    onDragEnd: vi.fn(),
  };
  const props: Props = {
    id: 'layers',
    title: 'Layers',
    isRolledUp: false,
    isDragging: false,
    children: <p>{BODY_MARKER}</p>,
    ...callbacks,
    ...overrides,
  };
  const utils = render(<PanelGroup {...props} />);
  const at = (testid: string) => utils.container.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!;
  return {
    ...utils,
    ...callbacks,
    props,
    group: at(`panel-group-${props.id}`),
    row: at(`panel-header-row-${props.id}`),
    control: at(`panel-header-${props.id}`),
    /** The element `aria-controls` names, resolved the way an assistive technology would. */
    body: () => utils.container.querySelector<HTMLElement>(`#panel-body-${props.id}`),
    /** Applies a prop change from the parent, which is what a toggle callback does upstream. */
    rerenderGroup: (next: Partial<Props>) => utils.rerender(<PanelGroup {...props} {...next} />),
  };
};

/**
 * A pointer gesture through the real `useDockDrag`. Deltas are what the hook computes, so the
 * numbers below are measured from the press, exactly as the dock measures them.
 */
const gesture = (target: HTMLElement, at_: { clientX: number; clientY: number; pointerId?: number }) => {
  const pointerId = at_.pointerId ?? 1;
  fireEvent.pointerDown(target, { button: 0, buttons: 1, pointerId, clientX: at_.clientX, clientY: at_.clientY });
  return {
    moveTo: (clientX: number, clientY: number) => fireEvent.pointerMove(document, { pointerId, clientX, clientY }),
    release: () => fireEvent.pointerUp(document, { pointerId }),
    escape: () => {
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.pointerUp(document, { pointerId });
    },
  };
};

/**
 * Dispatches a real `KeyboardEvent` and reports whether the component suppressed its default.
 * `fireEvent`'s boolean return hides which handler called `preventDefault`; this names it.
 */
const press = (target: HTMLElement, type: 'keydown' | 'keyup', init: KeyboardEventInit) => {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
};

describe('PanelGroup', () => {
  describe('the header control', () => {
    it('is a button whose accessible name is the panel title, and nothing else', () => {
      const { control } = setup({ title: 'History' });

      const named = screen.getByRole('button', { name: 'History' });
      expect(named).toBe(control);
      // The name comes from the rendered text, not from the `title` tooltip below, which spells
      // out the whole gesture: a control announced as "History panel — drag this tab..." tells a
      // screen reader nothing about which panel it belongs to.
      expect(named.textContent).toBe('History');
      // The title is truncated, so it is the one text node in the control.
      expect(control.querySelector('span')).toHaveClass('truncate');
    });

    it('names the panel in its tooltip, and keeps the layer rows’ locator out of it', () => {
      const { control } = setup({ title: 'Layers' });

      const tooltip = control.getAttribute('title') ?? '';
      // The panel's own name is load-bearing: with several tabs stacked, the tooltip is what says
      // which one this is, and it is the only text in the header that can.
      expect(tooltip).toContain('Layers');
      // This header owns two gestures, so the tooltip has to teach both. Matched by intent rather
      // than by sentence: the wording is the component's to choose, the two instructions are the
      // requirement, and a frozen copy of the string would only fire on rewordings.
      expect(tooltip).toMatch(/drag/i);
      expect(tooltip).toMatch(/double-?click/i);
      expect(tooltip).toMatch(/roll|collapse/i);
      // "Drag to reorder" is the `title` on a LAYER row inside `LayersTab`, and it is a locator
      // five e2e specs and three unit tests use verbatim. `getByTitle` matches on substring, so a
      // panel tab repeating those words would capture every one of them. This is the half of the
      // claim above that the word matches cannot carry: a tooltip of "Drag to reorder" alone would
      // satisfy every regex above and be the bug.
      expect(tooltip).not.toContain('Drag to reorder');
    });

    it('derives the group, the row and the control from one id, and is focusable', () => {
      const { group, row, control } = setup({ id: 'history' });

      expect(group).toHaveAttribute('data-testid', 'panel-group-history');
      expect(row).toHaveAttribute('data-testid', 'panel-header-row-history');
      expect(control).toHaveAttribute('data-testid', 'panel-header-history');
      // One id, three places it must not drift: what the control controls, and what the testids
      // name. The row exists so a real button can sit beside the control without invalid ARIA.
      expect(control.getAttribute('aria-controls')).toBe('panel-body-history');
      expect(row.parentElement).toBe(group);
      expect(control.parentElement).toBe(row);
      // Keyboard reachability is the whole point of `role="button"`: this is a roll-up control
      // with no other activation affordance.
      expect(control).toHaveAttribute('tabindex', '0');
      control.focus();
      expect(document.activeElement).toBe(control);
    });
  });

  describe('the roll-up', () => {
    it('announces itself expanded and renders the body inside the group when not rolled up', () => {
      const { group, control, body } = setup();

      expect(control).toHaveAttribute('aria-expanded', 'true');
      const rendered = body();
      expect(rendered).not.toBeNull();
      // The body is its own scroll container, and the id `aria-controls` names goes ON it rather
      // than on a `display: contents` placeholder that holds nothing.
      expect(rendered).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');
      expect(rendered!.parentElement).toBe(group);
      expect(rendered!.textContent).toBe(BODY_MARKER);
      // The body's children are the panel's CONTENT, not a wrapper: they must sit in the
      // scroll box, and must not be dragged along by the tab.
      expect(rendered!.querySelector('p')).not.toBeNull();
      expect(control.contains(rendered!)).toBe(false);
      expect(control.textContent).toBe('Layers');
    });

    it('hides the body and its children when rolled up, leaving the tab bar', () => {
      const { control, body, rerenderGroup } = setup();
      expect(body()).not.toBeNull();

      rerenderGroup({ isRolledUp: true });

      expect(control).toHaveAttribute('aria-expanded', 'false');
      expect(body()).toBeNull();
      expect(screen.queryByText(BODY_MARKER)).toBeNull();
      // A roll-up leaves the tab bar, not an empty box: the title is meant to still be there.
      expect(screen.getByText('Layers')).toBeInTheDocument();
      // The target `aria-controls` names is gone while the attribute still names it — asserted
      // because that is what the component does, and a fix has to change this line, not this test.
      expect(control.getAttribute('aria-controls')).toBe('panel-body-layers');
      expect(document.getElementById('panel-body-layers')).toBeNull();
    });

    it('rolls up on a double-click, reports a zero-argument callback, and comes back', () => {
      const { control, onToggleRolledUp, body, rerenderGroup } = setup();

      // "To collapse a panel group so that only the dock header bar and tabs are visible,
      // double-click a panel tab or panel title bar. Double-click again to restore it."
      fireEvent.doubleClick(control);
      expect(onToggleRolledUp.mock.calls).toEqual([[]]);

      rerenderGroup({ isRolledUp: true });
      expect(body()).toBeNull();

      fireEvent.doubleClick(control);
      expect(onToggleRolledUp.mock.calls).toEqual([[], []]);
      expect(onToggleRolledUp).toHaveBeenCalledTimes(2);

      rerenderGroup({ isRolledUp: false });
      expect(body()!.textContent).toBe(BODY_MARKER);
    });

    it('does not roll up when the double-click ended a drag', () => {
      const { control, onToggleRolledUp, onDrag, onDragEnd } = setup();

      const drag = gesture(control, { clientX: 400, clientY: 100 });
      drag.moveTo(400, 110);
      drag.release();

      // The gesture really happened, so the missing toggle below is a decision and not a dead
      // handler: the delta reached the dock, and the release reported itself uncancelled.
      expect(onDrag.mock.calls).toEqual([[{ dx: 0, dy: 10 }]]);
      expect(onDragEnd.mock.calls).toEqual([[false]]);

      // The same header is both a drag handle and a control, so the release synthesises a
      // double-click. Rolling up here would throw away a reorder the user just completed.
      fireEvent.doubleClick(control);
      expect(onToggleRolledUp).not.toHaveBeenCalled();
    });

    it('still rolls up after a twitch of exactly the 3px movement threshold', () => {
      const { control, onToggleRolledUp } = setup();

      const drag = gesture(control, { clientX: 400, clientY: 100 });
      // `Math.abs(delta.dy) > 3` is false at 3, so this is a click, not a drag: "a 3px twitch is a
      // click". A threshold written `>=` would swallow every double-click a shaky hand makes.
      drag.moveTo(400, 103);
      drag.release();
      fireEvent.doubleClick(control);

      expect(onToggleRolledUp.mock.calls).toEqual([[]]);
    });

    it('counts an upward twitch past the threshold as a drag', () => {
      const { control, onToggleRolledUp, onDragEnd } = setup();

      const drag = gesture(control, { clientX: 400, clientY: 100 });
      // Absolute value, not a signed one: the pointer came from below, and a reorder is a
      // vertical gesture whichever way it started.
      drag.moveTo(400, 96);
      drag.release();
      expect(onDragEnd.mock.calls).toEqual([[false]]);

      fireEvent.doubleClick(control);
      expect(onToggleRolledUp).not.toHaveBeenCalled();

      // Positive control on the same control: the roll-up handler is reachable, so what refused
      // the double-click was the movement, not a missing listener.
      expect(press(control, 'keydown', { key: 'Enter' })).toBe(true);
      expect(onToggleRolledUp.mock.calls).toEqual([[]]);
    });

    it('keeps the suppression until the next drag starts', () => {
      const { control, onToggleRolledUp } = setup();

      const first = gesture(control, { clientX: 400, clientY: 100 });
      first.moveTo(400, 110);
      first.release();
      fireEvent.doubleClick(control);
      fireEvent.doubleClick(control);
      // The suppression is a ref cleared in the drag's `onStart`, so it outlives the gesture that
      // set it: a second double-click is refused for the same reason the first was.
      expect(onToggleRolledUp).not.toHaveBeenCalled();

      // A new press clears it, which is what makes the control usable again after a drag.
      gesture(control, { clientX: 400, clientY: 100 }).release();
      fireEvent.doubleClick(control);
      expect(onToggleRolledUp.mock.calls).toEqual([[]]);
    });
  });

  describe('keyboard activation', () => {
    it('toggles on Enter and suppresses its default', () => {
      const { control, onToggleRolledUp } = setup();

      // The ARIA button pattern: Enter activates on key-down.
      expect(press(control, 'keydown', { key: 'Enter' })).toBe(true);
      expect(onToggleRolledUp.mock.calls).toEqual([[]]);
      // Enter is not re-armed for key-up, so the release of the same key is inert.
      expect(press(control, 'keyup', { key: 'Enter' })).toBe(false);
      expect(onToggleRolledUp).toHaveBeenCalledTimes(1);
    });

    it('toggles on Space key-up rather than key-down, and suppresses both defaults', () => {
      const { control, onToggleRolledUp } = setup();

      // Activating on key-down fires while the key is still down, so a user who changes their
      // mind cannot take it back. The page also must not scroll under the press.
      expect(press(control, 'keydown', { key: ' ' })).toBe(true);
      expect(onToggleRolledUp).not.toHaveBeenCalled();

      expect(press(control, 'keyup', { key: ' ' })).toBe(true);
      expect(onToggleRolledUp.mock.calls).toEqual([[]]);
    });

    it('ignores a Space key-up that no Space key-down armed', () => {
      const { control, onToggleRolledUp } = setup();

      // The held flag is what separates "released Space" from "some other key went up": without
      // the key-down, this key-up is nothing to suppress and nothing to activate.
      expect(press(control, 'keyup', { key: ' ' })).toBe(false);
      expect(onToggleRolledUp).not.toHaveBeenCalled();
    });

    it('leaves an unrelated key to the browser', () => {
      const { control, onToggleRolledUp } = setup();

      // No third arm on this handler, and no blanket `preventDefault`: the roll-up control is the
      // header, and every other key on it has to reach whatever the page does with it.
      expect(press(control, 'keydown', { key: 'a' })).toBe(false);
      expect(press(control, 'keyup', { key: 'a' })).toBe(false);
      expect(onToggleRolledUp).not.toHaveBeenCalled();
    });
  });

  describe('the drag', () => {
    it('reports the press that started the gesture', () => {
      const { control, onDragStart, onDrag } = setup();

      gesture(control, { clientX: 512, clientY: 100, pointerId: 7 }).release();

      // The dock's only way to know which way the panel is being thrown is the press's
      // `clientX`, so this payload is load-bearing rather than a formality.
      expect(onDragStart).toHaveBeenCalledTimes(1);
      expect(onDragStart.mock.calls[0][0]).toMatchObject({
        type: 'pointerdown',
        pointerId: 7,
        clientX: 512,
        clientY: 100,
      });
      expect(onDrag).not.toHaveBeenCalled();
    });

    it('reports each move as a delta from where the gesture started', () => {
      const { control, onDrag } = setup();

      const drag = gesture(control, { clientX: 400, clientY: 100 });
      drag.moveTo(405, 110);
      drag.moveTo(390, 130);
      drag.release();

      // Deltas from the start, not from the previous move: a resize that accumulated would drift
      // by a rounding error per move, and "which slot is this over" needs an absolute frame.
      expect(onDrag).toHaveBeenCalledTimes(2);
      expect(onDrag).toHaveBeenNthCalledWith(1, { dx: 5, dy: 10 });
      expect(onDrag).toHaveBeenNthCalledWith(2, { dx: -10, dy: 30 });
    });

    it('reports a release as not cancelled and an Escape as cancelled', () => {
      const released = setup();
      gesture(released.control, { clientX: 400, clientY: 100 }).release();
      expect(released.onDragEnd.mock.calls).toEqual([[false]]);

      const cancelled = setup();
      gesture(cancelled.control, { clientX: 400, clientY: 100 }).escape();
      // The flag is the whole payload: the dock previews a reorder while it drags, so a gesture
      // the user called off must not commit it. Only `useDockDrag` can tell the two apart.
      expect(cancelled.onDragEnd.mock.calls).toEqual([[true]]);
    });

    it('ignores a press that is not a primary button', () => {
      const { control, onDragStart, onDragEnd } = setup();

      fireEvent.pointerDown(control, { button: 2, buttons: 2, pointerId: 1, clientX: 400, clientY: 100 });
      fireEvent.pointerMove(document, { pointerId: 1, clientX: 400, clientY: 200 });
      fireEvent.pointerUp(document, { pointerId: 1 });

      expect(onDragStart).not.toHaveBeenCalled();
      expect(onDragEnd).not.toHaveBeenCalled();

      // Positive control on the same handle: the wiring is live, so what refused the gesture was
      // the button, not a handler that never runs.
      gesture(control, { clientX: 400, clientY: 100 }).release();
      expect(onDragStart).toHaveBeenCalledTimes(1);
      expect(onDragStart.mock.calls[0][0]).toMatchObject({ button: 0, clientX: 400, clientY: 100 });
      expect(onDragEnd.mock.calls).toEqual([[false]]);
    });

    it('paints the header row while a drag of its own is in flight, and only then', () => {
      const { row, control, onDragEnd } = setup();

      // Idle: the drag tint is absent even though `isDragging` is false, and even though the row
      // carries the class list that would carry it.
      expect(row).not.toHaveClass('bg-blue-200', 'dark:bg-blue-700');

      const drag = gesture(control, { clientX: 400, clientY: 100 });
      // Driven by the hook's own gesture, not by the `isDragging` prop: the prop says the DOCK
      // considers this panel in flight, which is a different question from this header's pointer
      // being down.
      expect(row).toHaveClass('bg-blue-200');
      expect(row).toHaveClass('dark:bg-blue-700');

      drag.release();
      expect(onDragEnd.mock.calls).toEqual([[false]]);
      expect(row).not.toHaveClass('bg-blue-200', 'dark:bg-blue-700');
    });

    it('does not paint the row for a drag it only hears about through the prop', () => {
      const { row, onDragEnd } = setup({ isDragging: true });

      expect(onDragEnd).not.toHaveBeenCalled();
      expect(row).toHaveAttribute('data-dragging', 'true');
      // The prop is a flag the dock reads; it is not evidence that this header's gesture is live.
      expect(row).not.toHaveClass('bg-blue-200');
    });
  });

  describe('the header row', () => {
    it('marks itself as dragging only while the prop is true', () => {
      const { row, rerenderGroup } = setup({ isDragging: false });

      // Omitted rather than `data-dragging="false"`: a `false` string in the DOM reads as a
      // state, and `querySelector('[data-dragging]')` would then select both panels.
      expect(row).not.toHaveAttribute('data-dragging');

      rerenderGroup({ isDragging: true });
      expect(row.getAttribute('data-dragging')).toBe('true');
      // The control is the thing a test drags and double-clicks; the marker belongs to the row.
      expect(row.querySelector('[data-testid="panel-header-layers"]')).not.toHaveAttribute('data-dragging');
    });

    it('renders headerAction beside the control, never inside it', () => {
      const { row, control, onToggleRolledUp } = setup({
        headerAction: (
          <button type="button" aria-label="Collapse panels to icons">
            «
          </button>
        ),
      });

      const action = screen.getByRole('button', { name: 'Collapse panels to icons' });
      // "Beside, never inside" is a placement claim, and it is asserted as the parts the title
      // names: the action is a child of the row, it comes AFTER the control in document order, and
      // the control does not contain it. `compareDocumentPosition` is a direction test only — a
      // button nested in the control would satisfy it — so the direction and the non-containment
      // are separate assertions, and none of the three implies another. The `row.contains(action)`
      // this replaces could not fail: `action.parentElement` being the row already decides it.
      expect(control.contains(action)).toBe(false);
      expect(control.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // A real button nested inside `role="button"` is invalid ARIA and was not only invalid: the
      // control's own key handler saw the inner button's Enter and rolled the panel up instead.
      expect(action.parentElement).toBe(row);

      action.focus();
      expect(press(action, 'keydown', { key: 'Enter' })).toBe(false);
      expect(onToggleRolledUp).not.toHaveBeenCalled();
    });

    it('leaves the row holding only the control when no header action is given', () => {
      const { row, control } = setup();

      // One claim instead of two halves: the row's element children ARE the control, and nothing
      // else. `toHaveLength(1)` alone would pass on any lone child, and `firstElementChild` alone
      // would pass with a sibling after it, so neither carried the placement on its own.
      expect([...row.children]).toEqual([control]);
      expect(screen.queryByRole('button', { name: 'Collapse panels to icons' })).toBeNull();
      // The one button in the tree is the control itself.
      expect(screen.getAllByRole('button')).toHaveLength(1);
    });
  });

  describe('the group box', () => {
    it('applies the dock’s style to the group and keeps its own layout classes', () => {
      const { group, rerenderGroup } = setup({ style: { flex: '0.8 1 0%', minHeight: 88 } });

      // `flex-basis: 0` with a growing factor is what makes a ratio land on the percentage split
      // it replaces, at every column height — so the shorthand has to survive onto the element.
      expect(group.style.flex).toBe('0.8 1 0%');
      expect(group.style.minHeight).toBe('88px');
      expect(group).toHaveClass('flex', 'flex-col', 'overflow-hidden');

      // A rolled-up group takes its natural height instead, and that is the parent's decision.
      rerenderGroup({ style: { flex: '0 0 auto' } });
      expect(group.style.flex).toBe('0 0 auto');
      expect(group.style.minHeight).toBe('');
    });

    it('appends the dock’s className and contributes no class of its own by default', () => {
      const { group, rerenderGroup } = setup({ className: 'border-b border-gray-300' });

      expect(group.className.trim().split(/\s+/)).toEqual([
        'flex',
        'flex-col',
        'overflow-hidden',
        'border-b',
        'border-gray-300',
      ]);

      rerenderGroup({ className: '' });
      // The default is an empty string, not `undefined`: a literal "undefined" class is a real
      // token in the DOM and every class-list query sees it.
      expect(group.className.trim().split(/\s+/)).toEqual(['flex', 'flex-col', 'overflow-hidden']);
    });
  });
});
