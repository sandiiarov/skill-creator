import { parseArgs, type ParseArgsConfig } from 'node:util';

import type { CommandDef } from '../core/types.js';

import { filterCommands } from '../core/filter.js';
import { formatOutput } from '../core/output.js';

export type DynamicModeGlobals = {
  include?: string[];
  exclude?: string[];
  methods?: string[];
  list: boolean;
  search?: string;
  pretty: boolean;
  raw: boolean;
  head?: number;
};

export type PreparedCommandArgs = {
  argv: string[];
  initialValues?: Record<string, unknown>;
};

export type RunDynamicModeOptions = {
  globals: DynamicModeGlobals;
  commandArgv: string[];
  loadCommands: () => Promise<CommandDef[]> | CommandDef[];
  renderCommands: (commands: CommandDef[]) => string;
  executeCommand: (
    command: CommandDef,
    values: Record<string, unknown>,
    argv: string[],
  ) => Promise<unknown> | unknown;
  prepareCommandArgs?: (argv: string[]) => Promise<PreparedCommandArgs> | PreparedCommandArgs;
  onEmptyCommand?: (commands: CommandDef[]) => Promise<void> | void;
};

export async function runDynamicMode(options: RunDynamicModeOptions): Promise<void> {
  let commands = filterCommands(await options.loadCommands(), options.globals);

  if (options.globals.search !== undefined) {
    commands = searchCommands(commands, options.globals.search);
  }

  if (options.globals.list || options.globals.search !== undefined) {
    writeStdout(options.renderCommands(commands));
    return;
  }

  if (options.commandArgv.length === 0) {
    if (options.onEmptyCommand !== undefined) {
      await options.onEmptyCommand(commands);
      return;
    }

    writeStdout(options.renderCommands(commands));
    return;
  }

  const commandName = options.commandArgv[0];
  if (commandName === undefined) throw new Error('missing subcommand');

  const command = commands.find((candidate) => candidate.name === commandName);
  if (command === undefined) throw new Error(`unknown subcommand: ${commandName}`);

  if (options.commandArgv.includes('--help') || options.commandArgv.includes('-h')) {
    writeStdout(renderCommandHelp(command));
    return;
  }

  const prepared = await prepareCommandArgs(options, options.commandArgv.slice(1));
  const values = parseCommandValues(command, prepared.argv, prepared.initialValues ?? {});
  const result = await options.executeCommand(command, values, prepared.argv);
  writeFormattedOutput(result, options.globals);
}

function searchCommands(commands: CommandDef[], search: string): CommandDef[] {
  const pattern = search.toLowerCase();
  return commands.filter(
    (command) =>
      command.name.toLowerCase().includes(pattern) ||
      (command.description ?? '').toLowerCase().includes(pattern),
  );
}

async function prepareCommandArgs(
  options: RunDynamicModeOptions,
  argv: string[],
): Promise<PreparedCommandArgs> {
  return options.prepareCommandArgs === undefined
    ? { argv }
    : await options.prepareCommandArgs(argv);
}

export function parseCommandValues(
  command: CommandDef,
  argv: string[],
  initialValues: Record<string, unknown> = {},
): Record<string, unknown> {
  const values: Record<string, unknown> = { ...initialValues };
  const params = new Map(command.params.map((param) => [param.name, param]));
  validateCommandOptions(command, argv, params);

  const { values: parsedValues } = parseArgs({
    args: normalizeStringOptionValues(argv, stringParamNames(command)),
    options: commandOptionSpec(command),
    strict: true,
    allowPositionals: true,
  });

  for (const param of command.params) {
    const value = parsedValues[param.name];
    if (value !== undefined) values[param.name] = value;
  }

  for (const param of command.params) {
    if (
      param.required &&
      values[param.name] === undefined &&
      values[param.originalName] === undefined &&
      param.location !== 'body'
    ) {
      throw new Error(`missing required option --${param.name}`);
    }
  }

  return values;
}

function validateCommandOptions(
  command: CommandDef,
  argv: string[],
  params: Map<string, CommandDef['params'][number]>,
): void {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || !token.startsWith('--')) continue;

    const rawFlag = token.slice(2);
    const flag = rawFlag.includes('=') ? rawFlag.slice(0, rawFlag.indexOf('=')) : rawFlag;
    const param = params.get(flag);
    if (param === undefined) throw new Error(`unknown option for ${command.name}: --${flag}`);
    if (param.type !== 'boolean' && !rawFlag.includes('=') && argv[index + 1] === undefined) {
      throw new Error(`missing value for --${flag}`);
    }
  }
}

function commandOptionSpec(command: CommandDef): NonNullable<ParseArgsConfig['options']> {
  return Object.fromEntries(
    command.params.map((param) => [
      param.name,
      { type: param.type === 'boolean' ? 'boolean' : 'string' },
    ]),
  ) as NonNullable<ParseArgsConfig['options']>;
}

function stringParamNames(command: CommandDef): Set<string> {
  return new Set(
    command.params.filter((param) => param.type !== 'boolean').map((param) => param.name),
  );
}

function normalizeStringOptionValues(argv: string[], optionNames: Set<string>): string[] {
  const result: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (
      token !== undefined &&
      next !== undefined &&
      token.startsWith('--') &&
      !token.includes('=') &&
      optionNames.has(token.slice(2)) &&
      next.startsWith('-')
    ) {
      result.push(`${token}=${next}`);
      index += 1;
    } else if (token !== undefined) {
      result.push(token);
    }
  }

  return result;
}

function renderCommandHelp(command: CommandDef): string {
  const lines = [`${command.name}: ${command.description ?? ''}`, '', 'Options:'];
  for (const param of command.params) {
    const required = param.required ? ' (required)' : '';
    lines.push(
      `  --${param.name.padEnd(24)} ${param.description ?? param.originalName}${required}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function writeFormattedOutput(data: unknown, globals: DynamicModeGlobals): void {
  const output = formatOutput(data, {
    pretty: globals.pretty,
    raw: globals.raw,
    ...(globals.head === undefined ? {} : { head: globals.head }),
  });
  if (output.stderr) console.error(output.stderr.replace(/\n$/, ''));
  writeStdout(output.stdout);
}

function writeStdout(text: string): void {
  console.log(text.replace(/\n$/, ''));
}
