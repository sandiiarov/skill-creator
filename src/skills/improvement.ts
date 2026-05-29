import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isAgentId, resolveAgentSkillDir, type AgentId, type InstallScope } from './agents.js';
import { readLock } from './lock.js';

const IMPROVEMENT_SKILL_NAME = 'skill-creator-improvement';

export async function refreshImprovementSkillDescription(options: {
  agent: string;
  scope: InstallScope;
}): Promise<boolean> {
  if (!isAgentId(options.agent)) return false;

  const skillPath = join(
    resolveAgentSkillDir(options.agent as AgentId, options.scope),
    IMPROVEMENT_SKILL_NAME,
    'SKILL.md',
  );

  try {
    await access(skillPath);
  } catch {
    return false;
  }

  const lock = await readLock();
  const names = Array.from(new Set(Object.values(lock.skills).map((entry) => entry.name))).sort(
    (left, right) => left.localeCompare(right),
  );
  const markdown = await readFile(skillPath, 'utf8');
  await writeFile(
    skillPath,
    replaceFrontmatterDescription(markdown, improvementDescription(names)),
  );
  return true;
}

export function improvementDescription(skillNames: string[]): string {
  const base =
    'Improves skill-creator generated skills by updating SKILL.md Gotchas and verified examples with reusable learnings.';
  const trigger =
    'if the interaction revealed custom fields, service quirks, faster workflows, corrected commands, or safer usage patterns.';

  if (skillNames.length === 0) return `${base} Use after using a generated skill ${trigger}`;

  return `${base} Use after using any of these generated skills — ${skillNames.join(', ')} — ${trigger}`;
}

function replaceFrontmatterDescription(markdown: string, description: string): string {
  const frontmatterEnd = markdown.indexOf('\n---\n', 4);
  if (!markdown.startsWith('---\n') || frontmatterEnd === -1) {
    throw new Error('skill-creator-improvement SKILL.md must start with YAML frontmatter');
  }

  const frontmatter = markdown.slice(4, frontmatterEnd);
  const body = markdown.slice(frontmatterEnd);
  const lines = frontmatter.split('\n');
  const descriptionIndex = lines.findIndex((line) => line.startsWith('description:'));
  const descriptionLine = `description: ${description}`;

  if (descriptionIndex === -1) lines.push(descriptionLine);
  else lines[descriptionIndex] = descriptionLine;

  return `---\n${lines.join('\n')}${body}`;
}
