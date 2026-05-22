import type { CommandDef } from '../core/types.js';

import { coerceAndValidateValue } from '../core/coerce.js';

export type CollectedOpenApiParams = {
  path: string;
  queryParams: Record<string, unknown>;
  headers: Record<string, string>;
  body: Record<string, unknown> | unknown[] | string | number | boolean | null;
  files: Record<string, unknown> | null;
};

export type CollectOpenApiOptions = {
  stdinBody?: unknown;
};

export function collectOpenApiParams(
  command: CommandDef,
  values: Record<string, unknown>,
  options: CollectOpenApiOptions = {},
): CollectedOpenApiParams {
  let path = command.path ?? '';
  const queryParams: Record<string, unknown> = {};
  const headers: Record<string, string> = {};
  let body: CollectedOpenApiParams['body'] = null;
  const files: Record<string, unknown> | null = null;

  for (const param of command.params) {
    if (param.location !== 'path') continue;
    const value = values[param.name];
    if (value !== undefined && value !== null) {
      path = path.replace(`{${param.originalName}}`, encodeURIComponent(String(value)));
    }
  }

  for (const param of command.params) {
    const value = values[param.name];
    if (value === undefined || value === null) continue;

    if (param.location === 'query') {
      queryParams[param.originalName] = coerceAndValidateValue(
        value,
        param.schema ?? {},
        `--${param.name}`,
      );
    } else if (param.location === 'header') {
      headers[param.originalName] = String(value);
    }
  }

  const method = command.method?.toLowerCase() ?? 'get';
  if (method !== 'get') {
    if (options.stdinBody !== undefined) {
      body = options.stdinBody as CollectedOpenApiParams['body'];
    } else {
      const collectedBody: Record<string, unknown> = {};
      for (const param of command.params) {
        if (param.location !== 'body') continue;
        const value = values[param.name];
        if (value !== undefined && value !== null) {
          collectedBody[param.originalName] = coerceAndValidateValue(
            value,
            param.schema ?? {},
            `--${param.name}`,
          );
        }
      }
      body = Object.keys(collectedBody).length > 0 ? collectedBody : null;
    }
  }

  return { path, queryParams, headers, body, files };
}
