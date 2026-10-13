import { Router, Request, Response } from 'express';
import { query } from '../db';
import { asyncH } from '../errors';

const router = Router();

/** Global topbar search: customers + items (serial/sku/barcode aware). */
router.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ customers: [], items: [] });
    const like = `%${q}%`;
    const perms = req.user!.permissions;
    const customers = perms.includes('customers.view')
      ? (await query(
          `select id, name, phone from customers
           where deleted_at is null and (name ilike $1 or coalesce(phone,'') ilike $1) limit 5`,
          [like]
        )).rows
      : [];
    const items = perms.includes('inventory.view')
      ? (await query(
          `select i.id, i.name, i.name_ar, i.sku, i.quantity::float8 as quantity from items i
           where i.deleted_at is null and (i.name ilike $1 or coalesce(i.name_ar,'') ilike $1 or coalesce(i.sku,'') ilike $1
             or coalesce(i.barcode,'') ilike $1
             or exists(select 1 from item_units u where u.item_id = i.id and u.serial ilike $1))
           limit 5`,
          [like]
        )).rows
      : [];
    res.json({ customers, items });
  })
);

export default router;
