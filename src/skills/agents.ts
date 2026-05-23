import { homedir } from 'node:os';
import { join } from 'node:path';

export type AgentId = keyof typeof AGENT_INSTALL_TARGETS;
export type InstallScope = 'project' | 'global';

export type AgentInstallTarget = {
  displayName: string;
  projectDir: string;
  globalDir: (home: string, configHome: string) => string;
};

// Agent skill locations adapted from vercel-labs/skills (MIT):
// https://github.com/vercel-labs/skills
export const AGENT_INSTALL_TARGETS = {
  pi: {
    displayName: 'Pi',
    projectDir: '.pi/skills',
    globalDir: (home: string) => join(home, '.pi/agent/skills'),
  },
  universal: {
    displayName: 'Universal (.agents)',
    projectDir: '.agents/skills',
    globalDir: (_home: string, configHome: string) => join(configHome, 'agents/skills'),
  },
  codex: {
    displayName: 'Codex',
    projectDir: '.agents/skills',
    globalDir: (home: string) =>
      join(process.env.CODEX_HOME?.trim() || join(home, '.codex'), 'skills'),
  },
  'claude-code': {
    displayName: 'Claude Code',
    projectDir: '.claude/skills',
    globalDir: (home: string) =>
      join(process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude'), 'skills'),
  },
  cursor: {
    displayName: 'Cursor',
    projectDir: '.agents/skills',
    globalDir: (home: string) => join(home, '.cursor/skills'),
  },
  opencode: {
    displayName: 'OpenCode',
    projectDir: '.agents/skills',
    globalDir: (_home: string, configHome: string) => join(configHome, 'opencode/skills'),
  },
  'gemini-cli': {
    displayName: 'Gemini CLI',
    projectDir: '.agents/skills',
    globalDir: (home: string) => join(home, '.gemini/skills'),
  },
  amp: {
    displayName: 'Amp',
    projectDir: '.agents/skills',
    globalDir: (_home: string, configHome: string) => join(configHome, 'agents/skills'),
  },
  'github-copilot': {
    displayName: 'GitHub Copilot',
    projectDir: '.agents/skills',
    globalDir: (home: string) => join(home, '.copilot/skills'),
  },
  goose: {
    displayName: 'Goose',
    projectDir: '.goose/skills',
    globalDir: (_home: string, configHome: string) => join(configHome, 'goose/skills'),
  },
  cline: {
    displayName: 'Cline',
    projectDir: '.agents/skills',
    globalDir: (home: string) => join(home, '.agents/skills'),
  },
  windsurf: {
    displayName: 'Windsurf',
    projectDir: '.windsurf/skills',
    globalDir: (home: string) => join(home, '.codeium/windsurf/skills'),
  },
} as const satisfies Record<string, AgentInstallTarget>;

export function listAgentIds(): AgentId[] {
  return Object.keys(AGENT_INSTALL_TARGETS) as AgentId[];
}

export function isAgentId(value: string): value is AgentId {
  return value in AGENT_INSTALL_TARGETS;
}

export function resolveAgentSkillDir(
  agent: AgentId,
  scope: InstallScope,
  options: { cwd?: string; home?: string; configHome?: string } = {},
): string {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();
  const configHome = options.configHome ?? process.env.XDG_CONFIG_HOME ?? join(home, '.config');
  const target = AGENT_INSTALL_TARGETS[agent];

  return scope === 'project' ? join(cwd, target.projectDir) : target.globalDir(home, configHome);
}

export function assertValidSkillName(name: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    throw new Error(
      '--name must be 1-64 characters and contain only lowercase letters, numbers, and single hyphens',
    );
  }
}
