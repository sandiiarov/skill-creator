import { readFile } from 'node:fs/promises';
import { GraphQLFileLoader } from '@graphql-tools/graphql-file-loader';
import ky from 'ky';
import { JsonFileLoader } from '@graphql-tools/json-file-loader';
import { loadSchema } from '@graphql-tools/load';
import { UrlLoader } from '@graphql-tools/url-loader';
import {
  buildClientSchema,
  buildSchema,
  getIntrospectionQuery,
  introspectionFromSchema,
  type GraphQLSchema,
  type IntrospectionQuery,
} from 'graphql';
import { GraphQLClient } from 'graphql-request';
import { cacheKeyFor, loadCached, saveCache } from '../core/cache.js';

export type LoadGraphqlOptions = {
  authHeaders?: Array<[string, string]>;
  cacheDir?: string;
  cacheKey?: string;
  ttlSeconds?: number;
  refresh?: boolean;
  schemaSource?: string;
  onWarning?: (message: string) => void;
};

export async function loadGraphqlSchema(
  endpoint: string,
  options: LoadGraphqlOptions = {},
): Promise<GraphQLSchema> {
  const authHeaders = options.authHeaders ?? [];
  if (options.schemaSource !== undefined) {
    return loadProvidedGraphqlSchema(options.schemaSource, authHeaders);
  }

  const cacheKey = `graphql-${
    options.cacheKey ?? cacheKeyFor({ endpoint, authHeaders: options.authHeaders ?? [] })
  }`;
  const ttlSeconds = options.ttlSeconds ?? 3600;

  if (options.cacheDir !== undefined && !options.refresh) {
    const cached = await loadCached<IntrospectionQuery>(options.cacheDir, cacheKey, ttlSeconds);
    if (cached !== null) return buildClientSchema(cached);
  }

  try {
    const schema = await loadRemoteGraphqlSchema(endpoint, authHeaders);
    if (options.cacheDir !== undefined) {
      await saveCache(options.cacheDir, cacheKey, introspectionFromSchema(schema));
    }
    return schema;
  } catch (error) {
    if (options.cacheDir !== undefined) {
      const stale = await loadCached<IntrospectionQuery>(
        options.cacheDir,
        cacheKey,
        Number.POSITIVE_INFINITY,
      );
      if (stale !== null) {
        options.onWarning?.(
          `Warning: using stale cached GraphQL schema because introspection failed: ${formatError(error)}`,
        );
        return buildClientSchema(stale);
      }
    }

    throw new Error(
      `GraphQL introspection is disabled or unavailable. Provide a schema with --graphql-schema ./schema.graphql or --graphql-schema ./introspection.json. (${formatError(error)})`,
    );
  }
}

async function loadRemoteGraphqlSchema(
  endpoint: string,
  authHeaders: Array<[string, string]>,
): Promise<GraphQLSchema> {
  const client = new GraphQLClient(endpoint, {
    headers: Object.fromEntries(authHeaders),
  });
  const introspection = await client.request<IntrospectionQuery>(getIntrospectionQuery());
  return buildClientSchema(introspection);
}

async function loadProvidedGraphqlSchema(
  source: string,
  authHeaders: Array<[string, string]>,
): Promise<GraphQLSchema> {
  try {
    const schema = await loadSchema(source, {
      loaders: [new UrlLoader(), new GraphQLFileLoader(), new JsonFileLoader()],
      headers: Object.fromEntries(authHeaders),
    });
    return buildClientSchema(introspectionFromSchema(schema));
  } catch {
    return loadProvidedGraphqlSchemaFallback(source, authHeaders);
  }
}

async function loadProvidedGraphqlSchemaFallback(
  source: string,
  authHeaders: Array<[string, string]>,
): Promise<GraphQLSchema> {
  const text = await readSchemaSource(source, authHeaders);
  const trimmed = text.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown;
    return buildClientSchema(extractIntrospection(parsed));
  }

  return buildSchema(text);
}

async function readSchemaSource(
  source: string,
  authHeaders: Array<[string, string]>,
): Promise<string> {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const response = await ky.get(source, {
      headers: Object.fromEntries(authHeaders),
      throwHttpErrors: false,
    });
    if (!response.ok) throw new Error(`failed to fetch GraphQL schema: HTTP ${response.status}`);
    return response.text();
  }
  return readFile(source, 'utf8');
}

function extractIntrospection(value: unknown): IntrospectionQuery {
  if (!isRecord(value)) throw new Error('GraphQL schema JSON must be an object');

  if (isRecord(value.data)) return extractIntrospection(value.data);
  if (isRecord(value.__schema)) return value as unknown as IntrospectionQuery;

  throw new Error('GraphQL schema JSON must contain an introspection __schema object');
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
