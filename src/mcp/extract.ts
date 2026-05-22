import type { CommandDef, JsonSchema, ParamDef } from '../core/types.js';

import { schemaTypeToCliType } from '../core/coerce.js';
import { toKebab } from '../core/names.js';

type McpToolLike = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export function extractMcpCommands(tools: McpToolLike[]): CommandDef[] {
  return tools.map((tool): CommandDef => {
    const schema = isJsonSchema(tool.inputSchema) ? tool.inputSchema : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const properties = getProperties(schema);
    const params = Object.entries(properties).map(([name, propSchema]): ParamDef => {
      const { type, suffix } = schemaTypeToCliType(propSchema);
      const choices = Array.isArray(propSchema.enum) ? { choices: propSchema.enum } : {};
      return {
        name: toKebab(name),
        originalName: name,
        type,
        required: required.has(name),
        description: `${String(propSchema.description ?? name)}${suffix}`,
        ...choices,
        location: 'tool_input',
        schema: propSchema,
      };
    });

    return {
      name: toKebab(tool.name),
      description: tool.description ?? '',
      params,
      hasBody: params.length > 0,
      toolName: tool.name,
    };
  });
}

function getProperties(schema: JsonSchema): Record<string, JsonSchema> {
  const properties = schema.properties;
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) return {};
  return Object.fromEntries(
    Object.entries(properties).filter((entry): entry is [string, JsonSchema] =>
      isJsonSchema(entry[1]),
    ),
  );
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
