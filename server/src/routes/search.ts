import { Router, Request, Response } from 'express';
import { Customer, Item, ItemUnit, rx, strip } from '../db';
import { asyncH } from '../errors';

const router = Router();

/** Global topbar search: customers + items (serial/sku/barcode aware). */
router.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ customers: [], items: [] });
    const s = rx(q);
    const perms = req.user!.permissions;
    const customers = perms.includes('customers.view')
      ? (await Customer.find({ deleted_at: null, $or: [{ name: s }, { phone: s }] })
          .limit(5)
          .lean()).map((c: any) => ({ id: c.id, name: c.name, phone: c.phone }))
      : [];
    let items: any[] = [];
    if (perms.includes('inventory.view')) {
      const unitItems = await ItemUnit.find({ serial: s, deleted_at: null }).lean();
      const or: any[] = [{ name: s }, { name_ar: s }, { sku: s }, { barcode: s }];
      if (unitItems.length) or.push({ id: { $in: [...new Set(unitItems.map((u: any) => u.item_id))] } });
      items = (await Item.find({ deleted_at: null, $or: or }).limit(5).lean()).map((i: any) => ({
        id: i.id, name: i.name, name_ar: i.name_ar, sku: i.sku, quantity: Number(i.quantity),
      }));
    }
    res.json({ customers, items });
  })
);

export default router;
