import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { run } from '../../src/cli/main.js';

let stdout = '';
let stderr = '';
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

const SERVER = join(process.cwd(), 'tests/fixtures/mcp-stdio-server.mjs');

beforeEach(() => {
  stdout = '';
  stderr = '';
  logSpy = vi.spyOn(console, 'log').mockImplementation((message = '') => {
    stdout += `${String(message)}\n`;
  });
  errorSpy = vi.spyOn(console, 'error').mockImplementation((message = '') => {
    stderr += `${String(message)}\n`;
  });
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('MCP stdio CLI mode', () => {
  it('lists tools from a stdio MCP server', async () => {
    const code = await run(['--mcp-stdio', `node ${SERVER}`, '--list']);
    expect(code).toBe(0);
    expect(stdout).toContain('echo');
    expect(stdout).toContain('add-numbers');
    expect(stdout).toContain('list-items');
  });

  it('calls a stdio MCP tool with arguments', async () => {
    const code = await run([
      '--mcp-stdio',
      `node ${SERVER}`,
      'echo',
      '--message',
      'hello filesystem',
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('hello filesystem');
  });

  it('coerces number and boolean tool arguments', async () => {
    const addCode = await run([
      '--mcp-stdio',
      `node ${SERVER}`,
      'add-numbers',
      '--a',
      '2',
      '--b',
      '5',
    ]);
    expect(addCode).toBe(0);
    expect(stdout).toContain('7');

    stdout = '';
    const listCode = await run([
      '--mcp-stdio',
      `node ${SERVER}`,
      'list-items',
      '--path',
      '/tmp',
      '--recursive',
    ]);
    expect(listCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ path: '/tmp', recursive: true });
  });
});
