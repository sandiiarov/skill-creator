import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../cli/main.js';
import { PETSTORE_SPEC } from '../test-fixtures/petstore.js';
import { resolveAgentSkillDir } from './agents.js';

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

async function writeSpec(dir: string): Promise<string> {
  const specPath = join(dir, 'petstore-openapi.json');
  await writeFile(specPath, JSON.stringify(PETSTORE_SPEC, null, 2));
  return specPath;
}

async function createProject(): Promise<{ cwd: string; specPath: string }> {
  const cwd = await mkdtemp(join(tmpdir(), 'skill-creator-generate-'));
  const specPath = await writeSpec(cwd);
  return { cwd, specPath };
}

describe('agent skill install locations', () => {
  it('resolves Pi project and global skill directories', () => {
    expect(
      resolveAgentSkillDir('pi', 'project', {
        cwd: '/workspace/app',
        home: '/home/alex',
      }),
    ).toBe('/workspace/app/.pi/skills');
    expect(
      resolveAgentSkillDir('pi', 'global', {
        cwd: '/workspace/app',
        home: '/home/alex',
      }),
    ).toBe('/home/alex/.pi/agent/skills');
  });
});

describe('generate openapi skill', () => {
  it('creates a spec-compliant OpenAPI skill in the selected agent scope', async () => {
    const { cwd, specPath } = await createProject();
    process.chdir(cwd);

    const code = await run([
      'generate',
      '--template',
      'openapi',
      '--name',
      'youtube',
      '--spec',
      specPath,
      '--agent',
      'pi',
      '--scope',
      'project',
      '--no-test',
    ]);

    expect(code).toBe(0);
    const skillDir = join(cwd, '.pi/skills/youtube');
    const skillMd = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
    const script = await readFile(join(skillDir, 'scripts/youtube'), 'utf8');
    const references = await readdir(join(skillDir, 'references'));
    const specFile = references.find((name) => name.startsWith('openapi-spec-'));

    expectSkillFrontmatter(skillMd, {
      name: 'youtube',
      descriptionPrefix: 'Use YouTube API commands',
    });
    expect(skillMd).toContain('## Start here\n\n```bash\n./scripts/youtube commands list');
    expect(skillMd).toContain(
      '## Usage rules\n\n- Run discovery before calling operations: `commands list`, `commands search`, then `commands help <command>`.',
    );
    expect(skillMd).toContain('Execute operations with `run <command>`.');
    expect(skillMd).toContain('## Output control');
    expect(skillMd).toContain('## Safety');
    expect(skillMd).toContain('references/openapi-spec-');
    expect(script).toMatch(/^#!\/usr\/bin\/env bash\n/);
    expect(script).not.toContain('python');
    expect(script).not.toContain('tsx');
    expect(script).toContain('exec npx -y @asnd/skill-creator \\');
    expect(script).toContain('--spec "${SKILL_DIR}/references/openapi-spec-');
    expect(specFile).toMatch(/^openapi-spec-\d{2}-\d{2}-\d{4}\.json$/);

    const savedSpec = JSON.parse(await readFile(join(skillDir, 'references', specFile!), 'utf8'));
    expect(savedSpec).toEqual(PETSTORE_SPEC);
    expect((await stat(join(skillDir, 'scripts/youtube'))).mode & 0o111).not.toBe(0);
    expect(stdout).toContain('.pi/skills/youtube');
  });

  it('puts auth environment variables in requirements, not setup prose', async () => {
    const { cwd, specPath } = await createProject();
    process.chdir(cwd);

    const code = await run([
      'generate',
      '--template',
      'openapi',
      '--name',
      'exa-public-api',
      '--spec',
      specPath,
      '--auth-header',
      'x-api-key:env:EXA_API_KEY',
      '--agent',
      'pi',
      '--scope',
      'project',
      '--no-test',
    ]);

    expect(code).toBe(0);
    const skillMd = await readFile(join(cwd, '.pi/skills/exa-public-api/SKILL.md'), 'utf8');
    const frontmatter = skillMd.slice(0, skillMd.indexOf('\n---', 4));

    expect(frontmatter).toBe(
      '---\nname: exa-public-api\ndescription: Use Exa Public API commands from a bundled OpenAPI spec. Use when the user needs to list, inspect, test, or call Exa Public API operations from the command line.',
    );
    expect(skillMd).toContain(
      '## Requirements\n\n- `EXA_API_KEY` must be available in the environment for `x-api-key` auth.',
    );
    expect(skillMd).not.toContain('## Setup and auth');
    expect(skillMd).not.toContain('export EXA_API_KEY');
    expect(skillMd).not.toContain('wrapper-auth flags');
  });

  it('supports the requested "agent pi" positional form', async () => {
    const { cwd, specPath } = await createProject();
    process.chdir(cwd);

    const code = await run([
      'generate',
      '--template',
      'openapi',
      '--name',
      'youtube',
      '--spec',
      specPath,
      'agent',
      'pi',
      '--scope',
      'project',
      '--no-test',
    ]);

    expect(code).toBe(0);
    expect(await readFile(join(cwd, '.pi/skills/youtube/SKILL.md'), 'utf8')).toContain(
      'name: youtube',
    );
  });

  it('formats generated skill text without duplicate API suffixes', async () => {
    const { cwd, specPath } = await createProject();
    process.chdir(cwd);

    expect(
      await run([
        'generate',
        '--template',
        'openapi',
        '--name',
        'dogfood-api',
        '--spec',
        specPath,
        '--agent',
        'pi',
        '--scope',
        'project',
        '--no-test',
      ]),
    ).toBe(0);

    const skillMd = await readFile(join(cwd, '.pi/skills/dogfood-api/SKILL.md'), 'utf8');
    expect(skillMd).toContain('# Dogfood API');
    expect(skillMd).toContain('description: Use Dogfood API commands');
    expect(skillMd).not.toContain('API API');
  });

  it('creates a GraphQL skill and saves the schema', async () => {
    const { cwd } = await createProject();
    process.chdir(cwd);
    const schemaPath = join(cwd, 'schema.graphql');
    await writeFile(
      schemaPath,
      'type Query { users(limit: Int): [User!]! }\ntype User { id: ID!, name: String! }\n',
    );

    const code = await run([
      'generate',
      '--template',
      'graphql',
      '--name',
      'dogfood-graphql',
      '--graphql',
      'https://example.com/graphql',
      '--graphql-schema',
      schemaPath,
      '--agent',
      'pi',
      '--scope',
      'project',
      '--no-test',
    ]);

    expect(code).toBe(0);
    const skillDir = join(cwd, '.pi/skills/dogfood-graphql');
    const skillMd = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
    const script = await readFile(join(skillDir, 'scripts/dogfood-graphql'), 'utf8');
    const references = await readdir(join(skillDir, 'references'));
    const schemaFile = references.find((name) => name.startsWith('graphql-schema-'));

    expect(schemaFile).toMatch(/^graphql-schema-\d{2}-\d{2}-\d{4}\.graphql$/);
    expect(await readFile(join(skillDir, 'references', schemaFile!), 'utf8')).toContain(
      'type Query',
    );
    expect(script).toContain('exec npx -y @asnd/skill-creator \\');
    expect(script).toContain('--graphql "https://example.com/graphql" \\');
    expect(script).toContain('--graphql-schema "${SKILL_DIR}/references/graphql-schema-');
    expect(skillMd).toContain('# Dogfood GraphQL API');
    expect(skillMd).toContain('references/graphql-schema-');
    expect(skillMd).not.toContain('GraphQL GraphQL');
  });

  it('creates an MCP HTTP skill without a references directory', async () => {
    const { cwd } = await createProject();
    process.chdir(cwd);

    const code = await run([
      'generate',
      '--template',
      'mcp-http',
      '--name',
      'context7',
      '--mcp',
      'https://mcp.example.com/mcp',
      '--auth-header',
      'Authorization:env:MCP_TOKEN',
      '--agent',
      'pi',
      '--scope',
      'project',
      '--no-test',
    ]);

    expect(code).toBe(0);
    const skillDir = join(cwd, '.pi/skills/context7');
    const entries = await readdir(skillDir);
    const skillMd = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
    const script = await readFile(join(skillDir, 'scripts/context7'), 'utf8');

    expect(entries).not.toContain('references');
    expect(script).toContain('--mcp "https://mcp.example.com/mcp" \\');
    expect(script).toContain('--auth-header "Authorization:env:MCP_TOKEN" \\');
    expect(skillMd).toContain('# Context7 MCP');
    expect(skillMd).toContain('./scripts/context7 commands list');
  });

  it('creates an MCP stdio skill without a references directory', async () => {
    const { cwd } = await createProject();
    process.chdir(cwd);

    const code = await run([
      'generate',
      '--template',
      'mcp-stdio',
      '--name',
      'filesystem-mcp',
      '--mcp-stdio',
      'node server.js --root /tmp',
      '--agent',
      'pi',
      '--scope',
      'project',
      '--no-test',
    ]);

    expect(code).toBe(0);
    const skillDir = join(cwd, '.pi/skills/filesystem-mcp');
    const entries = await readdir(skillDir);
    const skillMd = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
    const script = await readFile(join(skillDir, 'scripts/filesystem-mcp'), 'utf8');

    expect(entries).not.toContain('references');
    expect(script).toContain('--mcp-stdio "node server.js --root /tmp" \\');
    expect(skillMd).toContain('# Filesystem MCP');
    expect(skillMd).toContain('stdio');
    expect(skillMd).toContain('## Verified examples');
    expect(skillMd).toContain('Replace this scaffold section after smoke testing');
    expect(skillMd).toContain('## Gotchas');
    expect(skillMd).toContain('known upstream tool output bugs');
    expect(skillMd).toContain('install/add/apply/write/edit');
  });

  it('refuses to overwrite an existing generated skill unless --force is provided', async () => {
    const { cwd, specPath } = await createProject();
    process.chdir(cwd);
    const args = [
      'generate',
      '--template',
      'openapi',
      '--name',
      'youtube',
      '--spec',
      specPath,
      '--agent',
      'pi',
      '--scope',
      'project',
      '--no-test',
    ];

    expect(await run(args)).toBe(0);
    stdout = '';
    stderr = '';
    expect(await run(args)).toBe(1);
    expect(stderr).toContain('already exists');
    expect(stderr).toContain('--force');

    stderr = '';
    expect(await run([...args, '--force'])).toBe(0);
  });

  it('requires --agent and --scope when running non-interactively', async () => {
    const { cwd, specPath } = await createProject();
    process.chdir(cwd);

    const code = await run([
      'generate',
      '--template',
      'openapi',
      '--name',
      'youtube',
      '--spec',
      specPath,
      '--yes',
      '--no-test',
    ]);

    expect(code).toBe(1);
    expect(stderr).toContain('--agent');
    expect(stderr).toContain('--scope');
  });
});

function expectSkillFrontmatter(
  skillMd: string,
  expected: { name: string; descriptionPrefix: string },
): void {
  const match = /^---\n(?<frontmatter>[\s\S]*?)\n---\n/.exec(skillMd);
  expect(match).not.toBeNull();
  const frontmatter = match?.groups?.frontmatter ?? '';
  const entries = frontmatter.split('\n').map((line) => {
    const separator = line.indexOf(':');
    expect(separator).toBeGreaterThan(0);
    return [line.slice(0, separator), line.slice(separator + 1).trim()] as const;
  });

  expect(entries.map(([key]) => key)).toEqual(['name', 'description']);
  expect(Object.fromEntries(entries)).toMatchObject({
    name: expected.name,
    description: expect.stringMatching(new RegExp(`^${escapeRegExp(expected.descriptionPrefix)}`)),
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
