---
name: skill-creator
description: Turn MCP servers, OpenAPI specs, and GraphQL endpoints into runtime CLIs. Use when a user wants to discover available tools/endpoints, list commands, inspect command parameters, call MCP/OpenAPI/GraphQL operations, test an API from the shell, or create a skill/workflow around an API without writing generated client code.
---

# skill-creator

Use `skill-creator` to turn an MCP server, OpenAPI spec, or GraphQL endpoint into a CLI at runtime. Commands and flags are discovered dynamically from the source.

This TypeScript port currently supports:

- OpenAPI specs from local files or remote URLs
- MCP over stdio
- MCP over Streamable HTTP with SSE fallback
- GraphQL introspection, provided SDL schemas, and introspection JSON schemas
- filtering, caching, auth headers, output formatting, and GraphQL stdin variables

## Core workflow

1. Connect to exactly one source.
2. Discover available commands with `--list` or `--search`.
3. Inspect a command with `<command> --help`.
4. Execute the command with flags. Put global options before the subcommand and command-specific options after it.

```bash
# OpenAPI
skill-creator --spec ./openapi.json --list
skill-creator --spec ./openapi.json --pretty get-pet --id 1

# MCP over HTTP: auto tries Streamable HTTP then SSE
skill-creator --mcp https://mcp.example.com/mcp --list
skill-creator --mcp https://mcp.example.com/mcp search --query "test"

# MCP over stdio
skill-creator --mcp-stdio "node server.js" --list
skill-creator --mcp-stdio "node server.js" echo --message "hello"

# GraphQL
skill-creator --graphql https://api.example.com/graphql --list
skill-creator --graphql https://api.example.com/graphql users --limit 10
```

## CLI reference

```txt
skill-creator [global options] <subcommand> [command options]

Source (mutually exclusive, one required):
  --spec URL|FILE       OpenAPI spec (JSON or YAML, local or remote)
  --mcp URL             MCP server URL (HTTP/SSE)
  --mcp-stdio CMD       MCP server command (stdio transport)
  --graphql URL         GraphQL endpoint URL

Options:
  --auth-header K:V     HTTP header; values support env:NAME and file:/path
  --transport TYPE      MCP HTTP transport: auto|streamable|sse (default: auto)
  --base-url URL        Override OpenAPI base URL
  --graphql-schema SRC  GraphQL SDL or introspection JSON schema FILE|URL
  --cache-key KEY       Custom cache key
  --cache-ttl SECONDS   Cache TTL (default: 3600)
  --refresh             Bypass cache
  --list                List available commands
  --search PATTERN      Search by command name or description
  --include GLOBS       Include command globs, comma-separated
  --exclude GLOBS       Exclude command globs, comma-separated
  --methods METHODS     OpenAPI method filter, e.g. GET,POST
  --fields FIELDS       GraphQL selection override, e.g. "id name email"
  --selection-depth N   GraphQL default selection depth (default: 2)
  --stdin               Read GraphQL variables from stdin JSON
  --pretty              Pretty-print JSON
  --raw                 Print raw response body
  --head N              Limit array output to first N records
  --help, -h            Show help
  --version             Show version
```

## Authentication

Prefer `env:` or `file:` secret references. Do not pass raw tokens literally.

```bash
export API_TOKEN="Bearer ..."

skill-creator --mcp https://api.example.com/mcp \
  --auth-header Authorization:env:API_TOKEN \
  --list

skill-creator --spec https://api.example.com/openapi.json \
  --auth-header x-api-key:file:/run/secrets/api-key \
  list-items
```

## MCP patterns

### Transport selection

```bash
# Default: Streamable HTTP, then SSE fallback
skill-creator --mcp https://mcp.example.com/mcp --list

# Force Streamable HTTP only
skill-creator --mcp https://mcp.example.com/mcp --transport streamable --list

# Force legacy SSE
skill-creator --mcp https://mcp.example.com/sse --transport sse --list
```

### GitHub remote MCP

```bash
export GITHUB_MCP_PAT="Bearer $(gh auth token)"

skill-creator \
  --mcp https://api.githubcopilot.com/mcp/x/repos/readonly \
  --auth-header Authorization:env:GITHUB_MCP_PAT \
  --list

skill-creator \
  --mcp https://api.githubcopilot.com/mcp/x/repos/readonly \
  --auth-header Authorization:env:GITHUB_MCP_PAT \
  get-file-contents \
  --owner github \
  --repo github-mcp-server \
  --path README.md
```

### Filesystem MCP over stdio

Current npm installs may need `ajv` supplied explicitly:

```bash
skill-creator --mcp-stdio \
  "npx -y -p ajv -p @modelcontextprotocol/server-filesystem mcp-server-filesystem /tmp" \
  --list
```

On macOS, `/tmp` resolves to `/private/tmp`. If the filesystem server rejects `/tmp/foo`, retry with `/private/tmp/foo`.

## OpenAPI patterns

```bash
# Discover operations
skill-creator --spec https://petstore3.swagger.io/api/v3/openapi.json --list

# Override base URL if the spec lacks usable servers
skill-creator --spec ./openapi.json --base-url https://api.example.com/v1 --list

# Filter to safer read-only operations
skill-creator --spec ./openapi.json --methods GET --list

# Include/exclude by generated command names
skill-creator --spec ./openapi.json --include 'list-*' --exclude '*internal*' --list
```

## GraphQL patterns

### Introspected endpoints

```bash
skill-creator --graphql https://beta.pokeapi.co/graphql/v1beta --list

skill-creator --graphql https://beta.pokeapi.co/graphql/v1beta \
  --fields "id name" \
  pokemon-v2-pokemon \
  --limit 3
```

### Endpoints without introspection

If introspection is disabled, provide SDL or introspection JSON with `--graphql-schema`.

```bash
skill-creator --graphql https://api.example.com/graphql \
  --graphql-schema ./schema.graphql \
  --list

skill-creator --graphql https://api.example.com/graphql \
  --graphql-schema ./introspection.json \
  users --limit 10
```

If no schema is provided and introspection fails, skill-creator tries a stale cached schema. If none exists, provide `--graphql-schema`.

### Variables from stdin

Use `--stdin` for GraphQL variables that are easier to pass as JSON.

```bash
echo '{"limit": 3}' | skill-creator \
  --graphql https://beta.pokeapi.co/graphql/v1beta \
  pokemon-v2-pokemon \
  --stdin
```

### Selection sets

Use `--fields` for precise output and to avoid oversized nested responses.

```bash
skill-creator --graphql https://beta.pokeapi.co/graphql/v1beta \
  --fields "id name height weight" \
  pokemon-v2-pokemon-by-pk \
  --id 25
```

If no `--fields` is supplied, skill-creator builds a default selection set. Use `--selection-depth 1` to keep it shallow.

## Caching and refresh

Remote OpenAPI specs, MCP HTTP tool lists, and GraphQL schemas are cached under `~/.cache/skill-creator` by default. Override with `SKILL_CREATOR_CACHE_DIR`.

```bash
skill-creator --graphql https://api.example.com/graphql --refresh --list
skill-creator --mcp https://mcp.example.com/mcp --cache-ttl 86400 --list
```

## Output handling

```bash
# Pretty JSON
skill-creator --spec ./openapi.json --pretty list-pets

# Raw response body
skill-creator --spec ./openapi.json --raw download-report > report.json

# Preview large arrays
skill-creator --graphql https://api.example.com/graphql --head 5 users
```

## Creating another skill around an API

When asked to create a skill for a specific API, use skill-creator to explore first, then document the practical findings.

1. Discover commands:

   ```bash
   skill-creator --mcp https://target.example.com/mcp --list
   skill-creator --spec https://target.example.com/openapi.json --list
   skill-creator --graphql https://target.example.com/graphql --list
   ```

2. Inspect important commands:

   ```bash
   skill-creator --mcp https://target.example.com/mcp <command> --help
   ```

3. Test representative read-only calls first. Use `--head`, `--fields`, and `--pretty` to control output size.

4. Record gotchas in the generated `SKILL.md`:
   - required auth scopes and safe secret passing
   - pagination defaults and limits
   - date/time formats
   - fields that cause huge responses
   - binary or raw output handling
   - write/delete operations to avoid unless explicitly requested

5. Prefer wrapper scripts or documented command templates for repeated connection flags. This TypeScript port does not include bake mode.

Do not duplicate the entire `--help` output in generated skills. Focus on tested workflows, surprising defaults, anti-patterns, and examples that are known to work.
