import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, PackageSearch, ArrowLeftRight, Scale, FolderPlus, Warehouse as WhIcon } from 'lucide-react';
import { api, errMsg, exportCsv } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Badge, Button, Card, ConfirmDialog, DataTable, Field, Input, Modal, PageHeader, Pagination, Select, Tabs, Textarea, Column } from '../../components/ui/kit';
import { money, num, fmtDate } from '../../lib/format';

const emptyItem = {
  name: '', name_ar: '', sku: '', barcode: '', category_id: '', brand: '', model: '',
  cost_price: '', selling_price: '', min_stock_level: 0, warehouse_id: '', track_serials: false,
  initial_quantity: 0, serialsText: '',
};

export default function InventoryPage() {
  const { t, can, toast, locale } = useApp();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('items');
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [cats, setCats] = useState<any[]>([]);
  const [whs, setWhs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(emptyItem);
  const [adjustTarget, setAdjustTarget] = useState<any>(null);
  const [adjust, setAdjust] = useState({ delta: '', reason: '' });
  const [transferOpen, setTransferOpen] = useState(false);
  const [transfer, setTransfer] = useState({ item_id: '', quantity: '', from_warehouse_id: '', to_warehouse_id: '', reason: '' });
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [movements, setMovements] = useState<any[]>([]);
  const [mvSearch, setMvSearch] = useState('');
  const [mvType, setMvType] = useState('');
  const pageSize = 25;

  const loadLookups = useCallback(() => {
    api.get('/categories').then((r) => setCats(r.data)).catch(() => {});
    api.get('/warehouses').then((r) => setWhs(r.data)).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get(`/items?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}${catFilter ? `&category_id=${catFilter}` : ''}${lowOnly ? '&low_stock=true' : ''}`)
      .then((r) => {
        setRows(r.data.rows);
        setTotal(r.data.total);
      })
      .catch((e) => toast(errMsg(e), 'err'))
      .finally(() => setLoading(false));
  }, [page, search, catFilter, lowOnly]);

  const loadMovements = useCallback(() => {
    api.get(`/movements?pageSize=50&search=${encodeURIComponent(mvSearch)}${mvType ? `&movement_type=${mvType}` : ''}`)
      .then((r) => setMovements(r.data.rows))
      .catch(() => {});
  }, [mvSearch, mvType]);

  useEffect(() => {
    const id = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(id);
  }, [load]);
  useEffect(loadLookups, [loadLookups]);
  useEffect(() => {
    if (tab === 'movements') loadMovements();
  }, [tab, loadMovements]);
  useEffect(() => {
    if (params.get('new')) {
      setEditing(null);
      setForm(emptyItem);
      setFormOpen(true);
      setParams({}, { replace: true });
    }
  }, [params]);

  const saveItem = async () => {
    if (form.name.trim().length < 2) return toast(t('required_field'), 'err');
    const body: any = {
      name: form.name.trim(),
      name_ar: form.name_ar || null,
      sku: form.sku || null,
      barcode: form.barcode || null,
      category_id: form.category_id || null,
      brand: form.brand || null,
      model: form.model || null,
      cost_price: Number(form.cost_price) || 0,
      selling_price: Number(form.selling_price) || 0,
      min_stock_level: Number(form.min_stock_level) || 0,
      warehouse_id: form.warehouse_id || null,
      track_serials: form.track_serials,
    };
    try {
      if (editing) {
        await api.patch(`/items/${editing.id}`, body);
      } else {
        body.initial_quantity = Number(form.initial_quantity) || 0;
        body.serials = form.serialsText ? form.serialsText.split('\n').map((s: string) => s.trim()).filter(Boolean) : [];
        await api.post('/items', body);
      }
      toast(t('saved_ok'));
      setFormOpen(false);
      load();
      loadLookups();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  const doAdjust = async () => {
    try {
      await api.post(`/items/${adjustTarget.id}/adjust`, { delta: Number(adjust.delta), reason: adjust.reason });
      toast(t('saved_ok'));
      setAdjustTarget(null);
      setAdjust({ delta: '', reason: '' });
      load();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  const doTransfer = async () => {
    try {
      await api.post('/movements/transfer', {
        item_id: transfer.item_id,
        quantity: Number(transfer.quantity),
        from_warehouse_id: transfer.from_warehouse_id,
        to_warehouse_id: transfer.to_warehouse_id,
        reason: transfer.reason || undefined,
      });
      toast(t('saved_ok'));
      setTransferOpen(false);
      load();
      loadMovements();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  const itemCols: Column<any>[] = [
    {
      key: 'name',
      label: t('item'),
      render: (i) => (
        <div>
          <div className="font-bold text-slate-800 dark:text-slate-100">{locale === 'ar' && i.name_ar ? i.name_ar : i.name}</div>
          <div className="text-xs text-slate-400" dir="ltr">{i.sku} · {i.brand || ''}</div>
        </div>
      ),
    },
    { key: 'category_name', label: t('category'), hideOnMobile: true, render: (i) => (locale === 'ar' ? i.category_name_ar || i.category_name : i.category_name) || '—' },
    {
      key: 'quantity',
      label: t('quantity_in_stock'),
      render: (i) => (
        <Badge color={Number(i.quantity) === 0 ? 'red' : i.low_stock ? 'amber' : 'green'}>
          {num(i.quantity)}
        </Badge>
      ),
    },
    { key: 'cost_price', label: t('cost_price'), hideOnMobile: true, render: (i) => <span dir="ltr">{money(i.cost_price)}</span> },
    { key: 'selling_price', label: t('selling_price'), render: (i) => <span dir="ltr" className="font-bold">{money(i.selling_price)}</span> },
    { key: 'wh', label: t('warehouse'), hideOnMobile: true, render: (i) => (locale === 'ar' ? i.warehouse_name_ar || i.warehouse_name : i.warehouse_name) || '—' },
    ...(can('inventory.edit') || can('inventory.delete')
      ? [{
          key: 'actions',
          label: t('actions'),
          className: 'text-end',
          render: (i: any) => (
            <div className="flex justify-end gap-1">
              {can('inventory.edit') && (
                <>
                  <button className="rounded-lg p-2 text-slate-400 hover:bg-sky-50 hover:text-sky-600 dark:hover:bg-sky-900/30" title={t('adjust_stock')} onClick={() => setAdjustTarget(i)}>
                    <Scale size={15} />
                  </button>
                  <button
                    className="rounded-lg p-2 text-slate-400 hover:bg-violet-50 hover:text-violet-600 dark:hover:bg-violet-900/30"
                    title={t('transfer_stock')}
                    onClick={() => {
                      setTransfer({ item_id: i.id, quantity: '', from_warehouse_id: i.warehouse_id || '', to_warehouse_id: '', reason: '' });
                      setTransferOpen(true);
                    }}
                  >
                    <ArrowLeftRight size={15} />
                  </button>
                  <button
                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-primary-600 dark:hover:bg-slate-800"
                    title={t('edit')}
                    onClick={() => {
                      setEditing(i);
                      setForm({ ...emptyItem, ...i, category_id: i.category_id || '', warehouse_id: i.warehouse_id || '' });
                      setFormOpen(true);
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                </>
              )}
              {can('inventory.delete') && (
                <button className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30" title={t('delete')} onClick={() => setDeleteTarget(i)}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ),
        }]
      : []),
  ];

  const mvCols: Column<any>[] = [
    { key: 'created_at', label: t('date'), render: (m) => fmtDate(m.created_at, true) },
    { key: 'item_name', label: t('item'), render: (m) => (locale === 'ar' ? m.item_name_ar || m.item_name : m.item_name) },
    { key: 'movement_type', label: t('movement_type'), render: (m) => <Badge color={(({ purchase: 'green', assignment: 'blue', return: 'amber', adjustment: 'violet', transfer: 'slate' }) as Record<string, any>)[m.movement_type] || 'slate'}>{t(`mv_${m.movement_type}`)}</Badge> },
    { key: 'quantity', label: t('quantity'), render: (m) => <span className={m.quantity >= 0 ? 'font-bold text-emerald-600' : 'font-bold text-rose-600'} dir="ltr">{m.quantity >= 0 ? '+' : ''}{num(m.quantity)}</span> },
    { key: 'reason', label: t('reason'), hideOnMobile: true, render: (m) => <span className="text-xs text-slate-400">{m.reason || '—'}</span> },
    { key: 'performed_by_name', label: t('who_why'), hideOnMobile: true, render: (m) => m.performed_by_name || '—' },
  ];

  return (
    <>
      <PageHeader
        title={t('inventory')}
        subtitle={`${total} ${locale === 'ar' ? 'صنف' : 'items'}`}
        actions={
          <>
            {can('inventory.export') && (
              <Button variant="secondary" onClick={() => exportCsv('inventory.csv', rows, { name: t('name'), sku: t('sku'), quantity: t('quantity'), cost_price: t('cost_price'), selling_price: t('selling_price') })}>
                {t('export_csv')}
              </Button>
            )}
            {can('inventory.edit') && (
              <Button variant="secondary" icon={ArrowLeftRight} onClick={() => { setTransfer({ item_id: '', quantity: '', from_warehouse_id: '', to_warehouse_id: '', reason: '' }); setTransferOpen(true); }}>
                {t('transfer_stock')}
              </Button>
            )}
            {can('inventory.create') && (
              <Button icon={Plus} onClick={() => { setEditing(null); setForm(emptyItem); setFormOpen(true); }}>{t('add_item')}</Button>
            )}
          </>
        }
      />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'items', label: t('items') },
          { key: 'movements', label: t('movements') },
          { key: 'cats', label: t('categories') },
          { key: 'whs', label: t('warehouses') },
        ]}
      />

      <div className="mt-4">
        {tab === 'items' && (
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3 dark:border-slate-800">
              <Input placeholder={`${t('search')} (${locale === 'ar' ? 'اسم / باركود / تسلسل' : 'name / barcode / serial'})`} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
              <select value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setPage(1); }} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">{t('all')}</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{locale === 'ar' ? c.name_ar || c.name : c.name}</option>)}
              </select>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-300">
                <input type="checkbox" checked={lowOnly} onChange={(e) => { setLowOnly(e.target.checked); setPage(1); }} className="h-4 w-4 accent-primary-600" />
                {t('low_stock')}
              </label>
            </div>
            <DataTable columns={itemCols} rows={rows} loading={loading} />
            <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
          </Card>
        )}

        {tab === 'movements' && (
          <Card>
            <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3 dark:border-slate-800">
              <Input placeholder={t('search')} value={mvSearch} onChange={(e) => setMvSearch(e.target.value)} className="max-w-xs" />
              <select value={mvType} onChange={(e) => setMvType(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                <option value="">{t('all')}</option>
                {['purchase', 'assignment', 'return', 'adjustment', 'transfer'].map((m) => <option key={m} value={m}>{t(`mv_${m}`)}</option>)}
              </select>
              {can('inventory.export') && (
                <Button size="sm" variant="secondary" className="ms-auto" onClick={() => exportCsv('movements.csv', movements, { created_at: t('date'), item_name: t('item'), movement_type: t('movement_type'), quantity: t('quantity'), reason: t('reason') })}>
                  {t('export_csv')}
                </Button>
              )}
            </div>
            <DataTable columns={mvCols} rows={movements} />
          </Card>
        )}

        {tab === 'cats' && <CategoriesTab cats={cats} reload={loadLookups} />}
        {tab === 'whs' && <WarehousesTab whs={whs} reload={loadLookups} />}
      </div>

      {/* Item form */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? t('edit_item') : t('add_item')} wide>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={`${t('name')} (EN)`} required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={t('name_ar')}><Input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></Field>
          <Field label={t('sku')}><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} dir="ltr" /></Field>
          <Field label={t('barcode')}><Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} dir="ltr" /></Field>
          <Field label={t('category')}>
            <Select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">—</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{locale === 'ar' ? c.name_ar || c.name : c.name}</option>)}
            </Select>
          </Field>
          <Field label={t('warehouse')}>
            <Select value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}>
              <option value="">—</option>
              {whs.map((w) => <option key={w.id} value={w.id}>{locale === 'ar' ? w.name_ar || w.name : w.name}</option>)}
            </Select>
          </Field>
          <Field label={t('brand')}><Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
          <Field label={t('model')}><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></Field>
          <Field label={t('cost_price')} required><Input type="number" min={0} value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} dir="ltr" /></Field>
          <Field label={t('selling_price')} required><Input type="number" min={0} value={form.selling_price} onChange={(e) => setForm({ ...form, selling_price: e.target.value })} dir="ltr" /></Field>
          <Field label={t('min_stock')}><Input type="number" min={0} value={form.min_stock_level} onChange={(e) => setForm({ ...form, min_stock_level: e.target.value })} dir="ltr" /></Field>
          {!editing && (
            <Field label={t('initial_stock')}><Input type="number" min={0} value={form.initial_quantity} onChange={(e) => setForm({ ...form, initial_quantity: e.target.value })} dir="ltr" /></Field>
          )}
          <Field className="sm:col-span-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={form.track_serials} onChange={(e) => setForm({ ...form, track_serials: e.target.checked })} className="h-4 w-4 accent-primary-600" />
              {t('track_serials')}
            </label>
          </Field>
          {!editing && form.track_serials && (
            <Field label={t('serial_numbers')} hint={t('serials_help')} className="sm:col-span-2">
              <Textarea rows={4} value={form.serialsText} onChange={(e) => setForm({ ...form, serialsText: e.target.value })} className="font-mono" dir="ltr" />
            </Field>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setFormOpen(false)}>{t('cancel')}</Button>
          <Button onClick={saveItem}>{t('save')}</Button>
        </div>
      </Modal>

      {/* Adjust */}
      <Modal open={!!adjustTarget} onClose={() => setAdjustTarget(null)} title={`${t('adjust_stock')} — ${adjustTarget?.name || ''}`}>
        <div className="space-y-4">
          <Field label={`${t('quantity_in_stock')}: ${num(adjustTarget?.quantity)}`} />
          <Field label={`${t('adjust_stock')} (+/-)`} required>
            <Input type="number" value={adjust.delta} onChange={(e) => setAdjust({ ...adjust, delta: e.target.value })} dir="ltr" />
          </Field>
          <Field label={t('adjustment_reason')} required>
            <Textarea value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} rows={2} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setAdjustTarget(null)}>{t('cancel')}</Button>
          <Button onClick={doAdjust}>{t('save')}</Button>
        </div>
      </Modal>

      {/* Transfer */}
      <Modal open={transferOpen} onClose={() => setTransferOpen(false)} title={t('transfer_stock')}>
        <div className="space-y-4">
          <Field label={t('item')} required>
            <Select value={transfer.item_id} onChange={(e) => setTransfer({ ...transfer, item_id: e.target.value })}>
              <option value="">—</option>
              {rows.map((i) => <option key={i.id} value={i.id}>{locale === 'ar' ? i.name_ar || i.name : i.name} ({num(i.quantity)})</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('from_account')} required>
              <Select value={transfer.from_warehouse_id} onChange={(e) => setTransfer({ ...transfer, from_warehouse_id: e.target.value })}>
                <option value="">—</option>
                {whs.map((w) => <option key={w.id} value={w.id}>{w.name_ar || w.name}</option>)}
              </Select>
            </Field>
            <Field label={t('to_account')} required>
              <Select value={transfer.to_warehouse_id} onChange={(e) => setTransfer({ ...transfer, to_warehouse_id: e.target.value })}>
                <option value="">—</option>
                {whs.map((w) => <option key={w.id} value={w.id}>{w.name_ar || w.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label={t('quantity')} required><Input type="number" min={1} value={transfer.quantity} onChange={(e) => setTransfer({ ...transfer, quantity: e.target.value })} dir="ltr" /></Field>
          <Field label={t('reason')}><Input value={transfer.reason} onChange={(e) => setTransfer({ ...transfer, reason: e.target.value })} /></Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setTransferOpen(false)}>{t('cancel')}</Button>
          <Button onClick={doTransfer}>{t('save')}</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={async () => {
        try { await api.delete(`/items/${deleteTarget.id}`); toast(t('saved_ok')); load(); } catch (e) { toast(errMsg(e), 'err'); }
      }} title={t('delete_confirm')} message={deleteTarget?.name} />
    </>
  );
}

function CategoriesTab({ cats, reload }: { cats: any[]; reload: () => void }) {
  const { t, can, toast, locale } = useApp();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', name_ar: '', description: '' });
  const [delTarget, setDelTarget] = useState<any>(null);

  const save = async () => {
    try {
      await api.post('/categories', form);
      toast(t('saved_ok'));
      setOpen(false);
      setForm({ name: '', name_ar: '', description: '' });
      reload();
    } catch (e) { toast(errMsg(e), 'err'); }
  };

  return (
    <Card className="p-4">
      {can('inventory.create') && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" icon={FolderPlus} onClick={() => setOpen(true)}>{t('add_category')}</Button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cats.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 p-3.5 dark:border-slate-700">
            <div>
              <div className="font-bold text-slate-800 dark:text-slate-100">{locale === 'ar' ? c.name_ar || c.name : c.name}</div>
              <div className="text-xs text-slate-400">{c.items_count} {locale === 'ar' ? 'صنف' : 'items'}</div>
            </div>
            {can('inventory.delete') && Number(c.items_count) === 0 && (
              <button className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30" onClick={() => setDelTarget(c)}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
        {!cats.length && <div className="col-span-full py-8 text-center text-sm text-slate-400">{t('no_data')}</div>}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={t('add_category')}>
        <div className="space-y-4">
          <Field label={`${t('name')} (EN)`} required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={t('name_ar')}><Input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></Field>
          <Field label={t('notes')}><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>{t('cancel')}</Button>
          <Button onClick={save}>{t('save')}</Button>
        </div>
      </Modal>
      <ConfirmDialog open={!!delTarget} onClose={() => setDelTarget(null)} onConfirm={async () => {
        try { await api.delete(`/categories/${delTarget.id}`); toast(t('saved_ok')); reload(); } catch (e) { toast(errMsg(e), 'err'); }
      }} title={t('delete_confirm')} message={delTarget?.name} />
    </Card>
  );
}

function WarehousesTab({ whs, reload }: { whs: any[]; reload: () => void }) {
  const { t, can, toast, locale } = useApp();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', name_ar: '', location: '' });
  const [delTarget, setDelTarget] = useState<any>(null);

  const save = async () => {
    try {
      await api.post('/warehouses', form);
      toast(t('saved_ok'));
      setOpen(false);
      setForm({ name: '', name_ar: '', location: '' });
      reload();
    } catch (e) { toast(errMsg(e), 'err'); }
  };

  return (
    <Card className="p-4">
      {can('inventory.create') && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" icon={WhIcon} onClick={() => setOpen(true)}>{t('add_warehouse')}</Button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {whs.map((w) => (
          <div key={w.id} className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 p-3.5 dark:border-slate-700">
            <div>
              <div className="font-bold text-slate-800 dark:text-slate-100">
                {locale === 'ar' ? w.name_ar || w.name : w.name}
                {w.is_default && <Badge color="blue">{locale === 'ar' ? 'افتراضي' : 'default'}</Badge>}
              </div>
              <div className="text-xs text-slate-400">{w.location || '—'} · {num(w.total_quantity)} {locale === 'ar' ? 'وحدة' : 'units'}</div>
            </div>
            {can('inventory.delete') && !w.is_default && Number(w.total_quantity) === 0 && (
              <button className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30" onClick={() => setDelTarget(w)}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={t('add_warehouse')}>
        <div className="space-y-4">
          <Field label={`${t('name')} (EN)`} required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={t('name_ar')}><Input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></Field>
          <Field label={t('location')}><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>{t('cancel')}</Button>
          <Button onClick={save}>{t('save')}</Button>
        </div>
      </Modal>
      <ConfirmDialog open={!!delTarget} onClose={() => setDelTarget(null)} onConfirm={async () => {
        try { await api.delete(`/warehouses/${delTarget.id}`); toast(t('saved_ok')); reload(); } catch (e) { toast(errMsg(e), 'err'); }
      }} title={t('delete_confirm')} message={delTarget?.name} />
    </Card>
  );
}
