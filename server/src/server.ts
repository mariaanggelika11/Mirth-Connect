import app from './app.js';
import { config } from './config/env.js';
import { getConnection, closeConnection } from './config/db.js';
import { startHl7Listener, stopHl7Listener } from './services/hl7Listener.services.js';
import { startWorkers, stopWorkers } from './services/worker.services.js';
import { logger } from './utils/logger.js';
import { safeError } from './utils/errors.js';
import type { Server as TcpServer } from 'node:net';
import type { Server } from 'node:http';
let http: Server | undefined,
  mllp: TcpServer | undefined,
  closing = false;
let startupStage: 'database' | 'migration' | 'mllp' | 'http' = 'database';
async function shutdown() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => {
    logger.error({ code: 'SHUTDOWN_TIMEOUT' }, 'Shutdown deadline exceeded');
    process.exit(1);
  }, config.server.shutdownTimeout);
  try {
    const httpClosed = http
      ? new Promise<void>((resolve) => {
          http!.close(() => resolve());
          http!.closeIdleConnections();
        })
      : Promise.resolve();
    await Promise.all([
      httpClosed,
      mllp ? stopHl7Listener(mllp) : Promise.resolve(),
      stopWorkers(),
    ]);
    await closeConnection();
    clearTimeout(deadline);
  } catch {
    logger.error({ code: 'SHUTDOWN_FAILED' }, 'Shutdown failed');
    process.exitCode = 1;
    clearTimeout(deadline);
  }
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
try {
  const pool = await getConnection();
  startupStage = 'migration';
  const ready = (await pool.request().query('SELECT version FROM "SchemaMigrations" WHERE version=1'))
    .recordset;
  if (!ready.length) throw new Error('Migration required');
  if (config.hl7.enabled) {
    startupStage = 'mllp';
    mllp = await startHl7Listener();
  }
  startupStage = 'http';
  http = await new Promise<Server>((resolve, reject) => {
    const server = app.listen(config.server.port, config.server.host, () => resolve(server));
    server.once('error', reject);
  });
  http.requestTimeout = config.transport.timeout + config.server.shutdownTimeout;
  http.headersTimeout = 15000;
  http.keepAliveTimeout = 5000;
  startWorkers();
  logger.info({ port: config.server.port }, 'Integration engine started');
} catch (error) {
  const cause = safeError(error);
  logger.error(
    {
      code: 'STARTUP_FAILED',
      cause,
      stage: startupStage,
      ...(startupStage === 'mllp' || startupStage === 'http'
        ? { port: startupStage === 'mllp' ? config.hl7.port : config.server.port }
        : {}),
    },
    cause === 'EADDRINUSE'
      ? 'Port already in use; stop the other backend instance before starting'
      : 'Startup failed; check the reported stage, configuration and database connectivity',
  );
  process.exitCode = 1;
  await shutdown();
}
