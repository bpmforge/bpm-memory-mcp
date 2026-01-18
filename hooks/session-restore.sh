#!/bin/bash
# Session Restore Hook
# Automatically restores the previous session state when a conversation starts

# Get project root (prefer CLAUDE_PROJECT_ROOT, fallback to git root or cwd)
PROJECT_ROOT="${CLAUDE_PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

# Output instruction for Claude to restore session
cat << EOF
<session-restore>
Call the session_restore MCP tool to load the previous session state.
This will restore:
- Core memory (persona, goals, project context)
- Conversation summary from last session
- Working memory state
</session-restore>
EOF
