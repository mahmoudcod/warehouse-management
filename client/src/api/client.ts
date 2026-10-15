import axios from 'axios';

const API_BASE = import.meta.env.PROD ? 'https://demoblog-h71e.onrender.com/api' : '/api';

export const api = axios.create({ baseURL: API_BASE });

// Retry on network errors (Neon cold start, temporary network issues)
const RETRY_CODES = ['ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND', 'ENETUNREACH', 'EAI_AGAIN'];
const isRetryable = (err: any) => 
  !err.response && (RETRY_CODES.includes(err.code) || err.message?.includes('Network Error') || err.message?.includes('Failed to fetch'));

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('wh_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    // Retry on network errors (Neon cold start)
    if (isRetryable(err) && err.config && !err.config.__retryCount) {
      err.config.__retryCount = 1;
      await new Promise(r => setTimeout(r, 3000)); // wait 3s for Neon to wake
      return api(err.config);
    }
    if (isRetryable(err) && err.config && err.config.__retryCount === 1) {
      err.config.__retryCount = 2;
      await new Promise(r => setTimeout(r, 8000)); // wait 8s more
      return api(err.config);
    }

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
