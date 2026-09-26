import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { cloneDeep } from 'lodash-es';
import { lastSavedSettings } from '../tools/settings.ts';
import type { ToolName, ToolArgs, ToolArgsFor, ToolPatch } from './tool-types.ts';
import { saveLastSettings } from '../util/settings.ts';
import { useStore } from './StoreContext.tsx';
import { setRefValue } from '../util/ref.ts';

export interface CurrentToolContextState {
  toolArgs: ToolArgs;
  isToolDirty: boolean;
  setToolArgs: (args: ToolArgs) => void;
  getToolArgs: <TName extends ToolName>(toolName: TName) => ToolArgsFor<TName> | null;
  patchToolArgs: <TName extends ToolName>(toolName: TName, patch: ToolPatch<TName>) => void;
  resetToLastSavedArgs: (toolName?: ToolName) => void;
}

const CurrentToolContext = createContext<CurrentToolContextState | undefined>(undefined);

function cloneSavedToolArgs<TName extends ToolName>(toolName: TName): ToolArgsFor<TName> {
  return cloneDeep(lastSavedSettings[toolName]) as ToolArgsFor<TName>;
}

type ToolState = {
  toolName: ToolName;
  args: ToolArgs;
};

/* this provider is meant for fast updates. keep it away from Main component */
export const CurrentToolProvider = ({ children }: { children: React.ReactNode }) => {
  const [{ currentArgs: currentArgsRef, toolName, isToolDirty }] = useStore();
  const [toolState, setToolState] = useState<ToolState>(() => ({
    toolName,
    args: cloneSavedToolArgs(toolName),
  }));

  const savedArgsForTool = useMemo(() => cloneSavedToolArgs(toolName), [toolName]);
  const toolArgs = toolState.toolName === toolName ? toolState.args : savedArgsForTool;

  const resetToLastSavedArgs = useCallback(
    (nextToolName: ToolName = toolName) => {
      const args = cloneSavedToolArgs(nextToolName);
      setToolState({ toolName: nextToolName, args });
    },
    [toolName]
  );

  useEffect(() => {
    setRefValue(currentArgsRef, toolArgs);
  }, [toolArgs, currentArgsRef]);

  const _setToolArgs = useCallback(
    (args: ToolArgs) => {
      // Tool commits can happen before React publishes the next state. Keep
      // the imperative dirty-tool reader in the same state transition.
      setRefValue(currentArgsRef, args);
      saveLastSettings(args);
      setToolState({ toolName: args.toolName, args });
    },
    [currentArgsRef]
  );

  const getToolArgs = useCallback(
    <TName extends ToolName>(name: TName): ToolArgsFor<TName> | null => {
      return toolArgs.toolName === name ? (toolArgs as ToolArgsFor<TName>) : null;
    },
    [toolArgs]
  );

  const patchToolArgs = useCallback(
    <TName extends ToolName>(name: TName, patch: ToolPatch<TName>) => {
      const base = toolArgs.toolName === name ? (toolArgs as ToolArgsFor<TName>) : cloneSavedToolArgs(name);
      _setToolArgs({ ...base, ...patch, toolName: name } as ToolArgsFor<TName>);
    },
    [_setToolArgs, toolArgs]
  );

  const value = useMemo(
    () => ({
      toolArgs,
      isToolDirty,
      setToolArgs: _setToolArgs,
      getToolArgs,
      patchToolArgs,

      resetToLastSavedArgs,
    }),
    [_setToolArgs, getToolArgs, isToolDirty, patchToolArgs, resetToLastSavedArgs, toolArgs]
  );

  return <CurrentToolContext.Provider value={value}>{children}</CurrentToolContext.Provider>;
};

export const useCurrentTool = (): CurrentToolContextState => {
  const ctx = useContext(CurrentToolContext);
  if (!ctx) {
    throw new Error('useCurrentTool must be used within a CurrentToolProvider');
  }
  return ctx;
};
