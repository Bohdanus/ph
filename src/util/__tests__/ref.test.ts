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

  describe('edge cases', () => {
    it('handles an empty string value', () => {
      const ref = createRef<string>();

      setRefValue(ref, '');

      expect(ref.current).toBe('');
    });

    it('handles zero (falsy but a perfectly valid number)', () => {
      const ref = createRef<number>();

      setRefValue(ref, 0);

      expect(ref.current).toBe(0);
    });

    it('handles false (falsy but a valid boolean)', () => {
      const ref = createRef<boolean>();

      setRefValue(ref, false);

      expect(ref.current).toBe(false);
    });

    it('handles true (truthy boolean)', () => {
      const ref = createRef<boolean>();

      setRefValue(ref, true);

      expect(ref.current).toBe(true);
    });

    it('handles NaN without throwing', () => {
      const ref = createRef<number>();

      setRefValue(ref, NaN);

      expect(Number.isNaN(ref.current)).toBe(true);
    });

    it('handles Infinity', () => {
      const ref = createRef<number>();

      setRefValue(ref, Infinity);

      expect(ref.current).toBe(Infinity);
    });

    it('handles -Infinity', () => {
      const ref = createRef<number>();

      setRefValue(ref, -Infinity);

      expect(ref.current).toBe(-Infinity);
    });

    it('assigns an object value by reference (identity preserved)', () => {
      const ref = createRef<{ id: number; name: string }>();
      const obj = { id: 1, name: 'layer' };

      setRefValue(ref, obj);

      expect(ref.current).toBe(obj);
      expect(ref.current?.id).toBe(1);
    });

    it('assigns a function value by reference (invocable after)', () => {
      const ref = createRef<() => string>();
      const fn = () => 'hello';

      setRefValue(ref, fn);

      expect(ref.current).toBe(fn);
      expect(ref.current?.()).toBe('hello');
    });

    it('assigns an array value by reference', () => {
      const ref = createRef<number[]>();
      const arr = [1, 2, 3];

      setRefValue(ref, arr);

      expect(ref.current).toBe(arr);
      expect(ref.current).toEqual([1, 2, 3]);
    });

    it('last write wins when called sequentially on the same ref', () => {
      const ref = createRef<string>();

      setRefValue(ref, 'first');
      setRefValue(ref, 'second');
      setRefValue(ref, 'third');

      expect(ref.current).toBe('third');
    });

    it('preserves unrelated properties on a plain ref-like object', () => {
      const ref = { current: 'initial', tag: 'metadata' } as {
        current: string;
        tag: string;
      };

      setRefValue(ref, 'updated');

      expect(ref.current).toBe('updated');
      expect(ref.tag).toBe('metadata');
    });

    it('overwrites a previously assigned object with a completely different shape', () => {
      const ref = createRef<string | number>();

      setRefValue(ref, 'string');
      setRefValue(ref, 42);

      expect(ref.current).toBe(42);
    });
  });

  describe('null and undefined values', () => {
    it('sets the value to undefined', () => {
      const ref: RefObject<string | undefined> = { current: 'initial' };

      setRefValue(ref, undefined);

      expect(ref.current).toBeUndefined();
    });

    it('overwrites an initially undefined current with a real value', () => {
      const ref: RefObject<string | undefined> = { current: undefined };

      setRefValue(ref, 'assigned');

      expect(ref.current).toBe('assigned');
    });

    it('sets the value to null on a previously populated canvas ref', () => {
      const ref: RefObject<HTMLCanvasElement | null> = {
        current: document.createElement('canvas'),
      };

      setRefValue(ref, null);

      expect(ref.current).toBeNull();
    });

    it('overwrites an initially null current with a real value', () => {
      const ref: RefObject<HTMLCanvasElement | null> = { current: null };
      const canvas = document.createElement('canvas');

      setRefValue(ref, canvas);

      expect(ref.current).not.toBeNull();
      expect(ref.current).toBe(canvas);
    });

    it('toggles between a value and null repeatedly (last state wins)', () => {
      const ref: RefObject<string | null> = { current: 'active' };

      setRefValue(ref, null);
      setRefValue(ref, 'restored');
      setRefValue(ref, null);
      setRefValue(ref, 'final');

      expect(ref.current).toBe('final');
    });

    it('toggles between a value and undefined repeatedly', () => {
      const ref: RefObject<string | undefined> = { current: 'active' };

      setRefValue(ref, undefined);
      setRefValue(ref, 'restored');
      setRefValue(ref, undefined);

      expect(ref.current).toBeUndefined();
    });
  });

  describe('tripwires (it.fails)', () => {
    it.fails('returns the ref object instead of undefined', () => {
      const ref = createRef<string>();

      const result = setRefValue(ref, 'value');

      expect(result).toBe(ref);
    });

    it.fails('returns the assigned value', () => {
      const ref = createRef<string>();

      const result = setRefValue(ref, 'assigned');

      expect(result).toBe('assigned');
    });

    it.fails('returns a freshly constructed { current: value } object', () => {
      const ref = createRef<string>();

      const result = setRefValue(ref, 'value');

      expect(result).toEqual({ current: 'value' });
    });

    it.fails('leaves a stale alias when the ref is replaced rather than mutated', () => {
      // A caller may hold an alias to the same ref object (e.g. via closure). The correct
      // behaviour is in-place mutation, so the alias sees the update. This tripwire asserts
      // the WRONG contract — that the alias stays stale — and therefore must fail.
      const original: RefObject<string | null> = { current: 'old' };
      const alias = original;

      setRefValue(original, 'new');

      expect(alias.current).toBe('old');
    });

    it.fails("mutates the caller's binding (rebinds the parameter)", () => {
      // `setRefValue` receives `ref` by value; it cannot rebind the caller's variable.
      // This tripwire asserts that the caller's variable somehow points to a new object
      // after the call, which is impossible — so it must fail.
      const ref = createRef<string>();
      const before = ref;

      setRefValue(ref, 'value');

      expect(ref).not.toBe(before);
    });

    it.fails('silently accepts a null ref without throwing', () => {
      // TypeScript forbids this at the type level; at runtime `null.current` throws.
      setRefValue(null as unknown as { current: string }, 'value');
    });

    it.fails('silently accepts an undefined ref without throwing', () => {
      // TypeScript forbids this at the type level; at runtime `undefined.current` throws.
      setRefValue(undefined as unknown as { current: string }, 'value');
    });
  });
});
