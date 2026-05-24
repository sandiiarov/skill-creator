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
  fields?: string;
  selectionDepth?: number;
  stdin?: boolean;
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

  if (options.commandArgv[0] === 'commands') {
    handleCommandsNamespace(options, commands, options.commandArgv.slice(1));
    return;
  }

  if (options.commandArgv[0] === 'run') {
    const parsed = parseRunNamespace(options.commandArgv.slice(1));
    Object.assign(options.globals, parsed.globals);
    await executeDynamicCommand(options, commands, parsed.commandArgv);
    return;
  }

  await executeDynamicCommand(options, commands, options.commandArgv);
}

function handleCommandsNamespace(
  options: RunDynamicModeOptions,
  commands: CommandDef[],
  argv: string[],
): void {
  const action = argv[0];
  if (action === undefined) throw new Error('missing commands action: use list, search, or help');

  if (action === 'list') {
    writeStdout(options.renderCommands(commands));
    return;
  }

  if (action === 'search') {
    const pattern = argv[1];
    if (pattern === undefined) throw new Error('missing search pattern');
    writeStdout(options.renderCommands(searchCommands(commands, pattern)));
    return;
  }

  if (action === 'help') {
    const commandName = argv[1];
    if (commandName === undefined) throw new Error('missing command name for commands help');
    const command = findCommand(commands, commandName);
    writeStdout(renderCommandHelp(command));
    return;
  }

  throw new Error(`unknown commands action: ${action}`);
}

async function executeDynamicCommand(
  options: RunDynamicModeOptions,
  commands: CommandDef[],
  commandArgv: string[],
): Promise<void> {
  const commandName = commandArgv[0];
  if (commandName === undefined) throw new Error('missing subcommand');

  const command = findCommand(commands, commandName);

  if (commandArgv.includes('--help') || commandArgv.includes('-h')) {
    writeStdout(renderCommandHelp(command));
    return;
  }

  const prepared = await prepareCommandArgs(options, commandArgv.slice(1));
  const values = parseCommandValues(command, prepared.argv, prepared.initialValues ?? {});
  const result = await options.executeCommand(command, values, prepared.argv);
  writeFormattedOutput(result, options.globals);
}

function findCommand(commands: CommandDef[], name: string): CommandDef {
  const command = commands.find((candidate) => candidate.name === name);
  if (command === undefined) throw new Error(`unknown subcommand: ${name}`);
  return command;
}

function parseRunNamespace(argv: string[]): {
  globals: Partial<DynamicModeGlobals>;
  commandArgv: string[];
} {
  const globalArgv: string[] = [];
  let index = 0;

  while (index < argv.length) {
    const token = argv[index];
    if (token === undefined) break;
    if (!token.startsWith('-')) break;

    const option = token.includes('=') ? token.slice(0, token.indexOf('=')) : token;
    if (option === '--pretty' || option === '--raw' || option === '--stdin') {
      globalArgv.push(token);
      index += 1;
      continue;
    }

    if (option === '--head' || option === '--fields' || option === '--selection-depth') {
      globalArgv.push(token);
      if (!token.includes('=')) {
        const value = argv[index + 1];
        if (value === undefined) throw new Error(`missing value for ${option}`);
        globalArgv.push(value);
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }

    throw new Error(
      `unknown run option ${option}; wrapper run options must appear before the command, command options after it`,
    );
  }

  const { values } = parseArgs({
    args: globalArgv,
    options: {
      pretty: { type: 'boolean' },
      raw: { type: 'boolean' },
      stdin: { type: 'boolean' },
      head: { type: 'string' },
      fields: { type: 'string' },
      'selection-depth': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });

  return {
    globals: {
      ...(values.pretty === true ? { pretty: true } : {}),
      ...(values.raw === true ? { raw: true } : {}),
      ...(values.stdin === true ? { stdin: true } : {}),
      ...(typeof values.head === 'string' ? { head: Number.parseInt(values.head, 10) } : {}),
      ...(typeof values.fields === 'string' ? { fields: values.fields } : {}),
      ...(typeof values['selection-depth'] === 'string'
        ? { selectionDepth: Number.parseInt(values['selection-depth'], 10) }
        : {}),
    },
    commandArgv: argv.slice(index),
  };
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
