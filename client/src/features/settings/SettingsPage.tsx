import React, { useEffect, useState } from 'react';
import { api, errMsg } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Button, Card, Field, Input, PageHeader, Textarea } from '../../components/ui/kit';

export default function SettingsPage() {
  const { t, toast, user, refreshSettings } = useApp();
  const [form, setForm] = useState<any>(null);
  const isAdmin = user?.role === 'super_admin';

  useEffect(() => {
    api.get('/settings').then((r) => setForm(r.data)).catch((e) => toast(errMsg(e), 'err'));
  }, []);

  if (!form) return null;

  const save = async () => {
    try {
      const r = await api.put('/settings', {
        company_name: form.company_name,
        company_name_en: form.company_name_en,
        company_phone: form.company_phone,
        company_address: form.company_address,
        currency: form.currency,
        tax_enabled: form.tax_enabled,
        tax_rate: Number(form.tax_rate),
        receipt_footer: form.receipt_footer,
        notifications: form.notifications,
      });
      toast(t('saved_ok'));
      setForm(r.data);
      await refreshSettings();
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  const backup = async () => {
    try {
      const r = await api.get('/settings/backup', { responseType: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(r.data);
      a.download = `warehouse-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  return (
    <>
      <PageHeader
        title={t('nav_settings')}
        actions={form && <Button onClick={save}>{t('save')}</Button>}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-extrabold text-slate-700 dark:text-slate-200">{t('company_info')}</h3>
          <div className="space-y-4">
            <Field label={t('company_name')} required>
              <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} disabled={!isAdmin} />
            </Field>
            <Field label={t('company_name_en')}>
              <Input value={form.company_name_en} onChange={(e) => setForm({ ...form, company_name_en: e.target.value })} dir="ltr" disabled={!isAdmin} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label={t('phone')}>
                <Input value={form.company_phone || ''} onChange={(e) => setForm({ ...form, company_phone: e.target.value })} dir="ltr" disabled={!isAdmin} />
              </Field>
              <Field label={t('currency')}>
                <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} dir="ltr" disabled />
              </Field>
            </div>
            <Field label={t('address')}>
              <Input value={form.company_address || ''} onChange={(e) => setForm({ ...form, company_address: e.target.value })} disabled={!isAdmin} />
            </Field>
            <Field label={t('receipt_footer')}>
              <Textarea value={form.receipt_footer || ''} onChange={(e) => setForm({ ...form, receipt_footer: e.target.value })} disabled={!isAdmin} />
            </Field>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="mb-4 text-sm font-extrabold text-slate-700 dark:text-slate-200">{t('tax')}</h3>
            <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={form.tax_enabled} onChange={(e) => setForm({ ...form, tax_enabled: e.target.checked })} className="h-4 w-4 accent-primary-600" disabled={!isAdmin} />
              {t('tax_enabled')}
            </label>
            <Field label={t('tax_rate')}>
              <Input type="number" min={0} max={100} value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: e.target.value })} dir="ltr" disabled={!isAdmin} />
            </Field>
          </Card>

          <Card className="p-5">
            <h3 className="mb-4 text-sm font-extrabold text-slate-700 dark:text-slate-200">{t('notifications')}</h3>
            {['low_stock', 'overdue_installments'].map((k) => (
              <label key={k} className="mb-2 flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={!!form.notifications?.[k]}
                  onChange={(e) => setForm({ ...form, notifications: { ...form.notifications, [k]: e.target.checked } })}
                  className="h-4 w-4 accent-primary-600"
                  disabled={!isAdmin}
                />
                {t(k === 'low_stock' ? 'low_stock_alerts' : 'overdue_installments')}
              </label>
            ))}
          </Card>

          {isAdmin && (
            <Card className="p-5">
              <h3 className="mb-2 text-sm font-extrabold text-slate-700 dark:text-slate-200">{t('backup')}</h3>
              <p className="mb-3 text-xs text-slate-400">
                {t('download_backup')} — JSON
              </p>
              <Button variant="secondary" onClick={backup}>{t('download_backup')}</Button>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
