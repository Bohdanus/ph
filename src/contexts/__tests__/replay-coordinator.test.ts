import { describe, expect, it, vi } from 'vitest';

import { ReplayCoordinator, type ReplayRevisionToken, replayTokensEqual } from '../replay-coordinator.ts';

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
    const resultA = 'result-a';
    const resultB = 'result-b';

    const requestA = coordinator.request({
      token: tokenA,
      materialize: () => materializationA.promise,
      publish: publishA,
      release: releaseA,
      isStillValid: () => true,
    });
    const requestB = coordinator.request({
      token: tokenB,
      materialize: () => materializationB.promise,
      publish: publishB,
      isStillValid: () => true,
    });

    materializationB.resolve(resultB);
    await expect(requestB).resolves.toMatchObject({ state: 'published', result: resultB });
    expect(publishB).toHaveBeenCalledOnce();
    expect(publishB).toHaveBeenCalledWith(resultB, tokenB);

    materializationA.resolve(resultA);
    await expect(requestA).resolves.toMatchObject({ state: 'cancelled' });

    expect(publishA).not.toHaveBeenCalled();
    expect(releaseA).toHaveBeenCalledOnce();
    expect(releaseA).toHaveBeenCalledWith(resultA);
  });

  it('cancels immediately when the input signal is already aborted before materialization starts', async () => {
    const controller = new AbortController();
    controller.abort();
    const coordinator = new ReplayCoordinator<string>();
    const publish = vi.fn();
    const release = vi.fn();

    const result = await coordinator.request({
      token: createToken(1),
      signal: controller.signal,
      materialize: () => Promise.resolve('value'),
      publish,
      release,
    });

    expect(result.state).toBe('cancelled');
    expect(publish).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('aborts mid-materialization when the input signal fires during pending resolution', async () => {
    const controller = new AbortController();
    const coordinator = new ReplayCoordinator<string>();
    const materialization = deferred<string>();
    const publish = vi.fn();
    const release = vi.fn();

    const requestPromise = coordinator.request({
      token: createToken(1),
      signal: controller.signal,
      materialize: () => materialization.promise,
      publish,
      release,
    });

    controller.abort();
    materialization.resolve('result');

    const result = await requestPromise;
    expect(result.state).toBe('cancelled');
    expect(publish).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith('result');
  });

  it('cancels mid-materialization when cancel() is called while materialization is pending', async () => {
    const coordinator = new ReplayCoordinator<string>();
    const materialization = deferred<string>();
    const publish = vi.fn();
    const release = vi.fn();

    const requestPromise = coordinator.request({
      token: createToken(1),
      materialize: () => materialization.promise,
      publish,
      release,
    });

    expect(coordinator.currentRequestId).toBe(1);
    coordinator.cancel();
    expect(coordinator.currentRequestId).toBe(0);

    materialization.resolve('result');

    const result = await requestPromise;
    expect(result.state).toBe('cancelled');
    expect(publish).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith('result');
  });

  it('rejects a result via the validity callback even when the token matches', async () => {
    const coordinator = new ReplayCoordinator<string>();
    const materialization = deferred<string>();
    const publish = vi.fn();
    const release = vi.fn();
    const token = createToken(1);

    let valid = true;
    const isStillValid = vi.fn((checkedToken: ReplayRevisionToken) => {
      expect(checkedToken).toEqual(token);
      return valid;
    });

    const requestPromise = coordinator.request({
      token,
      materialize: () => materialization.promise,
      publish,
      release,
      isStillValid,
    });

    // The live state has changed so the token is no longer fresh, but no
    // new request was issued (no cancellation signal).
    valid = false;
    materialization.resolve('result');

    const result = await requestPromise;
    expect(isStillValid).toHaveBeenCalled();
    expect(result.state).toBe('stale');
    expect(publish).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith('result');
  });

  it('proves that a copied token being equal is not enough to stay current', async () => {
    // A copied (snapshot) token has identical values to the request token.
    // The coordinator must still consult the validity callback against fresh
    // live state — token equality alone must not keep a request current.
    const coordinator = new ReplayCoordinator<string>();
    const publish = vi.fn();
    const release = vi.fn();
    const token = createToken(1);

    expect(replayTokensEqual(token, { ...token })).toBe(true);

    let liveValid = true;
    const isStillValid = vi.fn(() => liveValid);

    const requestPromise = coordinator.request({
      token: { ...token },
      materialize: () => Promise.resolve('result'),
      publish,
      release,
      isStillValid,
    });

    // Live state changed (e.g. a new edit committed). The copied token still
    // matches, but the validity callback must reject it.
    liveValid = false;

    const result = await requestPromise;
    expect(isStillValid).toHaveBeenCalled();
    expect(result.state).toBe('stale');
    expect(publish).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith('result');
  });

  it('transitions to failed when materialization throws before producing a result', async () => {
    const coordinator = new ReplayCoordinator<string>();
    const publish = vi.fn();
    const release = vi.fn();

    const result = await coordinator.request({
      token: createToken(1),
      materialize: () => Promise.reject(new Error('materialization failed')),
      publish,
      release,
    });

    expect(result.state).toBe('failed');
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error).toMatchObject({ message: 'materialization failed' });
    expect(publish).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('transitions to failed and releases the result when publication throws', async () => {
    const coordinator = new ReplayCoordinator<string>();
    const publish = vi.fn(() => {
      throw new Error('publish failed');
    });
    const release = vi.fn();

    const result = await coordinator.request({
      token: createToken(1),
      materialize: () => Promise.resolve('result'),
      publish,
      release,
      isStillValid: () => true,
    });

    expect(result.state).toBe('failed');
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error).toMatchObject({ message: 'publish failed' });
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith('result', createToken(1));
    // The result was never successfully published, so it must be released.
    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith('result');
  });

  it('does not release a result that was successfully published even if a later cancellation occurs', async () => {
    const coordinator = new ReplayCoordinator<string>();
    const materialization = deferred<string>();
    const publish = vi.fn();
    const release = vi.fn();
    const tokenA = createToken(1);
    const tokenB = createToken(2);

    const requestA = coordinator.request({
      token: tokenA,
      materialize: () => materialization.promise,
      publish,
      release,
    });

    const requestB = coordinator.request({
      token: tokenB,
      materialize: () => Promise.resolve('result-b'),
      publish,
      isStillValid: () => true,
    });

    await requestB;
    expect(publish).toHaveBeenLastCalledWith('result-b', tokenB);

    // After B published, A's result arrives but is stale.
    materialization.resolve('result-a');
    const outcomeA = await requestA;
    expect(outcomeA.state).toBe('cancelled');
    // A's result is released because it was not published.
    expect(release).toHaveBeenCalledWith('result-a');
    // B's published result is never released.
    expect(release).not.toHaveBeenCalledWith('result-b');
  });
});
