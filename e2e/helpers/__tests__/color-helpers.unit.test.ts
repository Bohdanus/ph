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
const NON_ERROR_EVALUATE_REJECTION = 'Target page, context or browser has been closed';
// Approximation of real Playwright output, used only to assert error propagation.
const SWATCH_MISMATCH_MESSAGE =
  "Expected: 'rgb(255, 0, 0)'\nReceived: 'rgb(0, 128, 0)'\nCall log: - expected 'background-color' ...";

type Rgb = ReturnType<typeof hexToRgb>;
type SwatchHandle = { readonly selector: string };
type AbsentLocator = { readonly absentSelector: string; readonly count: () => Promise<number> };
type LocatorMock = { readonly locator: Mock<(selector: string) => object>; readonly swatch: SwatchHandle };
type StubEvent = { readonly type: string; readonly bubbles?: boolean };
type InputStub = { readonly testId: string; readonly dispatchEvent: Mock<(event: StubEvent) => boolean> };
type InputPrototype = { value?: string };
type MockPageParts = {
  evaluate: Page['evaluate'];
  locator?: (selector: string) => object;
};

const { mockExpect, mockToHaveCSS } = vi.hoisted(() => {
  const mockToHaveCSS = vi.fn<(property: string, expected: string) => Promise<void>>();
  const mockExpect = vi.fn<
    (subject: object) => {
      toHaveCSS: (property: string, expected: string) => Promise<void>;
    }
  >();
  return { mockExpect, mockToHaveCSS };
});

vi.mock('@playwright/test', () => ({
  expect: mockExpect,
}));

const createMockPage = (parts: MockPageParts): Page => parts as Page;

const isAbsentLocator = (subject: object): subject is AbsentLocator => 'absentSelector' in subject;

const createLocatorMock = (publishedSelectors: readonly string[] = [FOREGROUND_COLOR_SWATCH_SELECTOR]): LocatorMock => {
  const swatch: SwatchHandle = { selector: FOREGROUND_COLOR_SWATCH_SELECTOR };
  const locator = vi.fn<(selector: string) => object>((selector: string) =>
    publishedSelectors.includes(selector)
      ? swatch
      : ({ absentSelector: selector, count: async () => 0 } satisfies AbsentLocator)
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
  inputPrototype: InputPrototype
): Mock<(selector: string) => InputStub | null> => {
  const querySelector = vi.fn((selector: string) => elementsBySelector[selector] ?? null);
  vi.stubGlobal('document', { querySelector });
  vi.stubGlobal('window', { HTMLInputElement: { prototype: inputPrototype } });
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

    it('throws for multiple leading hash characters (invalid CSS)', () => {
      expect(() => hexToRgb('##ff0000')).toThrow('hexToRgb: expected 3 or 6 hex digits');
      expect(() => hexToRgb('###00ff00')).toThrow('hexToRgb: expected 3 or 6 hex digits');
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

    it('throws for unsupported length (8-char with alpha)', () => {
      expect(() => hexToRgb('#ff0000ff')).toThrow('hexToRgb: expected 3 or 6 hex digits, got "ff0000ff"');
    });

    it('throws for 4-char #rgba alpha shorthand (CSS-4 form is unsupported)', () => {
      expect(() => hexToRgb('#f00a')).toThrow('hexToRgb: expected 3 or 6 hex digits, got "f00a"');
      expect(() => hexToRgb('#0f0a')).toThrow('hexToRgb: expected 3 or 6 hex digits, got "0f0a"');
      expect(() => hexToRgb('#rgba')).toThrow('hexToRgb: expected 3 or 6 hex digits, got "rgba"');
    });

    it('throws for named colors', () => {
      expect(() => hexToRgb('red')).toThrow('hexToRgb: invalid hex value "red"');
      expect(() => hexToRgb('rebeccapurple')).toThrow('hexToRgb: expected 3 or 6 hex digits, got "rebeccapurple"');
      expect(() => hexToRgb('transparent')).toThrow('hexToRgb: expected 3 or 6 hex digits, got "transparent"');
    });

    it('throws for rgb() functional notation', () => {
      expect(() => hexToRgb('rgb(255, 0, 0)')).toThrow('hexToRgb: expected 3 or 6 hex digits, got "rgb(255, 0, 0)"');
      expect(() => hexToRgb('rgba(255, 0, 0, 0.5)')).toThrow(
        'hexToRgb: expected 3 or 6 hex digits, got "rgba(255, 0, 0, 0.5)"'
      );
    });
  });

  describe('setForegroundColor', () => {
    beforeEach(() => {
      mockExpect.mockReset();
      mockToHaveCSS.mockReset();
      mockToHaveCSS.mockResolvedValue(undefined);
      mockExpect.mockImplementation((subject: object) => ({
        toHaveCSS: async (property: string, expected: string) => {
          // Approximation of real Playwright's missing-locator timeout.
          if (isAbsentLocator(subject)) {
            throw new Error(`Timed out waiting for locator('${subject.absentSelector}')`);
          }
          await mockToHaveCSS(property, expected);
        },
      }));
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
      expect(mockExpect).not.toHaveBeenCalled();
    });

    it('verifies swatch CSS color when verifySwatch is true (branch 4, calls hexToRgb internally)', async () => {
      const evaluate = createResolvedEvaluate();
      const { locator, swatch } = createLocatorMock();
      const page = createMockPage({ evaluate, locator });

      await setForegroundColor(page, RED_HEX, true);

      expect(evaluate).toHaveBeenCalledWith(expect.any(Function), RED_HEX);
      expect(locator).toHaveBeenCalledWith(FOREGROUND_COLOR_SWATCH_SELECTOR);
      expect(mockExpect).toHaveBeenCalledWith(swatch);
      expect(mockToHaveCSS).toHaveBeenCalledWith('background-color', RED_RGB_CSS);
    });

    it('verifies swatch CSS color with 3-char shorthand hex', async () => {
      const evaluate = createResolvedEvaluate();
      const { locator } = createLocatorMock();
      const page = createMockPage({ evaluate, locator });

      await setForegroundColor(page, RED_SHORTHAND_HEX, true);

      expect(mockToHaveCSS).toHaveBeenCalledWith('background-color', RED_RGB_CSS);
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

    it('ignores a color input published under a different testid', async () => {
      const { prototype, applied } = createNativeValueSetterProbe();
      const otherInput = createInputStub('background-color-input');
      const querySelector = stubDom({ [OTHER_COLOR_INPUT_SELECTOR]: otherInput }, prototype);
      const evaluate = createRunningEvaluate();
      const page = createMockPage({ evaluate });

      await setForegroundColor(page, RED_HEX);

      expect(querySelector).toHaveBeenCalledWith(FOREGROUND_COLOR_INPUT_SELECTOR);
      expect(querySelector).not.toHaveBeenCalledWith(OTHER_COLOR_INPUT_SELECTOR);
      expect(applied).toEqual([]);
      expect(otherInput.dispatchEvent).not.toHaveBeenCalled();
    });

    it('silently does nothing when input element not found (branch 1)', async () => {
      const { prototype, applied } = createNativeValueSetterProbe();
      const querySelector = stubDom({}, prototype);
      const { locator } = createLocatorMock();
      const evaluate = createRunningEvaluate();
      const page = createMockPage({ evaluate, locator });

      await setForegroundColor(page, RED_HEX);

      expect(evaluate).toHaveBeenCalledWith(expect.any(Function), RED_HEX);
      expect(querySelector).toHaveBeenCalledWith(FOREGROUND_COLOR_INPUT_SELECTOR);
      expect(applied).toEqual([]);
      expect(locator).not.toHaveBeenCalled();
      expect(mockExpect).not.toHaveBeenCalled();
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
      expect(mockExpect).not.toHaveBeenCalled();
    });

    it('surfaces a swatch mismatch reported by the CSS assertion', async () => {
      const { locator, swatch } = createLocatorMock();
      const evaluate = createResolvedEvaluate();
      mockToHaveCSS.mockRejectedValueOnce(new Error(SWATCH_MISMATCH_MESSAGE));
      const page = createMockPage({ evaluate, locator });

      await expect(setForegroundColor(page, RED_HEX, true)).rejects.toThrow("Received: 'rgb(0, 128, 0)'");

      expect(mockExpect).toHaveBeenCalledWith(swatch);
      expect(mockToHaveCSS).toHaveBeenCalledWith('background-color', RED_RGB_CSS);
    });

    it('does not accept a swatch published under a different testid', async () => {
      const { locator } = createLocatorMock([OTHER_COLOR_SWATCH_SELECTOR]);
      const evaluate = createResolvedEvaluate();
      const page = createMockPage({ evaluate, locator });

      await expect(setForegroundColor(page, RED_HEX, true)).rejects.toThrow(
        `Timed out waiting for locator('${FOREGROUND_COLOR_SWATCH_SELECTOR}')`
      );

      expect(locator).toHaveBeenCalledTimes(1);
      expect(locator).toHaveBeenCalledWith(FOREGROUND_COLOR_SWATCH_SELECTOR);
      expect(locator).not.toHaveBeenCalledWith(OTHER_COLOR_SWATCH_SELECTOR);
      expect(mockToHaveCSS).not.toHaveBeenCalled();
    });

    it('rejects before touching the swatch when verifySwatch is true and the color is not hex', async () => {
      const { prototype } = createNativeValueSetterProbe();
      stubDom({}, prototype);
      const { locator } = createLocatorMock();
      const evaluate = createRunningEvaluate();
      const page = createMockPage({ evaluate, locator });

      await expect(setForegroundColor(page, 'red', true)).rejects.toThrow('hexToRgb: invalid hex value "red"');

      expect(locator).not.toHaveBeenCalled();
      expect(mockExpect).not.toHaveBeenCalled();
    });

    // Deliberate pin of an open defect: setForegroundColor only validates via hexToRgb
    // when verifySwatch is true, so with the default the DOM is touched with no pre-flight
    // validation and a non-hex color is written verbatim. This test fails the moment that
    // validation is added up front.
    it('writes a non-hex color to the input without validating it when verifySwatch is false', async () => {
      const { prototype, applied } = createNativeValueSetterProbe();
      const input = createInputStub('foreground-color-input');
      const querySelector = stubDom({ [FOREGROUND_COLOR_INPUT_SELECTOR]: input }, prototype);
      const evaluate = createRunningEvaluate();
      const { locator } = createLocatorMock();
      const page = createMockPage({ evaluate, locator });

      await expect(setForegroundColor(page, 'red')).resolves.toBeUndefined();

      expect(querySelector).toHaveBeenCalledTimes(1);
      expect(querySelector).toHaveBeenCalledWith(FOREGROUND_COLOR_INPUT_SELECTOR);
      expect(applied).toEqual([{ element: input, color: 'red' }]);
      expect(input.dispatchEvent).toHaveBeenCalledTimes(2);
      expect(locator).not.toHaveBeenCalled();
      expect(mockExpect).not.toHaveBeenCalled();
    });
  });
});
