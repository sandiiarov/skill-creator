import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { improvementDescription, refreshImprovementSkillDescription } from './improvement.js';

let originalCwd: string;
let originalSkillCreatorHome: string | undefined;

beforeEach(() => {
  originalCwd = process.cwd();
  originalSkillCreatorHome = process.env.SKILL_CREATOR_HOME;
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalSkillCreatorHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = originalSkillCreatorHome;
});

describe('skill-creator improvement description', () => {
  it('lists all generated skill names in the activation description', () => {
    expect(improvementDescription(['jira', 'slack', 'exa'])).toBe(
      'Improves skill-creator generated skills by updating SKILL.md Gotchas and verified examples with reusable learnings. Use after using any of these generated skills — jira, slack, exa — if the interaction revealed custom fields, service quirks, faster workflows, corrected commands, or safer usage patterns.',
    );
  });

  it('updates the installed improvement skill description from the lock file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'skill-creator-improvement-'));
    process.chdir(cwd);
    process.env.SKILL_CREATOR_HOME = join(cwd, '.skill-creator-home');

    await mkdir(join(cwd, '.skill-creator-home'), { recursive: true });
    await writeFile(
      join(cwd, '.skill-creator-home/lock.json'),
      JSON.stringify({
        version: 1,
        skills: {
          'pi:project:slack': {
            name: 'slack',
            agent: 'pi',
            scope: 'project',
            path: 'x',
            createdAt: 'a',
            updatedAt: 'b',
          },
          'pi:project:jira': {
            name: 'jira',
            agent: 'pi',
            scope: 'project',
            path: 'y',
            createdAt: 'a',
            updatedAt: 'b',
          },
        },
      }),
    );

    const skillDir = join(cwd, '.pi/skills/skill-creator-improvement');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---\nname: skill-creator-improvement\ndescription: old\n---\n\n# skill-creator improvement\n`,
    );

    await expect(
      refreshImprovementSkillDescription({ agent: 'pi', scope: 'project' }),
    ).resolves.toBe(true);

    const updated = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
    expect(updated).toContain(
      'description: Improves skill-creator generated skills by updating SKILL.md Gotchas and verified examples with reusable learnings. Use after using any of these generated skills — jira, slack — if the interaction revealed custom fields, service quirks, faster workflows, corrected commands, or safer usage patterns.',
    );
  });
});
