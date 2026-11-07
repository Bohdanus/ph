import { existsSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';
const WINDOWS_SHELL_META_PATTERN = /[&|<>^%!\r\n"]/u;

function environmentValue(env, name) {
  const normalizedName = name.toUpperCase();
  const key = Object.keys(env)
    .sort()
    .find((candidate) => candidate.toUpperCase() === normalizedName);
  return key === undefined ? undefined : env[key];
}

function windowsExtensions(env) {
  const value = environmentValue(env, 'PATHEXT');
  return (value || DEFAULT_PATHEXT)
    .split(';')
    .map((extension) => {
      const normalized = extension.trim().toLowerCase();
      return normalized.startsWith('.') ? normalized : `.${normalized}`;
    })
    .filter((extension) => ['.com', '.exe', '.bat', '.cmd'].includes(extension));
}

function resolveWindowsCommand(command, env, cwd) {
  const windowsPath = path.win32;
  const hasPath = /[\\/]/u.test(command) || /^[a-z]:/iu.test(command);
  const extension = windowsPath.extname(command).toLowerCase();
  const searchPath = (environmentValue(env, 'PATH') || '')
    .split(';')
    .filter(Boolean)
    .map((directory) => windowsPath.resolve(cwd, directory));

  if (extension === '.cmd' || extension === '.bat') {
    if (hasPath) {
      const candidate = windowsPath.resolve(cwd, command);
      return existsSync(candidate)
        ? { kind: 'shim', path: candidate }
        : { kind: 'missing-shim', path: candidate, viaPath: false };
    }
    for (const directory of searchPath) {
      const candidate = windowsPath.join(directory, command);
      if (existsSync(candidate)) return { kind: 'shim', path: candidate };
    }
    return { kind: 'missing-shim', path: command, viaPath: true };
  }

  if (extension) {
    if (hasPath) return { kind: 'native', path: windowsPath.resolve(cwd, command) };
    for (const directory of searchPath) {
      const candidate = windowsPath.join(directory, command);
      if (existsSync(candidate)) return { kind: 'native', path: candidate };
    }
    return null;
  }

  const basePath = hasPath ? windowsPath.resolve(cwd, command) : null;
  const directories = hasPath ? [windowsPath.dirname(basePath)] : searchPath;
  const basename = hasPath ? windowsPath.basename(command) : command;
  for (const directory of directories) {
    for (const candidateExtension of windowsExtensions(env)) {
      const candidate = windowsPath.join(directory, `${basename}${candidateExtension}`);
      if (!existsSync(candidate)) continue;
      return {
        kind: candidateExtension === '.bat' || candidateExtension === '.cmd' ? 'shim' : 'native',
        path: candidate,
      };
    }
  }

  return hasPath ? { kind: 'native', path: basePath } : null;
}

function quoteWindowsShellArgument(argument) {
  const value = String(argument);
  const trailingBackslashes = value.match(/\\+$/u)?.[0].length ?? 0;
  if (trailingBackslashes > 0) {
    if (/[\s()]/u.test(value)) {
      throw new Error('A Windows command-shim argument with spaces cannot end in a backslash');
    }
    return value;
  }
  return value.length === 0 || /[\s()]/u.test(value) ? `"${value}"` : value;
}

export function resolveCommandShim(command, args, { env = process.env, cwd = process.cwd() } = {}) {
  if (process.platform !== 'win32') return { command, args, spawnOptions: {} };
  if (
    /\.(?:cmd|bat)$/iu.test(command) &&
    [command, ...args].some((value) => WINDOWS_SHELL_META_PATTERN.test(String(value)))
  ) {
    throw new Error('Command arguments cannot be passed safely to a Windows command shim');
  }

  const resolved = resolveWindowsCommand(command, env, cwd);
  if (!resolved) return { command, args, spawnOptions: {} };
  if (resolved.kind === 'native') return { command: resolved.path, args, spawnOptions: {} };
  if (resolved.kind === 'missing-shim') {
    throw new Error(
      resolved.viaPath
        ? `Windows command shim was not found in PATH: ${command}`
        : `Windows command shim was not found: ${resolved.path}`
    );
  }
  if ([resolved.path, ...args].some((value) => WINDOWS_SHELL_META_PATTERN.test(String(value)))) {
    throw new Error('Command arguments cannot be passed safely to a Windows command shim');
  }

  const commandLine = [resolved.path, ...args].map(quoteWindowsShellArgument).join(' ');
  return {
    command: environmentValue(env, 'ComSpec') || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${commandLine}"`],
    spawnOptions: { windowsVerbatimArguments: true },
  };
}
