import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, realpathSync } from 'node:fs';
import { link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { delimiter, dirname, join } from 'node:path';
import { MAX_KILO_OUTPUT_BYTES, resolveKiloCli, runKiloCompletion } from '../lib/free-model-kilo.mjs';

vi.setConfig({ testTimeout: 15_000 });

async function writeExecutable(filePath, source, { windowsShim = process.platform === 'win32' } = {}) {
  await mkdir(join(filePath, '..'), { recursive: true });
  if (windowsShim) {
    const scriptPath = `${filePath}.cjs`;
    const commandPath = `${filePath}.cmd`;
    await writeFile(scriptPath, `${source}\n`, 'utf8');
    await writeFile(commandPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, 'utf8');
    return commandPath;
  }
  await writeFile(filePath, `#!/usr/bin/env node\n${source}\n`, { encoding: 'utf8', mode: 0o700 });
  return filePath;
}

describe('Kilo CLI discovery', () => {
  it('uses an explicit KILO_CLI override before searching local installations', async () => {
    await expect(resolveKiloCli({ command: '/custom/bin/kilo', pathValue: '', home: '/missing' })).resolves.toBe(
      '/custom/bin/kilo'
    );
  });

  it('excludes the caller checkout bin when locating the runner CLI', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-caller-checkout-'));
    const callerRoot = join(directory, 'caller-checkout');
    const projectRoot = join(directory, 'runner-checkout');
    const callerBin = join(callerRoot, 'node_modules', '.bin');
    const trustedBin = join(directory, 'trusted-bin');
    const callerKilo = await writeExecutable(join(callerBin, 'kilo'), 'process.exit(0);');
    const trustedKilo = await writeExecutable(join(trustedBin, 'kilo'), 'process.exit(0);');

    try {
      await mkdir(projectRoot, { recursive: true });
      await expect(
        resolveKiloCli({
          command: '',
          pathValue: [callerBin, trustedBin].join(delimiter),
          cwd: callerRoot,
          projectRoot,
          home: join(directory, 'empty-home'),
        })
      ).resolves.toBe(realpathSync(trustedKilo));
      expect(existsSync(callerKilo)).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    'excludes caller checkout PATH entries that escape through a descendant symlink',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-caller-symlink-'));
      const callerRoot = join(directory, 'caller-checkout');
      const projectRoot = join(directory, 'runner-checkout');
      const externalPackage = join(directory, 'external-package');
      const linkedPackage = join(callerRoot, 'vendor');
      const callerBin = join(linkedPackage, 'node_modules', '.bin');
      const trustedBin = join(directory, 'trusted-bin');
      const trustedKilo = await writeExecutable(join(trustedBin, 'kilo'), 'process.exit(0);');

      try {
        await Promise.all([
          mkdir(callerRoot, { recursive: true }),
          mkdir(projectRoot, { recursive: true }),
          mkdir(join(externalPackage, 'node_modules', '.bin'), { recursive: true }),
        ]);
        await symlink(externalPackage, linkedPackage, 'dir');
        await writeExecutable(join(callerBin, 'kilo'), 'process.exit(0);');

        await expect(
          resolveKiloCli({
            command: '',
            pathValue: [callerBin, trustedBin].join(delimiter),
            cwd: callerRoot,
            projectRoot,
            home: join(directory, 'empty-home'),
          })
        ).resolves.toBe(realpathSync(trustedKilo));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it.skipIf(process.platform === 'win32')(
    'excludes hard-link aliases to executables inside a protected checkout',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-hard-link-'));
      const callerRoot = join(directory, 'caller-checkout');
      const projectRoot = join(directory, 'runner-checkout');
      const callerKilo = await writeExecutable(join(callerRoot, 'bin', 'kilo'), 'process.exit(0);');
      const aliasBin = join(directory, 'external-bin');
      const trustedBin = join(directory, 'trusted-bin');
      const aliasKilo = join(aliasBin, 'kilo');
      const trustedKilo = await writeExecutable(join(trustedBin, 'kilo'), 'process.exit(0);');

      try {
        await mkdir(projectRoot, { recursive: true });
        await mkdir(aliasBin, { recursive: true });
        await link(callerKilo, aliasKilo);
        expect((await stat(aliasKilo)).nlink).toBe(2);
        await expect(
          resolveKiloCli({
            command: '',
            pathValue: [aliasBin, trustedBin].join(delimiter),
            cwd: callerRoot,
            projectRoot,
            home: join(directory, 'empty-home'),
          })
        ).resolves.toBe(realpathSync(trustedKilo));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it('filters Windows PATH entries case-insensitively with the Windows delimiter', async () => {
    const projectRoot = 'C:\\Repo';
    const projectBin = path.win32.join(projectRoot, 'node_modules', '.bin');
    const trustedDirectory = 'C:\\Tools';
    const fileSystem = new Map([
      [path.win32.normalize(projectBin).toLowerCase(), 'directory'],
      [path.win32.normalize(path.win32.join(projectBin, 'kilo.exe')).toLowerCase(), 'file'],
      [path.win32.normalize(trustedDirectory).toLowerCase(), 'directory'],
      [path.win32.normalize(path.win32.join(trustedDirectory, 'kilo.exe')).toLowerCase(), 'file'],
    ]);
    const statImpl = async (candidate) => {
      const kind = fileSystem.get(path.win32.normalize(candidate).toLowerCase());
      if (!kind) throw Object.assign(new Error('missing fixture path'), { code: 'ENOENT' });
      return { isDirectory: () => kind === 'directory', isFile: () => kind === 'file', nlink: kind === 'file' ? 1 : 2 };
    };

    await expect(
      resolveKiloCli({
        command: '',
        pathValue: `${projectBin.toLowerCase()};${trustedDirectory}`,
        cwd: projectRoot,
        projectRoot,
        platform: 'win32',
        accessImpl: async () => {},
        lstatImpl: async () => ({ isSymbolicLink: () => false }),
        readdirImpl: async () => [{ name: 'kilo.exe' }],
        realpathImpl: async (candidate) => path.win32.normalize(candidate),
        statImpl,
      })
    ).resolves.toBe(path.win32.join(trustedDirectory, 'kilo.exe'));
  });

  it.skipIf(process.platform === 'win32')(
    'rejects symlink chains through protected bins while allowing the same direct external executable',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-symlink-chain-'));
      const projectRoot = join(directory, 'project', 'repo');
      const projectBin = join(projectRoot, 'node_modules', '.bin');
      const trustedBin = join(directory, 'trusted-bin');
      const loopBin = join(directory, 'loop-bin');
      const externalBin = join(directory, 'external-bin');
      const externalKilo = await writeExecutable(join(externalBin, 'kilo'), 'process.exit(0);');

      try {
        await Promise.all([
          mkdir(projectBin, { recursive: true }),
          mkdir(trustedBin, { recursive: true }),
          mkdir(loopBin, { recursive: true }),
        ]);
        await symlink(externalKilo, join(projectBin, 'kilo'));
        await symlink(path.relative(trustedBin, join(projectBin, 'kilo')), join(trustedBin, 'kilo'));
        await symlink('kilo', join(loopBin, 'kilo'));

        const resolveFrom = (pathValue) =>
          resolveKiloCli({
            command: '',
            pathValue,
            cwd: projectRoot,
            projectRoot,
            home: join(directory, 'empty-home'),
          });

        await expect(resolveFrom(trustedBin)).resolves.toBeNull();
        await expect(resolveFrom(loopBin)).resolves.toBeNull();
        await expect(resolveFrom(externalBin)).resolves.toBe(realpathSync(externalKilo));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it.skipIf(process.platform === 'win32')(
    'rejects extension candidates with a parent symlink into a protected bin',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-extension-bin-alias-'));
      const projectRoot = join(directory, 'project', 'repo');
      const projectBin = join(projectRoot, 'node_modules', '.bin');
      const extensionBin = join(directory, 'home', '.vscode', 'extensions', 'kilocode.kilo-code-test', 'bin');
      const externalBin = join(directory, 'external-bin');
      const externalKilo = await writeExecutable(join(externalBin, 'kilo'), 'process.exit(0);');

      try {
        await Promise.all([mkdir(projectBin, { recursive: true }), mkdir(dirname(extensionBin), { recursive: true })]);
        await symlink(externalKilo, join(projectBin, 'kilo'));
        await symlink(projectBin, extensionBin, 'dir');

        await expect(
          resolveKiloCli({
            command: '',
            pathValue: '',
            cwd: projectRoot,
            projectRoot,
            home: join(directory, 'home'),
          })
        ).resolves.toBeNull();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it('filters unsafe PATH aliases and fails closed on unreadable ancestor bins before editor extensions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-discovery-'));
    const projectRoot = join(directory, 'project', 'repo');
    const projectBin = join(projectRoot, 'node_modules', '.bin');
    const ancestorBin = join(directory, 'node_modules', '.bin');
    const projectKilo = await writeExecutable(join(projectBin, 'kilo'), 'process.exit(0);');
    await writeExecutable(join(ancestorBin, 'other'), 'process.exit(0);');
    const externalKilo = await writeExecutable(join(directory, 'global-bin', 'kilo'), 'process.exit(0);');
    await symlink(externalKilo, join(ancestorBin, 'kilo'));
    const binAlias = join(directory, 'bin-alias');
    const executableAliasDirectory = join(directory, 'path-alias');
    await symlink(projectBin, binAlias, process.platform === 'win32' ? 'junction' : 'dir');
    await writeExecutable(join(executableAliasDirectory, 'other'), 'process.exit(0);');
    await symlink(projectKilo, join(executableAliasDirectory, 'kilo'));
    const pathKilo = await writeExecutable(join(directory, 'path', 'kilo'), 'process.exit(0);');
    const extensionKilo = await writeExecutable(
      join(directory, 'home', '.vscode', 'extensions', 'kilocode.kilo-code-8.0.0-test', 'bin', 'kilo'),
      'process.exit(0);'
    );
    try {
      await expect(
        resolveKiloCli({
          command: '',
          pathValue: [projectBin, binAlias, ancestorBin, executableAliasDirectory, join(directory, 'path')].join(
            delimiter
          ),
          home: join(directory, 'home'),
          cwd: projectRoot,
          projectRoot,
        })
      ).resolves.toBe(realpathSync(pathKilo));
      await expect(
        resolveKiloCli({
          command: '',
          pathValue: join(directory, 'global-bin'),
          home: join(directory, 'home'),
          cwd: projectRoot,
          projectRoot,
        })
      ).resolves.toBe(realpathSync(externalKilo));
      await expect(
        resolveKiloCli({
          command: '',
          pathValue: join(directory, 'path'),
          home: join(directory, 'home'),
          cwd: projectRoot,
          projectRoot,
          statImpl: async (candidate) => {
            if (candidate === ancestorBin) throw Object.assign(new Error('fixture access denied'), { code: 'EACCES' });
            return stat(candidate);
          },
        })
      ).resolves.toBeNull();
      await expect(resolveKiloCli({ command: '', pathValue: '', home: join(directory, 'home') })).resolves.toBe(
        realpathSync(extensionKilo)
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('authenticated Kilo CLI completion', () => {
  it.skipIf(process.platform !== 'win32')(
    'resolves Kilo shims through the filtered PATH and relative overrides from the caller cwd',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-shim-isolation-'));
      const callerCwd = join(directory, 'caller');
      const projectBin = join(callerCwd, 'node_modules', '.bin');
      const safeBin = join(directory, 'safe-bin');
      const relativeBin = join(callerCwd, 'relative-bin');
      await Promise.all([
        mkdir(projectBin, { recursive: true }),
        mkdir(safeBin, { recursive: true }),
        mkdir(relativeBin),
      ]);
      const projectShim = join(projectBin, 'kilo.cmd');
      const safeShim = join(safeBin, 'kilo.cmd');
      const safeExecutable = join(safeBin, 'kilo.exe');
      const relativeShim = join(relativeBin, 'kilo.cmd');
      await writeFile(projectShim, '@echo off\r\n', 'utf8');
      await writeFile(safeShim, '@echo off\r\n', 'utf8');
      await writeFile(safeExecutable, '', 'utf8');
      await writeFile(relativeShim, '@echo off\r\n', 'utf8');
      const callerPath = [projectBin, safeBin].join(';');
      const isolatedComSpec = join(directory, 'isolated-cmd.exe');
      const inheritedComSpec = join(directory, 'inherited-cmd.exe');
      vi.stubEnv('PATH', callerPath);
      vi.stubEnv('PATHEXT', '.EXE;.CMD');
      vi.stubEnv('ComSpec', inheritedComSpec);
      const spawnImpl = vi.fn(() => {
        throw new Error('intentional test stop before process launch');
      });
      const env = {
        PATH: callerPath,
        HOME: directory,
        USERPROFILE: directory,
        TEMP: directory,
        TMP: directory,
        TMPDIR: directory,
        XDG_DATA_HOME: join(directory, 'xdg-data'),
        COMSPEC: isolatedComSpec,
        PATHEXT: '.CMD;.EXE',
      };
      const options = {
        model: 'model:free',
        prompt: 'prompt',
        env,
        cwd: callerCwd,
        projectRoot: callerCwd,
        spawnImpl,
      };

      try {
        await expect(runKiloCompletion({ ...options, command: 'kilo' })).resolves.toEqual({
          error: 'Kilo CLI could not be started',
          exhaustSource: true,
        });
        let [spawnCommand, spawnArgs, spawnOptions] = spawnImpl.mock.calls.at(-1);
        expect(spawnCommand).toBe(isolatedComSpec);
        expect(spawnArgs.at(-1)).toContain(safeShim);
        expect(spawnArgs.at(-1)).not.toContain(projectShim);
        expect(spawnArgs.at(-1)).not.toContain(safeExecutable);
        expect(spawnOptions.env.PATH).not.toContain(projectBin);
        expect(spawnOptions.env.PATHEXT).toBeUndefined();
        expect(spawnOptions.env.COMSPEC).toBe(isolatedComSpec);

        spawnImpl.mockClear();
        await expect(
          runKiloCompletion({ ...options, command: path.win32.relative(callerCwd, relativeShim) })
        ).resolves.toEqual({ error: 'Kilo CLI could not be started', exhaustSource: true });
        [spawnCommand, spawnArgs, spawnOptions] = spawnImpl.mock.calls.at(-1);
        expect(spawnCommand).toBe(isolatedComSpec);
        expect(spawnArgs.at(-1)).toContain(relativeShim);
        expect(spawnOptions.cwd).not.toBe(callerCwd);
      } finally {
        vi.unstubAllEnvs();
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it('uses the logged-in provider, private stdin prompt, no-tools agent, and strict JSON completion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const fixtureDataHome = join(directory, 'fixture-data');
    const runtimeProjectRoot = join(directory, 'caller-project', 'repo');
    const runtimeProjectBin = join(runtimeProjectRoot, 'node_modules', '.bin');
    const runtimeAncestorBin = join(directory, 'node_modules', '.bin');
    const runtimeCallerRoot = join(directory, 'different-caller-worktree');
    const runtimeCallerBin = join(runtimeCallerRoot, 'node_modules', '.bin');
    const runtimeCallerExternalPackage = join(directory, 'external-caller-package');
    const runtimeCallerSymlinkBin = join(runtimeCallerRoot, 'vendor', 'node_modules', '.bin');
    await mkdir(runtimeProjectBin, { recursive: true });
    await mkdir(runtimeAncestorBin, { recursive: true });
    await mkdir(runtimeCallerBin, { recursive: true });
    await mkdir(runtimeCallerRoot, { recursive: true });
    await mkdir(join(runtimeCallerExternalPackage, 'node_modules', '.bin'), { recursive: true });
    await symlink(runtimeCallerExternalPackage, join(runtimeCallerRoot, 'vendor'), 'dir');
    await mkdir(join(fixtureDataHome, 'kilo'), { recursive: true });
    await mkdir(join(fixtureDataHome, 'other-app'), { recursive: true });
    await writeFile(join(fixtureDataHome, 'kilo', 'auth.json'), 'fixture auth', 'utf8');
    await writeFile(join(fixtureDataHome, 'kilo', 'history.json'), 'prior conversation', 'utf8');
    await writeFile(join(fixtureDataHome, 'other-app', 'private.json'), 'not exposed', 'utf8');
    vi.stubEnv('TMPDIR', directory);
    vi.stubEnv('TMP', directory);
    vi.stubEnv('TEMP', directory);
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const message = fs.readFileSync(0, 'utf8');
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
const isolatedKiloData = path.join(process.env.XDG_DATA_HOME, 'kilo');
const agentPath = path.join(process.cwd(), '.kilo', 'agent', 'free-completion.md');
const agentPolicy = fs.readFileSync(agentPath, 'utf8');
const runtimePath = process.env.PATH.split(path.delimiter);
if (runtimePath.includes(${JSON.stringify(runtimeProjectBin)}) || runtimePath.includes(${JSON.stringify(runtimeAncestorBin)}) || runtimePath.includes(${JSON.stringify(runtimeCallerBin)}) || runtimePath.includes(${JSON.stringify(realpathSync(runtimeCallerSymlinkBin))})) process.exit(23);
if (!runtimePath.includes(path.dirname(fs.realpathSync(process.execPath)))) process.exit(24);
if (!args.includes('--pure') || valueAfter('--format') !== 'json') process.exit(4);
if (valueAfter('--model') !== 'kilo/xingchen-agi/xing4.0-29b-a4b:free') process.exit(5);
if (valueAfter('--agent') !== 'free-completion') process.exit(6);
if (args.includes('--variant')) process.exit(7);
if (args.includes('--file')) process.exit(8);
if (!message.startsWith('Answer the provided request directly, in plain text, using at most 65536 output tokens.')) process.exit(9);
if (!message.includes('private prompt')) process.exit(10);
if (args.join(' ').includes('private prompt')) process.exit(11);
if (process.env.OPENROUTER_API_KEY || process.env.GROQ_API_KEY || process.env.GROQ_API_KEYS || process.env.NODE_OPTIONS || process.env.NODE_PATH || process.env.PWD || process.env.UNRELATED_SECRET) process.exit(12);
if (fs.realpathSync(process.cwd()) !== fs.realpathSync(path.join(process.env.HOME, 'project')) || fs.existsSync(path.join(process.cwd(), 'package.json')) || fs.existsSync(path.join(process.cwd(), 'kilo.jsonc')) || fs.existsSync(path.join(process.cwd(), '.kilo', 'kilo.jsonc'))) process.exit(13);
if (!agentPolicy.includes('mode: all') || !agentPolicy.includes("  '*': deny") || !agentPolicy.includes('Do not call tools.')) process.exit(14);
if (process.env.KILO_CONFIG_CONTENT || process.env.KILO_DISABLE_PROJECT_CONFIG) process.exit(15);
if (process.env.HOME === '/fixture/home' || process.env.USERPROFILE === '/fixture/home' || process.env.XDG_CONFIG_HOME === '/fixture/config') process.exit(22);
if (!process.env.XDG_DATA_HOME.startsWith(process.env.HOME + path.sep) || !process.env.XDG_CACHE_HOME.startsWith(process.env.HOME + path.sep) || process.env.KILO_DB) process.exit(16);
if (!process.env.TMPDIR.startsWith(process.env.HOME + path.sep) || process.env.TMP !== process.env.TMPDIR || process.env.TEMP !== process.env.TMPDIR || !fs.existsSync(process.env.TMPDIR)) process.exit(17);
if (fs.lstatSync(isolatedKiloData).isSymbolicLink() || !fs.lstatSync(path.join(isolatedKiloData, 'auth.json')).isSymbolicLink()) process.exit(18);
if (fs.readFileSync(path.join(isolatedKiloData, 'auth.json'), 'utf8') !== 'fixture auth') process.exit(19);
if (fs.existsSync(path.join(isolatedKiloData, 'history.json'))) process.exit(20);
if (fs.existsSync(path.join(process.env.XDG_DATA_HOME, 'other-app'))) process.exit(21);
const fixtureDir = path.dirname(process.argv[1]);
fs.writeFileSync(path.join(fixtureDir, 'isolated-home-path.txt'), process.env.HOME);
fs.writeFileSync(path.join(fixtureDir, 'isolated-agent-policy.txt'), agentPolicy);
console.log(JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }));
console.log(JSON.stringify({ type: 'text', part: { text: 'safe response' } }));
console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0, tokens: { input: 10, output: 3, reasoning: 1 } } }));`
    );

    try {
      await expect(
        runKiloCompletion({
          command,
          model: 'xingchen-agi/xing4.0-29b-a4b:free',
          prompt: 'private prompt',
          maxTokens: 65536,
          cwd: runtimeCallerRoot,
          projectRoot: runtimeProjectRoot,
          env: {
            PATH: [
              runtimeProjectBin,
              runtimeAncestorBin,
              runtimeCallerBin,
              runtimeCallerSymlinkBin,
              dirname(process.execPath),
            ].join(delimiter),
            HOME: '/fixture/home',
            USERPROFILE: '/fixture/home',
            XDG_CONFIG_HOME: '/fixture/config',
            XDG_DATA_HOME: fixtureDataHome,
            TMPDIR: directory,
            TMP: directory,
            TEMP: directory,
            KILO_DB: '/fixture/kilo.db',
            OPENROUTER_API_KEY: 'test-openrouter-key',
            GROQ_API_KEY: 'test-groq-key',
            GROQ_API_KEYS: 'test-groq-key-list',
            KILO_CONFIG_CONTENT: '{"agent":{"free-completion":{"permission":{"bash":"allow"}}}}',
            KILO_DISABLE_PROJECT_CONFIG: '0',
            NODE_OPTIONS: '--require /tmp/untrusted-preload.cjs',
            NODE_PATH: '/tmp/untrusted-modules',
            PWD: '/unexpected/worktree',
            UNRELATED_SECRET: 'do-not-forward',
          },
        })
      ).resolves.toEqual({
        model: 'xingchen-agi/xing4.0-29b-a4b:free',
        content: 'safe response',
        finishReason: 'stop',
        usage: { input_tokens: 10, output_tokens: 3, reasoning_tokens: 1, cost: 0 },
      });

      const blockedSpawn = vi.fn();
      await expect(
        runKiloCompletion({
          command,
          model: 'xingchen-agi/xing4.0-29b-a4b:free',
          prompt: 'private prompt',
          maxTokens: 128,
          cwd: runtimeCallerRoot,
          projectRoot: runtimeProjectRoot,
          env: {
            PATH: [
              runtimeProjectBin,
              runtimeAncestorBin,
              runtimeCallerBin,
              runtimeCallerSymlinkBin,
              dirname(process.execPath),
            ].join(delimiter),
          },
          statImpl: async (candidate) => {
            if (candidate === runtimeAncestorBin)
              throw Object.assign(new Error('fixture access denied'), { code: 'EACCES' });
            return stat(candidate);
          },
          spawnImpl: blockedSpawn,
        })
      ).resolves.toEqual({ error: 'Kilo completion failed locally', exhaustSource: true });
      expect(blockedSpawn).not.toHaveBeenCalled();

      const agent = await readFile(join(directory, 'isolated-agent-policy.txt'), 'utf8');
      expect(agent).toContain("  '*': deny");
      const isolatedHome = await readFile(join(directory, 'isolated-home-path.txt'), 'utf8');
      expect(isolatedHome).not.toBe('/fixture/home');
      expect(existsSync(isolatedHome)).toBe(false);
      expect(existsSync(join(fixtureDataHome, 'kilo', 'auth.json'))).toBe(true);
      expect(existsSync(join(fixtureDataHome, 'kilo', 'history.json'))).toBe(true);
      expect(existsSync(join(fixtureDataHome, 'other-app', 'private.json'))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  it.each(['.git', '.kilo', '.kilocode'])(
    'refuses to run when the caller temporary directory is inside a %s project boundary',
    async (marker) => {
      const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-project-temp-'));
      const projectRoot = join(directory, 'project');
      const boundaryDirectory = join(projectRoot, marker);
      await mkdir(boundaryDirectory, { recursive: true });
      const boundaryFile = join(boundaryDirectory, marker === '.git' ? 'HEAD' : 'kilo.jsonc');
      const originalBoundaryData = 'caller project data';
      await writeFile(boundaryFile, originalBoundaryData, 'utf8');
      const spawnImpl = vi.fn();

      try {
        const result = await runKiloCompletion({
          command: 'kilo',
          model: 'xingchen-agi/xing4.0-29b-a4b:free',
          prompt: 'safe prompt',
          maxTokens: 128,
          env: {
            PATH: process.env.PATH,
            HOME: directory,
            USERPROFILE: directory,
            TMPDIR: projectRoot,
            TMP: projectRoot,
            TEMP: projectRoot,
          },
          spawnImpl,
        });

        expect(result.error).toBe('Kilo completion failed locally');
        expect(spawnImpl).not.toHaveBeenCalled();
        expect(await readFile(boundaryFile, 'utf8')).toBe(originalBoundaryData);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it.each([
    ['.git', 'home-derived'],
    ['.kilo', 'home-derived'],
    ['.kilocode', 'home-derived'],
    ['.git', 'symlinked-xdg-data'],
    ['.kilo', 'symlinked-xdg-data'],
    ['.kilocode', 'symlinked-xdg-data'],
  ])(
    'refuses to link Kilo auth data with a %s project marker through %s configuration',
    async (marker, configuration) => {
      const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-project-auth-'));
      const projectRoot = join(directory, 'project');
      const dataHome = join(projectRoot, '.local', 'share');
      const authPath = join(dataHome, 'kilo', 'auth.json');
      const authContents = 'project-local auth sentinel';
      await mkdir(join(projectRoot, marker), { recursive: true });
      await mkdir(join(dataHome, 'kilo'), { recursive: true });
      await writeFile(authPath, authContents, 'utf8');
      const xdgDataAlias = join(directory, 'xdg-data-alias');
      const home = configuration === 'home-derived' ? projectRoot : join(directory, 'home');

      if (configuration === 'symlinked-xdg-data') {
        await symlink(dataHome, xdgDataAlias, process.platform === 'win32' ? 'junction' : 'dir');
      }

      const spawnImpl = vi.fn();

      try {
        const result = await runKiloCompletion({
          command: 'kilo',
          model: 'xingchen-agi/xing4.0-29b-a4b:free',
          prompt: 'safe prompt',
          env: {
            PATH: process.env.PATH,
            HOME: home,
            USERPROFILE: home,
            ...(configuration === 'symlinked-xdg-data' ? { XDG_DATA_HOME: xdgDataAlias } : {}),
            TMPDIR: directory,
          },
          spawnImpl,
        });

        expect(result.error).toBe('Kilo completion failed locally');
        expect(spawnImpl).not.toHaveBeenCalled();
        expect(await readFile(authPath, 'utf8')).toBe(authContents);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it('refuses OpenRouter so it cannot use Kilo-managed credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(join(directory, 'fake-kilo'), 'process.exit(12);');

    try {
      await expect(
        runKiloCompletion({ command, source: 'openrouter', model: 'vendor/model:free', prompt: 'prompt' })
      ).resolves.toEqual({ error: 'Unsupported Kilo CLI provider' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(['stdout', 'stderr'])(
    'rejects any attempted tool call reported on %s even when final text follows',
    async (stream) => {
      const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
      const command = await writeExecutable(
        join(directory, 'fake-kilo'),
        `${stream === 'stderr' ? 'console.error' : 'console.log'}(JSON.stringify({ type: 'tool_use', part: { type: 'tool' } }));
console.log(JSON.stringify({ type: 'text', part: { text: 'not accepted' } }));
console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0 } }));`
      );

      try {
        await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
          error: 'Kilo attempted a tool call; the completion was rejected',
          exhaustSource: true,
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it.each([
    [
      'the observed unwrapped response',
      `<function=kilo_memory_recall>
<parameter=mode>
search
</parameter>
<parameter=query>
watcher owner read
</parameter>
</function>
</tool_call>`,
    ],
    [
      'the unwrapped response after reasoning text',
      `I need to search before answering.
<function=kilo_memory_recall>
<parameter=mode>
search
</parameter>
<parameter=query>
watcher owner read
</parameter>
</function>
</tool_call>`,
    ],
    [
      'the wrapped form after reasoning text',
      `The request calls for a lookup.
<tool_call>
<function=kilo_memory_recall>
<parameter=mode>
search
</parameter>
<parameter=query>
watcher owner read
</parameter>
</function>
</tool_call>`,
    ],
    [
      'Kilo JavaScript-style calls',
      `kilo_ls({paths: ["src", "e2e"]})
kilo_grep({pattern: "magic.wand|MagicWand", paths: ["src"]})
kilo_grep({pattern: "selection", paths: ["e2e"]})`,
    ],
    ['an unfinished tool-call markup prefix', '<tool_call><function=kilo_ls>'],
    ['an unfinished Kilo function-call prefix', 'kilo_ls('],
    [
      'Kilo JavaScript-style calls separated by comments',
      `kilo_ls /* inspect the source */ ( // keep this call data-only
  {paths: ["src"]}
)`,
    ],
    ['the Kilo CLI rendered tool-call span', '<span class="tool-call">listFiles({"path": "src"})</span>'],
    [
      'a tool-call class after a quoted greater-than attribute',
      '<span title="a > b" class="tool-call">listFiles({"path": "src"})</span>',
    ],
    ['the Kilo CLI rendered read_file tool tag', '<read_file><path>src/example.ts</path></read_file>'],
    [
      'the Kilo CLI serialized attempt_completion tool tag',
      '<attempt_completion><result>Task completed.</result></attempt_completion>',
    ],
    ['a serialized delete_file tool tag', '<delete_file><path>src/obsolete.ts</path></delete_file>'],
    ['a serialized update_todo_list tool tag', '<update_todo_list><todos>[]</todos></update_todo_list>'],
    [
      'function-call JSONL records emitted as plain text',
      [
        JSON.stringify({ type: 'function_call', name: 'read', arguments: { path: 'src/tools/draw.ts' } }),
        JSON.stringify({ type: 'function_call', name: 'bash', arguments: { command: 'git show 80eb207cb8 --stat' } }),
        JSON.stringify({ type: 'function_call', name: 'view_file', arguments: { path: 'src/tools/draw.ts' } }),
        JSON.stringify({
          tool_calls: [{ type: 'function', function: { name: 'read', arguments: '{"path":"src/tools/draw.ts"}' } }],
        }),
      ].join('\n'),
    ],
    [
      'a pretty-printed function-call JSON object embedded in prose',
      [
        'Example function call:',
        '{',
        '  "type": "function_call",',
        '  "name": "read_file",',
        '  "arguments": { "path": "src/example.ts" }',
        '}',
        'This is an example.',
      ].join('\n'),
    ],
    [
      'a pretty-printed function-call JSON object inside a prose bracket',
      [
        'Example function call [payload:',
        '{',
        '  "type": "function_call",',
        '  "name": "read_file",',
        '  "arguments": { "path": "src/example.ts" }',
        '}',
        'The bracket is explanatory prose.',
      ].join('\n'),
    ],
    [
      'an OpenAI function-call JSON envelope emitted as plain text',
      JSON.stringify({
        tool_calls: [{ type: 'function', function: { name: 'read', arguments: '{"path":"src"}' } }],
      }),
    ],
    [
      'a function-call JSON object after nested false function markers exhaust the inspection budget',
      `Ordinary prose: ${('{"type":"function","pad":"' + 'x'.repeat(465) + '","payload":').repeat(65)}null${'}'.repeat(65)} actual call: ${JSON.stringify(
        {
          type: 'function_call',
          name: 'read_file',
          arguments: { path: 'src/secret.ts' },
        }
      )}`,
    ],
    [
      'a deeply nested array containing a function-call object',
      '['.repeat(15_000) + '{"type":"function_call","name":"read_file","arguments":{}}' + ']'.repeat(15_000),
    ],
    [
      'a Kilo JavaScript-style call hidden by an unterminated comment',
      `kilo_ls/* unfinished comment
({paths: ["src"]})`,
    ],
    [
      'bare serialized function markup with a spaced closer',
      `<function=kilo_memory_recall>
<parameter=mode>search</parameter>
</function >`,
    ],
    [
      'XML parameters indented within a serialized call',
      `<tool_call>
<function=kilo_memory_recall>
    <parameter=mode>search</parameter>
</function>
</tool_call>`,
    ],
    ['a Kilo call with an indented object argument', 'kilo_ls(\n    {paths: ["src"]}\n)'],
    [
      'a serialized call after a blockquoted fence opener ends',
      ['> ```', '<function=kilo_ls></function></tool_call>'].join('\n'),
    ],
    [
      'a serialized function envelope surrounding a fenced example',
      [
        '<tool_call><function=kilo_memory_recall>',
        '~~~~xml',
        'Example markup is shown for documentation only.',
        '~~~~',
        '</function></tool_call>',
      ].join('\n'),
    ],
    [
      'a Kilo function call with its argument split by a fenced example',
      ['kilo_edit(', '~~~js', 'const example = true;', '~~~', '{ "path": "a" })'].join('\n'),
    ],
    [
      'a serialized call in an indented paragraph continuation',
      ['Explanation', '    <function=kilo_ls></function></tool_call>'].join('\n'),
    ],
    [
      'a serialized call in a list continuation below the list code-block threshold',
      ['- item', '', '    <function=kilo_ls></function></tool_call>'].join('\n'),
    ],
    [
      'a serialized call in an ordered-list continuation below the code-block threshold',
      ['1. item', '', '      <function=kilo_ls></function></tool_call>'].join('\n'),
    ],
    [
      'a serialized call in a tab-indented list continuation below the code-block threshold',
      ['- item', '', '\t<function=kilo_ls></function></tool_call>'].join('\n'),
    ],
    [
      'a serialized call in a nested-list continuation below the code-block threshold',
      ['- outer', '  - inner', '', '      <function=kilo_ls></function></tool_call>'].join('\n'),
    ],
    [
      'a visible call in a nested list paragraph after two markers on one line',
      ['- - item', '', '      kilo_ls({paths: ["src"]})'].join('\n'),
    ],
    [
      'a serialized call in a blockquote list continuation below the code-block threshold',
      ['> - item', '> ', '>     <function=kilo_ls></function></tool_call>'].join('\n'),
    ],
    [
      'a serialized call in a blockquote list paragraph after tab padding shifts the list edge',
      ['>\t- item', '>', '>       <function=kilo_ls></function></tool_call>'].join('\n'),
    ],
    [
      'a serialized call in a list continuation after a lazy paragraph line',
      ['- item', '  continuation', '', '    <function=kilo_ls></function></tool_call>'].join('\n'),
    ],
    [
      'a serialized call continuing a paragraph after a blank line in a list item',
      ['- item', '', '  paragraph', '      <function=kilo_ls></function></tool_call>'].join('\n'),
    ],
    [
      'a serialized call in an ordered-list continuation after a fenced example',
      [
        '  10.  item',
        '',
        '       ~~~xml',
        '       <tool_call>',
        '       ~~~',
        '       <function=kilo_ls></function></tool_call>',
      ].join('\n'),
    ],
    [
      'a serialized call after a fenced block exits its list item',
      ['- item', '', '  ~~~xml', '  example', 'visible paragraph', '<function=kilo_ls></function></tool_call>'].join(
        '\n'
      ),
    ],
    [
      'a serialized call after a nested fence exits to its parent list item',
      [
        '- outer',
        '  - inner',
        '',
        '    ~~~xml',
        '    example',
        '  outer paragraph',
        '  <function=kilo_ls></function></tool_call>',
      ].join('\n'),
    ],
    [
      'escaped literal backticks around serialized call text',
      ['Before ', '\\', '` <function=kilo_ls></function></tool_call> after ', '\\', '`'].join(''),
    ],
    [
      'an escaped backtick inside inline code does not hide visible tool syntax',
      ['`', '\\', '` kilo_ls({paths: ["src"]}) ', '`'].join(''),
    ],
    [
      'backticks in separate paragraphs do not hide serialized call text',
      'Before a literal `\n\n<function=kilo_ls></function></tool_call>\n\nAfter a literal `',
    ],
  ])('rejects %s when returned as text instead of an answer', async (_label, content) => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const output = [
      JSON.stringify({ type: 'text', part: { text: content } }),
      JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0 } }),
    ].join('\n');
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `process.stdout.write(${JSON.stringify(output + '\n')});`
    );

    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
        error: 'Kilo attempted a tool call; the completion was rejected',
        exhaustSource: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'a triple-backtick fence',
      `Use this XML only as a documentation example:
\`\`\`xml
<tool_call>
<function=kilo_memory_recall>
<parameter=mode>
search
</parameter>
</function>
</tool_call>
\`\`\``,
    ],
    [
      'a four-backtick CRLF fence with a longer closer',
      [
        'Use this XML only as a documentation example:',
        '````xml',
        '<tool_call>',
        '<function=kilo_memory_recall>',
        '<parameter=mode>',
        'search',
        '</parameter>',
        '</function>',
        '</tool_call>',
        '`````',
      ].join('\r\n'),
    ],
    [
      'a tilde fence with mismatched and shorter closers',
      [
        '~~~~xml',
        '~~~',
        '<tool_call>',
        '<function=kilo_memory_recall>',
        '</function>',
        '</tool_call>',
        '````',
        '<tool_call>',
        '<function=kilo_memory_recall>',
        '</function>',
        '</tool_call>',
        '~~~~',
      ].join('\n'),
    ],
    ['a blockquoted tilde fence', ['> ~~~javascript', '> kilo_ls({paths: ["src"]})', '> ~~~'].join('\n')],
    [
      'a blockquoted tilde marker inside a top-level fence',
      ['~~~xml', '> ~~~', '<tool_call>', '<function=kilo_ls></function>', '</tool_call>', '~~~'].join('\n'),
    ],
    [
      'an unclosed tilde fence',
      `~~~xml
<tool_call>
<function=kilo_memory_recall>
</function>
</tool_call>`,
    ],
    ['a fenced JavaScript-style tool-call example', ['```javascript', 'kilo_ls({paths: ["src"]})', '```'].join('\n')],
    ['an indented JavaScript-style tool-call example', '    kilo_ls({paths: ["src"]})'],
    [
      'an inline JavaScript-style tool-call example',
      'The tool syntax is `kilo_ls({paths: ["src"]})` in this documentation example.',
    ],
    [
      'a rendered Kilo tool-call span in inline code',
      'The literal markup is `<span class="tool-call">listFiles({"path": "src"})</span>` in this documentation example.',
    ],
    [
      'a different rendered span class',
      '<span class="tool-call-example">This is documentation, not a tool call.</span>',
    ],
    [
      'an ordinary span whose title mentions the tool-call class',
      `<span title='the class="tool-call" example'>ordinary text</span>`,
    ],
    ['many malformed span starts', '<span data="unfinished '.repeat(25_000)],
    [
      'a prose answer with many lines and near-limit deeply nested non-call data',
      `Ordinary answer:\n${'line\n'.repeat(100_000)}${'['.repeat(200_000)}0${']'.repeat(200_000)}`,
    ],
    [
      'a rendered Kilo read_file tool tag in a fenced example',
      ['```xml', '<read_file><path>src/example.ts</path></read_file>', '```'].join('\n'),
    ],
    [
      'a JSON tool-call object in a fenced example',
      ['```json', '{"name":"read","arguments":{"path":"src/example.ts"}}', '```'].join('\n'),
    ],
    [
      'a pretty-printed function-call JSON object in a fenced example',
      [
        '```json',
        '{',
        '  "type": "function_call",',
        '  "name": "read_file",',
        '  "arguments": { "path": "src/example.ts" }',
        '}',
        '```',
      ].join('\n'),
    ],
    [
      'ordinary JSON data with name and arguments fields',
      '{"name":"settings","arguments":{"theme":"dark","language":"en"}}',
    ],
    ['JSON data with read as its name', '{"name":"read","arguments":{"path":"config.json"}}'],
    ['JSON data with bash as its name', '{"name":"bash","arguments":{"command":"build"}}'],
    ['JSON data with view_file as its name', '{"name":"view_file","arguments":{"path":"preview.json"}}'],
    [
      'a JSON tool result is not a new tool call',
      '{"type":"tool_result","name":"read","arguments":{"path":"config.json"}}',
    ],
    ['JSON data whose name extends a tool verb', '{"name":"readConfig","arguments":{"path":"settings.json"}}'],
    ['JSON data whose name uses an underscore after a tool verb', '{"name":"read_only","arguments":{"enabled":true}}'],
    ['JSON data with a generic action word as its name', '{"name":"search","arguments":{"query":"users"}}'],
    ['an ordinary XML search element', '<search>find users</search>'],
    ['an ordinary XML view element', '<view>preview details</view>'],
    [
      'an indented code example after an inline tool-call mention',
      'Use `kilo_ls({paths: ["src"]})` like this:\n\n    kilo_ls({paths: ["src"]})',
    ],
    [
      'a completed function-call mention before an indented example',
      'The old call was kilo_ls().\n\n    kilo_ls({paths: ["src"]})',
    ],
    [
      'a completed function call with a closing parenthesis in a string before an indented example',
      'The old call was kilo_ls(")").\n\n    kilo_ls({paths: ["src"]})',
    ],
    [
      'an indented code example at the threshold inside a bullet list item',
      ['- item', '', '      <function=kilo_ls></function></tool_call>'].join('\n'),
    ],
    [
      'an indented code example at the threshold inside an ordered list item',
      ['1. item', '', '       <function=kilo_ls></function></tool_call>'].join('\n'),
    ],
    [
      'an indented code example at the threshold inside a nested list item',
      ['- outer', '  - inner', '', '        <function=kilo_ls></function></tool_call>'].join('\n'),
    ],
    [
      'an indented code example at the threshold inside an indented ordered list item',
      ['  10.  item', '', '           <function=kilo_ls></function></tool_call>'].join('\n'),
    ],
    [
      'an indented code example at the threshold after a tab-padded list marker',
      ['-\titem', '', '\t\t<function=kilo_ls></function></tool_call>'].join('\n'),
    ],
    [
      'an indented code example after an ordered marker whose tab advances one column',
      [' 1.\tfirst', '', '        <function=kilo_ls></function></tool_call>'].join('\n'),
    ],
    [
      'an indented code example under a list after a tab-padded blockquote marker',
      ['>\t- item', '>', '>         <function=kilo_ls></function></tool_call>'].join('\n'),
    ],
    [
      'an indented code example under a quoted list after a tab following the marker',
      ['> -\titem', '>', '>       <function=kilo_ls></function></tool_call>'].join('\n'),
    ],
    [
      'a JavaScript-style call in an indented code example under a quoted list after a tab',
      ['> -\titem', '>', '>       kilo_ls({paths: ["src"]})'].join('\n'),
    ],
    [
      'a paragraph continuation in a nested list after two markers on one line',
      ['- - item', '', '        kilo_ls({paths: ["src"]})'].join('\n'),
    ],
    [
      'a fenced example inside an ordered list',
      ['  10.  item', '', '       ~~~xml', '       <function=kilo_ls></function></tool_call>', '       ~~~'].join('\n'),
    ],
    [
      'a fenced example inside a nested list item',
      ['- outer', '  - inner', '', '    ~~~xml', '    <function=kilo_ls></function></tool_call>', '    ~~~'].join('\n'),
    ],
    ['a fenced example opened on the same line as a list item', ['- ~~~js', '  kilo_ls({})', '  ~~~'].join('\n')],
    [
      'a fenced example opened on the same line as a nested list item',
      ['- - ~~~js', '    kilo_ls({})', '    ~~~'].join('\n'),
    ],
    [
      'a root indented code example after a list and a top-level paragraph',
      ['- item', '', 'Paragraph', '', '    kilo_ls({paths: ["src"]})'].join('\n'),
    ],
  ])('accepts tool-call markup inside %s as ordinary answer text', async (_label, content) => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const output = [
      JSON.stringify({ type: 'text', part: { text: content } }),
      JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0 } }),
    ].join('\n');
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `process.stdout.write(${JSON.stringify(output + '\n')});`
    );

    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toMatchObject({
        content,
        finishReason: 'stop',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('resumes rejecting serialized tool calls after a closed code fence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const content = `Documentation example:
~~~xml
<tool_call>
<function=kilo_memory_recall>
</function>
</tool_call>
~~~
<tool_call>
<function=kilo_memory_recall>
<parameter=mode>
search
</parameter>
</function>
</tool_call>`;
    const output = [
      JSON.stringify({ type: 'text', part: { text: content } }),
      JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0 } }),
    ].join('\n');
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `process.stdout.write(${JSON.stringify(output + '\n')});`
    );

    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
        error: 'Kilo attempted a tool call; the completion was rejected',
        exhaustSource: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not accept an earlier stopped step when the last step was truncated', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `console.log(JSON.stringify({ type: 'text', part: { text: 'earlier response' } }));
console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0 } }));
console.log(JSON.stringify({ type: 'text', part: { text: 'truncated tail' } }));
console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'length', cost: 0 } }));`
    );

    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
        error: 'Kilo did not return a complete non-empty response',
        finishReason: 'length',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects malformed JSONL stdout as a contained completion error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = join(directory, 'fake-kilo');
    await writeExecutable(
      command,
      `console.log(JSON.stringify({ type: 'text', part: { text: 'partial response' } }));
console.log('{"type":');
console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0 } }));`
    );

    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
        error: 'Kilo CLI returned malformed JSONL output',
        exhaustSource: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('exhausts a Kilo source after an authentication or quota status and hides provider bodies', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `console.log('\u001b[0;91mError: Too Many Requests\u001b[0m');
console.log(JSON.stringify({ type: 'error', error: { status: 429, message: 'private provider details' } }));
process.exit(1);`
    );

    try {
      const result = await runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' });
      expect(result).toEqual({
        error: 'Kilo provider quota or rate limit returned HTTP 429',
        exhaustSource: true,
        status: 429,
      });
      expect(JSON.stringify(result)).not.toContain('private provider details');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['nested numeric status', '{"status":429}'],
    ['snake-case status code', '{"status_code":429}'],
    ['snake-case HTTP status', '{"http_status":429}'],
    ['snake-case HTTP status code', '{"http_status_code":429}'],
    ['nested message status', '{"message":"HTTP 429"}'],
    ['nested message error status prefix', '{"message":"Error: HTTP 429"}'],
    ['nested message HTTP status code', '{"message":"HTTP status code: 429"}'],
    ['text status field', '{"status":"HTTP 429"}'],
    ['nested legacy quota message', JSON.stringify({ message: 'Free model usage limit reached (HTTP 429)' })],
    ['nested message status with reason phrase', '{"message":"HTTP 429 Too Many Requests"}'],
    ['nested message status with colon reason phrase', '{"message":"HTTP 429: Too Many Requests"}'],
  ])('extracts a deeply nested Kilo error status without recursive traversal: %s', async (_label, leaf) => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const depth = 6_000;
    const nestedError = `${'{"detail":'.repeat(depth)}${leaf}${'}'.repeat(depth)}`;
    const event = `{"type":"error","error":${nestedError}}`;
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `process.stdout.write(${JSON.stringify(event + '\n')});`
    );

    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
        error: 'Kilo provider quota or rate limit returned HTTP 429',
        exhaustSource: true,
        status: 429,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['detail text', '{"detail":"HTTP 429"}'],
    ['message prose', '{"message":"This is a local parse error; HTTP 429 is only an example."}'],
    ['leading status example', '{"message":"HTTP 429 is only an example in this local parse error."}'],
    ['detail array text', '{"detail":["HTTP 429"]}'],
    ['error prose', '"This local parse error mentions HTTP 429 only as an example."'],
    [
      'message quota phrase prose',
      JSON.stringify({ message: 'Local parse error: “Free model usage limit reached” is only an example.' }),
    ],
    [
      'multiline message quota phrase prose',
      JSON.stringify({
        message: 'Expected diagnostic:\nFree model usage limit reached (HTTP 429)\nActual error: invalid configuration',
      }),
    ],
    ['stderr message prose', '{"message":"This is a local parse error; HTTP 429 is only an example."}', 'stderr'],
    ['stderr diagnostic prose', 'Local parse error: HTTP 429 is only an example.', 'stderr', 'plain'],
    [
      'stderr quota phrase prose',
      'Local parse error: “Free model usage limit reached” is only an example.',
      'stderr',
      'plain',
    ],
    ['stderr quota phrase prefix prose', 'Free model usage limit reached is only an example.', 'stderr', 'plain'],
    [
      'multiline stderr quota phrase prose',
      'Expected diagnostic:\nFree model usage limit reached (HTTP 429)\nActual error: invalid configuration',
      'stderr',
      'plain',
    ],
  ])(
    'does not treat non-status or explanatory HTTP text in %s as a reported status',
    async (_label, errorFields, stream = 'stdout', format = 'json') => {
      const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
      const output = format === 'json' ? `{"type":"error","error":${errorFields}}` : errorFields;
      const command = await writeExecutable(
        join(directory, 'fake-kilo'),
        `process.${stream}.write(${JSON.stringify(`${output}\n`)}); process.exitCode = 1;`
      );

      try {
        await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
          error: format === 'plain' ? 'Kilo CLI exited 1' : 'Kilo CLI reported a provider or completion error',
          exhaustSource: false,
          status: null,
          modelAttributable: false,
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it.each([
    ['statusless stdout', 'stdout', { message: 'Free model usage limit reached' }],
    ['statusless stderr', 'stderr', { message: 'Free model usage limit reached' }],
    ['stdout status before message', 'stdout', { status: 400, message: 'Free model usage limit reached' }],
    ['stdout message before status', 'stdout', { message: 'Free model usage limit reached', status: 400 }],
    ['stderr status before message', 'stderr', { status: 400, message: 'Free model usage limit reached' }],
    ['stderr message before status', 'stderr', { message: 'Free model usage limit reached', status: 400 }],
    [
      'stdout status before coded quota message',
      'stdout',
      { status: 400, message: 'Free model usage limit reached (HTTP 429)' },
    ],
    [
      'stdout coded quota message before status',
      'stdout',
      { message: 'Free model usage limit reached (HTTP 429)', status: 400 },
    ],
    [
      'stderr status before coded quota message',
      'stderr',
      { status: 400, message: 'Free model usage limit reached (HTTP 429)' },
    ],
    [
      'stderr coded quota message before status',
      'stderr',
      { message: 'Free model usage limit reached (HTTP 429)', status: 400 },
    ],
  ])('preserves a structured quota error for %s', async (_label, stream, error) => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const event = JSON.stringify({ type: 'error', error });
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `process.${stream}.write(${JSON.stringify(`${event}\n`)}); process.exitCode = 1;`
    );

    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
        error: 'Kilo provider quota or rate limit was reached',
        exhaustSource: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not treat an error array index as a reported Kilo status', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const event = JSON.stringify({ type: 'error', error: Array.from({ length: 430 }, () => 'ordinary detail') });
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `process.stdout.write(${JSON.stringify(`${event}\n`)}); process.exitCode = 1;`
    );

    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
        error: 'Kilo CLI reported a provider or completion error',
        exhaustSource: false,
        status: null,
        modelAttributable: false,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['an unrelated identifier in a message', { message: 'Validation failed: user ID 429 not found' }],
    ['a numeric detail value', { details: [429] }],
    ['a numeric user field', { userId: 401 }],
    ['a generic numeric error code', { error_code: 429 }],
    ['an unrelated code in prose', { message: 'Record 402 could not be loaded' }],
  ])('does not treat %s as a Kilo HTTP status', async (_label, error) => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const event = JSON.stringify({ type: 'error', error });
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `process.stdout.write(${JSON.stringify(`${event}\n`)}); process.exitCode = 1;`
    );

    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
        error: 'Kilo CLI reported a provider or completion error',
        exhaustSource: false,
        status: null,
        modelAttributable: false,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'a text quota message',
      "console.error('Free model usage limit reached (HTTP 429): private provider body'); process.exit(1);",
    ],
    [
      'a structured JSONL error status',
      `process.stderr.write(${JSON.stringify(`${JSON.stringify({ type: 'error', error: { status: 429 } })}\n`)}); process.exitCode = 1;`,
    ],
    [
      'a structured JSONL legacy quota message',
      `process.stderr.write(${JSON.stringify(`${JSON.stringify({ type: 'error', error: { message: 'Free model usage limit reached (HTTP 429)' } })}\n`)}); process.exitCode = 1;`,
    ],
    ['a compact stderr status line', "console.error('HTTP status code: 429'); process.exit(1);"],
    ['an error-prefixed stderr status line', "console.error('Error: HTTP 429'); process.exit(1);"],
  ])(
    'detects quota errors written only to stderr from %s without exposing provider details',
    async (_label, source) => {
      const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
      const command = await writeExecutable(join(directory, 'fake-kilo'), source);

      try {
        const result = await runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' });
        expect(result).toEqual({
          error: 'Kilo provider quota or rate limit returned HTTP 429',
          exhaustSource: true,
          status: 429,
        });
        expect(JSON.stringify(result)).not.toContain('private provider body');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it('does not accept success-shaped stdout when stderr reports a structured quota error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `process.stdout.write([
  JSON.stringify({ type: 'text', part: { text: 'apparently successful response' } }),
  JSON.stringify({ type: 'step_finish', part: { reason: 'stop' } }),
].join('\\n') + '\\n');
process.stderr.write(JSON.stringify({ type: 'error', error: { status: 429 } }) + '\\n');
process.exitCode = 0;`
    );

    try {
      const result = await runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' });
      expect(result).toEqual({
        error: 'Kilo provider quota or rate limit returned HTTP 429',
        exhaustSource: true,
        status: 429,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves a legacy stderr quota signal alongside a different structured status', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const event = JSON.stringify({ type: 'error', error: { status: 400 } });
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `process.stdout.write(${JSON.stringify(`${event}\n`)});
process.stderr.write('Free model usage limit reached (HTTP 429)');
process.exitCode = 1;`
    );

    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
        error: 'Kilo provider quota or rate limit was reached',
        exhaustSource: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves a Kilo quota response when the child closes stdin', async () => {
    const spawnImpl = () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = () => {
        child.stdout.emit(
          'data',
          Buffer.from(
            `${JSON.stringify({ type: 'error', error: { status: 429, message: 'private provider details' } })}\n`
          )
        );
        child.stdin.emit('error', Object.assign(new Error('prompt pipe closed'), { code: 'EPIPE' }));
        child.emit('close', 1, null);
      };
      return child;
    };

    const result = await runKiloCompletion({
      command: '/unused/kilo',
      model: 'model:free',
      prompt: 'prompt',
      spawnImpl,
    });

    expect(result).toEqual({
      error: 'Kilo provider quota or rate limit returned HTTP 429',
      exhaustSource: true,
      status: 429,
    });
    expect(JSON.stringify(result)).not.toContain('private provider details');
  });

  it.each([
    ['error.code underscore', { type: 'error', error: { code: 'content_filter_blocked' } }],
    ['error.code hyphen', { type: 'error', error: { code: 'content-filter-blocked' } }],
    ['error.code dotted', { type: 'error', error: { code: 'content.filter.blocked' } }],
    ['error.code uppercase', { type: 'error', error: { code: 'CONTENT_FILTER_BLOCKED' } }],
    ['error.code padded', { type: 'error', error: { code: '  content_filter_blocked  ' } }],
    ['error.code versioned', { type: 'error', error: { code: 'content_filter_blocked_v2' } }],
    ['error.code versioned base', { type: 'error', error: { code: 'content_filter_v1' } }],
    ['error.code content policy', { type: 'error', error: { code: 'content_policy' } }],
    ['error.code refusal', { type: 'error', error: { code: 'refusal' } }],
    ['error.type', { type: 'error', error: { code: 'request_failed', type: 'content_filter_blocked' } }],
    [
      'error.type uppercase and hyphenated',
      { type: 'error', error: { code: 'request_failed', type: ' CONTENT-FILTER-BLOCKED ' } },
    ],
    [
      'error.type dotted and versioned',
      { type: 'error', error: { code: 'request_failed', type: 'content.policy.violation.v3' } },
    ],
    ['event.code', { type: 'error', code: 'content_filter_blocked', error: { code: 'request_failed' } }],
    [
      'event.code uppercase and hyphenated',
      { type: 'error', code: ' CONTENT-FILTER-BLOCKED ', error: { code: 'request_failed' } },
    ],
    [
      'event.code dotted and versioned',
      { type: 'error', code: 'content.filter.violation.v2', error: { code: 'request_failed' } },
    ],
  ])('stops fallback when Kilo reports an explicit policy code in %s', async (_source, sourceEvent) => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const event = {
      ...sourceEvent,
      error: { ...sourceEvent.error, message: 'private provider body' },
    };
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `console.log(JSON.stringify(${JSON.stringify(event)}));
process.exitCode = 1;`
    );

    try {
      const result = await runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' });
      expect(result).toEqual({
        error: 'Kilo provider content policy rejected or filtered this request',
        contentPolicyRejected: true,
      });
      expect(JSON.stringify(result)).not.toContain('private provider body');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('stops fallback for a policy message in a Kilo stdout error event', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `console.log(JSON.stringify({ type: 'error', error: { code: 'request_failed', message: 'Prompt was rejected by the content filter: private provider body' } }));
process.exitCode = 1;`
    );

    try {
      const result = await runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' });
      expect(result).toEqual({
        error: 'Kilo provider content policy rejected or filtered this request',
        contentPolicyRejected: true,
      });
      expect(JSON.stringify(result)).not.toContain('private provider body');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['message', "console.error('Prompt was rejected by the content filter: private provider body');"],
    [
      'structured JSONL error',
      "console.error(JSON.stringify({ type: 'error', error: { code: 'content_filter_blocked', message: 'private provider body' } }));",
    ],
    [
      'structured JSONL terminal',
      "console.error(JSON.stringify({ type: 'step_finish', part: { reason: 'content-filter' } }));",
    ],
  ])('stops fallback for an explicit content-policy rejection written only to stderr (%s)', async (_kind, output) => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(join(directory, 'fake-kilo'), `${output}\nprocess.exitCode = 1;`);

    try {
      const result = await runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' });
      expect(result).toEqual({
        error: 'Kilo provider content policy rejected or filtered this request',
        contentPolicyRejected: true,
      });
      expect(JSON.stringify(result)).not.toContain('private provider body');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('honors a stderr policy rejection alongside valid stdout JSONL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `console.log(JSON.stringify({ type: 'error', error: { code: 'request_failed', message: 'provider request failed' } }));
console.error('Prompt was rejected by the content filter: private provider body');
process.exitCode = 1;`
    );

    try {
      const result = await runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' });
      expect(result).toEqual({
        error: 'Kilo provider content policy rejected or filtered this request',
        contentPolicyRejected: true,
      });
      expect(JSON.stringify(result)).not.toContain('private provider body');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves an explicit stdout policy rejection before a malformed JSONL line', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `console.log(JSON.stringify({ type: 'error', error: { code: 'content_filter_blocked' } }));
console.log('{malformed json');
process.exitCode = 1;`
    );

    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
        error: 'Kilo provider content policy rejected or filtered this request',
        contentPolicyRejected: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('recognizes an explicit content-policy code delivered as an error string', async () => {
    const spawnImpl = () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = () => {
        child.stdout.emit(
          'data',
          Buffer.from(`${JSON.stringify({ type: 'error', error: 'content_filter_blocked' })}\n`)
        );
        setImmediate(() => child.emit('close', 1, null));
      };
      child.kill = (signal) => setImmediate(() => child.emit('close', null, signal));
      return child;
    };

    await expect(
      runKiloCompletion({ command: '/unused/kilo', model: 'model:free', prompt: 'prompt', spawnImpl })
    ).resolves.toEqual({
      error: 'Kilo provider content policy rejected or filtered this request',
      contentPolicyRejected: true,
    });
  });

  it.each([
    ['a clean CLI exit', { inputError: false, hang: false }],
    ['a stdin error and timeout after the terminal event', { inputError: true, hang: true }],
    ['output overflow after the terminal event', { inputError: false, hang: false, overflow: true }],
    ['an underscore content-filter terminal', { inputError: false, hang: false, reason: 'content_filter' }],
  ])('fails closed for a Kilo content-filter terminal after %s', async (_scenario, options) => {
    const childPid = 4242;
    const terminateWindowsProcessTreeImpl = vi.fn().mockResolvedValue(undefined);
    const spawnImpl = () => {
      const child = new EventEmitter();
      child.pid = childPid;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = () => {
        const terminal = Buffer.from(
          `${JSON.stringify({ type: 'step_finish', part: { reason: options.reason ?? 'content-filter' } })}\n`
        );
        const overflow = options.overflow ? Buffer.alloc(MAX_KILO_OUTPUT_BYTES, 'x') : Buffer.alloc(0);
        child.stdout.emit('data', Buffer.concat([terminal, overflow]));
        if (options.inputError) child.stdin.emit('error', new Error('prompt pipe closed'));
        if (!options.hang && !options.overflow) setImmediate(() => child.emit('close', 0, null));
      };
      child.kill = (signal) => setImmediate(() => child.emit('close', null, signal));
      return child;
    };

    await expect(
      runKiloCompletion({
        command: '/unused/kilo',
        model: 'model:free',
        prompt: 'prompt',
        timeoutMs: options.hang ? 20 : 1000,
        platform: 'win32',
        terminateWindowsProcessTreeImpl,
        spawnImpl,
      })
    ).resolves.toEqual({
      error: 'Kilo provider content policy rejected or filtered this request',
      contentPolicyRejected: true,
    });
    expect(terminateWindowsProcessTreeImpl).toHaveBeenCalledTimes(options.hang || options.overflow ? 1 : 0);
    if (options.hang || options.overflow) {
      expect(terminateWindowsProcessTreeImpl).toHaveBeenCalledWith(childPid);
    }
  });

  it('prioritizes a policy rejection over a tool-activity error', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `console.log(JSON.stringify({ type: 'tool_use', part: { type: 'tool' } }));
console.log(JSON.stringify({ type: 'error', error: { code: 'content_filter_blocked', message: 'private provider body' } }));
process.exitCode = 1;`
    );

    try {
      const result = await runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' });
      expect(result).toEqual({
        error: 'Kilo provider content policy rejected or filtered this request',
        contentPolicyRejected: true,
      });
      expect(JSON.stringify(result)).not.toContain('private provider body');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not mistake generic content wording for a Kilo content-policy rejection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const messages = [
      'Could not serialize content field for provider request',
      'Prompt was rejected due to rate limit exceeded',
      'Flagged as potentially violating quota limits',
      'Free model usage limit reached (usage policy)',
      'Content filtering is enabled',
      'Safety filter configuration is unavailable',
    ];
    const events = [
      ...messages.map((message) => ({ type: 'error', error: { code: 'request_failed', message } })),
      { type: 'error', error: { code: 'safety_warning', message: 'Provider emitted an advisory warning' } },
      { type: 'error', error: { code: 'content_filtering', message: 'Filter configuration is unavailable' } },
    ];
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      [
        ...events.map((event) => `console.log(JSON.stringify(${JSON.stringify(event)}));`),
        "console.error('Could not read content metadata from the provider response');",
        'process.exitCode = 1;',
      ].join('\n')
    );

    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt' })).resolves.toEqual({
        error: 'Kilo CLI reported a provider or completion error',
        exhaustSource: false,
        status: null,
        modelAttributable: false,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  // These cases use real Node child processes; leave startup headroom for a contended Vitest worker.
  it.each([
    [
      'provider error event',
      `console.log(JSON.stringify({ type: 'error', error: { code: 'request_failed' }, cost: 0.001 }));\nprocess.exitCode = 1;`,
    ],
    [
      'malformed JSONL after a cost event',
      `console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0.001 } }));\nconsole.log('{malformed json');`,
    ],
    [
      'output overflow after a cost event',
      `console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0.001 } }));\nprocess.stdout.write('x'.repeat(2 * 1024 * 1024));`,
    ],
    [
      'conflicting top-level and part costs',
      `console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0 }, cost: 0.001 }));`,
    ],
    [
      'cost nested in a provider error object',
      `console.log(JSON.stringify({ type: 'error', error: { code: 'request_failed', cost: 0.001 } }));`,
    ],
    [
      'cost reported on stderr',
      `console.error(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0.001 } }));`,
    ],
    [
      'buffered invalid cost before timeout',
      `console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: false } }));\nsetInterval(() => {}, 1000);`,
      2000,
    ],
  ])(
    'rejects every reported invalid Kilo cost before process failure handling: %s',
    async (_scenario, source, timeoutMs = 5000) => {
      const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
      const command = await writeExecutable(join(directory, 'fake-kilo'), source);

      try {
        await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt', timeoutMs })).resolves.toEqual(
          {
            error: 'Kilo reported non-zero or invalid completion cost',
            exhaustSource: true,
            safetyStop: true,
            reportedCost: true,
          }
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it('rejects a buffered invalid cost before returning a timeout error', async () => {
    const terminatedPids = [];
    const spawnImpl = () => {
      const child = new EventEmitter();
      child.pid = 4242;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = () => {
        child.stdout.emit(
          'data',
          Buffer.from(`${JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: false } })}\n`)
        );
      };
      return child;
    };

    await expect(
      runKiloCompletion({
        command: process.execPath,
        model: 'model:free',
        prompt: 'prompt',
        timeoutMs: 25,
        platform: 'win32',
        spawnImpl,
        terminateWindowsProcessTreeImpl: async (pid) => terminatedPids.push(pid),
      })
    ).resolves.toEqual({
      error: 'Kilo reported non-zero or invalid completion cost',
      exhaustSource: true,
      safetyStop: true,
      reportedCost: true,
    });
    expect(terminatedPids).toEqual([4242]);
  });

  it('aborts a stalled request at its configured inference timeout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-completion-'));
    const command = await writeExecutable(join(directory, 'fake-kilo'), 'setInterval(() => {}, 1000);');

    try {
      await expect(
        runKiloCompletion({ command, model: 'model:free', prompt: 'prompt', timeoutMs: 20 })
      ).resolves.toEqual({ error: 'Kilo completion exceeded 20 ms' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  async function expectProcessTreeKilled(trigger) {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-process-tree-'));
    const pidFile = join(directory, 'descendant.pid');
    const sentinel = join(directory, 'descendant-survived');
    const timeoutMs = trigger === 'timeout' ? 2_000 : 10_000;
    const descendantScript = `process.on('SIGTERM', () => {}); setTimeout(() => { require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'alive'); process.exit(0); }, 5000);`;
    const output = trigger === 'output overflow' ? "process.stdout.write('x'.repeat(1024 * 1024 + 1));" : '';
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `const { spawn } = require('node:child_process');
const fs = require('node:fs');
const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: 'ignore' });
fs.writeFileSync(${JSON.stringify(pidFile)}, String(descendant.pid));
${output}
setInterval(() => {}, 1000);`
    );
    try {
      await expect(runKiloCompletion({ command, model: 'model:free', prompt: 'prompt', timeoutMs })).resolves.toEqual({
        error:
          trigger === 'timeout'
            ? `Kilo completion exceeded ${timeoutMs} ms`
            : `Kilo CLI output exceeded ${MAX_KILO_OUTPUT_BYTES} bytes`,
      });
      expect(Number(await readFile(pidFile, 'utf8'))).toBeGreaterThan(0);
      await new Promise((resolve) => setTimeout(resolve, 5500));
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  it('kills the Kilo process tree after a timeout', async () => {
    await expectProcessTreeKilled('timeout');
  }, 15_000);

  // Give the real child and its descendant time to start under parallel suite load; the short timeout path is covered above.
  it('kills the Kilo process tree when output overflows', async () => {
    await expectProcessTreeKilled('output overflow');
  }, 20_000);
  it('reports Windows tree-termination failure when the child closes before termination finishes', async () => {
    let child;
    const terminateWindowsProcessTreeImpl = vi.fn(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => {
            child.exitCode = null;
            child.signalCode = 'SIGTERM';
            child.emit('close', null, 'SIGTERM');
          }, 0);
          setTimeout(() => reject(new Error('taskkill failed')), 10);
        })
    );
    const spawnImpl = () => {
      child = new EventEmitter();
      child.pid = 4242;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = () => setImmediate(() => child.stdout.emit('data', Buffer.alloc(MAX_KILO_OUTPUT_BYTES + 1)));
      child.kill = vi.fn();
      return child;
    };

    await expect(
      runKiloCompletion({
        command: '/unused/kilo',
        model: 'model:free',
        prompt: 'prompt',
        timeoutMs: 1000,
        platform: 'win32',
        terminateWindowsProcessTreeImpl,
        spawnImpl,
      })
    ).resolves.toEqual({ error: 'Kilo process-tree termination failed', exhaustSource: true, safetyStop: true });
    expect(terminateWindowsProcessTreeImpl).toHaveBeenCalledWith(4242);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it.each([
    [
      'reported cost',
      { type: 'step_finish', part: { reason: 'stop', cost: 0.01 } },
      { reportedCost: true, safetyStop: true },
    ],
    [
      'content-policy rejection',
      { type: 'error', error: { type: 'content_filter', message: 'Blocked by policy' } },
      { contentPolicyRejected: true },
    ],
  ])('preserves buffered Kilo %s when Windows tree termination times out', async (_label, event, expected) => {
    let child;
    const spawnImpl = () => {
      child = new EventEmitter();
      child.pid = 4242;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = () => {
        child.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
        child.stdout.emit('data', Buffer.alloc(2 * MAX_KILO_OUTPUT_BYTES));
      };
      child.kill = vi.fn();
      return child;
    };
    const terminateWindowsProcessTreeImpl = vi.fn(() => Promise.reject(new Error('taskkill failed')));

    const result = await runKiloCompletion({
      command: '/unused/kilo',
      model: 'model:free',
      prompt: 'prompt',
      timeoutMs: 10_000,
      platform: 'win32',
      terminateWindowsProcessTreeImpl,
      spawnImpl,
    });

    expect(result).toMatchObject({ error: 'Kilo process-tree termination failed', ...expected });
    if (!expected.safetyStop) expect(result.safetyStop).toBeUndefined();
    expect(terminateWindowsProcessTreeImpl).toHaveBeenCalledWith(4242);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it.each([
    [
      'reported cost',
      { type: 'step_finish', part: { reason: 'stop', cost: 0.01 } },
      { reportedCost: true, safetyStop: true },
    ],
    [
      'content-policy rejection',
      { type: 'error', error: { type: 'content_filter', message: 'Blocked by policy' } },
      { contentPolicyRejected: true },
    ],
  ])('preserves buffered Kilo %s when direct child termination emits error', async (_label, event, expected) => {
    let child;
    const spawnImpl = () => {
      child = new EventEmitter();
      child.pid = 4242;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = () => {
        child.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
        child.stdout.emit('data', Buffer.alloc(2 * MAX_KILO_OUTPUT_BYTES));
      };
      child.kill = vi.fn(() => {
        queueMicrotask(() => child.emit('error', new Error('simulated direct child kill failure')));
        return false;
      });
      return child;
    };
    const terminateWindowsProcessTreeImpl = vi.fn(() => Promise.reject(new Error('taskkill failed')));

    const result = await runKiloCompletion({
      command: '/unused/kilo',
      model: 'model:free',
      prompt: 'prompt',
      timeoutMs: 10_000,
      platform: 'win32',
      terminateWindowsProcessTreeImpl,
      spawnImpl,
    });

    expect(result).toMatchObject({ error: 'Kilo process-tree termination failed', ...expected });
    if (!expected.safetyStop) expect(result.safetyStop).toBeUndefined();
    expect(terminateWindowsProcessTreeImpl).toHaveBeenCalledWith(4242);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it.each([
    [
      'reported cost',
      { type: 'step_finish', part: { reason: 'stop', cost: 0.01 } },
      { error: 'Kilo reported non-zero or invalid completion cost', reportedCost: true, safetyStop: true },
    ],
    [
      'content-policy rejection',
      { type: 'error', error: { type: 'content_filter', message: 'Blocked by policy' } },
      { error: 'Kilo provider content policy rejected or filtered this request', contentPolicyRejected: true },
    ],
  ])('preserves buffered Kilo %s when direct child error is followed by close', async (_label, event, expected) => {
    let child;
    const spawnImpl = () => {
      child = new EventEmitter();
      child.pid = 4242;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = new EventEmitter();
      child.stdin.end = () => {
        child.stdout.emit('data', Buffer.from(JSON.stringify(event) + '\n'));
        child.stdout.emit('data', Buffer.alloc(2 * MAX_KILO_OUTPUT_BYTES));
      };
      child.kill = vi.fn(() => {
        queueMicrotask(() => {
          child.emit('error', new Error('simulated direct child kill failure'));
          child.emit('close', null, 'SIGKILL');
        });
        return false;
      });
      return child;
    };
    const terminateWindowsProcessTreeImpl = vi.fn(() => Promise.reject(new Error('taskkill failed')));

    const result = await runKiloCompletion({
      command: '/unused/kilo',
      model: 'model:free',
      prompt: 'prompt',
      timeoutMs: 10_000,
      platform: 'win32',
      terminateWindowsProcessTreeImpl,
      spawnImpl,
    });

    expect(result).toMatchObject(expected);
    expect(terminateWindowsProcessTreeImpl).toHaveBeenCalledWith(4242);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it.skipIf(process.platform !== 'win32')(
    'terminates descendants of a stalled Windows CLI shim',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-process-tree-'));
      const pidPath = join(directory, 'processes.json');
      const command = await writeExecutable(
        join(directory, 'fake-kilo'),
        `const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore', windowsHide: true });
writeFileSync(${JSON.stringify(pidPath)}, JSON.stringify({ parent: process.pid, descendant: child.pid }));
setInterval(() => {}, 1000);`
      );

      let processIds = [];
      try {
        await expect(
          runKiloCompletion({ command, model: 'model:free', prompt: 'prompt', timeoutMs: 2_000 })
        ).resolves.toEqual({ error: 'Kilo completion exceeded 2000 ms' });
        const recordedPids = JSON.parse(await readFile(pidPath, 'utf8'));
        processIds = [Number(recordedPids.parent), Number(recordedPids.descendant)];
        expect(processIds.every((pid) => Number.isSafeInteger(pid) && pid > 0)).toBe(true);

        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const alive = processIds.filter((pid) => {
            try {
              process.kill(pid, 0);
              return true;
            } catch (error) {
              if (error.code === 'ESRCH') return false;
              throw error;
            }
          });
          if (alive.length === 0) return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`Kilo process-tree PIDs ${processIds.join(', ')} remained alive after timeout`);
      } finally {
        if (processIds.length === 0) {
          try {
            const recordedPids = JSON.parse(await readFile(pidPath, 'utf8'));
            processIds = [Number(recordedPids.descendant), Number(recordedPids.parent)];
          } catch {}
        }
        for (const pid of processIds) {
          if (Number.isSafeInteger(pid) && pid > 0)
            spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
        }
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
    30_000
  );

  it('rejects invalid token and timeout values before starting the Kilo CLI', async () => {
    const model = 'nvidia/nemotron-3-ultra-550b-a55b:free';
    for (const maxTokens of [null, '4096', 1.5, 65_537]) {
      const spawnImpl = vi.fn();
      await expect(
        runKiloCompletion({ command: '/fake-kilo', model, prompt: 'prompt', maxTokens, spawnImpl })
      ).resolves.toEqual({ error: 'Invalid token limit' });
      expect(spawnImpl).not.toHaveBeenCalled();
    }

    for (const timeoutMs of [null, '1000', 0, 12 * 60 * 1000 + 1]) {
      const spawnImpl = vi.fn();
      await expect(
        runKiloCompletion({ command: '/fake-kilo', model, prompt: 'prompt', timeoutMs, spawnImpl })
      ).resolves.toEqual({ error: 'Invalid completion timeout' });
      expect(spawnImpl).not.toHaveBeenCalled();
    }
  });

  it('blocks noncanonical Nemotron variants before starting the Kilo CLI', async () => {
    const spawnImpl = vi.fn();
    await expect(
      runKiloCompletion({
        command: '/fake-kilo',
        model: 'nvidia/nemotron-3-ultra-550b-a55b-v2:free',
        prompt: 'private prompt',
        spawnImpl,
      })
    ).resolves.toEqual({ error: 'Nemotron model ID is not approved by free-model policy' });
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('uses the Nemotron reasoning variant and enforces its minimum output-token instruction', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kilo-cli-nemotron-'));
    const model = 'nvidia/nemotron-3-ultra-550b-a55b:free';
    const command = await writeExecutable(
      join(directory, 'fake-kilo'),
      `const fs = require('node:fs');
const args = process.argv.slice(2);
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
const message = fs.readFileSync(0, 'utf8');
if (!args.includes('--pure') || valueAfter('--model') !== 'kilo/${model}') process.exit(4);
if (valueAfter('--agent') !== 'free-completion') process.exit(5);
if (valueAfter('--variant') !== 'high') process.exit(6);
if (!message.startsWith('Answer the provided request directly, in plain text, using at most 4096 output tokens.')) process.exit(7);
console.log(JSON.stringify({ type: 'text', part: { text: 'approved response' } }));
console.log(JSON.stringify({ type: 'step_finish', part: { reason: 'stop', cost: 0, tokens: { input: 8, output: 2 } } }));`
    );

    try {
      await expect(runKiloCompletion({ command, model, prompt: 'bounded request', maxTokens: 1200 })).resolves.toEqual({
        model,
        content: 'approved response',
        finishReason: 'stop',
        usage: { input_tokens: 8, output_tokens: 2, cost: 0 },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
