import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Ban, ArrowLeftRight, Lock, Unlock, Vault, Paperclip } from 'lucide-react';
import { api, errMsg, exportCsv } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Badge, Button, Card, ConfirmDialog, DataTable, Field, Input, Modal, PageHeader, Pagination, Select, Tabs, Textarea, Column } from '../../components/ui/kit';
import { money, fmtDate, today, monthStart } from '../../lib/format';

const emptyTx = { type: 'expense', amount: '', category_id: '', occurred_at: today(), method: 'cash', account_id: '', reference: '', notes: '' };

export default function AccountingPage() {
  const { t, can, toast, locale, user } = useApp();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('tx');
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(true);
  const [cats, setCats] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [periods, setPeriods] = useState<any[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(emptyTx);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [voidTarget, setVoidTarget] = useState<any>(null);
  const [accOpen, setAccOpen] = useState(false);
  const [accForm, setAccForm] = useState({ name: '', name_ar: '', type: 'cash', opening_balance: '' });
  const [trOpen, setTrOpen] = useState(false);
  const [trForm, setTrForm] = useState({ from_account_id: '', to_account_id: '', amount: '', occurred_at: today(), notes: '' });
  const [catOpen, setCatOpen] = useState(false);
  const [catForm, setCatForm] = useState({ name: '', name_ar: '', kind: 'expense' });
  const [closeData, setCloseData] = useState<any>(null);
  const [counted, setCounted] = useState('');
  const [lockMonth, setLockMonth] = useState(today().slice(0, 7));
  const pageSize = 25;
  const isAdmin = user?.role === 'super_admin';

  const load = useCallback(() => {
    setLoading(true);
    api
      .get(`/accounting?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}&exclude_transfers=true${type ? `&type=${type}` : ''}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`)
      .then((r) => { setRows(r.data.rows); setTotal(r.data.total); })
      .catch((e) => toast(errMsg(e), 'err'))
      .finally(() => setLoading(false));
  }, [page, search, type, from, to]);

  const loadAux = useCallback(() => {
    api.get('/accounting/categories').then((r) => setCats(r.data)).catch(() => {});
    api.get('/accounting/accounts').then((r) => setAccounts(r.data)).catch(() => {});
    api.get('/accounting/periods').then((r) => setPeriods(r.data)).catch(() => {});
  }, []);

  const loadClose = useCallback(() => {
    api.get(`/accounting/daily-close?date=${today()}`).then((r) => {
      setCloseData(r.data);
      setCounted(r.data.saved ? String(r.data.saved.counted_amount) : '');
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const id = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(id);
  }, [load]);
  useEffect(loadAux, [loadAux]);
  useEffect(() => { if (tab === 'close') loadClose(); }, [tab, loadClose]);
  useEffect(() => {
    if (params.get('new')) {
      setEditing(null);
      setForm(emptyTx);
      setFormOpen(true);
      setParams({}, { replace: true });
    }
  }, [params]);

  const saveTx = async () => {
    if (!Number(form.amount)) return toast(t('required_field'), 'err');
    const payload = JSON.stringify({
      type: form.type,
      amount: Number(form.amount),
      category_id: form.category_id || null,
      occurred_at: form.occurred_at,
      method: form.method,
      account_id: form.account_id || null,
      reference: form.reference || null,
      notes: form.notes || null,
    });
    const fd = new FormData();
    fd.append('payload', payload);
    if (attachment) fd.append('attachment', attachment);
    try {
      if (editing) {
        await api.patch(`/accounting/${editing.id}`, fd);
      } else {
        await api.post('/accounting', fd);
      }
      toast(t('saved_ok'));
      setFormOpen(false);
      setAttachment(null);
      load();
      loadAux();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  const columns: Column<any>[] = [
    { key: 'occurred_at', label: t('date'), render: (r) => fmtDate(r.occurred_at) },
    {
      key: 'type',
      label: t('tx_type'),
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <Badge color={r.type === 'income' ? 'green' : 'red'}>{r.type === 'income' ? t('income') : t('expense')}</Badge>
          {r.payment_id && <Badge color="blue">{t('linked_payment')}</Badge>}
        </div>
      ),
    },
    { key: 'category', label: t('tx_category'), render: (r) => (locale === 'ar' ? r.category_name_ar || r.category_name : r.category_name) || '—' },
    { key: 'amount', label: t('amount'), render: (r) => <span dir="ltr" className={`font-extrabold ${r.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{r.type === 'income' ? '+' : '−'}{money(r.amount)}</span> },
    { key: 'method', label: t('method'), hideOnMobile: true, render: (r) => t(r.method) },
    { key: 'account_name', label: t('accounts'), hideOnMobile: true, render: (r) => (locale === 'ar' ? r.account_name_ar || r.account_name : r.account_name) || '—' },
    { key: 'reference', label: t('reference'), hideOnMobile: true, render: (r) => <span className="font-mono text-xs" dir="ltr">{r.reference || '—'}</span> },
    {
      key: 'attachment',
      label: t('attachment'),
      hideOnMobile: true,
      render: (r) =>
        r.attachment_path ? (
          <a
            href={r.attachment_path}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md p-1.5 text-xs text-primary-600 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-950/40"
            title={t('attachment')}
          >
            <Paperclip size={14} />
          </a>
        ) : (
          <span className="text-slate-300 dark:text-slate-600">—</span>
        ),
    },
    { key: 'created_by_name', label: t('created_by'), hideOnMobile: true, render: (r) => r.created_by_name || '—' },
    { key: 'status', label: t('status'), render: (r) => <Badge color={r.status === 'active' ? 'green' : 'red'}>{r.status === 'active' ? t('active') : t('voided')}</Badge> },
    ...(can('accounting.edit') || can('accounting.approve') || can('accounting.delete')
      ? [{
          key: 'act',
          label: t('actions'),
          className: 'text-end',
          render: (r: any) =>
            r.status === 'active' ? (
              <div className="flex justify-end gap-1">
                {can('accounting.edit') && !r.payment_id && (
                  <button
                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-primary-600 dark:hover:bg-slate-800"
                    title={t('edit')}
                    onClick={() => {
                      setEditing(r);
                      setForm({
                        type: r.type, amount: String(r.amount), category_id: r.category_id || '',
                        occurred_at: String(r.occurred_at).slice(0, 10), method: r.method,
                        account_id: r.account_id || '', reference: r.reference || '', notes: r.notes || '',
                      });
                      setFormOpen(true);
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                )}
                {(can('accounting.approve') || can('accounting.delete')) && !r.payment_id && (
                  <button className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30" title={t('void')} onClick={() => setVoidTarget(r)}>
                    <Ban size={15} />
                  </button>
                )}
              </div>
            ) : null,
        }]
      : []),
  ];

  const thisMonth = today().slice(0, 7);
  const isLocked = periods.some((p) => String(p.period).slice(0, 7) === thisMonth);

  return (
    <>
      <PageHeader
        title={t('accounting')}
        subtitle={isLocked ? `${t('locked_hint')}` : undefined}
        actions={
          <>
            {can('accounting.export') && (
              <Button variant="secondary" onClick={() => exportCsv('transactions.csv', rows, { occurred_at: t('date'), type: t('tx_type'), category_name: t('category'), amount: t('amount'), method: t('method'), reference: t('reference') })}>
                {t('export_csv')}
              </Button>
            )}
            {can('accounting.create') && (
              <Button icon={Plus} onClick={() => { setEditing(null); setForm(emptyTx); setFormOpen(true); }}>{t('add_transaction')}</Button>
            )}
          </>
        }
      />

      {/* Account cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {accounts.map((a) => (
          <Card key={a.id} className="p-4">
            <div className="flex items-center gap-2.5">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${a.type === 'cash' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-sky-50 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300'}`}>
                <Vault size={18} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[11px] font-bold text-slate-400">{locale === 'ar' ? a.name_ar || a.name : a.name}</div>
                <div className="truncate font-extrabold text-slate-800 dark:text-slate-100" dir="ltr">{money(a.balance)}</div>
              </div>
            </div>
          </Card>
        ))}
        {can('accounting.create') && (
          <>
            <button onClick={() => setAccOpen(true)} className="flex min-h-16 items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-4 text-xs font-bold text-slate-400 hover:border-primary-400 hover:text-primary-500 dark:border-slate-700">
              <Plus size={14} /> {t('add_account')}
            </button>
            <button onClick={() => setTrOpen(true)} className="flex min-h-16 items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-4 text-xs font-bold text-slate-400 hover:border-primary-400 hover:text-primary-500 dark:border-slate-700">
              <ArrowLeftRight size={14} /> {t('new_transfer')}
            </button>
          </>
        )}
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'tx', label: t('transactions') },
          { key: 'close', label: t('daily_close') },
          { key: 'cats', label: t('categories') },
          { key: 'periods', label: t('locked_periods') },
        ]}
      />

      <div className="mt-4">
        {tab === 'tx' && (
          <Card>
            <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3 dark:border-slate-800">
              <Input placeholder={t('search')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
              <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="!w-auto">
                <option value="">{t('all')}</option>
                <option value="income">{t('income')}</option>
                <option value="expense">{t('expense')}</option>
              </Select>
              <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} dir="ltr" className="!w-auto" />
              <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} dir="ltr" className="!w-auto" />
            </div>
            <DataTable columns={columns} rows={rows} loading={loading} />
            <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
          </Card>
        )}

        {tab === 'close' && closeData && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="mb-4 text-sm font-extrabold text-slate-700 dark:text-slate-200">{t('daily_close')} — {fmtDate(closeData.date)}</h3>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between border-b border-slate-100 pb-2 dark:border-slate-800"><span className="text-slate-400">{t('opening')}</span><b dir="ltr">{money(closeData.opening_balance)}</b></div>
                <div className="flex justify-between border-b border-slate-100 pb-2 dark:border-slate-800"><span className="text-slate-400">{t('total_in')}</span><b dir="ltr" className="text-emerald-600">{money(closeData.total_in)}</b></div>
                <div className="flex justify-between border-b border-slate-100 pb-2 dark:border-slate-800"><span className="text-slate-400">{t('total_out')}</span><b dir="ltr" className="text-rose-600">{money(closeData.total_out)}</b></div>
                <div className="flex justify-between text-base"><span className="text-slate-400">{t('closing')}</span><b dir="ltr">{money(closeData.closing_balance)}</b></div>
              </div>
              {can('accounting.edit') && (
                <div className="mt-5 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                  <Field label={t('counted')} required>
                    <Input type="number" value={counted} onChange={(e) => setCounted(e.target.value)} dir="ltr" />
                  </Field>
                  {counted !== '' && (
                    <div className={`rounded-xl px-4 py-2.5 text-sm font-bold ${Math.abs(Number(counted) - closeData.closing_balance) < 0.005 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                      {t('difference')}: {money(Number(counted) - closeData.closing_balance)}
                    </div>
                  )}
                  <Button
                    onClick={async () => {
                      try {
                        await api.post('/accounting/daily-close', { date: closeData.date, counted_amount: Number(counted), system_closing: closeData.closing_balance });
                        toast(t('saved_ok'));
                        loadClose();
                      } catch (e) { toast(errMsg(e), 'err'); }
                    }}
                  >
                    {t('save_close')}
                  </Button>
                </div>
              )}
            </Card>
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-extrabold text-slate-700 dark:text-slate-200">{t('locked_periods')}</h3>
              <p className="mb-3 text-xs text-slate-400">{t('locked_hint')}</p>
              <div className="flex flex-wrap gap-2">
                {periods.map((p) => (
                  <span key={p.id} className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <Lock size={11} /> {String(p.period).slice(0, 7)}
                    {isAdmin && (
                      <button
                        className="text-rose-500 hover:text-rose-700"
                        onClick={async () => {
                          try { await api.delete(`/accounting/periods/${String(p.period).slice(0, 7)}`); toast(t('saved_ok')); loadAux(); } catch (e) { toast(errMsg(e), 'err'); }
                        }}
                      >
                        <Unlock size={11} />
                      </button>
                    )}
                  </span>
                ))}
                {!periods.length && <span className="text-xs text-slate-400">{t('no_data')}</span>}
              </div>
              {isAdmin && (
                <div className="mt-4 flex items-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                  <Field label={t('lock_month')}>
                    <Input type="month" value={lockMonth} onChange={(e) => setLockMonth(e.target.value)} dir="ltr" />
                  </Field>
                  <Button
                    variant="secondary"
                    icon={Lock}
                    onClick={async () => {
                      try { await api.post('/accounting/periods', { month: lockMonth }); toast(t('saved_ok')); loadAux(); } catch (e) { toast(errMsg(e), 'err'); }
                    }}
                  >
                    {t('lock_month')}
                  </Button>
                </div>
              )}
            </Card>
          </div>
        )}

        {tab === 'cats' && (
          <Card className="p-4">
            {can('accounting.create') && (
              <div className="mb-3 flex justify-end">
                <Button size="sm" icon={Plus} onClick={() => setCatOpen(true)}>{t('add_category')}</Button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {cats.map((c) => (
                <div key={c.id} className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
                  <div className="font-bold text-slate-700 dark:text-slate-200">{locale === 'ar' ? c.name_ar || c.name : c.name}</div>
                  <Badge color={c.kind === 'income' ? 'green' : c.kind === 'expense' ? 'red' : 'slate'}>{t(c.kind === 'both' ? 'all' : c.kind)}</Badge>
                </div>
              ))}
            </div>
          </Card>
        )}

        {tab === 'periods' && (
          <Card className="p-5 text-sm text-slate-500 dark:text-slate-400">
            {t('locked_hint')}
          </Card>
        )}
      </div>

      {/* Transaction form */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? t('edit_transaction') : t('add_transaction')} wide>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('tx_type')} required>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="expense">{t('expense')}</option>
              <option value="income">{t('income')}</option>
            </Select>
          </Field>
          <Field label={t('amount')} required>
            <Input type="number" min={0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} dir="ltr" />
          </Field>
          <Field label={t('tx_category')}>
            <Select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">—</option>
              {cats.filter((c) => c.kind === 'both' || c.kind === form.type).map((c) => (
                <option key={c.id} value={c.id}>{locale === 'ar' ? c.name_ar || c.name : c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('date')} required>
            <Input type="date" value={form.occurred_at} onChange={(e) => setForm({ ...form, occurred_at: e.target.value })} dir="ltr" />
          </Field>
          <Field label={t('method')}>
            <Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              <option value="cash">{t('cash')}</option>
              <option value="transfer">{t('transfer')}</option>
              <option value="other">{t('other')}</option>
            </Select>
          </Field>
          <Field label={t('accounts')}>
            <Select value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
              <option value="">—</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{locale === 'ar' ? a.name_ar || a.name : a.name}</option>)}
            </Select>
          </Field>
          <Field label={t('reference')}>
            <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </Field>
          <Field label={t('attachment')}>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => setAttachment(e.target.files?.[0] || null)}
              className="w-full text-xs text-slate-500 file:me-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-xs file:font-bold file:text-primary-600 dark:file:bg-slate-800 dark:file:text-primary-300"
            />
          </Field>
          <Field label={t('notes')} className="sm:col-span-2">
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setFormOpen(false)}>{t('cancel')}</Button>
          <Button onClick={saveTx}>{t('save')}</Button>
        </div>
      </Modal>

      {/* Account form */}
      <Modal open={accOpen} onClose={() => setAccOpen(false)} title={t('add_account')}>
        <div className="space-y-4">
          <Field label={t('account_name')} required><Input value={accForm.name} onChange={(e) => setAccForm({ ...accForm, name: e.target.value })} /></Field>
          <Field label={t('name_ar')}><Input value={accForm.name_ar} onChange={(e) => setAccForm({ ...accForm, name_ar: e.target.value })} /></Field>
          <Field label={t('tx_type')}>
            <Select value={accForm.type} onChange={(e) => setAccForm({ ...accForm, type: e.target.value })}>
              <option value="cash">{t('cash_box')}</option>
              <option value="bank">{t('bank')}</option>
            </Select>
          </Field>
          <Field label={`${t('opening_balance')}`}><Input type="number" value={accForm.opening_balance} onChange={(e) => setAccForm({ ...accForm, opening_balance: e.target.value })} dir="ltr" /></Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setAccOpen(false)}>{t('cancel')}</Button>
          <Button onClick={async () => {
            try {
              await api.post('/accounting/accounts', { ...accForm, opening_balance: Number(accForm.opening_balance) || 0 });
              toast(t('saved_ok'));
              setAccOpen(false);
              loadAux();
            } catch (e) { toast(errMsg(e), 'err'); }
          }}>{t('save')}</Button>
        </div>
      </Modal>

      {/* Transfer form */}
      <Modal open={trOpen} onClose={() => setTrOpen(false)} title={t('new_transfer')}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('from_account')} required>
              <Select value={trForm.from_account_id} onChange={(e) => setTrForm({ ...trForm, from_account_id: e.target.value })}>
                <option value="">—</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{locale === 'ar' ? a.name_ar || a.name : a.name} ({money(a.balance)})</option>)}
              </Select>
            </Field>
            <Field label={t('to_account')} required>
              <Select value={trForm.to_account_id} onChange={(e) => setTrForm({ ...trForm, to_account_id: e.target.value })}>
                <option value="">—</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{locale === 'ar' ? a.name_ar || a.name : a.name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('amount')} required><Input type="number" value={trForm.amount} onChange={(e) => setTrForm({ ...trForm, amount: e.target.value })} dir="ltr" /></Field>
            <Field label={t('date')} required><Input type="date" value={trForm.occurred_at} onChange={(e) => setTrForm({ ...trForm, occurred_at: e.target.value })} dir="ltr" /></Field>
          </div>
          <Field label={t('notes')}><Input value={trForm.notes} onChange={(e) => setTrForm({ ...trForm, notes: e.target.value })} /></Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setTrOpen(false)}>{t('cancel')}</Button>
          <Button onClick={async () => {
            try {
              await api.post('/accounting/transfers', { ...trForm, amount: Number(trForm.amount) });
              toast(t('saved_ok'));
              setTrOpen(false);
              loadAux();
            } catch (e) { toast(errMsg(e), 'err'); }
          }}>{t('save')}</Button>
        </div>
      </Modal>

      {/* Category form */}
      <Modal open={catOpen} onClose={() => setCatOpen(false)} title={t('add_category')}>
        <div className="space-y-4">
          <Field label={`${t('name')} (EN)`} required><Input value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} /></Field>
          <Field label={t('name_ar')}><Input value={catForm.name_ar} onChange={(e) => setCatForm({ ...catForm, name_ar: e.target.value })} /></Field>
          <Field label={t('tx_type')}>
            <Select value={catForm.kind} onChange={(e) => setCatForm({ ...catForm, kind: e.target.value })}>
              <option value="expense">{t('expense')}</option>
              <option value="income">{t('income')}</option>
              <option value="both">{t('all')}</option>
            </Select>
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCatOpen(false)}>{t('cancel')}</Button>
          <Button onClick={async () => {
            try { await api.post('/accounting/categories', catForm); toast(t('saved_ok')); setCatOpen(false); loadAux(); } catch (e) { toast(errMsg(e), 'err'); }
          }}>{t('save')}</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!voidTarget} onClose={() => setVoidTarget(null)} onConfirm={async (reason) => {
        try { await api.post(`/accounting/${voidTarget.id}/void`, { reason }); toast(t('saved_ok')); load(); loadAux(); } catch (e) { toast(errMsg(e), 'err'); }
      }} title={t('void_confirm')} needReason />
    </>
  );
}
