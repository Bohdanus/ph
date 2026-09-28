import type { MouseEvent } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { getHistoryItemTitle, useHistory } from '../../contexts/useHistory.ts';
import { isDocumentGestureOpen } from '../../hooks/document-gesture.ts';
import { ICON_TOGGLE_BUTTON_VISIBLE, ICON_TOGGLE_BUTTON_HIDDEN } from '../ToolbarsRight/buttonStyles.ts';
import { EyeIcon } from '../Icons/EyeIcon.tsx';

export default function HistoryTab() {
  const [{ history, historyIndex }] = useStore();
  const { resetHistoryTo, toggleDisabled } = useHistory();

  const sortedHistory = [...history].reverse();

  // Both controls below reach `APPLY_HISTORY_REPLAY` through `useHistory`, the
  // same dispatch the keyboard refuses while a pointer gesture owns the document
  // (`useKeyboardEvents.tsx:134`) and the Undo/Redo buttons now refuse for the
  // same reason (`HistoryControls.tsx`, `MobileHeader.tsx`). This tab is the
  // third way in and had no gate at all.
  //
  // Inside a gesture's window the replay is destructive. `resetHistoryTo`
  // replays `selections` from the SAME `history` array, so `history.length` never
  // moves and the pending commit's `entries.slice(0, cursor + 1)` truncates the
  // redo tail with no other symptom. `toggleDisabled` is not equal to it in that
  // window, it is worse: it writes the disabled flag onto entries the pending
  // commit is about to append past, so what is lost is not only a redo tail but
  // the visibility flag of committed steps.
  //
  // A single pointer cannot reach it — the pointer is captured by the tool area —
  // so the window is reachable only by a second pointer, which is why this is a
  // coverage gap rather than an easy hit.
  //
  // The refusal is here, at the input layer, and deliberately NOT in the
  // `APPLY_HISTORY_REPLAY` dispatcher arm: no dispatch means nothing appends, so
  // nothing truncates. A writer-side guard is the wrong layer for the same reason
  // it was wrong in `HistoryControls.tsx` — the repository has already rejected
  // that shape once.
  //
  // There is deliberately no `isDocumentGestureOpen()` in a `disabled` expression
  // either. The claim is a module-level slot with no re-render, so a render-time
  // read is stale in both directions: it cannot see a claim made after the last
  // render, and a control disabled by a mid-gesture render would stay disabled
  // after the release. These handlers are the guarantee, and they read the slot at
  // click time.
  const handleRewind = (index: number) => {
    if (isDocumentGestureOpen()) return;
    resetHistoryTo(index);
  };

  // `stopPropagation` runs first and unconditionally: acting on the eye control
  // must never also rewind the timeline, and that is a fact about the DOM shape,
  // not about the gesture. The gesture is refused after it, so a refused eye
  // click still does not travel to the row.
  const handleToggleDisabled = (event: MouseEvent, itemId: string) => {
    event.stopPropagation();
    if (isDocumentGestureOpen()) return;
    toggleDisabled(itemId);
  };

  return (
    <div className="flex flex-col gap-2 h-full">
      {history.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">No history yet.</div>
      ) : (
        <ul className="flex flex-col list-none p-0 gap-1 overflow-y-auto min-h-0">
          {sortedHistory.map((item) => {
            const originalIndex = history.indexOf(item);
            const isActive = originalIndex <= historyIndex;
            const isCurrent = originalIndex === historyIndex;
            const itemTitle = getHistoryItemTitle(item);

            return (
              <li
                key={item.id}
                onClick={() => handleRewind(originalIndex)}
                className={[
                  'flex items-center gap-2 rounded px-2 py-0 select-none cursor-pointer',
                  'border border-transparent cursor-pointer',
                  'hover:bg-white/70 dark:hover:bg-gray-700/40',
                  isCurrent ? 'bg-white dark:bg-gray-700/60 border-gray-200 dark:border-gray-600' : 'bg-transparent',
                  item.disabled ? 'opacity-45' : !isActive ? 'opacity-50' : 'opacity-100',
                ].join(' ')}
                style={{
                  paddingTop: '1px',
                  paddingBottom: '1px',
                }}
                title="Click to go back to this state"
              >
                <button
                  type="button"
                  onClick={(e) => handleToggleDisabled(e, item.id)}
                  className={[
                    'h-6 w-6 grid place-items-center rounded border',
                    !item.disabled ? ICON_TOGGLE_BUTTON_VISIBLE : ICON_TOGGLE_BUTTON_HIDDEN,
                  ].join(' ')}
                  title={!item.disabled ? 'Disable history item' : 'Enable history item'}
                >
                  <EyeIcon open={!item.disabled} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate flex items-center gap-2">
                    <span className="capitalize">{itemTitle}</span>
                    {isCurrent && (
                      <span className="ml-1" title="Current state">
                        👈
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
