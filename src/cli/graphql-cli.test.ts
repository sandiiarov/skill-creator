import { buildSchema, graphql, introspectionFromSchema, printSchema } from 'graphql';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from './main.js';

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

let stdout = '';
let stderr = '';
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
const originalStdin = process.stdin;

beforeEach(() => {
  stdout = '';
  stderr = '';
  logSpy = vi.spyOn(console, 'log').mockImplementation((message = '') => {
    stdout += `${String(message)}\n`;
  });
  errorSpy = vi.spyOn(console, 'error').mockImplementation((message = '') => {
    stderr += `${String(message)}\n`;
  });
});

afterEach(() => {
  delete process.env.SKILL_CREATOR_CACHE_DIR;
  Object.defineProperty(process, 'stdin', {
    value: originalStdin,
    configurable: true,
  });
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('GraphQL CLI mode', () => {
  it('lists commands from a GraphQL endpoint', async () => {
    const server = await startGraphqlServer();
    try {
      const code = await run(['--graphql', server.url, 'commands', 'list']);
      expect(code).toBe(0);
      expect(stdout).toContain('users');
      expect(stdout).toContain('create-user');
    } finally {
      await server.close();
    }
  });

  it('searches commands and renders GraphQL operation help through the commands namespace', async () => {
    const server = await startGraphqlServer();
    try {
      expect(await run(['--graphql', server.url, 'commands', 'search', 'create'])).toBe(0);
      expect(stdout).toContain('create-user');
      expect(stdout).not.toContain('ping');

      stdout = '';
      expect(await run(['--graphql', server.url, 'commands', 'help', 'users'])).toBe(0);
      expect(stdout).toContain('users:');
      expect(stdout).toContain('--limit');
    } finally {
      await server.close();
    }
  });

  it('caches GraphQL introspection for repeated command discovery', async () => {
    process.env.SKILL_CREATOR_CACHE_DIR = await mkdtemp(
      join(tmpdir(), 'skill-creator-graphql-cache-'),
    );
    const server = await startGraphqlServer();
    try {
      expect(await run(['--graphql', server.url, '--list'])).toBe(0);
      const requestsAfterFirstList = server.requestCount();
      stdout = '';

      expect(await run(['--graphql', server.url, '--list'])).toBe(0);
      expect(stdout).toContain('users');
      expect(server.requestCount()).toBe(requestsAfterFirstList);

      stdout = '';
      expect(await run(['--graphql', server.url, '--refresh', '--list'])).toBe(0);
      expect(server.requestCount()).toBeGreaterThan(requestsAfterFirstList);
    } finally {
      await server.close();
    }
  });

  it('uses a provided SDL schema when endpoint introspection is disabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-creator-graphql-schema-'));
    const schemaPath = join(dir, 'schema.graphql');
    await writeFile(schemaPath, printSchema(schema));
    const server = await startGraphqlServer({ introspectionEnabled: false });
    try {
      const code = await run([
        '--graphql',
        server.url,
        '--graphql-schema',
        schemaPath,
        'run',
        'users',
        '--limit',
        '1',
      ]);
      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toEqual([users[0]]);
    } finally {
      await server.close();
    }
  });

  it('uses a provided introspection JSON schema', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-creator-graphql-schema-json-'));
    const schemaPath = join(dir, 'schema.json');
    await writeFile(schemaPath, JSON.stringify({ data: introspectionFromSchema(schema) }));
    const server = await startGraphqlServer({ introspectionEnabled: false });
    try {
      const code = await run(['--graphql', server.url, '--graphql-schema', schemaPath, '--list']);
      expect(code).toBe(0);
      expect(stdout).toContain('users');
      expect(server.requestCount()).toBe(0);
    } finally {
      await server.close();
    }
  });

  it('falls back to stale cached schema when introspection is unavailable', async () => {
    process.env.SKILL_CREATOR_CACHE_DIR = await mkdtemp(
      join(tmpdir(), 'skill-creator-graphql-stale-'),
    );
    const server = await startGraphqlServer();
    try {
      expect(await run(['--graphql', server.url, '--list'])).toBe(0);
      server.disableIntrospection();
      stdout = '';
      stderr = '';

      expect(await run(['--graphql', server.url, '--refresh', '--list'])).toBe(0);
      expect(stdout).toContain('users');
      expect(stderr).toContain('using stale cached GraphQL schema');
    } finally {
      await server.close();
    }
  });

  it('fails with an actionable error when introspection is disabled and no schema is available', async () => {
    process.env.SKILL_CREATOR_CACHE_DIR = await mkdtemp(
      join(tmpdir(), 'skill-creator-graphql-no-cache-'),
    );
    const server = await startGraphqlServer({ introspectionEnabled: false });
    try {
      const code = await run(['--graphql', server.url, '--list']);
      expect(code).toBe(1);
      expect(stderr).toContain('GraphQL introspection is disabled or unavailable');
      expect(stderr).toContain('--graphql-schema');
    } finally {
      await server.close();
    }
  });

  it('executes a query with variables', async () => {
    const server = await startGraphqlServer();
    try {
      const code = await run(['--graphql', server.url, 'run', 'users', '--limit', '1']);
      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toEqual([users[0]]);
    } finally {
      await server.close();
    }
  });

  it('limits default GraphQL selection depth', async () => {
    const server = await startGraphqlServer();
    try {
      const code = await run([
        '--graphql',
        server.url,
        'run',
        '--selection-depth',
        '1',
        'users',
        '--limit',
        '1',
      ]);
      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toEqual([
        { id: '1', name: 'Alice', email: 'alice@example.com', age: 31 },
      ]);
    } finally {
      await server.close();
    }
  });

  it('executes a mutation', async () => {
    const server = await startGraphqlServer();
    try {
      const code = await run([
        '--graphql',
        server.url,
        'run',
        'create-user',
        '--name',
        'Charlie',
        '--email',
        'charlie@example.com',
        '--age',
        '25',
      ]);
      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({
        id: '3',
        name: 'Charlie',
        email: 'charlie@example.com',
        age: 25,
      });
    } finally {
      await server.close();
    }
  });

  it('executes a mutation with variables from stdin JSON', async () => {
    Object.defineProperty(process, 'stdin', {
      value: Readable.from(['{"name":"Dana","email":"dana@example.com","age":29}']),
      configurable: true,
    });
    const server = await startGraphqlServer();
    try {
      const code = await run(['--graphql', server.url, 'run', '--stdin', 'create-user']);
      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({
        id: '3',
        name: 'Dana',
        email: 'dana@example.com',
        age: 29,
      });
    } finally {
      await server.close();
    }
  });

  it('supports explicit GraphQL selection fields', async () => {
    const server = await startGraphqlServer();
    try {
      const code = await run([
        '--graphql',
        server.url,
        'run',
        '--fields',
        'id name',
        'user',
        '--id',
        '1',
      ]);
      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toEqual({ id: '1', name: 'Alice' });
    } finally {
      await server.close();
    }
  });
});

async function startGraphqlServer(options: { introspectionEnabled?: boolean } = {}): Promise<{
  url: string;
  requestCount: () => number;
  disableIntrospection: () => void;
  close: () => Promise<void>;
}> {
  let requestCount = 0;
  let introspectionEnabled = options.introspectionEnabled ?? true;
  const httpServer = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('Method not allowed');
      return;
    }

    requestCount += 1;

    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      void (async () => {
        const body = JSON.parse(raw) as {
          query: string;
          variables?: Record<string, unknown>;
        };
        if (!introspectionEnabled && isIntrospectionQuery(body.query)) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ errors: [{ message: 'introspection disabled' }] }));
          return;
        }

        const result = await graphql({
          schema,
          source: body.query,
          variableValues: body.variables,
          rootValue: {
            users: ({ limit }: { limit?: number }) => users.slice(0, limit ?? users.length),
            user: ({ id }: { id: string }) => users.find((user) => user.id === id),
            ping: () => 'pong',
            createUser: ({ name, email, age }: { name: string; email: string; age?: number }) => ({
              id: '3',
              name,
              email,
              age: age ?? null,
              profile: { city: 'Viridian' },
            }),
          },
        });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
      })();
    });
  });

  return new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address();
      if (address === null || typeof address === 'string') throw new Error('unexpected address');
      resolve({
        url: `http://127.0.0.1:${address.port}/graphql`,
        requestCount: () => requestCount,
        disableIntrospection: () => {
          introspectionEnabled = false;
        },
        close: () => closeServer(httpServer),
      });
    });
  });
}

function isIntrospectionQuery(query: string): boolean {
  return query.includes('__schema') || query.includes('IntrospectionQuery');
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
