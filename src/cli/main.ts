#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import type { CommandDef } from '../core/types.js';

import { runInstallCommand } from '../commands/install.js';
import { cacheKeyFor, loadCached, saveCache } from '../core/cache.js';
import { coerceAndValidateValue } from '../core/coerce.js';
import { resolveSecret } from '../core/secrets.js';
import { executeGraphql } from '../graphql/execute.js';
import { extractGraphqlCommands } from '../graphql/extract.js';
import { loadGraphqlSchema } from '../graphql/load.js';
import { extractMcpCommands } from '../mcp/extract.js';
import { callHttpTool, listHttpTools, type McpHttpTransport } from '../mcp/http.js';
import { callStdioTool, listStdioTools, type McpTool } from '../mcp/stdio.js';
import { executeOpenApi } from '../openapi/execute.js';
import { extractOpenApiCommands } from '../openapi/extract.js';
import { loadOpenApiSpec, type OpenApiSpec } from '../openapi/load.js';
import { runGenerate } from '../skills/generate.js';
import { runDynamicMode } from './dynamic.js';
import { splitAtSubcommand } from './parse.js';

const GLOBAL_OPTION_SPEC = {
  valueOptions: [
    '--spec',
    '--mcp',
    '--mcp-stdio',
    '--graphql',
    '--graphql-schema',
    '--base-url',
    '--auth-header',
    '--transport',
    '--cache-key',
    '--cache-ttl',
    '--search',
    '--include',
    '--exclude',
    '--methods',
    '--fields',
    '--selection-depth',
    '--head',
  ],
  boolOptions: ['--list', '--pretty', '--raw', '--refresh', '--stdin', '--version', '--help', '-h'],
};

type GlobalArgs = {
  spec?: string;
  mcp?: string;
  mcpStdio?: string;
  graphql?: string;
  graphqlSchema?: string;
  baseUrl?: string;
  authHeaders: Array<[string, string]>;
  transport: McpHttpTransport;
  cacheKey?: string;
  cacheTtl: number;
  refresh: boolean;
  list: boolean;
  search?: string;
  include?: string[];
  exclude?: string[];
  methods?: string[];
  fields?: string;
  selectionDepth: number;
  stdin: boolean;
  pretty: boolean;
  raw: boolean;
  head?: number;
  help: boolean;
  version: boolean;
};

export async function run(argv = process.argv.slice(2)): Promise<number> {
  if (argv[0] === '--') argv = argv.slice(1);

  if (argv[0] === 'generate') {
    try {
      await runGenerate(argv.slice(1));
      return 0;
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }

  if (argv[0] === 'command' || argv[0] === 'commands' || argv[0] === 'install-command') {
    try {
      await runInstallCommand(argv.slice(1));
      return 0;
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }

  const { globalArgv, commandArgv } = splitAtSubcommand(argv, GLOBAL_OPTION_SPEC);
  const globals = parseGlobalArgs(globalArgv);

  if (globals.version) {
    const pkg = await import('../../package.json', { with: { type: 'json' } });
    writeStdout(`skill-creator ${pkg.default.version}\n`);
    return 0;
  }

  if (globals.help && commandArgv.length === 0) {
    printHelp();
    return 0;
  }

  try {
    validateSourceModes(globals);
    globals.authHeaders = await resolveAuthHeaders(globals.authHeaders);

    if (globals.spec !== undefined) {
      await handleOpenApiMode(globals, commandArgv);
      return 0;
    }

    if (globals.mcpStdio !== undefined) {
      await handleMcpStdioMode(globals, commandArgv);
      return 0;
    }

    if (globals.mcp !== undefined) {
      await handleMcpHttpMode(globals, commandArgv);
      return 0;
    }

    if (globals.graphql !== undefined) {
      await handleGraphqlMode(globals, commandArgv);
      return 0;
    }

    console.error(
      'Error: only --spec, --mcp-stdio, --mcp, and --graphql modes are implemented in this TypeScript port so far.',
    );
    return 1;
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function handleOpenApiMode(globals: GlobalArgs, commandArgv: string[]): Promise<void> {
  if (globals.spec === undefined) throw new Error('--spec is required');
  const source = globals.spec;

  const spec = await loadOpenApiSpec(source, {
    authHeaders: globals.authHeaders,
    cacheDir: defaultCacheDir(),
    ...(globals.cacheKey === undefined ? {} : { cacheKey: globals.cacheKey }),
    ttlSeconds: globals.cacheTtl,
    refresh: globals.refresh,
  });

  await runDynamicMode({
    globals,
    commandArgv,
    loadCommands: () => extractOpenApiCommands(spec),
    renderCommands: renderOpenApiCommands,
    onEmptyCommand: () => {
      printHelp();
      throw new Error('provide a subcommand, or use --list to see available commands');
    },
    executeCommand: async (command, values) => {
      const baseUrl = determineBaseUrl(spec, source, globals.baseUrl);
      const response = await executeOpenApi(command, values, {
        baseUrl,
        authHeaders: globals.authHeaders,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.text}`);
      return response.text;
    },
  });
}

async function handleGraphqlMode(globals: GlobalArgs, commandArgv: string[]): Promise<void> {
  if (globals.graphql === undefined) throw new Error('--graphql is required');
  const endpoint = globals.graphql;

  const schema = await loadGraphqlSchema(endpoint, {
    authHeaders: globals.authHeaders,
    cacheDir: defaultCacheDir(),
    ...(globals.cacheKey === undefined ? {} : { cacheKey: globals.cacheKey }),
    ttlSeconds: globals.cacheTtl,
    refresh: globals.refresh,
    ...(globals.graphqlSchema === undefined ? {} : { schemaSource: globals.graphqlSchema }),
    onWarning: (message) => console.error(message),
  });

  await runDynamicMode({
    globals,
    commandArgv,
    loadCommands: () => extractGraphqlCommands(schema),
    renderCommands: renderGraphqlCommands,
    prepareCommandArgs: async (argv) => {
      const stdinFlag = stripFlag(argv, '--stdin');
      const stdinValues = globals.stdin || stdinFlag.enabled ? await readStdinJson() : {};
      return { argv: stdinFlag.argv, initialValues: stdinValues };
    },
    executeCommand: (command, values) =>
      executeGraphql(command, values, {
        endpoint,
        authHeaders: globals.authHeaders,
        ...(globals.fields === undefined ? {} : { fields: globals.fields }),
        selectionDepth: globals.selectionDepth,
      }),
  });
}

async function handleMcpHttpMode(globals: GlobalArgs, commandArgv: string[]): Promise<void> {
  if (globals.mcp === undefined) throw new Error('--mcp is required');
  const endpoint = globals.mcp;

  await runDynamicMode({
    globals,
    commandArgv,
    loadCommands: async () => extractMcpCommands(await loadMcpHttpTools(globals)),
    renderCommands: renderMcpCommands,
    executeCommand: async (command, values) => {
      const toolArgs = collectMcpToolArgs(command, values);
      return callHttpTool(endpoint, command.toolName ?? command.name, toolArgs, {
        headers: globals.authHeaders,
        transport: globals.transport,
      });
    },
  });
}

async function loadMcpHttpTools(globals: GlobalArgs): Promise<McpTool[]> {
  if (globals.mcp === undefined) throw new Error('--mcp is required');

  const cacheKey = `mcp-${
    globals.cacheKey ??
    cacheKeyFor({
      source: globals.mcp,
      authHeaders: globals.authHeaders,
      transport: globals.transport,
    })
  }`;
  const cacheDir = defaultCacheDir();

  if (!globals.refresh) {
    const cached = await loadCached<McpTool[]>(cacheDir, cacheKey, globals.cacheTtl);
    if (cached !== null) return cached;
  }

  const tools = await listHttpTools(globals.mcp, {
    headers: globals.authHeaders,
    transport: globals.transport,
  });
  await saveCache(cacheDir, cacheKey, tools);
  return tools;
}

async function handleMcpStdioMode(globals: GlobalArgs, commandArgv: string[]): Promise<void> {
  if (globals.mcpStdio === undefined) throw new Error('--mcp-stdio is required');
  const commandLine = globals.mcpStdio;

  await runDynamicMode({
    globals,
    commandArgv,
    loadCommands: async () => extractMcpCommands(await listStdioTools(commandLine)),
    renderCommands: renderMcpCommands,
    executeCommand: async (command, values) => {
      const toolArgs = collectMcpToolArgs(command, values);
      return callStdioTool(commandLine, command.toolName ?? command.name, toolArgs);
    },
  });
}

function collectMcpToolArgs(
  command: CommandDef,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const param of command.params) {
    if (values[param.name] !== undefined) {
      args[param.originalName] = coerceAndValidateValue(
        values[param.name],
        param.schema ?? {},
        `--${param.name}`,
      );
    }
  }
  return args;
}

function parseGlobalArgs(argv: string[]): GlobalArgs {
  assertKnownValueOptionsHaveValues(argv, GLOBAL_OPTION_SPEC.valueOptions);

  const { values } = parseArgs({
    args: argv,
    options: {
      spec: { type: 'string' },
      mcp: { type: 'string' },
      'mcp-stdio': { type: 'string' },
      graphql: { type: 'string' },
      'graphql-schema': { type: 'string' },
      'base-url': { type: 'string' },
      'auth-header': { type: 'string', multiple: true },
      transport: { type: 'string' },
      'cache-key': { type: 'string' },
      'cache-ttl': { type: 'string' },
      search: { type: 'string' },
      include: { type: 'string' },
      exclude: { type: 'string' },
      methods: { type: 'string' },
      fields: { type: 'string' },
      'selection-depth': { type: 'string' },
      head: { type: 'string' },
      list: { type: 'boolean' },
      pretty: { type: 'boolean' },
      raw: { type: 'boolean' },
      refresh: { type: 'boolean' },
      stdin: { type: 'boolean' },
      version: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: false,
    allowPositionals: false,
  });

  const authHeaders = stringListOption(values['auth-header']).map(parseHeader);
  const search = stringOption(values.search);
  return {
    ...optionalStringProperty('spec', stringOption(values.spec)),
    ...optionalStringProperty('mcp', stringOption(values.mcp)),
    ...optionalStringProperty('mcpStdio', stringOption(values['mcp-stdio'])),
    ...optionalStringProperty('graphql', stringOption(values.graphql)),
    ...optionalStringProperty('graphqlSchema', stringOption(values['graphql-schema'])),
    ...optionalStringProperty('baseUrl', stringOption(values['base-url'])),
    authHeaders,
    transport: parseTransport(stringOption(values.transport) ?? 'auto'),
    ...optionalStringProperty('cacheKey', stringOption(values['cache-key'])),
    cacheTtl: Number.parseInt(stringOption(values['cache-ttl']) ?? '3600', 10),
    refresh: values.refresh === true,
    list: values.list === true || search !== undefined,
    ...optionalStringProperty('search', search),
    ...optionalStringArrayProperty('include', parseOptionalCommaList(values.include)),
    ...optionalStringArrayProperty('exclude', parseOptionalCommaList(values.exclude)),
    ...optionalStringArrayProperty('methods', parseOptionalCommaList(values.methods)),
    ...optionalStringProperty('fields', stringOption(values.fields)),
    selectionDepth: Number.parseInt(stringOption(values['selection-depth']) ?? '2', 10),
    stdin: values.stdin === true,
    pretty: values.pretty === true,
    raw: values.raw === true,
    ...optionalNumberProperty('head', parseOptionalInteger(values.head)),
    help: values.help === true,
    version: values.version === true,
  };
}

function renderOpenApiCommands(commands: CommandDef[]): string {
  if (commands.length === 0) return 'No commands found.\n';
  return `${commands
    .map((command) =>
      `${command.name.padEnd(32)} ${(command.method ?? '').toUpperCase().padEnd(6)} ${command.description ?? ''}`.trimEnd(),
    )
    .join('\n')}\n`;
}

function renderMcpCommands(commands: CommandDef[]): string {
  if (commands.length === 0) return 'No tools found.\n';
  return `${commands
    .map((command) => `${command.name.padEnd(32)} ${command.description ?? ''}`.trimEnd())
    .join('\n')}\n`;
}

function renderGraphqlCommands(commands: CommandDef[]): string {
  if (commands.length === 0) return 'No GraphQL operations found.\n';
  return `${commands
    .map((command) =>
      `${command.name.padEnd(32)} ${(command.graphqlOperationType ?? '').padEnd(8)} ${command.description ?? ''}`.trimEnd(),
    )
    .join('\n')}\n`;
}

function determineBaseUrl(spec: OpenApiSpec, source: string, override: string | undefined): string {
  if (override !== undefined) return override;
  const servers = Array.isArray(spec.servers) ? spec.servers : [];
  const firstServer = servers[0];
  const serverUrl =
    typeof firstServer === 'object' && firstServer !== null && 'url' in firstServer
      ? String((firstServer as { url: unknown }).url)
      : '';
  if (serverUrl.startsWith('http://') || serverUrl.startsWith('https://')) return serverUrl;
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const origin = new URL(source).origin;
    return serverUrl ? `${origin}${serverUrl}` : origin;
  }
  throw new Error('cannot determine base URL. Use --base-url.');
}

function validateSourceModes(globals: GlobalArgs): void {
  const active = [globals.spec, globals.mcp, globals.mcpStdio, globals.graphql].filter(
    (value) => value !== undefined,
  ).length;
  if (active === 0) {
    printHelp();
    throw new Error('one of --spec, --mcp, --mcp-stdio, or --graphql is required.');
  }
  if (active > 1)
    throw new Error('--spec, --mcp, --mcp-stdio, and --graphql are mutually exclusive.');
}

function assertKnownValueOptionsHaveValues(argv: string[], options: Iterable<string>): void {
  const valueOptions = new Set(options);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || !token.startsWith('--')) continue;

    const option = token.includes('=') ? token.slice(0, token.indexOf('=')) : token;
    if (!valueOptions.has(option) || token.includes('=')) continue;
    if (argv[index + 1] === undefined) throw new Error(`missing value for ${option}`);
  }
}

function stringOption(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stringListOption(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  const single = stringOption(value);
  return single === undefined ? [] : [single];
}

function optionalStringProperty<K extends string>(
  key: K,
  value: string | undefined,
): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

function optionalStringArrayProperty<K extends string>(
  key: K,
  value: string[] | undefined,
): Partial<Record<K, string[]>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string[]>);
}

function optionalNumberProperty<K extends string>(
  key: K,
  value: number | undefined,
): Partial<Record<K, number>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, number>);
}

function parseOptionalCommaList(value: unknown): string[] | undefined {
  const raw = stringOption(value);
  return raw === undefined ? undefined : parseCommaList(raw);
}

function parseOptionalInteger(value: unknown): number | undefined {
  const raw = stringOption(value);
  return raw === undefined ? undefined : Number.parseInt(raw, 10);
}

function stripFlag(argv: string[], flag: string): { argv: string[]; enabled: boolean } {
  let enabled = false;
  const filtered = argv.filter((token) => {
    if (token !== flag) return true;
    enabled = true;
    return false;
  });
  return { argv: filtered, enabled };
}

async function readStdinJson(): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of process.stdin) raw += String(chunk);
  if (raw.trim().length === 0) return {};

  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('--stdin must contain a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function parseCommaList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseTransport(value: string): McpHttpTransport {
  if (value === 'auto' || value === 'streamable' || value === 'sse') return value;
  throw new Error('--transport must be one of: auto, streamable, sse');
}

function parseHeader(header: string): [string, string] {
  const colon = header.indexOf(':');
  if (colon === -1) throw new Error(`invalid auth header format: ${header}`);
  return [header.slice(0, colon).trim(), header.slice(colon + 1).trim()];
}

async function resolveAuthHeaders(
  headers: Array<[string, string]>,
): Promise<Array<[string, string]>> {
  return Promise.all(headers.map(async ([key, value]) => [key, await resolveSecret(value)]));
}

function defaultCacheDir(): string {
  return process.env.SKILL_CREATOR_CACHE_DIR ?? join(homedir(), '.cache', 'skill-creator');
}

function printHelp(): void {
  writeStdout(`npx @asnd/skill-creator [global options] <subcommand> [command options]
npx @asnd/skill-creator generate --template openapi --name NAME --spec URL|FILE --agent AGENT --scope project|global
npx @asnd/skill-creator command install --agent AGENT --scope project|global

Source (mutually exclusive, one required):
  --spec URL|FILE       OpenAPI spec (JSON or YAML, local or remote)
  --mcp URL             MCP server URL (HTTP/SSE)
  --mcp-stdio CMD       MCP server command (stdio transport)
  --graphql URL         GraphQL endpoint URL

Options:
  --auth-header K:V     HTTP header (repeatable)
  --transport TYPE      MCP HTTP transport: auto|streamable|sse (default: auto)
  --base-url URL        Override base URL from spec
  --graphql-schema SRC  GraphQL SDL or introspection JSON schema FILE|URL
  --cache-key KEY       Custom cache key
  --cache-ttl SECONDS   Cache TTL (default: 3600)
  --refresh             Bypass cache
  --list                List available subcommands
  --search PATTERN      Search commands by name or description
  --include GLOBS       Include command globs (comma-separated)
  --exclude GLOBS       Exclude command globs (comma-separated)
  --methods METHODS     OpenAPI method filter, e.g. GET,POST
  --fields FIELDS       Override GraphQL selection set
  --selection-depth N   GraphQL default selection depth (default: 2)
  --stdin               Read GraphQL variables from stdin JSON
  --pretty              Pretty-print JSON output
  --raw                 Print raw response body
  --head N              Limit output to first N array records
  --help, -h            Show help
  --version             Show version
`);
}

function writeStdout(text: string): void {
  console.log(text.replace(/\n$/, ''));
}

export function isCliEntrypoint(metaUrl: string, argv1 = process.argv[1]): boolean {
  if (!argv1) return false;

  const modulePath = fileURLToPath(metaUrl);
  try {
    return realpathSync(argv1) === realpathSync(modulePath);
  } catch {
    return resolve(argv1) === modulePath;
  }
}

if (isCliEntrypoint(import.meta.url)) {
  const code = await run();
  process.exitCode = code;
}
