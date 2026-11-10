import type { RefObject } from 'react';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_VIEW_STATE, viewStateRef } from '../../contexts/view-state.ts';
import { usePointerPosition } from '../usePointerPosition.ts';

const IMAGE = { width: 100, height: 100 };

afterEach(() => {
  viewStateRef.current = DEFAULT_VIEW_STATE;
});

describe('usePointerPosition fractional viewport mapping', () => {
  it('uses the fractional client width for fitting and pointer mapping', () => {
    const rect = { left: 50.25, top: 25.5, width: 400.75, height: 200 };
    const element = document.createElement('div');
    element.getBoundingClientRect = () =>
      ({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
      }) as DOMRect;
    Object.defineProperties(element, {
      clientLeft: { configurable: true, value: 0 },
      clientTop: { configurable: true, value: 0 },
      clientWidth: { configurable: true, value: Math.round(rect.width) },
      clientHeight: { configurable: true, value: rect.height },
      offsetWidth: { configurable: true, value: Math.round(rect.width) },
      offsetHeight: { configurable: true, value: rect.height },
    });
    viewStateRef.current = { ...DEFAULT_VIEW_STATE, fitToScreen: false };

    const ref: RefObject<HTMLDivElement | null> = { current: element };
    const { result } = renderHook(() => usePointerPosition({ ref, imageSize: IMAGE }));
    const dimensions = result.current.dimensionsRef.current;
    const clientX = rect.left + dimensions.offsetX + dimensions.scale * 10;
    const clientY = rect.top + dimensions.offsetY + dimensions.scale * 20;

    expect(dimensions).toMatchObject({ outerWidth: 400.75, outerHeight: 200, scale: 2, offsetX: 100.375, offsetY: 0 });
    expect(result.current.getLocalCoordsFromClientPoint(clientX, clientY)).toEqual({ x: 10, y: 20 });
  });
});
