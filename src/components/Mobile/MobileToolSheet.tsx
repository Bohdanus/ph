import React from 'react';

import { toolsMap } from '../../tools/toolsMap.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useApp } from '../../hooks/useApp.ts';
import type { ToolbarTool } from '../../../toolbar-mapping.ts';
import { findMobileToolGroup } from './mobile-tools.ts';

export interface MobileToolSheetProps {
  isOpen: boolean;
  onToggle: () => void;
}

export const MobileToolSheet: React.FC<MobileToolSheetProps> = ({ isOpen, onToggle }) => {
  const [{ hasImage, toolName }] = useStore();
  const { isToolDirty, toolArgs, patchToolArgs } = useCurrentTool();
  const { goToTool } = useApp();

  if (!toolName || !hasImage) return null;

  const toolMeta = toolsMap[toolName];
  const ToolComponent = toolMeta?.toolboxComponent;
  const group = findMobileToolGroup(toolName);

  // Same identity rule as `SidebarLeft.isToolSelected`: five `toolbarMap` entries
  // share the `shape` tool name and differ only by `figure`, so the name alone
  // would light up all five.
  const isToolSelected = (tool: ToolbarTool) =>
    tool.name === toolName && (!tool.figure || (toolArgs.toolName === 'shape' && toolArgs.figure === tool.figure));

  const selectTool = (tool: ToolbarTool) => {
    if (tool.figure) {
      // Select first, then patch — the order `DesktopHeader.handleToolSelection`
      // uses, and deliberately not the order `SidebarLeft.selectTool` uses:
      // `goToTool` runs `commitDirtyTool()` against the OUTGOING tool, so
      // patching the incoming tool's args first clobbers the args the commit
      // needs to read.
      goToTool(tool.name);
      patchToolArgs('shape', { figure: tool.figure });
      return;
    }
    goToTool(tool.name);
  };

  return (
    <div
      className="fixed bottom-16 left-0 right-0 z-40 px-3 pb-2 select-none pointer-events-none md:hidden"
      data-testid="mobile-tool-sheet"
    >
      <div className="mx-auto max-w-lg rounded-2xl bg-white/95 dark:bg-gray-900/95 backdrop-blur-md shadow-2xl border border-gray-200/80 dark:border-gray-700/80 pointer-events-auto transition-all overflow-hidden">
        {/* A single real button. The old version was a `div onClick` with no role,
            no tabIndex and no key handler wrapping a `<button>` that only worked
            because the click bubbled up: unreachable by keyboard, and invalid
            interactive content nesting besides. */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls="mobile-tool-options"
          className="flex min-h-11 w-full items-center justify-between gap-2 px-4 py-2 text-left bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-800 cursor-pointer"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="w-2 h-2 shrink-0 rounded-full bg-blue-500" />
            <span className="truncate text-xs font-semibold text-gray-800 dark:text-gray-200 capitalize">
              {toolName.replace(/-/g, ' ')} Options
            </span>
            {isToolDirty && (
              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 font-medium">
                Modified
              </span>
            )}
          </span>
          <span aria-hidden="true" className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
            {isOpen ? '▼ Hide' : '▲ Options'}
          </span>
        </button>

        {isOpen && (
          // `touch-pan-x touch-pan-y` is not redundant with the overflow classes:
          // a scroller only pans by touch when its own `touch-action` allows it,
          // and a `touch-action` set by an ancestor silently wins.
          <div
            id="mobile-tool-options"
            className="px-4 py-3 max-h-[300px] overflow-x-auto overflow-y-auto touch-pan-x touch-pan-y"
          >
            {group && group.tools.length > 1 && (
              <div
                role="group"
                aria-label={`${group.label} tools`}
                className="mb-3 flex gap-1.5 overflow-x-auto overscroll-x-contain touch-pan-x pb-1"
              >
                {group.tools.map((tool) => (
                  <button
                    key={`${tool.name}-${tool.label}`}
                    type="button"
                    onClick={() => selectTool(tool)}
                    aria-pressed={isToolSelected(tool)}
                    className={`min-h-11 min-w-11 shrink-0 whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors ${
                      isToolSelected(tool)
                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/20 dark:text-blue-100'
                        : 'border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200'
                    }`}
                  >
                    {tool.label}
                  </button>
                ))}
              </div>
            )}

            {ToolComponent ? (
              <div className="min-w-fit flex items-center gap-4">
                <ToolComponent key={toolName} />
              </div>
            ) : (
              <div className="text-xs text-gray-500 dark:text-gray-400 py-2">No extra options for this tool.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
