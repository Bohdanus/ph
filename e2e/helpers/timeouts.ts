/**
 * Per-test time budgets, named by what they are for rather than by how long they are.
 *
 * These were 52 bare `test.setTimeout(60_000)`-shaped literals across 15 spec files, and
 * a bare number is the one kind of constant that costs nothing to write and everything to
 * read: nothing in `test.setTimeout(90_000)` said whether 90s was for a third-party page
 * load or for a document that replays a long history, so the budget could not be judged
 * against the work it was paying for. Only the export flow had a name for its own
 * (`INTEGRATION_TEST_TIMEOUT_MS` in `export/helpers.ts`, which is now an alias of
 * `DEFAULT_TEST_TIMEOUT_MS` below — the export sequence is a routine-length one).
 *
 * A value appearing twice under two names is deliberate, not a leftover: `layers.spec.ts`
 * and `photopea.spec.ts` both get 90s and they are not the same kind of test, so a single
 * name for both would be the abstraction the rest of this file refuses to make.
 *
 * Two budgets are NOT here, and should not be added:
 *
 * - Per-assertion and per-action timeouts (`click({ timeout: 5_000 })`,
 *   `waitForFunction(..., { timeout })`) are a different thing: they bound one step, and
 *   their value is about how long the UI is allowed to take, not about how much work the
 *   test does. Several specs already name their own for exactly that reason —
 *   `PIXEL_POLL_TIMEOUT_MS` in `paint-tools.spec.ts`, `CANVAS_READY_TIMEOUT_MS` in the
 *   export helper tests.
 * - The Playwright default, 30s, which is configured in `playwright.config.ts` and is what
 *   a test gets for free. A test that needs more says which of the budgets above.
 *
 * `__tests__/timeouts.unit.test.ts` fails if a bare numeric literal reappears in a
 * `test.setTimeout(...)` or `test.describe.configure({ timeout: ... })` anywhere under
 * `e2e/`, so the next magic number is a named test rather than a review comment.
 */

/** The routine budget: draw, assert, and clean up. Most tests need nothing longer. */
export const DEFAULT_TEST_TIMEOUT_MS = 60_000;

/**
 * A test that replays a long document — `layers.spec.ts` reorders and deletes every layer
 * in sequence, each an undoable step, and the whole chain is what has to fit the budget.
 */
export const SEQUENTIAL_LAYER_TEST_TIMEOUT_MS = 90_000;

/**
 * A test that hands the page to photopea.com. The budget covers a third party's page load
 * and file ingest, neither of which this repository controls, which is why it is longer
 * than a local test of the same work would need.
 */
export const THIRD_PARTY_PAGE_TEST_TIMEOUT_MS = 90_000;

/**
 * The paint-tools block: each test opens an options bar, builds a layer fixture, strokes,
 * and then makes three history round trips with a capture per poll. The comment above
 * `test.describe.configure` in `paint-tools.spec.ts` says the same thing and should move
 * here with it if the number moves.
 */
export const PAINT_TOOLS_TEST_TIMEOUT_MS = 120_000;
