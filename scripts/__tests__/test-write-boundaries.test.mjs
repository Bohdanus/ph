import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveScriptTests, scanTestSource } from '../lib/test-write-boundaries.mjs';

const TEST_DIRECTORY = join(import.meta.dirname, '.');

const REVIEWED = {
  'agent-board.test.mjs': {
    scope: 'Temporary board directories and in-memory/test-owned databases; CLI children use the test board.',
    patterns: `filesystem-write:mkdtempSync=1 filesystem-write:rmSync=9 database-open:DatabaseSync:write-capable=9 filesystem-write:mkdirSync=16 filesystem-write:symlinkSync=1 subprocess:execFileSync=7 filesystem-write:writeFileSync=2 subprocess:spawn=2`,
  },
  'agents-citations.test.mjs': {
    scope: 'Subprocess invocation is part of the citation/tooling contract; review its command and cwd.',
    patterns: `subprocess:execFileSync=1`,
  },
  'chat-search.test.mjs': {
    scope:
      'Search fixtures use per-test temporary directories and test-owned databases, including Codex rollout symlink guards.',
    patterns: `database-open:DatabaseSync:write-capable=8 filesystem-write:mkdtempSync=18 filesystem-write:mkdirSync=5 filesystem-write:rmSync=18 filesystem-write:symlinkSync=2 filesystem-write:writeFileSync=4`,
  },
  'dispose-worktree.test.mjs': {
    scope:
      'Filesystem fixtures are created under unique OS temporary directories and cleaned up; child Git is test-controlled.',
    patterns: `filesystem-write:mkdtempSync=5 filesystem-write:writeFileSync=17 filesystem-write:rmSync=5 filesystem-write:mkdirSync=23 filesystem-write:symlinkSync=2 filesystem-write:renameSync=2 subprocess:execFileSync=1 subprocess:spawnSync=1`,
  },
  'docs-index.test.mjs': {
    scope: 'Subprocess invocation is part of the docs-index contract; review its command and cwd.',
    patterns: `subprocess:execFileSync=1`,
  },
  'e2e-run.test.mjs': {
    scope:
      'Board, run-record, process-tree, and filesystem fixtures are temporary; the live run record and sentinel are read-only tripwires.',
    patterns: `filesystem-write:mkdtempSync=3 filesystem-write:rmSync=3 subprocess:spawnSync=3 filesystem-write:writeFileSync=1 subprocess:spawn=1`,
  },
  'e2e-skip-baseline.test.mjs': {
    scope: 'Baseline and report fixtures use unique OS temporary directories.',
    patterns: `filesystem-write:mkdtemp=2 filesystem-write:mkdir=4 filesystem-write:writeFile=3 filesystem-write:rm=2`,
  },
  'e2e-timeout-contract.test.mjs': {
    scope: 'Read-only workflow and Playwright config checks; no filesystem writes, subprocesses or databases.',
    patterns: '',
  },
  'find-session-id.test.mjs': {
    scope: 'Database and file fixtures live under unique OS temporary directories.',
    patterns: `database-open:DatabaseSync:write-capable=2 filesystem-write:mkdtempSync=18 filesystem-write:rmSync=18`,
  },
  'free-chat-search-agent.test.mjs': {
    scope:
      'Fake SQLite, database, failing CLI, and Kilo home fixtures live in unique temporary directories and are cleaned; child invocations use test-controlled paths.',
    patterns: `filesystem-write:mkdtemp=3 filesystem-write:writeFile=6 subprocess:spawnSync=9 filesystem-write:rm=3 filesystem-write:mkdir=4`,
  },
  'free-chat-search.test.mjs': {
    scope: 'Search database fixtures use unique OS temporary directories and are removed after the test.',
    patterns: `filesystem-write:mkdtemp=6 filesystem-write:writeFile=6 filesystem-write:rm=6`,
  },
  'free-model-kilo.test.mjs': {
    scope: 'Each fake Kilo CLI and configuration fixture uses a unique OS temp directory with finally cleanup.',
    patterns: `filesystem-write:mkdir=1 filesystem-write:writeFile=3 filesystem-write:mkdtemp=20 filesystem-write:rm=20 subprocess:spawnSync=1`,
  },
  'free-model-pool-external.test.mjs': {
    scope:
      'External-provider, typed transient 5xx, Kilo cost-stop and source-cooldown, OpenRouter quota metadata, and keyless catalog fixtures use unique OS temporary directories with finally cleanup.',
    patterns: `filesystem-write:mkdtemp=9 filesystem-write:rm=9 filesystem-write:writeFile=1`,
  },
  'free-model-pool.test.mjs': {
    scope:
      'Model/provider and cost-safety fixtures use unique OS temporary directories, including empty quarantine fixtures for catalog fallback and oversized-body checks; PATH overrides are restored in finally blocks, and timeout cleanup targets only fixture-owned process IDs.',
    patterns: `filesystem-write:mkdtemp=31 filesystem-write:rm=31 filesystem-write:writeFile=15 process-env-write:assignment:PATH=2 process-env-write:delete:PATH=1 subprocess:spawnSync=1`,
  },
  'free-model-pool-state.test.mjs': {
    scope:
      'Persistent pool-state regression fixtures use unique OS temporary directories and are removed after each test.',
    patterns: `filesystem-write:mkdtemp=1 filesystem-write:rm=1`,
  },
  'free-model-quarantine.test.mjs': {
    scope: 'Quarantine fixtures use unique OS temporary directories.',
    patterns: `filesystem-write:mkdtemp=11 filesystem-write:rm=11`,
  },
  'free-model-sweep.test.mjs': {
    scope: 'Sweep and quarantine fixtures use unique OS temporary directories.',
    patterns: `filesystem-write:mkdtemp=3 filesystem-write:writeFile=2 filesystem-write:rm=3`,
  },
  'free-research.test.mjs': {
    scope: 'Research output fixtures use unique OS temporary directories.',
    patterns: `filesystem-write:mkdtemp=4 filesystem-write:writeFile=10 filesystem-write:rm=4`,
  },
  'free-web-research.test.mjs': {
    scope: 'Research output fixtures use a unique OS temporary directory.',
    patterns: `filesystem-write:mkdtemp=1 filesystem-write:rm=1`,
  },
  'handoff-import-wiring.test.mjs': {
    scope: 'Import-wiring fixtures use unique OS temporary directories.',
    patterns: `filesystem-write:mkdtempSync=1 filesystem-write:rmSync=1 filesystem-write:writeFileSync=16 filesystem-write:mkdirSync=2`,
  },
  'main-worktree-guard.test.mjs': {
    scope:
      'Git and hook fixtures use temporary repositories, including forced duplicate-main recovery and a watcher retry after one pre-creation failure; review child cwd and any environment passed to subprocesses.',
    patterns: `subprocess:execFileSync=1 subprocess:spawnSync=45 filesystem-write:mkdtempSync=10 filesystem-write:writeFileSync=35 filesystem-write:rmSync=13 filesystem-write:mkdirSync=5`,
  },
  'main-landing-alert.test.mjs': {
    scope:
      'Alert-claim marker fixtures use a unique temporary directory and are removed after the test. Expanded coverage includes malformed recovery, invalid JSON shapes, sent markers, and lock contention.',
    patterns: `filesystem-write:mkdtempSync=5 filesystem-write:writeFileSync=7 filesystem-write:rmSync=2`,
  },
  'merge-release.test.mjs': {
    scope: 'Git and filesystem fixtures use a unique temporary repository.',
    patterns: `subprocess:execFileSync=3 filesystem-write:mkdtempSync=1 filesystem-write:mkdirSync=1 filesystem-write:writeFileSync=3 filesystem-write:rmSync=1`,
  },
  'merge-takeover-guard-install.test.mjs': {
    scope: 'Subprocess invocation is part of the installer contract; review its command and cwd.',
    patterns: `subprocess:execFileSync=1`,
  },
  'merge-takeover-guard.test.mjs': {
    scope:
      'Temporary repositories model the owner-tracked landing wrapper; project markers, installer stubs, hook scripts, and process environment changes remain isolated to each temporary repository.',
    patterns: `subprocess:execFileSync=17 filesystem-write:writeFileSync=54 filesystem-write:mkdirSync=20 filesystem-write:copyFileSync=2 filesystem-write:chmodSync=28 filesystem-write:rmSync=7 process-env-write:assignment:KILO_EXPECTED_MAIN_SHA=3 process-env-write:assignment:KILO_EXPECTED_INCOMING_SHA=3 process-env-write:assignment:KILO_EXPECTED_TREE_SHA=3 process-env-write:assignment:KILO_EXPECTED_BRANCH=3 process-env-write:assignment:KILO_EXPECTED_CHAT_ID=3 process-env-write:delete:KILO_EXPECTED_MAIN_SHA=3 process-env-write:delete:KILO_EXPECTED_INCOMING_SHA=3 process-env-write:delete:KILO_EXPECTED_TREE_SHA=3 process-env-write:delete:KILO_EXPECTED_BRANCH=3 process-env-write:delete:KILO_EXPECTED_CHAT_ID=3 subprocess:spawnSync=3 filesystem-write:mkdtempSync=2 process-env-write:assignment:GIT_REFLOG_ACTION=12 process-env-write:assignment:PATH=16 process-env-write:assignment:REAL_GIT_PATH=16 process-env-write:delete:PATH=8 process-env-write:delete:REAL_GIT_PATH=8 process-env-write:delete:GIT_REFLOG_ACTION=1`,
  },
  'mirror-e2e.test.mjs': {
    scope: 'Mirror and git fixtures use temporary repositories and directories.',
    patterns: `subprocess:spawnSync=3 filesystem-write:mkdtempSync=2 filesystem-write:writeFileSync=7 filesystem-write:mkdirSync=4 filesystem-write:rmSync=11`,
  },
  'orphan-branches.test.mjs': {
    scope: 'Git fixtures use a unique temporary repository.',
    patterns: `filesystem-write:mkdtempSync=1 subprocess:execFileSync=11 filesystem-write:writeFileSync=3 filesystem-write:rmSync=5`,
  },
  'path-identity.test.mjs': {
    scope:
      'Git path identity is read from the current checkout; directory and symlink fixtures are created under unique OS temporary directories and removed after each test.',
    patterns: `filesystem-write:mkdtempSync=1 subprocess:execFileSync=1 filesystem-write:rmSync=1 filesystem-write:mkdirSync=3 filesystem-write:writeFileSync=1 filesystem-write:symlinkSync=3`,
  },
  'quiet-command.test.mjs': {
    scope: 'Subprocess invocation is the command-wrapper behavior under test; review command and cwd.',
    patterns: `subprocess:spawnSync=2 filesystem-write:mkdtempSync=2 filesystem-write:writeFileSync=3 filesystem-write:rmSync=2`,
  },
  'recover-stale-auto-merge.test.mjs': {
    scope:
      'Git and filesystem fixtures use temporary repositories and directories, including a stale target package script, symlinks, hostile merge/index markers, and a Node preload shim that rewrites a fixture marker; child Git commands use the fixture repository.',
    patterns: `subprocess:execFileSync=2 filesystem-write:mkdtempSync=2 filesystem-write:writeFileSync=40 subprocess:spawnSync=4 filesystem-write:rmSync=6 filesystem-write:mkdirSync=4 filesystem-write:symlinkSync=1 filesystem-write:chmodSync=2`,
  },
  'repo-state-gate.test.mjs': {
    scope: 'Git and filesystem fixtures use temporary repositories; review child cwd and environment.',
    patterns: `filesystem-write:mkdtempSync=1 subprocess:execFileSync=2 subprocess:spawnSync=9 filesystem-write:mkdirSync=5 filesystem-write:writeFileSync=19 filesystem-write:rmSync=7 filesystem-write:symlinkSync=1 filesystem-write:chmodSync=4`,
  },
  'session-db-snapshot.test.mjs': {
    scope: 'Snapshot fixtures use temporary databases; copies are explicitly opened read-only.',
    patterns: `database-open:DatabaseSync:write-capable=2 filesystem-write:mkdtempSync=3 filesystem-write:rmSync=3 database-open:DatabaseSync:readOnly=2`,
  },
  'stale-branch-files.test.mjs': {
    scope: 'Git and filesystem fixtures use a unique temporary repository.',
    patterns: `subprocess:execFileSync=1 filesystem-write:writeFileSync=1 filesystem-write:mkdtempSync=1 filesystem-write:rmSync=1 subprocess:spawnSync=1`,
  },
  'tsc-guard.test.mjs': {
    scope:
      'Fixtures are temporary; shared node_modules is read for resolution and writes are gated by physical checkout ownership.',
    patterns: `subprocess:spawnSync=6 filesystem-write:mkdtempSync=5 filesystem-write:writeFileSync=10 filesystem-write:rmSync=9 filesystem-write:mkdirSync=2 filesystem-write:symlinkSync=3`,
  },
  'worktree-inventory.test.mjs': {
    scope:
      'Writable databases and environment overrides are test fixtures; the machine session database is explicitly opened read-only.',
    patterns: `filesystem-write:mkdtempSync=16 subprocess:execFileSync=80 filesystem-write:writeFileSync=25 filesystem-write:rmSync=58 database-open:DatabaseSync:write-capable=9 database-open:DatabaseSync:readOnly=3 filesystem-write:chmodSync=2 process-env-write:delete:<computed>=2 process-env-write:assignment:<computed>=2 filesystem-write:mkdirSync=3`,
  },
  'board-post-cap.test.mjs': {
    scope: 'Read-only document checks; no filesystem mutations, subprocesses, or database access.',
    patterns: '',
  },
  'free-model-validator.test.mjs': {
    scope: 'Unit tests with mocked fetch; no filesystem mutations, subprocesses, or database access.',
    patterns: '',
  },
  'free-subagent-launcher.test.mjs': {
    scope: 'Unit tests with mocked fetch and agentManager; no filesystem mutations, subprocesses, or database access.',
    patterns: '',
  },
  'handoff-import.test.mjs': {
    scope: 'Read-only document checks; no filesystem mutations, subprocesses, or database access.',
    patterns: '',
  },
  'orchestration-command-references.test.mjs': {
    scope: 'Read-only document checks; no filesystem mutations, subprocesses, or database access.',
    patterns: '',
  },
  'secrets.test.mjs': {
    scope:
      'In-memory secret-key/redaction assertions plus one bounded Node child for the adversarial key; no filesystem or database access.',
    patterns: `subprocess:spawnSync=1`,
  },
  'suite-budgets.test.mjs': {
    scope: 'Unit tests with mocked data; no filesystem mutations, subprocesses, or database access.',
    patterns: '',
  },
  'test-write-boundaries.test.mjs': {
    scope: 'Self-test of the boundary scanner; test fixtures are inline strings, no external side effects.',
    patterns: '',
  },
  'tool-descriptions.test.mjs': {
    scope: 'Read-only document checks; no filesystem mutations, subprocesses, or database access.',
    patterns: '',
  },
  'windows-command-shim.test.mjs': {
    scope: 'Windows command lookup fixtures live in unique temporary directories and are removed after each test.',
    patterns: `filesystem-write:mkdirSync=1 filesystem-write:mkdtempSync=11 filesystem-write:writeFileSync=9 filesystem-write:rmSync=11`,
  },
  'windows-process-tree.test.mjs': {
    scope: 'Process commands are mocked; tests do not create files, processes, or databases.',
    patterns: '',
  },
};

const SHARED_READS = [
  {
    file: 'e2e-run.test.mjs',
    resource: 'the worktree .kilo/e2e-last-run.json and virtual E2E sentinel',
    evidence: "const LIVE_RUN_RECORD = join(REPO_ROOT, '.kilo', 'e2e-last-run.json');",
    rule: 'The run record is read only as a tripwire; every run injects a temporary runRecordPath, and sentinel checks use a temporary board.',
  },
  {
    file: 'tsc-guard.test.mjs',
    resource: 'ancestor node_modules/.bin/tsc',
    evidence: 'function requireOwnership()',
    rule: 'Resolution may inspect an ancestor install; mutation tests return unless physical-path ownership is established.',
  },
  {
    file: 'worktree-inventory.test.mjs',
    resource: 'the machine Kilo session database',
    evidence: "new DatabaseSync(resolve(process.env.HOME, '.local/share/kilo/kilo.db'), { readOnly: true })",
    rule: 'The optional machine database is opened read-only and closed in a finally block.',
  },
];

const PROCESS_ENV_WRITES = [
  {
    file: 'free-model-pool.test.mjs',
    keys: ['PATH'],
    evidence: 'const previousPath = process.env.PATH;',
    rule: 'The Windows PATH fixture restores the previous value in a finally block, deleting PATH if it was originally absent.',
  },
  {
    file: 'merge-takeover-guard.test.mjs',
    keys: ['PATH', 'REAL_GIT_PATH'],
    evidence: 'const previousPath = process.env.PATH;',
    rule: 'These process-wide overrides are restored in finally blocks; this is not a filesystem write.',
  },
];

function summarize(findings) {
  const counts = new Map();
  for (const { kind, api } of findings) {
    const key = `${kind}:${api}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => `${key}=${count}`).sort();
}

function findingsWithLines(findings) {
  const grouped = new Map();
  for (const { kind, api, line } of findings) {
    const key = `${kind}:${api}`;
    const lines = grouped.get(key) ?? [];
    lines.push(line);
    grouped.set(key, lines);
  }
  return [...grouped].map(([key, lines]) => `${key} at ${lines.join(', ')}`).join('; ');
}

describe('script-test resource boundary audit', () => {
  it('recognizes supported write, process, SQLite, and environment patterns without counting reads', () => {
    const source = `
      import { writeFileSync as write, readFileSync } from 'node:fs';
      import * as fs from 'node:fs/promises';
      import { promises as fsPromises } from 'node:fs';
      import { execFileSync as execute } from 'node:child_process';
      import { DatabaseSync } from 'node:sqlite';
      const legacyFs = require('node:fs');
      const dynamicFs = await import('node:fs');
      write('fixture', 'data');
      fs.writeFile('fixture', 'data');
      fsPromises.writeFile('fixture', 'data');
      legacyFs.appendFileSync('fixture', 'data');
      dynamicFs.writeFileSync('fixture', 'data');
      readFileSync('shared');
      execute('git', ['status']);
      process['env'] = {};
      process.env.PATH = '/fixture/bin';
      delete process.env['REAL_GIT_PATH'];
      process.env[dynamicKey] = 'value';
      Object.assign(process.env, { CI: 'true' });
      process.env.RETRY_COUNT++;
      --process.env.RETRY_COUNT;
      new DatabaseSync(':memory:');
      new DatabaseSync('/shared/read-only.db', { readOnly: true });
      new DatabaseSync('/shared/overridden.db', { readOnly: true, readOnly: false });
      new DatabaseSync('/shared/spread-after.db', { readOnly: true, ...options });
      new DatabaseSync('/shared/explicit-after-spread.db', { ...options, readOnly: true });
      new DatabaseSync('/shared/computed-after.db', { readOnly: true, [optionName]: false });
    `;

    expect(scanTestSource(source, 'fixture.test.mjs').map(({ kind, api }) => `${kind}:${api}`)).toEqual([
      'filesystem-write:writeFileSync',
      'filesystem-write:writeFile',
      'filesystem-write:writeFile',
      'filesystem-write:appendFileSync',
      'filesystem-write:writeFileSync',
      'subprocess:execFileSync',
      'process-env-write:assignment:<object>',
      'process-env-write:assignment:PATH',
      'process-env-write:delete:REAL_GIT_PATH',
      'process-env-write:assignment:<computed>',
      'process-env-write:Object.assign:<object>',
      'process-env-write:update:RETRY_COUNT',
      'process-env-write:update:RETRY_COUNT',
      'database-open:DatabaseSync:write-capable',
      'database-open:DatabaseSync:readOnly',
      'database-open:DatabaseSync:write-capable',
      'database-open:DatabaseSync:write-capable',
      'database-open:DatabaseSync:readOnly',
      'database-open:DatabaseSync:write-capable',
    ]);
  });

  it('parses TypeScript test files when the derived tree contains them', () => {
    const source = `
      import { writeFileSync } from 'node:fs';
      const fixture: string = '/tmp/fixture';
      writeFileSync(fixture, 'content');
    `;

    expect(scanTestSource(source, 'fixture.test.ts')).toMatchObject([
      { kind: 'filesystem-write', api: 'writeFileSync', line: 4 },
    ]);
  });

  it('detects file descriptor and other filesystem write APIs', () => {
    const source = `
      import { open, openSync, write, writeSync, writev, writevSync, ftruncate, ftruncateSync, fchmod, fchmodSync, fchown, fchownSync, futimes, futimesSync } from 'node:fs';
      import { cp, cpSync, mkdtempDisposableSync } from 'node:fs';
      import { cp as copyTree, mkdtempDisposable, open as openPromises } from 'node:fs/promises';
      const fd = openSync('file', 'w');
      open('file', 'a', (err, fd) => { write(fd, Buffer.from('x')); });
      openPromises('file', 'w+').then(fd => { writev(fd, [Buffer.from('x')]); });
      cpSync('source', 'destination');
      cp('source', 'destination');
      mkdtempDisposableSync('/tmp/fixture-');
      copyTree('source', 'destination');
      mkdtempDisposable('/tmp/fixture-');
      write(fd, Buffer.from('x'));
      writeSync(fd, Buffer.from('x'));
      writev(fd, [Buffer.from('x')]);
      writevSync(fd, [Buffer.from('x')]);
      ftruncate(fd, 10);
      ftruncateSync(fd, 10);
      fchmod(fd, 0o644);
      fchmodSync(fd, 0o644);
      fchown(fd, 1000, 1000);
      fchownSync(fd, 1000, 1000);
      futimes(fd, new Date(), new Date());
      futimesSync(fd, new Date(), new Date());
    `;

    const findings = scanTestSource(source, 'fd-apis.test.mjs').map(({ kind, api }) => `${kind}:${api}`);
    expect(findings).toContain('filesystem-write:openSync');
    expect(findings).toContain('filesystem-write:open');
    expect(findings).toContain('filesystem-write:cp');
    expect(findings).toContain('filesystem-write:cpSync');
    expect(findings).toContain('filesystem-write:mkdtempDisposable');
    expect(findings).toContain('filesystem-write:mkdtempDisposableSync');
    expect(findings).toContain('filesystem-write:write');
    expect(findings).toContain('filesystem-write:writeSync');
    expect(findings).toContain('filesystem-write:writev');
    expect(findings).toContain('filesystem-write:writevSync');
    expect(findings).toContain('filesystem-write:ftruncate');
    expect(findings).toContain('filesystem-write:ftruncateSync');
    expect(findings).toContain('filesystem-write:fchmod');
    expect(findings).toContain('filesystem-write:fchmodSync');
    expect(findings).toContain('filesystem-write:fchown');
    expect(findings).toContain('filesystem-write:fchownSync');
    expect(findings).toContain('filesystem-write:futimes');
    expect(findings).toContain('filesystem-write:futimesSync');
  });

  it('fails closed when a source file cannot be parsed', () => {
    expect(() => scanTestSource('const broken = ;', 'broken.test.mjs')).toThrow('Could not parse broken.test.mjs');
  });

  it('derives every script test and requires exact reviewed pattern classifications', () => {
    const tests = deriveScriptTests(TEST_DIRECTORY);
    const names = new Set(tests.map(({ name }) => name));
    const unclassified = [];
    const stale = [];

    for (const { name, findings } of tests) {
      const expected = REVIEWED[name];
      if (findings.length > 0 && !expected) {
        unclassified.push(`${name}: ${findingsWithLines(findings)}`);
        continue;
      }
      if (!expected) continue;

      expect(expected.scope, `${name} needs a reviewed resource scope`).toBeTruthy();
      const actualPatterns = summarize(findings).sort();
      const expectedPatterns = expected.patterns.trim() ? expected.patterns.trim().split(/\s+/).sort() : [];
      if (JSON.stringify(actualPatterns) !== JSON.stringify(expectedPatterns)) {
        stale.push(`${name}: expected [${expectedPatterns.join(', ')}], found [${findingsWithLines(findings)}]`);
      }
    }

    const missingFiles = Object.keys(REVIEWED).filter((name) => !names.has(name));
    expect(unclassified, 'new write-shaped patterns need explicit classification').toEqual([]);
    expect(stale, 'changed resource patterns need review and an updated classification').toEqual([]);
    expect(missingFiles, 'classifications must refer to discovered script tests').toEqual([]);
  });

  it('requires explicit classification for tests with zero detected side effects', () => {
    const tests = deriveScriptTests(TEST_DIRECTORY);
    const unclassifiedZeroFindings = [];
    for (const { name, findings } of tests) {
      if (findings.length === 0 && !REVIEWED[name]) {
        unclassifiedZeroFindings.push(name);
      }
    }
    expect(unclassifiedZeroFindings, 'tests with zero findings must be explicitly classified in REVIEWED').toEqual([]);
  });

  it('keeps intentional shared reads and their boundaries explicit', () => {
    const tests = new Map(deriveScriptTests(TEST_DIRECTORY).map(({ name }) => [name, true]));
    for (const { file, resource, evidence, rule } of SHARED_READS) {
      expect(tests.has(file), `${file} must remain in the derived scan`).toBe(true);
      expect(resource, `${file} needs a named shared resource`).toBeTruthy();
      expect(rule, `${file} needs a bounded read/write rule`).toBeTruthy();
      const source = readFileSync(join(TEST_DIRECTORY, file), 'utf8');
      expect(source, `${file} must retain the evidence for ${resource}`).toContain(evidence);
    }
  });

  it('keeps process-wide environment mutation separate from filesystem writes', () => {
    const tests = new Map(deriveScriptTests(TEST_DIRECTORY).map(({ name, findings }) => [name, findings]));
    for (const { file, keys, evidence, rule } of PROCESS_ENV_WRITES) {
      const findings = tests.get(file);
      expect(findings, `${file} must remain in the derived scan`).toBeDefined();
      expect(rule, `${file} needs a process-state classification`).toBeTruthy();
      expect(readFileSync(join(TEST_DIRECTORY, file), 'utf8')).toContain(evidence);
      for (const key of keys) {
        expect(
          findings.some(({ kind, api }) => kind === 'process-env-write' && api.includes(key)),
          `${file} must flag process.env.${key}`
        ).toBe(true);
      }
    }
  });
});
