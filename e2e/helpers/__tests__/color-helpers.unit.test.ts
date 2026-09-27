import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import type { Page } from '@playwright/test';
import { hexToRgb, setForegroundColor } from '../color-helpers';

const FOREGROUND_COLOR_INPUT_SELECTOR = '[data-testid="foreground-color-input"]';
const FOREGROUND_COLOR_SWATCH_SELECTOR = '[data-testid="foreground-color-swatch"]';
const OTHER_COLOR_INPUT_SELECTOR = '[data-testid="background-color-input"]';
const OTHER_COLOR_SWATCH_SELECTOR = '[data-testid="background-color-swatch"]';
const RED_HEX = '#ff0000';
const RED_SHORTHAND_HEX = '#f00';
const RED_RGB_CSS = 'rgb(255, 0, 0)';
const RED_CHANNEL_MAX = 255;
const GREEN_RGB_CSS = 'rgb(0, 128, 0)';
const NON_ERROR_EVALUATE_REJECTION = 'Target page, context or browser has been closed';
const MISSING_INPUT_MESSAGE = 'setForegroundColor: no HTMLInputElement matched [data-testid="foreground-color-input"]';
/**
 * Every serialisation of the same colour a browser is allowed to hand back for
 * a computed `background-color`. The comparison is per channel, so all of them
 * verify as red.
 */
const RED_COMPUTED_FORMS = [
  RED_RGB_CSS,
  'rgba(255, 0, 0, 0.5)',
  'rgb(255 0 0)',
  'rgb(255 0 0 / 50%)',
  'rgb(100% 0% 0%)',
  'color(srgb 1 0 0)',
  'color(srgb 1 0 0 / 0.5)',
  'color(srgb 100% 0% 0%)',
] as const;
// Approximation of real Playwright output, used only to assert error propagation.
const SWATCH_MISMATCH_MESSAGE =
  'expect.poll(received).toBe(expected)\n\nExpected: "#ff0000"\nReceived: "#008000"\n\nCall log: - polled 5 times';

type Rgb = ReturnType<typeof hexToRgb>;
type SwatchEvaluate = (pageFunction: (element: object) => string) => Promise<string>;
type SwatchHandle = { readonly selector: string; readonly evaluate: Mock<SwatchEvaluate> };
type AbsentLocator = {
  readonly absentSelector: string;
  readonly count: () => Promise<number>;
  readonly evaluate: SwatchEvaluate;
};
type LocatorMock = { readonly locator: Mock<(selector: string) => object>; readonly swatch: SwatchHandle };
type StubEvent = { readonly type: string; readonly bubbles?: boolean };
type InputStub = { readonly testId: string; readonly dispatchEvent: Mock<(event: StubEvent) => boolean> };
type InputPrototype = { value?: string };
type InputElementConstructor = { new (): object; prototype: InputPrototype };
type StubDomOptions = { readonly nonInputSelectors?: readonly string[] };
type MockPageParts = {
  evaluate: Page['evaluate'];
  locator?: (selector: string) => object;
};

const { mockExpect, mockPoll, mockPollAssertion } = vi.hoisted(() => {
  // The helper only reaches Playwright through `expect.poll`, so the stand-in is
  // a poll implementation plus the assertion it delegates to. The local names
  // differ from the destructured ones below on purpose: identical names would
  // be flagged as shadowing, and the outer bindings are not in scope yet.
  const pollAssertion = vi.fn<(received: string, expected: string) => void>();
  const poll = vi.fn((pollCallback: () => Promise<string> | string) => ({
    toBe: async (expected: string) => {
      pollAssertion(await pollCallback(), expected);
    },
  }));
  const expectStandIn = Object.assign(vi.fn<(subject: object) => object>(), { poll });
  return { mockExpect: expectStandIn, mockPoll: poll, mockPollAssertion: pollAssertion };
});

vi.mock('@playwright/test', () => ({
  expect: mockExpect,
}));

const createMockPage = (parts: MockPageParts): Page => parts as Page;

const SWATCH_ELEMENT = { selector: FOREGROUND_COLOR_SWATCH_SELECTOR };

/** Stands in for the missing-locator timeout the real `locator.evaluate` reports. */
const createAbsentLocator = (selector: string): AbsentLocator => ({
  absentSelector: selector,
  count: async () => 0,
  evaluate: () => Promise.reject(new Error(`Timed out waiting for locator('${selector}')`)),
});

const createLocatorMock = (
  publishedSelectors: readonly string[] = [FOREGROUND_COLOR_SWATCH_SELECTOR],
  computedBackgroundColor: string = RED_RGB_CSS
): LocatorMock => {
  const swatch: SwatchHandle = {
    selector: FOREGROUND_COLOR_SWATCH_SELECTOR,
    evaluate: vi.fn<SwatchEvaluate>(async (pageFunction) => {
      // The helper hands the page function a live element and reads
      // getComputedStyle from the window, so the stub supplies both and the real
      // extraction code is what runs here.
      vi.stubGlobal('window', { getComputedStyle: () => ({ backgroundColor: computedBackgroundColor }) });
      return pageFunction(SWATCH_ELEMENT);
    }),
  };
  const locator = vi.fn<(selector: string) => object>((selector: string) =>
    publishedSelectors.includes(selector) ? swatch : createAbsentLocator(selector)
  );
  return { locator, swatch };
};

const createResolvedEvaluate = (): Mock<Page['evaluate']> => vi.fn<Page['evaluate']>().mockResolvedValue(undefined);

const createRejectedEvaluate = (reason: unknown): Mock<Page['evaluate']> =>
  vi.fn<Page['evaluate']>().mockRejectedValue(reason);

const createRunningEvaluate = (): Mock<Page['evaluate']> => {
  const evaluate = vi.fn<Page['evaluate']>();
  evaluate.mockImplementation(async (...args) => {
    const [pageFunction, color] = args;
    if (typeof pageFunction !== 'function') {
      throw new Error('page.evaluate must receive a page function');
    }
    return pageFunction(color);
  });
  return evaluate;
};

const createInputStub = (testId: string): InputStub => ({
  testId,
  dispatchEvent: vi.fn<(event: StubEvent) => boolean>().mockReturnValue(true),
});

const createNativeValueSetterProbe = (): {
  prototype: InputPrototype;
  applied: { element: unknown; color: string }[];
} => {
  const applied: { element: unknown; color: string }[] = [];
  const prototype: InputPrototype = {};
  Object.defineProperty(prototype, 'value', {
    get: () => '',
    set(this: unknown, color: string) {
      applied.push({ element: this, color });
    },
  });
  return { prototype, applied };
};

const PROTOTYPE_WITHOUT_VALUE_SETTER: InputPrototype = {};

const stubDom = (
  elementsBySelector: Record<string, InputStub>,
  inputPrototype: InputPrototype,
  { nonInputSelectors = [] }: StubDomOptions = {}
): Mock<(selector: string) => InputStub | null> => {
  const querySelector = vi.fn((selector: string) => elementsBySelector[selector] ?? null);
  // The helper guards with `instanceof window.HTMLInputElement`, so the stand-in
  // has to be a constructor whose prototype is the same object the native value
  // setter is probed on. Elements published under a selector listed in
  // `nonInputSelectors` keep the default prototype, which models an element
  // that matched the selector without being an input.
  const HTMLInputElementStandIn = function () {} as unknown as InputElementConstructor;
  HTMLInputElementStandIn.prototype = inputPrototype;
  for (const [selector, element] of Object.entries(elementsBySelector)) {
    if (!nonInputSelectors.includes(selector)) {
      Object.setPrototypeOf(element, inputPrototype);
    }
  }
  vi.stubGlobal('document', { querySelector });
  vi.stubGlobal('window', { HTMLInputElement: HTMLInputElementStandIn });
  vi.stubGlobal(
    'Event',
    vi.fn(function stubEvent(this: unknown, type: string, init?: { bubbles?: boolean }) {
      return { type, ...init } satisfies StubEvent;
    })
  );
  return querySelector;
};

const callHexToRgbAtRuntime = (value: unknown): Rgb => (hexToRgb as (hex: unknown) => Rgb)(value);

describe('Color Helpers', () => {
  describe('hexToRgb', () => {
    it('converts standard hex to RGB', () => {
      expect(hexToRgb(RED_HEX)).toEqual({ r: RED_CHANNEL_MAX, g: 0, b: 0 });
      expect(hexToRgb('#00ff00')).toEqual({ r: 0, g: RED_CHANNEL_MAX, b: 0 });
      expect(hexToRgb('#0000ff')).toEqual({ r: 0, g: 0, b: RED_CHANNEL_MAX });
    });

    it('converts hex without hash prefix', () => {
      expect(hexToRgb('ff0000')).toEqual({ r: RED_CHANNEL_MAX, g: 0, b: 0 });
      expect(hexToRgb('00ff00')).toEqual({ r: 0, g: RED_CHANNEL_MAX, b: 0 });
      expect(hexToRgb('0000ff')).toEqual({ r: 0, g: 0, b: RED_CHANNEL_MAX });
    });

    it('converts white and black', () => {
      expect(hexToRgb('#ffffff')).toEqual({ r: RED_CHANNEL_MAX, g: RED_CHANNEL_MAX, b: RED_CHANNEL_MAX });
      expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    });

    it('converts grayscale values', () => {
      expect(hexToRgb('#808080')).toEqual({ r: 128, g: 128, b: 128 });
      expect(hexToRgb('#7f7f7f')).toEqual({ r: 127, g: 127, b: 127 });
    });

    it('converts mixed case hex', () => {
      expect(hexToRgb('#FF0000')).toEqual({ r: RED_CHANNEL_MAX, g: 0, b: 0 });
      expect(hexToRgb('#Ff00Ff')).toEqual({ r: RED_CHANNEL_MAX, g: 0, b: RED_CHANNEL_MAX });
    });

    it('expands 3-char hex shorthand correctly (CSS spec)', () => {
      expect(hexToRgb(RED_SHORTHAND_HEX)).toEqual({ r: RED_CHANNEL_MAX, g: 0, b: 0 });
      expect(hexToRgb('#0f0')).toEqual({ r: 0, g: RED_CHANNEL_MAX, b: 0 });
      expect(hexToRgb('#00f')).toEqual({ r: 0, g: 0, b: RED_CHANNEL_MAX });
      expect(hexToRgb('#abc')).toEqual({ r: 170, g: 187, b: 204 });
      expect(hexToRgb('f00')).toEqual({ r: RED_CHANNEL_MAX, g: 0, b: 0 });
    });

    it('expands 4-char #rgba shorthand and drops the alpha digit (CSS-4)', () => {
      expect(hexToRgb('#f00a')).toEqual({ r: RED_CHANNEL_MAX, g: 0, b: 0 });
      expect(hexToRgb('#0f0a')).toEqual({ r: 0, g: RED_CHANNEL_MAX, b: 0 });
      expect(hexToRgb('#00fa')).toEqual({ r: 0, g: 0, b: RED_CHANNEL_MAX });
      expect(hexToRgb('#abc4')).toEqual({ r: 170, g: 187, b: 204 });
      expect(hexToRgb('f00f')).toEqual({ r: RED_CHANNEL_MAX, g: 0, b: 0 });
      expect(hexToRgb('#f000')).toEqual({ r: RED_CHANNEL_MAX, g: 0, b: 0 });
    });

    it('strips the alpha byte from 8-digit #rrggbbaa hex (CSS-4)', () => {
      expect(hexToRgb('#ff0000ff')).toEqual({ r: RED_CHANNEL_MAX, g: 0, b: 0 });
      expect(hexToRgb('#ff000000')).toEqual({ r: RED_CHANNEL_MAX, g: 0, b: 0 });
      expect(hexToRgb('#00ff0080')).toEqual({ r: 0, g: RED_CHANNEL_MAX, b: 0 });
      expect(hexToRgb('#0000ff00')).toEqual({ r: 0, g: 0, b: RED_CHANNEL_MAX });
      expect(hexToRgb('00ff00ff')).toEqual({ r: 0, g: RED_CHANNEL_MAX, b: 0 });
    });

    it('throws for shorthand whose digits are not hex', () => {
      expect(() => hexToRgb('#rgba')).toThrow('hexToRgb: expected 3, 4, 6 or 8 hex digits, got "rgba"');
      expect(() => hexToRgb('#zzzz')).toThrow('hexToRgb: expected 3, 4, 6 or 8 hex digits, got "zzzz"');
      // A non-hex alpha digit must not be dropped as if the value were `#ffff00`.
      expect(() => hexToRgb('#ff0zz')).toThrow('hexToRgb: expected 3, 4, 6 or 8 hex digits, got "ff0zz"');
      expect(() => hexToRgb('#ff0000zz')).toThrow('hexToRgb: expected 3, 4, 6 or 8 hex digits, got "ff0000zz"');
    });

    it('throws for multiple leading hash characters (invalid CSS)', () => {
      expect(() => hexToRgb('##ff0000')).toThrow('hexToRgb: expected 3, 4, 6 or 8 hex digits');
      expect(() => hexToRgb('###00ff00')).toThrow('hexToRgb: expected 3, 4, 6 or 8 hex digits');
    });

    it('reaches the digit check for a 3-char string that is not hex', () => {
      // Not a length problem, so the error names the digits rather than the shape.
      expect(() => hexToRgb('red')).toThrow('hexToRgb: invalid hex value "red"');
    });

    it('handles whitespace-padded input', () => {
      expect(hexToRgb(`  ${RED_HEX}  `)).toEqual({ r: RED_CHANNEL_MAX, g: 0, b: 0 });
      expect(hexToRgb('  ff0000')).toEqual({ r: RED_CHANNEL_MAX, g: 0, b: 0 });
    });

    it('throws for non-string input', () => {
      for (const value of [null, undefined, 123, {}]) {
        expect(() => callHexToRgbAtRuntime(value)).toThrow('hexToRgb: expected a non-empty string');
      }
    });

    it('throws for empty or whitespace-only string', () => {
      expect(() => hexToRgb('')).toThrow('hexToRgb: expected a non-empty string');
      expect(() => hexToRgb('   ')).toThrow('hexToRgb: expected a non-empty string');
    });

    it('throws for invalid hex digits', () => {
      expect(() => hexToRgb('#zzzzzz')).toThrow('hexToRgb: invalid hex value');
    });

    it('throws for named colors', () => {
      expect(() => hexToRgb('red')).toThrow('hexToRgb: invalid hex value "red"');
      expect(() => hexToRgb('rebeccapurple')).toThrow(
        'hexToRgb: expected 3, 4, 6 or 8 hex digits, got "rebeccapurple"'
      );
      expect(() => hexToRgb('transparent')).toThrow('hexToRgb: expected 3, 4, 6 or 8 hex digits, got "transparent"');
    });

    it('throws for rgb() functional notation', () => {
      expect(() => hexToRgb('rgb(255, 0, 0)')).toThrow(
        'hexToRgb: expected 3, 4, 6 or 8 hex digits, got "rgb(255, 0, 0)"'
      );
      expect(() => hexToRgb('rgba(255, 0, 0, 0.5)')).toThrow(
        'hexToRgb: expected 3, 4, 6 or 8 hex digits, got "rgba(255, 0, 0, 0.5)"'
      );
    });
  });

  describe('setForegroundColor', () => {
    beforeEach(() => {
      mockPoll.mockClear();
      mockPollAssertion.mockReset();
      mockPollAssertion.mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('calls page.evaluate with hex color, does not check swatch when verifySwatch is false (branch 3)', async () => {
      const evaluate = createResolvedEvaluate();
      const { locator } = createLocatorMock();
      const page = createMockPage({ evaluate, locator });

      await setForegroundColor(page, RED_HEX);

      expect(evaluate).toHaveBeenCalledWith(expect.any(Function), RED_HEX);
      expect(evaluate).toHaveBeenCalledTimes(1);
      expect(locator).not.toHaveBeenCalled();
      expect(mockPoll).not.toHaveBeenCalled();
    });

    it('verifies the swatch per channel when verifySwatch is true (branch 4, calls hexToRgb internally)', async () => {
      const evaluate = createResolvedEvaluate();
      const { locator, swatch } = createLocatorMock();
      const page = createMockPage({ evaluate, locator });

      await setForegroundColor(page, RED_HEX, true);

      expect(evaluate).toHaveBeenCalledWith(expect.any(Function), RED_HEX);
      expect(locator).toHaveBeenCalledWith(FOREGROUND_COLOR_SWATCH_SELECTOR);
      expect(mockPoll).toHaveBeenCalledTimes(1);
      expect(swatch.evaluate).toHaveBeenCalledTimes(1);
      expect(mockPollAssertion).toHaveBeenCalledWith(RED_HEX, RED_HEX);
    });

    it('verifies a correctly-set colour the browser serialises differently', async () => {
      for (const computed of RED_COMPUTED_FORMS) {
        mockPollAssertion.mockClear();
        const { locator } = createLocatorMock([FOREGROUND_COLOR_SWATCH_SELECTOR], computed);
        const page = createMockPage({ evaluate: createResolvedEvaluate(), locator });

        await setForegroundColor(page, RED_HEX, true);

        expect(mockPollAssertion).toHaveBeenCalledWith(RED_HEX, RED_HEX);
      }
    });

    it('reports an unrecognised computed colour form by name instead of passing', async () => {
      const { locator } = createLocatorMock([FOREGROUND_COLOR_SWATCH_SELECTOR], 'oklch(0.7 0.1 20)');
      const page = createMockPage({ evaluate: createResolvedEvaluate(), locator });

      await expect(setForegroundColor(page, RED_HEX, true)).rejects.toThrow(
        'setForegroundColor: cannot read colour channels from computed value "oklch(0.7 0.1 20)"'
      );
    });

    it('verifies swatch CSS color with 3-char shorthand hex', async () => {
      const evaluate = createResolvedEvaluate();
      const { locator } = createLocatorMock();
      const page = createMockPage({ evaluate, locator });

      await setForegroundColor(page, RED_SHORTHAND_HEX, true);

      // The shorthand is expanded to the simple colour a colour input can hold
      // before it is written, and that same colour is what the swatch is
      // verified against.
      expect(evaluate).toHaveBeenCalledWith(expect.any(Function), RED_HEX);
      expect(mockPollAssertion).toHaveBeenCalledWith(RED_HEX, RED_HEX);
    });

    it('applies the color to the foreground color input through the native value setter', async () => {
      const { prototype, applied } = createNativeValueSetterProbe();
      const input = createInputStub('foreground-color-input');
      const querySelector = stubDom({ [FOREGROUND_COLOR_INPUT_SELECTOR]: input }, prototype);
      const evaluate = createRunningEvaluate();
      const page = createMockPage({ evaluate });

      await setForegroundColor(page, RED_HEX);

      expect(querySelector).toHaveBeenCalledTimes(1);
      expect(querySelector).toHaveBeenCalledWith(FOREGROUND_COLOR_INPUT_SELECTOR);
      expect(applied).toEqual([{ element: input, color: RED_HEX }]);
      expect(input.dispatchEvent).toHaveBeenCalledTimes(2);
      expect(input.dispatchEvent).toHaveBeenNthCalledWith(1, { type: 'input', bubbles: true });
      expect(input.dispatchEvent).toHaveBeenNthCalledWith(2, { type: 'change', bubbles: true });
    });

    it('writes the simple colour a colour input can store, dropping alpha and case', async () => {
      const { prototype, applied } = createNativeValueSetterProbe();
      const input = createInputStub('foreground-color-input');
      stubDom({ [FOREGROUND_COLOR_INPUT_SELECTOR]: input }, prototype);
      const page = createMockPage({ evaluate: createRunningEvaluate() });

      await setForegroundColor(page, '#FF0000FF');

      // `#000000` is what a colour input silently stores for a value it cannot
      // parse, so anything the DOM cannot hold is expanded here instead.
      expect(applied).toEqual([{ element: input, color: RED_HEX }]);
    });

    it('rejects a colour it cannot parse before touching the DOM', async () => {
      const { prototype, applied } = createNativeValueSetterProbe();
      const input = createInputStub('foreground-color-input');
      const querySelector = stubDom({ [FOREGROUND_COLOR_INPUT_SELECTOR]: input }, prototype);
      const { locator } = createLocatorMock();
      const page = createMockPage({ evaluate: createRunningEvaluate(), locator });

      await expect(setForegroundColor(page, 'red')).rejects.toThrow('hexToRgb: invalid hex value "red"');

      expect(querySelector).not.toHaveBeenCalled();
      expect(applied).toEqual([]);
      expect(input.dispatchEvent).not.toHaveBeenCalled();
      expect(locator).not.toHaveBeenCalled();
      expect(mockPoll).not.toHaveBeenCalled();
    });

    it('rejects every notation a colour input would silently rewrite to black', async () => {
      for (const value of ['rgb(255, 0, 0)', 'transparent', '', '   ']) {
        const { prototype, applied } = createNativeValueSetterProbe();
        const input = createInputStub('foreground-color-input');
        const querySelector = stubDom({ [FOREGROUND_COLOR_INPUT_SELECTOR]: input }, prototype);
        const page = createMockPage({ evaluate: createRunningEvaluate() });

        await expect(setForegroundColor(page, value)).rejects.toThrow(/^hexToRgb: /);

        expect(querySelector).not.toHaveBeenCalled();
        expect(applied).toEqual([]);
      }
    });

    it('throws a named error when the foreground colour input is not found', async () => {
      const { prototype, applied } = createNativeValueSetterProbe();
      const querySelector = stubDom({}, prototype);
      const { locator } = createLocatorMock();
      const evaluate = createRunningEvaluate();
      const page = createMockPage({ evaluate, locator });

      await expect(setForegroundColor(page, RED_HEX)).rejects.toThrow(MISSING_INPUT_MESSAGE);

      expect(evaluate).toHaveBeenCalledWith(expect.any(Function), RED_HEX);
      expect(querySelector).toHaveBeenCalledWith(FOREGROUND_COLOR_INPUT_SELECTOR);
      expect(applied).toEqual([]);
      expect(locator).not.toHaveBeenCalled();
      expect(mockPoll).not.toHaveBeenCalled();
    });

    it('throws the same named error when the testid is published on a non-input element', async () => {
      const { prototype, applied } = createNativeValueSetterProbe();
      const notAnInput = createInputStub('foreground-color-input');
      stubDom({ [FOREGROUND_COLOR_INPUT_SELECTOR]: notAnInput }, prototype, {
        nonInputSelectors: [FOREGROUND_COLOR_INPUT_SELECTOR],
      });
      const page = createMockPage({ evaluate: createRunningEvaluate() });

      // An unsound cast would have reached the native setter here and failed with
      // an opaque `TypeError: Illegal invocation`.
      await expect(setForegroundColor(page, RED_HEX)).rejects.toThrow(MISSING_INPUT_MESSAGE);

      expect(applied).toEqual([]);
      expect(notAnInput.dispatchEvent).not.toHaveBeenCalled();
    });

    it('throws rather than writing to a color input published under a different testid', async () => {
      const { prototype, applied } = createNativeValueSetterProbe();
      const otherInput = createInputStub('background-color-input');
      const querySelector = stubDom({ [OTHER_COLOR_INPUT_SELECTOR]: otherInput }, prototype);
      const evaluate = createRunningEvaluate();
      const page = createMockPage({ evaluate });

      await expect(setForegroundColor(page, RED_HEX)).rejects.toThrow(MISSING_INPUT_MESSAGE);

      expect(querySelector).toHaveBeenCalledWith(FOREGROUND_COLOR_INPUT_SELECTOR);
      expect(querySelector).not.toHaveBeenCalledWith(OTHER_COLOR_INPUT_SELECTOR);
      expect(applied).toEqual([]);
      expect(otherInput.dispatchEvent).not.toHaveBeenCalled();
    });

    it('throws when native value setter not found (branch 2)', async () => {
      const input = createInputStub('foreground-color-input');
      stubDom({ [FOREGROUND_COLOR_INPUT_SELECTOR]: input }, PROTOTYPE_WITHOUT_VALUE_SETTER);
      const evaluate = createRunningEvaluate();
      const page = createMockPage({ evaluate });

      await expect(setForegroundColor(page, RED_HEX)).rejects.toThrow(
        'Native value setter not found on HTMLInputElement.prototype'
      );

      expect(input.dispatchEvent).not.toHaveBeenCalled();
    });

    it('propagates errors from page.evaluate', async () => {
      const evaluate = createRejectedEvaluate(new Error('Browser context error'));
      const page = createMockPage({ evaluate });

      await expect(setForegroundColor(page, RED_HEX)).rejects.toThrow('Browser context error');
    });

    it('propagates a non-Error rejection from page.evaluate', async () => {
      const evaluate = createRejectedEvaluate(NON_ERROR_EVALUATE_REJECTION);
      const { locator } = createLocatorMock();
      const page = createMockPage({ evaluate, locator });

      await expect(setForegroundColor(page, RED_HEX, true)).rejects.toBe(NON_ERROR_EVALUATE_REJECTION);

      expect(locator).not.toHaveBeenCalled();
      expect(mockPoll).not.toHaveBeenCalled();
    });

    it('surfaces a swatch mismatch reported by the channel comparison', async () => {
      const { locator, swatch } = createLocatorMock([FOREGROUND_COLOR_SWATCH_SELECTOR], GREEN_RGB_CSS);
      const evaluate = createResolvedEvaluate();
      mockPollAssertion.mockImplementationOnce(() => {
        throw new Error(SWATCH_MISMATCH_MESSAGE);
      });
      const page = createMockPage({ evaluate, locator });

      await expect(setForegroundColor(page, RED_HEX, true)).rejects.toThrow('Received: "#008000"');

      expect(swatch.evaluate).toHaveBeenCalledTimes(1);
      expect(mockPollAssertion).toHaveBeenCalledWith('#008000', RED_HEX);
    });

    it('does not accept a swatch published under a different testid', async () => {
      const { locator, swatch } = createLocatorMock([OTHER_COLOR_SWATCH_SELECTOR]);
      const evaluate = createResolvedEvaluate();
      const page = createMockPage({ evaluate, locator });

      await expect(setForegroundColor(page, RED_HEX, true)).rejects.toThrow(
        `Timed out waiting for locator('${FOREGROUND_COLOR_SWATCH_SELECTOR}')`
      );

      expect(locator).toHaveBeenCalledTimes(1);
      expect(locator).toHaveBeenCalledWith(FOREGROUND_COLOR_SWATCH_SELECTOR);
      expect(locator).not.toHaveBeenCalledWith(OTHER_COLOR_SWATCH_SELECTOR);
      expect(swatch.evaluate).not.toHaveBeenCalled();
    });

    it('rejects before touching the swatch when verifySwatch is true and the color is not hex', async () => {
      const { prototype } = createNativeValueSetterProbe();
      stubDom({}, prototype);
      const { locator } = createLocatorMock();
      const evaluate = createRunningEvaluate();
      const page = createMockPage({ evaluate, locator });

      await expect(setForegroundColor(page, 'red', true)).rejects.toThrow('hexToRgb: invalid hex value "red"');

      expect(locator).not.toHaveBeenCalled();
      expect(mockPoll).not.toHaveBeenCalled();
    });
  });
});
