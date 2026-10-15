import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../db';
import { AuthUser, effectivePermissions, hasPermission } from '../permissions';
import { forbidden, unauthorized } from '../errors';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export { effectivePermissions };

export function signToken(userId: string | number): string {
  return jwt.sign({ sub: String(userId) }, JWT_SECRET, { expiresIn: '12h' });
}

/**
 * Verifies the bearer token AND re-loads the user from the DB on every request,
 * so deactivation / permission changes apply immediately.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw unauthorized();
    let payload: any;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      throw unauthorized('Session expired or invalid — please sign in again');
    }
    const user: any = await User.findOne({ id: Number(payload.sub), deleted_at: null }).lean();
    if (!user) throw unauthorized();
    if (!user.is_active) throw unauthorized('This account has been deactivated');
    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      is_active: user.is_active,
      permissions: effectivePermissions(user.role, user.permissions ?? []),
    };
    next();
  } catch (e) {
    next(e);
  }
}

/** Route guard: requires the exact permission (server-side enforcement of RBAC). */
export function requirePerm(perm: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!hasPermission(req.user, perm)) return next(forbidden());
    next();
  };
}

export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'super_admin') return next(forbidden('Super Admin only'));
  next();
}
