import cookie from '@fastify/cookie';
import websocketPlugin from '@fastify/websocket';
import Fastify, { type FastifyServerOptions } from 'fastify';

import { authRoutes } from './routes/auth';
import { healthRoutes } from './routes/health';
import { roomsRoutes } from './routes/rooms';
import { wsRoutes } from './ws/server';

export function buildApp(opts: FastifyServerOptions = {}) {
  const app = Fastify(opts);
  void app.register(cookie);
  void app.register(websocketPlugin);
  void app.register(healthRoutes);
  void app.register(authRoutes);
  void app.register(roomsRoutes);
  void app.register(wsRoutes);
  return app;
}
