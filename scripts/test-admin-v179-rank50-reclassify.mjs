// ⭐ admin v1.79／server v1.57 守衛：序位預設 50＋用最新規則重新判定已儲存的牌型（站長 2026-10-07）
//   站長（逐字）：「請幫我先把預設的序位設為 50，這樣我才好增加比預設高或是比喻設低的牌組／之前已經設定好的牌組牌型原則也幫我改一下預設為50」
//   「賽事統計裡面之前的 5. 歷屆賽事 冠軍牌型…我常常更新規則，因此冠軍的牌組原型規則不一定是最新的…可以在 5. 歷屆賽事 那邊提供我一個按鈕」
//   「牌組公佈欄也有這個狀況，希望我在 admin 牌組原則那邊，提供我一個一鍵更新的按鈕，去更新之前儲存有相關牌組判定的部分（可能別的地方也有），都採用最新的判定」
//
// 【A】伺服器（真 handler、假 Mongo）
//   A1 ruleRank：沒設＝50、明確 0＝0；DEFAULT_RULE_RANK 由 ruleRank 導出；sanitizeRule 沒填＝50
//   A2 一次性遷移：沒有序位／null／0 ⇒ 50，其他不動；跑過一次（有標記）就不再改（之後刻意設的 0 不會被改掉）
//   A3 classify-decks：用「不經快取」的最新規則（快取裡是舊規則也一樣）、回中央 archetypeNameOf 的語義（名稱／未分類／null）
//   A4 reclassify-stored：公布欄每篇重算、只寫有變的、沒命中寫 ''、清掉四份原型結果快取；卡名對照沒載入 ⇒ 503 且一筆都不寫
//   A5 公布欄存的語義＝投稿時的 dpClassify（同一批牌表逐筆比對；dpClassify 從錦標賽區塊原樣抽出來跑）
// 【B】admin.html（實跑抽出來的函式）
//   B1 ruleRankOf／readRuleForm：空白＝50、填 0＝0；表單預設 50、新規則草稿 50
//   B2 歷屆賽事冠軍牌型儲存格：原型名／未分類（附主力）／還沒判定（主力寶可夢＋標註）
//   B3 tsRefreshChampArchetypes：只送有冠軍有牌表的場次、每 500 副一批、結果填進表格；伺服器錯誤 ⇒ 顯示原因、舊結果不動
//   B4 一鍵按鈕與結果摘要；載入賽事統計後自動判定一次
// 【H】HEAD-FAIL：同一批判準餵 v6.507（7c756222）逐條紅
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.507 修正版。
const BASE_SHA = '7c756222';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const T = async (n, fn) => { try { await fn(); pass++; console.log('  PASS ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + ' :: ' + (e && e.message)); } };

function grabFn(src, name, kw = 'function ') {
  const i = src.indexOf(kw + name + '(');
  if (i < 0) return null;
  const indent = ' '.repeat(src.slice(0, i).length - src.lastIndexOf('\n', i) - 1);
  const end = src.indexOf('\n' + indent + '}', i);
  return end > i ? src.slice(i, end + indent.length + 2) : null;
}
/** 大括號配對抽出「head」開頭的整段（到配對的 } 與其後的 `;` 或 `);`） */
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

// 卡名對照（卡名取自 static/cards 官方卡面）
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
const KANGA = '超級袋獸ex', BOSS = '老大的指令', CATCH = '頂尖捕捉器';
assert.ok(idByName.has(KANGA) && idByName.has(BOSS) && idByName.has(CATCH), 'fixture：卡名都在卡池');
const deck = (names) => names.map((n) => ({ cardId: idByName.get(n), count: 4 }));

// 假 Mongo：find(filter, opts).sort().toArray()／for await／updateMany／updateOne／findOne／bulkWrite
const matchOne = (d, f) => Object.entries(f || {}).every(([k, v]) => {
  if (k === '$or') return v.some((x) => matchOne(d, x));
  if (v && typeof v === 'object' && '$ne' in v) return d[k] !== v.$ne;
  if (v && typeof v === 'object' && '$exists' in v) return (k in d) === v.$exists;
  if (v === null) return d[k] === null || !(k in d);
  return d[k] === v;
});
function fakeColl(docs) {
  const c = {
    docs, writes: [],
    find(filter) {
      const rows = docs.filter((d) => matchOne(d, filter)).map((d) => ({ ...d }));
      const cur = { sort: () => cur, batchSize: () => cur, toArray: async () => rows,
        async *[Symbol.asyncIterator]() { for (const r of rows) yield r; } };
      return cur;
    },
    async findOne(f) { return docs.find((d) => matchOne(d, f)) || null; },
    async updateMany(f, u) { let n = 0; for (const d of docs) if (matchOne(d, f)) { Object.assign(d, u.$set); n++; } c.writes.push(['many', f]); return { modifiedCount: n }; },
    async updateOne(f, u, o) { let d = docs.find((x) => matchOne(x, f)); if (!d && o && o.upsert) { d = { ...f }; docs.push(d); } if (d) Object.assign(d, u.$set); c.writes.push(['one', f]); return {}; },
    async bulkWrite(ops) { for (const op of ops) { const d = docs.find((x) => x._id === op.updateOne.filter._id); Object.assign(d, op.updateOne.update.$set); c.writes.push(['bulk', op.updateOne.filter._id]); } return {}; },
  };
  return c;
}

// 從伺服器補丁組出 registerDeckRules 的必要零件＋本版的區塊，接假 db 實跑
function buildServer(PATCH, { trules, posts, meta, nameMapImpl }) {
  const fns = ['deckToSets', 'deckMatchesRule', 'ruleStrictness', 'ruleRank', 'classifyDeck', 'sanitizeRule', 'archetypeNameOf']
    .map((n) => grabFn(PATCH, n)).filter(Boolean).join('\n');
  const mig = sentinel(PATCH, 'v157-rank50-migrate') || '';
  const rec = sentinel(PATCH, 'v157-reclassify') || '';
  const handlers = {};
  const app = { post: (p, _mw, h) => { handlers[p] = h; }, locals: {} };
  const caches = { _archDetailCache: new Map([['x', 1]]), _archStatsCache: new Map([['x', 1]]), _roomArchCache: new Map([['x', 1]]), _deckStatsCache: new Map([['x', 1]]) };
  const db = { collection: (n) => (n === 'deckPosts' ? posts : null) };
  let invalidated = 0;
  const hasConst = /const DEFAULT_RULE_RANK = ruleRank\(null\);/.test(PATCH);
  const body = fns + '\n' + (hasConst ? 'const DEFAULT_RULE_RANK = ruleRank(null);\n' : '')
    + 'const _archYield = () => null;\n' + mig + '\n' + rec
    + '\nreturn { ruleRank: typeof ruleRank === "function" ? ruleRank : null, sanitizeRule: typeof sanitizeRule === "function" ? sanitizeRule : null,'
    + ' DEFAULT_RULE_RANK: typeof DEFAULT_RULE_RANK === "undefined" ? undefined : DEFAULT_RULE_RANK };';
  const out = new Function('app', 'requireFirebaseAdmin', 'db', 'TRULES', 'getSupportPokemonCol', 'getCardNameMap', 'invalidateRulesCache',
    '_archDetailCache', '_archStatsCache', '_roomArchCache', '_deckStatsCache', body)(
    app, () => {}, db, trules, () => meta, async () => (nameMapImpl || nameMap), () => { invalidated++; },
    caches._archDetailCache, caches._archStatsCache, caches._roomArchCache, caches._deckStatsCache);
  const call = async (path, body) => {
    const h = handlers[path];
    if (!h) throw new Error('沒有端點 ' + path);
    let out2 = null, code = 200;
    const res = { status: (c) => { code = c; return res; }, json: (o) => { out2 = o; return res; } };
    await h({ body: body || {} }, res);
    return { code, out: out2 };
  };
  return { ...out, call, caches, invalidated: () => invalidated };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

// ════════════════════════════════════════════════════════════════════
const PATCH = rd('oracle-admin/server_admin_patch.js');
const ADMIN = rd('oracle-admin/admin.html');

async function judgeServer(P) {
  const r = {};
  // A1
  try {
    const S = buildServer(P, { trules: fakeColl([]), posts: fakeColl([]), meta: fakeColl([]) });
    const base = { name: 'X', includes: 'A' };
    r.A1 = S.ruleRank({}) === 50 && S.ruleRank({ rank: 0 }) === 0 && S.ruleRank({ rank: 'x' }) === 50 && S.ruleRank({ rank: 7 }) === 7
      && S.DEFAULT_RULE_RANK === 50 && S.sanitizeRule(base).doc.rank === 50 && S.sanitizeRule({ ...base, rank: 0 }).doc.rank === 0
      && S.sanitizeRule({ ...base, rank: 500 }).doc.rank === 99;
  } catch { r.A1 = false; }
  // A2 一次性遷移
  try {
    const rules = [{ _id: 'a' }, { _id: 'b', rank: null }, { _id: 'c', rank: 0 }, { _id: 'd', rank: 30 }, { _id: 'e', rank: -5 }];
    const meta = fakeColl([]);
    const TR = fakeColl(rules);
    buildServer(P, { trules: TR, posts: fakeColl([]), meta });
    await tick();
    const first = rules.map((x) => x.rank).join(',');
    rules[2].rank = 0;                       // 站長之後刻意改回 0
    buildServer(P, { trules: TR, posts: fakeColl([]), meta });   // 伺服器重啟
    await tick();
    r.A2 = first === '50,50,50,30,-5' && rules[2].rank === 0 && !!meta.docs.find((d) => d._id === 'rank50Migrated');
    r.A2detail = first + ' / 重啟後 c=' + rules[2].rank;
  } catch (e) { r.A2 = false; r.A2detail = e.message; }
  // A3 classify-decks：不經快取的最新規則
  try {
    const TR = fakeColl([{ _id: 'k1', name: '袋獸常見型', includes: [KANGA], rank: 50, enabled: true },
      { _id: 'k2', name: '袋獸老大型', includes: [KANGA, BOSS], rank: 60, enabled: true },
      { _id: 'k3', name: '停用中', includes: [CATCH], rank: 99, enabled: false }]);
    const S = buildServer(P, { trules: TR, posts: fakeColl([]), meta: fakeColl([{ _id: 'rank50Migrated' }]) });
    const { code, out } = await S.call('/api/admin/deck-rules/classify-decks', { decks: [
      { key: 'ev1', entries: deck([KANGA, BOSS]) }, { key: 'ev2', entries: deck([KANGA]) },
      { key: 'ev3', entries: deck([CATCH]) }, { key: 'ev4', entries: [] }] });
    r.A3 = code === 200 && out.results.ev1 === '袋獸老大型' && out.results.ev2 === '袋獸常見型' && out.results.ev3 === '未分類'
      && out.results.ev4 === null && out.rulesCount === 2 && S.invalidated() >= 1;
    const big = await S.call('/api/admin/deck-rules/classify-decks', { decks: Array.from({ length: 1001 }, (_, i) => ({ key: 'k' + i, entries: [] })) });
    r.A3 = r.A3 && big.code === 400;
    r.A3detail = JSON.stringify(out && out.results);
  } catch (e) { r.A3 = false; r.A3detail = e.message; }
  // A4 reclassify-stored
  try {
    const TR = fakeColl([{ _id: 'k1', name: '袋獸常見型', includes: [KANGA], rank: 50, enabled: true },
      { _id: 'k2', name: '袋獸老大型', includes: [KANGA, BOSS], rank: 60, enabled: true }]);
    const posts = fakeColl([
      { _id: 'p1', deckName: '舊判定', entries: deck([KANGA, BOSS]), archetype: '袋獸常見型' },   // 規則改了 ⇒ 要變
      { _id: 'p2', deckName: '本來就對', entries: deck([KANGA]), archetype: '袋獸常見型' },
      { _id: 'p3', deckName: '舊規則已刪', entries: deck([CATCH]), archetype: '捕捉器型' },       // 沒命中 ⇒ ''
      { _id: 'p4', deckName: '已刪除的投稿', entries: deck([KANGA, BOSS]), archetype: '', status: 'deleted' },
    ]);
    const S = buildServer(P, { trules: TR, posts, meta: fakeColl([{ _id: 'rank50Migrated' }]) });
    const { code, out } = await S.call('/api/admin/deck-rules/reclassify-stored', {});
    const arch = Object.fromEntries(posts.docs.map((d) => [d._id, d.archetype]));
    const wrote = posts.writes.filter((w) => w[0] === 'bulk').map((w) => w[1]).sort().join(',');
    const cleared = Object.values(S.caches).every((m) => m.size === 0);
    r.A4 = code === 200 && arch.p1 === '袋獸老大型' && arch.p2 === '袋獸常見型' && arch.p3 === '' && arch.p4 === '袋獸老大型'
      && wrote === 'p1,p3,p4' && out.scanned === 4 && out.changed === 3 && cleared;
    r.A4detail = JSON.stringify({ code, arch, wrote, cleared, out: out && { scanned: out.scanned, changed: out.changed } });
    // 卡名對照沒載入 ⇒ 503、一筆都不寫
    const posts2 = fakeColl([{ _id: 'q1', entries: deck([KANGA]), archetype: '袋獸常見型' }]);
    const S2 = buildServer(P, { trules: TR, posts: posts2, meta: fakeColl([{ _id: 'rank50Migrated' }]), nameMapImpl: new Map() });
    const z = await S2.call('/api/admin/deck-rules/reclassify-stored', {});
    r.A4 = r.A4 && z.code === 503 && posts2.writes.length === 0 && posts2.docs[0].archetype === '袋獸常見型';
  } catch (e) { r.A4 = false; r.A4detail = e.message; }
  return r;
}

console.log('【A】伺服器');
const A = await judgeServer(PATCH);
await T('★★★A1 序位：沒設＝50、明確 0＝0；DEFAULT_RULE_RANK 由 ruleRank 導出；sanitizeRule 沒填＝50', () => assert.ok(A.A1));
await T('★★★A2 一次性遷移：沒有序位／null／0 ⇒ 50（30、-5 不動）；重啟後站長刻意設的 0 不會再被改', () => assert.ok(A.A2, A.A2detail));
await T('★★★A3 classify-decks：最新規則（停用的不算）、回 原型名／未分類／null；一次超過 1000 副 ⇒ 400', () => assert.ok(A.A3, A.A3detail));
await T('★★★A4 reclassify-stored：只寫有變的、沒命中寫空字串、清掉四份原型快取；卡名對照沒載入 ⇒ 503 且一筆都不寫', () => assert.ok(A.A4, A.A4detail));
await T('★★A5 公布欄存的語義＝投稿時的 dpClassify（同一批牌表逐筆比對，dpClassify 原樣從錦標賽區塊抽出）', async () => {
  const dpSrc = grabFn(PATCH, 'dpClassify', 'async function ');
  const rec = sentinel(PATCH, 'v157-reclassify');
  const sp = grabFn(rec, 'storedPostArchetype');
  assert.ok(dpSrc.length > 200 && sp, '抽不到函式');
  const helpers = ['deckToSets', 'deckMatchesRule', 'ruleStrictness', 'ruleRank', 'classifyDeck', 'archetypeNameOf'].map((n) => grabFn(PATCH, n)).join('\n');
  for (const rules of [
    [{ _id: 'k1', name: '袋獸常見型', includes: [KANGA], rank: 50 }, { _id: 'k2', name: '袋獸老大型', includes: [KANGA, BOSS], rank: 40 }],
    [{ _id: 'k1', name: '捕捉器型', includes: [CATCH] }],
    [],
  ]) {
    const H = new Function('NM', helpers + '\nreturn { classifyDeck, deckToSets, getCardNameMap: async () => NM };')(nameMap);
    const app = { locals: { _deckRuleHelpers: H } };
    const db = { collection: () => ({ find: () => ({ toArray: async () => rules }) }) };
    const dpClassify = new Function('app', 'db', dpSrc + '\nreturn dpClassify;')(app, db);
    const stored = new Function(helpers + '\n' + sp + '\nreturn storedPostArchetype;')();
    for (const names of [[KANGA], [KANGA, BOSS], [CATCH], [BOSS]]) {
      const e = deck(names);
      const a = await dpClassify(e), b = stored(e, nameMap, rules);
      assert.strictEqual(b, a, '牌表 ' + names.join('+') + '：重新判定 ' + JSON.stringify(b) + ' ≠ 投稿時 ' + JSON.stringify(a));
    }
  }
});

// ════════════════════════════════════════════════════════════════════
console.log('\n【B】admin.html');
function judgeAdmin(H) {
  const r = {};
  const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  try {
    const rr = grabFn(H, 'ruleRankOf');
    const f = new Function('const DEFAULT_RULE_RANK = 50;\n' + rr + '\nreturn ruleRankOf;')();
    const rf = grabFn(H, 'readRuleForm');
    const read = (rank) => {
      const vals = { 'rule-name': 'X', 'rule-rank': rank };
      const document = { getElementById: (id) => ({ value: vals[id] ?? '', checked: true }) };
      return new Function('document', 'const DEFAULT_RULE_RANK = 50;\n' + rf + '\nreturn readRuleForm;')(document)().rank;
    };
    r.B1 = f({}) === 50 && f({ rank: 0 }) === 0 && f({ rank: null }) === 50 && f({ rank: 12 }) === 12 && read('') === 50 && read('0') === 0 && read('61') === 61
      && H.includes('<input id="rule-rank" type="number" min="-99" max="99" step="1" value="50"')
      && H.includes("set('rule-rank', DEFAULT_RULE_RANK);") && H.includes("set('rule-rank', ruleRankOf(r));")
      && /const DEFAULT_RULE_RANK = 50;/.test(H);
  } catch { r.B1 = false; }
  try {
    const src = ['tsChampRecOf', 'tsChampMainOf', 'tsChampDeckText', 'tsChampDeckCellHtml', 'tsChampDecksForClassify'].map((n) => grabFn(H, n)).join('\n');
    const mk = (map) => new Function('escapeHtml', 'detectMainPokemon', '_tsChampArch', src + '\nreturn { tsChampDeckCellHtml, tsChampDecksForClassify, tsChampDeckText };')(
      escapeHtml, () => '超級袋獸ex', map);
    const F = mk(new Map([['e1', '袋獸老大型'], ['e2', '未分類'], ['e4', null]]));
    const a = (id, champ = true) => ({ eventId: id, championUid: champ ? 'u1' : null, players: [{ uid: 'u1', deckEntries: [{ cardId: '1', count: 4 }] }] });
    const c1 = F.tsChampDeckCellHtml(a('e1')), c2 = F.tsChampDeckCellHtml(a('e2')), c3 = F.tsChampDeckCellHtml(a('e3')), c4 = F.tsChampDeckCellHtml(a('e4'));
    r.B2 = c1 === '袋獸老大型' && c2.startsWith('未分類') && c2.includes('主力：超級袋獸ex') && c3.startsWith('超級袋獸ex') && c3.includes('（主力寶可夢）')
      && c4.includes('（主力寶可夢）') && F.tsChampDeckCellHtml(a('e5', false)) === '—' && F.tsChampDeckText(a('e1')) === '袋獸老大型';
    const list = F.tsChampDecksForClassify([a('e1'), a('e2', false), { eventId: 'e9', championUid: 'u1', players: [{ uid: 'u1', deckEntries: [] }] }]);
    r.B2 = r.B2 && list.length === 1 && list[0].key === 'e1' && list[0].entries[0].cardId === '1';
    r.B2detail = JSON.stringify([c1, c2, c3, c4]);
  } catch (e) { r.B2 = false; r.B2detail = e.message; }
  return r;
}
async function judgeAdminAsync(H) {
  const r = {};
  try {
    const src = ['tsChampRecOf', 'tsChampMainOf', 'tsChampDeckText', 'tsChampDeckCellHtml', 'tsChampDecksForClassify'].map((n) => grabFn(H, n)).join('\n');
    const refresh = grabBlock(H, 'window.tsRefreshChampArchetypes = async function');
    if (!refresh) throw new Error('抽不到 tsRefreshChampArchetypes');
    const run = async (n, apiImpl) => {
      const calls = [];
      let rendered = 0;
      const env = { msg: '' };
      const archives = Array.from({ length: n }, (_, i) => ({ eventId: 'e' + i, championUid: 'u', players: [{ uid: 'u', deckEntries: [{ cardId: String(i), count: 1 }] }] }));
      archives.push({ eventId: 'nochamp', championUid: null, players: [] });
      const window = {};
      const document = { getElementById: (id) => (id === 'ts-champ-arch-msg' ? { set textContent(t) { env.msg = t; } } : null) };
      const ctx = new Function('window', 'document', 'api', 'tvRender', 'tournStatsCache', 'detectMainPokemon', 'escapeHtml',
        'let _tsChampArch = new Map([["old", "舊結果"]]); let _tsChampArchMsg = ""; let _tsChampArchBusy = false;\n' + src + '\n' + refresh
        + '\nreturn { get map() { return _tsChampArch; } };')(
        window, document, async (url, o) => { calls.push(JSON.parse(o.body).decks.length); return apiImpl(url, o); }, () => { rendered++; },
        { archives }, () => 'X', (s) => String(s));
      await window.tsRefreshChampArchetypes();
      return { calls, rendered, map: ctx.map, msg: env.msg };
    };
    const ok = await run(1201, async (_u, o) => ({ ok: true, rulesCount: 7, results: Object.fromEntries(JSON.parse(o.body).decks.map((d) => [d.key, '型' + d.key])) }));
    const bad = await run(3, async () => ({ error: '伺服器炸了' }));
    r.B3 = JSON.stringify(ok.calls) === '[500,500,201]' && ok.map.size === 1201 && ok.map.get('e1200') === '型e1200' && !ok.map.has('old')
      && ok.rendered === 1 && ok.msg.includes('7 條') && ok.msg.includes('1201 場')
      && bad.map.get('old') === '舊結果' && bad.rendered === 0 && bad.msg.includes('伺服器炸了');
    r.B3detail = JSON.stringify({ calls: ok.calls, size: ok.map.size, msg: ok.msg, bad: bad.msg });
  } catch (e) { r.B3 = false; r.B3detail = e.message; }
  try {
    const f = grabFn(H, 'reclassifyResultHtml');
    const html = new Function('escapeHtml', f + '\nreturn reclassifyResultHtml;')((s) => String(s))({
      rulesCount: 12, scanned: 340, changed: 5, byName: { 袋獸老大型: 3, '（未分類）': 2 }, samples: [{ deckName: 'A', from: '袋獸常見型', to: '袋獸老大型' }] });
    r.B4 = html.includes('12 條') && html.includes('340') && html.includes('<b>5</b>') && html.includes('袋獸老大型 3 篇') && html.includes('袋獸常見型 → <b>袋獸老大型</b>')
      && H.includes('onclick="reclassifyStoredArchetypes(this)"') && H.includes('window.reclassifyStoredArchetypes = async function')
      && H.includes("api('/api/admin/deck-rules/reclassify-stored'")
      && H.includes('onclick="tsRefreshChampArchetypes(this)"')
      && /renderTournamentStats\(el, tournStatsCache\);\n    tsRefreshChampArchetypes\(\);/.test(H)
      && H.includes("tvTh('tsArchives', 'champDeck', '冠軍牌型'");
  } catch (e) { r.B4 = false; }
  return r;
}
const B = judgeAdmin(ADMIN);
const B2 = await judgeAdminAsync(ADMIN);
await T('★★★B1 序位：空白＝50、填 0＝0、表單預設 50、編輯回填與新規則草稿走中央 ruleRankOf／DEFAULT_RULE_RANK', () => assert.ok(B.B1));
await T('★★★B2 歷屆賽事冠軍牌型：原型名／未分類（附主力）／還沒判定（主力寶可夢＋標註）；只送有冠軍有牌表的場次', () => assert.ok(B.B2, B.B2detail));
await T('★★★B3 重新判定冠軍牌型：每 500 副一批、結果整份換新並重畫表格；伺服器錯誤 ⇒ 顯示原因、舊結果不動', () => assert.ok(B2.B3, B2.B3detail));
await T('★★B4 一鍵重新判定的按鈕與結果摘要、冠軍牌型按鈕、載入賽事統計後自動判定一次、冠軍牌型欄可排序', () => assert.ok(B2.B4));
await T('★B5 admin 版本 v1.79（title 與 h1 一致）', () => {
  assert.ok(ADMIN.includes('<title>PTCG Oracle Admin v1.79</title>') && ADMIN.includes('<h1>🛠️ PTCG Oracle Admin <span class="small">v1.79</span></h1>'));
});

// ════════════════════════════════════════════════════════════════════
console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const bp = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js').out.replace(/\r\n/g, '\n');
  const bh = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/admin.html').out.replace(/\r\n/g, '\n');
  const sa = await judgeServer(bp);
  const ba = judgeAdmin(bh), bb = await judgeAdminAsync(bh);
  const red = Object.entries({ A1: sa.A1, A2: sa.A2, A3: sa.A3, A4: sa.A4, B1: ba.B1, B2: ba.B2, B3: bb.B3, B4: bb.B4 }).filter(([, v]) => !v).map(([k]) => k);
  console.log('  （BASE 紅了：' + red.join('、') + '）');
  await T('★★H0 BASE（v6.507）A1～A4、B1～B4 全紅', () => assert.deepStrictEqual(red, ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4']));
} else shallowSkip('admin v1.79 H0', '需要 BASE commit');

console.log(`\n=== admin v1.79／server v1.57 序位預設 50＋用最新規則重新判定：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
