# Refactoring Plan

This plan focuses on simplifying `skill-creator` while keeping the current runtime behavior: dynamic CLIs for OpenAPI, MCP stdio, MCP HTTP/SSE, and GraphQL.

## Goals

- Reduce custom parsing and protocol glue code.
- Keep the CLI dynamic and lightweight.
- Prefer stable, focused libraries over large frameworks.
- Preserve current behavior and test coverage during each step.
- Avoid broad rewrites; refactor in small, independently testable phases.

## Current complexity hotspots

- `src/cli/main.ts` is the largest file and mixes parsing, dispatch, command rendering, mode handling, stdin, cache setup, and execution.
- CLI parsing is custom even though Node 20 has `util.parseArgs`.
- OpenAPI local `$ref` resolution is custom despite an existing dependency that can dereference schemas.
- MCP stdio command splitting is custom shell-like parsing.
- GraphQL execution manually handles request serialization, HTTP status checks, JSON parsing, and GraphQL error formatting.
- Mode handlers repeat the same flow: load commands, filter/search, list, find subcommand, render help, parse values, execute, format output.

## Guiding principles

1. Keep public CLI behavior stable.
2. Refactor one concern at a time.
3. Add or update tests before each behavior change.
4. Prefer removing code over adding abstraction unless repetition is clear.
5. Avoid heavyweight CLI frameworks because commands are discovered at runtime.

## Phase 1: Deduplicate dynamic command handling

Create a shared helper for the common command lifecycle.

Repeated flow today:

1. load commands
2. apply include/exclude/method filters
3. apply search
4. render list/search results
5. validate subcommand
6. render command help
7. parse command values
8. execute command
9. format output

Target shape:

```ts
await runDynamicMode({
  globals,
  commandArgv,
  loadCommands,
  renderCommands,
  executeCommand,
});
```

Expected impact:

- Shrinks `src/cli/main.ts` significantly.
- Makes OpenAPI, GraphQL, MCP HTTP, and MCP stdio behavior more consistent.
- Makes future modes easier to add.

Risk: low to medium. This is mostly internal structure, but it touches all modes.

Validation:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm fmt:check
```

## Phase 2: Replace custom global/command parsing with Node `util.parseArgs`

Use Node's built-in parser before adding a third-party CLI framework.

Benefits:

- No new dependency.
- Supports typed option specs.
- Handles `--flag=value` and positional tokens.
- Fits Node 20+ runtime requirement.

Likely replacements:

- `parseGlobalArgs`
- parts of `parseCommandValues`
- `splitOptionValue`
- `readOptionValue`

Keep `splitAtSubcommand` only if still needed for dynamic command boundaries. Otherwise, replace it too.

Possible shape:

```ts
import { parseArgs } from 'node:util';

const parsed = parseArgs({
  args: argv,
  options: {
    spec: { type: 'string' },
    mcp: { type: 'string' },
    'mcp-stdio': { type: 'string' },
    graphql: { type: 'string' },
    list: { type: 'boolean' },
    pretty: { type: 'boolean' },
  },
  allowPositionals: true,
});
```

Third-party alternative:

```bash
pnpm add commander
```

`commander` is acceptable if built-in parsing becomes awkward, but it is less natural for runtime-discovered commands. Avoid larger frameworks unless the CLI becomes much more complex.

Risk: medium. Parsing changes can subtly affect user-facing behavior.

Validation focus:

- `--flag value`
- `--flag=value`
- repeated `--auth-header`
- leading `--` from package-manager invocation
- command-specific flags
- unknown command flags
- boolean parameters

## Phase 3: Replace custom OpenAPI reference resolution

Current custom file:

- `src/openapi/refs.ts`

The project already depends on:

```json
"@apidevtools/json-schema-ref-parser"
```

Use it directly or remove the dependency if we decide to keep custom logic. Preferred option:

```ts
import $RefParser from '@apidevtools/json-schema-ref-parser';

const spec = await $RefParser.dereference(parsed);
```

Benefits:

- Deletes custom `$ref` resolver code.
- Handles more reference edge cases.
- Reduces maintenance burden.

Optional OpenAPI-specific alternative:

```bash
pnpm add @apidevtools/swagger-parser
```

Use `@apidevtools/swagger-parser` if we want stronger OpenAPI validation/parsing later.

Risk: medium. Dereferencing behavior may differ for circular references or remote refs.

Validation focus:

- local `$ref`
- nested schemas
- circular refs if supported or intentionally rejected
- existing OpenAPI tests

## Phase 4: Replace MCP stdio command splitting with `string-argv`

Current custom logic:

- `splitCommandLine` in `src/mcp/stdio.ts`

Recommended dependency:

```bash
pnpm add string-argv
```

Target:

```ts
import stringArgv from 'string-argv';

const [command, ...args] = stringArgv(commandLine);
```

Benefits:

- Removes custom shell-ish quote/escape parsing.
- Better tested behavior for quoted command lines.
- Smaller MCP stdio module.

Risk: low to medium. Shell parsing compatibility can change slightly.

Validation focus:

- quoted args
- escaped quotes
- paths with spaces
- empty command error
- filesystem MCP smoke command

## Phase 5: Simplify GraphQL execution with `graphql-request`

Current custom logic in `src/graphql/execute.ts`:

- manual `fetch`
- manual JSON payload creation
- manual response parsing
- manual GraphQL error formatting

Recommended dependency:

```bash
pnpm add graphql-request
```

Target shape:

```ts
import { GraphQLClient } from 'graphql-request';

const client = new GraphQLClient(endpoint, {
  headers: Object.fromEntries(authHeaders),
});

const data = await client.request<Record<string, unknown>>(query, variables);
return data[fieldName];
```

Benefits:

- Removes request/error boilerplate.
- Uses a focused, common GraphQL client.
- Keeps schema extraction and query generation under our control.

Keep custom:

- command extraction from schema
- variable collection
- default field selection logic

Risk: low to medium. Error messages may change.

Validation focus:

- successful query
- GraphQL error response
- HTTP error response
- auth headers
- variables
- `--fields`
- `--selection-depth`
- `--stdin`

## Phase 6: Consider GraphQL Tools for schema loading

Current schema loading in `src/graphql/load.ts` handles:

- endpoint introspection
- SDL files
- introspection JSON files
- schema URLs
- stale cache fallback

Optional dependencies:

```bash
pnpm add @graphql-tools/load @graphql-tools/url-loader @graphql-tools/graphql-file-loader @graphql-tools/json-file-loader
```

Possible target:

```ts
import { loadSchema } from '@graphql-tools/load';
import { UrlLoader } from '@graphql-tools/url-loader';
import { GraphQLFileLoader } from '@graphql-tools/graphql-file-loader';
import { JsonFileLoader } from '@graphql-tools/json-file-loader';

const schema = await loadSchema(source, {
  loaders: [new UrlLoader(), new GraphQLFileLoader(), new JsonFileLoader()],
  headers: Object.fromEntries(authHeaders),
});
```

Benefits:

- More robust schema loading.
- Better support for schema URLs/files.
- Less custom introspection/file parsing code.

Reasons to delay:

- Adds multiple dependencies.
- Current loader is not huge.
- We need to preserve custom stale-cache behavior.

Recommendation: do this only after `graphql-request`, and only if schema loading becomes a maintenance problem.

Risk: medium.

## Phase 7: Make GraphQL query generation safer with AST + `print`

Current query generation manually concatenates strings.

Use the existing `graphql` package to build an AST and print it:

```ts
import { print, Kind, type DocumentNode } from 'graphql';
```

Benefits:

- Reduces invalid query risks.
- Gives safer operation names, variable definitions, arguments, and nested selections.
- Makes future GraphQL features easier.

Tradeoff:

- May not reduce line count.
- Safer, but more verbose.

Recommendation: optional. Do this if GraphQL query generation gets more complex.

Risk: medium.

## Phase 8: Add JSON Schema validation/coercion with Ajv

Current coercion is intentionally small:

- `src/core/coerce.ts`

Recommended dependencies:

```bash
pnpm add ajv ajv-formats
```

Use cases:

- validate MCP tool args against input schemas
- validate OpenAPI params and request bodies
- provide better errors for invalid input
- eventually reduce custom coercion rules

Benefits:

- Better correctness.
- Better user-facing validation errors.
- Uses schemas already provided by MCP/OpenAPI.

Reasons to delay:

- Ajv adds complexity.
- Coercion semantics need careful design for CLI strings.
- Validation errors can be verbose unless formatted well.

Recommendation: add after parser/refactoring work, not first.

Risk: medium to high depending on how strict validation becomes.

## Phase 9: Optional HTTP helper library

Current HTTP usage relies on built-in `fetch`, which is fine on Node 20+.

Optional dependency:

```bash
pnpm add ky
```

Potential benefits:

- timeout support
- retries
- cleaner JSON handling
- hooks for auth headers

Reasons to avoid for now:

- Built-in `fetch` is adequate.
- Most code is protocol-specific, not generic HTTP boilerplate.
- Adding `ky` may not delete much code.

Recommendation: skip unless we need retries/timeouts globally.

## Phase 10: Optional cache library

Current cache module is small:

- `src/core/cache.ts`

Optional dependencies:

```bash
pnpm add cacache
```

Potential benefits:

- robust content-addressable cache
- integrity handling
- battle-tested npm-style cache behavior

Reasons to avoid for now:

- Current cache is simple and understandable.
- TTL behavior is project-specific.
- A cache dependency may add more complexity than it removes.

Recommendation: keep current cache until requirements grow.

## Recommended dependency changes

High-value additions:

```bash
pnpm add string-argv graphql-request
```

Use existing dependency:

```txt
@apidevtools/json-schema-ref-parser
```

Later, if needed:

```bash
pnpm add ajv ajv-formats
pnpm add @graphql-tools/load @graphql-tools/url-loader @graphql-tools/graphql-file-loader @graphql-tools/json-file-loader
```

Probably avoid for now:

```bash
pnpm add commander
pnpm add ky
pnpm add cacache
```

## Suggested implementation order

1. Add a shared dynamic-mode runner.
2. Replace OpenAPI `$ref` resolver with the existing ref parser dependency.
3. Replace MCP stdio command splitting with `string-argv`.
4. Replace GraphQL execution transport with `graphql-request`.
5. Replace CLI parsing with Node `util.parseArgs`.
6. Consider Ajv validation.
7. Consider GraphQL Tools schema loading.
8. Consider GraphQL AST query generation.

This order minimizes risk because it first removes duplication, then replaces isolated custom utilities, and only later changes parser behavior.

## Testing strategy

For each phase:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm fmt:check
pnpm build
```

Important smoke checks:

```bash
node dist/cli/main.js --version
node dist/cli/main.js --help
node dist/cli/main.js --graphql https://beta.pokeapi.co/graphql/v1beta --list
```

For MCP stdio after `string-argv`:

```bash
pnpm dev -- --mcp-stdio \
  "npx -y -p ajv -p @modelcontextprotocol/server-filesystem mcp-server-filesystem /tmp" \
  --list
```

## Success criteria

- Existing tests still pass.
- CLI examples still work.
- `src/cli/main.ts` is smaller and mostly dispatch-oriented.
- Custom parser/ref/schema/request helpers are removed where focused libraries are better.
- No large framework controls the dynamic CLI architecture.
