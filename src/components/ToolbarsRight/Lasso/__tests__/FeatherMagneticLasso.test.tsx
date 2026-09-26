import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import FeatherMagneticLasso from '../FeatherMagneticLasso.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());
const patchToolArgsMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      activeSelectionId: null,
      canvasRef: { current: document.createElement('canvas') },
      selections: [],
      totalSize: { width: 800, height: 600 },
    },
    dispatchMock,
  ],
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: () => ({
      antiAlias: true,
      edgeContrast: 30,
      featherRadius: 12,
      frequency: 40,
      magneticWidth: 18,
      previewFeather: true,
      smoothing: 1.5,
      snapStrength: 0.85,
      toolName: 'feather-magnetic-lasso',
    }),
    patchToolArgs: patchToolArgsMock,
  }),
}));

describe('FeatherMagneticLasso toolbar', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    patchToolArgsMock.mockClear();
  });

  it('shows settings information in a portal tooltip when the info button is hovered', async () => {
    render(<FeatherMagneticLasso />);

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Feather Magnetic Lasso settings information' }));

    const tooltip = await screen.findByRole('tooltip');

    expect(tooltip.textContent).toContain('Feather Magnetic Lasso settings');
    expect(tooltip.textContent).toContain('Feather');
    expect(tooltip.textContent).toContain('Width');
    expect(tooltip.textContent).toContain('Preview feather');
    expect(document.body.contains(tooltip)).toBe(true);
  });

  it('pins settings information when the info button is clicked', async () => {
    render(<FeatherMagneticLasso />);

    fireEvent.click(screen.getByRole('button', { name: 'Feather Magnetic Lasso settings information' }));

    await waitFor(() => {
      expect(screen.getByRole('tooltip').textContent).toContain('copy output uses a feathered alpha mask');
    });
  });

  describe('keyboard navigation', () => {
    it('allows tab navigation through all focusable elements', () => {
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      const featherSlider = screen.getByLabelText(/Feather/);
      const widthSlider = screen.getByLabelText(/Width/);
      const contrastSlider = screen.getByLabelText(/Contrast/);
      const frequencySlider = screen.getByLabelText(/Frequency/);
      const snapSlider = screen.getByLabelText(/Snap/);
      const smoothSlider = screen.getByLabelText(/Smooth/);
      const antiAliasCheckbox = screen.getByRole('checkbox', { name: /Anti-alias/ });
      const previewFeatherCheckbox = screen.getByRole('checkbox', { name: /Preview feather/ });
      const copyButton = screen.getByRole('button', { name: 'Copy' });
      const pasteButton = screen.getByRole('button', { name: 'Paste' });
      const clearButton = screen.getByRole('button', { name: 'Clear' });
      const infoButton = screen.getByRole('button', { name: 'Feather Magnetic Lasso settings information' });

      featherSlider.focus();
      expect(featherSlider).toHaveFocus();

      userEvent.tab();
      expect(widthSlider).toHaveFocus();

      userEvent.tab();
      expect(contrastSlider).toHaveFocus();

      userEvent.tab();
      expect(frequencySlider).toHaveFocus();

      userEvent.tab();
      expect(snapSlider).toHaveFocus();

      userEvent.tab();
      expect(smoothSlider).toHaveFocus();

      userEvent.tab();
      expect(antiAliasCheckbox).toHaveFocus();

      userEvent.tab();
      expect(previewFeatherCheckbox).toHaveFocus();

      userEvent.tab();
      expect(copyButton).toHaveFocus();

      userEvent.tab();
      expect(pasteButton).toHaveFocus();

      userEvent.tab();
      expect(clearButton).toHaveFocus();

      userEvent.tab();
      expect(infoButton).toHaveFocus();

      userEvent.tab({ shift: true });
      expect(clearButton).toHaveFocus();
    });

    it('allows arrow key navigation on all sliders', () => {
      render(<FeatherMagneticLasso />);
      const featherSlider = screen.getByLabelText(/Feather/);
      const widthSlider = screen.getByLabelText(/Width/);
      const contrastSlider = screen.getByLabelText(/Contrast/);
      const frequencySlider = screen.getByLabelText(/Frequency/);
      const snapSlider = screen.getByLabelText(/Snap/);
      const smoothSlider = screen.getByLabelText(/Smooth/);

      featherSlider.focus();
      const initialFeather = Number(featherSlider.value);
      fireEvent.keyDown(featherSlider, { key: 'ArrowRight' });
      expect(Number(featherSlider.value)).toBeGreaterThan(initialFeather);

      widthSlider.focus();
      const initialWidth = Number(widthSlider.value);
      fireEvent.keyDown(widthSlider, { key: 'ArrowLeft' });
      expect(Number(widthSlider.value)).toBeLessThan(initialWidth);

      contrastSlider.focus();
      const initialContrast = Number(contrastSlider.value);
      fireEvent.keyDown(contrastSlider, { key: 'ArrowUp' });
      expect(Number(contrastSlider.value)).toBeGreaterThan(initialContrast);

      frequencySlider.focus();
      const initialFrequency = Number(frequencySlider.value);
      fireEvent.keyDown(frequencySlider, { key: 'ArrowDown' });
      expect(Number(frequencySlider.value)).toBeLessThan(initialFrequency);

      snapSlider.focus();
      const initialSnap = Number(snapSlider.value);
      fireEvent.keyDown(snapSlider, { key: 'ArrowRight' });
      expect(Number(snapSlider.value)).toBeGreaterThan(initialSnap);

      smoothSlider.focus();
      const initialSmooth = Number(smoothSlider.value);
      fireEvent.keyDown(smoothSlider, { key: 'ArrowLeft' });
      expect(Number(smoothSlider.value)).toBeLessThan(initialSmooth);
    });

    it('allows space/enter to toggle checkboxes', () => {
      render(<FeatherMagneticLasso />);
      const antiAliasCheckbox = screen.getByRole('checkbox', { name: /Anti-alias/ });
      const previewFeatherCheckbox = screen.getByRole('checkbox', { name: /Preview feather/ });

      antiAliasCheckbox.focus();
      expect(antiAliasCheckbox).toBeChecked();
      fireEvent.keyDown(antiAliasCheckbox, { key: ' ' });
      expect(antiAliasCheckbox).not.toBeChecked();

      previewFeatherCheckbox.focus();
      expect(previewFeatherCheckbox).toBeChecked();
      fireEvent.keyDown(previewFeatherCheckbox, { key: 'Enter' });
      expect(previewFeatherCheckbox).not.toBeChecked();
    });

    it('allows enter/space to trigger copy, paste, and clear buttons', () => {
      render(<FeatherMagneticLasso />);
      const copyButton = screen.getByRole('button', { name: 'Copy' });
      const pasteButton = screen.getByRole('button', { name: 'Paste' });
      const clearButton = screen.getByRole('button', { name: 'Clear' });

      copyButton.focus();
      fireEvent.keyDown(copyButton, { key: 'Enter' });

      pasteButton.focus();
      fireEvent.keyDown(pasteButton, { key: ' ' });

      clearButton.focus();
      fireEvent.keyDown(clearButton, { key: 'Enter' });

      expect(patchToolArgsMock).toHaveBeenCalled();
    });

    it('opens info tooltip on info button focus', () => {
      render(<FeatherMagneticLasso />);
      const infoButton = screen.getByRole('button', { name: 'Feather Magnetic Lasso settings information' });

      infoButton.focus();
      fireEvent.keyDown(infoButton, { key: 'Enter' });

      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      expect(screen.getByRole('tooltip').textContent).toContain('Feather Magnetic Lasso settings');
    });

    it('opens info tooltip on space key', () => {
      render(<FeatherMagneticLasso />);
      const infoButton = screen.getByRole('button', { name: 'Feather Magnetic Lasso settings information' });

      infoButton.focus();
      fireEvent.keyDown(infoButton, { key: ' ' });

      expect(screen.getByRole('tooltip')).toBeInTheDocument();
    });

    it('allows arrow key navigation within info tooltip', () => {
      render(<FeatherMagneticLasso />);
      const infoButton = screen.getByRole('button', { name: 'Feather Magnetic Lasso settings information' });

      infoButton.focus();
      fireEvent.keyDown(infoButton, { key: 'Enter' });

      const tooltip = screen.getByRole('tooltip');
      expect(tooltip).toBeInTheDocument();

      const firstSetting = tooltip.querySelector('dt');
      expect(firstSetting).toBeInTheDocument();
    });

    it('escape key closes info tooltip', () => {
      render(<FeatherMagneticLasso />);
      const infoButton = screen.getByRole('button', { name: 'Feather Magnetic Lasso settings information' });

      infoButton.focus();
      fireEvent.keyDown(infoButton, { key: 'Enter' });

      expect(screen.getByRole('tooltip')).toBeInTheDocument();

      fireEvent.keyDown(infoButton, { key: 'Escape' });

      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('tab key moves focus within open tooltip', () => {
      render(<FeatherMagneticLasso />);
      const infoButton = screen.getByRole('button', { name: 'Feather Magnetic Lasso settings information' });

      infoButton.focus();
      fireEvent.keyDown(infoButton, { key: 'Enter' });

      expect(screen.getByRole('tooltip')).toBeInTheDocument();

      const user = userEvent.setup();
      userEvent.tab();

      expect(screen.getByRole('tooltip')).toBeInTheDocument();
    });
  });
});
