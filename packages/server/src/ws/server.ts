import { viewStepForRole, type FlightLesson } from '@skytalk/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { getDb } from '../db';
import { dispatchMessage } from './handlers';
import { getRoomManager } from './room-manager';

interface RoomRow {
  room_id: string;
  tutor_token: string;
  student_token: string;
  flight_json: string;
  current_step_index: number;
  current_input_index: number;
  state: string;
  attempt_count: number;
  expires_at: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    wsAuth?: { role: 'tutor' | 'student'; row: RoomRow };
  }
}

async function wsAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { room_id } = request.params as { room_id: string };
  const { token } = request.query as { token?: string };

  if (!token) {
    reply.status(401).send({ error: 'token is required' });
    return;
  }

  const row = getDb()
    .prepare('SELECT * FROM rooms WHERE room_id = ?')
    .get(room_id) as RoomRow | undefined;

  if (!row) {
    reply.status(401).send({ error: 'invalid token' });
    return;
  }

  let role: 'tutor' | 'student';
  if (token === row.tutor_token) {
    role = 'tutor';
  } else if (token === row.student_token) {
    role = 'student';
  } else {
    reply.status(401).send({ error: 'invalid token' });
    return;
  }

  if (row.expires_at < Date.now()) {
    reply.status(404).send({ error: 'room not found' });
    return;
  }

  if (row.state === 'ENDED') {
    reply.status(410).send({ error: 'lesson has ended' });
    return;
  }

  request.wsAuth = { role, row };
}

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws/rooms/:room_id', { preHandler: wsAuth, websocket: true }, (socket, request) => {
    const { role, row } = request.wsAuth!;
    const manager = getRoomManager();

    manager.join(row.room_id, role, socket);

    const freshRow = getDb()
      .prepare('SELECT * FROM rooms WHERE room_id = ?')
      .get(row.room_id) as unknown as RoomRow;
    const lesson = JSON.parse(freshRow.flight_json) as FlightLesson;
    const step = lesson.steps[freshRow.current_step_index];

    socket.send(
      JSON.stringify({
        type: 'state_snapshot',
        room_id: freshRow.room_id,
        current_step_index: freshRow.current_step_index,
        current_input_index: freshRow.current_input_index,
        total_steps: lesson.steps.length,
        state: freshRow.state,
        current_step_data: step ? viewStepForRole(step, role) : null,
        attempt_count: freshRow.attempt_count,
        last_input_result: null as null | { correct: boolean; value?: string },
      }),
    );

    socket.on('message', (raw) => {
      manager.touch(row.room_id, role);
      try {
        dispatchMessage(row.room_id, role, raw.toString());
      } catch {
        // unexpected error — don't crash the server
      }
    });

    socket.on('close', () => {
      manager.leave(row.room_id, role);
    });
  });
}
