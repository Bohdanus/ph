import { expect, type Page, type TestInfo } from '@playwright/test';

/**
 * Console and page-error capture for the whole e2e suite.
 * -----------------------------------------------
 * WHAT THIS IS FOR
 *   Before this file, `page.on('console')` appeared nowhere in `e2e/` and
 *   `page.on('pageerror')` appeared twice, both narrow and both local to one
 *   flow (`e2e/toolbar-fit.spec.ts:263`, `e2e/paint-tools.spec.ts:1059`). Nothing
 *   asserted that a normal flow logs nothing, so a React prop warning, a failed
 *   effect or an unhandled rejection passed all ~300 tests and its message went
 *   to stdout nobody reads.
 *
 *   The bug that proved the gap: `useRect` returns `redraw: () => drawMask()`
 *   (`src/hooks/useRect.ts:525`), and `CropToolArea` and
 *   `RectangularSelectionToolArea` spread that whole object onto a `<div>`. React
 *   logs `Invalid value for prop 'redraw' on <div> tag` on every render of either
 *   tool, in production and under test alike, and no spec could see it because the
 *   default tool on load is neither.
 *
 * WHY AN ALLOWLIST EXISTS
 *   An unfiltered global assertion cries wolf on its first run and gets deleted.
 *   `src/components/Common/__tests__/ErrorBoundary.test.tsx:36` already records
 *   the reason: React logs every error a boundary catches, so any spec that
 *   deliberately provokes the boundary would fail for the right reason. The
 *   allowlist is therefore part of the mechanism, not a concession — and every
 *   entry below states the source it comes from, so a reader can tell an
 *   accounted-for message from an accident.
 *
 *   An entry that stops being true must be deleted, and its replacement written
 *   down. Widening the allowlist to make a run green is the same move as raising a
 *   threshold, and this repo does not do that.
 *
 * WHAT IS REPORTED BUT NOT FAILED
 *   Console warnings and failed requests are printed and attached to the report
 *   without failing the test. Warnings are advisory by construction, and this
 *   app's `index.html:18,35` loads a Google Tag Manager container that beacons to
 *   `region1.google-analytics.com` on every page — including every e2e run, which
 *   makes the suite non-hermetic and would otherwise fail ~36 times over a
 *   network call no test controls.
 */
export interface ConsoleEntry {
  text: string;
  count: number;
  location?: { url: string; lineNumber: number };
}

/**
 * Console errors this suite accepts, each with the reason it exists.
 *
 * Keep this list short. A new entry is a claim that the message is not a defect,
 * and the claim is worth as much as its reason.
 */
export const ACCEPTED_CONSOLE_ERRORS: readonly { match: string; reason: string }[] = [
  {
    match: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
    reason:
      'Chrome requests /favicon.ico unprompted because index.html:5 has the ' +
      '<link rel="icon"> line commented out. It is a browser default probe, not an ' +
      'application request. Delete this entry and add a favicon when one is added.',
  },
  {
    match: 'Error boundary caught a throw from',
    reason:
      "The boundary's own console.error at src/components/Common/ErrorBoundary.tsx:90, " +
      'emitted by design on every catch. A spec that makes a boundary catch is testing the ' +
      'thing that logs, so the log is the expected result and not a finding. This is the ' +
      'case this allowlist exists for; without it no error-boundary spec could exist.',
  },
  {
    match: 'Injected fault: 2D context unavailable',
    reason:
      'The fault e2e/error-boundary.spec.ts deliberately injects at the platform seam: ' +
      'HTMLCanvasElement.prototype.getContext is made to throw a SecurityError for the tool ' +
      'overlay canvas. React reports it in the development build, so this appears on every run ' +
      'of that spec. Delete this entry when that spec is deleted.',
  },
];

const accepted = (text: string): boolean => ACCEPTED_CONSOLE_ERRORS.some((entry) => text.includes(entry.match));

/**
 * Accumulates console and page errors for one test and asserts on them at teardown.
 *
 * Deduplication is by message text with a count, because a React prop warning
 * fires once per render and the raw volume is not informative — "x412" plus the
 * message names the defect, 412 near-identical lines do not.
 */
export class ConsolePolice {
  private readonly consoleErrors = new Map<string, ConsoleEntry>();
  private readonly consoleWarnings = new Map<string, ConsoleEntry>();
  private readonly pageErrors = new Map<string, ConsoleEntry>();
  private readonly requestFailures = new Map<string, ConsoleEntry>();
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  attach(): void {
    this.page.on('console', (message) => {
      const target =
        message.type() === 'error'
          ? this.consoleErrors
          : message.type() === 'warning'
            ? this.consoleWarnings
            : undefined;
      if (!target) return;
      const { url, lineNumber } = message.location();
      record(target, message.text().slice(0, 300), url ? { url, lineNumber } : undefined);
    });
    this.page.on('pageerror', (error) => record(this.pageErrors, String(error).slice(0, 300)));
    this.page.on('requestfailed', (request) =>
      record(this.requestFailures, `${request.url().slice(0, 160)} :: ${request.failure()?.errorText ?? 'unknown'}`)
    );
  }

  /**
   * Fails the test on any unaccepted console error or page error.
   *
   * Warnings and failed requests are attached to the Playwright report and echoed
   * to stdout, because they are real information about the run and none of them is
   * a reason to fail a test that proved what it set out to prove.
   */
  assertClean(testInfo: TestInfo): void {
    const errors = [...this.consoleErrors.values()].filter((entry) => !accepted(entry.text));
    const pageErrors = [...this.pageErrors.values()];

    const report = {
      consoleErrors: errors,
      pageErrors,
      consoleWarnings: [...this.consoleWarnings.values()],
      requestFailures: [...this.requestFailures.values()],
    };
    testInfo.attach('console-police.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });

    const render = (entries: ConsoleEntry[]): string =>
      entries
        .map((entry) => {
          const at = entry.location ? ` (${entry.location.url}:${entry.location.lineNumber})` : '';
          return `  x${entry.count} ${entry.text}${at}`;
        })
        .join('\n');

    if (errors.length) {
      expect(
        errors,
        `the page logged ${errors.length} console error(s) during this test.\n` +
          'A React prop warning, a failed effect or an unhandled rejection is a defect, not noise.\n' +
          `If a message is genuinely expected, add it to ACCEPTED_CONSOLE_ERRORS in\n` +
          'e2e/helpers/console-police.ts WITH the reason it is expected.\n\n' +
          render(errors)
      ).toEqual([]);
    }

    if (pageErrors.length) {
      expect(
        pageErrors,
        `the page raised ${pageErrors.length} uncaught exception(s) during this test.\n\n` + render(pageErrors)
      ).toEqual([]);
    }

    for (const entry of [...this.consoleWarnings.values(), ...this.requestFailures.values()]) {
      console.log(`[console-police] ${entry.text}`);
    }
  }
}

function record(target: Map<string, ConsoleEntry>, text: string, location?: ConsoleEntry['location']): void {
  const existing = target.get(text);
  if (existing) {
    existing.count += 1;
    return;
  }
  target.set(text, { text, count: 1, location });
}
