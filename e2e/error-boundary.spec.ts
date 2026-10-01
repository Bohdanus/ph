import { expect, test } from './fixtures/extended-test';

/**
 * `src/components/Common/ErrorBoundary.tsx` in a browser, which is the only environment where
 * the thing it exists to do can actually be observed.
 *
 * WHY THIS FILE EXISTS. `grep -rn "error-boundary" e2e/` returned zero hits before it. The
 * boundary is mounted twice in the real app (`src/App.tsx:92` and `:100`), publishes five
 * `data-testid`s, and has thirteen unit tests — every one of them in jsdom, where the throw that
 * reaches a boundary is thrown by a component the test itself renders. So the whole suite proved
 * that a boundary catches a throw and never proved that the boundary AS MOUNTED catches a throw
 * FROM THE REAL EDITOR. Those are different claims. The second one is the one that matters, and
 * it was untested: if the Canvas boundary were mounted in the wrong place, or with a label the
 * heading does not derive from, or reading the wrong store field, every jsdom test would still
 * pass and the app would still white-screen.
 *
 * THE TRIGGER, and why it is not a mock of the thing under test. The fault is injected at the
 * PLATFORM: `HTMLCanvasElement.prototype.getContext` is made to answer `null` for exactly one
 * element, the one carrying `data-testid="tool-overlay-canvas"`. Everything downstream is
 * production code, unmodified — the throw, the React error boundary, `getDerivedStateFromError`,
 * `componentDidCatch`, `ErrorBoundaryFallback`, its `useStore()` call, and every testid below.
 * The seam is chosen because it is a REAL unguarded line, not because it is convenient:
 * `src/components/Main/Main.tsx:143` asserts a 2D context with `!` and immediately dereferences
 * it on line 144 (`toolCtxRef.current.imageSmoothingEnabled = true`), inside the `useLayoutEffect`
 * that lives inside the `Canvas` boundary. Nine sibling call sites in the same codebase DO check
 * for the null — `src/contexts/layer-renderer.ts:120`, `src/contexts/raster-utils.ts:8`,
 * `src/contexts/useLayer.ts:181`, `src/contexts/materialization.ts:68`, `src/util/selection.ts:426`,
 * `src/hooks/useAnts.ts:61`, `src/hooks/useSelectionAnts.ts:91`, `src/hooks/useRect.ts:126`,
 * `src/components/Main/EyedropperToolArea.tsx:73` — which is precisely why a browser that
 * refuses a context is a real hazard here rather than a hypothetical one, and precisely why the
 * app's own redundancy decided not to guard this one. A narrower reading: the fault proves the
 * boundary CONTAINS this line. It does not prove that this line is the one a user is most likely
 * to hit, because that is not a question a test can answer.
 *
 * WHY NOT A FAULT-INJECTION HOOK. There is none to use. `src/` reads no query parameter, no
 * `location.search`, no `window` flag and no `import.meta.env` switch outside `import.meta.env.DEV`
 * (`src/components/DevStatusStrip/DevStatusStrip.tsx:62`), and `e2e/` had no `page.addInitScript`
 * call at all before this file. So there was no existing, app-blessed door to walk through, and
 * inventing a URL flag would mean editing application code — which is not this file's job and is
 * not a decision this file may take.
 *
 * WHAT A GREEN RUN DOES NOT PROVE. Four things, stated plainly rather than left to be assumed:
 *
 * 1. It does not prove the boundary would contain an arbitrary defect. It proves the boundary
 *    contains THIS throw, from THIS region, with THIS label. A boundary is only ever as good as
 *    the region it wraps; the region list is asserted here (the canvas is gone, the dock is not)
 *    precisely so the claim cannot drift into "the app never white-screens".
 * 2. It does not prove `durableStatus` can report `stale` or `unavailable`. Only `current` is
 *    observable in a browser, and the reason is in `src/contexts/StoreContext.tsx`: every
 *    transition that marks the shadow `stale` (`:477` SET_SIZE, `:491` SET_LAYERS, `:507`
 *    ADD_LAYER, `:539` BATCH_UPDATES) is either dispatched nowhere in production or is the save
 *    metadata write — and Save cannot be driven once the canvas is gone, because the dialog
 *    gathers its canvas from the refs the fallback just unmounted. So the status assertion below
 *    pins the testid's WIRING, not the full vocabulary of the store field. The full vocabulary is
 *    covered where it is reachable, in `src/contexts/__tests__/StoreContext.*` and the durable
 *    projection's own unit tests; a reader wanting `stale` must go there, not here.
 * 3. It does not prove per-error-code diagnostics render. The branch is real and asserted in the
 *    negative (the list is absent for an empty diagnostic list), but no diagnostic is reachable
 *    from the UI: the codes are produced by the legacy-to-durable converter
 *    (`src/contexts/history-adapter.ts:62-67`) and by the append boundary
 *    (`src/contexts/history-append.ts:88-102`), and every history entry the editor writes from
 *    the default blank document converts cleanly — the footer's own reader confirms it, since
 *    `src/components/DevStatusStrip/DevStatusStrip.tsx:26` returns `null` for `current` with no
 *    diagnostics and the strip is measurably absent from the DOM throughout this file's runs.
 *    Asserting a code here would mean asserting a mock of the store.
 * 4. It does not prove the catch is recoverable. The boundary is terminal by construction
 *    (`src/components/Common/ErrorBoundary.tsx:42-44`): there is no reset, so the fallback stays
 *    for the life of the page. Nothing here asserts otherwise.
 */

/**
 * Answers `null` for the tool overlay's 2D context and behaves normally for every other canvas on
 * the page, so the fault stays inside the `Canvas` boundary and does not become a whole-app
 * outage that would prove less about the boundary and more about the injection.
 *
 * The `data-testid` read is the narrowest seam available: it is the attribute
 * `src/components/Main/Main.tsx:260` puts on the exact element whose context line 143 asserts, so
 * the script cannot drift onto a different canvas when the canvas set changes.
 */
const denyToolOverlayTwoDimensionalContext = () => {
  const proto = HTMLCanvasElement.prototype;
  const original = proto.getContext;
  proto.getContext = function toolOverlayHasNo2DContext(
    this: HTMLCanvasElement,
    contextId: string,
    ...rest: unknown[]
  ): RenderingContext | null {
    if (this.dataset.testid === 'tool-overlay-canvas') return null;
    return (original as (...args: unknown[]) => RenderingContext | null).call(this, contextId, ...rest);
  } as typeof proto.getContext;
};

test.describe('ErrorBoundary: a throw from the canvas region', () => {
  test('publishes nothing at all while the canvas region is healthy', async ({ page }) => {
    // The negative case first, and it is not a formality. Every assertion below is about markup
    // that appears only after a catch, and markup that appears only after a catch is trivially
    // satisfiable by markup that is simply always there. Asserting the absence on a HEALTHY load
    // is what makes the positive assertions mean something: it proves the fallback is gated on a
    // real throw, and it proves the four FIXED testids are absent together (the fifth is the
    // per-code `error-boundary-diagnostic-${code}`, which cannot be named without a diagnostic and
    // is covered by the wildcard assertion in the fourth test), so a later reader who finds one of
    // them permanently in the DOM learns it from this test rather than from a green run that never
    // mentioned it.
    //
    // `hasImage` is true here because `BlankImageStarter` (`src/App.tsx:28-41`) creates the
    // 800x600 default document on mount, so the canvas region is fully rendered — the guarded
    // subtree is not merely present but exercised, which is the precondition for "nothing was
    // published" being a statement about the boundary rather than about an empty page.
    await page.goto('/');
    await expect(page.getByTestId('workspace-canvas')).toBeVisible();

    for (const testid of [
      'error-boundary-fallback',
      'error-boundary-message',
      'error-boundary-durable-status',
      'error-boundary-diagnostics',
    ]) {
      await expect(
        page.getByTestId(testid),
        `${testid} must not exist before anything throws, or every assertion below is vacuous`
      ).toHaveCount(0);
    }

    // The guarded subtree is really there, so the four absences above are about the boundary and
    // not about a blank document.
    await expect(page.getByTestId('tool-overlay-canvas')).toHaveCount(1);
    await expect(page.getByTestId('workspace-container')).toBeVisible();
  });

  test('replaces the canvas region, and only the canvas region, with the labelled fallback', async ({ page }) => {
    await page.addInitScript(denyToolOverlayTwoDimensionalContext);
    await page.goto('/');

    // `role="alert"` is asserted alongside visibility because it is the only thing that tells a
    // screen reader the canvas became unusable: a visible block of replacement text in a
    // `[grid-area:main]` cell is announced as nothing at all without it. jsdom asserts the
    // attribute exists; only a browser can show that the fallback is the announcement.
    const fallback = page.getByTestId('error-boundary-fallback');
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveAttribute('role', 'alert');

    // The heading is `${label} stopped working` with the label interpolated
    // (`src/components/Common/ErrorBoundary.tsx:50`), and the labels are what mount the boundaries
    // (`src/App.tsx:92` "Canvas", `:100` "Right sidebar"). Asserting the INTERPOLATED string rather
    // than the presence of an `h2` is the whole test: a fallback that rendered a constant heading
    // would pass every assertion a presence check makes, and a mislabelled boundary — the failure
    // that would leave an operator reading "App stopped working" for a canvas-only fault — would
    // ship green.
    await expect(fallback.getByRole('heading')).toHaveText('Canvas stopped working');

    // The message is the caught error's own `message`, not a canned apology, so it names the
    // unguarded line from the header comment: `Main.tsx:144` writes `imageSmoothingEnabled` onto
    // the context `Main.tsx:143` asserted non-null. Asserting the property name rather than the
    // full sentence is deliberate — V8 and SpiderMonkey word this TypeError differently — while
    // still being specific enough that a fallback showing `error.message` of something else, or a
    // hardcoded string, cannot pass.
    await expect(page.getByTestId('error-boundary-message')).toContainText('imageSmoothingEnabled');

    // The region is GONE, not covered. A fallback that merely painted over a live canvas would
    // leave all four canvas testids in the DOM and every pointer gesture would still reach a
    // document the operator has been told is unusable; `workspace-container` is included because
    // it is the grid cell itself and its removal is what actually frees the `[grid-area:main]`
    // track for the fallback.
    for (const testid of ['workspace-container', 'workspace-canvas', 'tool-overlay-canvas']) {
      await expect(
        page.getByTestId(testid),
        `${testid} belongs to the guarded subtree and must be unmounted once the boundary catches`
      ).toHaveCount(0);
    }

    // ...and the fallback took its place in that region, which is the other half of "replaced"
    // and the half a containment test cannot make on its own: unmounting the canvas without
    // rendering anything would satisfy every assertion above and leave a hole in the layout.
    await expect(fallback).toContainText('Durable document:');
  });

  test('reports the durable status the live store holds, read through the fallback', async ({ page }) => {
    await page.addInitScript(denyToolOverlayTwoDimensionalContext);
    await page.goto('/');
    await expect(page.getByTestId('error-boundary-fallback')).toBeVisible();

    // `ErrorBoundaryFallback` reads `durableStatus` off `useStore()`
    // (`src/components/Common/ErrorBoundary.tsx:47`) rather than off anything captured in
    // `getDerivedStateFromError`, and the value this asserts proves the read is live rather than
    // snapshotted: the throw happens in `Main`'s FIRST `useLayoutEffect`, where the store is
    // still at its initial `durableStatus: 'unavailable'` (`src/contexts/StoreContext.tsx:321`)
    // and `hasImage` is still false. `BlankImageStarter` then commits the default document from
    // OUTSIDE the boundary, and the store moves to `current`
    // (`src/contexts/StoreContext.tsx:364`). The fallback re-renders on that dispatch and reports
    // the new value, so a snapshot-at-catch implementation would print `unavailable` here and
    // fail. That is a stronger claim than "the testid exists".
    //
    // The `toHaveText` retry is load-bearing for the same reason: the fallback mounts one commit
    // before `BlankImageStarter`'s effect runs, so the first value observed is racy and only the
    // settled one is a fact about the app.
    await expect(page.getByTestId('error-boundary-durable-status')).toHaveText('Durable document: current');

    // What a green run does NOT prove, in the test that would otherwise be asked to prove it:
    // `stale` and `unavailable` are unreachable here, because every store transition that marks
    // them is either dispatched nowhere in production or is the save metadata write, and Save
    // cannot be driven once the canvas is gone. See the header comment. A future reader who adds
    // `'Durable document: stale'` to this test without a route to that state has added a test
    // that cannot fail honestly.
  });

  test('omits the diagnostics list when the store holds none, and keeps the store readable', async ({ page }) => {
    await page.addInitScript(denyToolOverlayTwoDimensionalContext);
    await page.goto('/');
    await expect(page.getByTestId('error-boundary-fallback')).toBeVisible();

    // The list is conditional on a non-empty diagnostic list
    // (`src/components/Common/ErrorBoundary.tsx:60`), so for the empty list this app actually
    // holds there is no `ul` and no `error-boundary-diagnostic-*` item. This is the honest half of
    // the per-error-code coverage and it is worth pinning, because the alternative branch —
    // rendering an empty `Diagnostic code: ` shell for a healthy document — is the kind of thing
    // that ships unnoticed.
    //
    // It is NOT the half that proves codes render. No diagnostic is reachable from the UI at all
    // (see the header comment), so there is nothing here to assert about a code's text or its
    // per-code testid, and inventing one would mean asserting a store mock.
    await expect(
      page.getByTestId('error-boundary-diagnostics'),
      'the diagnostics list is conditional on a non-empty diagnostic list, so it must be absent here'
    ).toHaveCount(0);
    await expect(page.locator('[data-testid^="error-boundary-diagnostic-"]')).toHaveCount(0);

    // The fallback survived its own throw, which is the only way to know the store reader above
    // did not throw a second time: `useStore()` is called inside the fallback, and a fallback
    // that crashed would take the whole grid cell with it. The footer's independent reader of the
    // same two fields (`src/components/DevStatusStrip/DevStatusStrip.tsx:18`) is mounted in the
    // footer, outside the boundary, and renders nothing here — which is what "current with no
    // diagnostics" looks like from the store's own point of view, and is an independent
    // confirmation of the status asserted in the previous test rather than a restatement of it.
    await expect(page.locator('footer')).toBeVisible();
    await expect(
      page.getByTestId('dev-status-strip'),
      'the footer reader returns null for `current` with no diagnostics (DevStatusStrip.tsx:26), so its ' +
        'absence corroborates the fallback status without being computed from it'
    ).toHaveCount(0);
  });

  test('leaves the rest of the editor mounted, interactive, and inside its own boundaries', async ({ page }) => {
    await page.addInitScript(denyToolOverlayTwoDimensionalContext);
    await page.goto('/');
    await expect(page.getByTestId('error-boundary-fallback')).toBeVisible();

    // "Does not white-screen" is the operator-facing claim, and it is only true if the FAILED
    // region is bounded rather than the app. So each surviving region is named by its own testid
    // rather than by a generic "body has text": the menu bar (`src/App.tsx:90`), the tool rail
    // (`src/App.tsx:91`, `src/components/SidebarLeft/SidebarLeft.tsx:1028`), the History and
    // Layers panels (`src/components/SidebarRight/SidebarRight.tsx`, `panel-group-history` and
    // `panel-group-layers`), and the footer (`src/App.tsx:106`, which also holds the durable
    // reader). `layers-list` with a `layer-row` in it is the sharpest of these: it means the
    // Layers panel is not merely mounted but holding the document the canvas just lost.
    await expect(page.getByTestId('header-file-menu-button')).toBeVisible();
    await expect(page.getByTestId('left-sidebar')).toBeVisible();
    await expect(page.getByTestId('panel-group-history')).toBeVisible();
    await expect(page.getByTestId('panel-group-layers')).toBeVisible();
    await expect(page.getByTestId('layers-list').getByTestId('layer-row').first()).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();

    // Mounted is not the same as usable, and only an interaction can tell them apart: a
    // surviving menu whose handlers were torn down with the canvas would satisfy every assertion
    // above. Opening the File menu is the cheapest honest liveness check available, because the
    // menu is outside both boundaries and its open state is driven entirely by its own React
    // state — no store write, no canvas, nothing that could be excused by the fault.
    //
    // `header-file-save-button` is the item to look for rather than `header-file-menu-button`,
    // because the menu is a toggle (`src/components/DesktopHeader/DesktopHeader.tsx:179`) and a
    // second click on the button would CLOSE it and make this assertion pass for the wrong
    // reason.
    await page.getByTestId('header-file-menu-button').click();
    await expect(page.getByTestId('header-file-save-button')).toBeVisible();

    // The SECOND boundary is the claim this test exists to make, and it is invisible in every
    // other assertion in the file: `src/App.tsx:100` wraps `SidebarRight` in its own
    // `ErrorBoundary label="Right sidebar"`, so the options bar and both dock panels must be
    // intact while the `Canvas` boundary is displaying its fallback. A single boundary above both
    // regions — or a boundary that had replaced more than its own subtree — would satisfy every
    // other assertion here and fail this one.
    await expect(page.getByTestId('dock-resize-handle')).toBeVisible();
    await expect(page.getByTestId('dock-splitter')).toBeVisible();
    await expect(page.locator('#size-slider')).toBeVisible();
  });
});
