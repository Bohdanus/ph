import { createRef, type RefObject } from 'react';
import { describe, expect, it } from 'vitest';
import { setRefValue } from '../ref.ts';

describe('setRefValue', () => {
  it('assigns the value onto the ref object', () => {
    const ref = createRef<string>();

    setRefValue(ref, 'layer-1');

    expect(ref.current).toBe('layer-1');
  });

  it('mutates the existing ref instead of replacing it', () => {
    const ref: RefObject<string | null> = { current: 'old' };
    // A second holder of the same object stands in for a ref passed down through props: the
    // risk being guarded against is a rebind, which would leave every other holder stale.
    // `expect(ref).toBe(ref)` could never fail — `setRefValue` receives `ref` by value and has
    // no mechanism to rebind the caller's binding — so the assertion has to be made through
    // the alias.
    const consumer = { ref };

    setRefValue(ref, 'new');

    expect(consumer.ref).toBe(ref);
    expect(consumer.ref.current).toBe('new');
  });

  it('clears the ref when the value is null', () => {
    const ref: RefObject<HTMLCanvasElement | null> = { current: document.createElement('canvas') };

    setRefValue(ref, null);

    expect(ref.current).toBeNull();
  });

  it('returns undefined so it is safe to use in a callback body', () => {
    const ref = createRef<number>();

    expect(setRefValue(ref, 1)).toBeUndefined();
    expect(ref.current).toBe(1);
  });
});
