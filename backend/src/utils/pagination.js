// Parses ?page=&pageSize= safely: page >= 1, 1 <= pageSize <= 100
export function parsePagination(q = {}, defaultPageSize = 20) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize, 10) || defaultPageSize));
  return { page, pageSize };
}

export function parseSort(q = {}, defaultSort = 'created_at') {
  const sort = typeof q.sort === 'string' && q.sort ? q.sort : defaultSort;
  const dir = String(q.dir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  return { sort, dir };
}

export function reqMetaFrom(req) {
  return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: req.id };
}
