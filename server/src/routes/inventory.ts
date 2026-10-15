import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Category, Warehouse, Item, StockMovement, User, createWithId, withTransaction, rx, strip, todayStr } from '../db';
import { asyncH, badRequest, forbidden, notFound } from '../errors';
import { audit } from '../audit';
import { parseList, runAggList } from '../paging';

const numId = z.union([z.string(), z.number()]).transform((v) => Number(v));

// ======================= Categories =======================
const categories = Router();

const catBody = z.object({ name: z.string().min(2), name_ar: z.string().optional().nullable(), description: z.string().optional().nullable() });

categories.get(
  '/',
  asyncH(async (_req: Request, res: Response) => {
    const docs = (await Category.find({ deleted_at: null }).sort({ name: 1 }).lean()).map(strip);
    const counts = await Item.aggregate([
      { $match: { deleted_at: null } },
      { $group: { _id: '$category_id', c: { $sum: 1 } } },
    ]);
    const countById = new Map(counts.map((c: any) => [c._id, c.c]));
    res.json(docs.map((c: any) => ({ ...c, items_count: countById.get(c.id) ?? 0 })));
  })
);

categories.post(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.create')) throw forbidden();
    const body = catBody.parse(req.body);
    const c: any = await createWithId(Category, { name: body.name, name_ar: body.name_ar || null, description: body.description || null });
    await audit(req, { action: 'create', entity: 'category', entity_id: c.id, new_value: strip(c.toObject()) });
    res.status(201).json(strip(c.toObject()));
  })
);

categories.patch(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.edit')) throw forbidden();
    const body = catBody.partial().parse(req.body);
    const old: any = await Category.findOne({ id: Number(req.params.id) }).lean();
    if (!old) throw notFound('Category not found');
    const update: any = {};
    if (body.name != null) update.name = body.name;
    if (body.name_ar !== undefined) update.name_ar = body.name_ar;
    if (body.description !== undefined) update.description = body.description;
    await Category.updateOne({ id: old.id }, update);
    const fresh: any = strip(await Category.findOne({ id: old.id }).lean());
    await audit(req, { action: 'update', entity: 'category', entity_id: req.params.id, old_value: strip(old), new_value: fresh });
    res.json(fresh);
  })
);

categories.delete(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.delete')) throw forbidden();
    const count = await Item.countDocuments({ category_id: Number(req.params.id), deleted_at: null });
    if (count > 0) throw badRequest('Cannot delete a category that still has items');
    await Category.updateOne({ id: Number(req.params.id) }, { deleted_at: new Date() });
    await audit(req, { action: 'delete', entity: 'category', entity_id: req.params.id });
    res.json({ ok: true });
  })
);

// ======================= Warehouses =======================
const warehouses = Router();

const whBody = z.object({ name: z.string().min(2), name_ar: z.string().optional().nullable(), location: z.string().optional().nullable(), is_default: z.boolean().optional() });

warehouses.get(
  '/',
  asyncH(async (_req: Request, res: Response) => {
    const docs = (await Warehouse.find({ deleted_at: null }).sort({ is_default: -1, name: 1 }).lean()).map(strip);
    const qtys = await Item.aggregate([
      { $match: { deleted_at: null } },
      { $group: { _id: '$warehouse_id', q: { $sum: '$quantity' } } },
    ]);
    const qById = new Map(qtys.map((q: any) => [q._id, q.q]));
    res.json(docs.map((w: any) => ({ ...w, total_quantity: qById.get(w.id) ?? 0 })));
  })
);

warehouses.post(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.create')) throw forbidden();
    const body = whBody.parse(req.body);
    const w = await withTransaction(async (session) => {
      if (body.is_default) await Warehouse.updateMany({}, { is_default: false }, { session });
      return createWithId(
        Warehouse,
        { name: body.name, name_ar: body.name_ar || null, location: body.location || null, is_default: body.is_default ?? false },
        session
      );
    });
    await audit(req, { action: 'create', entity: 'warehouse', entity_id: w.id, new_value: strip(w.toObject()) });
    res.status(201).json(strip(w.toObject()));
  })
);

warehouses.patch(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.edit')) throw forbidden();
    const body = whBody.partial().parse(req.body);
    const { old, updated } = await withTransaction(async (session) => {
      const old: any = await Warehouse.findOne({ id: Number(req.params.id) }).session(session).lean();
      if (!old) throw notFound('Warehouse not found');
      if (body.is_default) await Warehouse.updateMany({}, { is_default: false }, { session });
      const update: any = {};
      if (body.name != null) update.name = body.name;
      if (body.name_ar !== undefined) update.name_ar = body.name_ar;
      if (body.location !== undefined) update.location = body.location;
      if (body.is_default != null) update.is_default = body.is_default;
      await Warehouse.updateOne({ id: old.id }, update, { session });
      const updated: any = await Warehouse.findOne({ id: old.id }).session(session).lean();
      return { old: strip(old), updated: strip(updated) };
    });
    await audit(req, { action: 'update', entity: 'warehouse', entity_id: req.params.id, old_value: old, new_value: updated });
    res.json(updated);
  })
);

warehouses.delete(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.delete')) throw forbidden();
    const wh: any = await Warehouse.findOne({ id: Number(req.params.id), deleted_at: null }).lean();
    if (!wh) throw notFound('Warehouse not found');
    if (wh.is_default) throw badRequest('Cannot delete the default warehouse');
    const count = await Item.countDocuments({ warehouse_id: wh.id, deleted_at: null });
    if (count > 0) throw badRequest('Move or reassign the items in this warehouse first');
    await Warehouse.updateOne({ id: wh.id }, { deleted_at: new Date() });
    await audit(req, { action: 'delete', entity: 'warehouse', entity_id: req.params.id });
    res.json({ ok: true });
  })
);

// ======================= Stock movements log =======================
const movements = Router();

movements.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    const lp = parseList(req, { created_at: 'created_at', item: 'item_name', quantity: 'quantity' }, 'created_at');
    const match: any = {};
    if (req.query.item_id) match.item_id = Number(req.query.item_id);
    if (req.query.movement_type) match.movement_type = req.query.movement_type;
    if (lp.from) match.created_at = { ...(match.created_at || {}), $gte: new Date(`${lp.from}T00:00:00.000Z`) };
    if (lp.to) match.created_at = { ...(match.created_at || {}), $lte: new Date(`${lp.to}T23:59:59.999Z`) };

    const pipeline: any[] = [
      { $match: match },
      {
        $lookup: { from: 'items', localField: 'item_id', foreignField: 'id', as: 'i', pipeline: [{ $project: { name: 1, name_ar: 1, sku: 1, _id: 0 } }] },
      },
      { $unwind: '$i' },
      {
        $lookup: { from: 'warehouses', localField: 'from_warehouse_id', foreignField: 'id', as: 'wf', pipeline: [{ $project: { name: 1, _id: 0 } }] },
      },
      {
        $lookup: { from: 'warehouses', localField: 'to_warehouse_id', foreignField: 'id', as: 'wt', pipeline: [{ $project: { name: 1, _id: 0 } }] },
      },
      {
        $lookup: { from: 'users', localField: 'performed_by', foreignField: 'id', as: 'u', pipeline: [{ $project: { name: 1, _id: 0 } }] },
      },
      {
        $set: {
          item_name: '$i.name',
          item_name_ar: '$i.name_ar',
          sku: '$i.sku',
          from_warehouse_name: { $ifNull: [{ $arrayElemAt: ['$wf.name', 0] }, null] },
          to_warehouse_name: { $ifNull: [{ $arrayElemAt: ['$wt.name', 0] }, null] },
          performed_by_name: { $ifNull: [{ $arrayElemAt: ['$u.name', 0] }, null] },
        },
      },
    ];
    if (lp.search) {
      const s = rx(lp.search);
      pipeline.push({
        $match: {
          $or: [{ 'i.name': s }, { 'i.name_ar': s }, { reason: s }, { unit_serial: s }],
        },
      });
    }
    pipeline.push({ $unset: ['i', 'wf', 'wt', 'u'] });
    const result = await runAggList(StockMovement, pipeline, lp.sort, lp);
    res.json(result);
  })
);

/** Transfer stock between warehouses. */
movements.post(
  '/transfer',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.edit')) throw forbidden();
    const body = z.object({
      item_id: numId,
      quantity: z.number().positive(),
      from_warehouse_id: numId,
      to_warehouse_id: numId,
      reason: z.string().optional(),
    }).parse(req.body);
    if (body.from_warehouse_id === body.to_warehouse_id) throw badRequest('Source and destination warehouses must differ');
    const result = await withTransaction(async (session) => {
      const item: any = await Item.findOne({ id: body.item_id, deleted_at: null }).session(session);
      if (!item) throw notFound('Item not found');
      if (item.quantity < body.quantity) throw badRequest(`Not enough stock (available: ${item.quantity})`);
      await Item.updateOne({ id: item.id }, { warehouse_id: body.to_warehouse_id, updated_at: new Date() }, { session });
      const mv = (fromWh: number | null, toWh: number | null, qty: number) =>
        createWithId(
          StockMovement,
          {
            item_id: item.id, movement_type: 'transfer', quantity: qty,
            from_warehouse_id: fromWh, to_warehouse_id: toWh,
            reason: body.reason || 'Warehouse transfer', performed_by: req.user!.id, reference_type: 'transfer',
          },
          session
        );
      await mv(body.from_warehouse_id, body.to_warehouse_id, -body.quantity);
      await mv(body.from_warehouse_id, body.to_warehouse_id, body.quantity);
      return { ok: true };
    });
    await audit(req, { action: 'stock_transfer', entity: 'item', entity_id: body.item_id, new_value: body });
    res.json(result);
  })
);

export { categories, warehouses, movements };
