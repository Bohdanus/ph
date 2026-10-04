import { flushSync } from 'react-dom';
import { useHistory } from '../../contexts/useHistory.ts';
import { useApp } from '../../hooks/useApp.ts';
import { useKeyDownShortcut } from '../../hooks/useKeyboardEvents.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useSelectionClipboard } from '../../contexts/useSelectionClipboard.ts';
import { useFile } from '../../contexts/useFile.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { BRUSH_SIZE_DEFAULT, BRUSH_SIZE_MAX, BRUSH_SIZE_MIN } from '../../util/brush-engine.ts';
import type { SpongeMode } from '../../tools/sponge.ts';
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
/**
 * `M`: the marquee tile — all four of Adobe's marquee tools, NOT the wand, which moved to `W`.
 *
 * The order is the flyout order from `toolbar-mapping.ts`, and it is what `Shift+M` walks.
 * Adobe publishes "Switch between marquee tools — SHIFT+M"
 * (`helpx.adobe.com/photoshop/web/get-set-up/preferences-and-settings/keyboard-shortcuts.html`)
 * without enumerating which tools the cycle covers, and its default-shortcut table names
 * only the Rectangular and Elliptical Marquees against `M`. Two third-party sources
 * disagree on whether the 1-pixel pair is inside the cycle at all
 * (`guides.wmlcloud.com`, reproducing Adobe's own CS5 "Basic Selection Tools", says they were
 * never assigned `M`; `flylib.com`'s Real World Adobe Photoshop CS2 says the cycle covers
 * four). This app follows the group: the cycle is the marquee tile, and a tool the rail
 * shows behind the same key that a user has just pressed is a tool they will expect the key
 * to reach. Recorded as unresolved in `selection.notes.md`.
 */
const marqueeGroup = [
  'rectangular-selection',
  'elliptical-selection',
  'single-row-marquee',
  'single-column-marquee',
] as const satisfies readonly ToolName[];
/** `W`: the object-selection tile — the wand and the quick selection, which now share it. */
const objectSelectionGroup = ['magic-wand', 'quick-selection'] as const satisfies readonly ToolName[];
/** `G`: paint bucket and gradient, one tile, one fill gesture between a click and a drag. */
const fillGroup = ['paint-bucket', 'gradient'] as const satisfies readonly ToolName[];
/** `O`: the whole toning flyout — the Dodge, the Burn and the Sponge, in Adobe's order. */
const tonalGroup = ['dodge', 'burn', 'sponge'] as const satisfies readonly ToolName[];
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
  sponge: 'size',
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
  const [{ fileName, totalSize, documentFrame, hasImage, toolName }] = useStore();
  const { canUndo, undo, canRedo, redo } = useHistory();
  const { goToTool, handleImageSave } = useApp();
  const { toolArgs, patchToolArgs } = useCurrentTool();
  const { copyActiveSelection, hasActiveSelection, pasteSelectionClipboard, layerViaCopy } = useSelectionClipboard();
  const { openSaveImageDialog } = useFile();
  const { commitDirtyTool } = useLayers();

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

  /**
   * The save the `mod+S` chord runs, and it is the header's save verbatim: commit the pending
   * tool preview, stage the document, open `SaveDialog`, and record the new file name on the
   * response. One flow rather than two is the point — a keyboard save and a `File > Save` click
   * that differed by even the `flushSync` would encode the pre-commit layers on one path.
   *
   * `flushSync` around `commitDirtyTool` is load-bearing and is not decoration: `commitDirtyTool`
   * bakes a live preview into a real layer and dispatches, and `exportLayers` has to hold that
   * result before `openSaveImageDialog` is called. Without it the batch runs after the call, so
   * the dialog would be handed the un-committed record. `DesktopHeader` and both mobile shells
   * wrap it identically.
   *
   * `if (data) handleImageSave(data)` is the in-band refusal every other caller of this flow
   * already guards: a cancelled dialog resolves `null` and is not a save, so there is nothing to
   * record and nothing to report. The `try` matches them too — a throwing `commitDirtyTool` is
   * reported rather than escaping a document-level `keydown` listener as an uncaught exception.
   */
  const saveDocument = async () => {
    try {
      if (!hasImage) return;

      let exportLayers!: ReturnType<typeof commitDirtyTool>;
      flushSync(() => {
        exportLayers = commitDirtyTool();
      });
      const data = await openSaveImageDialog({
        fileName,
        layers: exportLayers,
        size: totalSize,
        documentFrame,
      });
      if (data) handleImageSave(data);
    } catch (error) {
      console.error('Unable to prepare document export', error);
    }
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
      // The only copy call site with no `try` around it, and the one that most needs the
      // boolean read: `copySelection` returns `false` for a null snapshot instead of
      // throwing, so an unread result is a failed copy that leaves no trace anywhere. This
      // registration deliberately does NOT set `repeat`, which is what keeps the log to one
      // line per press — `useKeyboardEvents.tsx:154` drops an `event.repeat` before
      // `onKeyDown` runs, so a held Meta+C is one intent and one line, not a scrub.
      if (!copyActiveSelection()) {
        console.error('Failed to copy selection');
      }
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
    // `hasImage` alone, deliberately NOT `hasImage && hasActiveSelection`. `enabled` is
    // resolved BEFORE `preventDefault` (`useKeyboardEvents.tsx:111` continues out of the loop
    // body before :140 runs), so gating on the selection would hand the key back to the browser
    // — Ctrl+J is Downloads in Chrome on Windows and Linux — and replace a silent no-op with an
    // out-of-app page. `preventDefault: true` is what claims the key, so the registration stays
    // enabled and the empty case is answered where it belongs, in the handler. That is also what
    // the rest of this file already does for "nothing to act on": Meta+Z on an empty history is a
    // silent no-op (see the undo describe block), and every `copyActiveSelection` button guard
    // returns BEFORE calling rather than logging a refusal that never happened.
    enabled: hasImage,
    onKeyDown: async () => {
      // No selection is a state, not a failure: `layerViaCopy` would return `false` at
      // `useSelectionClipboard.ts:90` before touching anything. Reporting it would put a failure
      // in the console for the ordinary state of a document the user has not selected in yet.
      if (!hasActiveSelection) return;

      // `layerViaCopy`'s null-snapshot exits are an in-band channel its callers are expected to
      // report — `src/util/selection.ts:420-428` says so, and this was the only caller in the
      // family that discarded the boolean. `await` rather than a `.catch`: the promise is not
      // swallowed, so a throw from the un-`try`-wrapped `copySelectionToCanvas` still reaches the
      // console with its stack, which a defensive catch that can never fire would destroy.
      if (!(await layerViaCopy())) {
        console.error('Failed to create a layer from the active selection');
      }
    },
  });

  /**
   * `mod+S`: Adobe's Save on both platforms at once. `mod: true` is what covers the pair —
   * `matchesShortcut` compares `(event.metaKey || event.ctrlKey)` against the declared `mod`, so
   * this one registration IS `Cmd+S` on macOS and `Ctrl+S` on Windows and Linux, which is exactly
   * the split Adobe documents. Declaring `meta` or `ctrl` instead would bind one platform and
   * silently unbind the other.
   *
   * **Position is NOT load-bearing here, unlike the Sponge's two mode keys.** Every other `s`
   * registration in this file declares `mod: false`, so a press carrying either modifier fails
   * their `mod` test before their undeclared `shift`/`alt` are ever compared, and last-registered-
   * wins never gets to arbitrate. It sits here with the other document chords rather than beside
   * the Clone Stamp because that is where it belongs by kind; a future bare-`s` registration that
   * DID declare `mod: true` would need this moved last.
   *
   * `preventDefault` is the whole reason the key is registered at all: `Ctrl+S`/`Cmd+S` is the
   * browser's own Save Page in every engine, and an in-app Save that also saved the HTML would be
   * worse than the missing shortcut this replaces.
   *
   * `enabled: hasImage` alone, deliberately NOT narrowed further, for the reason the Meta+J
   * comment above gives in full: `useKeyboardEvents.tsx` resolves `enabled` with a `continue`
   * that runs BEFORE `preventDefault`, so any narrower gate hands the key back to the browser's
   * Save Page in precisely the case the user pressed Save. The no-document case is answered in the
   * handler, as a silent no-op, which is the same treatment an empty undo history already gets.
   *
   * `mutatesDocument` is left at its `true` default and that is deliberate: the handler commits a
   * live tool preview, and `useKeyboardEvents.tsx` refuses a document-committing registration at
   * `keydown` — before dispatch, therefore before `commitDirtyTool` — while a gesture holds the
   * document. A mid-gesture save would consume the preview the gesture's own commit is about to
   * write. The refusal costs the press, which is the correct trade.
   */
  useKeyDownShortcut({
    key: 's',
    mod: true,
    preventDefault: true,
    enabled: hasImage,
    onKeyDown: saveDocument,
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

  /**
   * The Sponge's two mode keys: `Shift+Alt+D` for Desaturate and `Shift+Alt+S` for
   * Saturate, with the Sponge selected.
   *
   * Adobe's own manual shortcut tables give both rows verbatim — "Desaturate (Sponge Tool)
   * Alt+Shift+D" and "Saturate (Sponge Tool) Alt+Shift+S" — and Julieanne Kost restates
   * them on Adobe's behalf. They are **tool-conditional**, which is load-bearing rather
   * than a workaround: the SAME `Alt+Shift+S` is Shadows on the Dodge and the Burn, on the
   * same page of the same table, so Photoshop resolves the collision by which tool is
   * active. `enabled: toolName === 'sponge'` is that resolution, and it is also what keeps
   * this registration from claiming the Dodge's Shadows key.
   *
   * `preventDefault` is on because `Alt+S` is a browser and OS chord on several platforms
   * and an unbound one would otherwise act on the user's document.
   *
   * **THEY ARE REGISTERED LAST ON PURPOSE, and that position is load-bearing.**
   * `matchesShortcut` only compares a modifier the registration actually DECLARES
   * (`src/hooks/useKeyboardEvents.tsx:70-77`), and the Clone Stamp's bare `s` at
   * `key: 's', mod: false` declares neither `shift` nor `alt` — so it matches `Alt+Shift+S`
   * as readily as a bare `s`. Dispatch is last-registered-wins (`useKeyboardEvents.tsx:109`
   * walks the registration array backwards), which is why a registration sitting earlier in
   * this function loses to one sitting later. Registered up here with the other tool
   * selectors, `Alt+Shift+S` reached the Clone Stamp instead of the Sponge and Adobe's
   * Saturate key was dead on arrival; `Alt+Shift+D` was unaffected because no registration
   * for `d` leaves its modifiers undeclared. Moving the pair to the end fixes it without
   * touching the Clone Stamp's own `Shift+S`, which is pinned behaviour.
   *
   * The alternative — declaring `shift: false, alt: false` on the Clone Stamp — was rejected
   * because `Shift+S` selecting the Clone Stamp is itself pinned by
   * `src/components/Common/__tests__/AppKeyboardShortcuts.test.tsx`. The dependency this
   * creates is on ORDER rather than on the flag, so the reason is recorded here and in the
   * tests that pin it.
   *
   * **The Dodge's and the Burn's own `Alt+Shift+S/M/H` range keys are NOT bound here.** They
   * are listed in their descriptions and do nothing. That asymmetry is the point of the
   * `enabled` gate rather than an oversight in it, and the missing pair is recorded in
   * `HANDOFF.md` §145 rather than fixed in this change.
   */
  const setSpongeMode = (mode: SpongeMode) => patchToolArgs('sponge', { mode });

  useKeyDownShortcut({
    key: 'd',
    mod: false,
    shift: true,
    alt: true,
    preventDefault: true,
    enabled: hasImage && toolName === 'sponge',
    onKeyDown: () => setSpongeMode('desaturate'),
  });

  useKeyDownShortcut({
    key: 's',
    mod: false,
    shift: true,
    alt: true,
    preventDefault: true,
    enabled: hasImage && toolName === 'sponge',
    onKeyDown: () => setSpongeMode('saturate'),
  });

  return null;
};
