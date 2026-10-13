import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, withTransaction, nextSequence } from '../db';
import { asyncH, badRequest, forbidden, notFound } from '../errors';
import { audit } from '../audit';

const router = Router();

function decorate(rows: any[]) {
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((s: any) => {
    const amount = Number(s.amount);
    const paid = Number(s.paid_amount);
    const remaining = amount - paid;
    const isOverdue = s.status !== 'paid' && remaining > 0.005 && s.due_date < today;
    return {
      ...s,
      amount, paid_amount: paid, remaining,
      is_overdue: isOverdue,
      display_status: s.status === 'paid' ? 'paid' : paid > 0 ? 'partial' : isOverdue ? 'overdue' : 'pending',
    };
  });
}

router.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    const params: any[] = [];
    let where = `pl.deleted_at is null`;
    if (req.query.customer_id) { params.push(req.query.customer_id); where += ` and pl.customer_id = $1`; }
    if (req.query.overdue === 'true') {
      where += ` and exists(select 1 from installment_schedule s where s.plan_id = pl.id and s.status <> 'paid' and s.paid_amount < s.amount and s.due_date < current_date)`;
    }
    const r = await query(
      `select pl.*, c.name as customer_name,
              (select json_agg(row_to_json(s) order by s.installment_no) from installment_schedule s where s.plan_id = pl.id) as schedule
       from installment_plans pl join customers c on c.id = pl.customer_id
       where ${where} order by pl.created_at desc`,
      params
    );
    const plans = r.rows.map((p: any) => ({
      ...p,
      total_amount: Number(p.total_amount),
      schedule: decorate(p.schedule || []),
      has_overdue: (p.schedule || []).some((s: any) => s.status !== 'paid' && Number(s.paid_amount) < Number(s.amount) && s.due_date < new Date().toISOString().slice(0, 10)),
    }));
    res.json(plans);
  })
);

router.post(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('customers.edit') && !req.user!.permissions.includes('payments.create')) throw forbidden();
    const body = z.object({
      customer_id: z.string().uuid(),
      total_amount: z.number().positive(),
      installments_count: z.number().int().min(1).max(60),
      start_date: z.string(),
      interval_days: z.number().int().min(1).max(365).default(30),
      notes: z.string().optional().nullable(),
    }).parse(req.body);
    const cust = (await query(`select id from customers where id=$1 and deleted_at is null`, [body.customer_id])).rows[0];
    if (!cust) throw notFound('Customer not found');
    const plan = await withTransaction(async (client) => {
      const p = (await client.query(
        `insert into installment_plans (customer_id, total_amount, installments_count, start_date, interval_days, notes, created_by)
         values ($1,$2,$3,$4,$5,$6,$7) returning *`,
        [body.customer_id, body.total_amount, body.installments_count, body.start_date, body.interval_days, body.notes || null, req.user!.id]
      )).rows[0];
      const each = Math.round((body.total_amount / body.installments_count) * 100) / 100;
      let allocated = 0;
      for (let i = 1; i <= body.installments_count; i++) {
        const isLast = i === body.installments_count;
        const amt = isLast ? Math.round((body.total_amount - allocated) * 100) / 100 : each;
        allocated += amt;
        const due = new Date(body.start_date);
        due.setDate(due.getDate() + body.interval_days * (i - 1));
        await client.query(
          `insert into installment_schedule (plan_id, installment_no, due_date, amount) values ($1,$2,$3,$4)`,
          [p.id, i, due.toISOString().slice(0, 10), amt]
        );
      }
      return p;
    });
    await audit(req, { action: 'create', entity: 'installment_plan', entity_id: plan.id, new_value: plan });
    res.status(201).json(plan);
  })
);

/** Pay one installment — creates a real payment through the standard atomic flow. */
router.post(
  '/:id/pay',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('payments.create')) throw forbidden();
    const body = z.object({
      schedule_id: z.string().uuid(),
      amount: z.number().positive(),
      method: z.enum(['cash', 'transfer', 'other']).default('cash'),
      paid_at: z.string().optional(),
    }).parse(req.body);
    const result = await withTransaction(async (client) => {
      const s = (await client.query(`select s.*, pl.customer_id from installment_schedule s join installment_plans pl on pl.id = s.plan_id where s.id=$1 for update of s`, [body.schedule_id])).rows[0];
      if (!s) throw notFound('Installment not found');
      const remaining = Number(s.amount) - Number(s.paid_amount);
      if (remaining <= 0.005) throw badRequest('This installment is already paid');
      if (body.amount > remaining + 0.005) throw badRequest(`Amount exceeds the remaining ${remaining}`);
      const plan = (await client.query(`select * from installment_plans where id=$1`, [s.plan_id])).rows[0];
      if (plan.status !== 'active') throw badRequest('Plan is not active');

      const seq = await nextSequence(client, 'receipt');
      const receiptNumber = `R-${new Date().toISOString().slice(0, 7).replace('-', '')}-${String(seq).padStart(5, '0')}`;
      const paidAt = body.paid_at || new Date().toISOString().slice(0, 10);
      const p = (await client.query(
        `insert into payments (customer_id, amount, method, paid_at, receipt_number, received_by, notes)
         values ($1,$2,$3,$4,$5,$6,$7) returning *`,
        [s.customer_id, body.amount, body.method, paidAt, receiptNumber, req.user!.id, `Installment ${s.installment_no}/${plan.installments_count}`]
      )).rows[0];
      const cat = (await client.query(`select id from transaction_categories where is_default and name='customer_collections'`)).rows[0];
      const acc = (await client.query(
        `select id from accounts where is_active and deleted_at is null and type=$1 order by created_at limit 1`,
        [body.method === 'cash' ? 'cash' : 'bank']
      )).rows[0];
      const t = (await client.query(
        `insert into transactions (type, amount, category_id, occurred_at, method, account_id, customer_id, payment_id, notes, created_by)
         values ('income',$1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [body.amount, cat?.id || null, paidAt, body.method, acc?.id || null, s.customer_id, p.id, `Installment payment ${receiptNumber}`, req.user!.id]
      )).rows[0];
      await client.query(`update payments set transaction_id=$2 where id=$1`, [p.id, t.id]);
      if (acc) await client.query(`update accounts set balance = balance + $2 where id=$1`, [acc.id, body.amount]);

      const newPaid = Number(s.paid_amount) + body.amount;
      await client.query(
        `update installment_schedule set paid_amount=$2, status = case when $2 >= amount - 0.005 then 'paid' else 'pending' end where id=$1`,
        [s.id, newPaid]
      );
      const remaining2 = (await client.query(
        `select count(*) c from installment_schedule where plan_id=$1 and status <> 'paid'`, [plan.id]
      )).rows[0].c;
      if (Number(remaining2) === 0) {
        await client.query(`update installment_plans set status='completed' where id=$1`, [plan.id]);
      }
      const balance = (await client.query(`select balance from customer_balances where customer_id=$1`, [s.customer_id])).rows[0];
      return { payment: p, newBalance: balance?.balance ?? 0 };
    });
    await audit(req, { action: 'installment_payment', entity: 'installment_plan', entity_id: req.params.id, new_value: result.payment });
    res.status(201).json(result);
  })
);

router.post(
  '/:id/cancel',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('customers.edit')) throw forbidden();
    const body = z.object({ reason: z.string().min(3) }).parse(req.body);
    const plan = (await query(`select * from installment_plans where id=$1`, [req.params.id])).rows[0];
    if (!plan) throw notFound('Plan not found');
    await query(`update installment_plans set status='cancelled' where id=$1`, [req.params.id]);
    await audit(req, { action: 'cancel', entity: 'installment_plan', entity_id: req.params.id, old_value: plan, new_value: { status: 'cancelled', reason: body.reason } });
    res.json({ ok: true });
  })
);

export default router;
