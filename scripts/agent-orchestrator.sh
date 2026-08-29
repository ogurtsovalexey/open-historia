#!/usr/bin/env bash

set -euo pipefail

LABEL="com.openhistoria.agent-orchestrator"
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
DEFAULT_REPO_ROOT="$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd)"
CONFIG_DIR="${HOME}/.config/open-historia-orchestrator"
CONFIG_FILE="${CONFIG_DIR}/config"
STATE_DIR="${HOME}/Library/Application Support/OpenHistoriaAgentOrchestrator"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG_PATH="${STATE_DIR}/watchdog.log"
LAST_MESSAGE_PATH="${STATE_DIR}/last-message.txt"
LAST_CLAIMED_CHECK_PATH="${STATE_DIR}/last-claimed-check"
LOCK_DIR="${STATE_DIR}/tick.lock"

mkdir -p "$CONFIG_DIR" "$STATE_DIR"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG_PATH"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  }
}

load_config() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    printf 'Orchestrator is not configured. Run `%s install`.\n' "$SCRIPT_PATH" >&2
    exit 1
  fi

  # The generated file contains only shell-quoted non-secret paths, UUIDs and intervals.
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
  : "${SESSION_ID:?Missing SESSION_ID in $CONFIG_FILE}"
  : "${REPO_ROOT:?Missing REPO_ROOT in $CONFIG_FILE}"
  : "${GITHUB_REPOSITORY:?Missing GITHUB_REPOSITORY in $CONFIG_FILE}"
  : "${TICK_SECONDS:=120}"
  : "${CLAIMED_CHECK_SECONDS:=900}"
}

write_config() {
  local session_id="${1:-${CODEX_THREAD_ID:-${CODEX_SESSION_ID:-}}}"
  local repo_root="${2:-$DEFAULT_REPO_ROOT}"
  local github_repository="${3:-ogurtsovalexey/open-historia-next}"

  if [[ -z "$session_id" ]]; then
    printf 'Pass the Codex session UUID: `%s install <session-id>`.\n' "$SCRIPT_PATH" >&2
    exit 1
  fi
  if [[ ! "$session_id" =~ ^[0-9a-fA-F-]{36}$ ]]; then
    printf 'Invalid Codex session UUID: %s\n' "$session_id" >&2
    exit 1
  fi
  if [[ ! -d "$repo_root/.git" && ! -f "$repo_root/.git" ]]; then
    printf 'Not a Git worktree: %s\n' "$repo_root" >&2
    exit 1
  fi

  {
    printf 'SESSION_ID=%q\n' "$session_id"
    printf 'REPO_ROOT=%q\n' "$repo_root"
    printf 'GITHUB_REPOSITORY=%q\n' "$github_repository"
    printf 'TICK_SECONDS=%q\n' "120"
    printf 'CLAIMED_CHECK_SECONDS=%q\n' "900"
  } >"$CONFIG_FILE"
  chmod 600 "$CONFIG_FILE"
}

write_plist() {
  load_config
  mkdir -p "$(dirname "$PLIST_PATH")"
  cat >"$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${SCRIPT_PATH}</string>
    <string>tick</string>
  </array>
  <key>StartInterval</key>
  <integer>${TICK_SECONDS}</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${STATE_DIR}/launchd.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${STATE_DIR}/launchd.stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
EOF
  plutil -lint "$PLIST_PATH" >/dev/null
}

launchd_loaded() {
  launchctl print "gui/${UID}/${LABEL}" >/dev/null 2>&1
}

board_json() {
  gh issue list \
    --repo "$GITHUB_REPOSITORY" \
    --state open \
    --limit 100 \
    --json number,title,updatedAt,labels
}

count_status() {
  local status="$1"
  jq --arg status "$status" '[.[] | select(any(.labels[]; .name == $status))] | length'
}

claimed_check_due() {
  local now last
  now="$(date +%s)"
  last=0
  if [[ -f "$LAST_CLAIMED_CHECK_PATH" ]]; then
    last="$(cat "$LAST_CLAIMED_CHECK_PATH" 2>/dev/null || printf '0')"
  fi
  (( now - last >= CLAIMED_CHECK_SECONDS ))
}

needs_tick() {
  local board="$1"
  local ready review claimed_deepseek
  ready="$(printf '%s' "$board" | count_status 'status:ready')"
  review="$(printf '%s' "$board" | count_status 'status:review')"
  claimed_deepseek="$(printf '%s' "$board" | jq '[.[] | select(any(.labels[]; .name == "status:claimed")) | select(any(.labels[]; .name == "agent:deepseek"))] | length')"

  if (( ready > 0 || review > 0 )); then
    return 0
  fi
  if (( claimed_deepseek > 0 )) && claimed_check_due; then
    return 0
  fi
  return 1
}

notify_owner() {
  local message="$1"
  /usr/bin/osascript -e "display notification \"${message//\"/\\\"}\" with title \"Open Historia agents\"" >/dev/null 2>&1 || true
}

run_tick() {
  load_config
  require_command codex
  require_command gh
  require_command jq
  require_command git

  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    if [[ -f "$LOCK_DIR/pid" ]] && kill -0 "$(cat "$LOCK_DIR/pid")" 2>/dev/null; then
      log "skip: another tick holds the lock"
      return 0
    fi
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR"
    log "recovered: removed a stale tick lock"
  fi
  printf '%s\n' "$$" >"$LOCK_DIR/pid"
  trap 'rm -rf "$LOCK_DIR" 2>/dev/null || true' EXIT

  local board force prompt exit_code
  board="$(board_json)"
  force="${ORCHESTRATOR_FORCE:-0}"
  if [[ "$force" != "1" ]] && ! needs_tick "$board"; then
    log "idle: no ready/review work and no claimed audit due"
    return 0
  fi

  date +%s >"$LAST_CLAIMED_CHECK_PATH"
  prompt="ORCHESTRATOR_TICK. Work in ${REPO_ROOT}. Read docs/agent-orchestrator.md and execute exactly one orchestration cycle against ${GITHUB_REPOSITORY}. Prefer review/integration before claiming new work. Keep at most four active task streams total. Do not create additional agent identities or ask the owner routine questions. End the final message with exactly one marker: ORCHESTRATOR_OK, ORCHESTRATOR_IDLE, or OWNER_ACTION_REQUIRED: <one-line decision>."

  log "wake: resuming Codex session ${SESSION_ID}"
  : >"$LAST_MESSAGE_PATH"
  set +e
  (
    cd "$REPO_ROOT"
    codex exec resume --json --output-last-message "$LAST_MESSAGE_PATH" "$SESSION_ID" "$prompt"
  ) >>"$LOG_PATH" 2>&1
  exit_code=$?
  set -e

  if (( exit_code != 0 )); then
    log "error: Codex resume exited ${exit_code}; the next interval will retry"
    return "$exit_code"
  fi

  if grep -q '^OWNER_ACTION_REQUIRED:' "$LAST_MESSAGE_PATH"; then
    notify_owner "$(grep '^OWNER_ACTION_REQUIRED:' "$LAST_MESSAGE_PATH" | tail -1 | cut -c1-180)"
  fi
  log "complete: orchestration tick finished"
}

print_status() {
  load_config
  require_command gh
  require_command jq

  if launchd_loaded; then
    printf 'watchdog: running (%ss interval)\n' "$TICK_SECONDS"
  else
    printf 'watchdog: stopped\n'
  fi
  printf 'session:  %s\n' "$SESSION_ID"
  printf 'repo:     %s\n\n' "$REPO_ROOT"

  board_json | jq -r '
    sort_by(.number)
    | .[]
    | ([.labels[].name] | map(select(startswith("status:"))) | first // "status:unknown") as $status
    | ([.labels[].name] | map(select(startswith("agent:"))) | first // "agent:unknown") as $agent
    | "#\(.number)\t\($status | sub("status:"; ""))\t\($agent | sub("agent:"; ""))\t\(.title)"
  '

  printf '\nOpenCode processes:\n'
  pgrep -fl 'opencode.*deepseek' || printf 'none\n'
  if [[ -s "$LAST_MESSAGE_PATH" ]]; then
    printf '\nLast orchestrator result:\n'
    tail -8 "$LAST_MESSAGE_PATH"
  fi
}

check_board() {
  load_config
  require_command gh
  require_command jq

  local board ready review claimed_deepseek
  board="$(board_json)"
  ready="$(printf '%s' "$board" | count_status 'status:ready')"
  review="$(printf '%s' "$board" | count_status 'status:review')"
  claimed_deepseek="$(printf '%s' "$board" | jq '[.[] | select(any(.labels[]; .name == "status:claimed")) | select(any(.labels[]; .name == "agent:deepseek"))] | length')"

  printf 'ready=%s review=%s claimed_deepseek=%s\n' "$ready" "$review" "$claimed_deepseek"
  if needs_tick "$board"; then
    printf 'decision=wake\n'
  else
    printf 'decision=idle\n'
  fi
}

install_watchdog() {
  require_command codex
  require_command gh
  require_command jq
  require_command plutil
  if [[ -z "${1:-}" && -z "${CODEX_THREAD_ID:-${CODEX_SESSION_ID:-}}" && -f "$CONFIG_FILE" ]]; then
    load_config
  else
    write_config "${1:-}"
  fi
  write_plist
  printf 'Installed configuration for Codex session %s.\n' "$(source "$CONFIG_FILE"; printf '%s' "$SESSION_ID")"
  printf 'Run `%s start` to load the watchdog.\n' "$SCRIPT_PATH"
}

start_watchdog() {
  load_config
  write_plist
  if launchd_loaded; then
    printf 'Watchdog is already running.\n'
    return 0
  fi
  launchctl bootstrap "gui/${UID}" "$PLIST_PATH"
  printf 'Watchdog started; first automatic check is within %s seconds.\n' "$TICK_SECONDS"
}

stop_watchdog() {
  if launchd_loaded; then
    launchctl bootout "gui/${UID}/${LABEL}"
    printf 'Watchdog stopped.\n'
  else
    printf 'Watchdog is already stopped.\n'
  fi
}

uninstall_watchdog() {
  stop_watchdog
  rm -f "$PLIST_PATH" "$CONFIG_FILE"
  printf 'Watchdog configuration removed; logs remain in %s.\n' "$STATE_DIR"
}

case "${1:-status}" in
  install)
    install_watchdog "${2:-}"
    ;;
  start)
    start_watchdog
    ;;
  stop)
    stop_watchdog
    ;;
  restart)
    stop_watchdog
    start_watchdog
    ;;
  tick)
    run_tick
    ;;
  run-now)
    ORCHESTRATOR_FORCE=1 run_tick
    ;;
  check)
    check_board
    ;;
  status)
    print_status
    ;;
  uninstall)
    uninstall_watchdog
    ;;
  *)
    printf 'Usage: %s {install [session-id]|start|stop|restart|check|run-now|status|uninstall}\n' "$SCRIPT_PATH" >&2
    exit 2
    ;;
esac
