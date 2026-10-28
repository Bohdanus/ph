import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  assertE2ESkipBaseline,
  assertE2ESkipBaselineAcrossShards,
  collectSkippedTests,
} from '../e2e-skip-baseline.mjs';

const photopea = {
  specId: 'photopea-test-id',
  projectId: 'google-chrome-project-id',
  file: 'export/photopea.spec.ts',
  titlePath: ['exports to PSD and verifies in Photopea'],
  projectName: 'Google Chrome',
};

const viewportDrawing = {
  specId: 'viewport-resize-test-id',
  projectId: 'google-chrome-project-id',
  file: 'viewport-drawing.spec.ts',
  titlePath: ['Viewport Drawing', 'line stays under cursor after window resize (normal, wide and narrow)'],
  projectName: 'Google Chrome',
};

function reportWith({ skipped = [photopea, viewportDrawing], statsSkipped = skipped.length } = {}) {
  const spec = (identity, status) => ({
    id: identity.specId,
    title: identity.titlePath.at(-1),
    file: identity.file,
    tests: [
      {
        projectId: identity.projectId,
        projectName: identity.projectName,
        status,
        results:
          status === 'flaky'
            ? [
                { retry: 0, status: 'failed' },
                { retry: 1, status: 'passed' },
              ]
            : [],
      },
    ],
  });
  const hasSkip = (identity) => skipped.some((entry) => JSON.stringify(entry) === JSON.stringify(identity));

  return {
    stats: { skipped: statsSkipped },
    suites: [
      {
        title: 'photopea.spec.ts',
        file: photopea.file,
        specs: hasSkip(photopea) ? [spec(photopea, 'skipped')] : [],
        suites: [],
      },
      {
        title: 'viewport-drawing.spec.ts',
        file: viewportDrawing.file,
        specs: [],
        suites: [
          {
            title: 'Viewport Drawing',
            file: viewportDrawing.file,
            specs: hasSkip(viewportDrawing) ? [spec(viewportDrawing, 'skipped')] : [],
            suites: [],
          },
        ],
      },
      {
        title: 'flaky.spec.ts',
        file: 'flaky.spec.ts',
        specs: [
          spec(
            {
              specId: 'flaky-test-id',
              projectId: 'google-chrome-project-id',
              file: 'flaky.spec.ts',
              titlePath: ['retries do not count as skips'],
              projectName: 'Google Chrome',
            },
            'flaky'
          ),
        ],
        suites: [],
      },
    ],
  };
}

const baseline = (skippedTests = [photopea, viewportDrawing]) => ({ schemaVersion: 1, skippedTests });
const execFileAsync = promisify(execFile);
const scriptPath = join(process.cwd(), 'scripts', 'e2e-skip-baseline.mjs');

function reportsAcrossShards() {
  return ['linux', 'windows', 'macos'].flatMap((platform) => [
    { platform, shard: 1, report: reportWith({ skipped: [photopea] }) },
    { platform, shard: 2, report: reportWith({ skipped: [viewportDrawing] }) },
  ]);
}

function appendSkippedSpec(report, identity) {
  report.stats.skipped += 1;
  report.suites.push({
    title: identity.file.split('/').at(-1),
    file: identity.file,
    specs: [
      {
        title: identity.titlePath.at(-1),
        file: identity.file,
        id: identity.specId,
        tests: [
          {
            projectId: identity.projectId,
            projectName: identity.projectName,
            status: 'skipped',
            results: [],
          },
        ],
      },
    ],
    suites: [],
  });
}

describe('E2E skipped-test baseline', () => {
  it('collects nested skipped cases by file, full title path and project, and ignores flaky retries', () => {
    const report = reportWith();

    expect(collectSkippedTests(report)).toEqual([photopea, viewportDrawing]);
    expect(assertE2ESkipBaseline(report, baseline())).toEqual([photopea, viewportDrawing]);
  });

  it('keeps the same skipped spec separate across projects', () => {
    const report = reportWith();
    const otherProject = { ...photopea, projectId: 'Google Firefox', projectName: 'Google Firefox' };
    report.suites[0].specs[0].tests.push({
      projectId: otherProject.projectId,
      projectName: otherProject.projectName,
      status: 'skipped',
      results: [],
    });
    report.stats.skipped = 3;

    expect(assertE2ESkipBaseline(report, baseline([photopea, otherProject, viewportDrawing]))).toHaveLength(3);
  });

  it('rejects a newly skipped test and names the unexpected identity', () => {
    const newSkip = {
      specId: 'sidebar-right-click-test-id',
      projectId: 'google-chrome-project-id',
      file: 'sidebar-flyout.spec.ts',
      titlePath: ['right-click does not open flyout for single-tool groups'],
      projectName: 'Google Chrome',
    };
    const report = reportWith({ skipped: [photopea, viewportDrawing, newSkip], statsSkipped: 3 });
    report.suites.push({
      title: 'sidebar-flyout.spec.ts',
      file: newSkip.file,
      specs: [
        {
          title: newSkip.titlePath[0],
          file: newSkip.file,
          id: newSkip.specId,
          tests: [
            {
              projectId: newSkip.projectId,
              projectName: newSkip.projectName,
              status: 'skipped',
              results: [],
            },
          ],
        },
      ],
      suites: [],
    });

    expect(() => assertE2ESkipBaseline(report, baseline())).toThrow(/unexpected skip: sidebar-flyout\.spec\.ts/);
  });

  it('requires removing a skip from the baseline when that test starts running', () => {
    const report = reportWith({ skipped: [photopea] });

    expect(() => assertE2ESkipBaseline(report, baseline())).toThrow(/baseline entry no longer skipped/);
  });

  it('fails closed when the reporter skip total disagrees with nested results', () => {
    const report = reportWith({ statsSkipped: 1 });

    expect(() => collectSkippedTests(report)).toThrow(/stats\.skipped is 1, but the suite traversal found 2/);
  });

  it('rejects malformed test outcome statuses instead of silently omitting them', () => {
    const report = reportWith();
    report.suites[0].specs[0].tests[0].status = undefined;

    expect(() => collectSkippedTests(report)).toThrow(/unknown status/);
  });

  it('rejects duplicate identities in the baseline', () => {
    const report = reportWith();

    expect(() => assertE2ESkipBaseline(report, baseline([photopea, photopea]))).toThrow(/duplicate identity/);
  });

  it('matches the complete baseline after recombining all platform and shard reports', () => {
    expect(assertE2ESkipBaselineAcrossShards(reportsAcrossShards(), baseline())).toEqual([photopea, viewportDrawing]);
  });

  it('does not bind a reviewed skip to one shard when test distribution changes', () => {
    const reports = reportsAcrossShards();
    reports[0].report = reportWith({ skipped: [viewportDrawing] });
    reports[1].report = reportWith({ skipped: [photopea] });

    expect(assertE2ESkipBaselineAcrossShards(reports, baseline())).toEqual([photopea, viewportDrawing]);
  });

  it('requires every platform and shard report', () => {
    expect(() => assertE2ESkipBaselineAcrossShards(reportsAcrossShards().slice(1), baseline())).toThrow(
      /Missing E2E shard report\(s\): linux shard 1/
    );
  });

  it('rejects a duplicate platform and shard report', () => {
    const reports = reportsAcrossShards();
    reports.push(reports[0]);

    expect(() => assertE2ESkipBaselineAcrossShards(reports, baseline())).toThrow(/Duplicate E2E report/);
  });

  it('rejects a new skip on any platform', () => {
    const reports = reportsAcrossShards();
    const newSkip = {
      specId: 'sidebar-right-click-test-id',
      projectId: 'google-chrome-project-id',
      file: 'sidebar-flyout.spec.ts',
      titlePath: ['right-click does not open flyout for single-tool groups'],
      projectName: 'Google Chrome',
    };
    appendSkippedSpec(reports[0].report, newSkip);

    expect(() => assertE2ESkipBaselineAcrossShards(reports, baseline())).toThrow(
      /Unexpected skip in linux shard 1: sidebar-flyout\.spec\.ts/
    );
  });

  it('requires each baseline identity to remain skipped once per platform', () => {
    const reports = reportsAcrossShards();
    reports[3].report = reportWith({ skipped: [] });

    expect(() => assertE2ESkipBaselineAcrossShards(reports, baseline())).toThrow(
      /baseline entry no longer skipped on windows:.*viewport-drawing\.spec\.ts/
    );
  });

  it('rejects the same skipped test appearing in both shards of one platform', () => {
    const reports = reportsAcrossShards();
    reports[1].report = reportWith({ skipped: [photopea, viewportDrawing] });

    expect(() => assertE2ESkipBaselineAcrossShards(reports, baseline())).toThrow(
      /skipped in more than one linux shard:.*photopea\.spec\.ts/
    );
  });

  it('reads reports from the GitHub artifact layout and checks the complete matrix', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'e2e-skip-baseline-'));
    const artifactsDirectory = join(tempDirectory, 'artifacts');
    const baselinePath = join(tempDirectory, 'skip-baseline.json');

    try {
      await mkdir(artifactsDirectory);
      await writeFile(baselinePath, JSON.stringify(baseline()));
      for (const platform of ['linux', 'windows', 'macos']) {
        for (const [shard, skipped] of [
          [1, [photopea]],
          [2, [viewportDrawing]],
        ]) {
          const artifactDirectory = join(
            artifactsDirectory,
            `playwright-report-${platform}-shard-${shard}-123456789-attempt-1`
          );
          const reportDirectory = join(artifactDirectory, 'test-results');
          await mkdir(reportDirectory, { recursive: true });
          await writeFile(join(reportDirectory, 'results.json'), JSON.stringify(reportWith({ skipped })));
        }
      }

      const result = await execFileAsync(process.execPath, [
        scriptPath,
        '--artifacts-dir',
        artifactsDirectory,
        baselinePath,
      ]);

      expect(result.stdout).toContain('E2E skip baseline matches (2 skipped identities across 6 reports).');
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });

  it('rejects artifact folders outside the current platform and shard matrix', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'e2e-skip-baseline-'));
    const artifactsDirectory = join(tempDirectory, 'artifacts');
    const baselinePath = join(tempDirectory, 'skip-baseline.json');

    try {
      await mkdir(artifactsDirectory);
      await writeFile(baselinePath, JSON.stringify(baseline()));
      await mkdir(join(artifactsDirectory, 'playwright-report-linux-shard-3-123456789-attempt-1'));

      await expect(
        execFileAsync(process.execPath, [scriptPath, '--artifacts-dir', artifactsDirectory, baselinePath])
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          'Unexpected E2E report artifact name: playwright-report-linux-shard-3-123456789-attempt-1'
        ),
      });
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });
});
