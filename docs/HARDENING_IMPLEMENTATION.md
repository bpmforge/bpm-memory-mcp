# Claude-Memory v2 Hardening Implementation

## Overview

This document describes the security hardening and data integrity improvements implemented in claude-memory v2. These changes align runtime behavior with documented security controls and enable staleness detection.

## Implementation Date
2026-01-18

## Changes Summary

| Task | Category | Status |
|------|----------|--------|
| Credential Filtering | P0: Security | Implemented |
| Path Traversal Validation | P0: Security | Implemented |
| Storage Quotas | P0: Security | Implemented |
| Supersession Transaction | P0: Data Integrity | Implemented |
| sourceHash Persistence | P1: Staleness | Implemented |
| Staleness in session_restore | P1: Staleness | Implemented |
| Language in memory_update | P2: Quality | Implemented |

---

## P0: Security & Data Integrity

### 1. Credential Filtering (SC-001)

**Location:** `mcp/memory-server/src/security/credentials.ts`

Prevents storage of secrets and credentials in memory entries.

#### Detected Patterns

| Category | Examples |
|----------|----------|
| Key-Value Secrets | `password="secret"`, `api_key='abc123'`, `token=xyz` |
| Bearer Tokens | `Bearer eyJhbGciOiJIUzI1...` |
| Private Keys | `-----BEGIN RSA PRIVATE KEY-----` |
| AWS Credentials | `aws_secret_access_key`, `aws_access_key_id` |
| Database URLs | `mongodb://user:pass@host`, `postgres://...` |
| Platform Tokens | `ghp_xxx` (GitHub), `glpat-xxx` (GitLab) |
| High-Entropy Strings | 40+ character alphanumeric strings in quotes |

#### API

```typescript
import { containsCredentials } from './security/credentials.js';

if (containsCredentials(content)) {
  // Reject the memory
}
```

#### Error Response

```json
{
  "content": [{ "type": "text", "text": "Error: Content appears to contain credentials or secrets. Memory not stored." }],
  "isError": true
}
```

---

### 2. Path Traversal Validation (SC-002)

**Location:** `mcp/memory-server/src/security/paths.ts`

Prevents directory traversal attacks in citation paths.

#### API

```typescript
import { isPathSafe } from './security/paths.js';

// Returns true if path is within projectRoot
isPathSafe('src/index.ts', '/project/root');        // true
isPathSafe('../../../etc/passwd', '/project/root'); // false
isPathSafe('/absolute/path', '/project/root');      // false (unless under root)
```

#### Validation Logic

1. Resolves the file path relative to project root
2. Normalizes both paths to handle `..` and `.` segments
3. Verifies resolved path starts with project root
4. Handles edge cases (trailing slashes, partial matches)

#### Error Response

```json
{
  "content": [{ "type": "text", "text": "Error: Citation path is outside project root." }],
  "isError": true
}
```

---

### 3. Storage Quotas

**Location:** `mcp/memory-server/src/index.ts`

Enforces per-project memory limits to prevent unbounded growth.

#### Configuration

```typescript
const MAX_MEMORIES_PER_PROJECT = 10000;
```

#### Implementation

```typescript
if (memoryRepository.getMemoryCount(projectId) >= MAX_MEMORIES_PER_PROJECT) {
  return {
    content: [{ type: 'text', text: `Error: Storage limit reached (${MAX_MEMORIES_PER_PROJECT} memories).` }],
    isError: true,
  };
}
```

#### New Repository Method

```typescript
// In MemoryRepository
getMemoryCount(projectId: string): number {
  const row = this.db.instance
    .prepare('SELECT COUNT(*) as count FROM memories WHERE project_id = ? AND deleted_at IS NULL')
    .get(projectId);
  return row.count;
}
```

---

### 4. Supersession Transaction Integrity

**Location:** `mcp/memory-server/src/storage/repository.ts`

Wraps UPDATE + INSERT operations in a transaction to ensure atomicity.

#### Before (Risk: Partial Updates)

```typescript
// UPDATE could succeed, INSERT could fail
// Leaving old memory marked as superseded with no replacement
this.db.instance.prepare('UPDATE ...').run(...);
this.db.instance.prepare('INSERT ...').run(...);
```

#### After (Atomic)

```typescript
return this.db.transaction(() => {
  // Both succeed or both fail
  if (input.supersedesId) {
    this.db.instance.prepare('UPDATE ...').run(...);
  }
  this.db.instance.prepare('INSERT ...').run(...);
  return memory;
});
```

---

## P1: Staleness Workflow

### 5. sourceHash Persistence

**Location:** `mcp/memory-server/src/language/context.ts`

Computes and stores SHA-256 hash of source files for change detection.

#### New Function

```typescript
export function enrichWithSourceHash(context: CodeContext, projectRoot: string): CodeContext {
  if (!context.filePath) return context;

  const fullPath = resolve(projectRoot, context.filePath);
  if (!existsSync(fullPath)) return context;

  try {
    const content = readFileSync(fullPath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');
    return { ...context, sourceHash: hash };
  } catch {
    return context;
  }
}
```

#### Integration

- Called during `createMemory()` when `projectRoot` is provided
- Hash stored in `code_context` JSON field
- Used by `StalenessDetector.detectContentChanged()` to identify modified files

---

### 6. Staleness Detection in session_restore

**Location:** `mcp/memory-server/src/index.ts`

Returns staleness report when restoring sessions.

#### Response Format

```json
{
  "sessionId": "uuid",
  "summary": "Previous session summary",
  "createdAt": "2026-01-18T...",
  "coreMemory": { ... },
  "stalenessReport": {
    "accessStale": 5,      // Not accessed in 10+ sessions
    "sourceMissing": 2,    // Citation files deleted
    "lowConfidence": 3,    // Confidence < 0.5
    "contentChanged": 1    // sourceHash mismatch
  },
  "message": "Session restored successfully"
}
```

#### Detection Methods

| Metric | Description | Threshold |
|--------|-------------|-----------|
| accessStale | Memories not accessed recently | 10 sessions |
| sourceMissing | Citation files that no longer exist | File not found |
| lowConfidence | Memories with degraded confidence | < 0.5 |
| contentChanged | Source file hash differs from stored | Hash mismatch |

---

## P2: Product Quality

### 7. Language Honor in memory_update

**Location:** `mcp/memory-server/src/storage/repository.ts`

Allows updating the language when superseding a memory.

#### Updated Signature

```typescript
createSupersedingMemory(
  oldId: string,
  projectId: string,
  newContent: string,
  embedding: Float32Array | null = null,
  language?: string,      // NEW: Override language
  projectRoot?: string    // NEW: For sourceHash
): Memory
```

#### Behavior

- If `language` is provided, uses the new language
- If `language` is undefined, preserves the original memory's language
- `projectRoot` enables sourceHash computation for the new version

#### Response Update

```json
{
  "id": "new-uuid",
  "version": 2,
  "supersedesId": "old-uuid",
  "language": "python",
  "message": "Memory updated to version 2"
}
```

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `src/security/credentials.ts` | Credential detection patterns and helper |
| `src/security/paths.ts` | Path traversal validation |
| `src/security/index.ts` | Security module exports |

### Modified Files

| File | Changes |
|------|---------|
| `src/index.ts` | Security checks, staleness wiring, quota enforcement |
| `src/storage/repository.ts` | Transaction wrapper, getMemoryCount, language param |
| `src/language/context.ts` | enrichWithSourceHash function |
| `src/language/index.ts` | Export enrichWithSourceHash |

### Test Updates

| File | Change |
|------|--------|
| `tests/unit/v2-features.test.ts` | Added transaction to mock DB |
| `tests/integration/v2-tools.test.ts` | Added transaction to mock DB |
| `tests/integration/mcp-tools.test.ts` | Added transaction to mock DB |
| `tests/unit/repository.test.ts` | Added transaction to mock DB |

---

## Verification

### Unit Tests
All 209 tests pass (180 unit/integration + 29 E2E hardening tests).

### TypeScript Build
Compiles without errors.

### E2E Tests
See `E2E_TEST_REPORT.md` for manual verification results.
