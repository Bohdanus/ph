import { createServer } from 'node:net';

/** Ask the OS for a port nothing is listening on, then let it go. */
export function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('the OS returned no TCP port to use'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

/** Can this process still take the port? The check that shrinks the race window. */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

/**
 * A port that was still free a moment ago, checked as late as possible.
 *
 * The check cannot close the gap between this returning and Vite calling `bind`.
 * `reuseExistingServer: false` and `--strictPort` turn a lost race into a visible
 * startup failure instead of silently attaching to another checkout.
 */
export async function reservePort() {
  for (let attempt = 1; ; attempt += 1) {
    const port = await findFreePort();
    if (await isPortFree(port)) return { port, attempt };
    if (attempt >= 5) {
      throw new Error(
        'picked a free port five times in a row and lost it every time. Something on this machine is ' +
          'claiming ports as fast as they are released.'
      );
    }
  }
}

/**
 * The port this run uses, or `null` to leave `playwright.config.ts`'s own default.
 *
 * - `CI`: one job, one checkout, one runner, and the workflow documents :5173.
 * - `PLAYWRIGHT_PORT`: the caller chose, out loud. Still this run's own server;
 *   reuse is off, so a busy port fails rather than attaches.
 * - otherwise: pick one. This is the case that used to collide.
 */
export function resolvePort(env, ci) {
  if (ci) return { port: null, reason: 'CI runs one checkout on one runner' };
  if (env.PLAYWRIGHT_PORT) {
    return { port: null, reason: `PLAYWRIGHT_PORT=${env.PLAYWRIGHT_PORT} was chosen by the caller` };
  }
  return { port: 'allocate', reason: 'no port was chosen, so this run picks its own' };
}
