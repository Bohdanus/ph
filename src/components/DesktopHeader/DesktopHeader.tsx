import { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useTheme } from '../../contexts/ThemeContext.tsx';
import HistoryControls from '../HistoryControls/HistoryControls';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useApp } from '../../hooks/useApp.ts';
import { useFile } from '../../contexts/useFile.tsx';
import { useHistoryCommands } from '../../hooks/useHistoryCommands.ts';
import { MENU_ITEM_BUTTON } from '../ToolbarsRight/buttonStyles.ts';
import { useLayers } from '../../contexts/useLayer.ts';
import { hasPendingText } from '../../util/typeGuards.ts';
import { slugifyToolLabel } from '../../../toolbar-mapping.ts';
import { useRightPanelVisibility } from '../../contexts/RightPanelVisibility.tsx';
import { usePanelLayout } from '../../contexts/PanelLayout.tsx';
import type { ToolName } from '../../contexts/tool-types.ts';

/**
 * ## What this menu bar is
 *
 * A transcription of Adobe's own list, in Adobe's order, and nothing else decides the list.
 * `File, Edit, Image, Layer, Type, Select, Filter, View, Window, Help` — ten menus, and the
 * order they appear in `MENUS` below is the order they render in.
 *
 * Three members of that list are worth their reasons, because each was wrong here before.
 *
 * - **`3D` is not a menu and never was again.** Adobe removed the 3D features outright in
 *   2020 and the menu with them ("As of July 2024, Photoshop's legacy 3D features have been
 *   removed", <https://helpx.adobe.com/photoshop/kb/3d-faq.html>). `docs/FEATURES.md` used to
 *   list it in the Photoshop column and so did this file's absence list; both are corrected.
 *   `Analysis` went the same way earlier and by a different route: there has been no top-level
 *   `Analysis` menu for many versions, because those commands sit at `Image ▸ Analysis`.
 * - **There is no `Tools` menu, and there never was one.** Photoshop exposes the tool set
 *   through the Tools panel — its tiles, their flyouts for grouped tools, and the single-key
 *   shortcuts (`V`, `M`, `L`, `B`, `T`, …) — and through nothing else. The `Tools` host this
 *   file used to carry was the one menu here that Adobe does not have, positioned between
 *   `File` and `Edit`, and `docs/OVERRIDES.md` is empty, so it had to go rather than be filed
 *   somewhere else. Nothing became unreachable: this app has both of Photoshop's surfaces
 *   already, in `SidebarLeft` (the rail, with its `role="menu"` flyouts) and
 *   `AppKeyboardShortcuts.tsx` (the single-key tool bindings), and
 *   `SidebarLeft/__tests__/toolbar-mapping.test.ts` pins the invariant that every registered
 *   tool is a rail tile or is named in `toolbar-mapping.ts`'s `extraTools`. That test is where
 *   the "a tool nobody can reach" guarantee lives now, and it is a stronger pin than the one
 *   it replaces: it walks the registry rather than a hand-written list of menu rows.
 * - **`Window ▸ Workspace ▸ Reset Essentials`, not a top-level `Reset Workspace`.** Adobe
 *   nests the workspace reset one level down ("Select `Window > Workspace > Reset Essentials`",
 *   <https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/move-panels.html>),
 *   and a `Window` menu with a command sitting on its own where Adobe puts two levels of
 *   submenu above it is a muscle-memory error, not a cosmetic one. The command itself is
 *   unchanged — the same `resetWorkspace`, for the same reason: a dock whose order and width
 *   survive a reload needs the documented way back from a layout the user cannot live with.
 *
 * ## What each menu contains
 *
 * Membership inside a host is Adobe's, in Adobe's order. How much of it is here is not Adobe's
 * business, and the rule for that is the one `ADJUSTMENTS_ITEMS` was already built on:
 *
 * **A command this app can run renders enabled; a command it cannot renders `disabled`; a
 * capability with no entry anywhere is recorded in `docs/FEATURES.md` rather than invented
 * here.** So `Select` carries Adobe's items with all of them inert, which is the honest state
 * of this app — it has selection tools and no selection commands — and it is still strictly
 * better than the alternative this file used to choose, which was to omit the menu and let the
 * gap live only in a document. Photoshop greys out most of `Image ▸ Adjustments` whenever the
 * active document cannot take the command, so an inert row is a shape Adobe itself uses.
 *
 * The lists below are deliberately partial in a second way: a submenu appears where this file
 * has something to put in it or where Adobe's own structure is the subject the repository
 * documents (`Image ▸ Adjustments`, `Select ▸ Modify`, `Edit ▸ Transform`, `Window ▸
 * Workspace`), and a category whose every leaf is unbuildable — `Filter ▸ Blur`,
 * `View ▸ Proof Setup`, `Type ▸ OpenType` — is not rendered at all. Adobe publishes the leaf
 * lists for those but not a stable top-to-bottom order, so guessing an order and calling it
 * Adobe's would be worse than naming the omission.
 */
type MenuItem =
  /**
   * A command the app runs. `disabled` carries the availability Photoshop shows the same way
   * — `Edit ▸ Undo` greys out with no history to undo — and it is deliberately a separate flag
   * from `unbuilt`: "this cannot be run yet" and "this cannot be run at all" are different
   * facts, and a user deciding whether to keep using the app needs to be able to tell them
   * apart.
   */
  | { kind: 'command'; label: string; onSelect: () => void; testId?: string; disabled?: boolean }
  /** Adobe's entry, this app's capability not built. Renders `disabled`, and stays visible. */
  | { kind: 'unbuilt'; label: string; testId?: string }
  | { kind: 'separator' }
  | { kind: 'submenu'; label: string; testId: string; items: readonly MenuItem[] };

type MenuHost = {
  id: string;
  label: string;
  /** Every host but `Window` uses the light/dark pair; `Window` keeps its own dark chrome. */
  className: string;
  items: readonly MenuItem[];
};

/**
 * The two discard prompts, named because `DesktopHeader.test.tsx` asserts on the exact
 * strings: a prompt a test can only match by substring is a prompt whose wording can drift
 * without anything noticing, and this wording is what tells the user the document is about to
 * be thrown away.
 */
const NEW_CONFIRM_MESSAGE = 'Discard unsaved changes and start a new image?';
const OPEN_CONFIRM_MESSAGE = 'Discard unsaved changes and open another file?';

const HOST_LIST_CLASS = 'absolute left-0 top-full z-10 m-0 list-none rounded bg-white py-2 shadow-lg dark:bg-gray-800';
const SUBMENU_LIST_CLASS =
  'absolute left-full top-0 z-20 m-0 min-w-[220px] list-none rounded border border-gray-300 bg-white py-2 shadow-lg dark:border-gray-600 dark:bg-gray-800';

/**
 * `Image ▸ Adjustments`, in Adobe's own order.
 *
 * Membership is Adobe-confirmed item by item; the ORDER is not, because Adobe publishes
 * no page that enumerates the submenu top to bottom — it is reconstructed from the order
 * Adobe's own pages present the commands in plus the create-new-adjustment-layer list.
 * Treat it as a good hypothesis, the same provenance rule
 * `docs/PHOTOSHOP-UX.md`'s "Confidence and provenance" section applies to the rail.
 *
 * Two items are enabled, and each is enabled because its computation is the Adobe command
 * it is named for:
 *
 * - **`Brightness/Contrast` → the `levels` id.** `LevelsToolArgs` is
 *   `{ brightness, contrast }` (`src/tools/levels.ts`) and the processor emits one
 *   `brightness(…) contrast(…)` filter, which is Adobe's Brightness/Contrast and not
 *   Adobe's Levels. Naming it `Levels` under a menu that is supposed to be a clone is the
 *   falsehood this rename removes.
 * - **`Photo Filter` → the `color` id.** Its three controls are grayscale, sepia and
 *   saturation (`src/tools/functions.ts`'s `buildColorsFilter`). Adobe's Photo Filter is a
 *   lens filter with a Density slider and a Preserve Luminosity option, and sepia IS its
 *   Warming preset, but **two of the three controls are a partial match and `grayscale`
 *   has no counterpart in it.** It is a bounded divergence, recorded here rather than
 *   papered over, and it is strictly better than the alternative: `Black and White` needs
 *   per-hue sextant weighting, and there is no hue decomposition anywhere in `src`.
 *
 * **`Levels`, `Curves`, `Exposure`, `Black and White`, `Hue/Saturation`, `Vibrance`,
 * `Color Balance`, `Channel Mixer`, `Selective Color`, `Desaturate`, `Invert`,
 * `Posterize`, `Threshold`, `Gradient Map`, `Equalize`, `Shadows/Highlights`, `HDR Toning`,
 * `Match Color`, `Replace Color` and `Color Lookup` are all disabled**, which is the
 * accurate state of this app: it has no adjustment layers at all, and
 * `src/contexts/psd-utils.ts` reports `adjustment` as unsupported on import. What exists
 * instead is a retained per-layer operation stack, which keeps an adjustment but cannot
 * re-edit it and has no properties panel.
 */
type AdjustmentItem = { label: string; toolName?: ToolName };

const ADJUSTMENTS_ITEMS: readonly AdjustmentItem[] = [
  { label: 'Brightness/Contrast', toolName: 'levels' },
  { label: 'Exposure' },
  { label: 'Vibrance' },
  { label: 'Hue/Saturation' },
  { label: 'Curves' },
  { label: 'Color Balance' },
  { label: 'Black and White' },
  { label: 'Photo Filter', toolName: 'color' },
  { label: 'Channel Mixer' },
  { label: 'Color Lookup' },
  { label: 'Selective Color' },
  { label: 'Shadows/Highlights' },
  { label: 'HDR Toning' },
  { label: 'Desaturate' },
  { label: 'Match Color' },
  { label: 'Replace Color' },
  { label: 'Invert' },
  { label: 'Equalize' },
  { label: 'Gradient Map' },
  { label: 'Posterize' },
  { label: 'Threshold' },
  { label: 'Levels' },
];

/**
 * A submenu's `<ul>` test id is its parent button's id without the trailing `-button`, which
 * is the rule every submenu id in this file already followed before the menu became data
 * (`image-menu-adjustments-button` opened `image-menu-adjustments`). Derived rather than
 * declared so the two cannot drift, and derived rather than reused because a test id that
 * names two elements at once makes every `getByTestId` on it ambiguous.
 */
const submenuListId = (buttonTestId: string) => buttonTestId.replace(/-button$/, '');

/**
 * One level of a menu, host list or submenu, from the item model above.
 *
 * A submenu parent is a real `<button>` that owns the submenu, not a hover-only `<span>`: a
 * hover affordance would put every item in this submenu out of reach of a keyboard, which is
 * the one input that cannot recover from a missing `:hover`. `aria-expanded` is what tells a
 * screen reader the same thing.
 */
const MenuList = ({
  items,
  testId,
  className,
  openSubmenu,
  toggleSubmenu,
}: {
  items: readonly MenuItem[];
  testId: string;
  className: string;
  openSubmenu: string | null;
  toggleSubmenu: (id: string) => void;
}) => (
  <ul className={className} data-testid={testId}>
    {items.map((item, index) => {
      // Index-based rather than label-based on purpose: two Adobe rows may differ only by an
      // ellipsis, and a key that collides silently drops one of them.
      const key = `${testId}-${index}`;

      if (item.kind === 'separator') {
        return <li key={key} className="my-1 h-px bg-gray-200 dark:bg-gray-600" role="separator" />;
      }

      if (item.kind === 'submenu') {
        return (
          <li key={key} className="relative">
            <button
              className={MENU_ITEM_BUTTON}
              type="button"
              aria-haspopup="true"
              aria-expanded={openSubmenu === item.testId}
              onClick={() => toggleSubmenu(item.testId)}
              data-testid={item.testId}
            >
              {item.label}
            </button>
            {openSubmenu === item.testId && (
              <MenuList
                items={item.items}
                testId={submenuListId(item.testId)}
                className={SUBMENU_LIST_CLASS}
                openSubmenu={openSubmenu}
                toggleSubmenu={toggleSubmenu}
              />
            )}
          </li>
        );
      }

      return (
        <li key={key}>
          <button
            className={MENU_ITEM_BUTTON}
            type="button"
            disabled={item.kind === 'unbuilt' || item.disabled === true}
            onClick={item.kind === 'command' ? item.onSelect : undefined}
            data-testid={item.testId}
          >
            {item.label}
          </button>
        </li>
      );
    })}
  </ul>
);

/**
 * One `ADJUSTMENTS_ITEMS` row as a `MenuItem`, with an id whether it is built or not.
 *
 * The id is not optional for the twenty disabled rows. They are the recorded gaps, and a gap
 * nothing can be pointed at is a gap that quietly stops being one of twenty and becomes an
 * omission — which is the outcome `docs/FEATURES.md` exists to prevent. A discriminated return
 * rather than a computed `kind`, so TypeScript can tell the two arms apart and `onSelect` is
 * absent from the arm that must not have one.
 */
const adjustmentMenuItem = ({ label, toolName }: AdjustmentItem, selectTool: (toolName: ToolName) => void): MenuItem =>
  toolName === undefined
    ? { kind: 'unbuilt', label, testId: `image-menu-adjustments-${slugifyToolLabel(label)}-button` }
    : {
        kind: 'command',
        label,
        testId: `image-menu-adjustments-${slugifyToolLabel(label)}-button`,
        onSelect: () => selectTool(toolName),
      };

const DesktopHeader = () => {
  const [{ currentArgs, fileName, hasUnsavedChanges, totalSize, documentFrame, hasImage }] = useStore();
  const { commitDirtyTool, mergeAllLayers } = useLayers();
  const { goToTool, setBlankImage, setImageFromUpload, handleImageSave } = useApp();
  const { openNewImageDialog, openLoadImageDialog, openSaveImageDialog } = useFile();
  const { canUndo, canRedo, undo, redo } = useHistoryCommands();

  const { theme, toggleTheme } = useTheme();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // Which submenu is expanded inside the open host. Keyed by the submenu's own test id, so
  // switching hosts cannot leave a stale submenu expanded — and it is deliberately not one
  // boolean per host, because a single value cannot disagree with itself.
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  // One map rather than one ref per host. Five `useRef`s plus five branches in
  // `handleClickOutside` meant a sixth host had to be remembered in two places, and forgetting
  // the second one produced a menu that never closes on an outside click — a defect with no
  // other symptom, and one the previous shape invited rather than prevented.
  const menuRefs = useRef(new Map<string, HTMLLIElement>());

  // Dismissing the menu is what activating an item means, so it is a single place rather than
  // something each handler remembers to do first.
  const closeMenus = useCallback(() => {
    setOpenMenu(null);
    setOpenSubmenu(null);
  }, []);

  // One toggle for both hosts, so the click that opens a menu is also the click that
  // collapses whatever submenu it had expanded.
  const toggleMenu = (id: string) => {
    setOpenMenu((current) => (current === id ? null : id));
    setOpenSubmenu(null);
  };

  const toggleSubmenu = (id: string) => setOpenSubmenu((current) => (current === id ? null : id));

  const selectTool = (toolName: ToolName) => {
    goToTool(toolName);
    closeMenus();
  };

  const newDocument = async () => {
    try {
      // Dismissing the menu is what activating an item means, so it happens
      // FIRST and unconditionally. It used to sit after the action, which
      // made the decline path — the one branch that returns early — leave the
      // dropdown hanging over the top-left of the canvas, and left it hanging
      // on the `catch` path too. `handleClickOutside` cannot rescue either:
      // the mousedown that opened this state already fired inside the menu's
      // own `<li>`, so `!contains(target)` is false and it does not close.
      closeMenus();
      if ((hasUnsavedChanges || hasPendingText(currentArgs.current)) && !confirm(NEW_CONFIRM_MESSAGE)) return;
      const data = await openNewImageDialog();
      if (data) setBlankImage(data);
    } catch (error) {
      console.error('Unable to create document', error);
    }
  };

  const openDocument = async () => {
    try {
      // Same ordering rule as `newDocument` above, and for the same reason: the decline
      // path returns before the close used to run.
      closeMenus();
      if ((hasUnsavedChanges || hasPendingText(currentArgs.current)) && !confirm(OPEN_CONFIRM_MESSAGE)) return;
      const data = await openLoadImageDialog();
      if (data) await setImageFromUpload(data);
    } catch (error) {
      console.error('Unable to open document', error);
    }
  };

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
      closeMenus();
    } catch (error) {
      console.error('Unable to prepare document export', error);
    }
  };

  /**
   * Adobe's ten, in Adobe's order. `docs/FEATURES.md`'s `## Menu bar` section is the record
   * of what is built and what is absent; this list is the structure.
   *
* `Edit` carries `Free Transform` at the top level rather than inside `Transform`, which is
 * where Adobe puts it, and `Transform` is a second command beside it rather than the same
 * one: the same Adobe page documents both
 * (<https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/transformation-options-in-adobe-photoshop.html>).
 * `blur`, `draw` and `text` are deliberately absent from `Edit` — all three are Tools-panel
 * tools, a menu is the wrong surface for each, and they stay in the rail.
 *
 * The three rows above the history group are Adobe's `Undo`, `Step Forward` and
 * `Step Backward`, in that order, because Adobe opens `Edit` with the history group and this
 * app's two history commands were button-only until now.
 */
  const menus: readonly MenuHost[] = [
    {
      id: 'file',
      label: 'File',
      className: `${HOST_LIST_CLASS} min-w-[160px]`,
      items: [
        { kind: 'command', label: 'New', testId: 'header-file-new-button', onSelect: () => void newDocument() },
        { kind: 'command', label: 'Open', testId: 'header-file-open-button', onSelect: () => void openDocument() },
        { kind: 'command', label: 'Save', testId: 'header-file-save-button', onSelect: () => void saveDocument() },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      className: `${HOST_LIST_CLASS} min-w-[180px]`,
      items: [
        // Adobe's `Edit` group is `Undo`, `Step Forward`, `Step Backward` — forward BEFORE
        // backward, which is the opposite of the order the words suggest and the order Adobe
        // prints them in. Getting it backwards is exactly the kind of detail that teaches a
        // user the menu is approximate. `Edit > Undo` / `Edit > Step Forward` are also how a
        // Photoshop user reaches the two commands this app had left button-only;
        // `docs/FEATURES.md` recorded them as "missing from the menu, not from the app",
        // which is the kind of gap a menu-bar fix closes. Adobe has no `Redo` item: redo IS
        // `Step Forward`, and this app's `redo` moves one step, so the label is the accurate
        // one rather than a near-miss.
        {
          kind: 'command',
          label: 'Undo',
          testId: 'edit-menu-undo-button',
          // `closeMenus()` inside the handler rather than after it, for the same reason
          // `File ▸ New` has it inside: activating an item is what dismisses the menu, and a
          // guard that returned early before reaching the close would leave the dropdown
          // hanging over the canvas.
          onSelect: () => {
            undo();
            closeMenus();
          },
          disabled: !canUndo(),
        },
        {
          kind: 'command',
          label: 'Step Forward',
          testId: 'edit-menu-step-forward-button',
          onSelect: () => {
            redo();
            closeMenus();
          },
          disabled: !canRedo(),
        },
        // Not built. `useHistory` has no step-backward command — one step back is the History
        // panel's rows, which is where an arbitrary target already lives — so the row records
        // the gap where a user looks for it instead of omitting the neighbour of the two that
        // work.
        { kind: 'unbuilt', label: 'Step Backward' },
        { kind: 'separator' },
        {
          kind: 'command',
          label: 'Free Transform',
          testId: 'edit-menu-free-transform-button',
          onSelect: () => selectTool('transform'),
        },
        // Only `Free Transform` ships. The rest of Adobe's submenu — `Scale`, `Rotate`,
        // `Skew`, `Distort`, `Perspective`, `Warp`, `Rotate 180°`, `Rotate 90° Clockwise`,
        // `Rotate 90° Counter Clockwise`, `Flip Horizontal`, `Flip Vertical` — needs each
        // item to preset that tool's args AND repaint, and `HANDOFF.md` §167 records why
        // that is not a one-liner. Nine items that all select the same tool and repaint
        // nothing is the falsehood this host exists to prevent.
        {
          kind: 'submenu',
          label: 'Transform',
          testId: 'edit-menu-transform-button',
          items: [
            { kind: 'unbuilt', label: 'Scale' },
            { kind: 'unbuilt', label: 'Rotate' },
            { kind: 'unbuilt', label: 'Skew' },
            { kind: 'unbuilt', label: 'Distort' },
            { kind: 'unbuilt', label: 'Perspective' },
            { kind: 'unbuilt', label: 'Warp' },
          ],
        },
      ],
    },
    {
      id: 'image',
      label: 'Image',
      className: `${HOST_LIST_CLASS} min-w-[180px]`,
      items: [
        {
          kind: 'submenu',
          label: 'Adjustments',
          testId: 'image-menu-adjustments-button',
          items: ADJUSTMENTS_ITEMS.map((item) => adjustmentMenuItem(item, selectTool)),
        },
      ],
    },
    {
      id: 'layer',
      label: 'Layer',
      className: `${HOST_LIST_CLASS} min-w-[180px]`,
      items: [
        { kind: 'unbuilt', label: 'Duplicate Layer…' },
        { kind: 'unbuilt', label: 'Layer Mask' },
        { kind: 'unbuilt', label: 'Vector Mask' },
        { kind: 'unbuilt', label: 'Create Clipping Mask' },
        { kind: 'separator' },
        { kind: 'unbuilt', label: 'Group Layers' },
        { kind: 'unbuilt', label: 'Arrange' },
        { kind: 'separator' },
        { kind: 'unbuilt', label: 'Merge Layers' },
        { kind: 'unbuilt', label: 'Merge Visible' },
        {
          // `useLayer.mergeAllLayers` collapses every layer into one layer over the whole
          // canvas, which is what Adobe calls `Flatten Image` — as opposed to `Merge
          // Layers`, which merges one layer DOWN and is the row above it. Both names are
          // above because the two commands are different and only one of them exists here.
          kind: 'command',
          label: 'Flatten Image',
          testId: 'layer-menu-flatten-image-button',
          onSelect: () => {
            void mergeAllLayers();
            closeMenus();
          },
        },
      ],
    },
    {
      id: 'type',
      label: 'Type',
      className: `${HOST_LIST_CLASS} min-w-[200px]`,
      items: [
        { kind: 'unbuilt', label: 'Convert to Shape' },
        { kind: 'unbuilt', label: 'Rasterize Type Layer' },
        { kind: 'unbuilt', label: 'Type Warp' },
        { kind: 'separator' },
        { kind: 'unbuilt', label: 'Font Preview Size' },
        { kind: 'separator' },
        { kind: 'unbuilt', label: 'Update All Text Layers' },
        { kind: 'unbuilt', label: 'Replace All Missing Fonts' },
      ],
    },
    {
      id: 'select',
      label: 'Select',
      className: `${HOST_LIST_CLASS} min-w-[180px]`,
      items: [
        { kind: 'unbuilt', label: 'All' },
        { kind: 'unbuilt', label: 'Deselect' },
        { kind: 'unbuilt', label: 'Reselect' },
        { kind: 'unbuilt', label: 'Inverse' },
        { kind: 'separator' },
        { kind: 'unbuilt', label: 'Select and Mask…' },
        {
          // The five leaves are `docs/TOOLS-TOO-HARD.md`'s `Select ▸ Modify` entry verbatim:
          // Feather, Expand, Contract, Border and Smooth. It is the one submenu here whose
          // subject the repository already documents as a build, so it renders as the
          // structure Adobe has rather than as a flat row that hides where those five live.
          kind: 'submenu',
          label: 'Modify',
          testId: 'select-menu-modify-button',
          items: [
            { kind: 'unbuilt', label: 'Border…' },
            { kind: 'unbuilt', label: 'Smooth…' },
            { kind: 'unbuilt', label: 'Expand…' },
            { kind: 'unbuilt', label: 'Contract…' },
            { kind: 'unbuilt', label: 'Feather…' },
          ],
        },
        { kind: 'unbuilt', label: 'Grow' },
        { kind: 'unbuilt', label: 'Similar' },
        { kind: 'separator' },
        { kind: 'unbuilt', label: 'Load Selection…' },
        { kind: 'unbuilt', label: 'Save Selection…' },
      ],
    },
    {
      id: 'filter',
      label: 'Filter',
      className: `${HOST_LIST_CLASS} min-w-[190px]`,
      items: [
        { kind: 'unbuilt', label: 'Last Filter' },
        { kind: 'separator' },
        { kind: 'unbuilt', label: 'Neural Filters' },
        { kind: 'separator' },
        { kind: 'unbuilt', label: 'Filter Gallery…' },
        { kind: 'unbuilt', label: 'Adaptive Wide Angle…' },
        { kind: 'unbuilt', label: 'Lens Correction…' },
        { kind: 'separator' },
        { kind: 'unbuilt', label: 'Liquify…' },
        { kind: 'unbuilt', label: 'Vanishing Point…' },
      ],
    },
    {
      id: 'view',
      label: 'View',
      className: `${HOST_LIST_CLASS} min-w-[180px]`,
      items: [
        { kind: 'unbuilt', label: 'Zoom In' },
        { kind: 'unbuilt', label: 'Zoom Out' },
        { kind: 'unbuilt', label: 'Fit on Screen' },
        { kind: 'unbuilt', label: '100%' },
        { kind: 'unbuilt', label: 'Print Size' },
        { kind: 'separator' },
        { kind: 'unbuilt', label: 'Extras' },
        { kind: 'separator' },
        { kind: 'unbuilt', label: 'Rulers' },
        { kind: 'separator' },
        { kind: 'unbuilt', label: 'Snap' },
        { kind: 'unbuilt', label: 'Lock Guides' },
        { kind: 'unbuilt', label: 'Clear Guides' },
      ],
    },
    {
      id: 'window',
      label: 'Window',
      // Not the light/dark pair the other nine use. Preserved rather than fixed here: this
      // host's chrome is a visual difference, not a structural one, and re-recording a
      // visual-regression baseline is not a thing this change is allowed to do.
      className:
        'absolute left-0 top-full z-10 min-w-[180px] list-none rounded border border-gray-600 bg-[#2b2f33] p-1 shadow-lg',
      items: [
        {
          kind: 'submenu',
          label: 'Workspace',
          testId: 'window-menu-workspace-button',
          items: [
            {
              kind: 'command',
              label: 'Reset Essentials',
              testId: 'window-menu-workspace-reset-essentials-button',
              onSelect: () => {
                resetWorkspace();
                closeMenus();
              },
            },
            { kind: 'unbuilt', label: 'New Workspace…' },
            { kind: 'unbuilt', label: 'Delete Workspace…' },
          ],
        },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      className: `${HOST_LIST_CLASS} min-w-[180px]`,
      items: [
        { kind: 'unbuilt', label: 'Photoshop Help…' },
        { kind: 'unbuilt', label: 'About Photoshop…' },
      ],
    },
  ];

  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      const node = openMenu === null ? undefined : menuRefs.current.get(openMenu);
      if (node && !node.contains(event.target as Node)) closeMenus();
    },
    [openMenu, closeMenus]
  );

  const {
    isCollapsible: isRightPanelCollapsible,
    isOpen: isRightPanelOpen,
    toggle: toggleRightPanel,
  } = useRightPanelVisibility();

  const { resetWorkspace } = usePanelLayout();

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [handleClickOutside]);

  return (
    <header className="flex h-[50px] items-center bg-[#212529] px-3 max-md:hidden [grid-area:header] dark:bg-gray-950">
      {/* The document's top-level heading, so a screen-reader user has something to
          navigate by and axe's `page-has-heading-one` has something to find. It sits
          INSIDE the header landmark: a bare grid child would fail axe's `region` rule
          instead, which is the rule that caught it here. `sr-only` keeps it out of the
          visual design. `MobileHeader` carries the same heading for the mobile shell. */}
      <h1 className="sr-only">Photo App</h1>
      <ul className="mr-auto flex list-none items-center p-0">
        {menus.map(({ id, label, className, items }) => (
          <li
            className="relative"
            key={id}
            ref={(node) => {
              // An inline callback ref is re-invoked with `null` and then the node on every
              // render, which is why the map is written to rather than rebuilt.
              if (node) menuRefs.current.set(id, node);
              else menuRefs.current.delete(id);
            }}
          >
            <button
              className="bg-transparent px-2 py-1 text-white opacity-75 hover:opacity-100"
              type="button"
              aria-haspopup="true"
              aria-expanded={openMenu === id}
              onClick={() => toggleMenu(id)}
              data-testid={`header-${id}-menu-button`}
            >
              {label}
            </button>
            {openMenu === id && (
              <MenuList
                items={items}
                testId={`header-${id}-menu`}
                className={className}
                openSubmenu={openSubmenu}
                toggleSubmenu={toggleSubmenu}
              />
            )}
          </li>
        ))}
      </ul>
      <div className="ml-auto flex items-center gap-4">
        <button
          className="bg-transparent px-2 py-1 text-white opacity-75 hover:opacity-100"
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          data-testid="theme-toggle-button"
        >
          {theme === 'light' ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
              <path d="M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277q.792-.001 1.533-.16a.79.79 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
              <path d="M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6m0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0m0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13m8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5M3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8m10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0m-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0m9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707M4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708" />
            </svg>
          )}
        </button>
        <HistoryControls />

        {/* Tablet only. `lg:hidden` hides it from 1024px up, and the header itself is
            `max-md:hidden`, so the button is visible in exactly the tablet band and at no
            other width — desktop keeps no trace of it, including no extra grid area, no
            state and no layout shift when the window crosses 1024px. */}
        {isRightPanelCollapsible && (
          <button
            type="button"
            onClick={toggleRightPanel}
            aria-expanded={isRightPanelOpen}
            aria-controls="right-panel"
            aria-label={isRightPanelOpen ? 'Hide layers panel' : 'Show layers panel'}
            title={isRightPanelOpen ? 'Hide layers panel' : 'Show layers panel'}
            className="ml-2 rounded p-1 text-white/75 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-400 lg:hidden"
            data-testid="right-panel-toggle"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              fill="currentColor"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8A2.5 2.5 0 0 1 15 2.5v11a2.5 2.5 0 0 1-2.5 2.5h-8A2.5 2.5 0 0 1 2 13.5zm10.5-1h-9a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V3A1.5 1.5 0 0 0 13.5 1.5" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
};

export default DesktopHeader;
