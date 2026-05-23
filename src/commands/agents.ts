import { homedir } from 'node:os';
import { join } from 'node:path';

import { AGENT_INSTALL_TARGETS, type AgentId, type InstallScope } from '../skills/agents.js';

export type CommandFormat = 'markdown' | 'gemini-toml';

export type AgentCommandTarget = {
  displayName: string;
  projectDir?: string;
  globalDir?: (home: string, configHome: string) => string;
  format: CommandFormat;
  fileName: (name: string) => string;
};

const markdownFileName = (name: string): string => `${name}.md`;

// Command/prompt locations are agent-specific. Most Markdown locations mirror
// the agents' documented custom slash-command or prompt-template directories.
export const AGENT_COMMAND_TARGETS = {
  pi: {
    displayName: AGENT_INSTALL_TARGETS.pi.displayName,
    projectDir: '.pi/prompts',
    globalDir: (home: string) => join(home, '.pi/agent/prompts'),
    format: 'markdown',
    fileName: markdownFileName,
  },
  universal: {
    displayName: AGENT_INSTALL_TARGETS.universal.displayName,
    projectDir: '.agents/commands',
    globalDir: (_home: string, configHome: string) => join(configHome, 'agents/commands'),
    format: 'markdown',
    fileName: markdownFileName,
  },
  codex: {
    displayName: AGENT_INSTALL_TARGETS.codex.displayName,
    globalDir: (home: string) =>
      join(process.env.CODEX_HOME?.trim() || join(home, '.codex'), 'prompts'),
    format: 'markdown',
    fileName: markdownFileName,
  },
  'claude-code': {
    displayName: AGENT_INSTALL_TARGETS['claude-code'].displayName,
    projectDir: '.claude/commands',
    globalDir: (home: string) =>
      join(process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude'), 'commands'),
    format: 'markdown',
    fileName: markdownFileName,
  },
  cursor: {
    displayName: AGENT_INSTALL_TARGETS.cursor.displayName,
    projectDir: '.cursor/commands',
    globalDir: (home: string) => join(home, '.cursor/commands'),
    format: 'markdown',
    fileName: markdownFileName,
  },
  opencode: {
    displayName: AGENT_INSTALL_TARGETS.opencode.displayName,
    projectDir: '.opencode/commands',
    globalDir: (_home: string, configHome: string) => join(configHome, 'opencode/commands'),
    format: 'markdown',
    fileName: markdownFileName,
  },
  'gemini-cli': {
    displayName: AGENT_INSTALL_TARGETS['gemini-cli'].displayName,
    projectDir: '.gemini/commands',
    globalDir: (home: string) => join(home, '.gemini/commands'),
    format: 'gemini-toml',
    fileName: (name: string) => `${name}.toml`,
  },
  amp: {
    displayName: AGENT_INSTALL_TARGETS.amp.displayName,
    projectDir: '.agents/commands',
    globalDir: (_home: string, configHome: string) => join(configHome, 'amp/commands'),
    format: 'markdown',
    fileName: markdownFileName,
  },
  'github-copilot': {
    displayName: AGENT_INSTALL_TARGETS['github-copilot'].displayName,
    projectDir: '.github/prompts',
    format: 'markdown',
    fileName: (name: string) => `${name}.prompt.md`,
  },
  cline: {
    displayName: AGENT_INSTALL_TARGETS.cline.displayName,
    projectDir: '.clinerules/workflows',
    globalDir: (home: string) => join(home, 'Documents/Cline/Workflows'),
    format: 'markdown',
    fileName: markdownFileName,
  },
  windsurf: {
    displayName: AGENT_INSTALL_TARGETS.windsurf.displayName,
    projectDir: '.windsurf/workflows',
    format: 'markdown',
    fileName: markdownFileName,
  },
} as const satisfies Partial<Record<AgentId, AgentCommandTarget>>;

export type CommandAgentId = keyof typeof AGENT_COMMAND_TARGETS;

export function listCommandAgentIds(): CommandAgentId[] {
  return Object.keys(AGENT_COMMAND_TARGETS) as CommandAgentId[];
}

export function isCommandAgentId(value: string): value is CommandAgentId {
  return value in AGENT_COMMAND_TARGETS;
}

export function resolveAgentCommandDir(
  agent: CommandAgentId,
  scope: InstallScope,
  options: { cwd?: string; home?: string; configHome?: string } = {},
): string {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();
  const configHome = options.configHome ?? process.env.XDG_CONFIG_HOME ?? join(home, '.config');
  const target: AgentCommandTarget = AGENT_COMMAND_TARGETS[agent];

  if (scope === 'project') {
    if (target.projectDir === undefined) {
      throw new Error(`${target.displayName} does not support project command installation`);
    }
    return join(cwd, target.projectDir);
  }

  if (target.globalDir === undefined) {
    throw new Error(`${target.displayName} does not support global command installation`);
  }
  return target.globalDir(home, configHome);
}

export function commandFileNameForAgent(agent: CommandAgentId, name: string): string {
  return AGENT_COMMAND_TARGETS[agent].fileName(name);
}

export function commandFormatForAgent(agent: CommandAgentId): CommandFormat {
  return AGENT_COMMAND_TARGETS[agent].format;
}

export function assertValidCommandName(name: string): void {
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(name) || name.length > 64) {
    throw new Error(
      '--name must be 1-64 characters and contain only lowercase letters, numbers, dots, underscores, and hyphens',
    );
  }
}
