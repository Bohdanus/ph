import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from '../ThemeContext.tsx';

const { localStorageMock, matchMediaMock, buildMediaQueryList } = vi.hoisted(() => {
  const createMediaQueryList = (query: string, matches = false) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });

  const storageMock = {
    getItem: vi.fn((): string | null => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    length: 0,
    key: vi.fn(),
  };

  const mediaQueryMock = vi.fn((query: string) => createMediaQueryList(query));

  Object.defineProperty(globalThis, 'localStorage', {
    value: storageMock,
    writable: true,
    configurable: true,
  });

  Object.defineProperty(globalThis, 'matchMedia', {
    value: mediaQueryMock,
    writable: true,
    configurable: true,
  });

  return { localStorageMock: storageMock, matchMediaMock: mediaQueryMock, buildMediaQueryList: createMediaQueryList };
});

describe('ThemeContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    // The provider writes to the SHARED `document.documentElement`, and nothing removes
    // those classes on unmount, so a test that rendered `dark` used to leave `dark` on the
    // document for every test after it. No mock API touches the DOM: this is a real
    // element, so the class list has to be reset explicitly.
    document.documentElement.classList.remove('light', 'dark');

    localStorageMock.getItem.mockReset().mockReturnValue(null);
    localStorageMock.setItem.mockReset();
    localStorageMock.removeItem.mockReset();
    localStorageMock.clear.mockReset();
    localStorageMock.key.mockReset();

    matchMediaMock.mockReset();
    matchMediaMock.mockImplementation((query: string) => buildMediaQueryList(query));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const renderWithProvider = (children: React.ReactNode) => {
    return render(<ThemeProvider>{children}</ThemeProvider>);
  };

  it('provides theme and toggle function', () => {
    const TestComponent = () => {
      const { theme, toggleTheme } = useTheme();
      return (
        <div>
          <span data-testid="theme">{theme}</span>
          <button data-testid="toggle" onClick={toggleTheme}>
            Toggle
          </button>
        </div>
      );
    };

    renderWithProvider(<TestComponent />);

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });

  it('toggles theme from light to dark', () => {
    const TestComponent = () => {
      const { theme, toggleTheme } = useTheme();
      return (
        <div>
          <span data-testid="theme">{theme}</span>
          <button data-testid="toggle" onClick={toggleTheme}>
            Toggle
          </button>
        </div>
      );
    };

    renderWithProvider(<TestComponent />);

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    act(() => {
      fireEvent.click(screen.getByTestId('toggle'));
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });

  it('toggles theme from dark to light', () => {
    localStorageMock.getItem.mockReturnValue('dark');

    const TestComponent = () => {
      const { theme, toggleTheme } = useTheme();
      return (
        <div>
          <span data-testid="theme">{theme}</span>
          <button data-testid="toggle" onClick={toggleTheme}>
            Toggle
          </button>
        </div>
      );
    };

    renderWithProvider(<TestComponent />);

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    act(() => {
      fireEvent.click(screen.getByTestId('toggle'));
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });

  it('applies theme class to documentElement', () => {
    const TestComponent = () => {
      const { theme } = useTheme();
      return <span data-testid="theme">{theme}</span>;
    };

    // Asserted BEFORE this test's own render, so the class list is being read in the state
    // the lifecycle hook left it in. Without that reset a `dark` test earlier in the file
    // would decide this expectation, and the provider's own effect would be what made it
    // pass — a test that cannot fail.
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    renderWithProvider(<TestComponent />);

    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('updates documentElement class when theme changes', () => {
    const TestComponent = () => {
      const { theme, toggleTheme } = useTheme();
      return (
        <div>
          <span data-testid="theme">{theme}</span>
          <button data-testid="toggle" onClick={toggleTheme}>
            Toggle
          </button>
        </div>
      );
    };

    // Same reason as the test above: this one only means anything if it starts from a
    // document element that the previous test did not leave themed.
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    renderWithProvider(<TestComponent />);

    act(() => {
      fireEvent.click(screen.getByTestId('toggle'));
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('persists theme to localStorage', () => {
    const TestComponent = () => {
      const { theme, toggleTheme } = useTheme();
      return (
        <div>
          <span data-testid="theme">{theme}</span>
          <button data-testid="toggle" onClick={toggleTheme}>
            Toggle
          </button>
        </div>
      );
    };

    renderWithProvider(<TestComponent />);

    act(() => {
      fireEvent.click(screen.getByTestId('toggle'));
    });
    expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'dark');
  });

  it('reads initial theme from localStorage', () => {
    localStorageMock.getItem.mockReturnValue('dark');

    const TestComponent = () => {
      const { theme } = useTheme();
      return <span data-testid="theme">{theme}</span>;
    };

    renderWithProvider(<TestComponent />);

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(localStorageMock.getItem).toHaveBeenCalledWith('theme');
  });

  it('falls back to prefers-color-scheme when no localStorage', () => {
    matchMediaMock.mockImplementation((query: string) =>
      buildMediaQueryList(query, query === '(prefers-color-scheme: dark)')
    );

    const TestComponent = () => {
      const { theme } = useTheme();
      return <span data-testid="theme">{theme}</span>;
    };

    renderWithProvider(<TestComponent />);

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });

  it('falls back to light when no localStorage and no dark preference', () => {
    matchMediaMock.mockImplementation((query: string) => buildMediaQueryList(query, false));

    const TestComponent = () => {
      const { theme } = useTheme();
      return <span data-testid="theme">{theme}</span>;
    };

    renderWithProvider(<TestComponent />);

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });

  it('throws when useTheme used outside ThemeProvider', () => {
    const TestComponent = () => {
      useTheme();
      return null;
    };

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      render(<TestComponent />);
    }).toThrow('useTheme must be used within a ThemeProvider');
    consoleError.mockRestore();
  });

  it('handles multiple toggle calls', () => {
    const TestComponent = () => {
      const { theme, toggleTheme } = useTheme();
      return (
        <div>
          <span data-testid="theme">{theme}</span>
          <button data-testid="toggle" onClick={toggleTheme}>
            Toggle
          </button>
        </div>
      );
    };

    renderWithProvider(<TestComponent />);

    act(() => {
      fireEvent.click(screen.getByTestId('toggle'));
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    act(() => {
      fireEvent.click(screen.getByTestId('toggle'));
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    act(() => {
      fireEvent.click(screen.getByTestId('toggle'));
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });
});
