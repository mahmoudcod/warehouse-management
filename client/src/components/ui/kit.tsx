import React, { useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, Inbox, Loader2, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useApp } from '../../context/AppContext';

/* ---------------- basic primitives ---------------- */

export function Button({
  children, onClick, variant = 'primary', size = 'md', type = 'button', disabled, className = '', icon: Icon,
}: {
  children?: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
  size?: 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
  icon?: React.ElementType;
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-primary-400/60 disabled:opacity-50 disabled:cursor-not-allowed select-none';
  const variants = {
    primary: 'bg-primary-600 text-white hover:bg-primary-700 active:scale-[.98] shadow-sm',
    secondary:
      'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-700',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 active:scale-[.98]',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[.98]',
    ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
  };
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2.5 text-sm', lg: 'px-5 py-3 text-base' };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}>
      {Icon && <Icon size={size === 'sm' ? 14 : 17} />}
      {children}
    </button>
  );
}

export function Field({ label, children, required, hint, className = '' }: { label?: string; children?: React.ReactNode; required?: boolean; hint?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      {label && (
        <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          {label} {required && <span className="text-rose-500">*</span>}
        </span>
      )}
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 transition focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className || ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${props.className || ''}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputCls} ${props.className || ''}`} rows={props.rows || 3} />;
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-900 ${className}`}>
      {children}
    </div>
  );
}

const badgeStyles: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  red: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  blue: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
};

export function Badge({ children, color = 'slate' }: { children: React.ReactNode; color?: keyof typeof badgeStyles }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${badgeStyles[color]}`}>{children}</span>;
}

/* ---------------- modal / confirm ---------------- */

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl dark:bg-slate-900 sm:rounded-3xl sm:p-6 ${
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'
        }`}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50">{title}</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open, onClose, onConfirm, title, message, needReason, danger = true, confirmLabel,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
  title: string;
  message?: string;
  needReason?: boolean;
  danger?: boolean;
  confirmLabel?: string;
}) {
  const { t } = useApp();
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setErr(false);
    }
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {message && <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{message}</p>}
      {needReason && (
        <Field label={t('reason_required')} required>
          <Textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setErr(false);
            }}
            rows={2}
          />
          {err && <span className="mt-1 block text-xs text-rose-500">{t('required_field')}</span>}
        </Field>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          onClick={() => {
            if (needReason && reason.trim().length < 3) {
              setErr(true);
              return;
            }
            onConfirm(needReason ? reason.trim() : undefined);
            onClose();
          }}
        >
          {confirmLabel || t('confirm')}
        </Button>
      </div>
    </Modal>
  );
}

/* ---------------- data table: table on desktop, stacked cards on mobile ---------------- */

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  hideOnMobile?: boolean;
  className?: string;
  sortable?: boolean;
}

export function DataTable<T extends { id?: string }>({
  columns, rows, loading, empty, onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  empty?: React.ReactNode;
  onRowClick?: (row: T) => void;
}) {
  const { t } = useApp();
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  };

  const sortedRows = React.useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a: any, b: any) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const comp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortOrder === 'asc' ? comp : -comp;
    });
  }, [rows, sortKey, sortOrder]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-400">
        <Loader2 className="animate-spin" size={18} /> {t('loading')}
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-14 text-slate-400">
        <Inbox size={36} strokeWidth={1.5} />
        <p className="text-sm font-semibold">{t('no_data')}</p>
        <p className="text-xs">{empty || t('no_data_hint')}</p>
      </div>
    );
  }
  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => c.sortable !== false && c.key !== 'act' && handleSort(c.key)}
                  className={`px-4 py-3 text-start font-bold whitespace-nowrap select-none ${c.sortable !== false && c.key !== 'act' ? 'cursor-pointer hover:text-primary-600 dark:hover:text-primary-400' : ''} ${c.className || ''}`}
                >
                  <div className="inline-flex items-center gap-1.5">
                    <span>{c.label}</span>
                    {c.sortable !== false && c.key !== 'act' && (
                      sortKey === c.key ? (
                        sortOrder === 'asc' ? <ArrowUp size={12} className="text-primary-600" /> : <ArrowDown size={12} className="text-primary-600" />
                      ) : (
                        <ArrowUpDown size={12} className="opacity-40" />
                      )
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, i) => (
              <tr
                key={row.id ?? i}
                onClick={() => onRowClick?.(row)}
                className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${onRowClick ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50' : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'}`}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 align-middle ${c.className || ''}`}>
                    {c.render ? c.render(row) : (row as any)[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile stacked cards */}
      <div className="flex flex-col gap-3 p-3 md:hidden">
        {sortedRows.map((row, i) => (
          <div
            key={row.id ?? i}
            onClick={() => onRowClick?.(row)}
            className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 ${onRowClick ? 'active:scale-[.99]' : ''}`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="font-bold text-slate-900 dark:text-slate-50">{columns[0]?.render ? columns[0].render(row) : (row as any)[columns[0]?.key]}</div>
            </div>
            <div className="flex flex-col gap-1.5">
              {columns.slice(1).filter((c) => !c.hideOnMobile).map((c) => (
                <div key={c.key} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="shrink-0 text-slate-400">{c.label}</span>
                  <span className="text-end font-medium text-slate-700 dark:text-slate-200">{c.render ? c.render(row) : (row as any)[c.key]}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const { t, locale } = useApp();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize && page === 1) return null;
  const Chevron = locale === 'ar' ? ChevronLeft : ChevronRight;
  const ChevronB = locale === 'ar' ? ChevronRight : ChevronLeft;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
      <span>
        {t('showing')} {Math.min(total, (page - 1) * pageSize + 1)}–{Math.min(total, page * pageSize)} {t('of')} {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-40 dark:border-slate-700"
        >
          <ChevronB size={14} />
        </button>
        <span className="px-2 font-semibold">
          {t('page')} {page} / {pages}
        </span>
        <button
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
          className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-40 dark:border-slate-700"
        >
          <Chevron size={14} />
        </button>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-50 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string; badge?: number }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 dark:border-slate-700 dark:bg-slate-900">
      {tabs.map((tb) => (
        <button
          key={tb.key}
          onClick={() => onChange(tb.key)}
          className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition sm:text-sm ${
            active === tb.key
              ? 'bg-primary-600 text-white shadow-sm'
              : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
          }`}
        >
          {tb.label}
          {tb.badge != null && tb.badge > 0 && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-extrabold ${active === tb.key ? 'bg-white/25' : 'bg-rose-100 text-rose-600 dark:bg-rose-900/50 dark:text-rose-300'}`}>
              {tb.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="pointer-events-none fixed bottom-4 start-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4 rtl:translate-x-1/2">
      {toasts.map((x) => (
        <div
          key={x.id}
          className={`pointer-events-auto flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-xl ${
            x.kind === 'ok' ? 'bg-emerald-600' : 'bg-rose-600'
          }`}
        >
          {x.kind === 'err' && <AlertTriangle size={16} />}
          {x.text}
        </div>
      ))}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-24 text-primary-500">
      <Loader2 className="animate-spin" size={28} />
    </div>
  );
}
