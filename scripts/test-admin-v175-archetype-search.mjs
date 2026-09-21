// admin v1.75／server patch v1.46 守衛：🎮 Oracle 對戰的伺服器端搜尋也能搜【牌組原型名稱】（含「未分類」）
//
// 站長需求（逐字）：「Oracle 對戰的搜尋功能，應該也要能搜尋排組原型的名稱，這樣子我只要去已結束的分頁，
//   搜尋 未分類，這樣我就可以快速把還沒分類的排組原型建立起來」
// 背景：v6.240 起搜尋在伺服器端做（分頁後前端只有 50 筆），而原型是**即時算**的、不在 rooms 文件裡
//   ⇒ Mongo 查不到 ⇒ 原型搜尋從那時起就失效（前端 filterRoomsBySearch 的原型分支只剩舊伺服器才走得到）。
//
// 驗法：沿用 test-v6229 的抽取方式（真 deckToSets/classifyDeck/archetypeNameOf ＋ 真 admin 端點），
//   配一個支援 $or／$in／regex／sort／limit 的假 Mongo，實跑端點。
// 【HEAD-FAIL】BASE（server patch v1.45）：A1～A3、A5、A6 紅（搜「未分類」／原型名找不到房）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PATCH = normEol(readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8'));
const HTML = normEol(readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8'));

let pass = 0, fail = 0; const failed = [];
async function T(name, fn) {
  try { await fn(); pass++; console.log('  PASS ' + name); }
  catch (e) { fail++; failed.push(name.split(' ')[0]); console.log('  FAIL ' + name + ' :: ' + (e && e.message)); }
}
function ok(c, m) { if (!c) throw new Error(m); }

function sliceBetween(src, a, b, what) {
  const s = src.indexOf(a); ok(s >= 0, '抽不到 ' + what);
  const e = src.indexOf(b, s); ok(e > s, '抽不到 ' + what + '（終點）');
  return src.slice(s, e);
}
function extractAppGet(src, needle, what) {
  const g = src.indexOf(needle); ok(g >= 0, '抽不到 ' + what);
  let i = src.indexOf('{', g), depth = 0, end = -1;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { end = i; break; } } }
  ok(end > 0, what + ' 大括號配對失敗');
  const close = src.indexOf(');', end); ok(close > 0, what + ' 收尾');
  return src.slice(g, close + 2);
}

// ── 假 Mongo（支援本端點會用到的運算子）──
const getPath = (o, p) => {
  const parts = p.split('.'); let cur = [o];
  for (const k of parts) { const nx = []; for (const c of cur) { if (c == null) continue; const v = c[k]; if (Array.isArray(v)) nx.push(...v); else nx.push(v); } cur = nx; }
  return cur;
};
function condOk(vals, cond) {
  if (cond instanceof RegExp) return vals.some((v) => v != null && cond.test(String(v)));
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    if ('$gte' in cond) return vals.some((v) => v >= cond.$gte);
    if ('$in' in cond) return vals.some((v) => cond.$in.includes(v));
  }
  return vals.some((v) => v === cond);
}
function matchDoc(d, f) {
  for (const k of Object.keys(f || {})) {
    if (k === '$or') { if (!f.$or.some((x) => matchDoc(d, x))) return false; continue; }
    if (!condOk(getPath(d, k), f[k])) return false;
  }
  return true;
}
function makeDb(docs, spy) {
  return {
    collection: (n) => ({
      find: (filter, opts) => {
        spy.finds.push({ n, filter, opts });
        const cur = { _skip: 0, _limit: Infinity };
        cur.sort = () => cur; cur.skip = (k) => { cur._skip = k; return cur; }; cur.limit = (k) => { cur._limit = k; return cur; };
        cur.toArray = async () => {
          const r = (n === 'rooms' ? docs : []).filter((d) => matchDoc(d, filter)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          const out = r.slice(cur._skip, cur._limit === Infinity ? undefined : cur._skip + cur._limit);
          return out.map((d) => JSON.parse(JSON.stringify(d)));
        };
        return cur;
      },
      countDocuments: async (f) => (n === 'rooms' ? docs.filter((d) => matchDoc(d, f || {})).length : 0),
      aggregate: () => ({ toArray: async () => [] }),
      createIndex: async () => 'ok',
    }),
  };
}

function buildServer(patchSrc, docs, spy, rules) {
  const coreFns = sliceBetween(patchSrc, 'function deckToSets(cardCounts, nameMap) {', '\n    function sanitizeRule', '分類核心');
  const start = patchSrc.indexOf('const _roomArchCache = new Map();'); ok(start >= 0, '抽不到 _roomArchCache');
  const ep = extractAppGet(patchSrc, "app.get('/api/rooms-archetypes'", '大廳原型端點');
  const archBlock = patchSrc.slice(start, patchSrc.indexOf(ep) + ep.length);
  const adminEp = extractAppGet(patchSrc, "app.get('/api/admin/oracle/rooms',", 'admin 房間端點');
  const handlers = {};
  const app = { locals: {}, get: (p, ...rest) => { handlers[p] = rest[rest.length - 1]; } };
  const nameMap = new Map(NAMEMAP);
  new Function('app', 'db', 'getCardNameMap', 'getEnabledRulesCached', 'summarizeRoom', 'enrichSeats', 'requireFirebaseAdmin',
    coreFns + '\n' + archBlock + '\n' + adminEp)(
    app, makeDb(docs, spy), async () => nameMap, async () => rules,
    (r) => { delete r.gameState; return r; }, async () => {}, () => {});
  ok(typeof handlers['/api/admin/oracle/rooms'] === 'function', 'admin 端點沒註冊');
  return handlers['/api/admin/oracle/rooms'];
}
async function call(h, query) {
  let out = null; const res = { json: (x) => { out = x; return res; }, status: () => res };
  await h({ query }, res); ok(out && !out.error, '端點回錯誤：' + (out && out.error)); return out;
}

const RULES = [{ _id: 'r1', name: '雙龍特調', includes: ['多龍巴魯托ex'], enabled: true, priority: 1 }];
const NAMEMAP = [['101', '多龍巴魯托ex'], ['102', '索羅亞克ex'], ['901', '基本【惡】能量']];
const HIT = [{ cardId: '101', count: 3 }, { cardId: '901', count: 10 }];
const MISS = [{ cardId: '102', count: 4 }, { cardId: '901', count: 8 }];
const NOW = Date.now();
const seat = (name, deck) => (deck ? { uid: 'u' + name, name, deckEntries: deck } : { uid: 'u' + name, name });
const DOCS = [
  { _id: 'BOTH', status: 'ended', updatedAt: NOW - 1000, seats: [seat('甲', HIT), seat('乙', HIT)] },
  { _id: 'HALF', status: 'ended', updatedAt: NOW - 2000, seats: [seat('丙', HIT), seat('丁', MISS)] },
  { _id: 'NONE', status: 'ended', updatedAt: NOW - 3000, seats: [seat('戊', MISS), seat('己', MISS)] },
  { _id: 'NULL', status: 'ended', updatedAt: NOW - 4000, seats: [seat('庚', HIT), seat('辛', null)] },   // 辛沒牌表＝不知道，不算未分類
  { _id: 'PLAY', status: 'playing', updatedAt: NOW - 500, seats: [seat('壬', MISS), seat('癸', MISS)] },
  { _id: 'OLDX', status: 'ended', updatedAt: NOW - 40 * 86400000, seats: [seat('老', MISS), seat('舊', MISS)] },
];
const Q = (q, extra = {}) => ({ status: 'ended', range: '7d', page: '1', pageSize: '50', q, ...extra });
const ids = (b) => b.rooms.map((r) => r._id).sort().join(',');

console.log('\n【A】伺服器端：搜尋牌組原型名稱');
await T('A1 ⭐⭐⭐【HEAD-FAIL】已結束＋搜「未分類」⇒ 找得到有任一座位未分類的房（HALF、NONE），不含兩邊都已分類的 BOTH', async () => {
  const spy = { finds: [] }; const h = buildServer(PATCH, DOCS, spy, RULES);
  const b = await call(h, Q('未分類'));
  ok(ids(b) === 'HALF,NONE', '實得 ' + ids(b));
});
await T('A2 ⭐⭐【HEAD-FAIL】搜原型名稱的一部分（「雙龍」）⇒ 找得到有座位屬於「雙龍特調」的房', async () => {
  const spy = { finds: [] }; const h = buildServer(PATCH, DOCS, spy, RULES);
  const b = await call(h, Q('雙龍'));
  ok(ids(b) === 'BOTH,HALF,NULL', '實得 ' + ids(b));
});
await T('A3 ⭐⭐【HEAD-FAIL】「還不知道」（沒牌表＝null）絕不當成未分類：NULL 房搜「未分類」不可命中', async () => {
  const spy = { finds: [] }; const h = buildServer(PATCH, DOCS, spy, RULES);
  const b = await call(h, Q('未分類'));
  ok(!b.rooms.some((r) => r._id === 'NULL'), 'null 被當成未分類了');
  ok(b.archScan && b.archScan.matched === 2 && b.archScan.capped === false, JSON.stringify(b.archScan));
});
await T('A4 ⭐零額外成本：搜玩家名（不是任何原型名）⇒ 不做原型掃描、archScan 為 null，結果照舊', async () => {
  const spy = { finds: [] }; const h = buildServer(PATCH, DOCS, spy, RULES);
  const b = await call(h, Q('丙'));
  ok(ids(b) === 'HALF', '玩家名搜尋壞了：' + ids(b));
  ok(b.archScan === null || b.archScan === undefined, '不該做原型掃描');
  ok(spy.finds.filter((f) => f.opts && f.opts.projection && f.opts.projection['seats.deckEntries'] === 1 && Object.keys(f.opts.projection).length === 2).length === 0, '多做了一次原型掃描');
});
await T('A5 ⭐⭐【HEAD-FAIL】掃描只在同一個狀態／時間範圍內，而且只取 _id＋牌表（不帶 gameState.log）', async () => {
  const spy = { finds: [] }; const h = buildServer(PATCH, DOCS, spy, RULES);
  const b = await call(h, Q('未分類'));
  ok(!b.rooms.some((r) => r._id === 'PLAY' || r._id === 'OLDX'), '跨出狀態或時間範圍：' + ids(b));
  const scan = spy.finds.find((f) => f.opts && f.opts.projection && f.opts.projection['seats.deckEntries'] === 1);
  ok(scan, '找不到原型掃描那一次查詢');
  ok(scan.filter.status === 'ended' && scan.filter.updatedAt && typeof scan.filter.updatedAt.$gte === 'number' && !scan.filter.$or, '掃描條件不對：' + JSON.stringify(scan.filter));
  ok(Object.keys(scan.opts.projection).sort().join(',') === '_id,seats.deckEntries', 'projection 帶了多餘欄位：' + JSON.stringify(scan.opts.projection));
});
await T('A6 ⭐⭐【HEAD-FAIL】超過掃描上限 ⇒ archScan.capped=true 誠實回報（不靜默截斷），且仍回得出結果', async () => {
  const big = [];
  for (let i = 0; i < 5200; i++) big.push({ _id: 'B' + i, status: 'ended', updatedAt: NOW - i * 10, seats: [seat('x' + i, i % 2 ? MISS : HIT), seat('y' + i, HIT)] });
  const spy = { finds: [] }; const h = buildServer(PATCH, big, spy, RULES);
  const b = await call(h, Q('未分類'));
  ok(b.archScan && b.archScan.capped === true && b.archScan.scanned === b.archScan.cap && b.archScan.cap >= 1000, JSON.stringify(b.archScan));
  ok(b.total === b.archScan.matched && b.total > 0, 'total 與命中數不符：' + b.total + ' vs ' + JSON.stringify(b.archScan));
});
await T('A7 ⭐零回歸：規則庫還沒載入（rules 空）⇒ 不掃、不報錯，其他搜尋照常', async () => {
  const spy = { finds: [] }; const h = buildServer(PATCH, DOCS, spy, []);
  const b = await call(h, Q('雙龍'));
  ok(Array.isArray(b.rooms) && (b.archScan === null || b.archScan === undefined), JSON.stringify(b.archScan));
});

console.log('\n【B】admin 前端');
await T('B1 ⭐⭐【HEAD-FAIL】Oracle 分頁搜尋框提示寫出「牌組原型（可搜「未分類」）」', async () => {
  ok(HTML.includes("'搜尋 房號 / 房間名 / 玩家名 / Email / 牌組卡名 / 牌組原型（可搜「未分類」）'"), '提示文字不在');
});
await T('B2 ⭐⭐【HEAD-FAIL】讀回 archScan，並在被截斷時明講「只掃了最近 N 間」', async () => {
  ok(/oracleRoomsArchScan = data\.archScan \|\| null;/.test(HTML), '沒有讀回 archScan');
  ok(HTML.includes('只掃了<b>最近 ') && HTML.includes('${archScanHtml}'), '截斷提示不在或沒放進版面');
});

console.log(`\nadmin v1.75 原型搜尋守衛：PASS ${pass} / FAIL ${fail}` + (fail ? '（紅：' + failed.join('、') + '）' : ''));
if (fail) process.exit(1);
