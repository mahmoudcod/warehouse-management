import React, { useCallback, useEffect, useState } from 'react';
import { Ban, Banknote, PackageCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, errMsg, exportCsv } from '../../api/client';
import { useApp } from '../../context/AppContext';
import {
  Badge, Button, Card, Column, ConfirmDialog, DataTable, Field, Input, Modal, PageHeader, Pagination, Select, Tabs, Textarea,
} from '../../components/ui/kit';
import { money, num, fmtDate, today } from '../../lib/format';
import { ItemSelect } from '../shared/forms';

const PO_STATUS_COLORS: Record<string, 'green' | 'red' | 'amber' | 'slate'> = {
  draft: 'slate',
  received: 'green',
  partial: 'amber',
  cancelled: 'red',
};

const emptySupplier = { name: '', phone: '', contact_person: '', address: '', notes: '' };
const emptyPoLine = { item_id: '', item_text: '', quantity: '', unit_cost: '' };

export default function SuppliersPage() {
  const { t, can, toast, locale } = useApp();
  const [tab, setTab] = useState('suppliers');

  // suppliers list
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  // purchase orders
  const [pos, setPos] = useState<any[]>([]);
  const [posLoading, setPosLoading] = useState(true);
  const [poStatus, setPoStatus] = useState('');

  // supplier add/edit form
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(emptySupplier);

  // modals / targets
  const [payTarget, setPayTarget] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [profileKey, setProfileKey] = useState(0);
  const [receiveTarget, setReceiveTarget] = useState<any>(null);
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const [newPoOpen, setNewPoOpen] = useState(false);
  const pageSize = 25;

  const canPay = can('suppliers.create') || can('suppliers.approve');
  const canReceive = can('suppliers.approve') || can('suppliers.edit');
  const canCancelPo = can('suppliers.approve') || can('suppliers.delete');

  const load = useCallback(() => {
    setLoading(true);
    api
      .get(`/suppliers?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}${statusFilter ? `&status=${statusFilter}` : ''}`)
      .then((r) => {
        setRows(r.data.rows);
        setTotal(r.data.total);
      })
      .catch((e) => toast(errMsg(e), 'err'))
      .finally(() => setLoading(false));
  }, [page, search, statusFilter]);

  const loadPos = useCallback(() => {
    setPosLoading(true);
    api
      .get(`/suppliers/orders${poStatus ? `?status=${poStatus}` : ''}`)
      .then((r) => setPos(r.data.rows))
      .catch((e) => toast(errMsg(e), 'err'))
      .finally(() => setPosLoading(false));
  }, [poStatus]);

  useEffect(() => {
    const id = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(id);
  }, [load]);

  useEffect(() => {
    if (tab === 'pos') loadPos();
  }, [tab, loadPos]);

  /** Refresh everything after a mutation (lists + open profile). */
  const afterMutate = useCallback(() => {
    load();
    loadPos();
    setProfileKey((k) => k + 1);
  }, [load, loadPos]);

  const saveSupplier = async () => {
    if (form.name.trim().length < 2) return toast(t('required_field'), 'err');
    const body = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      contact_person: form.contact_person.trim() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
    };
    try {
      if (editing) await api.patch(`/suppliers/${editing.id}`, body);
      else await api.post('/suppliers', body);
      toast(t('saved_ok'));
      setFormOpen(false);
      afterMutate();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  const supCols: Column<any>[] = [
    {
      key: 'name',
      label: t('name'),
      render: (s) => (
        <div>
          <div className="font-bold text-slate-800 dark:text-slate-100">{s.name}</div>
          <div className="text-xs text-slate-400" dir="ltr">{s.phone || ''}</div>
        </div>
      ),
    },
    { key: 'contact_person', label: t('contact_person'), hideOnMobile: true, render: (s) => s.contact_person || '—' },
    {
      key: 'balance',
      label: t('payable'),
      render: (s) => (
        <Badge color={Number(s.balance) > 0 ? 'red' : 'green'}>
          <span dir="ltr">{money(s.balance)}</span>
        </Badge>
      ),
    },
    { key: 'pos_count', label: t('purchase_orders'), hideOnMobile: true, render: (s) => <span dir="ltr">{num(s.pos_count)}</span> },
    { key: 'is_active', label: t('status'), render: (s) => <Badge color={s.is_active ? 'green' : 'slate'}>{s.is_active ? t('active') : t('inactive')}</Badge> },
    ...((canPay || can('suppliers.edit') || can('suppliers.delete'))
      ? [{
          key: 'act',
          label: t('actions'),
          className: 'text-end',
          render: (s: any) => (
            <div className="flex justify-end gap-1">
              {canPay && (
                <button
                  className="rounded-lg p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/30"
                  title={t('pay_supplier')}
                  onClick={(e) => { e.stopPropagation(); setPayTarget(s); }}
                >
                  <Banknote size={15} />
                </button>
              )}
              {can('suppliers.edit') && (
                <button
                  className="rounded-lg p-2 text-slate-400 hover:bg-sky-50 hover:text-sky-600 dark:hover:bg-sky-900/30"
                  title={t('edit')}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(s);
                    setForm({ name: s.name || '', phone: s.phone || '', contact_person: s.contact_person || '', address: s.address || '', notes: s.notes || '' });
                    setFormOpen(true);
                  }}
                >
                  <Pencil size={15} />
                </button>
              )}
              {can('suppliers.delete') && (
                <button
                  className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30"
                  title={t('delete')}
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(s); }}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ),
        }]
      : []),
  ];

  const poCols: Column<any>[] = [
    { key: 'supplier_name', label: t('supplier'), render: (o) => <span className="font-bold text-slate-800 dark:text-slate-100">{o.supplier_name}</span> },
    { key: 'status', label: t('status'), render: (o) => <Badge color={PO_STATUS_COLORS[o.status] || 'slate'}>{t(`po_status_${o.status}`)}</Badge> },
    { key: 'lines', label: t('po_lines'), render: (o) => <span dir="ltr">{num((o.items || []).length)}</span> },
    { key: 'total', label: t('total'), render: (o) => <span dir="ltr" className="font-extrabold">{money(o.total)}</span> },
    { key: 'expected_at', label: t('expected_date'), hideOnMobile: true, render: (o) => fmtDate(o.expected_at) },
    ...((canReceive || canCancelPo)
      ? [{
          key: 'act',
          label: t('actions'),
          className: 'text-end',
          render: (o: any) => (
            <div className="flex justify-end gap-1">
              {canReceive && (o.status === 'draft' || o.status === 'partial') && (
                <button
                  className="rounded-lg p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/30"
                  title={t('receive_po')}
                  onClick={() => setReceiveTarget(o)}
                >
                  <PackageCheck size={15} />
                </button>
              )}
              {canCancelPo && (o.status === 'draft' || o.status === 'partial') && (
                <button
                  className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30"
                  title={t('cancel_po')}
                  onClick={() => setCancelTarget(o)}
                >
                  <Ban size={15} />
                </button>
              )}
            </div>
          ),
        }]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t('nav_suppliers')}
        subtitle={`${total} ${locale === 'ar' ? 'مورد' : 'suppliers'}`}
        actions={
          <div className="flex gap-2">
            {can('suppliers.export') && (
              <Button
                variant="secondary"
                onClick={() => exportCsv('suppliers.csv', rows, { name: t('name'), phone: t('phone'), contact_person: t('contact_person'), balance: t('payable'), pos_count: t('purchase_orders'), is_active: t('status'), created_at: t('date') })}
              >
                {t('export_csv')}
              </Button>
            )}
            {can('suppliers.create') && (
              <Button variant="secondary" onClick={() => setNewPoOpen(true)}>
                {t('new_po')}
              </Button>
            )}
            {can('suppliers.create') && (
              <Button icon={Plus} onClick={() => { setEditing(null); setForm(emptySupplier); setFormOpen(true); }}>
                {t('add_supplier')}
              </Button>
            )}
          </div>
        }
      />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'suppliers', label: t('suppliers') },
          { key: 'pos', label: t('purchase_orders') },
        ]}
      />

      <div className="mt-4">
        {tab === 'suppliers' && (
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3 dark:border-slate-800">
              <Input placeholder={t('search')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
              <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="!w-auto">
                <option value="">{t('all')}</option>
                <option value="active">{t('active')}</option>
                <option value="inactive">{t('inactive')}</option>
              </Select>
            </div>
            <DataTable columns={supCols} rows={rows} loading={loading} onRowClick={(s) => setProfile(s)} />
            <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
          </Card>
        )}

        {tab === 'pos' && (
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3 dark:border-slate-800">
              <Select value={poStatus} onChange={(e) => setPoStatus(e.target.value)} className="!w-auto">
                <option value="">{t('all')}</option>
                <option value="draft">{t('po_status_draft')}</option>
                <option value="received">{t('po_status_received')}</option>
                <option value="partial">{t('po_status_partial')}</option>
                <option value="cancelled">{t('po_status_cancelled')}</option>
              </Select>
            </div>
            <DataTable columns={poCols} rows={pos} loading={posLoading} />
          </Card>
        )}
      </div>

      {/* supplier add/edit */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? t('edit_supplier') : t('add_supplier')}>
        <div className="space-y-4">
          <Field label={t('name')} required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('phone')}>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
            </Field>
            <Field label={t('contact_person')}>
              <Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
            </Field>
          </div>
          <Field label={t('address')}>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <Field label={t('notes')}>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setFormOpen(false)}>{t('cancel')}</Button>
          <Button onClick={saveSupplier}>{t('save')}</Button>
        </div>
      </Modal>

      {payTarget && <PaySupplierModal supplier={payTarget} onClose={() => setPayTarget(null)} onSaved={() => afterMutate()} />}

      {profile && <ProfileModal supplier={profile} refreshKey={profileKey} onClose={() => setProfile(null)} />}

      <NewPoModal open={newPoOpen} onClose={() => setNewPoOpen(false)} onSaved={afterMutate} />

      {receiveTarget && <ReceiveModal po={receiveTarget} onClose={() => setReceiveTarget(null)} onSaved={afterMutate} />}

      {/* cancel PO */}
      <ConfirmDialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={async (reason) => {
          try {
            await api.post(`/suppliers/orders/${cancelTarget.id}/cancel`, { reason });
            toast(t('saved_ok'));
            afterMutate();
          } catch (e) {
            toast(errMsg(e), 'err');
          }
        }}
        title={t('cancel_po')}
        message={`${cancelTarget?.supplier_name || ''} — ${money(cancelTarget?.total)}`}
        needReason
      />

      {/* delete supplier */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          try {
            await api.delete(`/suppliers/${deleteTarget.id}`);
            toast(t('saved_ok'));
            load();
          } catch (e) {
            toast(errMsg(e), 'err');
          }
        }}
        title={t('delete_confirm')}
        message={deleteTarget?.name}
      />
    </>
  );
}

/** Pay a supplier — prefilled with its payable balance; creates an accounting expense too. */
function PaySupplierModal({ supplier, onClose, onSaved }: { supplier: any; onClose: () => void; onSaved?: (newBalance?: number) => void }) {
  const { t, toast } = useApp();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState(today());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (supplier) {
      setAmount(Number(supplier.balance) > 0 ? String(supplier.balance) : '');
      setMethod('cash');
      setDate(today());
      setReference('');
      setNotes('');
    }
  }, [supplier]);

  const submit = async () => {
    if (!Number(amount)) {
      toast(t('required_field'), 'err');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post(`/suppliers/${supplier.id}/payments`, {
        amount: Number(amount),
        method,
        paid_at: date,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      });
      toast(`${t('saved_ok')} — ${t('balance')}: ${money(r.data?.balance ?? 0)}`);
      onSaved?.(r.data?.balance);
      onClose();
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`${t('pay_supplier')} — ${supplier.name}`}>
      <div className="space-y-4">
        <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">
          {t('payable')}: <span dir="ltr">{money(supplier.balance)}</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('amount')} required>
            <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} dir="ltr" />
          </Field>
          <Field label={t('method')} required>
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">{t('cash')}</option>
              <option value="transfer">{t('transfer')}</option>
              <option value="other">{t('other')}</option>
            </Select>
          </Field>
        </div>
        <Field label={t('date')} required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('reference')}>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('notes')}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="success" onClick={submit} disabled={busy}>{busy ? t('loading') : t('save')}</Button>
      </div>
    </Modal>
  );
}

/** Supplier profile: balance card + its POs and payments. */
function ProfileModal({ supplier, refreshKey, onClose }: { supplier: any; refreshKey: number; onClose: () => void }) {
  const { t } = useApp();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pos');

  const load = useCallback(() => {
    if (!supplier?.id) return;
    setLoading(true);
    api
      .get(`/suppliers/${supplier.id}`)
      .then((r) => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [supplier?.id]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const s = data ?? supplier;

  const poCols: Column<any>[] = [
    { key: 'status', label: t('status'), render: (o) => <Badge color={PO_STATUS_COLORS[o.status] || 'slate'}>{t(`po_status_${o.status}`)}</Badge> },
    { key: 'lines', label: t('po_lines'), render: (o) => <span dir="ltr">{num((o.items || []).length)}</span> },
    { key: 'total', label: t('total'), render: (o) => <span dir="ltr" className="font-bold">{money(o.total)}</span> },
    { key: 'expected_at', label: t('expected_date'), hideOnMobile: true, render: (o) => fmtDate(o.expected_at) },
    { key: 'created_at', label: t('date'), hideOnMobile: true, render: (o) => fmtDate(o.created_at) },
  ];

  const payCols: Column<any>[] = [
    { key: 'paid_at', label: t('date'), render: (p) => fmtDate(p.paid_at) },
    { key: 'amount', label: t('amount'), render: (p) => <span dir="ltr" className="font-extrabold text-rose-600 dark:text-rose-400">{money(p.amount)}</span> },
    { key: 'method', label: t('method'), render: (p) => t(p.method) },
    { key: 'reference', label: t('reference'), hideOnMobile: true, render: (p) => p.reference || '—' },
    { key: 'notes', label: t('notes'), hideOnMobile: true, render: (p) => p.notes || '—' },
  ];

  return (
    <Modal open onClose={onClose} title={s?.name || ''} wide>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        {s?.phone && <span dir="ltr">{s.phone}</span>}
        {s?.contact_person && <span>{t('contact_person')}: {s.contact_person}</span>}
        {s?.address && <span>{t('address')}: {s.address}</span>}
      </div>
      {s?.notes && (
        <div className="mb-3 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-300">{s.notes}</div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-rose-50 p-3.5 dark:bg-rose-900/20">
          <div className="text-xs font-bold text-rose-500/80">{t('payable')}</div>
          <div className={`mt-1 text-lg font-extrabold ${Number(s?.balance) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            <span dir="ltr">{money(s?.balance)}</span>
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3.5 dark:bg-slate-800/60">
          <div className="text-xs font-bold text-slate-400">{t('purchase_orders')}</div>
          <div className="mt-1 text-lg font-extrabold text-slate-800 dark:text-slate-100"><span dir="ltr">{num(data?.orders?.length ?? 0)}</span></div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3.5 dark:bg-slate-800/60">
          <div className="text-xs font-bold text-slate-400">{t('status')}</div>
          <div className="mt-1.5">
            <Badge color={s?.is_active ? 'green' : 'slate'}>{s?.is_active ? t('active') : t('inactive')}</Badge>
          </div>
        </div>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'pos', label: t('purchase_orders') },
          { key: 'pays', label: t('supplier_payments') },
        ]}
      />
      <div className="mt-3">
        {tab === 'pos' && <DataTable columns={poCols} rows={data?.orders || []} loading={loading} />}
        {tab === 'pays' && <DataTable columns={payCols} rows={data?.payments || []} loading={loading} />}
      </div>
    </Modal>
  );
}

/** New purchase order: catalog items (cost auto-filled) or free-text lines. */
function NewPoModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: () => void }) {
  const { t, toast, locale } = useApp();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState<any[]>([{ ...emptyPoLine }]);
  const [expected, setExpected] = useState(today());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSupplierId('');
    setLines([{ ...emptyPoLine }]);
    setExpected(today());
    setNotes('');
    api.get('/suppliers?pageSize=100').then((r) => setSuppliers(r.data.rows)).catch(() => {});
  }, [open]);

  const setLine = (i: number, patch: any) => setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const pickItem = (i: number, id: string) => {
    setLine(i, { item_id: id });
    if (id) {
      api.get(`/items/${id}`).then((r) => {
        const cost = r.data?.cost_price;
        setLine(i, { unit_cost: cost != null && cost !== '' ? String(cost) : '' });
      }).catch(() => {});
    }
  };

  const poTotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0);

  const submit = async () => {
    if (!supplierId) {
      toast(locale === 'ar' ? 'اختر المورد' : 'Pick a supplier', 'err');
      return;
    }
    const items = lines
      .filter((l) => (l.item_id || l.item_text.trim()) && Number(l.quantity) > 0)
      .map((l) => ({
        item_id: l.item_id ? Number(l.item_id) : null,
        item_text: l.item_id ? null : l.item_text.trim(),
        quantity: Number(l.quantity),
        unit_cost: Number(l.unit_cost) || 0,
      }));
    if (!items.length) {
      toast(locale === 'ar' ? 'أضف بنداً واحداً على الأقل مع كمية' : 'Add at least one line with a quantity', 'err');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/suppliers/${supplierId}/orders`, { items, expected_at: expected || null, notes: notes.trim() || null });
      toast(t('saved_ok'));
      onSaved?.();
      onClose();
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('new_po')} wide>
      <div className="space-y-4">
        <Field label={t('supplier')} required>
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>

        <div>
          <div className="mb-2 text-xs font-extrabold text-slate-500 dark:text-slate-300">{t('po_lines')}</div>
          <div className="space-y-3">
            {lines.map((l, i) => (
              <div key={i} className="rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={t('pick_item')}>
                    <ItemSelect value={l.item_id} onChange={(id) => pickItem(i, id)} />
                  </Field>
                  <Field
                    label={t('free_text_item')}
                    hint={l.item_id ? undefined : locale === 'ar' ? 'سيتم استخدامه إن لم تختر صنفاً من المخزون' : 'Used if no inventory item is picked'}
                  >
                    <Input value={l.item_text} onChange={(e) => setLine(i, { item_text: e.target.value })} disabled={!!l.item_id} />
                  </Field>
                  <Field label={t('quantity')} required>
                    <Input type="number" min={1} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} dir="ltr" />
                  </Field>
                  <Field label={t('unit_cost')}>
                    <Input type="number" min={0} step="0.01" value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value })} dir="ltr" />
                  </Field>
                </div>
                {lines.length > 1 && (
                  <button
                    type="button"
                    className="mt-2 flex items-center gap-1 text-xs font-bold text-rose-500 hover:underline"
                    onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 size={13} /> {t('delete')}
                  </button>
                )}
              </div>
            ))}
          </div>
          <Button size="sm" variant="secondary" icon={Plus} className="mt-3" onClick={() => setLines((prev) => [...prev, { ...emptyPoLine }])}>
            {t('add_line')}
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('expected_date')}>
            <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} dir="ltr" />
          </Field>
          <Field label={t('notes')}>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="text-sm font-bold text-slate-500 dark:text-slate-300">
          {t('total')}: <span dir="ltr" className="text-base font-extrabold text-slate-900 dark:text-slate-50">{money(poTotal)}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
          <Button onClick={submit} disabled={busy}>{busy ? t('loading') : t('save')}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Receive PO lines: qty defaults to remaining; optional serials per line. */
function ReceiveModal({ po, onClose, onSaved }: { po: any; onClose: () => void; onSaved?: () => void }) {
  const { t, toast, locale } = useApp();
  const [lines, setLines] = useState<{ received: string; serials: string }[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!po) return;
    setLines((po.items || []).map((li: any) => ({
      received: String(Math.max(0, Number(li.quantity) - Number(li.received_qty || 0))),
      serials: '',
    })));
    // resolve catalog item names for line labels
    const ids: string[] = Array.from(new Set((po.items || []).filter((li: any) => li.item_id).map((li: any) => String(li.item_id))));
    ids.forEach((id) => {
      api.get(`/items/${id}`)
        .then((r) => setLabels((prev) => ({ ...prev, [id]: locale === 'ar' && r.data?.name_ar ? r.data.name_ar : r.data?.name || `#${id}` })))
        .catch(() => {});
    });
  }, [po]);

  const setLineVal = (i: number, key: 'received' | 'serials', v: string) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [key]: v } : l)));

  const submit = async () => {
    const payload: { index: number; received_qty: number; serials?: string[] }[] = [];
    for (let i = 0; i < (po.items || []).length; i++) {
      const n = Number(lines[i]?.received) || 0;
      if (n <= 0) continue;
      const remaining = Math.max(0, Number(po.items[i].quantity) - Number(po.items[i].received_qty || 0));
      if (n > remaining) {
        toast(locale === 'ar' ? `الكمية المستلمة أكبر من المتبقي في السطر ${i + 1}` : `Received qty exceeds remaining on line ${i + 1}`, 'err');
        return;
      }
      const serials = (lines[i]?.serials || '').split('\n').map((x) => x.trim()).filter(Boolean);
      payload.push(serials.length ? { index: i, received_qty: n, serials } : { index: i, received_qty: n });
    }
    if (!payload.length) {
      toast(locale === 'ar' ? 'أدخل كمية الاستلام لسطر واحد على الأقل' : 'Enter a received quantity for at least one line', 'err');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/suppliers/orders/${po.id}/receive`, { lines: payload });
      toast(t('saved_ok'));
      onSaved?.();
      onClose();
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`${t('receive_po')} — ${po.supplier_name}`} wide>
      <div className="space-y-3">
        {(po.items || []).map((li: any, i: number) => {
          const remaining = Math.max(0, Number(li.quantity) - Number(li.received_qty || 0));
          return (
            <div key={i} className="rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-100">
                    {li.item_text || labels[String(li.item_id)] || (li.item_id ? `#${li.item_id}` : '—')}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {t('quantity')}: <span dir="ltr">{num(li.quantity)}</span> · {t('received_qty')}: <span dir="ltr">{num(li.received_qty)}</span> · {t('remaining')}: <span dir="ltr">{num(remaining)}</span>
                  </div>
                </div>
                <span dir="ltr" className="shrink-0 text-xs font-bold text-slate-400">{money(li.quantity * li.unit_cost)}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t('received_qty')}>
                  <Input type="number" min={0} max={remaining} value={lines[i]?.received ?? ''} onChange={(e) => setLineVal(i, 'received', e.target.value)} dir="ltr" />
                </Field>
                <Field label={t('serial_numbers')} hint={t('receive_serials_hint')}>
                  <Textarea rows={2} value={lines[i]?.serials ?? ''} onChange={(e) => setLineVal(i, 'serials', e.target.value)} className="font-mono" dir="ltr" />
                </Field>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
        <Button onClick={submit} disabled={busy}>{busy ? t('loading') : t('save')}</Button>
      </div>
    </Modal>
  );
}
