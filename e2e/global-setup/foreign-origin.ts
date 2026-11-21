import { URL } from 'node:url';

export const ALLOW_REMOTE_ENV = 'E2E_ALLOW_REMOTE';

export interface OwnServerCheck {
  /** False only when the run would navigate somewhere its own dev server is not. */
  permitted: boolean;
  /** Logged on EVERY run, so a report can never imply a local verification. */
  reason: string;
}

function parseHttpUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function normalizeOwnServerBaseUrl(configuredBaseUrl: string | undefined, webServerUrl: string): string {
  if (!configuredBaseUrl) return webServerUrl;

  const configured = parseHttpUrl(configuredBaseUrl);
  const webServer = parseHttpUrl(webServerUrl);
  if (
    configured?.protocol === 'http:' &&
    configured.hostname === 'localhost' &&
    webServer?.protocol === 'http:' &&
    configured.port === webServer.port
  ) {
    configured.hostname = webServer.hostname;
    return configured.toString();
  }

  return configuredBaseUrl;
}

export function checkOwnServer(options: {
  baseUrl: string | undefined;
  webServerUrl: string | undefined;
  allowRemote: string | undefined;
}): OwnServerCheck {
  const baseUrl = options.baseUrl?.trim();
  if (options.allowRemote === '1') {
    return {
      permitted: true,
      reason: `${ALLOW_REMOTE_ENV}=1: this run tests ${baseUrl ?? 'an unspecified URL'}, which is NOT this checkout`,
    };
  }

  if (!baseUrl) {
    return {
      permitted: false,
      reason: 'no base URL is configured, so this run cannot verify that the tests load its own server',
    };
  }

  const target = parseHttpUrl(baseUrl);
  if (!target) {
    return {
      permitted: false,
      reason:
        `base URL ${JSON.stringify(baseUrl)} is not an http(s) URL, so this run cannot show that it is ` +
        'loading the server it started',
    };
  }

  const webServer = parseHttpUrl(options.webServerUrl);
  if (!webServer) {
    return {
      permitted: false,
      reason: 'no webServer URL is configured, so this run could not verify that the tests load its own server',
    };
  }

  if (webServer.origin === target.origin) {
    return { permitted: true, reason: `the tests will load the dev server this run started at ${target.origin}` };
  }

  return {
    permitted: false,
    reason:
      `the tests will load ${target.origin}, but the dev server this run started is at ${webServer.origin}. ` +
      'A run that tests another origin is not a run about this branch.',
  };
}

export function refuseForeignOrigin(check: OwnServerCheck): void {
  if (check.permitted) return;
  throw new Error(
    [
      `Refusing to start a run against a server it did not start: ${check.reason}`,
      '',
      'Every worktree serves its own checkout, so a suite pointed at a foreign origin reports',
      "somebody else's code as this branch's result — green, with the artifacts everyone trusts.",
      'TEST-FLAKES.md §10 is a mutation campaign that reported every mutation green that way.',
      '',
      'If you mean to test a deployed build, say so explicitly:',
      `  ${ALLOW_REMOTE_ENV}=1 PLAYWRIGHT_BASE_URL=https://staging.example.com npx playwright test`,
      '',
      'and the run will log, on every run, which origin the tests were pointed at.',
    ].join('\n')
  );
}
