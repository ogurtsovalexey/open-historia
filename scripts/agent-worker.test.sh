#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_SCRIPT="$SCRIPT_DIR/agent-worker.sh"
TEST_STATE_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_STATE_DIR"' EXIT

printf '%s\n' 'test prompt' >"$TEST_STATE_DIR/42.prompt"
printf '%s\n' 'test log' >"$TEST_STATE_DIR/42.jsonl"
printf '%s\n' '0' >"$TEST_STATE_DIR/42.exit"
printf '%s\n' 'MODEL=openrouter/deepseek/deepseek-v3.2' >"$TEST_STATE_DIR/42.meta"

status_output="$(OPEN_HISTORIA_ORCHESTRATOR_WORKER_STATE_DIR="$TEST_STATE_DIR" bash "$WORKER_SCRIPT" status)"
grep -q $'^#42\texited(0)\topenrouter/deepseek/deepseek-v3.2\t' <<<"$status_output"

archive_output="$(OPEN_HISTORIA_ORCHESTRATOR_WORKER_STATE_DIR="$TEST_STATE_DIR" bash "$WORKER_SCRIPT" archive 42)"
grep -q 'Archived worker #42' <<<"$archive_output"
[[ ! -e "$TEST_STATE_DIR/42.prompt" ]]
[[ ! -e "$TEST_STATE_DIR/42.jsonl" ]]
archive_dir="$(find "$TEST_STATE_DIR/archive" -mindepth 1 -maxdepth 1 -type d -name '42-*' -print -quit)"
[[ -n "$archive_dir" ]]
[[ -f "$archive_dir/42.prompt" ]]
[[ -f "$archive_dir/42.jsonl" ]]

status_output="$(OPEN_HISTORIA_ORCHESTRATOR_WORKER_STATE_DIR="$TEST_STATE_DIR" bash "$WORKER_SCRIPT" status)"
[[ "$status_output" == 'No registered workers.' ]]

if OPEN_HISTORIA_ORCHESTRATOR_WORKER_STATE_DIR="$TEST_STATE_DIR" bash "$WORKER_SCRIPT" archive '../42' >/dev/null 2>&1; then
  echo 'Invalid archive target was accepted.' >&2
  exit 1
fi

printf '%s\n' 'agent-worker archive tests passed'
