#!/usr/bin/env bash
set -euo pipefail

resolve_sidecar_dir() {
  if [[ -n "${LMD_PYTHON_SIDECAR_DIR:-}" && -f "${LMD_PYTHON_SIDECAR_DIR}/lmd_sidecar/main.py" ]]; then
    printf '%s\n' "${LMD_PYTHON_SIDECAR_DIR}"
    return 0
  fi

  local script_dir
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

  for start in "$PWD" "$script_dir"; do
    local dir="$start"
    while [[ "$dir" != "/" ]]; do
      if [[ -f "$dir/python-sidecar/lmd_sidecar/main.py" ]]; then
        printf '%s\n' "$dir/python-sidecar"
        return 0
      fi
      if [[ -f "$dir/lmd_sidecar/main.py" ]]; then
        printf '%s\n' "$dir"
        return 0
      fi
      dir="$(dirname "$dir")"
    done
  done

  return 1
}

SIDECAR_DIR="$(resolve_sidecar_dir)" || {
  printf 'Unable to locate python-sidecar. Set LMD_PYTHON_SIDECAR_DIR to the sidecar package directory.\n' >&2
  exit 1
}

python_is_compatible() {
  "$1" -c 'import sys; raise SystemExit(0 if (3, 10) <= sys.version_info[:2] < (3, 13) else 1)' >/dev/null 2>&1
}

# The same order as scripts/resolve-python.mjs, which is the documented one. This launcher is
# spawned by the Rust side during `tauri dev`, so it cannot call the Node resolver — but it must
# not disagree with it either, or `npm run tauri dev` would use a different interpreter from every
# other sidecar script.
resolve_python_bin() {
  local repo_dir
  repo_dir="$(dirname "$SIDECAR_DIR")"

  # 1. An explicit choice for this project.
  if [[ -n "${LMD_PYTHON:-}" ]] && python_is_compatible "${LMD_PYTHON}"; then
    printf '%s\n' "${LMD_PYTHON}"
    return 0
  fi

  # 2. The conventional override.
  if [[ -n "${PYTHON:-}" ]] && command -v "$PYTHON" >/dev/null 2>&1 && python_is_compatible "$PYTHON"; then
    command -v "$PYTHON"
    return 0
  fi

  # 3. The environment that is already active.
  if [[ -n "${CONDA_PREFIX:-}" ]] && python_is_compatible "${CONDA_PREFIX}/bin/python"; then
    printf '%s\n' "${CONDA_PREFIX}/bin/python"
    return 0
  fi
  if [[ -n "${VIRTUAL_ENV:-}" ]] && python_is_compatible "${VIRTUAL_ENV}/bin/python"; then
    printf '%s\n' "${VIRTUAL_ENV}/bin/python"
    return 0
  fi

  # 4. A project-local environment.
  if [[ -x "$repo_dir/.conda/lmd/bin/python" ]] && python_is_compatible "$repo_dir/.conda/lmd/bin/python"; then
    printf '%s\n' "$repo_dir/.conda/lmd/bin/python"
    return 0
  fi

  if [[ -x "$SIDECAR_DIR/.venv/bin/python" ]] && python_is_compatible "$SIDECAR_DIR/.venv/bin/python"; then
    printf '%s\n' "$SIDECAR_DIR/.venv/bin/python"
    return 0
  fi

  for candidate in python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      local candidate_path
      candidate_path="$(command -v "$candidate")"
      if python_is_compatible "$candidate_path"; then
        printf '%s\n' "$candidate_path"
        return 0
      fi
    fi
  done

  return 1
}

PYTHON_BIN="$(resolve_python_bin)" || {
  printf 'Unable to locate Python 3.10-3.12 for python-sidecar. Set LMD_PYTHON, activate a Conda\nenvironment, or create python-sidecar/.venv. See scripts/resolve-python.mjs.\n' >&2
  exit 1
}

export PYTHONPATH="$SIDECAR_DIR${PYTHONPATH:+:$PYTHONPATH}"
exec "$PYTHON_BIN" -m lmd_sidecar.main "$@"
