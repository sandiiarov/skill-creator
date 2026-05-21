import { describe, expect, it } from 'vitest';
import { collectOpenApiParams } from '../../src/openapi/params.js';
import type { CommandDef } from '../../src/core/types.js';

describe('collectOpenApiParams', () => {
  it('substitutes path params and coerces query params for GET', () => {
    const command: CommandDef = {
      name: 'get-pet',
      method: 'get',
      path: '/pets/{petId}',
      params: [
        {
          name: 'pet-id',
          originalName: 'petId',
          type: 'string',
          location: 'path',
        },
        {
          name: 'limit',
          originalName: 'limit',
          type: 'integer',
          location: 'query',
          schema: { type: 'integer' },
        },
      ],
    };

    expect(collectOpenApiParams(command, { 'pet-id': 'abc', limit: '10' })).toEqual({
      path: '/pets/abc',
      queryParams: { limit: 10 },
      headers: {},
      body: null,
      files: null,
    });
  });

  it('collects body, header, and query params for non-GET methods', () => {
    const command: CommandDef = {
      name: 'create-item',
      method: 'post',
      path: '/items',
      hasBody: true,
      params: [
        {
          name: 'x-trace',
          originalName: 'X-Trace',
          type: 'string',
          location: 'header',
        },
        {
          name: 'dry-run',
          originalName: 'dryRun',
          type: 'boolean',
          location: 'query',
          schema: { type: 'boolean' },
        },
        {
          name: 'metadata',
          originalName: 'metadata',
          type: 'string',
          location: 'body',
          schema: { type: 'object' },
        },
        {
          name: 'tags',
          originalName: 'tags',
          type: 'string',
          location: 'body',
          schema: { type: 'array' },
        },
      ],
    };

    expect(
      collectOpenApiParams(command, {
        'x-trace': 'abc',
        'dry-run': true,
        metadata: '{"key":"value"}',
        tags: 'a,b',
      }),
    ).toEqual({
      path: '/items',
      queryParams: { dryRun: true },
      headers: { 'X-Trace': 'abc' },
      body: { metadata: { key: 'value' }, tags: ['a', 'b'] },
      files: null,
    });
  });

  it('uses stdin JSON as the whole body', () => {
    const command: CommandDef = {
      name: 'create-item',
      method: 'post',
      path: '/items',
      hasBody: true,
      params: [
        {
          name: 'name',
          originalName: 'name',
          type: 'string',
          location: 'body',
        },
      ],
    };

    expect(collectOpenApiParams(command, {}, { stdinBody: { name: 'Fido' } }).body).toEqual({
      name: 'Fido',
    });
  });
});
