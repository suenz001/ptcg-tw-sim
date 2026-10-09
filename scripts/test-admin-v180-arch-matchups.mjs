// ⭐ admin v1.80／server v1.58 守衛：常用牌組對戰勝率（站長 2026-10-10）
//   站長（逐字）：「抓前20名使用率的牌組 如 多龍巴魯托牌組 對上 N的索羅亞克 呆呆王 超級龍頭地鼠等同樣是前20名使用率的牌組 彼此間的勝率」
//   「或是增加 我輸入牌組原型名稱 然後就能產生該牌組對前20名使用率的牌組的勝率分析」
//
// 【S】伺服器（真 handler、假 Mongo；新端點與既有 deck-archetype-stats 用同一份假資料實跑）
//   S1 每個原型的使用次數／勝負和 ＝ deck-archetype-stats（環境報告圖）逐原型相同、未分類也相同 ⇒ 排名一致
//   S2 對戰計數：雙方都分類、各記自己視角；同型記兩筆；和局；只有一側有牌表 ⇒ 記使用、不記對戰；bye／沒勝方的錦標賽對局不算
//   S3 查詢條件：休閒走中央 buildCasualCleanFilter、projection 只取牌表與勝方（不撈 gameState）；停用規則不分類；names 只列有出現的
//   S4 60 秒快取；卡名對照沒載入 ⇒ 503
// 【P】admin 純函式（MX-PURE 區段逐字抽出實跑）
//   P1 前 N 名：依使用次數、未分類不排名、同票依名稱；P2 同型場數除 2、勝率不給；「其他」不含同型與前 N 名；「全體」＝使用計數
//   P3 指定牌組（不在前 N 名也可以）；P4 伺服器輸出 → 矩陣：A 對 B 與 B 對 A 勝率互補；P5 合併＝兩個資料源相加且不改原物件
//   P6 名稱查找（完全相同／唯一包含／不唯一回 null）；P7 配色（樣本不足＝灰、50%＝中性、±20pp 飽和）；P8 Wilson 區間
// 【U】admin 接線：區塊與控制項、inline handler 全掛 window、讀端點時沿用「統計範圍」、版本 v1.80
// 【E】真瀏覽器：兩張圖畫得出來且尺寸正確、網頁表格列數／格數正確、沒有 JS 例外
// 【H】HEAD-FAIL：同一批判準餵 BASE（e867d7c2）逐條紅
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：測試工具修正那一版（v6.517 之後）。
const BASE_SHA = 'e867d7c2';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

function grabFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const indent = ' '.repeat(src.slice(0, i).length - src.lastIndexOf('\n', i) - 1);
  const end = src.indexOf('\n' + indent + '}', i);
  return end > i ? src.slice(i, end + indent.length + 2) : null;
}
function grabBlock(src, head) {
  const i = src.indexOf(head);
  if (i < 0) return null;
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (d === 0) break; } }
  let k = j + 1;
  while (src[k] === ')' || src[k] === ';') k++;
  return src.slice(i, k);
}
const sentinel = (src, tag) => {
  const a = src.indexOf('// >>> ' + tag), b = src.indexOf('// <<< ' + tag);
  return a >= 0 && b > a ? src.slice(a, b) : null;
};

// ── 卡名對照（官方卡面）──
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const nameMap = new Map(), idByName = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null || !c.name) continue;
    nameMap.set(String(c.id), c.name);
    if (!idByName.has(c.name)) idByName.set(c.name, String(c.id));
  }
}
const KANGA = '超級袋獸ex', BOSS = '老大的指令', CATCH = '頂尖捕捉器', NEST = '巢穴球';
const missing = [KANGA, BOSS, CATCH, NEST].filter((n) => !idByName.has(n));
if (missing.length) { console.log('fixture 卡名不在卡池：' + missing.join(',')); process.exit(1); }
const cc = (names) => Object.fromEntries(names.map((n) => [idByName.get(n), 4]));          // 休閒 cardCounts
const de = (names) => names.map((n) => ({ cardId: idByName.get(n), count: 4 }));            // 錦標賽 deckEntries

// 規則：k1 袋獸型（含袋獸）、k2 老大型（含老大的指令、不含袋獸）、k3 停用（含捕捉器）
const RULES = [
  { _id: 'k1', name: '袋獸型', includes: [KANGA], priority: 1, enabled: true },
  { _id: 'k2', name: '老大型', includes: [BOSS], excludes: [KANGA], priority: 2, enabled: true },
  { _id: 'k3', name: '停用中', includes: [CATCH], priority: 3, enabled: false },
];
const A = () => cc([KANGA, NEST]), B = () => cc([BOSS, NEST]), U = () => cc([CATCH, NEST]);   // U：k3 停用 ⇒ 未分類
// 休閒：m1 A(p1) 勝 B；m2 A 同型（p2 勝）；m3 A 對 U 和局；m4 B 對 A，A 勝（p2 勝）；m5 p2 沒牌表（A 勝）；m6 U 勝 B
const CASUAL = [
  { _id: 'm1', p1: { cardCounts: A() }, p2: { cardCounts: B() }, winner: 0 },
  { _id: 'm2', p1: { cardCounts: A() }, p2: { cardCounts: A() }, winner: 1 },
  { _id: 'm3', p1: { cardCounts: A() }, p2: { cardCounts: U() }, winner: null },
  { _id: 'm4', p1: { cardCounts: B() }, p2: { cardCounts: A() }, winner: 1 },
  { _id: 'm5', p1: { cardCounts: A() }, p2: { cardCounts: {} }, winner: 0 },
  { _id: 'm6', p1: { cardCounts: U() }, p2: { cardCounts: B() }, winner: 0 },
];
// 錦標賽：一場有效（u1=A 勝 u2=B）、一場 bye、一場沒勝方、一場對手沒牌表（u1 A 勝 u4）
const TOURN = [{
  _id: 'ev1', finishedAt: 5,
  players: [{ uid: 'u1', deckEntries: de([KANGA, NEST]) }, { uid: 'u2', deckEntries: de([BOSS, NEST]) },
            { uid: 'u3', deckEntries: de([BOSS, NEST]) }, { uid: 'u4', deckEntries: [] }],
  matches: [{ p1uid: 'u1', p2uid: 'u2', winnerUid: 'u1' }, { p1uid: 'u3', p2uid: null, bye: true, winnerUid: 'u3' },
            { p1uid: 'u2', p2uid: 'u3', winnerUid: null }, { p1uid: 'u4', p2uid: 'u1', winnerUid: 'u1' }],
}];

// ⭐ 假 DB **真的套用 projection**（Fable 審查：不套用的話 projection 漏一個欄位守衛照樣綠）。
//   支援 Mongo 的點路徑包含式投影；路徑經過陣列時逐元素投影。
function project(doc, proj) {
  if (!proj || !Object.keys(proj).length) return doc;
  const out = {};
  const put = (src, dst, parts) => {
    if (src == null || typeof src !== 'object') return;
    const [h, ...rest] = parts;
    if (!(h in src)) return;
    if (!rest.length) { dst[h] = src[h]; return; }
    const v = src[h];
    if (Array.isArray(v)) {
      const arr = Array.isArray(dst[h]) ? dst[h] : (dst[h] = v.map(() => ({})));
      v.forEach((el, i) => put(el, arr[i], rest));
    } else if (v && typeof v === 'object') put(v, dst[h] || (dst[h] = {}), rest);
  };
  for (const k of Object.keys(proj)) if (proj[k]) put(doc, out, k.split('.'));
  if (!('_id' in proj) || proj._id) if ('_id' in doc) out._id = doc._id;
  return out;
}
function fakeDb(log) {
  const coll = (name, docs) => ({
    find(filter, opts) {
      log.push({ name, filter, opts });
      const rows = docs.map((d) => project(JSON.parse(JSON.stringify(d)), opts && opts.projection));
      const cur = { sort: () => cur, limit: () => cur, toArray: async () => rows,
        async *[Symbol.asyncIterator]() { for (const r of rows) yield r; } };
      return cur;
    },
  });
  const c = { matchRecords: coll('matchRecords', CASUAL), tournamentArchives: coll('tournamentArchives', TOURN) };
  return { collection: (n) => c[n] };
}
const TRULES_FAKE = { find: (f) => { const rows = RULES.filter((r) => r.enabled !== false); const cur = { sort: () => cur, toArray: async () => rows }; return cur; } };

/** 從補丁組出統計零件＋兩支端點（新的若不存在 ⇒ handlers 裡沒有它） */
function buildServer(PATCH, opts) {
  const o = opts || {};
  const fns = ['deckToSets', 'deckMatchesRule', 'ruleStrictness', 'ruleRank', 'classifyDeck', 'casualSideResult',
    'tournSideResult', 'buildCasualCleanFilter'].map((n) => grabFn(PATCH, n)).filter(Boolean).join('\n');
  const stats = grabBlock(PATCH, "app.get('/api/admin/deck-archetype-stats'") || '';
  const mu = sentinel(PATCH, 'v158-arch-matchups') || '';
  const handlers = {};
  const app = { get: (p, _mw, h) => { handlers[p] = h; }, post: () => {}, locals: {} };
  const log = [];
  const yields = [];   // 每一次讓路呼叫的參數（Fable 審查：要能斷言兩個迴圈都有讓路）
  new Function('app', 'requireFirebaseAdmin', 'db', 'TRULES', 'getCardNameMap', 'adminScanYield', '_archStatsCache',
    'getPokemonNameSet', 'getSupportPokemonNames', 'CASUAL_LEAVE_RE',
    fns + '\n' + stats + '\n' + mu)(
    app, () => {}, fakeDb(log), TRULES_FAKE, async () => (o.nameMap || nameMap), (n) => { yields.push(n); return null; }, new Map(),
    async () => new Set(), async () => new Set(), /中途離開|disconnect/i);
  const call = async (path, query) => {
    const h = handlers[path];
    if (!h) return { code: 404, out: null };
    let out = null, code = 200;
    const res = { status: (c) => { code = c; return res; }, json: (x) => { out = x; return res; } };
    await h({ query: query || {} }, res);
    return { code, out };
  };
  const cleanFilter = (() => { try { return new Function('CASUAL_LEAVE_RE', fns + '\nreturn buildCasualCleanFilter;')(/中途離開|disconnect/i); } catch { return null; } })();
  return { call, log, cleanFilter, yields };
}

const sum3 = (t) => (t ? t[0] + t[1] + t[2] : 0);
const eq3 = (t, w, l, d) => !!t && t[0] === w && t[1] === l && t[2] === d;

async function judgeServer(PATCH) {
  const r = {};
  try {
    const S = buildServer(PATCH);
    const st = await S.call('/api/admin/deck-archetype-stats', { source: 'all' });
    const y0 = S.yields.length;
    const mu = await S.call('/api/admin/deck-archetype-matchups', { source: 'all', since: '7' });
    const yN = S.yields.length - y0;
    r.exists = mu.code === 200 && !!mu.out;
    if (!r.exists) return r;
    const M = mu.out;
    // S1 與環境報告圖逐原型一致
    const s1 = [];
    for (const bk of ['casual', 'tourn']) {
      for (const row of st.out[bk].rows) {
        const t = M[bk].usage[row.ruleId];
        if (!eq3(t, row.wins, row.losses, row.draws) || sum3(t) !== row.usage) s1.push(bk + ':' + row.name);
      }
      const ru = st.out[bk].unclassified;
      if (sum3(M[bk].usage._u) !== ru.usage || (M[bk].usage._u || [0])[0] !== ru.wins) s1.push(bk + ':未分類');
      const ruleKeys = Object.keys(M[bk].usage).filter((k) => k !== '_u').sort().join(',');
      if (ruleKeys !== st.out[bk].rows.map((x) => x.ruleId).sort().join(',')) s1.push(bk + ':原型集合不同 ' + ruleKeys);
    }
    r.S1 = s1.length === 0 && st.out.casual.rows.length === 2; r.S1d = s1.join('｜');
    // S2 對戰計數（手算）
    const c = M.casual.pairs, t = M.tourn.pairs;
    r.S2 = eq3(c.k1.k2, 2, 0, 0) && eq3(c.k2.k1, 0, 2, 0)            // m1、m4：A 兩勝 B
      && eq3(c.k1.k1, 1, 1, 0)                                          // m2 同型：兩筆
      && eq3(c.k1._u, 0, 0, 1) && eq3(c._u.k1, 0, 0, 1)                 // m3 和局
      && eq3(c._u.k2, 1, 0, 0) && eq3(c.k2._u, 0, 1, 0)                 // m6
      && Object.keys(c).length === 3 && M.scanned.casualPairs === 5 && M.scanned.casualDecks === 11   // m5 只記使用
      && eq3(M.casual.usage.k1, 4, 1, 1)                                // A：m1 勝、m2 一勝一負、m3 和、m4 勝、m5 勝
      && eq3(t.k1.k2, 1, 0, 0) && eq3(t.k2.k1, 0, 1, 0) && Object.keys(t).length === 2
      && M.scanned.tournPairs === 1 && M.scanned.tournDecks === 3 && eq3(M.tourn.usage.k1, 2, 0, 0);
    r.S2d = JSON.stringify({ c, t, sc: M.scanned });
    // S3 查詢條件與輸出
    const q = S.log.filter((x) => x.name === 'matchRecords');
    const muQ = q[q.length - 1];
    const want = S.cleanFilter && JSON.stringify(S.cleanFilter({ excludeAI: true, since: 7 }), (k, v) => (v instanceof RegExp ? String(v) : v));
    const got = muQ && JSON.stringify(muQ.filter, (k, v) => (v instanceof RegExp ? String(v) : v));
    const proj = muQ && muQ.opts && muQ.opts.projection;
    const tq = S.log.filter((x) => x.name === 'tournamentArchives').pop();
    r.S3 = !!want && got === want && !!proj && Object.keys(proj).sort().join(',') === 'p1.cardCounts,p2.cardCounts,winner'
      && !!(tq && tq.filter && tq.filter.finishedAt && tq.filter.finishedAt.$gte === 7)
      && JSON.stringify(M.names) === JSON.stringify({ k1: '袋獸型', k2: '老大型' }) && M.unclassifiedKey === '_u';
    r.S3d = JSON.stringify({ got, want, proj, names: M.names });
    // S4 快取／卡名對照沒載入
    const again = await S.call('/api/admin/deck-archetype-matchups', { source: 'all', since: '7' });
    const S2 = buildServer(PATCH, { nameMap: new Map() });
    const z = await S2.call('/api/admin/deck-archetype-matchups', { source: 'casual' });
    const only = await S.call('/api/admin/deck-archetype-matchups', { source: 'casual' });
    r.S4 = again.out && again.out.cached === true && z.code === 503 && only.out.tourn === null && !!only.out.casual;
    // S5 讓路：休閒每一筆（6 場）＋錦標賽每一場有效對局（2 場）各呼叫一次 adminScanYield
    r.S5 = yN === 8; r.S5d = 'adminScanYield 呼叫 ' + yN + ' 次（預期 6＋2）';
    r.mu = M;
  } catch (e) { r.err = e.message; }
  return r;
}

// ── admin 純函式 ──
function loadPure(HTML) {
  const a = HTML.indexOf('// ══ MX-PURE-BEGIN'), b = HTML.indexOf('// ══ MX-PURE-END');
  if (a < 0 || b < a) return null;
  try {
    return new Function(HTML.slice(a, b) + '\nreturn { mxMergeBuckets, mxBucket, mxWilson, mxCell, mxBuild, mxFindKey, mxColor };')();
  } catch { return null; }
}
function judgePure(HTML, MU) {
  const r = {};
  const P = loadPure(HTML);
  r.exists = !!P;
  if (!P) return r;
  try {
    // 合成資料：x1 使用 30、x2 20、x3 20（同票：依名稱字碼，乙 U+4E59 < 甲 U+7532 ⇒ x2 在前）、x4 5、未分類 50（不排名）
    const data = { names: { x1: '丙牌組', x2: '乙牌組', x3: '甲牌組', x4: '丁牌組' }, unclassifiedKey: '_u',
      casual: { usage: { x1: [18, 10, 2], x2: [8, 12, 0], x3: [10, 10, 0], x4: [1, 4, 0], _u: [20, 30, 0] },
        pairs: { x1: { x1: [3, 3, 0], x2: [6, 2, 0], x3: [1, 1, 1], x4: [2, 0, 0], _u: [4, 1, 0] },
                 x4: { x4: [1, 1, 0], x1: [0, 2, 0], _u: [0, 1, 0] } } },
      tourn: { usage: { x2: [5, 0, 0] }, pairs: { x2: { x1: [2, 1, 0] } } } };
    const m = P.mxBuild(data, 'casual', { topN: 3, minGames: 5 });
    r.P1 = m.cols.map((c) => c.key).join(',') === 'x1,x2,x3' && m.ranked === 4 && m.rows.length === 3
      && m.cols[0].rank === 1 && m.cols[2].rank === 3 && Math.abs(m.cols[0].share - 30 / 125) < 1e-9;
    const x1 = m.rows[0];
    r.P2 = x1.cells[0].mirror && x1.cells[0].games === 3 && x1.cells[0].winRate === null
      && x1.cells[1].winRate === 0.75 && x1.cells[1].games === 8 && x1.cells[1].ok === true
      && x1.cells[2].games === 3 && x1.cells[2].ok === false
      && x1.other.w === 6 && x1.other.l === 1 && x1.other.games === 7          // x4＋未分類；同型與前 3 名不算
      && x1.overall.games === 30 && Math.abs(x1.overall.winRate - 18 / 28) < 1e-9;
    const f = P.mxBuild(data, 'casual', { topN: 3, minGames: 1, focusKey: 'x4' });
    r.P3 = f.rows.length === 1 && f.rows[0].key === 'x4' && f.rows[0].rank === 4 && f.rows[0].cells[0].winRate === 0
      && f.rows[0].other.games === 1 && f.cols.length === 3
      && P.mxBuild(data, 'casual', { topN: 3, focusKey: 'nope' }).rows.length === 0;
    // P4：伺服器真實輸出 → 矩陣互補
    if (MU) {
      const mm = P.mxBuild(MU, 'casual', { topN: 20, minGames: 1 });
      const ia = mm.cols.findIndex((c) => c.key === 'k1'), ib = mm.cols.findIndex((c) => c.key === 'k2');
      const ab = mm.rows[ia].cells[ib], ba = mm.rows[ib].cells[ia];
      r.P4 = ia === 0 && ib === 1 && ab.winRate === 1 && ba.winRate === 0 && ab.games === ba.games && mm.rows[ia].cells[ia].mirror;
    } else r.P4 = false;
    const before = JSON.stringify(data);
    const all = P.mxBuild(data, 'all', { topN: 4, minGames: 1 });
    const x2 = all.rows.find((x) => x.key === 'x2');
    r.P5 = JSON.stringify(data) === before && x2.usage === 25 && x2.cells.find((c, i) => all.cols[i].key === 'x1').w === 2
      && all.cols[0].key === 'x1' && all.cols[1].key === 'x2';
    r.P6 = P.mxFindKey(data, '甲牌組') === 'x3' && P.mxFindKey(data, '丁') === 'x4' && P.mxFindKey(data, '牌組') === null
      && P.mxFindKey(data, '') === null && P.mxFindKey(data, ' 乙牌組 ') === 'x2';
    const pal = { neg: '#ff0000', mid: '#808080', pos: '#00ff00', na: '#123456' };
    r.P7 = P.mxColor({ winRate: 0.9, ok: false }, pal) === '#123456' && P.mxColor({ winRate: 0.5, ok: true }, pal) === '#808080'
      && P.mxColor({ winRate: 0.7, ok: true }, pal) === '#00ff00' && P.mxColor({ winRate: 0.95, ok: true }, pal) === '#00ff00'
      && P.mxColor({ winRate: 0.3, ok: true }, pal) === '#ff0000' && P.mxColor({ winRate: 0.6, ok: true }, pal) === '#40c040'
      && P.mxColor({ winRate: null, ok: true }, pal) === '#123456';
    const w = P.mxWilson(5, 10);
    r.P8 = !!w && Math.abs(w[0] - 0.2366) < 0.001 && Math.abs(w[1] - 0.7634) < 0.001 && P.mxWilson(0, 0) === null
      && P.mxWilson(10, 10)[1] === 1;
  } catch (e) { r.err = e.message; }
  return r;
}

function judgeUi(HTML) {
  const ids = ['mx-src', 'mx-topn', 'mx-min', 'mx-name', 'mx-name-list', 'mx-box', 'mx-img-btn', 'mx-focus-btn'];
  const handlers = ['loadArchMatchups', 'renderArchMatchups', 'exportArchMatrixImage', 'openArchFocus', 'exportArchFocusImage', 'downloadMxImage'];
  const r = {};
  r.U1 = ids.every((id) => HTML.includes('id="' + id + '"')) && HTML.includes('⚔️ 常用牌組對戰勝率');
  // inline handler 在全域作用域執行（module script）⇒ 每一支都要掛 window
  r.U2 = handlers.every((h) => new RegExp('window\\.' + h + ' = ').test(HTML) && HTML.includes(h + '('));
  const load = grabBlock(HTML, 'window.loadArchMatchups = async function') || '';
  r.U3 = load.includes("api('/api/admin/deck-archetype-matchups?source=all&since=' + since)") && load.includes('currentArchSince()')
    && load.includes('Math.floor((Date.now() - days * 86400000) / 60000) * 60000');   // since 取整到分鐘 ⇒ 60 秒快取才命中得到
  // 列名點擊：key 放 data-key（雙引號屬性），不拼進單引號的 JS 字串（escapeHtml 不跳脫單引號）
  r.U5 = HTML.includes('data-key="\' + escapeHtml(r.key) + \'" onclick="openArchFocus(this.dataset.key)"') && !/openArchFocus\(\\'' \+/.test(HTML);
  // 不釘死字面（下一版 bump 就會誤紅）：title 與 h1 相同且 ≥ v1.80
  const t = /<title>PTCG Oracle Admin v(\d+)\.(\d+)<\/title>/.exec(HTML), h = /PTCG Oracle Admin <span class="small">v(\d+)\.(\d+)<\/span>/.exec(HTML);
  const v = (m) => (m ? Number(m[1]) * 1000 + Number(m[2]) : -1);
  r.U4 = v(t) >= 1080 && v(t) === v(h);
  return r;
}

// ═══════════════════════════════════════════════════════════
const PATCH = rd('oracle-admin/server_admin_patch.js');
const ADMIN = rd('oracle-admin/admin.html');

console.log('【S】伺服器');
const S = await judgeServer(PATCH);
ok('[S0] 新端點存在且回 200', S.exists, S.err);
ok('★★★[S1] 每個原型的使用／勝負和＝環境報告圖（deck-archetype-stats）逐原型相同，未分類也相同', S.S1, S.S1d);
ok('★★★[S2] 對戰計數手算一致：雙方視角、同型兩筆、和局、單側牌表只記使用、bye／沒勝方不算', S.S2, S.S2d);
ok('★★[S3] 休閒走中央 buildCasualCleanFilter、projection 只取牌表與勝方；錦標賽 since；停用規則不分類、names 只列有出現的', S.S3, S.S3d);
ok('★★[S4] 60 秒快取、卡名對照沒載入 ⇒ 503、source=casual 不回錦標賽', S.S4);
ok('★★[S5] 兩個掃描迴圈都會讓路（休閒每筆、錦標賽每場有效對局）', S.S5, S.S5d);

console.log('\n【P】admin 純函式');
const P = judgePure(ADMIN, S.mu);
ok('[P0] MX-PURE 區段抽得出來', P.exists, P.err);
ok('★★★[P1] 前 N 名：依使用次數、未分類不排名、同票依名稱字碼（不隨語系變）；佔比分母含未分類', P.P1);
ok('★★★[P2] 同型場數除 2 且不給勝率；最少場數；「其他」不含同型與前 N 名；「全體」＝使用計數', P.P2);
ok('★★★[P3] 指定牌組（不在前 N 名也行）只回那一列；不存在的牌組回空', P.P3);
ok('★★[P4] 伺服器真實輸出 → 矩陣：A 對 B 與 B 對 A 勝率互補、場數相同', P.P4);
ok('★★[P5] 合併＝兩個資料源相加、不改原物件，排名跟著合併後的使用次數', P.P5);
ok('★[P6] 名稱查找：完全相同／唯一包含／不唯一或空白回 null', P.P6);
ok('★[P7] 配色：樣本不足＝灰、50%＝中性、±20pp 飽和、中間內插', P.P7);
ok('★[P8] Wilson 95% 區間', P.P8);

console.log('\n【U】admin 接線');
const Ui = judgeUi(ADMIN);
ok('★★[U1] 區塊與控制項都在', Ui.U1);
ok('★★★[U2] inline handler 全部掛在 window（module script 的全域作用域）', Ui.U2);
ok('★★[U3] 讀新端點、時間範圍沿用「統計範圍」下拉、since 取整到分鐘', Ui.U3);
ok('★★[U5] 列名點擊用 data-key，不把 key 拼進單引號字串', Ui.U5);
ok('[U4] admin 版本 ≥ v1.80（title 與 h1 一致）', Ui.U4);

console.log('\n【E】真瀏覽器（畫圖與網頁表格）');
{
  const chromium = pwChromium('admin v1.80');
  const browser = chromium ? await pwLaunchWith(chromium, 'admin v1.80') : null;
  if (browser && S.mu) {
    const cut = (a, b) => { const i = ADMIN.indexOf(a); const j = ADMIN.indexOf(b, i); return i >= 0 && j > i ? ADMIN.slice(i, j) : ''; };
    const code = cut('const MI_URL', '// ══ MP-PURE-BEGIN') + cut('let _miLogo = null', '/**\n * 由「本期')
      + cut('// ══ v1.80 常用牌組對戰勝率', 'window.loadArchetypeStats');
    const css = cut('/* v1.80 常用牌組對戰勝率 */', '</style>');
    const pg = await browser.newPage();
    const errs = [];
    pg.on('pageerror', (e) => errs.push(e.message));
    try {
      await pg.setContent('<html><head><meta charset="utf-8"><style>' + css + '</style></head><body>'
        + '<select id="mx-src"><option value="casual">c</option><option value="all">a</option></select>'
        + '<select id="mx-topn"><option value="20">20</option></select><select id="mx-min"><option value="1">1</option></select>'
        + '<div id="mx-box"></div><div id="modal-container"></div></body></html>');
      const res = await pg.evaluate(async ([code, mu]) => {
        window.currentArchSince = () => 30; window.escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
        window.twOffsetMs = () => 8 * 3600000; window.closeModal = () => {};
        (0, eval)(code + '\nwindow.__mx = { mxBuild, mxDrawMatrix, mxDrawFocus }; _mxData = window.__mu;'.replace('window.__mu', JSON.stringify(mu)));
        const m = __mx.mxBuild(mu, 'casual', { topN: 20, minGames: 1 });
        const a = await __mx.mxDrawMatrix(m, 'casual');
        const f = await __mx.mxDrawFocus(__mx.mxBuild(mu, 'casual', { topN: 20, minGames: 1, focusKey: 'k2' }), 'casual');
        renderArchMatchups();
        const rows = [...document.querySelectorAll('#mx-box table tr')];
        document.querySelector('#mx-box a[data-key="k1"]').click();   // 真的點列名（data-key → openArchFocus）
        const modal = document.querySelectorAll('#modal-container .mx-f tr').length;
        return { a: [a.width, a.height], f: [f.width, f.height], rows: rows.length, cellsRow1: rows[1] ? rows[1].querySelectorAll('td').length : 0, modal };
      }, [code, S.mu]);
      ok('★★[E1] 矩陣圖 1080 寬（2 個原型時）、對戰表圖 1080×1350（2× 輸出）', res.a[0] === 2160 && res.f[0] === 2160 && res.f[1] === 2700, JSON.stringify(res));
      ok('★★[E2] 網頁表格：表頭＋2 列、每列 2＋其他＋全體＝4 格；對戰表視窗 2＋其他＝3 列', res.rows === 3 && res.cellsRow1 === 4 && res.modal === 3, JSON.stringify(res));
      ok('[E9] 沒有 JS 例外', errs.length === 0, errs.slice(0, 3).join(' | '));
    } catch (e) {
      ok('★★[E1] 畫圖', false, e.message); ok('★★[E2] 網頁表格', false, e.message);
    } finally { await browser.close(); }
  } else if (!S.mu) ok('[E0] 需要伺服器端輸出', false);
}

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const bp = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js');
  const ba = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/admin.html');
  if (bp.ok && ba.ok) {
    const BS = await judgeServer(bp.out.replace(/\r\n/g, '\n'));
    ok('★★★[H1] BASE 伺服器：沒有新端點 ⇒ S 組全紅（不是因為例外）', !BS.exists && !BS.S1 && !BS.S2 && !BS.err, JSON.stringify({ e: BS.exists, err: BS.err }));
    const BH = ba.out.replace(/\r\n/g, '\n');
    const BP = judgePure(BH, S.mu), BU = judgeUi(BH);
    ok('★★★[H2] BASE admin：沒有 MX-PURE ⇒ P 組全紅；U1～U4 全紅', !BP.exists && !BP.P1 && !BU.U1 && !BU.U2 && !BU.U3 && !BU.U4, JSON.stringify({ BP, BU }));
  } else shallowSkip('admin v180 H', '讀不到 BASE blob');
} else shallowSkip('admin v180 H', '需要 e867d7c2 commit');

console.log(`\n=== admin v1.80 常用牌組對戰勝率：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
