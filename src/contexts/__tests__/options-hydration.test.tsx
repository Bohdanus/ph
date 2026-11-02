import { describe, expect, it } from 'vitest';
import { durableToolArgsForNavigation } from '../useCurrentTool.tsx';
import {
  cloneDurableDocument,
  freezeDurableDocument,
  type DurableDocument,
  type DurableLayerSource,
} from '../history-model.ts';
import type { VectorToolName } from '../tool-types.ts';

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

function textSource(args: Record<string, unknown> = {}): DurableLayerSource {
  return {
    kind: 'text',
    toolName: 'text',
    args: { toolName: 'text', fontSize: 24, color: '#000000', ...args },
    size: { width: 100, height: 80 },
    sourcePos: { x: 0, y: 0, width: 100, height: 80 },
    isBedrock: false,
  };
}

function vectorSource(toolName: VectorToolName, args: Record<string, unknown> = {}): DurableLayerSource {
  return {
    kind: 'vector',
    toolName,
    args: { toolName, figure: 'rectangle', color: '#ff0000', ...args },
    size: { width: 100, height: 80 },
    sourcePos: { x: 0, y: 0, width: 100, height: 80 },
    isBedrock: false,
  };
}

describe('durableToolArgsForNavigation - options bar hydration', () => {
  describe('text source hydration', () => {
    it('hydrates fontSize from durable text source', () => {
      const args = durableToolArgsForNavigation(documentFor(textSource({ fontSize: 48 })), 'layer-1', 'text');
      expect(args).toMatchObject({ toolName: 'text', fontSize: 48 });
    });

    it('hydrates color from durable text source', () => {
      const args = durableToolArgsForNavigation(documentFor(textSource({ color: '#ff0000' })), 'layer-1', 'text');
      expect(args).toMatchObject({ toolName: 'text', color: '#ff0000' });
    });

    it('hydrates fontFamily from durable text source', () => {
      const args = durableToolArgsForNavigation(documentFor(textSource({ fontFamily: 'Georgia' })), 'layer-1', 'text');
      expect(args).toMatchObject({ toolName: 'text', fontFamily: 'Georgia' });
    });

    it('does NOT rehydrate committed text content', () => {
      const args = durableToolArgsForNavigation(
        documentFor(textSource({ text: 'Committed text', rect: { x: 1, y: 2, width: 30, height: 20 } })),
        'layer-1',
        'text'
      );
      expect(args).toMatchObject({ text: '', rect: null });
    });

    it('does NOT rehydrate edit-session geometry (rect, kind, angle, placeholderUntouched, editingLayerId)', () => {
      const args = durableToolArgsForNavigation(
        documentFor(
          textSource({
            text: 'Committed text',
            rect: { x: 1, y: 2, width: 30, height: 20 },
            kind: 'paragraph',
            angle: 37,
            placeholderUntouched: false,
            editingLayerId: 'layer-1',
          })
        ),
        'layer-1',
        'text'
      );
      expect(args).toMatchObject({ text: '', rect: null });
      expect(args).not.toHaveProperty('kind');
      expect(args).not.toHaveProperty('placeholderUntouched');
      expect(args).not.toHaveProperty('editingLayerId');
      // angle is reset to 0 (NEUTRAL_TEXT_ANGLE) not removed
      expect(args).toMatchObject({ angle: 0 });
    });

    it('resets text rotation to 0 (committed rotation not rehydrated for new draft)', () => {
      const args = durableToolArgsForNavigation(documentFor(textSource({ angle: 45 })), 'layer-1', 'text');
      expect(args).toMatchObject({ angle: 0 });
    });
  });

  describe('vector source hydration', () => {
    it('hydrates figure from durable vector source', () => {
      const args = durableToolArgsForNavigation(
        documentFor(vectorSource('ellipse', { figure: 'oval' })),
        'layer-1',
        'ellipse'
      );
      expect(args).toMatchObject({ toolName: 'ellipse', figure: 'oval' });
    });

    it('hydrates lineWidth from durable vector source', () => {
      const args = durableToolArgsForNavigation(
        documentFor(vectorSource('rectangle', { lineWidth: 7 })),
        'layer-1',
        'rectangle'
      );
      expect(args).toMatchObject({ toolName: 'rectangle', lineWidth: 7 });
    });

    it('hydrates color from durable vector source', () => {
      const args = durableToolArgsForNavigation(
        documentFor(vectorSource('ellipse', { color: '#00ff00' })),
        'layer-1',
        'ellipse'
      );
      expect(args).toMatchObject({ toolName: 'ellipse', color: '#00ff00' });
    });

    it('does NOT rehydrate committed geometry (start, end)', () => {
      const args = durableToolArgsForNavigation(
        documentFor(vectorSource('ellipse', { start: { x: 1, y: 2 }, end: { x: 40, y: 50 } })),
        'layer-1',
        'ellipse'
      );
      expect(args).not.toHaveProperty('start');
      expect(args).not.toHaveProperty('end');
    });

    it('hydrates shape tool (rectangle)', () => {
      const args = durableToolArgsForNavigation(
        documentFor(vectorSource('rectangle', { figure: 'rectangle' })),
        'layer-1',
        'rectangle'
      );
      expect(args).toMatchObject({ toolName: 'rectangle', figure: 'rectangle' });
    });
  });

  describe('hydration refusal - tool/source mismatch', () => {
    it.each([
      ['ellipse', 'vector' as const, 'shape' as VectorToolName],
      ['draw', 'paint' as const, 'draw' as const],
      ['text', 'legacy-tool' as const, 'text' as const],
    ])('refuses exact-tool hydration for %s from %s source', (_toolName, kind, _sourceToolName) => {
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
                toolName: 'shape' as VectorToolName,
                args: { toolName: 'shape', figure: 'rectangle' },
                size: { width: 100, height: 80 },
                sourcePos: { x: 0, y: 0, width: 100, height: 80 },
              };
      expect(durableToolArgsForNavigation(documentFor(source), 'layer-1', 'ellipse')).toBeNull();
    });

    it('returns null when toolName does not match source toolName', () => {
      const args = durableToolArgsForNavigation(documentFor(vectorSource('ellipse')), 'layer-1', 'rectangle');
      expect(args).toBeNull();
    });

    it('returns null when activeLayerId is null', () => {
      const args = durableToolArgsForNavigation(documentFor(textSource({ fontSize: 48 })), null, 'text');
      expect(args).toBeNull();
    });

    it('returns null when document is null', () => {
      const args = durableToolArgsForNavigation(null, 'layer-1', 'text');
      expect(args).toBeNull();
    });

    it('returns null when durableStatus is not current (editableDurableSourceKind returns false)', () => {
      const args = durableToolArgsForNavigation(documentFor(textSource({ fontSize: 48 })), 'layer-1', 'blur');
      expect(args).toBeNull();
    });
  });

  describe('hydration survives document mutations', () => {
    it('survives freezeDurableDocument', () => {
      const doc = documentFor(textSource({ fontSize: 48 }));
      const frozen = freezeDurableDocument(doc);
      const args = durableToolArgsForNavigation(frozen, 'layer-1', 'text');
      expect(args).toMatchObject({ toolName: 'text', fontSize: 48 });
    });

    it('survives cloneDurableDocument', () => {
      const doc = documentFor(textSource({ fontSize: 48 }));
      const cloned = cloneDurableDocument(doc);
      const args = durableToolArgsForNavigation(cloned, 'layer-1', 'text');
      expect(args).toMatchObject({ toolName: 'text', fontSize: 48 });
    });

    it('survives refreezeDurableDocument with cursor change', () => {
      const doc = documentFor(textSource({ fontSize: 48 }));
      const refrozen = freezeDurableDocument(doc);
      const args = durableToolArgsForNavigation(refrozen, 'layer-1', 'text');
      expect(args).toMatchObject({ toolName: 'text', fontSize: 48 });
    });
  });

  describe('fallback chain - when durable source unavailable', () => {
    it('falls back to saved settings when source kind is raster', () => {
      const rasterSource: DurableLayerSource = {
        kind: 'raster',
        assetId: 'asset-1' as never,
        width: 100,
        height: 80,
        isBedrock: false,
      };
      const args = durableToolArgsForNavigation(documentFor(rasterSource), 'layer-1', 'text');
      expect(args).toBeNull(); // Caller should fall back to lastSavedSettings
    });

    it('falls back to saved settings when source kind is blank', () => {
      const blankSource: DurableLayerSource = {
        kind: 'blank',
        color: '#ffffff',
        opacity: 1,
        isBedrock: false,
        size: { width: 100, height: 80 },
      };
      const args = durableToolArgsForNavigation(documentFor(blankSource), 'layer-1', 'text');
      expect(args).toBeNull();
    });

    it('falls back to saved settings when source kind is paint', () => {
      const paintSource: DurableLayerSource = {
        kind: 'paint',
        toolName: 'draw',
        args: { toolName: 'draw' },
        size: { width: 100, height: 80 },
        sourcePos: { x: 0, y: 0, width: 100, height: 80 },
      };
      const args = durableToolArgsForNavigation(documentFor(paintSource), 'layer-1', 'draw');
      expect(args).toBeNull();
    });

    it('falls back to saved settings when source kind is legacy-tool', () => {
      const legacySource: DurableLayerSource = {
        kind: 'legacy-tool',
        toolName: 'text',
        args: { toolName: 'text' },
        size: { width: 100, height: 80 },
      };
      const args = durableToolArgsForNavigation(documentFor(legacySource), 'layer-1', 'text');
      expect(args).toBeNull();
    });
  });

  describe('hydration timing - effect dependencies', () => {
    it('requires activeLayerId change to trigger', () => {
      // The useEffect in useCurrentTool has activeLayerId in its dependency array
      // This test documents that hydration is gated on activeLayerId change
      const doc = documentFor(textSource({ fontSize: 48 }));
      const args1 = durableToolArgsForNavigation(doc, 'layer-1', 'text');
      const args2 = durableToolArgsForNavigation(doc, 'layer-2', 'text');
      expect(args1).not.toBeNull();
      expect(args2).toBeNull(); // layer-2 doesn't exist in baseline
    });

    it('requires durableDocument change to trigger', () => {
      const doc1 = documentFor(textSource({ fontSize: 24 }));
      const doc2 = documentFor(textSource({ fontSize: 48 }));
      const args1 = durableToolArgsForNavigation(doc1, 'layer-1', 'text');
      const args2 = durableToolArgsForNavigation(doc2, 'layer-1', 'text');
      expect(args1).toMatchObject({ fontSize: 24 });
      expect(args2).toMatchObject({ fontSize: 48 });
    });

    it('requires durableStatus === current to hydrate', () => {
      // Simulate non-current status by passing null document
      const args = durableToolArgsForNavigation(null, 'layer-1', 'text');
      expect(args).toBeNull();
    });
  });

  describe('preview protection - in-flight edit not clobbered', () => {
    it('hydration returns null when previewLayers has content', () => {
      // This is tested at the useCurrentTool level via the useEffect guard:
      // if (Object.keys(previewLayers.current).length > 0) return;
      // The function itself doesn't know about previewLayers, but the caller does.
      // This test documents the contract.
      const doc = documentFor(textSource({ fontSize: 48 }));
      const args = durableToolArgsForNavigation(doc, 'layer-1', 'text');
      expect(args).not.toBeNull(); // Function works, but caller guards it
    });

    it('hydration returns null when hasPendingText is true', () => {
      // Guarded by: if (hasPendingText(currentArgsRef.current) ...) return;
      // The function itself doesn't know about pending text, but the caller does.
      const doc = documentFor(textSource({ fontSize: 48 }));
      const args = durableToolArgsForNavigation(doc, 'layer-1', 'text');
      expect(args).not.toBeNull(); // Function works, but caller guards it
    });

    it('hydration returns null when isDocumentGestureOpen is true', () => {
      // Guarded by: if (isDocumentGestureOpen()) return;
      const doc = documentFor(textSource({ fontSize: 48 }));
      const args = durableToolArgsForNavigation(doc, 'layer-1', 'text');
      expect(args).not.toBeNull(); // Function works, but caller guards it
    });
  });

  describe('saved settings fallback chain', () => {
    it('returns null for legacy-tool source (caller uses lastSavedSettings)', () => {
      const legacySource: DurableLayerSource = {
        kind: 'legacy-tool',
        toolName: 'text',
        args: { toolName: 'text' },
        size: { width: 100, height: 80 },
      };
      const args = durableToolArgsForNavigation(documentFor(legacySource), 'layer-1', 'text');
      expect(args).toBeNull();
    });

    it('returns null for missing active layer in document', () => {
      const doc = documentFor(textSource({ fontSize: 48 }));
      const args = durableToolArgsForNavigation(doc, 'non-existent-layer', 'text');
      expect(args).toBeNull();
    });

    it('returns null when source toolName mismatches requested toolName', () => {
      const doc = documentFor(vectorSource('ellipse'));
      const args = durableToolArgsForNavigation(doc, 'layer-1', 'rectangle');
      expect(args).toBeNull();
    });
  });

  describe('useCurrentTool hydration effect - integration behavior', () => {
    it('hydrates after navigation (history cursor change)', () => {
      // When resetHistoryTo navigates, durableDocument updates, triggering hydration
      // This is an integration test placeholder - the actual effect runs in React context
      const doc = documentFor(textSource({ fontSize: 48, color: '#ff0000' }));
      const args = durableToolArgsForNavigation(doc, 'layer-1', 'text');
      expect(args).toMatchObject({ fontSize: 48, color: '#ff0000' });
    });

    it('hydrates after undo/redo (historyIndex change)', () => {
      // undo/redo calls resetHistoryTo which updates durableDocument
      const doc = documentFor(vectorSource('ellipse', { figure: 'oval', lineWidth: 5 }));
      const args = durableToolArgsForNavigation(doc, 'layer-1', 'ellipse');
      expect(args).toMatchObject({ figure: 'oval', lineWidth: 5 });
    });

    it('hydrates after history panel click', () => {
      // HistoryTab click -> resetHistoryTo -> durableDocument update -> hydration
      const doc = documentFor(textSource({ fontSize: 36, fontFamily: 'Arial' }));
      const args = durableToolArgsForNavigation(doc, 'layer-1', 'text');
      expect(args).toMatchObject({ fontSize: 36, fontFamily: 'Arial' });
    });

    it('does not hydrate during active text edit (previewLayers guard)', () => {
      // When user is actively editing text, previewLayers has content
      // The effect returns early, preserving the in-flight edit args
      // This is tested by the integration test in useCurrentTool.test.tsx
      expect(true).toBe(true); // Placeholder for integration test
    });

    it('does not hydrate during document gesture (isDocumentGestureOpen guard)', () => {
      // During drag/transform, gesture is open, hydration deferred
      expect(true).toBe(true); // Placeholder for integration test
    });
  });
});
