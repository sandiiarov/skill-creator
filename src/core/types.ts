export type JsonSchema = {
  type?: string;
  format?: string;
  description?: string;
  enum?: unknown[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  [key: string]: unknown;
};

export type CliValueType = 'string' | 'integer' | 'number' | 'boolean';

export type ParamLocation =
  | 'path'
  | 'query'
  | 'header'
  | 'body'
  | 'file'
  | 'tool_input'
  | 'graphql_arg';

export type ParamDef = {
  /** kebab-case CLI flag name */
  name: string;
  /** original API/tool argument name */
  originalName: string;
  type: CliValueType;
  required?: boolean;
  description?: string;
  choices?: unknown[];
  location?: ParamLocation;
  schema?: JsonSchema;
};

export type CommandDef = {
  name: string;
  description?: string;
  params: ParamDef[];
  hasBody?: boolean;
  method?: string;
  path?: string;
  contentType?: string;
  toolName?: string;
  graphqlOperationType?: 'query' | 'mutation';
  graphqlFieldName?: string;
  graphqlReturnType?: unknown;
};
