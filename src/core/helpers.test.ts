import { describe, expect, it } from 'vitest';

import type { CommandDef } from './types.js';

import { coerceAndValidateValue, coerceValue, schemaTypeToCliType } from './coerce.js';
import { filterCommands } from './filter.js';
import { toKebab } from './names.js';

describe('schemaTypeToCliType', () => {
  it('maps primitive JSON schema types to CLI types', () => {
    expect(schemaTypeToCliType({ type: 'integer' })).toEqual({
      type: 'integer',
      suffix: '',
    });
    expect(schemaTypeToCliType({ type: 'number' })).toEqual({
      type: 'number',
      suffix: '',
    });
    expect(schemaTypeToCliType({ type: 'boolean' })).toEqual({
      type: 'boolean',
      suffix: '',
    });
    expect(schemaTypeToCliType({ type: 'string' })).toEqual({
      type: 'string',
      suffix: '',
    });
  });

  it('documents array and object string inputs', () => {
    expect(schemaTypeToCliType({ type: 'array' })).toEqual({
      type: 'string',
      suffix: ' (JSON array)',
    });
    expect(schemaTypeToCliType({ type: 'object' })).toEqual({
      type: 'string',
      suffix: ' (JSON object)',
    });
  });

  it('defaults unknown schemas to string', () => {
    expect(schemaTypeToCliType({})).toEqual({ type: 'string', suffix: '' });
  });

  it('uses the non-null schema from nullable anyOf/oneOf unions', () => {
    expect(schemaTypeToCliType({ anyOf: [{ type: 'integer' }, { type: 'null' }] })).toEqual({
      type: 'integer',
      suffix: '',
    });
    expect(schemaTypeToCliType({ oneOf: [{ type: 'object' }, { type: 'null' }] })).toEqual({
      type: 'string',
      suffix: ' (JSON object)',
    });
  });
});

describe('coerceValue', () => {
  it('coerces scalar schema values', () => {
    expect(coerceValue('42', { type: 'integer' })).toBe(42);
    expect(coerceValue('3.14', { type: 'number' })).toBe(3.14);
    expect(coerceValue(true, { type: 'boolean' })).toBe(true);
    expect(coerceValue('hello', { type: 'string' })).toBe('hello');
  });

  it('coerces arrays from JSON, comma strings, and single values', () => {
    expect(coerceValue('[1,2,3]', { type: 'array' })).toEqual([1, 2, 3]);
    expect(coerceValue('a,b', { type: 'array' })).toEqual(['a', 'b']);
    expect(coerceValue('a', { type: 'array' })).toEqual(['a']);
    expect(coerceValue('1,2', { type: 'array', items: { type: 'integer' } })).toEqual([1, 2]);
    expect(coerceValue('true,false', { type: 'array', items: { type: 'boolean' } })).toEqual([
      true,
      false,
    ]);
  });

  it('coerces object JSON and preserves invalid object input', () => {
    expect(coerceValue('{"a":1}', { type: 'object' })).toEqual({ a: 1 });
    expect(coerceValue('not json', { type: 'object' })).toBe('not json');
  });

  it('parses schemaless JSON objects and arrays', () => {
    expect(coerceValue('{"key":"value"}', {})).toEqual({ key: 'value' });
    expect(coerceValue('[1,2]', {})).toEqual([1, 2]);
    expect(coerceValue('plain', {})).toBe('plain');
  });

  it('coerces nullable anyOf/oneOf values using the non-null schema', () => {
    expect(coerceValue('2', { anyOf: [{ type: 'integer' }, { type: 'null' }] })).toBe(2);
    expect(coerceValue('{"a":1}', { oneOf: [{ type: 'object' }, { type: 'null' }] })).toEqual({
      a: 1,
    });
  });
});

describe('coerceAndValidateValue', () => {
  it('validates coerced values with JSON Schema', () => {
    expect(coerceAndValidateValue('2', { type: 'integer', enum: [1, 2] }, '--count')).toBe(2);
    expect(() => coerceAndValidateValue('bad', { type: 'integer' }, '--count')).toThrow(
      /--count failed validation/,
    );
  });
});

describe('toKebab', () => {
  it('normalizes camelCase, underscores, and existing kebab names', () => {
    expect(toKebab('findPetsByStatus')).toBe('find-pets-by-status');
    expect(toKebab('list_items')).toBe('list-items');
    expect(toKebab('list-items')).toBe('list-items');
    expect(toKebab('getHTTPResponse')).toBe('get-httpresponse');
  });
});

describe('filterCommands', () => {
  const commands: CommandDef[] = [
    { name: 'list-pets', method: 'get', params: [] },
    { name: 'create-pet', method: 'post', params: [] },
    { name: 'delete-pet', method: 'delete', params: [] },
    { name: 'echo', toolName: 'echo', params: [] },
  ];

  it('filters by methods while preserving MCP commands', () => {
    expect(filterCommands(commands, { methods: ['GET'] }).map((c) => c.name)).toEqual([
      'list-pets',
      'echo',
    ]);
  });

  it('applies include then exclude glob filters', () => {
    expect(
      filterCommands(commands, {
        include: ['*-pet'],
        exclude: ['delete-*'],
      }).map((c) => c.name),
    ).toEqual(['create-pet']);
  });
});
