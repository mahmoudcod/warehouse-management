import React, { useCallback, useEffect, useState } from 'react';
import { api, errMsg, exportCsv } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Badge, Button, Card, DataTable, Input, PageHeader, Pagination, Select, Column } from '../../components/ui/kit';
import { fmtDate } from '../../lib/format';

const actionColors: Record<string, string> = {
  login: 'blue', login_failed: 'red', logout: 'slate', create: 'green', update: 'amber',
  delete: 'red', void: 'red', return: 'amber', permission_change: 'violet',
  stock_adjustment: 'violet', stock_transfer: 'slate', deactivate: 'red', activate: 'green',
};

export default function AuditPage() {
  const { t, toast, locale } = useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [actions, setActions] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<any>(null);
  const pageSize = 30;

  useEffect(() => {
    api.get('/audit/actions').then((r) => setActions(r.data)).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get(`/audit?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}${action ? `&action=${action}` : ''}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`)
      .then((r) => { setRows(r.data.rows); setTotal(r.data.total); })
      .catch((e) => toast(errMsg(e), 'err'))
      .finally(() => setLoading(false));
  }, [page, search, action, from, to]);

  useEffect(() => {
    const id = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(id);
  }, [load]);

  const fmtVal = (v: any) => {
    if (!v) return '—';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 60 ? s.slice(0, 60) + '…' : s;
  };

  const columns: Column<any>[] = [
    { key: 'created_at', label: t('date'), render: (r) => <span className="whitespace-nowrap text-xs">{fmtDate(r.created_at, true)}</span> },
    { key: 'user_name', label: t('who'), render: (r) => <span className="font-bold">{r.user_name || '—'}</span> },
    { key: 'action', label: t('what'), render: (r) => <Badge color={(actionColors as any)[r.action] || 'slate'}>{r.action}</Badge> },
    { key: 'entity', label: t('entity'), hideOnMobile: true, render: (r) => <span className="text-xs">{r.entity || '—'}</span> },
    { key: 'changes', label: `${t('old_value')} → ${t('new_value')}`, render: (r) => (
      <button className="max-w-56 truncate text-start text-xs text-slate-400 hover:text-primary-600" onClick={() => setDetail(r)}>
        {fmtVal(r.old_value) !== '—' || fmtVal(r.new_value) !== '—' ? `${fmtVal(r.old_value)} → ${fmtVal(r.new_value)}` : '—'}
      </button>
    ) },
    { key: 'ip', label: t('ip'), hideOnMobile: true, render: (r) => <span className="font-mono text-xs" dir="ltr">{r.ip || '—'}</span> },
  ];

  return (
    <>
      <PageHeader
        title={t('audit_log')}
        actions={
          <Button variant="secondary" onClick={() => exportCsv('audit-log.csv', rows, { created_at: t('date'), user_name: t('who'), action: t('what'), entity: t('entity'), ip: t('ip') })}>
            {t('export_csv')}
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3 dark:border-slate-800">
          <Input placeholder={t('search')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
          <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="!w-auto">
            <option value="">{t('all')}</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} dir="ltr" className="!w-auto" />
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} dir="ltr" className="!w-auto" />
        </div>
        <DataTable columns={columns} rows={rows} loading={loading} />
        <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
      </Card>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setDetail(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl dark:bg-slate-900 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-extrabold text-slate-800 dark:text-slate-100">
              {detail.action} · {detail.entity} <span className="font-mono text-xs text-slate-400">{String(detail.entity_id || '').slice(0, 8)}</span>
            </h3>
            <div className="mb-3 text-xs text-slate-400">{detail.user_name} · {fmtDate(detail.created_at, true)} · <span dir="ltr">{detail.ip}</span></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-bold text-slate-400">{t('old_value')}</div>
                <pre className="max-h-64 overflow-auto rounded-xl bg-slate-50 p-3 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300" dir="ltr">{JSON.stringify(detail.old_value, null, 2) || '—'}</pre>
              </div>
              <div>
                <div className="mb-1 text-xs font-bold text-slate-400">{t('new_value')}</div>
                <pre className="max-h-64 overflow-auto rounded-xl bg-slate-50 p-3 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300" dir="ltr">{JSON.stringify(detail.new_value, null, 2) || '—'}</pre>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="secondary" onClick={() => setDetail(null)}>{t('close')}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
