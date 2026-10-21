import { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext.tsx';
import HistoryControls from '../HistoryControls/HistoryControls';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useApp } from '../../hooks/useApp.ts';
import { useFile } from '../../contexts/useFile.tsx';
import { MENU_ITEM_BUTTON } from '../ToolbarsRight/buttonStyles.ts';
import { useLayers } from '../../contexts/useLayer.ts';
import { flushSync } from 'react-dom';
import { useUnsavedChanges } from '../../contexts/UnsavedChangesContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { extraTools, slugifyToolLabel } from '../../../toolbar-mapping.ts';
import { useRightPanelVisibility } from '../../contexts/RightPanelVisibility.tsx';
import { usePanelLayout } from '../../contexts/PanelLayout.tsx';
import type { ToolName } from '../../contexts/tool-types.ts';
import type { FigureType } from '../../tools/shape.ts';

/**
 * A second, non-exhaustive surface over the same tool set. `Array` rather than an
 * exhaustive type, so nothing forces it to stay in step with `toolbarMap` — which is
 * exactly why it is written out here: a tool missing from the Tools menu is a visible
 * inconsistency the user has to notice and work around.
 *
 * The eleven entries added with the tool expansion carry the same labels
 * `toolbar-mapping.ts` spells, and sit in the same relative order: selection tools after
 * the lasso and wand, then the paint family (brush … burn), then the eyedropper.
 *
 * **`MENUS_EXCLUDE` is the deliberate part of "non-exhaustive", and it is exactly six
 * tools, for two separate reasons.**
 *
 * Add Anchor Point, Delete Anchor Point and Convert Point are absent because they are absent
 * from Photoshop's own Tools panel too — they modify a path rather than paint, and Photoshop
 * reaches them from the Pen's context menu and the path-modification commands, not from the
 * Tools panel or the Tools menu. `color`, `levels` and `transform` are absent for the other
 * reason: they are `Image ▸ Adjustments` and `Edit ▸ Free Transform` COMMANDS, which are the
 * same defect one level up from a missing tool — a command is not a tool, and a Tools-panel
 * entry for one is a falsehood in the list whose own header calls a missing tool "a visible
 * inconsistency the user has to notice and work around." They are in `ADJUSTMENTS_ITEMS` and
 * in the `Edit` menu below instead, and `toolbar-mapping.ts`'s `extraTools` names them as the
 * registered tool ids with no rail entry. All six are in `availableTools` because they are
 * selectable tools; none of them is a Tools-menu item.
 *
 * Every OTHER `availableTools` name must produce a row. That was not true until the test
 * below was derived from the registry: the assertion was a hand-written list of 24 names that
 * never mentioned the Dodge, the Burn, the Smudge, the Sharpen or the Magic Eraser, so the
 * Sponge shipped with no Tools-menu entry and the test stayed green.
 */
/**
 * The registered tools this menu deliberately does not list, and the ONLY ids allowed to be
 * missing from it — every other `availableTools` name must produce a row, which is what
 * `DesktopHeader.test.tsx` enforces by walking the registry.
 *
 * Two groups, two mechanisms, and they are not interchangeable. The three pen point-tools
 * modify a path, which Photoshop reaches from the Pen's context menu rather than from a
 * Tools panel. The three adjustment commands are not tools at all: they left the rail in
 * `4037463b`, which is also where they were added to this list — `MENUS_EXCLUDE` itself is
 * older, introduced by `dd234bad` with the pen tools alone — and they are hosted by
 * `Image ▸ Adjustments` and `Edit ▸ Free Transform`. See the note at the top of this file,
 * which is the authority for both.
 *
 * The second group is SPREAD from `toolbar-mapping.ts`'s `extraTools` rather than written
 * out, so the rail and this menu cannot disagree about which ids are commands: a fourth
 * id that leaves the rail is added to that export, and `toolbar-mapping.test.ts` fails
 * until it is.
 */
export const MENUS_EXCLUDE: readonly ToolName[] = [
  'add-anchor-point',
  'delete-anchor-point',
  'convert-point',
  ...extraTools,
];

const TOOL_MENU_ITEMS: Array<{ toolName: ToolName; label: string }> = [
  { toolName: 'reposition', label: 'Reposition' },
  { toolName: 'hand', label: 'Hand Tool' },
  { toolName: 'zoom', label: 'Zoom Tool' },
  { toolName: 'rotate-view', label: 'Rotate View Tool' },
  { toolName: 'blur', label: 'Blur' },
  { toolName: 'crop', label: 'Crop' },
  { toolName: 'draw', label: 'Draw' },
  { toolName: 'shape', label: 'Shape' },
  { toolName: 'text', label: 'Text' },
  { toolName: 'polygonal-lasso', label: 'Polygonal Lasso' },
  { toolName: 'freehand-lasso', label: 'Freehand Lasso' },
  { toolName: 'feather-magnetic-lasso', label: 'Feather Magnetic Lasso' },
  { toolName: 'magic-wand', label: 'Magic Wand' },
  { toolName: 'quick-selection', label: 'Quick Selection Tool' },
  { toolName: 'rectangular-selection', label: 'Rectangular Selection' },
  { toolName: 'elliptical-selection', label: 'Elliptical Marquee Tool' },
  { toolName: 'single-row-marquee', label: 'Single Row Marquee Tool' },
  { toolName: 'single-column-marquee', label: 'Single Column Marquee Tool' },
  { toolName: 'brush', label: 'Brush Tool' },
  { toolName: 'pencil', label: 'Pencil Tool' },
  { toolName: 'color-replacement', label: 'Color Replacement Tool' },
  { toolName: 'spot-healing', label: 'Spot Healing Brush Tool' },
  { toolName: 'healing-brush', label: 'Healing Brush Tool' },
  { toolName: 'patch', label: 'Patch Tool' },
  { toolName: 'red-eye', label: 'Red Eye Correction Tool' },
  { toolName: 'eraser', label: 'Eraser Tool' },
  { toolName: 'clone-stamp', label: 'Clone Stamp Tool' },
  { toolName: 'ruler', label: 'Ruler Tool' },
  { toolName: 'sharpen', label: 'Sharpen Tool' },
  { toolName: 'smudge', label: 'Smudge Tool' },
  { toolName: 'paint-bucket', label: 'Paint Bucket Tool' },
  { toolName: 'magic-eraser', label: 'Magic Eraser Tool' },
  { toolName: 'gradient', label: 'Gradient Tool' },
  { toolName: 'dodge', label: 'Dodge Tool' },
  { toolName: 'burn', label: 'Burn Tool' },
  { toolName: 'sponge', label: 'Sponge Tool' },
  { toolName: 'eyedropper', label: 'Eyedropper Tool' },
  { toolName: 'color-sampler', label: 'Color Sampler Tool' },
  { toolName: 'pen', label: 'Pen Tool' },
  { toolName: 'freeform-pen', label: 'Freeform Pen Tool' },
  { toolName: 'curvature-pen', label: 'Curvature Pen Tool' },
  { toolName: 'rectangle', label: 'Rectangle Tool' },
  { toolName: 'ellipse', label: 'Ellipse Tool' },
  { toolName: 'triangle', label: 'Triangle Tool' },
  { toolName: 'polygon', label: 'Polygon Tool' },
  { toolName: 'line', label: 'Line Tool' },
  { toolName: 'custom-shape', label: 'Custom Shape Tool' },
];

/**
 * The five figure entries above are the *second* selection surface for the figures
 * — the sidebar already selects them as `toolName: 'shape'` plus a `figure` patch.
 * Dispatching the registered figure `ToolName`s directly mounted the Shape panel
 * with a figure-specific tool name, bypassing the shared shape-family route and
 * leaving the panel's colour synchronization dependent on the wrong args shape.
 *
 * So route them through the same path the sidebar uses, which keeps every surface
 * on the shared shape-family state path rather than special-casing this menu.
 *
 * `ellipse` is the trap: the registered `ToolName` is `ellipse` but the stored
 * figure is `oval`, exactly as `toolbar-mapping.ts:77` spells it.
 */
const FIGURE_TOOLS: Partial<Record<ToolName, FigureType>> = {
  rectangle: 'rectangle',
  ellipse: 'oval',
  triangle: 'triangle',
  polygon: 'polygon',
  line: 'line',
};

/**
 * One item of a menu host.
 *
 * **`toolName` is absent on an item the app cannot do, and that renders it `disabled`.** A
 * disabled item is a capability recorded as unbuilt, not a fake one. The rule this file is
 * shaped by is `docs/TOOLS-TOO-HARD.md`'s: a capability the app cannot do is neither
 * shipped half-versioned nor quietly absent. Adobe's menu carries the entry, it is spelled
 * Adobe's way, and it cannot be activated — so the gap is visible where a user looks for
 * it instead of only in a document. Photoshop greys out most of `Image ▸ Adjustments`
 * itself whenever the active document cannot take the command.
 *
 * The distinction is structural rather than a flag, so the two cases cannot drift: an item
 * becomes enabled by having a `toolName` and nothing else. Removing a disabled item needs
 * the capability to land, not a decision.
 */
type MenuHostItem = {
  label: string;
  toolName?: ToolName;
};

/**
 * `Image ▸ Adjustments`, as close to Adobe's order as Adobe's own pages allow.
 *
 * Membership is Adobe-confirmed item by item. The ORDER is reconstructed, and the
 * reconstruction is not uniform across the list, so the confidence is not either:
 *
 * - **The tonal head is settled.** Adobe publishes no page that enumerates this submenu top
 *   to bottom — `helpx.adobe.com/photoshop/using/adjusting-image-color.html` is a 404 and
 *   `…/using/panels-menus.html` has an "Image adjustments" TOC entry with no body under it.
 *   Two Adobe pages do order the tonal group identically, though neither calls it a menu:
 *   `…/using/color-adjustments.html`'s command list runs `Levels · Curves · Exposure`, and
 *   `…/desktop/create-manage-layers/color-adjustment-fill-layers/adjustment-layers-options.html`
 *   (last updated 2026-02-23) runs `Brightness/Contrast · Levels · Curves · Exposure`. That is
 *   why `Levels` is second here and `Curves` precedes `Exposure`; `Levels` used to be last,
 *   which no source supports.
 * - **Everything from `Vibrance` down is a hypothesis.** Those two pages disagree with each
 *   other from `Vibrance` on — one puts `Photo Filter` immediately after `Vibrance`, the other
 *   after `Black & White` — and neither orders `Shadows/Highlights`, `HDR Toning`, `Desaturate`,
 *   `Match Color`, `Replace Color` or `Equalize` at all. No reputable third party transcribes
 *   the submenu in order either. Treat the rest as a good guess under the same provenance rule
 *   `docs/PHOTOSHOP-UX.md`'s "Confidence and provenance" section applies to the rail, and
 *   re-derive it if Adobe ever documents the menu itself.
 * - Three near-misses are deliberately NOT here: `Auto Tone`, `Auto Contrast` and `Auto Color`
 *   are `Image` items rather than submenu items (Adobe, `…/using/making-quick-tonal-adjustments.html`),
 *   and `Color Blindness Simulation` is not in this menu at all.
 *
 * Two items are enabled, and each is enabled because its computation is the Adobe command
 * it is named for:
 *
 * - **`Brightness/Contrast` → the `levels` id.** `LevelsToolArgs` is
 *   `{ brightness, contrast }` (`src/tools/levels.ts`) and the processor emits one
 *   `brightness(…) contrast(…)` filter, which is Adobe's Brightness/Contrast and not
 *   Adobe's Levels. Naming it `Levels` under a menu that is supposed to be a clone is the
 *   falsehood this rename removes.
 * - **`Desaturate` → the `color` id.** Adobe's Desaturate "converts a color image to
 *   grayscale values, but leaves the image in the same color mode", and "assigns equal red,
 *   green, and blue values to each pixel in an RGB image" — which is what the bar's
 *   **Grayscale** slider does at 100. Adobe adds that the command "has the same effect as
 *   setting Saturation to minus (-)100 in the Hue/Saturation adjustment", which is the bar's
 *   **Saturation** slider
 *   (<https://helpx.adobe.com/photoshop/using/applying-special-color-effects-images.html>). **`Sepia` is the bounded divergence**: it belongs to neither command, and
 *   Adobe's Desaturate is a one-shot command with no dialog at all, where this bar is three
 *   continuous sliders.
 *
 *   **This item used to be `Photo Filter`.** Adobe's Photo Filter is a lens filter applied
 *   "from a preset filter or a custom color filter", with a **Density** slider and a
 *   **Preserve Luminosity** option, and the bar reproduced **none** of those three — so an
 *   enabled item opened a bar whose controls did not contain the command its label named.
 *   `Photo Filter` is a `disabled` item now, which is this file's own rule applied: the
 *   capability is unbuilt. `Desaturate` is the Adobe name in the same submenu the bar's
 *   leading control actually computes, which is what `docs/TOOLS-TOO-HARD.md`'s enabled-items
 *   entry requires of an adjustment command — an item whose computation does not match its
 *   Adobe name is a falsehood and does not get enabled. Moving the row rather than dropping
 *   it is what keeps `color` reachable at all: it is in `extraTools`, so it has no rail tile
 *   and no `tools-menu-color-button`, and this submenu is the only path into the panel.
 *
 * **`Levels`, `Curves`, `Exposure`, `Black and White`, `Hue/Saturation`, `Vibrance`,
 * `Color Balance`, `Channel Mixer`, `Selective Color`, `Photo Filter`, `Invert`,
 * `Posterize`, `Threshold`, `Gradient Map`, `Equalize`, `Shadows/Highlights`, `HDR Toning`,
 * `Match Color`, `Replace Color` and `Color Lookup` are all disabled**, which is the
 * accurate state of this app: it has no adjustment layers at all, and
 * `src/contexts/psd-utils.ts` reports `adjustment` as unsupported on import. What exists
 * instead is a retained per-layer operation stack, which keeps an adjustment but cannot
 * re-edit it and has no properties panel.
 */
const ADJUSTMENTS_ITEMS: readonly MenuHostItem[] = [
  { label: 'Brightness/Contrast', toolName: 'levels' },
  { label: 'Levels' },
  { label: 'Curves' },
  { label: 'Exposure' },
  { label: 'Vibrance' },
  { label: 'Hue/Saturation' },
  { label: 'Color Balance' },
  { label: 'Black and White' },
  { label: 'Photo Filter' },
  { label: 'Channel Mixer' },
  { label: 'Color Lookup' },
  { label: 'Selective Color' },
  { label: 'Shadows/Highlights' },
  { label: 'HDR Toning' },
  { label: 'Desaturate', toolName: 'color' },
  { label: 'Match Color' },
  { label: 'Replace Color' },
  { label: 'Invert' },
  { label: 'Equalize' },
  { label: 'Gradient Map' },
  { label: 'Posterize' },
  { label: 'Threshold' },
];

const DesktopHeader = () => {
  const [{ fileName, totalSize, documentFrame, hasImage }] = useStore();
  const { commitDirtyTool } = useLayers();
  const { goToTool, setBlankImage, setImageFromUpload, handleImageSave } = useApp();
  const { openNewImageDialog, openLoadImageDialog, openSaveImageDialog } = useFile();
  const { confirmDiscard } = useUnsavedChanges();
  const { patchToolArgs } = useCurrentTool();

  const { theme, toggleTheme } = useTheme();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // Which submenu is expanded inside the open host. Keyed by the host, so switching from
  // `image` to `edit` cannot leave a stale submenu expanded — and it is deliberately not
  // two booleans, because a single value cannot disagree with itself.
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const fileMenuRef = useRef<HTMLLIElement>(null);
  const toolsMenuRef = useRef<HTMLLIElement>(null);
  const imageMenuRef = useRef<HTMLLIElement>(null);
  const editMenuRef = useRef<HTMLLIElement>(null);
  const windowMenuRef = useRef<HTMLLIElement>(null);

  // One toggle for both hosts, so the click that opens a menu is also the click that
  // collapses whatever submenu it had expanded.
  const toggleMenu = (id: string) => {
    setOpenMenu((current) => (current === id ? null : id));
    setOpenSubmenu(null);
  };

  const toggleSubmenu = (id: string) => setOpenSubmenu((current) => (current === id ? null : id));

  // The five hosts, addressed by the same ids `openMenu` holds, so one close path can put
  // focus back on whichever button opened what it just closed.
  const menuHostRefs: Record<string, React.RefObject<HTMLLIElement | null>> = {
    file: fileMenuRef,
    tools: toolsMenuRef,
    image: imageMenuRef,
    edit: editMenuRef,
    window: windowMenuRef,
  };

  // The item that was activated unmounts with its dropdown, and nothing else holds focus,
  // so the browser drops it to `<body>` and the next Tab restarts at the top of the
  // document. Focus belongs back on the host that opened the menu, which stays mounted.
  const closeMenus = () => {
    if (openMenu !== null) menuHostRefs[openMenu]?.current?.querySelector('button')?.focus();
    setOpenMenu(null);
    setOpenSubmenu(null);
  };

  const handleToolSelection = (toolName: ToolName) => {
    const figure = FIGURE_TOOLS[toolName];
    // Select first, then patch — deliberately *not* the order
    // `SidebarLeft.selectTool` uses. `goToTool` runs `commitDirtyTool()` against the
    // OUTGOING tool (`useApp.ts:167`), and `patchToolArgs` writes straight into the
    // live `currentArgsRef` (`useCurrentTool.tsx:61`). Patching first would leave the
    // text branch at `useLayer.ts:257` reading shape args — no `.text`, no `.rect` —
    // so it early-returns and an unapplied text layer is dropped with nothing to undo.
    // Selecting first lets that commit read the text args it is meant to read.
    if (figure !== undefined) {
      if (goToTool('shape') === false) return;
      patchToolArgs('shape', { figure });
    } else {
      if (goToTool(toolName) === false) return;
    }
    closeMenus();
  };

  const handleFreeTransform = () => handleToolSelection('transform');

  const handleResetWorkspace = () => {
    resetWorkspace();
    closeMenus();
  };

  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      if (openMenu === 'file' && fileMenuRef.current && !fileMenuRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
      if (openMenu === 'tools' && toolsMenuRef.current && !toolsMenuRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
      if (openMenu === 'image' && imageMenuRef.current && !imageMenuRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
      if (openMenu === 'edit' && editMenuRef.current && !editMenuRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
      if (openMenu === 'window' && windowMenuRef.current && !windowMenuRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    },
    [openMenu]
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

  // Escape closes whatever is open, and the listener exists only while something is. With
  // no menu open the key belongs to whoever else handles it — the Transform panel cancels a
  // pending transform on Escape (`Transform.tsx:41`, on `window`) — so this must not consume
  // it. It does consume it while a menu IS open, because `stopPropagation` on `document`
  // stops the event reaching a `window` listener: the menu is the topmost thing open, so it
  // takes the first press and the panel takes the second. The dropdowns had no keyboard
  // dismissal at all before this, while the rail's flyout closes the same way
  // (`SidebarLeft.tsx:554-564`).
  useEffect(() => {
    if (openMenu === null) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeMenus();
      event.stopPropagation();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  });

  return (
    <header className="flex h-[50px] items-center bg-[#212529] px-3 max-md:hidden [grid-area:header] dark:bg-gray-950">
      {/* The document's top-level heading, so a screen-reader user has something to
          navigate by and axe's `page-has-heading-one` has something to find. It sits
          INSIDE the header landmark: a bare grid child would fail axe's `region` rule
          instead, which is the rule that caught it here. `sr-only` keeps it out of the
          visual design. `MobileHeader` carries the same heading for the mobile shell. */}
      <h1 className="sr-only">Photo App</h1>
      <ul className="mr-auto flex list-none items-center p-0">
        <li className="relative" ref={fileMenuRef}>
          <button
            className="bg-transparent px-2 py-1 text-white opacity-75 hover:opacity-100"
            type="button"
            onClick={() => toggleMenu('file')}
            aria-haspopup="true"
            aria-expanded={openMenu === 'file'}
            data-testid="header-file-menu-button"
          >
            File
          </button>
          {openMenu === 'file' && (
            <ul
              className="absolute left-0 top-full z-10 m-0 min-w-[160px] list-none rounded bg-white py-2 shadow-lg dark:bg-gray-800"
              data-testid="header-file-menu"
            >
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                  type="button"
                  onClick={async () => {
                    try {
                      // Dismissing the menu is what activating an item means, so it happens
                      // FIRST and unconditionally. It used to sit after the action, which
                      // made the decline path — the one branch that returns early — leave the
                      // dropdown hanging over the top-left of the canvas, and left it hanging
                      // on the `catch` path too. `handleClickOutside` cannot rescue either:
                      // the mousedown that opened this state already fired inside
                      // `fileMenuRef`, so `!contains(target)` is false and it does not close.
                      setOpenMenu(null);
                      if (!(await confirmDiscard('new-document'))) return;
                      const data = await openNewImageDialog();
                      if (data) setBlankImage(data);
                    } catch (error) {
                      console.error('Unable to create document', error);
                    }
                  }}
                  data-testid="header-file-new-button"
                >
                  New
                </button>
              </li>
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                  type="button"
                  onClick={async () => {
                    try {
                      // Same ordering rule as New above, and for the same reason: the decline
                      // path returns before the close used to run.
                      setOpenMenu(null);
                      if (!(await confirmDiscard('open-document'))) return;
                      const data = await openLoadImageDialog();
                      if (data) await setImageFromUpload(data);
                    } catch (error) {
                      console.error('Unable to open document', error);
                    }
                  }}
                  data-testid="header-file-open-button"
                >
                  Open
                </button>
              </li>
              <li>
                <button
                  className="w-full bg-transparent px-4 py-1 text-left text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                  type="button"
                  onClick={async () => {
                    try {
                      if (!hasImage) return;
                      let exportLayers!: ReturnType<typeof commitDirtyTool>;
                      flushSync(() => {
                        exportLayers = commitDirtyTool();
                      });
                      if (exportLayers === null) return;
                      const data = await openSaveImageDialog({
                        fileName,
                        layers: exportLayers,
                        size: totalSize,
                        documentFrame,
                      });
                      if (data) handleImageSave(data);
                      setOpenMenu(null);
                    } catch (error) {
                      console.error('Unable to prepare document export', error);
                    }
                  }}
                  data-testid="header-file-save-button"
                >
                  Save
                </button>
              </li>
            </ul>
          )}
        </li>
        <li className="relative" ref={toolsMenuRef}>
          <button
            className="bg-transparent px-2 py-1 text-white opacity-75 hover:opacity-100"
            type="button"
            onClick={() => toggleMenu('tools')}
            aria-haspopup="true"
            aria-expanded={openMenu === 'tools'}
            data-testid="header-tools-menu-button"
          >
            Tools
          </button>
          {openMenu === 'tools' && (
            <ul
              className="absolute left-0 top-full z-10 m-0 min-w-[200px] list-none rounded bg-white py-2 shadow-lg dark:bg-gray-800"
              data-testid="header-tools-menu"
            >
              {TOOL_MENU_ITEMS.map(({ toolName, label }) => (
                <li key={toolName}>
                  <button
                    className={MENU_ITEM_BUTTON}
                    type="button"
                    onClick={() => handleToolSelection(toolName)}
                    data-testid={`tools-menu-${toolName}-button`}
                  >
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </li>
        <li className="relative" ref={imageMenuRef}>
          <button
            className="bg-transparent px-2 py-1 text-white opacity-75 hover:opacity-100"
            type="button"
            onClick={() => toggleMenu('image')}
            aria-haspopup="true"
            aria-expanded={openMenu === 'image'}
            data-testid="header-image-menu-button"
          >
            Image
          </button>
          {openMenu === 'image' && (
            <ul
              className="absolute left-0 top-full z-10 m-0 min-w-[180px] list-none rounded bg-white py-2 shadow-lg dark:bg-gray-800"
              data-testid="header-image-menu"
            >
              <li className="relative">
                {/* A real `<button>` that owns the submenu, not a hover-only `<span>`: a
                    hover affordance would put every item in this submenu out of reach of a
                    keyboard, which is the one input that cannot recover from a missing
                    `:hover`. `aria-expanded` is what tells a screen reader the same thing. */}
                <button
                  className={MENU_ITEM_BUTTON}
                  type="button"
                  aria-haspopup="true"
                  aria-expanded={openSubmenu === 'image-adjustments'}
                  onClick={() => toggleSubmenu('image-adjustments')}
                  data-testid="image-menu-adjustments-button"
                >
                  Adjustments
                </button>
                {openSubmenu === 'image-adjustments' && (
                  <ul
                    className="absolute left-full top-0 z-20 m-0 min-w-[220px] list-none rounded border border-gray-300 bg-white py-2 shadow-lg dark:border-gray-600 dark:bg-gray-800"
                    data-testid="image-menu-adjustments"
                  >
                    {ADJUSTMENTS_ITEMS.map((item) => {
                      const slug = slugifyToolLabel(item.label);
                      // Bound to a `const` before the closure so the check is one read and
                      // the handler carries no narrowing of its own.
                      const toolName = item.toolName;
                      return (
                        <li key={slug}>
                          <button
                            className={MENU_ITEM_BUTTON}
                            type="button"
                            disabled={toolName === undefined}
                            onClick={() => toolName !== undefined && handleToolSelection(toolName)}
                            data-testid={`image-menu-adjustments-${slug}-button`}
                          >
                            {item.label}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            </ul>
          )}
        </li>
        <li className="relative" ref={editMenuRef}>
          <button
            className="bg-transparent px-2 py-1 text-white opacity-75 hover:opacity-100"
            type="button"
            onClick={() => toggleMenu('edit')}
            aria-haspopup="true"
            aria-expanded={openMenu === 'edit'}
            data-testid="header-edit-menu-button"
          >
            Edit
          </button>
          {/* Adobe's `Edit` menu holds `Free Transform` at the top level rather than inside the
              `Transform` submenu, and the submenu is a separate command besides — the same Adobe
              page documents both (https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/transformation-options-in-adobe-photoshop.html).
              So this host is one item and not a bag of tool switches. `blur`, `draw` and
              `text` used to live here; all three are Tools-panel tools, so a menu is the
              wrong surface for each of them and they stay in the rail and the Tools menu
              above.

              Only `Free Transform` ships. The rest of Adobe's submenu — `Scale`, `Rotate`,
              `Skew`, `Distort`, `Perspective`, `Warp`, `Rotate 180°`, `Rotate 90° Clockwise`,
              `Rotate 90° Counter Clockwise`, `Flip Horizontal`, `Flip Vertical` — needs each
              item to preset that tool's args AND repaint, and `HANDOFF.md` §167 records why
              that is not a one-liner. Nine items that all select the same tool and repaint
              nothing is the falsehood this host exists to prevent. */}
          {openMenu === 'edit' && (
            <ul
              className="absolute left-0 top-full z-10 m-0 min-w-[160px] list-none rounded bg-white py-2 shadow-lg dark:bg-gray-800"
              data-testid="header-edit-menu"
            >
              <li>
                <button
                  className={MENU_ITEM_BUTTON}
                  type="button"
                  onClick={handleFreeTransform}
                  data-testid="edit-menu-free-transform-button"
                >
                  Free Transform
                </button>
              </li>
            </ul>
          )}
        </li>
        {/* `Window`, because that is where Photoshop keeps the panel commands: "Select Window
            from the menu bar. Select the panel name to remove it from the workspace" and
            "Window > Workspace > Reset > Essentials (Default)". Only the reset is here, and
            only because a draggable layout that persists needs the documented way back —
            "Select Window > Workspace > Reset to restore the last arrangement you had before
            a panel went missing."
            (https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/move-panels.html) */}
        <li className="relative" ref={windowMenuRef}>
          <button
            className="bg-transparent px-2 py-1 text-white opacity-75 hover:opacity-100"
            type="button"
            onClick={() => toggleMenu('window')}
            aria-haspopup="true"
            aria-expanded={openMenu === 'window'}
            data-testid="header-window-menu-button"
          >
            Window
          </button>
          {openMenu === 'window' && (
            <ul
              className="absolute left-0 top-full z-10 min-w-[180px] list-none rounded border border-gray-600 bg-[#2b2f33] p-1 shadow-lg"
              data-testid="header-window-menu"
            >
              <li>
                <button
                  className={MENU_ITEM_BUTTON}
                  type="button"
                  onClick={handleResetWorkspace}
                  data-testid="window-menu-reset-workspace-button"
                >
                  Reset Workspace
                </button>
              </li>
            </ul>
          )}
        </li>
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
