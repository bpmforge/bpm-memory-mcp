#!/bin/bash
# Memory Extract Hook (V9)
# Provides intelligent prompts for memory extraction after significant operations

TOOL_NAME="${1:-}"
TOOL_RESULT="${2:-}"

# Analyze result for extraction opportunities
analyze_result() {
  local result="$1"
  local opportunities=""

  # Check for error patterns that were fixed
  if echo "$result" | grep -qiE "(error|failed).*(fixed|resolved|solved)"; then
    opportunities="${opportunities}ERROR_FIX "
  fi

  # Check for decision language
  if echo "$result" | grep -qiE "(decided|chose|using|approach|instead of|because)"; then
    opportunities="${opportunities}DECISION "
  fi

  # Check for pattern discovery
  if echo "$result" | grep -qiE "(pattern|always|best practice|technique|learned)"; then
    opportunities="${opportunities}PATTERN "
  fi

  # Check for preference expressions
  if echo "$result" | grep -qiE "(prefer|style|convention|standard|never|always use)"; then
    opportunities="${opportunities}PREFERENCE "
  fi

  echo "$opportunities"
}

# Check if this was a significant operation
case "$TOOL_NAME" in
  "Write"|"Edit")
    opportunities=$(analyze_result "$TOOL_RESULT")
    if [ -n "$opportunities" ]; then
      cat << EOF
<memory-extract-opportunity>
Detected potential memories in code changes: ${opportunities}

You can use memory_auto_extract() to analyze and store automatically:
  memory_auto_extract({
    content: "<your response text>",
    source: "code_change",
    autoStore: true
  })

Or call memory_store() manually for specific learnings.
</memory-extract-opportunity>
EOF
    fi
    ;;

  "Bash")
    # Check for error patterns that should be remembered
    if echo "$TOOL_RESULT" | grep -qiE "(error|failed|exception)"; then
      if echo "$TOOL_RESULT" | grep -qiE "(fixed|resolved|solved|solution|workaround)"; then
        cat << EOF
<memory-extract-opportunity>
Detected ERROR + FIX pattern in command output.

Consider storing this error resolution:
  memory_auto_extract({
    content: "<error description and fix>",
    source: "error",
    autoStore: true
  })
</memory-extract-opportunity>
EOF
      fi
    fi
    ;;
esac
