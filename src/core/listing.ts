import type { CommandDef } from './types.js';
import type { UsageStore } from './usage.js';

export type SortMode = 'usage' | 'recent' | 'alpha' | 'default';

export async function sortCommands(
  commands: CommandDef[],
  sortMode: SortMode,
  sourceHash: string,
  usageStore: UsageStore,
): Promise<CommandDef[]> {
  if (sortMode === 'default') return commands;
  if (sortMode === 'alpha') return [...commands].sort((a, b) => a.name.localeCompare(b.name));

  const usage = (await usageStore.load())[sourceHash] ?? {};
  if (Object.keys(usage).length === 0) return commands;

  if (sortMode === 'usage') {
    return [...commands].sort((a, b) => {
      const diff = (usage[usageKey(b)]?.count ?? 0) - (usage[usageKey(a)]?.count ?? 0);
      return diff || 0;
    });
  }

  return [...commands].sort((a, b) =>
    (usage[usageKey(b)]?.lastUsed ?? '').localeCompare(usage[usageKey(a)]?.lastUsed ?? ''),
  );
}

export async function resolveSortMode(
  explicitSort: SortMode | undefined,
  sourceHash: string,
  usageStore: UsageStore,
): Promise<SortMode> {
  if (explicitSort !== undefined) return explicitSort;
  const usage = (await usageStore.load())[sourceHash] ?? {};
  return Object.keys(usage).length > 0 ? 'usage' : 'default';
}

export async function applyListOptions(
  commands: CommandDef[],
  options: {
    sourceHash: string;
    sortMode?: SortMode;
    top?: number;
    usageStore: UsageStore;
  },
): Promise<CommandDef[]> {
  const effectiveSort = await resolveSortMode(
    options.sortMode,
    options.sourceHash,
    options.usageStore,
  );
  const sorted = await sortCommands(
    commands,
    effectiveSort,
    options.sourceHash,
    options.usageStore,
  );
  return options.top === undefined ? sorted : sorted.slice(0, options.top);
}

function usageKey(command: CommandDef): string {
  return command.toolName ?? command.graphqlFieldName ?? command.name;
}
