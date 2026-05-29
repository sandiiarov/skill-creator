#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${1:-}" != "--inside" && "${E2E_INSIDE_DOCKER:-}" != "1" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required for e2e tests. To run in the current environment anyway: E2E_INSIDE_DOCKER=1 bash e2e/run.sh --inside" >&2
    exit 1
  fi

  image="${E2E_DOCKER_IMAGE:-skill-creator-e2e:local}"
  docker build -f "${ROOT}/e2e/Dockerfile" -t "${image}" "${ROOT}"
  docker run --rm "${image}"
  exit 0
fi

cd "${ROOT}"

export E2E_ROOT="${ROOT}"
export E2E_TMP="${E2E_TMP:-$(mktemp -d)}"
cleanup() {
  rm -rf "${E2E_TMP}"
}
trap cleanup EXIT

mkdir -p "${E2E_TMP}/pkg"

echo "==> Building package"
pnpm build

echo "==> Packing package"
pack_output="$(pnpm pack --pack-destination "${E2E_TMP}/pkg")"
export E2E_TARBALL="$(printf '%s\n' "${pack_output}" | tail -n 1)"
if [[ "${E2E_TARBALL}" != /* ]]; then
  E2E_TARBALL="${ROOT}/${E2E_TARBALL}"
fi
if [[ ! -f "${E2E_TARBALL}" ]]; then
  echo "Packed tarball not found: ${E2E_TARBALL}" >&2
  exit 1
fi

echo "==> Running e2e tests in ${E2E_TMP}"
for test_script in "${ROOT}"/e2e/tests/*.sh; do
  echo "==> $(basename "${test_script}")"
  bash "${test_script}"
done

echo "==> E2E tests passed"
