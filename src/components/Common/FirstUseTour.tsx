import { useCallback, useEffect, useRef, useState } from 'react';

import type { ToolName } from '../../contexts/tool-types.ts';
import { useFirstUseContext } from '../../contexts/FirstUseContext.tsx';
import { toolTooltips } from '../../tools/descriptions/tooltips.ts';

/**
 * localStorage key for whether the user has seen the first-use tour.
 */
const TOUR_SEEN_KEY = 'ph.firstUseTourSeen';
export { TOUR_SEEN_KEY };

export type FirstUseStep = {
  /** The tool name the step points at. */
  tool: ToolName;
  /** The heading text for this step. */
  heading: string;
  /** The body text explaining what the tool does and what the user can achieve. */
  body: string;
};

/**
 * The implemented tools that give the strongest first-use confidence.
 *
 * Ordered to roughly follow the toolbar's left-to-right layout so a first-time
 * user can click through and see the whole rail light up. Each step uses the
 * description record's summary as its body, so the tour and the tooltip say the
 * same thing — the two surfaces are sourced from the same line.
 */
const TOUR_STEPS: FirstUseStep[] = [
  {
    tool: 'reposition',
    heading: 'Move and transform',
    body: 'Drag a layer to move it; hold Space while dragging to pan the view. The Move tool is your starting point for everything else.',
  },
  {
    tool: 'brush',
    heading: 'Paint with the Brush',
    body: 'Click and drag to paint the foreground color. Press [ or ] to resize the tip, and watch the Opacity and Flow controls in the options bar.',
  },
  {
    tool: 'pencil',
    heading: 'Pixel-precise strokes',
    body: 'The Pencil paints hard-edged lines with no anti-aliasing — ideal for pixel art or sharp selections.',
  },
  {
    tool: 'rectangular-selection',
    heading: 'Select a region',
    body: 'Drag a rectangle to select part of your image. Shift makes it a square, Alt grows it from the center.',
  },
  {
    tool: 'magic-wand',
    heading: 'Select by color',
    body: 'Click an area to select every similar color in one step. Adjust Tolerance in the options bar to refine the selection.',
  },
  {
    tool: 'shape',
    heading: 'Draw shapes',
    body: 'Drag a rectangle, ellipse, or line. Hold Shift to constrain proportions, and release the mouse before releasing Shift.',
  },
  {
    tool: 'text',
    heading: 'Add text',
    body: 'Click to place a text layer, then type. Font, size, and alignment controls appear in the options bar.',
  },
  {
    tool: 'crop',
    heading: 'Crop your image',
    body: 'Drag the crop box to reframe, then press Enter to commit. Esc restores the original framing.',
  },
  {
    tool: 'transform',
    heading: 'Resize and rotate',
    body: 'Cmd/Ctrl+T scales, rotates, and skews a layer. Drag a corner, drag outside the box to rotate.',
  },
];

/**
 * Whether the user has already seen the full tour. The flag is checked before
 * mounting the component, so the tour never flashes in for a returning user.
 */
export const hasSeenFirstUseTour = (): boolean => {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === 'true';
  } catch {
    return true; // If storage is unavailable, skip the tour rather than blocking the app.
  }
};

/**
 * Marks the tour as seen so it does not reappear.
 */
export const markFirstUseTourSeen = (): void => {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, 'true');
  } catch {
    // Storage unavailable — the tour will reappear on next load. Cosmetic, not a breakage.
  }
};

export type FirstUseTourProps = {
  /** Called when the user dismisses the tour or reaches the end. */
  onComplete: () => void;
};

/**
 * A full-screen onboarding overlay that walks a first-time user through the
 * toolbar, one implemented tool at a time.
 *
 * The overlay follows Bandura's verbal/social persuasion source of self-efficacy:
 * it tells the user what each tool can do and that they can achieve results with it,
 * which raises their belief in their own capability before they touch a tool.
 *
 * The tour is dismissed via the X button at the top right, or it completes after
 * the last step. Completion is persisted to localStorage.
 *
 * The overlay traps focus within its bounds, restores focus to the triggering
 * element on close, and exposes correct ARIA roles so assistive technologies
 * treat it as a modal dialog.
 */
export const FirstUseTour = ({ onComplete }: FirstUseTourProps) => {
  const [stepIndex, setStepIndex] = useState(0);
  const { setCurrentStepIndex } = useFirstUseContext();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const step = TOUR_STEPS[stepIndex];
  const progress = ((stepIndex + 1) / TOUR_STEPS.length) * 100;
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  // Report the active step to the shared context so the sidebar can highlight
  // the corresponding tile. Clear on unmount so a closed tour leaves no stale
  // highlight.
  useEffect(() => {
    setCurrentStepIndex(stepIndex);
    return () => setCurrentStepIndex(null);
  }, [stepIndex, setCurrentStepIndex]);

  const handleNext = useCallback(() => {
    if (isLast) {
      markFirstUseTourSeen();
      onComplete();
    } else {
      setStepIndex(stepIndex + 1);
    }
  }, [stepIndex, isLast, onComplete]);

  const handleSkip = useCallback(() => {
    markFirstUseTourSeen();
    onComplete();
  }, [onComplete]);

  // The tool description records carry the shortcut for each tool; the tour
  // surfaces it so the user learns the fastest way to reach each tool.
  const shortcut = toolTooltips[step.tool]?.shortcut;

  // Capture focus before showing the tour so we can restore it on close.
  // Close on Escape so keyboard users can dismiss without hunting for the X.
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement;
    dialogRef.current?.focus();

    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleSkip();
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      previouslyFocusedRef.current?.focus();
    };
  }, [stepIndex, handleSkip]);

  // Trap focus within the dialog so keyboard users cannot tab behind the overlay.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleTab = (event: KeyboardEvent) => {
      const focusables = dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.key === 'Tab') {
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    dialog.addEventListener('keydown', handleTab);
    return () => dialog.removeEventListener('keydown', handleTab);
  }, [stepIndex]);

  return (
    <>
      {/* Dimmed backdrop that lets the toolbar glow through in theme color */}
      <div className="fixed inset-0 z-[100] bg-black/40" onClick={handleSkip} />

      {/* The tooltip-style card that walks through each step */}
      <div
        ref={dialogRef}
        id="first-use-tour"
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-use-tour-heading"
        aria-describedby="first-use-tour-body"
        className="fixed z-[101] flex w-72 flex-col gap-2 rounded-lg border border-gray-300 bg-white p-4 shadow-xl outline-none dark:border-gray-600 dark:bg-gray-800"
        style={{
          top: '5rem',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        {/* Close button */}
        <button
          aria-label="Close tour"
          className="absolute top-1 right-1 rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:hover:bg-gray-700"
          onClick={handleSkip}
          type="button"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="3" y1="3" x2="13" y2="13" />
            <line x1="13" y1="3" x2="3" y2="13" />
          </svg>
        </button>

        {/* Progress bar */}
        <div
          role="progressbar"
          aria-valuenow={stepIndex + 1}
          aria-valuemin={1}
          aria-valuemax={TOUR_STEPS.length}
          className="h-1 w-full rounded bg-gray-200 dark:bg-gray-700"
        >
          <div
            className="h-full rounded bg-blue-500 transition-all duration-200"
            style={{ width: `${progress}%` }}
            aria-hidden="true"
          />
        </div>

        {/* Heading */}
        <h3 id="first-use-tour-heading" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {step.heading}
        </h3>

        {/* Body */}
        <p id="first-use-tour-body" className="text-xs text-gray-600 dark:text-gray-300">
          {step.body}
        </p>

        {/* Shortcut hint */}
        {shortcut && (
          <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            <span>Shortcut:</span>
            <kbd className="rounded border border-gray-400 px-1.5 py-0.5 text-xs font-semibold dark:border-gray-500">
              {shortcut}
            </kbd>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-2 pt-1">
          <button
            className="flex-1 rounded border border-gray-300 bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            onClick={handleSkip}
            type="button"
          >
            Skip
          </button>
          <button
            className="flex-1 rounded border border-blue-500 bg-blue-500 px-3 py-1 text-xs font-medium text-white hover:bg-blue-600"
            onClick={handleNext}
            type="button"
          >
            {isLast ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </>
  );
};

/**
 * The set of tools that should be highlighted (pulsed) during the tour step
 * for that tool.
 *
 * Returns only the current step's tool — the tour highlights one tile at a time
 * to keep the visual signal focused.
 */
export const getHighlightedToolsForStep = (stepIndex: number): ToolName[] => {
  const step = TOUR_STEPS[stepIndex];
  return step ? [step.tool] : [];
};
