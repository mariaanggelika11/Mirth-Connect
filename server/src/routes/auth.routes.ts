import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AuthService } from '../services/auth.services.js';
import { config } from '../config/env.js';
import { validate, registration, credentials } from '../utils/validator.js';
import { AppError } from '../utils/errors.js';
import { withTransaction } from '../config/db.js';
import { audit } from '../services/audit.services.js';
import { authenticate } from '../middleware/auth.js';
import { increment } from '../utils/runtimeMetrics.js';
import { lockFamily, revokeFamily } from '../services/sessionPolicy.services.js';
import {
  browserLogin,
  browserRefresh,
  browserLogout,
  browserActivity,
  csrfGuard,
  listSessions,
  revokeSession,
} from '../services/session.services.js';
const router = Router();
const credentialLimit = rateLimit({
  windowMs: 60000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => {
    increment('rate_limit_auth_rejections_total');
    res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: 'Too many authentication attempts',
      requestId: req.requestId,
      details: [],
    });
  },
});
const maintenanceLimit = rateLimit({
  windowMs: 60000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => {
    increment('rate_limit_session_rejections_total');
    res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: 'Too many session requests',
      requestId: req.requestId,
      details: [],
    });
  },
});
const logoutLimit = rateLimit({
  windowMs: 60000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => {
    increment('rate_limit_session_rejections_total');
    res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: 'Too many logout requests',
      requestId: req.requestId,
      details: [],
    });
  },
});
// Polling and user-activity reports must not consume the credential brute-force budget.
// Logout has its own bounded budget so a busy shared NAT cannot strand an authenticated user.
router.use((req, res, next) => {
  if (req.method === 'POST' && /^\/(?:browser\/login|login|register)\/?$/i.test(req.path))
    return next();
  if (req.method === 'POST' && /^\/(?:browser\/logout|logout)\/?$/i.test(req.path))
    return logoutLimit(req, res, next);
  return maintenanceLimit(req, res, next);
});
router.post('/browser/login', credentialLimit, validate(credentials), browserLogin);
router.post('/browser/refresh', csrfGuard, browserRefresh);
router.post('/browser/logout', csrfGuard, browserLogout);
router.post('/browser/activity', csrfGuard, authenticate, browserActivity);
router.get('/sessions', authenticate, listSessions);
router.post('/sessions/:sessionId/revoke', authenticate, revokeSession);
router.post(
  '/register',
  credentialLimit,
  (_req, _res, next) =>
    config.auth.publicRegistration
      ? next()
      : next(new AppError(403, 'REGISTRATION_DISABLED', 'Public registration is disabled')),
  validate(registration),
  async (req, res, next) => {
    try {
      const result = await AuthService.register(
        req.body.username,
        req.body.password,
        req.body.name,
        req,
      );
      req.user = { id: result.id, name: req.body.name, role: 'VIEWER' };
      res.status(201).json({ token: result.token });
    } catch (error) {
      next(error);
    }
  },
);
router.post('/login', credentialLimit, validate(credentials), async (req, res, next) => {
  try {
    const result = await AuthService.login(req.body.username, req.body.password);
    req.user = { id: result.id, name: '', role: 'VIEWER' };
    await audit('LOGIN', req, 'user', result.id);
    res.json({ token: result.token });
  } catch (error) {
    next(error);
  }
});
router.get('/me', authenticate, (req, res) =>
  res.set('Cache-Control', 'no-store').json({
    success: true,
    data: { id: req.user?.id, name: req.user?.name, role: req.user?.role },
    ...(req.browserSession
      ? { session: (({ familyId: _familyId, ...session }) => session)(req.browserSession) }
      : {}),
  }),
);
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await withTransaction(async (tx) => {
      if (req.browserSession) {
        await lockFamily(tx, req.browserSession.familyId);
        await revokeFamily(tx, req.browserSession.familyId);
      }
      await tx
        .request()
        .input('token', req.user?.tokenId)
        .input('expires', new Date((req.user?.expiresAt || 0) * 1000))
        .query(
          'INSERT INTO "RevokedTokens"(token_id,expires_at) VALUES(@token,@expires) ON CONFLICT (token_id) DO NOTHING',
        );
      await audit('LOGOUT', req, 'user', req.user?.id, tx);
    });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
export default router;
