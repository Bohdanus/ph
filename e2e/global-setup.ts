import type { FullConfig } from '@playwright/test';

/**
 * Refuses to start a run that would put a browser window on the operator's screen.
 *
 * `use.headless` in `playwright.config.ts` already defaults to headless, but that
 * setting only governs the default. Three of Playwright's own flags bypass it:
 * `--headed`, `--debug` and `--ui` each override the resolved value after the
 * config has been read, and `show-report` / `show-trace` / `codegen` never load this
 * config at all. So "the config says headless" was a convention with four ways to
 * route around it, and the way you route around it is typing a flag.
 *
 * This turns the convention into a refusal that arrives before a single window is
 * created, with a message that says what to run instead. It is the difference
 * between a rule and a comment about a rule.
 *
 * ## What it can and cannot see
 *
 * The check is on the RESOLVED per-project `use.headless`, not on the config file,
 * because that is the value the browser will actually be launched with. A CLI
 * `--headed` is merged into every project's `use` before `globalSetup` runs, so this
 * catches it, and so does `--debug` (which forces `headless = false` itself) and any
 * `test.use({ headless: false })` written at project scope.
 *
 * It cannot see a `test.use({ headless: false })` inside a single spec file: that is
 * resolved per test, below this layer. Nothing in `e2e/` does that today, and
 * closing it would mean every spec importing a shared `test` from a fixtures module
 * instead of `@playwright/test`. Most of the specs import it directly, so the hole is
 * real but wide; closing it is a larger change than it looks and is not needed to
 * keep an agent from running `--headed`.
 *
 * ## The escape hatch
 *
 * `PLAYWRIGHT_ALLOW_HEADED=1`, which is what `npm run test:e2e:headed` sets. It is
 * named "allow" rather than "headed" on purpose: a model debugging a red suite will
 * try `PLAYWRIGHT_HEADED=1` because that is the obvious thing to type, and that must
 * not be enough. This variable is the human's signature on the run, and `kilo.json`
 * blocks the agent from reaching the command at all.
 */

/** The only environment value this guard accepts. Set by `npm run test:e2e:headed`. */
const ALLOW_ENV = 'PLAYWRIGHT_ALLOW_HEADED';

export default function refuseVisibleBrowser(config: FullConfig): void {
  if (process.env[ALLOW_ENV] === '1') return;

  const reasons: string[] = [];

  // Named explicitly so the message says which flag caused it. Authoritative for
  // `--headed` and `--debug`; `--ui` is not caught by the `use.headless` check below,
  // because in UI mode the test browsers stay headless and it is the UI itself that
  // opens in the default browser.
  for (const flag of ['--headed', '--debug', '--ui']) {
    if (config.argv.includes(flag)) reasons.push(`\`${flag}\``);
  }

  // The authoritative check. `use.headless` is `false` here for `--headed`,
  // `--debug`, `PLAYWRIGHT_ALLOW_HEADED=1`, and any project-scope `test.use`.
  for (const project of config.projects) {
    if (project.use.headless === false) reasons.push(`project "${project.name}" resolved to headless: false`);
  }

  if (reasons.length === 0) return;

  const cause = [...new Set(reasons)].join(', ');

  throw new Error(
    [
      `Refusing to start a run with a visible browser: ${cause}.`,
      '',
      "A headed browser puts a live, clickable window on the operator's screen for the whole run.",
      'Their clicks, keystrokes, mouse movement and focus changes all reach the page as real',
      "input, indistinguishable from the suite's own page.mouse / page.keyboard calls. The test",
      'then fails for a reason that is not in the code, and because the interference is',
      'intermittent it is indistinguishable from a real race. Both get filed as "flaky" and',
      'neither gets fixed.',
      '',
      'Run `npm run test:e2e`. It is headless, and this suite is verified headless. A',
      'headed run is a different measurement, not a stricter one: the CDP capture and the',
      'levels specs were root-caused and fixed, and neither reads a mode-dependent scale',
      'any more, so a headed run is expected to agree rather than to fail differently. See',
      'e2e/README.md and e2e/OPEN_PROBLEMS.md.',
      '',
      'To read a failure, open the screenshot Playwright already wrote under test-results/ on',
      'failure. Do not open a viewer, and do not run `show-report` or `show-trace`: both open',
      'a window, and both block until you close it.',
      '',
      'If something genuinely only reproduces visually and you need to watch it, that is the',
      `operator's call, not yours: ask them to run \`npm run test:e2e:headed\`, which sets`,
      `${ALLOW_ENV}=1. To unblock a run without a window, add --retries=1 so \`trace:`,
      "'on-first-retry' produces a trace file, and read the failure PNG from the test's own",
      'outputDir instead.',
    ].join('\n')
  );
}
