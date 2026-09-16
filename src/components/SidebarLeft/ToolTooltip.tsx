import { cloneElement, type ReactElement, useEffect, useRef, useState } from 'react';

type ToolTooltipProps = {
  children: ReactElement<{ 'aria-describedby'?: string }>;
  label: string;
  shortcut?: string;
};

const ToolTooltip = ({ children, label, shortcut }: ToolTooltipProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const showTimerRef = useRef<number | null>(null);
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
    <span className="group relative flex" onBlur={hideTooltip} onFocus={showTooltip} onMouseEnter={showTooltip} onMouseLeave={hideTooltip}>
      {cloneElement(children, { 'aria-describedby': isVisible ? tooltipId : undefined })}
      {isVisible && (
        <span
          className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-md bg-gray-950 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg ring-1 ring-white/10 dark:bg-white dark:text-gray-950 dark:ring-black/10"
          id={tooltipId}
          role="tooltip"
        >
          {label}
          {shortcut && <kbd className="rounded border border-white/25 px-1.5 py-0.5 text-[10px] font-semibold leading-none dark:border-black/20">{shortcut}</kbd>}
        </span>
      )}
    </span>
  );
};

export default ToolTooltip;