import { describe, it, expect, vi, beforeEach, expectTypeOf } from 'vitest';
import type { Mock } from 'vitest';
import type { Page } from '@playwright/test';
import { createScrollModel } from './canvas-helpers.fixtures';
import { slugifyToolLabel, toolbarMap } from '../../../toolbar-mapping.ts';
import {
  FLYOUT_VISIBLE_TIMEOUT_MS,
  // The helper's mirror of the app's own threshold. Imported so the fake below can be
  // pinned against the value it is modeling, and so a third literal never appears here.
  LONG_PRESS_DELAY_MS,
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

const {
  playwrightExpect,
  visibilityChecks,
  hiddenChecks,
  textChecks,
  accessibleNameChecks,
  attributeChecks,
  pollClock,
} = vi.hoisted(() => {
  type Target = {
    __elements: Array<{
      visible: boolean;
      focused: boolean;
      testId: string | null;
      text: string;
      attributes: Record<string, string>;
    }>;
  };
  type Check = { target: Target; options?: { timeout?: number } };

  // The bindings below are returned to names declared on the outer scope, so the
  // locals are spelled differently: shadowing them would make every recorded check
  // ambiguous about which array it lands in.
  const recordedVisibilityChecks: Check[] = [];
  const recordedHiddenChecks: Check[] = [];
  const recordedTextChecks: Array<{ target: Target; expected: string }> = [];
  const recordedAccessibleNameChecks: Array<{ target: Target; expected: string }> = [];
  const recordedAttributeChecks: Array<{
    target: Target;
    name: string;
    value: string;
    options?: { timeout?: number };
  }> = [];

  // Playwright's `expect(...).toHaveAttribute()` polls until the attribute matches or the
  // timeout is spent. A fake cannot sleep, so it advances the modeled clock instead. That
  // is load-bearing rather than decorative: advancing the clock is what lets a long-press
  // TIMER come due while the assertion is polling, which is precisely the condition a
  // helper that sleeps instead of polling cannot survive.
  const pollStepMs = 25;
  const poller = { advance: (_ms: number) => {} };

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
    // The accessible name, which for every tool tile in this app is its `aria-label` and NOT
    // its text: a tile draws an icon, so there is no text in it to match. Recorded separately
    // from `textChecks` so a test can prove which of the two a helper asked for — a helper that
    // silently downgrades to a text check against a collapsed tool fails with `Received string: ""`,
    // which reads as an empty button rather than as a tool with no tile of its own.
    toHaveAccessibleName: vi.fn(async (expected: string) => {
      recordedAccessibleNameChecks.push({ target, expected });
      const name = (element: (typeof target.__elements)[number]) => element.attributes['aria-label'] ?? element.text;
      if (!target.__elements.some((element) => name(element) === expected)) {
        throw timedOut('toHaveAccessibleName', target);
      }
    }),
    toBeFocused: vi.fn(async (options?: { timeout?: number }) => {
      // Models browser focus as at most one element, so a stale `focused` flag on a
      // sibling cannot make a stale locator look focused.
      if (!target.__elements.some((element) => element.focused)) {
        throw timedOut('toBeFocused', target, options?.timeout);
      }
    }),
    toHaveAttribute: vi.fn(async (name: string, value: string, options?: { timeout?: number }) => {
      recordedAttributeChecks.push({ target, name, value, options });
      const matches = (): boolean => target.__elements.some((element) => element.attributes[name] === value);
      const budget = options?.timeout ?? 0;
      let spent = 0;
      while (!matches() && spent < budget) {
        const slice = Math.min(pollStepMs, budget - spent);
        poller.advance(slice);
        spent += slice;
      }
      if (!matches()) {
        throw timedOut(`toHaveAttribute(${name}, ${value})`, target, options?.timeout);
      }
    }),
  }));

  return {
    playwrightExpect: hoistedExpect,
    visibilityChecks: recordedVisibilityChecks,
    hiddenChecks: recordedHiddenChecks,
    textChecks: recordedTextChecks,
    accessibleNameChecks: recordedAccessibleNameChecks,
    attributeChecks: recordedAttributeChecks,
    pollClock: poller,
  };
});

vi.mock('@playwright/test', () => ({
  expect: playwrightExpect,
}));

// The app arms this timer on pointerdown and opens the flyout when it fires
// (`SidebarLeft.scheduleFlyoutOpen`, which exports it as `FLYOUT_LONG_PRESS_MS`).
// `LATE_TIMER_DELAY_MS` is not an app constant: it is the same timer arriving late, which is
// what a busy renderer main thread does to it. The old helper had to win a race against it
// with a 350ms sleep, so it lost on exactly this.
//
// This constant and the helper's `LONG_PRESS_DELAY_MS` are the SAME value written twice,
// because the `e2e` TypeScript project does not compile `src/` and cannot import the app's
// export. The assertion in `verifyHoverDoesNotOpenFlyout` below is what stops the two copies
// drifting apart, so it is load-bearing rather than decorative: change one and the other is
// free to become wrong, which is exactly what happened when the app's threshold moved to
// 250ms and this fake stayed at 300.
const LONG_PRESS_THRESHOLD_MS = 250;
const LATE_TIMER_DELAY_MS = 900;
const FLYOUT_CLOSE_TIMEOUT_MS = 1000;
// Derived from the threshold rather than written beside it: this is the helper's hover
// settle budget, and the helper itself computes its own as `LONG_PRESS_DELAY_MS + 100` from
// the same 100. Written as a literal it was a fourth copy of one number, and it was the copy
// that had to change when the threshold did.
const HOVER_SETTLE_MS = LONG_PRESS_THRESHOLD_MS + 100;

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
  /** How long this element's own long-press timer takes to fire. Only read when `onLongPress` is set. */
  longPressDelayMs: number;
  attributes: Record<string, string>;
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
  /** Model a timer that arrives late. Defaults to `LONG_PRESS_THRESHOLD_MS`. */
  longPressDelayMs?: number;
  attributes?: Record<string, string>;
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
  // `string | RegExp`, as Playwright's own `Page.getByTestId` is. The implementation below
  // always accepted both; the declared type was the narrower one, and it only became a type
  // error when a helper started passing a pattern — which it does, to address a flyout item
  // by the prefix of its id.
  getByTestId: Mock<(testId: string | RegExp) => MockLocator>;
  getByRole: Mock<(role: string, options?: { name?: RegExp | string }) => MockLocator>;
  waitForTimeout: Mock<(timeout: number) => Promise<void>>;
  keyboard: { press: Mock<(key: string) => Promise<void>> };
  evaluate: Mock<Page['evaluate']>;
};

/**
 * The offset Playwright's scroll-into-view produced when a toolbar button was clicked.
 *
 * A GUARD, not a measurement: it was read off the 1177px rail that made the page outgrow a
 * 720px window, and the rail no longer does — its tiles collapse into the three-dots tile
 * instead, so a tool click is now expected to scroll nothing and `scrollOnClick` models a
 * case the layout should not reach. It is kept, and kept at 440, because the rail retains
 * `overflow-y-auto` as a deliberate backstop: any layout that does grow the page brings back
 * a scroll nothing else undoes, across every spec at once. Do not re-derive it from the
 * current rail, and do not delete it with the rail that produced it.
 */
const SCROLLED_BY_CLICK = 440;

interface FakeDom {
  page: MockPage & Page;
  mocks: MockPage;
  add: (spec: FakeElementSpec, parent?: FakeElement) => FakeElement;
  /** Every element added to this fake, in insertion order. */
  elements: FakeElement[];
  clicked: FakeElement[];
  activated: FakeElement[];
  dispatched: Array<{ element: FakeElement; type: string; options?: Record<string, unknown> }>;
  /**
   * One entry per dispatched pointer event, recording whether that tile's flyout was ALREADY
   * open at the instant the event was delivered. This is how a test proves the helper waits
   * for the menu before lifting, rather than lifting on a timer and hoping.
   */
  pressState: Array<{ type: string; flyoutAlreadyOpen: boolean }>;
  /** Is a long-press timer armed right now? The app's `longPressFlyoutTimeoutRef !== null`. */
  timerPending: () => boolean;
  /** The app's `ignoreNextClickRef` — the swallow that a following real click consumes. */
  ignoreNextClick: () => boolean;
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
  const elements: FakeElement[] = [];

  let active: FakeElement | null = null;
  let elapsedMs = 0;
  // Time since the last pointerdown. The app measures its long press with a timer rather
  // than a hold duration, so this exists only to keep `hover` honest: a hover cannot open a
  // flyout that was never pressed, and a hover after a completed long press still can.
  let holdMs = 0;
  /**
   * The app's single pending long-press timer (`longPressFlyoutTimeoutRef`), which is why
   * this is one slot and not one per element: `scheduleFlyoutOpen` clears any previous
   * timer before arming its own.
   *
   * Modeling it as a real pending timer — armed by pointerdown, fired by the clock reaching
   * it, CANCELLED by pointerup — is what makes this fake able to express the production
   * defect. Resolving the long press synchronously inside pointerup, as this fake used to,
   * cannot fail: there is no instant at which a pointerup can destroy a pending open, and
   * a helper that sleeps 350ms then lifts looks identical to one that waits for the menu.
   */
  let pendingTimer: { firesAtMs: number; element: FakeElement } | null = null;
  /** The app's `longPressOpenedRef`: did the timer fire, or is the press still pending? */
  let longPressOpened = false;
  /** The app's `ignoreNextClickRef`: set by pointerup after a completed long press. */
  let ignoreNextClick = false;
  /** What each dispatched pointer saw, so a test can assert what was true AT dispatch time. */
  const pressState: Array<{ type: string; flyoutAlreadyOpen: boolean }> = [];

  /** Whether this tile's flyout is currently open, as the app reports it on the button. */
  const isFlyoutOpen = (element: FakeElement): boolean => element.attributes['aria-expanded'] === 'true';

  const firePendingTimer = (): void => {
    if (pendingTimer === null) return;
    const { element } = pendingTimer;
    pendingTimer = null;
    longPressOpened = true;
    element.onLongPress?.();
  };

  /** Move the modeled clock forward, letting any timer that comes due fire on the way. */
  const advanceClock = (ms: number): void => {
    const target = elapsedMs + ms;
    while (pendingTimer !== null && pendingTimer.firesAtMs <= target) {
      elapsedMs = pendingTimer.firesAtMs;
      firePendingTimer();
    }
    elapsedMs = target;
    holdMs += ms;
  };

  // The hoisted `expect` polls by advancing this clock. It is reassigned per fake so that
  // concurrent fakes cannot disturb each other; a test drives exactly one at a time.
  pollClock.advance = advanceClock;

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
    longPressDelayMs: spec.longPressDelayMs ?? LONG_PRESS_THRESHOLD_MS,
    attributes: { ...(spec.attributes ?? {}) },
    throwOnDispatch: spec.throwOnDispatch ?? null,
  });

  const root = createElement({ role: 'document' });

  function add(spec: FakeElementSpec, parent: FakeElement = root): FakeElement {
    const element = createElement(spec);
    element.parent = parent;
    parent.children.push(element);
    elements.push(element);
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
    // A real `.click()` is a pointerdown followed by pointerup and click. The app's
    // `onPointerDown` clears `ignoreNextClickRef` on every press, which is what stops the
    // ignore left behind by a long press from swallowing the next real click on that tile.
    ignoreNextClick = false;
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
   * Mirrors the app's `onPointerDown` / `onPointerUp` pair.
   *
   * pointerdown arms the timer and clears both refs; pointerup clears the timer
   * UNCONDITIONALLY and, only when the timer had already fired, sets `ignoreNextClickRef`.
   * That unconditional clear is the defect's whole mechanism: a pointerup arriving before the
   * timer fires cancels the open, so the flyout never appears and nothing that waits
   * afterwards can bring it back.
   */
  function dispatchEvent(element: FakeElement, type: string, options?: Record<string, unknown>): void {
    dispatched.push({ element, type, options });
    if (element.throwOnDispatch === type) {
      throw new Error(`dispatchEvent('${type}') failed on ${element.testId ?? element.role}`);
    }
    if (type === 'pointerdown') {
      holdMs = 0;
      ignoreNextClick = false;
      longPressOpened = false;
      // A real click still clears the flag: this is why a later `clickToolButton` on the
      // same tile is not swallowed by the ignore left behind from a long press.
      pendingTimer = element.onLongPress ? { firesAtMs: elapsedMs + element.longPressDelayMs, element } : null;
      pressState.push({ type, flyoutAlreadyOpen: isFlyoutOpen(element) });
      return;
    }
    if (type === 'pointerup') {
      pressState.push({ type, flyoutAlreadyOpen: isFlyoutOpen(element) });
      if (element.onLongPress) {
        // `clearLongPressFlyout()` — unconditional, which is the point.
        pendingTimer = null;
        if (longPressOpened) ignoreNextClick = true;
        longPressOpened = false;
      }
    }
  }

  function locatorFor(matches: FakeElement[]): MockLocator {
    const primary = (): FakeElement | undefined => matches[0];
    const locator: MockLocator = {
      __elements: matches,
      click: vi.fn(async (options?: { button?: string }) => {
        const element = primary();
        if (element) clickElement(element, options);
        // Playwright scrolls a target into view before clicking it. It used to do so for
        // real — the left rail was 1177px tall in a 720px window, so a click on a tool near
        // the bottom of it landed with the window at 440, which is what `preservingScroll`
        // exists to undo. The rail now fits by collapsing tiles, so this models the
        // backstop rather than the expected case, and every test that sets `scrollOnClick`
        // is proving the restore still works if the layout ever outgrows the window again.
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
        // A hover is not a press: the app opens a flyout from a timer armed by pointerdown,
        // so this only reaches one when a press already ran long enough to complete.
        if (element.onLongPress && holdMs >= LONG_PRESS_THRESHOLD_MS) {
          holdMs = 0;
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
      advanceClock(timeout);
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
    elements,
    clicked,
    activated,
    dispatched,
    pressState,
    timerPending: () => pendingTimer !== null,
    ignoreNextClick: () => ignoreNextClick,
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

/**
 * The three-dots tile and the flyout it opens, wired the way the app wires it: a right-click
 * calls the same `openFlyout` the long press reaches, and the menu lists TOOLS in map order
 * (`overflowTools` pushes `...group` for every collapsed group), so each item carries the id
 * the app mints for it and nothing else.
 */
function addOverflowTile(
  dom: FakeDom,
  tools: ReadonlyArray<{ readonly name: string; readonly label: string }>
): { tile: FakeElement; menu: FakeElement; items: FakeElement[] } {
  const { menu, items } = addFlyout(
    dom,
    tools.map((tool) => ({ testId: flyoutItemTestId(tool.name, tool.label) })),
    { visible: false }
  );
  const tile = dom.add({
    testId: 'tool-overflow-tile',
    onContextMenu: () => {
      menu.visible = true;
    },
  });
  return { tile, menu, items };
}

/**
 * Every tool the app can put in a flyout, in the order it lists them, taken from
 * `toolbarMap` rather than transcribed — a fixture that listed its own names would agree with
 * the helper by construction, which is the failure the existing `REAL_TOOL_LABELS` comment
 * above already warns about for the slug rule.
 */
const TOOLBAR_TOOLS: ReadonlyArray<{ readonly name: string; readonly label: string }> = toolbarMap.flatMap((group) =>
  group.flatMap((menu) => menu.map((tool) => ({ name: tool.name, label: tool.label })))
);

function visibilityCheckFor(element: FakeElement): { options?: { timeout?: number } } | undefined {
  return visibilityChecks.find((check) => check.target.__elements[0] === element);
}
function attributeCheckFor(
  element: FakeElement
): { name: string; value: string; options?: { timeout?: number } } | undefined {
  const check = attributeChecks.find((entry) => entry.target.__elements[0] === element);
  // The locator is dropped on purpose: a test asserting on it would be asserting on the fake.
  return check && { name: check.name, value: check.value, options: check.options };
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
// `e2e/paint-options.spec.ts:98`, `e2e/paint-tool-pixels.spec.ts:276` and
// `e2e/sidebar-flyout.spec.ts:387`. They are a subset of REAL_TOOL_LABELS; they are listed
// separately because those are three paths an e2e run actually exercises end to end.
//
// `'Levels'` was here and is not any more: `levels` is an `Image ▸ Adjustments` command, so
// it has no rail group and its `tool-flyout-item-levels-…` id is no longer minted by
// anything. The three-dots/flyout path is not where that tool is reached from any more, so
// there is no flyout label of its to compare.
const SUITE_FLYOUT_LABELS = ['Brush Tool', 'Pencil Tool', 'Ellipse Tool'];

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
    // Recorded alongside the text checks and reset with them: they are asserted by COUNT, and a
    // count left over from the previous test turns "asked for the wrong primitive" into a
    // number that happens to be non-zero for the wrong reason.
    accessibleNameChecks.length = 0;
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
        // silently turn the real cases above into zero. Named rather than counted, because
        // the count is a property of `toolbarMap` and rots every time a group changes — the
        // last pin on it was a `'Levels'` that outlived the group holding it.
        expect(REAL_TOOL_LABELS.length).toBeGreaterThan(0);
        expect(REAL_TOOL_LABELS).toContain('Brush Tool');
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
    /**
     * Builds grouped tiles whose long-press timers open THEIR OWN flyout, the way the app
     * does: the timer sets `openGroup`, so exactly one group is open — the pressed tile
     * reports `aria-expanded="true"` and its own `role="menu"` is the one that is visible.
     *
     * `tileGroup()` returns a builder with its own registry, because "exactly one flyout at
     * a time" is the property these tests turn on and it must not leak between tests.
     */
    const tileGroup = () => {
      const tiles: Array<{ button: FakeElement; menu: FakeElement }> = [];
      return (
        dom: FakeDom,
        options: { testId: string; delayMs?: number }
      ): { button: FakeElement; menu: FakeElement } => {
        const { menu } = addFlyout(dom, [{ testId: flyoutItemTestId('levels', 'Levels') }], { visible: false });
        const button = dom.add({
          testId: options.testId,
          longPressDelayMs: options.delayMs,
          onLongPress: () => {
            for (const tile of tiles) {
              const isOpen = tile.button === button;
              tile.button.attributes['aria-expanded'] = isOpen ? 'true' : 'false';
              tile.menu.visible = isOpen;
            }
          },
        });
        tiles.push({ button, menu });
        return { button, menu };
      };
    };

    it('opens the flyout with a long press', async () => {
      const groupedTile = tileGroup();
      const dom = createFakeDom();
      const { button, menu } = groupedTile(dom, { testId: 'tool-button-reposition' });

      await openToolFlyout(dom.page, 'Select & Move');

      expect(menu.visible).toBe(true);
      expect(dom.dispatched.map((event) => event.element)).toEqual([button, button]);
      expect(dom.dispatched.map((event) => event.type)).toEqual(['pointerdown', 'pointerup']);
      expect(dom.dispatched.map((event) => event.options)).toEqual([{ button: 0 }, { button: 0 }]);
      expect(attributeCheckFor(button)).toEqual({
        name: 'aria-expanded',
        value: 'true',
        options: { timeout: FLYOUT_VISIBLE_TIMEOUT_MS },
      });
      // The post-lift menu assertion is the OTHER half of the contract, and the attribute
      // check above cannot see it: `aria-expanded` is set one commit before the portal
      // exists, so a helper that only waited for the attribute would return with no menu
      // on screen. Recorded on the menu, with the shared budget, which is the file's own
      // idiom — `openToolFlyoutViaRightClick`'s test asserts exactly this shape.
      expect(visibilityCheckFor(menu)?.options).toEqual({ timeout: FLYOUT_VISIBLE_TIMEOUT_MS });
    });

    it('never sleeps for a fixed delay, because a fixed delay is the race itself', async () => {
      const groupedTile = tileGroup();
      const dom = createFakeDom();
      groupedTile(dom, { testId: 'tool-button-reposition' });

      await openToolFlyout(dom.page, 'Select & Move');

      expect(dom.mocks.waitForTimeout).not.toHaveBeenCalled();
    });

    it('lifts only after the flyout is open, never before', async () => {
      const groupedTile = tileGroup();
      const dom = createFakeDom();
      // A late timer is what makes this an ORDERING pin rather than a restatement of the
      // happy path: at the app's own 300ms a helper that sleeps 350ms also happens to lift
      // after the menu opened, so only a timer that is still pending at lift time can tell
      // "waited for the menu" apart from "slept long enough and got lucky".
      groupedTile(dom, { testId: 'tool-button-reposition', delayMs: LATE_TIMER_DELAY_MS });

      await openToolFlyout(dom.page, 'Select & Move');

      // This records the flyout's state at each pointer event, so the difference is visible
      // rather than inferred: a helper that sleeps and lifts dispatches pointerup while the
      // timer is still pending, and that is exactly the event that cancels the open.
      expect(dom.pressState).toEqual([
        { type: 'pointerdown', flyoutAlreadyOpen: false },
        { type: 'pointerup', flyoutAlreadyOpen: true },
      ]);
    });

    it('opens the flyout even when the long-press timer arrives late', async () => {
      const groupedTile = tileGroup();
      const dom = createFakeDom();
      // The same 300ms timer, delivered late — what a busy renderer main thread does to it.
      // The old helper slept a fixed 350ms and lifted, so this timer was still pending at the
      // pointerup and the open was cancelled: the flyout never appeared at all.
      const { button, menu } = groupedTile(dom, {
        testId: 'tool-button-reposition',
        delayMs: LATE_TIMER_DELAY_MS,
      });

      await openToolFlyout(dom.page, 'Select & Move');

      expect(menu.visible).toBe(true);
      expect(button.attributes['aria-expanded']).toBe('true');
      expect(dom.timerPending()).toBe(false);
    });

    it('opens the SECOND tile when a different flyout is already open', async () => {
      const groupedTile = tileGroup();
      const dom = createFakeDom();
      const first = groupedTile(dom, { testId: 'tool-button-reposition' });
      const second = groupedTile(dom, { testId: 'tool-button-shape' });
      await openToolFlyout(dom.page, 'Select & Move');
      expect(first.menu.visible).toBe(true);

      await openToolFlyout(dom.page, 'shape');

      // The hazard this guards: asserting "some `role=menu` is visible" is satisfied at once
      // by the still-open first flyout, so a helper could lift while the second tile's timer
      // was pending, cancelling it, and return with the wrong menu open.
      expect(second.menu.visible).toBe(true);
      expect(first.menu.visible).toBe(false);
      expect(second.button.attributes['aria-expanded']).toBe('true');
      expect(first.button.attributes['aria-expanded']).toBe('false');
    });

    it('leaves no timer armed once it returns', async () => {
      const groupedTile = tileGroup();
      const dom = createFakeDom();
      groupedTile(dom, { testId: 'tool-button-reposition', delayMs: LATE_TIMER_DELAY_MS });

      await openToolFlyout(dom.page, 'Select & Move');

      expect(dom.timerPending()).toBe(false);
    });

    it('does not swallow the click that follows a long press on the same tile', async () => {
      const groupedTile = tileGroup();
      const dom = createFakeDom();
      const { button } = groupedTile(dom, { testId: 'tool-button-reposition' });
      await openToolFlyout(dom.page, 'Select & Move');
      // The app sets `ignoreNextClickRef` after a completed long press; the pointerdown of the
      // next real click clears it. Without that, a later `clickToolButton` on this tile would
      // be swallowed and the spec would silently assert nothing.
      expect(dom.ignoreNextClick()).toBe(true);

      await clickToolButton(dom.page, 'Select & Move');

      expect(dom.clicked).toEqual([button]);
      expect(dom.ignoreNextClick()).toBe(false);
    });

    it('keeps the shared flyout budget above the long-press threshold it has to absorb', () => {
      // The contract is not the value 2000, it is that the budget is bigger than the
      // 300ms the app's timer needs on a busy main thread. This wait is the whole margin
      // the gesture has — `onPointerUp` cancels the pending open outright — so a budget
      // below the threshold fails a gesture that would otherwise have worked. Measured as
      // a bound, which is what catches 2000 -> 200 without restating 2000.
      expect(FLYOUT_VISIBLE_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
    });

    it('leaves the flyout open after the lift, because onPointerUp never closes it', async () => {
      const groupedTile = tileGroup();
      const dom = createFakeDom();
      const { menu } = groupedTile(dom, { testId: 'tool-button-reposition' });
      await openToolFlyout(dom.page, 'Select & Move');

      // `pressState` records what was true AT each pointer event, so this reads the claim
      // directly: the flyout was already open when the pointer went up, and it is still
      // open now that the helper has returned.
      expect(dom.pressState.at(-1)).toEqual({ type: 'pointerup', flyoutAlreadyOpen: true });
      expect(menu.visible).toBe(true);
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

    it('reports a timeout naming the tile when the flyout never opens', async () => {
      const dom = createFakeDom();
      dom.add({ testId: 'tool-button-reposition' }); // no onLongPress: this tile never opens one

      const error = await captureError(openToolFlyout(dom.page, 'Select & Move'));

      expect(error.message).toContain(`Timed out ${FLYOUT_VISIBLE_TIMEOUT_MS}ms`);
      expect(error.message).toContain('[testid="tool-button-reposition"]');
      expect(error.message).toContain('aria-expanded');
    });
  });

  /**
   * A tile the rail cannot fit is collapsed into the three-dots tile, and the tool then has
   * NO `tool-button-<name>` element at all. The whole point of the fallback under test is
   * that the ~26 specs calling these helpers do not learn that this is possible, so these
   * assert the collapse is invisible from the outside: same arguments, same promise, same
   * "this tool is now active" result.
   */
  describe('a tool that has collapsed into the three-dots tile', () => {
    const PENCIL = { name: 'pencil', label: 'Pencil Tool' };

    it('clicks the tile and never goes near the three-dots tile when the tool has one', async () => {
      const dom = createFakeDom();
      const button = dom.add({ testId: 'tool-button-brush' });
      const overflow = addOverflowTile(dom, [PENCIL]);

      await clickToolButton(dom.page, 'brush');

      expect(dom.clicked).toEqual([button]);
      // The three-dots tile is on this rail and was still never touched. A right-click on it
      // would have opened a flyout over the canvas the caller is about to measure, and the
      // tile's own click would have selected a tool nobody asked for.
      expect(dom.clicked).not.toContain(overflow.tile);
      expect(overflow.menu.visible).toBe(false);
    });

    it('opens the three-dots flyout and clicks the tool inside it', async () => {
      const dom = createFakeDom();
      const overflow = addOverflowTile(dom, [PENCIL]);

      await clickToolButton(dom.page, 'pencil');

      // Right-click, then the item: the tile answers `onContextMenu` the same way every other
      // tile does, and no pointer event is dispatched on the way there.
      expect(dom.clicked).toEqual([overflow.tile, overflow.items[0]]);
      expect(dom.dispatched).toEqual([]);
      // The app closes the flyout on the pick, so the helper returns with the tool active
      // and the menu gone — the same contract the tile path returns under.
      expect(overflow.menu.visible).toBe(false);
    });

    it('lands on the exact test id the app mints, for every tool in toolbarMap', async () => {
      // The slug half of the id is the app's own `slugifyToolLabel` applied to the label the
      // app shows, and this walks the real map so a respelled or renamed label cannot leave
      // the helper addressing an id the app no longer renders. The app's ids are unique per
      // (name, label), so landing on the right element is what pins the slug.
      for (const name of new Set(TOOLBAR_TOOLS.map((tool) => tool.name))) {
        const dom = createFakeDom();
        const overflow = addOverflowTile(dom, TOOLBAR_TOOLS);

        await clickToolButton(dom.page, name);

        // The FIRST tool in map order carrying this name, which is the app's own rule for
        // what a tile selects, and therefore what a collapsed tile stands in for. It is the
        // whole answer for `shape`, whose five figures share one name.
        const expected = overflow.items[TOOLBAR_TOOLS.findIndex((tool) => tool.name === name)];
        expect(dom.clicked).toEqual([overflow.tile, expected]);
      }
    });

    it('builds that id from the slug the app renders, stated as the id itself', () => {
      // The walk above proves the agreement; this makes it legible. `generateSlug` is the
      // helper's independent copy of the rule, so the two strings are computed by different
      // code and the assertion is between the app's output and what the helper clicked.
      const dom = createFakeDom();
      const overflow = addOverflowTile(dom, TOOLBAR_TOOLS);
      const pencil = overflow.items[TOOLBAR_TOOLS.findIndex((tool) => tool.name === 'pencil')];

      expect(pencil.testId).toBe('tool-flyout-item-pencil-pencil-tool');
      expect(pencil.testId).toBe(`tool-flyout-item-pencil-${generateSlug('Pencil Tool')}`);
      expect(pencil.testId).toBe(`tool-flyout-item-pencil-${slugifyToolLabel('Pencil Tool')}`);
      expect(dom.elements).toContain(pencil);
    });

    it('leaves the window where the caller had it on the collapsed path', async () => {
      const dom = createFakeDom({ scrollOnClick: true });
      addOverflowTile(dom, [PENCIL]);
      await dom.page.evaluate(() => window.scrollTo(120, 300));

      await clickToolButton(dom.page, 'pencil');

      // The item hangs off a tile at the truncation point, so it is a click that can scroll
      // exactly as a tool button click can — the backstop, not the expected case, and the
      // restore is unconditional either way.
      expect(dom.windowScroll()).toEqual({ x: 120, y: 300 });
    });

    it('does not open the three-dots tile when the rail has none', async () => {
      // A rail tall enough to show every tile has no three-dots tile, so nothing collapsed
      // and the legacy role fallback is all that is left. Without the `count()` guard on the
      // tile this would time out against a control that was never going to appear, and the
      // failure would name the wrong element.
      const dom = createFakeDom();
      const legacy = dom.add({ testId: 'legacy-brush', name: 'Brush Tool' });

      await clickToolButton(dom.page, 'brush');

      expect(dom.clicked).toEqual([legacy]);
      // The helper does ASK whether the three-dots tile is there — it has to, that is the
      // collapse check — and it asks with `count()` rather than by asserting visibility.
      // Nothing is asserted visible anywhere on this path, so there is nothing that could
      // have spent the flyout budget waiting for a tile that was never going to appear.
      expect(visibilityChecks).toEqual([]);
    });

    it('names the missing item rather than searching roles, when it is in neither place', async () => {
      // The three-dots menu is open and the tool is not in it, so the tool does not exist.
      // Falling through to the role search could only produce a less honest answer than the
      // timeout, which already names the element that was not there.
      const dom = createFakeDom();
      addOverflowTile(dom, [PENCIL]);

      const error = await captureError(clickToolButton(dom.page, 'clone-stamp'));

      expect(error.message).toContain('toBeVisible()');
      // No search by accessible name. `waitForFlyout`'s bare `role=menu` is not one: a name
      // pattern is the legacy fallback's only tool, and it is what a fall-through would use.
      expect(dom.mocks.getByRole.mock.calls.some(([, options]) => options?.name !== undefined)).toBe(false);
      // Asserted on the selector, because an empty locator names nothing: the timeout can
      // only say "no such element", and the element it looked for is what says which.
      const asked = dom.mocks.getByTestId.mock.calls.at(-1)?.[0];
      expect(asked).toBeInstanceOf(RegExp);
      expect((asked as RegExp).source).toBe('^tool-flyout-item-clone-stamp-');
    });

    it('opens the three-dots flyout from openToolFlyout, which has no tile to press', async () => {
      const dom = createFakeDom();
      const overflow = addOverflowTile(dom, [PENCIL]);

      await openToolFlyout(dom.page, 'pencil');

      // A long press is a gesture ON a tile, and there is no tile: nothing is dispatched at
      // all. The caller's own `selectFromFlyout` finds the tool in the menu left open, which
      // is how it already worked for a tile's own flyout.
      expect(dom.dispatched).toEqual([]);
      expect(dom.clicked).toEqual([overflow.tile]);
      expect(overflow.menu.visible).toBe(true);
      expect(visibilityCheckFor(overflow.menu)?.options).toEqual({ timeout: FLYOUT_VISIBLE_TIMEOUT_MS });
    });

    it('keeps the long press when the tool still has a tile, and never opens the overflow', async () => {
      const dom = createFakeDom();
      const { menu } = addFlyout(dom, [{ testId: flyoutItemTestId('levels', 'Levels') }], { visible: false });
      const button = dom.add({
        testId: 'tool-button-pencil',
        onLongPress: () => {
          button.attributes['aria-expanded'] = 'true';
          menu.visible = true;
        },
      });
      const overflow = addOverflowTile(dom, [PENCIL]);

      await openToolFlyout(dom.page, 'pencil');

      expect(dom.dispatched.map((event) => event.element)).toEqual([button, button]);
      expect(dom.clicked).toEqual([]);
      expect(overflow.menu.visible).toBe(false);
    });

    it('still fails on the button when a tile exists but is hidden', async () => {
      // Present and invisible is not collapsed. Collapsing is the absence of a tile, and
      // treating a hidden tile as collapsed would answer a different question than the one
      // the fallback asks.
      const dom = createFakeDom();
      dom.add({ testId: 'tool-button-pencil', visible: false });
      const overflow = addOverflowTile(dom, [PENCIL]);

      await expect(openToolFlyout(dom.page, 'pencil')).rejects.toThrow(/toBeVisible\(\)/);
      expect(dom.dispatched).toEqual([]);
      expect(dom.clicked).toEqual([]);
      expect(overflow.menu.visible).toBe(false);
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
    it("resolves on the tile's ACCESSIBLE NAME, which is its aria-label and not its text", async () => {
      // A tool tile draws an ICON, so there is no text in it to match: the label is an
      // `aria-label`. Asserting the text content instead cannot pass on any tile, and on the
      // three-dots tile it fails with `Received string: ""`, which reads as an empty button
      // rather than as the thing it is — a tool the rail folded away. So the primitive is the
      // accessible name, and the check is recorded separately to prove which was asked for.
      const dom = createFakeDom();
      const button = dom.add({
        testId: 'tool-button-reposition',
        text: '',
        attributes: { 'aria-label': 'Move Tool' },
      });

      await verifyPrimaryTool(dom.page, 'Select & Move', 'Move Tool');

      expect(accessibleNameChecks, 'the accessible name, not the text content').toHaveLength(1);
      expect(accessibleNameChecks[0].target.__elements).toEqual([button]);
      expect(accessibleNameChecks[0].expected).toBe('Move Tool');
      expect(textChecks, 'and never a text check').toHaveLength(0);
    });

    it('fails when the tile presents a different name', async () => {
      const dom = createFakeDom();
      dom.add({ testId: 'tool-button-reposition', text: '', attributes: { 'aria-label': 'Select & Move' } });

      await expect(verifyPrimaryTool(dom.page, 'Select & Move', 'Move Tool')).rejects.toThrow(/toHaveAccessibleName/);
    });

    it('says so plainly when the rail folded the tool away, instead of matching an empty tile', async () => {
      // The two e2e failures this replaces were both this one wearing a disguise: a
      // `toContainText` against the three-dots tile, which reported `Received string: ""` and
      // read as an empty button. A caller whose subject is a TOOL wants a reachability
      // assertion; one whose subject is the tile wants the window grown. The message names
      // which, because "it failed" does not tell the next reader what to do.
      const dom = createFakeDom();
      dom.add({ testId: 'tool-overflow-tile', text: '', attributes: { 'aria-label': 'More Tools' } });

      await expect(verifyPrimaryTool(dom.page, 'eyedropper', 'Eyedropper Tool')).rejects.toThrow(/no tile of its own/);
      await expect(verifyPrimaryTool(dom.page, 'eyedropper', 'Eyedropper Tool')).rejects.toThrow(/More Tools/);
      // And it must not have fallen through to a check it knows cannot pass.
      expect(textChecks).toHaveLength(0);
      expect(accessibleNameChecks).toHaveLength(0);
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
      // `LONG_PRESS_DELAY_MS` is the helper's mirror of the app's `setTimeout(...)` on
      // `FLYOUT_LONG_PRESS_MS` (`SidebarLeft.scheduleFlyoutOpen`), and `HOVER_SETTLE_MS` is what
      // `verifyHoverDoesNotOpenFlyout` ends up waiting for. Both are exported so this file
      // cannot hold a third copy of either number; these two assertions are what stop the
      // export from drifting away from the fake that models the app.
      expect(LONG_PRESS_DELAY_MS).toBe(LONG_PRESS_THRESHOLD_MS);
      expect(HOVER_SETTLE_MS).toBe(LONG_PRESS_DELAY_MS + 100);
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

  // Each it.fails tripwire asserts the behaviour we WANT but the helper does NOT yet deliver.
  // It stays green while the gap is open; the moment the guard lands and the assertion
  // starts passing, `it.fails` flips and reports an unexpected pass, which is the signal
  // to promote it to a plain `it`.
  describe('Edge Cases and Tripwires', () => {
    describe('Empty and whitespace-only tool names', () => {
      it('resolveToolName("") normalizes to an empty string', () => {
        expect(resolveToolName('')).toBe('');
      });

      it.each(['   ', '-', '--'])(
        'resolveToolName(%j) normalizes whitespace or separator-only names to an empty string',
        (name) => {
          expect(resolveToolName(name)).toBe('');
        }
      );

      it('getToolButton returns a zero-count locator for an empty tool name', async () => {
        const dom = createFakeDom();
        dom.add({ testId: 'tool-button-brush' });

        const locator = getToolButton(dom.page, '');

        expect(dom.mocks.getByTestId).toHaveBeenCalledWith('tool-button-');
        expect(await locator.count()).toBe(0);
      });

      it.fails('clickToolButton rejects an empty tool name instead of matching the first button', async () => {
        // An empty tool name normalizes to the test id `tool-button-`, which no element
        // carries, so the lookup correctly falls through to the role fallback. There the
        // name is still "" and escapeRegExp("") is "", so patternsFor builds RegExp("") —
        // an empty pattern that matches EVERY accessible name. The helper should reject
        // "" outright rather than silently clicking whatever tile happens to be first.
        const dom = createFakeDom();
        dom.add({ testId: 'tool-button-brush' });
        dom.add({ name: 'Legacy Button' });

        await expect(clickToolButton(dom.page, '')).rejects.toThrow(/no clickable button found for tool ""/);
      });

      it.fails('clickToolButton rejects a whitespace-only tool name for the same reason', async () => {
        const dom = createFakeDom();
        dom.add({ testId: 'tool-button-brush' });
        dom.add({ name: 'Legacy Button' });

        await expect(clickToolButton(dom.page, '   ')).rejects.toThrow(/no clickable button found for tool " {3}"/);
      });

      it.fails('openToolFlyout rejects an empty tool name instead of timing out on toBeVisible', async () => {
        // Unlike clickToolButton, openToolFlyout has no role fallback — it asserts
        // visibility directly. With "" it looks for `tool-button-` and times out, which
        // is a genuine failure but a poor one: the error names no tool, so the caller
        // cannot tell which name was wrong. A dedicated guard would name it.
        const dom = createFakeDom();
        dom.add({ testId: 'tool-button-brush' });

        await expect(openToolFlyout(dom.page, '')).rejects.toThrow(/no tile|empty tool name|not found/);
      });
    });

    describe('Invalid tool IDs with regex metacharacters', () => {
      it.each(['.*', '()', '^$', '{}', '+?', '[]'])(
        'resolveToolName(%j) normalizes a metacharacter-only name to an empty string',
        (name) => {
          expect(resolveToolName(name)).toBe('');
        }
      );

      it.each([
        { name: 'tool-button-brush', toolName: 'brush' },
        { name: 'tool-button-reposition', toolName: 'Select & Move' },
      ])('getToolButton queries by exact test id, not by prefix match ($name)', async ({ name, toolName }) => {
        const dom = createFakeDom();
        dom.add({ testId: name });
        dom.add({ testId: `${name}-extra` });

        const locator = getToolButton(dom.page, toolName);

        expect(await locator.count()).toBe(1);
      });
    });

    describe('Non-finite scroll coordinates', () => {
      it.fails('clamps NaN scroll coordinates before restoring the window', async () => {
        // preservingScroll reads the page scroll, runs the action, then writes the
        // captured position back with window.scrollTo. If the captured value is NaN —
        // which a real browser can return from window.scrollX/Y in edge cases — the
        // restore writes NaN and the window is left broken. The helper should clamp
        // non-finite values to 0 before writing them back.
        const dom = createFakeDom();
        dom.add({ testId: 'tool-button-brush' });
        await dom.page.evaluate(() => window.scrollTo(Number.NaN, Number.NaN));

        await clickToolButton(dom.page, 'brush');

        const { x, y } = dom.windowScroll();
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
      });

      it.fails('clamps Infinity scroll coordinates before restoring the window', async () => {
        const dom = createFakeDom();
        dom.add({ testId: 'tool-button-brush' });
        await dom.page.evaluate(() => window.scrollTo(Infinity, -Infinity));

        await clickToolButton(dom.page, 'brush');

        const { x, y } = dom.windowScroll();
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
      });
    });
  });
});
