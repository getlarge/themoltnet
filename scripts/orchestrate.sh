#!/usr/bin/env bash
set -euo pipefail

# Agent Coordination Orchestrator
# Usage: ./scripts/orchestrate.sh <command> [args...]
#
# Commands:
#   spawn <task> [base-branch]  Create a worktree + branch for an agent
#   list                        Show all agent worktrees
#   status                      Full status: worktrees + PRs + CI
#   teardown <task>             Remove a worktree
#   teardown-all                Remove all agent worktrees
#   sync                        Pull latest TASKS.md into current worktree

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_NAME="$(basename "$REPO_ROOT")"
WORKTREE_PREFIX="${REPO_NAME}-"

# Colors (if terminal supports them)
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    BLUE='\033[0;34m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' BLUE='' BOLD='' NC=''
fi

log() { echo -e "${BLUE}[orchestrate]${NC} $*"; }
warn() { echo -e "${YELLOW}[orchestrate]${NC} $*"; }
err() { echo -e "${RED}[orchestrate]${NC} $*" >&2; }
ok() { echo -e "${GREEN}[orchestrate]${NC} $*"; }

usage() {
    cat <<'EOF'
Agent Coordination Orchestrator

Usage: ./scripts/orchestrate.sh <command> [args...]

Commands:
  spawn <task> [base]     Create worktree + branch for an agent task
                          base defaults to 'main'
  list                    Show all agent worktrees
  status                  Full status: worktrees, open PRs, CI runs
  teardown <task>         Remove a specific agent worktree
  teardown-all            Remove all agent worktrees
  sync                    Fetch and show latest TASKS.md

Examples:
  ./scripts/orchestrate.sh spawn auth-library
  ./scripts/orchestrate.sh spawn diary-service main
  ./scripts/orchestrate.sh list
  ./scripts/orchestrate.sh teardown auth-library
  ./scripts/orchestrate.sh status

After spawning, launch Claude Code in the worktree:
  cd ../themoltnet-auth-library && claude
EOF
}

# --- Commands ---

cmd_spawn() {
    local task="${1:?Usage: orchestrate.sh spawn <task> [base-branch]}"
    local base="${2:-main}"
    local branch="agent/${task}"
    local worktree_dir="${REPO_ROOT}/../${WORKTREE_PREFIX}${task}"

    if [ -d "$worktree_dir" ]; then
        err "Worktree already exists: $worktree_dir"
        err "Use 'teardown ${task}' first, or pick a different task name."
        exit 1
    fi

    log "Creating worktree for task: ${BOLD}${task}${NC}"
    log "  Branch:    ${branch}"
    log "  Base:      ${base}"
    log "  Directory: ${worktree_dir}"

    # Fetch latest base branch
    cd "$REPO_ROOT"
    git fetch origin "$base" 2>/dev/null || warn "Could not fetch origin/${base}, using local"

    # Create worktree with new branch
    if git show-ref --verify --quiet "refs/heads/${branch}" 2>/dev/null; then
        log "Branch ${branch} already exists, checking it out"
        git worktree add "$worktree_dir" "$branch"
    else
        git worktree add -b "$branch" "$worktree_dir" "origin/${base}" 2>/dev/null \
            || git worktree add -b "$branch" "$worktree_dir" "$base"
    fi

    # Install dependencies if package.json exists
    if [ -f "${worktree_dir}/package.json" ]; then
        log "Installing dependencies..."
        cd "$worktree_dir"
        pnpm install --silent 2>/dev/null || warn "pnpm install had issues (may be fine)"
    fi

    ok "Worktree ready: ${worktree_dir}"
    echo ""
    echo "Next steps:"
    echo "  cd ${worktree_dir}"
    echo "  claude                    # interactive"
    echo "  claude -p 'your prompt'   # headless"
    echo ""
}

cmd_list() {
    cd "$REPO_ROOT"
    log "Active worktrees:"
    echo ""
    git worktree list | while IFS= read -r line; do
        if echo "$line" | grep -q "agent/"; then
            echo -e "  ${GREEN}${line}${NC}"
        else
            echo "  ${line}"
        fi
    done
    echo ""
}

cmd_status() {
    cd "$REPO_ROOT"

    echo -e "${BOLD}=== Agent Worktrees ===${NC}"
    git worktree list
    echo ""

    echo -e "${BOLD}=== TASKS.md Summary ===${NC}"
    if [ -f "TASKS.md" ]; then
        # Show Active and Available sections
        awk '/^## Active/,/^## [A-Z]/{print}' TASKS.md 2>/dev/null | head -20
        echo "..."
        awk '/^## Available/,0{print}' TASKS.md 2>/dev/null | head -20
    else
        warn "No TASKS.md found"
    fi
    echo ""

    echo -e "${BOLD}=== Open Pull Requests ===${NC}"
    if command -v gh &>/dev/null; then
        gh pr list --limit 10 2>/dev/null || warn "Could not list PRs (gh not configured?)"
    else
        warn "gh CLI not installed — install it for PR monitoring"
    fi
    echo ""

    echo -e "${BOLD}=== Recent CI Runs ===${NC}"
    if command -v gh &>/dev/null; then
        gh run list --limit 5 2>/dev/null || warn "Could not list CI runs"
    else
        warn "gh CLI not installed"
    fi
    echo ""
}

cmd_teardown() {
    local task="${1:?Usage: orchestrate.sh teardown <task>}"
    local worktree_dir="${REPO_ROOT}/../${WORKTREE_PREFIX}${task}"

    if [ ! -d "$worktree_dir" ]; then
        err "Worktree not found: $worktree_dir"
        exit 1
    fi

    log "Removing worktree: ${worktree_dir}"

    cd "$REPO_ROOT"
    git worktree remove "$worktree_dir" --force 2>/dev/null || {
        warn "git worktree remove failed, cleaning up manually"
        rm -rf "$worktree_dir"
        git worktree prune
    }

    ok "Worktree removed: ${task}"

    # Optionally delete the branch
    local branch="agent/${task}"
    if git show-ref --verify --quiet "refs/heads/${branch}" 2>/dev/null; then
        read -p "Delete local branch ${branch}? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            git branch -D "$branch"
            ok "Branch deleted: ${branch}"
        fi
    fi
}

cmd_teardown_all() {
    cd "$REPO_ROOT"
    local count=0

    git worktree list --porcelain | grep "^worktree " | while IFS= read -r line; do
        local dir="${line#worktree }"
        if [ "$dir" != "$REPO_ROOT" ] && echo "$dir" | grep -q "${WORKTREE_PREFIX}"; then
            log "Removing: $dir"
            git worktree remove "$dir" --force 2>/dev/null || {
                rm -rf "$dir"
            }
            count=$((count + 1))
        fi
    done

    git worktree prune
    ok "All agent worktrees removed"
}

cmd_sync() {
    cd "$REPO_ROOT"
    log "Fetching latest from origin/main..."
    git fetch origin main 2>/dev/null || warn "Could not fetch origin/main"

    if git show origin/main:TASKS.md &>/dev/null; then
        git show origin/main:TASKS.md
    else
        warn "No TASKS.md found on origin/main"
    fi
}

# --- Main ---

command="${1:-}"
shift 2>/dev/null || true

case "$command" in
    spawn)      cmd_spawn "$@" ;;
    list)       cmd_list ;;
    status)     cmd_status ;;
    teardown)   cmd_teardown "$@" ;;
    teardown-all) cmd_teardown_all ;;
    sync)       cmd_sync ;;
    -h|--help|help|"")  usage ;;
    *)
        err "Unknown command: $command"
        usage
        exit 1
        ;;
esac
