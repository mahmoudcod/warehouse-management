import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db';
import { asyncH, badRequest, forbidden, notFound } from '../errors';
import { audit } from '../audit';
import { parseList, runList } from '../paging';

const router = Router();

const createBody = z.object({
  customer_id: z.string().uuid(),
  item_id: z.string().uuid().optional().nullable(),
  item_text: z.string().optional().nullable(),
  quantity: z.number().positive().default(1),
  unit_price: z.number().nonnegative().optional(),
  amount: z.number().nonnegative(),
  serial_numbers: z.string().optional().nullable(),
  unit_ids: z.array(z.string().uuid()).optional(),
  assigned_at: z.string().optional(),
  notes: z.string().optional().nullable(),
});

/**
 * Record "customer took a device for amount Y".
 * Atomic: locks the item row, validates stock, decrements it, writes a stock
 * movement, marks serialized units, and inserts the assignment (the debit).
 */
router.post(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('assignments.create')) throw forbidden();
    const body = createBody.parse(req.body);
    if (!body.item_id && !body.item_text) throw badRequest('Pick an inventory item or enter a free-text description');
    const created = await withTransaction(async (client) => {
      let itemName: string | null = null;
      let qty = body.quantity;
      if (body.item_id) {
        const r = await client.query(`select * from items where id=$1 and deleted_at is null for update`, [body.item_id]);
        const item = r.rows[0];
        if (!item) throw notFound('Item not found');
        if (item.status !== 'active') throw badRequest('Item is archived');
        if (body.unit_ids && body.unit_ids.length) qty = body.unit_ids.length;
        if (Number(item.quantity) < qty) {
          throw badRequest(`Not enough stock for "${item.name}" (available: ${item.quantity})`);
        }
        await client.query(`update items set quantity = quantity - $2, updated_at = now() where id = $1`, [item.id, qty]);
        await client.query(
          `insert into stock_movements (item_id, movement_type, quantity, to_warehouse_id, reason, performed_by, reference_type)
           values ($1,'assignment',$2,null,$3,$4,'assignment_out')`,
          [item.id, -qty, body.notes || 'Assigned to customer', req.user!.id]
        );
        for (const uid of body.unit_ids || []) {
          const ur = await client.query(
            `update item_units set status='assigned', assignment_id=null where id=$1 and item_id=$2 and status='in_stock' returning id`,
            [uid, item.id]
          );
          if (!ur.rows[0]) throw badRequest('One of the selected serials is not in stock');
        }
        itemName = item.name;
      }
      const r2 = await client.query(
        `insert into assignments (customer_id, item_id, item_text, quantity, unit_price, amount, serial_numbers, assigned_at, notes, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,coalesce($8, current_date),$9,$10) returning *`,
        [body.customer_id, body.item_id || null, body.item_text || itemName, qty,
         body.unit_price ?? (qty > 0 ? body.amount / qty : 0), body.amount,
         body.serial_numbers || null, body.assigned_at || null, body.notes || null, req.user!.id]
      );
      // link serialized units to the new assignment
      for (const uid of body.unit_ids || []) {
        await client.query(`update item_units set assignment_id=$2 where id=$1`, [uid, r2.rows[0].id]);
      }
      return r2.rows[0];
    });
    await audit(req, { action: 'create', entity: 'assignment', entity_id: created.id, new_value: created });
    res.status(201).json(created);
  })
);

router.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    const lp = parseList(req, { assigned_at: 'a.assigned_at', amount: 'a.amount', customer: 'c.name' }, 'assigned_at');
    const params: any[] = [];
    let where = `a.deleted_at is null`;
    if (req.user!.permissions.includes('data.own_only')) {
      params.push(req.user!.id);
      where += ` and a.created_by = $${params.length}`;
    }
    if (lp.search) {
      params.push(`%${lp.search}%`);
      where += ` and (c.name ilike $${params.length} or coalesce(i.name,'') ilike $${params.length} or coalesce(a.item_text,'') ilike $${params.length} or coalesce(a.serial_numbers,'') ilike $${params.length})`;
    }
    if (req.query.customer_id) { params.push(req.query.customer_id); where += ` and a.customer_id = $${params.length}`; }
    if (req.query.status) { params.push(req.query.status); where += ` and a.status = $${params.length}`; }
    if (req.query.item_id) { params.push(req.query.item_id); where += ` and a.item_id = $${params.length}`; }
    if (lp.from) { params.push(lp.from); where += ` and a.assigned_at >= $${params.length}`; }
    if (lp.to) { params.push(lp.to); where += ` and a.assigned_at <= $${params.length}`; }
    const result = await runList(
      `select a.*, c.name as customer_name, c.phone as customer_phone, i.name as item_name, i.name_ar as item_name_ar,
              i.sku as item_sku, u.name as created_by_name
       from assignments a
       join customers c on c.id = a.customer_id
       left join items i on i.id = a.item_id
       left join users u on u.id = a.created_by
       where ${where}`,
      `select count(*) from assignments a join customers c on c.id = a.customer_id left join items i on i.id = a.item_id where ${where}`,
      params,
      lp
    );
    result.rows = result.rows.map((r: any) => ({
      ...r, quantity: Number(r.quantity), unit_price: Number(r.unit_price), amount: Number(r.amount), credited_amount: Number(r.credited_amount),
    }));
    res.json(result);
  })
);

router.get(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    const r = await query(
      `select a.*, c.name as customer_name, i.name as item_name from assignments a
       join customers c on c.id = a.customer_id left join items i on i.id = a.item_id
       where a.id = $1 and a.deleted_at is null`,
      [req.params.id]
    );
    if (!r.rows[0]) throw notFound('Assignment not found');
    res.json(r.rows[0]);
  })
);

/** Edit amount/notes/date of a taken assignment. */
router.patch(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('assignments.edit')) throw forbidden();
    const body = z.object({
      amount: z.number().nonnegative().optional(),
      notes: z.string().optional().nullable(),
      assigned_at: z.string().optional(),
    }).parse(req.body);
    const old = (await query(`select * from assignments where id=$1 and deleted_at is null`, [req.params.id])).rows[0];
    if (!old) throw notFound('Assignment not found');
    if (old.status === 'voided') throw badRequest('Cannot edit a voided assignment');
    const r = await query(
      `update assignments set amount=coalesce($2,amount), notes=$3, assigned_at=coalesce($4,assigned_at),
        unit_price = case when $2::numeric is not null and quantity > 0 then $2/quantity else unit_price end,
        updated_at=now()
       where id=$1 returning *`,
      [req.params.id, body.amount ?? null, body.notes ?? old.notes, body.assigned_at || null]
    );
    await audit(req, { action: 'update', entity: 'assignment', entity_id: req.params.id, old_value: old, new_value: r.rows[0] });
    res.json(r.rows[0]);
  })
);

/** Mark returned: restores stock and credits the customer's balance. */
router.post(
  '/:id/return',
  asyncH(async (req: Request, res: Response) => {
    const perms = req.user!.permissions;
    if (!perms.includes('assignments.edit') && !perms.includes('assignments.approve')) throw forbidden();
    const body = z.object({
      credited_amount: z.number().nonnegative().optional(), // portion refunded to the customer's balance (default: full amount)
      notes: z.string().optional().nullable(),
    }).parse(req.body || {});
    const result = await withTransaction(async (client) => {
      const r = await client.query(`select * from assignments where id=$1 and deleted_at is null for update`, [req.params.id]);
      const a = r.rows[0];
      if (!a) throw notFound('Assignment not found');
      if (a.status !== 'taken') throw badRequest('Only taken assignments can be returned');
      const credit = body.credited_amount ?? Number(a.amount);
      if (credit > Number(a.amount)) throw badRequest('Credited amount cannot exceed the original amount');
      if (a.item_id) {
        await client.query(`update items set quantity = quantity + $2, updated_at=now() where id=$1`, [a.item_id, a.quantity]);
        await client.query(
          `insert into stock_movements (item_id, movement_type, quantity, reason, performed_by, reference_type, reference_id)
           values ($1,'return',$2,$3,$4,'assignment_return',$5)`,
          [a.item_id, a.quantity, body.notes || `Return of assignment ${String(a.id).slice(0, 8)}`, req.user!.id, a.id]
        );
        await client.query(`update item_units set status='in_stock', assignment_id=null where assignment_id=$1`, [a.id]);
      }
      const r2 = await client.query(
        `update assignments set status='returned', returned_at=now(), credited_amount=$2, notes=coalesce($3,notes), updated_at=now()
         where id=$1 returning *`,
        [a.id, credit, body.notes || null]
      );
      return { old: a, updated: r2.rows[0] };
    });
    await audit(req, { action: 'return', entity: 'assignment', entity_id: req.params.id, old_value: result.old, new_value: result.updated });
    res.json(result.updated);
  })
);

/** Void an assignment (reason mandatory): full credit + stock restore. */
router.post(
  '/:id/void',
  asyncH(async (req: Request, res: Response) => {
    const perms = req.user!.permissions;
    if (!perms.includes('assignments.approve') && !perms.includes('assignments.delete')) throw forbidden();
    const body = z.object({ reason: z.string().min(3) }).parse(req.body);
    const result = await withTransaction(async (client) => {
      const r = await client.query(`select * from assignments where id=$1 and deleted_at is null for update`, [req.params.id]);
      const a = r.rows[0];
      if (!a) throw notFound('Assignment not found');
      if (a.status === 'voided') throw badRequest('Assignment is already voided');
      if (a.item_id && a.status === 'taken') {
        await client.query(`update items set quantity = quantity + $2, updated_at=now() where id=$1`, [a.item_id, a.quantity]);
        await client.query(
          `insert into stock_movements (item_id, movement_type, quantity, reason, performed_by, reference_type, reference_id)
           values ($1,'return',$2,$3,$4,'assignment_void',$5)`,
          [a.item_id, a.quantity, `Void: ${body.reason}`, req.user!.id, a.id]
        );
        await client.query(`update item_units set status='in_stock', assignment_id=null where assignment_id=$1`, [a.id]);
      }
      const r2 = await client.query(
        `update assignments set status='voided', void_reason=$2, credited_amount=amount, updated_at=now() where id=$1 returning *`,
        [req.params.id, body.reason]
      );
      return { old: a, updated: r2.rows[0] };
    });
    await audit(req, { action: 'void', entity: 'assignment', entity_id: req.params.id, old_value: result.old, new_value: { ...result.updated, reason: body.reason } });
    res.json(result.updated);
  })
);

export default router;
