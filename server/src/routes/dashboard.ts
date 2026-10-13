import { Router, Request, Response } from 'express';
import { query } from '../db';
import { asyncH } from '../errors';

const router = Router();

/** Everything the dashboard needs in one call. `from`/`to` drive the financial widgets. */
router.get(
  '/summary',
  asyncH(async (req: Request, res: Response) => {
    const now = new Date();
    const to = req.query.to ? String(req.query.to) : now.toISOString().slice(0, 10);
    const from = req.query.from
      ? String(req.query.from)
      : new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const monthsBack = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().slice(0, 10);

    const canFinancials = req.user!.permissions.includes('customers.view_financials');
    const canAccounting = req.user!.permissions.includes('accounting.view');

    const [stock, devicesOut, receivables, collected, incomeExpense, lowStock] = await Promise.all([
      query(
        `select coalesce(sum(quantity),0)::float8 as total_quantity,
                coalesce(sum(quantity * cost_price),0)::float8 as stock_cost_value,
                coalesce(sum(quantity * selling_price),0)::float8 as stock_sell_value
         from items where deleted_at is null and status='active'`
      ),
      query(
        `select count(*) as count, coalesce(sum(quantity),0)::float8 as quantity,
                coalesce(sum(amount - credited_amount),0)::float8 as amount
         from assignments where status='taken' and deleted_at is null`
      ),
      canFinancials
        ? query(`select coalesce(sum(balance),0)::float8 as total from customer_balances where balance > 0`)
        : Promise.resolve({ rows: [{ total: null }] }),
      canFinancials
        ? query(
            `select coalesce(sum(amount),0)::float8 as total from payments
             where status='active' and deleted_at is null and paid_at between $1 and $2`,
            [from, to]
          )
        : Promise.resolve({ rows: [{ total: null }] }),
      canAccounting
        ? query(
            `select
              coalesce(sum(case when type='income' then amount else 0 end),0)::float8 as income,
              coalesce(sum(case when type='expense' then amount else 0 end),0)::float8 as expense
             from transactions
             where status='active' and deleted_at is null and transfer_id is null and occurred_at between $1 and $2`,
            [from, to]
          )
        : Promise.resolve({ rows: [{ income: null, expense: null }] }),
      query(
        `select id, name, name_ar, quantity::float8 as quantity, min_stock_level::float8 as min_stock_level, sku
         from items
         where deleted_at is null and status='active' and min_stock_level > 0 and quantity <= min_stock_level
         order by (quantity - min_stock_level) asc limit 10`
      ),
    ]);

    const [incomeVsExpense, stockByCategory, topCustomers, monthlyCollections] = await Promise.all([
      canAccounting
        ? query(
            `select to_char(date_trunc('month', occurred_at), 'YYYY-MM') as month,
                    sum(case when type='income' then amount else 0 end)::float8 as income,
                    sum(case when type='expense' then amount else 0 end)::float8 as expense
             from transactions
             where status='active' and deleted_at is null and transfer_id is null and occurred_at >= $1
             group by 1 order by 1`,
            [monthsBack]
          )
        : Promise.resolve({ rows: [] }),
      query(
        `select coalesce(c.name, 'Uncategorized') as category, coalesce(c.name_ar, c.name, 'بدون تصنيف') as category_ar,
                coalesce(sum(i.quantity),0)::float8 as quantity,
                coalesce(sum(i.quantity * i.cost_price),0)::float8 as value
         from items i left join categories c on c.id = i.category_id
         where i.deleted_at is null group by 1,2 having sum(i.quantity) > 0 order by value desc`
      ),
      canFinancials
        ? query(`select c.id, c.name, cb.balance from customers c join customer_balances cb on cb.customer_id=c.id
                 where c.deleted_at is null and cb.balance > 0.005 order by cb.balance desc limit 5`)
        : Promise.resolve({ rows: [] }),
      canFinancials
        ? query(
            `select to_char(date_trunc('month', paid_at), 'YYYY-MM') as month, sum(amount)::float8 as total
             from payments where status='active' and deleted_at is null and paid_at >= $1
             group by 1 order by 1`,
            [monthsBack]
          )
        : Promise.resolve({ rows: [] }),
    ]);

    const [recentAssignments, recentPayments, recentTransactions] = await Promise.all([
      query(
        `select a.id, c.name as customer_name, coalesce(i.name, a.item_text) as item_name,
                coalesce(i.name_ar, i.name, a.item_text) as item_name_ar,
                a.amount::float8 as amount, a.assigned_at, a.status
         from assignments a join customers c on c.id=a.customer_id left join items i on i.id=a.item_id
         where a.deleted_at is null order by a.created_at desc limit 5`
      ),
      canFinancials
        ? query(
            `select p.id, c.name as customer_name, p.amount::float8 as amount, p.paid_at, p.method, p.status, p.receipt_number
             from payments p join customers c on c.id=p.customer_id
             where p.deleted_at is null order by p.created_at desc limit 5`
          )
        : Promise.resolve({ rows: [] }),
      canAccounting
        ? query(
            `select t.id, t.type, t.amount::float8 as amount, t.occurred_at,
                    coalesce(tc.name_ar, tc.name) as category
             from transactions t left join transaction_categories tc on tc.id=t.category_id
             where t.deleted_at is null order by t.created_at desc limit 5`
          )
        : Promise.resolve({ rows: [] }),
    ]);

    const overdueCount = canFinancials
      ? (
          await query(
            `select count(*) as c from installment_plans pl join installment_schedule s on s.plan_id=pl.id
             where pl.status='active' and s.status<>'paid' and s.paid_amount < s.amount and s.due_date < current_date`
          )
        ).rows[0].c
      : null;

    res.json({
      kpis: {
        items_in_stock: stock.rows[0].total_quantity,
        stock_cost_value: stock.rows[0].stock_cost_value,
        stock_sell_value: stock.rows[0].stock_sell_value,
        devices_out_count: Number(devicesOut.rows[0].count),
        devices_out_quantity: devicesOut.rows[0].quantity,
        devices_out_amount: devicesOut.rows[0].amount,
        total_receivables: receivables.rows[0].total,
        collected_in_range: collected.rows[0].total,
        income_in_range: incomeExpense.rows[0].income,
        expense_in_range: incomeExpense.rows[0].expense,
        net_profit_in_range:
          incomeExpense.rows[0].income != null ? incomeExpense.rows[0].income - incomeExpense.rows[0].expense : null,
        overdue_installments: Number(overdueCount || 0),
      },
      low_stock: lowStock.rows,
      charts: {
        income_vs_expense: incomeVsExpense.rows,
        stock_by_category: stockByCategory.rows,
        top_customers: topCustomers.rows,
        monthly_collections: monthlyCollections.rows,
      },
      recent: {
        assignments: recentAssignments.rows,
        payments: recentPayments.rows,
        transactions: recentTransactions.rows,
      },
      range: { from, to },
    });
  })
);

export default router;
