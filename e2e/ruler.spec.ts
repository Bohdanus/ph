import { expect, type Page, test } from './fixtures/extended-test';

import { acceptDiscardPrompt } from './helpers/discard-prompt';
import { clickToolButton, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';

import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';

/**
 * The Ruler is a PIXEL_FREE tool, so there is nothing here to assert about pixels. What this spec
 * proves instead is the wiring a unit test cannot reach: that the rail's `I` tile reaches a tool
 * whose area mounts, that a real pointer drag across the workspace canvas publishes readouts into
 * the real options bar, that the four gestures Adobe documents each do their own thing to a real
 * measurement, and that none of it makes the document dirty.
 *
 * The readouts are `<output>` elements carrying `data-testid="ruler-x"` and friends. They are
 * addressed by test id because they are readouts rather than controls — a control would be addressed
 * by its label — and `src/components/ToolbarsRight/Text/Text.tsx` sets a test id on a numeric input
 * for the same reason. No other options bar needs one: every other bar's assertions go through role
 * and accessible name, which is the stronger oracle where it is available.
 */
const readout = (page: Page, id: string) => page.getByTestId(id);

/** The ruler is selected and its readout bar is mounted. */
const expectRulerActive = async (page: Page) => {
  await expect(readout(page, 'ruler-d1'), 'the Ruler bar is the active tool').toBeVisible();
};

/**
 * The contain fit, read from the attributes `usePointerPosition` publishes on `workspace-container`.
 *
 * Needed because a fraction of the WORKSPACE is not a fraction of the DOCUMENT: the document is
 * letterboxed inside it, so a drag computed from the workspace box lands somewhere else entirely and
 * the eight-pixel endpoint radius then misses it. A test that presses "where the end should be" and
 * silently starts a fresh measurement instead is worse than no test, because the resize it was
 * checking still leaves a horizontal line behind and the angle assertion still passes.
 *
 * `e2e/crop-history.spec.ts` reads the same attributes for the same reason.
 */
type Fit = {
  scale: number;
  offsetX: number;
  offsetY: number;
  documentWidth: number;
  documentHeight: number;
  rectX: number;
  rectY: number;
};

const readFit = async (page: Page): Promise<Fit> => {
  const container = page.getByTestId('workspace-container');
  await expect(container).toHaveAttribute('data-fit-scale', /.+/);
  return await container.evaluate((node) => {
    const read = (name: string) => {
      const raw = node.getAttribute(name);
      if (raw === null) throw new Error(`the app published no ${name}`);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`${name} is not a number: ${raw}`);
      return value;
    };
    return {
      scale: read('data-fit-scale'),
      offsetX: read('data-fit-offset-x'),
      offsetY: read('data-fit-offset-y'),
      documentWidth: read('data-fit-document-width'),
      documentHeight: read('data-fit-document-height'),
      rectX: read('data-fit-rect-x'),
      rectY: read('data-fit-rect-y'),
    };
  });
};

/**
 * A viewport point `fx`/`fy` of the way across the DOCUMENT.
 *
 * Expressed as a fraction of the document rather than in document pixels, so a test written against
 * it does not encode the seed image's size and keeps working if that changes.
 */
const docAt = async (page: Page, fx: number, fy: number): Promise<{ x: number; y: number }> => {
  const fit = await readFit(page);
  return {
    x: fit.rectX + fit.offsetX + fit.documentWidth * fx * fit.scale,
    y: fit.rectY + fit.offsetY + fit.documentHeight * fy * fit.scale,
  };
};

/** Draws one pointer drag across the canvas, from one fraction to another. */
/**
 * Draws one pointer drag across the canvas.
 *
 * It takes NO modifier argument, deliberately. An earlier version accepted `init` and then discarded
 * it — `void init` to satisfy the unused-parameter lint — so the next test to write
 * `{ shiftKey: true }` here would run an UNCONSTRAINED drag and pass while asserting a constrained
 * one. A modifier is pressed with `page.keyboard.down` around the call, which is what every caller
 * does and what cannot be forgotten.
 */
const dragAcross = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
};

/**
 * Whether the app's own unload guard would raise a prompt if the tab were closed.
 *
 * The guard is `src/contexts/UnsavedChangesContext.tsx`: a `beforeunload` listener that calls
 * `event.preventDefault()` exactly when `hasDiscardableWork` says the document holds work. So
 * `defaultPrevented` on a dispatched cancelable `beforeunload` IS the app's answer, read through the
 * same handler the browser would call — which is why this does not reach into the store and re-derive
 * the rule, and cannot pass while the store and the guard disagree.
 *
 * `page.close({ runBeforeUnload: true })` would ask the same question but answers it by hanging on a
 * native dialog, which Playwright can only dismiss blindly and which no assertion can read.
 */
const unloadGuardArmed = (page: Page) =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

test.describe('the Ruler tool', () => {
  test.beforeEach(async ({ page }) => {
    // The app seeds a Blank document on load, so this waits for the document that already exists
    // rather than creating one: there is no "create" gesture to get wrong, and the composition
    // poll is what proves the canvas is live rather than merely present.
    await page.goto('/');
    await expect(page.getByTestId('workspace-canvas')).toBeVisible();
    await expect(page.getByTitle('Drag to reorder').filter({ hasText: 'Blank 1' })).toBeVisible();
  });

  test('reports a drag as X, Y, W, H, the angle and the length', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await clickToolButton(page, 'eyedropper');
    await openToolFlyout(page, 'eyedropper');
    await selectFromFlyout(page, { toolName: 'ruler', label: 'Ruler Tool' });
    await expectRulerActive(page);

    // Empty before anything is dragged, so a bar showing stale numbers fails here rather than
    // quietly satisfying the assertions below.
    await expect(readout(page, 'ruler-d1')).toHaveText('');

    await dragAcross(page, await docAt(page, 0.3, 0.3), await docAt(page, 0.3, 0.6));

    // A purely vertical drag is the one shape whose every readout is knowable in advance: W is
    // zero, A is a right angle, and H equals D1. The exact pixel values depend on the contain fit,
    // which is why the assertions are relational rather than literal.
    await expect(readout(page, 'ruler-w')).toHaveText('0 px');
    await expect(readout(page, 'ruler-a')).toHaveText('90°');
    await expect(readout(page, 'ruler-y')).not.toHaveText('');
    // H EQUALS D1, which is the one relational fact the vertical drag makes knowable, and which
    // `not.toHaveText('')` cannot express: a clamp or a length taken before the constraint could make
    // them disagree — or either could read `NaN px`, which is also not the empty string.
    // `textContent()` is nullable, and a null expectation would throw a TypeError that reads as a
    // crash rather than as the mismatch it is.
    const length = await readout(page, 'ruler-d1').textContent();
    expect(length, 'the drag produced a length to compare H against').not.toBeNull();
    await expect(readout(page, 'ruler-h')).toHaveText(length ?? '');
    // No protractor has been pulled out, so D2 is absent rather than zero.
    await expect(readout(page, 'ruler-d2')).toHaveText('');
  });

  test('MOVES the line by its body, and RESIZES it by an endpoint', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await clickToolButton(page, 'eyedropper');
    await openToolFlyout(page, 'eyedropper');
    await selectFromFlyout(page, { toolName: 'ruler', label: 'Ruler Tool' });

    // A diagonal, because the two gestures are told apart by the SHAPE they preserve: a move keeps
    // the line's angle and its length and changes only its position, a resize keeps one end put and
    // changes the angle.
    await dragAcross(page, await docAt(page, 0.3, 0.4), await docAt(page, 0.5, 0.5));
    const drawnX = await readout(page, 'ruler-x').textContent();
    const drawnY = await readout(page, 'ruler-y').textContent();
    const drawnAngle = await readout(page, 'ruler-a').textContent();
    const drawnLength = await readout(page, 'ruler-d1').textContent();
    const drawnWidth = await readout(page, 'ruler-w').textContent();

    // Adobe: "To move the line, place the pointer on the line away from either endpoint and drag the
    // line." Halfway along a line drawn from 0.3/0.4 to 0.5/0.5 is 0.4/0.45, which is on the line and
    // clear of both ends.
    await dragAcross(page, await docAt(page, 0.4, 0.45), await docAt(page, 0.4, 0.6));

    // A MOVE, and every part of that is checkable. The drag is vertical, so X is pinned by
    // construction — a redraw would have moved it, which is what separates the two possibilities.
    expect(await readout(page, 'ruler-a').textContent(), 'a move preserves the angle').toBe(drawnAngle);
    expect(await readout(page, 'ruler-d1').textContent(), 'a move preserves the length').toBe(drawnLength);
    expect(await readout(page, 'ruler-x').textContent(), 'a vertical move cannot change X').toBe(drawnX);
    expect(await readout(page, 'ruler-y').textContent(), 'a vertical move does change Y').not.toBe(drawnY);
    const movedY = await readout(page, 'ruler-y').textContent();

    // Adobe: "To resize the line, drag one end of an existing measuring line." A MOVE translates every
    // point of the line by the pointer's delta, so the far end of the 0.3/0.4 → 0.5/0.5 line is now at
    // 0.5/0.65 — the same +0.15 the drag applied. Releasing on the height the START now sits at, 0.55,
    // levels the line: a move could not turn a diagonal into a horizontal.
    await dragAcross(page, await docAt(page, 0.5, 0.65), await docAt(page, 0.55, 0.55));

    // The angle is the discriminator: a fresh measurement from (0.5, 0.65) would also read 0°, so it
    // is asserted together with the end that must NOT have moved — that fresh line would report
    // 0.65 as its origin instead.
    await expect(readout(page, 'ruler-a')).toHaveText('0°');
    expect(await readout(page, 'ruler-y').textContent(), 'a resize leaves the other end alone').toBe(movedY);
    // And the dragged end is the one that travelled, which is the other half of a resize.
    expect(await readout(page, 'ruler-w').textContent(), 'the dragged end moved').not.toBe(drawnWidth);
  });

  test('keeps X and Y pinned when a protractor leg is pulled from the START end', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await clickToolButton(page, 'eyedropper');
    await openToolFlyout(page, 'eyedropper');
    await selectFromFlyout(page, { toolName: 'ruler', label: 'Ruler Tool' });

    await dragAcross(page, await docAt(page, 0.3, 0.4), await docAt(page, 0.5, 0.4));
    const x = await readout(page, 'ruler-x').textContent();
    const y = await readout(page, 'ruler-y').textContent();

    // Alt-drag straight down from the line's own start point, which is Adobe's "Alt-drag at an angle
    // from one end of the measuring line" applied to the NEAR end.
    await page.keyboard.down('Alt');
    await dragAcross(page, await docAt(page, 0.3, 0.4), await docAt(page, 0.3, 0.6));
    await page.keyboard.up('Alt');

    // The leg exists, so A is the angle BETWEEN the legs and D2 is a length: a horizontal line with a
    // vertical leg off its left end is a right angle.
    await expect(readout(page, 'ruler-d2')).not.toHaveText('');
    await expect(readout(page, 'ruler-a')).toHaveText('90°');

    // And the origin has not moved. Reversing the endpoints to make `end` the vertex is the shorter
    // implementation and it silently swaps what X and Y mean at exactly this moment; the numbers here
    // are the same two the bar reported before the protractor was pulled.
    expect(await readout(page, 'ruler-x').textContent()).toBe(x);
    expect(await readout(page, 'ruler-y').textContent()).toBe(y);
  });

  test('clears the line on Clear, and greys the button while there is nothing to clear', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await clickToolButton(page, 'eyedropper');
    await openToolFlyout(page, 'eyedropper');
    await selectFromFlyout(page, { toolName: 'ruler', label: 'Ruler Tool' });

    // "GREYS the button" is half the name and was not checked: the assertion was `toBeDisabled` twice,
    // which a button that is disabled but not greyed satisfies. The greying is the `disabled:opacity-50`
    // on `CLEAR_CLASS`, so the style is what has to be asserted — a disabled button at full opacity is
    // still a live-looking control the user is invited to press.
    const clear = page.getByTestId('ruler-clear');
    await expect(clear).toBeDisabled();
    const greyedOpacity = await clear.evaluate((node) => Number(window.getComputedStyle(node).opacity));
    expect(greyedOpacity, 'a disabled Clear is dimmed, not merely inert').toBeLessThan(1);

    const box = (await page.getByTestId('workspace-canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 6 });
    await page.mouse.up();

    await expect(page.getByTestId('ruler-clear')).toBeEnabled();
    await page.getByTestId('ruler-clear').click();

    await expect(readout(page, 'ruler-d1')).toHaveText('');
    await expect(page.getByTestId('ruler-clear')).toBeDisabled();
  });

  test('records no history state, because a measuring line is nonprinting', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await clickToolButton(page, 'eyedropper');
    await openToolFlyout(page, 'eyedropper');
    await selectFromFlyout(page, { toolName: 'ruler', label: 'Ruler Tool' });

    await dragAcross(page, await docAt(page, 0.4, 0.4), await docAt(page, 0.6, 0.5));

    // THAT THE MEASUREMENT EXISTS, first. It used to come second, or rather not at all, and the test
    // passed with the `dragAcross` call deleted outright: Undo is already disabled on the seeded Blank
    // document, so a Ruler that draws nothing at all satisfies "records no history state" perfectly.
    // A precondition this blunt has to be stated, or the assertion after it means nothing.
    await expect(readout(page, 'ruler-d1'), 'the gesture produced a measurement').not.toHaveText('');

    // The History panel's Undo is the app's own statement about what an edit was. A measurement
    // that created a history state would enable it, and this is the assertion that would catch it.
    const undo = page.getByRole('button', { name: /undo/i }).first();
    await expect(undo).toBeDisabled();
  });

  test('the probe reports a drawn-on document as dirty, which is what makes the next test mean anything', async ({
    page,
  }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await clickToolButton(page, 'draw');
    await dragAcross(page, await docAt(page, 0.4, 0.4), await docAt(page, 0.6, 0.5));

    // An assertion that the guard stays SILENT is satisfied just as well by a guard that is broken, a
    // listener that was never attached, or a probe reading the wrong event — so the probe is proven to
    // report the guard ARMED here, on a document that really has been drawn on, before the test that
    // depends on it asserts anything about silence.
    expect(await unloadGuardArmed(page), 'a drawn stroke must arm the unload guard').toBe(true);
  });

  test('measuring does not arm the unload guard, through every gesture the tool has', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    // The BASELINE is read rather than assumed. Whether a freshly seeded document counts as dirty is
    // the app's policy about document replacement, not a property of the Ruler, and hardcoding
    // `false` here would make this test fail for that unrelated reason — or, worse, make a future
    // change to it look like a Ruler regression. What is claimed is the only thing that is about the
    // Ruler: measuring does not CHANGE it.
    const baseline = await unloadGuardArmed(page);

    await clickToolButton(page, 'eyedropper');
    await openToolFlyout(page, 'eyedropper');
    await selectFromFlyout(page, { toolName: 'ruler', label: 'Ruler Tool' });

    // A fresh measurement.
    await dragAcross(page, await docAt(page, 0.35, 0.4), await docAt(page, 0.55, 0.5));
    await expect(readout(page, 'ruler-d1')).not.toHaveText('');
    expect(await unloadGuardArmed(page), 'a measuring line is a nonprinting annotation').toBe(baseline);

    // A MOVE of that line, which is a second path through the tool area.
    await dragAcross(page, await docAt(page, 0.45, 0.45), await docAt(page, 0.45, 0.6));
    expect(await unloadGuardArmed(page), 'moving the line is still not an edit').toBe(baseline);

    // A protractor leg pulled out of an ENDPOINT, a third path. It has to be an endpoint and not the
    // body: an Alt-drag anywhere on the line but near an end falls through to a move, which is what
    // keeps "Alt-drag anywhere on the canvas" able to start a fresh measurement.
    await page.keyboard.down('Alt');
    await dragAcross(page, await docAt(page, 0.55, 0.65), await docAt(page, 0.55, 0.75));
    await page.keyboard.up('Alt');
    await expect(readout(page, 'ruler-d2')).not.toHaveText('');
    expect(await unloadGuardArmed(page), 'a protractor leg is still not an edit').toBe(baseline);

    // Switching away and back, because the line SURVIVES that — so surviving is not the same thing as
    // dirty, and a store that keyed the line off the document's dirty flag would make it one.
    //
    // Reached by KEYBOARD rather than by clicking the tile again: the I tile is the tile this tool
    // lives on, `I` selects its first entry and `Shift+I` cycles to the Ruler — the same two keys
    // the test below pins. A second `clickToolButton(page, 'eyedropper')` would depend on whether
    // the rail is currently showing that tile or has collapsed it into the three-dots menu, which is
    // a layout decision this test has no stake in.
    await clickToolButton(page, 'draw');
    await page.keyboard.press('i');
    await page.keyboard.press('Shift+I');
    await expect(readout(page, 'ruler-d1'), 'the line survived the tool switch').not.toHaveText('');
    expect(await unloadGuardArmed(page), 'a surviving line is still not an edit').toBe(baseline);
  });

  test('Shift+I cycles the I tile between the Eyedropper and the Ruler', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    await page.keyboard.press('i');
    await expect(page.getByRole('combobox', { name: 'Sample Size' }), 'a bare I selects the tile anchor').toBeVisible();

    await page.keyboard.press('Shift+I');
    await expectRulerActive(page);

    await page.keyboard.press('Shift+I');
    await expect(page.getByRole('combobox', { name: 'Sample Size' }), 'the cycle wraps').toBeVisible();
  });

  /**
   * The measuring line must not survive a document change, and the interesting case is the one
   * where the Ruler is NOT the active tool when the document changes.
   *
   * The line lives in a module store so that it can outlive the tool area's mount, which is what
   * makes Adobe's "selecting the Ruler tool causes it to be displayed" true at all. The cost of
   * that is that nothing inside the tool area is guaranteed to be mounted when the document under
   * the line is replaced — and the sync that discards it used to live there, so this exact
   * sequence carried the old line across: measure, switch tools, open a document, come back.
   *
   * The new document is given the SAME SIZE as the first on purpose. That is the harder half of the
   * key, because a size-only key cannot tell two equal-sized documents apart, and the app's own
   * blank seed is a fixed size so this is not an exotic setup — it is what a user gets by opening
   * two documents without resizing either.
   */
  test('a line measured on one document is gone when another document is opened', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await clickToolButton(page, 'eyedropper');
    await openToolFlyout(page, 'eyedropper');
    await selectFromFlyout(page, { toolName: 'ruler', label: 'Ruler Tool' });

    const box = (await page.getByTestId('workspace-canvas').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 6 });
    await page.mouse.up();
    await expect(readout(page, 'ruler-d1')).not.toHaveText('');

    // Leave the Ruler before the document changes, so the tool area is unmounted when it does.
    await page.keyboard.press('v');
    await expect(page.getByTestId('workspace-canvas')).toBeVisible();

    await page.getByTestId('header-file-menu-button').click();
    await page.getByTestId('header-file-new-button').click();
    await acceptDiscardPrompt(page);
    await expect(page.getByTestId('new-image-dialog')).toBeVisible();
    await page.getByTestId('new-image-dialog-submit-button').click();
    await expect(page.getByTestId('new-image-dialog')).toHaveCount(0);

    // Back to the Ruler. If the line survived, this bar reports the previous document's geometry.
    await page.keyboard.press('i');
    await page.keyboard.press('Shift+I');
    await expectRulerActive(page);
    await expect(readout(page, 'ruler-d1'), "the previous document's line must not be here").toHaveText('');
    await expect(readout(page, 'ruler-x')).toHaveText('');
  });

  test('dims every unimplemented tool in the rail flyouts, and no working one', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    // The graying is a visual claim, so this reads the COMPUTED FILTER rather than the class name:
    // a class that stopped applying would still satisfy a class-name assertion. The Pen tile is not
    // on the rail at this viewport — the rail folds a suffix of whole rows into its three-dots tile
    // — so it is reached the way a user reaches it, from that tile.
    const filterOfTile = (toolName: string) =>
      page.getByTestId(`tool-button-${toolName}`).evaluate((node) => window.getComputedStyle(node).filter);
    const filterOfRow = (toolName: string) =>
      page
        .getByTestId(new RegExp(`^tool-flyout-item-${toolName}-`))
        .first()
        .evaluate((node) => window.getComputedStyle(node).filter);

    await expect(await filterOfTile('eyedropper'), 'a working tile carries no filter').toBe('none');

    await clickToolButton(page, 'pen');
    await openToolFlyout(page, 'pen');

    await expect(await filterOfRow('pen'), 'an unimplemented row is dimmed').toContain('grayscale');
    await expect(await filterOfRow('freeform-pen'), 'an unimplemented row is dimmed').toContain('grayscale');
    await expect(await filterOfRow('convert-point'), 'an unimplemented row is dimmed').toContain('grayscale');
  });

  test('dims the Custom Shape row while leaving the working rows of its flyout alone', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    // The shape flyout's rows are all `name: 'shape'` with a `figure`, so the id half carries the
    // figure's label slug rather than a distinct tool name — the Custom Shape row is the only one
    // in that flyout with a name of its own.
    const filterOfId = (testId: string) =>
      page.getByTestId(testId).evaluate((node) => window.getComputedStyle(node).filter);

    await clickToolButton(page, 'shape');
    await openToolFlyout(page, 'shape');

    await expect(
      await filterOfId('tool-flyout-item-custom-shape-custom-shape-tool'),
      'Custom Shape is unimplemented'
    ).toContain('grayscale');
    await expect(await filterOfId('tool-flyout-item-shape-line-tool'), 'the Line tool works').toBe('none');
  });
});
