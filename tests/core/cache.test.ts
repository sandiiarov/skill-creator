import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import * as cacache from 'cacache';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheKeyFor, loadCached, saveCache } from '../../src/core/cache.js';

describe('cacheKeyFor', () => {
  it('is deterministic and sensitive to meaningful config', () => {
    expect(cacheKeyFor({ url: 'https://example.com/a' })).toBe(
      cacheKeyFor({ url: 'https://example.com/a' }),
    );
    expect(cacheKeyFor({ url: 'https://example.com/a' })).not.toBe(
      cacheKeyFor({ url: 'https://example.com/b' }),
    );
  });

  it('ignores cache/list-only fields and sorts auth headers', () => {
    const a = cacheKeyFor({
      source: 'x',
      cacheTtl: 10,
      authHeaders: [
        ['b', '2'],
        ['a', '1'],
      ],
    });
    const b = cacheKeyFor({
      source: 'x',
      cacheTtl: 20,
      authHeaders: [
        ['a', '1'],
        ['b', '2'],
      ],
    });
    expect(a).toBe(b);
  });
});

describe('file cache', () => {
  it('round-trips JSON data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-creator-cache-'));
    await saveCache(dir, 'key', { a: 1 });
    await expect(loadCached(dir, 'key', 3600)).resolves.toEqual({ a: 1 });
  });

  it('returns null for missing, expired, and corrupt entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-creator-cache-'));
    await expect(loadCached(dir, 'missing', 3600)).resolves.toBeNull();

    await saveCache(dir, 'old', { a: 1 });
    await expect(loadCached(dir, 'old', 0)).resolves.toBeNull();

    await cacache.put(dir, 'bad', '{bad json');
    await expect(loadCached(dir, 'bad', 3600)).resolves.toBeNull();
  });
});
