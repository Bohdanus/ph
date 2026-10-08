import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { cloneDeep } from 'lodash-es';
import { lastSavedSettings } from '../tools/settings.ts';
import { isFigureType, normalizeFigure } from '../tools/shape.ts';
import type { ToolName, ToolArgs, ToolArgsFor, ToolPatch } from './tool-types.ts';
import { saveLastSettings } from '../util/settings.ts';
import { useStore } from './StoreContext.tsx';
import { setRefValue } from '../util/ref.ts';
import { SetToolArgsContext } from './set-tool-args.ts';
import { replayDurableDocument } from './durable-replay.ts';
import type { DurableDocument } from './history-model.ts';
import { editableDurableSourceKind } from './history-adapter.ts';
import { hasPendingText } from '../util/typeGuards.ts';
import { isDocumentGestureOpen } from '../hooks/document-gesture.ts';

export interface CurrentToolContextState {
  toolArgs: ToolArgs;
  setToolArgs: (args: ToolArgs) => void;
  isDocumentBacked: boolean;
  getToolArgs: <TName extends ToolName>(toolName: TName) => ToolArgsFor<TName> | null;
  patchToolArgs: <TName extends ToolName>(toolName: TName, patch: ToolPatch<TName>) => void;
}

const CurrentToolContext = createContext<CurrentToolContextState | undefined>(undefined);

/**
 * `lastSavedSettings` is mutable and may still hold a legacy `circle`/`square`
 * figure from an older build. Coerce on the way out so no caller ever renders
 * or commits a figure that the narrowed union no longer accepts.
 */
const normalizeToolArgs = <TName extends ToolName>(args: ToolArgsFor<TName>): ToolArgsFor<TName> => {
  if (!('figure' in args)) return args;
  const figure = (args as { figure: unknown }).figure;
  if (isFigureType(figure)) return args;
  return { ...args, figure: normalizeFigure(figure) } as ToolArgsFor<TName>;
};

function cloneSavedToolArgs<TName extends ToolName>(toolName: TName): ToolArgsFor<TName> {
  return normalizeToolArgs(cloneDeep(lastSavedSettings[toolName]) as ToolArgsFor<TName>);
}

export function durableToolArgsForNavigation(
  document: DurableDocument | null | undefined,
  activeLayerId: string | null,
  toolName: ToolName
): ToolArgs | null {
  if (!document || !activeLayerId || !editableDurableSourceKind(toolName)) return null;
  const source = replayDurableDocument(document).layers[activeLayerId]?.snapshot.source;
  if (!source || (source.kind !== 'text' && source.kind !== 'vector')) return null;
  if (source.toolName !== toolName || source.args.toolName !== toolName) return null;

  const args = cloneDeep(source.args) as Record<string, unknown>;
  if (source.kind === 'text') {
    const {
      text: _text,
      rect: _rect,
      kind: _kind,
      placeholderUntouched: _placeholderUntouched,
      editingLayerId: _editingLayerId,
      ...persisted
    } = args;
    // Keep an empty draft shape so Text.tsx cannot reopen a committed edit. The
    // committed text and layer-local rect are deliberately never rehydrated.
    return normalizeToolArgs({ ...persisted, text: '', rect: null } as ToolArgs);
  }

  const { start: _start, end: _end, ...persisted } = args;
  return normalizeToolArgs(persisted as ToolArgs);
}

type ToolState = {
  toolName: ToolName;
  args: ToolArgs;
  isDocumentBacked: boolean;
};

/* this provider is meant for fast updates. keep it away from Main component */
export const CurrentToolProvider = ({ children }: { children: React.ReactNode }) => {
  const [{ currentArgs: currentArgsRef, toolName, activeLayerId, durableDocument, durableStatus, previewLayers }] =
    useStore();
  const [toolState, setToolState] = useState<ToolState>(() => ({
    toolName,
    args: cloneSavedToolArgs(toolName),
    isDocumentBacked: false,
  }));

  const savedArgsForTool = useMemo(() => cloneSavedToolArgs(toolName), [toolName]);
  const toolArgs = toolState.toolName === toolName ? toolState.args : savedArgsForTool;

  useEffect(() => {
    setRefValue(currentArgsRef, toolArgs);
  }, [toolArgs, currentArgsRef]);

  const _setToolArgs = useCallback(
    (args: ToolArgs) => {
      const nextArgs = normalizeToolArgs(args);
      // Tool commits can happen before React publishes the next state. Keep
      // the imperative dirty-tool reader in the same state transition.
      setRefValue(currentArgsRef, nextArgs);
      saveLastSettings(nextArgs);
      setToolState({ toolName: nextArgs.toolName, args: nextArgs, isDocumentBacked: false });
    },
    [currentArgsRef]
  );

  const hydrateToolArgs = useCallback(
    (args: ToolArgs, isDocumentBacked: boolean) => {
      const nextArgs = normalizeToolArgs(args);
      setRefValue(currentArgsRef, nextArgs);
      setToolState({ toolName: nextArgs.toolName, args: nextArgs, isDocumentBacked });
    },
    [currentArgsRef]
  );

  useEffect(() => {
    if (Object.keys(previewLayers.current).length > 0) return;
    if (hasPendingText(currentArgsRef.current) || isDocumentGestureOpen()) return;

    const hydrated =
      durableStatus === 'current' ? durableToolArgsForNavigation(durableDocument, activeLayerId, toolName) : null;
    hydrateToolArgs(hydrated ?? cloneSavedToolArgs(toolName), hydrated !== null);
  }, [activeLayerId, currentArgsRef, durableDocument, durableStatus, hydrateToolArgs, previewLayers, toolName]);

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
      setToolArgs: _setToolArgs,
      isDocumentBacked: toolState.isDocumentBacked,
      getToolArgs,
      patchToolArgs,
    }),
    [_setToolArgs, getToolArgs, patchToolArgs, toolArgs]
  );

  return (
    <SetToolArgsContext.Provider value={_setToolArgs}>
      <CurrentToolContext.Provider value={value}>{children}</CurrentToolContext.Provider>
    </SetToolArgsContext.Provider>
  );
};

export const useCurrentTool = (): CurrentToolContextState => {
  const ctx = useContext(CurrentToolContext);
  if (!ctx) {
    throw new Error('useCurrentTool must be used within a CurrentToolProvider');
  }
  return ctx;
};
