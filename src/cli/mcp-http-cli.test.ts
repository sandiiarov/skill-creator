import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions,
} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mkdtemp } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { run } from './main.js';

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
  delete process.env.SKILL_CREATOR_CACHE_DIR;
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('MCP Streamable HTTP CLI mode', () => {
  it('lists tools from a Streamable HTTP MCP server', async () => {
    const server = await startMcpHttpServer();
    try {
      const code = await run(['--mcp', server.url, 'commands', 'list']);
      expect(code).toBe(0);
      expect(stdout).toContain('echo');
      expect(stdout).toContain('add-numbers');
    } finally {
      await server.close();
    }
  });

  it('caches MCP tool listings for repeated discovery', async () => {
    process.env.SKILL_CREATOR_CACHE_DIR = await mkdtemp(join(tmpdir(), 'skill-creator-mcp-cache-'));
    const server = await startMcpHttpServer();
    try {
      expect(await run(['--mcp', server.url, '--list'])).toBe(0);
      const requestsAfterFirstList = server.requestCount();
      stdout = '';

      expect(await run(['--mcp', server.url, '--list'])).toBe(0);
      expect(stdout).toContain('echo');
      expect(server.requestCount()).toBe(requestsAfterFirstList);

      stdout = '';
      expect(await run(['--mcp', server.url, '--refresh', '--list'])).toBe(0);
      expect(server.requestCount()).toBeGreaterThan(requestsAfterFirstList);
    } finally {
      await server.close();
    }
  });

  it('calls a Streamable HTTP MCP tool', async () => {
    const server = await startMcpHttpServer();
    try {
      const code = await run(['--mcp', server.url, 'run', 'add-numbers', '--a', '6', '--b', '7']);
      expect(code).toBe(0);
      expect(stdout).toContain('13');
    } finally {
      await server.close();
    }
  });

  it('falls back to SSE transport in auto mode', async () => {
    const server = await startMcpSseServer();
    try {
      const code = await run(['--mcp', server.url, '--list']);
      expect(code).toBe(0);
      expect(stdout).toContain('echo');
      expect(stdout).toContain('add-numbers');
    } finally {
      await server.close();
    }
  });

  it('can force SSE transport', async () => {
    const server = await startMcpSseServer();
    try {
      const code = await run([
        '--mcp',
        server.url,
        '--transport',
        'sse',
        'run',
        'add-numbers',
        '--a',
        '2',
        '--b',
        '5',
      ]);
      expect(code).toBe(0);
      expect(stdout).toContain('7');
    } finally {
      await server.close();
    }
  });
});

async function startMcpHttpServer(): Promise<{
  url: string;
  requestCount: () => number;
  close: () => Promise<void>;
}> {
  let requestCount = 0;
  const httpServer = createServer((req, res) => {
    requestCount += 1;
    void handleMcpRequest(req, res);
  });

  return new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address();
      if (address === null || typeof address === 'string') throw new Error('unexpected address');
      resolve({
        url: `http://127.0.0.1:${address.port}/mcp`,
        requestCount: () => requestCount,
        close: () => closeServer(httpServer),
      });
    });
  });
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.url !== '/mcp' || req.method !== 'POST') {
    res.writeHead(405).end('Method not allowed');
    return;
  }

  const server = createTestMcpServer();
  const statelessOptions = {
    sessionIdGenerator: undefined,
  } as unknown as StreamableHTTPServerTransportOptions;
  const transport = new StreamableHTTPServerTransport(statelessOptions);

  try {
    await server.connect(transport as unknown as Transport);
    await transport.handleRequest(req, res, await readJsonBody(req));
  } finally {
    await transport.close();
    await server.close();
  }
}

async function startMcpSseServer(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const transports = new Map<string, { transport: SSEServerTransport; server: McpServer }>();
  const httpServer = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (req.method === 'GET' && url.pathname === '/mcp') {
        const transport = new SSEServerTransport('/messages', res);
        const server = createTestMcpServer();
        transports.set(transport.sessionId, { transport, server });
        transport.onclose = () => {
          transports.delete(transport.sessionId);
        };
        await server.connect(transport as unknown as Transport);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/messages') {
        const sessionId = url.searchParams.get('sessionId');
        const entry = sessionId === null ? undefined : transports.get(sessionId);
        if (entry === undefined) {
          res.writeHead(404).end('Session not found');
          return;
        }
        await entry.transport.handlePostMessage(req, res, await readJsonBody(req));
        return;
      }

      res.writeHead(404).end('Not found');
    })();
  });

  return new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address();
      if (address === null || typeof address === 'string') throw new Error('unexpected address');
      resolve({
        url: `http://127.0.0.1:${address.port}/mcp`,
        close: async () => {
          for (const entry of transports.values()) {
            await entry.transport.close();
            await entry.server.close();
          }
          await closeServer(httpServer);
        },
      });
    });
  });
}

function createTestMcpServer(): McpServer {
  const server = new McpServer({
    name: 'skill-creator-http-test-server',
    version: '1.0.0',
  });
  server.registerTool(
    'echo',
    {
      description: 'Echo back the input',
      inputSchema: { message: z.string().describe('Message to echo') },
    },
    async ({ message }) => ({ content: [{ type: 'text', text: message }] }),
  );
  server.registerTool(
    'add_numbers',
    {
      description: 'Add two numbers',
      inputSchema: {
        a: z.number().describe('First number'),
        b: z.number().describe('Second number'),
      },
    },
    async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }),
  );
  return server;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('error', reject);
    req.on('end', () => {
      resolve(raw ? (JSON.parse(raw) as unknown) : undefined);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
