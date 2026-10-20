import { expect, test } from './fixtures/extended-test';
import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';

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
 * PLATFORM: `HTMLCanvasElement.prototype.getContext` is made to THROW a `SecurityError` for
 * exactly one element, the one carrying `data-testid="tool-overlay-canvas"`. Everything
 * downstream is production code, unmodified — the throw, the React error boundary,
 * `getDerivedStateFromError`, `componentDidCatch`, `ErrorBoundaryFallback`, its `useStore()`
 * call, and every testid below. Nothing about the boundary, the fallback or the store is
 * stubbed, and there is no application code path added to make this reachable.
 *
 * THIS SEAM USED TO BE A REAL DEFECT, and the change is worth recording because it is the
 * difference between testing a mechanism and testing a bug. `Main.tsx` asserted a 2D context
 * with `!` and dereferenced it on the next line, inside the `useLayoutEffect` inside the
 * `Canvas` boundary, so a browser refusing that context threw a `TypeError` and lost the whole
 * canvas region. Nine sibling call sites already checked for the null — `src/contexts/
 * layer-renderer.ts:120`, `src/contexts/raster-utils.ts:8`, `src/contexts/useLayer.ts:181`,
 * `src/contexts/materialization.ts:68`, `src/util/selection.ts:426`, `src/hooks/useAnts.ts:61`,
 * `src/hooks/useSelectionAnts.ts:91`, `src/hooks/useRect.ts:126`,
 * `src/components/Main/EyedropperToolArea.tsx:73` — which is why a browser refusing a context
 * was a real hazard here. Both `Main.tsx` sites are now null-tolerant, because `toolCtxRef` is
 * declared `CanvasRenderingContext2D | null` and every tool area already handles the null case.
 *
 * So the null no longer throws, and borrowing it would have made this file green only while a
 * defect happened to exist. A boundary is a DEFENCE, and a defence has to be testable when
 * nothing is currently breaking it — so the failure is injected deliberately, at a platform
 * seam, in a shape the platform can genuinely produce. A narrower reading: this proves the
 * boundary CONTAINS a throw from the canvas region. It does not prove which real defect a user
 * is most likely to hit, because that is not a question a test can answer.
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
const throwOnToolOverlayTwoDimensionalContext = () => {
  const proto = HTMLCanvasElement.prototype;
  const original = proto.getContext;
  proto.getContext = function toolOverlay2DContextThrows(
    this: HTMLCanvasElement,
    contextId: string,
    ...rest: unknown[]
  ): RenderingContext | null {
    // Throwing, not returning null. `getContext` really does throw — a `SecurityError`
    // on a canvas whose origin or size makes a context unavailable is a documented
    // outcome — and that is the shape this file needs. Returning `null` was the original
    // seam here, back when `Main.tsx` dereferenced the result with `!` and turned the null
    // into a TypeError. That dereference is fixed, so a null no longer reaches a boundary
    // and the honest way to test a boundary is to inject the failure rather than borrow
    // a defect that no longer exists.
    if (this.dataset.testid === 'tool-overlay-canvas') {
      throw new DOMException('Injected fault: 2D context unavailable', 'SecurityError');
    }
    return (original as (...args: unknown[]) => RenderingContext | null).call(this, contextId, ...rest);
  } as typeof proto.getContext;
};

test.describe('ErrorBoundary: a throw from the canvas region', () => {
  test.describe.configure({ timeout: DEFAULT_TEST_TIMEOUT_MS });
  test('publishes nothing at all while the canvas region is healthy', async ({ page }) => {
    // The negative case first, and it is not a formality. Every assertion below is about markup
    // that appears only after a catch, and markup that appears only after a catch is trivially
    // satisfiable by markup that is simply always there. Asserting the absence on a HEALTHY load
    // is what makes the positive assertions mean something: it proves the fallback is gated on a
    // real throw, and it proves the four FIXED testids are absent together — three of them in the
    // loop below, `error-boundary-diagnostics` immediately after it (the fifth is the per-code
    // `error-boundary-diagnostic-${code}`, which cannot be named without a diagnostic and is
    // covered by the wildcard assertion in the fourth test) — so a later reader who finds one of
    // them permanently in the DOM learns it from this test rather than from a green run that never
    // mentioned it.
    //
    // `hasImage` is true here because `BlankImageStarter` (`src/App.tsx:28-41`) creates the
    // 800x600 default document on mount, so the canvas region is fully rendered — the guarded
    // subtree is not merely present but exercised, which is the precondition for "nothing was
    // published" being a statement about the boundary rather than about an empty page.
    await page.goto('/');
    await expect(page.getByTestId('workspace-canvas')).toBeVisible();

    for (const testid of ['error-boundary-fallback', 'error-boundary-message', 'error-boundary-durable-status']) {
      await expect(
        page.getByTestId(testid),
        `${testid} must not exist before anything throws, or every assertion below is vacuous`
      ).toHaveCount(0);
    }

    /**
     * `error-boundary-diagnostics` is split out of that loop because it is the one member with
     * no positive ANYWHERE in this file: the other three are asserted present by the three tests
     * below, so each of their absences is read against a positive in the same file, while this
     * testid is absent from every positive here and its only positive in the repository is
     * `ErrorBoundary.test.tsx` asserting it in jsdom with a hand-built store slice. It still
     * belongs in this test — nothing has thrown, so nothing may have published a diagnostics
     * list — but it is a different claim and it carries a different reason.
     */
    await expect(
      page.getByTestId('error-boundary-diagnostics'),
      'the diagnostics list is conditional on a non-empty diagnostic list, so it must not exist before anything ' +
        'throws either; its only positive in the repository is ErrorBoundary.test.tsx, which is why it is asserted ' +
        'here rather than folded into the loop above'
    ).toHaveCount(0);

    // The guarded subtree is really there, so the four absences above are about the boundary and
    // not about a blank document.
    await expect(page.getByTestId('tool-overlay-canvas')).toHaveCount(1);
    await expect(page.getByTestId('workspace-container')).toBeVisible();
  });

  test('replaces the canvas region, and only the canvas region, with the labelled fallback', async ({ page }) => {
    await page.addInitScript(throwOnToolOverlayTwoDimensionalContext);
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

    // The message is the caught error's own `message`, not a canned apology. Asserting the
    // injected fault's text is what makes that a test rather than a presence check: a fallback
    // rendering a hardcoded string would fail here, and a fallback reporting a DIFFERENT error
    // would fail here too. The string is this file's own, so it is asserted exactly — the
    // cross-engine-wording concern that applied to the old `TypeError` does not apply to a
    // `DOMException` message this file supplies.
    await expect(page.getByTestId('error-boundary-message')).toContainText('Injected fault: 2D context unavailable');

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
    await page.addInitScript(throwOnToolOverlayTwoDimensionalContext);
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
    await page.addInitScript(throwOnToolOverlayTwoDimensionalContext);
    await page.goto('/');
    const fallback = page.getByTestId('error-boundary-fallback');
    await expect(fallback).toBeVisible();

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
    //
    // The two positively-anchored siblings come FIRST, and that ordering is the point. Without
    // them the three absences below would be satisfied just as well by a fallback that rendered
    // none of its children at all; with them, the region is known to be rendering the message
    // and the status, so "no list, no items" is a statement about the conditional branch and not
    // about an empty fallback. Each of these two is asserted present by an earlier test as well,
    // so each of their absences in the healthy load is read against a positive.
    await expect(
      page.getByTestId('error-boundary-message'),
      'the fallback rendered its message, so what follows is about the diagnostics branch alone'
    ).toBeVisible();
    await expect(page.getByTestId('error-boundary-durable-status')).toHaveText('Durable document: current');

    await expect(
      page.getByTestId('error-boundary-diagnostics'),
      'the diagnostics list is conditional on a non-empty diagnostic list, so it must be absent and hidden here'
    ).toHaveCount(0);
    await expect(
      page.getByTestId('error-boundary-diagnostics'),
      'the diagnostics list is not visible, so the fallback below is read against a real conditional branch rather than an empty shell'
    ).toBeHidden();
    await expect(
      page.locator('[data-testid^="error-boundary-diagnostic-"]'),
      'and no per-code item is rendered under any code, which is the only part of the list this app can ' +
        'reach without a store mock'
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid^="error-boundary-diagnostic-"]'),
      'and no per-code item exists or is visible under any code, which no rename can dodge'
    ).toBeHidden();

    // The two assertions above are both stated in terms of `data-testid` strings, and a testid is
    // a name a component is free to change. If `ErrorBoundary` were to render the list and its
    // items under different names, both counts would stay zero with the markup still on screen —
    // so the same claim is also stated in terms of the ELEMENTS, which no rename can dodge. This
    // is the direct property of the state under test: the fallback published no list and no list
    // item at all.
    await expect(fallback.locator('ul'), 'the fallback rendered no list element, whatever it was called').toHaveCount(
      0
    );
    await expect(fallback.locator('li'), 'and no list item, whatever it was called').toHaveCount(0);

    // The fallback survived its own throw, which is the only way to know the store reader above
    // did not throw a second time: `useStore()` is called inside the fallback, and a fallback
    // that crashed would take the whole grid cell with it. The footer's independent reader of the
    // durable presentation is mounted outside the boundary, so it remains observable while the
    // canvas region is showing its fallback.
    await expect(page.locator('footer')).toBeVisible();
    await expect(page.getByTestId('dev-status-strip')).toBeVisible();
    await expect(page.getByTestId('dev-status-strip')).toHaveAttribute('data-status', 'current');
  });

  test('leaves the rest of the editor mounted, interactive, and inside its own boundaries', async ({ page }) => {
    await page.addInitScript(throwOnToolOverlayTwoDimensionalContext);
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
