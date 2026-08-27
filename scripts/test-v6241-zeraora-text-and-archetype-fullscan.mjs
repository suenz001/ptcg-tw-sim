// v6.241 守衛 —— 站長的兩項裁定
//
// 【A】SVQP 捷拉奧拉（cardId 13145）｜麻麻關節 的卡面文字更正：
//     官方訓練家網站自己把它寫成「則**可**將對手的戰鬥寶可夢【麻痺】」（多一個「可」字），
//     我們的爬蟲當時照抄。同名同招式的另外兩個印刷（MC 16737、SV5M 9870）與站內同型的
//     擲幣附加狀態招式一律是「則將」，實作端本來就是「正面＝必定麻痺」。
//     ⇒ 改成正確文字，並登記到稽核工具的「刻意偏離官方」白名單（否則下次稽核會被報成差異、
//       然後被「修」回錯的）。⚠ 白名單必須維持 fail-open（兩側逐字匹配才豁免）。
//
// 【B】牌組原型【總表】/api/admin/deck-archetype-stats 與【明細】/api/admin/deck-archetype-detail
//     的 tournamentArchives `.limit(200)` 移除：那兩支都是**統計聚合**，限制筆數＝統計數字失真。
//     ⚠ 但不可讓 admin 變慢、也不可把大量資料 toArray 進玩家共用的 node 行程（v6.240 的 1.1GB 事故）
//       ⇒ 用 cursor 逐筆。本守衛用「這次查詢實際物化幾筆 / 有沒有走 toArray」當儀器（同 v6.240 手法）。
//
// 一律斷言到行為（Rule 25/32）：真的跑 handler、真的跑招式，不做「只驗字串存在」的守衛。
// 每條主斷言在 BASE(v6.240) 都會紅；另含突變測試。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const T = async (n, fn) => { try { await fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// ══════════════════════════════════════════════════════════════════════════
// 【A】卡面文字
// ══════════════════════════════════════════════════════════════════════════
const CARDS = join(ROOT, 'static/cards');
const LIVE = new Set(JSON.parse(readFileSync(join(CARDS, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
const bySet = {};
for (const f of readdirSync(CARDS)) {
  if (!f.endsWith('.json') || f === 'index.json' || !LIVE.has(f.slice(0, -5))) continue;
  const arr = JSON.parse(readFileSync(join(CARDS, f), 'utf8'));
  bySet[f.slice(0, -5)] = arr.length;
  for (const c of arr) if (c && c.id != null) pool.set(String(c.id), c);
}
// 掃描器下限斷言（Rule 25）：卡池讀不進來時不可以靜默全綠
assert.ok(pool.size > 4000, '卡池只讀到 ' + pool.size + ' 張 —— 掃描器壞了？');

const WANT = '擲1次硬幣若為正面，則將對手的戰鬥寶可夢【麻痺】。';
const atkOf = (id, name) => (pool.get(id).attacks || []).find((a) => a.name === name);

await T('【A】① 13145（SVQP 捷拉奧拉）｜麻麻關節 的 effect 逐字正確（BASE 必紅）', () => {
  const c = pool.get('13145');
  assert.ok(c, '找不到 cardId 13145');
  assert.strictEqual(c.name, '捷拉奧拉');
  assert.strictEqual(c.setCode, 'SVQP');
  assert.strictEqual(c.regulationMark, 'H');
  const a = atkOf('13145', '麻麻關節');
  assert.ok(a, '13145 沒有「麻麻關節」這招');
  assert.strictEqual(a.effect, WANT, '逐字不符（多/少了字？）');
  // 逐字＝連標點與碼位都一樣（避免「看起來一樣」的全形/半形陷阱）
  assert.deepStrictEqual([...a.effect].map((ch) => ch.codePointAt(0)), [...WANT].map((ch) => ch.codePointAt(0)));
  // 這一版只動 effect，其他欄位一個字都不能變
  assert.strictEqual(a.damage, '20');
  assert.deepStrictEqual(a.cost, ['Colorless']);
  assert.strictEqual(c.hp, 120);
  assert.strictEqual(c.pokemonType, 'Lightning');
  assert.strictEqual(c.collectorNumber, '009/023');
});

await T('【A】② 捷拉奧拉｜麻麻關節 的三個印刷現在逐字一致（13145 / 16737 / 9870）', () => {
  const ids = [];
  for (const [id, c] of pool) if (c.name === '捷拉奧拉' && (c.attacks || []).some((a) => a.name === '麻麻關節')) ids.push(id);
  assert.strictEqual(ids.length, 3, '同名同招式應有 3 個印刷，實得 ' + ids.length + '：' + ids.join(','));
  assert.deepStrictEqual(ids.sort(), ['13145', '16737', '9870'].sort());
  for (const id of ids) assert.strictEqual(atkOf(id, '麻麻關節').effect, WANT, id + ' 的文字不一致');
});

await T('【A】③ 站內同型「擲N次硬幣若為正面，則將…【狀態】」措辭一致（掃描器附下限）', () => {
  const RE = /^擲(\d+)次硬幣若為正面，則將對手的戰鬥寶可夢【(麻痺|中毒|睡眠|混亂|灼傷)】。$/;
  const BAD = /^擲(\d+)次硬幣若為正面，則可將對手的戰鬥寶可夢【(麻痺|中毒|睡眠|混亂|灼傷)】。$/;
  let ok = 0; const bad = [];
  for (const [id, c] of pool) for (const a of (c.attacks || [])) {
    if (RE.test(a.effect || '')) ok++;
    if (BAD.test(a.effect || '')) bad.push(id + ' ' + c.name + '｜' + a.name);
  }
  assert.ok(ok >= 60, '只掃到 ' + ok + ' 個同型招式 —— 掃描器壞了？');
  assert.deepStrictEqual(bad, [], '還有招式寫成「則可將…」：' + bad.join('、'));
});

// ── 稽核白名單：把 audit script 的白名單與比對邏輯抽出來**真的跑** ──
const auditSrc = readFileSync(join(ROOT, 'scripts/audit-card-data-vs-official.mjs'), 'utf8');
function braceEnd(src, openIdx, open = '{', close = '}') {
  let d = 0;
  for (let k = openIdx; k < src.length; k++) {
    if (src[k] === open) d++;
    else if (src[k] === close) { d--; if (d === 0) return k + 1; }
  }
  assert.fail('括號配對失敗 @' + openIdx);
}
function sliceFn(name) {
  const i = auditSrc.indexOf('function ' + name + '(');
  assert.ok(i >= 0, '找不到 ' + name);
  return auditSrc.slice(i, braceEnd(auditSrc, auditSrc.indexOf('{', auditSrc.indexOf(')', i))));
}
const wlStart = auditSrc.indexOf('const KNOWN_INTENTIONAL_DIVERGENCES = [');
assert.ok(wlStart >= 0, '找不到 KNOWN_INTENTIONAL_DIVERGENCES');
const wlSrc = auditSrc.slice(wlStart, braceEnd(auditSrc, auditSrc.indexOf('[', wlStart), '[', ']')) + ';';
const auditKit = (wl = wlSrc) => new Function('"use strict";\n' + wl + '\n'
  + sliceFn('normText') + '\n' + sliceFn('normEnergyArr') + '\n' + sliceFn('normAttacks') + '\n'
  + sliceFn('normAbilities') + '\n' + sliceFn('diffField') + '\n'
  + 'return { KNOWN_INTENTIONAL_DIVERGENCES, normText, diffField };')();

// 官方頁面現況（v6.241 實抓 2026-08-27，parse-card.js 解析結果）：仍寫「則可將」
const OFFICIAL_13145_ATTACKS = [
  { name: '麻麻關節', cost: ['Colorless'], damage: '20', effect: '擲1次硬幣若為正面，則可將對手的戰鬥寶可夢【麻痺】。' },
  { name: '強力伏特', cost: ['Lightning', 'Lightning', 'Colorless'], damage: '120', effect: '選擇1個這隻寶可夢身上附加的能量，將其丟棄。' },
];
/** 重現 audit script 的判斷：回 'waived' | 'gameDiff' | 'same' */
function verdict(kit, oursCard, officialAttacks) {
  const d = kit.diffField('attacks', oursCard.attacks, officialAttacks);
  if (!d) return 'same';
  const w = kit.KNOWN_INTENTIONAL_DIVERGENCES.find((x) =>
    x.id === '13145' && x.field === 'attacks'
    && kit.normText(x.ours) === d.ours && kit.normText(x.official) === d.official);
  return w ? 'waived' : 'gameDiff';
}

await T('【A】④ 白名單真的命中：修好的 13145 vs 官方錯字 ⇒ 豁免（不再報成差異）（BASE 必紅）', () => {
  const kit = auditKit();
  const e = kit.KNOWN_INTENTIONAL_DIVERGENCES.find((x) => x.id === '13145');
  assert.ok(e, '白名單沒有 13145');
  assert.strictEqual(e.field, 'attacks');
  assert.ok(/官方頁面自身的文字有誤/.test(e.reason), '理由沒有寫清楚「官方頁面自己錯」');
  assert.ok(/可/.test(e.reason) && /fail-open/.test(e.reason), '理由沒有交代錯在哪、也沒交代 fail-open');
  assert.strictEqual(verdict(kit, pool.get('13145'), OFFICIAL_13145_ATTACKS), 'waived',
    '13145 沒有被白名單豁免 —— 下次稽核會被報成差異、然後被「修」回錯的');
  // 白名單的 ours 必須就是我們現在資料庫裡的值（不是憑空寫的字串）
  const d = kit.diffField('attacks', pool.get('13145').attacks, OFFICIAL_13145_ATTACKS);
  assert.strictEqual(kit.normText(e.ours), d.ours, '白名單的 ours 與 DB 現值對不上');
  assert.strictEqual(kit.normText(e.official), d.official, '白名單的 official 與官方現況對不上');
});

await T('【A】⑤ 正對照：fail-open 沒壞 —— 任一側的值改變就回到差異報告', () => {
  // (a) 官方哪天把錯字修掉 / 又改成別的字 ⇒ 兩側不再逐字匹配 ⇒ 必須回到 gameDiff
  const kit = auditKit();
  const officialChanged = JSON.parse(JSON.stringify(OFFICIAL_13145_ATTACKS));
  officialChanged[0].effect = '擲1次硬幣若為正面，則可將對手的戰鬥寶可夢【麻痺】並回復30HP。';
  assert.strictEqual(verdict(kit, pool.get('13145'), officialChanged), 'gameDiff',
    '官方文字改了卻仍被靜默豁免 —— fail-open 壞了');
  // (b) 我們自己的資料被動到 ⇒ 同樣要回到 gameDiff
  const oursChanged = JSON.parse(JSON.stringify(pool.get('13145')));
  oursChanged.attacks[0].damage = '30';
  assert.strictEqual(verdict(kit, oursChanged, OFFICIAL_13145_ATTACKS), 'gameDiff',
    '我方資料被動到卻仍被靜默豁免 —— fail-open 壞了');
  // (c) 突變白名單那一筆的值 ⇒ 必須翻紅（證明 ④ 不是永遠綠的安慰劑）
  const mutated = wlSrc.replace('則可將對手的戰鬥寶可夢【麻痺】。"}', '則可將對手的戰鬥寶可夢【中毒】。"}');
  assert.notStrictEqual(mutated, wlSrc, '突變沒套用（白名單字串改了？）');
  assert.strictEqual(verdict(auditKit(mutated), pool.get('13145'), OFFICIAL_13145_ATTACKS), 'gameDiff',
    '把白名單的值改掉之後竟然還是豁免 —— ④ 擋不住回歸');
  // (d) 官方頁面若真的錯字修掉、與我方一致 ⇒ 根本沒有差異
  const officialFixed = JSON.parse(JSON.stringify(OFFICIAL_13145_ATTACKS));
  officialFixed[0].effect = WANT;
  assert.strictEqual(verdict(kit, pool.get('13145'), officialFixed), 'same');
});

await T('【A】⑥ 同名碰撞 audit 不留死條目：「可」字差異已消除 ⇒ 豁免清單不得再有這一筆', () => {
  const src = readFileSync(join(ROOT, 'scripts/audit-samename-collision.mjs'), 'utf8');
  const i = src.indexOf('const KNOWN = new Set([');
  assert.ok(i >= 0, '找不到 KNOWN');
  const seg = src.slice(i, braceEnd(src, src.indexOf('[', i), '[', ']'));
  const body = seg.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // 剝註解（Rule 25-4）
  const keys = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(keys.length >= 3, '只抽到 ' + keys.length + ' 筆 —— 抽取器壞了？');
  assert.ok(!keys.includes('捷拉奧拉|麻麻關節'),
    '「捷拉奧拉|麻麻關節」已不再是碰撞（三個印刷逐字相同），豁免清單留著會是死條目');
  assert.ok(keys.includes('銅鏡怪|鏡面攻擊'), '掃描器壞了？既有的真碰撞不見了');
});

// ── 實戰行為未變：真的跑那一招 ──
const S = join(ROOT, '.x6241-s.js'), E = join(ROOT, '.x6241-e.ts'), O = join(ROOT, '.x6241-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) try { unlinkSync(p); } catch { } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

let _iid = 0;
const inst = (cardId, e = {}) => ({ iid: 'x' + (++_iid), cardId, damage: 0, energyAttached: [], ...e });
function stFor(atkCardId, flips) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null,
    _retryInjectedFlipsQueue: flips,      // 固定擲幣結果（flipCoinsWithLog 的既有注入點）
    players: [
      { name: 'A', active: inst(atkCardId), bench: [], hand: [], deck: [], discard: [], prizes: [] },
      { name: 'B', active: inst('13145'), bench: [], hand: [], deck: [], discard: [], prizes: [] },
    ],
  };
}

await T('【A】⑦ 實戰行為未變：正面＝必定【麻痺】，且不會多開一個「要不要施加」的選擇視窗', () => {
  const fn = mod.ATTACK_POST.get('捷拉奧拉|麻麻關節');
  assert.ok(typeof fn === 'function', '捷拉奧拉|麻麻關節 沒有註冊 POST 效果');
  const heads = fn(stFor('13145', ['正面']), 0, pool);
  assert.strictEqual(heads.players[1].active.status, 'paralyzed', '正面卻沒有麻痺');
  assert.strictEqual(heads.pendingSelection, null, '冒出了選擇視窗 —— 那才是「則可將」的語意，不是卡面的意思');
  const tails = fn(stFor('13145', ['反面']), 0, pool);
  assert.strictEqual(tails.players[1].active.status, undefined, '反面卻麻痺了');
  assert.strictEqual(tails.pendingSelection, null);
});

await T('【A】⑧ 與「則將」措辭的同族卡走完全相同的實作（文字改動沒有動到行為）', () => {
  const a = mod.ATTACK_POST.get('捷拉奧拉|麻麻關節');
  const b = mod.ATTACK_POST.get('火斑喵|擊掌奇襲');    // 卡面本來就是「則將」
  assert.ok(typeof b === 'function', '對照組沒註冊');
  const norm = (st) => ({ status: st.players[1].active.status, pending: st.pendingSelection,
                          logs: st.log.map((l) => (typeof l === 'string' ? l : l.message)) });
  for (const flip of [['正面'], ['反面']]) {
    const ra = norm(a(stFor('13145', flip), 0, pool));
    const rb = norm(b(stFor('16737', flip), 0, pool));   // 用同一張防守方，只換進攻方招式
    assert.strictEqual(ra.status, rb.status, flip[0] + '：兩張卡的結果不同');
    assert.strictEqual(ra.pending, rb.pending);
  }
});

await T('【A】⑨ 校驗和：卡片總數與各卡包張數與 v6.240 完全相同（只改一個字串，沒有搬動資料）', () => {
  const EXPECT = {"M-P-H":11,"M-P-I":50,"M-P-J":101,"M1L":92,"M1S":92,"M2":116,"M2a":486,"M3":117,"M4":120,
    "M5":118,"M6":76,"MBD":24,"MBG":24,"MC":902,"MJ":24,"SV-P-H":61,"SV-P-I":22,"SV-P-J":21,"SV10":132,
    "SV11B":253,"SV11W":254,"SV5K":100,"SV5M":100,"SV5a":96,"SV6":133,"SV6a":94,"SV7":135,"SV7a":94,
    "SV8":138,"SV8a":335,"SV9":132,"SV9a":92,"SVK":50,"SVM":183,"SVOD":23,"SVOM":23,"SVPN":8,"SVPS":8,
    "SVQL":23,"SVQP":24,"svhk":24,"svhm":24};
  assert.deepStrictEqual(bySet, EXPECT, '各卡包張數變了');
  const tot = Object.values(bySet).reduce((a, b) => a + b, 0);
  assert.strictEqual(tot, 4935, '卡片總數變了：' + tot);
  assert.strictEqual(pool.size, 4935, 'cardId 出現重複（全站唯一性壞了）');
});

// ══════════════════════════════════════════════════════════════════════════
// 【B】牌組原型統計：全量 + cursor
// ══════════════════════════════════════════════════════════════════════════
const pat = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const adm = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
const verTs = readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8');

function arrowOf(anchor) {
  const i = pat.indexOf(anchor);
  assert.ok(i >= 0, '找不到端點錨點：' + anchor.slice(0, 60));
  const a = pat.indexOf('async (req, res) => {', i);
  assert.ok(a > i && a - i < 200, '端點錨點後找不到 handler');
  const txt = pat.slice(a, braceEnd(pat, pat.indexOf('{', a)));
  assert.ok(txt.length > 2000, 'handler 抽太短（抽取器壞了？）: ' + txt.length);
  return txt;
}

// ── 假 mongo driver：儀器＝物化筆數 + 有沒有走 toArray ──
function makeColl(docs, spy, sortKey, name) {
  return {
    find(filter) {
      const cur = { _limit: Infinity };
      cur.sort = () => cur; cur.skip = () => cur;
      cur.limit = (n) => { cur._limit = n; return cur; };
      const rows = () => {
        const r = docs.slice().sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
        return cur._limit === Infinity ? r : r.slice(0, cur._limit);
      };
      cur.toArray = async () => { const o = rows(); spy.materialised += o.length; (spy.toArrayOf[name] = (spy.toArrayOf[name] || 0) + o.length); return o.map((d) => ({ ...d })); };
      cur[Symbol.asyncIterator] = async function* () { for (const d of rows()) { spy.materialised++; spy.iterOf[name] = (spy.iterOf[name] || 0) + 1; yield { ...d }; } };
      return cur;
    },
  };
}
const mkRes = () => { const r = { body: null, code: 200 }; r.json = (o) => { r.body = o; return r; }; r.status = (c) => { r.code = c; return r; }; return r; };

// fixture：600 場歸檔（> 200 才驗得出上限被拿掉），每場 1 局、雙方各一副牌
const ARC_N = 600;
const NOW = Date.now();
const archives = [];
for (let i = 0; i < ARC_N; i++) {
  archives.push({
    _id: 'arch' + i, eventId: 'e' + i, finishedAt: NOW - i * 3600000,
    players: [
      { uid: 'u' + i, deckEntries: [{ cardId: 'c1', count: 4 }, { cardId: 'c2', count: 2 }] },
      { uid: 'v' + i, deckEntries: [{ cardId: 'c1', count: 3 }] },
    ],
    matches: [{ round: 1, p1uid: 'u' + i, p2uid: 'v' + i, winnerUid: 'u' + i, status: 'done' }],
  });
}
const RULE = { _id: 'R1', name: '皮卡丘', includes: [], excludes: [], priority: 1 };
const nameMap = new Map([['c1', '皮卡丘'], ['c2', '老大的指令']]);
const stubs = {
  getCardNameMap: async () => nameMap,
  TRULES: { find: () => ({ sort: () => ({ toArray: async () => [RULE] }) }) },
  deckToSets: (ref) => {
    const entries = Array.isArray(ref) ? ref.map((x) => [x.cardId, x.count]) : Object.entries(ref);
    return { names: new Set(entries.map(([id]) => nameMap.get(String(id)) || String(id))) };
  },
  classifyDeck: () => ({ rule: RULE, all: [RULE] }),
  buildCasualCleanFilter: () => ({}),
  casualSideResult: (winner, isP1) => ((winner === 'p1') === isP1 ? 'win' : 'loss'),
  tournSideResult: (winnerUid, uid) => (String(winnerUid) === String(uid) ? 'win' : 'loss'),
  getCardAttrMap: async () => new Map(),
  getPokemonNameSet: async () => new Set(['皮卡丘']),
  getSupportPokemonNames: async () => new Set(),
};

function buildHandler(arrowSrc, extra) {
  const spy = { materialised: 0, toArrayOf: {}, iterOf: {} };
  const arc = makeColl(archives, spy, 'finishedAt', 'tournamentArchives');
  const casual = makeColl([], spy, 'endedAt', 'matchRecords');
  const db = { collection: (n) => (n === 'tournamentArchives' ? arc : casual) };
  const names = ['db', 'console', ...Object.keys(stubs), ...Object.keys(extra || {})];
  const vals = [db, console, ...Object.values(stubs), ...Object.values(extra || {})];
  const h = new Function(...names, '"use strict"; return (' + arrowSrc + ');')(...vals);
  return { h, spy };
}
const call = async (h, query) => { const res = mkRes(); await h({ query }, res); assert.ok(res.body && !res.body.error, 'handler 回錯誤: ' + (res.body && res.body.error)); return res.body; };

let detailArrow = null, statsArrow = null;
await T('【B】前提：兩支 handler 抽得出來、且 tournamentArchives 已無 limit(200)（BASE 必紅）', () => {
  detailArrow = arrowOf("app.get('/api/admin/deck-archetype-detail', requireFirebaseAdmin");
  statsArrow = arrowOf("app.get('/api/admin/deck-archetype-stats', requireFirebaseAdmin");
  for (const [n, s] of [['明細', detailArrow], ['總表', statsArrow]]) {
    assert.ok(!/tournamentArchives'\)\.find\(q\)\.sort\(\{ finishedAt: -1 \}\)\.limit\(200\)/.test(s),
      n + '端點的錦標賽歸檔還套著 limit(200) —— 統計數字會是「只算最新 200 場」的錯數字');
    assert.ok(/for await \(const a of _cursor\)/.test(s), n + '端點沒有改用 cursor 逐筆');
  }
  // 全檔不得再有「歸檔 + limit(200) + toArray」的組合（避免漏改第三處）
  const left = [...pat.matchAll(/tournamentArchives'\)\.find\([^\n]*limit\(200\)/g)];
  assert.strictEqual(left.length, 0, '還有 ' + left.length + ' 處歸檔查詢套著 limit(200)');
});

await T('【B】① 明細端點：600 場全部進入統計（BASE 只會吃到 200 場）', async () => {
  const { h, spy } = buildHandler(detailArrow, { _archDetailCache: new Map(), normCardName: (n) => String(n || ''), wilsonLower: () => 0 });
  const b = await call(h, { ruleId: 'R1', source: 'tourn' });
  assert.strictEqual(b.scannedSrc, ARC_N, '只掃到 ' + b.scannedSrc + ' 場（應為 ' + ARC_N + '）');
  assert.strictEqual(b.sample.decks, ARC_N * 2, '進入統計的牌組應為 ' + ARC_N * 2 + ' 副次，實得 ' + b.sample.decks);
  assert.strictEqual(b.sample.wins, ARC_N, '勝場數錯');
  assert.strictEqual(b.sample.losses, ARC_N, '負場數錯');
  // 關鍵數字：c2（老大的指令）只出現在 p1 那副 ⇒ 採用率必須是 50%
  const c2 = b.cards.find((c) => c.name === '老大的指令');
  assert.ok(c2, '統計裡找不到 c2');
  assert.strictEqual(c2.nWith, ARC_N, '含 c2 的牌組數錯');
  assert.ok(Math.abs(c2.inclusion - 0.5) < 1e-9, '採用率應為 0.5，實得 ' + c2.inclusion);
});

await T('【B】② 明細端點：儀器 —— 歸檔走 cursor，一筆都沒有 toArray 進記憶體', async () => {
  const { h, spy } = buildHandler(detailArrow, { _archDetailCache: new Map(), normCardName: (n) => String(n || ''), wilsonLower: () => 0 });
  await call(h, { ruleId: 'R1', source: 'tourn' });
  assert.strictEqual(spy.toArrayOf.tournamentArchives || 0, 0,
    '歸檔被 toArray 了 ' + spy.toArrayOf.tournamentArchives + ' 筆 —— 那正是 v6.240 的 1.1GB 事故');
  assert.strictEqual(spy.iterOf.tournamentArchives, ARC_N, 'cursor 只吃到 ' + spy.iterOf.tournamentArchives + ' 筆');
});

await T('【B】③ 總表端點：600 場全部進入統計，usage/勝負為全量真值（BASE 必紅）', async () => {
  const { h, spy } = buildHandler(statsArrow, { _archStatsCache: new Map() });
  const b = await call(h, { source: 'tourn' });
  assert.strictEqual(b.scanned.tournEvents, ARC_N, 'tournEvents 應為 ' + ARC_N + '，實得 ' + b.scanned.tournEvents);
  assert.strictEqual(b.scanned.tournDecks, ARC_N * 2, 'tournDecks 應為 ' + ARC_N * 2);
  const row = b.tourn.rows.find((r) => r.ruleId === 'R1');
  assert.ok(row, '統計裡找不到原型 R1');
  assert.strictEqual(row.usage, ARC_N * 2, 'usage 應為 ' + ARC_N * 2 + '，實得 ' + row.usage);
  assert.strictEqual(row.wins, ARC_N, 'wins 應為 ' + ARC_N);
  assert.strictEqual(spy.toArrayOf.tournamentArchives || 0, 0, '總表端點把歸檔 toArray 了');
  assert.strictEqual(spy.iterOf.tournamentArchives, ARC_N, '總表端點的 cursor 只吃到 ' + spy.iterOf.tournamentArchives + ' 筆');
});

await T('【B】④ 突變測試：把 limit(200).toArray() 加回去 ⇒ ①②③ 必須翻紅', async () => {
  const MUT_FROM = "const _cursor = db.collection('tournamentArchives').find(q).sort({ finishedAt: -1 });\n          for await (const a of _cursor) {";
  const MUT_TO = "const _archives = await db.collection('tournamentArchives').find(q).sort({ finishedAt: -1 }).limit(200).toArray();\n          for (const a of _archives) {";
  for (const [n, src, extra, read] of [
    ['明細', detailArrow, { _archDetailCache: new Map(), normCardName: (x) => String(x || ''), wilsonLower: () => 0 },
      (b) => b.sample.decks],
    ['總表', statsArrow, { _archStatsCache: new Map() }, (b) => b.scanned.tournDecks],
  ]) {
    assert.ok(src.includes(MUT_FROM), n + ' 突變錨點對不上（寫法改了？）');
    const { h, spy } = buildHandler(src.replace(MUT_FROM, MUT_TO), extra);
    const b = await call(h, { ruleId: 'R1', source: 'tourn' });
    assert.strictEqual(read(b), 400, n + '：把 limit(200) 加回去之後統計竟然還是全量 —— 斷言擋不住回歸');
    assert.strictEqual(spy.toArrayOf.tournamentArchives, 200, n + '：突變後應走 toArray 200 筆');
  }
});

await T('【B】⑤ admin.html：MI_SCAN_CAP.tourn 不得再寫 200（否則超過 200 場永遠誤報「已達查詢上限」）', () => {
  // ⚠ v6.242 更新：休閒側（matchRecords）也已改成 cursor 全量掃描（站長裁定「一起處理」）
  //   ⇒ 原本這裡斷言 casual 必須維持 20000（「不在本次裁定範圍」）已經過期，
  //   而且 regex 的 (\d+) 也吃不下 Infinity。本條只守原始意圖：tourn 不可以被改回 200。
  const m = /const MI_SCAN_CAP = \{ casual: \['casualMatches', ([^\]]+)\], tourn: \['tournEvents', ([^\]]+)\] \};/.exec(adm);
  assert.ok(m, '找不到 MI_SCAN_CAP（寫法改了？）');
  assert.strictEqual(m[2].trim(), 'Infinity', '錦標賽側仍寫 ' + m[2] + ' —— 已經沒有查詢上限了');
});

await T('【B】⑥ ⚠ 資料保全：這一版沒有新增任何刪除歸檔的路徑', () => {
  const dm = [...pat.matchAll(/(TARCHIVE|TCHAMPS)\.(deleteMany|drop)\b/g)];
  assert.strictEqual(dm.length, 0, '賽事歸檔出現批次刪除：' + dm.map((x) => x[0]).join(', '));
  const del = [...pat.matchAll(/(TARCHIVE|TCHAMPS)\.deleteOne\b/g)].length;
  assert.strictEqual(del, 3, '歸檔的 deleteOne 呼叫點應剛好 3 處（站長手按的），實得 ' + del);
  const ttl = [...pat.matchAll(/(\w+)\.createIndex\([^)]*expireAfterSeconds/g)].map((x) => x[1]);
  assert.ok(ttl.length > 0, '掃描器壞了？全檔應至少有兩個 TTL 索引');
  for (const c of ttl) assert.ok(c !== 'TARCHIVE' && c !== 'TCHAMPS', c + ' 竟然有 TTL 索引');
});

await T('版本一致：version.ts ≥ 6.241 且 admin.html SITE_VERSION_HINT 同步', () => {
  const V = /VERSION = '([\d.]+)'/.exec(verTs)[1];
  // ⚠ v6.242 更新：原本寫死 '6.241'，下一版一 bump 就必紅 —— 守衛因為「不是 bug 的原因」
  //   變紅，接著就會有人去 skip 它。改斷「不得倒退」這個真正的不變量。
  assert.ok(parseFloat(V) >= 6.241, 'version.ts 倒退了（實為 ' + V + '）');
  const H = /SITE_VERSION_HINT = '([\d.]+)'/.exec(adm)[1];
  assert.strictEqual(H, V, 'hint ' + H + ' ≠ version.ts ' + V);
  assert.ok(!adm.includes('\r'), 'admin.html 出現 CRLF');
});

// ══ benchmark（Rule 32：效能數字必須附量測腳本，這裡就是那支腳本）══
//   問的是站長最在意的兩件事：①admin 會不會變慢 ②會不會把大量資料讀進玩家共用的 node 行程。
await T('⑦ benchmark：真的跑 handler —— 改前（toArray 200 筆）vs 改後（cursor 全量）', async () => {
  // 貼近線上的歸檔：8 人賽、每人 60 張（deckEntries 約 20 種）、12 局
  const mkArc = (i) => ({
    _id: 'a' + i, eventId: 'e' + i, finishedAt: NOW - i * 1000,
    players: Array.from({ length: 8 }, (_, k) => ({ uid: 'u' + i + '_' + k, name: '玩家' + k, email: 'p' + i + k + '@x.tw',
      deckEntries: Array.from({ length: 20 }, (_, j) => ({ cardId: 'sv' + j, count: 3 })) })),
    matches: Array.from({ length: 12 }, (_, k) => ({ round: 1 + (k >> 2), idx: k, p1uid: 'u' + i + '_' + (k % 8),
      p2uid: 'u' + i + '_' + ((k + 1) % 8), winnerUid: 'u' + i + '_' + (k % 8), status: 'done' })),
  });
  const BIG_N = 3000;                      // 未來量級（現況遠低於此，量的是上界）
  const big = Array.from({ length: BIG_N }, (_, i) => mkArc(i));
  const perDoc = JSON.stringify(big[0]).length;
  const KB = (b) => (b / 1024).toFixed(1) + ' KB';
  const MB = (b) => (b / 1048576).toFixed(2) + ' MB';

  // ⚠ mongo driver 是把 BSON 反序列化成**新物件**，不是共用參考 ⇒ 用 JSON round-trip 模擬，
  //   否則 { ...d } 的淺拷貝會把記憶體成本量成 0（Rule 32：別讓量測自己說謊）。
  function bench(docs, mode) {
    const spy = { materialised: 0, toArrayOf: {}, iterOf: {} };
    const coll = {
      find() {
        const cur = { _limit: Infinity };
        cur.sort = () => cur; cur.limit = (n) => { cur._limit = n; return cur; };
        const rows = () => (cur._limit === Infinity ? docs : docs.slice(0, cur._limit));
        cur.toArray = async () => { const o = rows().map((d) => JSON.parse(JSON.stringify(d))); spy.materialised += o.length; spy.toArrayOf.tournamentArchives = o.length; return o; };
        cur[Symbol.asyncIterator] = async function* () { for (const d of rows()) { spy.materialised++; spy.iterOf.tournamentArchives = (spy.iterOf.tournamentArchives || 0) + 1; yield JSON.parse(JSON.stringify(d)); } };
        return cur;
      },
    };
    const db = { collection: () => coll };
    const src = mode === 'before'
      ? statsArrow.replace(
          "const _cursor = db.collection('tournamentArchives').find(q).sort({ finishedAt: -1 });\n          for await (const a of _cursor) {",
          "const _archives = await db.collection('tournamentArchives').find(q).sort({ finishedAt: -1 }).limit(200).toArray();\n          for (const a of _archives) {")
      : statsArrow;
    const names = ['db', 'console', '_archStatsCache', ...Object.keys(stubs)];
    const vals = [db, console, new Map(), ...Object.values(stubs)];
    return { h: new Function(...names, '"use strict"; return (' + src + ');')(...vals), spy };
  }

  const run = async (mode) => {
    const { h, spy } = bench(big, mode);
    const h0 = process.memoryUsage().heapUsed;
    const t0 = process.hrtime.bigint();
    const res = mkRes(); await h({ query: { source: 'tourn' } }, res);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    return { ms, peak: process.memoryUsage().heapUsed - h0, spy, body: res.body };
  };
  const before = await run('before');
  const after = await run('after');

  console.log('      每筆歸檔（8 人賽 / 每人 60 張 / 12 局）約 ' + KB(perDoc) + '；fixture ' + BIG_N + ' 場');
  console.log('      改前（limit(200).toArray）：進入統計 ' + before.body.scanned.tournEvents + ' 場／'
    + before.body.scanned.tournDecks + ' 副次，一次物化 ' + before.spy.toArrayOf.tournamentArchives
    + ' 筆＝同時駐留約 ' + MB(perDoc * 200) + '，handler ' + before.ms.toFixed(1) + ' ms');
  console.log('      改後（cursor 全量）      ：進入統計 ' + after.body.scanned.tournEvents + ' 場／'
    + after.body.scanned.tournDecks + ' 副次，逐筆物化 ' + after.spy.iterOf.tournamentArchives
    + ' 筆＝同時只駐留 1 筆約 ' + KB(perDoc) + '，handler ' + after.ms.toFixed(1) + ' ms');
  console.log('      ⇒ 每場歸檔的處理成本 ' + (after.ms / BIG_N * 1000).toFixed(0) + ' µs；'
    + '同時駐留量由 O(N) 變成 O(1)（' + MB(perDoc * 200) + ' → ' + KB(perDoc) + '）。');
  console.log('      ⚠ 端點本來就有 60 秒 TTL 快取 ⇒ admin 反覆切換不會重算；'
    + '沙盒 CPU 約為正式 VM（ARM A1.Flex）的數倍慢，換算後才可推論線上（Rule 32）。');

  // 量級檢核（不是「有跑就好」）：
  assert.strictEqual(before.body.scanned.tournEvents, 200, '改前應只吃到 200 場');
  assert.strictEqual(after.body.scanned.tournEvents, BIG_N, '改後應吃到全量 ' + BIG_N + ' 場');
  assert.strictEqual(after.spy.toArrayOf.tournamentArchives || 0, 0, '改後仍走了 toArray');
  assert.ok(perDoc > 3000, '每筆歸檔只有 ' + perDoc + ' bytes —— fixture 不像線上資料');
  // 每場成本必須是「微秒級」，否則 admin 會因為全量而變慢（站長的紅線）
  const perEventUs = after.ms / BIG_N * 1000;
  assert.ok(perEventUs < 2000, '每場歸檔要 ' + perEventUs.toFixed(0) + 'µs —— 全量會讓 admin 變慢');
});

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
