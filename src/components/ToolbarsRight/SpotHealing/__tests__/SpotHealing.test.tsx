import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SpotHealing from '../SpotHealing.tsx';

const { patchToolArgsMock, toolArgsMock } = vi.hoisted(() => ({
  patchToolArgsMock: vi.fn(),
  toolArgsMock: {
    toolName: 'spot-healing',
    size: 40,
    hardness: 100,
    opacity: 1,
    points: [],
  },
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ getToolArgs: () => toolArgsMock, patchToolArgs: patchToolArgsMock }),
}));

const rafCallbacks: FrameRequestCallback[] = [];

beforeEach(() => {
  rafCallbacks.length = 0;
  patchToolArgsMock.mockReset();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => vi.unstubAllGlobals());

describe('SpotHealing options bar', () => {
  it('merges slider changes that arrive in the same animation frame', () => {
    render(<SpotHealing />);

    fireEvent.change(screen.getByRole('slider', { name: 'Size' }), { target: { value: '72' } });
    fireEvent.change(screen.getByRole('slider', { name: 'Hardness' }), { target: { value: '35' } });

    expect(patchToolArgsMock).not.toHaveBeenCalled();

    act(() => {
      rafCallbacks.splice(0).forEach((callback) => callback(0));
    });

    expect(patchToolArgsMock).toHaveBeenCalledExactlyOnceWith('spot-healing', { size: 72, hardness: 35 });
  });

  it('flushes a single slider change with only the changed field', () => {
    render(<SpotHealing />);

    fireEvent.change(screen.getByRole('slider', { name: 'Size' }), { target: { value: '72' } });

    expect(patchToolArgsMock).not.toHaveBeenCalled();

    act(() => {
      rafCallbacks.splice(0).forEach((callback) => callback(0));
    });

    expect(patchToolArgsMock).toHaveBeenCalledExactlyOnceWith('spot-healing', { size: 72 });
  });

  it('flushes separate patches across different animation frames', () => {
    render(<SpotHealing />);

    fireEvent.change(screen.getByRole('slider', { name: 'Size' }), { target: { value: '72' } });
    act(() => {
      rafCallbacks.splice(0).forEach((callback) => callback(0));
    });

    fireEvent.change(screen.getByRole('slider', { name: 'Hardness' }), { target: { value: '35' } });
    act(() => {
      rafCallbacks.splice(0).forEach((callback) => callback(0));
    });

    expect(patchToolArgsMock).toHaveBeenCalledTimes(2);
    expect(patchToolArgsMock).toHaveBeenNthCalledWith(1, 'spot-healing', { size: 72 });
    expect(patchToolArgsMock).toHaveBeenNthCalledWith(2, 'spot-healing', { hardness: 35 });
  });

  it.each([0, 100])('merges slider changes at Size boundary %i without breaking', (size) => {
    render(<SpotHealing />);

    fireEvent.change(screen.getByRole('slider', { name: 'Size' }), { target: { value: String(size) } });
    fireEvent.change(screen.getByRole('slider', { name: 'Hardness' }), { target: { value: '35' } });

    expect(patchToolArgsMock).not.toHaveBeenCalled();

    act(() => {
      rafCallbacks.splice(0).forEach((callback) => callback(0));
    });

    expect(patchToolArgsMock).toHaveBeenCalledTimes(1);
    const patch = patchToolArgsMock.mock.calls[0][1];
    // `BRUSH_SIZE_MIN` is 1, so the DOM range input clamps a Size of 0 to 1.
    expect(patch).toEqual({ size: Math.max(1, size), hardness: 35 });
  });
});
