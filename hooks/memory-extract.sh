#!/bin/bash
# Memory Extract Hook
# Suggests extracting memories from significant interactions

TOOL_NAME="${1:-}"
TOOL_RESULT="${2:-}"

# Check if this was a significant operation
is_significant=false

# Significant tool operations that often produce learnings
case "$TOOL_NAME" in
  "Write"|"Edit")
    # Code changes often involve decisions worth remembering
    is_significant=true
    ;;
  "Bash")
    # Check for error patterns that should be remembered
    if echo "$TOOL_RESULT" | grep -qiE "(error|failed|fixed|solution|resolved)"; then
      is_significant=true
    fi
    ;;
esac

if [ "$is_significant" = true ]; then
  cat << EOF
<memory-extract-suggestion>
This interaction may contain valuable information to remember:

Consider using memory_store() if you:
- Made a significant decision (type: "decision")
- Discovered a pattern or approach (type: "pattern")
- Solved an error or bug (type: "error")
- Learned a user preference (type: "preference")
- Documented a fact about the codebase (type: "fact")

Memory will be auto-linked to related memories (V4 feature).
</memory-extract-suggestion>
EOF
fi
