import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../../src/cli/main.js';
import { commandFileNameForAgent, resolveAgentCommandDir } from '../../src/commands/agents.js';

let stdout = '';
let stderr = '';
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let originalCwd: string;

beforeEach(() => {
  stdout = '';
  stderr = '';
  originalCwd = process.cwd();
  logSpy = vi.spyOn(console, 'log').mockImplementation((message = '') => {
    stdout += `${String(message)}\n`;
  });
  errorSpy = vi.spyOn(console, 'error').mockImplementation((message = '') => {
    stderr += `${String(message)}\n`;
  });
});

afterEach(() => {
  process.chdir(originalCwd);
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

async function createProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'skill-creator-commands-'));
}

describe('agent command install locations', () => {
  it('resolves command directories for supported agents', () => {
    expect(
      resolveAgentCommandDir('pi', 'project', {
        cwd: '/workspace/app',
        home: '/home/alex',
      }),
    ).toBe('/workspace/app/.pi/prompts');
    expect(
      resolveAgentCommandDir('pi', 'global', {
        cwd: '/workspace/app',
        home: '/home/alex',
      }),
    ).toBe('/home/alex/.pi/agent/prompts');
    expect(
      resolveAgentCommandDir('claude-code', 'project', {
        cwd: '/workspace/app',
        home: '/home/alex',
      }),
    ).toBe('/workspace/app/.claude/commands');
    expect(
      resolveAgentCommandDir('cursor', 'global', {
        cwd: '/workspace/app',
        home: '/home/alex',
      }),
    ).toBe('/home/alex/.cursor/commands');
    expect(
      resolveAgentCommandDir('opencode', 'global', {
        cwd: '/workspace/app',
        home: '/home/alex',
        configHome: '/home/alex/.config',
      }),
    ).toBe('/home/alex/.config/opencode/commands');
    expect(
      resolveAgentCommandDir('gemini-cli', 'project', {
        cwd: '/workspace/app',
        home: '/home/alex',
      }),
    ).toBe('/workspace/app/.gemini/commands');
    expect(
      resolveAgentCommandDir('github-copilot', 'project', {
        cwd: '/workspace/app',
        home: '/home/alex',
      }),
    ).toBe('/workspace/app/.github/prompts');
    expect(
      resolveAgentCommandDir('cline', 'global', {
        cwd: '/workspace/app',
        home: '/home/alex',
      }),
    ).toBe('/home/alex/Documents/Cline/Workflows');
    expect(
      resolveAgentCommandDir('windsurf', 'project', {
        cwd: '/workspace/app',
        home: '/home/alex',
      }),
    ).toBe('/workspace/app/.windsurf/workflows');
  });

  it('uses agent-specific command filenames and rejects unsupported scopes', () => {
    expect(commandFileNameForAgent('pi', 'review')).toBe('review.md');
    expect(commandFileNameForAgent('github-copilot', 'review')).toBe('review.prompt.md');
    expect(commandFileNameForAgent('gemini-cli', 'review')).toBe('review.toml');

    expect(() =>
      resolveAgentCommandDir('codex', 'project', {
        cwd: '/workspace/app',
        home: '/home/alex',
      }),
    ).toThrow('does not support project command installation');
    expect(() =>
      resolveAgentCommandDir('windsurf', 'global', {
        cwd: '/workspace/app',
        home: '/home/alex',
      }),
    ).toThrow('does not support global command installation');
  });
});

describe('command install', () => {
  it('installs a markdown command into the selected Pi prompt scope', async () => {
    const cwd = await createProject();
    process.chdir(cwd);
    const sourcePath = join(cwd, 'review.md');
    const content = `---\ndescription: Review staged changes\nargument-hint: "[focus]"\n---\nReview the staged changes.\nFocus: $ARGUMENTS\n`;
    await writeFile(sourcePath, content);

    const code = await run([
      'command',
      'install',
      '--source',
      sourcePath,
      '--agent',
      'pi',
      '--scope',
      'project',
    ]);

    expect(code).toBe(0);
    expect(await readFile(join(cwd, '.pi/prompts/review.md'), 'utf8')).toBe(content);
    expect(stdout).toContain('Installed command: review');
    expect(stdout).toContain('.pi/prompts');
  });

  it('installs every markdown command from a directory and skips README files', async () => {
    const cwd = await createProject();
    process.chdir(cwd);
    const commandsDir = join(cwd, 'commands');
    await mkdir(commandsDir);
    await writeFile(join(commandsDir, 'review.md'), 'Review the diff.\n');
    await writeFile(join(commandsDir, 'fix.md'), 'Fix the issue.\n');
    await writeFile(join(commandsDir, 'README.md'), '# Not a command\n');

    const code = await run([
      'commands',
      'install',
      commandsDir,
      '--agent',
      'claude-code',
      '--scope',
      'project',
    ]);

    expect(code).toBe(0);
    expect(await readdir(join(cwd, '.claude/commands'))).toEqual(['fix.md', 'review.md']);
    expect(await readFile(join(cwd, '.claude/commands/fix.md'), 'utf8')).toBe('Fix the issue.\n');
  });

  it('installs the bundled skill-creator prompt as a Pi command by default', async () => {
    const cwd = await createProject();
    process.chdir(cwd);

    const code = await run(['command', 'install', '--agent', 'pi', '--scope', 'project']);

    expect(code).toBe(0);
    const installed = await readFile(join(cwd, '.pi/prompts/skill-creator.md'), 'utf8');
    expect(installed).toContain('# Task: create a reusable agent command surface');
    expect(installed).toContain('not for one-off API calls');
    expect(installed).toContain('npx @asnd/skill-creator generate');
    expect(installed).not.toContain('/skill:skill-creator');
    expect(stdout).toContain('Installed command: skill-creator');
  });

  it('packages command prompts instead of a skill', async () => {
    const pkg = JSON.parse(await readFile(join(originalCwd, 'package.json'), 'utf8')) as {
      files: string[];
      pi: { prompts?: string[]; skills?: string[] };
    };

    expect(pkg.files).toContain('prompts');
    expect(pkg.files).not.toContain('skills');
    expect(pkg.pi.prompts).toEqual(['./prompts']);
    expect(pkg.pi.skills).toBeUndefined();
  });

  it('converts portable argument placeholders for Gemini CLI commands', async () => {
    const cwd = await createProject();
    process.chdir(cwd);
    const sourcePath = join(cwd, 'create.md');
    await writeFile(
      sourcePath,
      `---\ndescription: Create from source\n---\nUse this source:\n\n$ARGUMENTS\n`,
    );

    const code = await run([
      'command',
      'install',
      '--source',
      sourcePath,
      '--agent',
      'gemini-cli',
      '--scope',
      'project',
    ]);

    expect(code).toBe(0);
    const toml = await readFile(join(cwd, '.gemini/commands/create.toml'), 'utf8');
    expect(toml).toContain('{{args}}');
    expect(toml).not.toContain('$ARGUMENTS');
  });

  it('renders Gemini CLI commands as TOML from markdown prompts', async () => {
    const cwd = await createProject();
    process.chdir(cwd);
    const sourcePath = join(cwd, 'review.md');
    await writeFile(
      sourcePath,
      `---\ndescription: Review changes\n---\nReview the current changes and report risks.\n`,
    );

    const code = await run([
      'command',
      'install',
      '--source',
      sourcePath,
      '--agent',
      'gemini-cli',
      '--scope',
      'project',
    ]);

    expect(code).toBe(0);
    const toml = await readFile(join(cwd, '.gemini/commands/review.toml'), 'utf8');
    expect(toml).toContain('description = "Review changes"');
    expect(toml).toContain('prompt = "Review the current changes and report risks.\\n"');
    expect(toml).not.toContain('---');
  });
});
