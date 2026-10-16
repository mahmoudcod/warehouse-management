import { Router, Request, Response } from 'express';
import {
  Item, Assignment, Payment, Transaction, TransactionCategory, Customer, Warehouse,
  balanceMap, overdueCustomerSet, r2, todayStr, strip,
} from '../db';
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

    const [stockAgg, devicesOutAgg, lowStock, txRangeAgg, txMonthsAgg, stockByCategoryAgg, paymentsRangeAgg, paymentsMonthsAgg] =
      await Promise.all([
        Item.aggregate([
          { $match: { deleted_at: null, status: 'active' } },
          {
            $group: {
              _id: null,
              total_quantity: { $sum: '$quantity' },
              stock_cost_value: { $sum: { $multiply: ['$quantity', '$cost_price'] } },
              stock_sell_value: { $sum: { $multiply: ['$quantity', '$selling_price'] } },
            },
          },
        ]),
        Assignment.aggregate([
          { $match: { status: 'taken', deleted_at: null } },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              quantity: { $sum: '$quantity' },
              amount: { $sum: { $subtract: ['$amount', '$credited_amount'] } },
            },
          },
        ]),
        Item.aggregate([
          { $match: { deleted_at: null, status: 'active', min_stock_level: { $gt: 0 }, $expr: { $lte: ['$quantity', '$min_stock_level'] } } },
          { $set: { stock_gap: { $subtract: ['$quantity', '$min_stock_level'] } } },
          { $sort: { stock_gap: 1 } },
          { $limit: 10 },
          { $unset: ['stock_gap', '_id'] },
          {
            $set: {
              quantity: { $toDouble: '$quantity' },
              min_stock_level: { $toDouble: '$min_stock_level' },
            },
          },
        ]),
        canAccounting
          ? Transaction.aggregate([
              { $match: { status: 'active', deleted_at: null, transfer_id: null, occurred_at: { $gte: from, $lte: to } } },
              {
                $group: {
                  _id: null,
                  income: { $sum: { $cond: [{ $eq: ['$type', 'income'] }, '$amount', 0] } },
                  expense: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amount', 0] } },
                },
              },
            ])
          : Promise.resolve([]),
        canAccounting
          ? Transaction.aggregate([
              { $match: { status: 'active', deleted_at: null, transfer_id: null, occurred_at: { $gte: monthsBack } } },
              {
                $group: {
                  _id: { $substrCP: ['$occurred_at', 0, 7] },
                  income: { $sum: { $cond: [{ $eq: ['$type', 'income'] }, '$amount', 0] } },
                  expense: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amount', 0] } },
                },
              },
              { $set: { month: '$_id' } },
              { $sort: { month: 1 } },
              { $unset: '_id' },
            ])
          : Promise.resolve([]),
        Item.aggregate([
          { $match: { deleted_at: null } },
          {
            $lookup: { from: 'categories', localField: 'category_id', foreignField: 'id', as: 'c', pipeline: [{ $project: { name: 1, name_ar: 1, _id: 0 } }] },
          },
          {
            $group: {
              _id: '$category_id',
              category: { $first: { $ifNull: [{ $arrayElemAt: ['$c.name', 0] }, 'Uncategorized'] } },
              category_ar: { $first: { $ifNull: [{ $arrayElemAt: ['$c.name_ar', 0] }, { $ifNull: [{ $arrayElemAt: ['$c.name', 0] }, 'بدون تصنيف'] }] } },
              quantity: { $sum: '$quantity' },
              value: { $sum: { $multiply: ['$quantity', '$cost_price'] } },
            },
          },
          { $match: { quantity: { $gt: 0 } } },
          { $sort: { value: -1 } },
          { $unset: '_id' },
        ]),
        canFinancials
          ? Payment.aggregate([
              { $match: { status: 'active', deleted_at: null, paid_at: { $gte: from, $lte: to } } },
              { $group: { _id: null, total: { $sum: '$amount' } } },
            ])
          : Promise.resolve([]),
        canFinancials
          ? Payment.aggregate([
              { $match: { status: 'active', deleted_at: null, paid_at: { $gte: monthsBack } } },
              { $group: { _id: { $substrCP: ['$paid_at', 0, 7] }, total: { $sum: '$amount' } } },
              { $set: { month: '$_id' } },
              { $sort: { month: 1 } },
              { $unset: '_id' },
            ])
          : Promise.resolve([]),
      ]);

    // receivables / top customers (financials only)
    let totalReceivables: number | null = null;
    let topCustomers: any[] = [];
    if (canFinancials) {
      const customers = await Customer.find({ deleted_at: null }).lean();
      const balances = await balanceMap(customers.map((c: any) => c.id));
      let sum = 0;
      const all: any[] = [];
      for (const c of customers as any[]) {
        const b = balances.get(c.id);
        if (b && b.balance > 0) {
          sum += b.balance;
          all.push({ id: c.id, name: c.name, balance: b.balance });
        }
      }
      totalReceivables = r2(sum);
      topCustomers = all.sort((a, b) => b.balance - a.balance).slice(0, 5);
    }

    const recentAssignments = await Assignment.aggregate([
      { $match: { deleted_at: null } },
      { $sort: { created_at: -1 } },
      { $limit: 5 },
      {
        $lookup: { from: 'customers', localField: 'customer_id', foreignField: 'id', as: 'c', pipeline: [{ $project: { name: 1, _id: 0 } }] },
      },
      { $unwind: '$c' },
      {
        $lookup: { from: 'items', localField: 'item_id', foreignField: 'id', as: 'i', pipeline: [{ $project: { name: 1, name_ar: 1, _id: 0 } }] },
      },
      {
        $set: {
          customer_name: '$c.name',
          item_name: { $ifNull: [{ $arrayElemAt: ['$i.name', 0] }, '$item_text'] },
          item_name_ar: { $ifNull: [{ $arrayElemAt: ['$i.name_ar', 0] }, { $ifNull: [{ $arrayElemAt: ['$i.name', 0] }, '$item_text'] }] },
        },
      },
      { $project: { _id: 0, id: 1, customer_name: 1, item_name: 1, item_name_ar: 1, amount: 1, assigned_at: 1, status: 1 } },
    ]);

    let recentPayments: any[] = [];
    if (canFinancials) {
      recentPayments = await Payment.aggregate([
        { $match: { deleted_at: null } },
        { $sort: { created_at: -1 } },
        { $limit: 5 },
        {
          $lookup: { from: 'customers', localField: 'customer_id', foreignField: 'id', as: 'c', pipeline: [{ $project: { name: 1, _id: 0 } }] },
        },
        { $unwind: '$c' },
        { $set: { customer_name: '$c.name' } },
        { $project: { _id: 0, id: 1, customer_name: 1, amount: 1, paid_at: 1, method: 1, status: 1, receipt_number: 1 } },
      ]);
    }

    let recentTransactions: any[] = [];
    if (canAccounting) {
      recentTransactions = await Transaction.aggregate([
        { $match: { deleted_at: null } },
        { $sort: { created_at: -1 } },
        { $limit: 5 },
        {
          $lookup: { from: 'transactioncategories', localField: 'category_id', foreignField: 'id', as: 'tc', pipeline: [{ $project: { name: 1, name_ar: 1, _id: 0 } }] },
        },
        {
          $set: { category: { $ifNull: [{ $arrayElemAt: ['$tc.name_ar', 0] }, { $arrayElemAt: ['$tc.name', 0] }] } },
        },
        { $project: { _id: 0, id: 1, type: 1, amount: 1, occurred_at: 1, category: 1 } },
      ]);
    }

    let overdueCount: number | null = null;
    if (canFinancials) {
      const { InstallmentPlan } = await import('../db');
      const set = await overdueCustomerSet();
      const agg = await InstallmentPlan.aggregate([
        { $match: { status: 'active' } },
        {
          $lookup: {
            from: 'installmentschedules',
            localField: 'id',
            foreignField: 'plan_id',
            as: 's',
            pipeline: [
              { $match: { status: { $ne: 'paid' }, $expr: { $and: [{ $lt: ['$paid_amount', '$amount'] }, { $lt: ['$due_date', todayStr()] }] } } },
            ],
          },
        },
        { $project: { n: { $size: '$s' } } },
        { $group: { _id: null, n: { $sum: '$n' } } },
      ]);
      overdueCount = agg[0]?.n ?? 0;
      void set;
    }

    // Stock distribution per warehouse (quantity + value) for the dashboard widget
    const stockByWarehouse = await Item.aggregate([
      { $match: { deleted_at: null } },
      {
        $group: {
          _id: '$warehouse_id',
          items_count: { $sum: 1 },
          quantity: { $sum: '$quantity' },
          cost_value: { $sum: { $multiply: ['$cost_price', '$quantity'] } },
          sell_value: { $sum: { $multiply: ['$selling_price', '$quantity'] } },
        },
      },
      { $sort: { quantity: -1 } },
    ]);
    const whDocs = await Warehouse.find({ deleted_at: null }).lean();
    const whName = new Map(whDocs.map((w: any) => [w.id, { name: w.name, name_ar: w.name_ar }]));
    const warehouses = stockByWarehouse.map((s: any) => ({
      warehouse_id: s._id,
      name: whName.get(s._id)?.name ?? '—',
      name_ar: whName.get(s._id)?.name_ar ?? null,
      items_count: s.items_count,
      quantity: s.quantity,
      cost_value: Math.round(s.cost_value * 100) / 100,
      sell_value: Math.round(s.sell_value * 100) / 100,
    }));

    res.json({
      kpis: {
        items_in_stock: stockAgg[0]?.total_quantity ?? 0,
        stock_cost_value: stockAgg[0]?.stock_cost_value ?? 0,
        stock_sell_value: stockAgg[0]?.stock_sell_value ?? 0,
        devices_out_count: devicesOutAgg[0]?.count ?? 0,
        devices_out_quantity: devicesOutAgg[0]?.quantity ?? 0,
        devices_out_amount: devicesOutAgg[0]?.amount ?? 0,
        total_receivables: totalReceivables,
        collected_in_range: paymentsRangeAgg[0]?.total ?? null,
        income_in_range: canAccounting ? txRangeAgg[0]?.income ?? 0 : null,
        expense_in_range: canAccounting ? txRangeAgg[0]?.expense ?? 0 : null,
        net_profit_in_range: canAccounting ? (txRangeAgg[0] ? txRangeAgg[0].income - txRangeAgg[0].expense : null) : null,
        overdue_installments: overdueCount ?? 0,
      },
      low_stock: lowStock.map(strip),
      charts: {
        income_vs_expense: txMonthsAgg,
        stock_by_category: stockByCategoryAgg,
        top_customers: topCustomers,
        monthly_collections: paymentsMonthsAgg,
      },
      warehouses,
      recent: {
        assignments: recentAssignments,
        payments: recentPayments,
        transactions: recentTransactions,
      },
      range: { from, to },
    });
  })
);

export default router;
