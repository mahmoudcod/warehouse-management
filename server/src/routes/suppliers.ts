import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Supplier, SupplierPayment, PurchaseOrder, Item, StockMovement, ItemUnit, Account, TransactionCategory, Transaction, withTransaction, createWithId, isoDate } from '../db';
import { asyncH, badRequest, forbidden, notFound } from '../errors';
import { audit } from '../audit';
import { parseList, runList } from '../paging';

const router = Router();

function can(req: Request, perm: string): boolean {
  return req.user!.role === 'super_admin' || req.user!.permissions.includes(perm);
}

/** Payable = total of received/partial POs − supplier payments made. */
async function supplierBalance(supplierId: number): Promise<number> {
  const pos = await PurchaseOrder.find({ supplier_id: supplierId, status: { $in: ['received', 'partial'] } }).lean();
  const pays = await SupplierPayment.find({ supplier_id: supplierId }).lean();
  const billed = pos.reduce((s, p) => s + Number(p.total || 0), 0);
  const paid = pays.reduce((s, p) => s + Number(p.amount || 0), 0);
  return Math.round((billed - paid) * 100) / 100;
}

// ======================= Suppliers CRUD =======================
router.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!can(req, 'suppliers.view')) throw forbidden();
    const lp = parseList(req, { name: 'name', created_at: 'created_at', balance: 'balance' }, 'created_at');
    const params: any[] = [];
    let cond: any = { deleted_at: null };
    if (lp.search) {
      cond.$or = [{ name: new RegExp(lp.search, 'i') }, { phone: new RegExp(lp.search, 'i') }, { contact_person: new RegExp(lp.search, 'i') }];
    }
    if (req.query.status === 'active') cond.is_active = true;
    if (req.query.status === 'inactive') cond.is_active = false;
    const suppliers = await Supplier.find(cond).sort({ created_at: -1 }).lean();
    const withBalances = await Promise.all(
      suppliers.map(async (s: any) => ({
        ...s,
        balance: await supplierBalance(s.id as number),
        pos_count: await PurchaseOrder.countDocuments({ supplier_id: s.id }),
      }))
    );
    // sort + paginate in memory (balances are computed)
    withBalances.sort((a: any, b: any) => {
      const dir = lp.order === 'asc' ? 1 : -1;
      if (lp.sort === 'name') return a.name.localeCompare(b.name) * dir;
      if (lp.sort === 'balance') return (a.balance - b.balance) * dir;
      return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
    });
    const total = withBalances.length;
    const rows = withBalances.slice(lp.offset, lp.offset + lp.pageSize).map((s: any) => ({ ...s, total: undefined }));
    res.json({ rows, total, page: lp.page, pageSize: lp.pageSize });
  })
);

router.get(
  '/orders',
  asyncH(async (req: Request, res: Response) => {
    if (!can(req, 'suppliers.view')) throw forbidden();
    const cond: any = {};
    if (req.query.supplier_id) cond.supplier_id = Number(req.query.supplier_id);
    if (req.query.status) cond.status = req.query.status;
    const orders = await PurchaseOrder.find(cond).sort({ created_at: -1 }).limit(200).lean();
    const suppliers = await Supplier.find({ deleted_at: null }).lean();
    const byId = new Map(suppliers.map((s: any) => [s.id, s]));
    res.json({
      rows: orders.map((o: any) => ({ ...o, supplier_name: byId.get(o.supplier_id)?.name || '—' })),
      total: orders.length,
    });
  })
);

router.get(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!can(req, 'suppliers.view')) throw forbidden();
    const supplier = await Supplier.findOne({ id: Number(req.params.id), deleted_at: null }).lean();
    if (!supplier) throw notFound('Supplier not found');
    const orders = await PurchaseOrder.find({ supplier_id: supplier.id }).sort({ created_at: -1 }).lean();
    const payments = await SupplierPayment.find({ supplier_id: supplier.id }).sort({ paid_at: -1 }).lean();
    res.json({ ...supplier, balance: await supplierBalance(supplier.id as number), orders, payments });
  })
);

const supplierBody = z.object({
  name: z.string().min(2),
  phone: z.string().optional().nullable(),
  contact_person: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!can(req, 'suppliers.create')) throw forbidden();
    const body = supplierBody.parse(req.body);
    const created = await createWithId(Supplier, { ...body, created_by: req.user!.id });
    await audit(req, { action: 'create', entity: 'supplier', entity_id: String(created.id), new_value: created.toJSON() });
    res.status(201).json(created.toJSON());
  })
);

router.patch(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!can(req, 'suppliers.edit')) throw forbidden();
    const body = supplierBody.partial().parse(req.body);
    const old = await Supplier.findOne({ id: Number(req.params.id), deleted_at: null }).lean();
    if (!old) throw notFound('Supplier not found');
    const updated = await Supplier.findOneAndUpdate(
      { id: old.id },
      { ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)), updated_at: new Date() },
      { new: true }
    ).lean();
    await audit(req, { action: 'update', entity: 'supplier', entity_id: String(old.id), old_value: old, new_value: updated });
    res.json(updated);
  })
);

router.delete(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!can(req, 'suppliers.delete')) throw forbidden();
    const open = await PurchaseOrder.countDocuments({ supplier_id: Number(req.params.id), status: { $in: ['draft', 'partial'] } });
    if (open > 0) throw badRequest('Supplier has open purchase orders — settle or cancel them first');
    const balance = await supplierBalance(Number(req.params.id));
    if (Math.abs(balance) > 0.005) throw badRequest(`Supplier balance is ${balance} — record its payment or clear POs first`);
    const old = await Supplier.findOneAndUpdate({ id: Number(req.params.id), deleted_at: null }, { deleted_at: new Date(), is_active: false }, { new: true }).lean();
    if (!old) throw notFound('Supplier not found');
    await audit(req, { action: 'delete', entity: 'supplier', entity_id: String(old.id), old_value: old });
    res.json({ ok: true });
  })
);

// ======================= Purchase orders =======================
const poBody = z.object({
  items: z.array(z.object({
    item_id: z.number().optional().nullable(),
    item_text: z.string().optional().nullable(),
    quantity: z.number().positive(),
    unit_cost: z.number().nonnegative(),
  })).min(1),
  expected_at: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post(
  '/:id/orders',
  asyncH(async (req: Request, res: Response) => {
    if (!can(req, 'suppliers.create')) throw forbidden();
    const body = poBody.parse(req.body);
    const supplier = await Supplier.findOne({ id: Number(req.params.id), deleted_at: null }).lean();
    if (!supplier) throw notFound('Supplier not found');
    const total = Math.round(body.items.reduce((s, i) => s + i.quantity * i.unit_cost, 0) * 100) / 100;
    const created = await createWithId(PurchaseOrder, {
      supplier_id: supplier.id as number,
      status: 'draft',
      items: body.items.map((i) => ({ ...i, item_id: i.item_id || null, item_text: i.item_text || null, received_qty: 0 })),
      total,
      expected_at: body.expected_at || null,
      notes: body.notes || null,
      created_by: req.user!.id,
    });
    await audit(req, { action: 'create', entity: 'purchase_order', entity_id: String(created.id), new_value: created.toJSON() });
    res.status(201).json(created.toJSON());
  })
);

/** Receive PO lines: adds stock, writes movements, optionally registers serials. */
router.post(
  '/orders/:id/receive',
  asyncH(async (req: Request, res: Response) => {
    if (!can(req, 'suppliers.approve') && !can(req, 'suppliers.edit')) throw forbidden();
    const body = z.object({
      lines: z.array(z.object({
        index: z.number().int().nonnegative(),
        received_qty: z.number().nonnegative(),
        serials: z.array(z.string()).optional().default([]),
      })).default([]),
      notes: z.string().optional().nullable(),
    }).parse(req.body);
    const result = await withTransaction(async (session) => {
      const po = await PurchaseOrder.findOne({ id: Number(req.params.id) }).session(session as any).lean();
      if (!po) throw notFound('Purchase order not found');
      if (po.status === 'cancelled') throw badRequest('Purchase order is cancelled');
      if (po.status === 'received') throw badRequest('Purchase order is already fully received');

      const lines = [...po.items];
      for (const line of body.lines) {
        const li = lines[line.index];
        if (!li) throw badRequest(`Invalid line index ${line.index}`);
        const remaining = Number(li.quantity) - Number(li.received_qty);
        if (line.received_qty > remaining) {
          throw badRequest(`Line ${line.index + 1}: cannot receive more than the remaining ${remaining}`);
        }
        li.received_qty = Number(li.received_qty) + line.received_qty;
        if (li.item_id) {
          const item = await Item.findOne({ id: li.item_id, deleted_at: null }).session(session as any);
          if (item) {
            await Item.updateOne({ id: item.id }, { $inc: { quantity: line.received_qty }, $set: { updated_at: new Date() } }).session(session as any);
            await createWithId(
              StockMovement,
              {
                item_id: item.id,
                movement_type: 'purchase',
                quantity: line.received_qty,
                to_warehouse_id: item.warehouse_id,
                unit_serial: null,
                reference_type: 'purchase_order',
                reference_id: po.id,
                reason: `PO from supplier (received ${line.received_qty})`,
                performed_by: req.user!.id,
              },
              session
            );
            for (const serial of body.lines.find((l) => l.index === line.index)?.serials || []) {
              await createWithId(ItemUnit, { item_id: item.id, serial: serial.trim(), warehouse_id: item.warehouse_id }, session);
            }
          }
        }
      }
      const fullyReceived = lines.every((l) => Number(l.received_qty) >= Number(l.quantity));
      const updated = await PurchaseOrder.findOneAndUpdate(
        { id: po.id },
        { items: lines, status: fullyReceived ? 'received' : 'partial', received_at: fullyReceived ? new Date() : po.received_at, updated_at: new Date() },
        { new: true }
      ).session(session as any).lean();
      return { po, updated };
    });
    await audit(req, { action: 'receive_po', entity: 'purchase_order', entity_id: String(result.po!.id), new_value: result.updated });
    res.json(result.updated);
  })
);

router.post(
  '/orders/:id/cancel',
  asyncH(async (req: Request, res: Response) => {
    if (!can(req, 'suppliers.approve') && !can(req, 'suppliers.delete')) throw forbidden();
    const body = z.object({ reason: z.string().min(3) }).parse(req.body);
    const po = await PurchaseOrder.findOne({ id: Number(req.params.id) }).lean();
    if (!po) throw notFound('Purchase order not found');
    if (po.status === 'received') throw badRequest('Cannot cancel a fully received order');
    if (po.status === 'cancelled') throw badRequest('Already cancelled');
    const updated = await PurchaseOrder.findOneAndUpdate({ id: po.id }, { status: 'cancelled', cancel_reason: body.reason, updated_at: new Date() }, { new: true }).lean();
    await audit(req, { action: 'cancel', entity: 'purchase_order', entity_id: String(po.id), old_value: po, new_value: { ...updated, reason: body.reason } });
    res.json(updated);
  })
);

// ======================= Supplier payments =======================
router.post(
  '/:id/payments',
  asyncH(async (req: Request, res: Response) => {
    if (!can(req, 'suppliers.create') && !can(req, 'suppliers.approve')) throw forbidden();
    const body = z.object({
      amount: z.number().positive(),
      method: z.enum(['cash', 'transfer', 'other']).default('cash'),
      paid_at: z.string(),
      reference: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
      account_id: z.number().optional().nullable(),
    }).parse(req.body);
    const supplier = await Supplier.findOne({ id: Number(req.params.id), deleted_at: null }).lean();
    if (!supplier) throw notFound('Supplier not found');
    const created = await withTransaction(async (session) => {
      const payment = await createWithId(
        SupplierPayment,
        {
          supplier_id: supplier!.id as number, amount: body.amount, method: body.method, paid_at: body.paid_at,
          reference: body.reference || null, notes: body.notes || null, created_by: req.user!.id,
        },
        session
      );
      // auto expense entry in Accounting
      const cat = await TransactionCategory.findOne({ is_default: true, name: 'supplier_payment' }).session(session as any);
      let accountId = body.account_id || null;
      if (!accountId) {
        const acc = await Account.findOne({ is_active: true, deleted_at: null, type: body.method === 'cash' ? 'cash' : 'bank' }).sort({ created_at: 1 }).session(session as any);
        accountId = acc?.id || null;
      }
      const tx = await createWithId(
        Transaction,
        {
          type: 'expense', amount: body.amount, category_id: cat?.id || null, occurred_at: body.paid_at,
          method: body.method, account_id: accountId, reference: body.reference || null, supplier_id: supplier!.id as number,
          notes: body.notes ? `Supplier payment: ${body.notes}` : `Supplier payment — ${supplier!.name}`, created_by: req.user!.id,
        },
        session
      );
      await SupplierPayment.updateOne({ id: payment.id }, { transaction_id: tx.id }).session(session as any);
      if (accountId) {
        await Account.updateOne({ id: accountId }, { $inc: { balance: -body.amount } }).session(session as any);
      }
      return { payment: payment.toJSON(), transaction_id: tx.id, balance: await supplierBalance(supplier!.id as number) };
    });
    await audit(req, { action: 'create', entity: 'supplier_payment', entity_id: String(created.payment.id), new_value: created.payment });
    res.status(201).json(created);
  })
);

export default router;
