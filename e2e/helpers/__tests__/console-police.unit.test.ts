import type { ConsoleMessage, Page, TestInfo } from '@playwright/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ACCEPTED_CONSOLE_ERRORS, ConsolePolice, isAcceptedConsoleError } from '../console-police';

/**
 * Unit tests for `e2e/helpers/console-police.ts`.
 *
 * `e2e/README.md:289` claims every helper module under `e2e/helpers/` has one of
 * these. `console-police.ts` did not, and it is the module with the most consequential
 * allowlist in the suite: a wrongly scoped entry makes every one of ~370 specs green
 * over a defect the entry was written for. The claim in the README is the operator's to
 * correct; this file is the part of it that is code.
 *
 * ## Nothing here opens a browser
 *
 * `ConsolePolice.attach()` talks to a `Page` only through `.on()`, so the class is
 * driven with a three-line fake that keeps the registered listeners and lets a test
 * emit one. The real `assertClean` is exercised through it, which is the point: a test
 * of the exported predicate alone would prove the predicate works and not that the
 * suite calls it.
 *
 * `@playwright/test` is mocked for its `expect` and nothing else, because the real one
 * throws unless it is running inside a Playwright test. The stub is a faithful
 * `toEqual([])` — a deep-compare against the expected array that throws on mismatch with
 * the message Playwright would have used — so "the test failed" still means "the
 * assertion was false", and the recorded messages are the ones an operator would read.
 * The alternative, deleting the call and testing a re-implementation of it, would prove
 * that the re-implementation is correct.
 */

const { failures } = vi.hoisted(() => ({ failures: [] as string[] }));

vi.mock('@playwright/test', () => ({
  expect: (value: unknown, message: string) => ({
    toEqual: (expected: unknown) => {
      const equal = JSON.stringify(value) === JSON.stringify(expected);
      if (!equal) {
        failures.push(message);
        throw new Error(message);
      }
    },
  }),
}));

const NOT_FOUND_TEXT = 'Failed to load resource: the server responded with a status of 404 (Not Found)';

/** Where Chrome puts a resource 404: the failing resource's own URL, not the document's. */
const FAVICON = { url: 'http://localhost:5173/favicon.ico', lineNumber: 0 };
const APP_JS = { url: 'http://localhost:5173/assets/app.js', lineNumber: 0 };

/** The three texts the allowlist exists to account for, as Chrome/page would report them. */
const BOUNDARY_TEXT = 'Error boundary caught a throw from CropToolArea';
const INJECTED_TEXT = 'Injected fault: 2D context unavailable';

interface Harness {
  police: ConsolePolice;
  emitConsole: (type: 'error' | 'warning', text: string, location?: { url: string; lineNumber: number }) => void;
  emitPageError: (error: Error) => void;
}

/**
 * A `Page` reduced to what `attach()` uses. The listener arrays are what a test drives,
 * so nothing here needs a browser, a CDP session or a dev server.
 */
function harness(): Harness {
  type Listener = (arg: never) => void;
  const listeners: Record<string, Listener[]> = {};

  const page = {
    on(event: string, handler: Listener) {
      (listeners[event] ??= []).push(handler);
    },
  } as unknown as Page;

  const police = new ConsolePolice(page);
  police.attach();

  return {
    police,
    emitConsole: (type, text, location) => {
      const message = {
        type: () => type,
        text: () => text,
        location: () => ({ url: location?.url ?? '', lineNumber: location?.lineNumber ?? 0 }),
      } as unknown as ConsoleMessage;
      for (const handler of listeners['console'] ?? []) handler(message as never);
    },
    emitPageError: (error) => {
      for (const handler of listeners['pageerror'] ?? []) handler(error as never);
    },
  };
}

const testInfo = () => ({ attach: vi.fn() }) as unknown as TestInfo;

beforeEach(() => {
  failures.length = 0;
});

describe('isAcceptedConsoleError', () => {
  it('accepts the favicon 404, which is the one request the entry is about', () => {
    expect(isAcceptedConsoleError({ text: NOT_FOUND_TEXT, location: FAVICON })).toBe(true);
  });

  it('REFUSES the same 404 text on any other URL', () => {
    // This is the defect. Before, `accepted()` was `text.includes(entry.match)` over a
    // substring Chrome emits for EVERY 404, so a mistyped asset path, a deleted module
    // and a broken image were all accepted on the strength of a favicon's reason — and
    // `requestfailed` never sees them, because it fires on a transport failure and a 404
    // is a successful conversation that ended in the wrong status code.
    expect(isAcceptedConsoleError({ text: NOT_FOUND_TEXT, location: APP_JS })).toBe(false);
  });

  it('refuses the 404 text when the message carries no URL at all', () => {
    // The conservative direction, and the reason the entry is not `url?.includes(...)`:
    // a missing location is not evidence for /favicon.ico.
    expect(isAcceptedConsoleError({ text: NOT_FOUND_TEXT })).toBe(false);
  });

  it('matches the PATHNAME, so a query string or a fragment cannot smuggle a match', () => {
    // A predicate over the whole URL would accept `/assets/app.js?next=/favicon.ico`,
    // which is not the favicon by any reading.
    expect(
      isAcceptedConsoleError({
        text: NOT_FOUND_TEXT,
        location: { url: 'http://localhost:5173/assets/app.js?next=/favicon.ico', lineNumber: 0 },
      })
    ).toBe(false);
    expect(
      isAcceptedConsoleError({
        text: NOT_FOUND_TEXT,
        location: { url: 'http://localhost:5173/favicon.ico?v=2', lineNumber: 0 },
      })
    ).toBe(true);
  });

  it('refuses the 404 text when the location URL cannot be parsed', () => {
    // `message.location()` is typed as always returning a url, but the field is a
    // string from the browser and a rule that throws on it would fail the run from the
    // assertion rather than from the defect.
    expect(isAcceptedConsoleError({ text: NOT_FOUND_TEXT, location: { url: '', lineNumber: 0 } })).toBe(false);
  });

  it('keeps the boundary entry on text alone, with no URL needed and none consulted', () => {
    // The two entries that are about what the APP logs cannot be narrowed by URL: the
    // boundary's own console.error and React's report of an injected fault have no
    // meaningful resource URL, and narrowing them would delete the allowlist's reason
    // for existing.
    expect(isAcceptedConsoleError({ text: BOUNDARY_TEXT })).toBe(true);
    expect(isAcceptedConsoleError({ text: BOUNDARY_TEXT, location: APP_JS })).toBe(true);
    expect(isAcceptedConsoleError({ text: INJECTED_TEXT })).toBe(true);
    expect(isAcceptedConsoleError({ text: INJECTED_TEXT, location: FAVICON })).toBe(true);
  });

  it('still refuses an unaccounted console error', () => {
    expect(
      isAcceptedConsoleError({
        text: 'Invalid value for prop `redraw` on <div> tag.',
        location: { url: 'http://localhost:5173/src/components/Tool/CropToolArea.tsx:120', lineNumber: 120 },
      })
    ).toBe(false);
  });
});

describe('ACCEPTED_CONSOLE_ERRORS', () => {
  it('gives every entry a non-empty reason, since the reason is the whole claim', () => {
    for (const entry of ACCEPTED_CONSOLE_ERRORS) {
      expect(entry.reason.trim().length).toBeGreaterThan(20);
    }
  });

  it('scopes a URL only where text alone cannot decide the entry', () => {
    // A `urlPattern` on either of the other two would be a narrowing nobody asked for,
    // and it is the shape a future edit takes by accident.
    const scoped = ACCEPTED_CONSOLE_ERRORS.filter((entry) => entry.urlPattern);
    expect(scoped).toHaveLength(2);
    expect(scoped[0].match).toBe(NOT_FOUND_TEXT);
    expect(scoped[1].match).toBe('color-sampler-cap-reached');
  });
});

describe('ConsolePolice.assertClean', () => {
  it('passes a run whose only console error is the favicon 404', () => {
    const { police, emitConsole } = harness();
    emitConsole('error', NOT_FOUND_TEXT, FAVICON);

    police.assertClean(testInfo());

    expect(failures, 'the favicon 404 is still accounted for, on the run this suite does').toEqual([]);
  });

  it('FAILS a 404 on an application URL, and names it in the message', () => {
    // The favicon 404 is emitted FIRST on purpose, because that is the order the suite
    // produces: there is no `public/` directory and `index.html:5` has the
    // `<link rel="icon">` line commented out, so Chrome's unprompted probe is 404ing
    // before any application request. Written with the application 404 alone, the case
    // passed for a reason the real suite never reproduces, and the gate fired or not
    // depending on which 404 Chrome happened to report first.
    const { police, emitConsole } = harness();
    emitConsole('error', NOT_FOUND_TEXT, FAVICON);
    emitConsole('error', NOT_FOUND_TEXT, APP_JS);

    expect(() => police.assertClean(testInfo())).toThrow(/console error/);
    expect(failures.join('\n')).toContain('/assets/app.js');
  });

  it('keeps two URLs on the same text as two entries, each with its own count', () => {
    // The recording half of the same defect. `render()` and `console-police.json` are the
    // two things a developer reads when this gate fires, and both read the map entry, so
    // a text-only key reports `x3` for three defects in two places and names one of them.
    const { police, emitConsole } = harness();
    const WORKER_JS = { url: 'http://localhost:5173/assets/worker.js', lineNumber: 0 };
    emitConsole('error', NOT_FOUND_TEXT, APP_JS);
    emitConsole('error', NOT_FOUND_TEXT, WORKER_JS);
    emitConsole('error', NOT_FOUND_TEXT, APP_JS);

    const info = testInfo();
    expect(() => police.assertClean(info)).toThrow();

    const message = failures.join('\n');
    expect(message).toContain(`x2 ${NOT_FOUND_TEXT} (http://localhost:5173/assets/app.js:0)`);
    expect(message).toContain(`x1 ${NOT_FOUND_TEXT} (http://localhost:5173/assets/worker.js:0)`);
    expect(message).not.toContain('x3');

    const attach = info.attach as unknown as { mock: { calls: [string, { body: string }][] } };
    const report = JSON.parse(attach.mock.calls[0][1].body) as {
      consoleErrors: { text: string; count: number; location: { url: string; lineNumber: number } }[];
    };
    expect(report.consoleErrors).toEqual([
      { text: NOT_FOUND_TEXT, count: 2, location: APP_JS },
      { text: NOT_FOUND_TEXT, count: 1, location: WORKER_JS },
    ]);
  });

  it('FAILS the same pair in the opposite order, so the verdict is not a race', () => {
    // The mirror of the case above, and the reason the change belongs in `record` rather
    // than in the rule: each message is judged by its own URL whichever arrives first, and
    // the favicon's own exemption still holds once an application 404 has been recorded.
    const { police, emitConsole } = harness();
    emitConsole('error', NOT_FOUND_TEXT, APP_JS);
    emitConsole('error', NOT_FOUND_TEXT, FAVICON);

    expect(() => police.assertClean(testInfo())).toThrow(/console error/);
    expect(failures.join('\n')).toContain('/assets/app.js');
    // The favicon is accepted, so it is not rendered — and it did not donate its location
    // to the entry that failed, which is what would have named /favicon.ico here.
    expect(failures.join('\n')).not.toContain('/favicon.ico');
  });

  it('FAILS a page error even when its text is an allowlisted one', () => {
    // The allowlist is for console output the app logs on purpose. An uncaught
    // exception is a defect whatever it says, and routing page errors through
    // `isAcceptedConsoleError` is the edit this case exists to catch.
    const { police, emitConsole, emitPageError } = harness();
    emitConsole('error', NOT_FOUND_TEXT, FAVICON);
    emitPageError(new Error(BOUNDARY_TEXT));

    expect(() => police.assertClean(testInfo())).toThrow(/uncaught exception/);
    expect(failures.join('\n')).toContain(BOUNDARY_TEXT);
  });

  it('passes the two specs that provoke the two app-logged messages', () => {
    const { police, emitConsole } = harness();
    emitConsole('error', BOUNDARY_TEXT, { url: 'http://localhost:5173/src/index.tsx', lineNumber: 1 });
    emitConsole('error', INJECTED_TEXT, { url: 'http://localhost:5173/src/index.tsx', lineNumber: 1 });

    police.assertClean(testInfo());

    expect(failures).toEqual([]);
  });

  it('does not fail on warnings or failed requests, and still reports them', () => {
    const { police, emitConsole } = harness();
    emitConsole('warning', '[vite] connecting...', APP_JS);

    const info = testInfo();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      police.assertClean(info);
    } finally {
      log.mockRestore();
    }

    expect(failures).toEqual([]);
    expect(info.attach).toHaveBeenCalledWith(
      'console-police.json',
      expect.objectContaining({ contentType: 'application/json' })
    );
  });

  it('attaches the report even when it is about to fail, so the run has the message', () => {
    const { police, emitConsole } = harness();
    emitConsole('error', 'something nobody allowlisted');

    const info = testInfo();
    expect(() => police.assertClean(info)).toThrow();
    expect(info.attach).toHaveBeenCalledOnce();
  });
});
