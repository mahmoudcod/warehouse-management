import axios from 'axios';

const API_BASE = import.meta.env.PROD ? 'https://warehouse-management-server.fly.dev/api' : '/api';

export const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('wh_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('wh_token');
      localStorage.removeItem('wh_user');
      if (!location.hash.includes('#/login')) {
        location.hash = '#/login';
        location.reload();
      }
    }
    return Promise.reject(err);
  }
);

export function errMsg(e: any): string {
  return e?.response?.data?.error || e?.message || 'Something went wrong';
}

/** Download any array of rows as CSV (Excel-friendly, with BOM for Arabic). */
export function exportCsv(filename: string, rows: Record<string, any>[], headers?: Record<string, string>) {
  if (!rows.length) return;
  const cols = headers ? Object.keys(headers) : Object.keys(rows[0]);
  const head = (headers ? cols.map((c) => headers[c]) : cols).join(',');
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + head + '\n' + body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
