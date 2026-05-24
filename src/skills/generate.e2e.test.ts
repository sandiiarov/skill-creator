import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

import { PETSTORE_SPEC } from '../test-fixtures/petstore.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = join(process.cwd(), 'dist/cli/main.js');

beforeAll(async () => {
  await execFileAsync('pnpm', ['build'], { timeout: 120_000 });
}, 180_000);

describe('generate command e2e', () => {
  it('generates a Pi OpenAPI skill with simplified metadata, requirements, and a bash wrapper', async () => {
    const cwd = await createTempProject();
    const specPath = join(cwd, 'petstore.json');
    await writeFile(specPath, JSON.stringify(PETSTORE_SPEC, null, 2));

    const { stdout } = await runCli(cwd, [
      'generate',
      '--template',
      'openapi',
      '--name',
      'petstore-api',
      '--spec',
      specPath,
      '--auth-header',
      'x-api-key:env:PETSTORE_API_KEY',
      '--agent',
      'pi',
      '--scope',
      'project',
      '--no-test',
    ]);

    const skillDir = join(cwd, '.pi/skills/petstore-api');
    const skillMd = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
    const wrapperPath = join(skillDir, 'scripts/petstore-api');
    const wrapper = await readFile(wrapperPath, 'utf8');

    expect(stdout).toContain('Generated skill:');
    expect(stdout).toContain('.pi/skills/petstore-api');
    expectSkillFrontmatter(skillMd, {
      name: 'petstore-api',
      descriptionPrefix: 'Use Petstore API commands',
    });
    expect(skillMd).toContain(
      '## Requirements\n\n- `PETSTORE_API_KEY` must be available in the environment for `x-api-key` auth.',
    );
    expectBashNpxWrapper(wrapper);

    const args = await runWrapperWithFakeNpx(cwd, skillDir, wrapperPath, ['commands', 'list']);
    expect(args).toContain('@asnd/skill-creator\n');
    expect(args).toContain('--spec\n');
    expect(args).toContain('references/openapi-spec-');
    expect(args).toContain('--auth-header\n');
    expect(args).toContain('x-api-key:env:PETSTORE_API_KEY\n');
    expect(args).toContain('commands\n');
    expect(args).toContain('list\n');
  }, 180_000);

  it('generates a Pi GraphQL skill with a saved schema and a bash wrapper', async () => {
    const cwd = await createTempProject();
    const schemaPath = join(cwd, 'schema.graphql');
    await writeFile(
      schemaPath,
      'type Query { users(limit: Int): [User!]! }\ntype User { id: ID!, name: String! }\n',
    );

    await runCli(cwd, [
      'generate',
      '--template',
      'graphql',
      '--name',
      'people-graphql',
      '--graphql',
      'https://example.com/graphql',
      '--graphql-schema',
      schemaPath,
      '--auth-header',
      'Authorization:env:GRAPHQL_TOKEN',
      '--agent',
      'pi',
      '--scope',
      'project',
      '--no-test',
    ]);

    const skillDir = join(cwd, '.pi/skills/people-graphql');
    const skillMd = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
    const wrapperPath = join(skillDir, 'scripts/people-graphql');
    const wrapper = await readFile(wrapperPath, 'utf8');

    expectSkillFrontmatter(skillMd, {
      name: 'people-graphql',
      descriptionPrefix: 'Use People GraphQL API commands',
    });
    expect(skillMd).toContain(
      '## Requirements\n\n- `GRAPHQL_TOKEN` must be available in the environment for `Authorization` auth.',
    );
    expect(skillMd).toContain('references/graphql-schema-');
    expectBashNpxWrapper(wrapper);

    const args = await runWrapperWithFakeNpx(cwd, skillDir, wrapperPath, ['commands', 'list']);
    expect(args).toContain('--graphql\n');
    expect(args).toContain('https://example.com/graphql\n');
    expect(args).toContain('--graphql-schema\n');
    expect(args).toContain('references/graphql-schema-');
    expect(args).toContain('--auth-header\n');
    expect(args).toContain('Authorization:env:GRAPHQL_TOKEN\n');
  }, 180_000);

  it('generates a Pi MCP HTTP skill without references and with a bash wrapper', async () => {
    const cwd = await createTempProject();

    await runCli(cwd, [
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

    const skillDir = join(cwd, '.pi/skills/context7');
    const skillMd = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
    const wrapperPath = join(skillDir, 'scripts/context7');
    const wrapper = await readFile(wrapperPath, 'utf8');

    expectSkillFrontmatter(skillMd, {
      name: 'context7',
      descriptionPrefix: 'Use Context7 MCP tools',
    });
    expect(skillMd).toContain(
      '## Requirements\n\n- `MCP_TOKEN` must be available in the environment for `Authorization` auth.',
    );
    expect(await readdir(skillDir)).not.toContain('references');
    expectBashNpxWrapper(wrapper);

    const args = await runWrapperWithFakeNpx(cwd, skillDir, wrapperPath, ['commands', 'list']);
    expect(args).toContain('--mcp\n');
    expect(args).toContain('https://mcp.example.com/mcp\n');
    expect(args).toContain('--auth-header\n');
    expect(args).toContain('Authorization:env:MCP_TOKEN\n');
  }, 180_000);
});

async function createTempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'skill-creator-e2e-'));
}

async function runCli(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    timeout: 120_000,
  });
}

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

function expectBashNpxWrapper(wrapper: string): void {
  expect(wrapper).toMatch(/^#!\/usr\/bin\/env bash\n/);
  expect(wrapper).toContain('exec npx -y @asnd/skill-creator \\');
  expect(wrapper).not.toContain('python');
  expect(wrapper).not.toContain('tsx');
  expect(wrapper).not.toContain('node ');
}

async function runWrapperWithFakeNpx(
  cwd: string,
  skillDir: string,
  wrapperPath: string,
  args: string[],
): Promise<string> {
  const fakeBin = join(cwd, 'bin');
  const capturedArgs = join(cwd, `npx-args-${Date.now()}.txt`);
  await mkdir(fakeBin, { recursive: true });
  const npxPath = join(fakeBin, 'npx');
  await writeFile(
    npxPath,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > ${JSON.stringify(capturedArgs)}\n`,
  );
  await chmod(npxPath, 0o755);

  await execFileAsync(wrapperPath, args, {
    cwd: skillDir,
    env: {
      ...process.env,
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
    },
    timeout: 30_000,
  });

  return readFile(capturedArgs, 'utf8');
}
