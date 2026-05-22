import { minimatch } from 'minimatch';

import type { CommandDef } from './types.js';

export type CommandFilters = {
  include?: string[];
  exclude?: string[];
  methods?: string[];
};

export function filterCommands(commands: CommandDef[], filters: CommandFilters = {}): CommandDef[] {
  let result = commands;

  if (filters.methods?.length) {
    const allowed = new Set(filters.methods.map((method) => method.toUpperCase()));
    result = result.filter(
      (command) => command.method === undefined || allowed.has(command.method.toUpperCase()),
    );
  }

  if (filters.include?.length) {
    result = result.filter(
      (command) => filters.include?.some((pattern) => minimatch(command.name, pattern)) ?? false,
    );
  }

  if (filters.exclude?.length) {
    result = result.filter(
      (command) => !(filters.exclude?.some((pattern) => minimatch(command.name, pattern)) ?? false),
    );
  }

  return result;
}
