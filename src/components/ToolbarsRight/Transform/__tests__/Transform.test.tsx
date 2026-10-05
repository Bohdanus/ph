import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import Transform from '../Transform.tsx';

const toolArgs = vi.hoisted(() => ({
  toolName: 'transform',
  rotate: 0,
  mirrorH: false,
  mirrorV: false,
  skewX: 0,
  skewY: 0,
  trapezoid: 0,
  resizeX: 100,
  resizeY: 100,
}));

const mockTempUpdateLayer = vi.hoisted(() => vi.fn());
const mockSetToolArgs = vi.hoisted(() => vi.fn());
const mockCancelLayerPreview = vi.hoisted(() => vi.fn());
const mockCommitDirtyTool = vi.hoisted(() => vi.fn());
/** `cancelLayerPreview` and `commitDirtyTool` are optional on the layer context (Transform.tsx:12). */
const layerApi = vi.hoisted(() => ({ cancelLayerPreview: true, commitDirtyTool: true }));

vi.mock('../../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    tempUpdateLayer: mockTempUpdateLayer,
    cancelLayerPreview: layerApi.cancelLayerPreview ? mockCancelLayerPreview : undefined,
    commitDirtyTool: layerApi.commitDirtyTool ? mockCommitDirtyTool : undefined,
  }),
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs,
    setToolArgs: mockSetToolArgs,
  }),
}));

function resetToolArgs(overrides: Partial<typeof toolArgs> = {}) {
  Object.assign(toolArgs, {
    toolName: 'transform',
    rotate: 0,
    mirrorH: false,
    mirrorV: false,
    skewX: 0,
    skewY: 0,
    trapezoid: 0,
    resizeX: 100,
    resizeY: 100,
    ...overrides,
  });
}

/** The last transient preview payload published to the layer store. */
const previewArgs = () => mockTempUpdateLayer.mock.lastCall?.[0] as { toolArgs: Record<string, unknown> };

describe('Transform toolbar', () => {
  beforeEach(() => {
    resetToolArgs();
    layerApi.cancelLayerPreview = true;
    layerApi.commitDirtyTool = true;
    mockTempUpdateLayer.mockClear();
    mockSetToolArgs.mockClear();
    mockCancelLayerPreview.mockClear();
    mockCommitDirtyTool.mockClear();
  });

  it('renders rotate buttons and sliders', () => {
    render(<Transform />);

    expect(screen.getByTitle('Rotate 90° Left')).toBeInTheDocument();
    expect(screen.getByTitle('Rotate 180°')).toBeInTheDocument();
    expect(screen.getByTitle('Rotate 90° Right')).toBeInTheDocument();
    expect(screen.getByText('Skew X')).toBeInTheDocument();
    expect(screen.getByText('Skew Y')).toBeInTheDocument();
    expect(screen.getByText('Trapezoid')).toBeInTheDocument();
    expect(screen.getByText('Resize X')).toBeInTheDocument();
    expect(screen.getByText('Resize Y')).toBeInTheDocument();
  });

  it('has mirror toggle buttons', () => {
    render(<Transform />);

    expect(screen.getByTitle('Mirror Horizontal')).toBeInTheDocument();
    expect(screen.getByTitle('Mirror Vertical')).toBeInTheDocument();
  });

  it('renders icon buttons only — no Cancel, no Apply, no Reset All', () => {
    render(<Transform />);

    // The complete set of controls on the bar, by accessible name. Asserting the whole
    // set rather than three absences is the point: `queryByText('Apply')` would stay
    // green if the button came back as "APPLY", or as an icon with a title, and the bar
    // is exactly five icon buttons wide now.
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('title'))).toEqual([
      'Rotate 90° Left',
      'Rotate 180°',
      'Rotate 90° Right',
      'Mirror Horizontal',
      'Mirror Vertical',
    ]);
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    expect(screen.queryByText('Apply')).not.toBeInTheDocument();
    expect(screen.queryByText('Reset All')).not.toBeInTheDocument();
  });

  // These three used to live here as 'rotate buttons are clickable without error', 'mirror
  // buttons are clickable without error' and 'Reset All button is clickable without error'.
  // They contained no assertions at all, so they only re-proved that the component renders,
  // which the three tests above already establish: emptying any of those click handlers to a
  // no-op left all three green. Every control they clicked is exercised by name, with an
  // assertion on the value handed to the mocked tool-args writer, further down this file —
  // 'rotation wrap-around' and 'trapezoid exclusivity' for the three rotate buttons,
  // 'mirror toggles' for the two mirror toggles, and 'optional layer actions' plus
  // 'keyboard navigation' for Cancel — so re-adding them would duplicate real coverage
  // without adding any.

  describe('accessible names of the icon buttons', () => {
    it('falls back to the icon glyph as the accessible name, with the tooltip only as title', () => {
      render(<Transform />);

      const rotateLeft = screen.getByTitle('Rotate 90° Left');
      // The buttons carry a `title` but no `aria-label`, so a screen reader announces the glyph
      // ("-90°") rather than the intent ("Rotate 90° Left"). Documented rather than fixed here
      // because Transform.tsx is production code.
      expect(rotateLeft).toHaveAccessibleName('-90°');
      expect(rotateLeft).toHaveAttribute('title', 'Rotate 90° Left');
      expect(rotateLeft).not.toHaveAttribute('aria-label');

      expect(screen.getByTitle('Rotate 180°')).toHaveAccessibleName('180°');
      expect(screen.getByTitle('Rotate 90° Right')).toHaveAccessibleName('+90°');
      expect(screen.getByTitle('Mirror Horizontal')).toHaveAccessibleName('↔');
      expect(screen.getByTitle('Mirror Vertical')).toHaveAccessibleName('↕');
    });

    it.fails('names the rotate and mirror icon buttons after their action (Transform.tsx:155-175, 277-294)', () => {
      render(<Transform />);

      expect(screen.getByRole('button', { name: 'Rotate 90° Left' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mirror Horizontal' })).toBeInTheDocument();
    });
  });

  describe('argument defaults', () => {
    it('falls back to the documented defaults when the args omit every field (Transform.tsx:52)', () => {
      for (const key of Object.keys(toolArgs)) delete (toolArgs as Record<string, unknown>)[key];
      render(<Transform />);

      const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
      expect(value('rotate-slider')).toBe('0');
      expect(value('skew-x-slider')).toBe('0');
      expect(value('skew-y-slider')).toBe('0');
      expect(value('trapezoid-slider')).toBe('0');
      expect(value('resize-x-slider')).toBe('100');
      expect(value('resize-y-slider')).toBe('100');

      // rotate, skew x and skew y all render `0°`; only the trapezoid renders `0%`.
      expect(screen.getAllByText('0°')).toHaveLength(3);
      expect(screen.getAllByText('0%')).toHaveLength(1);
      expect(screen.getAllByText('100%')).toHaveLength(2);
    });

    it('exposes the documented slider bounds', () => {
      render(<Transform />);

      const bounds = (id: string) => {
        const input = document.getElementById(id) as HTMLInputElement;
        return [input.min, input.max];
      };

      expect(bounds('rotate-slider')).toEqual(['-90', '90']);
      expect(bounds('skew-x-slider')).toEqual(['-45', '45']);
      expect(bounds('skew-y-slider')).toEqual(['-45', '45']);
      expect(bounds('trapezoid-slider')).toEqual(['-85', '85']);
      expect(bounds('resize-x-slider')).toEqual(['10', '300']);
      expect(bounds('resize-y-slider')).toEqual(['10', '300']);
    });

    it('accepts both boundaries of every slider and republishes the exact payload', () => {
      render(<Transform />);

      const setTo = (id: string, value: string) =>
        fireEvent.change(document.getElementById(id) as HTMLInputElement, { target: { value } });

      setTo('rotate-slider', '-90');
      expect(previewArgs().toolArgs).toEqual({ ...toolArgs, rotate: -90, trapezoid: 0 });

      setTo('rotate-slider', '90');
      expect(previewArgs().toolArgs).toEqual({ ...toolArgs, rotate: 90, trapezoid: 0 });

      setTo('skew-x-slider', '-45');
      expect(previewArgs().toolArgs).toEqual({ ...toolArgs, skewX: -45, trapezoid: 0 });

      setTo('trapezoid-slider', '-85');
      expect(previewArgs().toolArgs).toEqual({ ...toolArgs, trapezoid: -85 });

      setTo('resize-x-slider', '10');
      expect(previewArgs().toolArgs).toEqual({ ...toolArgs, resizeX: 10, trapezoid: 0 });

      setTo('resize-y-slider', '300');
      expect(previewArgs().toolArgs).toEqual({ ...toolArgs, resizeY: 300, trapezoid: 0 });
    });
  });

  describe('the six sliders', () => {
    /**
     * Every bound in `Transform.tsx` is a hardcoded literal (`:185-186`, `:205-206`, `:220-221`,
     * `:238-239`, `:256-257`, `:271-272`) and none of them was asserted before this table, so a
     * bound could be edited and nothing in this file would report it. `Rotate` is the load-bearing
     * one: the three rotate BUTTONS wrap through 360 (`Transform.tsx:95-105`) while the slider is
     * capped at ±90, so a `max` quietly widened to 180 would give the panel a second, unwrapped
     * route to a rotate the buttons cannot produce.
     */
    it.each([
      ['rotate-slider', 'Rotate', '-90', '90'],
      ['skew-x-slider', 'Skew X', '-45', '45'],
      ['skew-y-slider', 'Skew Y', '-45', '45'],
      ['trapezoid-slider', 'Trapezoid', '-85', '85'],
      ['resize-x-slider', 'Resize X', '10', '300'],
      ['resize-y-slider', 'Resize Y', '10', '300'],
    ])('%s spans %s..%s', (id, _label, min, max) => {
      render(<Transform />);

      const slider = document.getElementById(id) as HTMLInputElement;
      expect(slider).toHaveAttribute('type', 'range');
      expect(slider).toHaveAttribute('min', min);
      expect(slider).toHaveAttribute('max', max);
    });

    /**
     * The five handlers `trapezoid exclusivity` does not reach. Each one clears `trapezoid` on the
     * way out (`Transform.tsx:113`, `:118`, `:123`, `:137`, `:142`) and preserves every other
     * field, so the payload below is the full seeded args with `trapezoid` zeroed — which is what
     * makes a handler that forgot the `trapezoid: 0` visible: it would publish a transform in which
     * a trapezoid correction and a rotation compose.
     *
     * The payloads are exact and literal rather than read back off `mockTempUpdateLayer`, which is
     * what makes them able to fail: a `previewArgs()`-derived oracle agrees with any wrong payload
     * the component happened to produce.
     */
    it.each([
      [
        'rotate-slider',
        '-90',
        {
          toolName: 'transform',
          rotate: -90,
          mirrorH: true,
          mirrorV: true,
          skewX: 20,
          skewY: -20,
          resizeX: 150,
          resizeY: 80,
          trapezoid: 0,
        },
      ],
      [
        'rotate-slider',
        '90',
        {
          toolName: 'transform',
          rotate: 90,
          mirrorH: true,
          mirrorV: true,
          skewX: 20,
          skewY: -20,
          resizeX: 150,
          resizeY: 80,
          trapezoid: 0,
        },
      ],
      [
        'skew-x-slider',
        '-45',
        {
          toolName: 'transform',
          rotate: 45,
          mirrorH: true,
          mirrorV: true,
          skewX: -45,
          skewY: -20,
          resizeX: 150,
          resizeY: 80,
          trapezoid: 0,
        },
      ],
      [
        'skew-y-slider',
        '45',
        {
          toolName: 'transform',
          rotate: 45,
          mirrorH: true,
          mirrorV: true,
          skewX: 20,
          skewY: 45,
          resizeX: 150,
          resizeY: 80,
          trapezoid: 0,
        },
      ],
      [
        'resize-x-slider',
        '10',
        {
          toolName: 'transform',
          rotate: 45,
          mirrorH: true,
          mirrorV: true,
          skewX: 20,
          skewY: -20,
          resizeX: 10,
          resizeY: 80,
          trapezoid: 0,
        },
      ],
      [
        'resize-y-slider',
        '300',
        {
          toolName: 'transform',
          rotate: 45,
          mirrorH: true,
          mirrorV: true,
          skewX: 20,
          skewY: -20,
          resizeX: 150,
          resizeY: 300,
          trapezoid: 0,
        },
      ],
    ])('%s publishes its endpoint and clears the trapezoid', (id, value, expected) => {
      resetToolArgs({
        rotate: 45,
        mirrorH: true,
        mirrorV: true,
        skewX: 20,
        skewY: -20,
        resizeX: 150,
        resizeY: 80,
        trapezoid: 25,
      });
      render(<Transform />);

      fireEvent.change(document.getElementById(id) as HTMLInputElement, { target: { value } });

      expect(mockTempUpdateLayer).toHaveBeenCalledExactlyOnceWith({ toolArgs: expected });
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith(expected);
    });
  });

  describe('trapezoid exclusivity', () => {
    it('resets every other transform field when the trapezoid slider moves (Transform.tsx:128-141)', () => {
      resetToolArgs({
        rotate: 45,
        mirrorH: true,
        mirrorV: true,
        skewX: 20,
        skewY: -20,
        resizeX: 150,
        resizeY: 80,
        trapezoid: 0,
      });
      render(<Transform />);

      fireEvent.change(document.getElementById('trapezoid-slider') as HTMLInputElement, { target: { value: '30' } });

      expect(mockTempUpdateLayer).toHaveBeenCalledExactlyOnceWith({
        toolArgs: {
          toolName: 'transform',
          rotate: 0,
          mirrorH: false,
          mirrorV: false,
          skewX: 0,
          skewY: 0,
          resizeX: 100,
          resizeY: 100,
          trapezoid: 30,
        },
      });
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({
        toolName: 'transform',
        rotate: 0,
        mirrorH: false,
        mirrorV: false,
        skewX: 0,
        skewY: 0,
        resizeX: 100,
        resizeY: 100,
        trapezoid: 30,
      });
    });

    it('clears the trapezoid whenever a rotate or mirror action is taken', () => {
      resetToolArgs({ rotate: 30, trapezoid: 25 });
      render(<Transform />);

      fireEvent.click(screen.getByTitle('Rotate 90° Right'));
      expect(previewArgs().toolArgs).toMatchObject({ rotate: 120, trapezoid: 0 });

      fireEvent.click(screen.getByTitle('Mirror Horizontal'));
      expect(previewArgs().toolArgs).toMatchObject({ mirrorH: true, trapezoid: 0 });
    });
  });

  describe('commit on release', () => {
    /**
     * The commit gesture is the END of a gesture, and the end of a slider drag is the
     * browser's native `change` event — the one that fires once, on release. React binds
     * its own `onChange` to the native `input` event, which fires on every frame of the
     * drag, so `fireEvent.input` alone is a frame and `fireEvent.change` is the release.
     *
     * These assertions are the load-bearing ones for the whole feature: without them the
     * panel would preview a drag and leave it uncommitted, and every value on the bar
     * would be lost the moment another tool was selected.
     */
    it('does not commit while the slider is still being dragged', () => {
      render(<Transform />);

      fireEvent.input(document.getElementById('rotate-slider') as HTMLInputElement, { target: { value: '40' } });

      expect(previewArgs().toolArgs.rotate).toBe(40);
      expect(mockCommitDirtyTool).not.toHaveBeenCalled();
    });

    it('commits once when the drag is released', () => {
      render(<Transform />);

      const slider = document.getElementById('rotate-slider') as HTMLInputElement;
      for (const frame of ['10', '25', '40']) {
        fireEvent.input(slider, { target: { value: frame } });
      }
      fireEvent.change(slider, { target: { value: '40' } });

      // One history entry for the drag, not one per frame: that is the whole point of
      // binding the commit to `change` rather than to the input stream.
      expect(mockCommitDirtyTool).toHaveBeenCalledExactlyOnceWith();
    });

    it('commits a keyboard step, which the browser also reports as a change', () => {
      render(<Transform />);

      const slider = document.getElementById('rotate-slider') as HTMLInputElement;
      slider.stepUp();
      fireEvent.input(slider);
      fireEvent.change(slider);

      expect(mockCommitDirtyTool).toHaveBeenCalledExactlyOnceWith();
    });

    it('commits each of the six sliders on release', () => {
      render(<Transform />);

      for (const id of [
        'rotate-slider',
        'skew-x-slider',
        'skew-y-slider',
        'trapezoid-slider',
        'resize-x-slider',
        'resize-y-slider',
      ]) {
        mockCommitDirtyTool.mockClear();
        const slider = document.getElementById(id) as HTMLInputElement;
        fireEvent.change(slider, { target: { value: slider.value } });
        expect(mockCommitDirtyTool, `${id} commits on release`).toHaveBeenCalledExactlyOnceWith();
      }
    });

    it('commits the rotate buttons and the mirror toggles as finished gestures', () => {
      render(<Transform />);

      fireEvent.click(screen.getByTitle('Rotate 90° Right'));
      expect(mockCommitDirtyTool, 'a rotate button is a completed gesture').toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTitle('Mirror Horizontal'));
      expect(mockCommitDirtyTool, 'a mirror toggle is a completed gesture').toHaveBeenCalledTimes(2);
    });

    it('previews before committing, so a commit never lands a stale value', () => {
      render(<Transform />);

      const slider = document.getElementById('rotate-slider') as HTMLInputElement;
      fireEvent.input(slider, { target: { value: '55' } });
      fireEvent.change(slider, { target: { value: '55' } });

      // `commitDirtyTool` consumes whatever the preview last published, so the assertion
      // that matters is that the LAST preview carried the released value. Ordering is
      // React's, not ours: the native `change` is dispatched after the final `input`.
      expect(previewArgs().toolArgs.rotate).toBe(55);
    });

    it('survives a layer context with no commitDirtyTool implementation (Transform.tsx:12)', () => {
      layerApi.commitDirtyTool = false;
      render(<Transform />);

      expect(() =>
        fireEvent.change(document.getElementById('rotate-slider') as HTMLInputElement, {
          target: { value: '30' },
        })
      ).not.toThrow();
      expect(mockCommitDirtyTool).not.toHaveBeenCalled();
      expect(previewArgs().toolArgs.rotate).toBe(30);
    });

    it('stops listening for changes on unmount', () => {
      const { unmount } = render(<Transform />);
      const slider = document.getElementById('rotate-slider') as HTMLInputElement;
      unmount();

      fireEvent.change(slider, { target: { value: '30' } });

      expect(mockCommitDirtyTool).not.toHaveBeenCalled();
    });
  });

  describe('rotation wrap-around', () => {
    it('wraps a left rotation past zero into 360 (Transform.tsx:95-99)', () => {
      resetToolArgs({ rotate: 10 });
      render(<Transform />);

      fireEvent.click(screen.getByTitle('Rotate 90° Left'));

      expect(previewArgs().toolArgs).toMatchObject({ rotate: 280, trapezoid: 0 });
    });

    it('wraps a right rotation past 360 back below it (Transform.tsx:101-105)', () => {
      resetToolArgs({ rotate: 350 });
      render(<Transform />);

      fireEvent.click(screen.getByTitle('Rotate 90° Right'));

      expect(previewArgs().toolArgs).toMatchObject({ rotate: 80, trapezoid: 0 });
    });

    it('leaves a left rotation that stays above zero untouched (Transform.tsx:97)', () => {
      resetToolArgs({ rotate: 350 });
      render(<Transform />);

      fireEvent.click(screen.getByTitle('Rotate 90° Left'));

      expect(previewArgs().toolArgs).toMatchObject({ rotate: 260 });
    });

    it('normalises the 180 toggle into 0..359', () => {
      resetToolArgs({ rotate: 180 });
      render(<Transform />);

      fireEvent.click(screen.getByTitle('Rotate 180°'));

      expect(previewArgs().toolArgs).toMatchObject({ rotate: 0, trapezoid: 0 });
    });
  });

  describe('mirror toggles', () => {
    it('turns the horizontal mirror on without touching the vertical one', () => {
      resetToolArgs({ mirrorH: false, mirrorV: false });
      render(<Transform />);

      fireEvent.click(screen.getByTitle('Mirror Horizontal'));

      expect(previewArgs().toolArgs).toMatchObject({ mirrorH: true, mirrorV: false, trapezoid: 0 });
    });

    it('turns the vertical mirror on while keeping an already mirrored horizontal axis', () => {
      resetToolArgs({ mirrorH: true, mirrorV: false });
      render(<Transform />);

      fireEvent.click(screen.getByTitle('Mirror Vertical'));

      expect(previewArgs().toolArgs).toMatchObject({ mirrorH: true, mirrorV: true });
    });

    it('turns a mirror back off', () => {
      resetToolArgs({ mirrorH: true });
      render(<Transform />);

      fireEvent.click(screen.getByTitle('Mirror Horizontal'));

      expect(previewArgs().toolArgs).toMatchObject({ mirrorH: false });
    });

    it.fails('lets consecutive mirror toggles accumulate in one session (Transform.tsx:112-118)', () => {
      // Each handler reads the args object published by the store. The mocked store never
      // hands a new one back within a single mount, so the second click is computed from the
      // first click's starting state and the first mirror is lost. Asserting the intended
      // accumulate behaviour documents the gap without touching the component.
      render(<Transform />);

      fireEvent.click(screen.getByTitle('Mirror Horizontal'));
      fireEvent.click(screen.getByTitle('Mirror Vertical'));

      expect(previewArgs().toolArgs).toMatchObject({ mirrorH: true, mirrorV: true });
    });
  });

  describe('optional layer actions', () => {
    it('still resets the tool args when the layer context has no cancelLayerPreview (Transform.tsx:12)', () => {
      layerApi.cancelLayerPreview = false;
      render(<Transform />);

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(mockCancelLayerPreview).not.toHaveBeenCalled();
      expect(mockSetToolArgs).toHaveBeenCalledExactlyOnceWith({
        rotate: 0,
        mirrorH: false,
        mirrorV: false,
        skewX: 0,
        skewY: 0,
        trapezoid: 0,
        resizeX: 100,
        resizeY: 100,
        toolName: 'transform',
      });
    });

    it('removes the escape listener on unmount (Transform.tsx:35-44)', () => {
      const { unmount } = render(<Transform />);
      unmount();

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(mockCancelLayerPreview).not.toHaveBeenCalled();
      expect(mockSetToolArgs).not.toHaveBeenCalled();
    });

    it('ignores every other key', () => {
      render(<Transform />);

      fireEvent.keyDown(window, { key: 'Enter' });
      fireEvent.keyDown(window, { key: 'e' });

      expect(mockSetToolArgs).not.toHaveBeenCalled();
    });
  });

  describe('keyboard navigation', () => {
    const pressArrowOnRange = (range: HTMLInputElement, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight') => {
      if (key === 'ArrowUp' || key === 'ArrowRight') {
        range.stepUp();
      } else {
        range.stepDown();
      }
      fireEvent.input(range);
    };

    const resetArgs = {
      rotate: 0,
      mirrorH: false,
      mirrorV: false,
      skewX: 0,
      skewY: 0,
      trapezoid: 0,
      resizeX: 100,
      resizeY: 100,
      toolName: 'transform',
    };

    it('allows tab navigation through all focusable elements', async () => {
      render(<Transform />);
      const user = userEvent.setup();

      const rotateLeftButton = screen.getByTitle('Rotate 90° Left');
      const rotate180Button = screen.getByTitle('Rotate 180°');
      const rotateRightButton = screen.getByTitle('Rotate 90° Right');
      const rotateSlider = document.getElementById('rotate-slider') as HTMLInputElement;
      const skewXSlider = screen.getByRole('slider', { name: /Skew X/ });
      const skewYSlider = screen.getByRole('slider', { name: /Skew Y/ });
      const trapezoidSlider = screen.getByRole('slider', { name: /Trapezoid/ });
      const resizeXSlider = screen.getByRole('slider', { name: /Resize X/ });
      const resizeYSlider = screen.getByRole('slider', { name: /Resize Y/ });
      const mirrorHButton = screen.getByTitle('Mirror Horizontal');
      const mirrorVButton = screen.getByTitle('Mirror Vertical');

      rotateLeftButton.focus();
      expect(rotateLeftButton).toHaveFocus();

      await user.tab();
      expect(rotate180Button).toHaveFocus();

      await user.tab();
      expect(rotateRightButton).toHaveFocus();

      await user.tab();
      expect(rotateSlider).toHaveFocus();

      await user.tab();
      expect(skewXSlider).toHaveFocus();

      await user.tab();
      expect(skewYSlider).toHaveFocus();

      await user.tab();
      expect(trapezoidSlider).toHaveFocus();

      await user.tab();
      expect(resizeXSlider).toHaveFocus();

      await user.tab();
      expect(resizeYSlider).toHaveFocus();

      await user.tab();
      expect(mirrorHButton).toHaveFocus();

      await user.tab();
      expect(mirrorVButton).toHaveFocus();

      await user.tab();
      expect(document.body).toHaveFocus();

      await user.tab({ shift: true });
      expect(mirrorVButton).toHaveFocus();
    });

    it('allows arrow key navigation on rotate slider', () => {
      render(<Transform />);
      const rotateSlider = document.getElementById('rotate-slider') as HTMLInputElement;

      rotateSlider.focus();
      expect(rotateSlider).toHaveFocus();
      expect(rotateSlider.type).toBe('range');
      expect(rotateSlider.min).toBe('-90');
      expect(rotateSlider.max).toBe('90');
      expect(Number(rotateSlider.value)).toBe(0);

      pressArrowOnRange(rotateSlider, 'ArrowRight');
      expect(previewArgs().toolArgs.rotate).toBe(1);
      expect(previewArgs().toolArgs.trapezoid).toBe(0);

      pressArrowOnRange(rotateSlider, 'ArrowLeft');
      expect(previewArgs().toolArgs.rotate).toBe(-1);
    });

    it('allows arrow key navigation on skew sliders', () => {
      render(<Transform />);
      const skewXSlider = screen.getByRole('slider', { name: /Skew X/ }) as HTMLInputElement;
      const skewYSlider = screen.getByRole('slider', { name: /Skew Y/ }) as HTMLInputElement;

      skewXSlider.focus();
      expect(skewXSlider).toHaveFocus();
      expect(Number(skewXSlider.value)).toBe(0);

      pressArrowOnRange(skewXSlider, 'ArrowRight');
      expect(previewArgs().toolArgs.skewX).toBe(1);

      pressArrowOnRange(skewXSlider, 'ArrowLeft');
      expect(previewArgs().toolArgs.skewX).toBe(-1);

      skewYSlider.focus();
      expect(skewYSlider).toHaveFocus();
      expect(Number(skewYSlider.value)).toBe(0);

      pressArrowOnRange(skewYSlider, 'ArrowUp');
      expect(previewArgs().toolArgs.skewY).toBe(1);

      pressArrowOnRange(skewYSlider, 'ArrowDown');
      expect(previewArgs().toolArgs.skewY).toBe(-1);
    });

    it('allows arrow key navigation on trapezoid slider', () => {
      render(<Transform />);
      const trapezoidSlider = screen.getByRole('slider', { name: /Trapezoid/ }) as HTMLInputElement;

      trapezoidSlider.focus();
      expect(trapezoidSlider).toHaveFocus();
      expect(Number(trapezoidSlider.value)).toBe(0);

      pressArrowOnRange(trapezoidSlider, 'ArrowRight');
      expect(previewArgs().toolArgs).toEqual(expect.objectContaining({ trapezoid: 1 }));

      pressArrowOnRange(trapezoidSlider, 'ArrowLeft');
      expect(previewArgs().toolArgs.trapezoid).toBe(-1);
    });

    it('allows arrow key navigation on resize sliders', () => {
      render(<Transform />);
      const resizeXSlider = screen.getByRole('slider', { name: /Resize X/ }) as HTMLInputElement;
      const resizeYSlider = screen.getByRole('slider', { name: /Resize Y/ }) as HTMLInputElement;

      resizeXSlider.focus();
      expect(resizeXSlider).toHaveFocus();
      expect(Number(resizeXSlider.value)).toBe(100);

      pressArrowOnRange(resizeXSlider, 'ArrowRight');
      expect(previewArgs().toolArgs.resizeX).toBe(101);

      pressArrowOnRange(resizeXSlider, 'ArrowLeft');
      expect(previewArgs().toolArgs.resizeX).toBe(99);

      resizeYSlider.focus();
      expect(resizeYSlider).toHaveFocus();
      expect(Number(resizeYSlider.value)).toBe(100);

      pressArrowOnRange(resizeYSlider, 'ArrowUp');
      expect(previewArgs().toolArgs.resizeY).toBe(101);

      pressArrowOnRange(resizeYSlider, 'ArrowDown');
      expect(previewArgs().toolArgs.resizeY).toBe(99);
    });

    it('allows enter/space to trigger rotate buttons', async () => {
      const user = userEvent.setup();
      render(<Transform />);
      const rotateLeftButton = screen.getByTitle('Rotate 90° Left');
      const rotate180Button = screen.getByTitle('Rotate 180°');
      const rotateRightButton = screen.getByTitle('Rotate 90° Right');

      rotateLeftButton.focus();
      await user.keyboard('{Enter}');
      expect(previewArgs().toolArgs.rotate).toBe(270);

      rotate180Button.focus();
      await user.keyboard(' ');
      expect(previewArgs().toolArgs.rotate).toBe(180);

      rotateRightButton.focus();
      await user.keyboard('{Enter}');
      expect(previewArgs().toolArgs.rotate).toBe(90);

      expect(mockTempUpdateLayer).toHaveBeenCalledTimes(3);
      expect(mockSetToolArgs).toHaveBeenCalledTimes(3);
    });

    it('allows enter/space to toggle mirror buttons', async () => {
      const user = userEvent.setup();
      render(<Transform />);
      const mirrorHButton = screen.getByTitle('Mirror Horizontal');
      const mirrorVButton = screen.getByTitle('Mirror Vertical');

      mirrorHButton.focus();
      await user.keyboard('{Enter}');
      expect(previewArgs().toolArgs.mirrorH).toBe(true);
      expect(previewArgs().toolArgs.mirrorV).toBe(false);

      mirrorVButton.focus();
      await user.keyboard(' ');
      expect(previewArgs().toolArgs.mirrorV).toBe(true);

      expect(mockTempUpdateLayer).toHaveBeenCalledTimes(2);
    });

    it('escape key triggers the discard, with nothing focused to begin with', async () => {
      const user = userEvent.setup();
      render(<Transform />);

      // There is no discard control on the bar any more, so Escape is the only route and
      // it must work with focus wherever it happens to be — including on body, which is
      // where it lands after the last icon button.
      await user.keyboard('{Escape}');

      expect(mockCancelLayerPreview).toHaveBeenCalledTimes(1);
      expect(mockSetToolArgs).toHaveBeenLastCalledWith(resetArgs);
      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
    });

    it('escape key still discards when a control holds focus', async () => {
      const user = userEvent.setup();
      render(<Transform />);
      const mirrorVButton = screen.getByTitle('Mirror Vertical');

      mirrorVButton.focus();
      await user.keyboard('{Escape}');

      expect(mockSetToolArgs).toHaveBeenCalledWith(
        expect.objectContaining({
          rotate: 0,
          mirrorH: false,
          mirrorV: false,
          skewX: 0,
          skewY: 0,
          trapezoid: 0,
          resizeX: 100,
          resizeY: 100,
        })
      );
    });
  });
});
