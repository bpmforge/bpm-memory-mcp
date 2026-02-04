#!/bin/bash
# Context Assembly Hook (V9)
# Prompts Claude to assemble memory context before significant tasks

# This hook should be triggered at conversation start or before major operations
# It reminds Claude to gather relevant context from memory

cat << 'EOF'
<memory-context-reminder>
Before starting significant work, consider assembling memory context:

  memory_context_assemble({
    task: "description of what you're about to do",
    files: ["path/to/relevant/files"],  // optional
    includeGlobal: true,
    maxMemories: 10
  })

This retrieves:
- Past decisions relevant to this task
- Patterns and approaches that worked before
- Errors to avoid
- User preferences and conventions
- Potential contradictions to resolve

Use this to avoid repeating mistakes and maintain consistency.
</memory-context-reminder>
EOF
