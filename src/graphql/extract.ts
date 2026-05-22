import {
  getNamedType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  type GraphQLFieldMap,
  type GraphQLInputType,
  type GraphQLOutputType,
  type GraphQLSchema,
  type GraphQLType,
} from 'graphql';

import type { CommandDef, JsonSchema, ParamDef } from '../core/types.js';

import { schemaTypeToCliType } from '../core/coerce.js';
import { toKebab } from '../core/names.js';

export function extractGraphqlCommands(schema: GraphQLSchema): CommandDef[] {
  const commands: CommandDef[] = [];
  addRootFields(commands, schema.getQueryType()?.getFields(), 'query');
  addRootFields(commands, schema.getMutationType()?.getFields(), 'mutation');
  return commands;
}

export function buildGraphqlSelectionSet(
  type: GraphQLOutputType,
  fields?: string,
  depth = 2,
): string {
  if (fields !== undefined && fields.trim().length > 0) return `{ ${fields.trim()} }`;
  return buildDefaultSelectionSet(type, depth, new Set());
}

function addRootFields(
  commands: CommandDef[],
  fields: GraphQLFieldMap<unknown, unknown> | undefined,
  operationType: 'query' | 'mutation',
): void {
  if (fields === undefined) return;

  for (const field of Object.values(fields)) {
    const description = optionalString(field.description);
    commands.push({
      name: toKebab(field.name),
      ...(description === undefined ? {} : { description }),
      params: field.args.map((arg) =>
        graphqlArgToParam(arg.name, arg.type, optionalString(arg.description)),
      ),
      graphqlOperationType: operationType,
      graphqlFieldName: field.name,
      graphqlReturnType: field.type,
    });
  }
}

function graphqlArgToParam(
  name: string,
  type: GraphQLInputType,
  description: string | undefined,
): ParamDef {
  const schema = graphqlInputTypeToJsonSchema(type);
  const cliType = schemaTypeToCliType(schema).type;
  return {
    name: toKebab(name),
    originalName: name,
    type: cliType,
    required: isNonNullType(type),
    ...(description === undefined ? {} : { description }),
    location: 'graphql_arg',
    schema,
  };
}

export function graphqlInputTypeToJsonSchema(type: GraphQLInputType): JsonSchema {
  if (isNonNullType(type)) {
    return { ...graphqlInputTypeToJsonSchema(type.ofType), graphqlType: graphqlTypeToString(type) };
  }

  if (isListType(type)) {
    return {
      type: 'array',
      items: graphqlInputTypeToJsonSchema(type.ofType),
      graphqlType: graphqlTypeToString(type),
    };
  }

  const namedType = getNamedType(type);
  const base: JsonSchema = { graphqlType: graphqlTypeToString(type) };

  if (isEnumType(namedType)) {
    return { ...base, type: 'string', enum: namedType.getValues().map((value) => value.name) };
  }

  if (isInputObjectType(namedType)) return { ...base, type: 'object' };

  if (isScalarType(namedType)) {
    switch (namedType.name) {
      case 'Int':
        return { ...base, type: 'integer' };
      case 'Float':
        return { ...base, type: 'number' };
      case 'Boolean':
        return { ...base, type: 'boolean' };
      default:
        return { ...base, type: 'string' };
    }
  }

  return { ...base, type: 'string' };
}

export function graphqlTypeToString(type: GraphQLType): string {
  if (isNonNullType(type)) return `${graphqlTypeToString(type.ofType)}!`;
  if (isListType(type)) return `[${graphqlTypeToString(type.ofType)}]`;
  return getNamedType(type).name;
}

function optionalString(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

function buildDefaultSelectionSet(
  type: GraphQLOutputType,
  depth: number,
  seenTypes: Set<string>,
): string {
  const namedType = getNamedType(type);
  if (isScalarType(namedType) || isEnumType(namedType)) return '';
  if (depth <= 0) return '';
  if (!isObjectType(namedType) && !isInterfaceType(namedType)) return '{ __typename }';
  if (seenTypes.has(namedType.name)) return '';

  const nextSeen = new Set(seenTypes);
  nextSeen.add(namedType.name);

  const selections = Object.values(namedType.getFields())
    .filter((field) => field.args.length === 0)
    .map((field) => {
      const fieldNamedType = getNamedType(field.type);
      if (isScalarType(fieldNamedType) || isEnumType(fieldNamedType)) return field.name;

      const nested = buildDefaultSelectionSet(field.type, depth - 1, nextSeen);
      return nested ? `${field.name} ${nested}` : '';
    })
    .filter((field) => field.length > 0);

  return selections.length === 0 ? '' : `{ ${selections.join(' ')} }`;
}
