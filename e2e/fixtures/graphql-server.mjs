#!/usr/bin/env node
import { buildSchema, graphql } from 'graphql';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const readyFile = process.argv[2];
if (!readyFile) throw new Error('usage: graphql-server.mjs READY_FILE');

const schema = buildSchema(`
  type Profile {
    city: String!
  }

  type User {
    id: ID!
    name: String!
    email: String!
    age: Int
    profile: Profile!
  }

  type Query {
    users(limit: Int): [User!]!
    user(id: ID!): User
    ping: String!
  }

  type Mutation {
    createUser(name: String!, email: String!, age: Int): User!
  }
`);

const users = [
  {
    id: '1',
    name: 'Alice',
    email: 'alice@example.com',
    age: 31,
    profile: { city: 'Pallet' },
  },
  {
    id: '2',
    name: 'Bob',
    email: 'bob@example.com',
    age: 42,
    profile: { city: 'Cerulean' },
  },
];

const rootValue = {
  users: ({ limit }) => users.slice(0, limit ?? users.length),
  user: ({ id }) => users.find((user) => user.id === id),
  ping: () => 'pong',
  createUser: ({ name, email, age }) => ({
    id: '3',
    name,
    email,
    age: age ?? null,
    profile: { city: 'Viridian' },
  }),
};

const server = createServer((req, res) => {
  void handleRequest(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) res.statusCode = 500;
    res.end(JSON.stringify({ errors: [{ message: String(error.message ?? error) }] }));
  });
});

async function handleRequest(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('Method not allowed');
    return;
  }

  const expectedAuthorization = process.env.GRAPHQL_AUTHORIZATION;
  if (expectedAuthorization && req.headers.authorization !== expectedAuthorization) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 401;
    res.end(JSON.stringify({ errors: [{ message: 'unauthorized' }] }));
    return;
  }

  const body = await readJsonBody(req);
  const result = await graphql({
    schema,
    source: body.query,
    variableValues: body.variables,
    rootValue,
  });
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(result));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch (error) {
        reject(error);
      }
    });
  });
}

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('unexpected address');
  writeFileSync(
    readyFile,
    `${JSON.stringify({ url: `http://127.0.0.1:${address.port}/graphql` })}\n`,
  );
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
