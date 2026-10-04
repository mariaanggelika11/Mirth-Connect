import { ErrorRequestHandler } from 'express';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const status =
    error instanceof AppError
      ? error.status
      : error?.type === 'entity.too.large'
        ? 413
        : error instanceof SyntaxError
          ? 400
          : 500;
  const code =
    error instanceof AppError
      ? error.code
      : status === 413
        ? 'PAYLOAD_TOO_LARGE'
        : status === 400
          ? 'INVALID_BODY'
          : 'INTERNAL_ERROR';
  logger.error({ requestId: req.requestId, code }, 'Request failed');
  if (!res.headersSent)
    res
      .status(status)
      .json({
        success: false,
        code,
        message:
          error instanceof AppError
            ? error.message
            : status === 500
              ? 'Internal server error'
              : 'Invalid request body',
        requestId: req.requestId,
      });
};
