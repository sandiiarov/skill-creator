import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { run } from '../cli/main.js';
import { PETSTORE_SPEC } from '../test-fixtures/petstore.js';

let originalCwd: string;
let originalSkillCreatorHome: string | undefined;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  originalCwd = process.cwd();
  originalSkillCreatorHome = process.env.SKILL_CREATOR_HOME;
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalSkillCreatorHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = originalSkillCreatorHome;
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('skill-creator improvement E2E', () => {
  it('installs improvement skill with existing generated skill names from the lock', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'skill-creator-improvement-e2e-'));
    process.chdir(cwd);
    process.env.SKILL_CREATOR_HOME = join(cwd, '.skill-creator-home');

    const specPath = join(cwd, 'petstore-openapi.json');
    await writeFile(specPath, JSON.stringify(PETSTORE_SPEC, null, 2));

    for (const name of ['jira', 'slack']) {
      await expect(
        run([
          'generate',
          '--template',
          'openapi',
          '--name',
          name,
          '--spec',
          specPath,
          '--agent',
          'pi',
          '--scope',
          'project',
          '--no-test',
        ]),
      ).resolves.toBe(0);
    }

    await expect(run(['command', 'install', '--agent', 'pi', '--scope', 'project'])).resolves.toBe(
      0,
    );

    const improvementSkill = await readFile(
      join(cwd, '.pi/skills/skill-creator-improvement/SKILL.md'),
      'utf8',
    );
    expect(improvementSkill).toContain(
      'Use after using any of these generated skills — jira, slack — if the interaction revealed custom fields',
    );
  });

  it('treats --no-improvement-skill as a no-op for later refreshes', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'skill-creator-improvement-e2e-'));
    process.chdir(cwd);
    process.env.SKILL_CREATOR_HOME = join(cwd, '.skill-creator-home');

    const specPath = join(cwd, 'petstore-openapi.json');
    await writeFile(specPath, JSON.stringify(PETSTORE_SPEC, null, 2));

    await expect(
      run(['command', 'install', '--agent', 'pi', '--scope', 'project', '--no-improvement-skill']),
    ).resolves.toBe(0);

    await expect(
      run([
        'generate',
        '--template',
        'openapi',
        '--name',
        'jira',
        '--spec',
        specPath,
        '--agent',
        'pi',
        '--scope',
        'project',
        '--no-test',
      ]),
    ).resolves.toBe(0);

    await expect(
      readFile(join(cwd, '.pi/skills/skill-creator-improvement/SKILL.md'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refreshes installed improvement skill description after generated skills update the lock', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'skill-creator-improvement-e2e-'));
    process.chdir(cwd);
    process.env.SKILL_CREATOR_HOME = join(cwd, '.skill-creator-home');

    const specPath = join(cwd, 'petstore-openapi.json');
    await writeFile(specPath, JSON.stringify(PETSTORE_SPEC, null, 2));

    await expect(run(['command', 'install', '--agent', 'pi', '--scope', 'project'])).resolves.toBe(
      0,
    );

    const improvementSkillPath = join(cwd, '.pi/skills/skill-creator-improvement/SKILL.md');
    expect(await readFile(improvementSkillPath, 'utf8')).toContain(
      'Use after using a generated skill if the interaction revealed custom fields',
    );

    await expect(
      run([
        'generate',
        '--template',
        'openapi',
        '--name',
        'jira',
        '--spec',
        specPath,
        '--agent',
        'pi',
        '--scope',
        'project',
        '--no-test',
      ]),
    ).resolves.toBe(0);

    expect(await readFile(improvementSkillPath, 'utf8')).toContain(
      'Use after using any of these generated skills — jira — if the interaction revealed custom fields',
    );

    await expect(
      run([
        'generate',
        '--template',
        'openapi',
        '--name',
        'slack',
        '--spec',
        specPath,
        '--agent',
        'pi',
        '--scope',
        'project',
        '--no-test',
      ]),
    ).resolves.toBe(0);

    const refreshed = await readFile(improvementSkillPath, 'utf8');
    expect(refreshed).toContain(
      'Use after using any of these generated skills — jira, slack — if the interaction revealed custom fields',
    );
    const frontmatter = refreshed.slice(0, refreshed.indexOf('\n---\n', 4));
    expect(frontmatter).not.toContain('lock.json');
  });
});
