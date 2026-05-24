import { describe, expect, it } from 'vitest';

import type { CommandDef } from '../core/types.js';

import { parseCommandValues } from './dynamic.js';

const command: CommandDef = {
  name: 'demo',
  params: [
    { name: 'limit', originalName: 'limit', type: 'integer', required: true },
    { name: 'enabled', originalName: 'enabled', type: 'boolean' },
    { name: 'label', originalName: 'label', type: 'string' },
  ],
};

describe('parseCommandValues', () => {
  it('parses command options with util.parseArgs semantics', () => {
    expect(parseCommandValues(command, ['--limit=5', '--enabled', '--label', 'hello'])).toEqual({
      limit: '5',
      enabled: true,
      label: 'hello',
    });
  });

  it('preserves dash-prefixed values for string parameters', () => {
    expect(parseCommandValues(command, ['--limit', '-1'])).toEqual({ limit: '-1' });
  });

  it('rejects unknown command options', () => {
    expect(() => parseCommandValues(command, ['--limit', '1', '--missing'])).toThrow(
      /unknown option for demo: --missing/,
    );
  });
});
