import { cloneElement, type ReactElement, useEffect, useRef, useState } from 'react';
import AnchoredOverlay from './AnchoredOverlay.tsx';

type ToolTooltipProps = {
  children: ReactElement<{ 'aria-describedby'?: string }>;
  label: string;
  shortcut?: string;
};

const ToolTooltip = ({ children, label, shortcut }: ToolTooltipProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const showTimerRef = useRef<number | null>(null);
  // The tooltip is portalled out of the rail, which scrolls and clips, so it is positioned
  // against this wrapper's box rather than laid out inside it. The wrapper is the anchor,
  // and it is also this overlay's parent — so its element has to come from a callback ref
  // rather than a `useRef`, because React attaches a parent's ref after its child's layout
  // effects and the overlay measures itself in one. See `AnchoredOverlay`.
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const tooltipId = `tool-tooltip-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`;

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
        <AnchoredOverlay align="center" anchor={anchor} gap={12} measureKey={tooltipId}>
          <span
            className="pointer-events-none z-50 flex items-center gap-2 whitespace-nowrap rounded-md bg-gray-950 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg ring-1 ring-white/10 dark:bg-white dark:text-gray-950 dark:ring-black/10"
            id={tooltipId}
            role="tooltip"
          >
            {label}
            {shortcut && (
              <kbd className="rounded border border-white/25 px-1.5 py-0.5 text-[10px] font-semibold leading-none dark:border-black/20">
                {shortcut}
              </kbd>
            )}
          </span>
        </AnchoredOverlay>
      )}
    </span>
  );
};

export default ToolTooltip;
