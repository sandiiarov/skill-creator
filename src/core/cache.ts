import * as cacache from 'cacache';
import { createHash } from 'node:crypto';

const CACHE_IGNORED_FIELDS = new Set([
  'cacheTtl',
  'cache_ttl',
  'description',
  'include',
  'exclude',
  'methods',
]);

export function cacheKeyFor(config: Record<string, unknown>): string {
  const normalized = normalizeConfig(config);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 16);
}

export async function loadCached<T = unknown>(
  cacheDir: string,
  key: string,
  ttlSeconds: number,
): Promise<T | null> {
  try {
    const info = await cacache.get.info(cacheDir, key);
    if (info === null) return null;

    const ageSeconds = (Date.now() - info.time) / 1000;
    if (ageSeconds >= ttlSeconds) return null;

    const entry = await cacache.get(cacheDir, key);
    return JSON.parse(entry.data.toString('utf8')) as T;
  } catch {
    return null;
  }
}

export async function saveCache(cacheDir: string, key: string, data: unknown): Promise<void> {
  await cacache.put(cacheDir, key, JSON.stringify(data));
}

function normalizeConfig(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (CACHE_IGNORED_FIELDS.has(key)) continue;
    if (key === 'authHeaders' || key === 'auth_headers') {
      output[key] = normalizeAuthHeaders(value);
    } else {
      output[key] = value;
    }
  }
  return Object.fromEntries(Object.entries(output).sort(([a], [b]) => a.localeCompare(b)));
}

function normalizeAuthHeaders(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return [...value].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
