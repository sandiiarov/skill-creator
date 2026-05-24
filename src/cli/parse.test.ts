import { describe, expect, it } from 'vitest';

import { splitAtSubcommand } from './parse.js';

const spec = {
  valueOptions: ['--spec', '--mcp', '--env', '--cache-ttl', '--auth-header', '--head'],
  boolOptions: ['--pretty', '--refresh', '--list'],
};

describe('splitAtSubcommand', () => {
  it('splits global options from the first positional subcommand', () => {
    expect(
      splitAtSubcommand(['--mcp', 'http://server', 'deploy', '--env', 'production'], spec),
    ).toEqual({
      globalArgv: ['--mcp', 'http://server'],
      commandArgv: ['deploy', '--env', 'production'],
    });
  });

  it('keeps global booleans and repeated value options before subcommand', () => {
    expect(splitAtSubcommand(['--pretty', '--env', 'A=1', '--env', 'B=2', 'tool'], spec)).toEqual({
      globalArgv: ['--pretty', '--env', 'A=1', '--env', 'B=2'],
      commandArgv: ['tool'],
    });
  });

  it('supports --option=value and -- separator', () => {
    expect(splitAtSubcommand(['--mcp=http://server', '--', 'tool', '--env', 'prod'], spec)).toEqual(
      {
        globalArgv: ['--mcp=http://server'],
        commandArgv: ['tool', '--env', 'prod'],
      },
    );
  });

  it('does not mistake option values for subcommands', () => {
    expect(splitAtSubcommand(['--mcp', 'http://server', '--head', '5', 'tool'], spec)).toEqual({
      globalArgv: ['--mcp', 'http://server', '--head', '5'],
      commandArgv: ['tool'],
    });
  });
});
