import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { InstallScope } from './agents.js';

export type ManagedSkillEntry = {
  name: string;
  agent: string;
  scope: InstallScope;
  path: string;
  script?: string;
  template?: string;
  createdAt: string;
  updatedAt: string;
};

export type SkillCreatorLock = {
  version: 1;
  skills: Record<string, ManagedSkillEntry>;
};

export function skillCreatorHome(): string {
  return process.env.SKILL_CREATOR_HOME?.trim() || join(homedir(), '.skill-creator');
}

export function lockPath(): string {
  return join(skillCreatorHome(), 'lock.json');
}

export function skillKey(agent: string, scope: InstallScope, name: string): string {
  return `${agent}:${scope}:${name}`;
}

export async function readLock(): Promise<SkillCreatorLock> {
  try {
    const parsed = JSON.parse(await readFile(lockPath(), 'utf8')) as SkillCreatorLock;
    return { version: 1, skills: parsed.skills ?? {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, skills: {} };
    throw error;
  }
}

export async function writeLock(lock: SkillCreatorLock): Promise<void> {
  await mkdir(skillCreatorHome(), { recursive: true });
  await writeFile(lockPath(), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

export async function upsertManagedSkill(
  entry: Omit<ManagedSkillEntry, 'createdAt' | 'updatedAt'>,
): Promise<void> {
  const lock = await readLock();
  const key = skillKey(entry.agent, entry.scope, entry.name);
  const now = new Date().toISOString();
  const existing = lock.skills[key];
  lock.skills[key] = {
    ...entry,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writeLock(lock);
}
