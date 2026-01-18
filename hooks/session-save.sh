#!/bin/bash
# Session Save Hook
# Automatically saves session state when a conversation ends

# Get project root
PROJECT_ROOT="${CLAUDE_PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

# Output instruction for Claude to save session
cat << EOF
<session-save>
Call the session_save MCP tool to persist the current session state.
Include a brief summary of:
- What was accomplished in this session
- Key decisions made
- Any important context for the next session
</session-save>
EOF
