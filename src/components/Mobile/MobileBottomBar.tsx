import React from 'react';

import type { ToolName } from '../../contexts/tool-types.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useApp } from '../../hooks/useApp.ts';
import {
  isMobileToolOptionsMounted,
  makeSelectTool,
  mobileToolGroups,
  MOBILE_TOOL_OPTIONS_ID,
} from './mobile-tools.ts';

export interface MobileBottomBarProps {
  onToggleToolSheet: () => void;
  isToolSheetOpen: boolean;
  onOpenLayers: () => void;
}

export const MobileBottomBar: React.FC<MobileBottomBarProps> = ({
  onToggleToolSheet,
  isToolSheetOpen,
  onOpenLayers,
}) => {
  const [{ toolName, hasImage }] = useStore();
  const { goToTool } = useApp();
  const { patchToolArgs } = useCurrentTool();
  const toolOptionsMounted = isMobileToolOptionsMounted(isToolSheetOpen, toolName, hasImage);
  const selectTool = makeSelectTool(goToTool, patchToolArgs);

  return (
    <nav
      role="toolbar"
      aria-label="Mobile Bottom Toolbar"
      aria-orientation="horizontal"
      data-testid="mobile-bottom-bar"
      className="[grid-area:bottom] md:hidden safe-area-bottom fixed bottom-0 left-0 right-0 z-30 flex h-16 items-stretch gap-1 overflow-x-auto overscroll-x-contain scrollbar-none touch-pan-x border-t border-gray-200 bg-white/95 px-1 backdrop-blur-md select-none dark:border-gray-800 dark:bg-gray-900/95"
    >
      {mobileToolGroups.map((group, index) => {
        const isActive = group.matchingTools.includes(toolName as ToolName);
        const isSectionStart = index > 0 && group.sectionIndex !== mobileToolGroups[index - 1].sectionIndex;

        return (
          <React.Fragment key={group.id}>
            {isSectionStart && (
              <span aria-hidden="true" className="my-2 w-px shrink-0 self-stretch bg-gray-200 dark:bg-gray-800" />
            )}
            <button
              type="button"
              disabled={!hasImage}
              onClick={() => selectTool(group.primary)}
              data-testid={group.id}
              aria-label={group.tools[0].label}
              aria-pressed={isActive}
              className={`flex min-w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 transition-colors ${
                isActive
                  ? 'bg-blue-50 font-bold text-blue-600 dark:bg-blue-500/15 dark:text-blue-400'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'
              } disabled:pointer-events-none disabled:opacity-30`}
            >
              <span className="max-w-full truncate text-[11px] leading-tight">{group.label}</span>
            </button>
          </React.Fragment>
        );
      })}

      <span aria-hidden="true" className="my-2 w-px shrink-0 self-stretch bg-gray-200 dark:bg-gray-800" />

      {/* The options sheet has its own control. A tool tile selecting its own tool
          is a different concern: the tile that grouped the adjustments compared
          `matchingTools` against the current tool and, on a match, opened the sheet
          instead of selecting, so with `levels` active a tap on Adjust never reached
          `color`. That tile left the rail with the other adjustment commands, so no
          mobile group holds two ids that can collide here any more; the rule stays
          because a group can hold two again. */}
      <button
        type="button"
        disabled={!hasImage}
        onClick={onToggleToolSheet}
        data-testid="mobile-tool-options-toggle"
        aria-label="Tool options"
        aria-expanded={isToolSheetOpen}
        // Gated for the same reason as the three triggers already fixed, and on the SHARED
        // predicate rather than `isToolSheetOpen`. The panel this names lives in
        // `MobileToolSheet`, which `MobileShell` renders as a SIBLING and which returns null
        // outright without a tool name or an image — so the open flag is only one clause of the
        // panel's existence, and a bar that stayed mounted while the sheet did not would advertise
        // an id nothing owns beside `aria-expanded="true"`.
        aria-controls={toolOptionsMounted ? MOBILE_TOOL_OPTIONS_ID : undefined}
        className={`flex min-w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 transition-colors ${
          isToolSheetOpen
            ? 'bg-blue-50 font-bold text-blue-600 dark:bg-blue-500/15 dark:text-blue-400'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'
        } disabled:pointer-events-none disabled:opacity-30`}
      >
        <span aria-hidden="true" className="text-base leading-none">
          ⚙
        </span>
        <span className="text-[11px] leading-tight">Options</span>
      </button>

      <button
        type="button"
        disabled={!hasImage}
        onClick={onOpenLayers}
        data-testid="mobile-bottom-layers-button"
        aria-label="Layers"
        className="flex min-w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:pointer-events-none disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      >
        <span aria-hidden="true" className="text-base leading-none">
          📑
        </span>
        <span className="text-[11px] leading-tight">Layers</span>
      </button>
    </nav>
  );
};
