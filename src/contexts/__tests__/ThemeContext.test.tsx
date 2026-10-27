import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from '../ThemeContext.tsx';

const { localStorageMock } = vi.hoisted(() => {
  const storageMock = {
    getItem: vi.fn((): string | null => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    length: 0,
    key: vi.fn(),
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: storageMock,
    writable: true,
    configurable: true,
  });

  return { localStorageMock: storageMock };
});

describe('ThemeContext', () => {
  beforeEach(() => {
    // The provider writes to the SHARED `document.documentElement`, and nothing removes those
    // classes on unmount, so every test that rendered a theme leaves that theme on the document
    // for the tests after it. That reset used to be a nicety for the few `dark` tests; with
    // `dark` as the DEFAULT it is what keeps a stale class from deciding an expectation that
    // the provider's own effect is supposed to be making. No mock API touches the DOM: this is
    // a real element, so the class list has to be reset explicitly — and by ASSIGNMENT rather
    // than by naming `light` and `dark`, so a third theme cannot fall out of the reset's
    // coverage without anything noticing.
    document.documentElement.className = '';

    // Default-theme cases must not inherit the override from the worker environment.
    // Tests for the override set it explicitly below.
    vi.stubEnv('VITE_TEST_THEME', '');

    localStorageMock.getItem.mockReset().mockReturnValue(null);
    localStorageMock.setItem.mockReset();
    localStorageMock.removeItem.mockReset();
    localStorageMock.clear.mockReset();
    localStorageMock.key.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
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

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });

  it('toggles theme from light to dark', () => {
    // Seeded rather than inherited: this test's subject is the light → dark direction, so it has
    // to put itself in light on purpose. While the default was `light` it got there for free,
    // which is exactly why it stopped meaning anything the moment the default flipped.
    localStorageMock.getItem.mockReturnValue('light');

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

  it('updates documentElement class when theme changes', () => {
    // Same reason the default test below asserts this before rendering: this one only means
    // anything if it starts from a document element that the previous test did not leave themed.
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // Seeded for the same reason as `toggles theme from light to dark`, and additionally because
    // the assertion after the click is `dark`, so the toggle has to start somewhere else.
    localStorageMock.getItem.mockReturnValue('light');

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
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('persists theme to localStorage', () => {
    // Seeded so the mount effect writes `light` and the toggle writes `dark`. Without the seed
    // this assertion would be unfalsifiable: `dark` is the default, so the mount effect already
    // calls `setItem('theme', 'dark')` and `toHaveBeenCalledWith` would pass on a render where
    // the toggle was never clicked.
    localStorageMock.getItem.mockReturnValue('light');

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

  it('uses VITE_TEST_THEME env var as fallback when no preference is stored', () => {
    // When localStorage has no stored theme, VITE_TEST_THEME can override the default.
    // This lets unit tests force a theme without mocking localStorage.
    localStorageMock.getItem.mockReturnValue(null);
    vi.stubEnv('VITE_TEST_THEME', 'light');

    const TestComponent = () => {
      const { theme } = useTheme();
      return <span data-testid="theme">{theme}</span>;
    };

    renderWithProvider(<TestComponent />);

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('prefers a stored theme over VITE_TEST_THEME', () => {
    // A real user preference in localStorage must win over the test override.
    localStorageMock.getItem.mockReturnValue('dark');
    vi.stubEnv('VITE_TEST_THEME', 'light');

    const TestComponent = () => {
      const { theme } = useTheme();
      return <span data-testid="theme">{theme}</span>;
    };

    renderWithProvider(<TestComponent />);

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });

  it('reads a stored light preference', () => {
    // The default flip must not have been bought by ignoring a saved choice. This is the half of
    // the storage contract the `dark` test above cannot reach: both values have to be read, or a
    // visitor who toggled to light would silently get `dark` on every reload while a test named
    // "reads initial theme from localStorage" stayed green. The `setItem` assertion is what makes
    // that sentence true rather than merely intended, and it is the ONLY direction this file
    // could not already reach: `persists theme to localStorage` asserts `dark`, which an
    // always-`dark` writer satisfies, so without this line a provider that stored `dark` for
    // every visitor — light included — passed all 12 tests.
    localStorageMock.getItem.mockReturnValue('light');

    const TestComponent = () => {
      const { theme } = useTheme();
      return <span data-testid="theme">{theme}</span>;
    };

    renderWithProvider(<TestComponent />);

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'light');
  });

  it('defaults to dark when nothing is stored', () => {
    // The pin for the flip, and the reason the two `falls back to …` tests it replaces were not
    // simply deleted: each of those asserted one OS-dependent outcome of a query the provider no
    // longer makes, and together they claimed a behaviour that no longer exists. This asserts the
    // contract instead — both the reported value AND the class the stylesheet keys on, because a
    // provider that reported `dark` while styling itself `light` would render a light app and
    // pass a value-only assertion.
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    const TestComponent = () => {
      const { theme } = useTheme();
      return <span data-testid="theme">{theme}</span>;
    };

    renderWithProvider(<TestComponent />);

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('ignores the operating system colour preference', () => {
    // `src/test/setup.ts` evaluates every colour query to `false`, so re-adding the
    // `matchMedia('(prefers-color-scheme: dark)')` fallback would fail the default test above —
    // in jsdom only. On a machine whose OS actually reports a dark preference, that same test would
    // have passed and recorded nothing, which is precisely the accident this default exists to
    // remove. Asserting the media query is not consulted is the only form of the claim that holds
    // on every machine.
    const matchMedia = vi.spyOn(window, 'matchMedia');

    const TestComponent = () => {
      const { theme } = useTheme();
      return <span data-testid="theme">{theme}</span>;
    };

    renderWithProvider(<TestComponent />);

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(matchMedia).not.toHaveBeenCalled();
  });

  it('treats an unrecognised stored value as no preference', () => {
    // `localStorage` is writable by any script on the origin, so the provider's own guard is the
    // only thing between a stale or hand-edited value and a document styled by a theme that does
    // not exist. With `dark` as the default this has to resolve to `dark` too: an implementation
    // that accepted any truthy stored string would put an unstyled app on screen, and the
    // default test would still be green.
    localStorageMock.getItem.mockReturnValue('solarized');

    const TestComponent = () => {
      const { theme } = useTheme();
      return <span data-testid="theme">{theme}</span>;
    };

    renderWithProvider(<TestComponent />);

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('throws when useTheme used outside ThemeProvider', () => {
    const TestComponent = () => {
      useTheme();
      return null;
    };

    // The restore has to run whatever `render` does, including the throw this test is asserting —
    // which is the only throw in this file. The `afterEach` above also calls `vi.restoreAllMocks()`,
    // but that is a coincidence of this file's setup, not the guard: a mock restored by a
    // `restore()` on the line after a failed assertion stays installed for every test below.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => {
        render(<TestComponent />);
      }).toThrow('useTheme must be used within a ThemeProvider');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('handles multiple toggle calls', () => {
    // Starts from the real default rather than a seed: an odd number of toggles has to land back
    // on the value it started from, and that is the property worth pinning — that the transition
    // is a function of the current theme and not of how many times it has been applied.
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
    act(() => {
      fireEvent.click(screen.getByTestId('toggle'));
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    act(() => {
      fireEvent.click(screen.getByTestId('toggle'));
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });
});
