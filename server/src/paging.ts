import { Request } from 'express';
import { query } from './db';

export interface ListParams {
  page: number;
  pageSize: number;
  offset: number;
  search: string;
  sort: string;
  order: 'asc' | 'desc';
  from?: string;
  to?: string;
}

/**
 * Standard list parsing: ?page=1&pageSize=25&search=&sort=created_at&order=desc&from=&to=
 * sort must be whitelisted by the caller via sortable map.
 */
export function parseList(req: Request, sortable: Record<string, string>, defaultSort: string): ListParams {
  const page = Math.max(1, parseInt(String(req.query.page || '1')) || 1);
  const pageSize = Math.min(100, Math.max(5, parseInt(String(req.query.pageSize || '25')) || 25));
  const search = String(req.query.search || '').trim();
  let sortKey = String(req.query.sort || defaultSort);
  if (!sortable[sortKey]) sortKey = defaultSort;
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    search,
    sort: sortable[sortKey] || Object.values(sortable)[0],
    order: req.query.order === 'asc' ? 'asc' : 'desc',
    from: req.query.from ? String(req.query.from) : undefined,
    to: req.query.to ? String(req.query.to) : undefined,
  };
}

export interface ListResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export async function runList<T>(
  baseSql: string, // "... from x where <conditions already applied>"
  countSql: string,
  params: any[],
  lp: ListParams
): Promise<ListResult<T>> {
  const countR = await query(countSql, params);
  const rowsR = await query(
    `${baseSql} order by ${lp.sort} ${lp.order} nulls last limit ${lp.pageSize} offset ${lp.offset}`,
    params
  );
  return { rows: rowsR.rows as T[], total: parseInt(countR.rows[0].count), page: lp.page, pageSize: lp.pageSize };
}
