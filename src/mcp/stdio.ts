import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import stringArgv from 'string-argv';

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export async function listStdioTools(commandLine: string): Promise<McpTool[]> {
  return withStdioClient(commandLine, async (client) => {
    const result = await client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      inputSchema: tool.inputSchema,
    }));
  });
}

export async function callStdioTool(
  commandLine: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return withStdioClient(commandLine, async (client) => {
    const result = await client.callTool({ name: toolName, arguments: args });
    return extractMcpContent(result.content);
  });
}

async function withStdioClient<T>(
  commandLine: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const [command, ...args] = splitCommandLine(commandLine);
  if (command === undefined) throw new Error('--mcp-stdio command cannot be empty');

  const client = new Client({ name: 'skill-creator', version: '0.1.0' });
  const transport = new StdioClientTransport({ command, args, stderr: 'pipe' });

  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

export function splitCommandLine(commandLine: string): string[] {
  return stringArgv(commandLine);
}

type ContentPart = Record<string, unknown>;

export function extractMcpContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;

  const parts = content
    .map((part) => extractContentPart(part))
    .filter((part) => part !== undefined);
  if (parts.length === 0) return '';
  if (parts.every((part) => typeof part === 'string')) return parts.join('\n');
  return parts;
}

function extractContentPart(part: unknown): unknown {
  if (!isObject(part)) return undefined;
  if (part.type === 'text' && typeof part.text === 'string') return part.text;
  if (typeof part.data === 'string') return part.data;

  if (part.type === 'resource' && isObject(part.resource)) {
    if (typeof part.resource.text === 'string') return part.resource.text;
    if (typeof part.resource.blob === 'string') return part.resource.blob;
  }

  return part;
}

function isObject(value: unknown): value is ContentPart {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
