import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

const MEMORY_DIR = join(homedir(), '.claude-memory');

/**
 * Get project ID from git root path
 * Uses SHA256 hash truncated to 16 chars for directory name
 */
export function getProjectId(gitRoot: string): string {
  return createHash('sha256').update(gitRoot).digest('hex').substring(0, 16);
}

/**
 * Get database path for a project
 */
export function getDatabasePath(projectId: string): string {
  return join(MEMORY_DIR, projectId, 'memory.db');
}

/**
 * Database connection manager
 * Handles WAL mode, pragmas, and connection lifecycle
 */
export class DatabaseConnection {
  private db: Database.Database;
  private projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
    const dbPath = getDatabasePath(projectId);

    // Ensure directory exists
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    // Open database
    this.db = new Database(dbPath);

    // Configure for performance and crash safety
    this.configurePragmas();
  }

  /**
   * Configure SQLite pragmas per DATABASE.md specifications
   */
  private configurePragmas(): void {
    // WAL mode for crash-safe concurrent access
    this.db.pragma('journal_mode = WAL');

    // Performance optimizations
    this.db.pragma('synchronous = NORMAL'); // Balance durability and speed
    this.db.pragma('cache_size = -64000'); // 64MB cache
    this.db.pragma('temp_store = MEMORY'); // Temp tables in memory
    this.db.pragma('mmap_size = 268435456'); // 256MB memory-mapped I/O

    // Foreign key enforcement
    this.db.pragma('foreign_keys = ON');

    // Busy timeout for concurrent access
    this.db.pragma('busy_timeout = 5000');
  }

  /**
   * Get the underlying database instance
   */
  get instance(): Database.Database {
    return this.db;
  }

  /**
   * Get the project ID for this connection
   */
  get project(): string {
    return this.projectId;
  }

  /**
   * Execute a query within a transaction
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Prepare a statement for execution
   */
  prepare(sql: string): Database.Statement {
    return this.db.prepare(sql);
  }

  /**
   * Execute a raw SQL statement
   */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Check if database is open
   */
  get isOpen(): boolean {
    return this.db.open;
  }

  /**
   * Get database file path
   */
  get path(): string {
    return getDatabasePath(this.projectId);
  }

  /**
   * Verify WAL mode is active
   */
  verifyWalMode(): boolean {
    const result = this.db.pragma('journal_mode') as Array<{ journal_mode: string }>;
    return result[0]?.journal_mode === 'wal';
  }
}

/**
 * Connection pool for managing multiple project databases
 */
class ConnectionPool {
  private connections: Map<string, DatabaseConnection> = new Map();

  /**
   * Get or create connection for a project
   */
  get(projectId: string): DatabaseConnection {
    let conn = this.connections.get(projectId);
    if (!conn || !conn.isOpen) {
      conn = new DatabaseConnection(projectId);
      this.connections.set(projectId, conn);
    }
    return conn;
  }

  /**
   * Close connection for a project
   */
  close(projectId: string): void {
    const conn = this.connections.get(projectId);
    if (conn) {
      conn.close();
      this.connections.delete(projectId);
    }
  }

  /**
   * Close all connections
   */
  closeAll(): void {
    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();
  }

  /**
   * Get all active project IDs
   */
  activeProjects(): string[] {
    return Array.from(this.connections.keys());
  }
}

// Singleton connection pool
export const connectionPool = new ConnectionPool();
