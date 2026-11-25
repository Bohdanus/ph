#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"

case "$repo_root" in
  */.kilo/worktrees/*) ;;
  *)
    echo "ERROR: Run this setup from a task worktree under .kilo/worktrees/." >&2
    exit 1
    ;;
esac

if ! git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: The setup directory is not inside a Git worktree." >&2
  exit 1
fi

git_root="$(git -C "$repo_root" rev-parse --show-toplevel)"
if [[ "$git_root" != "$repo_root" ]]; then
  echo "ERROR: Run this setup from the Git worktree root." >&2
  exit 1
fi

branch_ref="$(git -C "$repo_root" symbolic-ref --quiet HEAD 2>/dev/null || true)"
case "$branch_ref" in
  refs/heads/main)
    echo "ERROR: Run this setup from a task branch; the main worktree is read-only." >&2
    exit 1
    ;;
  refs/heads/*) ;;
  *)
    echo "ERROR: Run this setup from a task branch, not a detached checkout." >&2
    exit 1
    ;;
esac

if ! git -C "$repo_root" worktree list --porcelain | grep -Fqx -- "worktree $repo_root"; then
  echo "ERROR: This directory is not a registered Git worktree." >&2
  exit 1
fi

cd "$repo_root"

if [[ ! -f /etc/os-release ]]; then
  echo "ERROR: This setup requires Ubuntu Linux." >&2
  exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "ERROR: This setup requires Ubuntu Linux (found ${ID:-unknown})." >&2
  exit 1
fi

if [[ "${EUID}" -eq 0 ]]; then
  echo "ERROR: Run this script as your regular Ubuntu user, not as root." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: Install Node.js and npm before running this setup." >&2
  echo "Install the Node.js version specified by .nvmrc; see docs/WSL-SETUP.md." >&2
  exit 1
fi

required_node="$(tr -d '[:space:]' < .nvmrc)"
required_major="${required_node#v}"
required_major="${required_major%%.*}"
current_major="$(node -p 'process.versions.node.split(".")[0]')"
npm_major="$(npm --version | cut -d. -f1)"

if [[ ! "$required_major" =~ ^[0-9]+$ || ! "$current_major" =~ ^[0-9]+$ ]]; then
  echo "ERROR: Could not determine the required or installed Node.js version." >&2
  exit 1
fi

if (( current_major < required_major )); then
  echo "ERROR: Node.js $current_major is too old; this project requires Node.js $required_node or newer." >&2
  exit 1
fi

if [[ ! "$npm_major" =~ ^[0-9]+$ ]] || (( npm_major < 10 )); then
  echo "ERROR: This project requires npm 10 or newer (found $(npm --version))." >&2
  exit 1
fi

echo "Installing project dependencies..."
npm ci

echo "Installing Playwright Chrome and its system dependencies..."
npx playwright install --with-deps chrome

echo "Running the TypeScript check..."
npm run tsc

echo "WSL setup complete. Start the app with: npm run dev"
