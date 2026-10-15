import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User, createWithId, rx, strip } from '../db';
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

const USER_FIELDS = '-_id -__v -password_hash -deleted_at';

/** Staff list (staff.view). Accountants & staff with permission see basic info only. */
router.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('staff.view') && req.user!.role !== 'super_admin') {
      throw forbidden('You do not have permission to view staff');
    }
    const lp = parseList(req, { name: 'name', email: 'email', role: 'role', created_at: 'created_at', last_login: 'last_login_at' }, 'created_at');
    const filter: any = { deleted_at: null };
    if (lp.search) {
      const s = rx(lp.search);
      filter.$or = [{ name: s }, { email: s }, { phone: s }];
    }
    if (req.query.role) filter.role = req.query.role;
    const result = await runList(User, filter, lp);
    const perms = req.user!.role === 'super_admin';
    result.rows = result.rows.map((r: any) => {
      const o: any = {
        id: r.id, name: r.name, email: r.email, phone: r.phone, role: r.role,
        is_active: r.is_active, last_login_at: r.last_login_at, created_at: r.created_at,
      };
      if (perms) o.permissions = r.permissions ?? [];
      return o;
    });
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
    const user = await createWithId(User, {
      name: body.name,
      email: body.email.toLowerCase(),
      phone: body.phone || null,
      password_hash: hash,
      role: body.role,
      permissions: body.role === 'staff' ? permissions : [],
    });
    const out: any = strip(user.toObject());
    delete out.password_hash;
    delete out.deleted_at;
    await audit(req, { action: 'create', entity: 'user', entity_id: user.id, new_value: { ...out, permissions } });
    res.status(201).json({ id: out.id, name: out.name, email: out.email, phone: out.phone, role: out.role, is_active: out.is_active, created_at: out.created_at });
  })
);

/** Update basic info — Super Admin only. */
router.patch(
  '/:id',
  requireSuperAdmin,
  asyncH(async (req: Request, res: Response) => {
    const body = userBody.partial().parse(req.body);
    const user: any = await User.findOne({ id: Number(req.params.id), deleted_at: null }).lean();
    if (!user) throw badRequest('User not found');
    if (user.role === 'super_admin' && body.role && body.role !== 'super_admin') {
      const count = await User.countDocuments({ role: 'super_admin', deleted_at: null, is_active: true });
      if (count <= 1) throw badRequest('Cannot demote the only Super Admin');
    }
    const update: any = { updated_at: new Date() };
    if (body.name != null) update.name = body.name;
    if (body.email != null) update.email = body.email.toLowerCase();
    if (body.phone !== undefined) update.phone = body.phone;
    if (body.role != null) update.role = body.role;
    await User.updateOne({ id: user.id }, update);
    const fresh: any = await User.findOne({ id: user.id }).lean();
    const out = {
      id: fresh.id, name: fresh.name, email: fresh.email, phone: fresh.phone, role: fresh.role, is_active: fresh.is_active,
    };
    await audit(req, { action: 'update', entity: 'user', entity_id: req.params.id, old_value: user, new_value: out });
    res.json(out);
  })
);

/** Replace the permission matrix — Super Admin only. Changes apply immediately. */
router.put(
  '/:id/permissions',
  requireSuperAdmin,
  asyncH(async (req: Request, res: Response) => {
    const { permissions } = z.object({ permissions: z.array(z.string()) }).parse(req.body);
    const user: any = await User.findOne({ id: Number(req.params.id), deleted_at: null }).lean();
    if (!user) throw badRequest('User not found');
    if (user.role !== 'staff') throw badRequest('Custom permissions only apply to staff users');
    const old = user.permissions ?? [];
    await User.updateOne({ id: user.id }, { permissions: [...new Set(permissions)], updated_at: new Date() });
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
    if (Number(req.params.id) === Number(req.user!.id)) throw badRequest('You cannot deactivate your own account');
    const old: any = await User.findOne({ id: Number(req.params.id) }).lean();
    await User.updateOne({ id: Number(req.params.id) }, { is_active: false, updated_at: new Date() });
    await audit(req, { action: 'deactivate', entity: 'user', entity_id: req.params.id, old_value: old ? { is_active: old.is_active } : null, new_value: { is_active: false } });
    res.json({ ok: true });
  })
);

router.post(
  '/:id/activate',
  requireSuperAdmin,
  asyncH(async (req: Request, res: Response) => {
    await User.updateOne({ id: Number(req.params.id) }, { is_active: true, updated_at: new Date() });
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
    await User.updateOne({ id: Number(req.params.id) }, { password_hash: hash, updated_at: new Date() });
    await audit(req, { action: 'admin_password_reset', entity: 'user', entity_id: req.params.id });
    res.json({ ok: true });
  })
);

export default router;
