import type { NextFunction, Request, Response } from 'express';
import { AppError } from './errors';

export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
};

export const errorMiddleware = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      details: err.details,
    });
  }

  const message = err instanceof Error ? err.message : 'Internal server error';
  return res.status(500).json({
    error: message,
    code: 'INTERNAL_SERVER_ERROR',
  });
};
