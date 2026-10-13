import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db';
import { asyncH, badRequest, forbidden } from '../errors';
import { audit } from '../audit';
import { requireSuperAdmin } from '../middleware/auth';
import { parseList, runList } from '../paging';

const router = Router();

const userBody = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  password: z.string().min(8).optional(),
  role: z.enum(['super_admin', 'accountant', 'staff']),
  is_active: z.boolean().optional(),
});

/** Staff list (staff.view). Accountants & staff with permission see basic info only. */
router.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('staff.view') && req.user!.role !== 'super_admin') {
      throw forbidden('You do not have permission to view staff');
    }
    const lp = parseList(req, { name: 'u.name', email: 'u.email', role: 'u.role', created_at: 'u.created_at', last_login: 'u.last_login_at' }, 'created_at');
    const params: any[] = [];
    let where = `u.deleted_at is null`;
    if (lp.search) {
      params.push(`%${lp.search}%`);
      where += ` and (u.name ilike $1 or u.email ilike $1 or coalesce(u.phone,'') ilike $1)`;
    }
    if (req.query.role) {
      params.push(req.query.role);
      where += ` and u.role = $${params.length}`;
    }
    const perms = req.user!.role === 'super_admin';
    const permsSel = perms
      ? `, (select json_agg(p.permission order by p.permission) from user_permissions p where p.user_id = u.id) as permissions`
      : '';
    const result = await runList(
      `select u.id, u.name, u.email, u.phone, u.role, u.is_active, u.last_login_at, u.created_at${permsSel}
       from users u where ${where}`,
      `select count(*) from users u where ${where}`,
      params,
      lp
    );
    res.json(result);
  })
);

/** Create a staff account — Super Admin only. */
router.post(
  '/',
  requireSuperAdmin,
  asyncH(async (req: Request, res: Response) => {
    const body = userBody.parse(req.body);
    const permissions = Array.isArray(req.body.permissions) ? [...new Set(req.body.permissions as string[])] : [];
    if (body.role === 'staff' && permissions.length === 0) throw badRequest('A staff user needs at least one permission');
    const hash = await bcrypt.hash(body.password || 'Welcome@123', 10);
    const r = await query(
      `insert into users (name, email, phone, password_hash, role) values ($1,$2,$3,$4,$5) returning id, name, email, phone, role, is_active, created_at`,
      [body.name, body.email.toLowerCase(), body.phone || null, hash, body.role]
    );
    const user = r.rows[0];
    if (body.role === 'staff' && permissions.length) {
      await query(
        `insert into user_permissions (user_id, permission, granted_by) select $1, p, $2 from unnest($3::text[]) p`,
        [user.id, req.user!.id, permissions]
      );
    }
    await audit(req, { action: 'create', entity: 'user', entity_id: user.id, new_value: { ...user, permissions } });
    res.status(201).json(user);
  })
);

/** Update basic info — Super Admin only. */
router.patch(
  '/:id',
  requireSuperAdmin,
  asyncH(async (req: Request, res: Response) => {
    const body = userBody.partial().parse(req.body);
    const old = (await query(`select * from users where id = $1 and deleted_at is null`, [req.params.id])).rows[0];
    if (!old) throw badRequest('User not found');
    if (old.role === 'super_admin' && body.role && body.role !== 'super_admin') {
      const count = await query(`select count(*) c from users where role='super_admin' and deleted_at is null and is_active`);
      if (Number(count.rows[0].c) <= 1) throw badRequest('Cannot demote the only Super Admin');
    }
    const r = await query(
      `update users set name = coalesce($2, name), email = coalesce($3, email), phone = $4,
        role = coalesce($5, role), updated_at = now()
       where id = $1 returning id, name, email, phone, role, is_active`,
      [req.params.id, body.name, body.email?.toLowerCase(), body.phone ?? old.phone, body.role || null]
    );
    await audit(req, { action: 'update', entity: 'user', entity_id: req.params.id, old_value: old, new_value: r.rows[0] });
    res.json(r.rows[0]);
  })
);

/** Replace the permission matrix — Super Admin only. Changes apply immediately. */
router.put(
  '/:id/permissions',
  requireSuperAdmin,
  asyncH(async (req: Request, res: Response) => {
    const { permissions } = z.object({ permissions: z.array(z.string()) }).parse(req.body);
    const user = (await query(`select * from users where id = $1 and deleted_at is null`, [req.params.id])).rows[0];
    if (!user) throw badRequest('User not found');
    if (user.role !== 'staff') throw badRequest('Custom permissions only apply to staff users');
    const old = (await query(`select json_agg(permission) p from user_permissions where user_id = $1`, [user.id])).rows[0].p || [];
    await query(`delete from user_permissions where user_id = $1`, [user.id]);
    if (permissions.length) {
      await query(
        `insert into user_permissions (user_id, permission, granted_by) select $1, p, $2 from unnest($3::text[]) p`,
        [user.id, req.user!.id, [...new Set(permissions)]]
      );
    }
    await audit(req, {
      action: 'permission_change', entity: 'user', entity_id: user.id,
      old_value: { permissions: old }, new_value: { permissions },
    });
    res.json({ ok: true, permissions });
  })
);

/** Activate / deactivate. Deactivation kills access on the next request (token re-checks DB). */
router.post(
  '/:id/deactivate',
  requireSuperAdmin,
  asyncH(async (req: Request, res: Response) => {
    if (req.params.id === req.user!.id) throw badRequest('You cannot deactivate your own account');
    const old = (await query(`select is_active from users where id = $1`, [req.params.id])).rows[0];
    await query(`update users set is_active = false, updated_at = now() where id = $1`, [req.params.id]);
    await audit(req, { action: 'deactivate', entity: 'user', entity_id: req.params.id, old_value: old, new_value: { is_active: false } });
    res.json({ ok: true });
  })
);

router.post(
  '/:id/activate',
  requireSuperAdmin,
  asyncH(async (req: Request, res: Response) => {
    await query(`update users set is_active = true, updated_at = now() where id = $1`, [req.params.id]);
    await audit(req, { action: 'activate', entity: 'user', entity_id: req.params.id, new_value: { is_active: true } });
    res.json({ ok: true });
  })
);

/** Super Admin sets a new password for a user. */
router.post(
  '/:id/reset-password',
  requireSuperAdmin,
  asyncH(async (req: Request, res: Response) => {
    const { password } = z.object({ password: z.string().min(8) }).parse(req.body);
    const hash = await bcrypt.hash(password, 10);
    await query(`update users set password_hash = $2, updated_at = now() where id = $1`, [req.params.id, hash]);
    await audit(req, { action: 'admin_password_reset', entity: 'user', entity_id: req.params.id });
    res.json({ ok: true });
  })
);

export default router;
