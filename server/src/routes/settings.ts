import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { asyncH, forbidden } from '../errors';
import { audit } from '../audit';
import { requireSuperAdmin } from '../middleware/auth';

const router = Router();

router.get(
  '/',
  asyncH(async (_req: Request, res: Response) => {
    const r = await query(`select * from settings where id = 1`);
    const s = r.rows[0];
    s.tax_rate = Number(s.tax_rate);
    res.json(s);
  })
);

router.put(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('settings.edit')) throw forbidden();
    const body = z
      .object({
        company_name: z.string().min(2).optional(),
        company_name_en: z.string().optional().nullable(),
        company_phone: z.string().optional().nullable(),
        company_address: z.string().optional().nullable(),
        logo_url: z.string().optional().nullable(),
        currency: z.string().optional(),
        tax_enabled: z.boolean().optional(),
        tax_rate: z.number().min(0).max(100).optional(),
        receipt_footer: z.string().optional().nullable(),
        notifications: z.record(z.boolean()).optional(),
      })
      .parse(req.body);
    const old = (await query(`select * from settings where id=1`)).rows[0];
    const r = await query(
      `update settings set company_name=coalesce($2,company_name), company_name_en=$3, company_phone=$4,
        company_address=$5, logo_url=coalesce($6,logo_url), currency=coalesce($7,currency),
        tax_enabled=coalesce($8,tax_enabled), tax_rate=coalesce($9,tax_rate),
        receipt_footer=$10, notifications=coalesce($11,notifications), updated_at=now()
       where id=1 returning *`,
      [1, body.company_name ?? null, body.company_name_en ?? old.company_name_en, body.company_phone ?? old.company_phone,
       body.company_address ?? old.company_address, body.logo_url ?? null, body.currency ?? null,
       body.tax_enabled ?? null, body.tax_rate ?? null, body.receipt_footer ?? null,
       body.notifications ? JSON.stringify(body.notifications) : null]
    );
    await audit(req, { action: 'update', entity: 'settings', old_value: old, new_value: r.rows[0] });
    const s = r.rows[0];
    s.tax_rate = Number(s.tax_rate);
    res.json(s);
  })
);

/** Full data backup (JSON) — Super Admin only. */
router.get(
  '/backup',
  requireSuperAdmin,
  asyncH(async (_req: Request, res: Response) => {
    const tables = [
      'users', 'user_permissions', 'customers', 'categories', 'warehouses', 'items', 'item_units',
      'stock_movements', 'assignments', 'payments', 'accounts', 'transaction_categories', 'transactions',
      'transfers', 'closed_periods', 'daily_closes', 'installment_plans', 'installment_schedule', 'settings',
    ];
    const backup: Record<string, any[]> = {};
    for (const t of tables) {
      backup[t] = (await query(`select * from ${t}`)).rows;
    }
    await audit({ headers: {}, socket: { remoteAddress: 'self' }, user: { id: '', name: 'system' } } as any, {
      action: 'backup_export', entity: 'settings',
    });
    res.setHeader('Content-Disposition', `attachment; filename="warehouse-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ exported_at: new Date().toISOString(), data: backup });
  })
);

export default router;
