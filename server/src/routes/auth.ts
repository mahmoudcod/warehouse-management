import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { User, PasswordReset, createWithId } from '../db';
import { asyncH, badRequest, unauthorized } from '../errors';
import { audit } from '../audit';
import { clientIp, rateLimit } from '../rateLimit';
import { signToken, authenticate, effectivePermissions } from '../middleware/auth';

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
    const ident = body.identifier.trim().toLowerCase();
    const user: any = await User.findOne({
      deleted_at: null,
      $or: [{ email: ident }, { phone: body.identifier.trim() }],
    }).lean();
    const ok = user && (await bcrypt.compare(body.password, user.password_hash));
    if (!ok) {
      await audit(req, { action: 'login_failed', entity: 'user', new_value: { identifier: body.identifier } });
      throw unauthorized('Incorrect email/phone or password');
    }
    if (!user.is_active) throw unauthorized('This account has been deactivated — contact the administrator');
    await User.updateOne({ id: user.id }, { last_login_at: new Date() });
    await audit(req, { action: 'login', entity: 'user', entity_id: user.id, new_value: { name: user.name } });
    const permissions = effectivePermissions(user.role, user.permissions ?? []);
    res.json({
      token: signToken(user.id),
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, is_active: user.is_active, permissions },
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
    const user: any = await User.findOne({ email: email.toLowerCase(), deleted_at: null }).lean();
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await createWithId(PasswordReset, {
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      });
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
    const reset: any = await PasswordReset.findOne({
      token_hash: tokenHash,
      used_at: null,
      expires_at: { $gt: new Date() },
    }).lean();
    if (!reset) throw badRequest('Reset link is invalid or has expired');
    const hash = await bcrypt.hash(password, 10);
    await User.updateOne({ id: reset.user_id }, { password_hash: hash, updated_at: new Date() });
    await PasswordReset.updateOne({ id: reset.id }, { used_at: new Date() });
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
    const user: any = await User.findOne({ id: req.user!.id }).lean();
    const ok = user && (await bcrypt.compare(currentPassword, user.password_hash));
    if (!ok) throw badRequest('Current password is incorrect');
    const hash = await bcrypt.hash(newPassword, 10);
    await User.updateOne({ id: req.user!.id }, { password_hash: hash, updated_at: new Date() });
    await audit(req, { action: 'password_changed', entity: 'user', entity_id: req.user!.id });
    res.json({ ok: true });
  })
);

export default router;
