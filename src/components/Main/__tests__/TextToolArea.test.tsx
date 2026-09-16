import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TextToolArea } from '../TextToolArea.tsx';

const setToolArgs = vi.fn();
const textareaRef = { current: null as HTMLTextAreaElement | null };
const toolOverlayRef = { current: document.createElement('canvas') };
const containerRef = { current: document.createElement('div') };
const toolArgs: { toolName: 'draw' | 'text'; text?: string; rect?: null } = {
  toolName: 'draw',
};

let latestUseRectProps: { onChangeEnd?: (rect: any) => void } | null = null;

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef,
      textareaRef,
      toolOverlayRef,
      color: '#000000',
      totalSize: { width: 100, height: 100 },
    },
    vi.fn(),
  ],
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ toolArgs, setToolArgs }),
}));

vi.mock('../../../hooks/useRect.ts', () => ({
  useRect: (props: typeof latestUseRectProps) => {
    latestUseRectProps = props;
    return {};
  },
}));

vi.mock('../../../util/rect.ts', () => ({
  calculateNewRect: vi.fn(() => null),
}));

describe('TextToolArea', () => {
  beforeEach(() => {
    toolArgs.toolName = 'draw';
    textareaRef.current = null;
    latestUseRectProps = null;
    setToolArgs.mockReset();
  });

  it('does not crash when the textarea ref is not attached yet', () => {
    expect(() => render(<TextToolArea canvasCtxRef={{ current: null }} overlayCtxRef={{ current: null }} />)).not.toThrow();
  });

  it('focuses the textarea after text arguments become active', () => {
    const { rerender } = render(<TextToolArea canvasCtxRef={{ current: null }} overlayCtxRef={{ current: null }} />);
    const textarea = document.createElement('textarea');
    const focus = vi.spyOn(textarea, 'focus');
    textareaRef.current = textarea;

    act(() => {
      toolArgs.toolName = 'text';
      rerender(<TextToolArea canvasCtxRef={{ current: null }} overlayCtxRef={{ current: null }} />);
    });

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('does not crash when a rectangle finishes while the textarea is unavailable', () => {
    render(<TextToolArea canvasCtxRef={{ current: null }} overlayCtxRef={{ current: null }} />);

    expect(() => act(() => latestUseRectProps?.onChangeEnd?.({ x1: 0, y1: 0, x2: 10, y2: 10 }))).not.toThrow();
  });
});
