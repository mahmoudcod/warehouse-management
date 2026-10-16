import React, { useCallback, useEffect, useState } from 'react';
import { Ban, RotateCcw, Plus } from 'lucide-react';
import { api, errMsg, exportCsv } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Badge, Button, Card, ConfirmDialog, DataTable, Input, PageHeader, Pagination, Select, Column } from '../../components/ui/kit';
import { money, num, fmtDate, today, daysAgoStr, monthStart } from '../../lib/format';
import { RecordTakenModal } from '../shared/forms';

export default function AssignmentsPage() {
  const { t, can, toast, locale } = useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [returnTarget, setReturnTarget] = useState<any>(null);
  const [voidTarget, setVoidTarget] = useState<any>(null);
  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const pageSize = 25;

  const load = useCallback(() => {
    setLoading(true);
    api
      .get(`/assignments?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}${status ? `&status=${status}` : ''}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`)
      .then((r) => {
        setRows(r.data.rows);
        setTotal(r.data.total);
      })
      .catch((e) => toast(errMsg(e), 'err'))
      .finally(() => setLoading(false));
  }, [page, search, status, from, to]);

  useEffect(() => {
    const id = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(id);
  }, [load]);

  const columns: Column<any>[] = [
    { key: 'assigned_at', label: t('date'), render: (a) => fmtDate(a.assigned_at) },
    {
      key: 'customer_name',
      label: t('customer_name'),
      render: (a) => (
        <div>
          <div className="font-bold text-slate-800 dark:text-slate-100">{a.customer_name}</div>
          <div className="text-xs text-slate-400" dir="ltr">{a.customer_phone || ''}</div>
        </div>
      ),
    },
    { key: 'item', label: t('item'), render: (a) => (locale === 'ar' ? a.item_name_ar || a.item_name || a.item_text : a.item_name || a.item_text) },
    { key: 'quantity', label: t('quantity'), hideOnMobile: true, render: (a) => num(a.quantity) },
    { key: 'amount', label: t('amount'), render: (a) => <span dir="ltr" className="font-extrabold">{money(a.amount)}</span> },
    {
      key: 'initial_paid',
      label: t('paid_at_record'),
      hideOnMobile: true,
      render: (a) => Number(a.initial_paid) > 0 ? (
        <span dir="ltr" className={`font-bold ${Number(a.initial_paid) >= Number(a.amount) ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
          {money(a.initial_paid)}
        </span>
      ) : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>,
    },
    { key: 'created_by_name', label: t('created_by'), hideOnMobile: true, render: (a) => a.created_by_name || '—' },
    { key: 'status', label: t('status'), render: (a) => <Badge color={a.status === 'taken' ? 'blue' : a.status === 'returned' ? 'green' : 'slate'}>{t(a.status)}</Badge> },
    ...(can('assignments.edit') || can('assignments.approve') || can('assignments.delete')
      ? [{
          key: 'act',
          label: t('actions'),
          className: 'text-end',
          render: (a: any) =>
            a.status === 'taken' ? (
              <div className="flex justify-end gap-1">
                {(can('assignments.edit') || can('assignments.approve')) && (
                  <button className="rounded-lg p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/30" title={t('mark_returned')} onClick={() => setReturnTarget(a)}>
                    <RotateCcw size={15} />
                  </button>
                )}
                {(can('assignments.approve') || can('assignments.delete')) && (
                  <button className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30" title={t('void')} onClick={() => setVoidTarget(a)}>
                    <Ban size={15} />
                  </button>
                )}
              </div>
            ) : null,
        }]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t('assignments')}
        subtitle={`${total} ${locale === 'ar' ? 'سجل' : 'records'}`}
        actions={
          <div className="flex gap-2">
            {can('assignments.create') && (
              <Button icon={Plus} onClick={() => setRecordModalOpen(true)}>
                {t('record_device_taken')}
              </Button>
            )}
            {can('assignments.export') && (
              <Button variant="secondary" onClick={() => exportCsv('assignments.csv', rows, { assigned_at: t('date'), customer_name: t('customer'), item_name: t('item'), quantity: t('quantity'), amount: t('amount'), status: t('status') })}>
                {t('export_csv')}
              </Button>
            )}
          </div>
        }
      />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3 dark:border-slate-800">
          <Input placeholder={t('search')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="!w-auto">
            <option value="">{t('all')}</option>
            <option value="taken">{t('taken')}</option>
            <option value="returned">{t('returned')}</option>
            <option value="voided">{t('voided')}</option>
          </Select>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} dir="ltr" className="!w-auto" />
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} dir="ltr" className="!w-auto" />
        </div>
        <DataTable columns={columns} rows={rows} loading={loading} />
        <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
      </Card>

      <ConfirmDialog open={!!returnTarget} onClose={() => setReturnTarget(null)} onConfirm={async () => {
        try { await api.post(`/assignments/${returnTarget.id}/return`, {}); toast(t('saved_ok')); load(); } catch (e) { toast(errMsg(e), 'err'); }
      }} title={t('mark_returned')} danger={false}
        message={`${returnTarget?.customer_name} — ${returnTarget?.item_name || returnTarget?.item_text} (${money(returnTarget?.amount)})`} />
      <ConfirmDialog open={!!voidTarget} onClose={() => setVoidTarget(null)} onConfirm={async (reason) => {
        try { await api.post(`/assignments/${voidTarget.id}/void`, { reason }); toast(t('saved_ok')); load(); } catch (e) { toast(errMsg(e), 'err'); }
      }} title={t('void_confirm')} needReason />

      <RecordTakenModal open={recordModalOpen} onClose={() => setRecordModalOpen(false)} onSaved={load} />
    </>
  );
}
