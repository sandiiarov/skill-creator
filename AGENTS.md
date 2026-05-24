# AGENTS.md

Guidance for coding agents working in this repository.

## Project overview

- Package: `@asnd/skill-creator` (CLI binary: `skill-creator`)
- Purpose: TypeScript CLI that turns MCP servers, OpenAPI specs, and GraphQL endpoints into runtime CLIs without code generation.
- Runtime: Node.js >= 26, ESM modules.
- Package manager: pnpm.

## Useful commands

- Install dependencies: `pnpm install`
- Run CLI in development: `pnpm dev -- <args>`
- Build: `pnpm build`
- Test: `pnpm test`
- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint`
- Format check: `pnpm fmt:check`
- Format: `pnpm fmt`

## Repository layout

- `src/cli/` - CLI entrypoint and argument parsing.
- `src/core/` - shared runtime utilities, types, output, filtering, caching, and secret handling.
- `src/openapi/` - OpenAPI loading, reference resolution, parameter handling, extraction, and execution.
- `src/**/*.test.ts` - Vitest tests colocated next to the source they cover.
- `src/test-fixtures/` - shared test fixtures.
- `dist/` - build output; do not edit manually.

## Coding guidelines

- Prefer small, focused TypeScript modules with explicit types.
- Keep code ESM-compatible and avoid CommonJS patterns.
- Validate external inputs with existing Zod/type utilities where practical.
- Add or update Vitest coverage for behavior changes.
- Do not hand-edit generated build artifacts in `dist/`.
- Use existing formatter/linter settings (`oxfmt`, `oxlint`) rather than introducing new style conventions.

## Before finishing changes

Run the relevant checks for the change size:

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm lint`
4. `pnpm fmt:check`
