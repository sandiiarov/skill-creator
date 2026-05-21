import ky from 'ky';
import { collectOpenApiParams } from './params.js';
import type { CommandDef } from '../core/types.js';

export type ExecuteOpenApiOptions = {
  baseUrl: string;
  authHeaders?: Array<[string, string]>;
  stdinBody?: unknown;
};

export async function executeOpenApi(
  command: CommandDef,
  values: Record<string, unknown>,
  options: ExecuteOpenApiOptions,
): Promise<{ status: number; ok: boolean; text: string; contentType: string }> {
  const collected = collectOpenApiParams(command, values, {
    stdinBody: options.stdinBody,
  });
  const url = buildUrl(options.baseUrl, collected.path, collected.queryParams);
  const method = (command.method ?? 'get').toUpperCase();
  const headers: Record<string, string> = {
    ...Object.fromEntries(options.authHeaders ?? []),
    ...collected.headers,
  };

  const body =
    method !== 'GET' && collected.body !== null ? JSON.stringify(collected.body) : undefined;
  if (body !== undefined) headers['Content-Type'] ??= 'application/json';

  const response = await ky(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
    throwHttpErrors: false,
  });
  return {
    status: response.status,
    ok: response.ok,
    text: await response.text(),
    contentType: response.headers.get('content-type') ?? '',
  };
}

function buildUrl(baseUrl: string, path: string, queryParams: Record<string, unknown>): string {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}${path}`);
  for (const [key, value] of Object.entries(queryParams)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}
