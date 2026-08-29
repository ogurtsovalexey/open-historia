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

BEFORE_PATH="$TEST_ROOT/sessions-before"
find "$(codex_sessions_dir)" -type f -name '*.jsonl' -print | sort >"$BEFORE_PATH"
NEW_SESSION_ID="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
NEW_SESSION_FILE="$SESSION_DIR/rollout-new-${NEW_SESSION_ID}.jsonl"
jq -cn --arg id "$NEW_SESSION_ID" '{type:"session_meta",payload:{id:$id,cwd:"/tmp/repo",source:"cli"}}' >"$NEW_SESSION_FILE"
jq -cn '{ordinal:1,type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:"ORCHESTRATOR_TICK_ID=tick-new"}],internal_chat_message_metadata_passthrough:{turn_id:"turn-new"}}}' >>"$NEW_SESSION_FILE"
[[ "$(detect_new_orchestrator_session "$BEFORE_PATH" "tick-new")" == "$NEW_SESSION_ID" ]]

printf 'agent-orchestrator state tests passed\n'
