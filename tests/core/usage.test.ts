import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { CommandDef } from '../../src/core/types.js';

import { sortCommands } from '../../src/core/listing.js';
import { sourceHashFor, UsageStore } from '../../src/core/usage.js';

function commands(names: string[]): CommandDef[] {
  return names.map((name) => ({ name, toolName: name, params: [] }));
}

describe('UsageStore', () => {
  it('loads empty/corrupt usage and round-trips records', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-creator-usage-'));
    const store = new UsageStore(join(dir, 'usage.json'));
    expect(await store.load()).toEqual({});

    await store.record('src', 'tool-a');
    await store.record('src', 'tool-a');
    const usage = await store.load();
    expect(usage.src?.['tool-a']?.count).toBe(2);
    expect(usage.src?.['tool-a']?.lastUsed).toBeTruthy();
  });
});

describe('sourceHashFor', () => {
  it('is deterministic and short', () => {
    expect(sourceHashFor('http://example.com')).toBe(sourceHashFor('http://example.com'));
    expect(sourceHashFor('http://example.com')).not.toBe(sourceHashFor('http://other.com'));
    expect(sourceHashFor('anything')).toHaveLength(16);
  });
});

describe('sortCommands', () => {
  it('supports default and alpha sorting', async () => {
    const store = new UsageStore(
      join(await mkdtemp(join(tmpdir(), 'skill-creator-usage-')), 'usage.json'),
    );
    expect(
      (await sortCommands(commands(['c', 'a', 'b']), 'default', 'src', store)).map((c) => c.name),
    ).toEqual(['c', 'a', 'b']);
    expect(
      (await sortCommands(commands(['c', 'a', 'b']), 'alpha', 'src', store)).map((c) => c.name),
    ).toEqual(['a', 'b', 'c']);
  });

  it('supports usage and recent sorting', async () => {
    const store = new UsageStore(
      join(await mkdtemp(join(tmpdir(), 'skill-creator-usage-')), 'usage.json'),
    );
    await store.record('src', 'b');
    await store.record('src', 'b');
    await store.record('src', 'a');

    expect(
      (await sortCommands(commands(['a', 'b', 'c']), 'usage', 'src', store)).map((c) => c.name),
    ).toEqual(['b', 'a', 'c']);
    expect((await sortCommands(commands(['a', 'b', 'c']), 'recent', 'src', store))[0]?.name).toBe(
      'a',
    );
  });
});
