import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

export type UsageEntry = {
  count: number;
  lastUsed: string;
};

export type UsageData = Record<string, Record<string, UsageEntry>>;

export function sourceHashFor(source: string): string {
  return createHash('sha256').update(source).digest('hex').slice(0, 16);
}

export class UsageStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<UsageData> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as UsageData;
    } catch {
      return {};
    }
  }

  async save(data: UsageData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`);
  }

  async record(sourceHash: string, toolName: string, now = new Date()): Promise<void> {
    const usage = await this.load();
    usage[sourceHash] ??= {};
    usage[sourceHash][toolName] ??= { count: 0, lastUsed: '' };
    usage[sourceHash][toolName].count += 1;
    usage[sourceHash][toolName].lastUsed = now.toISOString();
    await this.save(usage);
  }
}
