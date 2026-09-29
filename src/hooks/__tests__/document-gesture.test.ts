import { afterEach, describe, expect, it } from 'vitest';
import {
  claimDocumentGesture,
  isDocumentGestureOpen,
  readDocumentGesture,
  releaseDocumentGesture,
  resetDocumentGestures,
} from '../document-gesture';

describe('document-gesture', () => {
  // The slot is module-level, which is the point of the module and also its one
  // hazard: a case that leaves a claim behind would gate every later assertion in
  // this file. Every case is therefore torn down, and `resetDocumentGestures` is
  // itself under test below rather than assumed.
  afterEach(() => {
    resetDocumentGestures();
  });

  it('reports no gesture before anything claims one', () => {
    expect(isDocumentGestureOpen()).toBe(false);
    expect(readDocumentGesture()).toBeNull();
  });

  it('opens on the first claim and records the kind and the pointer it was taken with', () => {
    expect(claimDocumentGesture('rectangular-selection', 7)).toBe(true);

    expect(isDocumentGestureOpen()).toBe(true);
    expect(readDocumentGesture()).toEqual({ kind: 'rectangular-selection', pointerId: 7 });
  });

  it('refuses a second claim, so the document has one owner at a time', () => {
    expect(claimDocumentGesture('rectangular-selection', 1)).toBe(true);
    // A different kind and a different pointer, so nothing about the loser is
    // what the refusal depends on.
    expect(claimDocumentGesture('layer-transform', 2)).toBe(false);

    expect(readDocumentGesture()).toEqual({ kind: 'rectangular-selection', pointerId: 1 });
  });

  it('ignores a release that names a different kind', () => {
    claimDocumentGesture('polygon-selection', 3);

    releaseDocumentGesture('freehand-lasso', 3);

    expect(isDocumentGestureOpen()).toBe(true);
    expect(readDocumentGesture()).toEqual({ kind: 'polygon-selection', pointerId: 3 });
  });

  it('ignores a release that names a different pointer', () => {
    claimDocumentGesture('polygon-selection', 3);

    releaseDocumentGesture('polygon-selection', 4);

    expect(isDocumentGestureOpen()).toBe(true);
  });

  it('closes on a release that names the open claim exactly', () => {
    claimDocumentGesture('freehand-lasso', 5);

    releaseDocumentGesture('freehand-lasso', 5);

    expect(isDocumentGestureOpen()).toBe(false);
    expect(readDocumentGesture()).toBeNull();
  });

  it('treats a release with nothing open as a no-op, so abort routes can call it unconditionally', () => {
    expect(() => {
      releaseDocumentGesture('shape-draw', 1);
    }).not.toThrow();

    expect(isDocumentGestureOpen()).toBe(false);
  });

  it('releases a null-pointer claim by kind, which is the synthetic-event case', () => {
    // A caller with no pointer id still closes the keyboard: the claim records
    // the identity it was given, and `null` is an identity, not "unknown". It is
    // the same distinction `usePointerPosition` draws with its `null` sentinel.
    expect(claimDocumentGesture('brush-stroke', null)).toBe(true);
    expect(readDocumentGesture()).toEqual({ kind: 'brush-stroke', pointerId: null });

    releaseDocumentGesture('brush-stroke', null);

    expect(isDocumentGestureOpen()).toBe(false);
  });

  it('lets the next claim through after a release, so a second gesture is not blocked by the first', () => {
    claimDocumentGesture('rectangular-selection', 1);
    releaseDocumentGesture('rectangular-selection', 1);

    expect(claimDocumentGesture('rectangular-selection', 2)).toBe(true);
  });

  it('drops a claim left behind by a mount that never released it', () => {
    // This is what a leaked claim looks like: a surface torn down between claim
    // and commit. `resetDocumentGestures` is the only way out, and it is why the
    // keyboard provider calls it on mount.
    claimDocumentGesture('layer-transform', 9);
    expect(isDocumentGestureOpen()).toBe(true);

    resetDocumentGestures();

    expect(isDocumentGestureOpen()).toBe(false);
    expect(readDocumentGesture()).toBeNull();
  });

  it('hands back a copy, so a caller cannot mutate the open claim in place', () => {
    claimDocumentGesture('polygon-selection', 2);

    const read = readDocumentGesture();
    if (!read) throw new Error('expected an open claim');
    read.kind = 'shape-draw';
    read.pointerId = 99;

    expect(readDocumentGesture()).toEqual({ kind: 'polygon-selection', pointerId: 2 });
    // And the mutated copy can never be used to close someone else's claim.
    releaseDocumentGesture('shape-draw', 99);
    expect(isDocumentGestureOpen()).toBe(true);
  });
});
