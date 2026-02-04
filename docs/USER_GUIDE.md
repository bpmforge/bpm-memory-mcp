# Claude Memory User Guide

> Practical guide to using the intelligent memory system with automatic and semi-automatic features.

---

## Quick Start

### 1. Session Start
When you start Claude Code, the memory system automatically loads. Run:
```
session_restore()
```

**You'll get:**
- Previous session summary
- Active goals and drift indicator
- Graph stats (total memories, links, contradictions)
- Incomplete checkpoints to resume
- Staleness warnings

### 2. Set Your Goals
At the start of any significant work, anchor your goals:
```
goal_anchor({ action: "set", content: "Implement user authentication", priority: 1 })
goal_anchor({ action: "set", content: "Write tests for auth module", priority: 2 })
```

### 3. Work Normally
As you work, the system helps automatically:
- **Auto-linking**: When memories are stored, related memories are automatically linked
- **Contradiction warnings**: Alerts if new info conflicts with existing memories
- **Hook reminders**: Prompts to store decisions, check goals after significant changes

### 4. End Session
Before ending:
```
session_save({ summary: "Completed auth implementation, tests passing" })
```

---

## Automatic Features (No Action Needed)

### Auto-Linking on Store
When you store a memory, the system automatically:
1. Finds similar memories (>75% similarity)
2. Creates `relates_to` links
3. Suggests additional links (60-75% similarity)

**Example response:**
```json
{
  "id": "new-memory-id",
  "autoLinks": {
    "created": 2,
    "links": [
      { "targetId": "uuid-1", "linkType": "relates_to", "strength": 0.85 }
    ],
    "suggestions": [
      { "targetId": "uuid-2", "similarity": 0.68, "reason": "Shared topics: auth, jwt" }
    ]
  }
}
```

### Contradiction Detection
When storing memories, you'll be warned if content conflicts:
```json
{
  "contradictionWarning": {
    "count": 1,
    "memories": [
      { "id": "uuid", "similarity": 0.92, "reason": "Negation pattern detected" }
    ]
  }
}
```

**Action:** Review the conflict, then either:
- Update the old memory: `memory_update({ id: "old-uuid", content: "corrected info" })`
- Create explicit contradiction link: `memory_link({ action: "create", sourceId: "new", targetId: "old", linkType: "contradicts" })`

### Proactive Context on Restore
`session_restore()` automatically includes:
```json
{
  "proactiveContext": {
    "graphStats": { "totalMemories": 150, "linkedMemories": 120, "contradictionCount": 3 },
    "recentContradictions": [...],
    "incompleteCheckpoints": [{ "taskId": "auth-impl", "pendingSteps": 2 }]
  }
}
```

### Confidence Decay
Old memories automatically have reduced effective confidence during search:
- **Facts**: Decay slowest (360-day half-life)
- **Patterns**: Slow decay (270 days)
- **Decisions**: Moderate (135 days)
- **Errors**: Fast decay (45 days)
- **Checkpoints**: Fastest (9 days)

---

## Semi-Automatic Features (Prompted by Hooks)

### Memory Extraction Prompts
After significant code changes (Write/Edit), you'll see:
```
<memory-extract-suggestion>
Consider using memory_store() if you:
- Made a significant decision (type: "decision")
- Solved an error or bug (type: "error")
- Discovered a pattern (type: "pattern")
</memory-extract-suggestion>
```

**Action:** Store the memory if relevant:
```
memory_store({
  content: "Used JWT with 24h expiry for auth tokens",
  type: "decision",
  confidence: 1.0,
  citation: "src/auth/config.ts:15"
})
```

### Goal Check Prompts
After code changes, you'll see:
```
<goal-check-reminder>
Consider checking for goal drift if this task involved significant changes.
</goal-check-reminder>
```

**Action:** Check your goals:
```
goal_anchor({ action: "check" })
```

**Response:**
```json
{
  "driftIndicator": 0.3,
  "isWarning": false,
  "activeGoals": [
    { "id": "uuid", "content": "Implement auth", "priority": 1 }
  ]
}
```

If `driftIndicator` > 0.7, you're drifting from your goals - refocus!

### Error Detection Prompts
After commands that produce errors:
```
<error-detected>
An error was detected. Consider storing this error and its resolution
to memory using memory_store with type="error".
</error-detected>
```

**Action:**
```
memory_store({
  content: "CORS error fixed by adding proxy config to vite.config.ts",
  type: "error",
  citation: "vite.config.ts:12"
})
```

---

## Manual Features (You Initiate)

### Storing Memories
```
memory_store({
  content: "Description of what to remember",
  type: "decision",     // fact, pattern, decision, error, preference
  confidence: 0.9,      // 0-1, higher = more certain
  citation: "file.ts:42"  // optional source reference
})
```

### Recalling Memories
```
memory_recall({
  query: "authentication token handling",
  type: "error",        // optional filter
  limit: 10,
  language: "typescript"  // optional filter
})
```

### Creating Manual Links
```
memory_link({
  action: "create",
  sourceId: "memory-1-uuid",
  targetId: "memory-2-uuid",
  linkType: "extends",  // relates_to, contradicts, supports, extends, derived_from
  strength: 0.9
})
```

### Graph Queries
```
// Get overall statistics
memory_link({ action: "get_stats" })

// Find all contradictions to review
memory_link({ action: "find_contradictions" })

// Trace how a decision evolved
memory_link({
  action: "find_chain",
  memoryId: "decision-uuid",
  linkTypes: ["extends", "derived_from"]
})

// Find related memories in a cluster
memory_link({ action: "find_cluster", memoryId: "uuid", depth: 2 })

// Find unlinked orphan memories
memory_link({ action: "find_orphans" })
```

### Task Checkpoints
```
// Save progress
checkpoint_task({
  action: "save",
  taskId: "feature-auth",
  phase: "implementation",
  completedSteps: ["JWT setup", "Login endpoint"],
  pendingSteps: ["Refresh tokens", "Logout"],
  artifacts: ["src/auth/jwt.ts"]
})

// Resume later
checkpoint_task({ action: "restore", taskId: "feature-auth" })

// List all checkpoints
checkpoint_task({ action: "list" })
```

---

## Workflow Examples

### Starting a New Feature
```
1. session_restore()                    # Load context
2. goal_anchor({ action: "set", content: "Implement feature X", priority: 1 })
3. memory_recall({ query: "feature X related decisions" })  # Check past context
4. [work on feature]
5. memory_store({ content: "Key decision made", type: "decision" })
6. checkpoint_task({ action: "save", taskId: "feature-x", ... })
7. session_save({ summary: "Progress on feature X" })
```

### Debugging a Problem
```
1. memory_recall({ query: "error similar problem", type: "error" })
2. [investigate and fix]
3. memory_store({
     content: "Error: X. Cause: Y. Fix: Z",
     type: "error",
     citation: "file.ts:line"
   })
```

### Reviewing Memory Health
```
1. memory_link({ action: "get_stats" })           # Overall health
2. memory_link({ action: "find_contradictions" }) # Conflicts to resolve
3. memory_link({ action: "find_orphans" })        # Memories to link
```

### Resuming Work After Break
```
1. session_restore()                              # Get context + proactive alerts
2. goal_anchor({ action: "list" })                # Review goals
3. checkpoint_task({ action: "list" })            # Find incomplete work
4. checkpoint_task({ action: "restore", taskId: "..." })  # Resume
```

---

## Best Practices

### What to Store
- **Decisions**: "We chose X because Y"
- **Errors**: "Problem X, caused by Y, fixed by Z"
- **Patterns**: "This codebase uses pattern X for Y"
- **Facts**: "Main entry point is src/index.ts"
- **Preferences**: "User prefers explicit types"

### What NOT to Store
- Temporary debugging notes
- Obvious code comments
- Entire file contents (store summaries)
- Sensitive data (credentials, secrets)

### Confidence Guidelines
- **1.0**: Verified fact, explicit user statement
- **0.8-0.9**: High confidence inference
- **0.5-0.7**: Reasonable assumption
- **<0.5**: Uncertain, needs verification

### Link Type Guidelines
| Type | Use When |
|------|----------|
| `relates_to` | General connection |
| `contradicts` | Conflicting information |
| `supports` | Reinforcing evidence |
| `extends` | Builds on previous |
| `derived_from` | Concluded from |

---

## Troubleshooting

### "No embeddings" in store response
- Check LM Studio is running: `curl http://localhost:1234/v1/models`
- Memories still work but vector search won't find them

### Goal drift warning keeps triggering
- Your work may have diverged from stated goals
- Either refocus on goals OR update goals to match current work:
  ```
  goal_anchor({ action: "complete", goalId: "old-goal" })
  goal_anchor({ action: "set", content: "New direction", priority: 1 })
  ```

### Too many contradictions
- Review with `memory_link({ action: "find_contradictions" })`
- Resolve by updating outdated memories or creating explicit contradiction links

### Search not finding relevant memories
- Try broader query terms
- Check if memories have embeddings
- Use `memory_link({ action: "find_cluster" })` to explore connections
