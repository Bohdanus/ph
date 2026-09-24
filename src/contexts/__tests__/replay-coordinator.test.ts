import { describe, expect, it, vi } from 'vitest';

import { ReplayCoordinator, type ReplayRevisionToken } from '../replay-coordinator.ts';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createToken(cursor: number): ReplayRevisionToken {
  return {
    documentId: 'document-1',
    documentRevision: cursor,
    durableRevision: cursor,
    branchRevision: cursor,
    cursor,
    baselineAssetGeneration: cursor,
    operationSetRevision: cursor,
    sourceGeneration: cursor,
  };
}

describe('ReplayCoordinator', () => {
  it('does not publish a stale request, releases its result, and publishes the current request', async () => {
    const coordinator = new ReplayCoordinator<string>();
    const materializationA = deferred<string>();
    const materializationB = deferred<string>();
    const publishA = vi.fn();
    const releaseA = vi.fn();
    const publishB = vi.fn();
    const tokenA = createToken(1);
    const tokenB = createToken(2);

    const requestA = coordinator.request({
      token: tokenA,
      materialize: () => materializationA.promise,
      publish: publishA,
      release: releaseA,
    });
    const requestB = coordinator.request({
      token: tokenB,
      materialize: () => materializationB.promise,
      publish: publishB,
    });

    materializationB.resolve('result-b');
    await expect(requestB).resolves.toMatchObject({ state: 'published', result: 'result-b' });
    expect(publishB).toHaveBeenCalledOnce();
    expect(publishB).toHaveBeenCalledWith('result-b', tokenB);

    materializationA.resolve('result-a');
    await expect(requestA).resolves.toMatchObject({ state: 'cancelled' });
    expect(publishA).not.toHaveBeenCalled();
    expect(releaseA).toHaveBeenCalledOnce();
    expect(releaseA).toHaveBeenCalledWith('result-a');
  });
});
