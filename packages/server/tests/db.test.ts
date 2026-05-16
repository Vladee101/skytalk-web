import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { cleanupExpiredRooms, openDb, runMigrations } from '../src/db';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeDb(): DatabaseSync {
  const db = openDb(':memory:');
  runMigrations(db);
  return db;
}

function insertRoom(
  db: DatabaseSync,
  roomId: string,
  tutorToken: string,
  studentToken: string,
  expiresAt: number,
): void {
  db.prepare(
    `INSERT INTO rooms (room_id, tutor_token, student_token, flight_json, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(roomId, tutorToken, studentToken, '{}', Date.now() - 10 * DAY_MS, expiresAt);
}

describe('runMigrations', () => {
  it('creates rooms, session_events, and schema_migrations tables', () => {
    const db = makeDb();
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('rooms');
    expect(names).toContain('session_events');
    expect(names).toContain('schema_migrations');
    db.close();
  });

  it('is idempotent — calling runMigrations twice does not error or duplicate rows', () => {
    const db = openDb(':memory:');
    runMigrations(db);
    runMigrations(db);
    const row = db.prepare('SELECT COUNT(*) as n FROM schema_migrations').get() as { n: number };
    expect(row.n).toBe(1);
    db.close();
  });
});

describe('cleanupExpiredRooms', () => {
  it('deletes rooms expired > 7 days ago, keeps recently-expired rooms', () => {
    const db = makeDb();
    const now = Date.now();

    insertRoom(db, 'old-room', 'tok-t-1', 'tok-s-1', now - 8 * DAY_MS); // expired 8 days ago → delete
    insertRoom(db, 'new-room', 'tok-t-2', 'tok-s-2', now - DAY_MS); // expired 1 day ago → keep

    const deleted = cleanupExpiredRooms(db);
    expect(deleted).toBe(1);

    const remaining = db.prepare('SELECT room_id FROM rooms').all() as { room_id: string }[];
    expect(remaining.map((r) => r.room_id)).toEqual(['new-room']);
    db.close();
  });

  it('deletes session_events belonging to purged rooms', () => {
    const db = makeDb();
    const now = Date.now();

    insertRoom(db, 'old-room', 'tok-t-3', 'tok-s-3', now - 8 * DAY_MS);
    db.prepare(
      `INSERT INTO session_events (room_id, ts, actor, event_type) VALUES (?, ?, ?, ?)`,
    ).run('old-room', now - 8 * DAY_MS, 'server', 'room_created');

    cleanupExpiredRooms(db);

    const events = db.prepare('SELECT id FROM session_events').all();
    expect(events).toHaveLength(0);
    db.close();
  });
});
