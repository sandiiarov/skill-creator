#!/usr/bin/env bash
set -euo pipefail

source "${E2E_ROOT}/e2e/lib.sh"

sandbox="$(create_sandbox real-generated-wrappers)"
project="${sandbox}/project"
mkdir -p "${project}"
isolate_env "${sandbox}/env"

pids=()
cleanup() {
  stop_fixtures "${pids[@]:-}"
}
trap cleanup EXIT

# OpenAPI: generate without --no-test, then use the generated wrapper through real npx.
export PETSTORE_API_KEY="petstore-e2e-key"
openapi_ready="${sandbox}/openapi-ready.json"
openapi_log="${sandbox}/openapi-server.log"
pids+=("$(start_fixture openapi-server.mjs "${openapi_ready}" "${openapi_log}")")
openapi_base_url="$(json_get "${openapi_ready}" baseUrl)"
openapi_spec="${project}/petstore.json"
write_petstore_spec "${openapi_spec}"

openapi_generate_output="$(run_cli "${project}" generate \
  --template openapi \
  --name petstore-api \
  --spec "${openapi_spec}" \
  --base-url "${openapi_base_url}" \
  --auth-header "x-api-key:env:PETSTORE_API_KEY" \
  --agent pi \
  --scope project)"
assert_contains "${openapi_generate_output}" "Generated skill:"

openapi_skill="${project}/.pi/skills/petstore-api"
openapi_wrapper="${openapi_skill}/scripts/petstore-api"
assert_file "${openapi_skill}/SKILL.md"
assert_file "${openapi_wrapper}"
assert_dir "${openapi_skill}/references"
assert_contains "$(<"${openapi_skill}/SKILL.md")" 'PETSTORE_API_KEY'

openapi_list="$(run_wrapper "${openapi_skill}" "${openapi_wrapper}" commands list)"
assert_contains "${openapi_list}" "list-pets"
assert_contains "${openapi_list}" "create-pet"
openapi_help="$(run_wrapper "${openapi_skill}" "${openapi_wrapper}" commands help list-pets)"
assert_contains "${openapi_help}" "list-pets: List pets"
assert_contains "${openapi_help}" "--limit"
openapi_run="$(run_wrapper "${openapi_skill}" "${openapi_wrapper}" run --pretty --head 1 list-pets --limit 2)"
assert_contains "${openapi_run}" '"name": "Fido"'

# GraphQL: saved schema, live endpoint execution, and real generated wrapper.
export GRAPHQL_AUTHORIZATION="Bearer graphql-e2e-token"
export GRAPHQL_TOKEN="${GRAPHQL_AUTHORIZATION}"
graphql_ready="${sandbox}/graphql-ready.json"
graphql_log="${sandbox}/graphql-server.log"
pids+=("$(start_fixture graphql-server.mjs "${graphql_ready}" "${graphql_log}")")
graphql_url="$(json_get "${graphql_ready}" url)"
graphql_schema="${project}/schema.graphql"
write_graphql_schema "${graphql_schema}"

graphql_generate_output="$(run_cli "${project}" generate \
  --template graphql \
  --name people-graphql \
  --graphql "${graphql_url}" \
  --graphql-schema "${graphql_schema}" \
  --auth-header "Authorization:env:GRAPHQL_TOKEN" \
  --agent pi \
  --scope project)"
assert_contains "${graphql_generate_output}" "Generated skill:"

graphql_skill="${project}/.pi/skills/people-graphql"
graphql_wrapper="${graphql_skill}/scripts/people-graphql"
assert_file "${graphql_skill}/SKILL.md"
assert_file "${graphql_wrapper}"
assert_dir "${graphql_skill}/references"
assert_contains "$(<"${graphql_skill}/SKILL.md")" 'GRAPHQL_TOKEN'

graphql_list="$(run_wrapper "${graphql_skill}" "${graphql_wrapper}" commands list)"
assert_contains "${graphql_list}" "users"
assert_contains "${graphql_list}" "create-user"
graphql_run="$(run_wrapper "${graphql_skill}" "${graphql_wrapper}" run --pretty users --limit 1)"
assert_contains "${graphql_run}" '"name": "Alice"'
assert_contains "${graphql_run}" '"email": "alice@example.com"'

# MCP HTTP: smoke test reaches a real MCP server, then the generated wrapper calls a tool.
mcp_ready="${sandbox}/mcp-http-ready.json"
mcp_log="${sandbox}/mcp-http-server.log"
pids+=("$(start_fixture mcp-http-server.mjs "${mcp_ready}" "${mcp_log}")")
mcp_url="$(json_get "${mcp_ready}" url)"

mcp_http_generate_output="$(run_cli "${project}" generate \
  --template mcp-http \
  --name context7 \
  --mcp "${mcp_url}" \
  --agent pi \
  --scope project)"
assert_contains "${mcp_http_generate_output}" "Generated skill:"

mcp_http_skill="${project}/.pi/skills/context7"
mcp_http_wrapper="${mcp_http_skill}/scripts/context7"
assert_file "${mcp_http_skill}/SKILL.md"
assert_file "${mcp_http_wrapper}"
assert_not_exists "${mcp_http_skill}/references"

mcp_http_list="$(run_wrapper "${mcp_http_skill}" "${mcp_http_wrapper}" commands list)"
assert_contains "${mcp_http_list}" "echo"
assert_contains "${mcp_http_list}" "add-numbers"
mcp_http_run="$(run_wrapper "${mcp_http_skill}" "${mcp_http_wrapper}" run add-numbers --a 6 --b 7)"
assert_contains "${mcp_http_run}" "13"

# MCP stdio: generated wrapper starts a real stdio MCP server process.
mcp_stdio_command="node \"${E2E_ROOT}/e2e/fixtures/mcp-stdio-server.mjs\""
mcp_stdio_generate_output="$(run_cli "${project}" generate \
  --template mcp-stdio \
  --name local-mcp \
  --mcp-stdio "${mcp_stdio_command}" \
  --agent pi \
  --scope project)"
assert_contains "${mcp_stdio_generate_output}" "Generated skill:"

mcp_stdio_skill="${project}/.pi/skills/local-mcp"
mcp_stdio_wrapper="${mcp_stdio_skill}/scripts/local-mcp"
assert_file "${mcp_stdio_skill}/SKILL.md"
assert_file "${mcp_stdio_wrapper}"
assert_not_exists "${mcp_stdio_skill}/references"

mcp_stdio_list="$(run_wrapper "${mcp_stdio_skill}" "${mcp_stdio_wrapper}" commands list)"
assert_contains "${mcp_stdio_list}" "echo"
assert_contains "${mcp_stdio_list}" "add-numbers"
mcp_stdio_run="$(run_wrapper "${mcp_stdio_skill}" "${mcp_stdio_wrapper}" run echo --message 'hello real npx')"
assert_contains "${mcp_stdio_run}" "hello real npx"
mcp_stdio_add="$(run_wrapper "${mcp_stdio_skill}" "${mcp_stdio_wrapper}" run add-numbers --a 2 --b 5)"
assert_contains "${mcp_stdio_add}" "7"
mcp_stdio_list_items="$(run_wrapper "${mcp_stdio_skill}" "${mcp_stdio_wrapper}" run list-items --path /tmp --recursive)"
assert_contains "${mcp_stdio_list_items}" '"path":"/tmp"'
assert_contains "${mcp_stdio_list_items}" '"recursive":true'
