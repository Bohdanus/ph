import type { ProcessorToolParams, ToolResult } from './toolProcessors.ts';
import type { Point, Pos } from '../contexts/general-types.ts';

type RepositionPatch =
  { move: Point; resize?: never } | { resize: Pos; move?: never } | { move?: undefined; resize?: undefined };

export type RepositionToolArgs = RepositionPatch & { toolName: 'reposition' };

export const reposition =
  ({ bitmap }: ProcessorToolParams) =>
  ({ move, resize }: RepositionToolArgs): ToolResult => {
    // Reposition commits geometry structurally; this processor only passes the source
    // through with the same position patch that live preview and history replay apply.
    const positionPatch = resize ?? move;
    return positionPatch ? [bitmap, positionPatch] : [bitmap];
  };
