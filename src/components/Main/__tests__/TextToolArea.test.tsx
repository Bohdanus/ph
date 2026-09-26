import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TextToolArea } from '../TextToolArea.tsx';
import type { UseRectProps } from '../../../hooks/useRect.ts';

const createSetToolArgs = vi.hoisted(() => vi.fn);
const createTextareaRef = vi.hoisted(() => () => ({ current: null as HTMLTextAreaElement | null }));
const createToolOverlayRef = vi.hoisted(() => () => ({ current: document.createElement('canvas') }));
const createContainerRef = vi.hoisted(() => () => ({ current: document.createElement('div') }));
const createToolArgs = vi.hoisted(() => () => ({ toolName: 'draw' as 'draw' | 'text', text: undefined, rect: null }));
const createLatestUseRectProps = vi.hoisted(() => () => null as UseRectProps | null);

let setToolArgs: ReturnType<typeof createSetToolArgs>;
let textareaRef: ReturnType<typeof createTextareaRef>;
let toolOverlayRef: ReturnType<typeof createToolOverlayRef>;
let containerRef: ReturnType<typeof createContainerRef>;
let toolArgs: ReturnType<typeof createToolArgs>;
let latestUseRectProps: ReturnType<typeof createLatestUseRectProps>;

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      get containerRef() {
        return containerRef;
      },
      get textareaRef() {
        return textareaRef;
      },
      get toolOverlayRef() {
        return toolOverlayRef;
      },
      color: '#000000',
      totalSize: { width: 100, height: 100 },
    },
    vi.fn(),
  ],
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    get toolArgs() {
      return toolArgs;
    },
    get setToolArgs() {
      return setToolArgs;
    },
  }),
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
    setToolArgs = createSetToolArgs();
    textareaRef = createTextareaRef();
    toolOverlayRef = createToolOverlayRef();
    containerRef = createContainerRef();
    toolArgs = createToolArgs();
    latestUseRectProps = createLatestUseRectProps();
  });

  it('does not crash when the textarea ref is not attached yet', () => {
    expect(() =>
      render(<TextToolArea canvasCtxRef={{ current: null }} overlayCtxRef={{ current: null }} />)
    ).not.toThrow();
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
