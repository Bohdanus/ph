import { describe, expect, it } from 'vitest';

import { legacyHistoryToDurable } from '../history-adapter.ts';
import { normalizeTransformHistoryArgs } from '../affine-transform.ts';
import { replayDurableDocument } from '../durable-replay.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer } from '../layer-types.ts';
import type { TransformToolArgs } from '../../tools/transform.ts';
import { OPEN_DOCUMENT_ACTION, SET_DOCUMENT_FRAME_ACTION, TOOL_ACTION } from '../../util/constants.ts';

const layerId = 'layer-1';
const initialSize = { width: 400, height: 300 };
const baselineFrame = { x: 0, y: 0, width: initialSize.width, height: initialSize.height };
const layerPos = { x: 20, y: 30, width: 120, height: 80 };

function createBaselineLayer(): Layer {
  return {
    id: layerId,
    name: 'Layer',
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos: { ...layerPos },
    presentationBounds: null,
    source: {
      kind: 'blank',
      color: '#ffffff',
      opacity: 1,
      isBedrock: false,
      pos: { ...layerPos },
    },
    operations: [],
  };
}

function convert(...items: HistoryItem[]) {
  return legacyHistoryToDurable(
    [
      {
        id: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        layerId,
        documentSource: {
          layers: { [layerId]: createBaselineLayer() },
          size: initialSize,
          frame: baselineFrame,
        },
      },
      ...items,
    ],
    { documentId: 'test-document' }
  );
}

const rawTransform: TransformToolArgs = {
  toolName: 'transform',
  rotate: 17,
  mirrorH: true,
  mirrorV: false,
  skewX: 8,
  skewY: -4,
  trapezoid: 0,
  resizeX: 125,
  resizeY: 85,
};

describe('durable history adapter and replay', () => {
  it('converts raw and normalized non-trapezoid transforms to the same affine operation', () => {
    const normalizedTransform = normalizeTransformHistoryArgs(rawTransform, {
      width: layerPos.width,
      height: layerPos.height,
    });
    expect(normalizedTransform).not.toBeNull();

    const raw = convert({ id: 'raw-transform', actionName: TOOL_ACTION, layerId, args: rawTransform });
    const normalized = convert({
      id: 'normalized-transform',
      actionName: TOOL_ACTION,
      layerId,
      args: normalizedTransform!,
    });

    expect(raw.document.history[0]?.operation).toEqual(normalized.document.history[0]?.operation);
    expect(raw.document.history[0]?.operation).toMatchObject({ kind: 'apply-affine-transform', layerId });
  });

  it('uses a raster processor for trapezoid-only transforms and rejects mixed transforms', () => {
    const trapezoidOnly = convert({
      id: 'trapezoid-transform',
      actionName: TOOL_ACTION,
      layerId,
      args: {
        ...rawTransform,
        rotate: 0,
        mirrorH: false,
        skewX: 0,
        skewY: 0,
        resizeX: 100,
        resizeY: 100,
        trapezoid: 25,
      },
    });

    expect(trapezoidOnly.document.history[0]?.operation).toMatchObject({
      kind: 'apply-raster-processor',
      layerId,
      processorId: 'transform',
    });

    const mixed = convert({
      id: 'mixed-transform',
      actionName: TOOL_ACTION,
      layerId,
      args: { ...rawTransform, trapezoid: 25 },
    });

    expect(mixed.diagnostics).toHaveLength(1);
    expect(mixed.diagnostics[0]).toMatchObject({
      historyId: 'mixed-transform',
      severity: 'error',
    });
    expect(mixed.diagnostics[0]?.message).toMatch(/Mixed trapezoid and affine transform is unsupported/);
    expect(mixed.document.history).toHaveLength(0);
  });

  it('keeps disabled affine and filter entries disabled and excludes them from replay', () => {
    const converted = convert(
      {
        id: 'disabled-affine',
        actionName: TOOL_ACTION,
        layerId,
        disabled: true,
        args: rawTransform,
      },
      {
        id: 'disabled-filter',
        actionName: TOOL_ACTION,
        layerId,
        disabled: true,
        args: { toolName: 'blur', radius: 4 },
      }
    );

    expect(converted.document.history.map((entry) => entry.enabled)).toEqual([false, false]);
    expect(converted.document.history.map((entry) => entry.operation.kind)).toEqual([
      'apply-affine-transform',
      'apply-filter',
    ]);
    expect(replayDurableDocument(converted.document).layers[layerId]?.operations).toEqual([]);
  });

  it('diagnoses a disabled mixed transform without making the conversion partial', () => {
    const converted = convert(
      {
        id: 'disabled-mixed-transform',
        actionName: TOOL_ACTION,
        layerId,
        disabled: true,
        args: { ...rawTransform, trapezoid: 25 },
      },
      { id: 'after-disabled-transform', actionName: TOOL_ACTION, layerId, args: rawTransform }
    );

    expect(converted.document.history.map((entry) => entry.id)).toEqual(['after-disabled-transform']);
    expect(converted.firstErrorIndex).toBeUndefined();
    expect(converted.legacyCursorToDurableCursor).toEqual([-1, -1, 0]);
    expect(converted.diagnostics).toEqual([
      expect.objectContaining({
        historyId: 'disabled-mixed-transform',
        severity: 'error',
        code: 'unsupported-history-feature',
        message: 'Mixed trapezoid and affine transform is unsupported',
      }),
    ]);
    expect(replayDurableDocument(converted.document).layers[layerId]?.operations).toHaveLength(1);
  });

  it('returns logical replay state without bitmap or temporary-canvas fields', () => {
    const converted = convert({ id: 'affine', actionName: TOOL_ACTION, layerId, args: rawTransform });
    const replay = replayDurableDocument(converted.document);
    const serialized = JSON.stringify(replay);

    expect(serialized).not.toContain('"bitmap"');
    expect(serialized).not.toContain('"tmpCanvas"');
    expect(replay.layers[layerId]?.operations).toHaveLength(1);
  });

  it('keeps document-frame changes distinct from reposition resize operations', () => {
    const nextFrame = { x: 40, y: 25, width: 200, height: 120 };
    const resize = { x: 70, y: 50, width: 180, height: 110 };
    const converted = convert(
      {
        id: 'crop',
        actionName: SET_DOCUMENT_FRAME_ACTION,
        layerId: 'document',
        args: { previousFrame: baselineFrame, nextFrame },
      },
      {
        id: 'resize',
        actionName: TOOL_ACTION,
        layerId,
        args: { toolName: 'reposition', resize },
      }
    );
    const operations = converted.document.history.map((entry) => entry.operation);

    expect(operations.map((operation) => operation.kind)).toEqual(['set-document-frame', 'reposition-layer']);
    const replay = replayDurableDocument(converted.document);
    expect(replay.frame).toEqual(nextFrame);
    expect(replay.layers[layerId]?.snapshot.pos).toEqual(resize);
  });
});
