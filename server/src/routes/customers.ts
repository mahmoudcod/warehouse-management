import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query } from '../db';
import { asyncH, forbidden, notFound } from '../errors';
import { audit } from '../audit';
import { parseList, runList } from '../paging';

const router = Router();

const customerBody = z.object({
  name: z.string().min(2),
  phone: z.string().optional().nullable(),
  national_id: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  photo_url: z.string().optional().nullable(),
  is_active: z.boolean().optional(),
});

function ownOnlyFilter(req: Request): string {
  // "View only own records" granular permission
  return req.user!.permissions.includes('data.own_only') ? ` and c.created_by = '${req.user!.id}'` : '';
}

/** Customers list with server-computed balances. */
router.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('customers.view')) throw forbidden();
    const canFinancials0 = req.user!.permissions.includes('customers.view_financials');
    const sortable: Record<string, string> = canFinancials0
      ? { name: 'c.name', created_at: 'c.created_at', balance: 'cb.balance', total_taken: 'cb.total_taken' }
      : { name: 'c.name', created_at: 'c.created_at' };
    const lp = parseList(req, sortable, 'created_at');
    const params: any[] = [];
    let where = `c.deleted_at is null${ownOnlyFilter(req)}`;
    if (lp.search) {
      params.push(`%${lp.search}%`);
      where += ` and (c.name ilike $1 or coalesce(c.phone,'') ilike $1 or coalesce(c.national_id,'') ilike $1)`;
    }
    if (req.query.status === 'active') where += ` and c.is_active`;
    if (req.query.status === 'inactive') where += ` and not c.is_active`;
    if (req.query.status === 'owes') where += ` and coalesce(cb.balance, 0) > 0.005`;
    if (req.query.status === 'clear') where += ` and coalesce(cb.balance, 0) <= 0.005`;
    if (req.query.status === 'overdue') {
      where += ` and exists(select 1 from installment_plans pl join installment_schedule s on s.plan_id = pl.id
                            where pl.customer_id = c.id and pl.status = 'active' and s.status = 'pending'
                              and s.due_date < current_date and s.paid_amount < s.amount)`;
    }
    const canFinancials = req.user!.permissions.includes('customers.view_financials');
    const balanceSel = canFinancials
      ? `, cb.total_taken, cb.total_returned, cb.total_paid, cb.balance,
         (cb.balance > 0.005) as owes,
         exists(select 1 from installment_plans pl join installment_schedule s on s.plan_id = pl.id
                where pl.customer_id = c.id and pl.status = 'active' and s.status = 'pending'
                  and s.due_date < current_date and s.paid_amount < s.amount) as overdue`
      : '';
    const join = canFinancials ? `left join customer_balances cb on cb.customer_id = c.id` : '';
    const result = await runList(
      `select c.id, c.name, c.phone, c.national_id, c.address, c.notes, c.photo_url, c.is_active, c.created_at${balanceSel}
       from customers c ${join} where ${where}`,
      `select count(*) from customers c where ${where}`,
      params,
      lp
    );
    res.json(result);
  })
);

router.get(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('customers.view')) throw forbidden();
    const r = await query(`select * from customers where id = $1 and deleted_at is null`, [req.params.id]);
    if (!r.rows[0]) throw notFound('Customer not found');
    const canFinancials = req.user!.permissions.includes('customers.view_financials');
    const customer = r.rows[0];
    if (canFinancials) {
      const b = await query(`select * from customer_balances where customer_id = $1`, [req.params.id]);
      customer.total_taken = b.rows[0]?.total_taken ?? 0;
      customer.total_returned = b.rows[0]?.total_returned ?? 0;
      customer.total_paid = b.rows[0]?.total_paid ?? 0;
      customer.balance = b.rows[0]?.balance ?? 0;
      const od = await query(
        `select exists(select 1 from installment_plans pl join installment_schedule s on s.plan_id = pl.id
          where pl.customer_id = $1 and pl.status = 'active' and s.status = 'pending'
            and s.due_date < current_date and s.paid_amount < s.amount) as overdue`,
        [req.params.id]
      );
      customer.overdue = od.rows[0].overdue;
    }
    res.json(customer);
  })
);

router.post(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('customers.create')) throw forbidden();
    const body = customerBody.parse(req.body);
    const r = await query(
      `insert into customers (name, phone, national_id, address, notes, photo_url, created_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [body.name, body.phone || null, body.national_id || null, body.address || null, body.notes || null, body.photo_url || null, req.user!.id]
    );
    await audit(req, { action: 'create', entity: 'customer', entity_id: r.rows[0].id, new_value: r.rows[0] });
    res.status(201).json(r.rows[0]);
  })
);

router.patch(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('customers.edit')) throw forbidden();
    const body = customerBody.partial().parse(req.body);
    const old = (await query(`select * from customers where id = $1 and deleted_at is null`, [req.params.id])).rows[0];
    if (!old) throw notFound('Customer not found');
    const r = await query(
      `update customers set name=coalesce($2,name), phone=$3, national_id=$4, address=$5, notes=$6,
        photo_url=coalesce($7,photo_url), is_active=coalesce($8,is_active), updated_at=now()
       where id=$1 returning *`,
      [req.params.id, body.name, body.phone ?? old.phone, body.national_id ?? old.national_id,
       body.address ?? old.address, body.notes ?? old.notes, body.photo_url ?? null, body.is_active ?? null]
    );
    await audit(req, { action: 'update', entity: 'customer', entity_id: req.params.id, old_value: old, new_value: r.rows[0] });
    res.json(r.rows[0]);
  })
);

/** Soft delete — financial history is never destroyed. */
router.delete(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('customers.delete')) throw forbidden();
    const old = (await query(`select * from customers where id = $1 and deleted_at is null`, [req.params.id])).rows[0];
    if (!old) throw notFound('Customer not found');
    await query(`update customers set deleted_at = now(), is_active = false where id = $1`, [req.params.id]);
    await audit(req, { action: 'delete', entity: 'customer', entity_id: req.params.id, old_value: old });
    res.json({ ok: true });
  })
);

/** Chronological ledger: debits (devices taken) and credits (payments) with running balance. */
router.get(
  '/:id/statement',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('customers.view_financials')) throw forbidden();
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const params: any[] = [req.params.id];
    let dateFilter = '';
    if (from) { params.push(from); dateFilter += ` and e.date >= $${params.length}`; }
    if (to) { params.push(to); dateFilter += ` and e.date <= $${params.length}`; }
    const r = await query(
      `select * from (
         select a.assigned_at as date, 'debit' as kind, 'assignment' as source, a.id, a.item_text,
                coalesce(a.item_text, i.name, i.name_ar) as label,
                (a.amount - a.credited_amount)::float8 as amount, a.status, a.notes
         from assignments a left join items i on i.id = a.item_id
         where a.customer_id = $1 and a.status <> 'voided' and a.deleted_at is null
         union all
         select p.paid_at as date, 'credit' as kind, 'payment' as source, p.id, null as item_text,
                p.receipt_number as label, p.amount::float8 as amount, p.status, p.notes
         from payments p
         where p.customer_id = $1 and p.status = 'active' and p.deleted_at is null
       ) e where true ${dateFilter}
       order by e.date asc, e.kind desc`,
      params
    );
    let running = 0;
    const entries = r.rows.map((row: any) => {
      running += row.kind === 'debit' ? Number(row.amount) : -Number(row.amount);
      return { ...row, amount: Number(row.amount), running_balance: Math.round(running * 100) / 100 };
    });
    const opening = from
      ? (await query(
          `select (
             coalesce((select sum(a.amount - a.credited_amount) from assignments a where a.customer_id=$1 and a.status<>'voided' and a.deleted_at is null and a.assigned_at < $2),0)
             - coalesce((select sum(p.amount) from payments p where p.customer_id=$1 and p.status='active' and p.deleted_at is null and p.paid_at < $2),0)
           )::float8 as opening`, [req.params.id, from]
        )).rows[0].opening
      : 0;
    if (from) {
      let running2 = Number(opening);
      for (const e of entries) {
        running2 += e.kind === 'debit' ? e.amount : -e.amount;
        e.running_balance = Math.round(running2 * 100) / 100;
      }
    }
    const cust = (await query(`select id, name, phone, address from customers where id = $1`, [req.params.id])).rows[0];
    const totals = entries.reduce(
      (acc: any, e: any) => {
        if (e.kind === 'debit') acc.debits += e.amount; else acc.credits += e.amount;
        return acc;
      },
      { debits: 0, credits: 0 }
    );
    res.json({ customer: cust, opening_balance: Number(opening), entries, totals, closing_balance: Number(opening) + totals.debits - totals.credits });
  })
);

export default router;
