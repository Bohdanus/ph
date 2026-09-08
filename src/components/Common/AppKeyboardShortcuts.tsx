import { useHistory } from '../../contexts/useHistory.ts';
import { useApp } from '../../hooks/useApp.ts';
import { useKeyDownShortcut } from '../../hooks/useKeyboardEvents.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';

export const AppKeyboardShortcuts = () => {
  const [{ hasImage, isToolDirty }] = useStore();
  const { canUndo, undo, canRedo, redo } = useHistory();
  const { goToTool } = useApp();
  const { resetToLastSavedArgs } = useCurrentTool();

  useKeyDownShortcut({
    key: 'z',
    mod: true,
    preventDefault: true,
    enabled: hasImage,
    onKeyDown: () => {
      if (isToolDirty) {
        resetToLastSavedArgs();
        return;
      }

      if (canUndo()) {
        undo();
      }
    },
  });

  useKeyDownShortcut({
    key: 'z',
    mod: true,
    shift: true,
    preventDefault: true,
    enabled: hasImage,
    onKeyDown: () => {
      if (canRedo()) {
        redo();
      }
    },
  });

  useKeyDownShortcut({
    key: 'y',
    mod: true,
    preventDefault: true,
    enabled: hasImage,
    onKeyDown: () => {
      if (canRedo()) {
        redo();
      }
    },
  });

  useKeyDownShortcut({
    key: 'v',
    mod: false,
    enabled: hasImage,
    onKeyDown: () => goToTool('reposition'),
  });

  useKeyDownShortcut({
    key: 'b',
    mod: false,
    enabled: hasImage,
    onKeyDown: () => goToTool('draw'),
  });

  useKeyDownShortcut({
    key: 'c',
    mod: false,
    enabled: hasImage,
    onKeyDown: () => goToTool('crop'),
  });

  useKeyDownShortcut({
    key: 'u',
    mod: false,
    enabled: hasImage,
    onKeyDown: () => goToTool('shape'),
  });

  useKeyDownShortcut({
    key: 't',
    mod: false,
    enabled: hasImage,
    onKeyDown: () => goToTool('text'),
  });

  useKeyDownShortcut({
    key: 'l',
    mod: false,
    enabled: hasImage,
    onKeyDown: () => goToTool('freehand-lasso'),
  });

  return null;
};
