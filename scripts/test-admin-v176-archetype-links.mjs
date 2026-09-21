// admin v1.76／server patch v1.48 守衛：牌組原型 ↔ 房間 ↔ 規則 互通（站長四選）
//
// 站長選項（逐字，AskUserQuestion 四項全選）：「牌組視窗一鍵建規則（推薦）,對戰歷史改用原型,高頻卡直接開規則,原型與房間互相跳轉」
//   ① 🃏 牌組 modal：顯示座位原型＋「以這副牌建立原型規則」→ 中央 openRuleDraft 預填（不存檔）
//   ② 📜 對戰歷史：伺服器（v1.48）替每筆紀錄補 p1/p2.archetype（走中央 archetypeNameOf），可搜原型（含「未分類」）
//   ③ 未分類高頻卡 chip 的「＋規則」→ 同一個 openRuleDraft
//   ④ 🎮 Oracle 對戰搜尋框旁的原型下拉；原型統計每列「🎮 看房間」→ 已結束＋帶入原型名搜尋
// 驗法：伺服器端沿用 test-admin-v175 的抽取法（真 deckToSets/classifyDeck/archetypeNameOf ＋ 真端點）＋假 Mongo；
//   前端把真函式抽出來、注入最小替身實跑（不是只驗字串）。
// 【HEAD-FAIL】BASE（admin v1.75／server v1.47）：A1～A5、B1～B6 紅。
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
function braceBlock(src, start, what) {
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { end = i; break; } } }
  ok(end > 0, what + ' 大括號配對失敗');
  return end;
}
function extractAppGet(src, needle, what) {
  const g = src.indexOf(needle); ok(g >= 0, '抽不到 ' + what);
  const end = braceBlock(src, g, what);
  const close = src.indexOf(');', end); ok(close > 0, what + ' 收尾');
  return src.slice(g, close + 2);
}
/** 抽 `window.NAME = function` / `window.NAME = async function` / `function NAME(` 的完整原始碼；找不到回 null。 */
function fnSrc(src, name) {
  const pats = ['window.' + name + ' = async function', 'window.' + name + ' = function', 'async function ' + name + '(', 'function ' + name + '('];
  for (const p of pats) {
    const s = src.indexOf(p);
    if (s < 0) continue;
    const end = braceBlock(src, s + p.length, name);
    let out = src.slice(s, end + 1);
    if (p.startsWith('window.')) out += ';';
    return out;
  }
  return null;
}
const MISSING = (n) => { throw new Error('找不到 ' + n + '（BASE 上本來就沒有）'); };

// ── 伺服器端：假 Mongo（$and/$or/regex/$type/$gte/$gt/$in、巢狀路徑）──
const getPath = (o, p) => p.split('.').reduce((c, k) => (c == null ? undefined : c[k]), o);
function condOk(v, cond) {
  if (cond instanceof RegExp) return v != null && cond.test(String(v));
  if (cond === null) return v == null;
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    if ('$type' in cond) return cond.$type === 'string' ? typeof v === 'string' : false;
    if ('$gte' in cond) return typeof v === 'number' && v >= cond.$gte;
    if ('$gt' in cond) return typeof v === 'number' && v > cond.$gt;
    if ('$in' in cond) return cond.$in.includes(v);
  }
  return v === cond;
}
function matchDoc(d, f) {
  for (const k of Object.keys(f || {})) {
    if (k === '$and') { if (!f.$and.every((x) => matchDoc(d, x))) return false; continue; }
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
        if (spy.scanThrows && opts && opts.projection && opts.projection['p1.cardCounts'] === 1) throw new Error('scan boom');
        const cur = { _skip: 0, _limit: Infinity };
        cur.sort = () => cur; cur.skip = (k) => { cur._skip = k; return cur; }; cur.limit = (k) => { cur._limit = k; return cur; };
        cur.toArray = async () => {
          const r = (n === 'matchRecords' ? docs : []).filter((d) => matchDoc(d, filter)).sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
          return r.slice(cur._skip, cur._limit === Infinity ? undefined : cur._skip + cur._limit).map((d) => JSON.parse(JSON.stringify(d)));
        };
        return cur;
      },
      countDocuments: async (f) => (n === 'matchRecords' ? docs.filter((d) => matchDoc(d, f || {})).length : 0),
      aggregate: () => ({ toArray: async () => [] }),
      createIndex: async () => 'ok',
    }),
  };
}
function buildServer(patchSrc, docs, spy, rules, opts = {}) {
  const coreFns = sliceBetween(patchSrc, 'function deckToSets(cardCounts, nameMap) {', '\n    function sanitizeRule', '分類核心');
  const start = patchSrc.indexOf('const _roomArchCache = new Map();'); ok(start >= 0, '抽不到 _roomArchCache');
  const ep = extractAppGet(patchSrc, "app.get('/api/rooms-archetypes'", '大廳原型端點');
  const archBlock = patchSrc.slice(start, patchSrc.indexOf(ep) + ep.length);
  const mrEp = extractAppGet(patchSrc, "app.get('/api/admin/match-records',", '對戰歷史端點');
  const handlers = {};
  const app = { locals: {}, get: (p, ...rest) => { handlers[p] = rest[rest.length - 1]; } };
  const nameMap = new Map(NAMEMAP);
  new Function('app', 'db', 'getCardNameMap', 'getEnabledRulesCached', 'summarizeRoom', 'enrichSeats', 'requireFirebaseAdmin',
    coreFns + '\n' + archBlock + '\n' + mrEp)(
    app, makeDb(docs, spy),
    opts.nameMapThrows ? async () => { throw new Error('boom'); } : async () => nameMap,
    async () => rules, (r) => r, async () => {}, () => {});
  ok(typeof handlers['/api/admin/match-records'] === 'function', '對戰歷史端點沒註冊');
  return handlers['/api/admin/match-records'];
}
async function call(h, query) {
  let out = null; const res = { json: (x) => { out = x; return res; }, status: () => res };
  await h({ query }, res); ok(out && !out.error, '端點回錯誤：' + (out && out.error)); return out;
}

const RULES = [{ _id: 'r1', name: '雙龍特調', includes: ['多龍巴魯托ex'], enabled: true, priority: 1 }];
const NAMEMAP = [['101', '多龍巴魯托ex'], ['102', '索羅亞克ex'], ['901', '基本【惡】能量']];
const HIT = { 101: 3, 901: 10 };
const MISS = { 102: 4, 901: 8 };
const NOW = Date.now();
const rec = (id, p1, p2, extra = {}) => ({ _id: id, roomCode: 'R' + id, endedAt: NOW - Number(String(id).replace(/\D/g, '') || 0) * 1000,
  p1: { name: '甲' + id, email: 'a' + id + '@x', cardCounts: p1 }, p2: { name: '乙' + id, email: 'b' + id + '@x', cardCounts: p2 }, ...extra });
const DOCS = [
  rec('M1', HIT, HIT), rec('M2', HIT, MISS), rec('M3', MISS, MISS), rec('M4', HIT, undefined),
  rec('M5', MISS, MISS, { roomCode: null }),          // 本機對戰
];
const ids = (b) => b.records.map((r) => r._id).sort().join(',');

console.log('\n【A】伺服器端：📜 對戰歷史的牌組原型');
await T('A1 ⭐⭐⭐【HEAD-FAIL】每筆紀錄的 p1/p2 補上 archetype（中央分類）；沒牌表＝null（還不知道）', async () => {
  const h = buildServer(PATCH, DOCS, { finds: [] }, RULES);
  const b = await call(h, { limit: '50' });
  const m = Object.fromEntries(b.records.map((r) => [r._id, [r.p1.archetype, r.p2.archetype]]));
  ok(JSON.stringify(m.M1) === '["雙龍特調","雙龍特調"]', 'M1 ' + JSON.stringify(m.M1));
  ok(JSON.stringify(m.M2) === '["雙龍特調","未分類"]', 'M2 ' + JSON.stringify(m.M2));
  ok(m.M4[0] === '雙龍特調' && m.M4[1] === null, 'M4（沒牌表）必須是 null，不可當成未分類：' + JSON.stringify(m.M4));
});
await T('A2 ⭐⭐【HEAD-FAIL】搜「未分類」⇒ 任一方未分類的場次（M2、M3、M5），且回報 archScan', async () => {
  const h = buildServer(PATCH, DOCS, { finds: [] }, RULES);
  const b = await call(h, { limit: '50', q: '未分類' });
  ok(ids(b) === 'M2,M3,M5', '實得 ' + ids(b));
  ok(b.archScan && b.archScan.matched === 3 && b.archScan.capped === false && b.archScan.scanned === 5, JSON.stringify(b.archScan));
});
await T('A3 ⭐⭐【HEAD-FAIL】搜原型名稱的一部分（「雙龍」）⇒ 命中 M1、M2、M4；掃描遵守模式篩選（線上）', async () => {
  const h = buildServer(PATCH, DOCS, { finds: [] }, RULES);
  const b = await call(h, { limit: '50', q: '雙龍' });
  ok(ids(b) === 'M1,M2,M4', '實得 ' + ids(b));
  const spy = { finds: [] }; const h2 = buildServer(PATCH, DOCS, spy, RULES);
  const b2 = await call(h2, { limit: '50', q: '未分類', mode: 'online' });
  ok(ids(b2) === 'M2,M3', '線上模式仍掃到本機場：' + ids(b2));
  const scan = spy.finds.find((f) => f.opts && f.opts.projection && f.opts.projection['p1.cardCounts'] === 1);
  ok(scan && Object.keys(scan.opts.projection).sort().join(',') === '_id,p1.cardCounts,p2.cardCounts', '掃描 projection 不對');
  ok(b2.archScan && b2.archScan.scanned === 4, '掃描沒有套用模式篩選（應只掃 4 場線上）：' + JSON.stringify(b2.archScan));
});
await T('A4 ⭐零額外成本：搜玩家名 ⇒ 不做原型掃描、archScan 為 null，結果照舊', async () => {
  const spy = { finds: [] }; const h = buildServer(PATCH, DOCS, spy, RULES);
  const b = await call(h, { limit: '50', q: '甲M3' });
  ok(ids(b) === 'M3', '玩家名搜尋壞了：' + ids(b));
  ok(b.archScan == null, '不該做原型掃描');
  ok(!spy.finds.some((f) => f.opts && f.opts.projection && f.opts.projection['p1.cardCounts'] === 1), '多做了一次原型掃描');
});
await T('A5 ⭐【HEAD-FAIL】原型分類失敗（卡名對照載入丟錯）⇒ 列表照常回、沒有 archetype 欄位（前端退回主力打手）', async () => {
  const h = buildServer(PATCH, DOCS, { finds: [] }, RULES, { nameMapThrows: true });
  const b = await call(h, { limit: '50' });
  ok(b.records.length === 5, '列表壞了');
  ok(b.records.every((r) => !('archetype' in r.p1)), '失敗時不可留下半套欄位');
  ok(PATCH.includes('app.locals._archetypeEnrichMatchRecords'), '（HEAD-FAIL 錨）沒有 _archetypeEnrichMatchRecords');
});
await T('A7 ⭐超過掃描上限 ⇒ archScan.capped=true 誠實回報', async () => {
  const big = [];
  for (let i = 0; i < 5003; i++) big.push(rec('X' + i, i % 2 ? MISS : HIT, HIT));
  const h = buildServer(PATCH, big, { finds: [] }, RULES);
  const b = await call(h, { limit: '50', q: '未分類' });
  ok(b.archScan && b.archScan.capped === true && b.archScan.scanned === b.archScan.cap && b.archScan.cap >= 1000, JSON.stringify(b.archScan));
});
await T('A8 ⭐原型掃描丟錯 ⇒ 略過原型搜尋、其他搜尋照常回應（不可讓請求掛住）', async () => {
  const spy = { finds: [], scanThrows: true }; const h = buildServer(PATCH, DOCS, spy, RULES);
  const b = await call(h, { limit: '50', q: '未分類' });
  ok(Array.isArray(b.records) && b.archScan == null, JSON.stringify(b.archScan));
});
await T('A6 規則庫空（rules 空）⇒ archetype 為 null（還不知道），搜「未分類」一筆都不算命中，不報錯', async () => {
  const h = buildServer(PATCH, DOCS, { finds: [] }, []);
  const b = await call(h, { limit: '50', q: '未分類' });
  ok(b.archScan == null || b.archScan.matched === 0, JSON.stringify(b.archScan));
  ok(b.records.length === 0, '規則庫空時「未分類」不可命中任何場次（null 不是未分類）：' + ids(b));
  const b2 = await call(h, { limit: '50' });
  ok(b2.records.every((r) => r.p1.archetype == null && r.p2.archetype == null), '規則庫空時不可給出「未分類」');
});

console.log('\n【B】admin 前端（抽真函式實跑）');
// 最小替身：cardInfoMap／cardTagsCache
const CARDS = {
  a1: { supertype: 'Pokemon', subtype: 'ex', name: '多龍巴魯托ex' },
  a2: { supertype: 'Pokemon', subtype: 'Stage2', name: '沙奈朵' },
  a3: { supertype: 'Pokemon', subtype: 'ex', name: '吉雉雞ex' },
  a4: { supertype: 'Pokemon', subtype: 'Basic', name: '拉魯拉絲' },
  s1: { supertype: 'Pokemon', subtype: 'ex', name: '喵喵ex' },
  t1: { supertype: 'Trainer', subtype: 'Supporter', name: '老大的指令' },
};
const TAGS = { s1: ['support'] };
const mpcSrc = fnSrc(HTML, 'mainPokemonCandidates');
const dmpSrc = fnSrc(HTML, 'detectMainPokemon');
const mk = (body, ret) => new Function('cardInfoMap', 'cardTagsCache', body + '\nreturn ' + ret + ';')(CARDS, TAGS);
await T('B1 ⭐⭐【HEAD-FAIL】主力候選判準只有一份：detectMainPokemon ＝ mainPokemonCandidates 第一名', async () => {
  ok(mpcSrc, '找不到 mainPokemonCandidates');
  const [cands, dmp] = mk(mpcSrc + '\n' + dmpSrc, '[mainPokemonCandidates, detectMainPokemon]');
  const deck = [{ cardId: 'a4', count: 4 }, { cardId: 'a2', count: 3 }, { cardId: 's1', count: 1 }, { cardId: 'a1', count: 2 }, { cardId: 't1', count: 4 }];
  const c = cands(deck);
  ok(JSON.stringify(c) === '["多龍巴魯托ex","沙奈朵","拉魯拉絲"]', '候選順序：' + JSON.stringify(c));
  ok(dmp({ deckEntries: deck }) === c[0], 'detectMainPokemon 與候選第一名不一致');
  ok(!/const score = \(isRuleBox/.test(dmpSrc), 'detectMainPokemon 裡還留著自己的一份評分（Rule 38：判準寫了兩份）');
  // 支援型名單（原型用）也要排除；吉雉雞ex 是 ex 分數最高，排除後不得出現
  const c2 = cands(deck.concat([{ cardId: 'a3', count: 3 }]), ['吉雉雞ex']);
  ok(!c2.includes('吉雉雞ex') && c2[0] === '多龍巴魯托ex', JSON.stringify(c2));
  ok(cands(deck.concat([{ cardId: 'a3', count: 3 }]))[0] === '吉雉雞ex', '正對照：沒給名單時吉雉雞ex（ex、3 張）應排第一 — 排除判準抓不到東西');
  // 同名去重＋同分順序：A(低分) → B(高分) → A'(同高分) ⇒ 第一名必須是 B（v1.19「第一個嚴格最高分」）
  const tie = [{ cardId: 'a4', count: 1 }, { cardId: 'a2', count: 1 }, { cardId: 'a4b', count: 11 }];
  CARDS.a4b = { supertype: 'Pokemon', subtype: 'Basic', name: '拉魯拉絲' };
  ok(cands(tie)[0] === '沙奈朵' && dmp({ deckEntries: tie }) === '沙奈朵', '同分順序與 v1.19 不同：' + JSON.stringify(cands(tie)));
  ok(JSON.stringify(cands(tie)) === '["沙奈朵","拉魯拉絲"]', '同名沒去重：' + JSON.stringify(cands(tie)));
});
await T('B2 ⭐⭐【HEAD-FAIL】openRuleDraft：切到規則分頁、預填名稱／必含卡／備註，rule-id 一定清空（絕不覆蓋既有規則）', async () => {
  const src = fnSrc(HTML, 'openRuleDraft'); ok(src, '找不到 openRuleDraft');
  const els = {}; const calls = [];
  const doc = { getElementById: (k) => (els[k] = els[k] || { value: k === 'rule-id' ? 'OLD_RULE' : 'x', checked: false, focus() {}, select() {} }) };
  const win = { scrollTo() {} };
  const run = new Function('window', 'document', 'switchTab', 'renderDeckRules', 'scrollTo',
    'let _rulePreview = { stale: true };\n' + src + '\nreturn [window.openRuleDraft, () => _rulePreview];')(
    win, doc, async (t) => { calls.push(t); }, () => { calls.push('render'); }, () => {});
  await run[0]({ name: '雙龍特調', includes: ['多龍巴魯托ex', '', '索羅亞克ex'], note: '由房間 X 草擬' });
  ok(calls[0] === 'deck-rules' && calls.includes('render'), '沒有切到規則分頁：' + JSON.stringify(calls));
  ok(els['rule-id'].value === '', 'rule-id 沒清空 ⇒ 會覆蓋既有規則');
  ok(els['rule-name'].value === '雙龍特調', 'rule-name');
  ok(els['rule-includes'].value === '多龍巴魯托ex\n索羅亞克ex', 'rule-includes：' + JSON.stringify(els['rule-includes'].value));
  ok(els['rule-excludes'].value === '' && els['rule-note'].value === '由房間 X 草擬' && els['rule-enabled'].checked === true, '其他欄位');
  ok(run[1]() === null, '預覽結果沒清掉（會顯示上一條規則的命中數）');
});
await T('B3 ⭐⭐【HEAD-FAIL】openArchetypeRooms：切到 Oracle「已結束」、帶入原型名、時間範圍跟著原型統計', async () => {
  const src = fnSrc(HTML, 'openArchetypeRooms'); ok(src, '找不到 openArchetypeRooms');
  const conv = fnSrc(HTML, 'archSinceToRoomsRange'); ok(conv, '找不到 archSinceToRoomsRange');
  for (const [since, want] of [['0', 'all'], ['7', '7d'], ['30', '30d'], ['90', '90d'], ['365', 'all']]) {
    const calls = [];
    const st = new Function('window', 'switchTab', 'currentArchSince',
      "let oracleRoomsSearch = '', oracleRoomsRange = '7d', oracleRoomsPage = 4, _oracleSearchFocus = true;\n" + conv + '\n' + src
      + '\nreturn async (n) => { await window.openArchetypeRooms(n); return { oracleRoomsSearch, oracleRoomsRange, oracleRoomsPage, _oracleSearchFocus }; };')(
      {}, async (t, o) => { calls.push([t, o]); }, () => since);
    const r = await st('雙龍特調');
    ok(r.oracleRoomsSearch === '雙龍特調' && r.oracleRoomsRange === want && r.oracleRoomsPage === 1 && r._oracleSearchFocus === false,
      'since=' + since + ' ⇒ ' + JSON.stringify(r));
    ok(calls.length === 1 && calls[0][0] === 'oracle-rooms' && calls[0][1] && calls[0][1].status === 'ended', JSON.stringify(calls));
  }
});
await T('B4 ⭐【HEAD-FAIL】switchTab 接受 opts.status（預設仍是「進行中」）並回傳載入的 Promise', async () => {
  const src = fnSrc(HTML, 'switchTab'); ok(src, '找不到 switchTab');
  const mkRun = () => new Function('window', 'document', 'loadActive',
    "let currentTab = '', statusFilter = 'all';\n" + src + '\nreturn (n, o) => { const p = window.switchTab(n, o); return { p, statusFilter }; };')(
    {}, { querySelectorAll: () => [] }, () => 'LOADED');
  const a = mkRun()('oracle-rooms');
  ok(a.statusFilter === 'playing' && a.p === 'LOADED', '預設：' + JSON.stringify(a));
  const b = mkRun()('oracle-rooms', { status: 'ended' });
  ok(b.statusFilter === 'ended', 'opts.status 沒生效：' + JSON.stringify(b));
});
await T('B5 ⭐【HEAD-FAIL】入口都接上中央出口：牌組 modal（座位原型＋建規則鈕）、高頻卡「＋規則」、原型統計「看房間」、Oracle 原型下拉', async () => {
  const modal = fnSrc(HTML, 'showDeckModal'); ok(modal, '找不到 showDeckModal');
  ok(modal.includes('onclick="draftRuleFromSeat(') && modal.includes('${seatHead(s0, 0)}') && modal.includes('${seatHead(s1, 1)}'), '牌組 modal 沒有建規則鈕');
  ok(/'archetype' in ls/.test(modal), '牌組 modal 的原型沒有沿用「欄位存在才顯示」語義');
  const stats = fnSrc(HTML, 'renderArchetypeStats'); ok(stats, '找不到 renderArchetypeStats');
  ok(stats.includes("event.stopPropagation(); draftRuleFromCard("), '高頻卡 chip 沒有「＋規則」或沒擋冒泡（會同時觸發設為支援型）');
  ok((stats.match(/srcKey === 'casual' \? archRoomsLink\(/g) || []).length === 2, '「看房間」應只出現在休閒表的原型列與未分類列');
  const tab = fnSrc(HTML, 'renderRoomsTab'); ok(tab, '找不到 renderRoomsTab');
  ok(tab.includes('${archPickHtml}') && tab.includes("(source === 'oracle' && srv) ? archetypePickerHtml("), 'Oracle 原型下拉沒放進工具列');
  const seatDraft = fnSrc(HTML, 'draftRuleFromSeat'); ok(seatDraft && seatDraft.includes('mainPokemonCandidates(') && seatDraft.includes('openRuleDraft('), '牌組 modal 沒走中央出口');
  const cardDraft = fnSrc(HTML, 'draftRuleFromCard'); ok(cardDraft && cardDraft.includes('openRuleDraft('), '高頻卡沒走中央出口');
});
await T('B6 ⭐【HEAD-FAIL】📜 對戰歷史：有 archetype 欄位就顯示【原型】，欄位不存在或 null 才退回主力打手；null 絕不顯示成未分類', async () => {
  const src = fnSrc(HTML, 'renderMatchRow'); ok(src, '找不到 renderMatchRow');
  const f = new Function('escapeHtml', 'playerLink', 'detectMainFromCardCounts', 'fmtMatchTime', 'fmtMatchDuration',
    src + '\nreturn renderMatchRow;')((x) => String(x), (e) => e, () => '主力X', () => 't', () => 'd');
  const base = { _id: 'm', roomCode: 'R', winner: 0 };
  const h1 = f({ ...base, p1: { name: 'a', archetype: '雙龍特調' }, p2: { name: 'b', archetype: '未分類' } });
  ok(h1.includes('【雙龍特調】') && h1.includes('【未分類】') && !h1.includes('主力X'), '原型沒顯示或還混著主力打手');
  const h2 = f({ ...base, p1: { name: 'a' }, p2: { name: 'b' } });
  ok(h2.includes('⚔️ 主力X'), '舊伺服器（沒有欄位）沒有退回主力打手');
  const h3 = f({ ...base, p1: { name: 'a', archetype: null }, p2: { name: 'b', archetype: null } });
  ok(!h3.includes('【') && h3.includes('⚔️ 主力X'), 'null（還不知道）必須退回主力打手、且絕不顯示成【未分類】');
  ok(HTML.includes('牌組原型（可搜「未分類」）"') && HTML.includes('matchRecordsArchScan = data.archScan || null;'), '搜尋提示或掃描範圍提示不在');
});

await T('B7 ⭐⭐規則庫載入失敗 ⇒ 下拉只嘗試一次、不重繪（不可「重繪→請求→重繪」無限迴圈）', async () => {
  const e1 = fnSrc(HTML, 'ensureDeckRulesLoaded'), e2 = fnSrc(HTML, 'archetypePickerHtml');
  ok(e1 && e2, '找不到 ensureDeckRulesLoaded／archetypePickerHtml');
  for (const apiRes of [{ error: 'not logged in' }, { rules: [] }]) {
    let apiN = 0, renderN = 0;
    const env = {};
    const run = new Function('api', 'renderRoomsTab', 'document', 'escapeHtml', '_restoreOracleSearchFocus', 'env',
      "let _deckRules = [], currentTab = 'oracle-rooms', oracleRoomsCache = [];\nlet _deckRulesLoadPromise = null;\n" + e1 + '\n' + e2
      + '\nenv.pick = archetypePickerHtml; return archetypePickerHtml;')(
      () => { apiN++; return Promise.resolve(apiRes); },
      () => { renderN++; env.pick(''); }, { getElementById: () => ({}) }, (x) => String(x), () => {}, env);
    run(''); run(''); run('');
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    ok(apiN === 1 && renderN === 0, JSON.stringify(apiRes) + ' ⇒ api ' + apiN + ' 次、重繪 ' + renderN + ' 次');
  }
  // 正對照：成功拿到規則 ⇒ 重繪恰好一次，且下拉出現規則名
  let apiN = 0, renderN = 0; const env = {}; let lastHtml = '';
  const run = new Function('api', 'renderRoomsTab', 'document', 'escapeHtml', '_restoreOracleSearchFocus', 'env',
    "let _deckRules = [], currentTab = 'oracle-rooms', oracleRoomsCache = [];\nlet _deckRulesLoadPromise = null;\n" + e1 + '\n' + e2
    + '\nenv.pick = archetypePickerHtml; return archetypePickerHtml;')(
    () => { apiN++; return Promise.resolve({ rules: [{ name: '雙龍特調', enabled: true }, { name: '停用', enabled: false }] }); },
    () => { renderN++; lastHtml = env.pick('雙龍特調'); }, { getElementById: () => ({}) }, (x) => String(x), () => {}, env);
  run('');
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  ok(apiN === 1 && renderN === 1, '成功時 api ' + apiN + '、重繪 ' + renderN);
  ok(lastHtml.includes('<option value="雙龍特調" selected>') && !lastHtml.includes('停用') && lastHtml.includes('onchange="pickOracleArchetype(this.value)"'), lastHtml);
});
await T('B8 ⭐牌組 modal 草擬：必含＝主力前 2 名、名稱＝第一名、備註記房號；先關 modal 再開規則', async () => {
  const src = fnSrc(HTML, 'draftRuleFromSeat'); ok(src, '找不到 draftRuleFromSeat');
  const calls = [];
  const win = { _deckModalRoom: { code: 'EU3Y', room: { seats: [{ name: 'YT', deckEntries: [{ cardId: 'a4', count: 4 }, { cardId: 'a2', count: 3 }, { cardId: 'a1', count: 2 }] }] } } };
  const f = new Function('window', 'ensureCardIndex', 'ensureCardTags', 'mainPokemonCandidates', 'getSupportPokemonNames', 'closeModal', 'openRuleDraft', 'alert',
    src + '\nreturn window.draftRuleFromSeat;')(
    win, async () => {}, async () => {}, (e) => ['多龍巴魯托ex', '沙奈朵', '拉魯拉絲'], async () => new Set(),
    () => calls.push('close'), async (d) => calls.push(d), (m) => calls.push('alert:' + m));
  await f(0);
  ok(calls[0] === 'close' && calls[1] && calls[1].name === '多龍巴魯托ex', JSON.stringify(calls));
  ok(JSON.stringify(calls[1].includes) === '["多龍巴魯托ex","沙奈朵"]' && calls[1].note.includes('EU3Y') && calls[1].note.includes('P1'), JSON.stringify(calls[1]));
});
await T('B9 ⭐inline onclick 的字串參數：含單引號／雙引號／反斜線的名稱也能原樣傳進去（jsArgAttr）', async () => {
  const src = fnSrc(HTML, 'jsArgAttr'); ok(src, '找不到 jsArgAttr');
  const esc = fnSrc(HTML, 'escapeHtml');
  const jsArgAttr = new Function(esc + '\n' + src + '\nreturn jsArgAttr;')();
  const decode = (a) => a.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const name of ["Farfetch'd", '他說"好"', 'a\\b', '<&>']) {
    const attr = jsArgAttr(name);
    ok(!attr.includes('"'), '屬性值裡出現未跳脫的雙引號：' + attr);
    const got = new Function('f', 'return f(' + decode(attr) + ');')((x) => x);
    ok(got === name, '還原後不同：' + JSON.stringify(got) + ' vs ' + JSON.stringify(name));
  }
  const stats = fnSrc(HTML, 'renderArchetypeStats');
  ok(!/replace\(\/'\/g, '&apos;'\)/.test(fnSrc(HTML, 'archRoomsLink') || '') && stats.includes('draftRuleFromCard(\' + jsArgAttr(c.name)'), '新入口仍用 &apos; 舊手法');
});

console.log(`\nadmin v1.76 原型互通守衛：PASS ${pass} / FAIL ${fail}` + (fail ? '（紅：' + failed.join('、') + '）' : ''));
if (fail) process.exit(1);
