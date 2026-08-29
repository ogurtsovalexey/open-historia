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
  printf '[]\n'
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

printf 'agent-orchestrator state tests passed\n'
