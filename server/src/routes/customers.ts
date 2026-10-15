import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Customer, Assignment, Payment, balanceMap, overdueCustomerSet, createWithId, r2, rx, strip, todayStr } from '../db';
import { asyncH, forbidden, notFound } from '../errors';
import { audit } from '../audit';
import { parseList } from '../paging';

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

function ownOnly(req: Request) {
  // "View only own records" granular permission
  return req.user!.permissions.includes('data.own_only') ? req.user!.id : null;
}

async function financialContext(ids: number[]) {
  const [balances, overdue] = await Promise.all([balanceMap(ids), overdueCustomerSet()]);
  return { balances, overdue };
}

function customerRow(c: any, canFinancials: boolean, ctx?: { balances: Map<number, any>; overdue: Set<number> }) {
  const o: any = {
    id: c.id, name: c.name, phone: c.phone, national_id: c.national_id, address: c.address,
    notes: c.notes, photo_url: c.photo_url, is_active: c.is_active, created_at: c.created_at,
  };
  if (canFinancials) {
    const b = ctx!.balances.get(c.id) ?? { total_taken: 0, total_returned: 0, total_paid: 0, balance: 0 };
    o.total_taken = b.total_taken;
    o.total_returned = b.total_returned;
    o.total_paid = b.total_paid;
    o.balance = b.balance;
    o.owes = b.balance > 0.005;
    o.overdue = ctx!.overdue.has(c.id);
  }
  return o;
}

/** Customers list with server-computed balances. */
router.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('customers.view')) throw forbidden();
    const canFinancials = req.user!.permissions.includes('customers.view_financials');
    const sortable: Record<string, string> = canFinancials
      ? { name: 'name', created_at: 'created_at', balance: 'balance', total_taken: 'total_taken' }
      : { name: 'name', created_at: 'created_at' };
    const lp = parseList(req, sortable, 'created_at');

    const filter: any = { deleted_at: null };
    const own = ownOnly(req);
    if (own) filter.created_by = own;
    if (lp.search) {
      const s = rx(lp.search);
      filter.$or = [{ name: s }, { phone: s }, { national_id: s }];
    }
    if (req.query.status === 'active') filter.is_active = true;
    if (req.query.status === 'inactive') filter.is_active = false;

    const docs = (await Customer.find(filter).lean()).map(strip);
    const ctx = canFinancials ? await financialContext(docs.map((d: any) => d.id)) : undefined;

    let rows = docs.map((c: any) => customerRow(c, canFinancials, ctx));
    if (canFinancials && req.query.status === 'owes') rows = rows.filter((r: any) => r.balance > 0.005);
    if (canFinancials && req.query.status === 'clear') rows = rows.filter((r: any) => r.balance <= 0.005);
    if (canFinancials && req.query.status === 'overdue') rows = rows.filter((r: any) => r.overdue);

    const dir = lp.order === 'asc' ? 1 : -1;
    rows.sort((a: any, b: any) => {
      const av = a[lp.sort] ?? '';
      const bv = b[lp.sort] ?? '';
      if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * dir;
      return (av - bv) * dir;
    });
    const total = rows.length;
    rows = rows.slice(lp.offset, lp.offset + lp.pageSize);
    res.json({ rows, total, page: lp.page, pageSize: lp.pageSize });
  })
);

router.get(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('customers.view')) throw forbidden();
    const c: any = await Customer.findOne({ id: Number(req.params.id), deleted_at: null }).lean();
    if (!c) throw notFound('Customer not found');
    const canFinancials = req.user!.permissions.includes('customers.view_financials');
    const customer: any = strip(c);
    if (canFinancials) {
      const ctx = await financialContext([customer.id]);
      Object.assign(customer, customerRow(customer, true, ctx));
    }
    res.json(customer);
  })
);

router.post(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('customers.create')) throw forbidden();
    const body = customerBody.parse(req.body);
    const c: any = await createWithId(Customer, {
      name: body.name,
      phone: body.phone || null,
      national_id: body.national_id || null,
      address: body.address || null,
      notes: body.notes || null,
      photo_url: body.photo_url || null,
      created_by: req.user!.id,
    });
    await audit(req, { action: 'create', entity: 'customer', entity_id: c.id, new_value: strip(c.toObject()) });
    res.status(201).json(strip(c.toObject()));
  })
);

router.patch(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('customers.edit')) throw forbidden();
    const body = customerBody.partial().parse(req.body);
    const old: any = await Customer.findOne({ id: Number(req.params.id), deleted_at: null }).lean();
    if (!old) throw notFound('Customer not found');
    const update: any = { updated_at: new Date() };
    if (body.name != null) update.name = body.name;
    if (body.phone !== undefined) update.phone = body.phone;
    if (body.national_id !== undefined) update.national_id = body.national_id;
    if (body.address !== undefined) update.address = body.address;
    if (body.notes !== undefined) update.notes = body.notes;
    if (body.photo_url != null) update.photo_url = body.photo_url;
    if (body.is_active != null) update.is_active = body.is_active;
    await Customer.updateOne({ id: old.id }, update);
    const fresh: any = strip(await Customer.findOne({ id: old.id }).lean());
    await audit(req, { action: 'update', entity: 'customer', entity_id: req.params.id, old_value: strip(old), new_value: fresh });
    res.json(fresh);
  })
);

/** Soft delete — financial history is never destroyed. */
router.delete(
  '/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('customers.delete')) throw forbidden();
    const old: any = await Customer.findOne({ id: Number(req.params.id), deleted_at: null }).lean();
    if (!old) throw notFound('Customer not found');
    await Customer.updateOne({ id: old.id }, { deleted_at: new Date(), is_active: false });
    await audit(req, { action: 'delete', entity: 'customer', entity_id: req.params.id, old_value: strip(old) });
    res.json({ ok: true });
  })
);

/** Chronological ledger: debits (devices taken) and credits (payments) with running balance. */
router.get(
  '/:id/statement',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('customers.view_financials')) throw forbidden();
    const cid = Number(req.params.id);
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;

    const [assignments, payments] = await Promise.all([
      Assignment.find({ customer_id: cid, status: { $ne: 'voided' }, deleted_at: null }).lean(),
      Payment.find({ customer_id: cid, status: 'active', deleted_at: null }).lean(),
    ]);
    const itemIds = [...new Set(assignments.map((a: any) => a.item_id).filter((x: any) => x != null))];
    const itemsById = new Map<number, any>();
    if (itemIds.length) {
      const { Item } = await import('../db');
      const items = await Item.find({ id: { $in: itemIds } }).lean();
      items.forEach((i: any) => itemsById.set(i.id, i));
    }

    type Entry = {
      date: string; kind: 'debit' | 'credit'; source: string; id: number;
      item_text: string | null; label: any; amount: number; status: string;
      notes: string | null; running_balance?: number;
    };
    let entries: Entry[] = [];
    for (const a of assignments as any[]) {
      const it = a.item_id ? itemsById.get(a.item_id) : null;
      const label = a.item_text ?? it?.name ?? it?.name_ar ?? null;
      entries.push({
        date: a.assigned_at, kind: 'debit', source: 'assignment', id: a.id, item_text: a.item_text,
        label, amount: r2(a.amount - a.credited_amount), status: a.status, notes: a.notes,
      });
    }
    for (const p of payments as any[]) {
      entries.push({
        date: p.paid_at, kind: 'credit', source: 'payment', id: p.id, item_text: null,
        label: p.receipt_number, amount: r2(p.amount), status: p.status, notes: p.notes,
      });
    }
    if (from) entries = entries.filter((e) => e.date >= from);
    if (to) entries = entries.filter((e) => e.date <= to);
    entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind < b.kind ? 1 : -1));

    const opening = from
      ? r2(
          assignments.filter((a: any) => a.assigned_at < from).reduce((s: number, a: any) => s + (a.amount - a.credited_amount), 0) -
          payments.filter((p: any) => p.paid_at < from).reduce((s: number, p: any) => s + p.amount, 0)
        )
      : 0;

    let running = Number(opening);
    for (const e of entries) {
      running += e.kind === 'debit' ? e.amount : -e.amount;
      e.running_balance = r2(running);
    }
    const totals = entries.reduce(
      (acc: any, e: Entry) => {
        if (e.kind === 'debit') acc.debits += e.amount;
        else acc.credits += e.amount;
        return acc;
      },
      { debits: 0, credits: 0 }
    );
    totals.debits = r2(totals.debits);
    totals.credits = r2(totals.credits);

    const cust: any = await Customer.findOne({ id: cid }).lean();
    res.json({
      customer: cust ? { id: cust.id, name: cust.name, phone: cust.phone, address: cust.address } : null,
      opening_balance: Number(opening),
      entries,
      totals,
      closing_balance: r2(Number(opening) + totals.debits - totals.credits),
      as_of: todayStr(),
    });
  })
);

export default router;
