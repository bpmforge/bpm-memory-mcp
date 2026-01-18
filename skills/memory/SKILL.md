# Memory Skill

Use persistent memory to maintain context across sessions.

## Quick Reference

**Store** when you encounter:
- Decisions ("We chose PostgreSQL because...")
- Patterns ("This codebase uses repository pattern")
- Errors ("Auth fails when token expired, fix: refresh first")
- Preferences ("User prefers TypeScript over JavaScript")

**Recall** before:
- Making architecture decisions
- Repeating past work
- Starting a new session

## Memory Types

| Type | Use For | Example |
|------|---------|---------|
| `fact` | Static truths about code | "Main entry is src/index.ts" |
| `pattern` | Recurring approaches | "Services use dependency injection" |
| `decision` | Choices with reasoning | "Chose SQLite for portability" |
| `error` | Problems and solutions | "CORS fails without proxy, fixed in vite.config" |
| `preference` | User preferences | "Prefers explicit types over inference" |

## Storing Memories

```
memory_store({
  content: "The auth module uses JWT with 24h expiry",
  type: "fact",
  confidence: 0.9,
  citation: "src/auth/config.ts:15"
})
```

**Guidelines:**
- Be specific, include file paths when relevant
- Higher confidence (0.8-1.0) for verified facts
- Lower confidence (0.5-0.7) for inferences
- Always cite source files when possible
- Language is auto-detected from citation file extension

## Recalling Memories

```
memory_recall({
  query: "authentication token handling",
  type: "error",
  limit: 5,
  language: "typescript"  // optional: filter by language
})
```

**Query Tips:**
- Use domain terms from the codebase
- Filter by type when looking for specific info
- Broader queries find more, narrow finds precise
- Combine with minConfidence for reliable results
- Filter by language when working in a specific file type

**Languages:** typescript, javascript, python, rust, go, java, c, cpp, ruby, php, shell, sql, markdown, json, yaml

## Providing Feedback

After recalling a memory, provide feedback to improve future results:

```
memory_feedback({
  id: "memory-uuid",
  feedback: "helpful"  // helpful, wrong, outdated, duplicate
})
```

**Feedback types:**
| Type | Effect | Use when |
|------|--------|----------|
| `helpful` | +5% confidence | Memory was useful |
| `wrong` | -20% confidence, flag | Memory contains errors |
| `outdated` | -30% confidence, flag | Information has changed |
| `duplicate` | No change, link | Duplicate of another memory |

**With correction:**
```
memory_feedback({
  id: "memory-uuid",
  feedback: "wrong",
  correction: "The correct approach is..."
})
```
This creates a new version superseding the old memory.

## Updating Memories

When information changes, update creates a new version:

```
memory_update({
  id: "memory-uuid",
  content: "New corrected content..."
})
```

- Old version is preserved (not deleted)
- New version has incremented version number
- Search returns only latest versions by default

## Session Flow

**Start of session:**
1. `session_restore` - loads previous context
2. Review returned memories and working state

**During work:**
- Store decisions as you make them
- Store errors when you solve them
- Store patterns when you recognize them

**End of session:**
1. `session_save({ summary: "..." })` - persists state

## Context Engineering

**When to compact:**
- Before large file reads
- When context feels full
- Before multi-step operations

**Budget awareness:**
- Memories add ~100-200 tokens each
- Recall 5-10 memories, not 50
- Store summaries, not full content

## Project Isolation

Memories are isolated by project (git root). When you switch projects:
- Previous project memories won't appear
- New project starts fresh or loads its history
- Cross-project knowledge requires explicit transfer

## Common Patterns

**Before refactoring:**
```
memory_recall({ query: "refactoring patterns architecture" })
```

**After solving a bug:**
```
memory_store({
  content: "TypeError in UserList: add null check for user.email",
  type: "error",
  citation: "src/components/UserList.tsx:42"
})
```

**Recording a decision:**
```
memory_store({
  content: "Using Zod for validation: type inference + runtime checks",
  type: "decision",
  confidence: 1.0
})
```
