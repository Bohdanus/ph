import type { FullConfig } from '@playwright/test';

/** The only environment value this guard accepts. Set by `npm run test:e2e:headed`. */
export const ALLOW_ENV = 'PLAYWRIGHT_ALLOW_HEADED';

export function refuseVisibleBrowser(config: FullConfig): void {
  if (process.env[ALLOW_ENV] === '1') return;

  const reasons: string[] = [];

  // Playwright UI mode skips global setup; kilo.jsonc refuses it before the command starts.
  for (const flag of ['--headed', '--debug']) {
    if (config.argv.includes(flag)) reasons.push(`\`${flag}\``);
  }

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
      'any more, so a headed run is expected to agree rather than fail differently. See',
      'e2e/README.md and e2e/OPEN_PROBLEMS.md.',
      '',
      'To read a failure, open the screenshot Playwright already wrote under the run output',
      'directory: test-results/, or test-results/runs/<run-id>/ when the run went through',
      'scripts/e2e-run.mjs, which prints the path it used. Do not open a viewer, and do not run',
      '`show-report` or `show-trace`: both open a window, and both block until you close it.',
      '',
      'If something genuinely only reproduces visually and you need to watch it, that is the',
      `operator's call, not yours: ask them to run \`npm run test:e2e:headed\`, which sets`,
      `${ALLOW_ENV}=1. To unblock a run without a window, add --retries=1 so \`trace:`,
      "'on-first-retry' produces a trace file, and read the failure PNG from the test's own",
      'outputDir instead.',
    ].join('\n')
  );
}
