import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  Assignment, Item, ItemUnit, StockMovement, Payment, Transaction, Account, TransactionCategory, ClosedPeriod,
  createWithId, withTransaction, nextSequence, customerBalance, rx, r2, strip, todayStr,
} from '../db';
import { asyncH, badRequest, forbidden, notFound } from '../errors';
import { audit } from '../audit';
import { parseList, runAggList } from '../paging';

const router = Router();

const numId = z.union([z.string(), z.number()]).transform((v) => Number(v));

const createBody = z.object({
  customer_id: numId,
  item_id: numId.optional().nullable(),
  item_text: z.string().optional().nullable(),
  quantity: z.number().positive().default(1),
  unit_price: z.number().nonnegative().optional(),
  amount: z.number().nonnegative(),
  paid_amount: z.number().nonnegative().optional().default(0), // payment taken at the same moment
  payment_method: z.enum(['cash', 'transfer', 'other']).optional(),
  serial_numbers: z.string().optional().nullable(),
  unit_ids: z.array(numId).optional(),
  assigned_at: z.string().optional(),
  notes: z.string().optional().nullable(),
});

/**
 * Record "customer took a device for amount Y".
 * Atomic: validates stock, decrements it, writes a stock movement, marks
 * serialized units, and inserts the assignment (the debit).
 * Optionally records the payment taken on the spot: payment row + linked
 * income transaction + account balance, all in the same transaction.
 */
router.post(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('assignments.create')) throw forbidden();
    const body = createBody.parse(req.body);
    if (!body.item_id && !body.item_text) throw badRequest('Pick an inventory item or enter a free-text description');
    if (body.paid_amount > 0 && !req.user!.permissions.includes('payments.create')) throw forbidden();
    const created = await withTransaction(async (session) => {
      let itemName: string | null = null;
      let qty = body.quantity;
      if (body.item_id) {
        const item: any = await Item.findOne({ id: body.item_id, deleted_at: null }).session(session);
        if (!item) throw notFound('Item not found');
        if (item.status !== 'active') throw badRequest('Item is archived');
        if (body.unit_ids && body.unit_ids.length) qty = body.unit_ids.length;
        if (item.quantity < qty) throw badRequest(`Not enough stock for "${item.name}" (available: ${item.quantity})`);
        await Item.updateOne({ id: item.id }, { $inc: { quantity: -qty }, $set: { updated_at: new Date() } }, { session });
        await createWithId(
          StockMovement,
          {
            item_id: item.id, movement_type: 'assignment', quantity: -qty, to_warehouse_id: null,
            reason: body.notes || 'Assigned to customer', performed_by: req.user!.id, reference_type: 'assignment_out',
          },
          session
        );
        for (const uid of body.unit_ids || []) {
          const u = await ItemUnit.findOneAndUpdate(
            { id: uid, item_id: item.id, status: 'in_stock' },
            { $set: { status: 'assigned' } },
            { session }
          );
          if (!u) throw badRequest('One of the selected serials is not in stock');
        }
        itemName = item.name;
      }
      const a: any = await createWithId(
        Assignment,
        {
          customer_id: body.customer_id,
          item_id: body.item_id || null,
          item_text: body.item_text || itemName,
          quantity: qty,
          unit_price: body.unit_price ?? (qty > 0 ? body.amount / qty : 0),
          amount: body.amount,
          serial_numbers: body.serial_numbers || null,
          assigned_at: body.assigned_at || todayStr(),
          notes: body.notes || null,
          created_by: req.user!.id,
        },
        session
      );
      // link serialized units to the new assignment
      for (const uid of body.unit_ids || []) {
        await ItemUnit.updateOne({ id: uid }, { assignment_id: a.id }, { session });
      }
      // payment taken on the spot → same accounting flow as POST /payments
      let receiptNumber: string | null = null;
      if (body.paid_amount > 0) {
        const method = body.payment_method || 'cash';
        const month = a.assigned_at.slice(0, 7);
        const closed: any = await ClosedPeriod.findOne({ period: `${month}-01` }).session(session);
        if (closed && req.user!.role !== 'super_admin') {
          throw forbidden(`Month ${month} is closed — a Super Admin must approve changes to locked periods`);
        }
        const seq = await nextSequence('receipt', session);
        receiptNumber = `R-${new Date().toISOString().slice(0, 7).replace('-', '')}-${String(seq).padStart(5, '0')}`;
        const p: any = await createWithId(
          Payment,
          {
            customer_id: body.customer_id, amount: body.paid_amount, method,
            paid_at: a.assigned_at, receipt_number: receiptNumber, received_by: req.user!.id,
            notes: `دفعة عند تسجيل جهاز #${a.id}`,
          },
          session
        );
        const cat: any = await TransactionCategory.findOne({ is_default: true, name: 'customer_collections', deleted_at: null }).session(session);
        const acc: any = await Account.findOne({ is_active: true, deleted_at: null, type: method === 'cash' ? 'cash' : 'bank' }).sort({ created_at: 1 }).session(session);
        const t: any = await createWithId(
          Transaction,
          {
            type: 'income', amount: body.paid_amount, category_id: cat?.id ?? null, occurred_at: a.assigned_at,
            method, account_id: acc?.id ?? null, customer_id: body.customer_id, payment_id: p.id,
            notes: `Payment ${receiptNumber} — assignment #${a.id}`, created_by: req.user!.id,
          },
          session
        );
        await Payment.updateOne({ id: p.id }, { transaction_id: t.id }, { session });
        if (acc?.id) await Account.updateOne({ id: acc.id }, { $inc: { balance: body.paid_amount } }, { session });
        await Assignment.updateOne({ id: a.id }, { initial_paid: body.paid_amount, payment_id: p.id }, { session });
      }
      return a;
    });
    await audit(req, { action: 'create', entity: 'assignment', entity_id: created.id, new_value: { ...strip(created.toObject()), initial_paid: body.paid_amount } });
    const payload: any = strip(created.toObject());
    payload.initial_paid = body.paid_amount;
    if (body.paid_amount > 0) {
      const bal = await customerBalance(body.customer_id);
      payload.new_balance = bal.balance;
    }
    res.status(201).json(payload);
  })
);

router.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    const lp = parseList(req, { assigned_at: 'assigned_at', amount: 'amount', customer: 'customer_name' }, 'assigned_at');
    const match: any = { deleted_at: null };
    if (req.user!.permissions.includes('data.own_only')) match.created_by = req.user!.id;
    if (req.query.customer_id) match.customer_id = Number(req.query.customer_id);
    if (req.query.status) match.status = req.query.status;
    if (req.query.item_id) match.item_id = Number(req.query.item_id);
    if (lp.from) match.assigned_at = { ...(match.assigned_at || {}), $gte: lp.from };
    if (lp.to) match.assigned_at = { ...(match.assigned_at || {}), $lte: lp.to };

    const pipeline: any[] = [
      { $match: match },
      {
        $lookup: { from: 'customers', localField: 'customer_id', foreignField: 'id', as: 'c', pipeline: [{ $project: { name: 1, phone: 1, _id: 0 } }] },
      },
      { $unwind: '$c' },
      {
        $lookup: { from: 'items', localField: 'item_id', foreignField: 'id', as: 'i', pipeline: [{ $project: { name: 1, name_ar: 1, sku: 1, _id: 0 } }] },
      },
      {
        $lookup: { from: 'users', localField: 'created_by', foreignField: 'id', as: 'u', pipeline: [{ $project: { name: 1, _id: 0 } }] },
      },
      {
        $set: {
          customer_name: '$c.name',
          customer_phone: '$c.phone',
          item_name: { $ifNull: [{ $arrayElemAt: ['$i.name', 0] }, null] },
          item_name_ar: { $ifNull: [{ $arrayElemAt: ['$i.name_ar', 0] }, null] },
          item_sku: { $ifNull: [{ $arrayElemAt: ['$i.sku', 0] }, null] },
          created_by_name: { $ifNull: [{ $arrayElemAt: ['$u.name', 0] }, null] },
        },
      },
    ];
    if (lp.search) {
      const s = rx(lp.search);
      pipeline.push({
        $match: {
          $or: [
            { 'c.name': s }, { 'i.name': s }, { item_text: s }, { serial_numbers: s },
          ],
        },
      });
    }
    pipeline.push({ $unset: ['c', 'i', 'u'] });
    const result = await runAggList(Assignment, pipeline, lp.sort, lp);
    res.json(result);
  })
);

router.get(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    const { Assignment } = await import('../db');
    const rows = await Assignment.aggregate([
      { $match: { id: Number(req.params.id), deleted_at: null } },
      { $lookup: { from: 'customers', localField: 'customer_id', foreignField: 'id', as: 'c', pipeline: [{ $project: { name: 1, _id: 0 } }] } },
      { $unwind: '$c' },
      { $lookup: { from: 'items', localField: 'item_id', foreignField: 'id', as: 'i', pipeline: [{ $project: { name: 1, _id: 0 } }] } },
      {
        $set: {
          customer_name: '$c.name',
          item_name: { $ifNull: [{ $arrayElemAt: ['$i.name', 0] }, null] },
        },
      },
      { $unset: ['c', 'i', '_id'] },
    ]);
    if (!rows[0]) throw notFound('Assignment not found');
    res.json(rows[0]);
  })
);

/** Edit amount/notes/date of a taken assignment. */
router.patch(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('assignments.edit')) throw forbidden();
    const body = z.object({
      amount: z.number().nonnegative().optional(),
      notes: z.string().optional().nullable(),
      assigned_at: z.string().optional(),
    }).parse(req.body);
    const old: any = await Assignment.findOne({ id: Number(req.params.id), deleted_at: null }).lean();
    if (!old) throw notFound('Assignment not found');
    if (old.status === 'voided') throw badRequest('Cannot edit a voided assignment');
    const update: any = { updated_at: new Date() };
    if (body.amount != null) {
      update.amount = body.amount;
      if (old.quantity > 0) update.unit_price = body.amount / old.quantity;
    }
    if (body.notes !== undefined) update.notes = body.notes;
    if (body.assigned_at) update.assigned_at = body.assigned_at;
    await Assignment.updateOne({ id: old.id }, update);
    const fresh: any = strip(await Assignment.findOne({ id: old.id }).lean());
    await audit(req, { action: 'update', entity: 'assignment', entity_id: req.params.id, old_value: strip(old), new_value: fresh });
    res.json(fresh);
  })
);

/** Mark returned: restores stock and credits the customer's balance. */
router.post(
  '/:id/return',
  asyncH(async (req: Request, res: Response) => {
    const perms = req.user!.permissions;
    if (!perms.includes('assignments.edit') && !perms.includes('assignments.approve')) throw forbidden();
    const body = z.object({
      credited_amount: z.number().nonnegative().optional(), // portion refunded to the customer's balance (default: full amount)
      notes: z.string().optional().nullable(),
    }).parse(req.body || {});
    const result = await withTransaction(async (session) => {
      const a: any = await Assignment.findOne({ id: Number(req.params.id), deleted_at: null }).session(session);
      if (!a) throw notFound('Assignment not found');
      if (a.status !== 'taken') throw badRequest('Only taken assignments can be returned');
      const credit = body.credited_amount ?? a.amount;
      if (credit > a.amount) throw badRequest('Credited amount cannot exceed the original amount');
      if (a.item_id) {
        await Item.updateOne({ id: a.item_id }, { $inc: { quantity: a.quantity }, $set: { updated_at: new Date() } }, { session });
        await createWithId(
          StockMovement,
          {
            item_id: a.item_id, movement_type: 'return', quantity: a.quantity,
            reason: body.notes || `Return of assignment ${String(a.id).slice(0, 8)}`,
            performed_by: req.user!.id, reference_type: 'assignment_return', reference_id: a.id,
          },
          session
        );
        await ItemUnit.updateMany({ assignment_id: a.id }, { $set: { status: 'in_stock', assignment_id: null } }, { session });
      }
      await Assignment.updateOne(
        { id: a.id },
        {
          status: 'returned', returned_at: new Date(), credited_amount: credit,
          notes: body.notes || a.notes, updated_at: new Date(),
        },
        { session }
      );
      const old = a.toObject ? strip(a.toObject()) : { ...a };
      const updated = await Assignment.findOne({ id: a.id }).session(session).lean();
      return { old, updated: strip(updated) };
    });
    await audit(req, { action: 'return', entity: 'assignment', entity_id: req.params.id, old_value: result.old, new_value: result.updated });
    res.json(result.updated);
  })
);

/** Void an assignment (reason mandatory): full credit + stock restore. */
router.post(
  '/:id/void',
  asyncH(async (req: Request, res: Response) => {
    const perms = req.user!.permissions;
    if (!perms.includes('assignments.approve') && !perms.includes('assignments.delete')) throw forbidden();
    const body = z.object({ reason: z.string().min(3) }).parse(req.body);
    const result = await withTransaction(async (session) => {
      const a: any = await Assignment.findOne({ id: Number(req.params.id), deleted_at: null }).session(session);
      if (!a) throw notFound('Assignment not found');
      if (a.status === 'voided') throw badRequest('Assignment is already voided');
      if (a.item_id && a.status === 'taken') {
        await Item.updateOne({ id: a.item_id }, { $inc: { quantity: a.quantity }, $set: { updated_at: new Date() } }, { session });
        await createWithId(
          StockMovement,
          {
            item_id: a.item_id, movement_type: 'return', quantity: a.quantity,
            reason: `Void: ${body.reason}`, performed_by: req.user!.id, reference_type: 'assignment_void', reference_id: a.id,
          },
          session
        );
        await ItemUnit.updateMany({ assignment_id: a.id }, { $set: { status: 'in_stock', assignment_id: null } }, { session });
      }
      await Assignment.updateOne(
        { id: a.id },
        { status: 'voided', void_reason: body.reason, credited_amount: a.amount, updated_at: new Date() },
        { session }
      );
      const old = a.toObject ? strip(a.toObject()) : { ...a };
      const updated = await Assignment.findOne({ id: a.id }).session(session).lean();
      return { old, updated: strip(updated) };
    });
    await audit(req, { action: 'void', entity: 'assignment', entity_id: req.params.id, old_value: result.old, new_value: { ...result.updated, reason: body.reason } });
    res.json(result.updated);
  })
);

export default router;
