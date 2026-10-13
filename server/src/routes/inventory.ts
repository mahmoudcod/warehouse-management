import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db';
import { asyncH, badRequest, forbidden, notFound } from '../errors';
import { audit } from '../audit';
import { parseList, runList } from '../paging';

// ======================= Categories =======================
const categories = Router();

const catBody = z.object({ name: z.string().min(2), name_ar: z.string().optional().nullable(), description: z.string().optional().nullable() });

categories.get(
  '/',
  asyncH(async (_req: Request, res: Response) => {
    const r = await query(
      `select c.*, (select count(*) from items i where i.category_id = c.id and i.deleted_at is null) as items_count
       from categories c where c.deleted_at is null order by c.name`
    );
    res.json(r.rows);
  })
);

categories.post(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.create')) throw forbidden();
    const body = catBody.parse(req.body);
    const r = await query(`insert into categories (name, name_ar, description) values ($1,$2,$3) returning *`,
      [body.name, body.name_ar || null, body.description || null]);
    await audit(req, { action: 'create', entity: 'category', entity_id: r.rows[0].id, new_value: r.rows[0] });
    res.status(201).json(r.rows[0]);
  })
);

categories.patch(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.edit')) throw forbidden();
    const body = catBody.partial().parse(req.body);
    const old = (await query(`select * from categories where id=$1`, [req.params.id])).rows[0];
    if (!old) throw notFound('Category not found');
    const r = await query(
      `update categories set name=coalesce($2,name), name_ar=$3, description=$4 where id=$1 returning *`,
      [req.params.id, body.name, body.name_ar ?? old.name_ar, body.description ?? old.description]
    );
    await audit(req, { action: 'update', entity: 'category', entity_id: req.params.id, old_value: old, new_value: r.rows[0] });
    res.json(r.rows[0]);
  })
);

categories.delete(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.delete')) throw forbidden();
    const count = (await query(`select count(*) c from items where category_id=$1 and deleted_at is null`, [req.params.id])).rows[0].c;
    if (Number(count) > 0) throw badRequest('Cannot delete a category that still has items');
    await query(`update categories set deleted_at=now() where id=$1`, [req.params.id]);
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
    const r = await query(
      `select w.*, (select coalesce(sum(quantity),0) from items i where i.warehouse_id = w.id and i.deleted_at is null) as total_quantity
       from warehouses w where w.deleted_at is null order by w.is_default desc, w.name`
    );
    res.json(r.rows.map((x: any) => ({ ...x, total_quantity: Number(x.total_quantity) })));
  })
);

warehouses.post(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.create')) throw forbidden();
    const body = whBody.parse(req.body);
    const r = await withTransaction(async (client) => {
      if (body.is_default) await client.query(`update warehouses set is_default=false`);
      const res2 = await client.query(
        `insert into warehouses (name, name_ar, location, is_default) values ($1,$2,$3,coalesce($4,false)) returning *`,
        [body.name, body.name_ar || null, body.location || null, body.is_default ?? null]
      );
      return res2.rows[0];
    });
    await audit(req, { action: 'create', entity: 'warehouse', entity_id: r.id, new_value: r });
    res.status(201).json(r);
  })
);

warehouses.patch(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.edit')) throw forbidden();
    const body = whBody.partial().parse(req.body);
    const r = await withTransaction(async (client) => {
      const old = (await client.query(`select * from warehouses where id=$1`, [req.params.id])).rows[0];
      if (!old) throw notFound('Warehouse not found');
      if (body.is_default) await client.query(`update warehouses set is_default=false`);
      const res2 = await client.query(
        `update warehouses set name=coalesce($2,name), name_ar=$3, location=$4, is_default=coalesce($5,is_default) where id=$1 returning *`,
        [req.params.id, body.name, body.name_ar ?? old.name_ar, body.location ?? old.location, body.is_default ?? null]
      );
      return { old, updated: res2.rows[0] };
    });
    await audit(req, { action: 'update', entity: 'warehouse', entity_id: req.params.id, old_value: r.old, new_value: r.updated });
    res.json(r.updated);
  })
);

warehouses.delete(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.delete')) throw forbidden();
    const wh = (await query(`select * from warehouses where id=$1 and deleted_at is null`, [req.params.id])).rows[0];
    if (!wh) throw notFound('Warehouse not found');
    if (wh.is_default) throw badRequest('Cannot delete the default warehouse');
    const count = (await query(`select count(*) c from items where warehouse_id=$1 and deleted_at is null`, [req.params.id])).rows[0].c;
    if (Number(count) > 0) throw badRequest('Move or reassign the items in this warehouse first');
    await query(`update warehouses set deleted_at=now() where id=$1`, [req.params.id]);
    await audit(req, { action: 'delete', entity: 'warehouse', entity_id: req.params.id });
    res.json({ ok: true });
  })
);

// ======================= Stock movements log =======================
const movements = Router();

movements.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    const lp = parseList(req, { created_at: 'm.created_at', item: 'i.name', quantity: 'm.quantity' }, 'created_at');
    const params: any[] = [];
    let where = `1=1`;
    if (lp.search) {
      params.push(`%${lp.search}%`);
      where += ` and (i.name ilike $1 or coalesce(i.name_ar,'') ilike $1 or coalesce(m.reason,'') ilike $1 or coalesce(m.unit_serial,'') ilike $1)`;
    }
    if (req.query.item_id) { params.push(req.query.item_id); where += ` and m.item_id = $${params.length}`; }
    if (req.query.movement_type) { params.push(req.query.movement_type); where += ` and m.movement_type = $${params.length}`; }
    if (lp.from) { params.push(lp.from); where += ` and m.created_at::date >= $${params.length}`; }
    if (lp.to) { params.push(lp.to); where += ` and m.created_at::date <= $${params.length}`; }
    const result = await runList(
      `select m.*, i.name as item_name, i.name_ar as item_name_ar, i.sku,
              wf.name as from_warehouse_name, wt.name as to_warehouse_name, u.name as performed_by_name
       from stock_movements m
       join items i on i.id = m.item_id
       left join warehouses wf on wf.id = m.from_warehouse_id
       left join warehouses wt on wt.id = m.to_warehouse_id
       left join users u on u.id = m.performed_by
       where ${where}`,
      `select count(*) from stock_movements m join items i on i.id = m.item_id where ${where}`,
      params,
      lp
    );
    result.rows = result.rows.map((r: any) => ({ ...r, quantity: Number(r.quantity) }));
    res.json(result);
  })
);

/** Transfer stock between warehouses. */
movements.post(
  '/transfer',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('inventory.edit')) throw forbidden();
    const body = z.object({
      item_id: z.string().uuid(),
      quantity: z.number().positive(),
      from_warehouse_id: z.string().uuid(),
      to_warehouse_id: z.string().uuid(),
      reason: z.string().optional(),
    }).parse(req.body);
    if (body.from_warehouse_id === body.to_warehouse_id) throw badRequest('Source and destination warehouses must differ');
    const result = await withTransaction(async (client) => {
      const r = await client.query(`select * from items where id=$1 and deleted_at is null for update`, [body.item_id]);
      const item = r.rows[0];
      if (!item) throw notFound('Item not found');
      if (Number(item.quantity) < body.quantity) throw badRequest(`Not enough stock (available: ${item.quantity})`);
      await client.query(`update items set warehouse_id=$2, updated_at=now() where id=$1`, [item.id, body.to_warehouse_id]);
      await client.query(
        `insert into stock_movements (item_id, movement_type, quantity, from_warehouse_id, to_warehouse_id, reason, performed_by, reference_type)
         values ($1,'transfer',$2,$3,$4,$5,$6,'transfer')`,
        [item.id, -body.quantity, body.from_warehouse_id, body.to_warehouse_id, body.reason || 'Warehouse transfer', req.user!.id]
      );
      await client.query(
        `insert into stock_movements (item_id, movement_type, quantity, from_warehouse_id, to_warehouse_id, reason, performed_by, reference_type)
         values ($1,'transfer',$2,$3,$4,$5,$6,'transfer')`,
        [item.id, body.quantity, body.from_warehouse_id, body.to_warehouse_id, body.reason || 'Warehouse transfer', req.user!.id]
      );
      return { ok: true };
    });
    await audit(req, { action: 'stock_transfer', entity: 'item', entity_id: body.item_id, new_value: body });
    res.json(result);
  })
);

export { categories, warehouses, movements };
