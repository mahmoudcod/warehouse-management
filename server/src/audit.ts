import { Request } from 'express';
import { query } from './db';
import { clientIp } from './rateLimit';

export interface AuditEntry {
  action: string; // login, login_failed, logout, create, update, delete, void, return, permission_change, ...
  entity?: string;
  entity_id?: string | number | (string | number)[];
  old_value?: any;
  new_value?: any;
}

/** Fire-and-forget immutable audit trail. Never throws into the main flow. */
export async function audit(req: Request, entry: AuditEntry): Promise<void> {
  try {
    await query(
      `insert into audit_logs (user_id, user_name, action, entity, entity_id, old_value, new_value, ip, user_agent)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        req.user?.id ?? null,
        req.user?.name ?? 'anonymous',
        entry.action,
        entry.entity ?? null,
        entry.entity_id != null ? String(Array.isArray(entry.entity_id) ? entry.entity_id[0] : entry.entity_id) : null,
        entry.old_value ? JSON.stringify(entry.old_value) : null,
        entry.new_value ? JSON.stringify(entry.new_value) : null,
        clientIp(req),
        (req.headers['user-agent'] || '').slice(0, 250),
      ]
    );
  } catch (e) {
    console.error('audit log failed', e);
  }
}
