import { printSchema } from 'graphql';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';

import { resolveSecret } from '../core/secrets.js';
import { loadGraphqlSchema } from '../graphql/load.js';
import {
  AGENT_INSTALL_TARGETS,
  assertValidSkillName,
  isAgentId,
  listAgentIds,
  resolveAgentSkillDir,
  type AgentId,
  type InstallScope,
} from './agents.js';
import { upsertManagedSkill } from './lock.js';

const execFileAsync = promisify(execFile);

type GenerateTemplate = 'openapi' | 'graphql' | 'mcp-http' | 'mcp-stdio';

type GenerateArgs = {
  template?: string;
  name?: string;
  script?: string;
  spec?: string;
  graphql?: string;
  graphqlSchema?: string;
  mcp?: string;
  mcpStdio?: string;
  agent?: AgentId;
  scope?: InstallScope;
  force: boolean;
  yes: boolean;
  noTest: boolean;
  authHeaders: string[];
  baseUrl?: string;
  description?: string;
  help: boolean;
};

export async function runGenerate(argv: string[]): Promise<void> {
  const args = await completeInteractiveOptions(parseGenerateArgs(argv));

  if (args.help) {
    printGenerateHelp();
    return;
  }

  if (args.name === undefined) throw new Error('--name is required');
  if (args.agent === undefined || args.scope === undefined) {
    throw new Error('--agent and --scope are required when prompts are unavailable');
  }

  const template = normalizeTemplate(args);
  assertValidSkillName(args.name);
  const scriptName = args.script ?? args.name;
  assertValidSkillName(scriptName);

  const skillRoot = resolveAgentSkillDir(args.agent, args.scope);
  const skillDir = join(skillRoot, args.name);
  await assertWritableTarget(skillDir, args.force);

  const scriptsDir = join(skillDir, 'scripts');
  await mkdir(scriptsDir, { recursive: true });

  const scriptPath = join(scriptsDir, scriptName);
  let skillMd: string;

  if (template === 'openapi') {
    const specSource = required(args.spec, '--spec is required for --template openapi');
    const referencesDir = join(skillDir, 'references');
    await mkdir(referencesDir, { recursive: true });
    const specFileName = `openapi-spec-${formatDateForFile(new Date())}${openApiSpecExtension(specSource)}`;
    await writeFile(join(referencesDir, specFileName), await readSource(specSource));
    await writeFile(scriptPath, renderOpenApiScript(specFileName, args));
    skillMd = renderOpenApiSkillMd(specFileName, scriptName, args);
  } else if (template === 'graphql') {
    const endpoint = required(args.graphql, '--graphql is required for --template graphql');
    const referencesDir = join(skillDir, 'references');
    await mkdir(referencesDir, { recursive: true });
    const schemaFileName = await saveGraphqlSchema(referencesDir, args);
    await writeFile(scriptPath, renderGraphqlScript(endpoint, schemaFileName, args));
    skillMd = renderGraphqlSkillMd(schemaFileName, scriptName, args);
  } else if (template === 'mcp-http') {
    const endpoint = required(args.mcp, '--mcp is required for --template mcp-http');
    await writeFile(scriptPath, renderMcpHttpScript(endpoint, args));
    skillMd = renderMcpSkillMd(scriptName, args, 'http');
  } else {
    const command = required(args.mcpStdio, '--mcp-stdio is required for --template mcp-stdio');
    await writeFile(scriptPath, renderMcpStdioScript(command));
    skillMd = renderMcpSkillMd(scriptName, args, 'stdio');
  }

  await chmod(scriptPath, 0o755);
  await writeFile(join(skillDir, 'SKILL.md'), skillMd);

  if (!args.noTest) await smokeTestScript(scriptPath);

  await upsertManagedSkill({
    name: args.name,
    agent: args.agent,
    scope: args.scope,
    path: skillDir,
    script: scriptName,
    template,
  });

  console.log(`Generated skill: ${skillDir}`);
  console.log(`Agent: ${AGENT_INSTALL_TARGETS[args.agent].displayName}`);
  console.log(`Scope: ${args.scope}`);
  console.log(`Try: ${join('.', 'scripts', scriptName)} commands list`);
}

function parseGenerateArgs(argv: string[]): GenerateArgs {
  const args: GenerateArgs = {
    force: false,
    yes: false,
    noTest: false,
    authHeaders: [],
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;

    switch (token) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--template':
        args.template = requireValue(argv, ++index, token);
        break;
      case '--name':
        args.name = requireValue(argv, ++index, token);
        break;
      case '--script':
        args.script = requireValue(argv, ++index, token);
        break;
      case '--spec':
        args.spec = requireValue(argv, ++index, token);
        break;
      case '--graphql':
        args.graphql = requireValue(argv, ++index, token);
        break;
      case '--graphql-schema':
        args.graphqlSchema = requireValue(argv, ++index, token);
        break;
      case '--mcp':
        args.mcp = requireValue(argv, ++index, token);
        break;
      case '--mcp-stdio':
        args.mcpStdio = requireValue(argv, ++index, token);
        break;
      case '--agent':
        args.agent = parseAgent(requireValue(argv, ++index, token));
        break;
      case '--scope':
        args.scope = parseScope(requireValue(argv, ++index, token));
        break;
      case '--auth-header':
        args.authHeaders.push(requireValue(argv, ++index, token));
        break;
      case '--base-url':
        args.baseUrl = requireValue(argv, ++index, token);
        break;
      case '--description':
        args.description = requireValue(argv, ++index, token);
        break;
      case '--force':
        args.force = true;
        break;
      case '--yes':
      case '-y':
        args.yes = true;
        break;
      case '--no-test':
        args.noTest = true;
        break;
      case 'agent':
        args.agent = parseAgent(requireValue(argv, ++index, token));
        break;
      case 'scope':
        args.scope = parseScope(requireValue(argv, ++index, token));
        break;
      default:
        if (token.startsWith('-')) throw new Error(`unknown generate option: ${token}`);
        throw new Error(`unexpected generate argument: ${token}`);
    }
  }

  return args;
}

async function completeInteractiveOptions(args: GenerateArgs): Promise<GenerateArgs> {
  if (args.help || (args.agent !== undefined && args.scope !== undefined)) return args;

  if (args.yes || !process.stdin.isTTY || !process.stdout.isTTY) return args;

  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const completed = { ...args };
    if (completed.agent === undefined) {
      const agentChoices = listAgentIds();
      console.log(`Agents: ${agentChoices.join(', ')}`);
      completed.agent = parseAgent(await rl.question('Agent to install for: '));
    }
    if (completed.scope === undefined) {
      completed.scope = parseScope(await rl.question('Install scope (project/global): '));
    }
    return completed;
  } finally {
    rl.close();
  }
}

function normalizeTemplate(args: GenerateArgs): GenerateTemplate {
  if (args.template === 'mcp') {
    if (args.mcp !== undefined && args.mcpStdio === undefined) return 'mcp-http';
    if (args.mcpStdio !== undefined && args.mcp === undefined) return 'mcp-stdio';
    throw new Error('--template mcp requires exactly one of --mcp or --mcp-stdio');
  }

  if (
    args.template === 'openapi' ||
    args.template === 'graphql' ||
    args.template === 'mcp-http' ||
    args.template === 'mcp-stdio'
  ) {
    return args.template;
  }

  throw new Error('--template must be one of: openapi, graphql, mcp-http, mcp-stdio, mcp');
}

async function assertWritableTarget(skillDir: string, force: boolean): Promise<void> {
  if (!existsSync(skillDir)) return;
  if (!force)
    throw new Error(`skill target already exists: ${skillDir}. Use --force to overwrite.`);
  await rm(skillDir, { recursive: true, force: true });
}

async function readSource(source: string): Promise<Buffer> {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`failed to download source: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  return readFile(source);
}

async function saveGraphqlSchema(referencesDir: string, args: GenerateArgs): Promise<string> {
  const schemaSource = args.graphqlSchema;
  const schemaFileName = `graphql-schema-${formatDateForFile(new Date())}${graphqlSchemaExtension(schemaSource)}`;
  const schemaPath = join(referencesDir, schemaFileName);

  if (schemaSource !== undefined) {
    await writeFile(schemaPath, await readSource(schemaSource));
    return schemaFileName;
  }

  const endpoint = required(args.graphql, '--graphql is required for --template graphql');
  const schema = await loadGraphqlSchema(endpoint, {
    authHeaders: await resolveAuthHeaders(args.authHeaders),
    refresh: true,
  });
  await writeFile(schemaPath, `${printSchema(schema)}\n`);
  return schemaFileName;
}

function renderOpenApiScript(specFileName: string, args: GenerateArgs): string {
  const optionLines = [`--spec "\${SKILL_DIR}/references/${specFileName}"`];
  if (args.baseUrl !== undefined) {
    optionLines.push(`--base-url "${shellDoubleQuote(args.baseUrl)}"`);
  }
  appendAuthHeaderOptions(optionLines, args.authHeaders);
  return renderSkillCreatorScript(optionLines);
}

function renderGraphqlScript(endpoint: string, schemaFileName: string, args: GenerateArgs): string {
  const optionLines = [
    `--graphql "${shellDoubleQuote(endpoint)}"`,
    `--graphql-schema "\${SKILL_DIR}/references/${schemaFileName}"`,
  ];
  appendAuthHeaderOptions(optionLines, args.authHeaders);
  return renderSkillCreatorScript(optionLines);
}

function renderMcpHttpScript(endpoint: string, args: GenerateArgs): string {
  const optionLines = [`--mcp "${shellDoubleQuote(endpoint)}"`];
  appendAuthHeaderOptions(optionLines, args.authHeaders);
  return renderSkillCreatorScript(optionLines);
}

function renderMcpStdioScript(command: string): string {
  return renderSkillCreatorScript([`--mcp-stdio "${shellDoubleQuote(command)}"`]);
}

function renderSkillCreatorScript(optionLines: string[]): string {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"',
    'SKILL_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"',
    '',
    'exec npx -y @asnd/skill-creator \\',
    ...optionLines.map((line) => `  ${line} \\`),
    '  "$@"',
    '',
  ].join('\n');
}

function renderOpenApiSkillMd(
  specFileName: string,
  scriptName: string,
  args: GenerateArgs,
): string {
  const apiName = titleWithSuffix(args.name ?? scriptName, 'API');
  const description =
    args.description ??
    `Use ${apiName} commands from a bundled OpenAPI spec. Use when the user needs to list, inspect, test, or call ${apiName} operations from the command line.`;

  return renderApiSkillMd({
    name: args.name ?? scriptName,
    title: apiName,
    description,
    scriptName,
    referenceLine: `- \`references/${specFileName}\` — bundled OpenAPI spec used by \`scripts/${scriptName}\`.`,
    workflowIntro: `Use the bundled wrapper script to discover and call ${apiName} operations. Global skill-creator options go before the subcommand; operation-specific options go after it.`,
    requirements: authRequirementLines(args.authHeaders),
  });
}

function renderGraphqlSkillMd(
  schemaFileName: string,
  scriptName: string,
  args: GenerateArgs,
): string {
  const apiName = titleWithSuffix(args.name ?? scriptName, 'GraphQL API');
  const description =
    args.description ??
    `Use ${apiName} commands from a saved GraphQL schema. Use when the user needs to list, inspect, query, or mutate ${apiName} operations from the command line.`;

  return renderApiSkillMd({
    name: args.name ?? scriptName,
    title: apiName,
    description,
    scriptName,
    referenceLine: `- \`references/${schemaFileName}\` — saved GraphQL schema used by \`scripts/${scriptName}\`.`,
    workflowIntro: `Use the bundled wrapper script to discover and call ${apiName} operations. Global skill-creator options go before the subcommand; operation-specific options go after it.`,
    requirements: authRequirementLines(args.authHeaders),
    extraGotchas: [
      '- Use `--fields` to keep GraphQL selection sets precise and avoid oversized nested responses.',
      '- Use `--stdin` for complex GraphQL variables that are easier to pass as JSON.',
    ],
  });
}

function renderApiSkillMd(options: {
  name: string;
  title: string;
  description: string;
  scriptName: string;
  workflowIntro: string;
  referenceLine: string;
  requirements?: string[];
  extraGotchas?: string[];
}): string {
  return `---
name: ${options.name}
description: ${options.description}
---

# ${options.title}

${options.workflowIntro}

${renderRequirementsSection(options.requirements)}## Start here

\`\`\`bash
./scripts/${options.scriptName} commands list
./scripts/${options.scriptName} commands search '<topic>'
./scripts/${options.scriptName} commands help <command>
./scripts/${options.scriptName} run --pretty <command> <flags>
\`\`\`

## Usage rules

- Run discovery before calling operations: \`commands list\`, \`commands search\`, then \`commands help <command>\`.
- Execute operations with \`run <command>\`.
- Put wrapper run flags after \`run\` and before the command; put operation flags after it.
- Pass JSON object/array flags as quoted JSON strings.
- Start with safe read-only operations before using write/admin operations.

## Output control

- Keep first results bounded: use \`--head 3\`, API limit flags, pagination/cursors, or narrow IDs.
- Use \`--fields a,b,c\` for top-level or dotted field selection when only a subset is needed.
- Use \`--pretty\` for readable JSON.
- For binary, raw, or large responses, redirect to a file instead of printing: \`--raw > response.bin\`.

## Gotchas

No gotchas learned yet. When real usage reveals stable custom fields, service quirks, faster command patterns, or corrected examples, update this section directly.
${options.extraGotchas === undefined ? '' : `\n${options.extraGotchas.join('\n')}`}

## Safety

- Treat create/update/delete/cancel/trigger/import/webhook/admin/research operations as mutating or potentially costly.
- Do not run mutating operations unless the user explicitly asks and provides safe target IDs or test data.

## References

${options.referenceLine}
`;
}

function renderMcpSkillMd(
  scriptName: string,
  args: GenerateArgs,
  transport: 'http' | 'stdio',
): string {
  const title = titleWithSuffix(args.name ?? scriptName, 'MCP');
  const transportLabel = transport === 'stdio' ? 'stdio' : 'HTTP/SSE';
  const description =
    args.description ??
    `Use ${title} tools over MCP ${transportLabel}. Use when the user needs to list, inspect, or call ${title} tools from the command line.`;

  return `---
name: ${args.name ?? scriptName}
description: ${description}
---

# ${title}

Use the bundled Bash wrapper to discover and call ${title} tools over MCP ${transportLabel}.

${renderRequirementsSection(authRequirementLines(args.authHeaders))}## Start here

\`\`\`bash
./scripts/${scriptName} commands list
./scripts/${scriptName} commands search '<topic>'
./scripts/${scriptName} commands help <tool>
./scripts/${scriptName} run --pretty <tool> <flags>
\`\`\`

## Usage rules

- Run discovery before calling tools: \`commands list\`, \`commands search\`, then \`commands help <tool>\`.
- Execute tools with \`run <tool>\`.
- Put wrapper run flags after \`run\` and before the tool name; put tool-specific flags after it.
- Pass JSON object/array flags as quoted JSON strings.
- MCP ${transportLabel} tool lists can change at runtime; rerun \`commands list\` when a tool is missing.

## Verified examples

Replace this scaffold section after smoke testing with one or two safe, source-specific commands that actually worked. Keep examples bounded and read-only, for example:

\`\`\`bash
./scripts/${scriptName} run --pretty <safe-read-tool> <flags>
\`\`\`

## Gotchas

Replace this scaffold section after smoke testing with concise source-specific quirks, such as required project files, default registry names, path normalization, auth/runtime requirements, known upstream tool output bugs, or which helper tool returns the real install command. Remove this section if there are no gotchas.

## Output control

- Keep first results bounded with \`--head 3\`, tool limit flags, pagination/cursors, or narrow IDs.
- Use \`--fields a,b,c\` for top-level or dotted field selection when only a subset is needed.
- Use \`--pretty\` for readable JSON.
- For binary, raw, or large responses, redirect to a file instead of printing: \`--raw > response.bin\`.

## Safety

- Treat create/update/delete/cancel/trigger/admin/install/add/apply/write/edit operations as mutating or potentially costly.
- Do not run mutating tools or generated install commands unless the user explicitly asks and provides safe target IDs, files, or test data.
`;
}

function renderRequirementsSection(requirements: string[] | undefined): string {
  if (requirements === undefined || requirements.length === 0) return '';
  return `## Requirements\n\n${requirements.join('\n')}\n\n`;
}

function authRequirementLines(authHeaders: string[]): string[] {
  return authHeaders.map((header) => {
    const [headerName, value] = parseHeader(header);
    if (value.startsWith('env:')) {
      const envName = value.slice('env:'.length);
      return `- \`${envName}\` must be available in the environment for \`${headerName}\` auth.`;
    }
    if (value.startsWith('file:')) {
      const filePath = value.slice('file:'.length);
      return `- Auth token file \`${filePath}\` must be readable for \`${headerName}\` auth.`;
    }
    return `- \`${headerName}\` auth must be configured before calling protected operations.`;
  });
}

async function smokeTestScript(scriptPath: string): Promise<void> {
  try {
    await execFileAsync(scriptPath, ['commands', 'list'], { timeout: 120_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`generated script smoke test failed: ${message}`);
  }
}

function appendAuthHeaderOptions(optionLines: string[], authHeaders: string[]): void {
  for (const header of authHeaders) {
    optionLines.push(`--auth-header "${shellDoubleQuote(header)}"`);
  }
}

async function resolveAuthHeaders(headers: string[]): Promise<Array<[string, string]>> {
  return Promise.all(
    headers.map(async (header) => {
      const [key, value] = parseHeader(header);
      return [key, await resolveSecret(value)];
    }),
  );
}

function parseHeader(header: string): [string, string] {
  const colon = header.indexOf(':');
  if (colon === -1) throw new Error(`invalid auth header format: ${header}`);
  return [header.slice(0, colon).trim(), header.slice(colon + 1).trim()];
}

function parseAgent(value: string): AgentId {
  if (isAgentId(value)) return value;
  throw new Error(`unknown agent: ${value}. Valid agents: ${listAgentIds().join(', ')}`);
}

function parseScope(value: string): InstallScope {
  if (value === 'project' || value === 'global') return value;
  throw new Error('--scope must be project or global');
}

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${option}`);
  return value;
}

function required(value: string | undefined, message: string): string {
  if (value === undefined) throw new Error(message);
  return value;
}

function openApiSpecExtension(source: string): '.json' | '.yaml' {
  const pathname = urlPathnameOrSource(source);
  const ext = extname(pathname).toLowerCase();
  return ext === '.yaml' || ext === '.yml' ? '.yaml' : '.json';
}

function graphqlSchemaExtension(source: string | undefined): '.graphql' | '.json' {
  if (source === undefined) return '.graphql';
  const ext = extname(urlPathnameOrSource(source)).toLowerCase();
  return ext === '.json' ? '.json' : '.graphql';
}

function urlPathnameOrSource(source: string): string {
  return source.startsWith('http://') || source.startsWith('https://')
    ? new URL(source).pathname
    : source;
}

function formatDateForFile(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${month}-${day}-${year}`;
}

function titleWithSuffix(skillName: string, suffix: string): string {
  const name = displayName(skillName);
  if (name.endsWith(suffix)) return name;
  if (suffix === 'GraphQL API' && name.endsWith(' GraphQL')) return `${name} API`;
  return `${name} ${suffix}`;
}

function displayName(skillName: string): string {
  if (skillName.toLowerCase() === 'youtube') return 'YouTube';
  return skillName
    .split('-')
    .filter((part) => part.length > 0)
    .map(formatDisplayPart)
    .join(' ');
}

function formatDisplayPart(part: string): string {
  const acronyms: Record<string, string> = {
    api: 'API',
    graphql: 'GraphQL',
    http: 'HTTP',
    mcp: 'MCP',
  };
  return acronyms[part.toLowerCase()] ?? `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`;
}

function shellDoubleQuote(value: string): string {
  return value.replace(/[\\"$`]/g, (character) => `\\${character}`);
}

function printGenerateHelp(): void {
  console.log(`npx @asnd/skill-creator generate --template TEMPLATE --name NAME --agent AGENT --scope project|global

Templates:
  openapi       Requires --spec URL|FILE
  graphql      Requires --graphql URL; optionally --graphql-schema URL|FILE
  mcp-http     Requires --mcp URL
  mcp-stdio    Requires --mcp-stdio CMD
  mcp          Alias; chooses mcp-http or mcp-stdio from provided source flag

Options:
  --template TEMPLATE     openapi|graphql|mcp-http|mcp-stdio|mcp
  --name NAME             Spec-compliant skill name, e.g. youtube
  --script NAME           Script name (defaults to --name)
  --spec URL|FILE         OpenAPI spec to bundle into references/
  --graphql URL           GraphQL endpoint URL
  --graphql-schema SRC    SDL or introspection JSON schema to save into references/
  --mcp URL               MCP HTTP/SSE endpoint URL
  --mcp-stdio CMD         MCP stdio server command
  --agent AGENT           Target agent, e.g. pi, codex, claude-code, cursor
  --scope SCOPE           Install scope: project|global
  --auth-header K:V       Add auth header to generated wrapper (repeatable)
  --base-url URL          Add OpenAPI base URL override to generated wrapper
  --description TEXT      Override generated SKILL.md description
  --force                 Overwrite an existing skill directory
  --yes, -y               Non-interactive mode; requires --agent and --scope
  --no-test               Skip generated script smoke test
  --help, -h              Show this help
`);
}
