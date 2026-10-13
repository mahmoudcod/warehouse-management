import { Router, Request, Response } from 'express';
import { query } from '../db';
import { asyncH } from '../errors';

import { requirePerm } from '../middleware/auth';

const router = Router();
router.use(requirePerm('reports.view'));

function range(req: Request): { from: string; to: string } {
  const now = new Date();
  const to = req.query.to ? String(req.query.to) : now.toISOString().slice(0, 10);
  const defaultFrom = new Date(now.getTime() - 180 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const from = req.query.from ? String(req.query.from) : defaultFrom;
  return { from, to };
}

/** Inventory valuation grouped by category. */
router.get(
  '/inventory-valuation',
  asyncH(async (_req: Request, res: Response) => {
    const r = await query(
      `select coalesce(c.name, 'Uncategorized') as category, coalesce(c.name_ar, c.name, 'بدون تصنيف') as category_ar,
              count(i.id) as items_count,
              coalesce(sum(i.quantity),0)::float8 as total_quantity,
              coalesce(sum(i.quantity * i.cost_price),0)::float8 as cost_value,
              coalesce(sum(i.quantity * i.selling_price),0)::float8 as sell_value
       from items i left join categories c on c.id = i.category_id
       where i.deleted_at is null
       group by c.name, c.name_ar order by cost_value desc`
    );
    const totals = r.rows.reduce(
      (acc: any, x: any) => ({
        items_count: acc.items_count + Number(x.items_count),
        total_quantity: acc.total_quantity + x.total_quantity,
        cost_value: acc.cost_value + x.cost_value,
        sell_value: acc.sell_value + x.sell_value,
      }),
      { items_count: 0, total_quantity: 0, cost_value: 0, sell_value: 0 }
    );
    res.json({ rows: r.rows, totals });
  })
);

/** Customer balances report (receivables). */
router.get(
  '/customer-balances',
  asyncH(async (req: Request, res: Response) => {
    const { from, to } = range(req);
    const r = await query(
      `select c.id, c.name, c.phone, cb.total_taken, cb.total_returned, cb.total_paid, cb.balance,
              (select count(*) from assignments a where a.customer_id = c.id and a.status='taken' and a.deleted_at is null) as open_assignments,
              (select max(a.assigned_at) from assignments a where a.customer_id = c.id and a.status='taken' and a.deleted_at is null) as oldest_open
       from customers c join customer_balances cb on cb.customer_id = c.id
       where c.deleted_at is null and ${req.query.all === 'true' ? 'true' : 'cb.balance > 0.005'}
       order by cb.balance desc`
    );
    res.json({ rows: r.rows, from, to });
  })
);

/** Receivables aging buckets, based on unpaid assignment age. */
router.get(
  '/receivables-aging',
  asyncH(async (_req: Request, res: Response) => {
    const r = await query(
      `select c.id, c.name, a.assigned_at,
              (a.amount - a.credited_amount)::float8 as outstanding,
              current_date - a.assigned_at as age_days
       from assignments a join customers c on c.id = a.customer_id
       where a.status='taken' and a.deleted_at is null and (a.amount - a.credited_amount) > 0.005
       order by a.assigned_at asc`
    );
    const buckets = { current: 0, d1_30: 0, d31_60: 0, d60_plus: 0 };
    const rows = r.rows.map((x: any) => {
      const b = x.age_days <= 30 ? 'current' : x.age_days <= 60 ? 'd1_30' : x.age_days <= 90 ? 'd31_60' : 'd60_plus';
      buckets[b as keyof typeof buckets] += Number(x.outstanding);
      return { ...x, outstanding: Number(x.outstanding), bucket: b };
    });
    res.json({ rows, buckets });
  })
);

/** Devices currently out with customers. */
router.get(
  '/devices-out',
  asyncH(async (req: Request, res: Response) => {
    const { from, to } = range(req);
    const r = await query(
      `select a.id, a.assigned_at, a.quantity, a.amount::float8 as amount, a.serial_numbers,
              c.name as customer_name, c.phone as customer_phone,
              coalesce(i.name, a.item_text) as item_name, coalesce(i.name_ar, i.name, a.item_text) as item_name_ar,
              u.name as created_by_name
       from assignments a
       join customers c on c.id = a.customer_id
       left join items i on i.id = a.item_id
       left join users u on u.id = a.created_by
       where a.status='taken' and a.deleted_at is null and a.assigned_at between $1 and $2
       order by a.assigned_at desc`,
      [from, to]
    );
    const total = r.rows.reduce((s: number, x: any) => s + Number(x.amount), 0);
    res.json({ rows: r.rows, total, from, to });
  })
);

/** Payments report. */
router.get(
  '/payments',
  asyncH(async (req: Request, res: Response) => {
    const { from, to } = range(req);
    const r = await query(
      `select p.paid_at, p.receipt_number, p.amount::float8 as amount, p.method, p.status,
              c.name as customer_name, u.name as received_by_name
       from payments p join customers c on c.id = p.customer_id
       left join users u on u.id = p.received_by
       where p.deleted_at is null and p.paid_at between $1 and $2
       order by p.paid_at desc`,
      [from, to]
    );
    const byMethod: Record<string, number> = {};
    let total = 0;
    for (const row of r.rows) {
      if (row.status === 'active') {
        total += row.amount;
        byMethod[row.method] = (byMethod[row.method] || 0) + row.amount;
      }
    }
    res.json({ rows: r.rows, total, byMethod, from, to });
  })
);

/** Income statement (P&L). */
router.get(
  '/income-statement',
  asyncH(async (req: Request, res: Response) => {
    const { from, to } = range(req);
    const income = (await query(
      `select coalesce(tc.name,'Other') as category, coalesce(tc.name_ar, tc.name, 'أخرى') as category_ar,
              sum(t.amount)::float8 as total, count(*) as entries
       from transactions t left join transaction_categories tc on tc.id = t.category_id
       where t.status='active' and t.deleted_at is null and t.type='income' and t.transfer_id is null
         and t.occurred_at between $1 and $2
       group by tc.name, tc.name_ar order by total desc`,
      [from, to]
    )).rows;
    const expense = (await query(
      `select coalesce(tc.name,'Other') as category, coalesce(tc.name_ar, tc.name, 'أخرى') as category_ar,
              sum(t.amount)::float8 as total, count(*) as entries
       from transactions t left join transaction_categories tc on tc.id = t.category_id
       where t.status='active' and t.deleted_at is null and t.type='expense' and t.transfer_id is null
         and t.occurred_at between $1 and $2
       group by tc.name, tc.name_ar order by total desc`,
      [from, to]
    )).rows;
    const totalIncome = income.reduce((s: number, x: any) => s + x.total, 0);
    const totalExpense = expense.reduce((s: number, x: any) => s + x.total, 0);
    res.json({ from, to, income, expense, totalIncome, totalExpense, netProfit: totalIncome - totalExpense });
  })
);

/** Cash flow: monthly in/out including transfers. */
router.get(
  '/cash-flow',
  asyncH(async (req: Request, res: Response) => {
    const { from, to } = range(req);
    const r = await query(
      `select to_char(date_trunc('month', t.occurred_at), 'YYYY-MM') as month,
              sum(case when t.type='income' then t.amount else 0 end)::float8 as inflow,
              sum(case when t.type='expense' then t.amount else 0 end)::float8 as outflow
       from transactions t
       where t.status='active' and t.deleted_at is null and t.occurred_at between $1 and $2
       group by 1 order by 1`,
      [from, to]
    );
    res.json({ rows: r.rows, from, to });
  })
);

/** Staff activity summary. */
router.get(
  '/staff-activity',
  asyncH(async (req: Request, res: Response) => {
    const { from, to } = range(req);
    const params: any[] = [from, to];
    const r = await query(
      `select coalesce(al.user_name, 'system') as user_name, al.user_id,
              count(*) as actions,
              count(*) filter (where al.action='login') as logins,
              count(*) filter (where al.entity='payment') as payment_actions,
              count(*) filter (where al.entity='assignment') as assignment_actions,
              count(*) filter (where al.entity='transaction') as transaction_actions,
              max(al.created_at) as last_action_at
       from audit_logs al
       where al.created_at::date between $1 and $2
       group by 1, 2 order by actions desc`,
      params
    );
    res.json({ rows: r.rows, from, to });
  })
);

export default router;
