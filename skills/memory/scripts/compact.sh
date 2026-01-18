#!/bin/bash
# Context Compaction Script
# Summarizes conversation history and extracts key decisions for archival

# This script outputs instructions for Claude to perform context compaction
# It's called when context is getting full or before large operations

cat << 'EOF'
<context-compact>
## Context Compaction Request

Your context is getting full. Please perform the following compaction:

### 1. Summarize Current Work
Create a brief summary (2-3 sentences) of what you've been working on.

### 2. Extract Key Decisions
Identify any decisions made during this session that should be remembered:
- Architecture choices
- Technology selections
- Bug fixes and their solutions
- User preferences discovered

### 3. Store to Memory
For each key decision, call memory_store:
```
memory_store({
  content: "[decision description with reasoning]",
  type: "decision",
  confidence: 0.9,
  citation: "[relevant file:line if applicable]"
})
```

### 4. Store Errors & Solutions
For any errors encountered and solved:
```
memory_store({
  content: "[error description] -> [solution]",
  type: "error",
  confidence: 1.0,
  citation: "[file where error occurred]"
})
```

### 5. Update Core Memory (if needed)
If project context has changed significantly, update the project block:
```
// This would be done via a future core_memory_update tool
```

### 6. Report Summary
After storing memories, report what was preserved.
</context-compact>
EOF
