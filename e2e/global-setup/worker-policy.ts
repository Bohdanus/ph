export function playwrightWorkerCount(isCi: boolean, platform: NodeJS.Platform): number | undefined {
  return isCi && platform !== 'win32' ? undefined : 1;
}
