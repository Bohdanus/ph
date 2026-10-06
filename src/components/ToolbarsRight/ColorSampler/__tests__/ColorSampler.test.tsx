import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Point } from '../../../../contexts/general-types.ts';
import {
  addColorSampler,
  removeColorSampler,
  resetColorSamplersForTest,
  useColorSamplers,
} from '../../../../tools/color-sampler-store.ts';
import ColorSampler from '../ColorSampler.tsx';

const toolArgs = vi.hoisted(() => ({ sampleSize: 1, toolName: 'color-sampler' as string }));

/**
 * `getToolArgs` answers `null` for every tool but the active one, so one flag is enough to put the
 * bar under a different tool. The mock keys on the name the bar asks for rather than blanket-answering
 * everything, because a mock that answered for every tool would let a bar that asked for the WRONG
 * tool pass.
 */
const colorSamplerIsActive = vi.hoisted(() => ({ current: true }));

/** Applies the patch to the args, so the select is a controlled input the way it is in the app. */
const patchToolArgs = vi.hoisted(() =>
  vi.fn((_toolName: string, patch: Record<string, unknown>) => {
    Object.assign(toolArgs, patch);
  })
);

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: (name: string) =>
      name === 'color-sampler' && colorSamplerIsActive.current
        ? { sampleSize: toolArgs.sampleSize, toolName: 'color-sampler' }
        : null,
    patchToolArgs,
  }),
}));

/** A second reader of the same store, so a test can assert what the bar's own Clear reached. */
const Probe = () => {
  const samplers = useColorSamplers();
  return (
    <output data-testid="probe">
      {samplers.length === 0 ? 'none' : samplers.map((sampler) => sampler.id).join(',')}
    </output>
  );
};

const renderBar = () => render(<ColorSampler />);

const renderBarOverProbe = () =>
  render(
    <>
      <ColorSampler />
      <Probe />
    </>
  );

/** Places a sampler the way the canvas gesture does: outside the component, inside `act`. */
const place = (color: string, point: Point) => {
  act(() => {
    addColorSampler(point, color);
  });
};

/**
 * The bar's own test ids, filtered to the readouts.
 *
 * The filter is on the SHAPE of the id, not on a fixed list, because the whole claim of the last two
 * tests is which numbers those suffixes carry: a reader that hard-coded the six ids would assert its
 * own list back. `color-sampler-clear` shares the prefix and would otherwise be counted as a readout.
 */
const READOUT_TESTID = /^color-sampler-(?:hex-|swatch-)?\d+$/;

const readoutTestids = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-testid^="color-sampler-"]')]
    .map((element) => element.getAttribute('data-testid') ?? '')
    .filter((testid) => READOUT_TESTID.test(testid))
    .sort();

/** One element per sampler: the RGB output is the only readout id that is a bare number. */
const rows = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-testid^="color-sampler-"]')].filter((element) =>
    /^color-sampler-\d+$/.test(element.getAttribute('data-testid') ?? '')
  );

const text = (container: HTMLElement, testid: string) =>
  container.querySelector(`[data-testid="${testid}"]`)?.textContent ?? null;

describe('the Color Sampler options bar', () => {
  beforeEach(() => {
    resetColorSamplersForTest();
    toolArgs.sampleSize = 1;
    colorSamplerIsActive.current = true;
    patchToolArgs.mockClear();
  });

  afterEach(() => {
    resetColorSamplersForTest();
    vi.restoreAllMocks();
  });

  it('renders nothing at all under another tool, rather than reporting its samplers under that name', () => {
    place('#ff0000', { x: 1, y: 1 });
    colorSamplerIsActive.current = false;

    const { container } = renderBar();

    expect(container.querySelector('[data-testid="color-sampler-clear"]')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
    expect(readoutTestids(container)).toEqual([]);
    // The bar belongs to the tool, so it reads as ABSENT rather than as a set of samples wearing
    // another tool's name. Samplers outlive a tool switch, so the only thing keeping them off
    // another tool's bar is this guard.
    expect(container).toBeEmptyDOMElement();
  });

  it('offers all seven Sample Size entries, in the order and with the labels Adobe prints', () => {
    renderBar();

    const options = [...screen.getByLabelText('Sample Size').querySelectorAll('option')];

    // Adobe enumerates the menu for the two tools that share it — "choose (then Shift-click) the
    // Eyedropper tool or Color Sampler tool, and if necessary, choose a sample size in the options
    // bar" — so a dropped, reordered or renamed entry is a DIFFERENT Photoshop control rather than a
    // shorter list of the same one.
    // https://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html
    expect(options).toHaveLength(7);
    expect(options.map((option) => option.textContent)).toEqual([
      'Point Sample',
      '3 by 3 Average',
      '5 by 5 Average',
      '11 by 11 Average',
      '31 by 31 Average',
      '51 by 51 Average',
      '101 by 101 Average',
    ]);
    expect(options.map((option) => option.value)).toEqual(['1', '3', '5', '11', '31', '51', '101']);
    // No entry is ever unavailable: a size the bar cannot honour would be a promise it cannot keep.
    expect(options.every((option) => !option.disabled)).toBe(true);
  });

  it('writes a Sample Size change through patchToolArgs as a number, never the raw select string', () => {
    renderBar();

    fireEvent.change(screen.getByLabelText('Sample Size'), { target: { value: '11' } });

    // The NUMBER, not merely the call: `Number(event.target.value)` is the whole mechanism, and a
    // string would satisfy the union through the cast and then multiply the size as a coercion the
    // first time it is read.
    expect(patchToolArgs).toHaveBeenCalledTimes(1);
    expect(patchToolArgs.mock.calls).toEqual([['color-sampler', { sampleSize: 11 }]]);
  });

  it('greys Clear while there is no sampler to clear and lights it once one exists', () => {
    const { container } = renderBar();

    expect(container.querySelector('[data-testid="color-sampler-clear"]')).toBeDisabled();

    place('#ff0000', { x: 4, y: 4 });

    // A Clear that reads as active with nothing behind it is the false-promise shape this repo
    // records on bars repeatedly: the control claims a state the store cannot be in.
    expect(container.querySelector('[data-testid="color-sampler-clear"]')).not.toBeDisabled();
  });

  it('empties the store on Clear, which is Adobe Clear in the options bar', () => {
    const { container } = renderBarOverProbe();
    place('#ff0000', { x: 1, y: 1 });
    place('#00ff00', { x: 2, y: 2 });

    expect(screen.getByTestId('probe').textContent).toBe('1,2');

    // Adobe: "To delete all color samplers, click Clear in the options bar."
    // https://helpx.adobe.com/photoshop/using/viewing-histograms-pixel-values.html
    fireEvent.click(screen.getByTestId('color-sampler-clear'));

    // The store is read by a SEPARATE reader, not inferred from the bar, so a bar that merely hid
    // its rows would fail here.
    expect(screen.getByTestId('probe').textContent).toBe('none');
    expect(rows(container)).toHaveLength(0);
    expect(readoutTestids(container)).toEqual([]);
    expect(container.querySelector('[data-testid="color-sampler-clear"]')).toBeDisabled();
  });

  it('renders one readout row per sampler, each carrying the number and the colour of its own sampler', () => {
    const { container } = renderBar();
    place('#ff0000', { x: 1, y: 1 });
    place('#123456', { x: 2, y: 2 });
    place('#0000ff', { x: 3, y: 3 });

    expect(rows(container)).toHaveLength(3);
    expect(rows(container).map((row) => row.textContent)).toEqual(['255, 0, 0', '18, 52, 86', '0, 0, 255']);

    // The SECOND row, named by testid rather than by position, so a row that reported the first
    // sampler or the last one is caught rather than averaged into a passing order check.
    expect(text(container, 'color-sampler-2')).toBe('18, 52, 86');
    expect(text(container, 'color-sampler-hex-2')).toBe('#123456');

    // The swatch is half the readout — it is what makes a row legible at a glance, and it is the
    // same colour by construction, not a decoration.
    const swatch = container.querySelector<HTMLElement>('[data-testid="color-sampler-swatch-2"]');
    expect(swatch?.style.backgroundColor).toBe('rgb(18, 52, 86)');
    expect(swatch?.style.backgroundColor).not.toBe('rgb(255, 0, 0)');
    expect(swatch?.style.backgroundColor).not.toBe('rgb(0, 0, 255)');
  });

  it('suffixes every readout id with the number of the sampler it belongs to, so a second row cannot overwrite a first', () => {
    const { container } = renderBar();
    place('#ff0000', { x: 1, y: 1 });
    place('#00ff00', { x: 2, y: 2 });

    // A single fixed id would leave two rows sharing one testid, so the first would answer for both
    // and the second would silently vanish. The three ids per sampler are asserted together because
    // the numbers, the hex and the swatch are one readout and a partial fix is still a broken one.
    expect(readoutTestids(container)).toEqual([
      'color-sampler-1',
      'color-sampler-2',
      'color-sampler-hex-1',
      'color-sampler-hex-2',
      'color-sampler-swatch-1',
      'color-sampler-swatch-2',
    ]);
    expect(text(container, 'color-sampler-1')).toBe('255, 0, 0');
    expect(text(container, 'color-sampler-2')).toBe('0, 255, 0');
  });

  it('keeps the numbers of the samplers that survive a deletion, so the second one stays the second all session', () => {
    const { container } = renderBarOverProbe();
    place('#ff0000', { x: 1, y: 1 });
    place('#123456', { x: 2, y: 2 });
    place('#0000ff', { x: 3, y: 3 });

    act(() => {
      removeColorSampler(1);
    });

    // The id is STORED on the sampler rather than being its index, and that is a decision: renumbering
    // on delete would make a user's reference to "sampler 2" mean two different points over one
    // session. The survivor therefore keeps `#2` and `#3` and the bar must not compact them.
    expect(screen.getByTestId('probe').textContent).toBe('2,3');
    expect(readoutTestids(container)).toEqual([
      'color-sampler-2',
      'color-sampler-3',
      'color-sampler-hex-2',
      'color-sampler-hex-3',
      'color-sampler-swatch-2',
      'color-sampler-swatch-3',
    ]);
    expect(container.querySelector('[data-testid="color-sampler-1"]')).toBeNull();
    expect(rows(container).map((row) => row.textContent)).toEqual(['18, 52, 86', '0, 0, 255']);
  });
});
