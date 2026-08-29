#!/usr/bin/env bash

set -euo pipefail

STATE_DIR="${HOME}/Library/Application Support/OpenHistoriaAgentOrchestrator/workers"
mkdir -p "$STATE_DIR"

screen_name() {
  printf 'historia-issue-%s' "$1"
}

is_running() {
  local sessions
  sessions="$(screen -ls 2>/dev/null || true)"
  grep -q "[.]$(screen_name "$1")[[:space:]]" <<<"$sessions"
}

start_worker() {
  local issue="${1:?issue number required}"
  local model="${2:?model required}"
  local worktree="${3:?worktree required}"
  local prompt_file="${4:?prompt file required}"
  local resume_session="${5:-}"
  local name runner log exit_file

  name="$(screen_name "$issue")"
  runner="$STATE_DIR/$issue-run.sh"
  log="$STATE_DIR/$issue.jsonl"
  exit_file="$STATE_DIR/$issue.exit"

  [[ -d "$worktree" ]] || { echo "Missing worktree: $worktree" >&2; exit 1; }
  [[ -f "$prompt_file" ]] || { echo "Missing prompt: $prompt_file" >&2; exit 1; }
  if is_running "$issue"; then
    echo "Worker #$issue is already running in screen session $name." >&2
    exit 1
  fi

  printf 'MODEL=%s\nWORKTREE=%s\n' "$model" "$worktree" >"$STATE_DIR/$issue.meta"
  printf 'starting\n' >"$exit_file"

  {
    printf '#!/usr/bin/env bash\nset +e\n'
    printf 'cd %q || exit 1\n' "$worktree"
    printf 'opencode run --dir %q --model %q --format json --auto --title %q' "$worktree" "$model" "$name"
    if [[ -n "$resume_session" ]]; then
      printf ' --session %q' "$resume_session"
    fi
    printf ' "$(cat %q)" >>%q 2>&1\n' "$prompt_file" "$log"
    printf 'code=$?\nprintf "%%s\\n" "$code" >%q\nexit "$code"\n' "$exit_file"
  } >"$runner"
  chmod 700 "$runner"

  screen -dmS "$name" /bin/bash "$runner"
  sleep 1
  if ! is_running "$issue" && [[ "$(cat "$exit_file")" == "starting" ]]; then
    echo "Worker #$issue did not start." >&2
    exit 1
  fi
  echo "Started worker #$issue in detached screen session $name."
}

stop_worker() {
  local issue="${1:?issue number required}"
  if is_running "$issue"; then
    screen -S "$(screen_name "$issue")" -X quit
    echo "Stopped worker #$issue."
  else
    echo "Worker #$issue is not running."
  fi
}

print_status() {
  local found=0 issue state session model_line exit_code
  for prompt in "$STATE_DIR"/*.prompt; do
    [[ -f "$prompt" ]] || continue
    found=1
    issue="$(basename "$prompt" .prompt)"
    if is_running "$issue"; then
      state="running"
    elif [[ -f "$STATE_DIR/$issue.exit" ]]; then
      exit_code="$(cat "$STATE_DIR/$issue.exit")"
      state="exited($exit_code)"
    else
      state="stopped"
    fi
    session="$(grep -o '"sessionID":"[^"]*' "$STATE_DIR/$issue.jsonl" 2>/dev/null | head -1 | cut -d'"' -f4 || true)"
    model_line="$(grep '^MODEL=' "$STATE_DIR/$issue.meta" 2>/dev/null | cut -d= -f2- || true)"
    printf '#%s\t%s\t%s\t%s\n' "$issue" "$state" "${model_line:-unknown-model}" "${session:-pending-session}"
  done
  (( found == 1 )) || echo "No registered workers."
}

case "${1:-status}" in
  start)
    start_worker "${2:-}" "${3:-}" "${4:-}" "${5:-}" "${6:-}"
    ;;
  stop)
    stop_worker "${2:-}"
    ;;
  status)
    print_status
    ;;
  *)
    echo "Usage: $0 {start <issue> <model> <worktree> <prompt-file> [session-id]|stop <issue>|status}" >&2
    exit 2
    ;;
esac
