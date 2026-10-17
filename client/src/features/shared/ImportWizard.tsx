import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet } from 'lucide-react';
import { api, errMsg } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { money, num } from '../../lib/format';
import { Badge, Button, Field, Modal, Select, Textarea } from '../../components/ui/kit';

type ImportType = 'items' | 'customers';

interface RowError {
  row: number;
  error: string;
}

const MAX_ROWS = 500;

const ITEM_FIELDS = ['name', 'name_ar', 'sku', 'barcode', 'category', 'brand', 'model', 'cost_price', 'selling_price', 'quantity', 'min_stock_level', 'max_stock_level'];
const CUSTOMER_FIELDS = ['name', 'phone', 'national_id', 'address', 'notes'];
const FIELDS: Record<ImportType, string[]> = { items: ITEM_FIELDS, customers: CUSTOMER_FIELDS };

const NUMERIC_FIELDS = new Set(['cost_price', 'selling_price', 'quantity', 'min_stock_level', 'max_stock_level']);

/** Canonical field -> existing translation key for its label. */
const LABEL_KEY: Record<string, string> = {
  name: 'name',
  name_ar: 'name_ar',
  sku: 'sku',
  barcode: 'barcode',
  category: 'category',
  brand: 'brand',
  model: 'model',
  cost_price: 'cost_price',
  selling_price: 'selling_price',
  quantity: 'quantity',
  min_stock_level: 'min_stock',
  max_stock_level: 'max_stock',
  phone: 'phone',
  national_id: 'national_id',
  address: 'address',
  notes: 'notes',
};

/** English + Arabic header synonyms per canonical field (matched normalized). */
const SYNONYMS: Record<string, string[]> = {
  name: ['name', 'item name', 'product name', 'product', 'item', 'الاسم', 'اسم الصنف', 'اسم المنتج', 'الصنف'],
  name_ar: ['name ar', 'arabic name', 'name arabic', 'الاسم بالعربية', 'الاسم العربي'],
  sku: ['sku', 'code', 'item code', 'product code', 'رقم الصنف', 'الكود', 'كود الصنف'],
  barcode: ['barcode', 'bar code', 'الباركود', 'باركود'],
  category: ['category', 'التصنيف', 'الفئة'],
  brand: ['brand', 'الماركة', 'العلامة التجارية'],
  model: ['model', 'الموديل'],
  cost_price: ['cost price', 'cost', 'unit cost', 'purchase price', 'سعر التكلفة', 'التكلفة', 'سعر الشراء'],
  selling_price: ['selling price', 'price', 'sale price', 'unit price', 'سعر البيع', 'السعر'],
  quantity: ['quantity', 'qty', 'stock', 'الكمية', 'الكميه', 'المخزون'],
  min_stock_level: ['min stock level', 'min stock', 'minimum stock', 'الحد الأدنى', 'الحد الادنى'],
  max_stock_level: ['max stock level', 'max stock', 'maximum stock', 'الحد الأقصى', 'الحد الاقصى'],
  phone: ['phone', 'mobile', 'telephone', 'الهاتف', 'التليفون', 'الموبايل', 'رقم الهاتف'],
  national_id: ['national id', 'id number', 'الرقم القومي', 'الرقم القومى'],
  address: ['address', 'العنوان'],
  notes: ['notes', 'note', 'ملاحظات', 'ملاحظة'],
};

function normalizeHeader(s: string): string {
  return String(s ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[\s_]+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Auto-match file columns to canonical fields by header name (EN/AR), first-come-first-claimed. */
function autoMap(headers: string[], fields: string[]): Record<string, string> {
  const normed = headers.map(normalizeHeader);
  const used = new Set<number>();
  const map: Record<string, string> = {};
  for (const f of fields) {
    const syns = (SYNONYMS[f] || []).map(normalizeHeader);
    let hit = -1;
    for (let i = 0; i < normed.length; i++) {
      if (used.has(i) || !normed[i]) continue;
      if (syns.includes(normed[i])) {
        hit = i;
        break;
      }
    }
    if (hit >= 0) {
      map[f] = String(hit);
      used.add(hit);
    } else {
      map[f] = '';
    }
  }
  return map;
}

/** Detect comma / semicolon / tab from the first non-empty line (quote-aware). */
function detectSeparator(text: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
  const counts: [string, number][] = [
    [',', 0],
    [';', 0],
    ['\t', 0],
  ];
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ) for (const c of counts) if (c[0] === ch) c[1]++;
  }
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** Quote-aware CSV parser: "a,""b"",c" -> [a,"b",c]; multi-line quoted cells supported. */
function parseCsv(text: string): string[][] {
  const sep = detectSeparator(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQ = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function missingName(o: any): boolean {
  return !String(o?.name ?? '').trim();
}

/** Number() for imported cells — strips thousands separators/spaces (app formats en-EG: "18,000"). */
function toNum(v: string): number {
  return Number(String(v ?? '').replace(/[,\s\u00A0]/g, ''));
}

/** 3-step import wizard: source file/paste -> column mapping -> review & import. */
export default function ImportWizard({ type, open, onClose, onDone }: { type: 'items' | 'customers'; open: boolean; onClose: () => void; onDone: () => void }) {
  const { t, toast, locale } = useApp();
  const [step, setStep] = useState(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [source, setSource] = useState('');
  const [paste, setPaste] = useState('');
  const [parseErr, setParseErr] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [tmplBusy, setTmplBusy] = useState(false);
  const [result, setResult] = useState<{ inserted: number; errors: RowError[] } | null>(null);

  const fields = FIELDS[type];

  // Fresh state on every open (and if the target type changes while open)
  useEffect(() => {
    if (open) {
      setStep(0);
      setHeaders([]);
      setDataRows([]);
      setSource('');
      setPaste('');
      setParseErr('');
      setMapping({});
      setBusy(false);
      setTmplBusy(false);
      setResult(null);
    }
  }, [open, type]);

  /** Validate + store a parsed sheet. Returns true when usable. */
  const applyParsed = (aoa: string[][], label: string): boolean => {
    const nonEmpty = aoa.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
    if (nonEmpty.length < 2) {
      setParseErr(
        locale === 'ar'
          ? 'لم يتم العثور على صفوف بيانات — تأكد أن الصف الأول يحتوي عناوين الأعمدة'
          : 'No data rows found — make sure the first row contains the column headers'
      );
      setHeaders([]);
      setDataRows([]);
      setSource('');
      return false;
    }
    const [hdr, ...rest] = nonEmpty;
    if (rest.length > MAX_ROWS) {
      setParseErr(
        locale === 'ar'
          ? `الحد الأقصى ${MAX_ROWS} صف — البيانات تحتوي ${rest.length} صف. قسّمها إلى دفعات أصغر.`
          : `Maximum ${MAX_ROWS} rows — the data has ${rest.length}. Split it into smaller batches.`
      );
      setHeaders([]);
      setDataRows([]);
      setSource('');
      return false;
    }
    setHeaders(hdr.map((h) => String(h ?? '').trim()));
    setDataRows(rest.map((r) => r.map((c) => String(c ?? ''))));
    setSource(label);
    setParseErr('');
    return true;
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!f) return;
    setParseErr('');
    try {
      const name = f.name.toLowerCase();
      if (/\.(xlsx|xls)$/.test(name)) {
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf);
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws) throw new Error('empty workbook');
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false }) as any[][];
        const grid = aoa.map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? '' : String(c))) : []));
        applyParsed(grid, f.name);
      } else {
        const text = await f.text();
        applyParsed(parseCsv(text), f.name);
      }
    } catch {
      setParseErr(
        locale === 'ar'
          ? 'تعذر قراءة الملف — تأكد أنه ملف CSV أو Excel صالح'
          : 'Could not read the file — make sure it is a valid CSV or Excel file'
      );
    }
  };

  const goMap = () => {
    if (paste.trim()) {
      // pasted data wins over a previously picked file
      if (applyParsed(parseCsv(paste), locale === 'ar' ? 'نص ملصق' : 'Pasted text')) setStep(1);
      return;
    }
    if (dataRows.length) setStep(1);
  };

  const downloadTemplate = async () => {
    setTmplBusy(true);
    try {
      // fetched through the axios instance so the Bearer token is attached (plain <a href> would 401)
      const r = await api.get(`/import/template/${type}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}-template.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setTmplBusy(false);
    }
  };

  const mapped = useMemo(() => {
    const chosen = fields.filter((f) => (mapping[f] ?? '') !== '');
    const rows = dataRows.map((r) => {
      const obj: any = {};
      for (const f of chosen) {
        const cell = r[Number(mapping[f])] ?? '';
        obj[f] = NUMERIC_FIELDS.has(f) ? toNum(cell) : String(cell).trim();
      }
      return obj;
    });
    return { chosen, rows };
  }, [dataRows, mapping, fields]);

  const badCount = useMemo(() => mapped.rows.filter(missingName).length, [mapped]);
  const nameMapped = (mapping.name ?? '') !== '';

  const doImport = async () => {
    setBusy(true);
    try {
      const r = await api.post('/import', { type, rows: mapped.rows });
      const inserted = Number(r.data?.inserted ?? 0);
      const errors: RowError[] = Array.isArray(r.data?.errors) ? r.data.errors : [];
      onDone();
      if (!errors.length) {
        toast(`${t('import_inserted')} ${num(inserted)} ${t('import_rows')}`);
        onClose();
      } else {
        setResult({ inserted, errors });
      }
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const steps = [t('import_step_file'), t('import_step_map'), t('import_step_review')];

  const renderCell = (o: any, f: string) => {
    const v = o[f];
    if (NUMERIC_FIELDS.has(f)) {
      const n = Number(v);
      if (!Number.isFinite(n)) return <span dir="ltr">—</span>;
      return (
        <span dir="ltr" className="font-bold">
          {f === 'cost_price' || f === 'selling_price' ? money(n) : num(n)}
        </span>
      );
    }
    return String(v ?? '') || '—';
  };

  return (
    <Modal open={open} onClose={onClose} title={t('import_title')} wide>
      {/* stepper */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {steps.map((label, i) => (
          <div
            key={label}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-extrabold ${
              i === step && !result
                ? 'bg-primary-600 text-white'
                : i < step || result
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
            }`}
          >
            {(i < step || result) && <CheckCircle2 size={12} />}
            {label}
          </div>
        ))}
      </div>

      {result ? (
        /* ---------- result view ---------- */
        <div>
          <h4 className="mb-3 text-sm font-extrabold text-slate-700 dark:text-slate-200">{t('import_result')}</h4>
          <div className="mb-3 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-extrabold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300">
            <CheckCircle2 size={16} />
            {t('import_inserted')} {num(result.inserted)} {t('import_rows')}
          </div>
          {result.errors.length > 0 && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-900/20">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-extrabold text-rose-700 dark:text-rose-300">
                <AlertTriangle size={14} /> {num(result.errors.length)} {t('import_errors')}
              </div>
              <ul className="max-h-44 list-inside list-disc space-y-1 overflow-y-auto text-xs text-rose-600 dark:text-rose-300">
                {result.errors.map((er, i) => (
                  <li key={i}>
                    <span dir="ltr" className="inline-block">
                      row {er.row}: {er.error}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-5 flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              {t('close')}
            </Button>
          </div>
        </div>
      ) : step === 0 ? (
        /* ---------- step 1: source ---------- */
        <div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/60 px-4 py-6 text-center transition hover:border-primary-400 hover:bg-primary-50/40 dark:border-slate-600 dark:bg-slate-800/40 dark:hover:border-primary-500">
              <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onFile} />
              <FileSpreadsheet size={22} className="text-primary-500" />
              <span className="text-sm font-extrabold text-slate-700 dark:text-slate-200">{t('import_choose_file')}</span>
              {source && dataRows.length > 0 && (
                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400" dir="ltr">
                  {source} — {num(dataRows.length)} {t('import_rows')}
                </span>
              )}
            </label>
            <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/60 px-4 py-6 dark:border-slate-600 dark:bg-slate-800/40">
              <Button variant="secondary" icon={Download} onClick={downloadTemplate} disabled={tmplBusy}>
                {tmplBusy ? t('loading') : t('import_download_template')}
              </Button>
              <span className="text-[11px] text-slate-400">CSV</span>
            </div>
          </div>

          <div className="my-4 flex items-center gap-3 text-[11px] font-bold text-slate-400">
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            {t('import_or_paste')}
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          </div>

          <Field>
            <Textarea
              dir="ltr"
              rows={6}
              className="font-mono text-xs"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={locale === 'ar' ? 'name,phone\nمحمد أحمد,01000000001' : 'name,phone\nJohn,01000000001'}
            />
          </Field>

          {parseErr && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-rose-600 dark:bg-rose-900/30 dark:text-rose-300">
              <AlertTriangle size={14} /> {parseErr}
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button onClick={goMap} disabled={!dataRows.length && !paste.trim()}>
              {t('next')}
            </Button>
          </div>
        </div>
      ) : step === 1 ? (
        /* ---------- step 2: mapping ---------- */
        <div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <Field key={f} label={t(LABEL_KEY[f] || f)} required={f === 'name'}>
                <Select value={mapping[f] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value }))}>
                  <option value="">{t('import_ignore')}</option>
                  {headers.map((h, i) => (
                    <option key={i} value={String(i)}>
                      {h.trim() || `#${i + 1}`}
                    </option>
                  ))}
                </Select>
                {(mapping[f] ?? '') !== '' && (
                  <span className="mt-1 block truncate text-[11px] text-slate-400" dir="auto">
                    {t('import_mapped_to')} {headers[Number(mapping[f])]}
                  </span>
                )}
              </Field>
            ))}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStep(0)} disabled={busy}>
              {t('back')}
            </Button>
            <Button onClick={() => setStep(2)} disabled={!nameMapped}>
              {t('next')}
            </Button>
          </div>
        </div>
      ) : (
        /* ---------- step 3: review & import ---------- */
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-extrabold text-slate-700 dark:text-slate-200">{t('import_preview')}</h4>
            <span className="flex items-center gap-2">
              <Badge color="slate">
                {num(mapped.rows.length)} {t('import_rows')}
              </Badge>
              {badCount > 0 ? (
                <Badge color="red">
                  {num(badCount)} {t('required_field')}: {t('name')}
                </Badge>
              ) : (
                <Badge color="green">{t('import_ready')}</Badge>
              )}
            </span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-start text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                  {mapped.chosen.map((f) => (
                    <th key={f} className="whitespace-nowrap px-3 py-2 text-start font-bold">
                      {t(LABEL_KEY[f] || f)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mapped.rows.slice(0, 10).map((r, i) => (
                  <tr key={i} className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${missingName(r) ? 'bg-rose-50 dark:bg-rose-900/20' : ''}`}>
                    {mapped.chosen.map((f) => (
                      <td key={f} className="whitespace-nowrap px-3 py-2 text-start text-slate-700 dark:text-slate-200">
                        {renderCell(r, f)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {badCount > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-rose-500">
              <AlertTriangle size={12} /> {t('required_field')}: {t('name')} — {num(badCount)} {t('import_rows')}
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStep(1)} disabled={busy}>
              {t('back')}
            </Button>
            <Button variant="success" onClick={doImport} disabled={busy || !mapped.rows.length}>
              {busy ? t('loading') : t('import_start')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Also exported named — consumers import it both ways.
export { ImportWizard };
