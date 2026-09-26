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

vi.mock('../../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    tempUpdateLayer: mockTempUpdateLayer,
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
    it('allows tab navigation through all focusable elements', () => {
      render(<Transform />);
      const user = userEvent.setup();

      const rotateLeftButton = screen.getByTitle('Rotate 90° Left');
      const rotate180Button = screen.getByTitle('Rotate 180°');
      const rotateRightButton = screen.getByTitle('Rotate 90° Right');
      const rotateSlider = screen.getByRole('slider', { name: /Rotate/ });
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

      userEvent.tab();
      expect(rotate180Button).toHaveFocus();

      userEvent.tab();
      expect(rotateRightButton).toHaveFocus();

      userEvent.tab();
      expect(rotateSlider).toHaveFocus();

      userEvent.tab();
      expect(skewXSlider).toHaveFocus();

      userEvent.tab();
      expect(skewYSlider).toHaveFocus();

      userEvent.tab();
      expect(trapezoidSlider).toHaveFocus();

      userEvent.tab();
      expect(resizeXSlider).toHaveFocus();

      userEvent.tab();
      expect(resizeYSlider).toHaveFocus();

      userEvent.tab();
      expect(mirrorHButton).toHaveFocus();

      userEvent.tab();
      expect(mirrorVButton).toHaveFocus();

      userEvent.tab();
      expect(resetAllButton).toHaveFocus();

      userEvent.tab();
      expect(applyButton).toHaveFocus();

      userEvent.tab();
      expect(cancelButton).toHaveFocus();

      userEvent.tab({ shift: true });
      expect(applyButton).toHaveFocus();
    });

    it('allows arrow key navigation on rotate slider', () => {
      render(<Transform />);
      const rotateSlider = screen.getByRole('slider', { name: /Rotate/ });

      rotateSlider.focus();
      const initialRotate = Number(rotateSlider.value);
      fireEvent.keyDown(rotateSlider, { key: 'ArrowRight' });
      expect(Number(rotateSlider.value)).toBeGreaterThan(initialRotate);

      fireEvent.keyDown(rotateSlider, { key: 'ArrowLeft' });
      expect(Number(rotateSlider.value)).toBe(initialRotate);
    });

    it('allows arrow key navigation on skew sliders', () => {
      render(<Transform />);
      const skewXSlider = screen.getByRole('slider', { name: /Skew X/ });
      const skewYSlider = screen.getByRole('slider', { name: /Skew Y/ });

      skewXSlider.focus();
      const initialSkewX = Number(skewXSlider.value);
      fireEvent.keyDown(skewXSlider, { key: 'ArrowRight' });
      expect(Number(skewXSlider.value)).toBeGreaterThan(initialSkewX);

      fireEvent.keyDown(skewXSlider, { key: 'ArrowLeft' });
      expect(Number(skewXSlider.value)).toBe(initialSkewX);

      skewYSlider.focus();
      const initialSkewY = Number(skewYSlider.value);
      fireEvent.keyDown(skewYSlider, { key: 'ArrowUp' });
      expect(Number(skewYSlider.value)).toBeGreaterThan(initialSkewY);

      fireEvent.keyDown(skewYSlider, { key: 'ArrowDown' });
      expect(Number(skewYSlider.value)).toBe(initialSkewY);
    });

    it('allows arrow key navigation on trapezoid slider', () => {
      render(<Transform />);
      const trapezoidSlider = screen.getByRole('slider', { name: /Trapezoid/ });

      trapezoidSlider.focus();
      const initialTrapezoid = Number(trapezoidSlider.value);
      fireEvent.keyDown(trapezoidSlider, { key: 'ArrowRight' });
      expect(Number(trapezoidSlider.value)).toBeGreaterThan(initialTrapezoid);

      fireEvent.keyDown(trapezoidSlider, { key: 'ArrowLeft' });
      expect(Number(trapezoidSlider.value)).toBe(initialTrapezoid);
    });

    it('allows arrow key navigation on resize sliders', () => {
      render(<Transform />);
      const resizeXSlider = screen.getByRole('slider', { name: /Resize X/ });
      const resizeYSlider = screen.getByRole('slider', { name: /Resize Y/ });

      resizeXSlider.focus();
      const initialResizeX = Number(resizeXSlider.value);
      fireEvent.keyDown(resizeXSlider, { key: 'ArrowRight' });
      expect(Number(resizeXSlider.value)).toBeGreaterThan(initialResizeX);

      fireEvent.keyDown(resizeXSlider, { key: 'ArrowLeft' });
      expect(Number(resizeXSlider.value)).toBe(initialResizeX);

      resizeYSlider.focus();
      const initialResizeY = Number(resizeYSlider.value);
      fireEvent.keyDown(resizeYSlider, { key: 'ArrowUp' });
      expect(Number(resizeYSlider.value)).toBeGreaterThan(initialResizeY);

      fireEvent.keyDown(resizeYSlider, { key: 'ArrowDown' });
      expect(Number(resizeYSlider.value)).toBe(initialResizeY);
    });

    it('allows enter/space to trigger rotate buttons', () => {
      render(<Transform />);
      const rotateLeftButton = screen.getByTitle('Rotate 90° Left');
      const rotate180Button = screen.getByTitle('Rotate 180°');
      const rotateRightButton = screen.getByTitle('Rotate 90° Right');

      rotateLeftButton.focus();
      fireEvent.keyDown(rotateLeftButton, { key: 'Enter' });

      rotate180Button.focus();
      fireEvent.keyDown(rotate180Button, { key: ' ' });

      rotateRightButton.focus();
      fireEvent.keyDown(rotateRightButton, { key: 'Enter' });

      expect(mockTempUpdateLayer).toHaveBeenCalledTimes(3);
    });

    it('allows enter/space to toggle mirror buttons', () => {
      render(<Transform />);
      const mirrorHButton = screen.getByTitle('Mirror Horizontal');
      const mirrorVButton = screen.getByTitle('Mirror Vertical');

      mirrorHButton.focus();
      fireEvent.keyDown(mirrorHButton, { key: 'Enter' });

      mirrorVButton.focus();
      fireEvent.keyDown(mirrorVButton, { key: ' ' });

      expect(mockTempUpdateLayer).toHaveBeenCalledTimes(2);
    });

    it('allows enter/space to trigger reset all, apply, and cancel buttons', () => {
      render(<Transform />);
      const resetAllButton = screen.getByText('Reset All');
      const applyButton = screen.getByText('Apply');
      const cancelButton = screen.getByText('Cancel');

      resetAllButton.focus();
      fireEvent.keyDown(resetAllButton, { key: 'Enter' });

      applyButton.focus();
      fireEvent.keyDown(applyButton, { key: ' ' });

      cancelButton.focus();
      fireEvent.keyDown(cancelButton, { key: 'Enter' });

      expect(mockTempUpdateLayer).toHaveBeenCalled();
    });

    it('escape key triggers cancel', () => {
      render(<Transform />);
      const cancelButton = screen.getByText('Cancel');

      cancelButton.focus();
      fireEvent.keyDown(cancelButton, { key: 'Escape' });

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
