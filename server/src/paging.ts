import { Request } from 'express';
import { strip } from './db';

export interface ListParams {
  page: number;
  pageSize: number;
  offset: number;
  search: string;
  sort: string; // whitelisted sort key (mongo field name or caller-defined)
  order: 'asc' | 'desc';
  from?: string;
  to?: string;
}

/**
 * Standard list parsing: ?page=1&pageSize=25&search=&sort=created_at&order=desc&from=&to=
 * sort must be whitelisted by the caller via the sortable map (values are now
 * document field names or a caller-defined key used with runAggList).
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

/** Paginate a plain mongoose model query (optionally populating refs). */
export async function runList<T>(
  model: any,
  filter: any,
  lp: ListParams,
  populate?: any
): Promise<ListResult<T>> {
  const total = await model.countDocuments(filter);
  const q = model
    .find(filter)
    .sort({ [lp.sort]: lp.order === 'asc' ? 1 : -1 })
    .skip(lp.offset)
    .limit(lp.pageSize);
  if (populate) q.populate(populate);
  const rows = (await q.lean()).map(strip);
  return { rows, total, page: lp.page, pageSize: lp.pageSize };
}

/**
 * Paginate an aggregation pipeline. `pipeline` produces the joined/filtered rows;
 * sort/limit/count are appended here. Sort key must be a field present on the
 * joined rows (e.g. after $lookup flattening).
 */
export async function runAggList<T>(
  model: any,
  pipeline: any[],
  sortField: string,
  lp: ListParams
): Promise<ListResult<T>> {
  const res = await model.aggregate([
    ...pipeline,
    {
      $facet: {
        rows: [
          { $sort: { [sortField]: lp.order === 'asc' ? 1 : -1, id: -1 } },
          { $skip: lp.offset },
          { $limit: lp.pageSize },
          { $unset: ['_id'] },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ]);
  const f = res[0] ?? { rows: [], total: [] };
  return { rows: f.rows as T[], total: f.total[0]?.count ?? 0, page: lp.page, pageSize: lp.pageSize };
}
