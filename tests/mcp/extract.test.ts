import { describe, expect, it } from 'vitest';
import { extractMcpCommands } from '../../src/mcp/extract.js';

describe('extractMcpCommands', () => {
  it('converts MCP tools into command definitions', () => {
    const commands = extractMcpCommands([
      {
        name: 'list_items',
        description: 'List items',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path' },
            recursive: { type: 'boolean', description: 'Recursive' },
          },
          required: ['path'],
        },
      },
    ]);

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      name: 'list-items',
      toolName: 'list_items',
      description: 'List items',
    });
    expect(commands[0]?.params).toEqual([
      expect.objectContaining({
        name: 'path',
        originalName: 'path',
        type: 'string',
        required: true,
        location: 'tool_input',
      }),
      expect.objectContaining({
        name: 'recursive',
        originalName: 'recursive',
        type: 'boolean',
        required: false,
        location: 'tool_input',
      }),
    ]);
  });
});
