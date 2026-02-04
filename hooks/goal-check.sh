#!/bin/bash
# Goal Check Hook
# Reminds Claude to check for goal drift after significant work

# This hook is triggered after major tool calls
# It encourages Claude to periodically check if work is aligned with goals

cat << EOF
<goal-check-reminder>
Consider checking for goal drift if this task involved significant changes.
Use goal_anchor({ action: 'check' }) to verify alignment with session goals.

Trigger conditions for goal check:
- After completing a significant code change
- After 10+ minutes of focused work
- When switching between different tasks
- Before making architectural decisions
</goal-check-reminder>
EOF
