import { initAuth } from './auth';
import { buildApp } from './app';
import { initDb } from './db';
import { loadConfig } from './env';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

initAuth(config.tutorPassword, config.jwtSecret);
initDb(config.dbPath);

const app = buildApp({ logger: true });

const shutdown = async () => {
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
