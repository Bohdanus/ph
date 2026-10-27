import { useCallback, useEffect, useState } from 'react';

import type { ToolName } from '../contexts/tool-types.ts';
import { findToolProcessor } from '../tools/toolProcessors.ts';

/**
 * The localStorage key under which "has the user been introduced to this tool" is recorded.
 *
 * The set of unimplemented tools is derived from `toolProcessors` (the same source of truth
 * `SidebarLeft` reads), so the marker follows a tool from `unimplemented` to `implemented`
 * without any hand-maintained list to drift.
 */
const STORAGE_KEY = 'ph.firstUse';

type FirstUseRecord = Record<string, boolean>;

/**
 * Whether a tool is one the app has not implemented yet — the only set that gets a "new"
 * marker. Delegates to `toolProcessors` so the definition is single-sourced.
 */
export const isUnimplementedTool = (toolName: ToolName): boolean =>
  findToolProcessor(toolName)?.commit === 'unimplemented';

const readRecord = (): FirstUseRecord => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as FirstUseRecord) : {};
  } catch {
    return {};
  }
};

const writeRecord = (record: FirstUseRecord): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Quota exceeded or private mode — swallow. The marker simply never disappears,
    // which is a cosmetic regression, not a breakage.
  }
};

/**
/** Returns true while an unimplemented tool has no stored seen marker. */
export const isToolNew = (toolName: ToolName): boolean => {
  if (!isUnimplementedTool(toolName)) return false;
  const record = readRecord();
  return record[toolName] !== false;
};

/** Marks an unimplemented tool as seen; a stored `false` means the marker is cleared. */
export const markToolAsSeen = (toolName: ToolName): void => {
  if (!isUnimplementedTool(toolName)) return;
  const record = readRecord();
  record[toolName] = false;
  writeRecord(record);
};

/**
 * Keep consumers of the synchronous record helpers current in this tab and across tabs.
 * The pure helpers remain the single source of badge truth; this hook supplies their
 * React invalidation signal and owns the storage-event lifecycle.
 */
export const useFirstUse = (): {
  isToolNew: typeof isToolNew;
  markToolAsSeen: (toolName: ToolName) => void;
} => {
  const [, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((revision) => revision + 1), []);

  const markSeen = useCallback(
    (toolName: ToolName) => {
      markToolAsSeen(toolName);
      refresh();
    },
    [refresh]
  );

  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      refresh();
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [refresh]);

  return { isToolNew, markToolAsSeen: markSeen };
};
