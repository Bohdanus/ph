import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutosaveMetadata } from '../../contexts/autosave-storage.ts';
import AutoSaveRecoveryBanner from './AutoSaveRecoveryBanner.tsx';

const baseMetadata: AutosaveMetadata = {
  fileName: 'test.psd',
  documentId: 'doc-1',
  documentRevision: 1,
  branchRevision: 0,
  historyIndex: 0,
  toolName: 'reposition',
  color: '#000000',
  backgroundColor: '#ffffff',
  totalSize: { width: 800, height: 600 },
  documentFrame: { x: 0, y: 0, width: 800, height: 600 },
  savedAt: new Date('2026-10-09T10:00:00Z').getTime(),
};

const noop = () => Promise.resolve();

describe('AutoSaveRecoveryBanner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the recovery title and message', () => {
    render(<AutoSaveRecoveryBanner metadata={baseMetadata} recovering={false} onRecover={noop} onDismiss={noop} />);

    expect(screen.getByTestId('autosave-recovery-banner')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recovery Available' })).toBeInTheDocument();
    expect(screen.getByTestId('autosave-recovery-dismiss-button').textContent).toBe('Dismiss');
    expect(screen.getByTestId('autosave-recovery-recover-button').textContent).toBe('Recover');
  });

  it('formats the saved-at timestamp in the local time', () => {
    render(<AutoSaveRecoveryBanner metadata={baseMetadata} recovering={false} onRecover={noop} onDismiss={noop} />);

    const formatted = new Date(baseMetadata.savedAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(screen.getByText(`Saved at ${formatted}`)).toBeInTheDocument();
  });

  it('shows "Recovering..." and disables buttons while recovering', () => {
    render(<AutoSaveRecoveryBanner metadata={baseMetadata} recovering={true} onRecover={noop} onDismiss={noop} />);

    const recoverButton = screen.getByTestId('autosave-recovery-recover-button');
    const dismissButton = screen.getByTestId('autosave-recovery-dismiss-button');

    expect(recoverButton).toBeDisabled();
    expect(dismissButton).toBeDisabled();
    expect(recoverButton.textContent).toBe('Recovering...');
  });

  it('calls onRecover when the Recover button is clicked', async () => {
    const onRecover = vi.fn().mockResolvedValue(undefined);
    render(
      <AutoSaveRecoveryBanner metadata={baseMetadata} recovering={false} onRecover={onRecover} onDismiss={noop} />
    );

    fireEvent.click(screen.getByTestId('autosave-recovery-recover-button'));
    await waitFor(() => expect(onRecover).toHaveBeenCalledTimes(1));
  });

  it('calls onDismiss when the Dismiss button is clicked', async () => {
    const onDismiss = vi.fn().mockResolvedValue(undefined);
    render(
      <AutoSaveRecoveryBanner metadata={baseMetadata} recovering={false} onRecover={noop} onDismiss={onDismiss} />
    );

    fireEvent.click(screen.getByTestId('autosave-recovery-dismiss-button'));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
  });

  it('has role="alertdialog"', () => {
    render(<AutoSaveRecoveryBanner metadata={baseMetadata} recovering={false} onRecover={noop} onDismiss={noop} />);

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('displays the file name from metadata', () => {
    render(
      <AutoSaveRecoveryBanner
        metadata={{ ...baseMetadata, fileName: 'my-design.psd' }}
        recovering={false}
        onRecover={noop}
        onDismiss={noop}
      />
    );

    expect(screen.getByText('Recovery Available')).toBeInTheDocument();
  });
});
