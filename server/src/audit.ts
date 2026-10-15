import { Request } from 'express';
import { AuditLog, nextSequence } from './db';
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
    const entity_id =
      entry.entity_id != null
        ? String(Array.isArray(entry.entity_id) ? entry.entity_id[0] : entry.entity_id)
        : null;
    const id = await nextSequence('AuditLog');
    await AuditLog.create({
      id,
      user_id: req.user?.id ?? null,
      user_name: req.user?.name ?? 'anonymous',
      action: entry.action,
      entity: entry.entity ?? null,
      entity_id,
      old_value: entry.old_value ?? null,
      new_value: entry.new_value ?? null,
      search_blob: JSON.stringify([entry.old_value ?? null, entry.new_value ?? null, entity_id]).toLowerCase(),
      ip: clientIp(req),
      user_agent: String(req.headers['user-agent'] || '').slice(0, 250),
    });
  } catch (e) {
    console.error('audit log failed', e);
  }
}
