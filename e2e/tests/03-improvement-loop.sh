#!/usr/bin/env bash
set -euo pipefail

source "${E2E_ROOT}/e2e/lib.sh"

sandbox="$(create_sandbox improvement-loop)"

# Installing after generation should include existing generated skill names in the companion skill.
project_existing="${sandbox}/projects/existing-names"
mkdir -p "${project_existing}"
isolate_env "${sandbox}/env/existing-names"
spec_existing="${project_existing}/petstore.json"
write_petstore_spec "${spec_existing}"

run_cli "${project_existing}" generate \
  --template openapi \
  --name jira \
  --spec "${spec_existing}" \
  --agent pi \
  --scope project >/dev/null
run_cli "${project_existing}" generate \
  --template openapi \
  --name slack \
  --spec "${spec_existing}" \
  --agent pi \
  --scope project >/dev/null
run_cli "${project_existing}" command install --agent pi --scope project >/dev/null

improvement_skill="${project_existing}/.pi/skills/skill-creator-improvement/SKILL.md"
assert_file "${improvement_skill}"
assert_contains "$(<"${improvement_skill}")" \
  'Use after using any of these generated skills — jira, slack — if the interaction revealed custom fields'

# --no-improvement-skill should remain a no-op for later generated-skill refreshes.
project_skipped="${sandbox}/projects/skipped-improvement"
mkdir -p "${project_skipped}"
isolate_env "${sandbox}/env/skipped-improvement"
spec_skipped="${project_skipped}/petstore.json"
write_petstore_spec "${spec_skipped}"

run_cli "${project_skipped}" command install --agent pi --scope project --no-improvement-skill >/dev/null
run_cli "${project_skipped}" generate \
  --template openapi \
  --name jira \
  --spec "${spec_skipped}" \
  --agent pi \
  --scope project >/dev/null
assert_not_exists "${project_skipped}/.pi/skills/skill-creator-improvement/SKILL.md"

# An installed companion skill should refresh as the lock changes.
project_refresh="${sandbox}/projects/refresh"
mkdir -p "${project_refresh}"
isolate_env "${sandbox}/env/refresh"
spec_refresh="${project_refresh}/petstore.json"
write_petstore_spec "${spec_refresh}"

run_cli "${project_refresh}" command install --agent pi --scope project >/dev/null
refresh_skill="${project_refresh}/.pi/skills/skill-creator-improvement/SKILL.md"
assert_file "${refresh_skill}"
assert_contains "$(<"${refresh_skill}")" \
  'Use after using a generated skill if the interaction revealed custom fields'

run_cli "${project_refresh}" generate \
  --template openapi \
  --name jira \
  --spec "${spec_refresh}" \
  --agent pi \
  --scope project >/dev/null
assert_contains "$(<"${refresh_skill}")" \
  'Use after using any of these generated skills — jira — if the interaction revealed custom fields'

run_cli "${project_refresh}" generate \
  --template openapi \
  --name slack \
  --spec "${spec_refresh}" \
  --agent pi \
  --scope project >/dev/null
refreshed="$(<"${refresh_skill}")"
assert_contains "${refreshed}" \
  'Use after using any of these generated skills — jira, slack — if the interaction revealed custom fields'
frontmatter="${refreshed%%$'\n---\n'*}"
assert_not_contains "${frontmatter}" 'lock.json'
