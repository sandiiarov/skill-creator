import { readFile } from 'node:fs/promises';
import ky from 'ky';
import YAML from 'yaml';
import { cacheKeyFor, loadCached, saveCache } from '../core/cache.js';
import { resolveRefs } from './refs.js';

export type LoadOpenApiOptions = {
  authHeaders?: Array<[string, string]>;
  cacheDir?: string;
  cacheKey?: string;
  ttlSeconds?: number;
  refresh?: boolean;
};

export type OpenApiSpec = Record<string, unknown> & {
  paths: Record<string, unknown>;
};

export async function loadOpenApiSpec(
  source: string,
  options: LoadOpenApiOptions = {},
): Promise<OpenApiSpec> {
  const isUrl = source.startsWith('http://') || source.startsWith('https://');
  const ttlSeconds = options.ttlSeconds ?? 3600;
  const key = options.cacheKey ?? cacheKeyFor({ source, authHeaders: options.authHeaders ?? [] });

  if (isUrl && options.cacheDir !== undefined && !options.refresh) {
    const cached = await loadCached<OpenApiSpec>(options.cacheDir, key, ttlSeconds);
    if (cached !== null) return cached;
  }

  const raw = isUrl
    ? await fetchRemoteSpec(source, options.authHeaders ?? [])
    : await readFile(source, 'utf8');
  const parsed = parseSpec(raw);
  const spec = await resolveRefs(parsed);

  if (!isOpenApiSpec(spec)) {
    throw new Error("spec must contain 'paths'");
  }

  if (isUrl && options.cacheDir !== undefined) {
    await saveCache(options.cacheDir, key, spec);
  }

  return spec;
}

async function fetchRemoteSpec(
  source: string,
  authHeaders: Array<[string, string]>,
): Promise<string> {
  const response = await ky.get(source, {
    headers: Object.fromEntries(authHeaders),
    throwHttpErrors: false,
  });
  if (!response.ok) throw new Error(`failed to fetch spec: HTTP ${response.status}`);
  return response.text();
}

function parseSpec(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return YAML.parse(raw) as unknown;
  }
}

function isOpenApiSpec(value: unknown): value is OpenApiSpec {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'paths' in value &&
    typeof (value as { paths?: unknown }).paths === 'object'
  );
}
