import { useEffect, useState } from 'react';

import { findToolProcessor, toolProcessors } from '../tools/toolProcessors.ts';
import type { ToolName } from '../contexts/tool-types.ts';

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
 * The set of unimplemented tool names that have NOT yet been introduced to the user.
 *
 * A tool is "introduced" when the user hovers over its tile or flyout row — that is the
 * first moment the tooltip or the row's title attribute would name the tool, which is the
 * earliest point at which the name becomes visible. The record is keyed by tool name; a
 * value of `true` means "mark as new", `false` (or absent) means "already shown".
 */
export const getUnintroducedTools = (): ToolName[] => {
  const record = readRecord();
  const unimplemented = Object.keys(toolProcessors).filter(
    (name) => findToolProcessor(name as ToolName)?.commit === 'unimplemented'
  ) as ToolName[];
  return unimplemented.filter((name) => record[name] !== false);
};

/**
 * Returns true when the tool should still carry a "new" marker.
 */
export const isToolNew = (toolName: ToolName): boolean => {
  if (!isUnimplementedTool(toolName)) return false;
  const record = readRecord();
  return record[toolName] !== false;
};

/**
 * Marks a tool as having been introduced to the user, removing its "new" marker.
 */
export const markToolAsSeen = (toolName: ToolName): void => {
  if (!isUnimplementedTool(toolName)) return;
  const record = readRecord();
  record[toolName] = false;
  writeRecord(record);
};

/**
 * The React hook counterpart to `markToolAsSeen`. Returns whether the tool is new and a
 * callback that clears the flag. Safe to call on any tool name — implemented tools report
 * `false` and the callback is a no-op.
 */
export const useFirstUse = (toolName: ToolName): [boolean, () => void] => {
  const [isNew, setIsNew] = useState(() => isToolNew(toolName));

  const markSeen = () => {
    if (!isNew) return;
    markToolAsSeen(toolName);
    setIsNew(false);
  };

  // Sync across tab windows: a `storage` event fires when another tab writes the record.
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      setIsNew(isToolNew(toolName));
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [toolName]);

  return [isNew, markSeen];
};
