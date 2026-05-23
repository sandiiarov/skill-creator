import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { InstallScope } from '../skills/agents.js';

import {
  assertValidCommandName,
  commandFileNameForAgent,
  commandFormatForAgent,
  isCommandAgentId,
  listCommandAgentIds,
  resolveAgentCommandDir,
  type CommandAgentId,
} from './agents.js';

export type InstallCommandArgs = {
  source?: string;
  name?: string;
  agent?: CommandAgentId;
  scope?: InstallScope;
  force: boolean;
  yes: boolean;
  help: boolean;
};

type CommandTemplate = {
  name: string;
  content: string;
  sourcePath: string;
};

export async function runInstallCommand(argv: string[]): Promise<void> {
  const args = await completeInteractiveOptions(parseInstallCommandArgs(argv));

  if (args.help) {
    printInstallCommandHelp();
    return;
  }

  const source = args.source ?? bundledCommandSourcePath();
  if (args.agent === undefined || args.scope === undefined) {
    throw new Error('--agent and --scope are required when prompts are unavailable');
  }

  const templates = await loadCommandTemplates(source, args.name);
  const targetDir = resolveAgentCommandDir(args.agent, args.scope);
  await mkdir(targetDir, { recursive: true });

  for (const template of templates) {
    assertValidCommandName(template.name);
    const targetPath = join(targetDir, commandFileNameForAgent(args.agent, template.name));
    await assertWritableTarget(targetPath, args.force);
    await writeFile(targetPath, renderCommandTemplate(args.agent, template), 'utf8');
  }

  const label = templates.length === 1 ? 'command' : 'commands';
  console.log(`Installed ${label}: ${templates.map((template) => template.name).join(', ')}`);
  console.log(
    `Agent: ${listCommandAgentIds().includes(args.agent) ? args.agent : String(args.agent)}`,
  );
  console.log(`Scope: ${args.scope}`);
  console.log(`Path: ${targetDir}`);
}

function parseInstallCommandArgs(argv: string[]): InstallCommandArgs {
  const args: InstallCommandArgs = {
    force: false,
    yes: false,
    help: false,
  };
  const positional: string[] = [];
  const tokens = argv[0] === 'install' ? argv.slice(1) : argv;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;

    switch (token) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--source':
        args.source = resolve(requireValue(tokens, ++index, token));
        break;
      case '--name':
        args.name = requireValue(tokens, ++index, token);
        break;
      case '--agent':
        args.agent = parseAgent(requireValue(tokens, ++index, token));
        break;
      case '--scope':
        args.scope = parseScope(requireValue(tokens, ++index, token));
        break;
      case '--force':
        args.force = true;
        break;
      case '--yes':
      case '-y':
        args.yes = true;
        break;
      case 'agent':
        args.agent = parseAgent(requireValue(tokens, ++index, token));
        break;
      case 'scope':
        args.scope = parseScope(requireValue(tokens, ++index, token));
        break;
      default:
        if (token.startsWith('-')) throw new Error(`unknown command install option: ${token}`);
        positional.push(token);
    }
  }

  if (args.source === undefined && positional.length > 0) args.source = resolve(positional[0]!);
  if (positional.length > 1) throw new Error('only one command source may be provided');

  return args;
}

async function completeInteractiveOptions(args: InstallCommandArgs): Promise<InstallCommandArgs> {
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
      const agentChoices = listCommandAgentIds();
      console.log(`Agents: ${agentChoices.join(', ')}`);
      completed.agent = parseAgent(await rl.question('Agent to install command for: '));
    }
    if (completed.scope === undefined) {
      completed.scope = parseScope(await rl.question('Install scope (project/global): '));
    }
    return completed;
  } finally {
    rl.close();
  }
}

async function loadCommandTemplates(
  source: string,
  name: string | undefined,
): Promise<CommandTemplate[]> {
  const sourceStat = await stat(source);
  if (sourceStat.isDirectory()) {
    if (name !== undefined) throw new Error('--name can only be used when --source is a file');
    const entries = await readdir(source, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && isMarkdownCommandFile(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    if (files.length === 0) throw new Error(`no markdown command files found in ${source}`);

    return Promise.all(
      files.map(async (fileName) => ({
        name: commandNameFromFileName(fileName),
        content: await readFile(join(source, fileName), 'utf8'),
        sourcePath: join(source, fileName),
      })),
    );
  }

  if (!sourceStat.isFile()) throw new Error(`command source is not a file or directory: ${source}`);
  if (!isMarkdownCommandFile(basename(source))) {
    throw new Error(`command source must be a markdown file: ${source}`);
  }

  const commandName = name ?? commandNameFromFileName(basename(source));
  return [
    {
      name: commandName,
      content: await readFile(source, 'utf8'),
      sourcePath: source,
    },
  ];
}

function isMarkdownCommandFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.md') && lower !== 'readme.md';
}

function commandNameFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.prompt.md')) return fileName.slice(0, -'.prompt.md'.length);
  return fileName.slice(0, -extname(fileName).length);
}

async function assertWritableTarget(targetPath: string, force: boolean): Promise<void> {
  if (!existsSync(targetPath)) return;
  if (!force)
    throw new Error(`command target already exists: ${targetPath}. Use --force to overwrite.`);
  await rm(targetPath, { force: true });
}

function renderCommandTemplate(agent: CommandAgentId, template: CommandTemplate): string {
  if (commandFormatForAgent(agent) === 'gemini-toml') return renderGeminiToml(template.content);
  return template.content.endsWith('\n') ? template.content : `${template.content}\n`;
}

function renderGeminiToml(markdown: string): string {
  const parsed = parseMarkdownPrompt(markdown);
  const prompt = renderGeminiPrompt(parsed.body);
  const lines = [`prompt = ${JSON.stringify(prompt)}`];
  if (parsed.description !== undefined)
    lines.unshift(`description = ${JSON.stringify(parsed.description)}`);
  return `${lines.join('\n')}\n`;
}

function renderGeminiPrompt(markdownPrompt: string): string {
  return markdownPrompt.replaceAll('$ARGUMENTS', '{{args}}').replaceAll('$@', '{{args}}');
}

function parseMarkdownPrompt(markdown: string): {
  body: string;
  description?: string;
} {
  if (!markdown.startsWith('---\n'))
    return { body: markdown.endsWith('\n') ? markdown : `${markdown}\n` };

  const end = markdown.indexOf('\n---\n', 4);
  if (end === -1) return { body: markdown.endsWith('\n') ? markdown : `${markdown}\n` };

  const frontmatter = markdown.slice(4, end);
  const body = markdown.slice(end + '\n---\n'.length);
  const descriptionLine = frontmatter
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('description:'));
  const description = descriptionLine
    ?.slice('description:'.length)
    .trim()
    .replace(/^['"]|['"]$/g, '');

  return {
    body: body.endsWith('\n') ? body : `${body}\n`,
    ...(description === undefined || description.length === 0 ? {} : { description }),
  };
}

function bundledCommandSourcePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../..', 'prompts', 'skill-creator.md');
}

function parseAgent(value: string): CommandAgentId {
  if (isCommandAgentId(value)) return value;
  throw new Error(
    `unknown command agent: ${value}. Valid agents: ${listCommandAgentIds().join(', ')}`,
  );
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

function printInstallCommandHelp(): void {
  console.log(`npx @asnd/skill-creator command install --agent AGENT --scope project|global

Options:
  --source FILE|DIR     Markdown command file or directory of *.md command files (defaults to bundled /skill-creator command)
  --name NAME           Override command name when --source is a file
  --agent AGENT         Target agent, e.g. pi, claude-code, cursor, opencode
  --scope SCOPE         Install scope: project|global
  --force               Overwrite existing command files
  --yes, -y             Non-interactive mode; requires --agent and --scope
  --help, -h            Show this help
`);
}
