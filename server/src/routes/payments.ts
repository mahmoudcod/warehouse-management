import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, withTransaction, nextSequence, isoDate } from '../db';
import { asyncH, badRequest, forbidden, notFound } from '../errors';
import { audit } from '../audit';
import { parseList, runList } from '../paging';

const router = Router();

/** A month is locked → only Super Admin may touch entries inside it. */
async function assertPeriodOpen(client: any, dateStr: any, user: any) {
  const month = isoDate(dateStr).slice(0, 7);
  const r = await client.query(
    `select 1 from closed_periods where to_char(period, 'YYYY-MM') = $1`,
    [month]
  );
  if (r.rows[0] && user.role !== 'super_admin') {
    throw forbidden(`Month ${month} is closed — a Super Admin must approve changes to locked periods`);
  }
}

const createBody = z.object({
  customer_id: z.string().uuid(),
  amount: z.number().positive(),
  method: z.enum(['cash', 'transfer', 'other']).default('cash'),
  paid_at: z.string().optional(),
  account_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});

/**
 * Record a customer payment. Atomic across three tables:
 * payment row + linked income transaction + account balance.
 */
router.post(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('payments.create')) throw forbidden();
    const body = createBody.parse(req.body);
    const result = await withTransaction(async (client) => {
      const cust = (await client.query(`select id, name from customers where id=$1 and deleted_at is null`, [body.customer_id])).rows[0];
      if (!cust) throw notFound('Customer not found');
      await assertPeriodOpen(client, body.paid_at || new Date().toISOString().slice(0, 10), req.user);

      const seq = await nextSequence(client, 'receipt');
      const receiptNumber = `R-${new Date().toISOString().slice(0, 7).replace('-', '')}-${String(seq).padStart(5, '0')}`;

      const p = (await client.query(
        `insert into payments (customer_id, amount, method, paid_at, receipt_number, received_by, notes)
         values ($1,$2,$3,coalesce($4, current_date),$5,$6,$7) returning *`,
        [body.customer_id, body.amount, body.method, body.paid_at || null, receiptNumber, req.user!.id, body.notes || null]
      )).rows[0];

      // Auto income entry in Accounting, linked to the source payment.
      const cat = (await client.query(
        `select id from transaction_categories where is_default and name = 'customer_collections'`
      )).rows[0];
      let accountId = body.account_id || null;
      if (!accountId) {
        const acc = (await client.query(
          `select id from accounts where is_active and deleted_at is null and type = $1 order by created_at limit 1`,
          [body.method === 'cash' ? 'cash' : 'bank']
        )).rows[0];
        accountId = acc?.id || null;
      }
      const t = (await client.query(
        `insert into transactions (type, amount, category_id, occurred_at, method, account_id, customer_id, payment_id, notes, created_by)
         values ('income',$1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
        [body.amount, cat?.id || null, p.paid_at, body.method, accountId, body.customer_id, p.id,
         body.notes ? `Payment ${receiptNumber}` : `Payment ${receiptNumber}`, req.user!.id]
      )).rows[0];
      await client.query(`update payments set transaction_id=$2 where id=$1`, [p.id, t.id]);
      if (accountId) {
        await client.query(`update accounts set balance = balance + $2 where id=$1`, [accountId, body.amount]);
      }
      const balance = (await client.query(`select balance from customer_balances where customer_id=$1`, [body.customer_id])).rows[0];
      return { payment: { ...p, transaction_id: t.id }, newBalance: balance?.balance ?? 0 };
    });
    await audit(req, { action: 'create', entity: 'payment', entity_id: result.payment.id, new_value: result.payment });
    res.status(201).json(result);
  })
);

router.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    const lp = parseList(req, { paid_at: 'p.paid_at', amount: 'p.amount', customer: 'c.name', receipt: 'p.receipt_number' }, 'paid_at');
    const params: any[] = [];
    let where = `p.deleted_at is null`;
    if (req.user!.permissions.includes('data.own_only')) {
      params.push(req.user!.id);
      where += ` and p.received_by = $${params.length}`;
    }
    if (lp.search) {
      params.push(`%${lp.search}%`);
      where += ` and (c.name ilike $${params.length} or coalesce(p.receipt_number,'') ilike $${params.length} or coalesce(p.notes,'') ilike $${params.length})`;
    }
    if (req.query.customer_id) { params.push(req.query.customer_id); where += ` and p.customer_id = $${params.length}`; }
    if (req.query.method) { params.push(req.query.method); where += ` and p.method = $${params.length}`; }
    if (req.query.status) { params.push(req.query.status); where += ` and p.status = $${params.length}`; }
    if (lp.from) { params.push(lp.from); where += ` and p.paid_at >= $${params.length}`; }
    if (lp.to) { params.push(lp.to); where += ` and p.paid_at <= $${params.length}`; }
    const result = await runList(
      `select p.*, c.name as customer_name, c.phone as customer_phone, u.name as received_by_name
       from payments p join customers c on c.id = p.customer_id
       left join users u on u.id = p.received_by
       where ${where}`,
      `select count(*) from payments p join customers c on c.id = p.customer_id where ${where}`,
      params,
      lp
    );
    result.rows = result.rows.map((r: any) => ({ ...r, amount: Number(r.amount) }));
    res.json(result);
  })
);

router.get(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    const r = await query(
      `select p.*, c.name as customer_name, c.phone as customer_phone, u.name as received_by_name
       from payments p join customers c on c.id = p.customer_id
       left join users u on u.id = p.received_by
       where p.id = $1 and p.deleted_at is null`,
      [req.params.id]
    );
    if (!r.rows[0]) throw notFound('Payment not found');
    res.json({ ...r.rows[0], amount: Number(r.rows[0].amount) });
  })
);

/** Edit a payment — keeps the linked accounting entry in sync. */
router.patch(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('payments.edit') && req.user!.role !== 'super_admin') throw forbidden();
    const body = z.object({
      amount: z.number().positive().optional(),
      method: z.enum(['cash', 'transfer', 'other']).optional(),
      paid_at: z.string().optional(),
      notes: z.string().optional().nullable(),
      reason: z.string().min(3),
    }).parse(req.body);
    const result = await withTransaction(async (client) => {
      const r = await client.query(`select * from payments where id=$1 and deleted_at is null for update`, [req.params.id]);
      const p = r.rows[0];
      if (!p) throw notFound('Payment not found');
      if (p.status === 'voided') throw badRequest('Cannot edit a voided payment');
      await assertPeriodOpen(client, p.paid_at, req.user);
      if (body.paid_at) await assertPeriodOpen(client, body.paid_at, req.user);

      const newAmount = body.amount ?? Number(p.amount);
      const newDate = body.paid_at || p.paid_at;
      const newMethod = body.method || p.method;
      const r2 = await client.query(
        `update payments set amount=$2, method=$3, paid_at=$4, notes=$5, updated_at=now() where id=$1 returning *`,
        [p.id, newAmount, newMethod, newDate, body.notes ?? p.notes]
      );
      // sync linked transaction + account balance
      if (p.transaction_id) {
        const t = (await client.query(`select * from transactions where id=$1`, [p.transaction_id])).rows[0];
        if (t) {
          if (t.account_id) {
            const delta = newAmount - Number(t.amount);
            await client.query(`update accounts set balance = balance + $2 where id=$1`, [t.account_id, delta]);
          }
          await client.query(
            `update transactions set amount=$2, occurred_at=$3, method=$4, updated_at=now() where id=$1`,
            [t.id, newAmount, newDate, newMethod]
          );
        }
      }
      return { old: p, updated: r2.rows[0] };
    });
    await audit(req, { action: 'update', entity: 'payment', entity_id: req.params.id, old_value: result.old, new_value: { ...result.updated, reason: body.reason } });
    res.json(result.updated);
  })
);

/** Void a payment (reason mandatory) — also voids the linked income entry and reverses the account. */
router.post(
  '/:id/void',
  asyncH(async (req: Request, res: Response) => {
    const perms = req.user!.permissions;
    if (!perms.includes('payments.approve') && !perms.includes('payments.delete') && req.user!.role !== 'super_admin') throw forbidden();
    const body = z.object({ reason: z.string().min(3) }).parse(req.body);
    const result = await withTransaction(async (client) => {
      const r = await client.query(`select * from payments where id=$1 and deleted_at is null for update`, [req.params.id]);
      const p = r.rows[0];
      if (!p) throw notFound('Payment not found');
      if (p.status === 'voided') throw badRequest('Payment is already voided');
      await assertPeriodOpen(client, p.paid_at, req.user);
      const r2 = await client.query(
        `update payments set status='voided', void_reason=$2, updated_at=now() where id=$1 returning *`,
        [p.id, body.reason]
      );
      if (p.transaction_id) {
        const t = (await client.query(`select * from transactions where id=$1`, [p.transaction_id])).rows[0];
        if (t && t.status === 'active') {
          if (t.account_id) {
            await client.query(`update accounts set balance = balance - $2 where id=$1`, [t.account_id, t.amount]);
          }
          await client.query(
            `update transactions set status='voided', void_reason=$2, updated_at=now() where id=$1`,
            [t.id, `Payment void: ${body.reason}`]
          );
        }
      }
      return { old: p, updated: r2.rows[0] };
    });
    await audit(req, { action: 'void', entity: 'payment', entity_id: req.params.id, old_value: result.old, new_value: { ...result.updated, reason: body.reason } });
    res.json(result.updated);
  })
);

export default router;
