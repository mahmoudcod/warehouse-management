import { Router, Request, Response } from 'express';
import { Item, Customer, Assignment, Payment, Transaction, TransactionCategory, AuditLog, balanceMap, r2, strip, todayStr } from '../db';
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
    const rows = await Item.aggregate([
      { $match: { deleted_at: null } },
      {
        $lookup: { from: 'categories', localField: 'category_id', foreignField: 'id', as: 'c', pipeline: [{ $project: { name: 1, name_ar: 1, _id: 0 } }] },
      },
      {
        $group: {
          _id: '$category_id',
          category: { $first: { $ifNull: [{ $arrayElemAt: ['$c.name', 0] }, 'Uncategorized'] } },
          category_ar: { $first: { $ifNull: [{ $arrayElemAt: ['$c.name_ar', 0] }, { $ifNull: [{ $arrayElemAt: ['$c.name', 0] }, 'بدون تصنيف'] }] } },
          items_count: { $sum: 1 },
          total_quantity: { $sum: '$quantity' },
          cost_value: { $sum: { $multiply: ['$quantity', '$cost_price'] } },
          sell_value: { $sum: { $multiply: ['$quantity', '$selling_price'] } },
        },
      },
      { $sort: { cost_value: -1 } },
      { $unset: '_id' },
    ]);
    const totals = rows.reduce(
      (acc: any, x: any) => ({
        items_count: acc.items_count + Number(x.items_count),
        total_quantity: acc.total_quantity + x.total_quantity,
        cost_value: acc.cost_value + x.cost_value,
        sell_value: acc.sell_value + x.sell_value,
      }),
      { items_count: 0, total_quantity: 0, cost_value: 0, sell_value: 0 }
    );
    res.json({ rows, totals });
  })
);

/** Customer balances report (receivables). */
router.get(
  '/customer-balances',
  asyncH(async (req: Request, res: Response) => {
    const { from, to } = range(req);
    const customers = (await Customer.find({ deleted_at: null }).lean()).map(strip);
    const balances = await balanceMap(customers.map((c: any) => c.id));
    // open assignments per customer
    const openAgg = await Assignment.aggregate([
      { $match: { status: 'taken', deleted_at: null } },
      {
        $group: {
          _id: '$customer_id',
          open_assignments: { $sum: 1 },
          oldest_open: { $min: '$assigned_at' },
        },
      },
    ]);
    const openById = new Map(openAgg.map((o: any) => [o._id, o]));
    const rows = customers
      .map((c: any) => {
        const b = balances.get(c.id) ?? { total_taken: 0, total_returned: 0, total_paid: 0, balance: 0 };
        const open = openById.get(c.id);
        return {
          id: c.id, name: c.name, phone: c.phone,
          total_taken: b.total_taken, total_returned: b.total_returned, total_paid: b.total_paid, balance: b.balance,
          open_assignments: open?.open_assignments ?? 0,
          oldest_open: open?.oldest_open ?? null,
        };
      })
      .filter((r: any) => (req.query.all === 'true' ? true : r.balance > 0.005))
      .sort((a: any, b: any) => b.balance - a.balance);
    res.json({ rows, from, to });
  })
);

/** Receivables aging buckets, based on unpaid assignment age. */
router.get(
  '/receivables-aging',
  asyncH(async (_req: Request, res: Response) => {
    const rows0 = await Assignment.aggregate([
      { $match: { status: 'taken', deleted_at: null } },
      {
        $lookup: { from: 'customers', localField: 'customer_id', foreignField: 'id', as: 'c', pipeline: [{ $project: { name: 1, _id: 0 } }] },
      },
      { $unwind: '$c' },
      { $match: { $expr: { $gt: [{ $subtract: ['$amount', '$credited_amount'] }, 0.005] } } },
      {
        $set: {
          name: '$c.name',
          outstanding: { $subtract: ['$amount', '$credited_amount'] },
          age_days: {
            $divide: [
              { $subtract: [new Date(`${todayStr()}T00:00:00.000Z`), { $dateFromString: { dateString: { $concat: ['$assigned_at', 'T00:00:00Z'] } } }] },
              1000 * 60 * 60 * 24,
            ],
          },
        },
      },
      { $sort: { assigned_at: 1 } },
      { $unset: ['c'] },
    ]);
    const buckets: any = { current: 0, d1_30: 0, d31_60: 0, d60_plus: 0 };
    const rows = rows0.map((x: any) => {
      const days = Math.floor(x.age_days);
      const b = days <= 30 ? 'current' : days <= 60 ? 'd1_30' : days <= 90 ? 'd31_60' : 'd60_plus';
      buckets[b] += Number(x.outstanding);
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
    const rows = await Assignment.aggregate([
      { $match: { status: 'taken', deleted_at: null, assigned_at: { $gte: from, $lte: to } } },
      {
        $lookup: { from: 'customers', localField: 'customer_id', foreignField: 'id', as: 'c', pipeline: [{ $project: { name: 1, phone: 1, _id: 0 } }] },
      },
      { $unwind: '$c' },
      {
        $lookup: { from: 'items', localField: 'item_id', foreignField: 'id', as: 'i', pipeline: [{ $project: { name: 1, name_ar: 1, _id: 0 } }] },
      },
      {
        $lookup: { from: 'users', localField: 'created_by', foreignField: 'id', as: 'u', pipeline: [{ $project: { name: 1, _id: 0 } }] },
      },
      {
        $set: {
          customer_name: '$c.name',
          customer_phone: '$c.phone',
          item_name: { $ifNull: [{ $arrayElemAt: ['$i.name', 0] }, '$item_text'] },
          item_name_ar: { $ifNull: [{ $arrayElemAt: ['$i.name_ar', 0] }, { $ifNull: [{ $arrayElemAt: ['$i.name', 0] }, '$item_text'] }] },
          created_by_name: { $ifNull: [{ $arrayElemAt: ['$u.name', 0] }, null] },
        },
      },
      { $sort: { assigned_at: -1 } },
      { $unset: ['c', 'i', 'u'] },
    ]);
    const total = rows.reduce((s: number, x: any) => s + Number(x.amount), 0);
    res.json({ rows, total, from, to });
  })
);

/** Payments report. */
router.get(
  '/payments',
  asyncH(async (req: Request, res: Response) => {
    const { from, to } = range(req);
    const rows = await Payment.aggregate([
      { $match: { deleted_at: null, paid_at: { $gte: from, $lte: to } } },
      {
        $lookup: { from: 'customers', localField: 'customer_id', foreignField: 'id', as: 'c', pipeline: [{ $project: { name: 1, _id: 0 } }] },
      },
      { $unwind: '$c' },
      {
        $lookup: { from: 'users', localField: 'received_by', foreignField: 'id', as: 'u', pipeline: [{ $project: { name: 1, _id: 0 } }] },
      },
      {
        $set: {
          customer_name: '$c.name',
          received_by_name: { $ifNull: [{ $arrayElemAt: ['$u.name', 0] }, null] },
        },
      },
      {
        $project: {
          _id: 0, paid_at: 1, receipt_number: 1, amount: 1, method: 1, status: 1,
          customer_name: 1, received_by_name: 1,
        },
      },
      { $sort: { paid_at: -1 } },
    ]);
    const byMethod: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      if (row.status === 'active') {
        total += row.amount;
        byMethod[row.method] = (byMethod[row.method] || 0) + row.amount;
      }
    }
    res.json({ rows, total, byMethod, from, to });
  })
);

/** Income statement (P&L). */
router.get(
  '/income-statement',
  asyncH(async (req: Request, res: Response) => {
    const { from, to } = range(req);
    const groupStage = [
      {
        $lookup: { from: 'transactioncategories', localField: 'category_id', foreignField: 'id', as: 'tc', pipeline: [{ $project: { name: 1, name_ar: 1, _id: 0 } }] },
      },
      {
        $group: {
          _id: '$category_id',
          category: { $first: { $ifNull: [{ $arrayElemAt: ['$tc.name', 0] }, 'Other'] } },
          category_ar: { $first: { $ifNull: [{ $arrayElemAt: ['$tc.name_ar', 0] }, { $ifNull: [{ $arrayElemAt: ['$tc.name', 0] }, 'أخرى'] }] } },
          total: { $sum: '$amount' },
          entries: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
      { $unset: '_id' },
    ];
    const base = { status: 'active', deleted_at: null, transfer_id: null, occurred_at: { $gte: from, $lte: to } };
    const [income, expense] = await Promise.all([
      Transaction.aggregate([{ $match: { ...base, type: 'income' } }, ...groupStage] as any[]),
      Transaction.aggregate([{ $match: { ...base, type: 'expense' } }, ...groupStage] as any[]),
    ]);
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
    const rows = await Transaction.aggregate([
      { $match: { status: 'active', deleted_at: null, occurred_at: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { $substrCP: ['$occurred_at', 0, 7] },
          inflow: { $sum: { $cond: [{ $eq: ['$type', 'income'] }, '$amount', 0] } },
          outflow: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amount', 0] } },
        },
      },
      { $set: { month: '$_id' } },
      { $sort: { month: 1 } },
      { $unset: '_id' },
    ]);
    res.json({ rows, from, to });
  })
);

/** Staff activity summary. */
router.get(
  '/staff-activity',
  asyncH(async (req: Request, res: Response) => {
    const { from, to } = range(req);
    const rows = await AuditLog.aggregate([
      { $match: { created_at: { $gte: new Date(`${from}T00:00:00.000Z`), $lte: new Date(`${to}T23:59:59.999Z`) } } },
      {
        $group: {
          _id: { user_name: { $ifNull: ['$user_name', 'system'] }, user_id: '$user_id' },
          user_name: { $first: { $ifNull: ['$user_name', 'system'] } },
          user_id: { $first: '$user_id' },
          actions: { $sum: 1 },
          logins: { $sum: { $cond: [{ $eq: ['$action', 'login'] }, 1, 0] } },
          payment_actions: { $sum: { $cond: [{ $eq: ['$entity', 'payment'] }, 1, 0] } },
          assignment_actions: { $sum: { $cond: [{ $eq: ['$entity', 'assignment'] }, 1, 0] } },
          transaction_actions: { $sum: { $cond: [{ $eq: ['$entity', 'transaction'] }, 1, 0] } },
          last_action_at: { $max: '$created_at' },
        },
      },
      { $sort: { actions: -1 } },
      { $unset: '_id' },
    ]);
    res.json({ rows, from, to });
  })
);

export default router;
