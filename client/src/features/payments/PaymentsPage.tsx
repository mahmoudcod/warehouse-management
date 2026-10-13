import React, { useCallback, useEffect, useState } from 'react';
import { Ban, Printer, Plus } from 'lucide-react';
import { api, errMsg, exportCsv } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Badge, Button, Card, ConfirmDialog, DataTable, Input, PageHeader, Pagination, Select, Column } from '../../components/ui/kit';
import { money, fmtDate, today, monthStart } from '../../lib/format';
import { RecordPaymentModal } from '../shared/forms';

export default function PaymentsPage() {
  const { t, can, toast, locale, settings } = useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(true);
  const [voidTarget, setVoidTarget] = useState<any>(null);
  const [receipt, setReceipt] = useState<any>(null);
  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const pageSize = 25;

  const load = useCallback(() => {
    setLoading(true);
    api
      .get(`/payments?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}${method ? `&method=${method}` : ''}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`)
      .then((r) => {
        setRows(r.data.rows);
        setTotal(r.data.total);
      })
      .catch((e) => toast(errMsg(e), 'err'))
      .finally(() => setLoading(false));
  }, [page, search, method, from, to]);

  useEffect(() => {
    const id = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(id);
  }, [load]);

  const columns: Column<any>[] = [
    { key: 'receipt_number', label: t('receipt_no'), render: (p) => (
      <button className="font-mono text-xs font-extrabold text-primary-600 hover:underline dark:text-primary-400" dir="ltr" onClick={() => setReceipt(p)}>
        {p.receipt_number}
      </button>
    ) },
    {
      key: 'customer_name',
      label: t('customer_name'),
      render: (p) => (
        <div>
          <div className="font-bold text-slate-800 dark:text-slate-100">{p.customer_name}</div>
          <div className="text-xs text-slate-400" dir="ltr">{p.customer_phone || ''}</div>
        </div>
      ),
    },
    { key: 'amount', label: t('amount'), render: (p) => <span dir="ltr" className={`font-extrabold ${p.status === 'voided' ? 'text-slate-400 line-through' : 'text-emerald-600 dark:text-emerald-400'}`}>{money(p.amount)}</span> },
    { key: 'method', label: t('method'), render: (p) => t(p.method) },
    { key: 'paid_at', label: t('date'), render: (p) => fmtDate(p.paid_at) },
    { key: 'received_by_name', label: t('received_by'), hideOnMobile: true, render: (p) => p.received_by_name || '—' },
    { key: 'status', label: t('status'), render: (p) => <Badge color={p.status === 'active' ? 'green' : 'red'}>{p.status === 'active' ? t('active') : t('voided')}</Badge> },
    ...(can('payments.approve') || can('payments.delete')
      ? [{
          key: 'act',
          label: t('actions'),
          className: 'text-end',
          render: (p: any) =>
            p.status === 'active' ? (
              <div className="flex justify-end">
                <button className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30" title={t('void')} onClick={() => setVoidTarget(p)}>
                  <Ban size={15} />
                </button>
              </div>
            ) : null,
        }]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t('payments')}
        subtitle={`${total} ${locale === 'ar' ? 'سجل' : 'records'}`}
        actions={
          <div className="flex gap-2">
            {can('payments.create') && (
              <Button icon={Plus} onClick={() => setRecordModalOpen(true)}>
                {t('record_payment')}
              </Button>
            )}
            {can('payments.export') && (
              <Button variant="secondary" onClick={() => exportCsv('payments.csv', rows, { receipt_number: t('receipt_no'), customer_name: t('customer'), amount: t('amount'), method: t('method'), paid_at: t('date'), received_by_name: t('received_by') })}>
                {t('export_csv')}
              </Button>
            )}
          </div>
        }
      />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3 dark:border-slate-800">
          <Input placeholder={t('search')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
          <Select value={method} onChange={(e) => { setMethod(e.target.value); setPage(1); }} className="!w-auto">
            <option value="">{t('all')}</option>
            <option value="cash">{t('cash')}</option>
            <option value="transfer">{t('transfer')}</option>
            <option value="other">{t('other')}</option>
          </Select>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} dir="ltr" className="!w-auto" />
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} dir="ltr" className="!w-auto" />
        </div>
        <DataTable columns={columns} rows={rows} loading={loading} />
        <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
      </Card>

      {/* printable receipt */}
      {receipt && (
        <div id="print-statement" className="fixed inset-0 z-[70] overflow-y-auto bg-white p-6 text-slate-900 dark:bg-white">
          <div className="mx-auto max-w-sm">
            <div className="mb-3 flex items-center justify-between print:hidden">
              <Button size="sm" icon={Printer} onClick={() => window.print()}>{t('print')}</Button>
              <Button size="sm" variant="secondary" onClick={() => setReceipt(null)}>{t('close')}</Button>
            </div>
            <div className="rounded-xl border border-slate-300 p-5 text-center print:border-0">
              <div className="text-lg font-black">{locale === 'ar' ? settings?.company_name : settings?.company_name_en}</div>
              <div className="mb-3 text-xs text-slate-400" dir="ltr">{settings?.company_phone}</div>
              <div className="mb-1 text-sm font-bold">{locale === 'ar' ? 'إيصال استلام' : 'Payment Receipt'}</div>
              <div className="mb-4 font-mono text-xs" dir="ltr">{receipt.receipt_number}</div>
              <div className="space-y-1.5 border-y border-dashed border-slate-300 py-3 text-sm">
                <div className="flex justify-between"><span>{t('customer_name')}:</span><b>{receipt.customer_name}</b></div>
                <div className="flex justify-between"><span>{t('amount')}:</span><b dir="ltr">{money(receipt.amount)}</b></div>
                <div className="flex justify-between"><span>{t('method')}:</span><b>{t(receipt.method)}</b></div>
                <div className="flex justify-between"><span>{t('date')}:</span><b>{fmtDate(receipt.paid_at)}</b></div>
                <div className="flex justify-between"><span>{t('received_by')}:</span><b>{receipt.received_by_name || '—'}</b></div>
              </div>
              {receipt.notes && <div className="pt-2 text-xs text-slate-400">{receipt.notes}</div>}
              <div className="pt-3 text-[10px] text-slate-400">{settings?.receipt_footer}</div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog open={!!voidTarget} onClose={() => setVoidTarget(null)} onConfirm={async (reason) => {
        try { await api.post(`/payments/${voidTarget.id}/void`, { reason }); toast(t('saved_ok')); load(); } catch (e) { toast(errMsg(e), 'err'); }
      }} title={t('void_confirm')} message={`${voidTarget?.receipt_number} — ${money(voidTarget?.amount)}`} needReason />

      <RecordPaymentModal open={recordModalOpen} onClose={() => setRecordModalOpen(false)} onSaved={load} />
    </>
  );
}
