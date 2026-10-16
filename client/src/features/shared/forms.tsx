import React, { useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Button, Field, Input, Modal, Select, Textarea, Badge } from '../../components/ui/kit';
import { money, today, num } from '../../lib/format';

/* Searchable select shared by all record modals */
export function CustomerSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { locale } = useApp();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      api.get(`/customers?pageSize=20&search=${encodeURIComponent(q)}`).then((r) => setRows(r.data.rows)).catch(() => {});
    }, 200);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    if (value && !rows.some((r) => String(r.id) === String(value))) {
      api.get(`/customers/${value}`).then((r) => {
        if (r.data) setRows((prev) => (prev.some((x) => String(x.id) === String(r.data.id)) ? prev : [r.data, ...prev]));
      }).catch(() => {});
    }
  }, [value, rows]);

  const selected = rows.find((r) => String(r.id) === String(value));

  return (
    <div className="relative">
      <Input
        value={open ? q : selected ? selected.name : ''}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setQ('');
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={locale === 'ar' ? 'ابحث عن عميل…' : 'Search customer…'}
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {rows.map((r) => (
            <button
              type="button"
              key={r.id}
              className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              onMouseDown={() => {
                onChange(String(r.id));
                setOpen(false);
              }}
            >
              <span className="font-semibold text-slate-700 dark:text-slate-200">{r.name}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-slate-400" dir="ltr">{r.phone}</span>
                {r.balance != null && Number(r.balance) !== 0 && (
                  <Badge color={Number(r.balance) > 0 ? 'red' : 'green'}>{money(r.balance)}</Badge>
                )}
              </span>
            </button>
          ))}
          {!rows.length && <div className="px-3 py-3 text-center text-xs text-slate-400">—</div>}
        </div>
      )}
    </div>
  );
}

export function ItemSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { locale } = useApp();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      api.get(`/items?pageSize=20&search=${encodeURIComponent(q)}&status=active`).then((r) => setRows(r.data.rows)).catch(() => {});
    }, 200);
    return () => clearTimeout(id);
  }, [q]);

  const selected = rows.find((r) => String(r.id) === String(value));

  return (
    <div className="relative">
      <Input
        value={open ? q : selected ? `${locale === 'ar' && selected.name_ar ? selected.name_ar : selected.name}` : ''}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setQ('');
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={locale === 'ar' ? 'ابحث عن جهاز (اسم / SKU / باركود / تسلسل)…' : 'Search item (name / SKU / barcode / serial)…'}
      />
      {open && (
        <div className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {rows.map((r) => (
            <button
              type="button"
              key={r.id}
              className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              onMouseDown={() => {
                onChange(String(r.id));
                setOpen(false);
              }}
            >
              <span className="font-semibold text-slate-700 dark:text-slate-200">{locale === 'ar' && r.name_ar ? r.name_ar : r.name}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-slate-400" dir="ltr">{r.sku}</span>
                <Badge color={r.quantity > 0 ? 'green' : 'red'}>{num(r.quantity)}</Badge>
              </span>
            </button>
          ))}
          {!rows.length && <div className="px-3 py-3 text-center text-xs text-slate-400">—</div>}
        </div>
      )}
    </div>
  );
}

/** "Customer took a device for amount Y" — decreases stock, increases balance.
 *  Optionally records the money paid on the spot (payment + accounting in one go). */
export function RecordTakenModal({ open, onClose, customerId, onSaved }: { open: boolean; onClose: () => void; customerId?: string; onSaved?: () => void }) {
  const { t, toast, locale, can } = useApp();
  const [cust, setCust] = useState(customerId || '');
  const [itemId, setItemId] = useState('');
  const [itemText, setItemText] = useState('');
  const [qty, setQty] = useState(1);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [serials, setSerials] = useState('');
  const [notes, setNotes] = useState('');
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [item, setItem] = useState<any>(null);
  const canPay = can('payments.create');

  useEffect(() => {
    if (customerId) setCust(customerId);
  }, [customerId, open]);

  useEffect(() => {
    if (!itemId) {
      setItem(null);
      return;
    }
    api.get(`/items/${itemId}`).then((r) => {
      setItem(r.data);
      setAmount(r.data.selling_price ? String(Number(r.data.selling_price) * qty) : '');
    });
  }, [itemId]);

  useEffect(() => {
    if (item) setAmount(String(Number(item.selling_price) * qty));
  }, [qty]);

  const submit = async () => {
    if (!cust || (!itemId && !itemText.trim()) || !Number(amount)) {
      toast(locale === 'ar' ? 'أكمل الحقول المطلوبة' : 'Complete the required fields', 'err');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post('/assignments', {
        customer_id: cust,
        item_id: itemId || null,
        item_text: itemId ? null : itemText.trim(),
        quantity: qty,
        amount: Number(amount),
        paid_amount: Number(paid) || 0,
        payment_method: Number(paid) > 0 ? method : undefined,
        serial_numbers: serials.trim() || null,
        assigned_at: date,
        notes: notes.trim() || null,
      });
      const paidN = Number(paid) || 0;
      if (paidN > 0 && r.data?.new_balance != null) {
        toast(`${t('saved_ok')} — ${t('new_balance')}: ${money(r.data.new_balance)}`);
      } else {
        toast(t('saved_ok'));
      }
      onSaved?.();
      onClose();
      setItemId('');
      setItemText('');
      setQty(1);
      setAmount('');
      setSerials('');
      setNotes('');
      setPaid('');
      setMethod('cash');
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const remaining = Math.max(0, (Number(amount) || 0) - (Number(paid) || 0));

  return (
    <Modal open={open} onClose={onClose} title={t('record_taken')} wide>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('customer_name')} required className="sm:col-span-2">
          <CustomerSelect value={cust} onChange={setCust} />
        </Field>
        <Field label={t('pick_item')}>
          <ItemSelect value={itemId} onChange={setItemId} />
        </Field>
        <Field label={t('free_text_item')} hint={itemId ? undefined : locale === 'ar' ? 'سيتم استخدامه إن لم تختر جهازاً من المخزون' : 'Used if no inventory item is picked'}>
          <Input value={itemText} onChange={(e) => setItemText(e.target.value)} disabled={!!itemId} />
        </Field>
        <Field label={t('quantity')} required>
          <Input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} />
        </Field>
        <Field label={t('amount')} required hint={item ? `${locale === 'ar' ? 'المتوفر' : 'Available'}: ${num(item.quantity)}` : undefined}>
          <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('date')} required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" />
        </Field>
        <Field label={t('serial_numbers')}>
          <Input value={serials} onChange={(e) => setSerials(e.target.value)} />
        </Field>
        <Field label={t('notes')} className="sm:col-span-2">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
      </div>

      {canPay && (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/60 dark:bg-emerald-900/20">
          <div className="mb-3 text-xs font-extrabold text-emerald-700 dark:text-emerald-300">
            {locale === 'ar' ? '💰 دفع الآن (اختياري) — سيسجل دفعة على حساب العميل في نفس الوقت' : '💰 Paid now (optional) — records a customer payment at the same time'}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={locale === 'ar' ? 'المدفوع الآن' : 'Paid now'}>
              <div className="flex gap-1.5">
                {[0, 0.5, 1].map((f) => (
                  <button
                    type="button"
                    key={f}
                    className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-300"
                    onClick={() => setPaid(f === 0 ? '' : String(Math.round(Number(amount) * f)))}
                  >
                    {f === 0 ? (locale === 'ar' ? 'بدون' : 'None') : f === 0.5 ? (locale === 'ar' ? 'نصف' : 'Half') : (locale === 'ar' ? 'كامل' : 'Full')}
                  </button>
                ))}
              </div>
              <Input type="number" min={0} value={paid} onChange={(e) => setPaid(e.target.value)} dir="ltr" placeholder="0" />
            </Field>
            <Field label={t('method')}>
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">{t('cash')}</option>
                <option value="transfer">{t('transfer')}</option>
                <option value="other">{t('other')}</option>
              </Select>
            </Field>
          </div>
          {Number(amount) > 0 && (
            <div className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-300">
              {locale === 'ar' ? 'المتبقي على العميل:' : 'Customer remaining:'}{' '}
              <span dir="ltr" className="text-rose-600 dark:text-rose-400">{money(remaining)}</span>
            </div>
          )}
        </div>
      )}

      {item && (
        <div className="mt-2 rounded-xl bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          {locale === 'ar' ? 'سيتم خصم' : 'Stock will decrease by'} {qty} ← {num(item.quantity)} → {num(Number(item.quantity) - qty)}
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
        <Button onClick={submit} disabled={busy}>{busy ? t('loading') : t('save')}</Button>
      </div>
    </Modal>
  );
}

/** Payment — decreases balance, auto-creates accounting income. */
export function RecordPaymentModal({ open, onClose, customerId, onSaved }: { open: boolean; onClose: () => void; customerId?: string; onSaved?: () => void }) {
  const { t, toast, locale } = useApp();
  const [cust, setCust] = useState(customerId || '');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (customerId) setCust(customerId);
  }, [customerId, open]);

  const submit = async () => {
    if (!cust || !Number(amount)) {
      toast(locale === 'ar' ? 'أكمل الحقول المطلوبة' : 'Complete the required fields', 'err');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post('/payments', {
        customer_id: cust,
        amount: Number(amount),
        method,
        paid_at: date,
        notes: notes.trim() || null,
      });
      toast(`${t('saved_ok')} — ${t('receipt_no')}: ${r.data.payment.receipt_number} · ${t('new_balance')}: ${money(r.data.newBalance)}`);
      onSaved?.();
      onClose();
      setAmount('');
      setNotes('');
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('record_payment')}>
      <div className="space-y-4">
        <Field label={t('customer_name')} required>
          <CustomerSelect value={cust} onChange={setCust} />
        </Field>
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
        <Field label={t('notes')}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="success" onClick={submit} disabled={busy}>{busy ? t('loading') : t('save')}</Button>
      </div>
    </Modal>
  );
}
