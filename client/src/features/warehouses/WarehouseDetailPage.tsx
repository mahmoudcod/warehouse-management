import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Pencil } from 'lucide-react';
import { api, errMsg } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Badge, Button, Card, DataTable, Field, Input, Modal, Spinner, Tabs, Column } from '../../components/ui/kit';
import { money, num, fmtDate } from '../../lib/format';

const MV_COLORS: Record<string, 'green' | 'blue' | 'amber' | 'slate' | 'violet'> = {
  purchase: 'green',
  assignment: 'blue',
  return: 'amber',
  adjustment: 'slate',
  transfer: 'violet',
};

export default function WarehouseDetailPage() {
  const { id } = useParams();
  const { t, can, toast, locale } = useApp();
  const navigate = useNavigate();
  const [warehouse, setWarehouse] = useState<any>(null);
  const [stats, setStats] = useState<any>({});
  const [items, setItems] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [tab, setTab] = useState('items');
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const Back = locale === 'ar' ? ArrowRight : ArrowLeft;

  const load = useCallback(() => {
    api.get(`/warehouses/${id}`).then((r) => {
      const w = r.data.warehouse || {};
      setWarehouse(w);
      setStats(r.data.stats || {});
      setItems(r.data.items || []);
      setMovements(r.data.movements || []);
      setForm({
        name: w.name || '',
        name_ar: w.name_ar || '',
        location: w.location || '',
        capacity: w.capacity ?? 0,
        is_default: !!w.is_default,
      });
    }).catch((e) => toast(errMsg(e), 'err'));
  }, [id]);

  useEffect(load, [load]);

  if (!warehouse) return <Spinner />;

  const cap = Number(warehouse.capacity || 0);
  const util = stats.utilization == null ? null : Number(stats.utilization);
  const utilPct = Math.min(util ?? 0, 100);
  const utilColor = (util ?? 0) >= 100 ? 'bg-rose-500' : (util ?? 0) >= 70 ? 'bg-amber-500' : 'bg-emerald-500';

  const itemCols: Column<any>[] = [
    { key: 'name', label: t('item'), render: (it) => (
      <div>
        <div className="font-bold text-slate-800 dark:text-slate-100">{locale === 'ar' ? it.name_ar || it.name : it.name}</div>
        <div className="text-xs text-slate-400">{it.sku || ''}</div>
      </div>
    ) },
    { key: 'quantity', label: t('quantity'), render: (it) => num(it.quantity) },
    { key: 'selling_price', label: t('selling_price'), render: (it) => <span dir="ltr" className="font-bold">{money(it.selling_price)}</span> },
    { key: 'low_stock', label: t('low_stock'), render: (it) => (it.low_stock ? <Badge color="amber">{t('low_stock')}</Badge> : null) },
    { key: 'over_stock', label: t('over_stock'), render: (it) => (it.over_stock ? <Badge color="red">{t('over_stock')}</Badge> : null) },
  ];

  const mvCols: Column<any>[] = [
    { key: 'created_at', label: t('date'), render: (m) => <span className="whitespace-nowrap text-slate-500">{fmtDate(m.created_at, true)}</span> },
    { key: 'item', label: t('item'), render: (m) => locale === 'ar' ? m.item_name_ar || m.item_name : m.item_name },
    { key: 'movement_type', label: t('movements'), render: (m) => <Badge color={MV_COLORS[m.movement_type] || 'slate'}>{t(`mv_${m.movement_type}`)}</Badge> },
    { key: 'quantity', label: t('quantity'), render: (m) => {
      const q = Number(m.quantity || 0);
      return (
        <span dir="ltr" className={`font-extrabold ${q > 0 ? 'text-emerald-600 dark:text-emerald-400' : q < 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>
          {q > 0 ? '+' : ''}{num(q)}
        </span>
      );
    } },
    { key: 'reason', label: t('reason'), hideOnMobile: true, render: (m) => <span className="text-xs text-slate-400">{m.reason || '—'}</span> },
    { key: 'performed_by_name', label: locale === 'ar' ? 'بواسطة' : 'Performed by', hideOnMobile: true, render: (m) => m.performed_by_name || '—' },
  ];

  const save = async () => {
    if (!String(form.name || '').trim()) {
      toast(t('required_field'), 'err');
      return;
    }
    try {
      await api.patch(`/warehouses/${id}`, {
        name: form.name,
        name_ar: form.name_ar,
        location: form.location,
        capacity: Number(form.capacity) || 0,
        is_default: !!form.is_default,
      });
      toast(t('saved_ok'));
      setEditOpen(false);
      load();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <button onClick={() => navigate('/inventory')} title={t('go_back')} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
          <Back size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-extrabold text-slate-900 dark:text-slate-50">
            <span className="truncate">{locale === 'ar' ? warehouse.name_ar || warehouse.name : warehouse.name}</span>
            {warehouse.is_default && <Badge color="blue">{locale === 'ar' ? 'افتراضي' : 'default'}</Badge>}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>{t('location')}: {warehouse.location || '—'}</span>
          </div>
        </div>
        {can('inventory.edit') && (
          <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditOpen(true)}>{t('edit_warehouse')}</Button>
        )}
      </div>

      {/* capacity */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-bold text-slate-400">{t('capacity')}</div>
          {util != null && util > 100 && <Badge color="red">{t('over_capacity')}</Badge>}
        </div>
        {cap > 0 ? (
          <>
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className={`h-full rounded-full transition-all ${utilColor}`} style={{ width: `${utilPct}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs font-bold">
              <span className="text-slate-400">{t('utilization')}</span>
              <span dir="ltr" className="text-slate-700 dark:text-slate-200">{num(stats.total_quantity)} / {num(cap)}</span>
            </div>
          </>
        ) : (
          <div className="mt-2 text-sm font-extrabold text-emerald-600 dark:text-emerald-400">{t('unlimited')}</div>
        )}
      </Card>

      {/* stats */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Card className="p-4"><div className="text-[11px] font-bold text-slate-400">{locale === 'ar' ? 'إجمالي الكميات' : 'Total units'}</div><div className="text-lg font-extrabold text-slate-800 dark:text-slate-100"><span dir="ltr">{num(stats.total_quantity)}</span></div></Card>
        <Card className="p-4"><div className="text-[11px] font-bold text-slate-400">{t('items')}</div><div className="text-lg font-extrabold text-slate-800 dark:text-slate-100"><span dir="ltr">{num(stats.items_count)}</span></div></Card>
        <Card className="p-4"><div className="text-[11px] font-bold text-slate-400">{t('low_items')}</div><div className={`text-lg font-extrabold ${Number(stats.low_count) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-100'}`}><span dir="ltr">{num(stats.low_count)}</span></div></Card>
        <Card className="p-4"><div className="text-[11px] font-bold text-slate-400">{t('units_stored')}</div><div className="text-lg font-extrabold text-slate-800 dark:text-slate-100"><span dir="ltr">{num(stats.units_in_stock)}</span></div></Card>
        <Card className="p-4"><div className="text-[11px] font-bold text-slate-400">{t('value_at_cost')}</div><div className="text-lg font-extrabold text-sky-700 dark:text-sky-300"><span dir="ltr">{money(stats.cost_value)}</span></div></Card>
        <Card className="p-4"><div className="text-[11px] font-bold text-slate-400">{t('value_at_sell')}</div><div className="text-lg font-extrabold text-violet-700 dark:text-violet-300"><span dir="ltr">{money(stats.sell_value)}</span></div></Card>
      </div>

      <div className="mt-4">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { key: 'items', label: t('items_in_warehouse'), badge: items.length },
            { key: 'movements', label: t('movements'), badge: movements.length },
          ]}
        />

        <div className="mt-4">
          {tab === 'items' && (
            <Card>
              <DataTable columns={itemCols} rows={items} />
            </Card>
          )}
          {tab === 'movements' && (
            <Card>
              <DataTable columns={mvCols} rows={movements} />
            </Card>
          )}
        </div>
      </div>

      {/* edit warehouse */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={t('edit_warehouse')}>
        <div className="space-y-4">
          <Field label={`${t('name')} (EN)`} required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={t('name_ar')}><Input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></Field>
          <Field label={t('location')}><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          <Field label={t('capacity')} hint={t('capacity_hint')}>
            <Input type="number" min={0} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} dir="ltr" />
          </Field>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={!!form.is_default}
              onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 accent-primary-600"
            />
            {locale === 'ar' ? 'افتراضي' : 'Default warehouse'}
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditOpen(false)}>{t('cancel')}</Button>
          <Button onClick={save}>{t('save')}</Button>
        </div>
      </Modal>
    </>
  );
}
