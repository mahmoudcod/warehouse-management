import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Boxes, Truck, HandCoins, TrendingUp, TrendingDown, PiggyBank, Wallet, PackageX,
  UserPlus, PlusCircle, ArrowLeftRight, AlertTriangle,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Card, PageHeader, Button, Badge, Field, Input } from '../../components/ui/kit';
import { money, num, fmtDate, monthStart, today } from '../../lib/format';
import { RecordTakenModal, RecordPaymentModal } from '../shared/forms';

function Kpi({ icon: Icon, label, value, tone, hint }: { icon: React.ElementType; label: string; value: string; tone: string; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${tone}`}>
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[11px] font-bold text-slate-400">{label}</div>
          <div className="truncate text-base font-extrabold text-slate-900 dark:text-slate-50 sm:text-lg" dir="ltr">{value}</div>
          {hint && <div className="truncate text-[11px] text-slate-400">{hint}</div>}
        </div>
      </div>
    </Card>
  );
}

const PIE_COLORS = ['#4653e2', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316'];

export default function DashboardPage() {
  const { t, can, locale, user } = useApp();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [takenOpen, setTakenOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const load = () => {
    api.get(`/dashboard/summary?from=${from}&to=${to}`).then((r) => setData(r.data)).catch(() => {});
  };
  useEffect(load, [from, to]);

  if (!data) return <div className="py-24 text-center text-sm text-slate-400">{t('loading')}</div>;

  const k = data.kpis;
  const iee = data.charts.income_vs_expense || [];
  const monthLabel = (m: string) => {
    const [y, mo] = m.split('-');
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en', { month: 'short' }).format(new Date(Number(y), Number(mo) - 1, 1));
  };
  const ieeData = iee.map((x: any) => ({ month: monthLabel(x.month), income: x.income, expense: x.expense }));
  const catData = (data.charts.stock_by_category || []).map((x: any) => ({ name: locale === 'ar' ? x.category_ar || x.category : x.category, value: x.value, quantity: x.quantity }));
  const custData = (data.charts.top_customers || []).map((x: any) => ({ name: x.name, balance: x.balance }));
  const collData = (data.charts.monthly_collections || []).map((x: any) => ({ month: monthLabel(x.month), total: x.total }));

  const showMoney = (v: any) => (v == null ? '—' : money(v));

  return (
    <>
      <PageHeader
        title={`${locale === 'ar' ? 'أهلاً' : 'Hello'}, ${user?.name?.split('—')[0]?.trim()}`}
        subtitle={locale === 'ar' ? 'نظرة عامة على الأداء' : 'Business overview'}
        actions={
          <div className="flex items-end gap-2">
            <Field label={t('from')}>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" className="!py-2 !text-xs" />
            </Field>
            <Field label={t('to')}>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" className="!py-2 !text-xs" />
            </Field>
          </div>
        }
      />

      {/* Quick actions */}
      <div className="mb-5 flex flex-wrap gap-2">
        {can('customers.create') && (
          <Button variant="secondary" icon={UserPlus} onClick={() => navigate('/customers?new=1')}>{t('quick_add_customer')}</Button>
        )}
        {can('inventory.create') && (
          <Button variant="secondary" icon={PlusCircle} onClick={() => navigate('/inventory?new=1')}>{t('quick_add_device')}</Button>
        )}
        {can('payments.create') && <Button variant="success" icon={Wallet} onClick={() => setPayOpen(true)}>{t('quick_record_payment')}</Button>}
        {can('assignments.create') && <Button icon={Truck} onClick={() => setTakenOpen(true)}>{t('record_taken')}</Button>}
        {can('accounting.create') && (
          <Button variant="secondary" icon={ArrowLeftRight} onClick={() => navigate('/accounting?new=1')}>{t('quick_record_tx')}</Button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icon={Boxes} label={t('kpi_in_stock')} value={num(k.items_in_stock)} tone="bg-primary-50 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300" hint={showMoney(k.stock_cost_value)} />
        <Kpi icon={Truck} label={t('kpi_devices_out')} value={num(k.devices_out_quantity)} tone="bg-sky-50 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300" hint={showMoney(k.devices_out_amount)} />
        <Kpi icon={HandCoins} label={t('kpi_receivables')} value={showMoney(k.total_receivables)} tone="bg-rose-50 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300" />
        <Kpi icon={Wallet} label={t('kpi_collected')} value={showMoney(k.collected_in_range)} tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300" />
        {k.income_in_range != null && (
          <Kpi icon={TrendingUp} label={t('kpi_income')} value={showMoney(k.income_in_range)} tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300" />
        )}
        {k.expense_in_range != null && (
          <Kpi icon={TrendingDown} label={t('kpi_expense')} value={showMoney(k.expense_in_range)} tone="bg-amber-50 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300" />
        )}
        {k.net_profit_in_range != null && (
          <Kpi icon={PiggyBank} label={t('kpi_net')} value={showMoney(k.net_profit_in_range)} tone="bg-violet-50 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300" />
        )}
        <Kpi icon={PackageX} label={t('low_stock_alerts')} value={num(data.low_stock.length)} tone="bg-orange-50 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300" hint={`${t('overdue_installments')}: ${num(k.overdue_installments)}`} />
      </div>

      {/* Charts */}
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {ieeData.length > 0 && (
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-extrabold text-slate-700 dark:text-slate-200">{t('chart_income_expense')}</h3>
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={ieeData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="month" fontSize={11} tickLine={false} />
                <YAxis fontSize={10} tickLine={false} tickFormatter={(v) => num(v)} width={55} />
                <Tooltip formatter={(v: any) => money(v)} contentStyle={{ borderRadius: 12, fontSize: 12, direction: 'ltr' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="income" name={t('income')} stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="expense" name={t('expense')} stroke="#ef4444" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        )}
        {catData.length > 0 && (
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-extrabold text-slate-700 dark:text-slate-200">{t('chart_stock_cat')}</h3>
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie data={catData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                  {catData.map((_: any, i: number) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: any) => money(v)} contentStyle={{ borderRadius: 12, fontSize: 12, direction: 'ltr' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        )}
        {collData.length > 0 && (
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-extrabold text-slate-700 dark:text-slate-200">{t('chart_collections')}</h3>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={collData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis dataKey="month" fontSize={11} tickLine={false} />
                <YAxis fontSize={10} tickLine={false} tickFormatter={(v) => num(v)} width={55} />
                <Tooltip formatter={(v: any) => money(v)} contentStyle={{ borderRadius: 12, fontSize: 12, direction: 'ltr' }} />
                <Bar dataKey="total" name={t('total_paid')} fill="#4653e2" radius={[6, 6, 0, 0]} maxBarSize={38} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}
        {custData.length > 0 && (
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-extrabold text-slate-700 dark:text-slate-200">{t('chart_top_customers')}</h3>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={custData} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" />
                <XAxis type="number" fontSize={10} tickFormatter={(v) => num(v)} />
                <YAxis type="category" dataKey="name" fontSize={10} width={110} tickLine={false} />
                <Tooltip formatter={(v: any) => money(v)} contentStyle={{ borderRadius: 12, fontSize: 12, direction: 'ltr' }} />
                <Bar dataKey="balance" name={t('balance')} fill="#f59e0b" radius={[0, 6, 6, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}
      </div>

      {/* Recent + low stock */}
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-extrabold text-slate-700 dark:text-slate-200">{t('nav_assignments')}</h3>
          <div className="space-y-2.5">
            {data.recent.assignments.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between gap-2 border-b border-slate-50 pb-2 text-xs last:border-0 dark:border-slate-800">
                <div className="min-w-0">
                  <div className="truncate font-bold text-slate-700 dark:text-slate-200">{a.customer_name}</div>
                  <div className="truncate text-slate-400">{locale === 'ar' ? a.item_name_ar || a.item_name : a.item_name} · {fmtDate(a.assigned_at)}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="font-extrabold text-slate-800 dark:text-slate-100" dir="ltr">{money(a.amount)}</span>
                  <Badge color={a.status === 'taken' ? 'blue' : 'green'}>{a.status === 'taken' ? t('taken') : t('returned')}</Badge>
                </div>
              </div>
            ))}
            {!data.recent.assignments.length && <div className="py-4 text-center text-xs text-slate-400">{t('no_data')}</div>}
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-extrabold text-slate-700 dark:text-slate-200">{t('nav_payments')}</h3>
          <div className="space-y-2.5">
            {data.recent.payments.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between gap-2 border-b border-slate-50 pb-2 text-xs last:border-0 dark:border-slate-800">
                <div className="min-w-0">
                  <div className="truncate font-bold text-slate-700 dark:text-slate-200">{p.customer_name}</div>
                  <div className="truncate text-slate-400">{p.receipt_number} · {fmtDate(p.paid_at)}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="font-extrabold text-emerald-600 dark:text-emerald-400" dir="ltr">+{money(p.amount)}</span>
                  {p.status === 'voided' && <Badge color="red">{t('voided')}</Badge>}
                </div>
              </div>
            ))}
            {!data.recent.payments.length && <div className="py-4 text-center text-xs text-slate-400">{t('no_data')}</div>}
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-extrabold text-slate-700 dark:text-slate-200">
            <AlertTriangle size={14} className="text-orange-500" /> {t('low_stock_alerts')}
          </h3>
          <div className="space-y-2.5">
            {data.low_stock.map((i: any) => (
              <div key={i.id} className="flex items-center justify-between gap-2 border-b border-slate-50 pb-2 text-xs last:border-0 dark:border-slate-800">
                <div className="min-w-0">
                  <div className="truncate font-bold text-slate-700 dark:text-slate-200">{locale === 'ar' ? i.name_ar || i.name : i.name}</div>
                  <div className="text-slate-400" dir="ltr">{i.sku}</div>
                </div>
                <Badge color={Number(i.quantity) === 0 ? 'red' : 'amber'}>
                  {num(i.quantity)} / {num(i.min_stock_level)}
                </Badge>
              </div>
            ))}
            {!data.low_stock.length && <div className="py-4 text-center text-xs text-slate-400">{t('no_data')}</div>}
          </div>
        </Card>
      </div>

      <RecordTakenModal open={takenOpen} onClose={() => setTakenOpen(false)} onSaved={load} />
      <RecordPaymentModal open={payOpen} onClose={() => setPayOpen(false)} onSaved={load} />
    </>
  );
}
