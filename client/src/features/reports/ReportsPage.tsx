import React, { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { api, errMsg, exportCsv } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Badge, Button, Card, PageHeader, Input, Tabs, Column, DataTable } from '../../components/ui/kit';
import { money, num, fmtDate, today, daysAgoStr } from '../../lib/format';

function RangePicker({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  const { t } = useApp();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" className="!w-auto !py-2 !text-xs" />
      <span className="pb-2.5 text-xs text-slate-400">→</span>
      <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" className="!w-auto !py-2 !text-xs" />
      <Button size="sm" variant="ghost" onClick={() => { setFrom(daysAgoStr(30)); setTo(today()); }}>{'30d'}</Button>
      <Button size="sm" variant="ghost" onClick={() => { setFrom(daysAgoStr(90)); setTo(today()); }}>{'90d'}</Button>
      <Button size="sm" variant="ghost" onClick={() => { setFrom(daysAgoStr(180)); setTo(today()); }}>{'180d'}</Button>
    </div>
  );
}

export default function ReportsPage() {
  const { t, can, toast, locale } = useApp();
  const [tab, setTab] = useState('valuation');
  const [from, setFrom] = useState(daysAgoStr(90));
  const [to, setTo] = useState(today());
  const [valuation, setValuation] = useState<any>(null);
  const [balances, setBalances] = useState<any>(null);
  const [devicesOut, setDevicesOut] = useState<any>(null);
  const [paymentsRep, setPaymentsRep] = useState<any>(null);
  const [pl, setPl] = useState<any>(null);
  const [cashFlow, setCashFlow] = useState<any>(null);
  const [aging, setAging] = useState<any>(null);
  const [staffAct, setStaffAct] = useState<any>(null);
  const [staffRep, setStaffRep] = useState(false);

  useEffect(() => {
    api.get('/reports/inventory-valuation').then((r) => setValuation(r.data)).catch(() => {});
    api.get('/reports/receivables-aging').then((r) => setAging(r.data)).catch(() => {});
    if (can('staff.view') || locale) {
      // staff activity requires staff.view; try quietly
      api.get(`/reports/staff-activity?from=${from}&to=${to}`).then((r) => setStaffAct(r.data)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (['balances', 'devices', 'payments', 'pl', 'cashflow'].includes(tab)) {
      if (tab === 'balances') api.get(`/reports/customer-balances?all=true&from=${from}&to=${to}`).then((r) => setBalances(r.data)).catch((e) => toast(errMsg(e), 'err'));
      if (tab === 'devices') api.get(`/reports/devices-out?from=${from}&to=${to}`).then((r) => setDevicesOut(r.data)).catch((e) => toast(errMsg(e), 'err'));
      if (tab === 'payments') api.get(`/reports/payments?from=${from}&to=${to}`).then((r) => setPaymentsRep(r.data)).catch((e) => toast(errMsg(e), 'err'));
      if (tab === 'pl') api.get(`/reports/income-statement?from=${from}&to=${to}`).then((r) => setPl(r.data)).catch((e) => toast(errMsg(e), 'err'));
      if (tab === 'cashflow') api.get(`/reports/cash-flow?from=${from}&to=${to}`).then((r) => setCashFlow(r.data)).catch((e) => toast(errMsg(e), 'err'));
    }
  }, [tab, from, to]);

  const balanceCols: Column<any>[] = [
    { key: 'name', label: t('customer_name'), render: (r) => (
      <div><div className="font-bold">{r.name}</div><div className="text-xs text-slate-400" dir="ltr">{r.phone || ''}</div></div>
    ) },
    { key: 'total_taken', label: t('total_taken'), hideOnMobile: true, render: (r) => <span dir="ltr">{money(r.total_taken)}</span> },
    { key: 'total_paid', label: t('total_paid'), hideOnMobile: true, render: (r) => <span dir="ltr" className="text-emerald-600">{money(r.total_paid)}</span> },
    { key: 'balance', label: t('balance'), render: (r) => <span dir="ltr" className={`font-extrabold ${r.balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{money(r.balance)}</span> },
    { key: 'open_assignments', label: t('nav_assignments'), hideOnMobile: true, render: (r) => num(r.open_assignments) },
    { key: 'oldest_open', label: locale === 'ar' ? 'أقدم فاتورة' : 'Oldest open', hideOnMobile: true, render: (r) => fmtDate(r.oldest_open) },
  ];

  const deviceCols: Column<any>[] = [
    { key: 'assigned_at', label: t('date'), render: (r) => fmtDate(r.assigned_at) },
    { key: 'customer_name', label: t('customer_name'), render: (r) => r.customer_name },
    { key: 'item_name', label: t('item'), render: (r) => (locale === 'ar' ? r.item_name_ar || r.item_name : r.item_name) },
    { key: 'quantity', label: t('quantity'), render: (r) => num(r.quantity) },
    { key: 'amount', label: t('amount'), render: (r) => <span dir="ltr" className="font-bold">{money(r.amount)}</span> },
    { key: 'serial_numbers', label: t('serial_numbers'), hideOnMobile: true, render: (r) => <span className="font-mono text-xs">{r.serial_numbers || '—'}</span> },
  ];

  const paymentCols: Column<any>[] = [
    { key: 'paid_at', label: t('date'), render: (r) => fmtDate(r.paid_at) },
    { key: 'customer_name', label: t('customer_name'), render: (r) => r.customer_name },
    { key: 'receipt_number', label: t('receipt_no'), render: (r) => <span className="font-mono text-xs" dir="ltr">{r.receipt_number}</span> },
    { key: 'amount', label: t('amount'), render: (r) => <span dir="ltr" className="font-bold">{money(r.amount)}</span> },
    { key: 'method', label: t('method'), render: (r) => t(r.method) },
    { key: 'status', label: t('status'), render: (r) => <Badge color={r.status === 'active' ? 'green' : 'red'}>{r.status === 'active' ? t('active') : t('voided')}</Badge> },
  ];

  return (
    <>
      <PageHeader
        title={t('nav_reports')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {['balances', 'devices', 'payments', 'pl', 'cashflow'].includes(tab) && (
              <RangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} />
            )}
            <Button size="sm" variant="secondary" icon={Printer} onClick={() => window.print()}>{t('print')}</Button>
          </div>
        }
      />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'valuation', label: t('rep_inventory_valuation') },
          { key: 'balances', label: t('rep_customer_balances') },
          { key: 'aging', label: t('rep_aging') },
          { key: 'devices', label: t('rep_devices_out') },
          { key: 'payments', label: t('rep_payments') },
          { key: 'pl', label: t('rep_income_statement') },
          { key: 'cashflow', label: t('rep_cash_flow') },
          ...(staffAct ? [{ key: 'staff', label: t('rep_staff_activity') }] : []),
        ]}
      />

      <div className="mt-4">
        {tab === 'valuation' && valuation && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card className="p-4"><div className="text-[11px] font-bold text-slate-400">{t('total')} ({locale === 'ar' ? 'كمية' : 'qty'})</div><div className="text-lg font-extrabold">{num(valuation.totals.total_quantity)}</div></Card>
              <Card className="p-4"><div className="text-[11px] font-bold text-slate-400">{t('stock_value')} ({locale === 'ar' ? 'تكلفة' : 'cost'})</div><div className="text-lg font-extrabold" dir="ltr">{money(valuation.totals.cost_value)}</div></Card>
              <Card className="p-4"><div className="text-[11px] font-bold text-slate-400">{locale === 'ar' ? 'قيمة البيع' : 'Retail value'}</div><div className="text-lg font-extrabold text-emerald-600" dir="ltr">{money(valuation.totals.sell_value)}</div></Card>
              <Card className="p-4"><div className="text-[11px] font-bold text-slate-400">{locale === 'ar' ? 'هامش متوقع' : 'Potential margin'}</div><div className="text-lg font-extrabold text-violet-600" dir="ltr">{money(valuation.totals.sell_value - valuation.totals.cost_value)}</div></Card>
            </div>
            <Card>
              <DataTable
                columns={[
                  { key: 'category', label: t('category'), render: (r: any) => (locale === 'ar' ? r.category_ar || r.category : r.category) },
                  { key: 'items_count', label: locale === 'ar' ? 'أصناف' : 'Items', render: (r: any) => num(r.items_count) },
                  { key: 'total_quantity', label: t('quantity'), render: (r: any) => num(r.total_quantity) },
                  { key: 'cost_value', label: t('cost_price'), render: (r: any) => <span dir="ltr">{money(r.cost_value)}</span> },
                  { key: 'sell_value', label: t('selling_price'), render: (r: any) => <span dir="ltr" className="font-bold text-emerald-600">{money(r.sell_value)}</span> },
                ]}
                rows={valuation.rows}
              />
            </Card>
          </>
        )}

        {tab === 'balances' && balances && (
          <Card>
            <div className="flex justify-end p-3">
              {can('customers.export') && (
                <Button size="sm" variant="secondary" onClick={() => exportCsv('customer-balances.csv', balances.rows, { name: t('name'), phone: t('phone'), total_taken: t('total_taken'), total_paid: t('total_paid'), balance: t('balance') })}>
                  {t('export_csv')}
                </Button>
              )}
            </div>
            <DataTable columns={balanceCols} rows={balances.rows} />
          </Card>
        )}

        {tab === 'aging' && aging && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[['current', 'green'], ['d1_30', 'amber'], ['d31_60', 'amber'], ['d60_plus', 'red']].map(([b, color]) => (
                <Card key={b} className="p-4">
                  <div className="text-[11px] font-bold text-slate-400">{t(b === 'current' ? 'current_bucket' : b!)}</div>
                  <div className="text-lg font-extrabold" dir="ltr">{money((aging.buckets as any)[b!])}</div>
                </Card>
              ))}
            </div>
            <Card>
              <DataTable
                columns={[
                  { key: 'name', label: t('customer_name'), render: (r: any) => r.name },
                  { key: 'assigned_at', label: t('date'), render: (r: any) => fmtDate(r.assigned_at) },
                  { key: 'age_days', label: locale === 'ar' ? 'العمر (يوم)' : 'Age (days)', render: (r: any) => num(r.age_days) },
                  { key: 'outstanding', label: t('remaining'), render: (r: any) => <span dir="ltr" className="font-bold text-rose-600">{money(r.outstanding)}</span> },
                  { key: 'bucket', label: t('rep_aging'), render: (r: any) => <Badge color={r.bucket === 'current' ? 'green' : r.bucket === 'd60_plus' ? 'red' : 'amber'}>{t(r.bucket === 'current' ? 'current_bucket' : r.bucket)}</Badge> },
                ]}
                rows={aging.rows}
              />
            </Card>
          </>
        )}

        {tab === 'devices' && devicesOut && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="text-sm font-extrabold text-slate-600 dark:text-slate-300">{t('total')}: <span dir="ltr">{money(devicesOut.total)}</span></div>
              {can('assignments.export') && (
                <Button size="sm" variant="secondary" onClick={() => exportCsv('devices-out.csv', devicesOut.rows, { assigned_at: t('date'), customer_name: t('customer'), item_name: t('item'), quantity: t('quantity'), amount: t('amount') })}>
                  {t('export_csv')}
                </Button>
              )}
            </div>
            <DataTable columns={deviceCols} rows={devicesOut.rows} />
          </Card>
        )}

        {tab === 'payments' && paymentsRep && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="flex flex-wrap gap-3 text-sm font-bold">
                <span className="text-slate-500">{t('total')}: <span dir="ltr" className="text-emerald-600">{money(paymentsRep.total)}</span></span>
                {Object.entries(paymentsRep.byMethod).map(([m, v]) => (
                  <span key={m} className="text-slate-400">{t(m)}: <span dir="ltr">{money(v as number)}</span></span>
                ))}
              </div>
              {can('payments.export') && (
                <Button size="sm" variant="secondary" onClick={() => exportCsv('payments-report.csv', paymentsRep.rows, { paid_at: t('date'), customer_name: t('customer'), receipt_number: t('receipt_no'), amount: t('amount'), method: t('method') })}>
                  {t('export_csv')}
                </Button>
              )}
            </div>
            <DataTable columns={paymentCols} rows={paymentsRep.rows} />
          </Card>
        )}

        {tab === 'pl' && pl && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="mb-3 flex items-center justify-between text-sm font-extrabold text-slate-700 dark:text-slate-200">
                {t('income')} <span dir="ltr" className="text-emerald-600">{money(pl.totalIncome)}</span>
              </h3>
              {pl.income.map((r: any) => (
                <div key={r.category} className="flex justify-between border-b border-slate-50 py-2 text-sm dark:border-slate-800">
                  <span className="text-slate-500">{locale === 'ar' ? r.category_ar || r.category : r.category} <span className="text-xs text-slate-300">({r.entries})</span></span>
                  <b dir="ltr">{money(r.total)}</b>
                </div>
              ))}
            </Card>
            <Card className="p-5">
              <h3 className="mb-3 flex items-center justify-between text-sm font-extrabold text-slate-700 dark:text-slate-200">
                {t('expense')} <span dir="ltr" className="text-rose-600">{money(pl.totalExpense)}</span>
              </h3>
              {pl.expense.map((r: any) => (
                <div key={r.category} className="flex justify-between border-b border-slate-50 py-2 text-sm dark:border-slate-800">
                  <span className="text-slate-500">{locale === 'ar' ? r.category_ar || r.category : r.category} <span className="text-xs text-slate-300">({r.entries})</span></span>
                  <b dir="ltr">{money(r.total)}</b>
                </div>
              ))}
            </Card>
            <Card className="p-5 lg:col-span-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-extrabold text-slate-600 dark:text-slate-300">{t('net_profit')}</span>
                <span className={`text-2xl font-black ${pl.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} dir="ltr">{money(pl.netProfit)}</span>
              </div>
            </Card>
          </div>
        )}

        {tab === 'cashflow' && cashFlow && (
          <Card>
            <DataTable
              columns={[
                { key: 'month', label: locale === 'ar' ? 'الشهر' : 'Month', render: (r: any) => r.month },
                { key: 'inflow', label: t('total_in'), render: (r: any) => <span dir="ltr" className="font-bold text-emerald-600">{money(r.inflow)}</span> },
                { key: 'outflow', label: t('total_out'), render: (r: any) => <span dir="ltr" className="font-bold text-rose-600">{money(r.outflow)}</span> },
                { key: 'net', label: t('net_profit'), render: (r: any) => <span dir="ltr" className={`font-extrabold ${r.inflow - r.outflow >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{money(r.inflow - r.outflow)}</span> },
              ]}
              rows={cashFlow.rows}
            />
          </Card>
        )}

        {tab === 'staff' && staffAct && (
          <Card>
            <DataTable
              columns={[
                { key: 'user_name', label: t('who'), render: (r: any) => <span className="font-bold">{r.user_name}</span> },
                { key: 'actions', label: locale === 'ar' ? 'إجراءات' : 'Actions', render: (r: any) => num(r.actions) },
                { key: 'logins', label: t('login'), render: (r: any) => num(r.logins) },
                { key: 'payment_actions', label: t('nav_payments'), render: (r: any) => num(r.payment_actions) },
                { key: 'assignment_actions', label: t('nav_assignments'), render: (r: any) => num(r.assignment_actions) },
                { key: 'last_action_at', label: t('date'), render: (r: any) => fmtDate(r.last_action_at, true) },
              ]}
              rows={staffAct.rows}
            />
          </Card>
        )}
      </div>
    </>
  );
}
