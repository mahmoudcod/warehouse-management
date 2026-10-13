import { Response } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function badRequest(msg: string): AppError {
  return new AppError(400, msg);
}
export function unauthorized(msg = 'Authentication required'): AppError {
  return new AppError(401, msg);
}
export function forbidden(msg = 'You do not have permission to perform this action'): AppError {
  return new AppError(403, msg);
}
export function notFound(msg = 'Not found'): AppError {
  return new AppError(404, msg);
}

export function handleError(err: any, res: Response) {
  if (err instanceof ZodError) {
    const msg = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    return res.status(400).json({ error: msg });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message });
  }
  // Postgres check-violation / unique etc.
  if (err && err.code === '23514') {
    return res.status(400).json({ error: 'Operation violates a data constraint (e.g. stock cannot go negative)' });
  }
  if (err && err.code === '23505') {
    return res.status(409).json({ error: 'A record with the same unique value already exists' });
  }
  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}

/** Wrap async handlers so rejections reach the error middleware. */
export function asyncH(fn: (req: any, res: Response, next: any) => Promise<any>) {
  return (req: any, res: Response, next: any) => {
    fn(req, res, next).catch(next);
  };
}
