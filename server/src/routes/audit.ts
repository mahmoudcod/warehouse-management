import { Router, Request, Response } from 'express';
import { AuditLog, rx } from '../db';
import { asyncH } from '../errors';
import { parseList, runAggList } from '../paging';

const router = Router();

/** Super Admin only — immutable action trail. */
router.get(
  '/',
  asyncH(async (req: Request, res: Response) => {
    if (req.user!.role !== 'super_admin') {
      return res.status(403).json({ error: 'The audit log is visible to the Super Admin only' });
    }
    const lp = parseList(req, { created_at: 'created_at', user: 'user_name', action: 'action' }, 'created_at');
    const match: any = {};
    if (lp.search) {
      const s = rx(lp.search);
      match.$or = [{ user_name: s }, { action: s }, { entity: s }, { entity_id: s }, { search_blob: s }];
    }
    if (req.query.user_id) match.user_id = Number(req.query.user_id);
    if (req.query.entity) match.entity = req.query.entity;
    if (req.query.action) match.action = req.query.action;
    if (lp.from) match.created_at = { ...(match.created_at || {}), $gte: new Date(`${lp.from}T00:00:00.000Z`) };
    if (lp.to) match.created_at = { ...(match.created_at || {}), $lte: new Date(`${lp.to}T23:59:59.999Z`) };
    const result = await runAggList(AuditLog, [{ $match: match }], lp.sort, lp);
    res.json(result);
  })
);

router.get(
  '/actions',
  asyncH(async (_req: Request, res: Response) => {
    const rows = await AuditLog.distinct('action');
    res.json((rows as string[]).sort());
  })
);

export default router;
