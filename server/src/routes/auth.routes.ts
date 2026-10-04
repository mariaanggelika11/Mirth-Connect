import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AuthService } from '../services/auth.services.js';
import { config } from '../config/env.js';
import { validate, registration, credentials } from '../utils/validator.js';
import { AppError } from '../utils/errors.js';
import { withTransaction } from '../config/db.js';
import { audit } from '../services/audit.services.js';
import { authenticate } from '../middleware/auth.js';
const router = Router();
router.use(
  rateLimit({
    windowMs: 60000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, code: 'RATE_LIMITED', message: 'Too many authentication attempts' },
  }),
);
router.post(
  '/register',
  (req, _res, next) =>
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
router.post('/login', validate(credentials), async (req, res, next) => {
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
  res.json({
    success: true,
    data: { id: req.user?.id, name: req.user?.name, role: req.user?.role },
  }),
);
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await withTransaction(async (tx) => {
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
