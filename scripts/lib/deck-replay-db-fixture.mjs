// v6.588：Mongo 基本運算替身；執行產品 pipeline／handler，不另寫一份統計功能。
import assert from 'node:assert/strict';
export const clone = value => structuredClone(value);
export function functionSource(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, '找不到產品函式 ' + name);
  let i = source.indexOf('(', start), depth = 0;
  for (; i < source.length; i++) { if (source[i] === '(') depth++; if (source[i] === ')' && --depth === 0) break; }
  const body = source.indexOf('{', i); depth = 0;
  for (i = body; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(source.slice(start - 6, start) === 'async ' ? start - 6 : start, i + 1);
  }
  throw new Error('產品函式括號不完整 ' + name);
}
function field(doc, path) {
  if (!path) return doc;
  const [key, ...rest] = path.split('.');
  if (Array.isArray(doc)) return doc.map(d => field(d, path));
  return field(doc?.[key], rest.join('.'));
}
function value(expr, doc, vars = {}) {
  if (typeof expr === 'string' && expr.startsWith('$$')) return vars[expr.slice(2)];
  if (typeof expr === 'string' && expr.startsWith('$')) return field(doc, expr.slice(1));
  if (expr && typeof expr === 'object' && !Array.isArray(expr)) {
    if ('$eq' in expr) return value(expr.$eq[0], doc, vars) === value(expr.$eq[1], doc, vars);
    if ('$ifNull' in expr) return value(expr.$ifNull[0], doc, vars) ?? value(expr.$ifNull[1], doc, vars);
    if ('$arrayElemAt' in expr) return value(expr.$arrayElemAt[0], doc, vars)?.[value(expr.$arrayElemAt[1], doc, vars)];
  }
  return expr;
}
function match(doc, query, vars = {}) {
  return Object.entries(query).every(([key, wanted]) => {
    if (key === '$and') return wanted.every(q => match(doc, q, vars));
    if (key === '$or') return wanted.some(q => match(doc, q, vars));
    if (key === '$expr') return value(wanted, doc, vars);
    const got = field(doc, key);
    if (wanted && typeof wanted === 'object') {
      return Object.entries(wanted).every(([op, arg]) => {
        if (op === '$ne') return got !== arg && !(arg === null && got == null);
        if (op === '$in') return Array.isArray(got) ? got.some(g => arg.includes(g)) : arg.includes(got);
        if (op === '$gt') return got > arg;
        if (op === '$regex') return new RegExp(arg, wanted.$options || '').test(got || '');
        if (op === '$options') return true;
        throw new Error('Mongo 替身未實作條件 ' + op);
      });
    }
    return wanted === null ? got == null : got === wanted;
  });
}
function sortRows(rows, spec) {
  return rows.sort((a, b) => {
    for (const [key, direction] of Object.entries(spec)) {
      const x = field(a, key) ?? 0, y = field(b, key) ?? 0;
      if (x !== y) return (x < y ? -1 : 1) * direction;
    }
    return 0;
  });
}
function project(doc, spec) {
  const keys = Object.keys(spec).filter(k => spec[k]);
  if (keys.length) return Object.fromEntries(keys.map(k => [k, field(doc, k)]));
  const out = clone(doc); for (const k of Object.keys(spec)) delete out[k]; return out;
}
function pipeline(rows, stages, collections, vars = {}) {
  let result = clone(rows);
  for (const stage of stages) {
    if (stage.$match) result = result.filter(d => match(d, stage.$match, vars));
    else if (stage.$sort) result = sortRows(result, stage.$sort);
    else if (stage.$skip != null) result = result.slice(stage.$skip);
    else if (stage.$limit != null) result = result.slice(0, stage.$limit);
    else if (stage.$project) result = result.map(d => project(d, stage.$project));
    else if (stage.$count) result = result.length ? [{ [stage.$count]: result.length }] : [];
    else if (stage.$addFields) result = result.map(d => ({ ...d, ...Object.fromEntries(Object.entries(stage.$addFields).map(([k, v]) => [k, value(v, d, vars)])) }));
    else if (stage.$lookup) {
      const l = stage.$lookup;
      result = result.map(d => ({ ...d, [l.as]: pipeline(collections[l.from], l.pipeline, collections, Object.fromEntries(Object.entries(l.let).map(([k, v]) => [k, value(v, d, vars)]))) }));
    } else if (stage.$group) {
      const groups = new Map();
      for (const d of result) {
        const id = value(stage.$group._id, d, vars), row = groups.get(id) || { _id: id };
        for (const [key, expr] of Object.entries(stage.$group)) if (key !== '_id') {
          assert.ok('$sum' in expr, '只需要通用 $sum'); row[key] = (row[key] || 0) + value(expr.$sum, d, vars);
        }
        groups.set(id, row);
      }
      result = [...groups.values()];
    } else if (stage.$facet) result = [Object.fromEntries(Object.entries(stage.$facet).map(([k, p]) => [k, pipeline(result, p, collections, vars)]))];
    else throw new Error('Mongo 替身未實作階段 ' + Object.keys(stage));
  }
  return result;
}
export function deckReplayServer(source, data) {
  const collections = clone(data), calls = [];
  function collection(name) {
    return {
      find(query, options = {}) {
        calls.push({ name, op: 'find', query: clone(query), options });
        let rows = collections[name].filter(d => match(d, query));
        const cursor = {
          sort(s) { rows = sortRows(rows.slice(), s); return cursor; },
          skip(n) { rows = rows.slice(n); return cursor; },
          limit(n) { rows = rows.slice(0, n); return cursor; },
          async toArray() { return rows.map(d => project(d, options.projection || {})); },
        }; return cursor;
      },
      async countDocuments(query) { calls.push({ name, op: 'count' }); return collections[name].filter(d => match(d, query)).length; },
      aggregate(stages) { calls.push({ name, op: 'aggregate', stages: clone(stages) }); return { async toArray() { return pipeline(collections[name], stages, collections); } }; },
      async findOne(query) { return clone(collections[name].find(d => match(d, query)) || null); },
      async updateOne(query, update) { const d = collections[name].find(d => match(d, query)); if (d) Object.assign(d, update.$set); return { matchedCount: d ? 1 : 0 }; },
    };
  }
  const handlers = new Map();
  const app = { locals: {}, get(path, handler) { handlers.set('GET ' + path, handler); }, post(path, handler) { handlers.set('POST ' + path, handler); } };
  const helper = source.match(/    \/\/ >>> v171-deck-post-replay-stats\n([\s\S]*?)    \/\/ <<< v171-deck-post-replay-stats/);
  if (helper) new Function('app', '_dprPosts', '_dprCol', helper[1])(app, collection('deckPosts'), collection('deckPostReplays'));
  const start = source.indexOf('      const _dpListCache = new Map();');
  const end = source.indexOf("      app.get('/api/deck-posts/:id'", start);
  assert.ok(start > 0 && end > start, '列表 handler 定位');
  const names = ['dpPublic', 'dpSearchTokens', 'dpSearchEscape', 'dpTokenOr'];
  const defs = names.map(n => functionSource(source, n)).join('\n');
  new Function('app', 'DPOSTS', 'DPCOMM', 'DP_LIST_TTL', 'dpRate', 'dpIp', 'dpCardNamePairs', 'dpCardIdsForToken', defs + '\n' + source.slice(start, end))(
    app, collection('deckPosts'), { async distinct() { return []; } }, 30000, () => true, () => 'fixture', () => [], () => []);
  const removeStart = source.indexOf("    app.post('/api/deck-posts-replays/remove',");
  const removeEnd = source.indexOf('    // <<< v170-deck-post-replays', removeStart);
  if (removeStart > 0) new Function('app', '_dprCol', '_dprPosts', 'dprSoftId', 'isTournAdmin', source.slice(removeStart, removeEnd))(
    app, collection('deckPostReplays'), collection('deckPosts'), async req => req.identity, () => false);
  async function request(query = {}, method = 'GET', path = '/api/deck-posts', extra = {}) {
    let payload, status = 200;
    const res = { set() {}, status(n) { status = n; return res; }, json(x) { payload = x; return res; } };
    await handlers.get(method + ' ' + path)({ query, ...extra }, res);
    assert.equal(status, 200, JSON.stringify(payload));
    return payload;
  }
  return { request, calls, collections, app };
}
