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
    if (value && !rows.some((r) => r.id === value)) {
      api.get(`/customers/${value}`).then((r) => {
        if (r.data) setRows((prev) => (prev.some((x) => x.id === r.data.id) ? prev : [r.data, ...prev]));
      }).catch(() => {});
    }
  }, [value, rows]);

  const selected = rows.find((r) => r.id === value);

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
                onChange(r.id);
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

  const selected = rows.find((r) => r.id === value);

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
                onChange(r.id);
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

/** "Customer took a device for amount Y" — decreases stock, increases balance. */
export function RecordTakenModal({ open, onClose, customerId, onSaved }: { open: boolean; onClose: () => void; customerId?: string; onSaved?: () => void }) {
  const { t, toast, locale } = useApp();
  const [cust, setCust] = useState(customerId || '');
  const [itemId, setItemId] = useState('');
  const [itemText, setItemText] = useState('');
  const [qty, setQty] = useState(1);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [serials, setSerials] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [item, setItem] = useState<any>(null);

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
      await api.post('/assignments', {
        customer_id: cust,
        item_id: itemId || null,
        item_text: itemId ? null : itemText.trim(),
        quantity: qty,
        amount: Number(amount),
        serial_numbers: serials.trim() || null,
        assigned_at: date,
        notes: notes.trim() || null,
      });
      toast(t('saved_ok'));
      onSaved?.();
      onClose();
      setItemId('');
      setItemText('');
      setQty(1);
      setAmount('');
      setSerials('');
      setNotes('');
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

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
