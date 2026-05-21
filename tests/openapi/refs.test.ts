import { describe, expect, it } from 'vitest';
import { resolveRefs } from '../../src/openapi/refs.js';
import { PETSTORE_SPEC_WITH_REFS } from '../fixtures/petstore.js';

describe('resolveRefs', () => {
  it('resolves local JSON pointer refs without mutating input', async () => {
    const resolved = await resolveRefs(PETSTORE_SPEC_WITH_REFS);
    expect(resolved.paths['/pets'].get.parameters[0]).toMatchObject({
      name: 'limit',
      in: 'query',
    });
    expect(PETSTORE_SPEC_WITH_REFS.paths['/pets'].get.parameters[0]).toEqual({
      $ref: '#/components/parameters/LimitParam',
    });
  });

  it('leaves circular refs safe instead of recursing forever', async () => {
    const resolved = await resolveRefs({ a: { $ref: '#/b' }, b: { $ref: '#/a' } });
    expect(JSON.stringify(resolved)).toContain('$ref');
  });
});
