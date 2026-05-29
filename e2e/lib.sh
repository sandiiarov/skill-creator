#!/usr/bin/env bash

if [[ -z "${E2E_ROOT:-}" || -z "${E2E_TMP:-}" || -z "${E2E_TARBALL:-}" ]]; then
  echo "e2e/lib.sh requires E2E_ROOT, E2E_TMP, and E2E_TARBALL" >&2
  exit 1
fi

NPM_E2E_ENV=(
  NO_UPDATE_NOTIFIER=1
  NPM_CONFIG_UPDATE_NOTIFIER=false
  npm_config_update_notifier=false
  npm_config_audit=false
  npm_config_fund=false
  npm_config_progress=false
)

create_sandbox() {
  local name="$1"
  local dir="${E2E_TMP}/${name}"
  rm -rf "${dir}"
  mkdir -p "${dir}"

  (
    cd "${dir}"
    env "${NPM_E2E_ENV[@]}" npm init -y >/dev/null
    env "${NPM_E2E_ENV[@]}" npm_config_cache="${dir}/npm-install-cache" npm install "${E2E_TARBALL}" >/dev/null
  )

  printf '%s\n' "${dir}"
}

isolate_env() {
  local dir="$1"
  mkdir -p "${dir}/home" "${dir}/config" "${dir}/codex" "${dir}/claude" "${dir}/skill-creator" "${dir}/npm-cache"
  export HOME="${dir}/home"
  export XDG_CONFIG_HOME="${dir}/config"
  export CODEX_HOME="${dir}/codex"
  export CLAUDE_CONFIG_DIR="${dir}/claude"
  export SKILL_CREATOR_HOME="${dir}/skill-creator"
  export npm_config_cache="${dir}/npm-cache"
}

run_cli() {
  local cwd="$1"
  shift
  (
    cd "${cwd}"
    env "${NPM_E2E_ENV[@]}" npm_config_offline=true npx -y @asnd/skill-creator "$@"
  )
}

run_wrapper() {
  local cwd="$1"
  local wrapper="$2"
  shift 2
  (
    cd "${cwd}"
    env "${NPM_E2E_ENV[@]}" npm_config_offline=true "${wrapper}" "$@"
  )
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "${haystack}" != *"${needle}"* ]]; then
    echo "Expected output to contain: ${needle}" >&2
    echo "--- output ---" >&2
    printf '%s\n' "${haystack}" >&2
    echo "--------------" >&2
    exit 1
  fi
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "${haystack}" == *"${needle}"* ]]; then
    echo "Expected output not to contain: ${needle}" >&2
    echo "--- output ---" >&2
    printf '%s\n' "${haystack}" >&2
    echo "--------------" >&2
    exit 1
  fi
}

assert_file() {
  local path="$1"
  if [[ ! -f "${path}" ]]; then
    echo "Expected file to exist: ${path}" >&2
    exit 1
  fi
}

assert_dir() {
  local path="$1"
  if [[ ! -d "${path}" ]]; then
    echo "Expected directory to exist: ${path}" >&2
    exit 1
  fi
}

assert_not_exists() {
  local path="$1"
  if [[ -e "${path}" ]]; then
    echo "Expected path not to exist: ${path}" >&2
    exit 1
  fi
}

json_get() {
  local path="$1"
  local key="$2"
  node -e "const fs = require('node:fs'); const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); console.log(data[process.argv[2]]);" "${path}" "${key}"
}

start_fixture() {
  local fixture="$1"
  local ready_file="$2"
  local log_file="$3"
  rm -f "${ready_file}" "${log_file}"

  node "${E2E_ROOT}/e2e/fixtures/${fixture}" "${ready_file}" >"${log_file}" 2>&1 &
  local pid="$!"

  for _ in $(seq 1 200); do
    if [[ -s "${ready_file}" ]]; then
      printf '%s\n' "${pid}"
      return 0
    fi
    if ! kill -0 "${pid}" 2>/dev/null; then
      echo "Fixture ${fixture} exited before becoming ready" >&2
      cat "${log_file}" >&2 || true
      return 1
    fi
    sleep 0.1
  done

  echo "Timed out waiting for fixture ${fixture}" >&2
  cat "${log_file}" >&2 || true
  kill "${pid}" 2>/dev/null || true
  return 1
}

stop_fixtures() {
  local pid
  for pid in "$@"; do
    if [[ -n "${pid}" ]]; then
      kill "${pid}" 2>/dev/null || true
      wait "${pid}" 2>/dev/null || true
    fi
  done
}

write_petstore_spec() {
  local path="$1"
  cat >"${path}" <<'JSON'
{
  "openapi": "3.0.0",
  "info": { "title": "Petstore", "version": "1.0.0" },
  "servers": [{ "url": "http://localhost:3000/api/v1" }],
  "paths": {
    "/pets": {
      "get": {
        "operationId": "listPets",
        "summary": "List pets",
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": { "type": "integer" },
            "description": "Max results"
          },
          {
            "name": "status",
            "in": "query",
            "schema": { "type": "string", "enum": ["available", "pending", "sold"] }
          }
        ]
      },
      "post": {
        "operationId": "createPet",
        "summary": "Create a pet",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["name"],
                "properties": {
                  "name": { "type": "string", "description": "Pet name" },
                  "tag": { "type": "string" },
                  "age": { "type": "integer" }
                }
              }
            }
          }
        }
      }
    },
    "/pets/{petId}": {
      "get": {
        "operationId": "getPet",
        "summary": "Get a pet",
        "parameters": [
          {
            "name": "petId",
            "in": "path",
            "required": true,
            "schema": { "type": "string" },
            "description": "Pet ID"
          }
        ]
      }
    }
  }
}
JSON
}

write_graphql_schema() {
  local path="$1"
  cat >"${path}" <<'GRAPHQL'
type Profile {
  city: String!
}

type User {
  id: ID!
  name: String!
  email: String!
  age: Int
  profile: Profile!
}

type Query {
  users(limit: Int): [User!]!
  user(id: ID!): User
  ping: String!
}

type Mutation {
  createUser(name: String!, email: String!, age: Int): User!
}
GRAPHQL
}
