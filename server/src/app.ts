import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rateLimit } from 'express-rate-limit';
import { config } from './config/env.js';
import { getConnection } from './config/db.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authenticate, requirePermission } from './middleware/auth.js';
import { validateId } from './utils/validator.js';
import { AppError } from './utils/errors.js';
import { logger } from './utils/logger.js';
import authRoutes from './routes/auth.routes.js';
import channelRoutes from './routes/channel.routes.js';
import destinationRoutes from './routes/destination.routes.js';
import messageRoutes from './routes/message.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import usersRoutes from './routes/users.routes.js';
import { decrypt } from './utils/secrets.js';
import hl7Routes from './routes/hl7.js';
import { handleInboundMessage } from './services/message.services.js';
export const app = express();
app.disable('x-powered-by');
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  res.on('finish', () =>
    logger.info(
      { requestId: req.requestId, status: res.statusCode, method: req.method },
      'HTTP request completed',
    ),
  );
  next();
});
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", ...config.cors.allowedOrigins],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.production ? [] : null,
      },
    },
  }),
);
app.use(
  cors({
    origin: (origin, done) => {
      if (!origin || config.cors.allowedOrigins.includes(origin)) done(null, true);
      else done(new AppError(403, 'CORS_DENIED', 'Origin not allowed'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    exposedHeaders: ['X-Request-Id'],
  }),
);
app.get(['/health', '/api/status'], (_req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() }),
);
app.get('/ready', async (_req, res) => {
  try {
    const pool = await getConnection();
    await pool.request().query('SELECT 1');
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not_ready' });
  }
});
app.post(
  config.inbound.path + '/:channelId',
  validateId,
  async (req, res, next) => {
    try {
      const pool = await getConnection();
      const channel = (
        await pool
          .request()
          .input('id', Number(req.params.channelId))
          .query('SELECT source_api_key FROM "Channels" WHERE id=@id')
      ).recordset[0];
      if (!channel) throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Channel not found');
      const expected = channel.source_api_key
        ? decrypt(channel.source_api_key)
        : config.production
          ? ''
          : config.inbound.apiKey;
      const a = Buffer.from(req.get('X-API-Key') || ''),
        b = Buffer.from(expected);
      if (!b.length || a.length !== b.length || !timingSafeEqual(a, b))
        throw new AppError(401, 'CONNECTOR_UNAUTHORIZED', 'Invalid connector credential');
      next();
    } catch (error) {
      next(error);
    }
  },
  express.text({ type: '*/*', limit: config.server.payloadLimit }),
  handleInboundMessage,
);
app.use('/api/auth', express.json({ limit: config.server.payloadLimit }), authRoutes);
const managementLimit = rateLimit({
  windowMs: 60000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many management requests' },
});
app.use('/api/upload', managementLimit, authenticate, uploadRoutes);
app.use(
  '/api/users',
  managementLimit,
  authenticate,
  express.json({ limit: config.server.payloadLimit }),
  usersRoutes,
);
app.use(
  '/api/channel',
  managementLimit,
  authenticate,
  express.json({ limit: config.server.payloadLimit }),
  channelRoutes,
);
app.use('/api/destination', managementLimit, authenticate, destinationRoutes);
app.use('/api/message', managementLimit, authenticate, messageRoutes);
app.use(
  '/api/hl7',
  managementLimit,
  authenticate,
  express.json({ limit: config.server.payloadLimit }),
  hl7Routes,
);
app.get(
  '/api/audit',
  managementLimit,
  authenticate,
  requirePermission('audit:read'),
  async (req, res, next) => {
    try {
      const pool = await getConnection();
      const page = Number(req.query.page || 1);
      if (!Number.isSafeInteger(page) || page < 1 || page > 1000000)
        throw new AppError(400, 'INVALID_QUERY', 'Invalid page');
      const rows = await pool
        .request()
        .input('offset', (page - 1) * 50)
        .query(
          'SELECT * FROM "AuditLog" ORDER BY id DESC LIMIT 50 OFFSET @offset',
        );
      res.json({ success: true, data: rows.recordset, page });
    } catch (error) {
      next(error);
    }
  },
);
// Unknown API requests must not receive a misleading HTML success response.
app.use('/api', (_req, _res, next) =>
  next(new AppError(404, 'NOT_FOUND', 'API endpoint not found')),
);
const publicPath = fileURLToPath(new URL('../public', import.meta.url));
app.use(express.static(publicPath));
app.get('*', (_req, res) => res.sendFile(path.join(publicPath, 'index.html')));
app.use(errorHandler);
export default app;
