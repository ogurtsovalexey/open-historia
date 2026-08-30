#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

export OPEN_HISTORIA_ORCHESTRATOR_LIBRARY_ONLY=1
export OPEN_HISTORIA_ORCHESTRATOR_CONFIG_DIR="$TEST_ROOT/config"
export OPEN_HISTORIA_ORCHESTRATOR_STATE_DIR="$TEST_ROOT/state"
export OPEN_HISTORIA_ORCHESTRATOR_PLIST_PATH="$TEST_ROOT/agent.plist"
export OPEN_HISTORIA_ORCHESTRATOR_CODEX_HOME="$TEST_ROOT/codex"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/agent-orchestrator.sh"

CLAIMED_CHECK_SECONDS=420
MAX_ACTIVE_STREAMS=7

SESSION_ID="11111111-2222-4333-8444-555555555555"
PENDING_START_TIMEOUT=3600
PENDING_RUN_TIMEOUT=3600
SESSION_DIR="$(codex_sessions_dir)/2026/08/29"
SESSION_FILE="$SESSION_DIR/rollout-test-${SESSION_ID}.jsonl"
mkdir -p "$SESSION_DIR"

append_json() {
  jq -cn "$@" >>"$SESSION_FILE"
}

assert_status() {
  local expected="${1:?expected status required}"
  inspect_pending_tick
  if [[ "$PENDING_STATUS" != "$expected" ]]; then
    printf 'Expected pending status %s, got %s\n' "$expected" "$PENDING_STATUS" >&2
    exit 1
  fi
}

append_json --arg id "$SESSION_ID" '{type:"session_meta",payload:{id:$id,cwd:"/tmp/repo",source:"cli"}}'
append_json --arg tick "tick-success" '{ordinal:1,type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:("ORCHESTRATOR_TICK_ID=" + $tick)}],internal_chat_message_metadata_passthrough:{turn_id:"turn-success"}}}'
write_pending_tick "tick-success" "7:signature" 1 "$(date +%s)"
read_pending_tick
assert_status waiting

append_json '{ordinal:2,type:"event_msg",payload:{type:"task_complete",turn_id:"turn-success",last_agent_message:"Cycle complete.\n\nORCHESTRATOR_OK"}}'
assert_status complete
[[ "$PENDING_RESULT" == *"ORCHESTRATOR_OK"* ]]
acknowledge_pending_tick
[[ ! -f "$PENDING_TICK_PATH" ]]
[[ "$(cat "$LAST_ACK_SIGNATURE_PATH")" == "7:signature" ]]

append_json --arg tick "tick-interrupted" '{ordinal:3,type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:("ORCHESTRATOR_TICK_ID=" + $tick)}],internal_chat_message_metadata_passthrough:{turn_id:"turn-interrupted"}}}'
append_json '{ordinal:4,type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:"manual interruption"}],internal_chat_message_metadata_passthrough:{turn_id:"turn-manual"}}}'
write_pending_tick "tick-interrupted" "8:signature" 1 "$(date +%s)"
read_pending_tick
assert_status interrupted

append_json --arg tick "tick-no-marker" '{ordinal:5,type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:("ORCHESTRATOR_TICK_ID=" + $tick)}],internal_chat_message_metadata_passthrough:{turn_id:"turn-no-marker"}}}'
append_json '{ordinal:6,type:"event_msg",payload:{type:"task_complete",turn_id:"turn-no-marker",last_agent_message:"Cycle ended without its required marker."}}'
write_pending_tick "tick-no-marker" "9:signature" 1 "$(date +%s)"
read_pending_tick
assert_status missing-marker

launchctl() {
  if [[ "${1:-}" == "print" ]]; then
    return 1
  fi
  return 0
}

gh() {
  printf '%s\n' "${MOCK_GH_BOARD:-[]}"
}

codex() {
  if [[ "${1:-}" == "queue" ]]; then
    printf 'Queued mock message.\n'
    return 0
  fi
  return 1
}

plutil() {
  return 0
}

notify_owner() {
  return 0
}

FAKE_REPO="$TEST_ROOT/canonical-repo"
git init -qb main "$FAKE_REPO"
git -C "$FAKE_REPO" config user.email test@example.com
git -C "$FAKE_REPO" config user.name 'Test User'
git -C "$FAKE_REPO" commit --allow-empty -qm base
DEFAULT_REPO_ROOT="$FAKE_REPO"

rm -f "$PENDING_TICK_PATH" "$CONFIG_FILE"
start_bound_session "$SESSION_ID" >/dev/null
read_pending_tick
inspect_pending_tick
[[ "$PENDING_SESSION_ID" == "$SESSION_ID" ]]
[[ "$PENDING_STATUS" == "waiting" ]]
[[ -f "$CONFIG_FILE" ]]
[[ -f "$PLIST_PATH" ]]
grep -Fq "SESSION_ID=${SESSION_ID}" "$CONFIG_FILE"
grep -Fq "CLAIMED_CHECK_SECONDS=420" "$CONFIG_FILE"
grep -Fq "MAX_ACTIVE_STREAMS=7" "$CONFIG_FILE"
[[ "$(tick_prompt tick-capacity)" == *"at most 7 active task streams total"* ]]

# A review tick fails closed on owner Git state, reports the exact condition,
# preserves the file, and cannot manufacture an ORCHESTRATOR_OK result.
rm -f "$PENDING_TICK_PATH"
printf 'owner work\n' >"$FAKE_REPO/owner-change.txt"
MOCK_GH_BOARD='[{"number":99,"title":"review","updatedAt":"x","labels":[{"name":"status:review"},{"name":"agent:deepseek"},{"name":"priority:high"}]}]'
if run_tick; then
  printf 'Dirty review tick unexpectedly passed preflight.\n' >&2
  exit 1
fi
[[ -f "$FAKE_REPO/owner-change.txt" ]]
grep -Fq 'untracked-files' "$LAST_MESSAGE_PATH"
grep -Fq 'OWNER_ACTION_REQUIRED:' "$LAST_MESSAGE_PATH"
if grep -Fq 'ORCHESTRATOR_OK' "$LAST_MESSAGE_PATH"; then
  printf 'Refused review tick reported ORCHESTRATOR_OK.\n' >&2
  exit 1
fi
rm "$FAKE_REPO/owner-change.txt"
MOCK_GH_BOARD='[]'

PRIORITY_BOARD='[
  {"number":40,"title":"critical later","updatedAt":"2026-08-30T00:00:00Z","labels":[{"name":"status:ready"},{"name":"agent:deepseek"},{"name":"priority:critical"}]},
  {"number":41,"title":"critical later two","updatedAt":"2026-08-30T00:00:00Z","labels":[{"name":"status:ready"},{"name":"agent:deepseek"},{"name":"priority:critical"}]},
  {"number":20,"title":"high","updatedAt":"2026-08-30T00:00:00Z","labels":[{"name":"status:ready"},{"name":"agent:deepseek"},{"name":"priority:high"}]},
  {"number":30,"title":"medium","updatedAt":"2026-08-30T00:00:00Z","labels":[{"name":"status:ready"},{"name":"agent:deepseek"},{"name":"priority:medium"}]},
  {"number":10,"title":"low","updatedAt":"2026-08-30T00:00:00Z","labels":[{"name":"status:ready"},{"name":"agent:deepseek"},{"name":"priority:low"}]},
  {"number":50,"title":"blocked critical","updatedAt":"2026-08-30T00:00:00Z","labels":[{"name":"status:blocked"},{"name":"agent:deepseek"},{"name":"priority:critical"}]},
  {"number":51,"title":"claimed critical","updatedAt":"2026-08-30T00:00:00Z","labels":[{"name":"status:claimed"},{"name":"agent:deepseek"},{"name":"priority:critical"}]},
  {"number":60,"title":"gpt critical","updatedAt":"2026-08-30T00:00:00Z","labels":[{"name":"status:ready"},{"name":"agent:gpt"},{"name":"priority:critical"}]},
  {"number":61,"title":"gpt low","updatedAt":"2026-08-30T00:00:00Z","labels":[{"name":"status:ready"},{"name":"agent:gpt"},{"name":"priority:low"}]},
  {"number":70,"title":"missing priority","updatedAt":"2026-08-30T00:00:00Z","labels":[{"name":"status:ready"},{"name":"agent:deepseek"}]},
  {"number":71,"title":"multiple priorities","updatedAt":"2026-08-30T00:00:00Z","labels":[{"name":"status:ready"},{"name":"agent:deepseek"},{"name":"priority:critical"},{"name":"priority:high"}]},
  {"number":80,"title":"review first","updatedAt":"2026-08-30T00:00:00Z","labels":[{"name":"status:review"},{"name":"agent:deepseek"},{"name":"priority:low"}]}
]'
PRIORITY_SNAPSHOT="$(printf '%s' "$PRIORITY_BOARD" | dispatch_snapshot)"

# CRITICAL precedes HIGH, HIGH precedes MEDIUM/LOW, and same-band order is stable.
[[ "$(printf '%s' "$PRIORITY_SNAPSHOT" | jq -c '.["queues"]["agent:deepseek"] | map(.number)')" == '[40,41,20,30,10]' ]]
[[ "$(printf '%s' "$PRIORITY_SNAPSHOT" | jq -c '.["highestBands"]["agent:deepseek"] | map(.number)')" == '[40,41]' ]]

# Blocked and claimed CRITICAL work is not ready and cannot suppress ready HIGH.
NON_READY_CRITICAL='[
  {"number":1,"title":"blocked","updatedAt":"x","labels":[{"name":"status:blocked"},{"name":"agent:deepseek"},{"name":"priority:critical"}]},
  {"number":2,"title":"claimed","updatedAt":"x","labels":[{"name":"status:claimed"},{"name":"agent:deepseek"},{"name":"priority:critical"}]},
  {"number":3,"title":"high","updatedAt":"x","labels":[{"name":"status:ready"},{"name":"agent:deepseek"},{"name":"priority:high"}]}
]'
[[ "$(printf '%s' "$NON_READY_CRITICAL" | dispatch_snapshot | jq -c '.["highestBands"]["agent:deepseek"] | map(.number)')" == '[3]' ]]

# Agent classes have independent bands: GPT CRITICAL does not suppress DeepSeek HIGH.
AGENT_ISOLATION='[
  {"number":1,"title":"gpt","updatedAt":"x","labels":[{"name":"status:ready"},{"name":"agent:gpt"},{"name":"priority:critical"}]},
  {"number":2,"title":"deepseek","updatedAt":"x","labels":[{"name":"status:ready"},{"name":"agent:deepseek"},{"name":"priority:high"}]}
]'
AGENT_SNAPSHOT="$(printf '%s' "$AGENT_ISOLATION" | dispatch_snapshot)"
[[ "$(printf '%s' "$AGENT_SNAPSHOT" | jq -r '.["highestBands"]["agent:gpt"][0].number')" == '1' ]]
[[ "$(printf '%s' "$AGENT_SNAPSHOT" | jq -r '.["highestBands"]["agent:deepseek"][0].number')" == '2' ]]

# LOW remains selectable when it is the highest eligible ready band.
LOW_ONLY='[{"number":9,"title":"low","updatedAt":"x","labels":[{"name":"status:ready"},{"name":"agent:deepseek"},{"name":"priority:low"}]}]'
[[ "$(printf '%s' "$LOW_ONLY" | dispatch_snapshot | jq -r '.["highestBands"]["agent:deepseek"][0].number')" == '9' ]]

# Missing and multiple canonical priorities fail closed and are diagnosed.
[[ "$(printf '%s' "$PRIORITY_SNAPSHOT" | jq -c '.malformed | map(.number)')" == '[70,71]' ]]
[[ "$(printf '%s' "$PRIORITY_BOARD" | malformed_priority_numbers)" == '#70, #71' ]]

# Review precedence and the computed snapshot are part of every tick contract.
PRIORITY_PROMPT="$(tick_prompt tick-priority "$PRIORITY_SNAPSHOT")"
[[ "$PRIORITY_PROMPT" == *"(1) process every status:review handoff before any new claim; (2) reconcile status:claimed"* ]]
[[ "$PRIORITY_PROMPT" == *'"review":[80]'* ]]
[[ "$PRIORITY_PROMPT" == *"Never claim an issue listed as malformed"* ]]

# Reprioritization alone changes the actionable signature.
SIGNATURE_HIGH='[{"number":1,"title":"same","updatedAt":"same","labels":[{"name":"status:ready"},{"name":"agent:deepseek"},{"name":"priority:high"}]}]'
SIGNATURE_LOW='[{"number":1,"title":"same","updatedAt":"same","labels":[{"name":"status:ready"},{"name":"agent:deepseek"},{"name":"priority:low"}]}]'
[[ "$(printf '%s' "$SIGNATURE_HIGH" | actionable_signature)" != "$(printf '%s' "$SIGNATURE_LOW" | actionable_signature)" ]]

BEFORE_PATH="$TEST_ROOT/sessions-before"
find "$(codex_sessions_dir)" -type f -name '*.jsonl' -print | sort >"$BEFORE_PATH"
NEW_SESSION_ID="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
NEW_SESSION_FILE="$SESSION_DIR/rollout-new-${NEW_SESSION_ID}.jsonl"
jq -cn --arg id "$NEW_SESSION_ID" '{type:"session_meta",payload:{id:$id,cwd:"/tmp/repo",source:"cli"}}' >"$NEW_SESSION_FILE"
jq -cn '{ordinal:1,type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:"ORCHESTRATOR_TICK_ID=tick-new"}],internal_chat_message_metadata_passthrough:{turn_id:"turn-new"}}}' >>"$NEW_SESSION_FILE"
[[ "$(detect_new_orchestrator_session "$BEFORE_PATH" "tick-new")" == "$NEW_SESSION_ID" ]]

# A worker process exit is not a handoff. It wakes reconciliation immediately,
# even when the periodic claimed audit is not due, and exposes missing evidence.
mkdir -p "$WORKER_STATE_DIR"
printf '0\n' >"$WORKER_STATE_DIR/91.exit"
printf 'MODEL=test-model\nWORKTREE=/tmp/worker-91\n' >"$WORKER_STATE_DIR/91.meta"
printf '%s\n' '{"type":"text","sessionID":"session-91","part":{"text":"Finished locally without lifecycle mutation."}}' >"$WORKER_STATE_DIR/91.jsonl"
CLAIMED_ONLY_BOARD='[{"number":91,"title":"claimed worker","updatedAt":"x","labels":[{"name":"status:claimed"},{"name":"agent:deepseek"},{"name":"priority:high"}]}]'
date +%s >"$LAST_CLAIMED_CHECK_PATH"
[[ "$(worker_reconciliation_snapshot "$CLAIMED_ONLY_BOARD" | jq -r '.[0].issue')" == '91' ]]
[[ "$(worker_reconciliation_snapshot "$CLAIMED_ONLY_BOARD" | jq -r '.[0].exitCode')" == '0' ]]
[[ "$(worker_reconciliation_snapshot "$CLAIMED_ONLY_BOARD" | jq -r '.[0].finalResponseHasHandoff')" == 'false' ]]
needs_tick "$CLAIMED_ONLY_BOARD"
RECONCILIATION_PROMPT="$(tick_prompt tick-worker '[]' "$(worker_reconciliation_snapshot "$CLAIMED_ONLY_BOARD")")"
[[ "$RECONCILIATION_PROMPT" == *'exit code records process termination only'* ]]
[[ "$RECONCILIATION_PROMPT" == *'"issue":91'* ]]
WORKER_SIGNATURE="$(printf '%s' "$CLAIMED_ONLY_BOARD" | actionable_signature)|workers:$(worker_reconciliation_snapshot "$CLAIMED_ONLY_BOARD" | jq -c 'map({issue,exitCode,finalResponseHasHandoff})')"
[[ "$WORKER_SIGNATURE" == *'"issue":91'* ]]

# All Git safety checks operate on disposable repositories. The repository that
# contains this test is never passed to a mutating helper.
HANDOFF_REPO="$TEST_ROOT/handoff-repo"
git init -qb main "$HANDOFF_REPO"
git -C "$HANDOFF_REPO" config user.email test@example.com
git -C "$HANDOFF_REPO" config user.name 'Test User'
printf 'base\n' >"$HANDOFF_REPO/tracked.txt"
git -C "$HANDOFF_REPO" add tracked.txt
git -C "$HANDOFF_REPO" commit -qm base
HANDOFF_BASE="$(git -C "$HANDOFF_REPO" rev-parse HEAD)"
preflight_worktree "$HANDOFF_REPO"

printf 'dirty\n' >>"$HANDOFF_REPO/tracked.txt"
[[ "$(worktree_problems "$HANDOFF_REPO")" == *unstaged-changes* ]]
if preflight_worktree "$HANDOFF_REPO" 2>/dev/null; then exit 1; fi
git -C "$HANDOFF_REPO" restore tracked.txt
printf 'staged\n' >>"$HANDOFF_REPO/tracked.txt"
git -C "$HANDOFF_REPO" add tracked.txt
[[ "$(worktree_problems "$HANDOFF_REPO")" == *staged-changes* ]]
git -C "$HANDOFF_REPO" reset --hard -q HEAD
printf 'untracked\n' >"$HANDOFF_REPO/untracked.txt"
[[ "$(worktree_problems "$HANDOFF_REPO")" == *untracked-files* ]]
rm "$HANDOFF_REPO/untracked.txt"
HANDOFF_GIT_DIR="$(git_dir_of "$HANDOFF_REPO")"
printf '%s\n' "$HANDOFF_BASE" >"$HANDOFF_GIT_DIR/MERGE_HEAD"
[[ "$(worktree_problems "$HANDOFF_REPO")" == *merge-in-progress* ]]
rm "$HANDOFF_GIT_DIR/MERGE_HEAD"
printf '%s\n' "$HANDOFF_BASE" >"$HANDOFF_GIT_DIR/CHERRY_PICK_HEAD"
[[ "$(worktree_problems "$HANDOFF_REPO")" == *cherry-pick-in-progress* ]]
rm "$HANDOFF_GIT_DIR/CHERRY_PICK_HEAD"
printf '%s\n' "$HANDOFF_BASE" >"$HANDOFF_GIT_DIR/REVERT_HEAD"
[[ "$(worktree_problems "$HANDOFF_REPO")" == *revert-in-progress* ]]
rm "$HANDOFF_GIT_DIR/REVERT_HEAD"
for operation_dir in rebase-merge rebase-apply sequencer; do
  mkdir "$HANDOFF_GIT_DIR/$operation_dir"
  [[ -n "$(worktree_problems "$HANDOFF_REPO")" ]]
  rm -r "$HANDOFF_GIT_DIR/$operation_dir"
done
BASE_BLOB="$(printf 'base conflict\n' | git -C "$HANDOFF_REPO" hash-object -w --stdin)"
OURS_BLOB="$(printf 'ours conflict\n' | git -C "$HANDOFF_REPO" hash-object -w --stdin)"
THEIRS_BLOB="$(printf 'theirs conflict\n' | git -C "$HANDOFF_REPO" hash-object -w --stdin)"
printf '100644 %s 1\tconflict.txt\n100644 %s 2\tconflict.txt\n100644 %s 3\tconflict.txt\n' \
  "$BASE_BLOB" "$OURS_BLOB" "$THEIRS_BLOB" | git -C "$HANDOFF_REPO" update-index --index-info
[[ "$(worktree_problems "$HANDOFF_REPO")" == *unmerged-index* ]]
git -C "$HANDOFF_REPO" reset --hard -q HEAD
preflight_worktree "$HANDOFF_REPO"

# A clean range rooted at the recorded base validates and integrates.
git -C "$HANDOFF_REPO" switch -qc worker-valid
printf 'worker\n' >"$HANDOFF_REPO/worker.txt"
git -C "$HANDOFF_REPO" add worker.txt
git -C "$HANDOFF_REPO" commit -qm worker
VALID_TIP="$(git -C "$HANDOFF_REPO" rev-parse HEAD)"
git -C "$HANDOFF_REPO" switch -q main
validate_handoff_range "$HANDOFF_REPO" "$HANDOFF_BASE" "$HANDOFF_BASE..$VALID_TIP" HEAD
integrate_handoff_range "$HANDOFF_REPO" "$HANDOFF_BASE" "$HANDOFF_BASE..$VALID_TIP" HEAD
[[ -f "$HANDOFF_REPO/worker.txt" ]]
preflight_worktree "$HANDOFF_REPO"

# A branch rebased away from the recorded SHA is accepted only as one explicit
# self-contained patch that applies to the current integration head.
BASE_TREE="$(git -C "$HANDOFF_REPO" rev-parse "${HANDOFF_BASE}^{tree}")"
UNRELATED_BASE="$(printf 'unrelated root\n' | git -C "$HANDOFF_REPO" commit-tree "$BASE_TREE")"
git -C "$HANDOFF_REPO" switch -qc worker-rebased "$UNRELATED_BASE"
printf 'rebased patch\n' >"$HANDOFF_REPO/rebased.txt"
git -C "$HANDOFF_REPO" add rebased.txt
git -C "$HANDOFF_REPO" commit -qm rebased-worker
REBASED_TIP="$(git -C "$HANDOFF_REPO" rev-parse HEAD)"
git -C "$HANDOFF_REPO" switch -q main
validate_handoff_range "$HANDOFF_REPO" "$HANDOFF_BASE" "$UNRELATED_BASE..$REBASED_TIP" HEAD
integrate_handoff_range "$HANDOFF_REPO" "$HANDOFF_BASE" "$UNRELATED_BASE..$REBASED_TIP" HEAD
[[ -f "$HANDOFF_REPO/rebased.txt" ]]
preflight_worktree "$HANDOFF_REPO"

# Issue #7 regression: a correction advertised without its rejected add commit
# depends on an ancestor absent from integration and is rejected before mutation.
git -C "$HANDOFF_REPO" switch -qc worker-dependent "$HANDOFF_BASE"
printf 'bad\n' >"$HANDOFF_REPO/dependent.txt"
git -C "$HANDOFF_REPO" add dependent.txt
git -C "$HANDOFF_REPO" commit -qm rejected-add
REJECTED_ADD="$(git -C "$HANDOFF_REPO" rev-parse HEAD)"
printf 'corrected\n' >"$HANDOFF_REPO/dependent.txt"
git -C "$HANDOFF_REPO" commit -qam correction
DEPENDENT_TIP="$(git -C "$HANDOFF_REPO" rev-parse HEAD)"
git -C "$HANDOFF_REPO" switch -q main
MAIN_BEFORE="$(git -C "$HANDOFF_REPO" rev-parse HEAD)"
if validate_handoff_range "$HANDOFF_REPO" "$HANDOFF_BASE" "$REJECTED_ADD..$DEPENDENT_TIP" HEAD 2>/dev/null; then exit 1; fi
[[ "$(git -C "$HANDOFF_REPO" rev-parse HEAD)" == "$MAIN_BEFORE" ]]
preflight_worktree "$HANDOFF_REPO"

# If the real cherry-pick fails after disposable validation, cleanup is allowed
# because the helper proved the initial state clean and started the operation.
git -C "$HANDOFF_REPO" switch -qc worker-hook-failure
printf 'hook range\n' >"$HANDOFF_REPO/hook.txt"
git -C "$HANDOFF_REPO" add hook.txt
git -C "$HANDOFF_REPO" commit -qm hook-range
HOOK_TIP="$(git -C "$HANDOFF_REPO" rev-parse HEAD)"
HOOK_BASE="$(git -C "$HANDOFF_REPO" rev-parse HEAD^)"
git -C "$HANDOFF_REPO" switch -q main
git -C "$HANDOFF_REPO" config user.name ''
git -C "$HANDOFF_REPO" config user.email ''
HOOK_HEAD_BEFORE="$(git -C "$HANDOFF_REPO" rev-parse HEAD)"
if integrate_handoff_range "$HANDOFF_REPO" "$HOOK_BASE" "$HOOK_BASE..$HOOK_TIP" HEAD 2>/dev/null; then exit 1; fi
[[ "$(git -C "$HANDOFF_REPO" rev-parse HEAD)" == "$HOOK_HEAD_BEFORE" ]]
preflight_worktree "$HANDOFF_REPO"
git -C "$HANDOFF_REPO" config user.name 'Test User'
git -C "$HANDOFF_REPO" config user.email test@example.com

printf 'agent-orchestrator state tests passed\n'
