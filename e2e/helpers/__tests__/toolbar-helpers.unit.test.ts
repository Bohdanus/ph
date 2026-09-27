import { describe, it, expect, vi, beforeEach, expectTypeOf } from 'vitest';
import type { Mock } from 'vitest';
import type { Page } from '@playwright/test';
import {
  TOOL_NAME_MAP,
  TOOL_DISPLAY_LABEL_MAP,
  normalizeToolName,
  resolveToolName,
  generateSlug,
  clickToolButton,
  openToolFlyout,
  waitForFlyout,
  selectFromFlyout,
  getToolButton,
  toggleToolbarLayout,
  verifyPrimaryTool,
  openToolFlyoutViaRightClick,
  verifyHoverDoesNotOpenFlyout,
  openToolFlyoutViaKeyboard,
  navigateAndSelectInFlyout,
  type FlyoutItem,
} from '../toolbar-helpers';

const { playwrightExpect, visibilityChecks, hiddenChecks, textChecks } = vi.hoisted(() => {
  type Target = { __elements: Array<{ visible: boolean; focused: boolean; testId: string | null; text: string }> };
  type Check = { target: Target; options?: { timeout?: number } };

  const visibilityChecks: Check[] = [];
  const hiddenChecks: Check[] = [];
  const textChecks: Array<{ target: Target; expected: string }> = [];

  const locatorLabel = (target: Target): string => {
    const testId = target.__elements[0]?.testId;
    return testId ? `[testid="${testId}"]` : '[role]';
  };

  const timedOut = (matcher: string, target: Target, timeout?: number): Error =>
    new Error(`Timed out ${timeout ?? 0}ms waiting for expect(locator${locatorLabel(target)}).${matcher}()`);

  const playwrightExpect = vi.fn((target: Target) => ({
    toBeVisible: vi.fn(async (options?: { timeout?: number }) => {
      visibilityChecks.push({ target, options });
      if (!target.__elements.some((element) => element.visible)) {
        throw timedOut('toBeVisible', target, options?.timeout);
      }
    }),
    toBeHidden: vi.fn(async (options?: { timeout?: number }) => {
      hiddenChecks.push({ target, options });
      if (target.__elements.some((element) => element.visible)) {
        throw timedOut('toBeHidden', target, options?.timeout);
      }
    }),
    toContainText: vi.fn(async (expected: string) => {
      textChecks.push({ target, expected });
      if (!target.__elements.some((element) => element.text.includes(expected))) {
        throw timedOut('toContainText', target);
      }
    }),
    toBeFocused: vi.fn(async (options?: { timeout?: number }) => {
      // Models browser focus as at most one element, so a stale `focused` flag on a
      // sibling cannot make a stale locator look focused.
      if (!target.__elements.some((element) => element.focused)) {
        throw timedOut('toBeFocused', target, options?.timeout);
      }
    }),
  }));

  return { playwrightExpect, visibilityChecks, hiddenChecks, textChecks };
});

vi.mock('@playwright/test', () => ({
  expect: playwrightExpect,
}));

const LONG_PRESS_THRESHOLD_MS = 300;
const LONG_PRESS_DELAY_MS = 350;
const FLYOUT_VISIBLE_TIMEOUT_MS = 2000;
const FLYOUT_CLOSE_TIMEOUT_MS = 1000;
const HOVER_SETTLE_MS = 400;

const LEGACY_SELECT_AND_MOVE_LABEL = 'Select and Move';

const toolButtonTestId = (name: string): string => `tool-button-${resolveToolName(name)}`;
const flyoutItemTestId = (toolName: string, label: string): string =>
  `tool-flyout-item-${toolName}-${generateSlug(label)}`;

interface FakeElement {
  testId: string | null;
  role: string;
  name: string;
  text: string;
  visible: boolean;
  focused: boolean;
  children: FakeElement[];
  parent: FakeElement | null;
  onActivate: (() => void) | null;
  onContextMenu: (() => void) | null;
  onKey: ((key: string) => void) | null;
  onLongPress: (() => void) | null;
  throwOnDispatch: string | null;
}

interface FakeElementSpec {
  testId?: string | null;
  role?: string;
  name?: string;
  text?: string;
  visible?: boolean;
  focused?: boolean;
  onActivate?: () => void;
  onContextMenu?: () => void;
  onKey?: (key: string) => void;
  onLongPress?: () => void;
  throwOnDispatch?: string;
}

type MockLocator = {
  __elements: FakeElement[];
  click: Mock<(options?: { button?: string }) => Promise<void>>;
  count: Mock<() => Promise<number>>;
  dispatchEvent: Mock<(type: string, options?: Record<string, unknown>) => Promise<void>>;
  first: Mock<() => MockLocator>;
  last: Mock<() => MockLocator>;
  focus: Mock<() => Promise<void>>;
  getAttribute: Mock<(name: string) => Promise<string | null>>;
  getByRole: Mock<(role: string) => MockLocator>;
  hover: Mock<() => Promise<void>>;
  nth: Mock<(index: number) => MockLocator>;
  press: Mock<(key: string) => Promise<void>>;
};

type MockPage = {
  getByTestId: Mock<(testId: string) => MockLocator>;
  getByRole: Mock<(role: string, options?: { name?: RegExp | string }) => MockLocator>;
  waitForTimeout: Mock<(timeout: number) => Promise<void>>;
  keyboard: { press: Mock<(key: string) => Promise<void>> };
};

interface FakeDom {
  page: MockPage & Page;
  mocks: MockPage;
  add: (spec: FakeElementSpec, parent?: FakeElement) => FakeElement;
  clicked: FakeElement[];
  activated: FakeElement[];
  dispatched: Array<{ element: FakeElement; type: string; options?: Record<string, unknown> }>;
  focused: FakeElement[];
  focusElement: (element: FakeElement) => void;
  hovers: FakeElement[];
}

function matchesAccessibleName(element: FakeElement, name?: RegExp | string): boolean {
  if (name === undefined) return true;
  if (name instanceof RegExp) return name.test(element.name);
  return element.name.toLowerCase() === name.toLowerCase();
}

function createFakeDom(): FakeDom {
  const clicked: FakeElement[] = [];
  const activated: FakeElement[] = [];
  const dispatched: Array<{ element: FakeElement; type: string; options?: Record<string, unknown> }> = [];
  const focused: FakeElement[] = [];
  const hovers: FakeElement[] = [];

  let active: FakeElement | null = null;
  let elapsedMs = 0;

  const createElement = (spec: FakeElementSpec): FakeElement => ({
    testId: spec.testId ?? null,
    role: spec.role ?? 'button',
    name: spec.name ?? spec.text ?? '',
    text: spec.text ?? '',
    visible: spec.visible ?? true,
    focused: spec.focused ?? false,
    children: [],
    parent: null,
    onActivate: spec.onActivate ?? null,
    onContextMenu: spec.onContextMenu ?? null,
    onKey: spec.onKey ?? null,
    onLongPress: spec.onLongPress ?? null,
    throwOnDispatch: spec.throwOnDispatch ?? null,
  });

  const root = createElement({ role: 'document' });

  function add(spec: FakeElementSpec, parent: FakeElement = root): FakeElement {
    const element = createElement(spec);
    element.parent = parent;
    parent.children.push(element);
    return element;
  }

  function elementsMatching(predicate: (element: FakeElement) => boolean): FakeElement[] {
    const found: FakeElement[] = [];
    const walk = (element: FakeElement): void => {
      if (predicate(element)) found.push(element);
      element.children.forEach(walk);
    };
    walk(root);
    return found;
  }

  function nearestMenu(element: FakeElement): FakeElement | null {
    for (let current = element.parent; current; current = current.parent) {
      if (current.role === 'menu') return current;
    }
    return null;
  }

  function activate(element: FakeElement): void {
    activated.push(element);
    if (element.onActivate) {
      element.onActivate();
      return;
    }
    const menu = nearestMenu(element);
    if (menu) menu.visible = false;
  }

  function clickElement(element: FakeElement, options?: { button?: string }): void {
    clicked.push(element);
    if (options?.button === 'right') {
      element.onContextMenu?.();
      return;
    }
    activate(element);
  }

  function focusElement(element: FakeElement): void {
    // Browser focus is single-valued: drop the flag anywhere before setting the new
    // one, otherwise a locator that still points at the previously focused element
    // would keep reporting it as focused.
    elementsMatching(() => true).forEach((candidate) => {
      candidate.focused = false;
    });
    element.focused = true;
    active = element;
    focused.push(element);
  }

  function pressKey(element: FakeElement, key: string): void {
    if (element.onKey) {
      element.onKey(key);
      return;
    }
    const items = (element.parent?.children ?? []).filter((child) => child.role === 'menuitemradio');
    const index = items.indexOf(element);
    if (items.length === 0 || index === -1) return;
    if (key === 'ArrowDown') focusElement(items[(index + 1) % items.length]);
    else if (key === 'ArrowUp') focusElement(items[(index - 1 + items.length) % items.length]);
    else if (key === 'Enter' || key === ' ') activate(element);
  }

  function dispatchEvent(element: FakeElement, type: string, options?: Record<string, unknown>): void {
    dispatched.push({ element, type, options });
    if (element.throwOnDispatch === type) {
      throw new Error(`dispatchEvent('${type}') failed on ${element.testId ?? element.role}`);
    }
    if (type === 'pointerdown') {
      elapsedMs = 0;
      return;
    }
    if (type === 'pointerup' && element.onLongPress && elapsedMs >= LONG_PRESS_THRESHOLD_MS) {
      elapsedMs = 0;
      element.onLongPress();
    }
  }

  function locatorFor(matches: FakeElement[]): MockLocator {
    const primary = (): FakeElement | undefined => matches[0];
    const locator: MockLocator = {
      __elements: matches,
      click: vi.fn(async (options?: { button?: string }) => {
        const element = primary();
        if (element) clickElement(element, options);
      }),
      count: vi.fn(async () => matches.length),
      dispatchEvent: vi.fn(async (type: string, options?: Record<string, unknown>) => {
        const element = primary();
        if (element) dispatchEvent(element, type, options);
      }),
      first: vi.fn(() => locator),
      last: vi.fn(() => locatorFor(matches.length ? [matches[matches.length - 1]] : [])),
      focus: vi.fn(async () => {
        const element = primary();
        if (element) focusElement(element);
      }),
      getAttribute: vi.fn(async (name: string) => {
        const element = primary();
        if (!element || name !== 'data-testid') return null;
        return element.testId;
      }),
      getByRole: vi.fn((role: string) =>
        locatorFor((primary()?.children ?? []).filter((child) => child.role === role))
      ),
      hover: vi.fn(async () => {
        const element = primary();
        if (!element) return;
        hovers.push(element);
        if (element.onLongPress && elapsedMs >= LONG_PRESS_THRESHOLD_MS) {
          elapsedMs = 0;
          element.onLongPress();
        }
      }),
      nth: vi.fn((index: number) => locatorFor(matches[index] ? [matches[index]] : [])),
      press: vi.fn(async (key: string) => {
        const element = primary();
        if (element) pressKey(element, key);
      }),
    };
    return locator;
  }

  const mocks: MockPage = {
    getByTestId: vi.fn((testId: string | RegExp) =>
      locatorFor(
        elementsMatching((element) =>
          typeof testId === 'string' ? element.testId === testId : testId.test(element.testId ?? '')
        )
      )
    ),
    getByRole: vi.fn((role: string, options?: { name?: RegExp | string }) =>
      locatorFor(elementsMatching((element) => element.role === role && matchesAccessibleName(element, options?.name)))
    ),
    waitForTimeout: vi.fn(async (timeout: number) => {
      elapsedMs += timeout;
    }),
    keyboard: {
      press: vi.fn(async (key: string) => {
        if (active) pressKey(active, key);
      }),
    },
  };

  // Playwright's Page exposes far more surface than the helpers touch, so the
  // fake is materialized from a bare object and the declared type stays authoritative.
  const page: MockPage & Page = Object.assign(Object.create(null), mocks);

  return { page, mocks, add, clicked, activated, dispatched, focused, focusElement, hovers };
}

interface FakeFlyoutItem {
  testId: string | null;
  text?: string;
  onActivate?: () => void;
}

function addFlyout(
  dom: FakeDom,
  items: FakeFlyoutItem[],
  options: { visible?: boolean } = {}
): { menu: FakeElement; items: FakeElement[] } {
  const menu = dom.add({ role: 'menu', visible: options.visible ?? true });
  const elements = items.map((item) =>
    dom.add(
      {
        role: 'menuitemradio',
        testId: item.testId,
        text: item.text ?? '',
        onActivate: item.onActivate,
      },
      menu
    )
  );
  return { menu, items: elements };
}

function visibilityCheckFor(element: FakeElement): { options?: { timeout?: number } } | undefined {
  return visibilityChecks.find((check) => check.target.__elements[0] === element);
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (reason) {
    if (reason instanceof Error) return reason;
    throw new Error(`expected an Error rejection but got: ${String(reason)}`, { cause: reason });
  }
  throw new Error('expected the promise to reject, but it resolved');
}

const IDEMPOTENCY_SAMPLES = [
  '',
  '&&&',
  '@#$%',
  '---',
  'Select & Move',
  'Tool@#$%',
  '  Tool Name  ',
  'Café Tool',
  '工具',
  'a - b',
  '🎨pen',
  'µ ± 5',
];

// Names that exist on Object.prototype. A plain object literal map answers these
// lookups with the inherited function/accessor, so `expected` is what normalization
// should yield once the maps are own-property-safe.
const INHERITED_NAME_CASES: Array<{ input: string; expected: string }> = [
  { input: 'constructor', expected: 'constructor' },
  { input: 'toString', expected: 'tostring' },
  { input: 'valueOf', expected: 'valueof' },
  { input: 'hasOwnProperty', expected: 'hasownproperty' },
  { input: '__proto__', expected: 'proto' },
  { input: 'isPrototypeOf', expected: 'isprototypeof' },
  { input: 'propertyIsEnumerable', expected: 'propertyisenumerable' },
  { input: 'toLocaleString', expected: 'tolocalestring' },
];

const INHERITED_NAME_KEYS = INHERITED_NAME_CASES.map(({ input }) => input);

const KEYBOARD_CASES: Array<{
  requested: 'ArrowDown' | 'ArrowUp' | 'Enter' | ' ';
  expected: string;
  /** Index of the item the app focuses for this key: last for ArrowUp, else first. */
  focusedIndex: number;
}> = [
  { requested: 'ArrowDown', expected: 'ArrowDown', focusedIndex: 0 },
  { requested: 'ArrowUp', expected: 'ArrowUp', focusedIndex: 1 },
  { requested: 'Enter', expected: 'Enter', focusedIndex: 0 },
  { requested: ' ', expected: ' ', focusedIndex: 0 },
];

describe('Toolbar Helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visibilityChecks.length = 0;
    hiddenChecks.length = 0;
    textChecks.length = 0;
  });

  describe('Pure Functions', () => {
    describe('TOOL_NAME_MAP', () => {
      it('maps "Select & Move" to "reposition"', () => {
        expect(TOOL_NAME_MAP['Select & Move']).toBe('reposition');
      });
    });

    describe('TOOL_DISPLAY_LABEL_MAP', () => {
      it('maps "reposition" to "Select & Move"', () => {
        expect(TOOL_DISPLAY_LABEL_MAP['reposition']).toBe('Select & Move');
      });

      it('is the exact inverse of TOOL_NAME_MAP', () => {
        expect(TOOL_DISPLAY_LABEL_MAP).toEqual(
          Object.fromEntries(Object.entries(TOOL_NAME_MAP).map(([display, internal]) => [internal, display]))
        );
      });
    });

    describe('normalizeToolName', () => {
      it('converts "Select & Move" to "select-and-move"', () => {
        expect(normalizeToolName('Select & Move')).toBe('select-and-move');
      });

      it('converts "Brush Tool" to "brush-tool"', () => {
        expect(normalizeToolName('Brush Tool')).toBe('brush-tool');
      });

      it('converts "Color Picker" to "color-picker"', () => {
        expect(normalizeToolName('Color Picker')).toBe('color-picker');
      });

      it('handles special characters (strips trailing non-alphanumeric)', () => {
        expect(normalizeToolName('Tool@#$%')).toBe('tool');
      });

      it('handles multiple spaces', () => {
        expect(normalizeToolName('Tool   Name')).toBe('tool-name');
      });

      it('strips leading/trailing non-alphanumeric characters (no malformed dashes)', () => {
        expect(normalizeToolName('  Tool Name  ')).toBe('tool-name');
      });

      it('returns an empty string for an empty name', () => {
        expect(normalizeToolName('')).toBe('');
      });

      it('returns an empty string when the name is only non-alphanumeric characters', () => {
        expect(normalizeToolName('@#$%')).toBe('');
        expect(normalizeToolName('---')).toBe('');
        expect(normalizeToolName('   ')).toBe('');
      });

      it('expands ampersands to "and" before stripping', () => {
        expect(normalizeToolName('&&&')).toBe('andandand');
        expect(normalizeToolName('a&b')).toBe('aandb');
      });

      it('drops non-ascii letters', () => {
        expect(normalizeToolName('Café Tool')).toBe('caf-tool');
        expect(normalizeToolName('🎨pen')).toBe('pen');
        expect(normalizeToolName('工具')).toBe('');
      });

      it.each(IDEMPOTENCY_SAMPLES)('is idempotent for %j', (sample) => {
        const once = normalizeToolName(sample);
        expect(normalizeToolName(once)).toBe(once);
      });
    });

    describe('resolveToolName', () => {
      it('applies TOOL_NAME_MAP before normalizing', () => {
        expect(resolveToolName('Select & Move')).toBe('reposition');
      });

      it('passes through unmapped names to normalizeToolName', () => {
        expect(resolveToolName('Brush Tool')).toBe('brush-tool');
      });

      it('resolves every mapped display name through normalizeToolName', () => {
        for (const [display, internal] of Object.entries(TOOL_NAME_MAP)) {
          expect(resolveToolName(display)).toBe(normalizeToolName(internal));
        }
      });

      it('normalizes a mapped internal name that is not already normalized', () => {
        // Synthetic state: TOOL_DISPLAY_LABEL_MAP is derived once at module load, so it cannot reflect this entry.
        TOOL_NAME_MAP['Crop & Slice'] = 'Crop Tool';
        try {
          expect(resolveToolName('Crop & Slice')).toBe('crop-tool');
        } finally {
          delete TOOL_NAME_MAP['Crop & Slice'];
        }
      });

      it('only matches mapped display names case-sensitively', () => {
        expect(resolveToolName('SELECT & MOVE')).toBe('select-and-move');
        expect(resolveToolName('select and move')).toBe('select-and-move');
        expect(resolveToolName('Select & Move')).toBe('reposition');
      });

      it('still resolves legitimate mapped and unmapped tool names', () => {
        expect(resolveToolName('Select & Move')).toBe('reposition');
        expect(resolveToolName('brush')).toBe('brush');
      });
    });

    describe('inherited Object.prototype member names', () => {
      it.each(INHERITED_NAME_CASES)(
        'resolveToolName(%j) returns the normalized string instead of an inherited function',
        ({ input, expected }) => {
          const resolved = resolveToolName(input);

          expect(typeof resolved).toBe('string');
          expect(resolved).toBe(expected);
        }
      );

      it.each(INHERITED_NAME_CASES)('normalizeToolName and generateSlug(%j) do not throw', ({ input, expected }) => {
        expect(() => normalizeToolName(input)).not.toThrow();
        expect(normalizeToolName(input)).toBe(expected);
        expect(() => generateSlug(input)).not.toThrow();
        expect(generateSlug(input)).toBe(expected);
      });

      it.each(INHERITED_NAME_KEYS)('TOOL_NAME_MAP and TOOL_DISPLAY_LABEL_MAP have no inherited entry for %j', (key) => {
        expect(TOOL_NAME_MAP[key]).toBeUndefined();
        expect(TOOL_DISPLAY_LABEL_MAP[key]).toBeUndefined();
      });
    });

    describe('generateSlug', () => {
      it('converts "Levels" to "levels"', () => {
        expect(generateSlug('Levels')).toBe('levels');
      });

      it('converts "Color Balance" to "color-balance"', () => {
        expect(generateSlug('Color Balance')).toBe('color-balance');
      });

      it('handles special characters in label (strips trailing non-alphanumeric)', () => {
        expect(generateSlug('Item @#$%')).toBe('item');
      });

      it('handles numbers', () => {
        expect(generateSlug('Tool 2')).toBe('tool-2');
      });

      it('strips leading/trailing whitespace and non-alphanumeric', () => {
        expect(generateSlug('  My Label  ')).toBe('my-label');
      });

      it('returns an empty string for an empty label', () => {
        expect(generateSlug('')).toBe('');
      });

      it('FlyoutItem interface has toolName and label string fields', () => {
        expectTypeOf<FlyoutItem>().toEqualTypeOf<{
          toolName: string;
          label: string;
        }>();
      });
    });
  });

  describe('clickToolButton', () => {
    it('clicks the tool button addressed by its data-testid', async () => {
      const dom = createFakeDom();
      const button = dom.add({ testId: 'tool-button-brush' });

      await clickToolButton(dom.page, 'brush');

      expect(dom.clicked).toEqual([button]);
      expect(dom.mocks.getByRole).not.toHaveBeenCalled();
    });

    it('maps a display name to the internal testid before querying', async () => {
      const dom = createFakeDom();
      const button = dom.add({ testId: 'tool-button-reposition' });

      await clickToolButton(dom.page, 'Select & Move');

      expect(dom.mocks.getByTestId).toHaveBeenCalledWith(toolButtonTestId('Select & Move'));
      expect(dom.clicked).toEqual([button]);
    });

    it('getToolButton and clickToolButton resolve the same testid', async () => {
      const dom = createFakeDom();
      dom.add({ testId: 'tool-button-reposition' });

      await clickToolButton(dom.page, 'Select & Move');
      const locator = getToolButton(dom.page, 'Select & Move');

      expect(dom.mocks.getByTestId.mock.calls.map(([testId]) => testId)).toEqual([
        toolButtonTestId('Select & Move'),
        toolButtonTestId('Select & Move'),
      ]);
      expect(await locator.count()).toBe(1);
    });

    it('falls back to the role selector using the resolved display name', async () => {
      const dom = createFakeDom();
      const legacyButton = dom.add({ testId: 'legacy-select-move', name: LEGACY_SELECT_AND_MOVE_LABEL });

      await clickToolButton(dom.page, 'Select & Move');

      expect(dom.mocks.getByTestId).toHaveBeenCalledWith(toolButtonTestId('Select & Move'));
      expect(dom.clicked).toEqual([legacyButton]);
    });

    it('falls back to the display label for the internal name "reposition"', async () => {
      const dom = createFakeDom();
      const legacyButton = dom.add({ testId: 'legacy-select-move', name: LEGACY_SELECT_AND_MOVE_LABEL });
      const internalNameButton = dom.add({ testId: 'legacy-internal', name: 'reposition' });

      await clickToolButton(dom.page, 'reposition');

      expect(dom.mocks.getByTestId).toHaveBeenCalledWith(toolButtonTestId('reposition'));
      expect(dom.clicked).toEqual([legacyButton]);
      expect(dom.clicked).not.toContain(internalNameButton);
    });

    it('falls back to the internal name when no display label is mapped', async () => {
      const dom = createFakeDom();
      const legacyButton = dom.add({ testId: 'legacy-brush', name: 'Brush Tool' });

      await clickToolButton(dom.page, 'brush');

      expect(dom.clicked).toEqual([legacyButton]);
    });

    it('clicks only the first of several testid matches', async () => {
      const dom = createFakeDom();
      const first = dom.add({ testId: 'tool-button-lasso', text: 'first' });
      dom.add({ testId: 'tool-button-lasso', text: 'second' });
      dom.add({ testId: 'tool-button-lasso', text: 'third' });

      await clickToolButton(dom.page, 'lasso');

      expect(dom.clicked).toEqual([first]);
    });

    it('clicks only the first of several role matches', async () => {
      const dom = createFakeDom();
      const first = dom.add({ testId: 'legacy-lasso-1', name: 'Lasso Select' });
      dom.add({ testId: 'legacy-lasso-2', name: 'Lasso Polygonal' });

      await clickToolButton(dom.page, 'lasso');

      expect(dom.clicked).toEqual([first]);
    });

    it('throws when no testid and no fallback candidate resolves', async () => {
      const dom = createFakeDom();
      dom.add({ testId: 'tool-button-brush', name: 'Brush' });

      const failure = clickToolButton(dom.page, 'Select & Move');

      await expect(failure).rejects.toThrow(/no clickable button found for tool "Select & Move"/);
      await expect(failure).rejects.toThrow(/data-testid="tool-button-reposition"/);
      await expect(failure).rejects.toThrow(/"Select & Move"/);
      await expect(failure).rejects.toThrow(/"reposition"/);
      expect(dom.clicked).toEqual([]);
    });

    it('throws when the page has no matching button at all', async () => {
      const dom = createFakeDom();

      const failure = clickToolButton(dom.page, 'brush');

      await expect(failure).rejects.toThrow(/no clickable button found for tool "brush"/);
      await expect(failure).rejects.toThrow(/"brush"/);
      expect(dom.clicked).toEqual([]);
    });

    it.each(INHERITED_NAME_CASES)(
      'reports the actionable error for %j instead of a TypeError from the string helpers',
      async ({ input, expected }) => {
        const dom = createFakeDom();
        dom.add({ testId: 'tool-button-brush', name: 'Brush' });

        const error = await captureError(clickToolButton(dom.page, input));

        expect(error).not.toBeInstanceOf(TypeError);
        expect(error.message).toContain(`no clickable button found for tool "${input}"`);
        expect(error.message).toContain(`data-testid="tool-button-${expected}"`);
        expect(dom.clicked).toEqual([]);
      }
    );
  });

  describe('openToolFlyout', () => {
    it('opens the flyout with a long press', async () => {
      const dom = createFakeDom();
      const { menu } = addFlyout(dom, [{ testId: flyoutItemTestId('levels', 'Levels') }], { visible: false });
      const button = dom.add({
        testId: 'tool-button-reposition',
        onLongPress: () => {
          menu.visible = true;
        },
      });

      await openToolFlyout(dom.page, 'Select & Move');

      expect(menu.visible).toBe(true);
      expect(dom.dispatched.map((event) => event.element)).toEqual([button, button]);
      expect(dom.dispatched.map((event) => event.type)).toEqual(['pointerdown', 'pointerup']);
      expect(dom.dispatched.map((event) => event.options)).toEqual([{ button: 0 }, { button: 0 }]);
      expect(dom.mocks.waitForTimeout).toHaveBeenCalledWith(LONG_PRESS_DELAY_MS);
      expect(visibilityCheckFor(menu)?.options).toEqual({ timeout: FLYOUT_VISIBLE_TIMEOUT_MS });
    });

    it('fails when the tool button is not visible', async () => {
      const dom = createFakeDom();
      dom.add({ testId: 'tool-button-reposition', visible: false });

      await expect(openToolFlyout(dom.page, 'Select & Move')).rejects.toThrow(/toBeVisible\(\)/);
      expect(dom.dispatched).toEqual([]);
    });

    it('propagates a dispatchEvent failure and never sends pointerup', async () => {
      const dom = createFakeDom();
      dom.add({ testId: 'tool-button-reposition', throwOnDispatch: 'pointerdown' });

      await expect(openToolFlyout(dom.page, 'Select & Move')).rejects.toThrow(/dispatchEvent\('pointerdown'\) failed/);
      expect(dom.dispatched.map((event) => event.type)).toEqual(['pointerdown']);
    });
  });

  describe('waitForFlyout', () => {
    it('resolves once the flyout is visible', async () => {
      const dom = createFakeDom();
      const { menu } = addFlyout(dom, []);

      await waitForFlyout(dom.page);

      expect(visibilityCheckFor(menu)?.options).toEqual({ timeout: FLYOUT_VISIBLE_TIMEOUT_MS });
    });

    it('rejects when the flyout never becomes visible', async () => {
      const dom = createFakeDom();
      addFlyout(dom, [], { visible: false });

      await expect(waitForFlyout(dom.page)).rejects.toThrow(
        new RegExp(`Timed out ${FLYOUT_VISIBLE_TIMEOUT_MS}ms.*toBeVisible\\(\\)`)
      );
    });
  });

  describe('selectFromFlyout', () => {
    it('clicks the item addressed by tool name and label slug and closes the flyout', async () => {
      const dom = createFakeDom();
      const { menu, items } = addFlyout(dom, [
        { testId: flyoutItemTestId('levels', 'Levels') },
        { testId: flyoutItemTestId('color-and-tone', 'Color & Tone') },
      ]);

      await selectFromFlyout(dom.page, { toolName: 'color-and-tone', label: 'Color & Tone' });

      expect(dom.mocks.getByTestId).toHaveBeenCalledWith(flyoutItemTestId('color-and-tone', 'Color & Tone'));
      expect(dom.clicked).toEqual([items[1]]);
      expect(menu.visible).toBe(false);
      expect(hiddenChecks).toHaveLength(1);
      expect(hiddenChecks[0].options).toEqual({ timeout: FLYOUT_CLOSE_TIMEOUT_MS });
    });

    it('fails when the item is not present in the flyout', async () => {
      const dom = createFakeDom();
      addFlyout(dom, [{ testId: flyoutItemTestId('levels', 'Levels') }]);

      await expect(selectFromFlyout(dom.page, { toolName: 'curves', label: 'Curves' })).rejects.toThrow(
        /toBeVisible\(\)/
      );
      expect(dom.clicked).toEqual([]);
    });

    it('fails when the flyout stays open after the click', async () => {
      const dom = createFakeDom();
      addFlyout(dom, [{ testId: flyoutItemTestId('levels', 'Levels'), onActivate: () => {} }]);

      await expect(selectFromFlyout(dom.page, { toolName: 'levels', label: 'Levels' })).rejects.toThrow(
        /toBeHidden\(\)/
      );
    });
  });

  describe('getToolButton', () => {
    it('returns a locator for the resolved testid', async () => {
      const dom = createFakeDom();
      dom.add({ testId: 'tool-button-reposition' });

      const locator = getToolButton(dom.page, 'Select & Move');

      expect(dom.mocks.getByTestId).toHaveBeenCalledWith(toolButtonTestId('Select & Move'));
      expect(await locator.count()).toBe(1);
    });

    it('returns a locator for an unmapped tool name', async () => {
      const dom = createFakeDom();
      dom.add({ testId: 'tool-button-brush' });

      const locator = getToolButton(dom.page, 'brush');

      expect(dom.mocks.getByTestId).toHaveBeenCalledWith(toolButtonTestId('brush'));
      expect(await locator.count()).toBe(1);
    });

    it.each(INHERITED_NAME_CASES)('resolves %j to a string testid instead of throwing', async ({ input, expected }) => {
      const dom = createFakeDom();
      dom.add({ testId: `tool-button-${expected}` });

      const locator = getToolButton(dom.page, input);

      expect(dom.mocks.getByTestId).toHaveBeenCalledWith(`tool-button-${expected}`);
      expect(await locator.count()).toBe(1);
    });
  });

  describe('toggleToolbarLayout', () => {
    it('clicks the layout toggle', async () => {
      const dom = createFakeDom();
      const toggle = dom.add({ testId: 'toolbar-layout-toggle' });

      await toggleToolbarLayout(dom.page);

      expect(dom.clicked).toEqual([toggle]);
    });

    it('fails when the layout toggle is not visible', async () => {
      const dom = createFakeDom();
      dom.add({ testId: 'toolbar-layout-toggle', visible: false });

      await expect(toggleToolbarLayout(dom.page)).rejects.toThrow(/toBeVisible\(\)/);
      expect(dom.clicked).toEqual([]);
    });
  });

  describe('verifyPrimaryTool', () => {
    it('resolves when the primary tool label matches the button text', async () => {
      const dom = createFakeDom();
      const button = dom.add({
        testId: 'tool-button-reposition',
        text: 'Reposition',
      });

      await verifyPrimaryTool(dom.page, 'Select & Move', 'Reposition');

      expect(textChecks).toHaveLength(1);
      expect(textChecks[0].target.__elements).toEqual([button]);
      expect(textChecks[0].expected).toBe('Reposition');
    });

    it('fails when the grouped button shows a different primary tool', async () => {
      const dom = createFakeDom();
      dom.add({ testId: 'tool-button-reposition', text: 'Select & Move' });

      await expect(verifyPrimaryTool(dom.page, 'Select & Move', 'Reposition')).rejects.toThrow(/toContainText\(\)/);
    });
  });

  describe('openToolFlyoutViaRightClick', () => {
    it('opens the flyout on right click', async () => {
      const dom = createFakeDom();
      const { menu } = addFlyout(dom, [{ testId: flyoutItemTestId('levels', 'Levels') }], { visible: false });
      const button = dom.add({
        testId: 'tool-button-reposition',
        onContextMenu: () => {
          menu.visible = true;
        },
      });

      await openToolFlyoutViaRightClick(dom.page, 'Select & Move');

      expect(dom.clicked).toEqual([button]);
      expect(menu.visible).toBe(true);
      expect(visibilityCheckFor(menu)?.options).toEqual({ timeout: FLYOUT_VISIBLE_TIMEOUT_MS });
    });
  });

  describe('verifyHoverDoesNotOpenFlyout', () => {
    it('hovers the button and leaves the flyout closed', async () => {
      const dom = createFakeDom();
      const { menu } = addFlyout(dom, [{ testId: flyoutItemTestId('levels', 'Levels') }], { visible: false });
      const button = dom.add({
        testId: 'tool-button-reposition',
        onContextMenu: () => {
          menu.visible = true;
        },
        onLongPress: () => {
          menu.visible = true;
        },
      });

      await verifyHoverDoesNotOpenFlyout(dom.page, 'Select & Move');

      expect(dom.hovers).toEqual([button]);
      expect(dom.mocks.waitForTimeout).toHaveBeenCalledWith(HOVER_SETTLE_MS);
      expect(dom.dispatched).toEqual([]);
      expect(menu.visible).toBe(false);
      expect(hiddenChecks).toHaveLength(1);
    });

    it('control: a hover that reaches the long-press threshold opens the flyout in the fake', async () => {
      const dom = createFakeDom();
      const { menu } = addFlyout(dom, [{ testId: flyoutItemTestId('levels', 'Levels') }], { visible: false });
      dom.add({
        testId: 'tool-button-reposition',
        onLongPress: () => {
          menu.visible = true;
        },
      });
      const button = getToolButton(dom.page, 'Select & Move');
      await button.dispatchEvent('pointerdown', { button: 0 });
      await dom.mocks.waitForTimeout(HOVER_SETTLE_MS);

      await button.hover();

      expect(menu.visible).toBe(true);
    });
  });

  describe('openToolFlyoutViaKeyboard', () => {
    it.each(KEYBOARD_CASES)(
      'opens the flyout and waits for $requested to land focus, not just visibility',
      async ({ requested, expected, focusedIndex }) => {
        const dom = createFakeDom();
        // Two items, so "first" and "last" are distinguishable: a helper that asserted
        // the wrong end for ArrowUp would pass against a single-item flyout.
        const { menu, items } = addFlyout(
          dom,
          [{ testId: flyoutItemTestId('levels', 'Levels') }, { testId: flyoutItemTestId('curves', 'Curves') }],
          { visible: false }
        );
        const pressed: string[] = [];
        dom.add({
          testId: 'tool-button-reposition',
          onKey: (key) => {
            pressed.push(key);
            // Models the app's handler: open the flyout, then - from its rAF callback -
            // focus the last item for ArrowUp and the first otherwise.
            menu.visible = true;
            const target = key === 'ArrowUp' ? items[items.length - 1] : items[0];
            dom.focusElement(target);
          },
        });

        await openToolFlyoutViaKeyboard(dom.page, 'Select & Move', requested);

        expect(pressed).toEqual([expected]);
        expect(menu.visible).toBe(true);
        expect(visibilityCheckFor(menu)?.options).toEqual({ timeout: FLYOUT_VISIBLE_TIMEOUT_MS });
        // The contract that makes this safe to navigate from: the promised item holds
        // focus by the time the helper returns. Without it a caller can send the next
        // key while the tool button still has focus, which re-opens the flyout.
        expect(items[focusedIndex].focused).toBe(true);
        expect(items.filter((item) => item.focused)).toHaveLength(1);
      }
    );

    it('defaults to ArrowDown and waits for the first item to be focused', async () => {
      const dom = createFakeDom();
      const { menu, items } = addFlyout(
        dom,
        [{ testId: flyoutItemTestId('levels', 'Levels') }, { testId: flyoutItemTestId('curves', 'Curves') }],
        { visible: false }
      );
      const pressed: string[] = [];
      dom.add({
        testId: 'tool-button-reposition',
        onKey: (key) => {
          pressed.push(key);
          menu.visible = true;
          dom.focusElement(items[0]);
        },
      });

      await openToolFlyoutViaKeyboard(dom.page, 'Select & Move');

      expect(pressed).toEqual(['ArrowDown']);
      expect(menu.visible).toBe(true);
      expect(items[0].focused).toBe(true);
    });

    it('rejects when the flyout opens but no item ever takes focus', async () => {
      const dom = createFakeDom();
      const { menu } = addFlyout(dom, [{ testId: flyoutItemTestId('levels', 'Levels') }], { visible: false });
      dom.add({
        testId: 'tool-button-reposition',
        // Visibility without focus is exactly the rAF gap that made Enter leave the
        // flyout open in 5 of 12 measured runs. The helper must not return here.
        onKey: () => {
          menu.visible = true;
        },
      });

      await expect(openToolFlyoutViaKeyboard(dom.page, 'Select & Move')).rejects.toThrow(/toBeFocused\(\)/);
    });
  });

  describe('navigateAndSelectInFlyout', () => {
    const flyoutItemSpecs: FakeFlyoutItem[] = [
      { testId: flyoutItemTestId('levels', 'Levels'), text: 'Levels' },
      { testId: flyoutItemTestId('curves', 'Curves'), text: 'Curves' },
      { testId: flyoutItemTestId('color-and-tone', 'Color & Tone'), text: 'Color & Tone' },
    ];

    it('activates the first item and closes the flyout', async () => {
      const dom = createFakeDom();
      const { menu, items } = addFlyout(dom, flyoutItemSpecs);

      await navigateAndSelectInFlyout(dom.page, 'levels', 'Levels');

      expect(dom.activated).toEqual([items[0]]);
      expect(dom.focused.at(-1)).toBe(items[0]);
      expect(menu.visible).toBe(false);
    });

    it('activates a middle item and closes the flyout', async () => {
      const dom = createFakeDom();
      const { menu, items } = addFlyout(dom, flyoutItemSpecs);

      await navigateAndSelectInFlyout(dom.page, 'curves', 'Curves');

      expect(dom.activated).toEqual([items[1]]);
      expect(dom.focused.at(-1)).toBe(items[1]);
      expect(menu.visible).toBe(false);
    });

    it('activates the last item and closes the flyout', async () => {
      const dom = createFakeDom();
      const { menu, items } = addFlyout(dom, flyoutItemSpecs);

      await navigateAndSelectInFlyout(dom.page, 'color-and-tone', 'Color & Tone');

      expect(dom.activated).toEqual([items[2]]);
      expect(dom.focused.at(-1)).toBe(items[2]);
      expect(menu.visible).toBe(false);
    });

    it('wraps to the end of the flyout when navigating up', async () => {
      const dom = createFakeDom();
      const { menu, items } = addFlyout(dom, flyoutItemSpecs);

      await navigateAndSelectInFlyout(dom.page, 'levels', 'Levels', 'up');

      expect(dom.activated).toEqual([items[0]]);
      expect(dom.focused).toEqual([items[0], items[2], items[1], items[0]]);
      expect(dom.focused.at(-1)).toBe(items[0]);
      expect(menu.visible).toBe(false);
    });

    it('throws when the flyout is empty', async () => {
      const dom = createFakeDom();
      addFlyout(dom, []);

      await expect(navigateAndSelectInFlyout(dom.page, 'levels', 'Levels')).rejects.toThrow(
        'Flyout item not found: levels-levels'
      );
      expect(dom.activated).toEqual([]);
    });

    it('throws when the flyout items carry no data-testid', async () => {
      const dom = createFakeDom();
      addFlyout(dom, [
        { testId: null, text: 'Levels' },
        { testId: null, text: 'Curves' },
      ]);

      await expect(navigateAndSelectInFlyout(dom.page, 'levels', 'Levels')).rejects.toThrow(
        'Flyout item not found: levels-levels'
      );
      expect(dom.activated).toEqual([]);
    });

    it('throws when the target item is not part of the flyout', async () => {
      const dom = createFakeDom();
      addFlyout(dom, flyoutItemSpecs);

      await expect(navigateAndSelectInFlyout(dom.page, 'nonexistent', 'Nonexistent')).rejects.toThrow(
        'Flyout item not found: nonexistent-nonexistent'
      );
      expect(dom.activated).toEqual([]);
    });

    it('fails when the flyout stays open after Enter', async () => {
      const dom = createFakeDom();
      addFlyout(
        dom,
        flyoutItemSpecs.map((item) => ({ ...item, onActivate: () => {} }))
      );

      await expect(navigateAndSelectInFlyout(dom.page, 'levels', 'Levels')).rejects.toThrow(/toBeHidden\(\)/);
    });
  });
});
