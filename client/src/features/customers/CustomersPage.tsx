import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Pencil, UserX, UserCheck, Upload } from 'lucide-react';
import { api, errMsg, exportCsv } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Badge, Button, Card, ConfirmDialog, DataTable, Field, Input, Modal, PageHeader, Pagination, Textarea, Column } from '../../components/ui/kit';
import { money, fmtDate } from '../../lib/format';
import ImportWizard from '../shared/ImportWizard';

const empty = { name: '', phone: '', national_id: '', address: '', notes: '' };

export default function CustomersPage() {
  const { t, can, toast, locale } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(empty);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [importOpen, setImportOpen] = useState(false);
  const canFin = can('customers.view_financials');
  const pageSize = 25;

  const load = useCallback(() => {
    setLoading(true);
    api
      .get(`/customers?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}${status ? `&status=${status}` : ''}`)
      .then((r) => {
        setRows(r.data.rows);
        setTotal(r.data.total);
      })
      .catch((e) => toast(errMsg(e), 'err'))
      .finally(() => setLoading(false));
  }, [page, search, status]);

  useEffect(() => {
    if (params.get('new')) {
      setForm(empty);
      setEditing(null);
      setFormOpen(true);
    }
  }, [params]);

  useEffect(() => {
    const id = setTimeout(load, search || status ? 250 : 0);
    return () => clearTimeout(id);
  }, [load]);

  const save = async () => {
    if (form.name.trim().length < 2) return toast(t('required_field'), 'err');
    try {
      if (editing) {
        await api.patch(`/customers/${editing.id}`, form);
      } else {
        await api.post('/customers', form);
      }
      toast(t('saved_ok'));
      setFormOpen(false);
      load();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  const doDelete = async () => {
    try {
      await api.delete(`/customers/${deleteTarget.id}`);
      toast(t('saved_ok'));
      load();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  const statusBadge = (r: any) => {
    if (!canFin) return null;
    if (r.overdue) return <Badge color="red">{t('overdue_status')}</Badge>;
    if (Number(r.balance) > 0.005) return <Badge color="amber">{t('owes_status')}</Badge>;
    return <Badge color="green">{t('clear_status')}</Badge>;
  };

  const columns: Column<any>[] = [
    {
      key: 'name',
      label: t('name'),
      render: (r) => (
        <div>
          <div className="font-bold text-slate-800 dark:text-slate-100">{r.name}</div>
          <div className="text-xs text-slate-400" dir="ltr">{r.phone || '—'}</div>
        </div>
      ),
    },
    { key: 'phone', label: t('phone'), hideOnMobile: true, render: (r) => <span dir="ltr">{r.phone || '—'}</span> },
    ...(canFin
      ? [
          { key: 'total_taken', label: t('total_taken'), hideOnMobile: true, render: (r: any) => <span dir="ltr">{money(r.total_taken)}</span> },
          { key: 'total_paid', label: t('total_paid'), hideOnMobile: true, render: (r: any) => <span dir="ltr" className="text-emerald-600 dark:text-emerald-400">{money(r.total_paid)}</span> },
          {
            key: 'balance',
            label: t('balance'),
            render: (r: any) => (
              <span dir="ltr" className={`font-extrabold ${Number(r.balance) > 0.005 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {money(r.balance)}
              </span>
            ),
          },
          { key: 'st', label: t('status'), render: statusBadge },
        ]
      : []),
    { key: 'active', label: t('status'), hideOnMobile: true, render: (r) => (r.is_active ? <Badge color="green">{t('active')}</Badge> : <Badge color="slate">{t('inactive')}</Badge>) },
    {
      key: 'actions',
      label: t('actions'),
      render: (r) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {can('customers.edit') && (
            <button
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-primary-600 dark:hover:bg-slate-800"
              onClick={() => {
                setEditing(r);
                setForm({ name: r.name, phone: r.phone || '', national_id: r.national_id || '', address: r.address || '', notes: r.notes || '' });
                setFormOpen(true);
              }}
              title={t('edit')}
            >
              <Pencil size={15} />
            </button>
          )}
          {can('customers.delete') && (
            <button className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30" onClick={() => setDeleteTarget(r)} title={t('delete')}>
              <UserX size={15} />
            </button>
          )}
        </div>
      ),
      className: 'text-end',
    },
  ];

  return (
    <>
      <PageHeader
        title={t('customers')}
        subtitle={`${total} ${locale === 'ar' ? 'عميل' : 'customers'}`}
        actions={
          <>
            {can('customers.export') && (
              <Button variant="secondary" onClick={() => exportCsv('customers.csv', rows, { name: t('name'), phone: t('phone'), total_taken: t('total_taken'), total_paid: t('total_paid'), balance: t('balance') })}>
                {t('export_csv')}
              </Button>
            )}
            {can('customers.create') && (
              <Button variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>{t('import_data')}</Button>
            )}
            {can('customers.create') && (
              <Button
                icon={Plus}
                onClick={() => {
                  setEditing(null);
                  setForm(empty);
                  setFormOpen(true);
                }}
              >
                {t('add_customer')}
              </Button>
            )}
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3 dark:border-slate-800">
          <Input placeholder={t('search')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="">{t('all')}</option>
            <option value="active">{t('active')}</option>
            <option value="inactive">{t('inactive')}</option>
            {canFin && (
              <>
                <option value="owes">{locale === 'ar' ? 'مدين (عليه رصيد)' : 'Owes balance'}</option>
                <option value="clear">{locale === 'ar' ? 'خالص (لا يوجد رصيد)' : 'Clear (zero balance)'}</option>
                <option value="overdue">{locale === 'ar' ? 'أقساط متأخرة' : 'Overdue installments'}</option>
              </>
            )}
          </select>
        </div>
        <DataTable columns={columns} rows={rows} loading={loading} onRowClick={(r) => navigate(`/customers/${r.id}`)} />
        <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
      </Card>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? t('edit_customer') : t('add_customer')}>
        <div className="space-y-4">
          <Field label={t('name')} required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('phone')}>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
            </Field>
            <Field label={t('national_id')}>
              <Input value={form.national_id} onChange={(e) => setForm({ ...form, national_id: e.target.value })} dir="ltr" />
            </Field>
          </div>
          <Field label={t('address')}>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <Field label={t('notes')}>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setFormOpen(false)}>{t('cancel')}</Button>
          <Button onClick={save}>{t('save')}</Button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={doDelete} title={t('delete_confirm')} message={deleteTarget?.name} />

      <ImportWizard type="customers" open={importOpen} onClose={() => setImportOpen(false)} onDone={load} />
    </>
  );
}
