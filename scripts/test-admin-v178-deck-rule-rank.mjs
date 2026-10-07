// ⭐ admin v1.78／server v1.56 守衛：牌組原型「序位」（站長 2026-10-07）
//   站長（逐字）：「之前在做牌組原型分類的時候，少了序位的方式，導致現在多個牌組有相同的牌的時候，會以設定的牌的多寡來分類，
//   例如有兩套牌組都設定了同一張超級袋獸ex，卻有可能是不同的牌組。因此需要幫一些常見和不常出現的牌組設定序位高低，
//   比較高的只要有符合內容就優先判定，比較低的要完全吻合，且高序位的牌組都未判定，才判定為本牌組」。
//
// 【A】伺服器：命中預覽端點（真 handler、假 Mongo）回「實際會被分到本規則幾副（wins）」與「被哪條規則拿走（lost）」，
//      而且用的是中央 classifyDeck（序位先比）
// 【B】admin.html：表單有序位欄、讀表單帶 rank、編輯／預覽回填／新規則草稿都會設序位、規則表有序位欄且預設依序位排序、
//      預覽顯示 wins／lost、說明文字不再寫「優先序數字最小」
// 【H】HEAD-FAIL：同一批判準餵 BASE（v6.506）逐條紅
// （classifyDeck 的序位語義由 test-deck-rule-engine 的 v1.56 段實跑。）
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.506。
const BASE_SHA = 'bb07efc6';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const T = async (n, fn) => { try { await fn(); pass++; console.log('  PASS ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + ' :: ' + (e && e.message)); } };

function grabFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const indent = ' '.repeat(src.slice(0, i).length - src.lastIndexOf('\n', i) - 1);
  const end = src.indexOf('\n' + indent + '}', i);
  return end > i ? src.slice(i, end + indent.length + 2) : null;
}
// 大括號配對抽出 app.post(...) 整段（含結尾的 `);`）
function grabRoute(src, head) {
  const i = src.indexOf(head);
  if (i < 0) return null;
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (d === 0) break; } }
  const k = src.indexOf(');', j);
  return src.slice(i, k + 2);
}

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
const deck = (names) => Object.fromEntries(names.map((n) => [idByName.get(n), 4]));

async function runPreview(PATCH, body, enabledRules) {
  const fns = ['deckToSets', 'deckMatchesRule', 'ruleStrictness', 'ruleRank', 'classifyDeck', 'sanitizeRule'].map((n) => grabFn(PATCH, n)).filter(Boolean).join('\n');
  const route = grabRoute(PATCH, "app.post('/api/admin/deck-rules/preview'");
  if (!route) throw new Error('抓不到預覽端點');
  let handler = null;
  const app = { post: (_p, _mw, h) => { handler = h; } };
  const records = [
    { endedAt: 3, p1: { name: 'A', cardCounts: deck([KANGA, BOSS, CATCH]) }, p2: { name: 'B', cardCounts: deck([KANGA, BOSS]) } },
    { endedAt: 2, p1: { name: 'C', cardCounts: deck([KANGA, CATCH]) }, p2: { name: 'D', cardCounts: deck([CATCH]) } },
  ];
  const db = { collection: () => ({ find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => records }) }) }) }) };
  new Function('app', 'requireFirebaseAdmin', 'db', 'getCardNameMap', 'getEnabledRulesCached',
    fns + '\n' + route)(app, () => {}, db, async () => nameMap, async () => enabledRules);
  let out = null, code = 200;
  const res = { status: (c) => { code = c; return res; }, json: (o) => { out = o; return res; } };
  await handler({ body, query: { limit: '200' } }, res);
  return { code, out };
}

console.log('【A】伺服器命中預覽');
const PATCH = rd('oracle-admin/server_admin_patch.js');
const judgeA = async (P) => {
  // 編輯中的「袋獸少見型」（序位 0，含袋獸＋老大）；既有啟用規則「袋獸常見型」（序位 10，只含袋獸）
  const common = { _id: 'k1', name: '袋獸常見型', includes: [KANGA], excludes: [], rank: 10, enabled: true };
  const body = { id: 'k2', name: '袋獸少見型', includes: [KANGA, BOSS].join('\n'), excludes: '', rank: 0, enabled: true };
  const r1 = await runPreview(P, body, [common, { _id: 'k2', name: '舊版本的自己', includes: [KANGA], rank: 99 }]);
  const r2 = await runPreview(P, { ...body, rank: 20 }, [common]);
  return { r1: r1.out, r2: r2.out };
};
let A = null;
await T('A0 預覽端點跑得起來', async () => { A = await judgeA(PATCH); assert.ok(A.r1 && A.r1.ok, JSON.stringify(A.r1)); });
await T('★★★A1 序位 0 的規則：符合 2 副，但都被序位 10 的「袋獸常見型」拿走 ⇒ wins=0、lost 列出它', async () => {
  assert.equal(A.r1.hits, 2);
  assert.equal(A.r1.wins, 0);
  assert.deepEqual(A.r1.lost, [{ name: '袋獸常見型', n: 2 }]);
});
await T('★★★A2 編輯中的規則本身（同 id 的舊版本）不算進「其他規則」；調高序位到 20 ⇒ 兩副都歸它', async () => {
  assert.ok(!A.r1.lost.some((x) => x.name === '舊版本的自己'), '同 id 的舊版本不可以把自己的命中搶走');
  assert.equal(A.r2.wins, 2); assert.deepEqual(A.r2.lost, []);
});
await T('★★A3 停用中的規則預覽：符合照算、實際歸類 0', async () => {
  const common = { _id: 'k1', name: '袋獸常見型', includes: [KANGA], rank: 10, enabled: true };
  const r = await runPreview(PATCH, { id: '', name: 'X', includes: KANGA, excludes: '', rank: 50, enabled: false }, [common]);
  assert.equal(r.out.hits, 3); assert.equal(r.out.wins, 0);
});

console.log('\n【B】admin.html');
const judgeB = (H) => {
  const r = {};
  r.B1 = H.includes('<input id="rule-rank" type="number" min="-99" max="99" step="1" value="0"');
  r.B2 = /rank: Number\(val\('rule-rank'\) \|\| 0\),/.test(H);
  r.B3 = H.includes("set('rule-rank', r.rank ?? 0);") && H.includes("set('rule-rank', form.rank);") && H.includes("set('rule-rank', 0);");
  r.B4 = H.includes("rank: { get: (r) => Number(r.rank) || 0 },") && H.includes("tvTh('deckRules', 'rank', '序位'") && H.includes("defaultSort: ['rank', 'desc'],");
  r.B5 = H.includes("typeof pv.wins === 'number'") && H.includes('其中實際會被分到本規則');
  r.B6 = !H.includes('取<b>優先序數字最小</b>的那條');
  return r;
};
const B = judgeB(rd('oracle-admin/admin.html'));
await T('★★B1 表單有序位欄（-99～99、預設 0）', () => assert.ok(B.B1));
await T('★★★B2 讀表單時帶 rank', () => assert.ok(B.B2));
await T('★★B3 編輯／預覽回填／新規則草稿都會設序位', () => assert.ok(B.B3));
await T('★★B4 規則表有序位欄、預設依序位由高到低排', () => assert.ok(B.B4));
await T('★★B5 預覽顯示實際歸類與被誰拿走', () => assert.ok(B.B5));
await T('★B6 說明文字不再寫「優先序數字最小」（v0.93 起就不是那樣判定了）', () => assert.ok(B.B6));
await T('★★B7 讀表單實跑：rank 欄填 12 ⇒ 送出 rank:12', () => {
  const H = rd('oracle-admin/admin.html');
  const i = H.indexOf('function readRuleForm()');
  const src = grabFn(H, 'readRuleForm');
  assert.ok(i > 0 && src, '抓不到 readRuleForm');
  const vals = { 'rule-name': 'X', 'rule-rank': '12' };
  const document = { getElementById: (id) => ({ value: vals[id] ?? '', checked: true }) };
  const f = new Function('document', src + '\nreturn readRuleForm;')(document);
  assert.equal(f().rank, 12);
});

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const bp = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js');
  const bh = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/admin.html');
  let redA = false;
  try { const x = await judgeA(bp.out.replace(/\r\n/g, '\n')); redA = x.r1.wins !== 0 || !Array.isArray(x.r1.lost); } catch { redA = true; }
  const BB = judgeB(bh.out.replace(/\r\n/g, '\n'));
  const redB = Object.entries(BB).filter(([, v]) => !v).map(([k]) => k);
  console.log('  （BASE 紅了：' + [redA ? 'A1' : null, ...redB].filter(Boolean).join('、') + '）');
  await T('★★H0 BASE 的伺服器沒有實際歸類（A1 紅），admin 的 B1～B6 全紅', () => {
    assert.ok(redA); assert.deepEqual(redB.sort(), ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']);
  });
} else shallowSkip('admin v1.78 H0', '需要 BASE commit');

console.log(`\n=== admin v1.78／server v1.56 牌組原型序位：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
