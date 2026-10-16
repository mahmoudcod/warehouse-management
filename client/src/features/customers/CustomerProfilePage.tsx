import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Printer, Truck, Wallet, Pencil, RotateCcw, Ban, CalendarClock, Plus } from 'lucide-react';
import { api, errMsg, exportCsv } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Badge, Button, Card, ConfirmDialog, DataTable, Field, Input, Modal, Select, Spinner, Tabs, Textarea, Column } from '../../components/ui/kit';
import { money, num, fmtDate, today } from '../../lib/format';
import { RecordTakenModal, RecordPaymentModal } from '../shared/forms';

function PrintableStatement({ data, onClose }: { data: any; onClose: () => void }) {
  const { t, locale, settings } = useApp();
  if (!data) return null;
  const companyName = locale === 'ar' ? settings?.company_name : settings?.company_name_en;
  return (
    <div id="print-statement" className="fixed inset-0 z-[70] overflow-y-auto bg-white p-6 text-slate-900 print:static print:bg-white dark:bg-white">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-start justify-between gap-4 print:hidden">
          <h2 className="text-lg font-extrabold">{t('statement')}</h2>
          <div className="flex gap-2">
            <Button size="sm" icon={Printer} onClick={() => window.print()}>{t('print')}</Button>
            <Button size="sm" variant="secondary" onClick={onClose}>{t('close')}</Button>
          </div>
        </div>
        <div className="rounded-xl border border-slate-300 p-5 print:border-0">
          <div className="flex items-start justify-between border-b-2 border-slate-800 pb-3">
            <div>
              <div className="text-xl font-black">{companyName}</div>
              <div className="text-xs text-slate-500">{settings?.company_address} · <span dir="ltr">{settings?.company_phone}</span></div>
            </div>
            <div className="text-end text-xs">
              <div className="font-bold">{t('statement')}</div>
              <div>{fmtDate(new Date(), true)}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 py-3 text-sm">
            <div><span className="font-bold">{t('customer')}:</span> {data.customer?.name}</div>
            <div dir="ltr" className="text-end"><span className="font-bold">{t('phone')}:</span> {data.customer?.phone || '—'}</div>
            <div><span className="font-bold">{t('opening_balance')}:</span> <span dir="ltr">{money(data.opening_balance)}</span></div>
            <div className="text-end"><span className="font-bold">{t('closing_balance')}:</span> <span dir="ltr" className="font-black">{money(data.closing_balance)}</span></div>
          </div>
          <table className="w-full border-collapse text-xs" dir="ltr">
            <thead>
              <tr className="bg-slate-100 text-start">
                <th className="border border-slate-300 p-1.5">{t('date')}</th>
                <th className="border border-slate-300 p-1.5">{t('details')}</th>
                <th className="border border-slate-300 p-1.5">{t('debit')}</th>
                <th className="border border-slate-300 p-1.5">{t('credit')}</th>
                <th className="border border-slate-300 p-1.5">{t('running_balance')}</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e: any, i: number) => (
                <tr key={i}>
                  <td className="border border-slate-300 p-1.5 whitespace-nowrap">{fmtDate(e.date)}</td>
                  <td className="border border-slate-300 p-1.5">{e.label || e.notes || (e.kind === 'debit' ? t('nav_assignments') : t('payment'))}</td>
                  <td className="border border-slate-300 p-1.5 text-end">{e.kind === 'debit' ? Number(e.amount).toFixed(2) : ''}</td>
                  <td className="border border-slate-300 p-1.5 text-end">{e.kind === 'credit' ? Number(e.amount).toFixed(2) : ''}</td>
                  <td className="border border-slate-300 p-1.5 text-end font-bold">{e.running_balance.toFixed(2)}</td>
                </tr>
              ))}
              <tr className="bg-slate-100 font-black">
                <td className="border border-slate-300 p-1.5" colSpan={2}>{t('total')}</td>
                <td className="border border-slate-300 p-1.5 text-end">{Number(data.totals.debits).toFixed(2)}</td>
                <td className="border border-slate-300 p-1.5 text-end">{Number(data.totals.credits).toFixed(2)}</td>
                <td className="border border-slate-300 p-1.5 text-end">{Number(data.closing_balance).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
          <div className="pt-3 text-center text-[10px] text-slate-400">{settings?.receipt_footer}</div>
        </div>
      </div>
    </div>
  );
}

function InstallmentsTab({ customerId }: { customerId: string }) {
  const { t, can, toast, locale } = useApp();
  const [plans, setPlans] = useState<any[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ total_amount: '', installments_count: 4, start_date: today(), interval_days: 30, notes: '' });
  const [payTarget, setPayTarget] = useState<any>(null);
  const [payAmount, setPayAmount] = useState('');
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const canPay = can('payments.create');

  const load = useCallback(() => {
    api.get(`/installments?customer_id=${customerId}`).then((r) => setPlans(r.data)).catch(() => {});
  }, [customerId]);
  useEffect(load, [load]);

  const createPlan = async () => {
    try {
      await api.post('/installments', { ...form, customer_id: customerId, total_amount: Number(form.total_amount), installments_count: Number(form.installments_count), interval_days: Number(form.interval_days) });
      toast(t('saved_ok'));
      setFormOpen(false);
      load();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  const payInstallment = async () => {
    try {
      await api.post(`/installments/${payTarget.plan_id}/pay`, { schedule_id: payTarget.id, amount: Number(payAmount) });
      toast(t('saved_ok'));
      setPayTarget(null);
      setPayAmount('');
      load();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  const cancelPlan = async () => {
    try {
      await api.post(`/installments/${cancelTarget.id}/cancel`, { reason: 'cancelled by user' });
      toast(t('saved_ok'));
      load();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  const statusColor = (s: string) => (s === 'paid' ? 'green' : s === 'overdue' ? 'red' : s === 'partial' ? 'amber' : 'slate');

  return (
    <div className="space-y-4">
      {can('customers.edit') && (
        <div className="flex justify-end">
          <Button icon={Plus} onClick={() => setFormOpen(true)}>{t('create_plan')}</Button>
        </div>
      )}
      {!plans.length && <div className="py-10 text-center text-sm text-slate-400">{t('no_data')}</div>}
      {plans.map((p) => (
        <Card key={p.id} className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-extrabold text-slate-800 dark:text-slate-100" dir="ltr">{money(p.total_amount)}</span>
              <span className="ms-2 text-xs text-slate-400">{p.installments_count} × {locale === 'ar' ? 'قسط' : 'installment'} · {fmtDate(p.start_date)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge color={p.status === 'active' ? (p.has_overdue ? 'red' : 'blue') : p.status === 'completed' ? 'green' : 'slate'}>
                {t(`plan_${p.status}`)}{p.has_overdue ? ` · ${t('overdue_status')}` : ''}
              </Badge>
              {can('customers.edit') && p.status === 'active' && (
                <button className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30" onClick={() => setCancelTarget(p)}>
                  <Ban size={14} />
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {(p.schedule || []).map((s: any) => (
              <div key={s.id} className={`rounded-xl border p-2.5 text-xs ${s.display_status === 'overdue' ? 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-900/20' : 'border-slate-200 dark:border-slate-700'}`}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-bold text-slate-500">#{s.installment_no}</span>
                  <Badge color={statusColor(s.display_status)}>{t(s.display_status)}</Badge>
                </div>
                <div className="font-extrabold text-slate-800 dark:text-slate-100" dir="ltr">{money(s.amount)}</div>
                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400"><CalendarClock size={10} />{fmtDate(s.due_date)}</div>
                {canPay && s.status !== 'paid' && (
                  <button
                    className="mt-1.5 w-full rounded-lg bg-emerald-600 py-1 text-[10px] font-bold text-white hover:bg-emerald-700"
                    onClick={() => {
                      setPayTarget({ ...s, plan_id: p.id });
                      setPayAmount(String(s.remaining));
                    }}
                  >
                    {t('pay_installment')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={t('create_plan')}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('total')} required>
              <Input type="number" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} dir="ltr" />
            </Field>
            <Field label={t('installments_count')} required>
              <Input type="number" min={1} max={60} value={form.installments_count} onChange={(e) => setForm({ ...form, installments_count: Number(e.target.value) })} dir="ltr" />
            </Field>
            <Field label={t('start_date')} required>
              <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} dir="ltr" />
            </Field>
            <Field label={t('every_days')}>
              <Input type="number" min={1} value={form.interval_days} onChange={(e) => setForm({ ...form, interval_days: Number(e.target.value) })} dir="ltr" />
            </Field>
          </div>
          <Field label={t('notes')}>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setFormOpen(false)}>{t('cancel')}</Button>
          <Button onClick={createPlan}>{t('save')}</Button>
        </div>
      </Modal>

      <Modal open={!!payTarget} onClose={() => setPayTarget(null)} title={t('pay_installment')}>
        <Field label={t('amount')} required hint={`${t('remaining')}: ${money(payTarget?.remaining || 0)}`}>
          <Input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} dir="ltr" />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setPayTarget(null)}>{t('cancel')}</Button>
          <Button variant="success" onClick={payInstallment}>{t('confirm')}</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!cancelTarget} onClose={() => setCancelTarget(null)} onConfirm={cancelPlan} title={t('cancel_plan')} needReason />
    </div>
  );
}

export default function CustomerProfilePage() {
  const { id } = useParams();
  const { t, can, toast, locale } = useApp();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<any>(null);
  const [tab, setTab] = useState('overview');
  const [assignments, setAssignments] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [statement, setStatement] = useState<any>(null);
  const [statementOpen, setStatementOpen] = useState(false);
  const [takenOpen, setTakenOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [returnTarget, setReturnTarget] = useState<any>(null);
  const [voidTarget, setVoidTarget] = useState<any>(null);
  const [payVoidTarget, setPayVoidTarget] = useState<any>(null);
  const canFin = can('customers.view_financials');
  const Back = locale === 'ar' ? ArrowRight : ArrowLeft;

  const load = useCallback(() => {
    api.get(`/customers/${id}`).then((r) => {
      setCustomer(r.data);
      setForm({ name: r.data.name, phone: r.data.phone || '', national_id: r.data.national_id || '', address: r.data.address || '', notes: r.data.notes || '' });
    }).catch((e) => toast(errMsg(e), 'err'));
    api.get(`/assignments?customer_id=${id}&pageSize=100`).then((r) => setAssignments(r.data.rows)).catch(() => {});
    api.get(`/payments?customer_id=${id}&pageSize=100`).then((r) => setPayments(r.data.rows)).catch(() => {});
  }, [id]);

  useEffect(load, [load]);

  const openStatement = async () => {
    try {
      const r = await api.get(`/customers/${id}/statement`);
      setStatement(r.data);
      setStatementOpen(true);
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  const doReturn = async () => {
    try {
      await api.post(`/assignments/${returnTarget.id}/return`, {});
      toast(t('saved_ok'));
      load();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  if (!customer) return <Spinner />;

  const aCols: Column<any>[] = [
    { key: 'item', label: t('item'), render: (a) => (
      <div>
        <div className="font-bold text-slate-800 dark:text-slate-100">{locale === 'ar' ? a.item_name_ar || a.item_name || a.item_text : a.item_name || a.item_text}</div>
        <div className="text-xs text-slate-400">{a.serial_numbers || ''}</div>
      </div>
    ) },
    { key: 'quantity', label: t('quantity'), render: (a) => num(a.quantity) },
    { key: 'amount', label: t('amount'), render: (a) => <span dir="ltr" className="font-bold">{money(a.amount)}</span> },
    { key: 'assigned_at', label: t('date'), render: (a) => fmtDate(a.assigned_at) },
    { key: 'status', label: t('status'), render: (a) => <Badge color={a.status === 'taken' ? 'blue' : a.status === 'returned' ? 'green' : 'slate'}>{t(a.status)}</Badge> },
    { key: 'notes', label: t('notes'), hideOnMobile: true, render: (a) => <span className="text-xs text-slate-400">{a.notes || '—'}</span> },
    ...(can('assignments.edit') || can('assignments.approve') || can('assignments.delete')
      ? [{
          key: 'act', label: t('actions'), className: 'text-end', render: (a: any) => (
            <div className="flex justify-end gap-1">
              {a.status === 'taken' && (can('assignments.edit') || can('assignments.approve')) && (
                <button className="rounded-lg p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/30" title={t('mark_returned')} onClick={() => setReturnTarget(a)}>
                  <RotateCcw size={15} />
                </button>
              )}
              {a.status === 'taken' && (can('assignments.approve') || can('assignments.delete')) && (
                <button className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30" title={t('void')} onClick={() => setVoidTarget(a)}>
                  <Ban size={15} />
                </button>
              )}
            </div>
          ),
        }]
      : []),
  ];

  const pCols: Column<any>[] = [
    { key: 'receipt_number', label: t('receipt_no'), render: (p) => <span className="font-mono text-xs font-bold" dir="ltr">{p.receipt_number}</span> },
    { key: 'amount', label: t('amount'), render: (p) => <span dir="ltr" className="font-extrabold text-emerald-600 dark:text-emerald-400">{money(p.amount)}</span> },
    { key: 'method', label: t('method'), render: (p) => t(p.method) },
    { key: 'paid_at', label: t('date'), render: (p) => fmtDate(p.paid_at) },
    { key: 'received_by_name', label: t('received_by'), hideOnMobile: true, render: (p) => p.received_by_name || '—' },
    { key: 'status', label: t('status'), render: (p) => <Badge color={p.status === 'active' ? 'green' : 'red'}>{p.status === 'active' ? t('active') : t('voided')}</Badge> },
    { key: 'notes', label: t('notes'), hideOnMobile: true, render: (p) => <span className="text-xs text-slate-400">{p.notes || '—'}</span> },
    ...(can('payments.approve') || can('payments.delete') || can('payments.edit')
      ? [{
          key: 'act', label: t('actions'), className: 'text-end', render: (p: any) => (
            p.status === 'active' && (can('payments.approve') || can('payments.delete')) ? (
              <div className="flex justify-end">
                <button className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30" title={t('void')} onClick={() => setPayVoidTarget(p)}>
                  <Ban size={15} />
                </button>
              </div>
            ) : null
          ),
        }]
      : []),
  ];

  const bal = Number(customer.balance || 0);

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <button onClick={() => navigate('/customers')} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
          <Back size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-extrabold text-slate-900 dark:text-slate-50">{customer.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span dir="ltr">{customer.phone || '—'}</span>
            {customer.national_id && <span dir="ltr">· {customer.national_id}</span>}
            {customer.address && <span>· {customer.address}</span>}
            {!customer.is_active && <Badge color="slate">{t('inactive')}</Badge>}
          </div>
        </div>
        <div className="flex gap-2">
          {can('customers.edit') && (
            <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditOpen(true)}>{t('edit')}</Button>
          )}
        </div>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: t('tab_overview') },
          { key: 'devices', label: t('tab_devices'), badge: assignments.filter((a) => a.status === 'taken').length },
          { key: 'payments', label: t('tab_payments'), badge: payments.length },
          { key: 'statement', label: t('tab_statement') },
          { key: 'installments', label: t('tab_installments') },
        ]}
      />

      <div className="mt-4">
        {tab === 'overview' && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card className="p-4"><div className="text-[11px] font-bold text-slate-400">{t('total_taken')}</div><div className="text-lg font-extrabold text-slate-800 dark:text-slate-100"><span dir="ltr">{money(customer.total_taken)}</span></div></Card>
              <Card className="p-4"><div className="text-[11px] font-bold text-slate-400">{t('total_paid')}</div><div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400"><span dir="ltr">{money(customer.total_paid)}</span></div></Card>
              <Card className="p-4"><div className="text-[11px] font-bold text-slate-400">{t('remaining')}</div><div className={`text-lg font-extrabold ${bal > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}><span dir="ltr">{money(bal)}</span></div></Card>
              <Card className="p-4">
                <div className="mb-1 text-[11px] font-bold text-slate-400">{t('status')}</div>
                <div className="mt-1">{customer.overdue ? <Badge color="red">{t('overdue_status')}</Badge> : bal > 0.005 ? <Badge color="amber">{t('owes_status')}</Badge> : <Badge color="green">{t('clear_status')}</Badge>}</div>
              </Card>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {can('assignments.create') && <Button icon={Truck} onClick={() => setTakenOpen(true)}>{t('record_taken')}</Button>}
              {can('payments.create') && <Button variant="success" icon={Wallet} onClick={() => setPayOpen(true)}>{t('record_payment')}</Button>}
              {canFin && <Button variant="secondary" icon={Printer} onClick={openStatement}>{t('print')} — {t('tab_statement')}</Button>}
            </div>
            {canFin && (
              <Card className="mt-4 p-4">
                <h3 className="mb-3 text-sm font-extrabold text-slate-700 dark:text-slate-200">{t('tab_statement')} — {locale === 'ar' ? 'آخر الحركات' : 'latest entries'}</h3>
                <MiniStatement customerId={id!} />
              </Card>
            )}
          </>
        )}

        {tab === 'devices' && (
          <Card>
            <div className="flex justify-end p-3">
              {can('assignments.create') && <Button size="sm" icon={Truck} onClick={() => setTakenOpen(true)}>{t('record_taken')}</Button>}
            </div>
            <DataTable columns={aCols} rows={assignments} />
          </Card>
        )}

        {tab === 'payments' && (
          <Card>
            <div className="flex justify-end gap-2 p-3">
              {can('payments.create') && <Button size="sm" variant="success" icon={Wallet} onClick={() => setPayOpen(true)}>{t('record_payment')}</Button>}
              {can('payments.export') && (
                <Button size="sm" variant="secondary" onClick={() => exportCsv(`payments-${customer.name}.csv`, payments, { receipt_number: t('receipt_no'), amount: t('amount'), method: t('method'), paid_at: t('date') })}>
                  {t('export_csv')}
                </Button>
              )}
            </div>
            <DataTable columns={pCols} rows={payments} />
          </Card>
        )}

        {tab === 'statement' && canFin && (
          <Card className="p-4">
            <div className="mb-3 flex justify-end">
              <Button size="sm" icon={Printer} onClick={openStatement}>{t('print')}</Button>
            </div>
            <MiniStatement customerId={id!} />
          </Card>
        )}

        {tab === 'installments' && canFin && <InstallmentsTab customerId={id!} />}
      </div>

      <RecordTakenModal open={takenOpen} onClose={() => setTakenOpen(false)} customerId={id} onSaved={load} />
      <RecordPaymentModal open={payOpen} onClose={() => setPayOpen(false)} customerId={id} onSaved={load} />

      {/* edit customer */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={t('edit_customer')}>
        <div className="space-y-4">
          <Field label={t('name')} required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('phone')}><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" /></Field>
            <Field label={t('national_id')}><Input value={form.national_id} onChange={(e) => setForm({ ...form, national_id: e.target.value })} dir="ltr" /></Field>
          </div>
          <Field label={t('address')}><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <Field label={t('notes')}><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditOpen(false)}>{t('cancel')}</Button>
          <Button onClick={async () => {
            try {
              await api.patch(`/customers/${id}`, form);
              toast(t('saved_ok'));
              setEditOpen(false);
              load();
            } catch (e) { toast(errMsg(e), 'err'); }
          }}>{t('save')}</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!returnTarget} onClose={() => setReturnTarget(null)} onConfirm={doReturn} title={t('mark_returned')} danger={false} confirmLabel={t('confirm')}
        message={`${returnTarget?.item_name || returnTarget?.item_text} — ${money(returnTarget?.amount)}`} />
      <ConfirmDialog open={!!voidTarget} onClose={() => setVoidTarget(null)} onConfirm={async (reason) => {
        try { await api.post(`/assignments/${voidTarget.id}/void`, { reason }); toast(t('saved_ok')); load(); } catch (e) { toast(errMsg(e), 'err'); }
      }} title={t('void_confirm')} needReason />
      <ConfirmDialog open={!!payVoidTarget} onClose={() => setPayVoidTarget(null)} onConfirm={async (reason) => {
        try { await api.post(`/payments/${payVoidTarget.id}/void`, { reason }); toast(t('saved_ok')); load(); } catch (e) { toast(errMsg(e), 'err'); }
      }} title={t('void_confirm')} needReason />

      {statementOpen && <PrintableStatement data={statement} onClose={() => setStatementOpen(false)} />}
    </>
  );
}

function MiniStatement({ customerId }: { customerId: string }) {
  const { t, locale } = useApp();
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    api.get(`/customers/${customerId}/statement`).then((r) => setData(r.data)).catch(() => {});
  }, [customerId]);
  if (!data) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs md:text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-start text-[11px] text-slate-400 dark:border-slate-700">
            <th className="p-2 text-start">{t('date')}</th>
            <th className="p-2 text-start">{t('details')}</th>
            <th className="p-2 text-end">{t('debit')}</th>
            <th className="p-2 text-end">{t('credit')}</th>
            <th className="p-2 text-end">{t('running_balance')}</th>
          </tr>
        </thead>
        <tbody>
          {data.entries.slice(-15).reverse().map((e: any, i: number) => (
            <tr key={i} className="border-b border-slate-50 last:border-0 dark:border-slate-800">
              <td className="p-2 text-slate-400 whitespace-nowrap">{fmtDate(e.date)}</td>
              <td className="p-2">{e.label || e.notes || (e.kind === 'debit' ? t('nav_assignments') : t('payment'))}</td>
              <td className="p-2 text-end font-bold"><span dir="ltr">{e.kind === 'debit' ? money(e.amount) : ''}</span></td>
              <td className="p-2 text-end font-bold text-emerald-600 dark:text-emerald-400"><span dir="ltr">{e.kind === 'credit' ? money(e.amount) : ''}</span></td>
              <td className="p-2 text-end"><span dir="ltr">{money(e.running_balance)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
