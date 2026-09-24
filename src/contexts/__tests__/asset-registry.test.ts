import { describe, expect, it, vi } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';

function createOwnedBitmap(width = 1, height = 1) {
  const close = vi.fn();
  const bitmap = { width, height, close } as unknown as ImageBitmap;
  return { bitmap, close };
}

describe('AssetRegistry', () => {
  it('does not double-close an adopted ImageBitmap registered by multiple documents', () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = createOwnedBitmap(10, 10);

    const firstId = registry.registerBaseline('document-a', bitmap, { ownership: 'adopt' });
    const secondId = registry.registerBaseline('document-b', bitmap, { ownership: 'adopt' });

    expect(secondId).toBe(firstId);

    registry.disposeDocument('document-a');
    expect(close).not.toHaveBeenCalled();

    registry.disposeDocument('document-b');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('waits for an active baseline lease before disposing its bitmap', async () => {
    const registry = new AssetRegistry();
    const { bitmap, close } = createOwnedBitmap(10, 10);
    const assetId = registry.registerBaseline('document-a', bitmap, { ownership: 'adopt' });
    const lease = await registry.resolve(assetId);

    registry.disposeDocument('document-a');
    expect(close).not.toHaveBeenCalled();

    lease.release();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('never closes a borrowed canvas when its baseline is disposed', () => {
    const registry = new AssetRegistry();
    const canvas = document.createElement('canvas');
    const close = vi.fn();
    Object.defineProperty(canvas, 'close', { value: close });
    const assetId = registry.registerBorrowed('document-a', canvas);

    registry.disposeDocument('document-a');

    expect(close).not.toHaveBeenCalled();
    expect(registry.getRecord(assetId)).toBeUndefined();
  });

  it('evicts released materializations and closes owned bitmaps under a byte budget', async () => {
    const registry = new AssetRegistry({ maxCacheBytes: 4 });
    const first = createOwnedBitmap();
    const second = createOwnedBitmap();

    const firstLease = await registry.materialize({
      key: 'first',
      producer: () => first.bitmap,
      byteSize: 4,
    });
    firstLease.release();

    const secondLease = await registry.materialize({
      key: 'second',
      producer: () => second.bitmap,
      byteSize: 4,
    });

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();

    secondLease.release();
  });
});
