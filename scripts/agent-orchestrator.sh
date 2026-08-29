#!/usr/bin/env bash

set -euo pipefail

LABEL="com.openhistoria.agent-orchestrator"
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
DEFAULT_REPO_ROOT="$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd)"
CONFIG_DIR="${OPEN_HISTORIA_ORCHESTRATOR_CONFIG_DIR:-${HOME}/.config/open-historia-orchestrator}"
CONFIG_FILE="${CONFIG_DIR}/config"
STATE_DIR="${OPEN_HISTORIA_ORCHESTRATOR_STATE_DIR:-${HOME}/Library/Application Support/OpenHistoriaAgentOrchestrator}"
RUNTIME_SCRIPT_PATH="${STATE_DIR}/agent-orchestrator.sh"
PLIST_PATH="${OPEN_HISTORIA_ORCHESTRATOR_PLIST_PATH:-${HOME}/Library/LaunchAgents/${LABEL}.plist}"
LOG_PATH="${STATE_DIR}/watchdog.log"
LAST_MESSAGE_PATH="${STATE_DIR}/last-message.txt"
LAST_CLAIMED_CHECK_PATH="${STATE_DIR}/last-claimed-check"
LAST_ACK_SIGNATURE_PATH="${STATE_DIR}/last-ack-signature"
PENDING_TICK_PATH="${STATE_DIR}/pending-tick"
SESSION_LAUNCHER_PATH="${STATE_DIR}/open-orchestrator-session.sh"
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
  : "${RESEARCH_MODEL:=openrouter/qwen/qwen3-30b-a3b-instruct-2507}"
  : "${CODE_MODEL:=openrouter/qwen/qwen3-coder-30b-a3b-instruct}"
  : "${COMPLEX_MODEL:=openrouter/deepseek/deepseek-v3.2}"
  : "${ESCALATION_MODEL:=openrouter/deepseek/deepseek-v4-pro-0813}"
  : "${PENDING_START_TIMEOUT:=3600}"
  : "${PENDING_RUN_TIMEOUT:=3600}"
}

write_config() {
  local session_id="${1:-${CODEX_THREAD_ID:-${CODEX_SESSION_ID:-}}}"
  local repo_root="${2:-$DEFAULT_REPO_ROOT}"
  local github_repository="${3:-ogurtsovalexey/open-historia-next}"
  local tick_seconds="${TICK_SECONDS:-120}"
  local claimed_check_seconds="${CLAIMED_CHECK_SECONDS:-900}"
  local research_model="${RESEARCH_MODEL:-openrouter/qwen/qwen3-30b-a3b-instruct-2507}"
  local code_model="${CODE_MODEL:-openrouter/qwen/qwen3-coder-30b-a3b-instruct}"
  local complex_model="${COMPLEX_MODEL:-openrouter/deepseek/deepseek-v3.2}"
  local escalation_model="${ESCALATION_MODEL:-openrouter/deepseek/deepseek-v4-pro-0813}"
  local pending_start_timeout="${PENDING_START_TIMEOUT:-3600}"
  local pending_run_timeout="${PENDING_RUN_TIMEOUT:-3600}"

  if [[ -z "$session_id" ]]; then
    printf 'Pass the Codex session UUID: `%s install <session-id>`.\n' "$SCRIPT_PATH" >&2
    exit 1
  fi
  if ! valid_session_id "$session_id"; then
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
    printf 'TICK_SECONDS=%q\n' "$tick_seconds"
    printf 'CLAIMED_CHECK_SECONDS=%q\n' "$claimed_check_seconds"
    printf 'RESEARCH_MODEL=%q\n' "$research_model"
    printf 'CODE_MODEL=%q\n' "$code_model"
    printf 'COMPLEX_MODEL=%q\n' "$complex_model"
    printf 'ESCALATION_MODEL=%q\n' "$escalation_model"
    printf 'PENDING_START_TIMEOUT=%q\n' "$pending_start_timeout"
    printf 'PENDING_RUN_TIMEOUT=%q\n' "$pending_run_timeout"
  } >"$CONFIG_FILE"
  chmod 600 "$CONFIG_FILE"
}

valid_session_id() {
  [[ "${1:-}" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]
}

codex_sessions_dir() {
  printf '%s/sessions\n' "${OPEN_HISTORIA_ORCHESTRATOR_CODEX_HOME:-${CODEX_HOME:-${HOME}/.codex}}"
}

find_session_file() {
  local session_id="${1:?session id required}"
  local sessions_dir
  sessions_dir="$(codex_sessions_dir)"
  [[ -d "$sessions_dir" ]] || return 0
  find "$sessions_dir" -type f -name "*-${session_id}.jsonl" -print -quit 2>/dev/null || true
}

new_tick_id() {
  /usr/bin/uuidgen | tr '[:upper:]' '[:lower:]'
}

tick_prompt() {
  local tick_id="${1:?tick id required}"
  printf '%s' "ORCHESTRATOR_TICK_ID=${tick_id}. Work in ${REPO_ROOT}. Read docs/agent-orchestrator.md and execute exactly one orchestration cycle against ${GITHUB_REPOSITORY}. Prefer review/integration before claiming new work. Keep at most four active task streams total. Worker model routing: research=${RESEARCH_MODEL}; standard-code=${CODE_MODEL}; complex=${COMPLEX_MODEL}; escalation-only=${ESCALATION_MODEL}. Do not use the escalation model unless the documented promotion rule is met. Do not create additional agent identities or ask the owner routine questions. End the final message with exactly one marker on its own line: ORCHESTRATOR_OK, ORCHESTRATOR_IDLE, or OWNER_ACTION_REQUIRED: <one-line decision>."
}

write_pending_tick() {
  local tick_id="${1:?tick id required}"
  local signature="${2:-}"
  local attempts="${3:-1}"
  local queued_at="${4:-$(date +%s)}"
  local temp_path
  temp_path="$(mktemp "${STATE_DIR}/pending-tick.XXXXXX")"
  {
    printf 'PENDING_SESSION_ID=%q\n' "$SESSION_ID"
    printf 'PENDING_TICK_ID=%q\n' "$tick_id"
    printf 'PENDING_SIGNATURE=%q\n' "$signature"
    printf 'PENDING_QUEUED_AT=%q\n' "$queued_at"
    printf 'PENDING_ATTEMPTS=%q\n' "$attempts"
  } >"$temp_path"
  mv "$temp_path" "$PENDING_TICK_PATH"
}

read_pending_tick() {
  [[ -f "$PENDING_TICK_PATH" ]] || return 1
  unset PENDING_SESSION_ID PENDING_TICK_ID PENDING_SIGNATURE PENDING_QUEUED_AT PENDING_ATTEMPTS
  # The generated file contains only shell-quoted UUIDs, signatures and integers.
  # shellcheck disable=SC1090
  source "$PENDING_TICK_PATH"
  : "${PENDING_SESSION_ID:?Missing session id in $PENDING_TICK_PATH}"
  : "${PENDING_TICK_ID:?Missing tick id in $PENDING_TICK_PATH}"
  : "${PENDING_SIGNATURE:=}"
  : "${PENDING_QUEUED_AT:=0}"
  : "${PENDING_ATTEMPTS:=1}"
}

has_orchestrator_marker() {
  grep -Eq '^(ORCHESTRATOR_OK|ORCHESTRATOR_IDLE|OWNER_ACTION_REQUIRED: .+)$'
}

inspect_pending_tick() {
  PENDING_STATUS="waiting"
  PENDING_RESULT=""

  local session_file tick_record turn_id tick_ordinal completed_message later_user now age
  session_file="$(find_session_file "$PENDING_SESSION_ID")"
  if [[ -z "$session_file" ]]; then
    PENDING_STATUS="missing-session"
    return 0
  fi

  tick_record="$(jq -r --arg needle "ORCHESTRATOR_TICK_ID=${PENDING_TICK_ID}" '
    select(
      .type == "response_item"
      and .payload.type == "message"
      and .payload.role == "user"
      and any(.payload.content[]?; ((.text? // "") | contains($needle)))
    )
    | [(.payload.internal_chat_message_metadata_passthrough.turn_id // ""), (.ordinal // 0)]
    | @tsv
  ' "$session_file" 2>/dev/null | tail -1 || true)"

  now="$(date +%s)"
  age=$(( now - PENDING_QUEUED_AT ))
  if [[ -z "$tick_record" ]]; then
    if (( age >= PENDING_START_TIMEOUT )); then
      PENDING_STATUS="not-started"
    fi
    return 0
  fi

  IFS=$'\t' read -r turn_id tick_ordinal <<<"$tick_record"
  if [[ -z "$turn_id" ]]; then
    PENDING_STATUS="invalid-session-record"
    return 0
  fi

  completed_message="$(jq -r --arg turn_id "$turn_id" '
    select(
      .type == "event_msg"
      and .payload.type == "task_complete"
      and .payload.turn_id == $turn_id
    )
    | .payload.last_agent_message // ""
  ' "$session_file" 2>/dev/null | tail -1 || true)"
  if [[ -n "$completed_message" ]]; then
    PENDING_RESULT="$completed_message"
    if printf '%s\n' "$completed_message" | has_orchestrator_marker; then
      PENDING_STATUS="complete"
    else
      PENDING_STATUS="missing-marker"
    fi
    return 0
  fi

  later_user="$(jq -r --argjson tick_ordinal "$tick_ordinal" '
    select(
      (.ordinal // 0) > $tick_ordinal
      and .type == "response_item"
      and .payload.type == "message"
      and .payload.role == "user"
    )
    | .ordinal
  ' "$session_file" 2>/dev/null | tail -1 || true)"
  if [[ -n "$later_user" ]]; then
    PENDING_STATUS="interrupted"
  elif (( age >= PENDING_RUN_TIMEOUT )); then
    PENDING_STATUS="timed-out"
  fi
}

acknowledge_pending_tick() {
  printf '%s\n' "$PENDING_SIGNATURE" >"$LAST_ACK_SIGNATURE_PATH"
  printf '%s\n' "$PENDING_RESULT" >"$LAST_MESSAGE_PATH"
  date +%s >"$LAST_CLAIMED_CHECK_PATH"
  rm -f "$PENDING_TICK_PATH"
  log "acknowledged: tick ${PENDING_TICK_ID} completed with an orchestrator marker"
}

clear_delivery_state() {
  rm -f "$PENDING_TICK_PATH" "$LAST_ACK_SIGNATURE_PATH"
  : >"$LAST_MESSAGE_PATH"
}

write_plist() {
  load_config
  mkdir -p "$(dirname "$PLIST_PATH")"
  if [[ "$SCRIPT_PATH" != "$RUNTIME_SCRIPT_PATH" ]]; then
    cp "$SCRIPT_PATH" "$RUNTIME_SCRIPT_PATH"
    chmod 700 "$RUNTIME_SCRIPT_PATH"
  fi
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
    <string>${RUNTIME_SCRIPT_PATH}</string>
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

actionable_signature() {
  jq -r '
    [
      .[]
      | select(any(.labels[]; .name == "status:ready" or .name == "status:review"))
      | "\(.number):\(.updatedAt)"
    ]
    | sort
    | join("|")
  '
}

notify_owner() {
  local message="$1"
  /usr/bin/osascript -e "display notification \"${message//\"/\\\"}\" with title \"Open Historia agents\"" >/dev/null 2>&1 || true
}

run_tick() (
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

  local board force prompt exit_code signature acknowledged_signature tick_id
  local retry_required retry_attempts
  retry_required=0
  retry_attempts=1

  if read_pending_tick; then
    if [[ "$PENDING_SESSION_ID" != "$SESSION_ID" ]]; then
      log "retry: discarded pending tick for previous session ${PENDING_SESSION_ID}"
      rm -f "$PENDING_TICK_PATH"
      retry_required=1
    else
      inspect_pending_tick
      case "$PENDING_STATUS" in
        complete)
          acknowledge_pending_tick
          if printf '%s\n' "$PENDING_RESULT" | grep -q '^OWNER_ACTION_REQUIRED:'; then
            notify_owner "$(printf '%s\n' "$PENDING_RESULT" | grep '^OWNER_ACTION_REQUIRED:' | tail -1 | cut -c1-180)"
          fi
          ;;
        waiting)
          log "pending: tick ${PENDING_TICK_ID} has not completed yet"
          return 0
          ;;
        *)
          retry_attempts=$(( PENDING_ATTEMPTS + 1 ))
          log "retry: tick ${PENDING_TICK_ID} status=${PENDING_STATUS} attempt=${retry_attempts}"
          rm -f "$PENDING_TICK_PATH"
          retry_required=1
          ;;
      esac
    fi
  fi

  board="$(board_json)"
  force="${ORCHESTRATOR_FORCE:-0}"
  if (( retry_required == 1 )); then
    force=1
  fi
  if [[ "$force" != "1" ]] && ! needs_tick "$board"; then
    log "idle: no ready/review work and no claimed audit due"
    return 0
  fi

  signature="$(printf '%s' "$board" | actionable_signature)"
  acknowledged_signature="$(cat "$LAST_ACK_SIGNATURE_PATH" 2>/dev/null || true)"
  if [[ "$force" != "1" && -n "$signature" && "$signature" == "$acknowledged_signature" ]] && ! claimed_check_due; then
    log "idle: actionable board state was already acknowledged"
    return 0
  fi

  tick_id="$(new_tick_id)"
  prompt="$(tick_prompt "$tick_id")"
  write_pending_tick "$tick_id" "$signature" "$retry_attempts"

  log "wake: delivering tick ${tick_id} to Codex session ${SESSION_ID}"
  : >"$LAST_MESSAGE_PATH"

  if codex queue --thread "$SESSION_ID" --message "$prompt" >>"$LOG_PATH" 2>&1; then
    log "queued: tick ${tick_id} is pending until its final marker is recorded"
    return 0
  fi

  log "queue unavailable: falling back to headless session resume"
  set +e
  (
    cd "$REPO_ROOT"
    codex exec resume --json --output-last-message "$LAST_MESSAGE_PATH" "$SESSION_ID" "$prompt"
  ) >>"$LOG_PATH" 2>&1
  exit_code=$?
  set -e

  if (( exit_code != 0 )); then
    rm -f "$PENDING_TICK_PATH"
    log "error: Codex resume exited ${exit_code}; the next interval will retry"
    return "$exit_code"
  fi

  read_pending_tick
  inspect_pending_tick
  if [[ "$PENDING_STATUS" == "complete" ]]; then
    acknowledge_pending_tick
    if printf '%s\n' "$PENDING_RESULT" | grep -q '^OWNER_ACTION_REQUIRED:'; then
      notify_owner "$(printf '%s\n' "$PENDING_RESULT" | grep '^OWNER_ACTION_REQUIRED:' | tail -1 | cut -c1-180)"
    fi
    log "complete: headless orchestration tick ${tick_id} finished"
    return 0
  fi

  log "error: headless tick ${tick_id} ended with status=${PENDING_STATUS}; the next interval will retry"
  return 1
)

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
  printf 'models:   research=%s\n' "$RESEARCH_MODEL"
  printf '          code=%s\n' "$CODE_MODEL"
  printf '          complex=%s\n' "$COMPLEX_MODEL"
  printf '          escalation=%s\n\n' "$ESCALATION_MODEL"

  if read_pending_tick; then
    inspect_pending_tick
    printf 'delivery: pending tick=%s status=%s attempt=%s\n\n' "$PENDING_TICK_ID" "$PENDING_STATUS" "$PENDING_ATTEMPTS"
  else
    printf 'delivery: no pending tick\n\n'
  fi

  board_json | jq -r '
    sort_by(.number)
    | .[]
    | ([.labels[].name] | map(select(startswith("status:"))) | first // "status:unknown") as $status
    | ([.labels[].name] | map(select(startswith("agent:"))) | first // "agent:unknown") as $agent
    | "#\(.number)\t\($status | sub("status:"; ""))\t\($agent | sub("agent:"; ""))\t\(.title)"
  '

  printf '\nWorkers:\n'
  if [[ -x "$REPO_ROOT/scripts/agent-worker.sh" ]]; then
    bash "$REPO_ROOT/scripts/agent-worker.sh" status
  else
    pgrep -fl 'opencode.*deepseek' || printf 'none\n'
  fi
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

load_start_settings() {
  if [[ -f "$CONFIG_FILE" ]]; then
    load_config
  else
    REPO_ROOT="$DEFAULT_REPO_ROOT"
    GITHUB_REPOSITORY="ogurtsovalexey/open-historia-next"
    TICK_SECONDS=120
    CLAIMED_CHECK_SECONDS=900
    RESEARCH_MODEL="openrouter/qwen/qwen3-30b-a3b-instruct-2507"
    CODE_MODEL="openrouter/qwen/qwen3-coder-30b-a3b-instruct"
    COMPLEX_MODEL="openrouter/deepseek/deepseek-v3.2"
    ESCALATION_MODEL="openrouter/deepseek/deepseek-v4-pro-0813"
    PENDING_START_TIMEOUT=3600
    PENDING_RUN_TIMEOUT=3600
  fi
}

bootstrap_watchdog() {
  write_plist
  launchctl bootstrap "gui/${UID}" "$PLIST_PATH"
}

stop_watchdog_silently() {
  if launchd_loaded; then
    launchctl bootout "gui/${UID}/${LABEL}"
  fi
}

start_bound_session() {
  local session_id="${1:?session id required}"
  valid_session_id "$session_id" || {
    printf 'Invalid Codex session UUID: %s\n' "$session_id" >&2
    return 1
  }
  if [[ -z "$(find_session_file "$session_id")" ]]; then
    printf 'Codex session was not found locally: %s\n' "$session_id" >&2
    return 1
  fi

  stop_watchdog_silently
  load_start_settings
  write_config "$session_id" "$REPO_ROOT" "$GITHUB_REPOSITORY"
  load_config
  clear_delivery_state
  write_plist
  ORCHESTRATOR_FORCE=1 run_tick
  bootstrap_watchdog
  printf 'Watchdog is bound to Codex session %s.\n' "$SESSION_ID"
  printf 'The first orchestration tick was queued immediately; interval=%ss.\n' "$TICK_SECONDS"
}

detect_new_orchestrator_session() {
  local before_path="${1:?before snapshot required}"
  local tick_id="${2:?tick id required}"
  local sessions_dir candidate session_id attempt
  sessions_dir="$(codex_sessions_dir)"

  for attempt in $(seq 1 30); do
    candidate=""
    while IFS= read -r session_file; do
      if grep -Fqx "$session_file" "$before_path"; then
        continue
      fi
      if grep -Fq "ORCHESTRATOR_TICK_ID=${tick_id}" "$session_file" 2>/dev/null; then
        candidate="$session_file"
      fi
    done < <(find "$sessions_dir" -type f -name '*.jsonl' -print 2>/dev/null | sort)

    if [[ -n "$candidate" ]]; then
      session_id="$(head -1 "$candidate" | jq -r '.payload.id // empty')"
      if valid_session_id "$session_id"; then
        printf '%s\n' "$session_id"
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

start_new_terminal_session() {
  require_command codex
  require_command gh
  require_command jq
  require_command plutil

  local board signature tick_id prompt sessions_before session_id launched_at codex_path
  load_start_settings
  board="$(board_json)"
  signature="$(printf '%s' "$board" | actionable_signature)"
  tick_id="$(new_tick_id)"
  prompt="$(tick_prompt "$tick_id")"
  codex_path="$(command -v codex)"
  sessions_before="$(mktemp "${STATE_DIR}/sessions-before.XXXXXX")"
  find "$(codex_sessions_dir)" -type f -name '*.jsonl' -print 2>/dev/null | sort >"$sessions_before"
  launched_at="$(date +%s)"
  stop_watchdog_silently

  {
    printf '#!/usr/bin/env bash\nset -e\n'
    printf 'cd %q\n' "$REPO_ROOT"
    printf 'exec %q --yolo -C %q %q\n' "$codex_path" "$REPO_ROOT" "$prompt"
  } >"$SESSION_LAUNCHER_PATH"
  chmod 700 "$SESSION_LAUNCHER_PATH"

  /usr/bin/osascript - "$SESSION_LAUNCHER_PATH" <<'APPLESCRIPT'
on run argv
  set launcherPath to item 1 of argv
  tell application "Terminal"
    activate
    do script quoted form of launcherPath
  end tell
end run
APPLESCRIPT

  session_id="$(detect_new_orchestrator_session "$sessions_before" "$tick_id" || true)"
  rm -f "$sessions_before"
  if [[ -z "$session_id" ]]; then
    printf 'A Terminal window was opened, but its Codex session UUID was not detected within 30 seconds.\n' >&2
    printf 'The watchdog remains stopped; rerun `npm run agents:start -- <UUID>` with the UUID shown by `/status`.\n' >&2
    return 1
  fi

  write_config "$session_id" "$REPO_ROOT" "$GITHUB_REPOSITORY"
  load_config
  clear_delivery_state
  write_pending_tick "$tick_id" "$signature" "1" "$launched_at"
  bootstrap_watchdog
  printf 'Opened a new Terminal window with `codex --yolo`.\n'
  printf 'Watchdog is bound to new Codex session %s; its first orchestration cycle started immediately.\n' "$SESSION_ID"
}

start_watchdog() {
  if [[ -n "${1:-}" ]]; then
    start_bound_session "$1"
  else
    start_new_terminal_session
  fi
}

stop_watchdog() {
  if launchd_loaded; then
    launchctl bootout "gui/${UID}/${LABEL}"
    printf 'Watchdog stopped.\n'
  else
    printf 'Watchdog is already stopped.\n'
  fi
}

restart_watchdog() {
  load_config
  stop_watchdog_silently
  bootstrap_watchdog
  printf 'Watchdog restarted for Codex session %s; interval=%ss.\n' "$SESSION_ID" "$TICK_SECONDS"
}

uninstall_watchdog() {
  stop_watchdog
  rm -f "$PLIST_PATH" "$CONFIG_FILE"
  printf 'Watchdog configuration removed; logs remain in %s.\n' "$STATE_DIR"
}

if [[ "${OPEN_HISTORIA_ORCHESTRATOR_LIBRARY_ONLY:-0}" == "1" ]]; then
  return 0 2>/dev/null || exit 0
fi

case "${1:-status}" in
  install)
    install_watchdog "${2:-}"
    ;;
  start)
    start_watchdog "${2:-}"
    ;;
  stop)
    stop_watchdog
    ;;
  restart)
    restart_watchdog
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
    printf 'Usage: %s {install [session-id]|start [session-id]|stop|restart|check|run-now|status|uninstall}\n' "$SCRIPT_PATH" >&2
    exit 2
    ;;
esac
