import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RefObject } from 'react';
import { DummyToolArea } from '../DummyToolArea.tsx';

/**
 * Direct coverage for the fallback tool area. Main.toolAreas.test.tsx already
 * checks that Main routes unmapped tools here; these tests pin the component's
 * own contract: hidden, inert, and className passthrough.
 */

const makeRef = <T,>(): RefObject<T | null> => ({ current: null });

describe('DummyToolArea', () => {
  it('renders a hidden, empty div that keeps the shared className verbatim', () => {
    const { container } = render(<DummyToolArea className="absolute inset-0" />);
    const el = container.firstElementChild as HTMLElement;

    expect(el).toBeInTheDocument();
    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('absolute inset-0');
    expect(el.style.display).toBe('none');
    expect(el.childNodes).toHaveLength(0);
  });

  it('renders with an empty className when none is supplied', () => {
    const { container } = render(<DummyToolArea />);
    const el = container.firstElementChild as HTMLElement;

    expect(el.className).toBe('');
    expect(el.style.display).toBe('none');
  });

  it('accepts the shared tool-area refs without rendering anything from them', () => {
    const { container } = render(
      <DummyToolArea
        className="tool-area"
        canvasCtxRef={makeRef<CanvasRenderingContext2D>()}
        overlayCtxRef={makeRef<CanvasRenderingContext2D>()}
        toolOverlayRef={makeRef<HTMLCanvasElement>()}
      />
    );
    const el = container.firstElementChild as HTMLElement;

    expect(el.className).toBe('tool-area');
    expect(el.children).toHaveLength(0);
    expect(el.querySelector('canvas')).toBeNull();
  });

  it('registers no pointer handlers so it never swallows editor input', () => {
    const { container } = render(<DummyToolArea className="tool-area" />);
    const el = container.firstElementChild as HTMLElement;

    expect(el).toHaveProperty('onpointerdown', null);
    expect(el).toHaveProperty('onpointermove', null);
    expect(el).toHaveProperty('onpointerup', null);
    expect(el).toHaveProperty('oncontextmenu', null);
  });
});
