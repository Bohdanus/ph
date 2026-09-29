import { useHistory } from '../../contexts/useHistory.ts';
import { useApp } from '../../hooks/useApp.ts';
import { useKeyDownShortcut } from '../../hooks/useKeyboardEvents.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useSelectionClipboard } from '../../contexts/useSelectionClipboard.ts';
import { BRUSH_SIZE_DEFAULT, BRUSH_SIZE_MAX, BRUSH_SIZE_MIN } from '../../util/brush-engine.ts';
import type { ToolName, ToolPatch } from '../../contexts/tool-types.ts';

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

/**
 * The tools whose options bar carries a tip, and the field each one spells it with.
 *
 * Photoshop's `[` and `]` change the tip of whatever tool is up, so the binding is per TOOL and
 * not per field: a partial `Record` is what makes "no tip" expressible, and an entry may only name
 * a field that tool actually has. The stamping family and the pen-backed paint family disagree on
 * the name — `lineWidth` is the legacy pen's stroke width and is carried as the tip size so the
 * existing Size sliders keep writing one field, while the tools that stamp a tip call theirs `size`.
 */
const tipSizeField = {
  brush: 'lineWidth',
  pencil: 'lineWidth',
  eraser: 'lineWidth',
  'color-replacement': 'lineWidth',
  smudge: 'size',
  dodge: 'size',
  burn: 'size',
  'clone-stamp': 'size',
} as const satisfies Partial<Record<ToolName, 'lineWidth' | 'size'>>;

/** The same, for the bar control Photoshop labels `Opacity`, which is 0-1 in every args type here. */
const opacityField = {
  brush: 'alpha',
  pencil: 'alpha',
  eraser: 'alpha',
  'color-replacement': 'alpha',
  'clone-stamp': 'alpha',
} as const satisfies Partial<Record<ToolName, 'alpha'>>;

type TipSizeTool = keyof typeof tipSizeField;
type OpacityTool = keyof typeof opacityField;

/** One pixel per press, and `repeat: true` is what turns that into a scrub while the key is held. */
const TIP_SIZE_STEP = 1;

/** Photoshop's `0` and `1`, in the 0-1 the sliders and every args type already use. */
const OPACITY_FULL = 1;
const OPACITY_TEN_PERCENT = 0.1;

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

  const tipSizeTool = (name: ToolName): TipSizeTool | null => (name in tipSizeField ? (name as TipSizeTool) : null);
  const opacityTool = (name: ToolName): OpacityTool | null => (name in opacityField ? (name as OpacityTool) : null);

  /**
   * `[` and `]`, one pixel per press.
   *
   * The write is a PATCH, not a `setToolArgs` of a rebuilt object, so it cannot drop a sibling
   * control's value the way a whole-object write would — the same reason the options bar patches.
   * The clamp is the tip engine's own range (`BRUSH_SIZE_MIN`/`BRUSH_SIZE_MAX`) because every
   * entry in the table is stamped by it, and it is the range `ERASER_SIZE_MAX` already mirrors.
   *
   * A non-finite current size falls back to `BRUSH_SIZE_DEFAULT` rather than to the floor:
   * `NaN + 1` is `NaN`, and a `NaN` bound on a range input renders as an empty slider with no
   * value to recover from.
   */
  const nudgeTipSize = (direction: -1 | 1) => {
    const tool = tipSizeTool(toolName);
    if (!tool) return;

    const field = tipSizeField[tool];
    const current = (toolArgs as Record<string, unknown>)[field];
    const from = Number.isFinite(current) ? (current as number) : BRUSH_SIZE_DEFAULT;
    const next = Math.min(BRUSH_SIZE_MAX, Math.max(BRUSH_SIZE_MIN, from + direction * TIP_SIZE_STEP));

    // The field NAME is data, so the patch has a computed key that the per-tool `ToolPatch`
    // union cannot check. `tipSizeField` is what narrows it: an entry may only name a field that
    // tool actually carries, and `Partial` is what makes "this tool has no tip" expressible.
    patchToolArgs(tool, { [field]: next } as unknown as ToolPatch<typeof tool>);
  };

  /** `0` is Opacity 100% and `1` is Opacity 10%, exactly as Adobe documents them. */
  const setOpacity = (value: number) => {
    const tool = opacityTool(toolName);
    if (!tool) return;

    patchToolArgs(tool, { alpha: value } as ToolPatch<typeof tool>);
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

  // Adobe's painting keys. <https://helpx.adobe.com/photoshop/using/painting-tools.html>
  // "[ and ]", and "To set Opacity to 100%, press 0; to set it to 10%, press 1".
  //
  // `mod: false` is load-bearing on all four: the brackets and the digits are plain keystrokes in
  // Photoshop, and a bare `key` with no modifier test would let Ctrl+[ and Cmd+] step the tip
  // instead of reaching the platform chord the user asked for. The brackets therefore do not
  // match Shift either — `{` is the key Shift+[ produces, and it is not a tip step.
  //
  // `preventDefault` is on the two digit keys only. They are the ones a browser would otherwise
  // do something with, and a shortcut that is disabled (a tool with no Opacity) leaves the key
  // alone, because the provider skips `preventDefault` for a registration that did not match.
  useKeyDownShortcut({
    key: '[',
    mod: false,
    repeat: true,
    enabled: hasImage && tipSizeTool(toolName) !== null,
    onKeyDown: () => nudgeTipSize(-1),
  });

  useKeyDownShortcut({
    key: ']',
    mod: false,
    repeat: true,
    enabled: hasImage && tipSizeTool(toolName) !== null,
    onKeyDown: () => nudgeTipSize(1),
  });

  useKeyDownShortcut({
    key: '0',
    mod: false,
    preventDefault: true,
    enabled: hasImage && opacityTool(toolName) !== null,
    onKeyDown: () => setOpacity(OPACITY_FULL),
  });

  useKeyDownShortcut({
    key: '1',
    mod: false,
    preventDefault: true,
    enabled: hasImage && opacityTool(toolName) !== null,
    onKeyDown: () => setOpacity(OPACITY_TEN_PERCENT),
  });

  return null;
};
