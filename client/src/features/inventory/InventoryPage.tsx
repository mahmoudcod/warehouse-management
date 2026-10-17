import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, PackageSearch, ArrowLeftRight, Scale, FolderPlus, Warehouse as WhIcon, Boxes, Ban, Upload } from 'lucide-react';
import { api, errMsg, exportCsv } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Badge, Button, Card, ConfirmDialog, DataTable, Field, Input, Modal, PageHeader, Pagination, Select, Tabs, Textarea, Column } from '../../components/ui/kit';
import { money, num, fmtDate } from '../../lib/format';
import ImportWizard from '../shared/ImportWizard';

const emptyItem = {
  name: '', name_ar: '', sku: '', barcode: '', category_id: '', brand: '', model: '',
  cost_price: '', selling_price: '', min_stock_level: 0, max_stock_level: 0, warehouse_id: '', track_serials: false,
  initial_quantity: 0, serialsText: '',
};

/* Serialized-unit status → badge color / label (labels use existing keys). */
const unitStatusColor: Record<string, any> = { in_stock: 'green', assigned: 'blue', returned: 'amber', void: 'slate' };
function unitStatusText(status: string, t: (k: string) => string): string {
  const map: Record<string, string> = { in_stock: 'in_stock', assigned: 'taken', returned: 'returned', void: 'voided' };
  return map[status] ? t(map[status]) : status;
}

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
  const [unitsTarget, setUnitsTarget] = useState<any>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [movements, setMovements] = useState<any[]>([]);
  const [mvSearch, setMvSearch] = useState('');
  const [mvType, setMvType] = useState('');
  const [serialQ, setSerialQ] = useState('');
  const [serialResult, setSerialResult] = useState<any>(null);
  const [serialNotFound, setSerialNotFound] = useState(false);
  const [serialSearching, setSerialSearching] = useState(false);
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
      max_stock_level: Number(form.max_stock_level) || 0,
      warehouse_id: form.warehouse_id || null,
      track_serials: form.track_serials,
    };
    try {
      if (editing) {
        // Quantity changes go through the stock-movement ledger (audit-safe):
        // apply an adjustment first, then patch the item fields.
        const delta = Math.round((Number(form.quantity) - Number(editing.quantity)) * 100) / 100;
        if (delta !== 0) {
          if (!form.qty_reason || form.qty_reason.trim().length < 3) {
            return toast(locale === 'ar' ? 'أدخل سبب تعديل الكمية' : 'Enter a reason for the quantity change', 'err');
          }
          await api.post(`/items/${editing.id}/adjust`, { delta, reason: form.qty_reason.trim() });
        }
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

  const findSerial = async () => {
    const s = serialQ.trim();
    if (!s) return;
    setSerialSearching(true);
    setSerialResult(null);
    setSerialNotFound(false);
    try {
      const r = await api.get(`/items/units/search?serial=${encodeURIComponent(s)}`);
      setSerialResult(r.data);
    } catch (e: any) {
      if (e?.response?.status === 404) setSerialNotFound(true);
      else toast(errMsg(e), 'err');
    } finally {
      setSerialSearching(false);
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
        <div className="flex flex-wrap items-center gap-1">
          <Badge color={Number(i.quantity) === 0 ? 'red' : i.low_stock ? 'amber' : 'green'}>
            {num(i.quantity)}
          </Badge>
          {i.over_stock && <Badge color="violet">{t('over_stock')}</Badge>}
        </div>
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
                    className="rounded-lg p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/30"
                    title={t('units_management')}
                    onClick={() => setUnitsTarget(i)}
                  >
                    <Boxes size={15} />
                  </button>
                  <button
                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-primary-600 dark:hover:bg-slate-800"
                    title={t('edit')}
                    onClick={() => {
                      setEditing(i);
                      setForm({ ...emptyItem, ...i, category_id: i.category_id || '', warehouse_id: i.warehouse_id || '', max_stock_level: i.max_stock_level ?? 0, quantity: String(i.quantity), qty_reason: '' });
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
              <Button variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>{t('import_data')}</Button>
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
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 p-3 dark:border-slate-800">
              <Input
                placeholder={t('find_serial')}
                value={serialQ}
                onChange={(e) => setSerialQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && findSerial()}
                className="max-w-xs font-mono"
                dir="ltr"
              />
              <Button size="sm" variant="secondary" disabled={serialSearching} onClick={findSerial}>{t('search')}</Button>
            </div>
            {serialNotFound && (
              <div className="border-t border-slate-100 p-4 text-sm font-semibold text-rose-600 dark:border-slate-800 dark:text-rose-400">
                {locale === 'ar' ? 'لم يتم العثور على هذا الرقم التسلسلي' : 'Serial not found'}
              </div>
            )}
            {serialResult?.unit && (
              <div className="border-t border-slate-100 p-4 dark:border-slate-800">
                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-slate-800 dark:text-slate-100">
                        {locale === 'ar' && serialResult.item?.name_ar ? serialResult.item.name_ar : serialResult.item?.name || '—'}
                      </div>
                      <div className="font-mono text-xs text-slate-400" dir="ltr">{serialResult.unit.serial}</div>
                    </div>
                    <Badge color={unitStatusColor[serialResult.unit.status] || 'slate'}>{unitStatusText(serialResult.unit.status, t)}</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <span className="text-xs font-bold text-slate-400">{t('serial_found_in')}: </span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {serialResult.warehouse ? (locale === 'ar' ? serialResult.warehouse.name_ar || serialResult.warehouse.name : serialResult.warehouse.name) : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-400">{t('holder')}: </span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {serialResult.holder ? (
                          <>
                            {serialResult.holder.name}{' '}
                            <span className="text-xs font-normal text-slate-400" dir="ltr">{serialResult.holder.phone || ''}</span>
                          </>
                        ) : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
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
          <Field label={t('max_stock')}><Input type="number" min={0} value={form.max_stock_level} onChange={(e) => setForm({ ...form, max_stock_level: e.target.value })} dir="ltr" /></Field>
          {!editing ? (
            <Field label={t('initial_stock')}><Input type="number" min={0} value={form.initial_quantity} onChange={(e) => setForm({ ...form, initial_quantity: e.target.value })} dir="ltr" /></Field>
          ) : (
            <Field
              label={t('quantity_in_stock')}
              required
              hint={
                Number(form.quantity) !== Number(editing.quantity)
                  ? (locale === 'ar'
                    ? `سيتم تسجيل حركة تسوية: ${Number(editing.quantity)} → ${Number(form.quantity)} (${(Number(form.quantity) - Number(editing.quantity)) > 0 ? '+' : ''}${Math.round((Number(form.quantity) - Number(editing.quantity)) * 100) / 100})`
                    : `A stock adjustment will be recorded: ${Number(editing.quantity)} → ${Number(form.quantity)} (${(Number(form.quantity) - Number(editing.quantity)) > 0 ? '+' : ''}${Math.round((Number(form.quantity) - Number(editing.quantity)) * 100) / 100})`)
                  : undefined
              }
            >
              <Input type="number" min={0} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} dir="ltr" />
            </Field>
          )}
          {editing && Number(form.quantity) !== Number(editing.quantity) && (
            <Field label={t('adjustment_reason')} required className="sm:col-span-2">
              <Textarea rows={2} value={form.qty_reason} onChange={(e) => setForm({ ...form, qty_reason: e.target.value })} placeholder={locale === 'ar' ? 'مثال: جرد فعلي / تالف / مرتجع' : 'e.g. physical count / damaged / return'} />
            </Field>
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

      {unitsTarget && (
        <UnitsModal item={unitsTarget} whs={whs} onClose={() => setUnitsTarget(null)} onChanged={load} />
      )}

      <ImportWizard type="items" open={importOpen} onClose={() => setImportOpen(false)} onDone={load} />
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
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: '', name_ar: '', location: '', capacity: '' });
  const [delTarget, setDelTarget] = useState<any>(null);

  const save = async () => {
    try {
      if (editing) {
        const body: any = { name: form.name, name_ar: form.name_ar || null, location: form.location || null };
        // Capacity only travels when the user actually changed it.
        if ((Number(form.capacity) || 0) !== (Number(editing.capacity) || 0)) body.capacity = Number(form.capacity) || 0;
        await api.patch(`/warehouses/${editing.id}`, body);
      } else {
        await api.post('/warehouses', { name: form.name, name_ar: form.name_ar || null, location: form.location || null, capacity: Number(form.capacity) || 0 });
      }
      toast(t('saved_ok'));
      setOpen(false);
      setEditing(null);
      setForm({ name: '', name_ar: '', location: '', capacity: '' });
      reload();
    } catch (e) { toast(errMsg(e), 'err'); }
  };

  return (
    <Card className="p-4">
      {can('inventory.create') && (
        <div className="mb-3 flex justify-end">
          <Button size="sm" icon={WhIcon} onClick={() => { setEditing(null); setForm({ name: '', name_ar: '', location: '', capacity: '' }); setOpen(true); }}>{t('add_warehouse')}</Button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {whs.map((w) => {
          const util = Number(w.utilization) || 0;
          return (
            <div
              key={w.id}
              className="cursor-pointer rounded-2xl border border-slate-200 p-4 transition hover:border-primary-300 hover:bg-slate-50/60 dark:border-slate-700 dark:hover:border-primary-700 dark:hover:bg-slate-800/40"
              onClick={() => navigate('/warehouses/' + w.id)}
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-slate-800 dark:text-slate-100">
                    {locale === 'ar' ? w.name_ar || w.name : w.name}
                    {w.is_default && <Badge color="blue">{locale === 'ar' ? 'افتراضي' : 'default'}</Badge>}
                  </div>
                  <div className="text-xs text-slate-400">{w.location || '—'}</div>
                </div>
                <div className="flex gap-1">
                  {can('inventory.edit') && (
                    <button
                      className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-primary-600 dark:hover:bg-slate-800"
                      title={t('edit_warehouse')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(w);
                        setForm({ name: w.name, name_ar: w.name_ar || '', location: w.location || '', capacity: String(w.capacity ?? 0) });
                        setOpen(true);
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                  {can('inventory.delete') && !w.is_default && Number(w.total_quantity) === 0 && (
                    <button
                      className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDelTarget(w);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
                  <div className="font-bold text-slate-400">{t('items')}</div>
                  <div className="mt-0.5 text-base font-extrabold text-slate-800 dark:text-slate-100"><span dir="ltr">{num(w.items_count)}</span></div>
                </div>
                <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
                  <div className="font-bold text-slate-400">{locale === 'ar' ? 'إجمالي الكميات' : 'Total units'}</div>
                  <div className="mt-0.5 text-base font-extrabold text-slate-800 dark:text-slate-100"><span dir="ltr">{num(w.total_quantity)}</span></div>
                </div>
                <div className="rounded-xl bg-sky-50 p-2.5 dark:bg-sky-900/20">
                  <div className="font-bold text-sky-500/80">{locale === 'ar' ? 'قيمة التكلفة' : 'Cost value'}</div>
                  <div className="mt-0.5 font-extrabold text-sky-700 dark:text-sky-300"><span dir="ltr">{money(w.cost_value)}</span></div>
                </div>
                <div className="rounded-xl bg-violet-50 p-2.5 dark:bg-violet-900/20">
                  <div className="font-bold text-violet-500/80">{locale === 'ar' ? 'قيمة البيع' : 'Sell value'}</div>
                  <div className="mt-0.5 font-extrabold text-violet-700 dark:text-violet-300"><span dir="ltr">{money(w.sell_value)}</span></div>
                </div>
              </div>
              {Number(w.capacity) > 0 && (
                <div className="mt-2.5">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5 text-xs">
                    <span className="font-bold text-slate-400">{t('utilization')}</span>
                    <span className="flex items-center gap-1.5">
                      <span dir="ltr" className="font-semibold text-slate-600 dark:text-slate-300">{num(w.units_in_stock)} / {num(w.capacity)}</span>
                      {util > 100 && <Badge color="red">{t('over_capacity')}</Badge>}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={'h-full rounded-full ' + (util >= 100 ? 'bg-rose-500' : util >= 70 ? 'bg-amber-500' : 'bg-emerald-500')}
                      style={{ width: Math.min(util, 100) + '%' }}
                    />
                  </div>
                </div>
              )}
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {Number(w.out_count) > 0 && <Badge color="red">{locale === 'ar' ? `${num(w.out_count)} صنف نفد` : `${num(w.out_count)} out of stock`}</Badge>}
                {Number(w.low_count) > 0 && <Badge color="amber">{locale === 'ar' ? `${num(w.low_count)} صنف منخفض` : `${num(w.low_count)} low`}</Badge>}
                {Number(w.out_count) === 0 && Number(w.low_count) === 0 && <Badge color="green">{locale === 'ar' ? 'المخزون سليم' : 'Stock healthy'}</Badge>}
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={open} onClose={() => { setOpen(false); setEditing(null); }} title={editing ? t('edit_warehouse') : t('add_warehouse')}>
        <div className="space-y-4">
          <Field label={`${t('name')} (EN)`} required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={t('name_ar')}><Input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('location')}><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            <Field label={t('capacity')} hint={t('capacity_hint')}>
              <Input type="number" min={0} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} dir="ltr" />
            </Field>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { setOpen(false); setEditing(null); }}>{t('cancel')}</Button>
          <Button onClick={save}>{t('save')}</Button>
        </div>
      </Modal>
      <ConfirmDialog open={!!delTarget} onClose={() => setDelTarget(null)} onConfirm={async () => {
        try { await api.delete(`/warehouses/${delTarget.id}`); toast(t('saved_ok')); reload(); } catch (e) { toast(errMsg(e), 'err'); }
      }} title={t('delete_confirm')} message={delTarget?.name} />
    </Card>
  );
}

/** Serialized-units manager for one item: add serials, void / move in-stock units. */
function UnitsModal({ item, whs, onClose, onChanged }: { item: any; whs: any[]; onClose: () => void; onChanged: () => void }) {
  const { t, can, toast, locale } = useApp();
  const [units, setUnits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [serialsText, setSerialsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [voidTarget, setVoidTarget] = useState<any>(null);
  const [moveTarget, setMoveTarget] = useState<any>(null);
  const [moveWh, setMoveWh] = useState('');

  const loadUnits = useCallback(() => {
    setLoading(true);
    api
      .get(`/items/${item.id}`)
      .then((r) => setUnits(r.data.units || []))
      .catch((e) => toast(errMsg(e), 'err'))
      .finally(() => setLoading(false));
  }, [item.id]);
  useEffect(loadUnits, [loadUnits]);

  const whName = (id: any) => {
    const w = whs.find((x: any) => x.id === Number(id));
    if (!w) return '—';
    return locale === 'ar' ? w.name_ar || w.name : w.name;
  };

  const addSerials = async () => {
    const serials = serialsText.split('\n').map((s: string) => s.trim()).filter(Boolean);
    if (!serials.length) return;
    setSaving(true);
    try {
      await api.post(`/items/${item.id}/units`, { serials });
      toast(t('saved_ok'));
      setSerialsText('');
      loadUnits();
      onChanged();
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setSaving(false);
    }
  };

  const doVoid = async (reason?: string) => {
    try {
      await api.post(`/items/${item.id}/units/${voidTarget.id}/void`, { reason });
      toast(t('saved_ok'));
      setVoidTarget(null);
      loadUnits();
      onChanged();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  const doMove = async () => {
    if (!moveWh) return;
    try {
      await api.post(`/items/${item.id}/units/${moveTarget.id}/transfer`, { to_warehouse_id: Number(moveWh) });
      toast(t('saved_ok'));
      setMoveTarget(null);
      loadUnits();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  const unitCols: Column<any>[] = [
    { key: 'serial', label: t('serial_numbers'), render: (u) => <span className="font-mono" dir="ltr">{u.serial}</span> },
    { key: 'status', label: t('status'), render: (u) => <Badge color={unitStatusColor[u.status] || 'slate'}>{unitStatusText(u.status, t)}</Badge> },
    { key: 'wh', label: t('warehouse'), hideOnMobile: true, render: (u) => whName(u.warehouse_id) },
    { key: 'holder', label: t('holder'), hideOnMobile: true, render: (u) => u.customer_name || '—' },
    ...(can('inventory.edit')
      ? [{
          key: 'act',
          label: t('actions'),
          className: 'text-end',
          render: (u: any) =>
            u.status === 'in_stock' ? (
              <div className="flex justify-end gap-1">
                <button className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30" title={t('void_unit')} onClick={() => setVoidTarget(u)}>
                  <Ban size={15} />
                </button>
                <button
                  className="rounded-lg p-2 text-slate-400 hover:bg-violet-50 hover:text-violet-600 dark:hover:bg-violet-900/30"
                  title={t('move_unit')}
                  onClick={() => {
                    setMoveWh('');
                    setMoveTarget(u);
                  }}
                >
                  <ArrowLeftRight size={15} />
                </button>
              </div>
            ) : null,
        }]
      : []),
  ];

  return (
    <Modal open onClose={onClose} title={`${t('units_management')} — ${locale === 'ar' && item.name_ar ? item.name_ar : item.name}`} wide>
      {can('inventory.edit') && (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label={t('add_serials')} hint={t('serials_help')} className="flex-1">
            <Textarea rows={2} value={serialsText} onChange={(e) => setSerialsText(e.target.value)} className="font-mono" dir="ltr" />
          </Field>
          <Button icon={Plus} disabled={saving} onClick={addSerials}>{t('add_serials')}</Button>
        </div>
      )}
      {loading ? (
        <div className="py-8 text-center text-sm text-slate-400">{t('loading')}</div>
      ) : units.length ? (
        <DataTable columns={unitCols} rows={units} />
      ) : (
        <div className="py-8 text-center text-sm text-slate-400">{t('no_serials')}</div>
      )}

      <ConfirmDialog
        open={!!voidTarget}
        onClose={() => setVoidTarget(null)}
        onConfirm={doVoid}
        title={t('void_unit')}
        message={voidTarget?.serial}
        needReason
      />

      <Modal open={!!moveTarget} onClose={() => setMoveTarget(null)} title={t('move_unit')}>
        <div className="space-y-4">
          <div className="font-mono text-sm text-slate-600 dark:text-slate-300" dir="ltr">{moveTarget?.serial}</div>
          <Field label={t('warehouse')} required>
            <Select value={moveWh} onChange={(e) => setMoveWh(e.target.value)}>
              <option value="">—</option>
              {whs.map((w) => (
                <option key={w.id} value={w.id}>{locale === 'ar' ? w.name_ar || w.name : w.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setMoveTarget(null)}>{t('cancel')}</Button>
          <Button disabled={!moveWh} onClick={doMove}>{t('save')}</Button>
        </div>
      </Modal>
    </Modal>
  );
}
