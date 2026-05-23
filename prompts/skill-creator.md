---
description: Generate an API/tool skill and wrapper CLI
argument-hint: '<source flags or URL> [--name skill-name] [--agent agent] [--scope project|global]'
---

# Task: create a reusable agent command surface

Invocation arguments from the user/host:

```txt
$ARGUMENTS
```

Generate and install a complete Agent Skill plus thin wrapper CLI scripts from an MCP server, OpenAPI spec, GraphQL endpoint/schema, or similar API/tool source. This command is for creating reusable agent infrastructure, not for one-off API calls.

If the arguments block is empty or still a literal placeholder, infer the source from the surrounding user message. If the source, target agent, or install scope is still missing, ask only the minimum blocking questions.

## Research-backed command principles

Follow these principles when creating the generated skill and its scripts:

- Write instructions for the future agent, not prose about what the command would do.
- Keep command/prompt descriptions short, verb-led, and specific.
- Make the CLI inspectable: it must support discovery/help such as `--list`, `--search`, and `<command> --help`.
- Make output small by default: document `--head`, `--limit`, `--fields`, `--pretty`, `jq`, and file export patterns when useful.
- Preserve approval boundaries: identify write/delete/mutation commands and do not test destructive operations without explicit safe test data.
- Avoid raw secrets. Use environment variables or files, e.g. `--auth-header 'Authorization:env:API_TOKEN'`.
- Test the installed wrapper from the generated skill directory, exactly as a future agent will run it.

## Decide the target

1. Determine the target agent and install scope.
   - Agents commonly supported by `npx @asnd/skill-creator generate`: `pi`, `universal`, `codex`, `claude-code`, `cursor`, `opencode`, `gemini-cli`, `amp`, `github-copilot`, `goose`, `cline`, `windsurf`.
   - Scope is `project` or `global`.
2. Choose a spec-compliant skill name: lowercase kebab-case, 1-64 chars, letters/numbers/hyphens only, no leading/trailing hyphen, no consecutive hyphens.
3. Choose a script name, usually the same as the skill name.

## Prefer the built-in generator

Use `npx @asnd/skill-creator` for generator commands so the package does not need to be installed globally.

### OpenAPI

```bash
npx @asnd/skill-creator generate \
  --template openapi \
  --name <skill-name> \
  --spec <openapi-url-or-file> \
  --agent <agent> \
  --scope project|global
```

### GraphQL

```bash
npx @asnd/skill-creator generate \
  --template graphql \
  --name <skill-name> \
  --graphql <graphql-endpoint-url> \
  --graphql-schema <schema-url-or-file> \
  --agent <agent> \
  --scope project|global
```

If no schema is provided and introspection may fail, ask whether to introspect live or where to get SDL/introspection JSON.

### MCP HTTP/SSE

```bash
npx @asnd/skill-creator generate \
  --template mcp-http \
  --name <skill-name> \
  --mcp <mcp-url> \
  --agent <agent> \
  --scope project|global
```

### MCP stdio

```bash
npx @asnd/skill-creator generate \
  --template mcp-stdio \
  --name <skill-name> \
  --mcp-stdio '<server-command>' \
  --agent <agent> \
  --scope project|global
```

Useful optional flags:

```bash
--script <script-name>
--auth-header 'Header:env:ENV_NAME'
--base-url <url>
--description '<trigger-oriented generated skill description>'
--force
--no-test
```

## Refine the generated skill

After generation, inspect `SKILL.md` and rewrite it if needed so future agents know when and how to use the wrapper.

The generated skill should contain:

- Trigger-oriented frontmatter `description` that names the service and when to use it.
- Setup/auth environment variables; never raw secret values.
- Usage commands:
  - `./scripts/<script-name> --list`
  - `./scripts/<script-name> --search '<topic>'`
  - `./scripts/<script-name> <command> --help`
  - `./scripts/<script-name> --pretty <command> <flags>`
- Small-output guidance: limits, field selection, paging, raw/binary output, and `jq` examples when responses are nested.
- Safety notes for write/delete/mutation operations.
- References to bundled specs/schemas/docs instead of copied full help output.

Expected generated layout:

```txt
<skill-name>/
├── SKILL.md
├── scripts/
│   └── <script-name>
├── references/
│   ├── openapi-spec-MM-DD-YYYY.json|yaml       # OpenAPI when available
│   └── graphql-schema-MM-DD-YYYY.graphql|json  # GraphQL when available
└── assets/                                     # optional static resources
```

MCP skills usually do not need a source artifact in `references/`; add concise notes only when they help future agents.

## Smoke test

From the generated skill directory, run discovery/help first:

```bash
./scripts/<script-name> --list
./scripts/<script-name> --search '<topic>'
./scripts/<script-name> <command> --help
```

Then run at most one safe read-only command with bounded output, for example:

```bash
./scripts/<script-name> --pretty --head 3 <safe-read-command> <flags>
```

If auth, billing, network, or destructive side effects block testing, do not fake success. Record exactly what was skipped and why.

## Manual path for unsupported sources

If `npx @asnd/skill-creator generate` does not support the source:

1. Create the selected agent/scope skill directory manually.
2. Add executable scripts in `scripts/` that hide setup/source details and expose a simple, inspectable CLI.
3. Add stable specs, schemas, docs excerpts, examples, or notes under `references/`.
4. Write `SKILL.md` using the requirements above.
5. `chmod +x scripts/<script-name>` and smoke-test from the skill directory.

## Final response

Report:

- Installed skill path and target agent/scope.
- Files created or changed.
- Wrapper commands future agents should use.
- Required environment variables or auth setup.
- Commands tested and results.
- Anything intentionally not tested.
