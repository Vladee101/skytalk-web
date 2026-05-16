export interface Config {
  tutorPassword: string;
  jwtSecret: string;
  publicUrl: string;
  turnSecret: string;
  dbPath: string;
  port: number;
  host: string;
}

export function loadConfig(): Config {
  const tutorPassword = process.env['SKYTALK_TUTOR_PASSWORD'];
  if (!tutorPassword) {
    throw new Error('FATAL: SKYTALK_TUTOR_PASSWORD env var is not set. Server cannot start.');
  }

  const jwtSecret = process.env['SKYTALK_JWT_SECRET'];
  if (!jwtSecret) {
    throw new Error('FATAL: SKYTALK_JWT_SECRET env var is not set. Server cannot start.');
  }
  if (jwtSecret.length < 32) {
    throw new Error('FATAL: SKYTALK_JWT_SECRET must be at least 32 characters.');
  }

  const publicUrl = process.env['SKYTALK_PUBLIC_URL'];
  if (!publicUrl) {
    throw new Error('FATAL: SKYTALK_PUBLIC_URL env var is not set. Server cannot start.');
  }

  const turnSecret = process.env['SKYTALK_TURN_SECRET'];
  if (!turnSecret) {
    throw new Error('FATAL: SKYTALK_TURN_SECRET env var is not set. Server cannot start.');
  }

  return {
    tutorPassword,
    jwtSecret,
    publicUrl,
    turnSecret,
    dbPath: process.env['SKYTALK_DB_PATH'] ?? '/var/lib/skytalk/skytalk.db',
    port: Number(process.env['PORT'] ?? 3001),
    host: process.env['HOST'] ?? '127.0.0.1',
  };
}
