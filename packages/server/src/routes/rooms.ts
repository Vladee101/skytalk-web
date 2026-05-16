import multipart from '@fastify/multipart';
import { validateFlightJson, viewStepForRole, type FlightLesson } from '@skytalk/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import { randomBytes } from 'node:crypto';

import { verifyToken } from '../auth';
import { getDb } from '../db';
import { generateTurnCredentials } from '../turn-creds';

const MAX_FILE_BYTES = 256 * 1024;

interface TruncatableStream extends NodeJS.ReadableStream {
  truncated: boolean;
}

interface RoomRow {
  room_id: string;
  tutor_token: string;
  student_token: string;
  flight_json: string;
  student_name: string | null;
  current_step_index: number;
  current_input_index: number;
  state: string;
  attempt_count: number;
  reset_count: number;
  created_at: number;
  expires_at: number;
  ended_at: number | null;
}

async function authenticateTutor(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookieToken = request.cookies?.['tutor_session'];
  const authHeader = request.headers['authorization'];
  let token: string | undefined;

  if (cookieToken) {
    token = cookieToken;
  } else if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  if (!token) {
    reply.status(401).send({ error: 'authentication required' });
    return;
  }

  try {
    verifyToken(token);
  } catch {
    reply.status(401).send({ error: 'invalid or expired token' });
  }
}

export async function roomsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart);

  app.post('/api/rooms', { preHandler: authenticateTutor }, async (request, reply) => {
    const publicUrl = process.env['SKYTALK_PUBLIC_URL'] ?? '';
    const turnSecret = process.env['SKYTALK_TURN_SECRET'] ?? '';

    let fileContent: string | undefined;
    let studentName: string | undefined;

    const parts = request.parts({ limits: { fileSize: MAX_FILE_BYTES } });
    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'flight_json') {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(chunk);
        }
        if ((part.file as unknown as TruncatableStream).truncated) {
          return reply.status(413).send({ error: 'flight.json exceeds 256 KB limit' });
        }
        fileContent = Buffer.concat(chunks).toString('utf-8');
      } else if (part.type === 'field' && part.fieldname === 'student_name') {
        studentName = part.value as string;
      }
    }

    if (fileContent === undefined) {
      return reply.status(422).send({ error: 'flight_json field is required' });
    }

    let rawLesson: unknown;
    try {
      rawLesson = JSON.parse(fileContent);
    } catch {
      return reply.status(422).send({ error: 'flight_json is not valid JSON' });
    }

    const result = validateFlightJson(rawLesson);
    if (!result.valid) {
      return reply.status(422).send({ errors: result.errors });
    }

    const roomId = nanoid(16);
    const tutorToken = randomBytes(16).toString('hex');
    const studentToken = randomBytes(16).toString('hex');
    const now = Date.now();
    const expiresAt = now + 24 * 60 * 60 * 1000;

    getDb()
      .prepare(
        `INSERT INTO rooms (room_id, tutor_token, student_token, flight_json, student_name, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(roomId, tutorToken, studentToken, fileContent, studentName ?? null, now, expiresAt);

    return reply.status(201).send({
      room_id: roomId,
      lesson_name: result.lesson.lesson.name,
      tutor_url: `${publicUrl}/tutor/${roomId}?token=${tutorToken}`,
      student_url: `${publicUrl}/student/${roomId}?token=${studentToken}`,
      expires_at: new Date(expiresAt).toISOString(),
      turn_credentials: generateTurnCredentials(turnSecret, roomId),
    });
  });

  app.delete('/api/rooms/:room_id', { preHandler: authenticateTutor }, async (request, reply) => {
    const { room_id } = request.params as { room_id: string };
    const db = getDb();
    db.prepare('DELETE FROM session_events WHERE room_id = ?').run(room_id);
    const result = db.prepare('DELETE FROM rooms WHERE room_id = ?').run(room_id);
    if (result.changes === 0) return reply.status(404).send({ error: 'room not found' });
    return reply.status(204).send();
  });

  app.get('/api/rooms/:room_id/turn-creds', async (request, reply) => {
    const { room_id } = request.params as { room_id: string };
    const { token } = request.query as { token?: string };
    const turnSecret = process.env['SKYTALK_TURN_SECRET'] ?? '';

    if (!token) {
      return reply.status(401).send({ error: 'token is required' });
    }

    const row = getDb()
      .prepare('SELECT tutor_token, student_token, expires_at, state FROM rooms WHERE room_id = ?')
      .get(room_id) as Pick<RoomRow, 'tutor_token' | 'student_token' | 'expires_at' | 'state'> | undefined;

    if (!row || (token !== row.tutor_token && token !== row.student_token)) {
      return reply.status(401).send({ error: 'invalid token' });
    }

    if (row.expires_at < Date.now()) {
      return reply.status(404).send({ error: 'room not found' });
    }

    if (row.state === 'ENDED') {
      return reply.status(410).send({ error: 'lesson has ended' });
    }

    const creds = generateTurnCredentials(turnSecret, room_id);
    return reply.status(200).send({ ...creds, ttl: 86400 });
  });

  app.get('/api/rooms/:room_id', async (request, reply) => {
    const { room_id } = request.params as { room_id: string };
    const { token } = request.query as { token?: string };

    if (!token) {
      return reply.status(401).send({ error: 'token is required' });
    }

    const row = getDb()
      .prepare('SELECT * FROM rooms WHERE room_id = ?')
      .get(room_id) as RoomRow | undefined;

    if (!row) {
      return reply.status(401).send({ error: 'invalid token' });
    }

    let role: 'tutor' | 'student';
    if (token === row.tutor_token) {
      role = 'tutor';
    } else if (token === row.student_token) {
      role = 'student';
    } else {
      return reply.status(401).send({ error: 'invalid token' });
    }

    if (row.expires_at < Date.now()) {
      return reply.status(404).send({ error: 'room not found' });
    }

    if (row.state === 'ENDED') {
      return reply.status(410).send({ error: 'lesson has ended' });
    }

    const lesson = JSON.parse(row.flight_json) as FlightLesson;
    const step = lesson.steps[row.current_step_index];

    if (!step) {
      return reply.status(500).send({ error: 'internal error' });
    }

    return reply.status(200).send({
      room_id: row.room_id,
      role,
      lesson: lesson.lesson,
      total_steps: lesson.steps.length,
      current_step_index: row.current_step_index,
      state: row.state,
      attempt_count: row.attempt_count,
      current_step_data: viewStepForRole(step, role),
    });
  });
}
