import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Item, Category, Customer, withTransaction, createWithId, StockMovement } from '../db';
import { asyncH, badRequest, forbidden } from '../errors';
import { audit } from '../audit';

const router = Router();

function can(req: Request, perm: string): boolean {
  return req.user!.role === 'super_admin' || req.user!.permissions.includes(perm);
}

const MAX_ROWS = 500;

/**
 * Bulk import. Body: { type: 'items'|'customers', rows: [{...}] }.
 * Per-row validation; good rows insert, bad rows report. Runs in one transaction.
 */
router.post(
  '/',
  asyncH(async (req: Request, res: Response) => {
    const body = z
      .object({
        type: z.enum(['items', 'customers']),
        rows: z.array(z.record(z.any())).min(1).max(MAX_ROWS),
      })
      .parse(req.body);
    const perm = body.type === 'items' ? 'inventory.create' : 'customers.create';
    if (!can(req, perm)) throw forbidden();

    if (body.type === 'items') return importItems(req, res, body.rows);
    return importCustomers(req, res, body.rows);
  })
);

async function importItems(req: Request, res: Response, rows: any[]) {
  // preload categories + existing SKUs for fast matching
  const cats = await Category.find({ deleted_at: null }).lean();
  const catByName = new Map<string, number>();
  for (const c of cats) {
    if (c.name) catByName.set(String(c.name).trim().toLowerCase(), c.id as number);
    if (c.name_ar) catByName.set(String(c.name_ar).trim().toLowerCase(), c.id as number);
  }
  const existingSkus = new Set(
    (await Item.find({ sku: { $ne: null } }).select('sku').lean()).map((i: any) => String(i.sku).trim().toLowerCase())
  );

  const errors: { row: number; error: string }[] = [];
  const good: any[] = [];
  rows.forEach((r, idx) => {
    const name = String(r.name || r['الاسم'] || '').trim();
    if (name.length < 2) {
      errors.push({ row: idx + 1, error: 'name is required' });
      return;
    }
    const cost = Number(r.cost_price ?? r['سعر التكلفة'] ?? 0);
    const price = Number(r.selling_price ?? r['سعر البيع'] ?? 0);
    const qty = Number(r.quantity ?? r['الكمية'] ?? 0);
    if (!Number.isFinite(cost) || cost < 0) { errors.push({ row: idx + 1, error: `invalid cost_price "${r.cost_price}"` }); return; }
    if (!Number.isFinite(price) || price < 0) { errors.push({ row: idx + 1, error: `invalid selling_price "${r.selling_price}"` }); return; }
    if (!Number.isInteger(qty) || qty < 0) { errors.push({ row: idx + 1, error: `invalid quantity "${r.quantity}"` }); return; }
    const sku = String(r.sku || '').trim() || null;
    if (sku && existingSkus.has(sku.toLowerCase())) { errors.push({ row: idx + 1, error: `duplicate SKU "${sku}"` }); return; }
    if (sku) existingSkus.add(sku.toLowerCase());
    const catRaw = String(r.category ?? r['التصنيف'] ?? '').trim();
    const category_id = catRaw ? catByName.get(catRaw.toLowerCase()) || null : null;
    good.push({
      name,
      name_ar: String(r.name_ar || r['الاسم بالعربية'] || '').trim() || null,
      sku,
      barcode: String(r.barcode || '').trim() || null,
      brand: String(r.brand || r['الماركة'] || '').trim() || null,
      model: String(r.model || '').trim() || null,
      cost_price: cost,
      selling_price: price,
      quantity: qty,
      min_stock_level: Number.isFinite(Number(r.min_stock_level)) ? Number(r.min_stock_level) : 0,
      max_stock_level: Number.isFinite(Number(r.max_stock_level)) ? Number(r.max_stock_level) : 0,
      category_id,
      created_by: req.user!.id,
    });
  });

  const created = await withTransaction(async (session) => {
    const out: any[] = [];
    for (const data of good) {
      const doc = await createWithId(Item, data, session);
      if (data.quantity > 0) {
        await createWithId(
          StockMovement,
          {
            item_id: doc.id, movement_type: 'purchase', quantity: data.quantity,
            reference_type: 'import', reason: 'Opening stock via import', performed_by: req.user!.id,
          },
          session
        );
      }
      out.push(doc.toJSON());
    }
    return out;
  });

  await audit(req, { action: 'import', entity: 'item', new_value: { requested: rows.length, inserted: created.length, errors: errors.length } });
  res.json({ inserted: created.length, items: created, errors });
}

async function importCustomers(req: Request, res: Response, rows: any[]) {
  const existingPhones = new Set(
    (await Customer.find({ phone: { $ne: null } }).select('phone').lean()).map((c: any) => String(c.phone).trim())
  );
  const errors: { row: number; error: string }[] = [];
  const good: any[] = [];
  rows.forEach((r, idx) => {
    const name = String(r.name || r['الاسم'] || '').trim();
    if (name.length < 2) { errors.push({ row: idx + 1, error: 'name is required' }); return; }
    const phone = String(r.phone || r['الهاتف'] || '').trim() || null;
    if (phone) {
      if (existingPhones.has(phone)) { errors.push({ row: idx + 1, error: `duplicate phone "${phone}"` }); return; }
      existingPhones.add(phone);
    }
    good.push({
      name,
      phone,
      national_id: String(r.national_id || '').trim() || null,
      address: String(r.address || r['العنوان'] || '').trim() || null,
      notes: String(r.notes || r['ملاحظات'] || '').trim() || null,
      created_by: req.user!.id,
    });
  });

  const created = await withTransaction(async (session) => {
    const out: any[] = [];
    for (const data of good) {
      const doc = await createWithId(Customer, data, session);
      out.push(doc.toJSON());
    }
    return out;
  });

  await audit(req, { action: 'import', entity: 'customer', new_value: { requested: rows.length, inserted: created.length, errors: errors.length } });
  res.json({ inserted: created.length, customers: created, errors });
}

/** Downloadable CSV templates with Arabic + English headers. */
router.get(
  '/template/:type',
  asyncH(async (req: Request, res: Response) => {
    if (req.params.type === 'items') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="items-template.csv"');
      res.send('\uFEFFname,name_ar,sku,barcode,category,brand,cost_price,selling_price,quantity,min_stock_level\nSplit AC 1.5HP,تكييف سبليت 1.5 حصان,SKU-101,622000000001,Split AC,Carrier,18000,22500,10,3\n');
    } else if (req.params.type === 'customers') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="customers-template.csv"');
      res.send('\uFEFFname,phone,national_id,address,notes\nمحمد أحمد,01000000001,29000000000000,القاهرة,عميل جديد\n');
    } else {
      throw badRequest('Unknown template type');
    }
  })
);

export default router;
