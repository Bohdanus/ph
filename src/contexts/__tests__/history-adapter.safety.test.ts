import { describe, expect, it } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import { legacyHistoryToDurable, UnsupportedHistoryFeatureError } from '../history-adapter.ts';
import type { HistoryItem } from '../history-types.ts';
import { OPEN_DOCUMENT_ACTION, TOOL_ACTION } from '../../util/constants.ts';
import type { TransformToolArgs } from '../../tools/transform.ts';

const layerId = 'layer-1';
const initialSize = { width: 400, height: 300 };
const baselineFrame = { x: 0, y: 0, width: 400, height: 300 };

function blankLayer(id = layerId) {
  return {
    id,
    name: 'Layer',
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over' as GlobalCompositeOperation,
    order: 0,
    pos: { x: 0, y: 0, width: 100, height: 80 },
    source: {
      kind: 'blank' as const,
      color: '#ffffff',
      opacity: 1,
      isBedrock: false as const,
      pos: { x: 0, y: 0, width: 100, height: 80 },
    },
    operations: [],
  };
}

function baselineHistory(): HistoryItem[] {
  return [
    {
      id: 'baseline',
      actionName: OPEN_DOCUMENT_ACTION,
      layerId,
      documentSource: {
        layers: { [layerId]: blankLayer() },
        size: initialSize,
        frame: baselineFrame,
      },
    },
  ];
}

function convert(items: HistoryItem[], registry: AssetRegistry) {
  return legacyHistoryToDurable([...baselineHistory(), ...items], {
    documentId: 'test-doc',
    registry,
  });
}

function transformArgs(overrides: Partial<TransformToolArgs>): TransformToolArgs {
  return {
    toolName: 'transform',
    rotate: 0,
    mirrorH: false,
    mirrorV: false,
    skewX: 0,
    skewY: 0,
    trapezoid: 0,
    resizeX: 100,
    resizeY: 100,
    ...overrides,
  };
}

describe('legacyHistoryToDurable safety boundary', () => {
  it('throws UnsupportedHistoryFeatureError for an unsupported tool that has no durable replay kind', () => {
    const registry = new AssetRegistry();
    expect(() =>
      convert([{ id: 'pen-tool', actionName: TOOL_ACTION, layerId, args: { toolName: 'pen' } }], registry)
    ).toThrow(UnsupportedHistoryFeatureError);
  });

  it('throws UnsupportedHistoryFeatureError for an unknown processor (toolName not registered)', () => {
    const registry = new AssetRegistry();
    expect(() =>
      convert(
        [{ id: 'unknown-tool', actionName: TOOL_ACTION, layerId, args: { toolName: 'nonexistent-tool' as never } }],
        registry
      )
    ).toThrowError(/Unknown processor/);
  });

  it('throws UnsupportedHistoryFeatureError for a mixed trapezoid-plus-affine transform', () => {
    const registry = new AssetRegistry();
    expect(() =>
      convert(
        [
          {
            id: 'mixed-transform',
            actionName: TOOL_ACTION,
            layerId,
            args: { ...transformArgs({ rotate: 17, trapezoid: 25 }) },
          },
        ],
        registry
      )
    ).toThrowError(/Mixed trapezoid and affine transform is unsupported/);
  });

  it('produces a per-entry diagnostic and skips the entry for malformed non-plain arguments', () => {
    const registry = new AssetRegistry();
    class FakeClass {
      foo = 'bar';
    }
    const result = convert(
      [
        {
          id: 'malformed',
          actionName: TOOL_ACTION,
          layerId,
          args: { toolName: 'blur', radius: new FakeClass() as unknown as number },
        },
      ],
      registry
    );

    expect(result.document.history).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      historyId: 'malformed',
      severity: 'error',
    });
    expect(result.diagnostics[0]?.message).toMatch(/Non-plain/);
  });

  it('throws UnsupportedHistoryFeatureError for non-finite transform values', () => {
    const registry = new AssetRegistry();
    expect(() =>
      convert(
        [
          {
            id: 'nan-transform',
            actionName: TOOL_ACTION,
            layerId,
            args: transformArgs({ rotate: NaN }),
          },
        ],
        registry
      )
    ).toThrow(UnsupportedHistoryFeatureError);
  });

  it('does not register raster assets for a baseline that only uses blank sources', () => {
    const registry = new AssetRegistry();
    const result = convert([], registry);

    expect(result.document.history).toHaveLength(0);
    expect(result.document.baseline.layers).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(0);
  });
});
