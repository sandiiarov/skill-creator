import { describe, expect, it } from 'vitest';

import { PETSTORE_SPEC } from '../test-fixtures/petstore.js';
import { extractOpenApiCommands } from './extract.js';

describe('extractOpenApiCommands', () => {
  it('extracts operation commands and normalizes names', () => {
    const commands = extractOpenApiCommands(PETSTORE_SPEC);
    expect(commands.map((command) => command.name)).toEqual([
      'list-pets',
      'create-pet',
      'get-pet',
      'delete-pet',
      'update-pet',
    ]);
  });

  it('extracts query, path, enum, and body params with schemas preserved', () => {
    const commands = extractOpenApiCommands(PETSTORE_SPEC);

    const listPets = commands.find((command) => command.name === 'list-pets');
    expect(listPets).toMatchObject({ method: 'get', path: '/pets' });
    expect(listPets?.params.find((param) => param.name === 'limit')).toMatchObject({
      originalName: 'limit',
      type: 'integer',
      location: 'query',
      schema: { type: 'integer' },
    });
    expect(listPets?.params.find((param) => param.name === 'status')?.choices).toEqual([
      'available',
      'pending',
      'sold',
    ]);

    const getPet = commands.find((command) => command.name === 'get-pet');
    expect(getPet?.params[0]).toMatchObject({
      name: 'pet-id',
      originalName: 'petId',
      required: true,
      location: 'path',
    });

    const createPet = commands.find((command) => command.name === 'create-pet');
    expect(createPet?.hasBody).toBe(true);
    expect(
      createPet?.params.filter((param) => param.location === 'body').map((param) => param.name),
    ).toEqual(['name', 'tag', 'age']);
  });

  it('generates fallback names from method and path when operationId is missing', () => {
    const commands = extractOpenApiCommands({
      openapi: '3.0.0',
      info: { title: 'x', version: '1' },
      paths: { '/users/{id}/posts': { get: { summary: 'Posts' } } },
    });
    expect(commands[0]?.name).toBe('get-users-id-posts');
  });
});
