#!/bin/bash
# Error Tracker Hook
# Detects errors in tool results and suggests storing them to memory

TOOL_RESULT="$1"

# Check for common error patterns
if echo "$TOOL_RESULT" | grep -qiE "(error|exception|failed|cannot|unable|denied|not found)"; then
  cat << EOF
<error-detected>
An error was detected in the tool result. Consider storing this error and its resolution
to memory using memory_store with type="error" for future reference.
</error-detected>
EOF
fi
