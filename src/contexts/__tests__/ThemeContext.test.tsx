import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from '../ThemeContext.tsx';

describe('ThemeContext', () => {
  let localStorageMock: Storage;
  let matchMediaMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();

    localStorageMock = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(),
    } as unknown as Storage;

    vi.stubGlobal('localStorage', localStorageMock);

    matchMediaMock = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal('matchMedia', matchMediaMock);

    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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
    fireEvent.click(screen.getByTestId('toggle'));
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });

  it('toggles theme from dark to light', () => {
    (localStorageMock.getItem as ReturnType<typeof vi.fn>).mockReturnValue('dark');

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
    fireEvent.click(screen.getByTestId('toggle'));
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });

  it('applies theme class to documentElement', () => {
    const TestComponent = () => {
      const { theme } = useTheme();
      return <span data-testid="theme">{theme}</span>;
    };

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

    renderWithProvider(<TestComponent />);

    fireEvent.click(screen.getByTestId('toggle'));
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

    fireEvent.click(screen.getByTestId('toggle'));
    expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'dark');
  });

  it('reads initial theme from localStorage', () => {
    (localStorageMock.getItem as ReturnType<typeof vi.fn>).mockReturnValue('dark');

    const TestComponent = () => {
      const { theme } = useTheme();
      return <span data-testid="theme">{theme}</span>;
    };

    renderWithProvider(<TestComponent />);

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(localStorageMock.getItem).toHaveBeenCalledWith('theme');
  });

  it('falls back to prefers-color-scheme when no localStorage', () => {
    matchMediaMock.mockImplementation((query) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const TestComponent = () => {
      const { theme } = useTheme();
      return <span data-testid="theme">{theme}</span>;
    };

    renderWithProvider(<TestComponent />);

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });

  it('falls back to light when no localStorage and no dark preference', () => {
    matchMediaMock.mockImplementation(() => ({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

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

    fireEvent.click(screen.getByTestId('toggle'));
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    fireEvent.click(screen.getByTestId('toggle'));
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    fireEvent.click(screen.getByTestId('toggle'));
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });
});
