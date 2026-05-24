# Runtime command namespace refactor plan

## Goal

Refactor generated wrapper CLIs so wrapper/discovery behavior cannot collide with generated API/tool command names or command flags.

Target documented UX:

```bash
./scripts/<script> commands list
./scripts/<script> commands search '<topic>'
./scripts/<script> commands help <command-or-tool>

./scripts/<script> run <command-or-tool> <command-or-tool-flags>
./scripts/<script> run --pretty --head 3 <command-or-tool> <command-or-tool-flags>
```

Keep legacy syntax working for backward compatibility, but stop documenting it:

```bash
./scripts/<script> --list
./scripts/<script> --search '<topic>'
./scripts/<script> <command-or-tool> --help
./scripts/<script> --pretty <command-or-tool> <flags>
```

## Why

Current runtime globals include `--list`, `--search`, `--fields`, `--head`, `--raw`, `--stdin`, `--include`, `--exclude`, and `--methods`. These can conflict with natural API/tool parameter names and with generated command names such as `search` or `list`.

A namespaced runtime makes the mental model explicit:

- `commands ...` means inspect generated commands/tools.
- `run ...` means execute one generated command/tool.
- flags after the generated command/tool name belong to that command/tool.

## Current code map

### CLI entrypoint

File: `src/cli/main.ts`

Responsibilities:

- Dispatches top-level package commands:
  - `generate` -> `runGenerate()`
  - `command` / `commands` / `install-command` -> `runInstallCommand()`
- Runtime source modes:
  - `--spec` -> OpenAPI runtime
  - `--graphql` -> GraphQL runtime
  - `--mcp` -> MCP HTTP/SSE runtime
  - `--mcp-stdio` -> MCP stdio runtime
- Defines current global option spec and help text.

Important current globals:

```txt
--spec --mcp --mcp-stdio --graphql --graphql-schema --base-url --auth-header --transport
--cache-key --cache-ttl --refresh
--list --search --include --exclude --methods
--fields --selection-depth --head --pretty --raw --stdin
--version --help -h
```

### Argument splitting

File: `src/cli/parse.ts`

`splitAtSubcommand(argv, spec)` currently splits runtime global options from the first positional subcommand. This is why old syntax works:

```bash
skill-creator --spec spec.json --pretty get-user --id 123
```

The first positional (`get-user`) becomes `commandArgv[0]`.

### Dynamic runtime

File: `src/cli/dynamic.ts`

`runDynamicMode()` currently handles:

- global `--search`: filter/list commands
- global `--list`: list commands
- empty command behavior
- `<command> --help`
- parse generated command options
- execute command and format output

This is the main place to add explicit runtime modes.

### Extractors

Files:

- `src/openapi/extract.ts`
- `src/graphql/extract.ts`
- `src/mcp/extract.ts`

All return `CommandDef[]`. They should not need major changes.

### Generator templates

File: `src/skills/generate.ts`

Currently generated `SKILL.md` documents legacy syntax:

```bash
./scripts/<script> --list
./scripts/<script> --search '<topic>'
./scripts/<script> <command> --help
./scripts/<script> --pretty <command> <flags>
```

Must be updated to document namespaced syntax.

### Prompt command template

File: `prompts/skill-creator.md`

This is installed into Pi as `/skill-creator`. It currently instructs the AI agent how to generate and refine skills. It must be updated to use namespaced wrapper syntax.

### README

File: `README.md`

Must update usage examples and claims around `--list`, `--search`, and `--help`.

## Proposed runtime grammar

### Source options

Source options remain at the beginning and identify the backend source:

```bash
skill-creator --spec spec.json ...
skill-creator --graphql https://example.com/graphql ...
skill-creator --mcp https://example.com/mcp ...
skill-creator --mcp-stdio 'node server.js' ...
```

### Discovery namespace

```bash
skill-creator <source-options> commands list [filter-options]
skill-creator <source-options> commands search <pattern> [filter-options]
skill-creator <source-options> commands help <command-or-tool> [filter-options]
```

Filter options for discovery:

```txt
--include GLOBS
--exclude GLOBS
--methods METHODS
```

Notes:

- `commands search <pattern>` replaces documented `--search <pattern>`.
- `commands help <name>` replaces documented `<name> --help`.
- Keep `--list` and `--search` as legacy aliases.

### Execution namespace

```bash
skill-creator <source-options> run [run-options] <command-or-tool> [command-or-tool-options]
```

Run options before generated command/tool name:

```txt
--pretty
--raw
--head N
--fields FIELDS
--stdin
--selection-depth N
```

Generated command/tool options after generated command/tool name must be parsed only by `parseCommandValues()`.

Examples:

```bash
./scripts/api run --pretty --head 3 search --query cats --num-results 3
./scripts/api run update-item --id 123 --fields '{"name":"new"}'
```

If generated command has flags named `--list` or `--search`, this is now safe:

```bash
./scripts/api run some-command --list true --search cats
```

### Legacy compatibility

Keep supporting current forms:

```bash
skill-creator <source-options> --list
skill-creator <source-options> --search '<pattern>'
skill-creator <source-options> <command-or-tool> --help
skill-creator <source-options> --pretty <command-or-tool> <flags>
```

But generated docs/templates should stop showing legacy syntax.

## Implementation steps

### 1. Add runtime command mode parsing

Likely files:

- `src/cli/main.ts`
- `src/cli/dynamic.ts`
- possibly `src/cli/parse.ts`

Approach:

1. Continue using `splitAtSubcommand()` to separate source/global options from first positional.
2. In `runDynamicMode()`, inspect `commandArgv[0]`:
   - `commands` -> discovery namespace
   - `run` -> execution namespace
   - otherwise -> legacy mode
3. Add helper parsing functions:
   - `parseCommandsModeArgv(argv)`
   - `parseRunModeArgv(argv)`

`commands` mode behavior:

- `commands list` -> render filtered command list
- `commands search <pattern>` -> search and render command list
- `commands help <name>` -> render help for command/tool

`run` mode behavior:

- Split run wrapper options before generated command/tool name.
- Apply run options to output globals.
- Execute selected command/tool with remaining generated command/tool args.

### 2. Make command help reusable

File: `src/cli/dynamic.ts`

`renderCommandHelp()` is currently private and used for legacy `<command> --help`. Keep private or expose a local helper for both:

- legacy `<command> --help`
- new `commands help <command>`
- new `run <command> --help` if desired

Decision: support both:

```bash
./scripts/foo commands help get-user
./scripts/foo run get-user --help
```

### 3. Keep filter behavior consistent

Current global `--include`, `--exclude`, and `--methods` are applied before `runDynamicMode()` sees commands. That should continue for source-global filters.

For `commands list --include ...`, `commands search ... --methods ...`, either:

- parse those options in `parseGlobalArgs()` before `commands`, if placed before `commands`, or
- add local parsing inside `commands` mode for options after `commands list/search`.

Recommended first implementation:

- Support filters before `commands` initially:
  ```bash
  ./scripts/foo --include 'websets-*' commands list
  ```
- Optionally support filters after `commands list` as a second pass if easy.

Generated docs can avoid showing post-command filters.

### 4. Update generated skill templates

File: `src/skills/generate.ts`

Update:

- `Try:` output:

  ```txt
  Try: scripts/<script> commands list
  ```

- Smoke test script:
  currently runs `script --list`; change to:

  ```txt
  script commands list
  ```

- API skill `Start here`:

  ```bash
  ./scripts/<script> commands list
  ./scripts/<script> commands search '<topic>'
  ./scripts/<script> commands help <command>
  ./scripts/<script> run --pretty <command> <flags>
  ```

- MCP skill `Start here`:

  ```bash
  ./scripts/<script> commands list
  ./scripts/<script> commands search '<topic>'
  ./scripts/<script> commands help <tool>
  ./scripts/<script> run --pretty <tool> <flags>
  ```

- Usage rules:
  - Discovery uses `commands list/search/help`.
  - Execution uses `run`.
  - Wrapper run flags go after `run` and before command/tool.
  - Command/tool flags go after command/tool.

### 5. Update `/skill-creator` prompt template

File: `prompts/skill-creator.md`

Update all discovery/help/smoke-test examples:

```bash
./scripts/<script-name> commands list
./scripts/<script-name> commands search '<topic>'
./scripts/<script-name> commands help <command-or-tool>
./scripts/<script-name> run --pretty <command-or-tool> <flags>
```

Update rules to explain:

- `commands ...` inspects generated commands/tools.
- `run ...` executes generated commands/tools.
- run wrapper flags belong between `run` and command/tool.
- generated flags belong after command/tool.

### 6. Update README

File: `README.md`

Update examples currently showing:

```bash
./scripts/youtube --list
./scripts/youtube --search videos
./scripts/youtube <command> --help
./scripts/youtube --pretty <command> <flags>
```

To:

```bash
./scripts/youtube commands list
./scripts/youtube commands search videos
./scripts/youtube commands help <command>
./scripts/youtube run --pretty <command> <flags>
```

Update claims like:

```txt
Wrapper scripts expose discoverable commands with `--list`, `--search`, and `--help`.
```

To:

```txt
Wrapper scripts expose discoverable commands with `commands list`, `commands search`, and `commands help`.
```

### 7. Update tests

#### Runtime CLI tests

Files likely needing updates/additions:

- `src/cli/openapi-cli.test.ts`
- `src/cli/graphql-cli.test.ts`
- `src/cli/mcp-http-cli.test.ts`
- `src/cli/mcp-stdio-cli.test.ts`
- `src/cli/parse.test.ts`

Add tests for:

- OpenAPI:
  - `commands list`
  - `commands search <pattern>`
  - `commands help <command>`
  - `run <command> <flags>`
  - `run --pretty --head 3 <command> <flags>`
- GraphQL:
  - `commands list`
  - `commands help <query>`
  - `run <query> <flags>`
- MCP:
  - `commands list`
  - `commands help <tool>`
  - `run <tool> <flags>`

Add collision regression tests:

- Generate or fixture command with parameter named `list`; verify:
  ```bash
  ... run command-with-list-param --list value
  ```
- Generate or fixture command with parameter named `search`; verify:
  ```bash
  ... run command-with-search-param --search value
  ```

#### Generator tests

Files:

- `src/skills/generate.test.ts`
- `src/skills/generate.e2e.test.ts`

Update assertions from legacy syntax to new namespaced syntax.

E2E fake `npx` should call generated wrapper with:

```txt
commands list
```

or also test:

```txt
run --pretty --head 3 <command>
```

#### Command install tests

File:

- `src/commands/install.test.ts`

Update assertions for bundled prompt content to look for:

- `commands list`
- `commands search`
- `commands help`
- `run --pretty`

### 8. Update help text

File: `src/cli/main.ts`

Add help documentation for new runtime grammar:

```txt
Discovery:
  commands list                  List available generated commands/tools
  commands search PATTERN        Search generated commands/tools
  commands help NAME             Show help for a generated command/tool

Execution:
  run [run options] NAME [flags] Execute a generated command/tool
```

Mark legacy `--list` and `--search` as legacy aliases or omit them from main examples but keep in option list as compatibility aliases.

### 9. Backward compatibility policy

Do not remove current flags yet:

- `--list`
- `--search`
- legacy `<command> --help`
- legacy direct execution

But generated documentation and prompt templates should only recommend the namespaced syntax.

## Potential parser details

### `commands` mode

Input examples after source-global splitting:

```ts
['commands', 'list'][('commands', 'search', 'websets')][('commands', 'help', 'get-user')];
```

Validation:

- Missing action -> error with examples.
- Unknown action -> error.
- Missing pattern/name -> error.

### `run` mode

Input examples after source-global splitting:

```ts
['run', 'get-user', '--id', '123'][('run', '--pretty', '--head', '3', 'get-user', '--id', '123')];
```

Run option parsing must stop at first non-option token after `run`. That token is generated command/tool name. Everything after it is generated command/tool args.

Known run value options:

```txt
--head
--fields
--selection-depth
```

Known run booleans:

```txt
--pretty
--raw
--stdin
```

If unknown option appears before command/tool name, decide whether to:

- treat as error, or
- assume command/tool name missing.

Recommended: error with message explaining wrapper run options must come before command/tool, command/tool options after command/tool.

## Acceptance criteria

- New syntax works for OpenAPI, GraphQL, MCP HTTP, and MCP stdio.
- Generated `SKILL.md` and `/skill-creator` prompt document only new syntax.
- README documents only new syntax.
- Legacy syntax still passes existing tests or dedicated compatibility tests.
- Collision regression tests prove generated command flags named `--list` and `--search` work under `run`.
- `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm fmt:check` pass.
