import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { query, withTransaction, isoDate } from '../db';
import { asyncH, badRequest, forbidden, notFound } from '../errors';
import { audit } from '../audit';
import { parseList, runList } from '../paging';
import { requireSuperAdmin } from '../middleware/auth';

const router = Router();

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

async function assertPeriodOpen(client: any, dateStr: any, user: any) {
  const month = isoDate(dateStr).slice(0, 7);
  const r = await client.query(`select 1 from closed_periods where to_char(period,'YYYY-MM') = $1`, [month]);
  if (r.rows[0] && user.role !== 'super_admin') {
    throw forbidden(`Month ${month} is closed — a Super Admin must approve changes to locked periods`);
  }
}

// ======================= Transactions =======================
router.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    const lp = parseList(req, { occurred_at: 't.occurred_at', amount: 't.amount', type: 't.type', category: 'tc.name' }, 'occurred_at');
    const params: any[] = [];
    let where = `t.deleted_at is null`;
    if (req.user!.permissions.includes('data.own_only')) {
      params.push(req.user!.id);
      where += ` and t.created_by = $${params.length}`;
    }
    if (lp.search) {
      params.push(`%${lp.search}%`);
      where += ` and (coalesce(t.reference,'') ilike $${params.length} or coalesce(t.notes,'') ilike $${params.length} or coalesce(c.name,'') ilike $${params.length} or coalesce(tc.name,'') ilike $${params.length} or coalesce(tc.name_ar,'') ilike $${params.length})`;
    }
    if (req.query.type) { params.push(req.query.type); where += ` and t.type = $${params.length}`; }
    if (req.query.category_id) { params.push(req.query.category_id); where += ` and t.category_id = $${params.length}`; }
    if (req.query.account_id) { params.push(req.query.account_id); where += ` and t.account_id = $${params.length}`; }
    if (req.query.method) { params.push(req.query.method); where += ` and t.method = $${params.length}`; }
    if (req.query.exclude_transfers === 'true') where += ` and t.transfer_id is null`;
    if (lp.from) { params.push(lp.from); where += ` and t.occurred_at >= $${params.length}`; }
    if (lp.to) { params.push(lp.to); where += ` and t.occurred_at <= $${params.length}`; }
    const result = await runList(
      `select t.*, tc.name as category_name, tc.name_ar as category_name_ar,
              a.name as account_name, a.name_ar as account_name_ar, c.name as customer_name, u.name as created_by_name
       from transactions t
       left join transaction_categories tc on tc.id = t.category_id
       left join accounts a on a.id = t.account_id
       left join customers c on c.id = t.customer_id
       left join users u on u.id = t.created_by
       where ${where}`,
      `select count(*) from transactions t
       left join transaction_categories tc on tc.id = t.category_id
       left join accounts a on a.id = t.account_id
       left join customers c on c.id = t.customer_id
       where ${where}`,
      params,
      lp
    );
    result.rows = result.rows.map((r: any) => ({ ...r, amount: Number(r.amount) }));
    res.json(result);
  })
);

const txBody = z.object({
  type: z.enum(['income', 'expense']),
  amount: z.number().positive(),
  category_id: z.string().uuid().optional().nullable(),
  occurred_at: z.string(),
  method: z.enum(['cash', 'transfer', 'other']).default('cash'),
  account_id: z.string().uuid().optional().nullable(),
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
    const created = await withTransaction(async (client) => {
      await assertPeriodOpen(client, body.occurred_at, req.user);
      const r = await client.query(
        `insert into transactions (type, amount, category_id, occurred_at, method, account_id, reference, notes, attachment_path, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [body.type, body.amount, body.category_id || null, body.occurred_at, body.method,
         body.account_id || null, body.reference || null, body.notes || null, attachment, req.user!.id]
      );
      if (body.account_id) {
        const sign = body.type === 'income' ? 1 : -1;
        await client.query(`update accounts set balance = balance + $2 where id=$1`, [body.account_id, sign * body.amount]);
      }
      return r.rows[0];
    });
    await audit(req, { action: 'create', entity: 'transaction', entity_id: created.id, new_value: created });
    res.status(201).json(created);
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
    const result = await withTransaction(async (client) => {
      const r = await client.query(`select * from transactions where id=$1 and deleted_at is null for update`, [req.params.id]);
      const t = r.rows[0];
      if (!t) throw notFound('Transaction not found');
      if (t.status === 'voided') throw badRequest('Cannot edit a voided transaction');
      if (t.payment_id) throw badRequest('This entry is linked to a customer payment — edit it from the Payments module');
      await assertPeriodOpen(client, t.occurred_at, req.user);
      if (body.occurred_at) await assertPeriodOpen(client, body.occurred_at, req.user);

      const newAmount = body.amount ?? Number(t.amount);
      const newType = body.type || t.type;
      const newAccount = body.account_id !== undefined ? body.account_id : t.account_id;

      // Reverse the old effect, apply the new one
      if (t.account_id) {
        const oldSign = t.type === 'income' ? 1 : -1;
        await client.query(`update accounts set balance = balance - $2 where id=$1`, [t.account_id, oldSign * Number(t.amount)]);
      }
      if (newAccount) {
        const newSign = newType === 'income' ? 1 : -1;
        await client.query(`update accounts set balance = balance + $2 where id=$1`, [newAccount, newSign * newAmount]);
      }
      const r2 = await client.query(
        `update transactions set type=$2, amount=$3, category_id=$4, occurred_at=$5, method=$6, account_id=$7,
          reference=$8, notes=$9, attachment_path=coalesce($10, attachment_path), updated_at=now()
         where id=$1 returning *`,
        [t.id, newType, newAmount, body.category_id ?? t.category_id, body.occurred_at || t.occurred_at,
         body.method || t.method, newAccount, body.reference ?? t.reference, body.notes ?? t.notes, attachment ?? null]
      );
      return { old: t, updated: r2.rows[0] };
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
    const result = await withTransaction(async (client) => {
      const r = await client.query(`select * from transactions where id=$1 and deleted_at is null for update`, [req.params.id]);
      const t = r.rows[0];
      if (!t) throw notFound('Transaction not found');
      if (t.status === 'voided') throw badRequest('Already voided');
      if (t.payment_id) throw badRequest('Void the linked customer payment instead');
      await assertPeriodOpen(client, t.occurred_at, req.user);
      if (t.transfer_id) {
        // Void both transactions of the transfer to prevent balance discrepancy
        const pair = await client.query(`select * from transactions where transfer_id=$1 and deleted_at is null for update`, [t.transfer_id]);
        for (const tx of pair.rows) {
          if (tx.status !== 'voided' && tx.account_id) {
            const sign = tx.type === 'income' ? 1 : -1;
            await client.query(`update accounts set balance = balance - $2 where id=$1`, [tx.account_id, sign * Number(tx.amount)]);
          }
        }
        await client.query(
          `update transactions set status='voided', void_reason=$2, updated_at=now() where transfer_id=$1`,
          [t.transfer_id, body.reason]
        );
        const r2 = await client.query(`select * from transactions where id=$1`, [t.id]);
        return { old: t, updated: r2.rows[0] };
      } else {
        if (t.account_id) {
          const sign = t.type === 'income' ? 1 : -1;
          await client.query(`update accounts set balance = balance - $2 where id=$1`, [t.account_id, sign * Number(t.amount)]);
        }
        const r2 = await client.query(
          `update transactions set status='voided', void_reason=$2, updated_at=now() where id=$1 returning *`,
          [t.id, body.reason]
        );
        return { old: t, updated: r2.rows[0] };
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
    const r = await query(`select * from transaction_categories where deleted_at is null order by kind, name`);
    res.json(r.rows);
  })
);

router.post(
  '/categories',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('accounting.create')) throw forbidden();
    const body = z.object({ name: z.string().min(2), name_ar: z.string().optional().nullable(), kind: z.enum(['income', 'expense', 'both']) }).parse(req.body);
    const r = await query(`insert into transaction_categories (name, name_ar, kind) values ($1,$2,$3) returning *`,
      [body.name, body.name_ar || null, body.kind]);
    await audit(req, { action: 'create', entity: 'transaction_category', entity_id: r.rows[0].id, new_value: r.rows[0] });
    res.status(201).json(r.rows[0]);
  })
);

router.delete(
  '/categories/:id',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('accounting.delete')) throw forbidden();
    const used = (await query(`select count(*) c from transactions where category_id=$1 and deleted_at is null`, [req.params.id])).rows[0].c;
    if (Number(used) > 0) throw badRequest('Category is used by existing transactions');
    await query(`update transaction_categories set deleted_at=now() where id=$1 and is_default = false`, [req.params.id]);
    await audit(req, { action: 'delete', entity: 'transaction_category', entity_id: req.params.id });
    res.json({ ok: true });
  })
);

// ======================= Accounts & transfers =======================
router.get(
  '/accounts',
  asyncH(async (_req: Request, res: Response) => {
    const r = await query(
      `select a.*,
        (select coalesce(sum(case when t2.type='income' then t2.amount else -t2.amount end),0)
         from transactions t2 where t2.account_id = a.id and t2.status='active' and t2.deleted_at is null)::float8 as computed_balance
       from accounts a where a.deleted_at is null order by a.type, a.created_at`
    );
    res.json(r.rows.map((a: any) => ({ ...a, balance: Number(a.balance), computed_balance: Number(a.computed_balance) })));
  })
);

router.post(
  '/accounts',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('accounting.create') && req.user!.role !== 'super_admin') throw forbidden();
    const body = z.object({ name: z.string().min(2), name_ar: z.string().optional().nullable(), type: z.enum(['cash', 'bank']), opening_balance: z.number().optional() }).parse(req.body);
    const r = await query(`insert into accounts (name, name_ar, type, balance) values ($1,$2,$3,$4) returning *`,
      [body.name, body.name_ar || null, body.type, body.opening_balance ?? 0]);
    await audit(req, { action: 'create', entity: 'account', entity_id: r.rows[0].id, new_value: r.rows[0] });
    res.status(201).json(r.rows[0]);
  })
);

/** Transfer between accounts — creates a linked expense/income pair. */
router.post(
  '/transfers',
  asyncH(async (req: Request, res: Response) => {
    if (!req.user!.permissions.includes('accounting.create')) throw forbidden();
    const body = z.object({
      from_account_id: z.string().uuid(),
      to_account_id: z.string().uuid(),
      amount: z.number().positive(),
      occurred_at: z.string(),
      notes: z.string().optional().nullable(),
    }).parse(req.body);
    if (body.from_account_id === body.to_account_id) throw badRequest('Accounts must differ');
    const result = await withTransaction(async (client) => {
      await assertPeriodOpen(client, body.occurred_at, req.user);
      const from = (await client.query(`select * from accounts where id=$1 for update`, [body.from_account_id])).rows[0];
      const to = (await client.query(`select * from accounts where id=$1 for update`, [body.to_account_id])).rows[0];
      if (!from || !to) throw notFound('Account not found');
      if (Number(from.balance) < body.amount) throw badRequest(`Insufficient balance in "${from.name}" (${from.balance})`);
      const tr = (await client.query(
        `insert into transfers (from_account_id, to_account_id, amount, occurred_at, notes, created_by)
         values ($1,$2,$3,$4,$5,$6) returning *`,
        [body.from_account_id, body.to_account_id, body.amount, body.occurred_at, body.notes || null, req.user!.id]
      )).rows[0];
      const cat = (await client.query(`select id from transaction_categories where is_default and name='transfers'`)).rows[0];
      await client.query(
        `insert into transactions (type, amount, category_id, occurred_at, method, account_id, transfer_id, notes, created_by)
         values ('expense',$1,$2,$3,'transfer',$4,$5,$6,$7)`,
        [body.amount, cat?.id || null, body.occurred_at, body.from_account_id, tr.id, `Transfer out: ${body.notes || ''}`.trim(), req.user!.id]
      );
      await client.query(
        `insert into transactions (type, amount, category_id, occurred_at, method, account_id, transfer_id, notes, created_by)
         values ('income',$1,$2,$3,'transfer',$4,$5,$6,$7)`,
        [body.amount, cat?.id || null, body.occurred_at, body.to_account_id, tr.id, `Transfer in: ${body.notes || ''}`.trim(), req.user!.id]
      );
      await client.query(`update accounts set balance = balance - $2 where id=$1`, [body.from_account_id, body.amount]);
      await client.query(`update accounts set balance = balance + $2 where id=$1`, [body.to_account_id, body.amount]);
      return tr;
    });
    await audit(req, { action: 'transfer', entity: 'transfer', entity_id: result.id, new_value: result });
    res.status(201).json(result);
  })
);

// ======================= Daily close =======================
router.get(
  '/daily-close',
  asyncH(async (req: Request, res: Response) => {
    const date = req.query.date ? String(req.query.date) : new Date().toISOString().slice(0, 10);
    const cashAccounts = (await query(`select id from accounts where type='cash' and deleted_at is null and is_active`)).rows.map((r: any) => r.id);
    const inList = cashAccounts.length ? `and t.account_id = any($2)` : `and false`;
    const opening = (await query(
      `select coalesce(sum(case when t.type='income' then t.amount else -t.amount end),0)::float8 as v
       from transactions t where t.status='active' and t.deleted_at is null and t.occurred_at < $1 ${inList}`,
      cashAccounts.length ? [date, cashAccounts] : [date]
    )).rows[0].v;
    const day = (await query(
      `select
         coalesce(sum(case when t.type='income' then t.amount else 0 end),0)::float8 as total_in,
         coalesce(sum(case when t.type='expense' then t.amount else 0 end),0)::float8 as total_out
       from transactions t where t.status='active' and t.deleted_at is null and t.occurred_at = $1 ${inList}`,
      cashAccounts.length ? [date, cashAccounts] : [date]
    )).rows[0];
    const saved = (await query(`select * from daily_closes where date=$1`, [date])).rows[0];
    res.json({
      date,
      opening_balance: Number(opening),
      total_in: Number(day.total_in),
      total_out: Number(day.total_out),
      net: Number(day.total_in) - Number(day.total_out),
      closing_balance: Number(opening) + Number(day.total_in) - Number(day.total_out),
      saved: saved || null,
    });
  })
);

router.post(
  '/daily-close',
  asyncH(async (req: Request, res: Response) => {
    const body = z.object({ date: z.string(), counted_amount: z.number().nonnegative(), system_closing: z.number(), note: z.string().optional().nullable() }).parse(req.body);
    const diff = Math.round((body.counted_amount - body.system_closing) * 100) / 100;
    await query(
      `insert into daily_closes (date, counted_amount, system_closing, difference, note, closed_by)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (date) do update set counted_amount=$2, system_closing=$3, difference=$4, note=$5, closed_by=$6`,
      [body.date, body.counted_amount, body.system_closing, diff, body.note || null, req.user!.id]
    );
    await audit(req, { action: 'daily_close', entity: 'daily_close', entity_id: body.date, new_value: { ...body, difference: diff } });
    res.json({ ok: true, difference: diff });
  })
);

// ======================= Closed (locked) periods =======================
router.get(
  '/periods',
  asyncH(async (_req: Request, res: Response) => {
    const r = await query(
      `select p.*, u.name as closed_by_name from closed_periods p left join users u on u.id = p.closed_by order by p.period desc`
    );
    res.json(r.rows);
  })
);

router.post(
  '/periods',
  requireSuperAdmin,
  asyncH(async (req: Request, res: Response) => {
    const body = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.body);
    const period = `${body.month}-01`;
    await query(
      `insert into closed_periods (period, closed_by) values ($1,$2) on conflict (period) do nothing`,
      [period, req.user!.id]
    );
    await audit(req, { action: 'close_period', entity: 'period', entity_id: period, new_value: { month: body.month } });
    res.status(201).json({ ok: true });
  })
);

router.delete(
  '/periods/:month',
  requireSuperAdmin,
  asyncH(async (req: Request, res: Response) => {
    const period = `${req.params.month}-01`;
    await query(`delete from closed_periods where period=$1`, [period]);
    await audit(req, { action: 'reopen_period', entity: 'period', entity_id: period });
    res.json({ ok: true });
  })
);

export default router;
