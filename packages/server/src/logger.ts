import type { FastifyLoggerOptions, FastifyRequest } from 'fastify';

/** Magic-link tokens travel in query strings (?token=…) — they must never reach journald. */
export function redactUrl(url: string): string {
  return url.replace(/([?&]token=)[^&#]*/g, '$1REDACTED');
}

export const loggerOptions: FastifyLoggerOptions = {
  serializers: {
    // Same fields as Fastify's default request serializer, with the URL redacted
    req(request: FastifyRequest) {
      const remotePort = request.socket?.remotePort;
      return {
        method: request.method,
        url: redactUrl(request.url),
        hostname: request.hostname,
        remoteAddress: request.ip,
        ...(remotePort !== undefined && { remotePort }),
      };
    },
  },
};
