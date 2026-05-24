---
description: Generate an API/tool skill and wrapper CLI
argument-hint: '<source flags or URL> [--name skill-name] [--agent agent] [--scope project|global]'
---

# Task: create a reusable agent skill

Invocation arguments from the user/host:

```txt
$ARGUMENTS
```

You are running inside an AI agent after the user installed this command with `npx @asnd/skill-creator command install`. Your job is to create and install a reusable Agent Skill for an API/tool source.

The CLI generator creates a scaffold. You must research the source, generate the scaffold, read the generated files, rewrite `SKILL.md` using the guide below, and smoke test the result. Do not stop after generation unless the user explicitly asks for scaffold-only output.

## Workflow

### 1. Understand the request

- Parse `$ARGUMENTS` and the surrounding user message.
- Identify the source type: OpenAPI, GraphQL, MCP HTTP/SSE, MCP stdio, or unsupported/manual.
- Identify target `--agent`, `--scope`, skill name, script name, auth requirements, and base URL.
- Always ask the user for install scope when `--scope project|global` is not explicitly provided. Do not infer or default the scope.
- Ask for target agent when `--agent` is not explicitly provided and cannot be determined from the host agent with certainty.
- If any other blocking decision is ambiguous, ask the user before generating. Ask only the minimum necessary questions.

### 2. Research the source

- Find the actual machine-readable spec/schema/endpoint, not just a human docs page.
- Check whether the source represents one API surface or multiple distinct APIs. If multiple skills may be appropriate and the choice is not obvious, ask the user.
- Identify auth headers, environment variable names, base URLs, and any network/runtime requirements.
- Prefer stable official spec/schema URLs or bundled local files.

### 3. Generate the scaffold

Use `npx @asnd/skill-creator generate` so the package does not need to be installed globally.

OpenAPI:

```bash
npx @asnd/skill-creator generate \
  --template openapi \
  --name <skill-name> \
  --spec <openapi-url-or-file> \
  --agent <agent> \
  --scope project|global
```

GraphQL:

```bash
npx @asnd/skill-creator generate \
  --template graphql \
  --name <skill-name> \
  --graphql <graphql-endpoint-url> \
  --graphql-schema <schema-url-or-file> \
  --agent <agent> \
  --scope project|global
```

If no GraphQL schema is available and introspection may fail, ask whether to introspect live or where to get SDL/introspection JSON.

MCP HTTP/SSE:

```bash
npx @asnd/skill-creator generate \
  --template mcp-http \
  --name <skill-name> \
  --mcp <mcp-url> \
  --agent <agent> \
  --scope project|global
```

MCP stdio:

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
--description '<specific task coverage and when to use this skill>'
--force
--no-test
```

Use `--force` only when the user asked to overwrite or you are clearly regenerating the same target. Use `--no-test` only when generator smoke testing would be blocked by auth, network, billing, or unavailable runtime.

### 4. Inspect generated files

After generation, read:

- `<skill-dir>/SKILL.md`
- `<skill-dir>/scripts/<script-name>`
- `<skill-dir>/references/*` when present

Run discovery/help from the generated skill directory when possible:

```bash
./scripts/<script-name> commands list
./scripts/<script-name> commands search '<topic>'
./scripts/<script-name> commands help <command-or-tool>
```

Use this information to make the final `SKILL.md` specific to the generated wrapper and source.

### 5. Rewrite `SKILL.md`

Rewrite the generated `SKILL.md`; do not merely append notes. Keep it concise and agent-oriented. Use the structure below, removing sections that do not apply while preserving the order of sections that remain.

````md
---
name: <skill-name>
description: <specific task coverage and when to use this skill>
---

# <Service or tool name>

One short sentence telling the future agent to use the bundled Bash wrapper and bundled references.

## Requirements

Include this section only when prerequisites exist. Use one bullet per prerequisite:

- `<ENV_NAME>` must be available in the environment for `<auth scheme/header>` auth.
- `<runtime/tool>` must be available when the wrapper cannot avoid that dependency.

Do not include setup tutorials, `export ...` examples, raw secrets, or generic compatibility prose.

## Start here

Use discovery/help commands adapted to the script name and whether the surface calls entries commands or tools:

```bash
./scripts/<script-name> commands list
./scripts/<script-name> commands search '<topic>'
./scripts/<script-name> commands help <command-or-tool>
./scripts/<script-name> run --pretty <command-or-tool> <flags>
```

## Usage rules

Write short bullets that tell the agent how to operate the wrapper:

- Run discovery first: `commands list`, `commands search`, then `commands help <command-or-tool>`.
- Execute commands/tools with `run <command-or-tool>`. Put wrapper run flags after `run` and before the command/tool name.
- Put command/tool-specific flags after the command/tool name.
- Pass JSON object/array values as quoted JSON strings.
- Prefer safe read-only commands/tools before write/admin commands/tools.

## Output control

Write short bullets that keep context small:

- Bound first reads with `--head 3`, API/tool limit flags, cursors, or narrow IDs.
- Use `--fields a,b,c` when only a subset of response fields is needed.
- Use `--pretty` for readable JSON.
- Redirect raw, binary, or large responses to files instead of printing them.
- Add one `jq` example only if the API returns deeply nested data and the example is service-specific.

## Safety

Write short bullets that identify risky operation classes for this source:

- Treat create/update/delete/cancel/trigger/import/webhook/admin/research operations as mutating or potentially costly.
- Do not run mutating operations unless the user explicitly asks and provides safe target IDs or test data.
- For destructive operations, confirm the target ID and intended effect first.

## References

List bundled references only. Do not copy full API docs or command help into `SKILL.md`:

- `references/<file>` — what it contains and when to read it.
````

Final `SKILL.md` rules:

- Frontmatter must contain only `name` and `description`.
- Description must include what the skill does and when to use it.
- Use instructions for the future agent, not human marketing prose.
- Keep large docs, schemas, examples, and copied help out of `SKILL.md`; put or leave them in `references/`.
- Scripts in `scripts/` must be Bash entrypoints. Do not create Python, TypeScript, or JavaScript wrapper scripts; Bash may delegate to `npx @asnd/skill-creator`.

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

### 6. Smoke test

From the generated skill directory, run discovery/help first:

```bash
./scripts/<script-name> commands list
./scripts/<script-name> commands search '<topic>'
./scripts/<script-name> commands help <command-or-tool>
```

Then run at most one safe read-only command/tool with bounded output, for example:

```bash
./scripts/<script-name> run --pretty --head 3 <safe-read-command-or-tool> <flags>
```

If auth, billing, network, missing runtime, or destructive side effects block testing, do not fake success. Record exactly what was skipped and why.

## Manual path for unsupported sources

If `npx @asnd/skill-creator generate` does not support the source:

1. Create the selected agent/scope skill directory manually.
2. Add executable Bash scripts in `scripts/` that hide setup/source details and expose a simple, inspectable CLI. Do not use Python, TypeScript, or JavaScript wrapper scripts.
3. Add stable specs, schemas, docs excerpts, examples, or notes under `references/`.
4. Write `SKILL.md` using the structure above.
5. `chmod +x scripts/<script-name>` and smoke-test from the skill directory.

## Final response

Report:

- Installed skill path and target agent/scope.
- Files created or changed.
- Wrapper commands future agents should use.
- Required environment variables or auth setup.
- Commands tested and results.
- Anything intentionally not tested.
