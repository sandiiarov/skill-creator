import type { CommandDef, JsonSchema, ParamDef, ParamLocation } from '../core/types.js';

import { schemaTypeToCliType } from '../core/coerce.js';
import { toKebab } from '../core/names.js';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

type JsonObject = Record<string, unknown>;

export function extractOpenApiCommands(spec: unknown): CommandDef[] {
  const commands: CommandDef[] = [];
  const seenNames = new Map<string, number>();
  const paths = isObject(spec) && isObject(spec.paths) ? spec.paths : {};

  for (const [path, methods] of Object.entries(paths)) {
    if (!isObject(methods)) continue;
    for (const [method, operation] of Object.entries(methods)) {
      if (!HTTP_METHODS.has(method) || !isObject(operation)) continue;

      let name =
        operation.operationId !== undefined
          ? toKebab(String(operation.operationId))
          : fallbackName(method, path);
      const seen = seenNames.get(name) ?? 0;
      seenNames.set(name, seen + 1);
      if (seen > 0) name = `${name}-${method}`;

      const params = extractParameters(operation);
      const body = extractRequestBodyParams(operation);
      params.push(...body.params);

      commands.push({
        name,
        description: String(
          operation.summary ?? operation.description ?? `${method.toUpperCase()} ${path}`,
        ),
        params,
        hasBody: body.params.length > 0,
        method,
        path,
        ...(body.contentType === undefined ? {} : { contentType: body.contentType }),
      });
    }
  }

  return commands;
}

function extractParameters(operation: JsonObject): ParamDef[] {
  const rawParams = Array.isArray(operation.parameters) ? operation.parameters : [];
  return rawParams.filter(isObject).map((param): ParamDef => {
    const schema = getSchema(param.schema);
    const { type, suffix } = schemaTypeToCliType(schema);
    const choices = Array.isArray(schema.enum) ? { choices: schema.enum } : {};
    return {
      name: toKebab(String(param.name)),
      originalName: String(param.name),
      type,
      required: Boolean(param.required),
      description: `${String(param.description ?? param.name)}${suffix}`,
      ...choices,
      location: normalizeLocation(param.in),
      schema,
    };
  });
}

function extractRequestBodyParams(operation: JsonObject): {
  params: ParamDef[];
  contentType?: string;
} {
  const requestBody = isObject(operation.requestBody) ? operation.requestBody : undefined;
  const content =
    requestBody !== undefined && isObject(requestBody.content) ? requestBody.content : {};

  const multipartSchema = normalizeObjectSchema(getContentSchema(content, 'multipart/form-data'));
  const jsonSchema = normalizeObjectSchema(getContentSchema(content, 'application/json'));
  const multipartProps = getProperties(multipartSchema);
  const hasBinary = Object.values(multipartProps).some((schema) => schema.format === 'binary');

  let schema: JsonSchema = {};
  let contentType: string | undefined;
  if (hasBinary) {
    schema = multipartSchema;
    contentType = 'multipart/form-data';
  } else if (Object.keys(getProperties(jsonSchema)).length > 0) {
    schema = jsonSchema;
  } else if (Object.keys(multipartProps).length > 0) {
    schema = multipartSchema;
    contentType = 'multipart/form-data';
  }

  const normalizedSchema = normalizeObjectSchema(schema);
  const required = new Set(
    Array.isArray(normalizedSchema.required) ? normalizedSchema.required : [],
  );
  const properties = getProperties(normalizedSchema);
  const params = Object.entries(properties).map(([propName, propSchema]): ParamDef => {
    const isBinary = contentType === 'multipart/form-data' && propSchema.format === 'binary';
    const { type, suffix } = isBinary
      ? { type: 'string' as const, suffix: ' (file path)' }
      : schemaTypeToCliType(propSchema);
    const choices = Array.isArray(propSchema.enum) ? { choices: propSchema.enum } : {};
    return {
      name: toKebab(propName),
      originalName: propName,
      type,
      required: required.has(propName),
      description: `${String(propSchema.description ?? propName)}${suffix}`,
      ...choices,
      location: isBinary ? 'file' : 'body',
      schema: propSchema,
    };
  });

  return contentType === undefined ? { params } : { params, contentType };
}

function getContentSchema(content: JsonObject, contentType: string): JsonSchema {
  const item = content[contentType];
  return isObject(item) ? getSchema(item.schema) : {};
}

function getProperties(schema: JsonSchema): Record<string, JsonSchema> {
  return isObject(schema.properties)
    ? Object.fromEntries(
        Object.entries(schema.properties).filter((entry): entry is [string, JsonSchema] =>
          isObject(entry[1]),
        ),
      )
    : {};
}

function normalizeObjectSchema(schema: JsonSchema): JsonSchema {
  const merged = mergeComposedObjectSchema(schema);
  const properties = getProperties(merged);
  if (Object.keys(properties).length === 0) return merged;

  return {
    ...merged,
    properties: Object.fromEntries(
      Object.entries(properties).map(([name, propSchema]) => [
        name,
        mergeComposedObjectSchema(propSchema),
      ]),
    ),
  };
}

function mergeComposedObjectSchema(schema: JsonSchema): JsonSchema {
  const composed = [
    ...schemaArray(schema.allOf),
    ...objectCompositionSchemaArray(schema.anyOf),
    ...objectCompositionSchemaArray(schema.oneOf),
  ];
  if (composed.length === 0) return schema;

  const mergedParts = composed.map((part) => mergeComposedObjectSchema(part));
  const mergedProperties: Record<string, JsonSchema> = {};
  const required = new Set<string>();

  for (const part of mergedParts) {
    Object.assign(mergedProperties, getProperties(part));
    if (Array.isArray(part.required)) {
      for (const name of part.required) {
        if (typeof name === 'string') required.add(name);
      }
    }
  }

  const ownProperties = getProperties({
    ...schema,
    allOf: undefined,
    anyOf: undefined,
    oneOf: undefined,
  });
  Object.assign(mergedProperties, ownProperties);
  if (Array.isArray(schema.required)) {
    for (const name of schema.required) {
      if (typeof name === 'string') required.add(name);
    }
  }

  const { allOf: _allOf, anyOf: _anyOf, oneOf: _oneOf, required: _required, ...rest } = schema;
  return {
    ...rest,
    ...(Object.keys(mergedProperties).length === 0 ? {} : { properties: mergedProperties }),
    ...(required.size === 0 ? {} : { required: [...required] }),
  };
}

function schemaArray(value: unknown): JsonSchema[] {
  return Array.isArray(value) ? value.filter(isObject).map((item) => item as JsonSchema) : [];
}

function objectCompositionSchemaArray(value: unknown): JsonSchema[] {
  return schemaArray(value).filter((schema) => Object.keys(getProperties(schema)).length > 0);
}

function getSchema(value: unknown): JsonSchema {
  return isObject(value) ? (value as JsonSchema) : {};
}

function normalizeLocation(value: unknown): ParamLocation {
  return value === 'path' || value === 'header' || value === 'body' || value === 'file'
    ? value
    : 'query';
}

function fallbackName(method: string, path: string): string {
  const slug = path
    .replace(/^\/+|\/+$/g, '')
    .replace(/[{}]/g, '')
    .replace(/\//g, '-');
  return slug ? `${method}-${slug}` : method;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
