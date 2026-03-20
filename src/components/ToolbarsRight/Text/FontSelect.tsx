import React, { useState, useRef, useEffect } from 'react';

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

interface FontSelectProps {
  value: string;
  onChange: (value: string) => void;
}

const FontSelect: React.FC<FontSelectProps> = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [initialValue, setInitialValue] = useState(value);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        if (isOpen) {
          onChange(initialValue);
          setIsOpen(false);
        }
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onChange(initialValue);
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
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
    <div className="relative w-full" ref={dropdownRef}>
      <button
        id="font-family-select"
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center justify-between rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        style={{ fontFamily: value }}
      >
        <span>{value}</span>
        <svg
          className={`ml-2 h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-700">
          {FONTS.map((font) => (
            <button
              key={font}
              type="button"
              className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-blue-90 dark:hover:bg-blue-900/70 ${
                font === value ? 'bg-blue-100 font-bold dark:bg-blue-900/90' : 'text-gray-900 dark:text-white'
              }`}
              style={{ fontFamily: font }}
              onClick={() => handleSelect(font)}
              onMouseEnter={() => handleHover(font)}
            >
              {font}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default FontSelect;
