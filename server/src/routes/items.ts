import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db';
import { asyncH, badRequest, forbidden, notFound } from '../errors';
import { audit } from '../audit';
import { parseList, runList } from '../paging';

const router = Router();

const itemBody = z.object({
  name: z.string().min(2),
  name_ar: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  category_id: z.string().uuid().optional().nullable(),
  brand: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  cost_price: z.number().nonnegative().optional(),
  selling_price: z.number().nonnegative().optional(),
  min_stock_level: z.number().nonnegative().optional(),
  warehouse_id: z.string().uuid().optional().nullable(),
  track_serials: z.boolean().optional(),
  photo_url: z.string().optional().nullable(),
  status: z.enum(['active', 'archived']).optional(),
});

router.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    const lp = parseList(req, { name: 'i.name', quantity: 'i.quantity', cost: 'i.cost_price', price: 'i.selling_price', created_at: 'i.created_at', sku: 'i.sku' }, 'created_at');
    const params: any[] = [];
    let where = `i.deleted_at is null`;
    if (lp.search) {
      params.push(`%${lp.search}%`);
      where += ` and (i.name ilike $1 or coalesce(i.name_ar,'') ilike $1 or coalesce(i.sku,'') ilike $1 or coalesce(i.barcode,'') ilike $1 or coalesce(i.brand,'') ilike $1
        or exists(select 1 from item_units u where u.item_id = i.id and u.serial ilike $1))`;
    }
    if (req.query.category_id) { params.push(req.query.category_id); where += ` and i.category_id = $${params.length}`; }
    if (req.query.warehouse_id) { params.push(req.query.warehouse_id); where += ` and i.warehouse_id = $${params.length}`; }
    if (req.query.status) { params.push(req.query.status); where += ` and i.status = $${params.length}`; }
    if (req.query.low_stock === 'true') where += ` and i.quantity <= i.min_stock_level and i.min_stock_level > 0`;
    const result = await runList(
      `select i.*, c.name as category_name, c.name_ar as category_name_ar,
              w.name as warehouse_name, w.name_ar as warehouse_name_ar,
              (i.cost_price * i.quantity)::float8 as stock_cost_value,
              (i.selling_price * i.quantity)::float8 as stock_sell_value,
              (i.quantity <= i.min_stock_level and i.min_stock_level > 0) as low_stock,
              (select count(*) from item_units u where u.item_id = i.id and u.status='in_stock' and u.deleted_at is null) as units_in_stock
       from items i
       left join categories c on c.id = i.category_id
       left join warehouses w on w.id = i.warehouse_id
       where ${where}`,
      `select count(*) from items i where ${where}`,
      params,
      lp
    );
    // normalize numerics
    result.rows = result.rows.map((r: any) => ({ ...r, quantity: Number(r.quantity), cost_price: Number(r.cost_price), selling_price: Number(r.selling_price), min_stock_level: Number(r.min_stock_level), units_in_stock: Number(r.units_in_stock) }));
    res.json(result);
  })
);

/** Barcode / serial scanner lookup. */
router.get(
  '/lookup/:code',
  asyncH(async (req: Request, res: Response) => {
    const code = req.params.code;
    const r = await query(
      `select i.*, w.name as warehouse_name from items i
       left join warehouses w on w.id = i.warehouse_id
       where i.deleted_at is null and (i.sku = $1 or i.barcode = $1
         or exists(select 1 from item_units u where u.item_id = i.id and u.serial = $1 and u.deleted_at is null))
       limit 1`,
      [code]
    );
    res.json({ item: r.rows[0] || null });
  })
);

router.get(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    const r = await query(
      `select i.*, c.name as category_name, w.name as warehouse_name from items i
       left join categories c on c.id = i.category_id
       left join warehouses w on w.id = i.warehouse_id
       where i.id = $1 and i.deleted_at is null`,
      [req.params.id]
    );
    if (!r.rows[0]) throw notFound('Item not found');
    const item = r.rows[0];
    item.quantity = Number(item.quantity);
    const units = await query(
      `select u.*, a.customer_id, c.name as customer_name from item_units u
       left join assignments a on a.id = u.assignment_id
       left join customers c on c.id = a.customer_id
       where u.item_id = $1 and u.deleted_at is null order by u.created_at desc limit 200`,
      [req.params.id]
    );
    const movements = await query(
      `select m.*, u.name as performed_by_name from stock_movements m
       left join users u on u.id = m.performed_by
       where m.item_id = $1 order by m.created_at desc limit 100`,
      [req.params.id]
    );
    res.json({ ...item, units: units.rows, movements: movements.rows });
  })
);

router.post(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.create')) throw forbidden();
    const body = itemBody.parse(req.body);
    const initialQty = Number(req.body.initial_quantity ?? 0);
    const serials: string[] = Array.isArray(req.body.serials) ? req.body.serials : [];
    const created = await withTransaction(async (client) => {
      const r = await client.query(
        `insert into items (name, name_ar, sku, barcode, category_id, brand, model, cost_price, selling_price,
          quantity, min_stock_level, warehouse_id, track_serials, photo_url)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
        [body.name, body.name_ar || null, body.sku || null, body.barcode || null, body.category_id || null,
         body.brand || null, body.model || null, body.cost_price ?? 0, body.selling_price ?? 0,
         body.track_serials ? serials.length : initialQty, body.min_stock_level ?? 0,
         body.warehouse_id || null, body.track_serials ?? false, body.photo_url || null]
      );
      const item = r.rows[0];
      if (initialQty > 0 && !(body.track_serials && serials.length)) {
        await client.query(
          `insert into stock_movements (item_id, movement_type, quantity, to_warehouse_id, reason, performed_by, reference_type)
           values ($1,'purchase',$2,$3,$4,$5,'item_create')`,
          [item.id, initialQty, body.warehouse_id || null, 'Initial stock on item creation', req.user!.id]
        );
      }
      for (const s of serials) {
        await client.query(
          `insert into item_units (item_id, serial, warehouse_id) values ($1,$2,$3)`,
          [item.id, s.trim(), body.warehouse_id || null]
        );
      }
      if (serials.length) {
        await client.query(
          `insert into stock_movements (item_id, movement_type, quantity, to_warehouse_id, reason, performed_by, reference_type)
           values ($1,'purchase',$2,$3,$4,$5,'item_create')`,
          [item.id, serials.length, body.warehouse_id || null, `Initial stock: ${serials.length} serialized units`, req.user!.id]
        );
      }
      return item;
    });
    await audit(req, { action: 'create', entity: 'item', entity_id: created.id, new_value: created });
    res.status(201).json(created);
  })
);

router.patch(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.edit')) throw forbidden();
    const body = itemBody.partial().parse(req.body);
    const old = (await query(`select * from items where id=$1 and deleted_at is null`, [req.params.id])).rows[0];
    if (!old) throw notFound('Item not found');
    const r = await query(
      `update items set name=coalesce($2,name), name_ar=$3, sku=$4, barcode=$5, category_id=$6, brand=$7, model=$8,
        cost_price=coalesce($9,cost_price), selling_price=coalesce($10,selling_price),
        min_stock_level=coalesce($11,min_stock_level), warehouse_id=$12, track_serials=coalesce($13,track_serials),
        photo_url=coalesce($14,photo_url), status=coalesce($15,status), updated_at=now()
       where id=$1 returning *`,
      [req.params.id, body.name, body.name_ar ?? old.name_ar, body.sku ?? old.sku, body.barcode ?? old.barcode,
       body.category_id ?? old.category_id, body.brand ?? old.brand, body.model ?? old.model,
       body.cost_price ?? null, body.selling_price ?? null, body.min_stock_level ?? null,
       body.warehouse_id ?? old.warehouse_id, body.track_serials ?? null, body.photo_url ?? null,
       body.status ?? null]
    );
    await audit(req, { action: 'update', entity: 'item', entity_id: req.params.id, old_value: old, new_value: r.rows[0] });
    res.json(r.rows[0]);
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
    const result = await withTransaction(async (client) => {
      const r = await client.query(`select * from items where id=$1 and deleted_at is null for update`, [req.params.id]);
      const item = r.rows[0];
      if (!item) throw notFound('Item not found');
      const newQty = Number(item.quantity) + body.delta;
      if (newQty < 0) throw badRequest(`Adjustment would make stock negative (current: ${item.quantity})`);
      await client.query(`update items set quantity=$2, updated_at=now() where id=$1`, [item.id, newQty]);
      await client.query(
        `insert into stock_movements (item_id, movement_type, quantity, reason, performed_by, reference_type)
         values ($1,'adjustment',$2,$3,$4,'manual_adjustment')`,
        [item.id, body.delta, body.reason, req.user!.id]
      );
      return { item_id: item.id, quantity: newQty };
    });
    await audit(req, { action: 'stock_adjustment', entity: 'item', entity_id: req.params.id, old_value: { quantity: result.quantity - body.delta }, new_value: { quantity: result.quantity, reason: body.reason } });
    res.json(result);
  })
);

router.delete(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.delete')) throw forbidden();
    const old = (await query(`select * from items where id=$1 and deleted_at is null`, [req.params.id])).rows[0];
    if (!old) throw notFound('Item not found');
    await query(`update items set deleted_at=now(), status='archived' where id=$1`, [req.params.id]);
    await audit(req, { action: 'delete', entity: 'item', entity_id: req.params.id, old_value: old });
    res.json({ ok: true });
  })
);

export default router;
