import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { query } from '../db';
import { asyncH, badRequest, unauthorized } from '../errors';
import { audit } from '../audit';
import { clientIp, rateLimit } from '../rateLimit';
import { signToken, authenticate } from '../middleware/auth';

const router = Router();

const loginSchema = z.object({
  identifier: z.string().min(3), // email or phone
  password: z.string().min(1),
});

router.post(
  '/login',
  rateLimit((req) => `login:${clientIp(req)}`, 10, 15 * 60 * 1000),
  asyncH(async (req: Request, res: Response) => {
    const body = loginSchema.parse(req.body);
    const r = await query(
      `select * from users where deleted_at is null and (email = $1 or phone = $1) limit 1`,
      [body.identifier.trim().toLowerCase()]
    );
    const user = r.rows[0];
    const ok = user && (await bcrypt.compare(body.password, user.password_hash));
    if (!ok) {
      await audit(req, { action: 'login_failed', entity: 'user', new_value: { identifier: body.identifier } });
      throw unauthorized('Incorrect email/phone or password');
    }
    if (!user.is_active) throw unauthorized('This account has been deactivated — contact the administrator');
    await query(`update users set last_login_at = now() where id = $1`, [user.id]);
    await audit(req, { action: 'login', entity: 'user', entity_id: user.id, new_value: { name: user.name } });
    res.json({
      token: signToken(user.id),
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role },
    });
  })
);

router.post(
  '/logout',
  authenticate,
  asyncH(async (req: Request, res: Response) => {
    await audit(req, { action: 'logout', entity: 'user', entity_id: req.user?.id });
    res.json({ ok: true });
  })
);

router.get(
  '/me',
  authenticate,
  asyncH(async (req: Request, res: Response) => {
    if (!req.user) throw unauthorized();
    res.json({ user: req.user });
  })
);

// ---- Forgot / reset password ----
router.post(
  '/forgot-password',
  rateLimit((req) => `forgot:${clientIp(req)}`, 5, 15 * 60 * 1000),
  asyncH(async (req: Request, res: Response) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const r = await query(`select id from users where email = $1 and deleted_at is null`, [email.toLowerCase()]);
    const user = r.rows[0];
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await query(
        `insert into password_resets (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 hour')`,
        [user.id, tokenHash]
      );
      await audit(req, { action: 'password_reset_requested', entity: 'user', entity_id: user.id });
      // No mail server in this deployment: the link is logged and can be handed to the user.
      console.log(`[reset-link] /#/reset-password?token=${token}`);
    }
    // Always the same response — do not reveal whether the account exists.
    res.json({ ok: true, message: 'If the account exists, a reset link has been generated.' });
  })
);

router.post(
  '/reset-password',
  rateLimit((req) => `reset:${clientIp(req)}`, 10, 15 * 60 * 1000),
  asyncH(async (req: Request, res: Response) => {
    const { token, password } = z
      .object({ token: z.string().min(10), password: z.string().min(8) })
      .parse(req.body);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const r = await query(
      `select * from password_resets where token_hash = $1 and used_at is null and expires_at > now() limit 1`,
      [tokenHash]
    );
    const reset = r.rows[0];
    if (!reset) throw badRequest('Reset link is invalid or has expired');
    const hash = await bcrypt.hash(password, 10);
    await query(`update users set password_hash = $2, updated_at = now() where id = $1`, [reset.user_id, hash]);
    await query(`update password_resets set used_at = now() where id = $1`, [reset.id]);
    await audit(req, { action: 'password_reset', entity: 'user', entity_id: reset.user_id });
    res.json({ ok: true });
  })
);

router.post(
  '/change-password',
  authenticate,
  asyncH(async (req: Request, res: Response) => {
    const { currentPassword, newPassword } = z
      .object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) })
      .parse(req.body);
    const r = await query(`select password_hash from users where id = $1`, [req.user!.id]);
    const ok = await bcrypt.compare(currentPassword, r.rows[0].password_hash);
    if (!ok) throw badRequest('Current password is incorrect');
    const hash = await bcrypt.hash(newPassword, 10);
    await query(`update users set password_hash = $2, updated_at = now() where id = $1`, [req.user!.id, hash]);
    await audit(req, { action: 'password_changed', entity: 'user', entity_id: req.user!.id });
    res.json({ ok: true });
  })
);

export default router;
