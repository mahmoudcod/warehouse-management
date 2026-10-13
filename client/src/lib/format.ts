/** Central format helpers: EGP currency, Cairo-timezone dates, numbers. */

const egp = new Intl.NumberFormat('en-EG', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function money(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  return `${egp.format(n)} EGP`;
}

export function num(v: number | string | null | undefined, digits = 0): string {
  return new Intl.NumberFormat('en-EG', { maximumFractionDigits: digits }).format(Number(v ?? 0));
}

/** Format a date (ISO string or Date) in Africa/Cairo. */
export function fmtDate(v: string | Date | null | undefined, withTime = false): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(d);
}

function cairoYMD(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return parts;
}

export function today(): string {
  return cairoYMD(new Date());
}

export function monthStart(): string {
  const now = new Date();
  const ymd = cairoYMD(now);
  return `${ymd.slice(0, 7)}-01`;
}

export function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return cairoYMD(d);
}
