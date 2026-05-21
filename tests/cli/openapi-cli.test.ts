import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../../src/cli/main.js';
import { PETSTORE_SPEC } from '../fixtures/petstore.js';

let stdout = '';
let stderr = '';
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

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
  delete process.env.SKILL_CREATOR_TEST_AUTH_HEADER;
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

async function writePetstoreSpec(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'skill-creator-cli-'));
  const path = join(dir, 'openapi.json');
  await writeFile(path, JSON.stringify(PETSTORE_SPEC));
  return path;
}

function startPetstoreServer(expectedAuth?: string): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'GET' && url.pathname === '/api/v1/pets') {
      if (expectedAuth !== undefined && req.headers.authorization !== expectedAuth) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      const limit = Number(url.searchParams.get('limit') ?? '2');
      res.end(
        JSON.stringify(
          [
            { id: 1, name: 'Fido' },
            { id: 2, name: 'Spot' },
          ].slice(0, limit),
        ),
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/pets') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += String(chunk);
      });
      req.on('end', () => {
        res.end(JSON.stringify({ id: 3, ...JSON.parse(raw) }));
      });
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('unexpected address');
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
        close: () => closeServer(server),
      });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe('OpenAPI CLI mode', () => {
  it('lists commands from a spec file', async () => {
    const specPath = await writePetstoreSpec();
    const code = await run(['--spec', specPath, '--base-url', 'http://unused', '--list']);
    expect(code).toBe(0);
    expect(stdout).toContain('list-pets');
    expect(stdout).toContain('create-pet');
  });

  it('applies include, exclude, and method filters when listing commands', async () => {
    const specPath = await writePetstoreSpec();

    expect(
      await run([
        '--spec',
        specPath,
        '--base-url',
        'http://unused',
        '--include',
        'list-*',
        '--list',
      ]),
    ).toBe(0);
    expect(stdout).toContain('list-pets');
    expect(stdout).not.toContain('create-pet');

    stdout = '';
    expect(
      await run([
        '--spec',
        specPath,
        '--base-url',
        'http://unused',
        '--exclude',
        'list-*',
        '--methods',
        'POST',
        '--list',
      ]),
    ).toBe(0);
    expect(stdout).toContain('create-pet');
    expect(stdout).not.toContain('list-pets');
  });

  it('executes a GET operation', async () => {
    const specPath = await writePetstoreSpec();
    const server = await startPetstoreServer();
    try {
      const code = await run([
        '--spec',
        specPath,
        '--base-url',
        server.baseUrl,
        'list-pets',
        '--limit',
        '1',
      ]);
      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toEqual([{ id: 1, name: 'Fido' }]);
    } finally {
      await server.close();
    }
  });

  it('resolves env-prefixed auth headers', async () => {
    process.env.SKILL_CREATOR_TEST_AUTH_HEADER = 'Bearer from-env';
    const specPath = await writePetstoreSpec();
    const server = await startPetstoreServer('Bearer from-env');
    try {
      const code = await run([
        '--spec',
        specPath,
        '--base-url',
        server.baseUrl,
        '--auth-header',
        'Authorization:env:SKILL_CREATOR_TEST_AUTH_HEADER',
        'list-pets',
      ]);
      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toEqual([
        { id: 1, name: 'Fido' },
        { id: 2, name: 'Spot' },
      ]);
    } finally {
      await server.close();
    }
  });

  it('executes a POST operation with body flags', async () => {
    const specPath = await writePetstoreSpec();
    const server = await startPetstoreServer();
    try {
      const code = await run([
        '--spec',
        specPath,
        '--base-url',
        server.baseUrl,
        'create-pet',
        '--name',
        'Buddy',
        '--age',
        '4',
      ]);
      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({
        id: 3,
        name: 'Buddy',
        age: 4,
      });
    } finally {
      await server.close();
    }
  });

  it('rejects missing and mutually exclusive source modes', async () => {
    expect(await run([])).toBe(1);
    expect(stderr).toContain('one of --spec');
    stderr = '';
    expect(await run(['--spec', 'x', '--mcp', 'y', '--list'])).toBe(1);
    expect(stderr).toContain('mutually exclusive');
  });
});
