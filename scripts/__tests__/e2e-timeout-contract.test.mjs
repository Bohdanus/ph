import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const testDirectory = import.meta.dirname;
const ciWorkflow = readFileSync(join(testDirectory, '../../.github/workflows/ci.yml'), 'utf8');
const playwrightConfig = readFileSync(join(testDirectory, '../../playwright.config.ts'), 'utf8');
// Keep the documented macOS upload reserve for every CI matrix row. The job clock
// also includes checkout, dependency installation and Chrome setup before Playwright starts.
const minimumReportHeadroomMinutes = 10;

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

describe('E2E timeout contract', () => {
  it('reserves at least ten minutes beyond Playwright globalTimeout on every CI shard', () => {
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
      expect(entry.jobTimeoutMinutes - playwrightTimeoutMinutes).toBeGreaterThanOrEqual(minimumReportHeadroomMinutes);
    }
  });
});
