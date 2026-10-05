import { useEffect, useRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Brush from '../../Brush/Brush.tsx';
import Pencil from '../../Pencil/Pencil.tsx';
import { PAINT_BLEND_MODES, PAINT_PRESETS, PAINT_SIZE_MAX, PAINT_SIZE_MIN } from '../../../../tools/brush.ts';
import { defaultSettings } from '../../../../tools/settings.ts';
import type { PaintToolArgs } from '../../../../tools/draw.ts';

const PREVIEW_WIDTH = 96;
const PREVIEW_HEIGHT = 48;

const storeState = vi.hoisted(() => ({
  color: '#000000',
  containerRef: { current: null as HTMLDivElement | null },
  totalSize: { width: 800, height: 600 },
}));

/**
 * The args object the mocked `useCurrentTool` seeds its `useState` from. A real
 * `patchToolArgs` publishes a new args object back into React state, so the readouts
 * and the preview repaint; a bare spy never does. Real `useState` (rather than
 * assigning a module variable) is what makes the repaint observable here, because the
 * repo compiles with `babel-plugin-react-compiler`, which memoizes a zero-prop
 * component. Mirrors `Draw/__tests__/Draw.test.tsx:17-50`.
 */
const toolState = vi.hoisted(() => ({ initial: null as unknown }));

const mockPatchToolArgs = vi.hoisted(() => vi.fn());
const mockSetToolArgs = vi.hoisted(() => vi.fn());
const pointerScale = vi.hoisted(() => ({ value: 1 }));

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState],
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', async () => {
  const { useState } = await import('react');
  return {
    useCurrentTool: () => {
      const [toolArgs, setArgs] = useState(toolState.initial);
      return {
        toolArgs,
        setToolArgs: (next: unknown) => {
          mockSetToolArgs(next);
          toolState.initial = next;
          setArgs(next);
        },
        getToolArgs: (name: string) => ((toolArgs as { toolName: string }).toolName === name ? toolArgs : null),
        patchToolArgs: (name: string, patch: unknown) => {
          mockPatchToolArgs(name, patch);
          const next = { ...(toolArgs as object), ...(patch as object), toolName: name };
          toolState.initial = next;
          setArgs(next);
        },
      };
    },
  };
});

vi.mock('../../../../hooks/usePointerPosition.ts', () => ({
  // `onResize` is invoked once per scale so the preview effect actually runs;
  // changing `pointerScale.value` and forcing a re-render notifies the component about
  // the new zoom level. Mirrors `Draw/__tests__/Draw.test.tsx:52-64`.
  usePointerPosition: ({ onResize }: { onResize?: (arg: { scale: number }) => void }) => {
    const notifiedScale = useRef<number | null>(null);
    useEffect(() => {
      if (notifiedScale.current === pointerScale.value) return;
      notifiedScale.current = pointerScale.value;
      onResize?.({ scale: pointerScale.value });
    });
    return { getLocalCoords: () => ({ x: 0, y: 0 }), isMouseDown: { current: false } };
  },
}));

const resetState = () => {
  storeState.color = '#000000';
  storeState.totalSize = { width: 800, height: 600 };
  pointerScale.value = 1;
};

const resetToolArgs = (toolName: 'brush' | 'pencil', overrides: Partial<PaintToolArgs> = {}) => {
  toolState.initial = { ...defaultSettings[toolName], ...overrides } as PaintToolArgs;
};

const lastPatch = () => mockPatchToolArgs.mock.lastCall as ['brush' | 'pencil', Record<string, unknown>] | undefined;

const getSizeSlider = () => screen.getByLabelText(/Size/) as HTMLInputElement;
const getOpacitySlider = () => screen.getByLabelText(/Opacity/) as HTMLInputElement;
const getSmoothingSlider = () => screen.getByLabelText(/Smoothing/) as HTMLInputElement;
const getModeSelect = () => screen.getByLabelText('Mode') as HTMLSelectElement;
const getPresetSelect = () => screen.getByLabelText('Brush Preset') as HTMLSelectElement;
const previewCanvas = () => document.querySelector('canvas') as HTMLCanvasElement;

const changeSize = (value: string) => fireEvent.change(getSizeSlider(), { target: { value } });
const changeOpacity = (value: string) => fireEvent.change(getOpacitySlider(), { target: { value } });
const changeSmoothing = (value: string) => fireEvent.change(getSmoothingSlider(), { target: { value } });
const changeMode = (value: string) => fireEvent.change(getModeSelect(), { target: { value } });
const changePreset = (value: string) => fireEvent.change(getPresetSelect(), { target: { value } });

/**
 * The global canvas context stub from `src/test/setup.ts` deliberately records
 * nothing about pixels, so the preview is asserted on the calls it made. Mirrors
 * `Draw/__tests__/Draw.test.tsx:163-175`.
 */
const capturePreviewContext = () => {
  const installed = vi.mocked(HTMLCanvasElement.prototype.getContext).getMockImplementation();
  if (!installed) throw new Error('the global canvas context stub from src/test/setup.ts is missing');

  const contexts: CanvasRenderingContext2D[] = [];
  const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(
    this: HTMLCanvasElement
  ) {
    const ctx = installed.call(this, '2d') as CanvasRenderingContext2D;
    contexts.push(ctx);
    return ctx;
  });

  return { spy, contexts, last: () => contexts[contexts.length - 1] };
};

describe.each([
  ['Brush', Brush, 'brush' as const],
  ['Pencil', Pencil, 'pencil' as const],
])('%s options bar', (_label, Component, toolName) => {
  beforeEach(() => {
    resetState();
    resetToolArgs(toolName);
    mockPatchToolArgs.mockClear();
    mockSetToolArgs.mockClear();
  });

  afterEach(() => {
    resetState();
  });

  it('renders every Photoshop paint control', () => {
    render(<Component />);

    expect(getPresetSelect()).toBeInTheDocument();
    expect(getSizeSlider()).toBeInTheDocument();
    expect(getModeSelect()).toBeInTheDocument();
    expect(getOpacitySlider()).toBeInTheDocument();
    expect(getSmoothingSlider()).toBeInTheDocument();
  });

  it('no longer renders the TODO placeholder it replaced', () => {
    render(<Component />);

    // The bar used to be `placeholderTool('Brush Tool', 'brush', false)`
    // (`src/tools/toolsMap.ts:72-81`), which rendered inert option chips and a
    // "TODO: tool behavior not implemented yet." description. Every one of those
    // chip names was a control the renderer could not honour, so their absence is
    // the assertion; only `Brush Preset` survives as a real picker.
    expect(screen.queryByText('TODO')).not.toBeInTheDocument();
    expect(screen.queryByText(/tool behavior not implemented/)).not.toBeInTheDocument();
    for (const dead of ['Flow', 'Airbrush', 'Symmetry', 'Auto Erase']) {
      expect(screen.queryByText(dead), dead).not.toBeInTheDocument();
    }
  });

  it('shows the seeded defaults in the readouts', () => {
    render(<Component />);

    const seeded = defaultSettings[toolName];
    expect(screen.getByText(`${seeded.lineWidth}px`)).toBeInTheDocument();
    expect(screen.getByText(`${Math.round(seeded.alpha * 100)}%`)).toBeInTheDocument();
    expect(screen.getByText(`${seeded.smoothing}%`)).toBeInTheDocument();
    expect(getModeSelect()).toHaveValue('source-over');
  });

  it('bounds Size, Opacity and Smoothing the way Photoshop does', () => {
    render(<Component />);

    expect(getSizeSlider()).toHaveAttribute('min', String(PAINT_SIZE_MIN));
    expect(getSizeSlider()).toHaveAttribute('max', String(PAINT_SIZE_MAX));
    expect(getSizeSlider()).toHaveAttribute('step', '1');
    for (const slider of [getOpacitySlider(), getSmoothingSlider()]) {
      expect(slider).toHaveAttribute('min', '0');
      expect(slider).toHaveAttribute('max', '100');
      expect(slider).toHaveAttribute('step', '1');
    }
  });

  describe('size slider', () => {
    it('publishes the exact line width and repaints the readout', () => {
      render(<Component />);
      expect(getSizeSlider()).toHaveValue(String(defaultSettings[toolName].lineWidth));

      changeSize('120');

      expect(mockPatchToolArgs).toHaveBeenCalledTimes(1);
      expect(lastPatch()).toEqual([toolName, { lineWidth: 120 }]);
      expect(screen.getByText('120px')).toBeInTheDocument();
    });

    it('accepts both range boundaries', () => {
      render(<Component />);

      changeSize(String(PAINT_SIZE_MIN));
      expect(lastPatch()?.[1]).toEqual({ lineWidth: PAINT_SIZE_MIN });

      changeSize(String(PAINT_SIZE_MAX));
      expect(lastPatch()?.[1]).toEqual({ lineWidth: PAINT_SIZE_MAX });
    });

    it('clamps a value the slider could not have produced', () => {
      render(<Component />);

      // A `<input type=range>` cannot be driven out of range from the UI, so this
      // pins the guard the handler carries for a value pasted or scripted in.
      changeSize('0');
      expect(lastPatch()?.[1]).toEqual({ lineWidth: PAINT_SIZE_MIN });

      changeSize('5000');
      expect(lastPatch()?.[1]).toEqual({ lineWidth: PAINT_SIZE_MAX });
    });
  });

  describe('opacity slider', () => {
    it('publishes opacity as the fraction the renderer consumes', () => {
      render(<Component />);

      changeOpacity('35');

      // `ctx.globalAlpha` takes a fraction, not a percentage
      // (`src/tools/draw.ts:35`), so the bar has to divide on the way out.
      expect(lastPatch()).toEqual([toolName, { alpha: 0.35 }]);
      expect(screen.getByText('35%')).toBeInTheDocument();
    });

    it('maps 0 and 100 onto a fully transparent and a fully opaque stroke', () => {
      render(<Component />);

      changeOpacity('0');
      expect(lastPatch()?.[1]).toEqual({ alpha: 0 });

      changeOpacity('100');
      expect(lastPatch()?.[1]).toEqual({ alpha: 1 });
    });
  });

  describe('smoothing slider', () => {
    it('publishes the percentage the sampled-path filter consumes', () => {
      render(<Component />);

      changeSmoothing('63');

      expect(lastPatch()).toEqual([toolName, { smoothing: 63 }]);
      expect(screen.getByText('63%')).toBeInTheDocument();
    });

    it('publishes an exact 0 rather than dropping the field', () => {
      render(<Component />);

      // `smoothStrokePoints` treats an absent value as 0
      // (`src/util/draw.ts:drawLine`), so a falsy check that dropped a 0 would be
      // invisible here and only show up as a stroke that would not stop smoothing.
      changeSmoothing('0');
      expect(lastPatch()).toEqual([toolName, { smoothing: 0 }]);
    });
  });

  describe('mode select', () => {
    it('offers every mode in PAINT_BLEND_MODES, in order, with Photoshop labels', () => {
      render(<Component />);

      const options = Array.from(getModeSelect().options);
      expect(options.map((option) => option.value)).toEqual(PAINT_BLEND_MODES.map((mode) => mode.value));
      expect(options.map((option) => option.textContent)).toEqual(PAINT_BLEND_MODES.map((mode) => mode.label));
      expect(options[0].value).toBe('source-over');
    });

    it('publishes a recognised mode', () => {
      render(<Component />);

      changeMode('multiply');

      expect(lastPatch()).toEqual([toolName, { blendMode: 'multiply' }]);
      expect(getModeSelect()).toHaveValue('multiply');
    });

    it('refuses a mode the renderer cannot composite', () => {
      render(<Component />);

      // `destination-out` is a valid `GlobalCompositeOperation` but not a paint mode,
      // and the layer seam would hand it straight to `ctx.globalCompositeOperation`.
      changeMode('destination-out');

      expect(mockPatchToolArgs).not.toHaveBeenCalled();
      expect(getModeSelect()).toHaveValue('source-over');
    });
  });

  describe('brush preset picker', () => {
    it('offers the tool own presets behind a Custom option', () => {
      render(<Component />);

      const options = Array.from(getPresetSelect().options);
      expect(options.map((option) => option.value)).toEqual(['', ...PAINT_PRESETS[toolName].map((p) => p.label)]);
      expect(options[0].textContent).toBe('Custom');
    });

    it('applies all four settings of the chosen preset at once', () => {
      render(<Component />);

      changePreset(PAINT_PRESETS[toolName][1].label);

      const preset = PAINT_PRESETS[toolName][1];
      expect(lastPatch()).toEqual([
        toolName,
        { lineWidth: preset.lineWidth, alpha: preset.alpha, smoothing: preset.smoothing, blendMode: preset.blendMode },
      ]);
      expect(screen.getByText(`${preset.lineWidth}px`)).toBeInTheDocument();
    });

    it('shows the preset that matches the current settings', () => {
      resetToolArgs(toolName, { ...PAINT_PRESETS[toolName][0], points: [] });
      render(<Component />);

      expect(getPresetSelect()).toHaveValue(PAINT_PRESETS[toolName][0].label);
    });

    it('falls back to Custom when a single setting has been edited away from the preset', () => {
      resetToolArgs(toolName, { ...PAINT_PRESETS[toolName][0], lineWidth: 37, points: [] });
      render(<Component />);

      expect(getPresetSelect()).toHaveValue('');
    });

    it('ignores the Custom option rather than resetting the settings', () => {
      render(<Component />);

      changePreset('');

      // `Custom` is the state the bar reports when the settings match no preset, not
      // an instruction. Re-applying a preset on it would be a silent way to lose
      // hand-tuned values.
      expect(mockPatchToolArgs).not.toHaveBeenCalled();
    });
  });

  describe('colour synchronisation', () => {
    it("mirrors the store's foreground colour into the tool args", () => {
      render(<Component />);
      expect(mockSetToolArgs).not.toHaveBeenCalled();

      storeState.color = '#ff0000';
      fireEvent.change(getSizeSlider(), { target: { value: '20' } });

      // Nothing else carries the store colour into a paint tool: the Draw bar's sync
      // effect (`src/components/ToolbarsRight/Draw/Draw.tsx:29-33`) is scoped to the
      // legacy pen, so without this the brush is frozen on its `#000000` default no
      // matter what the DesktopHeader swatch says.
      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
      expect((mockSetToolArgs.mock.lastCall?.[0] as PaintToolArgs).color).toBe('#ff0000');
    });

    it('does not write when the colour already matches', () => {
      resetToolArgs(toolName, { color: '#ff0000' });
      storeState.color = '#ff0000';
      render(<Component />);

      expect(mockSetToolArgs).not.toHaveBeenCalled();
    });
  });

  describe('preview canvas', () => {
    it('renders a fixed-size surface that repaints from the current settings', () => {
      const { spy } = capturePreviewContext();
      try {
        render(<Component />);

        const canvas = previewCanvas();
        expect(canvas.width).toBe(PREVIEW_WIDTH);
        expect(canvas.height).toBe(PREVIEW_HEIGHT);
        // The workspace canvas is located only by `data-testid="workspace-canvas"`
        // (`e2e/helpers/canvas-helpers.ts:174-186`) precisely so a positional lookup
        // cannot land on this one, so it must never claim an accessible name.
        expect(canvas).not.toHaveAttribute('aria-label');
        expect(canvas).not.toHaveAttribute('data-testid');
      } finally {
        spy.mockRestore();
      }
    });

    it('blits a stroke rendered by the same draw the commit uses', () => {
      const { spy, last } = capturePreviewContext();
      try {
        render(<Component />);

        // The stroke itself is rasterized into an `OffscreenCanvas` inside `draw`, so
        // the only thing observable on the preview canvas's own context is the blit of
        // that canvas. The stroke's geometry is pinned against the renderer in
        // `src/tools/__tests__/paint-tools.test.ts`; what matters here is that the bar
        // shows the real renderer's output rather than an approximation of it.
        const ctx = last();
        // The Paint bar clears the whole backing store in STORE units, not CSS units.
        // Asserting only that `clearRect` ran let a sub-rect (`width / 2`, a hardcoded `PREVIEW_WIDTH`)
        // through: at dpr 2 that leaves the right-hand half of every repaint holding the previous
        // stroke, and no other assertion here would notice. `canvas.width`/`canvas.height` are
        // read off the element rather than written as literals so the assertion stays dpr-correct.
        const canvas = previewCanvas();
        expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, canvas.width, canvas.height);
        // One blit, of the raster at the full store size, 1:1. Mirrors the Draw bar's pin in
        // `Draw/__tests__/Draw.test.tsx` — a destination of `PREVIEW_WIDTH / 2` would
        // shrink the thumbnail to half the control while every `canvas.width` assertion passed.
        expect(ctx.drawImage).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ width: canvas.width, height: canvas.height }),
          0,
          0,
          canvas.width,
          canvas.height
        );
        // Smoothing the stroke is sampled, not stamped, so the blit is scaled down
        // from a zoom-sized canvas into the fixed preview; smoothing quality is set
        // low deliberately, as in the Draw bar.
        expect(ctx.imageSmoothingEnabled).toBe(true);
        expect(ctx.imageSmoothingQuality).toBe('low');
      } finally {
        spy.mockRestore();
      }
    });

    it('re-blits the preview when the settings change', () => {
      const { spy, contexts } = capturePreviewContext();
      // `installCanvasContextStub` hands out a fresh mock context per `getContext`
      // call (`src/test/setup.ts:211-215`), so a repaint lands on a new object rather
      // than accumulating on the last one. Counted across all of them instead.
      const blits = () => contexts.reduce((total, ctx) => total + vi.mocked(ctx.drawImage).mock.calls.length, 0);
      try {
        render(<Component />);
        expect(blits()).toBe(1);

        changeSize('60');

        expect(blits()).toBeGreaterThan(1);
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('renders nothing when the tool is not the active one', () => {
    toolState.initial = { ...defaultSettings[toolName === 'brush' ? 'pencil' : 'brush'] };

    const { container } = render(<Component />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('the two paint bars are independent', () => {
  beforeEach(() => {
    resetState();
    resetToolArgs('brush');
    mockPatchToolArgs.mockClear();
  });

  it('never reads the other tool args', () => {
    // `getToolArgs` returns null for a tool that is not active, so a bar mounted
    // against the wrong args renders nothing rather than editing them.
    toolState.initial = defaultSettings.pencil;

    const { container } = render(<Brush />);

    expect(container).toBeEmptyDOMElement();
  });

  it('does not alias one tool settings object into the other', () => {
    const brushArgs = defaultSettings.brush;
    const pencilArgs = defaultSettings.pencil;

    expect(brushArgs).not.toBe(pencilArgs);
    expect(brushArgs.lineWidth).not.toBe(pencilArgs.lineWidth);
  });
});
