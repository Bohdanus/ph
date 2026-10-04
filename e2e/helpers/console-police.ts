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
 * down. Widening the allowlist to make a run green is the same move as raising a
 * threshold, and this repo does not do that.
 *
 *   An entry is TEXT plus, where text cannot decide it, a URL. A reason that names
 * one request ("Chrome requests /favicon.ico") is a claim about that request, and a
 * substring match over Chrome's own fixed 404 string is a claim about all of them.
 * Where those two come apart, the entry matches on the URL as well — see
 *   `AcceptedConsoleError`.
 *
 * AN ALLOWLIST RULE IS ONLY AS GOOD AS THE RECORDING IT READS
 *   `isAcceptedConsoleError` is handed one `ConsoleEntry`, and that entry holds one
 *   location. A rule with a `urlPattern` is judging a URL, so it can only be right if the
 *   entry’s location is the URL of the message recorded inside it. Deduplicating on text
 *   alone breaks that silently and in the permissive direction: the first occurrence
 *   donates its location to every later message with the same text, and the browser’s own
 *   unprompted 404s are the first occurrences. `entryKey` is what makes the URL-scoped
 *   rule below mean what its reason says.
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
 * One entry in the allowlist.
 *
 * `urlPattern` exists because ONE entry cannot be decided by message text alone, and
 * the entry that needs it was the weakest thing in this file. Chrome emits the byte-identical
 * string `Failed to load resource: the server responded with a status of 404 (Not Found)`
 * for every 404 on the page, so a matching entry accepted a mistyped asset path, a deleted
 * module and a broken image with exactly as much enthusiasm as it accepted the favicon.
 * `requestfailed` does not close that gap either: it fires on a TRANSPORT failure, and a
 * 404 is a perfectly successful conversation that ended in the wrong status code.
 */
export interface AcceptedConsoleError {
  /** A substring of the message. Still the whole test for every entry without `urlPattern`. */
  match: string;
  /** Why this message is not a defect. Every entry states one; a claim without a reason is not an entry. */
  reason: string;
  /**
   * Optional second condition, matched against the PATHNAME of the URL in the message's
   * own location. When present, text alone no longer accepts anything: the location is
   * required, and it must match. An unparseable or absent URL therefore fails the test,
   * which is the safe direction — a rule that guesses is the rule this entry used to be.
   */
  urlPattern?: RegExp;
}

/**
 * Console errors this suite accepts, each with the reason it exists.
 *
 * Keep this list short. A new entry is a claim that the message is not a defect,
 * and the claim is worth as much as its reason.
 */
export const ACCEPTED_CONSOLE_ERRORS: readonly AcceptedConsoleError[] = [
  {
    match: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
    reason:
      'Chrome requests /favicon.ico unprompted because index.html:5 has the ' +
      '<link rel="icon"> line commented out. It is a browser default probe, not an ' +
      'application request. Delete this entry and add a favicon when one is added.',
    // The reason above is about ONE request, and the match string names none of them:
    // every 404 in the app logs this exact text. Confirmed against Chrome during an e2e
    // run, which reports `url="http://localhost:65420/favicon.ico"` for it — the
    // failing resource's own URL, not the document's. That is what makes the path a
    // usable second condition, and it is why a 404 on anything else now fails its test
    // instead of being waved through by a favicon's reason. That second claim is not this
    // line's work alone: it holds only because `record` keys the map on the location as
    // well as the text, so the entry this rule judges carries the URL of the message it
    // was recorded from. See `entryKey`.
    urlPattern: /^\/favicon\.ico$/,
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
  {
    match: 'The Line tool needs a drag',
    reason:
      'The deliberate refusal at src/components/Main/ShapeToolArea.tsx, emitted when the Line ' +
      'tool is clicked rather than dragged. Adobe documents drag-and-release only for the Line ' +
      'tool and never names a Create Line dialog ' +
      '(https://helpx.adobe.com/photoshop/using/tool-techniques/line-tool.html), while the other ' +
      'four figures get one — so this message is the Line half of that contract rather than ' +
      'noise. Delete this entry together with the refusal if the Line ever grows a click dialog.',
  },
];

/** The URL pathname a `urlPattern` is tested against, or `null` when there is not one. */
function locationPathname(location: ConsoleEntry['location']): string | null {
  if (!location?.url) return null;
  try {
    return new URL(location.url).pathname;
  } catch {
    return null;
  }
}

/**
 * Is this console error accounted for?
 *
 * Takes the whole ENTRY rather than its text, because one entry needs the URL and the
 * other two must keep deciding on text alone. An entry with no `urlPattern` is exactly
 * the substring test it was before this signature changed.
 */
export function isAcceptedConsoleError(entry: Pick<ConsoleEntry, 'text' | 'location'>): boolean {
  return ACCEPTED_CONSOLE_ERRORS.some((rule) => {
    if (!entry.text.includes(rule.match)) return false;
    if (!rule.urlPattern) return true;
    const pathname = locationPathname(entry.location);
    return pathname !== null && rule.urlPattern.test(pathname);
  });
}

/**
 * Accumulates console and page errors for one test and asserts on them at teardown.
 *
 * Deduplication is by message text AND location with a count, because a React prop warning
 * fires once per render and the raw volume is not informative — "x412" plus the
 * message names the defect, 412 near-identical lines do not. The location is part of the
 * key rather than a detail of the entry for the reason `entryKey` gives.
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
   * Page errors are read straight from the map, with no allowlist consulted at all and
   * no rule to widen: an uncaught exception is a defect in every message, including the
   * two texts above that are perfectly expected as CONSOLE output but are not exceptions.
   * (The file header says the same, and this is the line that is true of it.)
   *
   * Warnings and failed requests are attached to the Playwright report and echoed
   * to stdout, because they are real information about the run and none of them is
   * a reason to fail a test that proved what it set out to prove.
   */
  assertClean(testInfo: TestInfo): void {
    const errors = [...this.consoleErrors.values()].filter((entry) => !isAcceptedConsoleError(entry));
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
  const key = entryKey(text, location);
  const existing = target.get(key);
  if (existing) {
    existing.count += 1;
    return;
  }
  target.set(key, { text, count: 1, location });
}

/**
 * The deduplication key: the text plus the whole location, not the text alone.
 *
 * A text-only key is wrong here, and not for a cosmetic reason. `ConsoleEntry` carries ONE
 * location, so a text-only key keeps the location of the FIRST occurrence and discards
 * every later one — and `isAcceptedConsoleError` reads that one location. Every 404 in
 * this app logs one byte-identical Chrome string, `/favicon.ico` is 404ed on every
 * document load (no `public/` directory, and `index.html:5` has the
 * `<link rel="icon">` line commented out), and Chrome's probe is the first 404 of the run.
 * So the favicon's URL became the entry's URL and every later application 404 inherited
 * the favicon's exemption: the `urlPattern` on the favicon entry above decided the case
 * from a URL that was not in the message it was judging, and the gate fired or not
 * depending on which 404 Chrome reported first.
 * `e2e/helpers/__tests__/console-police.unit.test.ts` emits the favicon first for that
 * reason.
 *
 * The line number is in the key too, because `render()` prints it: two messages sharing a
 * URL and differing only in line are two defects, and merging them would print one line
 * for both. NUL separates the fields so no url/lineNumber pair can be re-split into
 * another's.
 */
function entryKey(text: string, location?: ConsoleEntry['location']): string {
  return [text, location?.url ?? '', location?.lineNumber ?? ''].join('\u0000');
}
