import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Item, ItemUnit, StockMovement, Category, Warehouse, Customer, Assignment, createWithId, withTransaction, rx, r2, strip } from '../db';
import { asyncH, badRequest, forbidden, notFound } from '../errors';
import { audit } from '../audit';
import { parseList, runList } from '../paging';

const router = Router();

const numId = z.union([z.string(), z.number()]).transform((v) => Number(v));

const itemBody = z.object({
  name: z.string().min(2),
  name_ar: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  category_id: numId.optional().nullable(),
  brand: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  cost_price: z.number().nonnegative().optional(),
  selling_price: z.number().nonnegative().optional(),
  min_stock_level: z.number().nonnegative().optional(),
  max_stock_level: z.number().nonnegative().optional(),
  warehouse_id: numId.optional().nullable(),
  track_serials: z.boolean().optional(),
  photo_url: z.string().optional().nullable(),
  status: z.enum(['active', 'archived']).optional(),
});

/** in-stock serialized-unit counts per item id */
async function unitsInStockMap(itemIds: number[]): Promise<Map<number, number>> {
  if (!itemIds.length) return new Map();
  const rows = await ItemUnit.aggregate([
    { $match: { item_id: { $in: itemIds }, status: 'in_stock', deleted_at: null } },
    { $group: { _id: '$item_id', c: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r: any) => [r._id, r.c]));
}

async function decorateItems(docs: any[]) {
  const rows = docs.map(strip);
  const unitCounts = await unitsInStockMap(rows.map((r: any) => r.id));
  const catIds = [...new Set(rows.map((r: any) => r.category_id).filter((x) => x != null))];
  const whIds = [...new Set(rows.map((r: any) => r.warehouse_id).filter((x) => x != null))];
  const [cats, whs] = await Promise.all([
    catIds.length ? Category.find({ id: { $in: catIds } }).lean() : [],
    whIds.length ? Warehouse.find({ id: { $in: whIds } }).lean() : [],
  ]);
  const catById = new Map<number, any>(cats.map((c: any) => [c.id, c] as [number, any]));
  const whById = new Map<number, any>(whs.map((w: any) => [w.id, w] as [number, any]));
  return rows.map((r: any) => {
    const cat = r.category_id ? catById.get(r.category_id) : null;
    const wh = r.warehouse_id ? whById.get(r.warehouse_id) : null;
    return {
      ...r,
      category_name: cat?.name ?? null,
      category_name_ar: cat?.name_ar ?? null,
      warehouse_name: wh?.name ?? null,
      warehouse_name_ar: wh?.name_ar ?? null,
      stock_cost_value: r2(r.cost_price * r.quantity),
      stock_sell_value: r2(r.selling_price * r.quantity),
      low_stock: r.quantity <= r.min_stock_level && r.min_stock_level > 0,
      over_stock: r.quantity > r.max_stock_level && r.max_stock_level > 0,
      units_in_stock: unitCounts.get(r.id) ?? 0,
    };
  });
}

router.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    const lp = parseList(req, { name: 'name', quantity: 'quantity', cost: 'cost_price', price: 'selling_price', created_at: 'created_at', sku: 'sku' }, 'created_at');
    const filter: any = { deleted_at: null };
    if (lp.search) {
      const s = rx(lp.search);
      const or: any[] = [{ name: s }, { name_ar: s }, { sku: s }, { barcode: s }, { brand: s }];
      const unitItems = await ItemUnit.find({ serial: s }).lean();
      if (unitItems.length) or.push({ id: { $in: [...new Set(unitItems.map((u: any) => u.item_id))] } });
      filter.$or = or;
    }
    if (req.query.category_id) filter.category_id = Number(req.query.category_id);
    if (req.query.warehouse_id) filter.warehouse_id = Number(req.query.warehouse_id);
    if (req.query.status) filter.status = req.query.status;
    if (req.query.low_stock === 'true') {
      filter.$expr = { $and: [{ $lte: ['$quantity', '$min_stock_level'] }, { $gt: ['$min_stock_level', 0] }] };
    }
    const result = await runList(Item, filter, lp);
    result.rows = await decorateItems(result.rows);
    res.json(result);
  })
);

/** Barcode / serial scanner lookup. */
router.get(
  '/lookup/:code',
  asyncH(async (req: Request, res: Response) => {
    const code = req.params.code;
    const unit = await ItemUnit.findOne({ serial: code, deleted_at: null }).lean();
    const filter: any = { deleted_at: null, $or: [{ sku: code }, { barcode: code }] };
    if (unit) filter.$or.push({ id: unit.item_id });
    const item: any = await Item.findOne(filter).lean();
    if (!item) return res.json({ item: null });
    const wh = item.warehouse_id ? await Warehouse.findOne({ id: item.warehouse_id }).lean() : null;
    res.json({ item: { ...strip(item), warehouse_name: wh?.name ?? null } });
  })
);

router.get(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    const item: any = await Item.findOne({ id: Number(req.params.id), deleted_at: null }).lean();
    if (!item) throw notFound('Item not found');
    const [cat, wh] = await Promise.all([
      item.category_id ? Category.findOne({ id: item.category_id }).lean() : null,
      item.warehouse_id ? Warehouse.findOne({ id: item.warehouse_id }).lean() : null,
    ]);
    const units = await ItemUnit.find({ item_id: item.id, deleted_at: null })
      .sort({ created_at: -1 })
      .limit(200)
      .lean();
    // attach assignment → customer info
    const aIds = [...new Set(units.map((u: any) => u.assignment_id).filter((x) => x != null))];
    const unitRows = await (async () => {
      if (!aIds.length) return units.map((u: any) => ({ ...strip(u), customer_id: null, customer_name: null }));
      const { Assignment, Customer } = await import('../db');
      const assignments: any[] = await Assignment.find({ id: { $in: aIds } }).lean();
      const cIds = [...new Set(assignments.map((a: any) => a.customer_id))];
      const customers: any[] = await Customer.find({ id: { $in: cIds } }).lean();
      const aById = new Map<number, any>(assignments.map((a: any) => [a.id, a] as [number, any]));
      const cById = new Map<number, any>(customers.map((c: any) => [c.id, c] as [number, any]));
      return units.map((u: any) => {
        const a = u.assignment_id ? aById.get(u.assignment_id) : null;
        const c = a ? cById.get(a.customer_id) : null;
        return { ...strip(u), customer_id: a?.customer_id ?? null, customer_name: c?.name ?? null };
      });
    })();
    const movements = await StockMovement.find({ item_id: item.id }).sort({ created_at: -1 }).limit(100).lean();
    const userIds = [...new Set(movements.map((m: any) => m.performed_by).filter((x) => x != null))];
    const { User } = await import('../db');
    const users = userIds.length ? await User.find({ id: { $in: userIds } }).lean() : [];
    const uById = new Map(users.map((u: any) => [u.id, u]));
    res.json({
      ...strip(item),
      category_name: cat?.name ?? null,
      warehouse_name: wh?.name ?? null,
      quantity: Number(item.quantity),
      units: unitRows,
      movements: movements.map((m: any) => ({ ...strip(m), performed_by_name: uById.get(m.performed_by)?.name ?? null })),
    });
  })
);

router.post(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.create')) throw forbidden();
    const body = itemBody.parse(req.body);
    const initialQty = Number(req.body.initial_quantity ?? 0);
    const serials: string[] = Array.isArray(req.body.serials) ? req.body.serials : [];
    const created = await withTransaction(async (session) => {
      const item: any = await createWithId(
        Item,
        {
          name: body.name,
          name_ar: body.name_ar || null,
          sku: body.sku || null,
          barcode: body.barcode || null,
          category_id: body.category_id || null,
          brand: body.brand || null,
          model: body.model || null,
          cost_price: body.cost_price ?? 0,
          selling_price: body.selling_price ?? 0,
          quantity: body.track_serials && serials.length ? serials.length : initialQty,
          min_stock_level: body.min_stock_level ?? 0,
          max_stock_level: body.max_stock_level ?? 0,
          warehouse_id: body.warehouse_id || null,
          track_serials: body.track_serials ?? false,
          photo_url: body.photo_url || null,
        },
        session
      );
      if (initialQty > 0 && !(body.track_serials && serials.length)) {
        await createWithId(
          StockMovement,
          {
            item_id: item.id, movement_type: 'purchase', quantity: initialQty,
            to_warehouse_id: body.warehouse_id || null,
            reason: 'Initial stock on item creation', performed_by: req.user!.id, reference_type: 'item_create',
          },
          session
        );
      }
      for (const s of serials) {
        await createWithId(ItemUnit, { item_id: item.id, serial: s.trim(), warehouse_id: body.warehouse_id || null }, session);
      }
      if (serials.length) {
        await createWithId(
          StockMovement,
          {
            item_id: item.id, movement_type: 'purchase', quantity: serials.length,
            to_warehouse_id: body.warehouse_id || null,
            reason: `Initial stock: ${serials.length} serialized units`, performed_by: req.user!.id, reference_type: 'item_create',
          },
          session
        );
      }
      return item;
    });
    await audit(req, { action: 'create', entity: 'item', entity_id: created.id, new_value: strip(created.toObject()) });
    res.status(201).json(strip(created.toObject()));
  })
);

router.patch(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.edit')) throw forbidden();
    const body = itemBody.partial().parse(req.body);
    const old: any = await Item.findOne({ id: Number(req.params.id), deleted_at: null }).lean();
    if (!old) throw notFound('Item not found');
    const update: any = { updated_at: new Date() };
    if (body.name != null) update.name = body.name;
    if (body.name_ar !== undefined) update.name_ar = body.name_ar;
    if (body.sku !== undefined) update.sku = body.sku;
    if (body.barcode !== undefined) update.barcode = body.barcode;
    if (body.category_id !== undefined) update.category_id = body.category_id;
    if (body.brand !== undefined) update.brand = body.brand;
    if (body.model !== undefined) update.model = body.model;
    if (body.cost_price != null) update.cost_price = body.cost_price;
    if (body.selling_price != null) update.selling_price = body.selling_price;
    if (body.min_stock_level != null) update.min_stock_level = body.min_stock_level;
    if (body.max_stock_level != null) update.max_stock_level = body.max_stock_level;
    if (body.warehouse_id !== undefined) update.warehouse_id = body.warehouse_id;
    if (body.track_serials != null) update.track_serials = body.track_serials;
    if (body.photo_url != null) update.photo_url = body.photo_url;
    if (body.status != null) update.status = body.status;
    await Item.updateOne({ id: old.id }, update);
    const fresh: any = strip(await Item.findOne({ id: old.id }).lean());
    await audit(req, { action: 'update', entity: 'item', entity_id: req.params.id, old_value: strip(old), new_value: fresh });
    res.json(fresh);
  })
);

/** Stock adjustment — always requires a reason, logged as a movement. */
router.post(
  '/:id/adjust',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.edit')) throw forbidden();
    const body = z.object({
      delta: z.number(), // positive = add, negative = remove
      reason: z.string().min(3),
    }).parse(req.body);
    const result = await withTransaction(async (session) => {
      const item: any = await Item.findOneAndUpdate(
        { id: Number(req.params.id), deleted_at: null },
        { $inc: { quantity: body.delta }, $set: { updated_at: new Date() } },
        { new: true, session }
      ).lean();
      if (!item) throw notFound('Item not found');
      if (item.quantity < 0) throw badRequest(`Adjustment would make stock negative (current: ${item.quantity - body.delta})`);
      await createWithId(
        StockMovement,
        {
          item_id: item.id, movement_type: 'adjustment', quantity: body.delta,
          reason: body.reason, performed_by: req.user!.id, reference_type: 'manual_adjustment',
        },
        session
      );
      return { item_id: item.id, quantity: item.quantity };
    });
    await audit(req, {
      action: 'stock_adjustment', entity: 'item', entity_id: req.params.id,
      old_value: { quantity: result.quantity - body.delta }, new_value: { quantity: result.quantity, reason: body.reason },
    });
    res.json(result);
  })
);

router.delete(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.delete')) throw forbidden();
    const old: any = await Item.findOne({ id: Number(req.params.id), deleted_at: null }).lean();
    if (!old) throw notFound('Item not found');
    await Item.updateOne({ id: old.id }, { deleted_at: new Date(), status: 'archived' });
    await audit(req, { action: 'delete', entity: 'item', entity_id: req.params.id, old_value: strip(old) });
    res.json({ ok: true });
  })
);

// ======================= Serialized unit operations =======================

/** Add serialized units to an existing item (each becomes an in_stock unit + adjustment movement). */
router.post(
  '/:id/units',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.edit')) throw forbidden();
    const body = z.object({ serials: z.array(z.string().min(1)).min(1).max(200) }).parse(req.body);
    const result = await withTransaction(async (session) => {
      const item: any = await Item.findOne({ id: Number(req.params.id), deleted_at: null }).session(session as any).lean();
      if (!item) throw notFound('Item not found');
      const added: string[] = [];
      for (const raw of body.serials) {
        const serial = raw.trim();
        if (!serial) continue;
        const dupe = await ItemUnit.findOne({ item_id: item.id, serial, deleted_at: null }).session(session as any).lean();
        if (dupe) throw badRequest(`Serial "${serial}" already exists for this item`);
        await createWithId(ItemUnit, { item_id: item.id, serial, warehouse_id: item.warehouse_id }, session);
        added.push(serial);
      }
      if (added.length) {
        await Item.updateOne({ id: item.id }, { $inc: { quantity: added.length }, $set: { updated_at: new Date() } }).session(session as any);
        await createWithId(
          StockMovement,
          {
            item_id: item.id, movement_type: 'adjustment', quantity: added.length,
            reason: `Added ${added.length} serialized unit(s)`, performed_by: req.user!.id, reference_type: 'units_added',
          },
          session
        );
      }
      return { added };
    });
    await audit(req, { action: 'units_added', entity: 'item', entity_id: req.params.id, new_value: { serials: result.added } });
    res.status(201).json(result);
  })
);

/** Void a serialized unit (only while in stock). Requires a reason. */
router.post(
  '/:id/units/:unitId/void',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.edit')) throw forbidden();
    const body = z.object({ reason: z.string().min(3) }).parse(req.body);
    const result = await withTransaction(async (session) => {
      const unit: any = await ItemUnit.findOne({ id: Number(req.params.unitId), item_id: Number(req.params.id), deleted_at: null }).session(session as any).lean();
      if (!unit) throw notFound('Unit not found');
      if (unit.status !== 'in_stock') throw badRequest(`Only in-stock units can be voided (current: ${unit.status})`);
      await ItemUnit.updateOne({ id: unit.id }, { status: 'void', deleted_at: new Date() }).session(session as any);
      await Item.updateOne({ id: unit.item_id }, { $inc: { quantity: -1 }, $set: { updated_at: new Date() } }).session(session as any);
      await createWithId(
        StockMovement,
        {
          item_id: unit.item_id, movement_type: 'adjustment', quantity: -1, unit_serial: unit.serial,
          reason: `Void unit ${unit.serial}: ${body.reason}`, performed_by: req.user!.id, reference_type: 'unit_void',
        },
        session
      );
      return { serial: unit.serial };
    });
    await audit(req, { action: 'unit_void', entity: 'item', entity_id: req.params.id, new_value: { ...body, ...result } });
    res.json({ ok: true, ...result });
  })
);

/** Move a specific in-stock unit to another warehouse. */
router.post(
  '/:id/units/:unitId/transfer',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.edit')) throw forbidden();
    const body = z.object({ to_warehouse_id: numId, reason: z.string().optional().nullable() }).parse(req.body);
    const unit: any = await ItemUnit.findOne({ id: Number(req.params.unitId), item_id: Number(req.params.id), deleted_at: null }).lean();
    if (!unit) throw notFound('Unit not found');
    if (unit.status !== 'in_stock') throw badRequest('Only in-stock units can be transferred');
    const wh = await Warehouse.findOne({ id: body.to_warehouse_id, deleted_at: null }).lean();
    if (!wh) throw notFound('Warehouse not found');
    await ItemUnit.updateOne({ id: unit.id }, { warehouse_id: body.to_warehouse_id });
    await createWithId(StockMovement, {
      item_id: unit.item_id, movement_type: 'transfer', quantity: 1, from_warehouse_id: unit.warehouse_id,
      to_warehouse_id: body.to_warehouse_id, unit_serial: unit.serial,
      reason: body.reason || `Unit ${unit.serial} transferred to ${wh.name}`, performed_by: req.user!.id, reference_type: 'unit_transfer',
    });
    await audit(req, { action: 'unit_transfer', entity: 'item', entity_id: req.params.id, new_value: { serial: unit.serial, to: body.to_warehouse_id } });
    res.json({ ok: true });
  })
);

/** Trace a serial anywhere: item, status, current warehouse, and the customer holding it. */
router.get(
  '/units/search',
  asyncH(async (req: Request, res: Response) => {
    const serial = String(req.query.serial || '').trim();
    if (!serial) throw badRequest('serial is required');
    const unit: any = await ItemUnit.findOne({ serial, deleted_at: null }).lean();
    if (!unit) throw notFound(`No unit with serial "${serial}"`);
    const item: any = await Item.findOne({ id: unit.item_id }).lean();
    const wh = unit.warehouse_id ? await Warehouse.findOne({ id: unit.warehouse_id }).lean() : null;
    let holder: any = null;
    if (unit.assignment_id) {
      const asg: any = await Assignment.findOne({ id: unit.assignment_id }).lean();
      if (asg) {
        const cust = await Customer.findOne({ id: asg.customer_id }).lean();
        holder = cust ? { id: cust.id, name: cust.name, phone: cust.phone } : null;
      }
    }
    res.json({ unit: strip(unit), item: item ? { id: item.id, name: item.name, name_ar: item.name_ar, sku: item.sku } : null, warehouse: wh ? { id: wh.id, name: wh.name, name_ar: wh.name_ar } : null, holder });
  })
);

export default router;
