import { describe, expect, it } from 'vitest';

import { splitCommandLine } from '../../src/mcp/stdio.js';

describe('splitCommandLine', () => {
  it('splits stdio command lines with quoted arguments', () => {
    expect(splitCommandLine('node "/tmp/server with spaces.mjs" --root "/tmp/my root"')).toEqual([
      'node',
      '/tmp/server with spaces.mjs',
      '--root',
      '/tmp/my root',
    ]);
  });

  it('returns no arguments for empty command lines', () => {
    expect(splitCommandLine('   ')).toEqual([]);
  });
});
