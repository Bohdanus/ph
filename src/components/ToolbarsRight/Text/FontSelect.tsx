import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useKeyDownShortcut } from '../../../hooks/useKeyboardEvents.tsx';

const FONTS = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Georgia',
  'Palatino',
  'Garamond',
  'Comic Sans MS',
  'Roboto',
  'Impact',
  'Trebuchet MS',
  'Tahoma',
  'Brush Script MT',
];

const LIST_ID = 'font-family-list';
/** Matches the popup's `max-h-60`, so the flip decision uses the height it will occupy. */
const LIST_MAX_HEIGHT = 240;
const VIEWPORT_MARGIN = 8;
const GUTTER = 4;

interface FontSelectProps {
  value: string;
  onChange: (value: string) => void;
}

interface ListPosition {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
}

const FontSelect: React.FC<FontSelectProps> = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [initialValue, setInitialValue] = useState(value);
  const [position, setPosition] = useState<ListPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useKeyDownShortcut({
    key: 'Escape',
    enabled: isOpen,
    onKeyDown: () => {
      onChange(initialValue);
      setIsOpen(false);
    },
  });

  // The popup is portalled to `document.body`, so it is no longer a descendant of the
  // toolbar and therefore no longer clipped by it. That is load-bearing: the toolbar is
  // `overflow-visible` on desktop, and a horizontal scroll container in the tablet band,
  // and a 240px list anchored `absolute` inside a 50px `overflow-hidden` box renders as an
  // 8px sliver with none of the fourteen fonts reachable.
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    // Flip above the trigger when the list would not fit below AND there is more room
    // above, rather than opening off the bottom of the window.
    const openUpwards = spaceBelow < LIST_MAX_HEIGHT + GUTTER && rect.top > spaceBelow;
    const maxLeft = window.innerWidth - rect.width - VIEWPORT_MARGIN;

    setPosition({
      left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft)),
      width: rect.width,
      top: openUpwards ? undefined : rect.bottom + GUTTER,
      bottom: openUpwards ? window.innerHeight - rect.top + GUTTER : undefined,
    });
  }, []);

  // Measure before paint so the popup never appears at 0,0 for a frame, which is what an
  // `absolute`-anchored list did implicitly by being laid out with the toolbar.
  useLayoutEffect(() => {
    if (isOpen) updatePosition();
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;

    // The trigger is a fixed-position anchor, so the popup must follow the window. Capture
    // phase catches scrolls in any ancestor, including the document.
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!isOpen) return;
      const target = event.target as Node;
      // Both the trigger and the portalled list are "inside", even though only the trigger
      // is a descendant of this component's JSX.
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;

      onChange(initialValue);
      setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, initialValue, onChange]);

  const handleToggle = () => {
    if (!isOpen) {
      setInitialValue(value);
    }
    setIsOpen(!isOpen);
  };

  const handleSelect = (font: string) => {
    setInitialValue(font);
    onChange(font);
    setIsOpen(false);
  };

  const handleHover = (font: string) => {
    onChange(font);
  };

  return (
    <div className="relative w-full">
      <button
        id="font-family-select"
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-controls={isOpen ? LIST_ID : undefined}
        className="flex w-full items-center justify-between rounded border border-gray-300 bg-white px-2 h-9 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        style={{ fontFamily: value }}
      >
        <span>{value}</span>
        <svg
          className={`ml-1 h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen &&
        position &&
        createPortal(
          <div
            id={LIST_ID}
            ref={listRef}
            className="fixed z-[9999] max-h-60 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-700"
            style={{ left: position.left, top: position.top, bottom: position.bottom, width: position.width }}
          >
            {FONTS.map((font) => (
              <button
                key={font}
                type="button"
                className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                  font === value
                    ? 'bg-blue-600 font-bold text-white dark:bg-blue-700 dark:text-white'
                    : 'text-gray-900 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-600'
                }`}
                style={{ fontFamily: font }}
                onClick={() => handleSelect(font)}
                onMouseEnter={() => handleHover(font)}
              >
                {font}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
};

export default FontSelect;
