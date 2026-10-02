import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * The app's unsaved-changes guard, from the outside.
 *
 * Until this existed, a spec that reached File > New or File > Open on a dirty document
 * had to install `page.once('dialog', …)` to get past the browser's native `confirm()` —
 * and Playwright AUTO-DISMISSES a dialog that has no listener, so a spec that simply
 * clicked the menu item silently got a no-op and could not tell the difference between
 * "the guard declined" and "the menu item is broken". Each site invented its own handler.
 *
 * The prompt is now the app's own modal (`src/components/ConfirmDialog`), so answering it
 * is an ordinary click and both answers are assertable. These helpers wait for the prompt
 * to appear before answering, so a spec cannot pass by racing a guard that never ran.
 */

export const discardPrompt = (page: Page): Locator => page.getByTestId('confirm-dialog');

/** The prompt's message, which is also the string the old native dialogs used verbatim. */
export const discardPromptMessage = (page: Page): Locator => page.getByTestId('confirm-dialog-message');

/**
 * Answers "Discard" and waits for the prompt to leave, so the action it was gating can
 * now proceed. Fails if the prompt never appeared — which is the point: a spec that
 * expected to be asked must not pass by never being asked.
 */
export async function acceptDiscardPrompt(page: Page): Promise<void> {
  await expect(discardPrompt(page), 'the unsaved-changes prompt was never shown').toBeVisible();
  await page.getByTestId('confirm-dialog-confirm-button').click();
  await expect(discardPrompt(page)).toHaveCount(0);
}

/** Answers "Cancel" and waits for the prompt to leave. The gated action must not happen. */
export async function declineDiscardPrompt(page: Page): Promise<void> {
  await expect(discardPrompt(page), 'the unsaved-changes prompt was never shown').toBeVisible();
  await page.getByTestId('confirm-dialog-cancel-button').click();
  await expect(discardPrompt(page)).toHaveCount(0);
}

/**
 * Asserts that nothing asked. Used where a spec is on a clean document and the claim is
 * that the guard stayed out of the way: no prompt may remain in the tree by the time the
 * gated action has completed, because nothing else would dismiss one.
 */
export async function expectNoDiscardPrompt(page: Page): Promise<void> {
  await expect(discardPrompt(page)).toHaveCount(0);
}
