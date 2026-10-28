import { initAuth } from './auth';
import { buildApp } from './app';
import { cleanupExpiredRooms, getDb, initDb } from './db';
import { loadConfig } from './env';
import { loggerOptions } from './logger';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

initAuth(config.tutorPassword, config.jwtSecret);
initDb(config.dbPath);

const app = buildApp({ logger: loggerOptions });

// initDb() cleans up on startup only; the service runs for weeks between restarts.
const cleanupTimer = setInterval(() => {
  try {
    const removed = cleanupExpiredRooms(getDb());
    if (removed > 0) app.log.info({ removed }, 'expired rooms cleaned up');
  } catch (err) {
    app.log.error(err, 'expired room cleanup failed');
  }
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

const shutdown = async () => {
  clearInterval(cleanupTimer);
  await app.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
