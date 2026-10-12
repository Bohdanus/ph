import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HealingBrush from '../HealingBrush.tsx';

const { patchToolArgsMock, toolArgsMock } = vi.hoisted(() => ({
  patchToolArgsMock: vi.fn(),
  toolArgsMock: {
    toolName: 'healing-brush',
    size: 20,
    hardness: 0,
    opacity: 1,
    source: null,
    aligned: true,
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

describe('HealingBrush options bar', () => {
  it('merges slider changes that arrive in the same animation frame', () => {
    render(<HealingBrush />);

    fireEvent.change(screen.getByRole('slider', { name: 'Size' }), { target: { value: '72' } });
    fireEvent.change(screen.getByRole('slider', { name: 'Hardness' }), { target: { value: '35' } });

    expect(patchToolArgsMock).not.toHaveBeenCalled();

    act(() => {
      rafCallbacks.splice(0).forEach((callback) => callback(0));
    });

    expect(patchToolArgsMock).toHaveBeenCalledExactlyOnceWith('healing-brush', { size: 72, hardness: 35 });
  });

  it('patches only Size on a single slider change', () => {
    render(<HealingBrush />);

    fireEvent.change(screen.getByRole('slider', { name: 'Size' }), { target: { value: '72' } });

    expect(patchToolArgsMock).not.toHaveBeenCalled();

    act(() => {
      rafCallbacks.splice(0).forEach((callback) => callback(0));
    });

    expect(patchToolArgsMock).toHaveBeenCalledExactlyOnceWith('healing-brush', { size: 72 });
  });

  it('patches separately for changes across different animation frames', () => {
    render(<HealingBrush />);

    fireEvent.change(screen.getByRole('slider', { name: 'Size' }), { target: { value: '72' } });

    act(() => {
      rafCallbacks.splice(0).forEach((callback) => callback(0));
    });

    fireEvent.change(screen.getByRole('slider', { name: 'Hardness' }), { target: { value: '35' } });

    act(() => {
      rafCallbacks.splice(0).forEach((callback) => callback(0));
    });

    expect(patchToolArgsMock).toHaveBeenCalledTimes(2);
    expect(patchToolArgsMock).toHaveBeenNthCalledWith(1, 'healing-brush', { size: 72 });
    expect(patchToolArgsMock).toHaveBeenNthCalledWith(2, 'healing-brush', { hardness: 35 });
  });

  it.each([0, 100])('merges slider changes at Size boundary %i without breaking', (size) => {
    render(<HealingBrush />);

    fireEvent.change(screen.getByRole('slider', { name: 'Size' }), { target: { value: String(size) } });
    fireEvent.change(screen.getByRole('slider', { name: 'Hardness' }), { target: { value: '35' } });

    expect(patchToolArgsMock).not.toHaveBeenCalled();

    act(() => {
      rafCallbacks.splice(0).forEach((callback) => callback(0));
    });

    expect(patchToolArgsMock).toHaveBeenCalledTimes(1);
    const patch = patchToolArgsMock.mock.calls[0][1];
    expect(patch).toEqual({ size: Math.max(1, size), hardness: 35 });
  });
});
