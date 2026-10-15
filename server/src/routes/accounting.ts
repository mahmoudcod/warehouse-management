import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import {
  Transaction, TransactionCategory, Account, Transfer, ClosedPeriod, DailyClose, User, Customer,
  createWithId, withTransaction, isoDate, rx, r2, strip, todayStr,
} from '../db';
import { asyncH, badRequest, forbidden, notFound } from '../errors';
import { audit } from '../audit';
import { parseList, runAggList } from '../paging';
import { requireSuperAdmin } from '../middleware/auth';

const router = Router();

const numId = z.union([z.string(), z.number()]).transform((v) => Number(v));

const uploadDir = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['.png', '.jpg', '.jpeg', '.pdf', '.webp'].includes(path.extname(file.originalname).toLowerCase());
    cb(null, ok);
  },
});

async function assertPeriodOpen(session: any, dateStr: any, user: any) {
  const month = isoDate(dateStr).slice(0, 7);
  const closed: any = await ClosedPeriod.findOne({ period: `${month}-01` }).session(session);
  if (closed && user.role !== 'super_admin') {
    throw forbidden(`Month ${month} is closed — a Super Admin must approve changes to locked periods`);
  }
}

// ======================= Transactions =======================
router.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    const lp = parseList(req, { occurred_at: 'occurred_at', amount: 'amount', type: 'type', category: 'category_name' }, 'occurred_at');
    const match: any = { deleted_at: null };
    if (req.user!.permissions.includes('data.own_only')) match.created_by = req.user!.id;
    if (req.query.type) match.type = req.query.type;
    if (req.query.category_id) match.category_id = Number(req.query.category_id);
    if (req.query.account_id) match.account_id = Number(req.query.account_id);
    if (req.query.method) match.method = req.query.method;
    if (req.query.exclude_transfers === 'true') match.transfer_id = null;
    if (lp.from) match.occurred_at = { ...(match.occurred_at || {}), $gte: lp.from };
    if (lp.to) match.occurred_at = { ...(match.occurred_at || {}), $lte: lp.to };

    const pipeline: any[] = [
      { $match: match },
      {
        $lookup: { from: 'transactioncategories', localField: 'category_id', foreignField: 'id', as: 'tc', pipeline: [{ $project: { name: 1, name_ar: 1, _id: 0 } }] },
      },
      {
        $lookup: { from: 'accounts', localField: 'account_id', foreignField: 'id', as: 'a', pipeline: [{ $project: { name: 1, name_ar: 1, _id: 0 } }] },
      },
      {
        $lookup: { from: 'customers', localField: 'customer_id', foreignField: 'id', as: 'c', pipeline: [{ $project: { name: 1, _id: 0 } }] },
      },
      {
        $lookup: { from: 'users', localField: 'created_by', foreignField: 'id', as: 'u', pipeline: [{ $project: { name: 1, _id: 0 } }] },
      },
      {
        $set: {
          category_name: { $ifNull: [{ $arrayElemAt: ['$tc.name', 0] }, null] },
          category_name_ar: { $ifNull: [{ $arrayElemAt: ['$tc.name_ar', 0] }, null] },
          account_name: { $ifNull: [{ $arrayElemAt: ['$a.name', 0] }, null] },
          account_name_ar: { $ifNull: [{ $arrayElemAt: ['$a.name_ar', 0] }, null] },
          customer_name: { $ifNull: [{ $arrayElemAt: ['$c.name', 0] }, null] },
          created_by_name: { $ifNull: [{ $arrayElemAt: ['$u.name', 0] }, null] },
        },
      },
    ];
    if (lp.search) {
      const s = rx(lp.search);
      pipeline.push({
        $match: {
          $or: [
            { reference: s }, { notes: s }, { 'c.name': s }, { 'tc.name': s }, { 'tc.name_ar': s },
          ],
        },
      });
    }
    pipeline.push({ $unset: ['tc', 'a', 'c', 'u'] });
    const result = await runAggList(Transaction, pipeline, lp.sort, lp);
    res.json(result);
  })
);

const txBody = z.object({
  type: z.enum(['income', 'expense']),
  amount: z.number().positive(),
  category_id: numId.optional().nullable(),
  occurred_at: z.string(),
  method: z.enum(['cash', 'transfer', 'other']).default('cash'),
  account_id: numId.optional().nullable(),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post(
  '/',
  upload.single('attachment'),
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('accounting.create')) throw forbidden();
    const raw = typeof req.body.payload === 'string' ? JSON.parse(req.body.payload) : req.body;
    const body = txBody.parse(raw);
    const attachment = req.file ? `/uploads/${req.file.filename}` : null;
    const created = await withTransaction(async (session) => {
      await assertPeriodOpen(session, body.occurred_at, req.user);
      const t: any = await createWithId(
        Transaction,
        {
          type: body.type, amount: body.amount, category_id: body.category_id || null,
          occurred_at: body.occurred_at, method: body.method, account_id: body.account_id || null,
          reference: body.reference || null, notes: body.notes || null,
          attachment_path: attachment, created_by: req.user!.id,
        },
        session
      );
      if (body.account_id) {
        const sign = body.type === 'income' ? 1 : -1;
        await Account.updateOne({ id: body.account_id }, { $inc: { balance: sign * body.amount } }, { session });
      }
      return t;
    });
    await audit(req, { action: 'create', entity: 'transaction', entity_id: created.id, new_value: strip(created.toObject()) });
    res.status(201).json(strip(created.toObject()));
  })
);

router.patch(
  '/:id',
  upload.single('attachment'),
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('accounting.edit')) throw forbidden();
    const raw = typeof req.body.payload === 'string' ? JSON.parse(req.body.payload) : req.body;
    const body = txBody.partial().parse(raw);
    const attachment = req.file ? `/uploads/${req.file.filename}` : undefined;
    const result = await withTransaction(async (session) => {
      const t: any = await Transaction.findOne({ id: Number(req.params.id), deleted_at: null }).session(session);
      if (!t) throw notFound('Transaction not found');
      if (t.status === 'voided') throw badRequest('Cannot edit a voided transaction');
      if (t.payment_id) throw badRequest('This entry is linked to a customer payment — edit it from the Payments module');
      await assertPeriodOpen(session, t.occurred_at, req.user);
      if (body.occurred_at) await assertPeriodOpen(session, body.occurred_at, req.user);

      const newAmount = body.amount ?? t.amount;
      const newType = body.type || t.type;
      const newAccount = body.account_id !== undefined ? body.account_id : t.account_id;

      // Reverse the old effect, apply the new one
      if (t.account_id) {
        const oldSign = t.type === 'income' ? 1 : -1;
        await Account.updateOne({ id: t.account_id }, { $inc: { balance: -(oldSign * t.amount) } }, { session });
      }
      if (newAccount) {
        const newSign = newType === 'income' ? 1 : -1;
        await Account.updateOne({ id: newAccount }, { $inc: { balance: newSign * newAmount } }, { session });
      }
      const update: any = {
        type: newType, amount: newAmount, occurred_at: body.occurred_at || t.occurred_at,
        method: body.method || t.method, account_id: newAccount, updated_at: new Date(),
      };
      if (body.category_id !== undefined) update.category_id = body.category_id;
      if (body.reference !== undefined) update.reference = body.reference;
      if (body.notes !== undefined) update.notes = body.notes;
      if (attachment != null) update.attachment_path = attachment;
      await Transaction.updateOne({ id: t.id }, update, { session });
      const old = strip(t.toObject());
      const updated = strip(await Transaction.findOne({ id: t.id }).session(session).lean());
      return { old, updated };
    });
    await audit(req, { action: 'update', entity: 'transaction', entity_id: req.params.id, old_value: result.old, new_value: result.updated });
    res.json(result.updated);
  })
);

router.post(
  '/:id/void',
  asyncH(async (req: Request, res: Response) => {
    const perms = req.user!.permissions;
    if (!perms.includes('accounting.approve') && !perms.includes('accounting.delete') && req.user!.role !== 'super_admin') throw forbidden();
    const body = z.object({ reason: z.string().min(3) }).parse(req.body);
    const result = await withTransaction(async (session) => {
      const t: any = await Transaction.findOne({ id: Number(req.params.id), deleted_at: null }).session(session);
      if (!t) throw notFound('Transaction not found');
      if (t.status === 'voided') throw badRequest('Already voided');
      if (t.payment_id) throw badRequest('Void the linked customer payment instead');
      await assertPeriodOpen(session, t.occurred_at, req.user);
      if (t.transfer_id) {
        // Void both transactions of the transfer to prevent balance discrepancy
        const pair: any[] = await Transaction.find({ transfer_id: t.transfer_id, deleted_at: null }).session(session);
        for (const tx of pair) {
          if (tx.status !== 'voided' && tx.account_id) {
            const sign = tx.type === 'income' ? 1 : -1;
            await Account.updateOne({ id: tx.account_id }, { $inc: { balance: -(sign * tx.amount) } }, { session });
          }
        }
        await Transaction.updateMany(
          { transfer_id: t.transfer_id },
          { status: 'voided', void_reason: body.reason, updated_at: new Date() },
          { session }
        );
        const updated = strip(await Transaction.findOne({ id: t.id }).session(session).lean());
        return { old: strip(t.toObject()), updated };
      } else {
        if (t.account_id) {
          const sign = t.type === 'income' ? 1 : -1;
          await Account.updateOne({ id: t.account_id }, { $inc: { balance: -(sign * t.amount) } }, { session });
        }
        await Transaction.updateOne({ id: t.id }, { status: 'voided', void_reason: body.reason, updated_at: new Date() }, { session });
        const updated = strip(await Transaction.findOne({ id: t.id }).session(session).lean());
        return { old: strip(t.toObject()), updated };
      }
    });
    await audit(req, { action: 'void', entity: 'transaction', entity_id: req.params.id, old_value: result.old, new_value: { ...result.updated, reason: body.reason } });
    res.json(result.updated);
  })
);

// ======================= Categories =======================
router.get(
  '/categories',
  asyncH(async (_req: Request, res: Response) => {
    const rows = (await TransactionCategory.find({ deleted_at: null }).sort({ kind: 1, name: 1 }).lean()).map(strip);
    res.json(rows);
  })
);

router.post(
  '/categories',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('accounting.create')) throw forbidden();
    const body = z.object({ name: z.string().min(2), name_ar: z.string().optional().nullable(), kind: z.enum(['income', 'expense', 'both']) }).parse(req.body);
    const c: any = await createWithId(TransactionCategory, { name: body.name, name_ar: body.name_ar || null, kind: body.kind });
    await audit(req, { action: 'create', entity: 'transaction_category', entity_id: c.id, new_value: strip(c.toObject()) });
    res.status(201).json(strip(c.toObject()));
  })
);

router.delete(
  '/categories/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('accounting.delete')) throw forbidden();
    const used = await Transaction.countDocuments({ category_id: Number(req.params.id), deleted_at: null });
    if (used > 0) throw badRequest('Category is used by existing transactions');
    await TransactionCategory.updateOne({ id: Number(req.params.id), is_default: false }, { deleted_at: new Date() });
    await audit(req, { action: 'delete', entity: 'transaction_category', entity_id: req.params.id });
    res.json({ ok: true });
  })
);

// ======================= Accounts & transfers =======================
router.get(
  '/accounts',
  asyncH(async (_req: Request, res: Response) => {
    const accounts = (await Account.find({ deleted_at: null }).sort({ type: 1, created_at: 1 }).lean()).map(strip);
    const sums = await Transaction.aggregate([
      { $match: { account_id: { $ne: null }, status: 'active', deleted_at: null } },
      {
        $group: {
          _id: '$account_id',
          v: {
            $sum: {
              $cond: [{ $eq: ['$type', 'income'] }, '$amount', { $multiply: ['$amount', -1] }],
            },
          },
        },
      },
    ]);
    const sumById = new Map(sums.map((s: any) => [s._id, s.v]));
    res.json(accounts.map((a: any) => ({ ...a, balance: Number(a.balance), computed_balance: sumById.get(a.id) ?? 0 })));
  })
);

router.post(
  '/accounts',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('accounting.create') && req.user!.role !== 'super_admin') throw forbidden();
    const body = z.object({ name: z.string().min(2), name_ar: z.string().optional().nullable(), type: z.enum(['cash', 'bank']), opening_balance: z.number().optional() }).parse(req.body);
    const a: any = await createWithId(Account, { name: body.name, name_ar: body.name_ar || null, type: body.type, balance: body.opening_balance ?? 0 });
    await audit(req, { action: 'create', entity: 'account', entity_id: a.id, new_value: strip(a.toObject()) });
    res.status(201).json(strip(a.toObject()));
  })
);

/** Transfer between accounts — creates a linked expense/income pair. */
router.post(
  '/transfers',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('accounting.create')) throw forbidden();
    const body = z.object({
      from_account_id: numId,
      to_account_id: numId,
      amount: z.number().positive(),
      occurred_at: z.string(),
      notes: z.string().optional().nullable(),
    }).parse(req.body);
    if (body.from_account_id === body.to_account_id) throw badRequest('Accounts must differ');
    const result = await withTransaction(async (session) => {
      await assertPeriodOpen(session, body.occurred_at, req.user);
      const from: any = await Account.findOne({ id: body.from_account_id }).session(session);
      const to: any = await Account.findOne({ id: body.to_account_id }).session(session);
      if (!from || !to) throw notFound('Account not found');
      if (from.balance < body.amount) throw badRequest(`Insufficient balance in "${from.name}" (${from.balance})`);
      const tr: any = await createWithId(
        Transfer,
        {
          from_account_id: body.from_account_id, to_account_id: body.to_account_id,
          amount: body.amount, occurred_at: body.occurred_at, notes: body.notes || null, created_by: req.user!.id,
        },
        session
      );
      const cat: any = await TransactionCategory.findOne({ is_default: true, name: 'transfers', deleted_at: null }).session(session);
      await createWithId(
        Transaction,
        {
          type: 'expense', amount: body.amount, category_id: cat?.id ?? null, occurred_at: body.occurred_at,
          method: 'transfer', account_id: body.from_account_id, transfer_id: tr.id,
          notes: `Transfer out: ${body.notes || ''}`.trim(), created_by: req.user!.id,
        },
        session
      );
      await createWithId(
        Transaction,
        {
          type: 'income', amount: body.amount, category_id: cat?.id ?? null, occurred_at: body.occurred_at,
          method: 'transfer', account_id: body.to_account_id, transfer_id: tr.id,
          notes: `Transfer in: ${body.notes || ''}`.trim(), created_by: req.user!.id,
        },
        session
      );
      await Account.updateOne({ id: body.from_account_id }, { $inc: { balance: -body.amount } }, { session });
      await Account.updateOne({ id: body.to_account_id }, { $inc: { balance: body.amount } }, { session });
      return tr;
    });
    await audit(req, { action: 'transfer', entity: 'transfer', entity_id: result.id, new_value: strip(result.toObject()) });
    res.status(201).json(strip(result.toObject()));
  })
);

// ======================= Daily close =======================
router.get(
  '/daily-close',
  asyncH(async (req: Request, res: Response) => {
    const date = req.query.date ? String(req.query.date) : todayStr();
    const cashAccounts = (await Account.find({ type: 'cash', deleted_at: null, is_active: true }).lean()).map((a: any) => a.id);
    const accMatch = cashAccounts.length ? { account_id: { $in: cashAccounts } } : { account_id: { $exists: false } };

    const [openAgg, dayAgg, saved] = await Promise.all([
      Transaction.aggregate([
        { $match: { status: 'active', deleted_at: null, occurred_at: { $lt: date }, ...accMatch } },
        { $group: { _id: null, v: { $sum: { $cond: [{ $eq: ['$type', 'income'] }, '$amount', { $multiply: ['$amount', -1] }] } } } },
      ]),
      Transaction.aggregate([
        { $match: { status: 'active', deleted_at: null, occurred_at: date, ...accMatch } },
        {
          $group: {
            _id: null,
            total_in: { $sum: { $cond: [{ $eq: ['$type', 'income'] }, '$amount', 0] } },
            total_out: { $sum: { $cond: [{ $eq: ['$type', 'expense'] }, '$amount', 0] } },
          },
        },
      ]),
      DailyClose.findOne({ date }).lean(),
    ]);
    const opening = openAgg[0]?.v ?? 0;
    const totalIn = dayAgg[0]?.total_in ?? 0;
    const totalOut = dayAgg[0]?.total_out ?? 0;
    res.json({
      date,
      opening_balance: Number(opening),
      total_in: Number(totalIn),
      total_out: Number(totalOut),
      net: Number(totalIn) - Number(totalOut),
      closing_balance: Number(opening) + Number(totalIn) - Number(totalOut),
      saved: saved ? strip(saved) : null,
    });
  })
);

router.post(
  '/daily-close',
  asyncH(async (req: Request, res: Response) => {
    const body = z.object({ date: z.string(), counted_amount: z.number().nonnegative(), system_closing: z.number(), note: z.string().optional().nullable() }).parse(req.body);
    const diff = r2(body.counted_amount - body.system_closing);
    await DailyClose.findOneAndUpdate(
      { date: body.date },
      {
        counted_amount: body.counted_amount, system_closing: body.system_closing,
        difference: diff, note: body.note || null, closed_by: req.user!.id,
      },
      { upsert: true }
    );
    await audit(req, { action: 'daily_close', entity: 'daily_close', entity_id: body.date, new_value: { ...body, difference: diff } });
    res.json({ ok: true, difference: diff });
  })
);

// ======================= Closed (locked) periods =======================
router.get(
  '/periods',
  asyncH(async (_req: Request, res: Response) => {
    const rows = await ClosedPeriod.aggregate([
      { $lookup: { from: 'users', localField: 'closed_by', foreignField: 'id', as: 'u', pipeline: [{ $project: { name: 1, _id: 0 } }] } },
      { $set: { closed_by_name: { $ifNull: [{ $arrayElemAt: ['$u.name', 0] }, null] } } },
      { $sort: { period: -1 } },
      { $unset: ['u'] },
    ]);
    res.json(rows);
  })
);

router.post(
  '/periods',
  requireSuperAdmin,
  asyncH(async (req: Request, res: Response) => {
    const body = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.body);
    const period = `${body.month}-01`;
    await ClosedPeriod.updateOne({ period }, { $setOnInsert: { period, closed_by: req.user!.id } }, { upsert: true });
    await audit(req, { action: 'close_period', entity: 'period', entity_id: period, new_value: { month: body.month } });
    res.status(201).json({ ok: true });
  })
);

router.delete(
  '/periods/:month',
  requireSuperAdmin,
  asyncH(async (req: Request, res: Response) => {
    const period = `${req.params.month}-01`;
    await ClosedPeriod.deleteOne({ period });
    await audit(req, { action: 'reopen_period', entity: 'period', entity_id: period });
    res.json({ ok: true });
  })
);

export default router;
