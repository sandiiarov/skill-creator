import { buildSchema, isObjectType } from 'graphql';
import { describe, expect, it } from 'vitest';

import { buildGraphqlSelectionSet, extractGraphqlCommands } from './extract.js';

const schema = buildSchema(`
  type User {
    id: ID!
    name: String!
    email: String!
    age: Int
  }

  type Query {
    users(limit: Int): [User!]!
    user(id: ID!): User
    usersByIds(ids: [ID!]!): [User!]!
    ping: String!
  }

  type Mutation {
    createUser(name: String!, email: String!, age: Int): User!
    deleteUser(id: ID!): Boolean!
  }
`);

const nestedSchema = buildSchema(`
  type Node {
    id: ID!
    parent: Node
    children: [Node!]!
  }

  type Query {
    node(id: ID!): Node
  }
`);

describe('extractGraphqlCommands', () => {
  it('extracts query and mutation commands', () => {
    const commands = extractGraphqlCommands(schema);
    expect(commands.map((command) => command.name)).toEqual([
      'users',
      'user',
      'users-by-ids',
      'ping',
      'create-user',
      'delete-user',
    ]);
  });

  it('maps GraphQL arguments to CLI params', () => {
    const commands = extractGraphqlCommands(schema);
    const user = commands.find((command) => command.name === 'user');
    expect(user?.params).toMatchObject([
      {
        name: 'id',
        originalName: 'id',
        type: 'string',
        required: true,
        location: 'graphql_arg',
        schema: { type: 'string' },
      },
    ]);

    const createUser = commands.find((command) => command.name === 'create-user');
    expect(createUser?.graphqlOperationType).toBe('mutation');
    expect(createUser?.params).toMatchObject([
      { name: 'name', required: true, schema: { type: 'string' } },
      { name: 'email', required: true, schema: { type: 'string' } },
      { name: 'age', required: false, schema: { type: 'integer' } },
    ]);
  });

  it('maps list arguments to array schema', () => {
    const commands = extractGraphqlCommands(schema);
    const usersByIds = commands.find((command) => command.name === 'users-by-ids');
    expect(usersByIds?.params).toMatchObject([
      {
        name: 'ids',
        required: true,
        schema: { type: 'array', items: { type: 'string' } },
      },
    ]);
  });

  it('omits object fields when default selection depth is exhausted', () => {
    const nodeType = nestedSchema.getType('Node');
    if (!isObjectType(nodeType)) throw new Error('missing Node object type');
    expect(buildGraphqlSelectionSet(nodeType)).toBe('{ id }');
  });
});
