import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const testDirectory = import.meta.dirname;
const ciWorkflow = readFileSync(join(testDirectory, '../../.github/workflows/ci.yml'), 'utf8');
const focusedE2EWorkflow = readFileSync(join(testDirectory, '../../.github/workflows/focused-e2e.yml'), 'utf8');
const baselineCaptureWorkflow = readFileSync(
  join(testDirectory, '../../.github/workflows/capture-linux-baselines.yml'),
  'utf8'
);
const playwrightConfig = readFileSync(join(testDirectory, '../../playwright.config.ts'), 'utf8');
const packageManifest = JSON.parse(readFileSync(join(testDirectory, '../../package.json'), 'utf8'));
const packageLock = JSON.parse(readFileSync(join(testDirectory, '../../package-lock.json'), 'utf8'));
// This is nominal job headroom: GitHub's clock includes setup while Playwright's starts at test launch.
// The reserved budget must cover setup and report/upload work across each workflow.
const minimumJobHeadroomMinutes = 10;
// Playwright PR https://github.com/microsoft/playwright/pull/43605 disables TcpPortRandomizationWin starting in v1.65.0.
const minimumWindowsSocketFixVersion = '1.65.0';
const focusedRunnerExpression =
  "${{ github.event.client_payload.platform == 'linux' && 'ubuntu-latest' || github.event.client_payload.platform == 'windows' && 'windows-latest' || github.event.client_payload.platform == 'macos' && 'macos-latest' || 'ubuntu-latest' }}";

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function readCiE2EMatrix() {
  const e2eJobStart = ciWorkflow.indexOf('\n  e2e:\n');
  const e2eJobEnd = ciWorkflow.indexOf('\n  e2e-skip-baseline:\n', e2eJobStart);
  if (e2eJobStart < 0 || e2eJobEnd < 0) {
    throw new Error('Could not find the e2e matrix job in .github/workflows/ci.yml');
  }

  const e2eJob = ciWorkflow.slice(e2eJobStart, e2eJobEnd);
  if (!e2eJob.includes('timeout-minutes: ${{ matrix.timeout }}')) {
    throw new Error('The e2e job must apply each matrix row timeout with timeout-minutes: ${{ matrix.timeout }}');
  }

  const matrixMatch = e2eJob.match(/^        include:\r?\n([\s\S]*?)(?=^    needs:)/m);
  if (!matrixMatch) throw new Error('Could not find the e2e matrix include rows in .github/workflows/ci.yml');

  return matrixMatch[1]
    .split(/(?=^[ \t]*-[ \t]+platform:)/m)
    .filter((row) => /^[ \t]*-[ \t]+platform:/m.test(row))
    .map((row) => {
      const fields = Object.fromEntries(
        [...row.matchAll(/^[ \t]*(?:-[ \t]+)?([a-z-]+):[ \t]*([^\r\n]*?)[ \t]*$/gm)].map((match) => [
          match[1],
          match[2],
        ])
      );
      return {
        platform: fields.platform,
        os: fields.os,
        shard: Number(fields.shard),
        shards: Number(fields.shards),
        jobTimeoutMinutes: Number(fields.timeout),
      };
    });
}

function readPlaywrightCiTimeouts() {
  const timeoutMatch = playwrightConfig.match(
    /^[ \t]*globalTimeout:[ \t]*process\.env\.CI[ \t]*\?[ \t]*\(process\.platform[ \t]*===[ \t]*['"]darwin['"][ \t]*\?[ \t]*(\d+)[ \t]*:[ \t]*(\d+)\)[ \t]*\*[ \t]*60_000/m
  );
  if (!timeoutMatch) {
    throw new Error('Could not find the explicit CI globalTimeout expression in playwright.config.ts');
  }

  return {
    macos: Number(timeoutMatch[1]),
    other: Number(timeoutMatch[2]),
  };
}

function readWorkflowScalar(jobBlock, fieldName) {
  const fieldMatch = jobBlock.match(new RegExp(`^ {4}${fieldName}:[ \\t]*([^\\r\\n]+)$`, 'm'));
  if (!fieldMatch) throw new Error(`Could not find the active ${fieldName} field in the workflow job`);
  return fieldMatch[1];
}

function readJobBlock(workflow, jobName) {
  const jobStart = workflow.indexOf(`\n  ${jobName}:\n`);
  if (jobStart < 0) throw new Error(`Could not find the ${jobName} job`);

  const nextJobStart = workflow.slice(jobStart + 1).search(/\n  [a-z][a-z0-9-]*:\n/);
  const jobEnd = nextJobStart < 0 ? workflow.length : jobStart + 1 + nextJobStart;
  return workflow.slice(jobStart + 1, jobEnd);
}

function readFixedJobTimeoutMinutes(jobBlock, jobName) {
  const timeoutMatch = jobBlock.match(/^[ \t]+timeout-minutes:[ \t]+(\d+)[ \t]*$/m);
  if (!timeoutMatch) throw new Error(`Could not find a fixed timeout-minutes value for the ${jobName} job`);
  return Number(timeoutMatch[1]);
}

function readPlaywrightRunCommands(jobBlock) {
  return [...jobBlock.matchAll(/^[ \t]+run:[ \t]+([^\r\n]*)$/gm)]
    .map((match) => match[1])
    .filter((command) => /(?:npx playwright test|scripts\/e2e-run\.mjs|test:e2e)/.test(command));
}

describe('E2E timeout contract', () => {
  it('keeps the Windows Chromium socket exhaustion fix in the locked Playwright version', () => {
    const declaredRange = String(packageManifest.devDependencies['@playwright/test'] ?? '');
    const declaredMinimum = declaredRange.match(/^[~^]?([0-9]+\.[0-9]+\.[0-9]+)$/)?.[1] ?? '0.0.0';
    const lockedCoreVersion = String(packageLock.packages['node_modules/playwright-core']?.version ?? '0.0.0');

    expect(declaredMinimum).not.toBe('0.0.0');
    expect(compareVersions(declaredMinimum, minimumWindowsSocketFixVersion)).toBeGreaterThanOrEqual(0);
    expect(lockedCoreVersion).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
    expect(compareVersions(lockedCoreVersion, minimumWindowsSocketFixVersion)).toBeGreaterThanOrEqual(0);
  });

  it('keeps ten minutes of nominal job headroom for every CI shard', () => {
    const job = readJobBlock(ciWorkflow, 'e2e');
    const matrix = readCiE2EMatrix();
    const playwrightTimeouts = readPlaywrightCiTimeouts();

    expect(matrix.map(({ platform, shard }) => `${platform}/shard-${shard}`).sort()).toEqual([
      'linux/shard-1',
      'linux/shard-2',
      'macos/shard-1',
      'macos/shard-2',
      'windows/shard-1',
      'windows/shard-2',
    ]);
    expect(readPlaywrightRunCommands(job)).toEqual([
      'npx playwright test --shard=${{ matrix.shard }}/${{ matrix.shards }}',
    ]);

    for (const entry of matrix) {
      expect(entry.os).toBe(
        {
          linux: 'ubuntu-latest',
          windows: 'windows-latest',
          macos: 'macos-latest',
        }[entry.platform]
      );
      expect(entry.shards).toBe(2);

      const playwrightTimeoutMinutes = entry.platform === 'macos' ? playwrightTimeouts.macos : playwrightTimeouts.other;
      expect(entry.jobTimeoutMinutes - playwrightTimeoutMinutes).toBeGreaterThanOrEqual(minimumJobHeadroomMinutes);
    }
  });

  it('keeps ten minutes of nominal job headroom for each supported focused-E2E platform', () => {
    const job = readJobBlock(focusedE2EWorkflow, 'focused-e2e');
    const jobTimeoutMinutes = readFixedJobTimeoutMinutes(job, 'focused-e2e');
    const playwrightTimeouts = readPlaywrightCiTimeouts();
    expect(readPlaywrightRunCommands(job)).toEqual(['npx playwright test --workers=1 "$E2E_SPEC"']);
    expect(readWorkflowScalar(job, 'runs-on').trim()).toBe(focusedRunnerExpression);
    for (const platform of ['linux', 'windows', 'macos']) {
      const playwrightTimeoutMinutes = platform === 'macos' ? playwrightTimeouts.macos : playwrightTimeouts.other;
      expect(jobTimeoutMinutes - playwrightTimeoutMinutes).toBeGreaterThanOrEqual(minimumJobHeadroomMinutes);
    }
  });

  it('keeps ten minutes of nominal job headroom after both Linux baseline-capture runs', () => {
    const job = readJobBlock(baselineCaptureWorkflow, 'capture');
    const jobTimeoutMinutes = readFixedJobTimeoutMinutes(job, 'baseline capture');
    const playwrightTimeouts = readPlaywrightCiTimeouts();
    const playwrightRuns = readPlaywrightRunCommands(job);

    expect(job).toContain('runs-on: ubuntu-latest');
    expect(playwrightRuns).toEqual([
      'npm run test:e2e:update-baselines -- --workers=1',
      'npm run test:e2e -- e2e/export/visual-regression.spec.ts --workers=1',
    ]);
    expect(jobTimeoutMinutes - playwrightRuns.length * playwrightTimeouts.other).toBeGreaterThanOrEqual(
      minimumJobHeadroomMinutes
    );
  });

  it('leaves the configured timeout in control of the npm scripts used by baseline capture', () => {
    for (const name of ['test:e2e:update-baselines', 'test:e2e']) {
      const command = String(packageManifest.scripts[name] ?? '');
      expect(command).toMatch(/^node scripts\/e2e-run\.mjs(?:\s|$)/);
      expect(command).not.toMatch(/(?:^|\s)--global-timeout(?:=|\s|$)/);
    }
  });
});
