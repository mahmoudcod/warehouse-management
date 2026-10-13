import { NextFunction, Request, Response } from 'express';

/** Simple in-memory sliding-window limiter — protects login & password reset against brute force. */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(keyFn: (req: Request) => string, max: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyFn(req);
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || b.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    b.count += 1;
    if (b.count > max) {
      res.set('Retry-After', String(Math.ceil((b.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many attempts — try again later' });
    }
    next();
  };
}

export function clientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}
