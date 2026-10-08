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
});
