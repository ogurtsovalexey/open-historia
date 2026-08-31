#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_SCRIPT="$SCRIPT_DIR/agent-worker.sh"
TEST_STATE_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_STATE_DIR"' EXIT
export OPEN_HISTORIA_ORCHESTRATOR_CONFIG_DIR="$TEST_STATE_DIR/config"
mkdir -p "$OPEN_HISTORIA_ORCHESTRATOR_CONFIG_DIR"

printf '%s\n' 'test prompt' >"$TEST_STATE_DIR/942.prompt"
printf '%s\n' \
  '{"type":"step_finish","part":{"tokens":{"total":120}}}' \
  '{"type":"step_finish","part":{"tokens":{"total":80}}}' >"$TEST_STATE_DIR/942.jsonl"
printf '%s\n' '0' >"$TEST_STATE_DIR/942.exit"
printf '%s\n' \
  'MODEL=openrouter/deepseek/deepseek-v4-pro-0813' \
  'WORKTREE=/tmp/test-worker' \
  'PHASE=planning' \
  'TOKEN_BUDGET=400000' \
  'TOKEN_BASE=0' >"$TEST_STATE_DIR/942.meta"
printf '%s\n' 'planning' >"$TEST_STATE_DIR/942.attempts"

status_output="$(OPEN_HISTORIA_ORCHESTRATOR_WORKER_STATE_DIR="$TEST_STATE_DIR" bash "$WORKER_SCRIPT" status)"
grep -q $'^#942\texited(0)\topenrouter/deepseek/deepseek-v4-pro-0813\t.*\tplanning\t200/400000 tokens$' <<<"$status_output"
usage_output="$(OPEN_HISTORIA_ORCHESTRATOR_WORKER_STATE_DIR="$TEST_STATE_DIR" bash "$WORKER_SCRIPT" usage 942)"
grep -q '^TOTAL_TOKENS=200$' <<<"$usage_output"

archive_output="$(OPEN_HISTORIA_ORCHESTRATOR_WORKER_STATE_DIR="$TEST_STATE_DIR" bash "$WORKER_SCRIPT" archive 942)"
grep -q 'Archived worker #942' <<<"$archive_output"
[[ ! -e "$TEST_STATE_DIR/942.prompt" ]]
[[ ! -e "$TEST_STATE_DIR/942.jsonl" ]]
archive_dir="$(find "$TEST_STATE_DIR/archive" -mindepth 1 -maxdepth 1 -type d -name '942-*' -print -quit)"
[[ -n "$archive_dir" ]]
[[ -f "$archive_dir/942.prompt" ]]
[[ -f "$archive_dir/942.jsonl" ]]
[[ -f "$archive_dir/942.attempts" ]]

status_output="$(OPEN_HISTORIA_ORCHESTRATOR_WORKER_STATE_DIR="$TEST_STATE_DIR" bash "$WORKER_SCRIPT" status)"
[[ "$status_output" == 'No registered workers.' ]]

if OPEN_HISTORIA_ORCHESTRATOR_WORKER_STATE_DIR="$TEST_STATE_DIR" bash "$WORKER_SCRIPT" archive '../942' >/dev/null 2>&1; then
  echo 'Invalid archive target was accepted.' >&2
  exit 1
fi

# V3.2 and duplicate phase attempts are rejected before any process starts.
mkdir -p "$TEST_STATE_DIR/worktree"
printf '%s\n' 'task' >"$TEST_STATE_DIR/task.prompt"
if OPEN_HISTORIA_ORCHESTRATOR_WORKER_STATE_DIR="$TEST_STATE_DIR" bash "$WORKER_SCRIPT" \
  start 942 openrouter/deepseek/deepseek-v4-pro-0813 "$TEST_STATE_DIR/worktree" "$TEST_STATE_DIR/task.prompt" '' planning >/dev/null 2>&1; then
  echo 'Archived planning attempt was accepted again.' >&2
  exit 1
fi
if OPEN_HISTORIA_ORCHESTRATOR_WORKER_STATE_DIR="$TEST_STATE_DIR" bash "$WORKER_SCRIPT" \
  start 943 openrouter/deepseek/deepseek-v3.2 "$TEST_STATE_DIR/worktree" "$TEST_STATE_DIR/task.prompt" >/dev/null 2>&1; then
  echo 'DeepSeek V3.2 was accepted.' >&2
  exit 1
fi
printf '%s\n' 'planning' >"$TEST_STATE_DIR/944.attempts"
if OPEN_HISTORIA_ORCHESTRATOR_WORKER_STATE_DIR="$TEST_STATE_DIR" bash "$WORKER_SCRIPT" \
  start 944 openrouter/deepseek/deepseek-v4-pro-0813 "$TEST_STATE_DIR/worktree" "$TEST_STATE_DIR/task.prompt" '' planning >/dev/null 2>&1; then
  echo 'Duplicate planning attempt was accepted.' >&2
  exit 1
fi

# The runner stops an in-flight worker after the emitted request-token budget.
MOCK_BIN="$TEST_STATE_DIR/mock-bin"
mkdir -p "$MOCK_BIN"
cat >"$MOCK_BIN/screen" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "-ls" ]]; then exit 1; fi
if [[ "${1:-}" == "-dmS" ]]; then shift 2; "$@"; exit $?; fi
exit 1
EOF
cat >"$MOCK_BIN/opencode" <<'EOF'
#!/usr/bin/env bash
trap 'exit 143' TERM
printf '%s\n' '{"type":"step_finish","part":{"tokens":{"total":100}}}'
while :; do sleep 1; done
EOF
chmod +x "$MOCK_BIN/screen" "$MOCK_BIN/opencode"
set +e
PATH="$MOCK_BIN:$PATH" OPEN_HISTORIA_ORCHESTRATOR_WORKER_STATE_DIR="$TEST_STATE_DIR" \
  bash "$WORKER_SCRIPT" start 945 openrouter/deepseek/deepseek-v4-pro-0813 \
  "$TEST_STATE_DIR/worktree" "$TEST_STATE_DIR/task.prompt" '' planning 50 >/dev/null
budget_rc=$?
set -e
[[ "$budget_rc" == '125' ]]
[[ "$(cat "$TEST_STATE_DIR/945.exit")" == '125' ]]
grep -Fq 'used_tokens=100' "$TEST_STATE_DIR/945.budget"
grep -Fq 'budget_tokens=50' "$TEST_STATE_DIR/945.budget"

# Direct worker launches obey the same persistent kill switch, while read-only
# status remains available.
printf 'disabled_at=test\n' >"$OPEN_HISTORIA_ORCHESTRATOR_CONFIG_DIR/disabled"
if OPEN_HISTORIA_ORCHESTRATOR_WORKER_STATE_DIR="$TEST_STATE_DIR" bash "$WORKER_SCRIPT" \
  start 946 openrouter/deepseek/deepseek-v4-pro-0813 \
  "$TEST_STATE_DIR/worktree" "$TEST_STATE_DIR/task.prompt" '' planning 50 >/dev/null 2>&1; then
  echo 'Disabled worker launch unexpectedly succeeded.' >&2
  exit 1
fi
[[ ! -e "$TEST_STATE_DIR/946.meta" ]]
status_output="$(OPEN_HISTORIA_ORCHESTRATOR_WORKER_STATE_DIR="$TEST_STATE_DIR" bash "$WORKER_SCRIPT" status)"
[[ -n "$status_output" ]]

printf '%s\n' 'agent-worker archive tests passed'
