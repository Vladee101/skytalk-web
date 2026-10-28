import cookie from '@fastify/cookie';
import websocketPlugin from '@fastify/websocket';
import Fastify, { type FastifyServerOptions } from 'fastify';

import { authRoutes } from './routes/auth';
import { healthRoutes } from './routes/health';
import { roomsRoutes } from './routes/rooms';
import { wsRoutes } from './ws/server';

export function buildApp(opts: FastifyServerOptions = {}) {
  const app = Fastify({
    // Behind nginx on the same host: take the client IP from X-Forwarded-For, otherwise
    // every request comes from 127.0.0.1 and the login rate limit is shared by everyone.
    // Only the loopback hop is trusted, so a client can't spoof its address via the header.
    trustProxy: '127.0.0.1',
    ...opts,
  });
  void app.register(cookie);
  void app.register(websocketPlugin);
  void app.register(healthRoutes);
  void app.register(authRoutes);
  void app.register(roomsRoutes);
  void app.register(wsRoutes);
  return app;
}
