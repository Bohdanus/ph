import { useStore } from '../../contexts/StoreContext.tsx';
import { useSelectionHistory } from '../../contexts/useSelectionHistory.ts';
import { useKeyDownShortcut } from '../../hooks/useKeyboardEvents.tsx';

/**
 * Photoshop's Select All (`mod+A`) and Deselect (`mod+D`).
 *
 * `enabled` is `hasImage` alone, as for `Meta+J` in `AppKeyboardShortcuts`: the provider resolves
 * `enabled` before `preventDefault`, so gating on "has a selection" would hand `Ctrl+D` back to the
 * browser's Bookmark dialog. "Nothing to deselect" is answered by `clearSelections`, which appends
 * nothing for an empty selection set.
 *
 * `shift: false` keeps `Shift+mod+D` (Reselect) and `Shift+mod+A` from reaching these handlers.
 */
export const SelectionShortcuts = () => {
  const [{ hasImage }] = useStore();
  const { selectAll, clearSelections } = useSelectionHistory();

  useKeyDownShortcut({
    key: 'a',
    mod: true,
    shift: false,
    alt: false,
    preventDefault: true,
    enabled: hasImage,
    onKeyDown: selectAll,
  });

  useKeyDownShortcut({
    key: 'd',
    mod: true,
    shift: false,
    alt: false,
    preventDefault: true,
    enabled: hasImage,
    onKeyDown: clearSelections,
  });

  return null;
};
