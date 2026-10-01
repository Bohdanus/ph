#!/usr/bin/env node
/**
 * Headless console/pageerror probe.
 * ----------------------------------
 * WHY THIS EXISTS
 *   `e2e/` had no `console` listener anywhere, so a React prop warning or an
 *   unhandled rejection in any of the ~300 specs was invisible: the run went
 *   green and the message went to stdout nobody reads. A throwaway tour of the
 *   real app found `redraw` being spread onto a `<div>` (React logs an error for
 *   every render of the Crop and Rectangular Selection tools) and a 404, both
 *   under a passing suite. This makes that class of finding a command.
 *
 * WHY A SCRIPT AND NOT AN MCP SERVER
 *   The capability is not missing. `@playwright/test` re-exports `chromium`, the
 *   browser is already downloaded, and `launch()` is headless by default — the
 *   cost of a server would be process lifecycle, stdio framing and version
 *   pinning, to call a library this repo already depends on.
 *
 *   It would also be a hole in this repo's own safety mechanism. `kilo.jsonc`
 *   denies window-opening commands with `permission.bash` globs, which match
 *   shell commands, and `e2e/global-setup.ts` refuses them from inside
 *   Playwright. An `mcp_*_navigate_page` call is neither, so any browser MCP
 *   would reopen exactly the window `AGENTS.md` forbids. A file in `scripts/` is
 *   version-controlled, reviewable, and visible in the Commands table agents read.
 *
 * HEADLESS IS NOT NEGOTIABLE
 *   `headless` is hardcoded below and is NOT read from the environment. An
 *   env-read flag is one refactor away from an operator's terminal opening a
 *   window mid-run, and every input that reaches a headed run also reaches the
 *   test as real input. The invocation guard exists so the failure is an
 *   explanation rather than a blank refusal.
 *
 * USAGE
 *   npm run probe:console                              # the app on :5173
 *   npm run probe:console -- --url http://localhost:5199
 *   npm run probe:console -- --viewport 390x844 --dsf 3
 *   npm run probe:console -- --allow "Failed to load resource"
 *
 * EXIT CODE
 *   1 when any console error or page error survived the allowlist, so it can be
 *   used in a script. 0 otherwise.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const argv = process.argv.slice(2);
const flag = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
};
const has = (name) => argv.includes(`--${name}`);

if (has('headed') || process.env.PLAYWRIGHT_ALLOW_HEADED) {
  console.error(
    'probe:console is headless by design and refuses a headed invocation.\n' +
      "A visible window puts live input on the page that is indistinguishable from the probe's own.\n" +
      'To watch the app by hand, run `npm run dev` and open it yourself.'
  );
  process.exit(2);
}

const port = process.env.PLAYWRIGHT_PORT ?? '5173';
const url = flag('url') ?? `http://localhost:${port}/`;
const dsf = Number(flag('dsf') ?? '1');
const viewportArg = flag('viewport') ?? '1280x800';
const [width, height] = viewportArg.split('x').map(Number);
const allow = [flag('allow')].filter(Boolean);

const CAPTURED = { consoleErrors: [], consoleWarnings: [], pageErrors: [], requestFailures: [] };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dsf });
const page = await context.newPage();

page.on('console', (message) => {
  const entry = { text: message.text().slice(0, 300), location: message.location() };
  if (message.type() === 'error') CAPTURED.consoleErrors.push(entry);
  if (message.type() === 'warning') CAPTURED.consoleWarnings.push(entry);
});
page.on('pageerror', (error) => CAPTURED.pageErrors.push({ text: String(error).slice(0, 300) }));
page.on('requestfailed', (request) =>
  CAPTURED.requestFailures.push({
    text: `${request.url().slice(0, 140)} :: ${request.failure()?.errorText}`,
  })
);

let loadFailure = null;
try {
  await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
} catch (error) {
  loadFailure = String(error).split('\n')[0];
}

await page.waitForTimeout(2500);

const page_state = await page
  .evaluate(() => {
    const canvas = document.querySelector('[data-testid="workspace-canvas"]');
    const result = { dpr: window.devicePixelRatio, fonts: document.fonts.size, canvas: null };
    if (canvas instanceof HTMLCanvasElement) {
      const box = canvas.getBoundingClientRect();
      result.canvas = {
        attribute: `${canvas.width}x${canvas.height}`,
        css: `${Math.round(box.width)}x${Math.round(box.height)}`,
        expectedAtThisDpr: `${Math.round(box.width * window.devicePixelRatio)}x${Math.round(
          box.height * window.devicePixelRatio
        )}`,
      };
    }
    return result;
  })
  .catch((error) => ({ evaluateError: String(error).slice(0, 200) }));

await page.screenshot({ path: flag('out') ?? 'test-results/probe-console.png' });
await context.close();
await browser.close();

const allowed = (entries) => entries.filter((entry) => !allow.some((a) => entry.text.includes(a)));
const uniq = (entries) => {
  const seen = new Map();
  for (const entry of entries) {
    if (!seen.has(entry.text)) seen.set(entry.text, { ...entry, count: 0 });
    seen.get(entry.text).count += 1;
  }
  return [...seen.values()];
};

const errors = uniq(allowed(CAPTURED.consoleErrors));
const pageErrors = uniq(allowed(CAPTURED.pageErrors));
const warnings = uniq(CAPTURED.consoleWarnings);
const failures = uniq(CAPTURED.requestFailures);

console.log(`probe:console  ${url}  ${viewportArg} @${dsf}x`);
if (loadFailure) console.log(`  LOAD FAILED: ${loadFailure}`);
console.log(`  page: ${JSON.stringify(page_state)}`);
console.log(`  console errors: ${errors.length}   page errors: ${pageErrors.length}`);
console.log(`  console warnings: ${warnings.length}   failed requests: ${failures.length}`);
for (const [label, group] of [
  ['CONSOLE ERROR', errors],
  ['PAGE ERROR', pageErrors],
  ['CONSOLE WARNING', warnings],
  ['FAILED REQUEST', failures],
]) {
  if (!group.length) continue;
  console.log(`\n  ${label}`);
  for (const entry of group) {
    console.log(`    x${entry.count}  ${entry.text}`);
    if (entry.location?.url) console.log(`          ${entry.location.url}:${entry.location.lineNumber}`);
  }
}
console.log('');

if (loadFailure || errors.length || pageErrors.length) {
  console.log('probe:console FAILED — the page reported errors.');
  process.exit(1);
}
console.log('probe:console clean — no console errors, no page errors.');
