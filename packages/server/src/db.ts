import { DatabaseSync } from 'node:sqlite';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface Migration {
  readonly version: number;
  readonly sql: string;
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS rooms (
  room_id             TEXT PRIMARY KEY,
  tutor_token         TEXT NOT NULL UNIQUE,
  student_token       TEXT NOT NULL UNIQUE,
  flight_json         TEXT NOT NULL,
  student_name        TEXT,
  current_step_index  INTEGER NOT NULL DEFAULT 0,
  current_input_index INTEGER NOT NULL DEFAULT 0,
  state               TEXT NOT NULL DEFAULT 'IDLE',
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  reset_count         INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  expires_at          INTEGER NOT NULL,
  ended_at            INTEGER
);

CREATE TABLE IF NOT EXISTS session_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id      TEXT NOT NULL REFERENCES rooms(room_id),
  ts           INTEGER NOT NULL,
  actor        TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_rooms_expires       ON rooms(expires_at);
CREATE INDEX IF NOT EXISTS idx_rooms_tutor_token   ON rooms(tutor_token);
CREATE INDEX IF NOT EXISTS idx_rooms_student_token ON rooms(student_token);
CREATE INDEX IF NOT EXISTS idx_events_room         ON session_events(room_id, ts);
    `,
  },
];

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  return db;
}

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const checkStmt = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
  const markStmt = db.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );

  for (const migration of MIGRATIONS) {
    if (checkStmt.get(migration.version) === undefined) {
      db.exec('BEGIN');
      try {
        db.exec(migration.sql);
        markStmt.run(migration.version, Date.now());
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
  }
}

export function cleanupExpiredRooms(db: DatabaseSync): number {
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  db.prepare(
    'DELETE FROM session_events WHERE room_id IN (SELECT room_id FROM rooms WHERE expires_at < ?)',
  ).run(cutoff);
  const result = db.prepare('DELETE FROM rooms WHERE expires_at < ?').run(cutoff);
  return Number(result.changes);
}

let _db: DatabaseSync | null = null;

export function initDb(path: string): DatabaseSync {
  const db = openDb(path);
  runMigrations(db);
  cleanupExpiredRooms(db);
  _db = db;
  return db;
}

export function getDb(): DatabaseSync {
  if (_db === null) throw new Error('db not initialized — call initDb first');
  return _db;
}
