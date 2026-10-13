import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, ShieldCheck, UserX, UserCheck, KeyRound } from 'lucide-react';
import { api, errMsg } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Badge, Button, Card, ConfirmDialog, DataTable, Field, Input, Modal, PageHeader, Pagination, Select, Column } from '../../components/ui/kit';
import { fmtDate } from '../../lib/format';
import { MODULES, ACTIONS, MODULE_LABELS, EXTRA_PERMISSIONS, PERMISSION_TEMPLATES } from '../../lib/permissions';

const empty = { name: '', email: '', phone: '', password: '', role: 'staff' };

export default function StaffPage() {
  const { t, toast, locale, user } = useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(empty);
  const [permTarget, setPermTarget] = useState<any>(null);
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [saveBusy, setSaveBusy] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<any>(null);
  const [pwTarget, setPwTarget] = useState<any>(null);
  const [newPw, setNewPw] = useState('');
  const pageSize = 20;

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/users?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}`)
      .then((r) => { setRows(r.data.rows); setTotal(r.data.total); })
      .catch((e) => toast(errMsg(e), 'err'))
      .finally(() => setLoading(false));
  }, [page, search]);

  useEffect(() => {
    const id = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(id);
  }, [load]);

  const openPerms = (u: any) => {
    setPermTarget(u);
    setPerms(new Set(u.permissions || []));
  };

  const toggle = (p: string) => {
    const next = new Set(perms);
    if (next.has(p)) {
      next.delete(p);
      // remove dependent extras when view is removed? keep simple: independent toggles
    } else {
      next.add(p);
    }
    setPerms(next);
  };

  const applyTemplate = (key: string) => {
    setPerms(new Set((PERMISSION_TEMPLATES as any)[key].permissions));
  };

  const savePerms = async () => {
    setSaveBusy(true);
    try {
      await api.put(`/users/${permTarget.id}/permissions`, { permissions: [...perms] });
      toast(t('saved_ok'));
      setPermTarget(null);
      load();
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setSaveBusy(false);
    }
  };

  const saveUser = async () => {
    if (form.name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(form.email)) return toast(t('required_field'), 'err');
    try {
      if (editing) {
        await api.patch(`/users/${editing.id}`, { name: form.name, email: form.email, phone: form.phone || null, role: form.role });
      } else {
        if (form.password.length < 8) return toast(locale === 'ar' ? 'كلمة المرور 8 أحرف على الأقل' : 'Password must be at least 8 characters', 'err');
        await api.post('/users', {
          name: form.name, email: form.email, phone: form.phone || null,
          password: form.password, role: form.role,
          permissions: form.role === 'staff' ? [...perms] : undefined,
        });
      }
      toast(t('saved_ok'));
      setFormOpen(false);
      load();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  const columns: Column<any>[] = [
    {
      key: 'name',
      label: t('name'),
      render: (u) => (
        <div>
          <div className="font-bold text-slate-800 dark:text-slate-100">{u.name}</div>
          <div className="text-xs text-slate-400" dir="ltr">{u.email}</div>
        </div>
      ),
    },
    { key: 'role', label: t('role'), render: (u) => <Badge color={u.role === 'super_admin' ? 'violet' : u.role === 'accountant' ? 'blue' : 'slate'}>{t(`role_${u.role}`)}</Badge> },
    {
      key: 'permissions',
      label: t('permissions'),
      hideOnMobile: true,
      render: (u) => (u.role === 'staff' ? <span className="text-xs font-bold text-slate-500">{(u.permissions || []).length} {locale === 'ar' ? 'صلاحية' : 'perms'}</span> : u.role === 'accountant' ? <span className="text-xs text-slate-400">{locale === 'ar' ? 'دور مدمج' : 'built-in role'}</span> : <span className="text-xs text-slate-400">{locale === 'ar' ? 'كل الصلاحيات' : 'full access'}</span>),
    },
    { key: 'last_login_at', label: t('last_login'), hideOnMobile: true, render: (u) => fmtDate(u.last_login_at, true) },
    { key: 'active', label: t('status'), render: (u) => (u.is_active ? <Badge color="green">{t('active')}</Badge> : <Badge color="red">{t('inactive')}</Badge>) },
    {
      key: 'actions',
      label: t('actions'),
      className: 'text-end',
      render: (u) => (
        <div className="flex justify-end gap-1">
          {u.role === 'staff' && (
            <button className="rounded-lg p-2 text-slate-400 hover:bg-primary-50 hover:text-primary-600 dark:hover:bg-primary-900/30" title={t('permission_matrix')} onClick={() => openPerms(u)}>
              <ShieldCheck size={15} />
            </button>
          )}
          <button
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-primary-600 dark:hover:bg-slate-800"
            title={t('edit')}
            onClick={() => {
              setEditing(u);
              setForm({ name: u.name, email: u.email, phone: u.phone || '', password: '', role: u.role });
              setFormOpen(true);
            }}
          >
            <Pencil size={15} />
          </button>
          <button
            className="rounded-lg p-2 text-slate-400 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/30"
            title={t('reset_password_admin')}
            onClick={() => { setPwTarget(u); setNewPw(''); }}
          >
            <KeyRound size={15} />
          </button>
          {u.id !== user?.id && (
            u.is_active ? (
              <button className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30" title={t('deactivate')} onClick={() => setDeactivateTarget(u)}>
                <UserX size={15} />
              </button>
            ) : (
              <button
                className="rounded-lg p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/30"
                title={t('activate')}
                onClick={async () => { try { await api.post(`/users/${u.id}/activate`); toast(t('saved_ok')); load(); } catch (e) { toast(errMsg(e), 'err'); } }}
              >
                <UserCheck size={15} />
              </button>
            )
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('staff')}
        subtitle={t('perm_hint')}
        actions={
          <Button
            icon={Plus}
            onClick={() => {
              setEditing(null);
              setForm(empty);
              setPerms(new Set());
              setFormOpen(true);
            }}
          >
            {t('add_staff')}
          </Button>
        }
      />
      <Card>
        <div className="border-b border-slate-100 p-3 dark:border-slate-800">
          <Input placeholder={t('search')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
        </div>
        <DataTable columns={columns} rows={rows} loading={loading} />
        <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
      </Card>

      {/* user form */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? t('edit_staff') : t('add_staff')} wide>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('name')} required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={t('email_or_phone')} required><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" /></Field>
          <Field label={t('phone')}><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" /></Field>
          <Field label={t('role')} required>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="staff">{t('role_staff')}</option>
              <option value="accountant">{t('role_accountant')}</option>
              <option value="super_admin">{t('role_super_admin')}</option>
            </Select>
          </Field>
          {!editing && (
            <Field label={t('password')} required hint={locale === 'ar' ? '8 أحرف على الأقل' : 'At least 8 characters'} className="sm:col-span-2">
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} dir="ltr" />
            </Field>
          )}
        </div>
        {!editing && form.role === 'staff' && (
          <div className="mt-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-extrabold text-slate-700 dark:text-slate-200">{t('permissions')}</h4>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(PERMISSION_TEMPLATES).map(([k, v]) => (
                  <button
                    key={k}
                    type="button"
                    className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-600 hover:bg-primary-100 hover:text-primary-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-primary-900/40"
                    onClick={() => applyTemplate(k)}
                  >
                    {locale === 'ar' ? (v as any).ar : (v as any).en}
                  </button>
                ))}
              </div>
            </div>
            <PermissionMatrix perms={perms} toggle={toggle} locale={locale} />
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setFormOpen(false)}>{t('cancel')}</Button>
          <Button onClick={saveUser}>{t('save')}</Button>
        </div>
      </Modal>

      {/* permission matrix editor */}
      <Modal open={!!permTarget} onClose={() => setPermTarget(null)} title={`${t('permission_matrix')} — ${permTarget?.name || ''}`} wide>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-400">{t('perm_hint')}</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(PERMISSION_TEMPLATES).map(([k, v]) => (
              <button
                key={k}
                className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-600 hover:bg-primary-100 hover:text-primary-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-primary-900/40"
                onClick={() => applyTemplate(k)}
              >
                {locale === 'ar' ? (v as any).ar : (v as any).en}
              </button>
            ))}
          </div>
        </div>
        <PermissionMatrix perms={perms} toggle={toggle} locale={locale} />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setPermTarget(null)}>{t('cancel')}</Button>
          <Button onClick={savePerms} disabled={saveBusy}>{saveBusy ? t('loading') : t('save')}</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deactivateTarget} onClose={() => setDeactivateTarget(null)} onConfirm={async () => {
        try { await api.post(`/users/${deactivateTarget.id}/deactivate`); toast(t('saved_ok')); load(); } catch (e) { toast(errMsg(e), 'err'); }
      }} title={t('deactivate')} message={deactivateTarget?.name} />

      <Modal open={!!pwTarget} onClose={() => setPwTarget(null)} title={`${t('reset_password_admin')} — ${pwTarget?.name || ''}`}>
        <Field label={t('new_password')} required hint={locale === 'ar' ? '8 أحرف على الأقل' : 'At least 8 characters'}>
          <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} dir="ltr" />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setPwTarget(null)}>{t('cancel')}</Button>
          <Button onClick={async () => {
            if (newPw.length < 8) return toast(t('required_field'), 'err');
            try { await api.post(`/users/${pwTarget.id}/reset-password`, { password: newPw }); toast(t('saved_ok')); setPwTarget(null); } catch (e) { toast(errMsg(e), 'err'); }
          }}>{t('save')}</Button>
        </div>
      </Modal>
    </>
  );
}

function PermissionMatrix({ perms, toggle, locale }: { perms: Set<string>; toggle: (p: string) => void; locale: string }) {
  const actionLabel: Record<string, string> = { view: 'action_view', create: 'action_create', edit: 'action_edit', delete: 'action_delete', export: 'action_export', approve: 'action_approve' };
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
      <table className="w-full min-w-[560px] text-xs">
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-800/60">
            <th className="p-2.5 text-start font-bold text-slate-500 dark:text-slate-400">{locale === 'ar' ? 'الوحدة' : 'Module'}</th>
            {ACTIONS.map((a) => (
              <th key={a} className="p-2.5 text-center font-bold text-slate-500 dark:text-slate-400">{t_(actionLabel[a], locale)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MODULES.map((m) => (
            <tr key={m} className="border-t border-slate-100 dark:border-slate-800">
              <td className="p-2.5 font-bold text-slate-700 dark:text-slate-200">{locale === 'ar' ? MODULE_LABELS[m].ar : MODULE_LABELS[m].en}</td>
              {ACTIONS.map((a) => {
                const key = `${m}.${a}`;
                return (
                  <td key={key} className="p-2.5 text-center">
                    <input type="checkbox" checked={perms.has(key)} onChange={() => toggle(key)} className="h-4 w-4 cursor-pointer accent-primary-600" />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-slate-200 p-3 dark:border-slate-700">
        <div className="mb-2 font-bold text-slate-500 dark:text-slate-400">{locale === 'ar' ? 'صلاحيات إضافية' : 'Extra granular permissions'}</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {EXTRA_PERMISSIONS.map((x) => (
            <label key={x.key} className="flex cursor-pointer items-center gap-2 rounded-lg bg-slate-50 p-2.5 text-xs dark:bg-slate-800/60">
              <input type="checkbox" checked={perms.has(x.key)} onChange={() => toggle(x.key)} className="h-4 w-4 accent-primary-600" />
              <span className="font-semibold text-slate-600 dark:text-slate-300">{locale === 'ar' ? x.ar : x.en}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// tiny local translate for action labels (avoids circular import with context)
function t_(key: string, locale: string): string {
  const dict: Record<string, [string, string]> = {
    action_view: ['عرض', 'View'],
    action_create: ['إنشاء', 'Create'],
    action_edit: ['تعديل', 'Edit'],
    action_delete: ['حذف', 'Delete'],
    action_export: ['تصدير', 'Export'],
    action_approve: ['اعتماد', 'Approve'],
  };
  const pair = dict[key] || [key, key];
  return locale === 'ar' ? pair[0] : pair[1];
}
