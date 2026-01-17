# Constraints: claude-memory

## Technical Constraints

### TC-001: MCP Protocol Compliance

**Constraint**: Must implement MCP server specification exactly as documented.

**Rationale**: Claude Code only communicates via MCP. Non-compliant implementations will fail silently or cause errors.

**Implications**:
- Use official `@modelcontextprotocol/sdk` package
- Follow tool/resource schema exactly
- Handle all required protocol messages
- Support stdio transport (Claude Code default)

---

### TC-002: Local-First Architecture

**Constraint**: All processing must occur locally without cloud dependencies.

**Rationale**: Privacy requirements, offline capability, no API costs.

**Implications**:
- No cloud embedding APIs (OpenAI, Cohere, etc.)
- No telemetry or data collection
- Must work without internet connection
- All storage on local filesystem

---

### TC-003: SQLite-Only Storage

**Constraint**: Use SQLite as the sole persistence mechanism.

**Rationale**: Zero-config, portable, no external database server required.

**Implications**:
- Single-file database per project
- BLOB storage for embeddings
- WAL mode for concurrency safety
- Limited to SQLite's capabilities

---

### TC-004: Node.js Runtime

**Constraint**: Must run on Node.js 18+.

**Rationale**: MCP SDK is TypeScript/JavaScript. Claude Code ecosystem is Node-based.

**Implications**:
- TypeScript as primary language
- npm/pnpm for package management
- Node.js built-in APIs only
- Cross-platform (macOS, Linux, Windows)

---

### TC-005: Embedding Dimension Compatibility

**Constraint**: Support 768-dimension embeddings (nomic-embed-text standard).

**Rationale**: Most local embedding models output 768 dimensions.

**Implications**:
- Vector storage sized for 768 floats
- Similarity functions optimized for this size
- May need adapter for other dimensions

---

### TC-006: Response Latency

**Constraint**: Memory operations must complete within 500ms.

**Rationale**: Claude Code is interactive; slow responses break flow.

**Implications**:
- Aggressive caching required
- Async embedding generation
- Indexed search queries
- Pagination for large results

---

### TC-007: Memory Footprint

**Constraint**: Process memory usage should stay under 512MB.

**Rationale**: Runs alongside Claude Code and user's IDE; shouldn't compete for resources.

**Implications**:
- Stream large data instead of loading
- Use SQLite for storage (not in-memory)
- Lazy loading of embeddings
- Bounded caches

---

## Business Constraints

### BC-001: Open Source License

**Constraint**: Must be released under permissive open source license (MIT or Apache 2.0).

**Rationale**: Maximize adoption, community contribution, trust.

**Implications**:
- No proprietary dependencies
- Clear license headers
- Contribution guidelines
- Public repository

---

### BC-002: Zero Cost to Users

**Constraint**: No paid features, subscriptions, or API costs in core product.

**Rationale**: Developer tools should be accessible; competing with free alternatives.

**Implications**:
- No cloud services requiring payment
- Local-only by default
- Optional features, not paywalled

---

### BC-003: Single Developer Focus (v1)

**Constraint**: v1.0 targets individual developers, not teams.

**Rationale**: Simpler architecture, faster delivery, clearer use case.

**Implications**:
- No multi-user support
- No sync/collaboration features
- Per-machine storage
- Single-tenant data model

---

## Operational Constraints

### OC-001: No External Services

**Constraint**: Must not require running additional services beyond the MCP server itself.

**Rationale**: Minimize setup complexity and ongoing maintenance.

**Implications**:
- No separate database server
- No message queue
- No background workers (beyond main process)
- Self-contained executable

**Exception**: Optional embedding server (LM Studio/Ollama) is user's responsibility.

---

### OC-002: Graceful Degradation

**Constraint**: Must function (with reduced capability) when optional components unavailable.

**Rationale**: Users shouldn't be blocked if embedding server isn't running.

**Degradation Levels**:
1. **Full**: Vector + BM25 hybrid search
2. **Reduced**: BM25-only search (no embedding server)
3. **Minimal**: Exact match only (database issues)

---

### OC-003: Non-Destructive Operations

**Constraint**: Memory operations must not modify user's project files.

**Rationale**: Read-only access to codebase; trust boundary.

**Implications**:
- Only read source files, never write
- Memory database in separate location
- No git operations
- No file system modifications outside memory DB

---

### OC-004: Backwards Compatibility

**Constraint**: Database schema changes must migrate existing data.

**Rationale**: Users shouldn't lose accumulated project knowledge on upgrade.

**Implications**:
- Versioned schema with migrations
- Migration tested before release
- Rollback capability
- Export/import as escape hatch

---

## Security Constraints

### SC-001: No Credential Storage

**Constraint**: Must never store content matching credential patterns.

**Rationale**: Prevent accidental leakage of secrets.

**Patterns to Filter**:
- API keys (AWS, OpenAI, etc.)
- Passwords and tokens
- Private keys
- .env file contents

---

### SC-002: Local Network Only

**Constraint**: MCP server binds to localhost only.

**Rationale**: Prevent remote access to memory data.

**Implications**:
- stdio transport (default, no network)
- If HTTP needed, localhost:port only
- No remote API endpoints

---

### SC-003: Input Validation

**Constraint**: All tool inputs must be validated before processing.

**Rationale**: Prevent injection attacks, corrupted data.

**Validations**:
- String length limits
- JSON schema validation
- Path traversal prevention
- SQL injection prevention (parameterized queries)

---

## Design Constraints

### DC-001: Minimal Dependencies

**Constraint**: Limit npm dependencies to essential packages only.

**Rationale**: Reduce attack surface, improve reliability, faster installs.

**Essential Dependencies**:
- `@modelcontextprotocol/sdk` (required)
- `better-sqlite3` (storage)
- `natural` (BM25)
- TypeScript tooling (dev only)

---

### DC-002: Convention Over Configuration

**Constraint**: Sensible defaults; configuration optional.

**Rationale**: Zero-config experience for basic usage.

**Defaults**:
- Memory DB: `~/.claude-memory/<project-hash>.db`
- Token budget: 50% of context for memory
- Search results: top 10
- Embedding: first available provider

---

### DC-003: Observable Behavior

**Constraint**: All memory operations must be traceable/debuggable.

**Rationale**: Users need to understand what's stored and retrieved.

**Requirements**:
- Logging with configurable verbosity
- Memory inspection tools
- Search result explanations
- Token usage reporting

---

## Constraint Summary

| ID | Category | Constraint | Priority |
|----|----------|------------|----------|
| TC-001 | Technical | MCP Protocol Compliance | Must Have |
| TC-002 | Technical | Local-First Architecture | Must Have |
| TC-003 | Technical | SQLite-Only Storage | Must Have |
| TC-004 | Technical | Node.js Runtime | Must Have |
| TC-005 | Technical | 768-dim Embeddings | Should Have |
| TC-006 | Technical | <500ms Latency | Should Have |
| TC-007 | Technical | <512MB Memory | Should Have |
| BC-001 | Business | Open Source License | Must Have |
| BC-002 | Business | Zero Cost | Must Have |
| BC-003 | Business | Single Developer | Must Have |
| OC-001 | Operational | No External Services | Must Have |
| OC-002 | Operational | Graceful Degradation | Must Have |
| OC-003 | Operational | Non-Destructive | Must Have |
| OC-004 | Operational | Backwards Compatible | Should Have |
| SC-001 | Security | No Credential Storage | Must Have |
| SC-002 | Security | Local Network Only | Must Have |
| SC-003 | Security | Input Validation | Must Have |
| DC-001 | Design | Minimal Dependencies | Should Have |
| DC-002 | Design | Convention Over Config | Should Have |
| DC-003 | Design | Observable Behavior | Should Have |
