import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test, type TestInfo, useAppDefaultTheme } from './fixtures/extended-test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { acceptDiscardPrompt } from './helpers/discard-prompt';
import { clickToolButton, openToolFlyoutViaKeyboard } from './helpers/toolbar-helpers';

/**
 * Automated accessibility auditing, via axe-core, over desktop app regions and a live tablet flyout.
 *
 * ## Why this file exists at all, when the suite already has ~172 role locators
 *
 * `getByRole(role, { name })` is a real accessible-name oracle, and about forty places
 * in `e2e/` lean on it — `toHaveAccessibleName('More Tools')` in `toolbar-helpers.ts`,
 * `getByRole('menuitemradio')` in the flyout helpers. That is a genuine strength and
 * nothing here replaces it. What it does NOT reach is everything the name is a label
 * FOR:
 *
 * - **Contrast.** No locator can tell whether `#9ca3af` on `#f3f4f6` is readable. The
 *   suite's greys are everywhere: `text-gray-500`, `opacity-50`, `dark:text-gray-400`.
 * - **Label association.** A `<label htmlFor>` that points at an id which does not
 *   exist is invisible to a role locator — the control still resolves by role, and
 *   still has whatever text happens to sit beside it.
 * - **Role validity and `aria-*` completeness.** `aria-pressed` on a control whose
 *   role has no pressed state, an `aria-labelledby` naming a missing id, an
 *   `aria-controls` pointing nowhere. All of these pass every current assertion.
 * - **Landmarks and headings.** `region`, `page-has-heading-one`, `landmark-one-main`.
 * - **Nested-interactive, and controls with no accessible name at all.**
 *
 * `grep -rn 'axe|pa11y|lighthouse|jsx-a11y' package.json eslint.config.js` returned
 * nothing before this file. This is the only automated a11y checking in the repository,
 * and it is the first.
 *
 * The app already hand-rolls exactly what axe audits, which is the strongest argument
 * for running axe rather than for trusting the hand-rolled version:
 * `src/components/Mobile/useModalA11y.ts` implements focus containment, the initial
 * focus and the restore, and `src/components/Mobile/MobileLayersDrawer.tsx`
 * manages `role="dialog"`, `aria-modal`, `tabIndex={-1}` and the panel ref by hand.
 * The desktop dialogs do it through a shared hook instead
 * (`src/hooks/useDialogFocusContainment.ts`, wired in at
 * `src/components/NewImageDialog/NewImageDialog.tsx`). Two hand-written
 * implementations of one rule is precisely the shape that drifts.
 *
 * ## Why scoped scans instead of one whole-page sweep
 *
 * A single `analyze()` over the whole document is the obvious version and it is
 * worthless here: every violation comes back with the same selector prefix, so a
 * report says "18 contrast failures" and names nothing. Scoping each run to one
 * region means a failing node reads as one component — the options bar, not "the
 * page" — which is the difference between a list somebody can act on and a number.
 * It is also what keeps the canvas out of the blast radius: `Main` owns a
 * `workspace-canvas` plus a stack of overlays, and a document-wide sweep attributes
 * whatever it finds there to the shell.
 *
 * The desktop scopes cover distinct kinds of widget, not only the
 * most-likely-to-fail spots:
 *
 * 1. **The shell** (`document`, unscoped) — DesktopHeader, the tools rail, the right
 *    dock, the footer. Structure, landmarks, headings, names.
 * 2. **An options bar** — the Draw tool's panel, which is the densest form UI in the
 *    app: a `<select>`, four range inputs, a labelled checkbox, a canvas preview.
 *    Every label there is a `<label htmlFor>`, which is exactly the association axe
 *    checks and a role locator cannot.
 * 3. **A modal dialog with a form** — New Image. A surface with a focus trap, an
 *    `aria-labelledby`, a form and its own contrast palette.
 * 4. **A modal dialog with no form** — the unsaved-changes prompt
 *    (`src/components/ConfirmDialog`). It is the FIRST modal a user meets, it stands
 *    between the file commands and the document, and before the guard moved into the
 *    app it was a native `confirm()` — which axe cannot audit at all, so nothing else
 *    in this file could ever have covered it.
 * 5. **The same four desktop surfaces in dark theme** — the shared test fixture pins
 *    light for reliable pixel oracles, so these scans release the pin and reload.
 * 6. **A live portalled tool flyout at tablet width in both themes** — its positioning
 *    wrapper is absent from the app-shell scan while the flyout is closed.
 *
 * The tablet flyout scan is additive; the original desktop scopes are not relaxed.
 *
 * ## What a GREEN run does NOT prove — read this before trusting one
 *
 * This is the part that decides whether the file is worth keeping, so it is stated at
 * length and in the negative.
 *
 * - **Green means axe found no violations in the scanned states and themes.** The
 *   desktop scopes use the desktop viewport; the flyout scope uses a tablet viewport.
 *   A green run does not mean the app is accessible. axe covers roughly 30-40% of WCAG
 *   as a matter of design; the rest — keyboard operability, focus order, focus
 *   visibility, a screen reader actually understanding a canvas editor, error recovery,
 *   timing — is invisible to it and is mostly invisible to Playwright too.
 * - **A canvas photo editor has no meaningful non-visual equivalent.** The document
 *   is a `<canvas>`; its pixels are the content, and there is no DOM to expose. axe
 *   scans the SHELL AROUND the canvas and says nothing about the canvas. A green run
 *   here is a statement about the furniture, not the picture.
 * - **The scans are per-state, not per-app.** Ten snapshots cover four desktop surfaces
 *   in both themes and one tablet flyout in both themes. Other overlays are unscanned.
 * - **Contrast is measured on a headless render at one window size.** A subpixel
 *   difference between browsers or display scales can move a borderline pair across a
 *   threshold; inspect attached axe details rather than treating a result as universal.
 * - **Incomplete results are not asserted.** Axe attaches the complete result and logs
 *   incomplete rules for human review; only the `violations` bucket is a gate.
 * - **No rule is disabled and no tag filter is applied.** The full default rule set runs,
 *   including `best-practice`; this repository does not weaken a gate to get green.
 * - **axe is a linter, not a judgement.** Product-level semantics remain subject to
 *   Photoshop behavior and the decision records in `docs/OVERRIDES.md`.
 * - **Every scoped scan reports its audited node count.** This distinguishes a clean
 *   region from an empty audit and makes scope drift visible without pinning layout size.
 *
 * ## Gate policy
 *
 * All scans assert zero violations. The app shell is scanned in light and dark themes,
 * and the tablet flyout is scanned while open; neither state suppresses rules.
 */

/**
 * The axe's own result types, derived from the builder rather than imported from
 * `axe-core`.
 *
 * `axe-core` is a TRANSITIVE dependency here — `@axe-core/playwright` depends on it —
 * so importing its types would compile only for as long as npm's hoisting kept the
 * package reachable from this file, and would break the moment it did not. Deriving
 * them from `AxeBuilder['analyze']` cannot: the shape this file reads is whatever the
 * installed version returns, and a version that changed it is a type error at the
 * derivation rather than a silent wrong field.
 *
 * `analyze()` resolves to the result object DIRECTLY. An older shape wrapped it as
 * `{ error, results }` and unwrapped the error inside `runLegacy`
 * (`dist/index.js:283-291`), which throws rather than returning the wrapper — so
 * there is no `.results` to read.
 */
type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;
type AxeViolation = AxeResults['violations'][number];
type AxeNode = AxeViolation['nodes'][number];

/** How deep into a violation's node list the failure message goes. */
const MAX_NODES_REPORTED = 5;

/**
 * The default ruleset, stated so a reader can see it was not narrowed.
 *
 * `AxeBuilder` with no `withTags` and no `disableRules` runs every rule axe ships,
 * minus the ones axe itself marks experimental. That is the configuration this file
 * uses, and it is a configuration rather than an omission: naming the alternative
 * (`withTags(['wcag2a', 'wcag2aa'])`) here would document a narrowing that this file
 * deliberately does not perform.
 */
const DEFAULT_RULESET = 'every axe rule, no tag filter, nothing disabled';

/** The one snapshot every scan below is taken at. */
const VIEWPORT = { width: 1280, height: 720 };
const TABLET_VIEWPORT = { width: 900, height: 720 };

async function loadDarkApplication(page: Page): Promise<void> {
  await page.goto('/');
  await useAppDefaultTheme(page);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
}

/**
 * Renders a violation list as text a human can act on.
 *
 * Grouped by rule, because a rule id is the actionable unit — the fix for
 * `color-contrast` is "darken this grey", wherever it appears — and each rule lists
 * every node's selector, because the count alone ("x18") tells a reader nothing about
 * which eighteen.
 *
 * `html` is included and truncated: the selector names a node, and the node's own
 * markup is usually the fastest route to the source line.
 */
function describeViolations(violations: readonly AxeViolation[]): string {
  return violations
    .map((violation) => {
      const nodes = violation.nodes.slice(0, MAX_NODES_REPORTED);
      const rendered = nodes
        .map((node: AxeNode) => {
          const targets = Array.isArray(node.target) ? node.target : [node.target];
          const selector = targets.map(String).join(' >> ');
          const html = node.html.length > 160 ? `${node.html.slice(0, 160)}…` : node.html;
          const summary = node.failureSummary ? `\n      ${node.failureSummary.replaceAll('\n', '\n      ')}` : '';
          return `    - ${selector}\n      <${html}>${summary}`;
        })
        .join('\n');
      const more =
        violation.nodes.length > MAX_NODES_REPORTED
          ? `\n    …and ${violation.nodes.length - MAX_NODES_REPORTED} more node(s) with this rule`
          : '';
      return (
        `  [${violation.impact ?? 'unknown'}] ${violation.id} (${violation.nodes.length} occurrence(s))\n` +
        `    ${violation.help} — ${violation.description}\n` +
        rendered +
        more
      );
    })
    .join('\n');
}

/**
 * Resolves a scan scope and REFUSES to run axe against a scope that is wrong.
 *
 * This function is the load-bearing part of the file, and it exists because of a
 * specific and common failure: axe scanned against a region that is visually hidden,
 * `aria-hidden`, or absent, produces violations that are artifacts of the SCAN rather
 * than defects in the app. A `display: none` mobile shell will report its controls as
 * unnamed; an `aria-hidden` wrapper will report a whole subtree of false positives.
 * Both read exactly like real defects in a report, and both are the test's fault.
 *
 * So every scope is checked before axe sees it:
 *
 * - it must resolve to EXACTLY ONE element (zero means the selector is stale; two
 *   means the selector is ambiguous and the scan would attribute both);
 * - that element must be VISIBLE (a `display: none` or `visibility: hidden` container
 *   is not what the user sees, and auditing it audits nothing);
 * - it must not sit inside an `aria-hidden` subtree (which the accessibility tree has
 *   already excluded, so anything axe says about it is a statement about markup the
 *   user cannot reach).
 *
 * A failure here names the SCOPE, not the app. That distinction is the whole reason
 * a violation list from this file can be trusted as a defect list.
 */
async function resolveScope(page: Page, scope: string, label: string): Promise<Locator> {
  const locator = page.locator(scope);
  await expect(locator, `${label}: the scan scope ${scope} must resolve to exactly one element`).toHaveCount(1);
  await expect(locator, `${label}: ${scope} must be visible to be audited`).toBeVisible();

  const hiddenBy = await locator.evaluate((node) => {
    const owner = node.closest('[aria-hidden="true"]');
    return owner === null
      ? null
      : owner.tagName.toLowerCase() + (owner.className ? `.${String(owner.className).split(/\s+/)[0]}` : '');
  });
  expect(
    hiddenBy,
    `${label}: ${scope} sits inside an aria-hidden subtree (${hiddenBy}). ` +
      'axe audits the accessibility tree, which has already excluded that subtree, so every ' +
      'violation it reported would be an artifact of the SCAN rather than a defect in the app. ' +
      'Fix the scope.'
  ).toBeNull();

  return locator;
}

/**
 * Runs axe over one region, attaches the whole result set, and asserts zero violations.
 *
 * The assertion is a single `toEqual([])` on the violation list, with the message
 * carrying the full report. It is not a count against a threshold: any violation at
 * any severity fails this file, because a threshold is a place to hide the one
 * finding nobody wanted to read.
 *
 * `incomplete` is attached but NOT asserted. See the header for why.
 */
async function expectNoViolations(
  page: Page,
  testInfo: TestInfo,
  label: string,
  build: (builder: AxeBuilder) => AxeBuilder
): Promise<void> {
  const results = await build(new AxeBuilder({ page })).analyze();

  // The `incomplete` ids are LOGGED rather than only attached, because an incomplete
  // result is the one bucket that is neither asserted nor silent: it says axe tried and
  // could not decide. Naming the rules on stdout is what lets a reader tell "nothing to
  // see" apart from "something axe could not see", which are different sentences.
  console.log(
    `[axe] ${label}: incomplete not asserted = [${results.incomplete.map((item) => `${item.id} x${item.nodes.length}`).join(', ')}]`
  );

  testInfo.attach(`axe-${label}.json`, {
    body: JSON.stringify(
      {
        label,
        ruleset: DEFAULT_RULESET,
        violations: results.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          occurrences: violation.nodes.length,
          targets: violation.nodes.map((node) => node.target),
        })),
        // Attached so a reader can see it was considered and not silently dropped. `targets` is
        // recorded for the same reason the violations bucket records it at `:300`: without the
        // element selector a rule id and a count say that axe stopped, and not WHERE. An
        // `aria-allowed-role` that cannot be located without re-running the scan is not a
        // hand-off, it is a to-do nobody can start.
        incompleteNotAsserted: results.incomplete.map((item) => ({
          id: item.id,
          impact: item.impact,
          help: item.help,
          occurrences: item.nodes.length,
          targets: item.nodes.map((node) => node.target),
        })),
        inapplicable: results.inapplicable.length,
        passes: results.passes.length,
      },
      null,
      2
    ),
    contentType: 'application/json',
  });

  // THE CENSUS LINE, and it is not decoration.
  //
  // A scoped scan can pass for two reasons that look identical in a test report: the
  // region is clean, or the scan audited nothing. A selector that no longer matches, a
  // region that is `display: none`, or an `include` axe could not resolve all produce
  // "zero violations", and `resolveScope` catches only the first of those. Without this
  // line there is no way to tell a clean pass from a vacuous one by reading the output —
  // `passes` is the number that distinguishes them, because a scan that audited nodes
  // passes rules against them, and a scan that audited nothing passes none.
  //
  // Logged on every run, including green ones, which is the only place it is useful.
  console.log(
    `[axe] ${label}: ${results.violations.length} violation(s), ` +
      `${results.incomplete.length} incomplete, ${results.passes.length} passed rule(s), ` +
      `${results.inapplicable.length} inapplicable — audited ${results.passes.reduce((total, item) => total + item.nodes.length, 0)} node(s)`
  );

  expect(
    results.violations,
    `axe found ${results.violations.length} violation(s) in ${label} ` +
      `(ruleset: ${DEFAULT_RULESET}; ${results.incomplete.length} incomplete result(s) are attached but NOT asserted).\n` +
      "Each one below is a candidate defect in this repository's own markup. They are reported, " +
      'not suppressed: no rule is disabled, no severity is thresholded, and no region is narrowed.\n' +
      'Fix the component, or record a deliberate decision in docs/OVERRIDES.md.\n\n' +
      describeViolations(results.violations)
  ).toEqual([]);
}

/**
 * The `New Image` dialog.
 *
 * Scoped to `[data-testid="new-image-dialog"]` and NOT to the document, which matters
 * for a modal specifically. The app renders this dialog as a `fixed inset-0` overlay
 * (`NewImageDialog.tsx:69`) and does not mark the rest of the page `aria-hidden` or
 * `inert` — so a document-wide scan here would report the entire shell underneath a
 * dialog that is on top of it, which is a statement about the overlay, not about the
 * shell. The shell has its own scan (test 1) and is judged there.
 *
 * What this scan therefore covers is the dialog itself: its `aria-labelledby`
 * (`:72` → `:79`), its form's label/control association (`:95` → `:100` and the four
 * siblings), and the contrast of a white card on a 25%-black backdrop
 * (`:75,:77`).
 */
test('the New Image dialog has no axe violations', async ({ page }, testInfo) => {
  await page.setViewportSize(VIEWPORT);
  await page.goto('/');
  await expect(getWorkspaceCanvas(page)).toBeVisible();

  // The blank document the app creates on load (`App.tsx:28-41`, `BlankImageStarter`)
  // carries unsaved changes, so the guard `DesktopHeader` puts on New
  // (`UnsavedChangesContext.tsx`) IS shown on this click, and it is now the app's own
  // modal (`src/components/ConfirmDialog`) rather than a native `confirm()`. The old
  // `page.on('dialog', …)` was armed with `on` rather than `once` for a reason that no
  // longer applies: `once` would consume the NEXT dialog of any kind if the guard did not
  // fire, and a bare Playwright dialog with no handler is DISMISSED, which silently
  // cancelled the New and left this test scanning nothing. `acceptDiscardPrompt` answers
  // the prompt this test caused and FAILS if it was never shown, which is the same
  // protection stated as an assertion rather than as a listener that tolerated its
  // absence — a clean document would now fail here instead of passing with an empty scan.
  await page.getByTestId('header-file-menu-button').click();
  await page.getByTestId('header-file-new-button').click();
  await acceptDiscardPrompt(page);

  const dialog = await resolveScope(page, '[data-testid="new-image-dialog"]', 'the New Image dialog');
  await expect(dialog).toBeVisible();

  await expectNoViolations(page, testInfo, 'new-image-dialog', (builder) =>
    builder.include('[data-testid="new-image-dialog"]')
  );
});

test('the dark New Image dialog has no axe violations', async ({ page }, testInfo) => {
  await page.setViewportSize(VIEWPORT);
  await loadDarkApplication(page);
  await expect(getWorkspaceCanvas(page)).toBeVisible();
  await page.getByTestId('header-file-menu-button').click();
  await page.getByTestId('header-file-new-button').click();
  await acceptDiscardPrompt(page);

  const dialog = await resolveScope(page, '[data-testid="new-image-dialog"]', 'the dark New Image dialog');
  await expect(dialog).toBeVisible();
  await expectNoViolations(page, testInfo, 'new-image-dialog-dark', (builder) =>
    builder.include('[data-testid="new-image-dialog"]')
  );
});

/**
 * The unsaved-changes guard — the app's own modal, and a FOURTH region.
 *
 * It was a native `confirm()` until the guard moved into the app
 * (`src/contexts/UnsavedChangesContext.tsx`), and a browser-native dialog is not in this
 * document at all: axe cannot audit the chrome of an OS dialog, and `role="dialog"` on
 * nothing is not a surface any of the existing scans reach. Now that it is DOM it is
 * auditable, and it is the FIRST modal a user meets in this app — it stands between the
 * file commands and the document — so a sweep of it is the cheapest real coverage
 * available for a new modal and belongs beside the New Image sweep rather than after it.
 *
 * What it covers that the New Image sweep does not: `aria-modal="true"` and an
 * `aria-describedby` pointing at the message paragraph (`ConfirmDialog.tsx:35,:37` → `:62`),
 * which is wiring no role locator in the suite asks about — the whole reason
 * `e2e/document-dialogs.spec.ts` and the unit tests can go green on a `toBeInTheDocument()`
 * while `aria-describedby` names an id that does not exist. The message is body copy inside
 * a titled dialog, so it is a `<p>` and not a heading: an `<h3>` there would break axe's
 * `heading-order`, and the `<h2>` title is chosen for the same reason.
 *
 * Same scope discipline as the New Image scan, for the same reason: a `fixed inset-0`
 * overlay that does not mark the page behind it `aria-hidden` or `inert` would drag the
 * whole shell into this report, and the shell is judged by its own scan.
 */
test('the unsaved-changes prompt has no axe violations', async ({ page }, testInfo) => {
  await page.setViewportSize(VIEWPORT);
  await page.goto('/');
  await expect(getWorkspaceCanvas(page)).toBeVisible();

  // Shown by the boot document's unsaved changes, so the guard is reached on the first
  // `File > New` with no work of this test's own required first.
  await page.getByTestId('header-file-menu-button').click();
  await page.getByTestId('header-file-new-button').click();

  const prompt = await resolveScope(page, '[data-testid="confirm-dialog"]', 'the unsaved-changes prompt');
  await expect(prompt).toBeVisible();

  await expectNoViolations(page, testInfo, 'confirm-dialog', (builder) =>
    builder.include('[data-testid="confirm-dialog"]')
  );

  // Answered only after the scan, so the prompt is on screen while axe reads it. Nothing
  // below this line depends on the answer, and leaving a modal up at the end of a test is
  // the sort of thing that makes the next one fail for the wrong reason.
  await acceptDiscardPrompt(page);
});

test('the dark unsaved-changes prompt has no axe violations', async ({ page }, testInfo) => {
  await page.setViewportSize(VIEWPORT);
  await loadDarkApplication(page);
  await expect(getWorkspaceCanvas(page)).toBeVisible();
  await page.getByTestId('header-file-menu-button').click();
  await page.getByTestId('header-file-new-button').click();

  const prompt = await resolveScope(page, '[data-testid="confirm-dialog"]', 'the dark unsaved-changes prompt');
  await expect(prompt).toBeVisible();
  await expectNoViolations(page, testInfo, 'confirm-dialog-dark', (builder) =>
    builder.include('[data-testid="confirm-dialog"]')
  );
  await acceptDiscardPrompt(page);
});

/**
 * The Draw tool's options bar.
 *
 * Scoped to the horizontal options-bar row and not to the document, so that a failure
 * names the options bar rather than the shell. The scope selector is the Tailwind
 * arbitrary property `[grid-area:toolbar]` — the grid-area name `App.tsx:83` assigns to
 * that row — because the component itself renders no `data-testid`
 * (`ToolbarHorizontal.tsx:36`). `resolveScope` asserts the selector matches exactly one
 * element, so a future layout change fails at the SCOPE with a message saying so,
 * rather than producing an empty audit that reports success.
 *
 * Why Draw: it is the densest form UI in the app and every one of its controls is a
 * real association to check. `Draw.tsx:126` (`<label htmlFor="pen-type">`),
 * `:142-143` (`size-slider`), `:164-165` and `:183-184` (the dash pattern, rendered
 * only for the dashed pen), and `:204-205` (`alpha-slider`) — plus an
 * `aria-pressed` toggle and a `<canvas>` preview. A `<label>` whose `htmlFor` names an
 * id that does not exist still leaves every control resolvable by role, so nothing in
 * the existing suite can see that class of defect.
 */
test("the Draw tool's options bar has no axe violations", async ({ page }, testInfo) => {
  await page.setViewportSize(VIEWPORT);
  await page.goto('/');
  await expect(getWorkspaceCanvas(page)).toBeVisible();

  await clickToolButton(page, 'draw');
  // The Draw bar is driven by `toolName` and is absent until the tool is current
  // (`ToolbarHorizontal.tsx:10-12`), and `keyboard-shortcuts.spec.ts:337` reads the
  // same control as the readiness signal. `#pen-type` is that control.
  await expect(page.locator('#pen-type'), 'the Draw options bar is the one on screen').toBeVisible();

  const scope = 'div[class~="[grid-area:toolbar]"]';
  await resolveScope(page, scope, "the Draw tool's options bar");

  await expectNoViolations(page, testInfo, 'draw-options-bar', (builder) => builder.include(scope));
});

test("the dark Draw tool's options bar has no axe violations", async ({ page }, testInfo) => {
  await page.setViewportSize(VIEWPORT);
  await loadDarkApplication(page);
  await expect(getWorkspaceCanvas(page)).toBeVisible();
  await clickToolButton(page, 'draw');
  await expect(page.locator('#pen-type'), 'the dark Draw options bar is the one on screen').toBeVisible();

  const scope = 'div[class~="[grid-area:toolbar]"]';
  await resolveScope(page, scope, "the dark Draw tool's options bar");
  await expectNoViolations(page, testInfo, 'draw-options-bar-dark', (builder) => builder.include(scope));
});

/**
 * The application shell, unscoped. The current strict scan passes after the wrapper fix.
 *
 * This is the only scan with no `include`, because the shell IS the thing under test:
 * landmarks and their names, heading structure, the accessible names of icon-only
 * controls, and the contrast of the greys the whole UI is built from.
 *
 * It is deliberately the broadest of the three and the last one written, because it is
 * the one whose failure message is least actionable on its own — every selector is a
 * shell-level one. Its value is as a census: it is the scan that finds the contrast
 * pairs the two scoped scans cannot see, because those pairs are spread across the
 * header, the rail, the dock and the footer. The original baseline found four; the
 * attribution below is historical context, not a description of current scan output.
 *
 * ## Historical baseline findings
 *
 * Each attribution was verified against the source and, where the finding could have
 * been an artifact of the SCAN rather than of the app, verified in the browser too.
 * That second check is the one that matters, because a scope artifact and a real
 * defect print identically in an axe report.
 *
 * 1. **`label`, critical, 2 occurrences.**
 *    `input[data-testid="foreground-color-input"]` and
 *    `input[data-testid="background-color-input"]` — `src/components/SidebarLeft/SidebarLeft.tsx`.
 *    Neither had a `<label>`, an `aria-label` or an `aria-labelledby` in the baseline.
 *
 *    **This is the finding most likely to be mistaken for a scan artifact, so it was
 *    checked in the browser rather than reasoned about.** The inputs are styled
 *    `absolute opacity-0 pointer-events-none`, which raises a fair question: is axe
 *    auditing something no user can perceive? Measured, in this app, at this viewport:
 *    computed `display: block`, computed `visibility: visible`, `opacity: 0`, no
 *    `aria-hidden` on the element and none on any ancestor, and — the part that
 *    settles it — `element.focus()` DOES move `document.activeElement` onto each one.
 *    `opacity: 0` hides pixels; it does not remove an element from the accessibility
 *    tree or from the tab order. A screen-reader user reaches these controls and is
 *    told they are an unnamed colour picker. The visible swatches beside them
 *    (`:1223-1238`) are `<div>`s carrying only a `title`, which is a tooltip and not
 *    an accessible name. Genuine defect, and the most consequential of the four: it is
 *    `critical`, and it is invisible to all 172 role locators in this suite because a
 *    role locator resolves the control fine and never asks what it is called.
 *
 * 2. **`color-contrast`, serious, 2 occurrences.** Both measure 4.39 against a 4.5
 *    threshold — `#6b7280` (`text-gray-500`) on `#f3f4f6` (`bg-gray-100`), a 2.4%
 *    shortfall, so these are borderline rather than egregious.
 *    - `.mt-1` → `data-testid="swap-colors-button"`, `src/components/SidebarLeft/SidebarLeft.tsx`
 *      (`text-[8px] … text-gray-500`, 8px bold).
 *    - `.justify-between.px-2 > .text-gray-500.text-sm.dark\\:text-gray-400` →
 *      the `© 2025 Photo App` span, `src/components/Footer/Footer.tsx`.
 *
 *    Both are ordinary visible text at ordinary sizes, so neither can be a visibility
 *    artifact. Genuine, and the cheapest of the four to fix.
 *
 * 3. **`page-has-heading-one`, moderate, 1 occurrence** — on `html` itself. There is
 *    no `<h1>` in the shell. `document.querySelectorAll('h1').length` is 0 after load,
 *    and the only `<h1>` in `src/` belongs to `LandingPage.tsx`, which nothing
 *    renders. A `best-practice` rule rather than WCAG A/AA, and this is a photo editor
 *    whose surfaces are panels and toolbars, so "the page needs a title heading" is a
 *    weak claim about a canvas app — but it is left enabled on purpose.
 *
 * 4. **`region`, moderate, 1 occurrence** — on
 *    `.\[grid-area\:toolbar\]`, the options-bar row. `App.tsx:83` builds the shell as a
 *    CSS grid and `ToolbarHorizontal.tsx:36` renders that row as a bare `<div>`; it is
 *    a direct child of the grid container, so it is inside no landmark. Verified
 *    against the live DOM: the shell's landmarks are `HEADER`, `ASIDE` (tools rail),
 *    `MAIN`, `ASIDE` (dock), `FOOTER`, and the options bar's own parent is a plain
 *    `DIV` with no `data-testid`. `best-practice`, not WCAG A/AA.
 *
 * ## Historical scope analysis
 *
 * The scan is UNSCOPED — `new AxeBuilder({ page })` with no `include` — so the usual
 * artifact causes do not apply to the structural findings: there is no region to be
 * hidden or `aria-hidden`. For the `label` pair, which does involve visually-hidden
 * elements, the browser measurement above is the ruling-out. The mobile shell is
 * mounted at EVERY width and hidden with `md:hidden` (`App.tsx:118-123`, and the
 * comment above it explains why unmounting was rejected); at this 1280px viewport it
 * is `display: none` and axe excludes it from every rule, which is confirmed by none of
 * the four selectors resolving inside it.
 */
test('the application shell has no axe violations', async ({ page }, testInfo) => {
  await page.setViewportSize(VIEWPORT);
  await page.goto('/');
  await expect(getWorkspaceCanvas(page)).toBeVisible();

  // The same readiness wait the two scoped scans use, and for the same reason: an axe
  // run against a half-rendered shell audits a shell that no user ever saw, and the
  // resulting violations move as the remaining panels mount.
  await expect(page.getByTestId('left-sidebar')).toBeVisible();

  // NO `include`. Scoping this one to a region would be the same as not writing it.
  await expectNoViolations(page, testInfo, 'app-shell', (builder) => builder);
});

test('the dark application shell has no axe violations', async ({ page }, testInfo) => {
  await page.setViewportSize(VIEWPORT);
  await loadDarkApplication(page);
  await expect(getWorkspaceCanvas(page)).toBeVisible();
  await expect(page.getByTestId('left-sidebar')).toBeVisible();

  await expectNoViolations(page, testInfo, 'app-shell-dark', (builder) => builder);
});

test('a live tool flyout keeps its menu semantics at tablet width', async ({ page }, testInfo) => {
  await page.setViewportSize(TABLET_VIEWPORT);
  await page.goto('/');
  await expect(getWorkspaceCanvas(page)).toBeVisible();
  await expect(page.getByTestId('left-sidebar')).toBeVisible();

  await openToolFlyoutViaKeyboard(page, 'magic-wand');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();

  const wrapperSelector = 'div:has(> [data-toolbar-flyout])';
  const wrapper = await resolveScope(page, wrapperSelector, 'the tablet tool flyout wrapper');
  expect(await wrapper.getAttribute('role')).toBeNull();
  expect(await wrapper.getAttribute('aria-label')).toBeNull();
  await expectNoViolations(page, testInfo, 'tablet-tool-flyout', (builder) => builder.include(wrapperSelector));
});

test('a live dark tool flyout keeps its menu semantics at tablet width', async ({ page }, testInfo) => {
  await page.setViewportSize(TABLET_VIEWPORT);
  await loadDarkApplication(page);
  await expect(getWorkspaceCanvas(page)).toBeVisible();
  await expect(page.getByTestId('left-sidebar')).toBeVisible();
  await openToolFlyoutViaKeyboard(page, 'magic-wand');
  await expect(page.getByRole('menu')).toBeVisible();

  const wrapperSelector = 'div:has(> [data-toolbar-flyout])';
  const wrapper = await resolveScope(page, wrapperSelector, 'the dark tablet tool flyout wrapper');
  expect(await wrapper.getAttribute('role')).toBeNull();
  expect(await wrapper.getAttribute('aria-label')).toBeNull();
  await expectNoViolations(page, testInfo, 'tablet-tool-flyout-dark', (builder) => builder.include(wrapperSelector));
});
