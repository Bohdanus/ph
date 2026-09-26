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

vi.mock('../../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    tempUpdateLayer: mockTempUpdateLayer,
    cancelLayerPreview: mockCancelLayerPreview,
    commitDirtyTool: mockCommitDirtyTool,
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

describe('Transform toolbar', () => {
  beforeEach(() => {
    resetToolArgs();
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

  it('has Reset All button', () => {
    render(<Transform />);

    expect(screen.getByText('Reset All')).toBeInTheDocument();
  });

  it('rotate buttons are clickable without error', () => {
    render(<Transform />);

    fireEvent.click(screen.getByTitle('Rotate 90° Left'));
    fireEvent.click(screen.getByTitle('Rotate 180°'));
    fireEvent.click(screen.getByTitle('Rotate 90° Right'));
  });

  it('mirror buttons are clickable without error', () => {
    render(<Transform />);

    fireEvent.click(screen.getByTitle('Mirror Horizontal'));
    fireEvent.click(screen.getByTitle('Mirror Vertical'));
  });

  it('Reset All button is clickable without error', () => {
    render(<Transform />);

    fireEvent.click(screen.getByText('Reset All'));
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

    const lastPreviewArgs = () => mockTempUpdateLayer.mock.lastCall?.[0] as { toolArgs: Record<string, unknown> };

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
      const resetAllButton = screen.getByText('Reset All');
      const applyButton = screen.getByText('Apply');
      const cancelButton = screen.getByText('Cancel');

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
      expect(resetAllButton).toHaveFocus();

      await user.tab();
      expect(applyButton).toHaveFocus();

      await user.tab();
      expect(cancelButton).toHaveFocus();

      await user.tab({ shift: true });
      expect(applyButton).toHaveFocus();
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
      expect(lastPreviewArgs().toolArgs.rotate).toBe(1);
      expect(lastPreviewArgs().toolArgs.trapezoid).toBe(0);

      pressArrowOnRange(rotateSlider, 'ArrowLeft');
      expect(lastPreviewArgs().toolArgs.rotate).toBe(-1);
    });

    it('allows arrow key navigation on skew sliders', () => {
      render(<Transform />);
      const skewXSlider = screen.getByRole('slider', { name: /Skew X/ }) as HTMLInputElement;
      const skewYSlider = screen.getByRole('slider', { name: /Skew Y/ }) as HTMLInputElement;

      skewXSlider.focus();
      expect(skewXSlider).toHaveFocus();
      expect(Number(skewXSlider.value)).toBe(0);

      pressArrowOnRange(skewXSlider, 'ArrowRight');
      expect(lastPreviewArgs().toolArgs.skewX).toBe(1);

      pressArrowOnRange(skewXSlider, 'ArrowLeft');
      expect(lastPreviewArgs().toolArgs.skewX).toBe(-1);

      skewYSlider.focus();
      expect(skewYSlider).toHaveFocus();
      expect(Number(skewYSlider.value)).toBe(0);

      pressArrowOnRange(skewYSlider, 'ArrowUp');
      expect(lastPreviewArgs().toolArgs.skewY).toBe(1);

      pressArrowOnRange(skewYSlider, 'ArrowDown');
      expect(lastPreviewArgs().toolArgs.skewY).toBe(-1);
    });

    it('allows arrow key navigation on trapezoid slider', () => {
      render(<Transform />);
      const trapezoidSlider = screen.getByRole('slider', { name: /Trapezoid/ }) as HTMLInputElement;

      trapezoidSlider.focus();
      expect(trapezoidSlider).toHaveFocus();
      expect(Number(trapezoidSlider.value)).toBe(0);

      pressArrowOnRange(trapezoidSlider, 'ArrowRight');
      expect(lastPreviewArgs().toolArgs).toEqual(expect.objectContaining({ trapezoid: 1 }));

      pressArrowOnRange(trapezoidSlider, 'ArrowLeft');
      expect(lastPreviewArgs().toolArgs.trapezoid).toBe(-1);
    });

    it('allows arrow key navigation on resize sliders', () => {
      render(<Transform />);
      const resizeXSlider = screen.getByRole('slider', { name: /Resize X/ }) as HTMLInputElement;
      const resizeYSlider = screen.getByRole('slider', { name: /Resize Y/ }) as HTMLInputElement;

      resizeXSlider.focus();
      expect(resizeXSlider).toHaveFocus();
      expect(Number(resizeXSlider.value)).toBe(100);

      pressArrowOnRange(resizeXSlider, 'ArrowRight');
      expect(lastPreviewArgs().toolArgs.resizeX).toBe(101);

      pressArrowOnRange(resizeXSlider, 'ArrowLeft');
      expect(lastPreviewArgs().toolArgs.resizeX).toBe(99);

      resizeYSlider.focus();
      expect(resizeYSlider).toHaveFocus();
      expect(Number(resizeYSlider.value)).toBe(100);

      pressArrowOnRange(resizeYSlider, 'ArrowUp');
      expect(lastPreviewArgs().toolArgs.resizeY).toBe(101);

      pressArrowOnRange(resizeYSlider, 'ArrowDown');
      expect(lastPreviewArgs().toolArgs.resizeY).toBe(99);
    });

    it('allows enter/space to trigger rotate buttons', async () => {
      const user = userEvent.setup();
      render(<Transform />);
      const rotateLeftButton = screen.getByTitle('Rotate 90° Left');
      const rotate180Button = screen.getByTitle('Rotate 180°');
      const rotateRightButton = screen.getByTitle('Rotate 90° Right');

      rotateLeftButton.focus();
      await user.keyboard('{Enter}');
      expect(lastPreviewArgs().toolArgs.rotate).toBe(270);

      rotate180Button.focus();
      await user.keyboard(' ');
      expect(lastPreviewArgs().toolArgs.rotate).toBe(180);

      rotateRightButton.focus();
      await user.keyboard('{Enter}');
      expect(lastPreviewArgs().toolArgs.rotate).toBe(90);

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
      expect(lastPreviewArgs().toolArgs.mirrorH).toBe(true);
      expect(lastPreviewArgs().toolArgs.mirrorV).toBe(false);

      mirrorVButton.focus();
      await user.keyboard(' ');
      expect(lastPreviewArgs().toolArgs.mirrorV).toBe(true);

      expect(mockTempUpdateLayer).toHaveBeenCalledTimes(2);
    });

    it('allows enter/space to trigger reset all, apply, and cancel buttons', async () => {
      const user = userEvent.setup();
      render(<Transform />);
      const resetAllButton = screen.getByText('Reset All');
      const applyButton = screen.getByText('Apply');
      const cancelButton = screen.getByText('Cancel');

      resetAllButton.focus();
      await user.keyboard('{Enter}');
      expect(mockCancelLayerPreview).toHaveBeenCalledTimes(1);
      expect(mockSetToolArgs).toHaveBeenLastCalledWith(resetArgs);

      applyButton.focus();
      await user.keyboard(' ');
      expect(mockCommitDirtyTool).toHaveBeenCalledTimes(1);
      expect(mockSetToolArgs).toHaveBeenCalledTimes(1);

      cancelButton.focus();
      await user.keyboard('{Enter}');
      expect(mockCancelLayerPreview).toHaveBeenCalledTimes(2);
      expect(mockSetToolArgs).toHaveBeenLastCalledWith(resetArgs);
      expect(mockSetToolArgs).toHaveBeenCalledTimes(2);
    });

    it('escape key triggers cancel', async () => {
      const user = userEvent.setup();
      render(<Transform />);
      const cancelButton = screen.getByText('Cancel');

      cancelButton.focus();
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
