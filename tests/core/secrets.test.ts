import { describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { resolveSecret } from '../../src/core/secrets.js';

describe('resolveSecret', () => {
  it('returns literal values', async () => {
    await expect(resolveSecret('literal')).resolves.toBe('literal');
  });

  it('resolves env: and file: prefixes', async () => {
    process.env.SKILL_CREATOR_TEST_SECRET = 'from-env';
    await expect(resolveSecret('env:SKILL_CREATOR_TEST_SECRET')).resolves.toBe('from-env');

    const dir = await mkdtemp(join(tmpdir(), 'skill-creator-secret-'));
    const path = join(dir, 'secret.txt');
    await writeFile(path, 'from-file\n');
    await expect(resolveSecret(`file:${path}`)).resolves.toBe('from-file');
  });

  it('throws helpful errors for missing env vars and files', async () => {
    delete process.env.SKILL_CREATOR_NOPE;
    await expect(resolveSecret('env:SKILL_CREATOR_NOPE')).rejects.toThrow(/environment variable/);
    await expect(resolveSecret('file:/definitely/missing')).rejects.toThrow(
      /secret file not found/,
    );
  });
});
