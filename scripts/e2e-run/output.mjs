import path from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/** One output directory per run; the HTML report remains the shared report viewer. */
export function runOutputPaths(repoRoot, runId) {
  return { outputDir: path.join(repoRoot, 'test-results', 'runs', runId), htmlDir: null };
}

/** The Playwright CLI, resolved through Node so an ancestor `node_modules` works. */
export function resolvePlaywrightCli() {
  const require = createRequire(path.join(REPO_ROOT, 'package.json'));
  const manifestPath = require.resolve('@playwright/test/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.playwright;
  if (!entry) throw new Error('@playwright/test declares no `playwright` bin, so its CLI cannot be started');
  return path.join(path.dirname(manifestPath), entry);
}
