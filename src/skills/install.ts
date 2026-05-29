import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertValidSkillName,
  isAgentId,
  resolveAgentSkillDir,
  type AgentId,
  type InstallScope,
} from './agents.js';

export type InstallBundledSkillResult = {
  skillName: string;
  targetPath: string;
  targetRoot: string;
};

export async function installBundledSkill(options: {
  skillName: string;
  agent: string;
  scope: InstallScope;
  force: boolean;
}): Promise<InstallBundledSkillResult | undefined> {
  if (!isAgentId(options.agent)) return undefined;
  assertValidSkillName(options.skillName);

  const targetRoot = resolveAgentSkillDir(options.agent as AgentId, options.scope);
  const targetPath = join(targetRoot, options.skillName);
  const sourcePath = bundledSkillPath(options.skillName);

  await mkdir(targetRoot, { recursive: true });
  if (options.force) await rm(targetPath, { recursive: true, force: true });
  await cp(sourcePath, targetPath, { recursive: true, force: options.force, errorOnExist: false });

  return { skillName: options.skillName, targetPath, targetRoot };
}

function bundledSkillPath(skillName: string): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../..', 'skills', skillName);
}
