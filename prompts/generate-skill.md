---
description: Generate a new Agent/Pi skill from an MCP server, OpenAPI spec, or GraphQL endpoint
argument-hint: '<--mcp URL|--mcp-stdio CMD|--spec URL|FILE|--graphql URL> [skill-name] [destination]'
---

Generate a new Agent/Pi skill from this API source:

```txt
$ARGUMENTS
```

Use this workflow:

1. If the source, desired skill name, auth requirements, or destination is unclear, ask only the minimum follow-up questions.
2. Read and follow the `skill-creator` skill instructions. If the skill is not already loaded, load `/skill:skill-creator` or read the local `skills/skill-creator/SKILL.md` when present.
3. Use `skill-creator` to discover commands with `--list` or `--search`, inspect important commands with `<command> --help`, and test representative read-only calls first.
4. Create a focused `SKILL.md` for the target API.
   - Default destination: `.pi/skills/<kebab-case-skill-name>/SKILL.md`.
   - Use a user-provided destination if one is included in the arguments.
5. Include only tested workflows, practical examples, auth/secret handling, pagination/field-selection notes, and important gotchas.
6. Do not duplicate the entire CLI help output. Do not execute write/delete/destructive API operations unless the user explicitly requested them.
7. Validate the generated skill structure and frontmatter before finishing.
