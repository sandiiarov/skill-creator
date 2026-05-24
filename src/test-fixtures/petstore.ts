export const PETSTORE_SPEC = {
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '1.0.0' },
  servers: [{ url: 'http://localhost:3000/api/v1' }],
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List pets',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer' },
            description: 'Max results',
          },
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string', enum: ['available', 'pending', 'sold'] },
          },
        ],
      },
      post: {
        operationId: 'createPet',
        summary: 'Create a pet',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', description: 'Pet name' },
                  tag: { type: 'string' },
                  age: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
    '/pets/{petId}': {
      get: {
        operationId: 'getPet',
        summary: 'Get a pet',
        parameters: [
          {
            name: 'petId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Pet ID',
          },
        ],
      },
      delete: {
        operationId: 'deletePet',
        summary: 'Delete a pet',
        parameters: [
          {
            name: 'petId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
      },
      put: {
        operationId: 'updatePet',
        summary: 'Update a pet',
        parameters: [
          {
            name: 'petId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const PETSTORE_SPEC_WITH_REFS = {
  openapi: '3.0.0',
  info: { title: 'Refs', version: '1' },
  components: {
    parameters: {
      LimitParam: {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer' },
        description: 'Max results',
      },
    },
  },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        parameters: [{ $ref: '#/components/parameters/LimitParam' }],
      },
    },
  },
} as const;
