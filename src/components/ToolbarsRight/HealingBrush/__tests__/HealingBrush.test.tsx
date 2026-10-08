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
});
