import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  InstallmentPlan, InstallmentSchedule, Payment, Transaction, Account, TransactionCategory, Customer,
  createWithId, withTransaction, nextSequence, customerBalance, r2, strip, todayStr,
} from '../db';
import { asyncH, badRequest, forbidden, notFound } from '../errors';
import { audit } from '../audit';

const router = Router();

const numId = z.union([z.string(), z.number()]).transform((v) => Number(v));

function decorate(rows: any[]) {
  const today = todayStr();
  return rows.map((s: any) => {
    const amount = Number(s.amount);
    const paid = Number(s.paid_amount);
    const remaining = r2(amount - paid);
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
    const match: any = { deleted_at: null };
    if (req.query.customer_id) match.customer_id = Number(req.query.customer_id);
    const plans = await InstallmentPlan.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'customers',
          localField: 'customer_id',
          foreignField: 'id',
          as: 'c',
          pipeline: [{ $project: { name: 1, _id: 0 } }],
        },
      },
      { $unwind: '$c' },
      {
        $lookup: {
          from: 'installmentschedules',
          localField: 'id',
          foreignField: 'plan_id',
          as: 'schedule',
          pipeline: [{ $project: { _id: 0 } }],
        },
      },
      { $set: { customer_name: '$c.name', schedule: { $sortArray: { input: '$schedule', sortBy: { installment_no: 1 } } } } },
      { $unset: ['c'] },
    ]);
    let out = plans.map((p: any) => {
      const schedule = decorate(p.schedule || []);
      const today = todayStr();
      return {
        ...p,
        total_amount: Number(p.total_amount),
        schedule,
        has_overdue: schedule.some((s: any) => s.status !== 'paid' && s.paid_amount < s.amount && s.due_date < today),
      };
    });
    if (req.query.overdue === 'true') out = out.filter((p: any) => p.has_overdue);
    out.sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1));
    res.json(out);
  })
);

router.post(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('customers.edit') && !req.user!.permissions.includes('payments.create')) throw forbidden();
    const body = z.object({
      customer_id: numId,
      total_amount: z.number().positive(),
      installments_count: z.number().int().min(1).max(60),
      start_date: z.string(),
      interval_days: z.number().int().min(1).max(365).default(30),
      notes: z.string().optional().nullable(),
    }).parse(req.body);
    const cust: any = await Customer.findOne({ id: body.customer_id, deleted_at: null }).lean();
    if (!cust) throw notFound('Customer not found');
    const plan = await withTransaction(async (session) => {
      const p: any = await createWithId(
        InstallmentPlan,
        {
          customer_id: body.customer_id, total_amount: body.total_amount,
          installments_count: body.installments_count, start_date: body.start_date,
          interval_days: body.interval_days, notes: body.notes || null, created_by: req.user!.id,
        },
        session
      );
      const each = r2(body.total_amount / body.installments_count);
      let allocated = 0;
      for (let i = 1; i <= body.installments_count; i++) {
        const isLast = i === body.installments_count;
        const amt = isLast ? r2(body.total_amount - allocated) : each;
        allocated += amt;
        const due = new Date(`${body.start_date}T00:00:00Z`);
        due.setUTCDate(due.getUTCDate() + body.interval_days * (i - 1));
        await createWithId(
          InstallmentSchedule,
          { plan_id: p.id, installment_no: i, due_date: due.toISOString().slice(0, 10), amount: amt },
          session
        );
      }
      return p;
    });
    await audit(req, { action: 'create', entity: 'installment_plan', entity_id: plan.id, new_value: strip(plan.toObject()) });
    res.status(201).json(strip(plan.toObject()));
  })
);

/** Pay one installment — creates a real payment through the standard atomic flow. */
router.post(
  '/:id/pay',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('payments.create')) throw forbidden();
    const body = z.object({
      schedule_id: numId,
      amount: z.number().positive(),
      method: z.enum(['cash', 'transfer', 'other']).default('cash'),
      paid_at: z.string().optional(),
    }).parse(req.body);
    const result = await withTransaction(async (session) => {
      const s: any = await InstallmentSchedule.findOne({ id: body.schedule_id }).session(session);
      if (!s) throw notFound('Installment not found');
      const plan: any = await InstallmentPlan.findOne({ id: s.plan_id }).session(session);
      if (!plan) throw notFound('Plan not found');
      const remaining = r2(s.amount - s.paid_amount);
      if (remaining <= 0.005) throw badRequest('This installment is already paid');
      if (body.amount > remaining + 0.005) throw badRequest(`Amount exceeds the remaining ${remaining}`);
      if (plan.status !== 'active') throw badRequest('Plan is not active');

      const seq = await nextSequence('receipt', session);
      const receiptNumber = `R-${new Date().toISOString().slice(0, 7).replace('-', '')}-${String(seq).padStart(5, '0')}`;
      const paidAt = body.paid_at || todayStr();
      const p: any = await createWithId(
        Payment,
        {
          customer_id: plan.customer_id, amount: body.amount, method: body.method,
          paid_at: paidAt, receipt_number: receiptNumber, received_by: req.user!.id,
          notes: `Installment ${s.installment_no}/${plan.installments_count}`,
        },
        session
      );
      const cat: any = await TransactionCategory.findOne({ is_default: true, name: 'customer_collections', deleted_at: null }).session(session);
      const acc: any = await Account.findOne({
        is_active: true, deleted_at: null, type: body.method === 'cash' ? 'cash' : 'bank',
      }).sort({ created_at: 1 }).session(session);
      const t: any = await createWithId(
        Transaction,
        {
          type: 'income', amount: body.amount, category_id: cat?.id ?? null, occurred_at: paidAt,
          method: body.method, account_id: acc?.id ?? null, customer_id: plan.customer_id, payment_id: p.id,
          notes: `Installment payment ${receiptNumber}`, created_by: req.user!.id,
        },
        session
      );
      await Payment.updateOne({ id: p.id }, { transaction_id: t.id }, { session });
      if (acc) await Account.updateOne({ id: acc.id }, { $inc: { balance: body.amount } }, { session });

      const newPaid = r2(s.paid_amount + body.amount);
      await InstallmentSchedule.updateOne(
        { id: s.id },
        { paid_amount: newPaid, status: newPaid >= s.amount - 0.005 ? 'paid' : 'pending' },
        { session }
      );
      const remainingCount = await InstallmentSchedule.countDocuments({ plan_id: plan.id, status: { $ne: 'paid' } }).session(session);
      if (remainingCount === 0) {
        await InstallmentPlan.updateOne({ id: plan.id }, { status: 'completed' }, { session });
      }
      const balance = await customerBalance(plan.customer_id);
      return { payment: strip(p.toObject()), newBalance: balance.balance };
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
    const plan: any = await InstallmentPlan.findOne({ id: Number(req.params.id) }).lean();
    if (!plan) throw notFound('Plan not found');
    await InstallmentPlan.updateOne({ id: plan.id }, { status: 'cancelled' });
    await audit(req, { action: 'cancel', entity: 'installment_plan', entity_id: req.params.id, old_value: strip(plan), new_value: { status: 'cancelled', reason: body.reason } });
    res.json({ ok: true });
  })
);

export default router;
