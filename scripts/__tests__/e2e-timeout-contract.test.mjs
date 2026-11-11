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
// This is nominal job headroom: GitHub's clock includes setup while Playwright's starts at test launch.
// The reserved budget must cover setup and report/upload work across each workflow.
const minimumJobHeadroomMinutes = 10;

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
    /globalTimeout:\s*process\.env\.CI\s*\?\s*\(process\.platform\s*===\s*['"]darwin['"]\s*\?\s*(\d+)\s*:\s*(\d+)\)\s*\*\s*60_000/
  );
  if (!timeoutMatch) {
    throw new Error('Could not find the explicit CI globalTimeout expression in playwright.config.ts');
  }

  return {
    macos: Number(timeoutMatch[1]),
    other: Number(timeoutMatch[2]),
  };
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

function countPlaywrightRuns(jobBlock) {
  return jobBlock.match(/^[ \t]+run:[ \t].*(?:npx playwright test|scripts\/e2e-run\.mjs|test:e2e)/gm)?.length ?? 0;
}

describe('E2E timeout contract', () => {
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
    expect(countPlaywrightRuns(job)).toBe(1);

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
    expect(countPlaywrightRuns(job)).toBe(1);
    const runners = {
      linux: 'ubuntu-latest',
      windows: 'windows-latest',
      macos: 'macos-latest',
    };

    for (const [platform, runner] of Object.entries(runners)) {
      expect(job).toContain(`client_payload.platform == '${platform}' && '${runner}'`);
      const playwrightTimeoutMinutes = platform === 'macos' ? playwrightTimeouts.macos : playwrightTimeouts.other;
      expect(jobTimeoutMinutes - playwrightTimeoutMinutes).toBeGreaterThanOrEqual(minimumJobHeadroomMinutes);
    }
  });

  it('keeps ten minutes of nominal job headroom after both Linux baseline-capture runs', () => {
    const job = readJobBlock(baselineCaptureWorkflow, 'capture');
    const jobTimeoutMinutes = readFixedJobTimeoutMinutes(job, 'baseline capture');
    const playwrightTimeouts = readPlaywrightCiTimeouts();
    const playwrightRunCount = countPlaywrightRuns(job);

    expect(job).toContain('runs-on: ubuntu-latest');
    expect(playwrightRunCount).toBe(2);
    expect(jobTimeoutMinutes - playwrightRunCount * playwrightTimeouts.other).toBeGreaterThanOrEqual(
      minimumJobHeadroomMinutes
    );
  });
});
