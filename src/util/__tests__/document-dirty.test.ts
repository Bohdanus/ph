import { describe, expect, it } from 'vitest';
import { hasDiscardableWork } from '../document-dirty.ts';
import type { ToolArgs } from '../../contexts/tool-types.ts';
import type { TextToolArgs } from '../../tools/text.ts';

const clean = {
  hasImage: true,
  hasUnsavedChanges: false,
  currentArgs: { toolName: 'draw' } as ToolArgs,
  pendingPreviewCount: 0,
};

/** A typed-but-unplaced text box: `hasPendingText`'s exact shape. */
const pendingText = {
  toolName: 'text',
  text: 'hello',
  rect: { x: 0, y: 0, width: 100, height: 20 },
} as unknown as TextToolArgs & { toolName: 'text' };

describe('hasDiscardableWork', () => {
  it('is false for a document with nothing in it', () => {
    expect(hasDiscardableWork(clean)).toBe(false);
  });

  it('is true once the document has committed work', () => {
    expect(hasDiscardableWork({ ...clean, hasUnsavedChanges: true })).toBe(true);
  });

  it('is true for a typed but unplaced text box, which has not been committed', () => {
    // The half of the predicate that `hasUnsavedChanges` alone cannot see: the text lives
    // only in `currentArgs` until a tool commit moves it onto the timeline.
    expect(hasDiscardableWork({ ...clean, currentArgs: pendingText })).toBe(true);
  });

  it('is true for an in-flight tool preview, which dispatches nothing at all', () => {
    // A brush stroke mid-drag and a Levels slider pulled halfway both live in
    // `previewLayers` and write no history, so `hasUnsavedChanges` is still false.
    expect(hasDiscardableWork({ ...clean, pendingPreviewCount: 1 })).toBe(true);
  });

  it('ignores every signal when there is no document to discard', () => {
    // Not a hypothetical: the startup blank document and `Main`'s empty-state buttons both
    // run with `hasImage` false, and a prompt there could only ever be answered "yes".
    expect(hasDiscardableWork({ ...clean, hasImage: false, hasUnsavedChanges: true })).toBe(false);
    expect(hasDiscardableWork({ ...clean, hasImage: false, currentArgs: pendingText })).toBe(false);
    expect(hasDiscardableWork({ ...clean, hasImage: false, pendingPreviewCount: 3 })).toBe(false);
  });

  it('ignores a text draft with no rectangle, which nothing would ever commit', () => {
    const { rect: _rect, ...withoutRect } = pendingText;
    expect(hasDiscardableWork({ ...clean, currentArgs: withoutRect as ToolArgs })).toBe(false);
  });

  it('ignores empty tool args, which is what every non-text tool carries', () => {
    expect(hasDiscardableWork({ ...clean, currentArgs: {} as ToolArgs })).toBe(false);
    expect(hasDiscardableWork({ ...clean, currentArgs: null as unknown as ToolArgs })).toBe(false);
  });
});
