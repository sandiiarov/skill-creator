import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { isCliEntrypoint } from '../../src/cli/main.js';

describe('isCliEntrypoint', () => {
  it('recognizes npm bin symlinks as the CLI entrypoint', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-creator-entrypoint-'));
    try {
      const target = join(dir, 'main.js');
      const link = join(dir, 'skill-creator');
      writeFileSync(target, '#!/usr/bin/env node\n');
      symlinkSync(target, link);

      expect(isCliEntrypoint(pathToFileURL(target).href, link)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects unrelated argv paths', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-creator-entrypoint-'));
    try {
      const target = join(dir, 'main.js');
      const other = join(dir, 'other.js');
      writeFileSync(target, '#!/usr/bin/env node\n');
      writeFileSync(other, '#!/usr/bin/env node\n');

      expect(isCliEntrypoint(pathToFileURL(target).href, other)).toBe(false);
      expect(isCliEntrypoint(pathToFileURL(target).href, undefined)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
