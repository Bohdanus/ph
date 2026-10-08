import { describe, expect, it } from 'vitest';

import { durableToolArgsForNavigation } from '../useCurrentTool.tsx';
import type { DurableDocument, DurableLayerSource } from '../history-model.ts';

const frame = { x: 0, y: 0, width: 100, height: 80 };

function documentFor(source: DurableLayerSource): DurableDocument {
  return {
    documentId: 'hydration-test',
    documentRevision: 1,
    branchRevision: 0,
    durableRevision: 1,
    baseline: {
      frame,
      layers: [
        {
          id: 'layer-1',
          name: 'Editable layer',
          isBedrock: false,
          visible: true,
          opacity: 1,
          locked: false,
          blendMode: 'source-over',
          order: 0,
          pos: { x: 0, y: 0, width: 100, height: 80 },
          source,
        },
      ],
      selections: { selections: [], activeSelectionId: null },
      activeLayerId: 'layer-1',
    },
    history: [],
    cursor: -1,
  };
}

describe('durableToolArgsForNavigation', () => {
  it('hydrates text settings without committed text or edit-session geometry', () => {
    const args = durableToolArgsForNavigation(
      documentFor({
        kind: 'text',
        toolName: 'text',
        args: {
          toolName: 'text',
          text: 'Committed text',
          rect: { x: 1, y: 2, width: 30, height: 20 },
          kind: 'paragraph',
          placeholderUntouched: false,
          editingLayerId: 'layer-1',
          fontSize: 48,
        },
        size: { width: 100, height: 80 },
        sourcePos: { x: 0, y: 0, width: 100, height: 80 },
      }),
      'layer-1',
      'text'
    );

    expect(args).toMatchObject({ toolName: 'text', fontSize: 48 });
    expect(args).toMatchObject({ text: '', rect: null });
    expect(args).not.toHaveProperty('kind');
    expect(args).not.toHaveProperty('placeholderUntouched');
    expect(args).not.toHaveProperty('editingLayerId');
  });

  it('hydrates vector settings without committed geometry', () => {
    const args = durableToolArgsForNavigation(
      documentFor({
        kind: 'vector',
        toolName: 'ellipse',
        args: {
          toolName: 'ellipse',
          figure: 'oval',
          lineWidth: 7,
          start: { x: 1, y: 2 },
          end: { x: 40, y: 50 },
        },
        size: { width: 100, height: 80 },
        sourcePos: { x: 0, y: 0, width: 100, height: 80 },
      }),
      'layer-1',
      'ellipse'
    );

    expect(args).toMatchObject({ toolName: 'ellipse', figure: 'oval', lineWidth: 7 });
    expect(args).not.toHaveProperty('start');
    expect(args).not.toHaveProperty('end');
  });

  it.each([
    ['ellipse', 'shape'],
    ['draw', 'paint'],
    ['text', 'legacy-tool'],
  ] as const)('refuses exact-tool hydration for %s from %s source', (toolName, kind) => {
    const source =
      kind === 'paint'
        ? {
            kind: 'paint' as const,
            toolName: 'draw',
            args: { toolName: 'draw' },
            size: { width: 100, height: 80 },
            sourcePos: { x: 0, y: 0, width: 100, height: 80 },
          }
        : kind === 'legacy-tool'
          ? {
              kind: 'legacy-tool' as const,
              toolName: 'text',
              args: { toolName: 'text' },
              size: { width: 100, height: 80 },
            }
          : {
              kind: 'vector' as const,
              toolName: 'shape',
              args: { toolName: 'shape', figure: 'rectangle' },
              size: { width: 100, height: 80 },
              sourcePos: { x: 0, y: 0, width: 100, height: 80 },
            };
    expect(durableToolArgsForNavigation(documentFor(source), 'layer-1', toolName)).toBeNull();
  });
});
