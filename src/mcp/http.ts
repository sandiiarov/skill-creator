import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { extractMcpContent, type McpTool } from './stdio.js';

export type McpHttpTransport = 'auto' | 'streamable' | 'sse';

export type McpHttpOptions = {
  headers?: Array<[string, string]>;
  transport?: McpHttpTransport;
};

export async function listHttpTools(
  url: string,
  optionsOrHeaders: McpHttpOptions | Array<[string, string]> = {},
): Promise<McpTool[]> {
  const options = normalizeOptions(optionsOrHeaders);
  return withHttpClient(url, options, async (client) => {
    const result = await client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      inputSchema: tool.inputSchema,
    }));
  });
}

export async function callHttpTool(
  url: string,
  toolName: string,
  args: Record<string, unknown>,
  optionsOrHeaders: McpHttpOptions | Array<[string, string]> = {},
): Promise<unknown> {
  const options = normalizeOptions(optionsOrHeaders);
  return withHttpClient(url, options, async (client) => {
    const result = await client.callTool({ name: toolName, arguments: args });
    return extractMcpContent(result.content);
  });
}

async function withHttpClient<T>(
  url: string,
  options: Required<McpHttpOptions>,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  if (options.transport === 'auto') {
    try {
      return await withSingleHttpClient(url, { ...options, transport: 'streamable' }, fn);
    } catch (streamableError) {
      try {
        return await withSingleHttpClient(url, { ...options, transport: 'sse' }, fn);
      } catch (sseError) {
        throw new Error(
          `failed to connect using streamable HTTP or SSE (${formatError(streamableError)}; ${formatError(sseError)})`,
        );
      }
    }
  }

  return withSingleHttpClient(url, options, fn);
}

async function withSingleHttpClient<T>(
  url: string,
  options: Required<McpHttpOptions>,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ name: 'skill-creator', version: '0.1.0' });
  const transport = createTransport(url, options);

  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

function createTransport(url: string, options: Required<McpHttpOptions>): Transport {
  const headers = Object.fromEntries(options.headers);
  if (options.transport === 'sse') {
    const fetchWithHeaders: typeof fetch = (input, init) =>
      fetch(input, { ...init, headers: { ...headers, ...headersToObject(init?.headers) } });
    return new SSEClientTransport(new URL(url), {
      eventSourceInit: { fetch: fetchWithHeaders },
      requestInit: { headers },
    }) as unknown as Transport;
  }

  return new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers },
  }) as unknown as Transport;
}

function normalizeOptions(
  optionsOrHeaders: McpHttpOptions | Array<[string, string]>,
): Required<McpHttpOptions> {
  if (Array.isArray(optionsOrHeaders)) {
    return { headers: optionsOrHeaders, transport: 'auto' };
  }
  return {
    headers: optionsOrHeaders.headers ?? [],
    transport: optionsOrHeaders.transport ?? 'auto',
  };
}

function headersToObject(headers: HeadersInit | undefined): Record<string, string> {
  if (headers === undefined) return {};
  return Object.fromEntries(new Headers(headers).entries());
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
