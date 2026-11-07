/** What named a window-opening hazard, and what it would have done. */
export interface WindowHazard {
  /** The exact token, quoted into the refusal so the reader can see what the run typed. */
  cause: string;
  /** Why that token opens something. Reported separately because the two causes differ. */
  why: string;
}

const HTML_OPEN_ENV_VARS = ['PLAYWRIGHT_HTML_OPEN', 'PW_TEST_HTML_REPORT_OPEN'] as const;
const NON_OPENING_HTML_OPEN = 'never';
const REPORTER_ENV_VAR = 'PW_TEST_REPORTER';
const REPORTER_FLAGS = ['--reporter', '--add-reporter'] as const;
const OPENING_REPORTER = 'html';

export function checkHtmlOpenEnv(env: Record<string, string | undefined>): WindowHazard | null {
  for (const variable of HTML_OPEN_ENV_VARS) {
    const value = env[variable];
    if (!value || value === NON_OPENING_HTML_OPEN) continue;
    return {
      cause: `${variable}=${value}`,
      why:
        `${variable} is read as the HTML reporter's "open" option, and it outranks the ` +
        `\`open: '${NON_OPENING_HTML_OPEN}'\` in playwright.config.ts`,
    };
  }
  return null;
}

function namesHtmlReporter(value: string): boolean {
  return value.split(',').includes(OPENING_REPORTER);
}

/** Detect CLI or environment reporter selections that use the HTML reporter's opening default. */
export function checkHtmlReporterSelection(options: {
  argv: readonly string[];
  env: Record<string, string | undefined>;
}): WindowHazard | null {
  const fromEnv = options.env[REPORTER_ENV_VAR];
  if (fromEnv && namesHtmlReporter(fromEnv)) {
    return {
      cause: `${REPORTER_ENV_VAR}=${fromEnv}`,
      why: `${REPORTER_ENV_VAR} adds a reporter built from no options, so "open" resolves to "on-failure"`,
    };
  }

  for (const [index, arg] of options.argv.entries()) {
    if (arg === '--') break;

    const flag = REPORTER_FLAGS.find((candidate) => arg === candidate || arg.startsWith(`${candidate}=`));
    if (!flag) continue;

    const value = arg.includes('=') ? arg.slice(flag.length + 1) : (options.argv[index + 1] ?? '');
    if (!namesHtmlReporter(value)) continue;

    return {
      cause: `${flag} ${value}`,
      why:
        `${flag === '--reporter' ? 'replaces' : 'adds to'} the reporter list, and a reporter ` +
        'named on the command line carries no "open" option, so it resolves to "on-failure"',
    };
  }

  return null;
}

export function refuseOpeningHtmlReport(hazard: WindowHazard | null): void {
  if (!hazard) return;

  throw new Error(
    [
      `Refusing to start a run that would open the HTML report and then never exit: ${hazard.cause}.`,
      '',
      `This run ${hazard.why}. Playwright serves the report, hands it to the`,
      'default browser, and waits for the browser to close before the run can finish.',
      '',
      "playwright.config.ts asks for `open: 'never'` on purpose, and asking is not the same as",
      'binding: this refusal is what makes the ask hold for every `playwright test` invocation,',
      'and `kilo.jsonc` refuses the same tokens at the permission layer, before the process',
      'starts. Nothing here has an escape hatch, on purpose: a variable that switches off this',
      'refusal would put the guarantee one `export` away from being false.',
      '',
      'Run `npm run test:e2e`. It writes `playwright-report/` and never opens it.',
      '',
      'To read a failure, open the screenshot Playwright already wrote under the run output',
      'directory: test-results/, or test-results/runs/<run-id>/ when the run went through',
      'scripts/e2e-run.mjs, which prints the path it used. Add --retries=1 so `trace:',
      "'on-first-retry' produces a trace file. Do not run `show-report` or `show-trace`: both open",
      'a window and block until you close it.',
    ].join('\n')
  );
}
