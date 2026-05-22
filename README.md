# skill-creator

TypeScript CLI for turning MCP servers, OpenAPI specs, and GraphQL endpoints into runtime CLIs with no codegen.

Built test-first with pnpm, TypeScript/tsgo, Vitest, and Zod. Runtime: Node.js 26+ ESM.

## Quick start

```bash
pnpm install
pnpm build
node dist/cli/main.js --help
```

Development:

```bash
pnpm dev -- --help
```

## Sources

Exactly one source is required:

```bash
# OpenAPI
skill-creator --spec ./openapi.json --list
skill-creator --spec https://petstore3.swagger.io/api/v3/openapi.json --list

# MCP over Streamable HTTP or SSE
skill-creator --mcp https://api.example.com/mcp --list

# MCP over stdio
skill-creator --mcp-stdio "npx -y @modelcontextprotocol/server-filesystem /tmp" --list

# GraphQL
skill-creator --graphql https://beta.pokeapi.co/graphql/v1beta --list
```

## Useful global options

```txt
--auth-header K:V       HTTP header; values support env:NAME and file:/path
--transport TYPE        MCP HTTP transport: auto|streamable|sse (default: auto)
--include GLOBS         Include command globs, comma-separated
--exclude GLOBS         Exclude command globs, comma-separated
--methods METHODS       OpenAPI method filter, e.g. GET,POST
--graphql-schema SRC    GraphQL SDL or introspection JSON schema FILE|URL
--cache-ttl SECONDS     Cache TTL for remote specs, MCP tools, GraphQL schemas
--refresh               Bypass cache
--search PATTERN        Search commands/tools
--fields FIELDS         GraphQL selection override
--selection-depth N     GraphQL default selection depth (default: 2)
--stdin                 Read GraphQL variables from stdin JSON
--pretty                Pretty-print JSON
--raw                   Print raw response body
--head N                Limit arrays to first N records
```

## Recipes

### GitHub remote MCP

GitHub's hosted MCP endpoint works with PAT-style auth headers. Prefer `env:` so tokens are not passed literally in shell history or process listings.

```bash
export GITHUB_MCP_PAT="Bearer $(gh auth token)"

node dist/cli/main.js \
  --mcp https://api.githubcopilot.com/mcp/x/repos/readonly \
  --auth-header Authorization:env:GITHUB_MCP_PAT \
  --list

node dist/cli/main.js \
  --mcp https://api.githubcopilot.com/mcp/x/repos/readonly \
  --auth-header Authorization:env:GITHUB_MCP_PAT \
  get-file-contents \
  --owner github \
  --repo github-mcp-server \
  --path README.md
```

### Filesystem MCP over stdio

On some current npm installs the filesystem server needs `ajv` supplied explicitly:

```bash
pnpm dev -- --mcp-stdio \
  "npx -y -p ajv -p @modelcontextprotocol/server-filesystem mcp-server-filesystem /tmp" \
  --list

printf 'hello from filesystem mcp\n' > /tmp/skill-creator-test.txt

pnpm dev -- --mcp-stdio \
  "npx -y -p ajv -p @modelcontextprotocol/server-filesystem mcp-server-filesystem /tmp" \
  read-text-file --path /private/tmp/skill-creator-test.txt
```

On macOS, `/tmp` resolves to `/private/tmp`; use the resolved path if the server reports an allowed-directory error.

### PokeAPI GraphQL

```bash
node dist/cli/main.js \
  --graphql https://beta.pokeapi.co/graphql/v1beta \
  --list

node dist/cli/main.js \
  --graphql https://beta.pokeapi.co/graphql/v1beta \
  --fields "id name" \
  pokemon-v2-pokemon \
  --limit 3

node dist/cli/main.js \
  --graphql https://beta.pokeapi.co/graphql/v1beta \
  --fields "id name height weight" \
  pokemon-v2-pokemon-by-pk \
  --id 25
```

GraphQL variables can also come from stdin:

```bash
echo '{"limit": 3}' | node dist/cli/main.js \
  --graphql https://beta.pokeapi.co/graphql/v1beta \
  pokemon-v2-pokemon \
  --stdin
```

### GraphQL endpoints without introspection

By default, `--graphql` introspects the endpoint to discover commands. If introspection is disabled, provide a schema SDL file or introspection JSON file/URL:

```bash
node dist/cli/main.js \
  --graphql https://api.example.com/graphql \
  --graphql-schema ./schema.graphql \
  --list

node dist/cli/main.js \
  --graphql https://api.example.com/graphql \
  --graphql-schema ./introspection.json \
  users --limit 10
```

If no schema is provided and introspection fails, skill-creator tries a stale cached schema for that endpoint. If no cache exists, it fails with an actionable `--graphql-schema` message.

### Filtering command lists

```bash
# Only list read operations from an OpenAPI spec
skill-creator --spec ./openapi.json --methods GET --list

# Include/exclude by command name
skill-creator --graphql https://beta.pokeapi.co/graphql/v1beta \
  --include 'pokemon-v2-pokemon*' \
  --exclude '*aggregate' \
  --list
```

## Checks

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm fmt:check
pnpm build
```
