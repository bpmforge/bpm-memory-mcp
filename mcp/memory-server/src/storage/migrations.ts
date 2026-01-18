import { DatabaseConnection } from './database.js';
import { MIGRATIONS, CURRENT_VERSION } from './schema.js';

/**
 * Run all pending migrations for a database
 */
export function runMigrations(db: DatabaseConnection): void {
  const currentVersion = getCurrentVersion(db);

  if (currentVersion >= CURRENT_VERSION) {
    return; // Already up to date
  }

  // Run each migration in a transaction
  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      db.transaction(() => {
        db.exec(migration.up);
        recordMigration(db, migration.version);
      });
    }
  }
}

/**
 * Get the current schema version
 */
function getCurrentVersion(db: DatabaseConnection): number {
  try {
    // Check if schema_version table exists
    const tableExists = db.instance
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'`
      )
      .get();

    if (!tableExists) {
      return 0;
    }

    const result = db.instance
      .prepare('SELECT MAX(version) as version FROM schema_version')
      .get() as { version: number | null } | undefined;

    return result?.version ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Record a migration as applied
 */
function recordMigration(db: DatabaseConnection, version: number): void {
  db.instance
    .prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
    .run(version, Math.floor(Date.now() / 1000));
}

/**
 * Rollback to a specific version (for development/testing)
 */
export function rollbackTo(db: DatabaseConnection, targetVersion: number): void {
  const currentVersion = getCurrentVersion(db);

  if (targetVersion >= currentVersion) {
    return; // Nothing to rollback
  }

  // Run down migrations in reverse order
  const migrationsToRollback = MIGRATIONS.filter(
    (m) => m.version > targetVersion && m.version <= currentVersion
  ).reverse();

  for (const migration of migrationsToRollback) {
    db.transaction(() => {
      db.exec(migration.down);
    });
  }
}

/**
 * Check if database needs migration
 */
export function needsMigration(db: DatabaseConnection): boolean {
  return getCurrentVersion(db) < CURRENT_VERSION;
}

/**
 * Get migration status
 */
export function getMigrationStatus(db: DatabaseConnection): {
  currentVersion: number;
  targetVersion: number;
  needsMigration: boolean;
} {
  const current = getCurrentVersion(db);
  return {
    currentVersion: current,
    targetVersion: CURRENT_VERSION,
    needsMigration: current < CURRENT_VERSION,
  };
}
