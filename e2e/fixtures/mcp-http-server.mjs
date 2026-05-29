#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { z } from 'zod';

const readyFile = process.argv[2];
if (!readyFile) throw new Error('usage: mcp-http-server.mjs READY_FILE');

const httpServer = createServer((req, res) => {
  void handleMcpRequest(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end(String(error.message ?? error));
  });
});

async function handleMcpRequest(req, res) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/mcp' || req.method !== 'POST') {
    res.writeHead(405).end('Method not allowed');
    return;
  }

  const server = createTestMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, await readJsonBody(req));
  } finally {
    await transport.close();
    await server.close();
  }
}

function createTestMcpServer() {
  const server = new McpServer({
    name: 'skill-creator-e2e-http-server',
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
        resolve(raw.length === 0 ? undefined : JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
  });
}

httpServer.listen(0, '127.0.0.1', () => {
  const address = httpServer.address();
  if (address === null || typeof address === 'string') throw new Error('unexpected address');
  writeFileSync(readyFile, `${JSON.stringify({ url: `http://127.0.0.1:${address.port}/mcp` })}\n`);
});

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0));
});
