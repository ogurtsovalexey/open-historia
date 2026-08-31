#!/usr/bin/env bash

set -euo pipefail

LABEL="com.openhistoria.agent-orchestrator"
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
DEFAULT_REPO_ROOT="$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd)"
CONFIG_DIR="${OPEN_HISTORIA_ORCHESTRATOR_CONFIG_DIR:-${HOME}/.config/open-historia-orchestrator}"
CONFIG_FILE="${CONFIG_DIR}/config"
DISABLED_PATH="${CONFIG_DIR}/disabled"
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
WORKER_STATE_DIR="${OPEN_HISTORIA_ORCHESTRATOR_WORKER_STATE_DIR:-${STATE_DIR}/workers}"

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

orchestrator_disabled() {
  [[ -f "$DISABLED_PATH" ]]
}

require_orchestrator_enabled() {
  if orchestrator_disabled; then
    printf 'Orchestrator is disabled by %s. Run `%s enable` to allow launches again.\n' \
      "$DISABLED_PATH" "$SCRIPT_PATH" >&2
    return 1
  fi
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
  : "${CLAIMED_CHECK_SECONDS:=420}"
  : "${MAX_ACTIVE_STREAMS:=7}"
  WORKER_MODEL="openrouter/deepseek/deepseek-v4-pro-0813"
  : "${PLANNING_TOKEN_BUDGET:=400000}"
  : "${IMPLEMENTATION_TOKEN_BUDGET:=1500000}"
  : "${PENDING_START_TIMEOUT:=3600}"
  : "${PENDING_RUN_TIMEOUT:=3600}"
}

write_config() {
  local session_id="${1:-${CODEX_THREAD_ID:-${CODEX_SESSION_ID:-}}}"
  local repo_root="${2:-$DEFAULT_REPO_ROOT}"
  local github_repository="${3:-ogurtsovalexey/open-historia-next}"
  local tick_seconds="${TICK_SECONDS:-120}"
  local claimed_check_seconds="${CLAIMED_CHECK_SECONDS:-420}"
  local max_active_streams="${MAX_ACTIVE_STREAMS:-7}"
  local worker_model="openrouter/deepseek/deepseek-v4-pro-0813"
  local planning_token_budget="${PLANNING_TOKEN_BUDGET:-400000}"
  local implementation_token_budget="${IMPLEMENTATION_TOKEN_BUDGET:-1500000}"
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
    printf 'MAX_ACTIVE_STREAMS=%q\n' "$max_active_streams"
    printf 'WORKER_MODEL=%q\n' "$worker_model"
    printf 'PLANNING_TOKEN_BUDGET=%q\n' "$planning_token_budget"
    printf 'IMPLEMENTATION_TOKEN_BUDGET=%q\n' "$implementation_token_budget"
    printf 'PENDING_START_TIMEOUT=%q\n' "$pending_start_timeout"
    printf 'PENDING_RUN_TIMEOUT=%q\n' "$pending_run_timeout"
  } >"$CONFIG_FILE"
  chmod 600 "$CONFIG_FILE"
}

valid_session_id() {
  [[ "${1:-}" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]
}

git_dir_of() {
  local dir="${1:?directory required}"
  git -C "$dir" rev-parse --absolute-git-dir 2>/dev/null
}

worktree_problems() {
  local dir="${1:?directory required}"
  local git_dir
  git_dir="$(git_dir_of "$dir")" || {
    printf 'not-a-git-worktree\n'
    return 0
  }

  git -C "$dir" diff --cached --quiet --ignore-submodules -- 2>/dev/null || printf 'staged-changes\n'
  git -C "$dir" diff --quiet --ignore-submodules -- 2>/dev/null || printf 'unstaged-changes\n'
  [[ -z "$(git -C "$dir" ls-files --others --exclude-standard 2>/dev/null)" ]] || printf 'untracked-files\n'
  [[ -z "$(git -C "$dir" ls-files --unmerged 2>/dev/null)" ]] || printf 'unmerged-index\n'
  [[ ! -f "$git_dir/MERGE_HEAD" ]] || printf 'merge-in-progress\n'
  [[ ! -f "$git_dir/CHERRY_PICK_HEAD" ]] || printf 'cherry-pick-in-progress\n'
  [[ ! -f "$git_dir/REVERT_HEAD" ]] || printf 'revert-in-progress\n'
  [[ ! -d "$git_dir/rebase-merge" ]] || printf 'rebase-merge-in-progress\n'
  [[ ! -d "$git_dir/rebase-apply" ]] || printf 'rebase-apply-in-progress\n'
  [[ ! -d "$git_dir/sequencer" ]] || printf 'sequencer-in-progress\n'
}

preflight_worktree() {
  local dir="${1:?directory required}"
  local problems
  problems="$(worktree_problems "$dir")"
  if [[ -z "$problems" ]]; then
    return 0
  fi
  printf 'Integration preflight failed for %s:\n%s\n' "$dir" "$problems" >&2
  return 1
}

remove_validation_worktree() {
  local repo="${1:?repository required}"
  local worktree="${2:?worktree required}"
  git -C "$repo" worktree remove --force "$worktree" >/dev/null 2>&1 || true
  [[ ! -d "$worktree" ]] || rm -rf "$worktree"
}

validate_handoff_range() {
  local repo="${1:?repository required}"
  local recorded_base="${2:?recorded base required}"
  local advertised="${3:?advertised range required}"
  local integration_ref="${4:?integration ref required}"
  local base_sha from_ref to_ref from_sha to_sha integration_sha validation_worktree patch_file mode rc

  base_sha="$(git -C "$repo" rev-parse --verify "${recorded_base}^{commit}" 2>/dev/null)" || {
    printf 'Handoff rejected: recorded base %s is not a commit.\n' "$recorded_base" >&2
    return 1
  }
  integration_sha="$(git -C "$repo" rev-parse --verify "${integration_ref}^{commit}" 2>/dev/null)" || {
    printf 'Handoff rejected: integration ref %s is not a commit.\n' "$integration_ref" >&2
    return 1
  }
  case "$advertised" in
    *..*) from_ref="${advertised%%..*}"; to_ref="${advertised##*..}" ;;
    *) from_ref="$recorded_base"; to_ref="$advertised" ;;
  esac
  from_sha="$(git -C "$repo" rev-parse --verify "${from_ref}^{commit}" 2>/dev/null)" || {
    printf 'Handoff rejected: range start %s is not a commit.\n' "$from_ref" >&2
    return 1
  }
  to_sha="$(git -C "$repo" rev-parse --verify "${to_ref}^{commit}" 2>/dev/null)" || {
    printf 'Handoff rejected: range end %s is not a commit.\n' "$to_ref" >&2
    return 1
  }
  [[ "$from_sha" != "$to_sha" ]] || {
    printf 'Handoff rejected: advertised range is empty.\n' >&2
    return 1
  }
  git -C "$repo" merge-base --is-ancestor "$from_sha" "$to_sha" 2>/dev/null || {
    printf 'Handoff rejected: advertised range is not a forward commit chain.\n' >&2
    return 1
  }
  mode=patch
  if git -C "$repo" merge-base --is-ancestor "$base_sha" "$to_sha" 2>/dev/null; then
    mode=commits
    git -C "$repo" merge-base --is-ancestor "$from_sha" "$integration_sha" 2>/dev/null || {
      printf 'Handoff rejected: correction depends on unintegrated ancestor %s.\n' "${from_sha:0:12}" >&2
      return 1
    }
  elif [[ "$advertised" != *..* ]]; then
    printf 'Handoff rejected: rebased work must advertise an explicit self-contained range.\n' >&2
    return 1
  fi

  validation_worktree="$(mktemp -d "${TMPDIR:-/tmp}/historia-handoff.XXXXXX")"
  if ! git -C "$repo" worktree add --detach --quiet "$validation_worktree" "$integration_sha"; then
    rm -rf "$validation_worktree"
    printf 'Handoff rejected: could not create disposable validation worktree.\n' >&2
    return 1
  fi
  set +e
  if [[ "$mode" == "commits" ]]; then
    git -C "$validation_worktree" -c user.name='Open Historia Handoff Validator' \
      -c user.email='handoff-validator@localhost' cherry-pick "$from_sha..$to_sha" >/dev/null 2>&1
    rc=$?
  else
    patch_file="$(mktemp "${TMPDIR:-/tmp}/historia-handoff-patch.XXXXXX")"
    git -C "$repo" diff --binary "$from_sha..$to_sha" >"$patch_file"
    if [[ ! -s "$patch_file" ]]; then
      rc=1
    else
      git -C "$validation_worktree" apply --index "$patch_file" >/dev/null 2>&1
      rc=$?
    fi
    rm -f "$patch_file"
  fi
  set -e
  remove_validation_worktree "$repo" "$validation_worktree"
  if (( rc != 0 )); then
    printf 'Handoff rejected: range does not apply cleanly to %s.\n' "${integration_sha:0:12}" >&2
    return 1
  fi
}

integrate_handoff_range() {
  local repo="${1:?repository required}"
  local recorded_base="${2:?recorded base required}"
  local advertised="${3:?advertised range required}"
  local integration_ref="${4:-HEAD}"
  local integration_sha head_before base_sha from_ref to_ref from_sha to_sha mode patch_file rc

  preflight_worktree "$repo" || return 1
  integration_sha="$(git -C "$repo" rev-parse --verify "${integration_ref}^{commit}")"
  head_before="$(git -C "$repo" rev-parse HEAD)"
  [[ "$integration_sha" == "$head_before" ]] || {
    printf 'Integration refused: integration ref must resolve to current HEAD.\n' >&2
    return 1
  }
  validate_handoff_range "$repo" "$recorded_base" "$advertised" "$integration_sha" || return 1
  case "$advertised" in
    *..*) from_ref="${advertised%%..*}"; to_ref="${advertised##*..}" ;;
    *) from_ref="$recorded_base"; to_ref="$advertised" ;;
  esac
  base_sha="$(git -C "$repo" rev-parse --verify "${recorded_base}^{commit}")"
  from_sha="$(git -C "$repo" rev-parse --verify "${from_ref}^{commit}")"
  to_sha="$(git -C "$repo" rev-parse --verify "${to_ref}^{commit}")"
  mode=patch
  if git -C "$repo" merge-base --is-ancestor "$base_sha" "$to_sha" 2>/dev/null; then
    mode=commits
  fi

  set +e
  if [[ "$mode" == "commits" ]]; then
    git -C "$repo" cherry-pick "$from_sha..$to_sha"
    rc=$?
  else
    patch_file="$(mktemp "${TMPDIR:-/tmp}/historia-integration-patch.XXXXXX")"
    git -C "$repo" diff --binary "$from_sha..$to_sha" >"$patch_file"
    git -C "$repo" apply --index "$patch_file"
    rc=$?
    rm -f "$patch_file"
    if (( rc == 0 )); then
      git -C "$repo" commit -m "Integrate handoff ${to_sha:0:12}"
      rc=$?
    fi
  fi
  set -e
  if (( rc == 0 )); then
    return 0
  fi

  if [[ "$(git -C "$repo" rev-parse HEAD 2>/dev/null)" != "$head_before" ]] || \
     [[ -f "$(git_dir_of "$repo")/CHERRY_PICK_HEAD" ]] || \
     [[ -d "$(git_dir_of "$repo")/sequencer" ]]; then
    git -C "$repo" cherry-pick --abort >/dev/null 2>&1 || {
      printf 'Integration failed and automatic abort failed; owner intervention is required.\n' >&2
      return 2
    }
  fi
  if ! preflight_worktree "$repo" >/dev/null 2>&1; then
    git -C "$repo" reset --hard "$head_before" >/dev/null 2>&1 || {
      printf 'Integration failed and automatic restoration failed; owner intervention is required.\n' >&2
      return 2
    }
  fi
  if [[ "$(git -C "$repo" rev-parse HEAD)" != "$head_before" ]] || ! preflight_worktree "$repo"; then
    printf 'Integration failed and the original clean Git state was not restored.\n' >&2
    return 2
  fi
  printf 'Integration failed; the orchestrator restored the original clean Git state.\n' >&2
  return 1
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
  local dispatch_snapshot="${2:-{\"review\":[],\"planReview\":[],\"malformed\":[],\"queues\":{\"agent:gpt\":[],\"agent:deepseek\":[]},\"highestBands\":{\"agent:gpt\":[],\"agent:deepseek\":[]}}}"
  local worker_snapshot="${3:-[]}"
  printf '%s' "ORCHESTRATOR_TICK_ID=${tick_id}. Work in ${REPO_ROOT}. Read docs/agent-orchestrator.md and execute exactly one orchestration cycle against ${GITHUB_REPOSITORY}. Act only as GPT plan gate, integration owner and dispatcher: review/integrate implementation handoffs, review worker plans, reconcile workers, improve initial prompts, and assign existing status:ready Issues. Never create new tasks, Issues, Epics, roadmap items, or backlog scope; the owner does that in a separate general session. Lifecycle order is mandatory: (1) process every status:review implementation handoff; rejected implementation is blocked with evidence and is never resumed for correction; (2) process every status:plan-review plan before any new claim—approve it or amend it yourself only when it covers one cohesive production seam and can fit the implementation token budget, then post APPROVED IMPLEMENTATION PLAN, move the Issue to status:claimed plus stage:implementation, and resume the same worker session exactly once; otherwise post NEEDS DECOMPOSITION and block it for the owner planning session without raising the budget; (3) reconcile status:claimed workers and stale claims without retrying an exited phase; (4) fill free capacity from eligible status:ready work by moving it to status:claimed plus stage:planning and launching exactly one planning phase. status:blocked is never eligible. A worker exit code records process termination only; it is never handoff acceptance. Every completed worker still labelled status:claimed in the worker reconciliation snapshot must be set status:blocked with evidence unless it already made the verified lifecycle handoff appropriate to its phase. Do not resume it as a correction. Do not end ORCHESTRATOR_OK or ORCHESTRATOR_IDLE while such a completion remains unreconciled. Before any integration, run scripts/agent-orchestrator.sh preflight ${REPO_ROOT} and integrate the advertised range with scripts/agent-orchestrator.sh integrate-range; never manually cherry-pick an unvalidated worker range. For each agent class independently, the code-generated queue below is ordered CRITICAL -> HIGH -> MEDIUM -> LOW and then by issue number. Apply dependency, owned-path and concurrency eligibility checks without reordering eligible work: claim only from the highest priority band that still has an eligible candidate. LOW is allowed only when no eligible ready CRITICAL, HIGH or MEDIUM remains for that agent class. A blocked or claimed higher-priority issue does not suppress lower ready work, and GPT work does not suppress DeepSeek work. Never claim an issue listed as malformed; zero or multiple canonical priority labels must be diagnosed. Priority labels are priority:critical, priority:high, priority:medium and priority:low; priority:p0 and priority:p1 are invalid. Dispatch snapshot: ${dispatch_snapshot}. Worker reconciliation snapshot: ${worker_snapshot}. Keep at most ${MAX_ACTIVE_STREAMS} active task streams total, including the GPT integration stream. Every worker phase uses ${WORKER_MODEL}; V3.2 and automatic model promotion are forbidden. Invoke planning with a ${PLANNING_TOKEN_BUDGET}-token hard budget and implementation with a ${IMPLEMENTATION_TOKEN_BUDGET}-token hard budget through scripts/agent-worker.sh. The budget is cumulative request-token usage reported by OpenCode and may overshoot by at most the in-flight request. Do not create additional agent identities or ask the owner routine questions. End the final message with exactly one marker on its own line: ORCHESTRATOR_OK, ORCHESTRATOR_IDLE, or OWNER_ACTION_REQUIRED: <one-line decision>."
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

dispatch_snapshot() {
  jq -c '
    def names: [.labels[].name];
    def priorities: [names[] | select(. == "priority:critical" or . == "priority:high" or . == "priority:medium" or . == "priority:low")];
    def rank($priority):
      if $priority == "priority:critical" then 0
      elif $priority == "priority:high" then 1
      elif $priority == "priority:medium" then 2
      elif $priority == "priority:low" then 3
      else 99
      end;
    def queue($agent):
      [
        .[]
        | (names) as $labels
        | (priorities) as $priority
        | select($labels | index("status:ready"))
        | select($labels | index($agent))
        | select($priority | length == 1)
        | {
            number,
            priority: $priority[0],
            priorityRank: rank($priority[0]),
            title
          }
      ]
      | sort_by(.priorityRank, .number);
    def highest_band($queue):
      if $queue | length == 0 then []
      else ($queue[0].priorityRank) as $rank
        | [$queue[] | select(.priorityRank == $rank)]
      end;
    (queue("agent:gpt")) as $gpt
    | (queue("agent:deepseek")) as $deepseek
    | {
      review: [
        .[]
        | select(names | index("status:review"))
        | .number
      ] | sort,
      planReview: [
        .[]
        | select(names | index("status:plan-review"))
        | .number
      ] | sort,
      malformed: [
        .[]
        | (priorities) as $priority
        | select($priority | length != 1)
        | {number, priorities: $priority}
      ] | sort_by(.number),
      queues: {
        "agent:gpt": $gpt,
        "agent:deepseek": $deepseek
      },
      highestBands: {
        "agent:gpt": highest_band($gpt),
        "agent:deepseek": highest_band($deepseek)
      }
    }
  '
}

malformed_priority_numbers() {
  printf '%s' "$(dispatch_snapshot)" | jq -r '.malformed | map("#" + (.number | tostring)) | join(", ")'
}

count_status() {
  local status="$1"
  jq --arg status "$status" '[.[] | select(any(.labels[]; .name == $status))] | length'
}

worker_reconciliation_snapshot() {
  local board="${1:?board JSON required}"
  local issue exit_file exit_code meta_file log_file model worktree session final_text has_handoff
  local result='[]'

  while IFS= read -r issue; do
    exit_file="$WORKER_STATE_DIR/$issue.exit"
    [[ -f "$exit_file" ]] || continue
    exit_code="$(tr -d '\r\n' <"$exit_file")"
    [[ "$exit_code" != "starting" ]] || continue
    meta_file="$WORKER_STATE_DIR/$issue.meta"
    log_file="$WORKER_STATE_DIR/$issue.jsonl"
    model="$(sed -n 's/^MODEL=//p' "$meta_file" 2>/dev/null | head -1)"
    worktree="$(sed -n 's/^WORKTREE=//p' "$meta_file" 2>/dev/null | head -1)"
    session="$(grep -o '"sessionID":"[^"]*' "$log_file" 2>/dev/null | head -1 | cut -d'"' -f4 || true)"
    final_text="$(jq -rs '[.[] | select(.type == "text") | .part.text] | last // ""' "$log_file" 2>/dev/null || true)"
    has_handoff=false
    [[ "$final_text" != *HANDOFF* ]] || has_handoff=true
    result="$(jq -cn \
      --argjson current "$result" \
      --argjson issue "$issue" \
      --arg exitCode "$exit_code" \
      --arg model "$model" \
      --arg worktree "$worktree" \
      --arg session "$session" \
      --argjson hasHandoff "$has_handoff" \
      '$current + [{issue:$issue,process:"exited",exitCode:$exitCode,model:$model,worktree:$worktree,session:$session,finalResponseHasHandoff:$hasHandoff,githubStatus:"claimed"}]')"
  done < <(printf '%s' "$board" | jq -r '.[] | select(any(.labels[]; .name == "status:claimed")) | select(any(.labels[]; .name == "agent:deepseek")) | .number')

  printf '%s\n' "$result"
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
  local ready review plan_review claimed_deepseek
  ready="$(printf '%s' "$board" | count_status 'status:ready')"
  review="$(printf '%s' "$board" | count_status 'status:review')"
  plan_review="$(printf '%s' "$board" | count_status 'status:plan-review')"
  claimed_deepseek="$(printf '%s' "$board" | jq '[.[] | select(any(.labels[]; .name == "status:claimed")) | select(any(.labels[]; .name == "agent:deepseek"))] | length')"

  if (( ready > 0 || review > 0 || plan_review > 0 )); then
    return 0
  fi
  if [[ "$(worker_reconciliation_snapshot "$board" | jq 'length')" -gt 0 ]]; then
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
      | select(any(.labels[]; .name == "status:ready" or .name == "status:plan-review" or .name == "status:review"))
      | ([.labels[].name | select(startswith("status:") or startswith("agent:") or startswith("priority:"))] | sort | join(",")) as $routing
      | "\(.number):\(.updatedAt):\($routing)"
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
  require_orchestrator_enabled || return 1
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

  local board dispatch workers force prompt exit_code signature acknowledged_signature tick_id review_count
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
  dispatch="$(printf '%s' "$board" | dispatch_snapshot)"
  workers="$(worker_reconciliation_snapshot "$board")"
  force="${ORCHESTRATOR_FORCE:-0}"
  if (( retry_required == 1 )); then
    force=1
  fi
  if [[ "$force" != "1" ]] && ! needs_tick "$board"; then
    log "idle: no ready/review work and no claimed audit due"
    return 0
  fi

  review_count="$(printf '%s' "$board" | count_status 'status:review')"
  if (( review_count > 0 )) && ! preflight_worktree "$REPO_ROOT" 2>"$STATE_DIR/preflight-error"; then
    {
      printf 'Integration refused: canonical worktree is unsafe.\n'
      cat "$STATE_DIR/preflight-error"
      printf 'OWNER_ACTION_REQUIRED: restore or explicitly resolve the reported canonical Git state before review integration.\n'
    } >"$LAST_MESSAGE_PATH"
    log "refused: review handoff exists but canonical worktree preflight failed"
    notify_owner "Integration refused: canonical Git state is unsafe"
    return 2
  fi
  rm -f "$STATE_DIR/preflight-error"

  signature="$(printf '%s' "$board" | actionable_signature)|workers:$(printf '%s' "$workers" | jq -c 'map({issue,exitCode,finalResponseHasHandoff})')"
  acknowledged_signature="$(cat "$LAST_ACK_SIGNATURE_PATH" 2>/dev/null || true)"
  if [[ "$force" != "1" && -n "$signature" && "$signature" == "$acknowledged_signature" ]] && ! claimed_check_due; then
    log "idle: actionable board state was already acknowledged"
    return 0
  fi

  tick_id="$(new_tick_id)"
  prompt="$(tick_prompt "$tick_id" "$dispatch" "$workers")"
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

  if orchestrator_disabled; then
    printf 'orchestrator: DISABLED (%s)\n' "$DISABLED_PATH"
  else
    printf 'orchestrator: enabled\n'
  fi
  if launchd_loaded; then
    printf 'watchdog: running (%ss interval)\n' "$TICK_SECONDS"
  else
    printf 'watchdog: stopped\n'
  fi
  printf 'session:  %s\n' "$SESSION_ID"
  printf 'repo:     %s\n\n' "$REPO_ROOT"
  printf 'capacity: %s active streams (GPT + up to %s workers)\n' "$MAX_ACTIVE_STREAMS" "$((MAX_ACTIVE_STREAMS - 1))"
  printf 'claimed:  audit every %ss\n\n' "$CLAIMED_CHECK_SECONDS"
  printf 'worker:   model=%s\n' "$WORKER_MODEL"
  printf 'budgets:  planning=%s implementation=%s request tokens\n\n' "$PLANNING_TOKEN_BUDGET" "$IMPLEMENTATION_TOKEN_BUDGET"

  if read_pending_tick; then
    inspect_pending_tick
    printf 'delivery: pending tick=%s status=%s attempt=%s\n\n' "$PENDING_TICK_ID" "$PENDING_STATUS" "$PENDING_ATTEMPTS"
  else
    printf 'delivery: no pending tick\n\n'
  fi

  local board malformed
  board="$(board_json)"
  printf '%s' "$board" | jq -r '
    def names: [.labels[].name];
    def priority_rank:
      if names | index("priority:critical") then 0
      elif names | index("priority:high") then 1
      elif names | index("priority:medium") then 2
      elif names | index("priority:low") then 3
      else 99
      end;
    sort_by(
      (if names | index("status:ready") then 0 else 1 end),
      (if names | index("status:ready") then priority_rank else 99 end),
      .number
    )
    | .[]
    | ([.labels[].name] | map(select(startswith("status:"))) | first // "status:unknown") as $status
    | ([.labels[].name] | map(select(startswith("agent:"))) | first // "agent:unknown") as $agent
    | ([.labels[].name] | map(select(startswith("priority:"))) | join(",") // "priority:missing") as $priority
    | "#\(.number)\t\($status | sub("status:"; ""))\t\($agent | sub("agent:"; ""))\t\($priority | sub("priority:"; ""))\t\(.title)"
  '

  malformed="$(printf '%s' "$board" | malformed_priority_numbers)"
  if [[ -n "$malformed" ]]; then
    printf '\nMalformed priority labels (not claimable): %s\n' "$malformed"
  fi

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

  local board ready review plan_review claimed_deepseek
  board="$(board_json)"
  ready="$(printf '%s' "$board" | count_status 'status:ready')"
  review="$(printf '%s' "$board" | count_status 'status:review')"
  plan_review="$(printf '%s' "$board" | count_status 'status:plan-review')"
  claimed_deepseek="$(printf '%s' "$board" | jq '[.[] | select(any(.labels[]; .name == "status:claimed")) | select(any(.labels[]; .name == "agent:deepseek"))] | length')"

  printf 'ready=%s plan_review=%s review=%s claimed_deepseek=%s\n' "$ready" "$plan_review" "$review" "$claimed_deepseek"
  if orchestrator_disabled; then
    printf 'decision=disabled\n'
  elif needs_tick "$board"; then
    printf 'decision=wake\n'
  else
    printf 'decision=idle\n'
  fi
}

install_watchdog() {
  require_orchestrator_enabled || return 1
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
    CLAIMED_CHECK_SECONDS=420
    MAX_ACTIVE_STREAMS=7
    WORKER_MODEL="openrouter/deepseek/deepseek-v4-pro-0813"
    PLANNING_TOKEN_BUDGET=400000
    IMPLEMENTATION_TOKEN_BUDGET=1500000
    PENDING_START_TIMEOUT=3600
    PENDING_RUN_TIMEOUT=3600
  fi
}

bootstrap_watchdog() {
  require_orchestrator_enabled || return 1
  write_plist
  launchctl bootstrap "gui/${UID}" "$PLIST_PATH"
}

stop_watchdog_silently() {
  if launchd_loaded; then
    launchctl bootout "gui/${UID}/${LABEL}"
  fi
}

start_bound_session() {
  require_orchestrator_enabled || return 1
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
  require_orchestrator_enabled || return 1
  require_command codex
  require_command gh
  require_command jq
  require_command plutil

  local board dispatch workers signature tick_id prompt sessions_before session_id launched_at codex_path
  load_start_settings
  board="$(board_json)"
  dispatch="$(printf '%s' "$board" | dispatch_snapshot)"
  workers="$(worker_reconciliation_snapshot "$board")"
  signature="$(printf '%s' "$board" | actionable_signature)|workers:$(printf '%s' "$workers" | jq -c 'map({issue,exitCode,finalResponseHasHandoff})')"
  tick_id="$(new_tick_id)"
  prompt="$(tick_prompt "$tick_id" "$dispatch" "$workers")"
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
  require_orchestrator_enabled || return 1
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
  require_orchestrator_enabled || return 1
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

stop_active_workers() {
  command -v screen >/dev/null 2>&1 || return 0

  local name
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    screen -S "$name" -X quit >/dev/null 2>&1 || true
    printf 'Stopped worker session %s.\n' "$name"
  done < <(screen -ls 2>/dev/null | sed -nE 's/^[[:space:]]*[0-9]+\.(historia-issue-[0-9]+)[[:space:]].*/\1/p' || true)
}

disable_orchestrator() {
  local temp_path archived_pending
  temp_path="$(mktemp "${CONFIG_DIR}/disabled.XXXXXX")"
  {
    printf 'disabled_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    printf 'reason=owner-disabled-orchestration\n'
  } >"$temp_path"
  chmod 600 "$temp_path"
  mv "$temp_path" "$DISABLED_PATH"

  if [[ "$SCRIPT_PATH" != "$RUNTIME_SCRIPT_PATH" ]]; then
    cp "$SCRIPT_PATH" "$RUNTIME_SCRIPT_PATH"
    chmod 700 "$RUNTIME_SCRIPT_PATH"
  fi

  stop_watchdog_silently
  stop_active_workers

  if [[ -f "$PENDING_TICK_PATH" ]]; then
    archived_pending="${STATE_DIR}/disabled-pending-tick-$(date '+%Y%m%dT%H%M%S')-$$"
    mv "$PENDING_TICK_PATH" "$archived_pending"
    printf 'Archived pending delivery at %s.\n' "$archived_pending"
  fi

  printf 'Orchestrator disabled. New watchdog ticks and worker launches are blocked.\n'
}

enable_orchestrator() {
  if orchestrator_disabled; then
    rm -f "$DISABLED_PATH"
    printf 'Orchestrator launch permission enabled. Watchdog remains stopped.\n'
  else
    printf 'Orchestrator launch permission is already enabled. Watchdog remains unchanged.\n'
  fi
}

if [[ "${OPEN_HISTORIA_ORCHESTRATOR_LIBRARY_ONLY:-0}" == "1" ]]; then
  return 0 2>/dev/null || exit 0
fi

case "${1:-status}" in
  disable)
    disable_orchestrator
    ;;
  enable)
    enable_orchestrator
    ;;
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
  preflight)
    require_command git
    preflight_worktree "${2:-$DEFAULT_REPO_ROOT}"
    ;;
  validate-range)
    require_command git
    validate_handoff_range "${2:?repository required}" "${3:?recorded base required}" "${4:?advertised range required}" "${5:?integration ref required}"
    ;;
  integrate-range)
    require_command git
    integrate_handoff_range "${2:?repository required}" "${3:?recorded base required}" "${4:?advertised range required}" "${5:-HEAD}"
    ;;
  uninstall)
    uninstall_watchdog
    ;;
  *)
    printf 'Usage: %s {disable|enable|install [session-id]|start [session-id]|stop|restart|check|run-now|status|preflight [repo]|validate-range <repo> <base> <range> <integration>|integrate-range <repo> <base> <range> [integration]|uninstall}\n' "$SCRIPT_PATH" >&2
    exit 2
    ;;
esac
