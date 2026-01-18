# Security Controls: claude-memory

## Overview

This document defines security controls that mitigate threats identified in THREAT_MODEL.md. Controls follow a defense-in-depth approach with multiple layers:

1. **Input Validation**: Sanitize all untrusted input
2. **Data Protection**: Filter sensitive content, enforce isolation
3. **Integrity**: Database safety, script verification
4. **Monitoring**: Logging and provenance tracking

## Control Matrix

| Control ID | Category | Description | Threats Mitigated | NFR |
|------------|----------|-------------|-------------------|-----|
| SC-001 | Data Protection | Credential pattern filtering | T-001, T-009 | NFR-030 |
| SC-002 | Input Validation | Parameterized SQL queries | T-002 | NFR-032 |
| SC-003 | Input Validation | Path traversal prevention | T-003 | NFR-032 |
| SC-004 | Data Protection | Project isolation enforcement | T-004 | NFR-053 |
| SC-005 | Integrity | Skill script integrity | T-005 | NFR-032 |
| SC-006 | Integrity | Embedding server validation | T-006 | NFR-011 |
| SC-007 | Integrity | WAL mode and backup | T-007 | NFR-010 |
| SC-008 | Monitoring | Memory provenance tracking | T-008 | NFR-032 |
| SC-009 | Data Protection | Sensitive content scanning | T-009 | NFR-030 |
| SC-010 | Input Validation | Hook command sanitization | T-010 | NFR-032 |
| SC-011 | Resource Control | Storage limits | T-011 | NFR-005 |
| SC-012 | Monitoring | Staleness detection | T-012 | NFR-051 |

---

## Control Details

### SC-001: Credential Pattern Filtering

**Category**: Data Protection
**Threats Mitigated**: T-001, T-009
**Requirements**: NFR-030

**Implementation**:
- Scan all content before storage
- Block content matching credential patterns
- Return clear error message
- Log blocked attempt (without sensitive content)

**Patterns to Detect**:
```typescript
const CREDENTIAL_PATTERNS = [
  // AWS
  /AKIA[0-9A-Z]{16}/,
  /aws_secret_access_key\s*=\s*[A-Za-z0-9/+=]{40}/i,

  // OpenAI
  /sk-[A-Za-z0-9]{48}/,

  // Generic API keys
  /api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9_-]{20,}['"]?/i,

  // Private keys
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
  /-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----/,

  // Passwords
  /password\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/i,

  // Tokens (bearer, JWT)
  /bearer\s+[A-Za-z0-9._-]+/i,
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,

  // Environment variable assignments with secrets
  /\b(SECRET|TOKEN|PASSWORD|APIKEY|API_KEY)\s*=\s*[^\s]+/i,
];

function containsCredentials(content: string): boolean {
  return CREDENTIAL_PATTERNS.some(pattern => pattern.test(content));
}
```

**Code Example**:
```typescript
export async function storeMemory(params: StoreParams): Promise<StoreResult> {
  // SC-001: Credential filtering
  if (containsCredentials(params.content)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Cannot store content that appears to contain credentials. ' +
      'Please remove sensitive data before storing.'
    );
  }

  // Continue with storage...
}
```

**Traces To**: FR-010, NFR-030

---

### SC-002: Parameterized SQL Queries

**Category**: Input Validation
**Threats Mitigated**: T-002
**Requirements**: NFR-032

**Implementation**:
- All SQL queries use parameterized statements
- No string concatenation in queries
- Use better-sqlite3 prepared statements

**Code Example**:
```typescript
// CORRECT: Parameterized query
const stmt = db.prepare(`
  SELECT * FROM memories
  WHERE project_id = ? AND type = ? AND deleted_at IS NULL
`);
const results = stmt.all(projectId, memoryType);

// NEVER: String concatenation
// const results = db.exec(`SELECT * FROM memories WHERE type = '${type}'`);
```

**Validation**:
- ESLint rule to detect string template SQL
- Code review checklist item
- Integration tests with injection payloads

---

### SC-003: Path Traversal Prevention

**Category**: Input Validation
**Threats Mitigated**: T-003
**Requirements**: NFR-032

**Implementation**:
- Validate all file paths in citations
- Resolve to absolute path and check within project
- Reject paths containing `..` or absolute paths outside project

**Code Example**:
```typescript
import { resolve, normalize, relative } from 'path';

function validateCitation(citation: string, projectRoot: string): boolean {
  // Extract file path from citation format "path:line"
  const filePath = citation.split(':')[0];

  // Normalize and resolve
  const absolutePath = resolve(projectRoot, filePath);
  const normalizedPath = normalize(absolutePath);

  // Check path is within project
  const relativePath = relative(projectRoot, normalizedPath);

  // Reject if path escapes project root
  if (relativePath.startsWith('..') || resolve(relativePath) === relativePath) {
    return false;
  }

  return true;
}
```

---

### SC-004: Project Isolation Enforcement

**Category**: Data Protection
**Threats Mitigated**: T-004
**Requirements**: NFR-053

**Implementation**:
- Separate SQLite database per project
- Project ID derived from git root hash
- Validate project ID on every database operation
- Log cross-project access attempts

**Code Example**:
```typescript
import { createHash } from 'crypto';
import { execSync } from 'child_process';

function getProjectId(workingDir: string): string {
  try {
    // Get git root
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      cwd: workingDir,
      encoding: 'utf-8'
    }).trim();

    // Hash for consistent, safe filename
    return createHash('sha256')
      .update(gitRoot)
      .digest('hex')
      .substring(0, 16);
  } catch {
    // Fallback to working directory
    return createHash('sha256')
      .update(workingDir)
      .digest('hex')
      .substring(0, 16);
  }
}

function getDatabase(projectId: string): Database {
  const dbPath = join(homedir(), '.claude-memory', projectId, 'memory.db');
  return new Database(dbPath);
}
```

**Validation Layer**:
```typescript
function validateProjectAccess(memory: Memory, currentProjectId: string): void {
  if (memory.project_id !== currentProjectId) {
    logger.warn('Cross-project access attempt', {
      attempted: memory.project_id,
      current: currentProjectId
    });
    throw new Error('Project isolation violation');
  }
}
```

---

### SC-005: Skill Script Integrity

**Category**: Integrity
**Threats Mitigated**: T-005
**Requirements**: NFR-032

**Implementation**:
- Scripts installed to user-writable directory with restrictive permissions
- Log script execution with command and exit code
- Consider future: hash verification of scripts

**Script Permissions**:
```bash
# During installation
chmod 755 ~/.claude/skills/memory/scripts/compact.sh
chmod 755 ~/.claude/skills/memory/scripts/validate.sh
```

**Execution Logging**:
```typescript
function executeScript(scriptPath: string, args: string[]): string {
  logger.info('Executing skill script', { script: scriptPath, args });

  const result = execSync(`"${scriptPath}" ${args.join(' ')}`, {
    encoding: 'utf-8',
    timeout: 30000
  });

  logger.info('Script completed', { script: scriptPath, exitCode: 0 });
  return result;
}
```

---

### SC-006: Embedding Server Validation

**Category**: Integrity
**Threats Mitigated**: T-006
**Requirements**: NFR-011

**Implementation**:
- Validate Ollama response format
- Check embedding dimensions match expected
- Graceful degradation on validation failure

**Code Example**:
```typescript
async function generateEmbedding(content: string): Promise<Float32Array | null> {
  try {
    const response = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nomic-embed-text:v2',
        prompt: content
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }

    const data = await response.json();

    // SC-006: Validate response
    if (!Array.isArray(data.embedding) ||
        data.embedding.length !== 768) {
      logger.warn('Invalid embedding response', {
        length: data.embedding?.length
      });
      return null;
    }

    return new Float32Array(data.embedding);
  } catch (error) {
    logger.warn('Embedding generation failed, using BM25 only', { error });
    return null;
  }
}
```

---

### SC-007: WAL Mode and Backup

**Category**: Integrity
**Threats Mitigated**: T-007
**Requirements**: NFR-010

**Implementation**:
- SQLite WAL mode for crash safety
- Optimized pragmas for durability
- Pre-migration backups

**Code Example**:
```typescript
function initializeDatabase(dbPath: string): Database {
  const db = new Database(dbPath);

  // SC-007: Crash-safe configuration
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('wal_autocheckpoint = 1000');

  // Performance optimizations
  db.pragma('cache_size = -64000');
  db.pragma('temp_store = MEMORY');

  return db;
}

function createBackup(dbPath: string): void {
  const backupDir = join(dirname(dbPath), 'backup');
  mkdirSync(backupDir, { recursive: true });

  const backupPath = join(
    backupDir,
    `pre-migration-${Date.now()}.db`
  );

  // SQLite online backup
  const db = new Database(dbPath);
  db.backup(backupPath);
  db.close();

  logger.info('Created database backup', { path: backupPath });
}
```

---

### SC-008: Memory Provenance Tracking

**Category**: Monitoring
**Threats Mitigated**: T-008
**Requirements**: NFR-032

**Implementation**:
- Track creation timestamp for all memories
- Track source (user, claude, hook) for preferences
- Log all modifications with reason
- Support audit queries

**Data Model**:
```typescript
interface MemoryProvenance {
  id: string;
  created_at: number;
  created_by: 'user' | 'claude' | 'hook';
  modified_at?: number;
  modified_reason?: string;
  access_history: number[];  // Timestamps of recalls
}
```

**Audit Query**:
```sql
SELECT id, content, type, created_at,
       json_extract(properties, '$.source') as source
FROM memories
WHERE project_id = ?
  AND type = 'preference'
ORDER BY created_at DESC;
```

---

### SC-009: Sensitive Content Scanning

**Category**: Data Protection
**Threats Mitigated**: T-009
**Requirements**: NFR-030

**Implementation**:
- Extended pattern matching beyond credentials
- Detect common sensitive file patterns
- Warning for .env file content

**Patterns**:
```typescript
const SENSITIVE_FILE_PATTERNS = [
  /\.env\b/i,
  /id_rsa/i,
  /\.pem$/i,
  /credentials\.json/i,
  /secrets?\.(yaml|yml|json)/i,
];

const SENSITIVE_CONTENT_PATTERNS = [
  // Database connection strings
  /postgres:\/\/[^:]+:[^@]+@/,
  /mysql:\/\/[^:]+:[^@]+@/,
  /mongodb:\/\/[^:]+:[^@]+@/,

  // Private key content
  /PRIVATE KEY/,
];

function warnOnSensitiveContent(content: string, citation?: string): void {
  if (citation) {
    for (const pattern of SENSITIVE_FILE_PATTERNS) {
      if (pattern.test(citation)) {
        logger.warn('Storing content from potentially sensitive file', {
          pattern: pattern.source
        });
      }
    }
  }

  for (const pattern of SENSITIVE_CONTENT_PATTERNS) {
    if (pattern.test(content)) {
      logger.warn('Storing potentially sensitive content', {
        pattern: pattern.source
      });
    }
  }
}
```

---

### SC-010: Hook Command Sanitization

**Category**: Input Validation
**Threats Mitigated**: T-010
**Requirements**: NFR-032

**Implementation**:
- Escape all arguments passed to hook commands
- Use array-based command execution
- Validate file paths before including in commands

**Code Example**:
```typescript
import { spawn } from 'child_process';

function executeHook(command: string, args: Record<string, string>): void {
  // SC-010: Sanitize all arguments
  const sanitizedArgs: string[] = [];

  for (const [key, value] of Object.entries(args)) {
    // Validate path arguments
    if (key.includes('PATH') || key.includes('FILE')) {
      if (!isValidPath(value)) {
        logger.warn('Invalid path in hook argument', { key });
        continue;
      }
    }

    // Use shell-safe argument passing
    sanitizedArgs.push(`--${key}=${value}`);
  }

  // Use spawn with array args (not shell string)
  const proc = spawn(command, sanitizedArgs, {
    shell: false,  // Avoid shell interpretation
    timeout: 10000
  });

  // ... handle output
}

function isValidPath(path: string): boolean {
  // No null bytes, control characters, or shell metacharacters
  return !/[\x00-\x1f\x7f;|&`$(){}[\]<>]/.test(path);
}
```

---

### SC-011: Storage Limits

**Category**: Resource Control
**Threats Mitigated**: T-011
**Requirements**: NFR-005

**Implementation**:
- Configurable maximum memories per project
- Database size monitoring
- Warning at 80%, limit at 100%

**Code Example**:
```typescript
const STORAGE_LIMITS = {
  maxMemoriesPerProject: 10000,
  maxDatabaseSizeMB: 100,
  warningThreshold: 0.8
};

async function checkStorageLimits(projectId: string): Promise<void> {
  const count = db.prepare(
    'SELECT COUNT(*) as count FROM memories WHERE project_id = ? AND deleted_at IS NULL'
  ).get(projectId) as { count: number };

  if (count.count >= STORAGE_LIMITS.maxMemoriesPerProject) {
    throw new Error(
      `Memory limit reached (${STORAGE_LIMITS.maxMemoriesPerProject}). ` +
      'Please delete old memories before adding new ones.'
    );
  }

  if (count.count >= STORAGE_LIMITS.maxMemoriesPerProject * STORAGE_LIMITS.warningThreshold) {
    logger.warn('Approaching memory limit', {
      current: count.count,
      limit: STORAGE_LIMITS.maxMemoriesPerProject
    });
  }
}
```

---

### SC-012: Staleness Detection

**Category**: Monitoring
**Threats Mitigated**: T-012
**Requirements**: NFR-051

**Implementation**:
- Track last access time for memories
- Flag memories not accessed in N sessions
- Check if cited files still exist
- Surface warnings in recall responses

**Code Example**:
```typescript
interface StalenessCheck {
  memoryId: string;
  reason: 'not_accessed' | 'file_missing' | 'file_changed';
  details: string;
}

async function checkStaleness(memory: Memory): Promise<StalenessCheck | null> {
  // Check access recency
  const sessionsSinceAccess = await getSessionsSinceAccess(memory.id);
  if (sessionsSinceAccess > 10) {
    return {
      memoryId: memory.id,
      reason: 'not_accessed',
      details: `Not accessed in ${sessionsSinceAccess} sessions`
    };
  }

  // Check cited file exists
  if (memory.citation) {
    const filePath = memory.citation.split(':')[0];
    if (!existsSync(filePath)) {
      return {
        memoryId: memory.id,
        reason: 'file_missing',
        details: `Cited file no longer exists: ${filePath}`
      };
    }
  }

  return null;
}
```

---

## Security Checklist

### Development

- [ ] All SQL queries use parameterized statements
- [ ] All user input validated before use
- [ ] Credential patterns checked before storage
- [ ] File paths validated and normalized
- [ ] No secrets in log messages
- [ ] Error messages don't leak internal details

### Build

- [ ] Dependencies audited (`npm audit`)
- [ ] No high/critical vulnerabilities
- [ ] Lockfile committed and verified

### Deployment

- [ ] SQLite database in user home directory
- [ ] Restrictive file permissions (600 for db, 755 for scripts)
- [ ] No world-readable files
- [ ] Ollama bound to localhost only

### Runtime

- [ ] WAL mode enabled
- [ ] Storage limits configured
- [ ] Logging enabled for security events
- [ ] Graceful degradation on embedding failure

---

## Incident Response

### Security Issue Found

1. **Assess**: Determine severity and scope
2. **Contain**: Disable affected functionality if needed
3. **Document**: Record issue details (not exploits) in private
4. **Fix**: Develop and test patch
5. **Release**: Ship fix with security advisory
6. **Review**: Update threat model and controls

### User Data Compromise

1. **Notify**: Inform affected users immediately
2. **Guide**: Provide steps to rotate any exposed credentials
3. **Clean**: Help users delete compromised memories
4. **Prevent**: Strengthen controls to prevent recurrence

---

## Traces to Requirements

| Control | User Story | Functional Requirement | Non-Functional Requirement |
|---------|------------|----------------------|---------------------------|
| SC-001 | US-006, US-007 | FR-010 | NFR-030 |
| SC-002 | US-008, US-009 | FR-011, FR-090 | NFR-032 |
| SC-003 | US-015 | FR-022 | NFR-032 |
| SC-004 | US-034, US-035, US-036 | FR-080, FR-081, FR-083 | NFR-053 |
| SC-005 | US-027 | SK-002 | NFR-032 |
| SC-006 | US-021, US-023 | FR-040, FR-043 | NFR-011 |
| SC-007 | US-037 | FR-090 | NFR-010 |
| SC-008 | US-014, US-048 | FR-021, FR-023 | NFR-032 |
| SC-009 | US-006 | FR-010 | NFR-030 |
| SC-010 | US-044, US-045 | HK-003, HK-004 | NFR-032 |
| SC-011 | US-037 | FR-090 | NFR-005 |
| SC-012 | US-046, US-047 | FR-023 | NFR-051 |
