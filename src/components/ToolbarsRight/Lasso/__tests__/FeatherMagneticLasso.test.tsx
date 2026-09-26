import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import FeatherMagneticLasso from '../FeatherMagneticLasso.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());
const patchToolArgsMock = vi.hoisted(() => vi.fn());
const clipboardMock = vi.hoisted(() => ({
  activeSelection: null as { id: string; geometry: string } | null,
  hasSelectionClipboard: false,
  copyActiveSelection: vi.fn(),
  layerViaCopy: vi.fn(),
  pasteSelectionClipboard: vi.fn(),
}));

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

vi.mock('../../../../contexts/useSelectionClipboard.ts', () => ({
  useSelectionClipboard: () => ({
    activeSelection: clipboardMock.activeSelection,
    copyActiveSelection: clipboardMock.copyActiveSelection,
    hasActiveSelection: clipboardMock.activeSelection !== null,
    hasSelectionClipboard: clipboardMock.hasSelectionClipboard,
    layerViaCopy: clipboardMock.layerViaCopy,
    pasteSelectionClipboard: clipboardMock.pasteSelectionClipboard,
    selectionClipboard: clipboardMock.hasSelectionClipboard ? { id: 'clipboard-1' } : null,
  }),
}));

const INFO_BUTTON_NAME = 'Feather Magnetic Lasso settings information';
const SETTING_LABELS = ['Feather', 'Width', 'Contrast', 'Frequency', 'Snap', 'Smooth', 'Anti-alias', 'Preview feather'];
// The toolbar keeps the info tooltip mounted for 120ms after focus/hover leaves the button.
const TOOLTIP_CLOSE_DELAY_MS = 200;

const setClipboardState = (
  state: { activeSelection?: { id: string; geometry: string } | null; hasClipboard?: boolean } = {}
) => {
  clipboardMock.activeSelection = state.activeSelection ?? null;
  clipboardMock.hasSelectionClipboard = state.hasClipboard ?? false;
};

const getInfoButton = () => screen.getByRole('button', { name: INFO_BUTTON_NAME });
const getSlider = (name: RegExp) => screen.getByRole('slider', { name }) as HTMLInputElement;
const getCheckbox = (name: RegExp) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

const focusElement = (element: HTMLElement) => {
  act(() => {
    element.focus();
  });
};

const waitOutTooltipCloseDelay = async () => {
  await act(async () => {
    await new Promise((resolve) => {
      window.setTimeout(resolve, TOOLTIP_CLOSE_DELAY_MS);
    });
  });
};

describe('FeatherMagneticLasso toolbar', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    patchToolArgsMock.mockClear();
    clipboardMock.copyActiveSelection.mockClear();
    clipboardMock.layerViaCopy.mockClear();
    clipboardMock.pasteSelectionClipboard.mockClear();
    setClipboardState();
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
    it('moves focus through every enabled control in visual order', async () => {
      setClipboardState({ activeSelection: { id: 'sel-1', geometry: 'lasso' }, hasClipboard: true });
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      const expectedStops = [
        getInfoButton(),
        getSlider(/^Feather/),
        getSlider(/^Width/),
        getSlider(/^Contrast/),
        getSlider(/^Frequency/),
        getSlider(/^Snap/),
        getSlider(/^Smooth/),
        getCheckbox(/Anti-alias/),
        getCheckbox(/Preview feather/),
        screen.getByRole('button', { name: 'Copy' }),
        screen.getByRole('button', { name: 'Paste' }),
        screen.getByRole('button', { name: 'Clear' }),
      ];

      expect(document.body).toHaveFocus();

      for (const stop of expectedStops) {
        await user.tab();
        expect(stop).toHaveFocus();
      }

      await user.tab();
      expect(document.body).toHaveFocus();

      await user.tab({ shift: true });
      expect(expectedStops[expectedStops.length - 1]).toHaveFocus();
    });

    it('skips the disabled copy, paste, and clear buttons while tabbing', async () => {
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Paste' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();

      const expectedStops = [
        getInfoButton(),
        getSlider(/^Feather/),
        getSlider(/^Width/),
        getSlider(/^Contrast/),
        getSlider(/^Frequency/),
        getSlider(/^Snap/),
        getSlider(/^Smooth/),
        getCheckbox(/Anti-alias/),
        getCheckbox(/Preview feather/),
      ];

      for (const stop of expectedStops) {
        await user.tab();
        expect(stop).toHaveFocus();
      }

      // The last remaining stop is the Preview feather checkbox: the three disabled buttons
      // are skipped, so focus leaves the toolbar entirely.
      await user.tab();
      expect(document.body).toHaveFocus();
    });

    it('keeps focus on each slider and patches the matching setting for arrow key changes', async () => {
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      const sliderCases = [
        { name: /^Feather/, field: 'featherRadius', nextValue: '13', expected: 13 },
        { name: /^Width/, field: 'magneticWidth', nextValue: '19', expected: 19 },
        { name: /^Contrast/, field: 'edgeContrast', nextValue: '31', expected: 31 },
        { name: /^Frequency/, field: 'frequency', nextValue: '41', expected: 41 },
        { name: /^Snap/, field: 'snapStrength', nextValue: '0.86', expected: 0.86 },
        { name: /^Smooth/, field: 'smoothing', nextValue: '2', expected: 2 },
      ];

      for (const { name, field, nextValue, expected } of sliderCases) {
        const slider = getSlider(name);

        focusElement(slider);
        expect(slider).toHaveFocus();

        await user.keyboard('{ArrowRight}');
        // Neither jsdom nor user-event implements the browser default action for arrow keys on
        // <input type="range">, so emit the change event the browser would raise afterwards.
        fireEvent.change(slider, { target: { value: nextValue } });

        expect(patchToolArgsMock).toHaveBeenLastCalledWith('feather-magnetic-lasso', { [field]: expected });
        expect(slider).toHaveFocus();
      }
    });

    it('toggles the checkbox settings with the space key and not with enter', async () => {
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      const antiAliasCheckbox = getCheckbox(/Anti-alias/);
      const previewFeatherCheckbox = getCheckbox(/Preview feather/);
      expect(antiAliasCheckbox).toBeChecked();
      expect(previewFeatherCheckbox).toBeChecked();

      focusElement(antiAliasCheckbox);
      expect(antiAliasCheckbox).toHaveFocus();
      await user.keyboard(' ');

      expect(patchToolArgsMock).toHaveBeenLastCalledWith('feather-magnetic-lasso', { antiAlias: false });
      // The checkbox is controlled by the tool args, so it stays checked until the store updates.
      expect(antiAliasCheckbox).toBeChecked();

      await user.keyboard('{Enter}');
      expect(patchToolArgsMock).toHaveBeenCalledTimes(1);

      focusElement(previewFeatherCheckbox);
      expect(previewFeatherCheckbox).toHaveFocus();
      await user.keyboard(' ');

      expect(patchToolArgsMock).toHaveBeenLastCalledWith('feather-magnetic-lasso', { previewFeather: false });
    });

    it('activates copy, paste, and clear with enter and space', async () => {
      const activeSelection = { id: 'sel-1', geometry: 'lasso' };
      setClipboardState({ activeSelection, hasClipboard: true });
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      const copyButton = screen.getByRole('button', { name: 'Copy' });
      const pasteButton = screen.getByRole('button', { name: 'Paste' });
      const clearButton = screen.getByRole('button', { name: 'Clear' });
      expect(copyButton).toBeEnabled();
      expect(pasteButton).toBeEnabled();
      expect(clearButton).toBeEnabled();

      focusElement(copyButton);
      expect(copyButton).toHaveFocus();
      await user.keyboard('{Enter}');

      expect(clipboardMock.copyActiveSelection).toHaveBeenCalledWith(activeSelection);

      focusElement(pasteButton);
      expect(pasteButton).toHaveFocus();
      await user.keyboard(' ');

      expect(clipboardMock.pasteSelectionClipboard).toHaveBeenCalledTimes(1);

      focusElement(clearButton);
      expect(clearButton).toHaveFocus();
      await user.keyboard('{Enter}');

      expect(dispatchMock).toHaveBeenCalledWith({ type: 'CLEAR_SELECTIONS' });
    });

    it('opens info tooltip on info button focus', async () => {
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      await user.tab();

      const infoButton = getInfoButton();
      expect(infoButton).toHaveFocus();

      const tooltip = await screen.findByRole('tooltip');
      expect(infoButton).toHaveAttribute('aria-expanded', 'true');
      expect(infoButton).toHaveAttribute('aria-describedby', tooltip.id);
      expect(within(tooltip).getByText('Feather Magnetic Lasso settings')).toBeInTheDocument();
    });

    it('keeps the info tooltip pinned when the info button is activated with the space key', async () => {
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      await user.tab();
      expect(getInfoButton()).toHaveFocus();

      await user.keyboard(' ');

      await user.tab();
      expect(getSlider(/^Feather/)).toHaveFocus();
      await waitOutTooltipCloseDelay();

      // Pinning keeps the tooltip mounted after focus leaves, unlike a focus/hover-only tooltip.
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
    });

    it('lists every setting in the tooltip without pulling focus off the info button', async () => {
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      await user.tab();
      const tooltip = await screen.findByRole('tooltip');

      await user.keyboard('{ArrowDown}');

      expect(getInfoButton()).toHaveFocus();
      expect(Array.from(tooltip.querySelectorAll('dt'), (term) => term.textContent)).toEqual(SETTING_LABELS);
      expect(tooltip.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')).toHaveLength(0);
    });

    it('ignores the escape key and closes the unpinned tooltip only after focus leaves the button', async () => {
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      await user.tab();
      expect(getInfoButton()).toHaveFocus();
      expect(screen.getByRole('tooltip')).toBeInTheDocument();

      await user.keyboard('{Escape}');

      // The toolbar registers no escape handler, so the tooltip stays open while the button keeps focus.
      expect(getInfoButton()).toHaveFocus();
      expect(screen.getByRole('tooltip')).toBeInTheDocument();

      await user.tab();
      expect(getSlider(/^Feather/)).toHaveFocus();
      await waitOutTooltipCloseDelay();

      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('tab key moves focus past the open tooltip', async () => {
      render(<FeatherMagneticLasso />);
      const user = userEvent.setup();

      await user.tab();
      const tooltip = await screen.findByRole('tooltip');
      expect(getInfoButton()).toHaveFocus();

      await user.tab();

      expect(getSlider(/^Feather/)).toHaveFocus();
      expect(tooltip.contains(document.activeElement)).toBe(false);
      await waitOutTooltipCloseDelay();

      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });
});
