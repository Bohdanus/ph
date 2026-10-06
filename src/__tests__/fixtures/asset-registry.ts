import { vi } from 'vitest';
import { AssetRegistry } from '@/contexts/asset-registry.ts';
import type { BitmapSource } from '@/contexts/general-types.ts';

export const createMockBitmap = (
  width: number = 1,
  height: number = 1,
  closeFn: () => void = () => {}
): { bitmap: BitmapSource; close: ReturnType<typeof vi.fn> } => {
  const close = vi.fn(closeFn);
  const bitmap = { width, height, close } as unknown as BitmapSource;
  return { bitmap, close };
};

export const createAssetRegistry = (options?: ConstructorParameters<typeof AssetRegistry>[0]): AssetRegistry => {
  return new AssetRegistry(options);
};

export const createAssetRegistryWithBaseline = (
  documentId: string,
  bitmap: BitmapSource,
  ownership: 'adopt' | 'borrow' = 'adopt'
): { registry: AssetRegistry; assetId: string } => {
  const registry = new AssetRegistry();
  const assetId = registry.registerBaseline(documentId, bitmap, { ownership });
  return { registry, assetId };
};

export const createAssetRegistryWithBorrowed = (
  documentId: string,
  bitmap: BitmapSource
): { registry: AssetRegistry; assetId: string } => {
  const registry = new AssetRegistry();
  const assetId = registry.registerBorrowed(documentId, bitmap);
  return { registry, assetId };
};

export const createMaterializationRequest = (
  key: string,
  producer: () => Promise<BitmapSource> | BitmapSource,
  byteSize?: number,
  documentId?: string
) => ({
  key,
  producer,
  byteSize,
  documentId,
});

export const createDeferredPromise = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};
