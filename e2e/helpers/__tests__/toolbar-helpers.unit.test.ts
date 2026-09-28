import { describe, it, expect, vi, beforeEach, expectTypeOf } from 'vitest';
import type { Mock } from 'vitest';
import type { Page } from '@playwright/test';
import { createScrollModel } from './canvas-helpers.fixtures';
import { slugifyToolLabel, toolbarMap } from '../../../toolbar-mapping.ts';
import {
  TOOL_NAME_MAP,
  TOOL_DISPLAY_LABEL_MAP,
  normalizeToolName,
  resolveToolName,
  generateSlug,
  clickToolButton,
  openToolFlyout,
  waitForFlyout,
  // Imported, not restated. Two literals for one timeout is how the delay came to be 300 in
  // one place and 350 in another while only `300 + 50 === 350` kept them compatible, so
  // declaring this again here would reintroduce the exact hazard the export exists to stop.
  FLYOUT_VISIBLE_TIMEOUT_MS,
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

const { playwrightExpect, visibilityChecks, hiddenChecks, textChecks, attributeChecks } = vi.hoisted(() => {
  type Target = {
    __elements: Array<{
      visible: boolean;
      focused: boolean;
      testId: string | null;
      text: string;
      attributes?: Record<string, string>;
      settle?: (() => void) | null;
    }>;
  };
  type Check = { target: Target; options?: { timeout?: number } };

  // The bindings below are returned to names declared on the outer scope, so the
  // locals are spelled differently: shadowing them would make every recorded check
  // ambiguous about which array it lands in.
  const recordedVisibilityChecks: Check[] = [];
  const recordedHiddenChecks: Check[] = [];
  const recordedTextChecks: Array<{ target: Target; expected: string }> = [];
  const recordedAttributeChecks: Array<{
    target: Target;
    name: string;
    expected: string;
    options?: { timeout?: number };
  }> = [];

  const locatorLabel = (target: Target): string => {
    const testId = target.__elements[0]?.testId;
    return testId ? `[testid="${testId}"]` : '[role]';
  };

  const timedOut = (matcher: string, target: Target, timeout?: number): Error =>
    new Error(`Timed out ${timeout ?? 0}ms waiting for expect(locator${locatorLabel(target)}).${matcher}()`);

  const hoistedExpect = vi.fn((target: Target) => ({
    toBeVisible: vi.fn(async (options?: { timeout?: number }) => {
      recordedVisibilityChecks.push({ target, options });
      if (!target.__elements.some((element) => element.visible)) {
        throw timedOut('toBeVisible', target, options?.timeout);
      }
    }),
    toBeHidden: vi.fn(async (options?: { timeout?: number }) => {
      recordedHiddenChecks.push({ target, options });
      if (target.__elements.some((element) => element.visible)) {
        throw timedOut('toBeHidden', target, options?.timeout);
      }
    }),
    toContainText: vi.fn(async (expected: string) => {
      recordedTextChecks.push({ target, expected });
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
    toHaveAttribute: vi.fn(async (name: string, expected: string, options?: { timeout?: number }) => {
      recordedAttributeChecks.push({ target, name, expected, options });
      // An attribute assertion is a CONDITION wait, so the app's pending work gets the
      // chance to run before the answer is read. That is what makes it a usable stand-in
      // for `openToolFlyout`'s wait on `aria-expanded`: the long-press timer is armed by
      // pointerdown and fires on its own, and a real `toHaveAttribute` polls until the
      // attribute appears rather than reading it once.
      if (!target.__elements.some((element) => element.attributes?.[name] === expected)) {
        target.__elements.forEach((element) => element.settle?.());
      }
      if (!target.__elements.some((element) => element.attributes?.[name] === expected)) {
        throw timedOut(`toHaveAttribute(${name}="${expected}")`, target, options?.timeout);
      }
    }),
  }));

  return {
    playwrightExpect: hoistedExpect,
    visibilityChecks: recordedVisibilityChecks,
    hiddenChecks: recordedHiddenChecks,
    textChecks: recordedTextChecks,
    attributeChecks: recordedAttributeChecks,
  };
});

vi.mock('@playwright/test', () => ({
  expect: playwrightExpect,
}));

const LONG_PRESS_THRESHOLD_MS = 300;
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
  attributes: Record<string, string>;
  children: FakeElement[];
  parent: FakeElement | null;
  onActivate: (() => void) | null;
  onContextMenu: (() => void) | null;
  onKey: ((key: string) => void) | null;
  onLongPress: (() => void) | null;
  /**
   * The long-press timer `SidebarLeft` arms on pointerdown, or `null` when none is pending.
   * The real timer fires on its own 300ms later and `onPointerUp` cancels it, so the fake
   * exposes it as a one-shot callback the trigger can fire or discard rather than deriving
   * the outcome from the order of `pointerup`.
   */
  settle: (() => void) | null;
  throwOnDispatch: string | null;
}

interface FakeElementSpec {
  testId?: string | null;
  role?: string;
  name?: string;
  text?: string;
  visible?: boolean;
  focused?: boolean;
  attributes?: Record<string, string>;
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
  evaluate: Mock<Page['evaluate']>;
};

/** The offset Playwright's scroll-into-view produces when a toolbar button is clicked. */
const SCROLLED_BY_CLICK = 440;

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
  /** Where the window ended up, and every `window.scrollTo` the code under test issued. */
  windowScroll: () => { x: number; y: number };
  scrollRequests: () => Array<{ x: number; y: number }>;
}

function matchesAccessibleName(element: FakeElement, name?: RegExp | string): boolean {
  if (name === undefined) return true;
  if (name instanceof RegExp) return name.test(element.name);
  return element.name.toLowerCase() === name.toLowerCase();
}

function createFakeDom(domOptions: { scrollOnClick?: boolean } = {}): FakeDom {
  const { scrollOnClick = false } = domOptions;
  const clicked: FakeElement[] = [];
  const activated: FakeElement[] = [];
  const dispatched: Array<{ element: FakeElement; type: string; options?: Record<string, unknown> }> = [];
  const focused: FakeElement[] = [];
  const hovers: FakeElement[] = [];

  let active: FakeElement | null = null;
  let elapsedMs = 0;
  // One model for the whole fake, so the window a click moved is the window the next
  // `evaluate` reads and the one a restore writes.
  const scrollModel = createScrollModel();

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
    attributes: spec.attributes ?? {},
    settle: null,
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

  /**
   * Arms the 300ms long-press timer, one-shot. Consuming it in the same call keeps the two
   * triggers — a condition wait on `aria-expanded`, and a real hover that outlives the
   * threshold — from both firing the flyout open.
   */
  function armLongPress(element: FakeElement): void {
    element.settle = () => {
      element.settle = null;
      elapsedMs = 0;
      element.onLongPress?.();
    };
  }

  function firePendingLongPress(element: FakeElement): void {
    if (element.settle && elapsedMs >= LONG_PRESS_THRESHOLD_MS) element.settle();
  }

  function dispatchEvent(element: FakeElement, type: string, options?: Record<string, unknown>): void {
    dispatched.push({ element, type, options });
    if (element.throwOnDispatch === type) {
      throw new Error(`dispatchEvent('${type}') failed on ${element.testId ?? element.role}`);
    }
    if (type === 'pointerdown') {
      elapsedMs = 0;
      armLongPress(element);
      return;
    }
    if (type === 'pointerup' || type === 'pointercancel') {
      // The app's `onPointerUp` calls `clearLongPressFlyout()` unconditionally, so a lift
      // before the timer fires cancels the open for good: the flyout is not merely late, it
      // never appears. Discarding the pending timer is that cancellation.
      element.settle = null;
      elapsedMs = 0;
    }
  }

  function locatorFor(matches: FakeElement[]): MockLocator {
    const primary = (): FakeElement | undefined => matches[0];
    const locator: MockLocator = {
      __elements: matches,
      click: vi.fn(async (options?: { button?: string }) => {
        const element = primary();
        if (element) clickElement(element, options);
        // Playwright scrolls a target into view before clicking it. The left toolbar is
        // 1177px tall in a 720px window, so a click on a tool near the bottom of it lands
        // with the window at 440 — which is what `preservingScroll` exists to undo.
        if (scrollOnClick) {
          void scrollModel.evaluate(() => {
            window.scrollTo(0, SCROLLED_BY_CLICK);
          }, undefined);
        }
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
        firePendingLongPress(element);
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
    // A toolbar click must not move the window, so the helpers read the scroll before the
    // click and write it back after. This models the window those two calls see: a click
    // can move it — that is what Playwright's scroll-into-view does — and the fake lets a
    // test make it do so.
    evaluate: scrollModel.evaluate,
  };

  // Playwright's Page exposes far more surface than the helpers touch, so the
  // fake is materialized from a bare object and the declared type stays authoritative.
  const page: MockPage & Page = Object.assign(Object.create(null), mocks);

  return {
    page,
    mocks,
    add,
    clicked,
    activated,
    dispatched,
    focused,
    focusElement,
    hovers,
    windowScroll: () => ({ x: scrollModel.scrollX(), y: scrollModel.scrollY() }),
    scrollRequests: () => scrollModel.scrollRequests(),
  };
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
//
// `slugExpected` is the same name run through the flyout-item slug rule, which is a
// different function: it does not trim, so `'__proto__'` keeps a dash on each side of
// `proto` where `normalizeToolName` trims them away. The two coincide for every other
// case here because each is a single run of alphanumerics.
const INHERITED_NAME_CASES: Array<{ input: string; expected: string; slugExpected: string }> = [
  { input: 'constructor', expected: 'constructor', slugExpected: 'constructor' },
  { input: 'toString', expected: 'tostring', slugExpected: 'tostring' },
  { input: 'valueOf', expected: 'valueof', slugExpected: 'valueof' },
  { input: 'hasOwnProperty', expected: 'hasownproperty', slugExpected: 'hasownproperty' },
  { input: '__proto__', expected: 'proto', slugExpected: '-proto-' },
  { input: 'isPrototypeOf', expected: 'isprototypeof', slugExpected: 'isprototypeof' },
  { input: 'propertyIsEnumerable', expected: 'propertyisenumerable', slugExpected: 'propertyisenumerable' },
  { input: 'toLocaleString', expected: 'tolocalestring', slugExpected: 'tolocalestring' },
];

const INHERITED_NAME_KEYS = INHERITED_NAME_CASES.map(({ input }) => input);

// Tool names whose regex metacharacters used to be interpolated straight into the
// role fallback's `new RegExp(...)`. Each `decoy` is a button that the *unescaped*
// pattern does match, which is why the old selector resolved to the wrong element
// rather than to no element at all. `'C:\\Tool'` is the two-character escape for the
// name the button really carries, `C:\Tool`.
const REGEX_METACHARACTER_CASES: Array<{ name: string; decoy: string }> = [
  { name: 'Brush (B)', decoy: 'Brush B' },
  { name: 'Levels[beta]', decoy: 'Levelsbeta' },
  { name: 'Crop.v2', decoy: 'Crop-v2' },
  { name: 'Zoom+', decoy: 'Zoom' },
  { name: 'Paint|Fill', decoy: 'Paint' },
  { name: 'C:\\Tool', decoy: 'C:Tool' },
];

// The `slugifyToolLabel` in `toolbar-mapping.ts`, which is what
// `SidebarLeft` mints `tool-flyout-item-${tool.name}-${slugifyToolLabel(tool.label)}` with.
// It is imported rather than transcribed: a second copy in this file would pin itself, and
// an application-side change to the rule would then go unnoticed here.
//
// `toolbar-mapping.ts` sits at the repository root and reaches into `src/` through
// `import type` only, which is erased at runtime — so importing it does not pull app
// source into this Node-environment project (see the note in `vitest.e2e.config.ts`).
// Every label the application can put in a flyout item, walked out of `toolbarMap` so the
// list cannot go stale: `toolbarMap` is groups → flyout menus → tools, three levels deep.
const REAL_TOOL_LABELS: string[] = toolbarMap.flatMap((group) =>
  group.flatMap((menu) => menu.map((tool) => tool.label))
);

// The labels the suite passes to the slug-consuming helpers:
// `e2e/levels.spec.ts:86,128` and `e2e/sidebar-flyout.spec.ts:73,86`. They are a subset
// of REAL_TOOL_LABELS; they are listed separately because those are the three paths an
// e2e run actually exercises end to end.
const SUITE_FLYOUT_LABELS = ['Levels', 'Pencil Tool', 'Ellipse Tool'];

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

      it('matches a mapped display name case-insensitively', () => {
        expect(resolveToolName('Select & Move')).toBe('reposition');
        expect(resolveToolName('SELECT & MOVE')).toBe('reposition');
        expect(resolveToolName('select & move')).toBe('reposition');
        expect(resolveToolName('SeLeCt & MoVe')).toBe('reposition');
      });

      it('matches a map entry added after module load, case-insensitively', () => {
        // A lowercased index would have been built at module load and would miss this,
        // so the lookup scans the map's own keys instead of caching them.
        TOOL_NAME_MAP['Crop & Slice'] = 'Crop Tool';
        try {
          expect(resolveToolName('crop & SLICE')).toBe('crop-tool');
        } finally {
          delete TOOL_NAME_MAP['Crop & Slice'];
        }
      });

      it('does not let the case-insensitive lookup reach an inherited member', () => {
        expect(resolveToolName('CONSTRUCTOR')).toBe('constructor');
        expect(resolveToolName('__PROTO__')).toBe('proto');
        expect(resolveToolName('TOSTRING')).toBe('tostring');
      });

      it('passes through a differently cased name that is not a mapped key', () => {
        // 'select and move' spells the word out, so it is not the key 'Select & Move':
        // the whole key is compared, not a normalized form of it.
        expect(resolveToolName('select and move')).toBe('select-and-move');
        expect(resolveToolName('BRUSH TOOL')).toBe('brush-tool');
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

      it.each(INHERITED_NAME_CASES)(
        'normalizeToolName and generateSlug(%j) do not throw',
        ({ input, expected, slugExpected }) => {
          expect(() => normalizeToolName(input)).not.toThrow();
          expect(normalizeToolName(input)).toBe(expected);
          expect(() => generateSlug(input)).not.toThrow();
          expect(generateSlug(input)).toBe(slugExpected);
        }
      );

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

      it('leaves a trailing separator run as a dash, the way the application does', () => {
        // The app does not trim, so the id it mints ends in a dash. An earlier version
        // pinned 'item' here — a slug the app cannot produce for this label.
        expect(generateSlug('Item @#$%')).toBe('item-');
      });

      it('handles numbers', () => {
        expect(generateSlug('Tool 2')).toBe('tool-2');
      });

      it('keeps leading and trailing separator runs as dashes, the way the application does', () => {
        // '-my-label-', not 'my-label': the run on each side is a run.
        expect(generateSlug('  My Label  ')).toBe('-my-label-');
      });

      it('returns an empty string for an empty label', () => {
        expect(generateSlug('')).toBe('');
      });

      it('collapses an ampersand into the surrounding run instead of spelling it out', () => {
        // normalizeToolName would answer 'color-and-tone'. The app mints 'color-tone',
        // because ' & ' is one run of non-alphanumeric characters.
        expect(generateSlug('Color & Tone')).toBe('color-tone');
        expect(generateSlug('R&B')).toBe('r-b');
        expect(generateSlug('A && B')).toBe('a-b');
      });

      it('is compared against the application rule for every real toolbar label', () => {
        // The tripwire is the it.each below: the helper keeps its own copy of the rule so
        // that the comparison is not a tautology. Change one side alone and it goes red.
        // This case only fails if the label set itself stops being read, which would
        // silently turn the 28 real cases above into zero.
        expect(REAL_TOOL_LABELS.length).toBeGreaterThan(0);
        expect(REAL_TOOL_LABELS).toContain('Levels');
      });

      it.each(REAL_TOOL_LABELS)('reproduces the application slug for the real toolbar label %j', (label) => {
        expect(generateSlug(label)).toBe(slugifyToolLabel(label));
      });

      it.each(SUITE_FLYOUT_LABELS)('reproduces the application slug for the suite label %j', (label) => {
        expect(generateSlug(label)).toBe(slugifyToolLabel(label));
      });

      it.each(SUITE_FLYOUT_LABELS)(
        'happens to agree with normalizeToolName for the suite label %j, which is why no spec moves',
        (label) => {
          // A property of these three labels — none carries '&' or edge punctuation — not
          // a rule. 'Color & Tone' above is the counterexample.
          expect(generateSlug(label)).toBe(normalizeToolName(label));
        }
      );

      it('FlyoutItem interface has toolName and label string fields', () => {
        expectTypeOf<FlyoutItem>().toEqualTypeOf<{
          toolName: string;
          label: string;
        }>();
      });
    });
  });

  // The regression: Playwright scrolls a target into view before clicking it, and the left
  // toolbar is 1177px tall inside a 720px window, so a tool click drags the page 440px
  // down. Every spec that measures the canvas afterwards then gets `y: -340` where it used
  // to get `y: 100`, and 19 of them failed. A tool click has to mean "this tool is active"
  // and nothing else, so these pin that the window is where the caller left it.
  describe('window scroll across a toolbar click', () => {
    it('puts the window back when the click scrolled it to reach the button', async () => {
      const dom = createFakeDom({ scrollOnClick: true });
      dom.add({ testId: 'tool-button-draw' });

      await clickToolButton(dom.page, 'draw');

      // The click scrolled the window to 440 and the helper put it back to 0, in that order.
      expect(dom.scrollRequests()).toEqual([
        { x: 0, y: SCROLLED_BY_CLICK },
        { x: 0, y: 0 },
      ]);
      expect(dom.windowScroll()).toEqual({ x: 0, y: 0 });
    });

    it('asks the window to return to where the caller had it, not to the top of the page', async () => {
      const dom = createFakeDom({ scrollOnClick: true });
      dom.add({ testId: 'tool-button-draw' });
      await dom.page.evaluate(() => window.scrollTo(120, 300));
      dom.add({ testId: 'tool-button-brush' });

      await clickToolButton(dom.page, 'draw');

      expect(dom.windowScroll()).toEqual({ x: 120, y: 300 });
      expect(dom.scrollRequests().at(-1)).toEqual({ x: 120, y: 300 });
    });

    it('restores the window on the role fallback too, which is a different locator', async () => {
      const dom = createFakeDom({ scrollOnClick: true });
      // The role fallback is reached only when the testid is absent, and this is the label
      // as the caller wrote it. Which spelling of `&` is searched is pinned in the
      // `clickToolButton` block below; this one is about the scroll, not the match.
      dom.add({ name: 'Select & Move' });

      await clickToolButton(dom.page, 'Select & Move');

      expect(dom.windowScroll()).toEqual({ x: 0, y: 0 });
    });

    it('restores the window after a flyout selection', async () => {
      const dom = createFakeDom({ scrollOnClick: true });
      const menu = dom.add({ role: 'menu', visible: false });
      dom.add({ testId: 'tool-button-brush' }, menu);
      dom.add({ testId: 'tool-flyout-item-pencil-pencil-tool' }, menu);
      menu.visible = true;

      await selectFromFlyout(dom.page, { toolName: 'pencil', label: 'Pencil Tool' });

      expect(dom.windowScroll()).toEqual({ x: 0, y: 0 });
    });

    it('restores the window after the layout toggle', async () => {
      const dom = createFakeDom({ scrollOnClick: true });
      dom.add({ testId: 'toolbar-layout-toggle' });

      await toggleToolbarLayout(dom.page);

      expect(dom.windowScroll()).toEqual({ x: 0, y: 0 });
    });

    it('leaves the window alone when the click did not move it', async () => {
      const dom = createFakeDom();
      dom.add({ testId: 'tool-button-draw' });

      await clickToolButton(dom.page, 'draw');

      // The click never moved the window, so the only request is the restore back to the
      // position it was already at — one write, not the two the scrolled case needs. That
      // difference is what tells this apart from "the click moved and the restore worked".
      expect(dom.scrollRequests()).toEqual([{ x: 0, y: 0 }]);
    });

    it('still throws when the tool does not exist, rather than swallowing the lookup failure', async () => {
      const dom = createFakeDom({ scrollOnClick: true });

      await expect(clickToolButton(dom.page, 'draw')).rejects.toThrow(/no clickable button found/);
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

    it('finds a button whose accessible name keeps the ampersand as written', async () => {
      // The regression. The raw caller-supplied name was one of the three fallback
      // candidates, and every candidate had `&` expanded in place, so `Select & Move` was
      // only ever searched as `Select and Move` — a pattern that cannot match a button
      // labelled `Select & Move`. The candidate existed and was dead.
      const dom = createFakeDom();
      const ampersandButton = dom.add({ testId: 'legacy-ampersand', name: 'Select & Move' });

      await clickToolButton(dom.page, 'Select & Move');

      expect(dom.clicked).toEqual([ampersandButton]);
      // Asserted on the FIRST pattern rather than only on the element that ended up
      // clicked, so a regression is attributed to the ordering of the two attempts
      // instead of hiding behind the expanded fallback that still succeeds.
      const first = dom.mocks.getByRole.mock.calls[0][1];
      const firstPattern = first?.name as RegExp;
      expect(firstPattern.test('Select & Move')).toBe(true);
      expect(firstPattern.test('Select and Move')).toBe(false);
    });

    it('still finds the legacy label that spells the ampersand out', async () => {
      // The other half, and the reason the fix is two attempts rather than one: expanding
      // in place is what broke the literal label, but the expanded spelling is a label that
      // really exists in the wild and dropping it would be a regression of its own.
      const dom = createFakeDom();
      const expandedButton = dom.add({ testId: 'legacy-expanded', name: LEGACY_SELECT_AND_MOVE_LABEL });

      await clickToolButton(dom.page, 'Select & Move');

      expect(dom.clicked).toEqual([expandedButton]);
    });

    it("prefers the caller's own spelling when a button carries each one", async () => {
      // Added first, so an expansion-first order would find it and this would go red. The
      // order is the contract: the name the caller asked for is the more specific match.
      const dom = createFakeDom();
      const expandedButton = dom.add({ testId: 'legacy-expanded', name: LEGACY_SELECT_AND_MOVE_LABEL });
      const ampersandButton = dom.add({ testId: 'legacy-ampersand', name: 'Select & Move' });

      await clickToolButton(dom.page, 'Select & Move');

      expect(dom.clicked).toEqual([ampersandButton]);
      expect(dom.clicked).not.toContain(expandedButton);
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

    it('resolves a differently cased display name to the mapped testid', async () => {
      const dom = createFakeDom();
      const button = dom.add({ testId: 'tool-button-reposition' });

      await clickToolButton(dom.page, 'select & move');

      expect(dom.mocks.getByTestId).toHaveBeenCalledWith('tool-button-reposition');
      expect(dom.clicked).toEqual([button]);
    });

    it.each(REGEX_METACHARACTER_CASES)(
      'treats the accessible name %j as data, not as a pattern',
      async ({ name, decoy }) => {
        const dom = createFakeDom();
        // The decoy is added first, so an unescaped pattern that matched it would
        // click it and leave the real button untouched.
        const decoyButton = dom.add({ testId: 'legacy-decoy', name: decoy });
        const target = dom.add({ testId: 'legacy-target', name });

        await clickToolButton(dom.page, name);

        // Asserted on the pattern itself, not only on the element that ended up
        // clicked, so a regression is attributed to the selector instead of to the
        // order of the fallback candidates.
        const options = dom.mocks.getByRole.mock.calls[0][1];
        expect(options?.name).toBeInstanceOf(RegExp);
        const pattern = options?.name as RegExp;
        expect(pattern.test(name)).toBe(true);
        expect(pattern.test(decoy)).toBe(false);
        // Control: the unescaped form is what the defect searched for, so this decoy
        // is a real tripwire rather than a name the old pattern also ignored.
        expect(new RegExp(name).test(decoy)).toBe(true);
        expect(dom.clicked).toEqual([target]);
        expect(dom.clicked).not.toContain(decoyButton);
      }
    );

    it('constructs a pattern from C:\\Tool without throwing, and pins what it then matches', () => {
      // An earlier comment here claimed `C:\\Tool` "throws on construction". It does not:
      // `\T` is an Annex B IdentityEscape, so the pattern builds and then matches `C:Tool`
      // — a name the caller never asked for — while failing to match its own literal name.
      // The `u` flag is the only thing that makes this a SyntaxError. Pinned here so the
      // doc comment on `escapeRegExp` cannot drift back into claiming otherwise.
      const unescaped = new RegExp('C:\\Tool');

      expect(() => new RegExp('C:\\Tool')).not.toThrow();
      expect(unescaped.test('C:\\Tool')).toBe(false);
      expect(unescaped.test('C:Tool')).toBe(true);
      // eslint-disable-next-line no-invalid-regexp -- the invalidity is the assertion: only `u` makes this a SyntaxError
      expect(() => new RegExp('C:\\Tool', 'u')).toThrow(SyntaxError);

      // The escaped form the helper actually builds, which does match itself.
      expect(new RegExp('C:\\\\Tool', 'i').test('C:\\Tool')).toBe(true);
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
      const button = dom.add({ testId: 'tool-button-reposition' });
      // `aria-expanded` is set from `openGroup === groupIndex` on the pressed tile, so the
      // tile turns it on as its flyout opens. It is the only thing that distinguishes
      // "this group is open" from "some group is open".
      button.onLongPress = () => {
        menu.visible = true;
        button.attributes['aria-expanded'] = 'true';
      };

      await openToolFlyout(dom.page, 'Select & Move');

      expect(menu.visible).toBe(true);
      expect(dom.dispatched.map((event) => event.element)).toEqual([button, button]);
      expect(dom.dispatched.map((event) => event.type)).toEqual(['pointerdown', 'pointerup']);
      expect(dom.dispatched.map((event) => event.options)).toEqual([{ button: 0 }, { button: 0 }]);
      expect(dom.mocks.waitForTimeout).not.toHaveBeenCalled();
    });

    it('spends the shared timeout on the expanded wait, and the shared timeout has a floor', async () => {
      // Two separate claims, and the second is the one that catches a change.
      //
      // Consistency: the wait is handed the EXPORTED constant rather than a literal of its
      // own, so the helper, `paint-tools.spec.ts` and this file cannot drift apart — which
      // is the whole reason the constant is exported.
      //
      // Floor: importing the constant means it cannot pin its own value, because the
      // assertion would move with it. A restated literal would pin the value but reintroduce
      // the two-literal hazard, and the value is not the contract. The contract is that the
      // budget is big enough for a busy main thread: this wait is the entire margin the
      // gesture has, since `onPointerUp` cancels the open outright, so too small a budget
      // fails a gesture that would have worked. Measured here as a bound, which is what
      // catches 2000 -> 200 without restating 2000.
      const dom = createFakeDom();
      const { menu } = addFlyout(dom, [{ testId: flyoutItemTestId('levels', 'Levels') }], { visible: false });
      const button = dom.add({ testId: 'tool-button-reposition' });
      button.onLongPress = () => {
        menu.visible = true;
        button.attributes['aria-expanded'] = 'true';
      };

      await openToolFlyout(dom.page, 'Select & Move');

      const wait = attributeChecks.find((check) => check.name === 'aria-expanded');
      expect(wait?.expected).toBe('true');
      expect(wait?.options).toEqual({ timeout: FLYOUT_VISIBLE_TIMEOUT_MS });
      expect(FLYOUT_VISIBLE_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
    });

    it('lifts only after the flyout is open, so a late timer cannot cancel the open', async () => {
      // The regression this pins: the old helper slept a hard 350ms and then lifted,
      // against a 300ms timer with 50ms of margin. A pointerup that arrives first calls
      // `clearLongPressFlyout()`, so on a busy main thread the lift cancelled the open and
      // the flyout never appeared — surfacing as a `toBeVisible()` timeout on a menu that
      // had not been opened yet, which reads as a product defect rather than a bad helper.
      const dom = createFakeDom();
      const { menu } = addFlyout(dom, [{ testId: flyoutItemTestId('levels', 'Levels') }], { visible: false });
      const button = dom.add({ testId: 'tool-button-reposition' });
      button.onLongPress = () => {
        menu.visible = true;
        button.attributes['aria-expanded'] = 'true';
      };

      await openToolFlyout(dom.page, 'Select & Move');

      // The lift is the second dispatch, and the open is recorded before it: the timer had
      // already fired by the time the pointer went up.
      const openIndex = dom.dispatched.findIndex((event) => event.type === 'pointerup');
      expect(openIndex).toBe(1);
      expect(menu.visible).toBe(true);
      expect(button.settle).toBeNull();
    });

    it('leaves the flyout open after the lift, because onPointerUp never closes it', async () => {
      const dom = createFakeDom();
      const { menu } = addFlyout(dom, [{ testId: flyoutItemTestId('levels', 'Levels') }], { visible: false });
      const button = dom.add({ testId: 'tool-button-reposition' });
      button.onLongPress = () => {
        menu.visible = true;
        button.attributes['aria-expanded'] = 'true';
      };

      await openToolFlyout(dom.page, 'Select & Move');

      expect(menu.visible).toBe(true);
    });

    it('gives up when the tile never reports its flyout as expanded', async () => {
      const dom = createFakeDom();
      addFlyout(dom, [{ testId: flyoutItemTestId('levels', 'Levels') }], { visible: false });
      // No `onLongPress`, so nothing ever sets `aria-expanded` and the wait must reject
      // rather than sleep through and return as if the flyout were open.
      dom.add({ testId: 'tool-button-reposition' });

      await expect(openToolFlyout(dom.page, 'Select & Move')).rejects.toThrow(/aria-expanded/);
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
