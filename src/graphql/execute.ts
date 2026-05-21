import {
  Kind,
  OperationTypeNode,
  parse,
  print,
  type DocumentNode,
  type FieldNode,
  type GraphQLOutputType,
  type OperationDefinitionNode,
  type SelectionSetNode,
  type TypeNode,
  type VariableDefinitionNode,
} from 'graphql';
import { ClientError, GraphQLClient } from 'graphql-request';
import { coerceAndValidateValue } from '../core/coerce.js';
import type { CommandDef } from '../core/types.js';
import { buildGraphqlSelectionSet } from './extract.js';

export type ExecuteGraphqlOptions = {
  endpoint: string;
  authHeaders?: Array<[string, string]>;
  fields?: string;
  selectionDepth?: number;
};

export async function executeGraphql(
  command: CommandDef,
  values: Record<string, unknown>,
  options: ExecuteGraphqlOptions,
): Promise<unknown> {
  const fieldName = command.graphqlFieldName ?? command.name;
  const variables = collectVariables(command, values);
  const query = buildGraphqlOperation(
    command,
    fieldName,
    variables,
    options.fields,
    options.selectionDepth ?? 2,
  );
  const client = new GraphQLClient(options.endpoint, {
    headers: Object.fromEntries(options.authHeaders ?? []),
  });

  try {
    const data = await client.request<Record<string, unknown>>(query, variables);
    if (!isRecord(data)) return data;
    return data[fieldName];
  } catch (error) {
    throw normalizeGraphqlRequestError(error);
  }
}

function collectVariables(
  command: CommandDef,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const variables: Record<string, unknown> = {};
  for (const param of command.params) {
    const value = values[param.name] ?? values[param.originalName];
    if (value !== undefined) {
      variables[param.originalName] = coerceAndValidateValue(
        value,
        param.schema ?? {},
        `--${param.name}`,
      );
    }
  }
  return variables;
}

function buildGraphqlOperation(
  command: CommandDef,
  fieldName: string,
  variables: Record<string, unknown>,
  fields: string | undefined,
  selectionDepth: number,
): string {
  const activeParams = command.params.filter(
    (param) => param.required || variables[param.originalName] !== undefined,
  );
  const variableDefinitions = activeParams.map(
    (param): VariableDefinitionNode => ({
      kind: Kind.VARIABLE_DEFINITION,
      variable: {
        kind: Kind.VARIABLE,
        name: { kind: Kind.NAME, value: param.originalName },
      },
      type: parseGraphqlType(graphqlParamType(param)),
    }),
  );
  const selectionSet = buildSelectionSetNode(command, fields, selectionDepth);
  const field: FieldNode = {
    kind: Kind.FIELD,
    name: { kind: Kind.NAME, value: fieldName },
    arguments: activeParams.map((param) => ({
      kind: Kind.ARGUMENT,
      name: { kind: Kind.NAME, value: param.originalName },
      value: {
        kind: Kind.VARIABLE,
        name: { kind: Kind.NAME, value: param.originalName },
      },
    })),
    ...(selectionSet === undefined ? {} : { selectionSet }),
  };
  const operation: OperationDefinitionNode = {
    kind: Kind.OPERATION_DEFINITION,
    operation:
      command.graphqlOperationType === 'mutation'
        ? OperationTypeNode.MUTATION
        : OperationTypeNode.QUERY,
    name: { kind: Kind.NAME, value: commandName(command) },
    ...(variableDefinitions.length === 0 ? {} : { variableDefinitions }),
    selectionSet: { kind: Kind.SELECTION_SET, selections: [field] },
  };
  const document: DocumentNode = { kind: Kind.DOCUMENT, definitions: [operation] };
  return print(document);
}

function buildSelectionSetNode(
  command: CommandDef,
  fields: string | undefined,
  selectionDepth: number,
): SelectionSetNode | undefined {
  if (command.graphqlReturnType === undefined) return undefined;

  const selectionSet = buildGraphqlSelectionSet(
    command.graphqlReturnType as GraphQLOutputType,
    fields,
    selectionDepth,
  );
  if (selectionSet.length === 0) return undefined;
  return parseSelectionSet(selectionSet);
}

function parseGraphqlType(type: string): TypeNode {
  const operation = parseSingleOperation(`query __Type($value: ${type}) { __typename }`);
  const variable = operation.variableDefinitions?.[0];
  if (variable === undefined) throw new Error(`invalid GraphQL variable type: ${type}`);
  return variable.type;
}

function parseSelectionSet(selectionSet: string): SelectionSetNode {
  const operation = parseSingleOperation(`query __Selection { _selection ${selectionSet} }`);
  const selection = operation.selectionSet.selections[0];
  if (selection?.kind !== Kind.FIELD || selection.selectionSet === undefined) {
    throw new Error('invalid GraphQL selection set');
  }
  return selection.selectionSet;
}

function parseSingleOperation(source: string): OperationDefinitionNode {
  const document = parse(source);
  const definition = document.definitions[0];
  if (definition?.kind !== Kind.OPERATION_DEFINITION) {
    throw new Error('failed to build GraphQL operation');
  }
  return definition;
}

function graphqlParamType(param: CommandDef['params'][number]): string {
  const type = param.schema?.graphqlType;
  return typeof type === 'string' ? type : jsonSchemaToGraphqlType(param.schema?.type);
}

function jsonSchemaToGraphqlType(type: string | undefined): string {
  switch (type) {
    case 'integer':
      return 'Int';
    case 'number':
      return 'Float';
    case 'boolean':
      return 'Boolean';
    default:
      return 'String';
  }
}

function commandName(command: CommandDef): string {
  return `${command.graphqlOperationType ?? 'query'}_${command.graphqlFieldName ?? command.name}`.replace(
    /[^_0-9A-Za-z]/g,
    '_',
  );
}

function normalizeGraphqlRequestError(error: unknown): Error {
  if (error instanceof ClientError) {
    if (error.response.errors !== undefined && error.response.errors.length > 0) {
      return new Error(`GraphQL error: ${formatGraphqlErrors(error.response.errors)}`);
    }

    return new Error(
      `GraphQL HTTP ${error.response.status}: ${JSON.stringify(error.response, null, 0)}`,
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}

function formatGraphqlErrors(errors: ReadonlyArray<{ message?: string }>): string {
  return errors.map((error) => error.message ?? 'unknown error').join('; ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
