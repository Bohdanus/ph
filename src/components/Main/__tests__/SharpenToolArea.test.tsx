import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RefObject } from 'react';
import { SharpenToolArea } from '../SharpenToolArea.tsx';

/**
 * Direct coverage for the Sharpen tool area. This component is the documented
 * ABSENCE of an interactive surface: it renders a hidden, empty div so the
 * tool's options bar can be mounted while the canvas remains inert.
 */
const makeRef = <T,>(): RefObject<T | null> => ({ current: null });

describe('SharpenToolArea', () => {
  it('renders a hidden, empty div that keeps the shared className verbatim', () => {
    const { container } = render(
      <SharpenToolArea className="absolute inset-0" overlayCtxRef={makeRef<CanvasRenderingContext2D>()} />
    );
    const el = container.firstElementChild as HTMLElement;

    expect(el).toBeInTheDocument();
    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('absolute inset-0');
    expect(el.style.display).toBe('none');
    expect(el.childNodes).toHaveLength(0);
  });

  it('renders with an empty className when none is supplied', () => {
    const { container } = render(<SharpenToolArea overlayCtxRef={makeRef<CanvasRenderingContext2D>()} />);
    const el = container.firstElementChild as HTMLElement;

    expect(el.className).toBe('');
    expect(el.style.display).toBe('none');
  });

  it('accepts the shared tool-area refs without rendering anything from them', () => {
    const { container } = render(
      <SharpenToolArea
        className="tool-area"
        overlayCtxRef={makeRef<CanvasRenderingContext2D>()}
        canvasCtxRef={makeRef<CanvasRenderingContext2D>()}
      />
    );
    const el = container.firstElementChild as HTMLElement;

    expect(el.className).toBe('tool-area');
    expect(el.children).toHaveLength(0);
    expect(el.querySelector('canvas')).toBeNull();
  });

  it('registers no pointer handlers so it never swallows editor input', () => {
    const { container } = render(
      <SharpenToolArea className="tool-area" overlayCtxRef={makeRef<CanvasRenderingContext2D>()} />
    );
    const el = container.firstElementChild as HTMLElement;

    expect(el).toHaveProperty('onpointerdown', null);
    expect(el).toHaveProperty('onpointermove', null);
    expect(el).toHaveProperty('onpointerup', null);
    expect(el).toHaveProperty('oncontextmenu', null);
  });
});
