import type { HistoryItem } from './history-types.ts';

export type HistoryTimeline = Readonly<{
  entries: readonly HistoryItem[];
  cursor: number;
  branchRevision: number;
}>;

export type HistoryTimelineCommand =
  | Readonly<{ type: 'append'; entry: HistoryItem }>
  | Readonly<{ type: 'toggle-disabled'; entryId: string }>
  | Readonly<{ type: 'set-cursor'; cursor: number }>;

export function updateHistoryTimeline(timeline: HistoryTimeline, command: HistoryTimelineCommand): HistoryTimeline {
  if (command.type === 'set-cursor') {
    if (!Number.isInteger(command.cursor) || command.cursor < 0 || command.cursor >= timeline.entries.length) {
      return timeline;
    }
    if (command.cursor === timeline.cursor) return timeline;
    return { ...timeline, cursor: command.cursor };
  }

  if (command.type === 'toggle-disabled') {
    const index = timeline.entries.findIndex((entry) => entry.id === command.entryId);
    if (index === -1) return timeline;
    const entries = [...timeline.entries];
    entries[index] = { ...entries[index], disabled: !entries[index].disabled };
    return { entries, cursor: timeline.cursor, branchRevision: timeline.branchRevision + 1 };
  }

  const entries = [...timeline.entries.slice(0, timeline.cursor + 1), command.entry];
  return { entries, cursor: entries.length - 1, branchRevision: timeline.branchRevision + 1 };
}
