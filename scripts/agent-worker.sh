#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_PROMPT_FILE="${SCRIPT_DIR}/../docs/agent-worker-baseline.md"
STATE_DIR="${OPEN_HISTORIA_ORCHESTRATOR_WORKER_STATE_DIR:-${HOME}/Library/Application Support/OpenHistoriaAgentOrchestrator/workers}"
WORKER_MODEL="openrouter/deepseek/deepseek-v4-pro-0813"
DEFAULT_PLANNING_TOKEN_BUDGET=400000
DEFAULT_IMPLEMENTATION_TOKEN_BUDGET=1500000
mkdir -p "$STATE_DIR"

token_usage() {
  local log_file="${1:?log file required}"
  [[ -f "$log_file" ]] || { printf '0\n'; return 0; }
  jq -Rr 'fromjson? | select(.type == "step_finish") | (.part.tokens.total // 0)' "$log_file" 2>/dev/null \
    | awk '{ total += $1 } END { printf "%.0f\n", total + 0 }'
}

phase_instructions() {
  local phase="${1:?phase required}"
  case "$phase" in
    planning)
      cat <<'EOF'
# Execution Phase: PLANNING ONLY

Analyze the Issue and the real production paths, but do not edit files, create
commits, or implement the solution. Produce one concrete implementation plan
that maps every acceptance criterion to owned files and executable validation.
The plan must identify production seams, likely risks, missing decisions and the
smallest coherent commit sequence. It must explicitly state whether the work is
one cohesive production seam and can realistically finish inside the phase's
1,500,000-token implementation budget. If it contains independent seams or
cannot fit, recommend decomposition instead of proposing a larger budget.

Post that plan to the GitHub Issue as `PLAN HANDOFF`, replace `status:claimed`
with `status:plan-review`, and remove `stage:planning`. If the task cannot be
planned inside its accepted scope, post `DECISION NEEDED` and set
`status:blocked`. End after this lifecycle mutation. There is no second planning
attempt.
EOF
      ;;
    implementation)
      cat <<'EOF'
# Execution Phase: IMPLEMENTATION

The GitHub Issue contains an `APPROVED IMPLEMENTATION PLAN` reviewed or amended
by GPT. Re-read it before editing and implement only that plan. Do not reopen
accepted architecture or silently substitute proxy validation. Finish with the
normal implementation `HANDOFF` and `status:review`, or set `status:blocked`
with exact evidence. There is no correction or implementation retry after this
run.
EOF
      ;;
    *)
      printf 'Unsupported worker phase: %s\n' "$phase" >&2
      return 2
      ;;
  esac
}

phase_attempted() {
  local issue="${1:?issue required}"
  local phase="${2:?phase required}"
  local record
  if [[ -f "$STATE_DIR/$issue.attempts" ]] && grep -Fqx "$phase" "$STATE_DIR/$issue.attempts"; then
    return 0
  fi
  while IFS= read -r record; do
    [[ -f "$record" ]] || continue
    if grep -Fqx "$phase" "$record"; then
      return 0
    fi
  done < <(find "$STATE_DIR/archive" -mindepth 2 -maxdepth 2 -type f -path "*/${issue}-*/${issue}.attempts" -print 2>/dev/null)
  return 1
}

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
  local phase="${6:-planning}"
  local token_budget="${7:-}"
  local name runner log exit_file composed_prompt attempt_file budget_file token_base

  name="$(screen_name "$issue")"
  runner="$STATE_DIR/$issue-run.sh"
  log="$STATE_DIR/$issue.jsonl"
  exit_file="$STATE_DIR/$issue.exit"
  composed_prompt="$STATE_DIR/$issue.composed.prompt"
  attempt_file="$STATE_DIR/$issue.attempts"
  budget_file="$STATE_DIR/$issue.budget"

  [[ "$issue" =~ ^[0-9]+$ ]] || { echo "Invalid issue number: $issue" >&2; exit 2; }
  [[ "$model" == "$WORKER_MODEL" ]] || {
    echo "Unsupported worker model: $model. Open Historia workers use only $WORKER_MODEL." >&2
    exit 2
  }
  [[ "$phase" == "planning" || "$phase" == "implementation" ]] || {
    echo "Unsupported worker phase: $phase" >&2
    exit 2
  }
  if [[ -z "$token_budget" ]]; then
    if [[ "$phase" == "planning" ]]; then
      token_budget="$DEFAULT_PLANNING_TOKEN_BUDGET"
    else
      token_budget="$DEFAULT_IMPLEMENTATION_TOKEN_BUDGET"
    fi
  fi
  [[ "$token_budget" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid token budget: $token_budget" >&2; exit 2; }
  if phase_attempted "$issue" "$phase"; then
    echo "Worker #$issue already consumed its single $phase attempt." >&2
    exit 1
  fi

  [[ -d "$worktree" ]] || { echo "Missing worktree: $worktree" >&2; exit 1; }
  [[ -f "$prompt_file" ]] || { echo "Missing prompt: $prompt_file" >&2; exit 1; }
  [[ -f "$BASE_PROMPT_FILE" ]] || { echo "Missing worker baseline: $BASE_PROMPT_FILE" >&2; exit 1; }
  if is_running "$issue"; then
    echo "Worker #$issue is already running in screen session $name." >&2
    exit 1
  fi

  token_base="$(token_usage "$log")"
  printf 'MODEL=%s\nWORKTREE=%s\nPHASE=%s\nTOKEN_BUDGET=%s\nTOKEN_BASE=%s\n' \
    "$model" "$worktree" "$phase" "$token_budget" "$token_base" >"$STATE_DIR/$issue.meta"
  printf '%s\n' "$phase" >>"$attempt_file"
  rm -f "$budget_file"
  printf 'starting\n' >"$exit_file"
  {
    cat "$BASE_PROMPT_FILE"
    printf '\n\n---\n\n'
    phase_instructions "$phase"
    printf '\n\n---\n\n# Task-Specific Instructions\n\n'
    cat "$prompt_file"
  } >"$composed_prompt"

  {
    printf '#!/usr/bin/env bash\nset +e\n'
    printf 'cd %q || exit 1\n' "$worktree"
    printf 'opencode run --dir %q --model %q --format json --auto --title %q' "$worktree" "$model" "$name"
    if [[ -n "$resume_session" ]]; then
      printf ' --session %q' "$resume_session"
    fi
    printf ' "$(cat %q)" >>%q 2>&1 &\n' "$composed_prompt" "$log"
    printf 'worker_pid=$!\nbudget_hit=0\n'
    printf 'while kill -0 "$worker_pid" 2>/dev/null; do\n'
    printf '  sleep 2\n'
    printf '  total=$(jq -Rr '\''fromjson? | select(.type == "step_finish") | (.part.tokens.total // 0)'\'' %q 2>/dev/null | awk '\''{ total += $1 } END { printf "%%.0f\\n", total + 0 }'\'')\n' "$log"
    printf '  used=$((total - %s))\n' "$token_base"
    printf '  if (( used >= %s )); then\n' "$token_budget"
    printf '    printf "phase=%%s\\nused_tokens=%%s\\nbudget_tokens=%%s\\n" %q "$used" %q >%q\n' "$phase" "$token_budget" "$budget_file"
    printf '    kill -TERM "$worker_pid" 2>/dev/null || true\n'
    printf '    for _ in 1 2 3 4 5; do kill -0 "$worker_pid" 2>/dev/null || break; sleep 1; done\n'
    printf '    kill -KILL "$worker_pid" 2>/dev/null || true\n'
    printf '    budget_hit=1\n    break\n  fi\ndone\n'
    printf 'wait "$worker_pid"\ncode=$?\n'
    printf 'if (( budget_hit == 1 )); then code=125; fi\n'
    printf 'printf "%%s\\n" "$code" >%q\nexit "$code"\n' "$exit_file"
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

archive_worker() {
  local issue="${1:?issue number required}"
  local archive_dir path found=0

  [[ "$issue" =~ ^[0-9]+$ ]] || { echo "Invalid issue number: $issue" >&2; exit 2; }
  if is_running "$issue"; then
    echo "Worker #$issue is still running; stop or finish it before archiving." >&2
    exit 1
  fi

  archive_dir="$STATE_DIR/archive/${issue}-$(date '+%Y%m%dT%H%M%S')-$$"
  for path in \
    "$STATE_DIR/$issue.prompt" \
    "$STATE_DIR/$issue.composed.prompt" \
    "$STATE_DIR/$issue.jsonl" \
    "$STATE_DIR/$issue.exit" \
    "$STATE_DIR/$issue.meta" \
    "$STATE_DIR/$issue.attempts" \
    "$STATE_DIR/$issue.budget" \
    "$STATE_DIR/$issue.pid" \
    "$STATE_DIR/$issue-run.sh"; do
    [[ -e "$path" ]] || continue
    if (( found == 0 )); then
      mkdir -p "$archive_dir"
    fi
    mv "$path" "$archive_dir/"
    found=1
  done

  if (( found == 0 )); then
    echo "No worker record found for Issue #$issue." >&2
    exit 1
  fi
  echo "Archived worker #$issue at $archive_dir."
}

print_status() {
  local found=0 issue state session model_line phase_line budget_line base_line used exit_code
  for prompt in "$STATE_DIR"/*.prompt; do
    [[ -f "$prompt" ]] || continue
    [[ "$prompt" == *.composed.prompt ]] && continue
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
    phase_line="$(grep '^PHASE=' "$STATE_DIR/$issue.meta" 2>/dev/null | cut -d= -f2- || true)"
    budget_line="$(grep '^TOKEN_BUDGET=' "$STATE_DIR/$issue.meta" 2>/dev/null | cut -d= -f2- || true)"
    base_line="$(grep '^TOKEN_BASE=' "$STATE_DIR/$issue.meta" 2>/dev/null | cut -d= -f2- || printf '0')"
    used=$(( $(token_usage "$STATE_DIR/$issue.jsonl") - ${base_line:-0} ))
    (( used >= 0 )) || used=0
    printf '#%s\t%s\t%s\t%s\t%s\t%s/%s tokens\n' "$issue" "$state" "${model_line:-unknown-model}" "${session:-pending-session}" "${phase_line:-legacy}" "$used" "${budget_line:-unbounded}"
  done
  (( found == 1 )) || echo "No registered workers."
}

print_usage() {
  local issue="${1:?issue number required}"
  local meta="$STATE_DIR/$issue.meta"
  local log="$STATE_DIR/$issue.jsonl"
  [[ -f "$meta" ]] || { echo "No worker metadata for Issue #$issue." >&2; exit 1; }
  printf 'issue=%s\n' "$issue"
  sed -n '/^MODEL=/p;/^PHASE=/p;/^TOKEN_BUDGET=/p;/^TOKEN_BASE=/p' "$meta"
  printf 'TOTAL_TOKENS=%s\n' "$(token_usage "$log")"
  [[ ! -f "$STATE_DIR/$issue.budget" ]] || cat "$STATE_DIR/$issue.budget"
}

case "${1:-status}" in
  start)
    start_worker "${2:-}" "${3:-}" "${4:-}" "${5:-}" "${6:-}" "${7:-}" "${8:-}"
    ;;
  stop)
    stop_worker "${2:-}"
    ;;
  archive)
    archive_worker "${2:-}"
    ;;
  status)
    print_status
    ;;
  usage)
    print_usage "${2:-}"
    ;;
  *)
    echo "Usage: $0 {start <issue> <model> <worktree> <prompt-file> [session-id] [planning|implementation] [token-budget]|stop <issue>|archive <issue>|status|usage <issue>}" >&2
    exit 2
    ;;
esac
