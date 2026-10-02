import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { UnsavedChangesProvider, useUnsavedChanges } from '../UnsavedChangesContext.tsx';
import type { ToolArgs } from '../tool-types.ts';
import type { TextToolArgs } from '../../tools/text.ts';

const storeState = vi.hoisted(() => ({
  hasImage: true,
  hasUnsavedChanges: false,
  currentArgs: { current: { toolName: 'draw' } as ToolArgs },
  previewLayers: { current: {} as Record<string, unknown> },
}));

vi.mock('../StoreContext.tsx', () => ({ useStore: () => [storeState, vi.fn()] }));

type Api = ReturnType<typeof useUnsavedChanges>;

const PENDING_TEXT = {
  toolName: 'text',
  text: 'typed',
  rect: { x: 0, y: 0, width: 10, height: 10 },
} as unknown as TextToolArgs;

/**
 * The provider renders its dialog as a sibling of `children`, so the consumer is rendered
 * as its own child and every assertion below is about what the app would see.
 */
const Probe = ({ onReady }: { onReady: (api: Api) => void }) => {
  onReady(useUnsavedChanges());
  return null;
};

/**
 * Dirtiness is configured BEFORE the mount, and that ordering is the contract rather than
 * an accident of the harness. `hasImage` and `hasUnsavedChanges` reach the predicate as
 * ordinary render values, because the store cannot change without re-rendering its own
 * consumer — so writing them after `render()` would be writing to a mock the provider has
 * already stopped reading, and the test would silently exercise the clean branch. The two
 * refs, `currentArgs` and `previewLayers`, are the opposite: they are read at call time and
 * stay live for the provider's lifetime, which is what lets the in-flight-preview cases
 * below mutate them after the mount on purpose.
 */
const tree = (onReady: (api: Api) => void) =>
  createElement(UnsavedChangesProvider, null, createElement(Probe, { onReady }) as ReactNode);

const mount = (setup?: () => void): Api => {
  reset(setup);
  let api!: Api;
  render(tree((value) => (api = value)));
  return api;
};

const reset = (setup?: () => void) => {
  storeState.hasImage = true;
  storeState.hasUnsavedChanges = false;
  storeState.currentArgs.current = { toolName: 'draw' } as ToolArgs;
  storeState.previewLayers.current = {};
  setup?.();
};

const dirty = () => {
  storeState.hasUnsavedChanges = true;
};

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * jsdom has no navigation, so `beforeunload` is dispatched by hand and what the handler
 * did is read off the event — which is the whole contract: the browser decides what to
 * show, and the only thing this app controls is whether it asked.
 */
const fireBeforeUnload = () => {
  const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(event);
  return event;
};

describe('UnsavedChangesProvider: confirmDiscard', () => {
  it('resolves true without rendering anything when there is nothing to discard', async () => {
    const api = mount();
    await expect(api.confirmDiscard('new-document')).resolves.toBe(true);
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it.each([
    ['new-document', 'Discard unsaved changes and start a new image?'],
    ['open-document', 'Discard unsaved changes and open another file?'],
  ] as const)('asks %s with the copy the old native prompt used', async (reason, message) => {
    const api = mount(dirty);
    const pending = api.confirmDiscard(reason);

    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog).toHaveAccessibleDescription(message);
    expect(screen.getByTestId('confirm-dialog-message')).toHaveTextContent(message);

    fireEvent.click(screen.getByTestId('confirm-dialog-confirm-button'));
    await expect(pending).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument());
  });

  it.each([
    ['the cancel button', 'confirm-dialog-cancel-button'],
    ['the close button', 'confirm-dialog-close-button'],
  ] as const)('resolves false when the user answers through %s', async (_name, testid) => {
    const api = mount(dirty);
    const pending = api.confirmDiscard('new-document');
    await screen.findByTestId('confirm-dialog');

    fireEvent.click(screen.getByTestId(testid));
    await expect(pending).resolves.toBe(false);
  });

  it('resolves false when the user clicks the backdrop', async () => {
    const api = mount(dirty);
    const pending = api.confirmDiscard('new-document');
    await screen.findByTestId('confirm-dialog');

    // The backdrop is the sibling that fills the viewport, so it is clicked by its own
    // backdrop — the `role="dialog"` wrapper's first child.
    fireEvent.click(screen.getByTestId('confirm-dialog').firstElementChild as Element);
    await expect(pending).resolves.toBe(false);
  });

  it('resolves false on Escape', async () => {
    const api = mount(dirty);
    const pending = api.confirmDiscard('open-document');
    const dialog = await screen.findByTestId('confirm-dialog');

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await expect(pending).resolves.toBe(false);
  });

  it('answers exactly once, however many times the dialog is dismissed', async () => {
    const api = mount(dirty);
    let answers = 0;
    void api.confirmDiscard('new-document').then(() => {
      answers += 1;
    });
    const dialog = await screen.findByTestId('confirm-dialog');
    // Captured before the first dismissal, because the point is that clicking a control
    // the dialog no longer owns changes nothing.
    const cancel = screen.getByTestId('confirm-dialog-cancel-button');
    const close = screen.getByTestId('confirm-dialog-close-button');

    fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument());
    fireEvent.click(cancel);
    fireEvent.click(close);
    fireEvent.click(dialog);

    await act(async () => {});
    expect(answers).toBe(1);
  });

  it('prompts for a live tool preview, which stores no state to re-render on', async () => {
    // The term a captured-at-render predicate cannot see: `previewLayers` is a ref, and a
    // tool mid-drag writes it without dispatching anything at all.
    const api = mount();
    storeState.previewLayers.current = { 'layer-1': { layer: {} } };
    expect(api.isDocumentDirty()).toBe(true);

    const pending = api.confirmDiscard('new-document');
    await screen.findByTestId('confirm-dialog');
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm-button'));
    await expect(pending).resolves.toBe(true);
  });

  it('prompts for a typed but unplaced text box, which has not been committed', async () => {
    const api = mount(() => {
      storeState.currentArgs.current = PENDING_TEXT as unknown as ToolArgs;
    });
    const pending = api.confirmDiscard('new-document');
    await screen.findByTestId('confirm-dialog');
    fireEvent.click(screen.getByTestId('confirm-dialog-cancel-button'));
    await expect(pending).resolves.toBe(false);
  });

  it('reports the same verdict through isDocumentDirty that it acts on', async () => {
    expect(mount().isDocumentDirty()).toBe(false);
    expect(mount(dirty).isDocumentDirty()).toBe(true);
    expect(
      mount(() => {
        storeState.currentArgs.current = PENDING_TEXT as unknown as ToolArgs;
      }).isDocumentDirty()
    ).toBe(true);
  });
});

describe('UnsavedChangesProvider: unload guard', () => {
  it('asks the browser to prompt when the document has unsaved changes', () => {
    mount(dirty);
    expect(fireBeforeUnload().defaultPrevented).toBe(true);
  });

  it('stays silent when the document has nothing to lose', () => {
    mount();
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });

  it('stays silent when there is no document at all', () => {
    mount(() => {
      storeState.hasImage = false;
      storeState.hasUnsavedChanges = true;
    });
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });

  it('prompts for a live tool preview even though nothing re-rendered', () => {
    const api = mount();
    storeState.previewLayers.current = { 'layer-1': { layer: {} } };
    expect(api.isDocumentDirty()).toBe(true);
    expect(fireBeforeUnload().defaultPrevented).toBe(true);
  });

  it('stops prompting once the document is exported clean', () => {
    reset(dirty);
    const { rerender } = render(tree(() => {}));
    expect(fireBeforeUnload().defaultPrevented).toBe(true);

    // The export's `BATCH_UPDATES` re-renders every store consumer, and that re-render is
    // what carries the clean document into the predicate — so the test drives one rather
    // than writing the mock behind the provider's back.
    storeState.hasUnsavedChanges = false;
    rerender(tree(() => {}));
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });

  it('detaches on unmount, so a torn-down provider cannot hold a prompt open', () => {
    const { unmount } = render(tree(() => {}));
    unmount();
    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });
});
