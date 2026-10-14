import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../db';
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

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '12h' });
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
    const r = await query(
      `select u.id, u.name, u.email, u.phone, u.role, u.is_active,
              coalesce(json_agg(up.permission) filter (where up.permission is not null), '[]') as stored_permissions
       from users u
       left join user_permissions up on up.user_id = u.id
       where u.id = $1 and u.deleted_at is null
       group by u.id`,
      [payload.sub]
    );
    const row = r.rows[0];
    if (!row) throw unauthorized();
    if (!row.is_active) throw unauthorized('This account has been deactivated');
    req.user = {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      role: row.role,
      is_active: row.is_active,
      permissions: effectivePermissions(row.role, row.stored_permissions),
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
