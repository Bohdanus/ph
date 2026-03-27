import React, { createContext, useContext, useEffect, useState } from 'react';
import { cloneDeep, isEqual } from 'lodash-es';
import { defaultSettings, lastSavedSettings } from '../tools/settings.ts';
import type { ToolName, ToolArgs } from './tool-types.ts';
import { saveSettings } from '../util/settings.ts';
import { useStore } from './StoreContext.tsx';

export interface CurrentToolContextState {
  toolArgs: ToolArgs;
  setToolArgs: (args: ToolArgs) => void;
  isToolDirty: boolean;

  resetToLastSavedArgs: (toolName?: ToolName) => void;
}

const CurrentToolContext = createContext<CurrentToolContextState | undefined>(undefined);

/* this provider is meant for fast updates. keep it away from Main component */
export const CurrentToolProvider = ({ children }: { children: React.ReactNode }) => {
  const [{ currentArgs, toolName }] = useStore();
  const [toolArgs, setToolArgs] = useState<ToolArgs>(cloneDeep(defaultSettings.draw));
  const [isToolDirty, setToolDirty] = useState(false);

  useEffect(() => {
    currentArgs.current = toolArgs;
  }, [toolArgs]);

  function resetToLastSavedArgs(_toolName = toolName) {
    setToolArgs(cloneDeep(lastSavedSettings[_toolName]));
    setToolDirty(false);
  }

  const _setToolArgs = (args: ToolArgs) => {
    saveSettings(toolName, args);
    setToolArgs(args);
    setToolDirty(isEqual(args, lastSavedSettings[toolName]));
  };

  const value = {
    toolArgs,
    setToolArgs: _setToolArgs,
    isToolDirty,

    resetToLastSavedArgs,
  };

  return <CurrentToolContext.Provider value={value}>{children}</CurrentToolContext.Provider>;
};

export const useCurrentTool = (): CurrentToolContextState => {
  const ctx = useContext(CurrentToolContext);
  if (!ctx) {
    throw new Error('useCurrentTool must be used within a CurrentToolProvider');
  }
  return ctx;
};
