#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { join, posix as posixPath } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASELINE_VERSION = 1;
const TEST_OUTCOMES = new Set(['expected', 'unexpected', 'flaky', 'skipped']);
// Keep these in sync with the e2e job's 3-platform by 2-shard matrix. The
// aggregator fails closed if a platform or shard disappears from that matrix.
const E2E_PLATFORMS = ['linux', 'windows', 'macos'];
const E2E_SHARDS = [1, 2];
const SHARD_ARTIFACT_NAME = /^playwright-report-(linux|windows|macos)-shard-([12])-\d+-attempt-\d+$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function normalizeTestFile(value, label) {
  requireNonEmptyString(value, label);
  const normalized = posixPath.normalize(value.replaceAll('\\', '/')).replace(/^\.\//, '');
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    throw new Error(`${label} must be relative to Playwright's configured rootDir: ${JSON.stringify(value)}`);
  }
  return normalized;
}

// A report groups each test declaration by spec ID and project; the readable
// fields stay in the key too, so a renamed or moved skip requires baseline review.
function identityKey(identity) {
  return JSON.stringify([identity.specId, identity.projectId, identity.file, identity.titlePath, identity.projectName]);
}

function compareIdentity(left, right) {
  const leftKey = identityKey(left);
  const rightKey = identityKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function validateIdentity(value, label) {
  requireRecord(value, label);
  const specId = requireNonEmptyString(value.specId, `${label}.specId`);
  if (typeof value.projectId !== 'string') throw new Error(`${label}.projectId must be a string`);
  const projectId = value.projectId;
  const file = normalizeTestFile(value.file, `${label}.file`);
  if (!Array.isArray(value.titlePath) || value.titlePath.length === 0) {
    throw new Error(`${label}.titlePath must be a non-empty array`);
  }
  const titlePath = value.titlePath.map((title, index) => requireNonEmptyString(title, `${label}.titlePath[${index}]`));
  if (typeof value.projectName !== 'string') throw new Error(`${label}.projectName must be a string`);
  return { specId, projectId, file, titlePath, projectName: value.projectName };
}

function validateBaseline(baseline) {
  requireRecord(baseline, 'Skip baseline');
  if (baseline.schemaVersion !== BASELINE_VERSION) {
    throw new Error(`Skip baseline schemaVersion must be ${BASELINE_VERSION}`);
  }
  if (!Array.isArray(baseline.skippedTests)) throw new Error('Skip baseline skippedTests must be an array');

  const identities = baseline.skippedTests.map((entry, index) =>
    validateIdentity(entry, `Skip baseline skippedTests[${index}]`)
  );
  const seen = new Set();
  for (const identity of identities) {
    const key = identityKey(identity);
    if (seen.has(key)) throw new Error(`Skip baseline contains a duplicate identity: ${formatIdentity(identity)}`);
    seen.add(key);
  }
  return identities.sort(compareIdentity);
}

function formatIdentity(identity) {
  const path = identity.titlePath.join(' › ');
  const project = identity.projectName ? `project ${JSON.stringify(identity.projectName)}` : 'default project';
  return `${identity.file} :: ${path} (${project}, id ${JSON.stringify(identity.projectId)}; ${identity.specId})`;
}

/**
 * Collect final skipped outcomes from Playwright's v2 JSON report.
 * The report's `stats.skipped` is a second, runner-produced count that catches
 * missed nested suites or an unexpected reporter schema before comparison.
 */
export function collectSkippedTests(report) {
  requireRecord(report, 'Playwright JSON report');
  requireRecord(report.stats, 'Playwright JSON report stats');
  if (!Number.isSafeInteger(report.stats.skipped) || report.stats.skipped < 0) {
    throw new Error('Playwright JSON report stats.skipped must be a non-negative integer');
  }
  if (!Array.isArray(report.suites)) throw new Error('Playwright JSON report suites must be an array');

  const skippedTests = [];
  const seen = new Set();

  function visitSuite(suiteValue, parents, isFileSuite) {
    const suite = requireRecord(suiteValue, 'Playwright JSON report suite');
    requireNonEmptyString(suite.title, 'Playwright JSON report suite.title');
    normalizeTestFile(suite.file, 'Playwright JSON report suite.file');
    if (!Array.isArray(suite.specs)) throw new Error('Playwright JSON report suite.specs must be an array');
    if (suite.suites !== undefined && !Array.isArray(suite.suites)) {
      throw new Error('Playwright JSON report suite.suites must be an array when present');
    }

    // The top-level suite in each report file is the file suite; keep its file in
    // the identity separately and use only describe/test titles in titlePath.
    const titlePath = isFileSuite ? parents : [...parents, suite.title];

    for (const [specIndex, specValue] of suite.specs.entries()) {
      const spec = requireRecord(specValue, `Playwright JSON report spec ${specIndex}`);
      requireNonEmptyString(spec.title, `Playwright JSON report spec ${specIndex}.title`);
      const specId = requireNonEmptyString(spec.id, `Playwright JSON report spec ${specIndex}.id`);
      const file = normalizeTestFile(spec.file, `Playwright JSON report spec ${specIndex}.file`);
      if (!Array.isArray(spec.tests) || spec.tests.length === 0) {
        throw new Error(`Playwright JSON report spec ${JSON.stringify(spec.title)} must contain tests`);
      }

      for (const testValue of spec.tests) {
        const test = requireRecord(testValue, `Playwright JSON report test in ${file}`);
        if (!TEST_OUTCOMES.has(test.status)) {
          throw new Error(`Playwright JSON report test in ${file} has unknown status ${JSON.stringify(test.status)}`);
        }
        if (typeof test.projectName !== 'string') {
          throw new Error(`Playwright JSON report test in ${file} has no string projectName`);
        }
        if (typeof test.projectId !== 'string') {
          throw new Error(`Playwright JSON report test in ${file} has no string projectId`);
        }
        const projectId = test.projectId;
        if (test.status !== 'skipped') continue;

        const identity = {
          specId,
          projectId,
          file,
          titlePath: [...titlePath, spec.title],
          projectName: test.projectName,
        };
        const key = identityKey(identity);
        if (seen.has(key)) {
          throw new Error(`Playwright JSON report contains duplicate skipped identity: ${formatIdentity(identity)}`);
        }
        seen.add(key);
        skippedTests.push(identity);
      }
    }

    for (const child of suite.suites ?? []) visitSuite(child, titlePath, false);
  }

  for (const suite of report.suites) visitSuite(suite, [], true);

  if (skippedTests.length !== report.stats.skipped) {
    throw new Error(
      `Playwright JSON report stats.skipped is ${report.stats.skipped}, but the suite traversal found ${skippedTests.length} skipped tests`
    );
  }
  return skippedTests.sort(compareIdentity);
}

/**
 * Require the actual skipped test set to match the reviewed baseline exactly.
 * A removed skip also requires an explicit baseline edit so the waiver cannot
 * silently become stale.
 */
export function assertE2ESkipBaseline(report, baseline) {
  const actual = collectSkippedTests(report);
  const expected = validateBaseline(baseline);
  const actualByKey = new Map(actual.map((identity) => [identityKey(identity), identity]));
  const expectedByKey = new Map(expected.map((identity) => [identityKey(identity), identity]));
  const added = actual.filter((identity) => !expectedByKey.has(identityKey(identity)));
  const removed = expected.filter((identity) => !actualByKey.has(identityKey(identity)));

  if (added.length || removed.length) {
    const details = [
      ...added.map((identity) => `  unexpected skip: ${formatIdentity(identity)}`),
      ...removed.map((identity) => `  baseline entry no longer skipped: ${formatIdentity(identity)}`),
    ];
    throw new Error(`Skipped-test set differs from e2e/skip-baseline.json:\n${details.join('\n')}`);
  }

  return actual;
}

/**
 * Compare the union of the two shard reports separately for each platform.
 * A shard sees only part of the suite, so comparing any one report to the full
 * baseline would reject the other shard's expected skips. Each expected
 * identity must appear exactly once per platform across the two reports.
 */
export function assertE2ESkipBaselineAcrossShards(shardReports, baseline) {
  if (!Array.isArray(shardReports)) throw new Error('Shard reports must be an array');
  const expected = validateBaseline(baseline);
  const expectedByKey = new Map(expected.map((identity) => [identityKey(identity), identity]));
  const reportsByPlatform = new Map(E2E_PLATFORMS.map((platform) => [platform, new Map()]));

  for (const [index, entryValue] of shardReports.entries()) {
    const entry = requireRecord(entryValue, `Shard report ${index}`);
    if (!E2E_PLATFORMS.includes(entry.platform)) {
      throw new Error(`Shard report ${index}.platform is not in the e2e matrix: ${JSON.stringify(entry.platform)}`);
    }
    if (!E2E_SHARDS.includes(entry.shard)) {
      throw new Error(`Shard report ${index}.shard is not in the e2e matrix: ${JSON.stringify(entry.shard)}`);
    }

    const reportsForPlatform = reportsByPlatform.get(entry.platform);
    if (reportsForPlatform.has(entry.shard)) {
      throw new Error(`Duplicate E2E report for ${entry.platform} shard ${entry.shard}`);
    }

    const skipped = collectSkippedTests(entry.report);
    for (const identity of skipped) {
      if (!expectedByKey.has(identityKey(identity))) {
        throw new Error(`Unexpected skip in ${entry.platform} shard ${entry.shard}: ${formatIdentity(identity)}`);
      }
    }
    reportsForPlatform.set(entry.shard, skipped);
  }

  const missingReports = [];
  for (const platform of E2E_PLATFORMS) {
    const reportsForPlatform = reportsByPlatform.get(platform);
    for (const shard of E2E_SHARDS) {
      if (!reportsForPlatform.has(shard)) missingReports.push(`${platform} shard ${shard}`);
    }
  }
  if (missingReports.length) {
    throw new Error(`Missing E2E shard report(s): ${missingReports.join(', ')}`);
  }

  const mismatches = [];
  for (const platform of E2E_PLATFORMS) {
    const seenCounts = new Map();
    for (const shard of E2E_SHARDS) {
      for (const identity of reportsByPlatform.get(platform).get(shard)) {
        const key = identityKey(identity);
        seenCounts.set(key, (seenCounts.get(key) ?? 0) + 1);
      }
    }

    for (const identity of expected) {
      const count = seenCounts.get(identityKey(identity)) ?? 0;
      if (count === 0) {
        mismatches.push(`  baseline entry no longer skipped on ${platform}: ${formatIdentity(identity)}`);
      } else if (count > 1) {
        mismatches.push(`  skipped in more than one ${platform} shard: ${formatIdentity(identity)}`);
      }
    }
  }

  if (mismatches.length) {
    throw new Error(`Skipped-test set differs from e2e/skip-baseline.json:\n${mismatches.join('\n')}`);
  }

  return expected;
}

async function readJson(file, label) {
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read ${label} at ${file}: ${error.message}`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Cannot parse ${label} at ${file}: ${error.message}`);
  }
}

async function readShardReports(artifactsDirectory) {
  const entries = await readdir(artifactsDirectory, { withFileTypes: true });
  const reports = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) throw new Error(`Unexpected non-directory in E2E artifacts: ${entry.name}`);
    const match = SHARD_ARTIFACT_NAME.exec(entry.name);
    if (!match) throw new Error(`Unexpected E2E report artifact name: ${entry.name}`);
    const platform = match[1];
    const shard = Number(match[2]);
    const reportPath = join(artifactsDirectory, entry.name, 'test-results', 'results.json');
    const report = await readJson(reportPath, `${platform} shard ${shard} Playwright JSON report`);
    reports.push({ platform, shard, report });
  }

  return reports;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--artifacts-dir') {
    const artifactsDirectory = args[1];
    const baselinePath = args[2] ?? 'e2e/skip-baseline.json';
    if (!artifactsDirectory || args.length > 3) {
      throw new Error('Usage: node scripts/e2e-skip-baseline.mjs --artifacts-dir <directory> [skip-baseline.json]');
    }

    const [shardReports, baseline] = await Promise.all([
      readShardReports(artifactsDirectory),
      readJson(baselinePath, 'E2E skip baseline'),
    ]);
    const skipped = assertE2ESkipBaselineAcrossShards(shardReports, baseline);
    process.stdout.write(
      `E2E skip baseline matches (${skipped.length} skipped identities across ${shardReports.length} reports).\n`
    );
    return;
  }

  const reportPath = args[0] ?? 'test-results/results.json';
  const baselinePath = args[1] ?? 'e2e/skip-baseline.json';
  if (args.length > 2) {
    throw new Error(
      'Usage: node scripts/e2e-skip-baseline.mjs [report.json] [skip-baseline.json] or --artifacts-dir <directory> [skip-baseline.json]'
    );
  }

  const [report, baseline] = await Promise.all([
    readJson(reportPath, 'Playwright JSON report'),
    readJson(baselinePath, 'E2E skip baseline'),
  ]);
  const skipped = assertE2ESkipBaseline(report, baseline);
  process.stdout.write(`E2E skip baseline matches (${skipped.length} skipped tests).\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`E2E skip baseline failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
