import { Router, Request, Response } from 'express';
import { query } from '../db';
import { asyncH } from '../errors';
import { parseList, runList } from '../paging';

const router = Router();

/** Super Admin only — immutable action trail. */
router.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (req.user!.role !== 'super_admin') {
      return res.status(403).json({ error: 'The audit log is visible to the Super Admin only' });
    }
    const lp = parseList(req, { created_at: 'created_at', user: 'user_name', action: 'action' }, 'created_at');
    const params: any[] = [];
    let where = `1=1`;
    if (lp.search) {
      params.push(`%${lp.search}%`);
      where += ` and (user_name ilike $1 or action ilike $1 or coalesce(entity,'') ilike $1 or coalesce(entity_id::text,'') ilike $1
        or coalesce(new_value::text,'') ilike $1 or coalesce(old_value::text,'') ilike $1)`;
    }
    if (req.query.user_id) { params.push(req.query.user_id); where += ` and user_id = $${params.length}`; }
    if (req.query.entity) { params.push(req.query.entity); where += ` and entity = $${params.length}`; }
    if (req.query.action) { params.push(req.query.action); where += ` and action = $${params.length}`; }
    if (lp.from) { params.push(lp.from); where += ` and created_at::date >= $${params.length}`; }
    if (lp.to) { params.push(lp.to); where += ` and created_at::date <= $${params.length}`; }
    const result = await runList(
      `select * from audit_logs where ${where}`,
      `select count(*) from audit_logs where ${where}`,
      params,
      lp
    );
    res.json(result);
  })
);

router.get(
  '/actions',
  asyncH(async (_req: Request, res: Response) => {
    const r = await query(`select distinct action from audit_logs order by action`);
    res.json(r.rows.map((x: any) => x.action));
  })
);

export default router;
