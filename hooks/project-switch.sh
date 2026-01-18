#!/bin/bash
# Project Switch Hook
# Handles automatic database switching when changing projects

OLD_PROJECT="${1:-}"
NEW_PROJECT="${CLAUDE_PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

# Check if project actually changed
if [ -n "$OLD_PROJECT" ] && [ "$OLD_PROJECT" != "$NEW_PROJECT" ]; then
  cat << EOF
<project-switch>
Project directory changed from $OLD_PROJECT to $NEW_PROJECT.

Actions to take:
1. Save current session with session_save (for the old project)
2. The MCP server will automatically switch to the new project's database
3. Restore the new project's session with session_restore

The new project has its own isolated memory store.
</project-switch>
EOF
fi
