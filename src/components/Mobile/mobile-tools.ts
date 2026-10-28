import { toolbarMap, type ToolbarTool } from '../../../toolbar-mapping.ts';
import type { ToolName } from '../../contexts/tool-types.ts';

/**
 * One bottom-bar tile. Deliberately the same unit of grouping the desktop rail
 * uses: `SidebarLeft.renderToolGroup` renders a tile per `ToolbarToolGroup` and
 * makes `group[0]` the tile's identity, so a mobile tile derived the same way
 * selects the same tool the desktop tile would.
 */
export interface MobileToolGroup {
  /** Stable across renders and across registry additions, because it is a source index. */
  id: string;
  /** Tile caption: the primary tool's label with the redundant ` Tool` suffix removed. */
  label: string;
  primaryTool: ToolName;
  /**
   * The primary as the registry stores it, `figure` included.
   *
   * Five `toolbarMap` entries share the `shape` name and differ only by `figure`, and the
   * shape group's `group[0]` is `{ name: 'shape', figure: 'rectangle' }`. A tile built from
   * `primaryTool` alone is captioned "Rectangle" and then selects plain `shape`, leaving
   * `figure` at whatever the outgoing tool held — so the tile does not select the figure it
   * is labelled with. `SidebarLeft.selectTool` avoids that by taking the whole `ToolbarTool`.
   */
  primary: ToolbarTool;
  /** Every `ToolName` in the group — what makes the tile read as pressed. */
  matchingTools: ToolName[];
  tools: ToolbarTool[];
  /** Index into `toolbarMap`, so the bar can draw the desktop rail's section breaks. */
  sectionIndex: number;
}

const stripToolSuffix = (label: string) => label.replace(/\s+Tool$/, '');

/**
 * The mobile tool list, derived from the one registry the desktop rail reads.
 *
 * This is the whole fix for the stale hand-written `MOBILE_TOOLS` array: that
 * list predated `eraser`, `magic-eraser`, `paint-bucket` and `eyedropper` and
 * nothing failed when they landed, because it was a `MobileToolItem[]` that
 * nothing type-checked against `ToolName`. `toolbarMap` is the single source of
 * truth for which tools exist and how they group, so a new tool reaches the
 * mobile bar by being added there, once.
 *
 * A tile selects `group[0]`, so `MobileToolSheet` renders the other members of
 * the same groups as its tool picker. Without that picker the five members of
 * the brush group and the six of the shape group would be unreachable on
 * mobile — the same class of trap the old list had.
 */
export const mobileToolGroups: MobileToolGroup[] = toolbarMap.flatMap((section, sectionIndex) =>
  section.map((group, groupIndex) => {
    const primary = group[0];
    return {
      id: `mobile-tool-${sectionIndex}-${groupIndex}`,
      label: stripToolSuffix(primary.label),
      primaryTool: primary.name,
      primary,
      matchingTools: [...group].map((tool) => tool.name),
      tools: [...group],
      sectionIndex,
    };
  })
);

/**
 * Select a `ToolbarTool`, patching `figure` when the entry carries one.
 *
 * One definition, shared by the bottom-bar tile and the tool sheet's picker, because the
 * two disagreed for a revision: the sheet patched the figure and the bar did not, so the
 * "Rectangle" tile selected plain `shape`.
 *
 * Selection happens before the figure patch, matching the desktop rail and header:
 * `goToTool` runs `commitDirtyTool()` against the OUTGOING tool (`useApp.ts`), which reads the
 * outgoing args, so patching the incoming tool's args first would clobber the values the
 * commit needs.
 */
export const makeSelectTool =
  (
    goToTool: (name: ToolName) => boolean | void,
    patchToolArgs: (name: ToolName, args: { figure: string }) => void
  ): ((tool: ToolbarTool) => void) =>
  (tool) => {
    if (goToTool(tool.name) === false) return;
    if (tool.figure) patchToolArgs('shape', { figure: tool.figure });
  };

/** The group the current tool belongs to, or `undefined` for an unregistered tool name. */
export const findMobileToolGroup = (toolName: ToolName | undefined | null) =>
  toolName ? mobileToolGroups.find((group) => group.matchingTools.includes(toolName)) : undefined;
