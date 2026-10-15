import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Setting, strip } from '../db';
import { asyncH, forbidden } from '../errors';
import { audit } from '../audit';
import { requireSuperAdmin } from '../middleware/auth';

const router = Router();

async function getSettingsRow(): Promise<any> {
  let s: any = await Setting.findOne({ id: 1 }).lean();
  if (!s) {
    await Setting.updateOne({ id: 1 }, {}, { upsert: true });
    s = await Setting.findOne({ id: 1 }).lean();
  }
  return strip(s);
}

router.get(
  '/',
  asyncH(async (_req: Request, res: Response) => {
    const s = await getSettingsRow();
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
    const old = await getSettingsRow();
    const update: any = { updated_at: new Date() };
    if (body.company_name != null) update.company_name = body.company_name;
    if (body.company_name_en !== undefined) update.company_name_en = body.company_name_en;
    if (body.company_phone !== undefined) update.company_phone = body.company_phone;
    if (body.company_address !== undefined) update.company_address = body.company_address;
    if (body.logo_url != null) update.logo_url = body.logo_url;
    if (body.currency != null) update.currency = body.currency;
    if (body.tax_enabled != null) update.tax_enabled = body.tax_enabled;
    if (body.tax_rate != null) update.tax_rate = body.tax_rate;
    if (body.receipt_footer !== undefined) update.receipt_footer = body.receipt_footer;
    if (body.notifications) update.notifications = body.notifications;
    await Setting.updateOne({ id: 1 }, update);
    const fresh = await getSettingsRow();
    await audit(req, { action: 'update', entity: 'settings', old_value: old, new_value: fresh });
    fresh.tax_rate = Number(fresh.tax_rate);
    res.json(fresh);
  })
);

/** Full data backup (JSON) — Super Admin only. */
router.get(
  '/backup',
  requireSuperAdmin,
  asyncH(async (_req: Request, res: Response) => {
    const {
      User, Customer, Category, Warehouse, Item, ItemUnit, StockMovement, Assignment, Payment,
      Account, TransactionCategory, Transaction, Transfer, ClosedPeriod, DailyClose,
      InstallmentPlan, InstallmentSchedule,
    } = await import('../db');
    const tables: Record<string, () => Promise<any[]>> = {
      users: () => User.find().lean(),
      user_permissions: async () =>
        (await User.find({ role: 'staff' }).lean()).map((u: any) => ({ user_id: u.id, permissions: u.permissions ?? [] })),
      customers: () => Customer.find().lean(),
      categories: () => Category.find().lean(),
      warehouses: () => Warehouse.find().lean(),
      items: () => Item.find().lean(),
      item_units: () => ItemUnit.find().lean(),
      stock_movements: () => StockMovement.find().lean(),
      assignments: () => Assignment.find().lean(),
      payments: () => Payment.find().lean(),
      accounts: () => Account.find().lean(),
      transaction_categories: () => TransactionCategory.find().lean(),
      transactions: () => Transaction.find().lean(),
      transfers: () => Transfer.find().lean(),
      closed_periods: () => ClosedPeriod.find().lean(),
      daily_closes: () => DailyClose.find().lean(),
      installment_plans: () => InstallmentPlan.find().lean(),
      installment_schedule: () => InstallmentSchedule.find().lean(),
      settings: () => Setting.find().lean(),
    };
    const backup: Record<string, any[]> = {};
    for (const [t, fn] of Object.entries(tables)) {
      backup[t] = (await fn()).map(strip);
    }
    await audit({ headers: {}, socket: { remoteAddress: 'self' }, user: { id: '', name: 'system' } } as any, {
      action: 'backup_export', entity: 'settings',
    });
    res.setHeader('Content-Disposition', `attachment; filename="warehouse-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ exported_at: new Date().toISOString(), data: backup });
  })
);

export default router;
