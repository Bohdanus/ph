import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FirstUseTour,
  hasSeenFirstUseTour,
  markFirstUseTourSeen,
  TOUR_SEEN_KEY,
  getHighlightedToolsForStep,
} from '../FirstUseTour.tsx';
import { FirstUseProvider, useFirstUseContext } from '../../../contexts/FirstUseContext.tsx';

type OnComplete = () => void;

const renderInProvider = (onComplete: OnComplete = vi.fn()) => {
  return render(
    <FirstUseProvider>
      <FirstUseTour onComplete={onComplete} />
    </FirstUseProvider>
  );
};

describe('FirstUseTour', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  describe('hasSeenFirstUseTour and markFirstUseTourSeen', () => {
    it('returns false before the tour is marked seen', () => {
      expect(hasSeenFirstUseTour()).toBe(false);
    });

    it('returns true after markFirstUseTourSeen', () => {
      markFirstUseTourSeen();
      expect(hasSeenFirstUseTour()).toBe(true);
    });

    it('persists the flag to localStorage under the correct key', () => {
      markFirstUseTourSeen();
      expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe('true');
    });

    it('returns true when storage is unavailable', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem');
      spy.mockImplementation(() => {
        throw new Error('storage unavailable');
      });
      expect(hasSeenFirstUseTour()).toBe(true);
      spy.mockRestore();
    });

    it('does not throw when persisting the seen flag fails', () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('storage unavailable');
      });

      expect(() => markFirstUseTourSeen()).not.toThrow();
      spy.mockRestore();
    });
  });

  describe('rendering', () => {
    it('renders as a dialog with aria-modal true', () => {
      renderInProvider();
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('exposes aria-labelledby and aria-describedby pointing to real elements', () => {
      renderInProvider();

      const dialog = screen.getByRole('dialog');
      const headingId = dialog.getAttribute('aria-labelledby');
      const bodyId = dialog.getAttribute('aria-describedby');

      expect(dialog.querySelector(`#${headingId}`)).toBeInTheDocument();
      expect(dialog.querySelector(`#${bodyId}`)).toBeInTheDocument();
    });

    it('renders a progress bar reflecting the current step', () => {
      renderInProvider();
      const progressBar = screen.getByRole('progressbar');
      expect(progressBar).toBeInTheDocument();
      expect(progressBar).toHaveAttribute('aria-valuenow', '1');
    });

    it('announces the current step to assistive technology', () => {
      renderInProvider();
      expect(screen.getByRole('status')).toHaveTextContent('Step 1 of 8: Move layers and pan');
    });
  });

  describe('navigation', () => {
    it('advances to the next step on Next click', () => {
      renderInProvider();

      expect(screen.getByRole('heading', { name: /move layers and pan/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Next' }));

      expect(screen.getByRole('heading', { name: /paint with the brush/i })).toBeInTheDocument();
    });

    it('completes the tour and calls onComplete on the last step', () => {
      const onComplete = vi.fn();
      renderInProvider(onComplete);

      while (screen.queryByRole('button', { name: 'Next' })) {
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      }
      fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(hasSeenFirstUseTour()).toBe(true);
    });

    it('persists the seen flag when the last step is completed', () => {
      renderInProvider();

      while (screen.queryByRole('button', { name: 'Next' })) {
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      }
      fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

      expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe('true');
    });

    it('shows Finish instead of Next on the last step', () => {
      renderInProvider();

      while (screen.queryByRole('button', { name: 'Next' })) {
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      }
      expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
    });
  });

  describe('dismissal', () => {
    it('closes via the Close button', () => {
      const onComplete = vi.fn();
      renderInProvider(onComplete);

      fireEvent.click(screen.getByLabelText('Close tour'));

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(hasSeenFirstUseTour()).toBe(true);
    });

    it('closes via the Skip button', () => {
      const onComplete = vi.fn();
      renderInProvider(onComplete);

      fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(hasSeenFirstUseTour()).toBe(true);
    });

    it('closes via Escape key', () => {
      const onComplete = vi.fn();
      renderInProvider(onComplete);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(hasSeenFirstUseTour()).toBe(true);
    });

    it('does not close via clicking the dialog itself', () => {
      const onComplete = vi.fn();
      renderInProvider(onComplete);

      const dialog = screen.getByRole('dialog');
      fireEvent.click(dialog);

      expect(onComplete).not.toHaveBeenCalled();
    });
  });

  describe('focus management', () => {
    it('focuses the first dialog control on mount', () => {
      renderInProvider();
      expect(document.activeElement).toBe(screen.getByLabelText('Close tour'));
    });

    it('restores focus to the previously focused element on unmount', () => {
      const trigger = document.createElement('button');
      trigger.textContent = 'Open Tour';
      document.body.appendChild(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      const { unmount } = renderInProvider();
      expect(document.activeElement).toBe(screen.getByLabelText('Close tour'));

      unmount();

      expect(document.activeElement).toBe(trigger);
      document.body.removeChild(trigger);
    });

    it('traps focus within the dialog when Tab is pressed', () => {
      renderInProvider();

      const dialog = screen.getByRole('dialog');
      const focusableElements = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'));

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];

      first.focus();
      fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(last);

      last.focus();
      fireEvent.keyDown(last, { key: 'Tab' });
      expect(document.activeElement).toBe(first);
    });

    it('prevents focused tour keys from reaching application-level listeners', () => {
      const appKeydown = vi.fn();
      document.addEventListener('keydown', appKeydown);
      renderInProvider();

      fireEvent.keyDown(screen.getByLabelText('Close tour'), { key: 'b' });

      expect(appKeydown).not.toHaveBeenCalled();
      document.removeEventListener('keydown', appKeydown);
    });

    it('recovers focus and suppresses keys that start outside the dialog', () => {
      const appKeydown = vi.fn();
      document.addEventListener('keydown', appKeydown);
      renderInProvider();

      fireEvent.keyDown(document.body, { key: 'b' });

      expect(appKeydown).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
      document.removeEventListener('keydown', appKeydown);
    });
  });

  describe('backdrop', () => {
    it('closes the tour when the backdrop is clicked', () => {
      const onComplete = vi.fn();
      renderInProvider(onComplete);

      const backdrop = document.querySelector('[aria-hidden="true"]');
      expect(backdrop).toBeInTheDocument();

      fireEvent.click(backdrop as Element);

      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  describe('shortcut display', () => {
    it('shows the shortcut for the current step tool when available', () => {
      renderInProvider();

      const shortcutLabel = screen.getByText('Shortcut:');
      expect(shortcutLabel).toBeInTheDocument();

      const kbd = shortcutLabel.nextElementSibling as HTMLElement;
      expect(kbd.tagName.toLowerCase()).toBe('kbd');
      expect(kbd).toHaveTextContent('V');
    });

    it('does not advertise the Brush key for Pencil', () => {
      renderInProvider();
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));

      expect(screen.getByRole('heading', { name: /pixel-precise strokes/i })).toBeInTheDocument();
      expect(screen.queryByText('Shortcut:')).not.toBeInTheDocument();
    });

    it('only describes Brush controls that exist in the options bar', () => {
      renderInProvider();
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));

      expect(screen.getByRole('heading', { name: /paint with the brush/i })).toBeInTheDocument();
      expect(screen.getByRole('dialog')).not.toHaveTextContent(/flow/i);
    });
  });

  describe('Move tool guidance', () => {
    it('does not teach "drag the canvas to pan" — that is the Hand tool', () => {
      renderInProvider();

      const dialog = screen.getByRole('dialog');
      const dialogText = dialog.textContent ?? '';

      // The tour body should NOT contain the incorrect "drag the canvas to pan" phrasing
      expect(dialogText).not.toContain('Drag the canvas to pan');
      // It should mention Spacebar for panning, which is the Photoshop convention
      expect(dialogText).toContain('Space');
    });
  });

  describe('getHighlightedToolsForStep', () => {
    it('returns the visible tile for standalone and flyout steps', () => {
      const tools = getHighlightedToolsForStep(0);
      expect(tools).toEqual(['reposition']);
      expect(getHighlightedToolsForStep(2)).toEqual(['brush']);
      expect(getHighlightedToolsForStep(5)).toEqual(['rectangle']);
    });

    it('returns an empty array for an out-of-bounds index', () => {
      const tools = getHighlightedToolsForStep(999);
      expect(tools).toEqual([]);
    });
  });

  describe('sidebar integration via context', () => {
    it('highlights the correct tile via the context', () => {
      const Probe = () => {
        const { highlightedTools } = useFirstUseContext();
        return <div data-testid="probe">{highlightedTools.join(',')}</div>;
      };

      render(
        <FirstUseProvider>
          <FirstUseTour onComplete={vi.fn()} />
          <Probe />
        </FirstUseProvider>
      );

      // First step is 'reposition'
      expect(screen.getByTestId('probe')).toHaveTextContent('reposition');

      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      // Second step is 'brush'
      expect(screen.getByTestId('probe')).toHaveTextContent('brush');

      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      // Pencil is a Brush flyout member, so the visible Brush tile remains highlighted.
      expect(screen.getByTestId('probe')).toHaveTextContent('brush');
    });

    it('clears the highlight when the tour unmounts', () => {
      const Probe = () => {
        const { highlightedTools } = useFirstUseContext();
        return <div data-testid="probe">{highlightedTools.join(',')}</div>;
      };
      const RemovableTour = () => {
        const [visible, setVisible] = useState(true);
        return (
          <>
            {visible && <FirstUseTour onComplete={vi.fn()} />}
            <button onClick={() => setVisible(false)} type="button">
              Remove tour
            </button>
            <Probe />
          </>
        );
      };

      render(
        <FirstUseProvider>
          <RemovableTour />
        </FirstUseProvider>
      );
      expect(screen.getByTestId('probe')).toHaveTextContent('reposition');

      fireEvent.click(screen.getByRole('button', { name: 'Remove tour' }));

      expect(screen.getByTestId('probe')).toBeEmptyDOMElement();
    });
  });
});
