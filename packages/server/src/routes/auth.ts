import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

import { signToken, verifyPassword } from '../auth';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    max: 10,
    timeWindow: '1 minute',
  });

  app.post(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['password'],
          properties: {
            password: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { password } = request.body as { password: string };

      const valid = await verifyPassword(password);
      if (!valid) {
        return reply.status(401).send({ error: 'invalid password' });
      }

      const token = signToken();

      void reply.setCookie('tutor_session', token, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
      });

      return { tutor_session_token: token };
    },
  );
}
