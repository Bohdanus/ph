import { extname } from 'node:path';

export function resolveCommandShim(command, args) {
  const isScript = /\.(?:cmd|bat)$/i.test(command);
  const isBareCommand = !/[\\/]/u.test(command) && extname(command) === '';
  if (process.platform !== 'win32' || (!isScript && !isBareCommand)) {
    return { command, args, spawnOptions: {} };
  }
  if ([command, ...args].some((value) => /[&|<>^%!"]/u.test(value))) {
    throw new Error('Command arguments cannot be passed safely to a Windows command shim');
  }

  const commandLine = [`"${command}"`, ...args.map((arg) => `"${arg}"`)].join(' ');
  return {
    command: process.env.ComSpec || process.env.COMSPEC || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${commandLine}"`],
    spawnOptions: { windowsVerbatimArguments: true },
  };
}
