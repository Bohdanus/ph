import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { cloneDeep } from 'lodash-es';
import { defaultSettings, lastSavedSettings } from '../tools/settings.ts';
import type { ToolName, ToolArgs, ToolArgsFor, ToolPatch } from './tool-types.ts';
import { saveLastSettings } from '../util/settings.ts';
import { useStore } from './StoreContext.tsx';

export interface CurrentToolContextState {
  toolArgs: ToolArgs;
  isToolDirty: boolean;
  setToolArgs: (args: ToolArgs) => void;
  getToolArgs: <TName extends ToolName>(toolName: TName) => ToolArgsFor<TName> | null;
  patchToolArgs: <TName extends ToolName>(toolName: TName, patch: ToolPatch<TName>) => void;

  resetToLastSavedArgs: (toolName?: ToolName) => void;
}

const initialArgs = cloneDeep(defaultSettings.draw) as ToolArgs;

const CurrentToolContext = createContext<CurrentToolContextState | undefined>(undefined);

function cloneSavedToolArgs<TName extends ToolName>(toolName: TName): ToolArgsFor<TName> {
  return cloneDeep(lastSavedSettings[toolName]) as ToolArgsFor<TName>;
}

/* this provider is meant for fast updates. keep it away from Main component */
export const CurrentToolProvider = ({ children }: { children: React.ReactNode }) => {
  const [{ currentArgs: currentArgsRef, toolName, isToolDirty }] = useStore();
  const [toolArgs, setToolArgs] = useState<ToolArgs>(initialArgs);

  const resetToLastSavedArgs = useCallback(
    (nextToolName: ToolName = toolName) => {
      const args = cloneSavedToolArgs(nextToolName);
      setToolArgs(args);
    },
    [toolName]
  );

  useEffect(() => {
    // eslint-disable-next-line react-compiler/react-compiler
    currentArgsRef.current = toolArgs;
  }, [toolArgs, currentArgsRef]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    resetToLastSavedArgs();
  }, [toolName, resetToLastSavedArgs]);

  const _setToolArgs = useCallback((args: ToolArgs) => {
    saveLastSettings(args);
    setToolArgs(args);
  }, []);

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
