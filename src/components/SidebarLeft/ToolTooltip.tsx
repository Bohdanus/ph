import { cloneElement, type ReactElement, useEffect, useRef, useState } from 'react';

import type { ToolName } from '../../contexts/tool-types.ts';
import { toolTooltips, type ToolTooltipProjection } from '../../tools/descriptions/tooltips.ts';
import AnchoredOverlay from './AnchoredOverlay.tsx';

type ToolTooltipProps = {
  children: ReactElement<{ 'aria-describedby'?: string }>;
  label: string;
  /**
   * The tool this tile stands for, which is what the description record is keyed by. It is
   * `ToolbarTool.name`, so a `figure` variant resolves to its own entry rather than to the
   * generic one, and the required prop is what stops a tile from quietly losing its
   * description because nobody passed one.
   */
  toolName: ToolName;
  shortcut?: string;
  /**
   * Which side of the tile the tooltip hangs off. The rail can be re-docked to either edge, and
   * a tooltip placed on the wrong one is clipped by the viewport. Passed through to
   * `AnchoredOverlay`; see its `side` prop.
   */
  side?: 'left' | 'right';
  /**
   * Placed against this element's horizontal edges rather than the tile's. See
   * `AnchoredOverlay`'s `xAnchor` — a tooltip wide enough to matter, on a second-column tile of
   * a right-docked rail, lands over the rail otherwise.
   */
  xAnchor?: HTMLElement | null;
};

/**
 * How a tool's implementation state reads in the tooltip.
 *
 * `implemented` has no entry, so a finished tool gets no third line at all. The other two
 * match what the options bar already says out loud — `PlaceholderTool` renders a `TODO` badge
 * for a `placeholder` tool — so the tooltip is not disclosing anything the app hides; it is
 * saying the same thing earlier, on the tile the user is already looking at.
 */
const IMPLEMENTATION_NOTE: Partial<Record<ToolTooltipProjection['implementation'], string>> = {
  partial: 'Partially implemented — behaviour diverges from Photoshop',
  placeholder: 'Not implemented — the options bar below is a placeholder',
};

const ToolTooltip = ({ children, label, toolName, shortcut, side = 'right', xAnchor }: ToolTooltipProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const showTimerRef = useRef<number | null>(null);
  // The tooltip is portalled out of the rail, which scrolls and clips, so it is positioned
  // against this wrapper's box rather than laid out inside it. The wrapper is the anchor,
  // and it is also this overlay's parent — so its element has to come from a callback ref
  // rather than a `useRef`, because React attaches a parent's ref after its child's layout
  // effects and the overlay measures itself in one. See `AnchoredOverlay`.
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const tooltipId = `tool-tooltip-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`;

  const description = toolTooltips[toolName];
  const implementationNote = IMPLEMENTATION_NOTE[description.implementation];

  useEffect(() => {
    return () => {
      if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current);
    };
  }, []);

  const showTooltip = () => {
    if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current);
    showTimerRef.current = window.setTimeout(() => setIsVisible(true), 250);
  };

  const hideTooltip = () => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    setIsVisible(false);
  };

  return (
    <span
      className="group relative flex"
      onBlur={hideTooltip}
      onFocus={showTooltip}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      ref={setAnchor}
    >
      {cloneElement(children, { 'aria-describedby': isVisible ? tooltipId : undefined })}
      {isVisible && (
        <AnchoredOverlay align="center" anchor={anchor} gap={12} measureKey={tooltipId} side={side} xAnchor={xAnchor}>
          <span
            // The label line is `whitespace-nowrap` and the summary below it wraps: a
            // tool's name is never worth a second line, but its description is. The cap is
            // what stops a long summary from running the tooltip across half the canvas, and
            // `AnchoredOverlay` flips the whole box to the rail's leading edge rather than
            // letting it leave the viewport.
            className="pointer-events-none flex max-w-64 flex-col gap-1 rounded-md bg-gray-950 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg ring-1 ring-white/10 dark:bg-white dark:text-gray-950 dark:ring-black/10"
            id={tooltipId}
            role="tooltip"
          >
            <span className="flex items-center gap-2 whitespace-nowrap">
              {label}
              {shortcut && (
                <kbd className="rounded border border-white/25 px-1.5 py-0.5 text-[10px] font-semibold leading-none dark:border-black/20">
                  {shortcut}
                </kbd>
              )}
            </span>
            <span className="font-normal leading-snug text-gray-300 dark:text-gray-700">{description.summary}</span>
            {implementationNote && (
              <span
                className="font-normal text-[10px] uppercase tracking-[0.16em] text-amber-300 dark:text-amber-600"
                data-testid="tool-tooltip-implementation-note"
              >
                {implementationNote}
              </span>
            )}
          </span>
        </AnchoredOverlay>
      )}
    </span>
  );
};

export default ToolTooltip;
