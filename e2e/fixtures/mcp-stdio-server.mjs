#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'skill-creator-test-server', version: '1.0.0' });

server.registerTool(
  'echo',
  {
    description: 'Echo back the input',
    inputSchema: {
      message: z.string().describe('Message to echo'),
    },
  },
  async ({ message }) => ({
    content: [{ type: 'text', text: message }],
  }),
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
  async ({ a, b }) => ({
    content: [{ type: 'text', text: String(a + b) }],
  }),
);

server.registerTool(
  'list_items',
  {
    description: 'List items in a directory',
    inputSchema: {
      path: z.string().describe('Directory path'),
      recursive: z.boolean().optional().describe('Recurse into subdirectories'),
    },
  },
  async ({ path, recursive = false }) => ({
    content: [
      { type: 'text', text: JSON.stringify({ path, recursive, items: ['a.txt', 'b.txt'] }) },
    ],
  }),
);

await server.connect(new StdioServerTransport());
