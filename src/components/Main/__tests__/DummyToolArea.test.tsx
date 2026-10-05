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

    /**
     * The props React attached to the host node, which is the only place an event handler is
     * observable from the outside: React never reflects one onto a DOM attribute, and jsdom's
     * `onX` IDL properties are NOT it either — `el.onpointerdown` reads `null` whether the node
     * has a React handler, a raw `addEventListener` listener, or neither. So an assertion of the
     * form `expect(el).toHaveProperty('onpointerdown', null)` passes for EVERY element in the
     * DOM, including one carrying a live pointer surface, and this test asserted nothing.
     *
     * React DOM stores the props it attached under a `__reactProps$<key>` expando
     * (`updateFiberProps`), so that is what is read here. `Main.toolAreas.test.tsx` reaches the
     * same conclusion about `SharpenToolArea` through `vi.importActual`; this is the same probe
     * applied to the component whose own file it belongs in.
     */
    const handlerNames = (element: Element): string[] => {
      // The expando is absent from the DOM's own typing, so it is read through an index signature.
      const host = element as unknown as Record<string, unknown>;
      const key = Object.keys(host).find((candidate) => candidate.startsWith('__reactProps$'));
      if (!key) throw new Error('React attached no props to the element, so this probe proves nothing');
      return Object.keys(host[key] as Record<string, unknown>).filter((name) => /^on[A-Z]/.test(name));
    };

    // The detector has to be shown to work, or "no handler names" is indistinguishable from
    // "the probe found nothing" — which is precisely how the previous form of this test could
    // pass while reading an element with a handler on it.
    const control = render(<div className="probe" onPointerDown={() => undefined} />).container
      .firstElementChild as Element;
    expect(handlerNames(control)).toEqual(['onPointerDown']);

    expect(handlerNames(el)).toEqual([]);
  });
});
