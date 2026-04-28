import { Buffer } from 'node:buffer';
import { hashCacheKey, hashCacheKeySync } from '@agent-evals/sdk';
import { describe, expect, test } from 'vitest';

async function cacheHash(
  key: unknown,
  options: { serializeFileBytes?: boolean } = {},
): Promise<string> {
  return await hashCacheKey(
    { namespace: 'cache-key-test', codeFingerprint: 'source-fingerprint', key },
    options,
  );
}

function cacheHashSync(key: unknown): string {
  return hashCacheKeySync({
    namespace: 'cache-key-test',
    codeFingerprint: 'source-fingerprint',
    key,
  });
}

describe('cache key hashing', () => {
  test('serializes Buffer and typed array keys by byte contents', async () => {
    const first = await cacheHash({ payload: Buffer.from('same bytes') });
    const second = await cacheHash({ payload: Buffer.from('same bytes') });
    const different = await cacheHash({
      payload: Buffer.from('different bytes'),
    });

    expect(first).toBe(second);
    expect(first).not.toBe(different);
    expect(first).toBe(cacheHashSync({ payload: Buffer.from('same bytes') }));
  });

  test('serializes ArrayBuffer and typed array views without expanding object fields', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const sameBytes = new Uint8Array([1, 2, 3, 4]);
    const differentBytes = new Uint8Array([1, 2, 3, 5]);

    const arrayBufferHash = await cacheHash({ payload: bytes.buffer });
    const sameArrayBufferHash = await cacheHash({ payload: sameBytes.buffer });
    const typedArrayHash = await cacheHash({ payload: bytes });
    const sameTypedArrayHash = await cacheHash({ payload: sameBytes });
    const differentTypedArrayHash = await cacheHash({
      payload: differentBytes,
    });

    expect(arrayBufferHash).toBe(sameArrayBufferHash);
    expect(typedArrayHash).toBe(sameTypedArrayHash);
    expect(typedArrayHash).not.toBe(differentTypedArrayHash);
  });

  test('serializes Blob and File keys by stable metadata by default', async () => {
    const firstFile = new File(['first'], 'receipt.txt', {
      lastModified: 1,
      type: 'text/plain',
    });
    const secondFile = new File(['other'], 'receipt.txt', {
      lastModified: 1,
      type: 'text/plain',
    });
    const renamedFile = new File(['first'], 'other.txt', {
      lastModified: 1,
      type: 'text/plain',
    });

    const firstFileHash = await cacheHash({ file: firstFile });
    const secondFileHash = await cacheHash({ file: secondFile });
    const renamedFileHash = await cacheHash({ file: renamedFile });
    const blobHash = await cacheHash({
      blob: new Blob(['abc'], { type: 'text/plain' }),
    });
    const sameBlobHash = await cacheHash({
      blob: new Blob(['abc'], { type: 'text/plain' }),
    });
    const differentBlobHash = await cacheHash({
      blob: new Blob(['xyz'], { type: 'text/plain' }),
    });

    expect(firstFileHash).toBe(secondFileHash);
    expect(firstFileHash).not.toBe(renamedFileHash);
    expect(blobHash).toBe(sameBlobHash);
    expect(blobHash).toBe(differentBlobHash);
    expect(firstFileHash).toBe(cacheHashSync({ file: firstFile }));
    expect(blobHash).toBe(
      cacheHashSync({ blob: new Blob(['abc'], { type: 'text/plain' }) }),
    );
  });

  test('serializes Blob and File bytes when opted in', async () => {
    const firstFile = new File(['first'], 'receipt.txt', {
      lastModified: 1,
      type: 'text/plain',
    });
    const secondFile = new File(['other'], 'receipt.txt', {
      lastModified: 1,
      type: 'text/plain',
    });

    const firstFileHash = await cacheHash(
      { file: firstFile },
      { serializeFileBytes: true },
    );
    const secondFileHash = await cacheHash(
      { file: secondFile },
      { serializeFileBytes: true },
    );
    const blobHash = await cacheHash(
      { blob: new Blob(['abc'], { type: 'text/plain' }) },
      { serializeFileBytes: true },
    );
    const sameBlobHash = await cacheHash(
      { blob: new Blob(['abc'], { type: 'text/plain' }) },
      { serializeFileBytes: true },
    );
    const differentBlobHash = await cacheHash(
      { blob: new Blob(['xyz'], { type: 'text/plain' }) },
      { serializeFileBytes: true },
    );

    expect(firstFileHash).not.toBe(secondFileHash);
    expect(blobHash).toBe(sameBlobHash);
    expect(blobHash).not.toBe(differentBlobHash);
  });
});
