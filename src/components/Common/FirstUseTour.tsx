import { useCallback, useEffect, useState } from 'react';

import type { ToolName } from '../../contexts/tool-types.ts';
import { useFirstUseContext } from '../../contexts/FirstUseContext.tsx';
import { useDialogFocusContainment } from '../../hooks/useDialogFocusContainment.ts';
import { toolTooltips } from '../../tools/descriptions/tooltips.ts';

/**
 * localStorage key for whether the user has seen the first-use tour.
 */
const TOUR_SEEN_KEY = 'ph.firstUseTourSeen';
export { TOUR_SEEN_KEY };

export type FirstUseStep = {
  /** The tool name the step points at. */
  tool: ToolName;
  /** The visible toolbar tile to highlight when the tool is a flyout member. */
  highlightTool?: ToolName;
  /** The heading text for this step. */
  heading: string;
  /** The body text explaining what the tool does and what the user can achieve. */
  body: string;
};

/**
 * Concrete actions for the implemented tools that have a visible toolbar tile.
 *
 * The bodies are hand-authored to describe controls that exist in this app.
 * Steps are ordered roughly left-to-right; flyout members point at their visible
 * parent tile. Transform is a menu command, not a toolbar tool, so it is not part
 * of this toolbar tour.
 */
const TOUR_STEPS: FirstUseStep[] = [
  {
    tool: 'reposition',
    heading: 'Move layers and pan',
    body: 'Use Move to drag a layer or selection. Hold Space and drag to pan the canvas.',
  },
  {
    tool: 'brush',
    heading: 'Paint with the Brush',
    body: 'Click and drag to paint with the foreground color. Press [ or ] to resize the tip, or adjust Size and Opacity in the options bar.',
  },
  {
    tool: 'pencil',
    highlightTool: 'brush',
    heading: 'Pixel-precise strokes',
    body: 'Choose Pencil from the Brush flyout for crisp, hard-edged strokes.',
  },
  {
    tool: 'rectangular-selection',
    heading: 'Select a region',
    body: 'Drag a rectangle to select part of your image. Shift constrains it to a square; Alt or Option grows it from the center.',
  },
  {
    tool: 'magic-wand',
    heading: 'Select by color',
    body: 'Click an area to select every similar color in one step. Adjust Tolerance in the options bar to refine the selection.',
  },
  {
    tool: 'shape',
    highlightTool: 'rectangle',
    heading: 'Draw shapes',
    body: 'Choose a shape from the toolbar group and drag to draw it. Hold Shift to constrain its proportions.',
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
 * The overlay uses Bandura's verbal/social persuasion source as a design hypothesis:
 * it offers concrete, accurate actions before use. This implementation has not
 * evaluated whether the tour changes users' self-efficacy.
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
  const { setHighlightedTools } = useFirstUseContext();
  const step = TOUR_STEPS[stepIndex];
  const progress = ((stepIndex + 1) / TOUR_STEPS.length) * 100;
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  const handleSkip = useCallback(() => {
    markFirstUseTourSeen();
    onComplete();
  }, [onComplete]);
  const { panelRef, handleKeyDown } = useDialogFocusContainment({ onEscape: handleSkip });

  // Publish the visible tile identity, then clear it on the next step or close.
  useEffect(() => {
    setHighlightedTools(getHighlightedToolsForStep(stepIndex));
    return () => setHighlightedTools([]);
  }, [stepIndex, setHighlightedTools]);

  const handleNext = useCallback(() => {
    if (isLast) {
      markFirstUseTourSeen();
      onComplete();
    } else {
      setStepIndex((current) => current + 1);
    }
  }, [isLast, onComplete]);

  // Only toolbar shortcuts declared for the tool itself are projected here.
  const shortcut = toolTooltips[step.tool]?.shortcut;

  return (
    <>
      {/* Dimmed backdrop that lets the toolbar glow through in theme color */}
      <div aria-hidden="true" className="fixed inset-0 z-[100] bg-black/40" onClick={handleSkip} />

      {/* The tooltip-style card that walks through each step */}
      <div
        ref={panelRef}
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
        onKeyDown={handleKeyDown}
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
          aria-label="Tour progress"
          aria-valuenow={stepIndex + 1}
          aria-valuemin={1}
          aria-valuemax={TOUR_STEPS.length}
          className="h-1 w-full rounded bg-gray-200 dark:bg-gray-700"
        >
          <div
            className="h-full rounded bg-blue-500 transition-all duration-200 motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
            aria-hidden="true"
          />
        </div>

        <span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
          Step {stepIndex + 1} of {TOUR_STEPS.length}: {step.heading}
        </span>

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
  return step ? [step.highlightTool ?? step.tool] : [];
};
