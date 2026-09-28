import { useHistory } from '../../contexts/useHistory.ts';
import { useApp } from '../../hooks/useApp.ts';
import { useKeyDownShortcut } from '../../hooks/useKeyboardEvents.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useSelectionClipboard } from '../../contexts/useSelectionClipboard.ts';
import type { ToolName } from '../../contexts/tool-types.ts';

/**
 * Flyout groups, each cycled by Shift+<key>, exactly as `toolbar-mapping.ts` groups the
 * flyout tiles. The arrays are the mapping's groups, not a guess: a shortcut that
 * disagrees with the map disagrees with the flyout the user just clicked.
 *
 * `brushGroup` is the Brush flyout — brush, pencil, color replacement and now the eraser,
 * which `toolbar-mapping.ts:70` puts in the same tile and also gives its own `E`. Both
 * are correct: `E` selects the eraser outright, Shift+B reaches it by cycling.
 */
const brushGroup = ['brush', 'pencil', 'color-replacement', 'eraser'] as const satisfies readonly ToolName[];
const lassoGroup = [
  'freehand-lasso',
  'polygonal-lasso',
  'feather-magnetic-lasso',
] as const satisfies readonly ToolName[];
/** `M`: the marquee tile — rectangular and elliptical, NOT the wand, which moved to `W`. */
const marqueeGroup = ['rectangular-selection', 'elliptical-selection'] as const satisfies readonly ToolName[];
/** `W`: the object-selection tile — the wand and the quick selection, which now share it. */
const objectSelectionGroup = ['magic-wand', 'quick-selection'] as const satisfies readonly ToolName[];
/** `G`: paint bucket and gradient, one tile, one fill gesture between a click and a drag. */
const fillGroup = ['paint-bucket', 'gradient'] as const satisfies readonly ToolName[];
/** `O`: the dodge/burn tonal pair, which also share one options bar (`ToolbarsRight/Tonal`). */
const tonalGroup = ['dodge', 'burn'] as const satisfies readonly ToolName[];
const penGroup = ['pen', 'freeform-pen', 'curvature-pen'] as const satisfies readonly ToolName[];

function cycleToolGroup(currentTool: ToolName, group: readonly ToolName[]) {
  const currentIndex = group.indexOf(currentTool as (typeof group)[number]);
  const startIndex = currentIndex === -1 ? 0 : currentIndex;
  return group[(startIndex + 1) % group.length];
}

export const AppKeyboardShortcuts = () => {
  const [{ hasImage, toolName }] = useStore();
  const { canUndo, undo, canRedo, redo } = useHistory();
  const { goToTool } = useApp();
  const { toolArgs, patchToolArgs } = useCurrentTool();
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
      // The cycle must be expressed in real FigureType values. Matching the
      // display name 'ellipse' against the stored figure 'oval' made
      // indexOf() return -1, so Shift+U from Ellipse wrapped back to Rectangle
      // instead of advancing to Line.
      const currentFigure = toolArgs.toolName === 'shape' ? toolArgs.figure : 'rectangle';
      const orderedFigures = ['rectangle', 'oval', 'line', 'custom-shape'] as const;
      const currentIndex = orderedFigures.indexOf(currentFigure as (typeof orderedFigures)[number]);
      const nextFigure = orderedFigures[(currentIndex + 1) % orderedFigures.length];

      if (nextFigure === 'custom-shape') {
        goToTool('custom-shape');
      } else {
        patchToolArgs('shape', { figure: nextFigure });
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

  const selectObjectSelectionTool = (shiftKey = false) => {
    if (shiftKey) {
      const current = objectSelectionGroup.includes(toolName as (typeof objectSelectionGroup)[number])
        ? toolName
        : 'magic-wand';
      const nextTool = cycleToolGroup(current as ToolName, objectSelectionGroup as readonly ToolName[]);
      goToTool(nextTool);
      return;
    }

    goToTool(
      objectSelectionGroup.includes(toolName as (typeof objectSelectionGroup)[number]) ? toolName : 'magic-wand'
    );
  };

  const selectFillTool = (shiftKey = false) => {
    if (shiftKey) {
      const current = fillGroup.includes(toolName as (typeof fillGroup)[number]) ? toolName : 'paint-bucket';
      const nextTool = cycleToolGroup(current as ToolName, fillGroup as readonly ToolName[]);
      goToTool(nextTool);
      return;
    }

    goToTool(fillGroup.includes(toolName as (typeof fillGroup)[number]) ? toolName : 'paint-bucket');
  };

  const selectTonalTool = (shiftKey = false) => {
    if (shiftKey) {
      const current = tonalGroup.includes(toolName as (typeof tonalGroup)[number]) ? toolName : 'dodge';
      const nextTool = cycleToolGroup(current as ToolName, tonalGroup as readonly ToolName[]);
      goToTool(nextTool);
      return;
    }

    goToTool(tonalGroup.includes(toolName as (typeof tonalGroup)[number]) ? toolName : 'dodge');
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
    key: 'i',
    mod: false,
    enabled: hasImage,
    onKeyDown: () => goToTool('eyedropper'),
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
    onKeyDown: (event) => selectObjectSelectionTool(event.shiftKey),
  });

  useKeyDownShortcut({
    key: 'w',
    mod: false,
    shift: true,
    enabled: hasImage,
    onKeyDown: (event) => selectObjectSelectionTool(event.shiftKey),
  });

  useKeyDownShortcut({
    key: 'g',
    mod: false,
    enabled: hasImage,
    onKeyDown: (event) => selectFillTool(event.shiftKey),
  });

  useKeyDownShortcut({
    key: 'g',
    mod: false,
    shift: true,
    enabled: hasImage,
    onKeyDown: (event) => selectFillTool(event.shiftKey),
  });

  useKeyDownShortcut({
    key: 'o',
    mod: false,
    enabled: hasImage,
    onKeyDown: (event) => selectTonalTool(event.shiftKey),
  });

  useKeyDownShortcut({
    key: 'o',
    mod: false,
    shift: true,
    enabled: hasImage,
    onKeyDown: (event) => selectTonalTool(event.shiftKey),
  });

  // The three tiles that hold a single tool get one plain registration each, exactly as
  // `t` and the old `w` did: there is nothing to cycle, so a `shift: true` twin would
  // select the same tool twice. Each key matches the `shortcut` on its `toolbar-mapping.ts`
  // line — I for the eyedropper (:56), E for the eraser (:70), S for the clone stamp (:74).
  useKeyDownShortcut({
    key: 'i',
    mod: false,
    enabled: hasImage,
    onKeyDown: () => goToTool('eyedropper'),
  });

  useKeyDownShortcut({
    key: 'e',
    mod: false,
    enabled: hasImage,
    onKeyDown: () => goToTool('eraser'),
  });

  useKeyDownShortcut({
    key: 's',
    mod: false,
    enabled: hasImage,
    onKeyDown: () => goToTool('clone-stamp'),
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
