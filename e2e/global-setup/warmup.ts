import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const INDEX_HTML = fileURLToPath(new URL('../../index.html', import.meta.url));

/** One whole `<script ...>` tag. Attribute order is not the tag's business. */
const SCRIPT_TAG_PATTERN = /<script\b[^>]*>/gi;
const SCRIPT_TYPE_PATTERN = /\btype\s*=\s*["']?([^"'\s>]+)/i;
const SCRIPT_SRC_PATTERN = /\bsrc\s*=\s*["']([^"']+)["']/i;

/** Fallback if `index.html` ever stops matching: the entry Vite is serving today. */
const FALLBACK_MODULE_ENTRY = '/src/main.tsx';

export const WARMUP_TIMEOUT_MS = 5_000;
export const PER_ATTEMPT_TIMEOUT_MS = 2_500;
export const WARMUP_INTERVAL_MS = 250;

const TERMINAL_STATUSES: ReadonlySet<number> = new Set([404, 410]);
const HTML_CONTENT_TYPE = /\btext\/html\b/i;

function moduleEntryFromHtml(html: string | null): string | null {
  if (!html) return null;
  for (const [tag] of html.matchAll(SCRIPT_TAG_PATTERN)) {
    if (SCRIPT_TYPE_PATTERN.exec(tag)?.[1]?.toLowerCase() !== 'module') continue;
    const src = SCRIPT_SRC_PATTERN.exec(tag)?.[1];
    if (src) return src;
  }
  return null;
}

export interface WarmupPlan {
  /** The module URL to request, or `null` when the warm-up is skipped. */
  url: string | null;
  /** Why. Logged verbatim, so a run's output says whether the warm-up happened. */
  reason: string;
}

export function planWarmup(options: {
  baseUrl: string | undefined;
  webServerUrl: string | undefined;
  html: string | null;
}): WarmupPlan {
  const baseUrl = options.baseUrl?.trim();
  if (!baseUrl) {
    return { url: null, reason: 'skipping warm-up: no base URL is configured' };
  }

  let origin: URL;
  try {
    origin = new URL(baseUrl);
  } catch {
    return { url: null, reason: `skipping warm-up: base URL ${JSON.stringify(baseUrl)} is not a URL` };
  }
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
    return { url: null, reason: `skipping warm-up: base URL scheme ${origin.protocol} is not http(s)` };
  }

  const webServer = parseHttpUrl(options.webServerUrl);
  if (webServer && webServer.origin !== origin.origin) {
    return {
      url: null,
      reason:
        `skipping warm-up: the tests will load ${origin.origin}, not the dev server this run started ` +
        `at ${webServer.origin}; a local warm-up cannot improve a remote origin`,
    };
  }

  const entry = moduleEntryFromHtml(options.html) ?? FALLBACK_MODULE_ENTRY;

  let url: URL;
  try {
    url = new URL(entry, origin);
  } catch {
    return { url: null, reason: `skipping warm-up: the module entry ${JSON.stringify(entry)} is not a URL` };
  }

  const basePath = origin.pathname.endsWith('/') ? origin.pathname : `${origin.pathname}/`;
  if (!url.pathname.startsWith(basePath)) {
    return {
      url: null,
      reason: `skipping warm-up: the module entry resolves to ${url.pathname}, outside the base path ${basePath}`,
    };
  }

  return { url: url.toString(), reason: `warming the dev server with ${entry}` };
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

export interface WarmupResult {
  warmed: boolean;
  url: string | null;
  reason: string;
  attempts: number;
  elapsedMs: number;
}

export interface WarmupDeps {
  fetch: (
    url: string,
    init: { signal: AbortSignal; headers: Record<string, string> }
  ) => Promise<{ ok: boolean; status: number; contentType: string }>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  abortSignal: (ms: number) => AbortSignal;
  timeoutMs: number;
  intervalMs: number;
}

export async function runWarmup(plan: WarmupPlan, deps: WarmupDeps): Promise<WarmupResult> {
  if (plan.url === null) {
    return { warmed: false, url: null, reason: plan.reason, attempts: 0, elapsedMs: 0 };
  }

  const started = deps.now();
  const deadline = started + deps.timeoutMs;
  let attempts = 0;
  let lastError = 'no response';

  const notWarmed = (why: string): WarmupResult => ({
    warmed: false,
    url: plan.url,
    reason: `${why}; continuing, the tests will report anything real`,
    attempts,
    elapsedMs: deps.now() - started,
  });

  for (;;) {
    const remaining = deadline - deps.now();
    if (remaining <= 0) break;
    attempts += 1;

    try {
      const response = await deps.fetch(plan.url, {
        signal: deps.abortSignal(Math.min(remaining, PER_ATTEMPT_TIMEOUT_MS)),
        headers: { accept: '*/*' },
      });

      const contentType = response.contentType ?? '';
      if (response.ok && !HTML_CONTENT_TYPE.test(contentType)) {
        return {
          warmed: true,
          url: plan.url,
          reason: `warmed the dev server: ${plan.url} answered HTTP ${response.status} (${contentType}) after ${attempts} attempt(s)`,
          attempts,
          elapsedMs: deps.now() - started,
        };
      }

      if (response.ok) {
        return notWarmed(
          `not warmed: ${plan.url} answered HTTP ${response.status} with content-type ${contentType || '(none)'}, ` +
            'which is the SPA fallback rather than a module, so nothing was transformed'
        );
      }

      lastError = `HTTP ${response.status}`;
      if (TERMINAL_STATUSES.has(response.status)) {
        return notWarmed(`not warmed: ${plan.url} answered HTTP ${response.status}, which no retry will change`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (deps.now() + deps.intervalMs >= deadline) break;
    await deps.sleep(deps.intervalMs);
  }

  return notWarmed(`warm-up gave up after ${attempts} attempt(s) in ${deps.timeoutMs}ms (${lastError})`);
}

export function readIndexHtml(): string | null {
  try {
    return readFileSync(INDEX_HTML, 'utf8');
  } catch {
    return null;
  }
}

export function resolvedBaseUrls(config: Pick<import('@playwright/test').FullConfig, 'projects'>): string[] {
  const baseUrls = new Set<string>();
  for (const project of config.projects) {
    const baseURL = project.use.baseURL;
    if (typeof baseURL === 'string' && baseURL.trim() !== '') baseUrls.add(baseURL.trim());
  }
  if (baseUrls.size > 0) return [...baseUrls];
  const envBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
  return envBaseUrl ? [envBaseUrl] : [];
}

export function resolvedBaseUrl(config: Pick<import('@playwright/test').FullConfig, 'projects'>): string | undefined {
  return resolvedBaseUrls(config)[0];
}

export function resolvedWebServerUrl(
  config: Pick<import('@playwright/test').FullConfig, 'webServer'>
): string | undefined {
  const url = config.webServer?.url;
  return typeof url === 'string' && url !== '' ? url : undefined;
}
