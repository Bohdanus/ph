import { useHistory } from '../../contexts/useHistory.ts';
import { useApp } from '../../hooks/useApp.ts';
import { useKeyDownShortcut } from '../../hooks/useKeyboardEvents.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useSelectionClipboard } from '../../contexts/useSelectionClipboard.ts';
import type { ToolName } from '../../contexts/tool-types.ts';

const brushGroup = ['brush', 'pencil', 'color-replacement'] as const satisfies readonly ToolName[];
const lassoGroup = [
  'freehand-lasso',
  'polygonal-lasso',
  'feather-magnetic-lasso',
] as const satisfies readonly ToolName[];
const marqueeGroup = ['rectangular-selection', 'magic-wand'] as const satisfies readonly ToolName[];
const penGroup = ['pen', 'freeform-pen', 'curvature-pen'] as const satisfies readonly ToolName[];

function cycleToolGroup(currentTool: ToolName, group: readonly ToolName[]) {
  const currentIndex = group.indexOf(currentTool as (typeof group)[number]);
  const startIndex = currentIndex === -1 ? 0 : currentIndex;
  return group[(startIndex + 1) % group.length];
}

export const AppKeyboardShortcuts = () => {
  const [{ hasImage, isToolDirty, toolName }] = useStore();
  const { canUndo, undo, canRedo, redo } = useHistory();
  const { goToTool } = useApp();
  const { toolArgs, patchToolArgs, resetToLastSavedArgs } = useCurrentTool();
  const { copyActiveSelection, pasteSelectionClipboard, layerViaCopy } = useSelectionClipboard();

  const selectBrushTool = (shiftKey = false) => {
    if (shiftKey) {
      const current = brushGroup.includes(toolName as (typeof brushGroup)[number]) ? toolName : 'brush';
      const nextTool = cycleToolGroup(current as ToolName, brushGroup as readonly ToolName[]);
      goToTool(nextTool);
      return;
    }

    goToTool(brushGroup.includes(toolName as (typeof brushGroup)[number]) ? toolName : 'brush');
  };

  const selectLassoTool = (shiftKey = false) => {
    if (shiftKey) {
      const current = lassoGroup.includes(toolName as (typeof lassoGroup)[number]) ? toolName : 'freehand-lasso';
      const nextTool = cycleToolGroup(current as ToolName, lassoGroup as readonly ToolName[]);
      goToTool(nextTool);
      return;
    }

    goToTool(lassoGroup.includes(toolName as (typeof lassoGroup)[number]) ? toolName : 'freehand-lasso');
  };

  const selectShapeTool = (shiftKey = false) => {
    if (shiftKey) {
      const currentFigure = toolArgs.toolName === 'shape' ? toolArgs.figure : 'rectangle';
      const orderedFigures = ['rectangle', 'ellipse', 'line', 'custom-shape'] as const;
      const currentIndex = orderedFigures.indexOf(currentFigure as (typeof orderedFigures)[number]);
      const nextFigure = orderedFigures[(currentIndex + 1) % orderedFigures.length];

      if (nextFigure === 'custom-shape') {
        goToTool('custom-shape');
      } else {
        patchToolArgs('shape', {
          figure: nextFigure === 'rectangle' ? 'rectangle' : nextFigure === 'ellipse' ? 'oval' : 'line',
        });
        goToTool('shape');
      }
      return;
    }

    if (toolName === 'shape') {
      goToTool('shape');
      return;
    }

    patchToolArgs('shape', { figure: 'rectangle' });
    goToTool('shape');
  };

  const selectMarqueeTool = (shiftKey = false) => {
    if (shiftKey) {
      const current = marqueeGroup.includes(toolName as (typeof marqueeGroup)[number])
        ? toolName
        : 'rectangular-selection';
      const nextTool = cycleToolGroup(current as ToolName, marqueeGroup as readonly ToolName[]);
      goToTool(nextTool);
      return;
    }

    goToTool(marqueeGroup.includes(toolName as (typeof marqueeGroup)[number]) ? toolName : 'rectangular-selection');
  };

  const selectPenTool = (shiftKey = false) => {
    if (shiftKey) {
      const current = penGroup.includes(toolName as (typeof penGroup)[number]) ? toolName : 'pen';
      const nextTool = cycleToolGroup(current as ToolName, penGroup as readonly ToolName[]);
      goToTool(nextTool);
      return;
    }

    goToTool(penGroup.includes(toolName as (typeof penGroup)[number]) ? toolName : 'pen');
  };

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
    key: 'c',
    mod: true,
    preventDefault: true,
    enabled: hasImage,
    onKeyDown: () => {
      copyActiveSelection();
    },
  });

  useKeyDownShortcut({
    key: 'v',
    mod: true,
    preventDefault: true,
    enabled: hasImage,
    onKeyDown: () => {
      pasteSelectionClipboard();
    },
  });

  useKeyDownShortcut({
    key: 'v',
    mod: false,
    enabled: hasImage,
    onKeyDown: () => goToTool('reposition'),
  });

  useKeyDownShortcut({
    key: 'j',
    mod: true,
    preventDefault: true,
    enabled: hasImage,
    onKeyDown: () => {
      layerViaCopy();
    },
  });

  useKeyDownShortcut({
    key: 'b',
    mod: false,
    enabled: hasImage,
    onKeyDown: (event) => selectBrushTool(event.shiftKey),
  });

  useKeyDownShortcut({
    key: 'b',
    mod: false,
    shift: true,
    enabled: hasImage,
    onKeyDown: (event) => selectBrushTool(event.shiftKey),
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
    onKeyDown: (event) => selectShapeTool(event.shiftKey),
  });

  useKeyDownShortcut({
    key: 'u',
    mod: false,
    shift: true,
    enabled: hasImage,
    onKeyDown: (event) => selectShapeTool(event.shiftKey),
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
    onKeyDown: (event) => selectLassoTool(event.shiftKey),
  });

  useKeyDownShortcut({
    key: 'l',
    mod: false,
    shift: true,
    enabled: hasImage,
    onKeyDown: (event) => selectLassoTool(event.shiftKey),
  });

  useKeyDownShortcut({
    key: 'w',
    mod: false,
    enabled: hasImage,
    onKeyDown: () => goToTool('magic-wand'),
  });

  useKeyDownShortcut({
    key: 'm',
    mod: false,
    enabled: hasImage,
    onKeyDown: (event) => selectMarqueeTool(event.shiftKey),
  });

  useKeyDownShortcut({
    key: 'm',
    mod: false,
    shift: true,
    enabled: hasImage,
    onKeyDown: (event) => selectMarqueeTool(event.shiftKey),
  });

  useKeyDownShortcut({
    key: 'p',
    mod: false,
    enabled: hasImage,
    onKeyDown: (event) => selectPenTool(event.shiftKey),
  });

  useKeyDownShortcut({
    key: 'p',
    mod: false,
    shift: true,
    enabled: hasImage,
    onKeyDown: (event) => selectPenTool(event.shiftKey),
  });

  return null;
};
