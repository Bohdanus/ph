import type { FullConfig } from '@playwright/test';

import { refuseVisibleBrowser, ALLOW_ENV } from './global-setup/headed.ts';
import { checkHtmlOpenEnv, checkHtmlReporterSelection, refuseOpeningHtmlReport } from './global-setup/html-report.ts';
import { checkOwnServer, refuseForeignOrigin, ALLOW_REMOTE_ENV } from './global-setup/foreign-origin.ts';
import {
  planWarmup,
  runWarmup,
  readIndexHtml,
  resolvedBaseUrls,
  resolvedBaseUrl,
  resolvedWebServerUrl,
  WARMUP_TIMEOUT_MS,
  WARMUP_INTERVAL_MS,
  PER_ATTEMPT_TIMEOUT_MS,
} from './global-setup/warmup.ts';

export {
  refuseVisibleBrowser,
  ALLOW_ENV,
  checkHtmlOpenEnv,
  checkHtmlReporterSelection,
  refuseOpeningHtmlReport,
  checkOwnServer,
  refuseForeignOrigin,
  ALLOW_REMOTE_ENV,
  planWarmup,
  runWarmup,
  readIndexHtml,
  resolvedBaseUrls,
  resolvedBaseUrl,
  resolvedWebServerUrl,
  WARMUP_TIMEOUT_MS,
  WARMUP_INTERVAL_MS,
  PER_ATTEMPT_TIMEOUT_MS,
};

export default async function globalSetup(config: FullConfig): Promise<void> {
  refuseVisibleBrowser(config);
  refuseOpeningHtmlReport(checkHtmlOpenEnv(process.env));
  refuseOpeningHtmlReport(checkHtmlReporterSelection({ argv: config.argv, env: process.env }));

  const baseUrls = resolvedBaseUrls(config);
  const baseUrl = baseUrls[0];
  const webServerUrl = resolvedWebServerUrl(config);
  for (const projectBaseUrl of baseUrls.length > 0 ? baseUrls : [undefined]) {
    const ownServer = checkOwnServer({
      baseUrl: projectBaseUrl,
      webServerUrl,
      allowRemote: process.env[ALLOW_REMOTE_ENV],
    });
    refuseForeignOrigin(ownServer);
    console.log(`[global-setup] ${ownServer.reason}`);
  }

  const plan = planWarmup({
    baseUrl,
    webServerUrl,
    html: readIndexHtml(),
  });
  const result = await runWarmup(plan, {
    fetch: (url, init) =>
      fetch(url, init).then((response) => ({
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
      })),
    now: () => Date.now(),
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    abortSignal: (ms) => AbortSignal.timeout(ms),
    timeoutMs: WARMUP_TIMEOUT_MS,
    intervalMs: WARMUP_INTERVAL_MS,
  });
  console.log(`[global-setup] ${result.reason}`);
}
