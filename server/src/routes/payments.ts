import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  Payment, Transaction, Account, TransactionCategory, ClosedPeriod, Customer,
  createWithId, withTransaction, nextSequence, isoDate, customerBalance, rx, strip, todayStr,
} from '../db';
import { asyncH, badRequest, forbidden, notFound } from '../errors';
import { audit } from '../audit';
import { parseList, runAggList } from '../paging';

const router = Router();

const numId = z.union([z.string(), z.number()]).transform((v) => Number(v));

/** A month is locked → only Super Admin may touch entries inside it. */
async function assertPeriodOpen(session: any, dateStr: any, user: any) {
  const month = isoDate(dateStr).slice(0, 7);
  const closed: any = await ClosedPeriod.findOne({ period: `${month}-01` }).session(session);
  if (closed && user.role !== 'super_admin') {
    throw forbidden(`Month ${month} is closed — a Super Admin must approve changes to locked periods`);
  }
}

async function findDefaultCategory(session: any, name: string) {
  const cat: any = await TransactionCategory.findOne({ is_default: true, name, deleted_at: null }).session(session);
  return cat?.id ?? null;
}

async function pickAccount(session: any, method: string, explicitId?: number | null) {
  if (explicitId) return explicitId;
  const acc: any = await Account.findOne({
    is_active: true, deleted_at: null,
    type: method === 'cash' ? 'cash' : 'bank',
  }).sort({ created_at: 1 }).session(session);
  return acc?.id ?? null;
}

const createBody = z.object({
  customer_id: numId,
  amount: z.number().positive(),
  method: z.enum(['cash', 'transfer', 'other']).default('cash'),
  paid_at: z.string().optional(),
  account_id: numId.optional().nullable(),
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
    const result = await withTransaction(async (session) => {
      const cust: any = await Customer.findOne({ id: body.customer_id, deleted_at: null }).session(session);
      if (!cust) throw notFound('Customer not found');
      const paidAt = body.paid_at || todayStr();
      await assertPeriodOpen(session, paidAt, req.user);

      const seq = await nextSequence('receipt', session);
      const receiptNumber = `R-${new Date().toISOString().slice(0, 7).replace('-', '')}-${String(seq).padStart(5, '0')}`;

      const p: any = await createWithId(
        Payment,
        {
          customer_id: body.customer_id, amount: body.amount, method: body.method,
          paid_at: paidAt, receipt_number: receiptNumber, received_by: req.user!.id, notes: body.notes || null,
        },
        session
      );

      // Auto income entry in Accounting, linked to the source payment.
      const catId = await findDefaultCategory(session, 'customer_collections');
      const accountId = await pickAccount(session, body.method, body.account_id || null);
      const t: any = await createWithId(
        Transaction,
        {
          type: 'income', amount: body.amount, category_id: catId, occurred_at: p.paid_at,
          method: body.method, account_id: accountId, customer_id: body.customer_id, payment_id: p.id,
          notes: `Payment ${receiptNumber}`, created_by: req.user!.id,
        },
        session
      );
      await Payment.updateOne({ id: p.id }, { transaction_id: t.id }, { session });
      if (accountId) {
        await Account.updateOne({ id: accountId }, { $inc: { balance: body.amount } }, { session });
      }
      const balance = await customerBalance(body.customer_id);
      const payment = { ...strip(p.toObject()), transaction_id: t.id };
      return { payment, newBalance: balance.balance };
    });
    await audit(req, { action: 'create', entity: 'payment', entity_id: result.payment.id, new_value: result.payment });
    res.status(201).json(result);
  })
);

router.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    const lp = parseList(req, { paid_at: 'paid_at', amount: 'amount', customer: 'customer_name', receipt: 'receipt_number' }, 'paid_at');
    const match: any = { deleted_at: null };
    if (req.user!.permissions.includes('data.own_only')) match.received_by = req.user!.id;
    if (req.query.customer_id) match.customer_id = Number(req.query.customer_id);
    if (req.query.method) match.method = req.query.method;
    if (req.query.status) match.status = req.query.status;
    if (lp.from) match.paid_at = { ...(match.paid_at || {}), $gte: lp.from };
    if (lp.to) match.paid_at = { ...(match.paid_at || {}), $lte: lp.to };

    const pipeline: any[] = [
      { $match: match },
      {
        $lookup: { from: 'customers', localField: 'customer_id', foreignField: 'id', as: 'c', pipeline: [{ $project: { name: 1, phone: 1, _id: 0 } }] },
      },
      { $unwind: '$c' },
      {
        $lookup: { from: 'users', localField: 'received_by', foreignField: 'id', as: 'u', pipeline: [{ $project: { name: 1, _id: 0 } }] },
      },
      {
        $set: {
          customer_name: '$c.name',
          customer_phone: '$c.phone',
          received_by_name: { $ifNull: [{ $arrayElemAt: ['$u.name', 0] }, null] },
        },
      },
    ];
    if (lp.search) {
      const s = rx(lp.search);
      pipeline.push({ $match: { $or: [{ 'c.name': s }, { receipt_number: s }, { notes: s }] } });
    }
    pipeline.push({ $unset: ['c', 'u'] });
    const result = await runAggList(Payment, pipeline, lp.sort, lp);
    res.json(result);
  })
);

router.get(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    const rows = await Payment.aggregate([
      { $match: { id: Number(req.params.id), deleted_at: null } },
      { $lookup: { from: 'customers', localField: 'customer_id', foreignField: 'id', as: 'c', pipeline: [{ $project: { name: 1, phone: 1, _id: 0 } }] } },
      { $unwind: '$c' },
      { $lookup: { from: 'users', localField: 'received_by', foreignField: 'id', as: 'u', pipeline: [{ $project: { name: 1, _id: 0 } }] } },
      {
        $set: {
          customer_name: '$c.name',
          customer_phone: '$c.phone',
          received_by_name: { $ifNull: [{ $arrayElemAt: ['$u.name', 0] }, null] },
        },
      },
      { $unset: ['c', 'u', '_id'] },
    ]);
    if (!rows[0]) throw notFound('Payment not found');
    res.json({ ...rows[0], amount: Number(rows[0].amount) });
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
    const result = await withTransaction(async (session) => {
      const p: any = await Payment.findOne({ id: Number(req.params.id), deleted_at: null }).session(session);
      if (!p) throw notFound('Payment not found');
      if (p.status === 'voided') throw badRequest('Cannot edit a voided payment');
      await assertPeriodOpen(session, p.paid_at, req.user);
      if (body.paid_at) await assertPeriodOpen(session, body.paid_at, req.user);

      const newAmount = body.amount ?? p.amount;
      const newDate = body.paid_at || p.paid_at;
      const newMethod = body.method || p.method;
      await Payment.updateOne(
        { id: p.id },
        { amount: newAmount, method: newMethod, paid_at: newDate, notes: body.notes ?? p.notes, updated_at: new Date() },
        { session }
      );
      // sync linked transaction + account balance
      if (p.transaction_id) {
        const t: any = await Transaction.findOne({ id: p.transaction_id }).session(session);
        if (t) {
          if (t.account_id) {
            const delta = newAmount - t.amount;
            await Account.updateOne({ id: t.account_id }, { $inc: { balance: delta } }, { session });
          }
          await Transaction.updateOne(
            { id: t.id },
            { amount: newAmount, occurred_at: newDate, method: newMethod, updated_at: new Date() },
            { session }
          );
        }
      }
      const old = strip(p.toObject());
      const updated = strip(await Payment.findOne({ id: p.id }).session(session).lean());
      return { old, updated };
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
    const result = await withTransaction(async (session) => {
      const p: any = await Payment.findOne({ id: Number(req.params.id), deleted_at: null }).session(session);
      if (!p) throw notFound('Payment not found');
      if (p.status === 'voided') throw badRequest('Payment is already voided');
      await assertPeriodOpen(session, p.paid_at, req.user);
      await Payment.updateOne({ id: p.id }, { status: 'voided', void_reason: body.reason, updated_at: new Date() }, { session });
      if (p.transaction_id) {
        const t: any = await Transaction.findOne({ id: p.transaction_id }).session(session);
        if (t && t.status === 'active') {
          if (t.account_id) {
            await Account.updateOne({ id: t.account_id }, { $inc: { balance: -t.amount } }, { session });
          }
          await Transaction.updateOne(
            { id: t.id },
            { status: 'voided', void_reason: `Payment void: ${body.reason}`, updated_at: new Date() },
            { session }
          );
        }
      }
      const old = strip(p.toObject());
      const updated = strip(await Payment.findOne({ id: p.id }).session(session).lean());
      return { old, updated };
    });
    await audit(req, { action: 'void', entity: 'payment', entity_id: req.params.id, old_value: result.old, new_value: { ...result.updated, reason: body.reason } });
    res.json(result.updated);
  })
);

export default router;
