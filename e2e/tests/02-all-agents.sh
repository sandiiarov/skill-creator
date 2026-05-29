#!/usr/bin/env bash
set -euo pipefail

source "${E2E_ROOT}/e2e/lib.sh"

sandbox="$(create_sandbox all-agents)"
mkdir -p "${sandbox}/projects"

command_agents=(
  "pi:project"
  "pi:global"
  "universal:project"
  "universal:global"
  "codex:global"
  "claude-code:project"
  "claude-code:global"
  "cursor:project"
  "cursor:global"
  "opencode:project"
  "opencode:global"
  "gemini-cli:project"
  "gemini-cli:global"
  "amp:project"
  "amp:global"
  "github-copilot:project"
  "cline:project"
  "cline:global"
  "windsurf:project"
)

skill_agents=(
  pi
  universal
  codex
  claude-code
  cursor
  opencode
  gemini-cli
  amp
  github-copilot
  goose
  cline
  windsurf
)

safe_name() {
  printf '%s' "$1" | tr -c 'a-z0-9-' '-'
}

command_path() {
  local agent="$1" scope="$2" project="$3"
  case "${agent}:${scope}" in
    pi:project) printf '%s/.pi/prompts/skill-creator.md\n' "${project}" ;;
    pi:global) printf '%s/.pi/agent/prompts/skill-creator.md\n' "${HOME}" ;;
    universal:project) printf '%s/.agents/commands/skill-creator.md\n' "${project}" ;;
    universal:global) printf '%s/agents/commands/skill-creator.md\n' "${XDG_CONFIG_HOME}" ;;
    codex:global) printf '%s/prompts/skill-creator.md\n' "${CODEX_HOME}" ;;
    claude-code:project) printf '%s/.claude/commands/skill-creator.md\n' "${project}" ;;
    claude-code:global) printf '%s/commands/skill-creator.md\n' "${CLAUDE_CONFIG_DIR}" ;;
    cursor:project) printf '%s/.cursor/commands/skill-creator.md\n' "${project}" ;;
    cursor:global) printf '%s/.cursor/commands/skill-creator.md\n' "${HOME}" ;;
    opencode:project) printf '%s/.opencode/commands/skill-creator.md\n' "${project}" ;;
    opencode:global) printf '%s/opencode/commands/skill-creator.md\n' "${XDG_CONFIG_HOME}" ;;
    gemini-cli:project) printf '%s/.gemini/commands/skill-creator.toml\n' "${project}" ;;
    gemini-cli:global) printf '%s/.gemini/commands/skill-creator.toml\n' "${HOME}" ;;
    amp:project) printf '%s/.agents/commands/skill-creator.md\n' "${project}" ;;
    amp:global) printf '%s/amp/commands/skill-creator.md\n' "${XDG_CONFIG_HOME}" ;;
    github-copilot:project) printf '%s/.github/prompts/skill-creator.prompt.md\n' "${project}" ;;
    cline:project) printf '%s/.clinerules/workflows/skill-creator.md\n' "${project}" ;;
    cline:global) printf '%s/Documents/Cline/Workflows/skill-creator.md\n' "${HOME}" ;;
    windsurf:project) printf '%s/.windsurf/workflows/skill-creator.md\n' "${project}" ;;
    *) echo "missing command path case for ${agent}:${scope}" >&2; return 1 ;;
  esac
}

skill_root() {
  local agent="$1" scope="$2" project="$3"
  case "${agent}:${scope}" in
    pi:project) printf '%s/.pi/skills\n' "${project}" ;;
    pi:global) printf '%s/.pi/agent/skills\n' "${HOME}" ;;
    universal:project) printf '%s/.agents/skills\n' "${project}" ;;
    universal:global) printf '%s/agents/skills\n' "${XDG_CONFIG_HOME}" ;;
    codex:project) printf '%s/.agents/skills\n' "${project}" ;;
    codex:global) printf '%s/skills\n' "${CODEX_HOME}" ;;
    claude-code:project) printf '%s/.claude/skills\n' "${project}" ;;
    claude-code:global) printf '%s/skills\n' "${CLAUDE_CONFIG_DIR}" ;;
    cursor:project) printf '%s/.agents/skills\n' "${project}" ;;
    cursor:global) printf '%s/.cursor/skills\n' "${HOME}" ;;
    opencode:project) printf '%s/.agents/skills\n' "${project}" ;;
    opencode:global) printf '%s/opencode/skills\n' "${XDG_CONFIG_HOME}" ;;
    gemini-cli:project) printf '%s/.agents/skills\n' "${project}" ;;
    gemini-cli:global) printf '%s/.gemini/skills\n' "${HOME}" ;;
    amp:project) printf '%s/.agents/skills\n' "${project}" ;;
    amp:global) printf '%s/agents/skills\n' "${XDG_CONFIG_HOME}" ;;
    github-copilot:project) printf '%s/.agents/skills\n' "${project}" ;;
    github-copilot:global) printf '%s/.copilot/skills\n' "${HOME}" ;;
    goose:project) printf '%s/.goose/skills\n' "${project}" ;;
    goose:global) printf '%s/goose/skills\n' "${XDG_CONFIG_HOME}" ;;
    cline:project) printf '%s/.agents/skills\n' "${project}" ;;
    cline:global) printf '%s/.agents/skills\n' "${HOME}" ;;
    windsurf:project) printf '%s/.windsurf/skills\n' "${project}" ;;
    windsurf:global) printf '%s/.codeium/windsurf/skills\n' "${HOME}" ;;
    *) echo "missing skill path case for ${agent}:${scope}" >&2; return 1 ;;
  esac
}

for pair in "${command_agents[@]}"; do
  agent="${pair%%:*}"
  scope="${pair##*:}"
  safe="$(safe_name "${agent}-${scope}")"
  project="${sandbox}/projects/command-${safe}"
  mkdir -p "${project}"
  isolate_env "${sandbox}/env/command-${safe}"

  output="$(run_cli "${project}" command install --agent "${agent}" --scope "${scope}" --force)"
  assert_contains "${output}" "Installed command: skill-creator"

  installed_command="$(command_path "${agent}" "${scope}" "${project}")"
  assert_file "${installed_command}"
  if [[ "${agent}" == "gemini-cli" ]]; then
    assert_contains "$(<"${installed_command}")" 'prompt = '
    assert_not_contains "$(<"${installed_command}")" '$ARGUMENTS'
  else
    assert_contains "$(<"${installed_command}")" '# Task: create a reusable agent skill'
  fi

  installed_skill="$(skill_root "${agent}" "${scope}" "${project}")/skill-creator-improvement/SKILL.md"
  assert_file "${installed_skill}"
  assert_contains "$(<"${installed_skill}")" 'name: skill-creator-improvement'
done

for agent in "${skill_agents[@]}"; do
  for scope in project global; do
    safe="$(safe_name "${agent}-${scope}")"
    project="${sandbox}/projects/generate-${safe}"
    mkdir -p "${project}"
    isolate_env "${sandbox}/env/generate-${safe}"
    spec="${project}/petstore.json"
    write_petstore_spec "${spec}"

    skill_name="e2e-${agent}"
    output="$(run_cli "${project}" generate \
      --template openapi \
      --name "${skill_name}" \
      --spec "${spec}" \
      --agent "${agent}" \
      --scope "${scope}" \
      --force)"
    assert_contains "${output}" "Generated skill:"

    root="$(skill_root "${agent}" "${scope}" "${project}")"
    skill_dir="${root}/${skill_name}"
    assert_file "${skill_dir}/SKILL.md"
    assert_file "${skill_dir}/scripts/${skill_name}"
    assert_dir "${skill_dir}/references"
    assert_contains "$(<"${skill_dir}/SKILL.md")" "name: ${skill_name}"
  done
done
