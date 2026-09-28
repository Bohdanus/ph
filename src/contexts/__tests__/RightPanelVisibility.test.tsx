import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setViewportWidth } from '../../test/setup.ts';
import { RightPanelVisibilityProvider, useRightPanelVisibility } from '../RightPanelVisibility.tsx';

/** Stands in for the header toggle and the panel itself. */
const Probe = () => {
  const { isCollapsible, isOpen, toggle } = useRightPanelVisibility();
  return (
    <div>
      <div data-testid="probe">{`${isCollapsible}/${isOpen}`}</div>
      {isCollapsible && (
        <button type="button" onClick={toggle} data-testid="toggle">
          toggle
        </button>
      )}
    </div>
  );
};

const probe = () => screen.getByTestId('probe').textContent;

const renderProbe = () =>
  render(
    <RightPanelVisibilityProvider>
      <Probe />
    </RightPanelVisibilityProvider>
  );

describe('RightPanelVisibility', () => {
  beforeEach(() => setViewportWidth(1280, 800));
  afterEach(() => setViewportWidth(1280, 800));

  it('is not collapsible on desktop, and the panel is unconditionally open there', () => {
    renderProbe();

    expect(probe()).toBe('false/true');
    // No toggle is offered on desktop, so the panel cannot be taken away there.
    expect(screen.queryByTestId('toggle')).toBeNull();
  });

  it('starts collapsed in the tablet band, so the canvas gets the 250px back', () => {
    setViewportWidth(900);
    renderProbe();

    expect(probe()).toBe('true/false');
  });

  it('opens and closes the panel from the tablet band', () => {
    setViewportWidth(900);
    renderProbe();

    act(() => {
      fireEvent.click(screen.getByTestId('toggle'));
    });
    expect(probe()).toBe('true/true');

    act(() => {
      fireEvent.click(screen.getByTestId('toggle'));
    });
    expect(probe()).toBe('true/false');
  });

  it('restores the panel when the window widens out of the tablet band', () => {
    setViewportWidth(900);
    renderProbe();
    expect(probe()).toBe('true/false');

    // A tablet collapse must not follow the user onto desktop. This is why `isOpen` is
    // `!isTablet || toggled` rather than the toggled value on its own.
    act(() => setViewportWidth(1280));
    expect(probe()).toBe('false/true');
  });

  it('is collapsed again when the window returns to the tablet band', () => {
    setViewportWidth(900);
    renderProbe();

    act(() => setViewportWidth(1280));
    expect(probe()).toBe('false/true');

    act(() => setViewportWidth(900));
    expect(probe()).toBe('true/false');
  });

  it('re-collapses at the tablet band, ignoring an open state set on desktop', () => {
    // `isToggledOpen` is only reachable through the tablet toggle, so this is the state a
    // user reaches by opening the panel on a tablet, widening, and narrowing again.
    setViewportWidth(900);
    renderProbe();

    act(() => {
      fireEvent.click(screen.getByTestId('toggle'));
    });
    expect(probe()).toBe('true/true');

    act(() => setViewportWidth(1280));
    expect(probe()).toBe('false/true');
  });

  it('is available at the band edges and outside them', () => {
    for (const [width, expected] of [
      [767, 'false/true'],
      [768, 'true/false'],
      [1023, 'true/false'],
      [1024, 'false/true'],
    ] as const) {
      const view = renderProbe();
      act(() => setViewportWidth(width));
      expect({ width, actual: probe() }).toEqual({ width, actual: expected });
      view.unmount();
    }
  });
});
