// v6.644 守衛：牌庫搜尋「無符合卡 → 只能檢視後重洗」時，選擇區必須是空的
//
// 由來（玩家回報）：牌庫沒有基礎【超】寶可夢時，感應【超】能量附到【超】寶可夢身上，
//   選擇視窗卻列出整副剩餘牌庫。正確：選擇區留空（沒有可選的卡），整副牌庫只在下方「📖 查看牌庫剩餘全部」。
//   根因：openDeckViewReshuffle 開的是 filter:'any'、maxCount:0 的 deck-search，沒有宣告 params.validIids；
//   UI 只有少數 filter 會與 validIids 取交集 ⇒ 'any' 顯示整副牌庫。另外三處 inline 的同型寫法（盈溢祈願、閃焰渦輪、
//   牌庫找基本能量附自身的三招）也一樣。
// 中央修法：
//   ① openDeckViewReshuffle 宣告 validIids: []、viewOnly: true；三處 inline 收斂到它（紀錄字樣以 opts.log 保留）。
//   ② selection-candidates.ts 的 deckSearchVisible：deck-search 的選擇區一律與 params.validIids 取交集
//      （與引擎 sanitizeSelectedIids 對 deck-search 的交集同一條規則 ⇒ 看得到的＝勾得動的）。
//   ③ +page.svelte 的 selectionItems 對 deck-search 套 deckSearchVisible（手機版吃同一份 selectionItems）。
//
// 【A】deckSearchVisible 單元：[] ⇒ 空；undefined／非陣列 ⇒ 不縮限；子集保留原順序
// 【B】感應【超】能量（實跑 SPECIAL_ENERGY_ATTACH）：無基礎【超】⇒ 檢視 pending、validIids []、選擇區空；
//      正對照：有基礎【超】⇒ 照常開放備戰搜尋；送牌庫裡任一張的 iid 也拿不到（引擎閘）；確認後牌庫張數不變、手牌不變
// 【C】收斂點（實跑 ATTACK_POST）：validIids []、viewOnly、紀錄字樣；含站長裁定統一先檢視的籌備×2、築窩、百變怪｜整人變身
// 【D】靜態 lint：src/lib/game 下所有 deck-search 物件字面量，maxCount 寫死 0 的一律宣告 validIids（含掃描器下限與正對照）
// 【E】性質：被 deckSearchVisible 拿掉的卡，引擎 sanitizeSelectedIids 一律拒收；留下的一律接受（＝不會藏起可選的卡）
//      E2／E3：引擎消毒閘先判上限再收（maxCount 0 ⇒ 0 張；原本先收再比，「只能檢視」照樣收 1 張）
// 【F】UI 接線（剝註解後）：import、selectionItems 對 deck-search 套用、候選為 0 時「查看牌庫剩餘全部」自動展開、手機版不另算候選
// 【G】查看牌庫上方 N 張不攤開全牌庫（Opus 審查 P2-1）：挖回／光照燃燒 filter 改中央 TOP_N；lint 查看牌庫頂一律 TOP 型
// 【H】HEAD-FAIL：BASE（v6.643）上 A／B1／B3／C1／D1／D3／E1／E2／F1 紅，B2／E3 等正對照綠
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '9e5510bc';   // v6.643＋server v1.83（本版的上一版）
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 400) : '')); } };
const MISSING = () => { throw new Error('MISSING'); };
const tmpFiles = [];
process.on('exit', () => { for (const p of tmpFiles) { try { unlinkSync(p); } catch { /* noop */ } } });

// ── 卡池（live H/I/J 以外也載入；本檔只用 live 卡）
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const findId = (name, pred) => { for (const [id, c] of pool) if (c.name === name && (!pred || pred(c))) return id; return null; };
const firstId = (pred) => { for (const [id, c] of pool) if (pred(c)) return id; return null; };

// ⚠ namespace import：BASE 上新符號不存在時只讓那幾條紅，不會整個 bundle 起不來（Rule 41）
async function loadBundle(srcRoot, tag) {
  const S = join(srcRoot, `.x6644-${tag}-s.js`), E = join(srcRoot, `.x6644-${tag}-e.ts`), O = join(ROOT, `.x6644-${tag}-o.mjs`);
  tmpFiles.push(S, E, O);
  writeFileSync(S, 'export const base="";export const assets="";');
  writeFileSync(E, "import * as ENG from './src/lib/game/engine';\nimport * as EFF from './src/lib/game/effects';\n"
    + "import * as SH from './src/lib/game/effects/_shared';\nimport * as SC from './src/lib/game/selection-candidates';\nimport * as SF from './src/lib/game/selection-filter';\nexport { ENG, EFF, SH, SC, SF };\n");
  await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
  return import(pathToFileURL(O).href + '?t=' + tag);
}

let _n = 0;
const I = (id, extra = {}) => ({ iid: 'i' + (++_n), cardId: String(id), damage: 0, energyAttached: [], extraTools: [], ...extra });
const ST = (p0, p1, extra = {}) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  players: [{ name: 'A', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p0 },
            { name: 'B', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p1 }], ...extra });

const SENSE = findId('感應【超】能量');
const PSYBASIC = firstId((c) => c.supertype === 'Pokemon' && c.pokemonType === 'Psychic' && !c.evolvesFrom && c.stage === 'Basic');
const PSYMON = firstId((c) => c.supertype === 'Pokemon' && c.pokemonType === 'Psychic' && c.stage === 'Basic' && (c.hp ?? 0) >= 100);
const PLAIN = firstId((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !c.abilities && !c.evolvesFrom
  && (c.hp ?? 0) >= 120 && c.pokemonType === 'Colorless');
const ITEM = firstId((c) => c.supertype === 'Trainer' && c.subtype === 'Item');
const lastLog = (s) => { const l = s.log ?? []; const e = l[l.length - 1]; return typeof e === 'string' ? e : (e?.text ?? e?.message ?? JSON.stringify(e)); };
const logHas = (s, txt) => (s.log ?? []).some((e) => (typeof e === 'string' ? e : JSON.stringify(e)).includes(txt));

function checkA(SC, tag) {
  const f = typeof SC?.deckSearchVisible === 'function' ? SC.deckSearchVisible : MISSING;
  const items = [{ iid: 'a' }, { iid: 'b' }, { iid: 'c' }];
  const run = (fn) => { try { return fn(); } catch (e) { return 'ERR:' + e.message; } };
  ok(`★★★ A1${tag} validIids: [] ⇒ 選擇區為空`, JSON.stringify(run(() => f(items, { validIids: [] }))) === '[]');
  const a2 = run(() => f(items, undefined)), a2b = run(() => f(items, { label: 'x' }));
  ok(`★★ A2${tag} 沒宣告 validIids（params 缺席／沒有這個欄位）⇒ 不縮限（既有 filter 行為不變），且回傳新陣列`,
    Array.isArray(a2) && a2.length === 3 && a2 !== items && Array.isArray(a2b) && a2b.length === 3, JSON.stringify({ a2, a2b }));
  ok(`★★ A3${tag} 子集 ⇒ 只留宣告的、保留原順序（宣告裡有牌庫沒有的 iid 不會無中生有）`,
    JSON.stringify(run(() => f(items, { validIids: ['c', 'zz', 'a'] }))?.map?.((x) => x.iid)) === '["a","c"]');
  ok(`★ A4${tag} validIids 不是陣列（字串／null）⇒ 不縮限（fail-open，不會把選擇區清空）`,
    run(() => f(items, { validIids: 'a' }))?.length === 3 && run(() => f(items, { validIids: null }))?.length === 3);
}

function checkB(M, tag) {
  const EFF = M.EFF, ENG = M.ENG, SC = M.SC;
  const attach = EFF?.SPECIAL_ENERGY_ATTACH?.get?.('感應【超】能量');
  const vis = typeof SC?.deckSearchVisible === 'function' ? SC.deckSearchVisible : MISSING;
  ok(`前提${tag} 卡池抓得到感應【超】能量、基礎【超】、對照寶可夢、物品；SPECIAL_ENERGY_ATTACH 有註冊`,
    !!(SENSE && PSYBASIC && PSYMON && PLAIN && ITEM && typeof attach === 'function'), JSON.stringify({ SENSE, PSYBASIC, PSYMON, PLAIN, ITEM }));
  if (typeof attach !== 'function') return;
  // ① 牌庫沒有基礎【超】寶可夢（3 張【無】寶可夢＋1 張物品）
  const host = I(PSYMON);
  const deck = [I(PLAIN), I(PLAIN), I(ITEM), I(PLAIN)];
  const s0 = ST({ active: I(PLAIN), bench: [host], deck: deck.slice() }, { active: I(PLAIN) });
  let r; try { r = attach(s0, 0, host.iid, pool); } catch (e) { r = { err: e.message }; }
  const ps = r?.pendingSelection;
  ok(`★★★ B1${tag} 無基礎【超】⇒ 開「檢視後重洗」：deck-search、maxCount 0、validIids []、viewOnly；選擇區 0 張（牌庫 4 張全在下拉）`,
    ps?.type === 'deck-search' && ps.effectKey === 'search-to-hand-reshuffle' && ps.maxCount === 0
      && Array.isArray(ps.params?.validIids) && ps.params.validIids.length === 0 && ps.params?.viewOnly === true
      && (() => { try { return vis(r.players[0].deck, ps.params).length === 0 && r.players[0].deck.length === 4; } catch { return false; } })(),
    JSON.stringify({ type: ps?.type, ek: ps?.effectKey, max: ps?.maxCount, params: ps?.params }));
  ok(`★ B1b${tag} 紀錄字樣不變（感應【超】能量：牌庫無符合卡，檢視牌庫後重洗）`, logHas(r, '感應【超】能量：牌庫無符合卡，檢視牌庫後重洗'));
  // ② 正對照：牌庫有基礎【超】⇒ 照常開放備戰搜尋（證明 ① 不是恆真）
  const host2 = I(PSYMON);
  const s2 = ST({ active: I(PLAIN), bench: [host2], deck: [I(PSYBASIC), I(PLAIN)] }, { active: I(PLAIN) });
  const r2 = attach(s2, 0, host2.iid, pool);
  ok(`★★ B2${tag} 正對照：牌庫有基礎【超】⇒ 照常開放備戰搜尋（bench-basic-from-deck）`, r2?.pendingSelection?.effectKey === 'bench-basic-from-deck',
    r2?.pendingSelection?.effectKey);
  // ③ 走完整 RESOLVE_SELECTION：送牌庫裡一張卡的 iid（舊版選擇區看得到的那些）⇒ 拿不到；牌庫張數不變、手牌不變、pending 關掉
  if (ps?.type === 'deck-search' && typeof ENG?.applyAction === 'function') {
    const sendIid = r.players[0].deck[0].iid;
    let r3; try { r3 = ENG.applyAction(r, { type: 'RESOLVE_SELECTION', selectedIids: [sendIid] }, pool); } catch (e) { r3 = { err: e.message }; }
    const p3 = r3?.players?.[0];
    ok(`★★ B3${tag} 送牌庫裡任一張的 iid ⇒ 拿不到（手牌不變、牌庫仍 4 張、備戰沒多），pending 關掉`,
      !!p3 && r3.pendingSelection == null && p3.deck.length === 4 && p3.hand.length === 0 && p3.bench.length === 1
        && p3.deck.some((c) => c.iid === sendIid),
      JSON.stringify({ err: r3?.err, pend: r3?.pendingSelection?.effectKey, deck: p3?.deck?.length, hand: p3?.hand?.length, bench: p3?.bench?.length }));
  }
}

function checkC(M, tag) {
  const EFF = M.EFF;
  const post = (k) => EFF?.ATTACK_POST?.get?.(k);
  const cases = [];
  // 超級沙奈朵ex｜盈溢祈願：備戰有寶可夢、牌庫無基本【超】能量
  cases.push({ k: '超級沙奈朵ex|盈溢祈願', label: '盈溢祈願', log: '盈溢祈願：牌庫中無基本【超】能量；檢視牌庫後重洗', st: () => ST({ active: I(PSYMON), bench: [I(PLAIN)], deck: [I(PLAIN), I(ITEM)] }, { active: I(PLAIN) }) });
  // 閃焰王牌｜閃焰渦輪：牌庫無基本能量
  cases.push({ k: '閃焰王牌|閃焰渦輪', label: '閃焰渦輪', log: '閃焰渦輪：牌庫無基本能量或備戰無寶可夢；檢視牌庫後重洗', st: () => ST({ active: I(PLAIN), bench: [I(PLAIN)], deck: [I(PLAIN), I(ITEM)] }, { active: I(PLAIN) }) });
  // 牌庫找基本能量附自身（三招共用工廠）：牌庫無對應基本能量
  for (const [k, atk] of [['蛋蛋|果實盈滿', '果實盈滿'], ['急凍鳥|冰冷羽擊', '冰冷羽擊'], ['雷電雲|充電', '充電']]) {
    cases.push({ k, label: atk, log: `${atk}：牌庫無基本能量；檢視牌庫後重洗`, st: () => ST({ active: I(PLAIN), deck: [I(PLAIN), I(ITEM)] }, { active: I(PLAIN) }) });
  }
  // ⭐站長裁定（2026-11-15）：原本「牌庫無符合卡 → 直接重洗、不讓玩家看牌庫」的四招統一成先檢視
  for (const [k, atk, what] of [['探探鼠|籌備', '籌備', 'Item'], ['火箭隊的咩利羊|籌備', '籌備', 'Item'], ['赫普的沙包蛇|築窩', '築窩', 'Stadium']]) {
    cases.push({ k, label: atk, log: `${atk}：牌庫無 ${what}；檢視牌庫後重洗`, st: () => ST({ active: I(PLAIN), deck: [I(PLAIN), I(PLAIN)] }, { active: I(PLAIN) }) });
  }
  const res = cases.map((c) => {
    const fn = post(c.k);
    if (typeof fn !== 'function') return { k: c.k, why: '沒註冊' };
    let r; try { r = fn(c.st(), 0, pool, {}); } catch (e) { return { k: c.k, why: e.message }; }
    const ps = r?.pendingSelection;
    const good = ps?.type === 'deck-search' && ps.effectKey === 'search-to-hand-reshuffle' && ps.maxCount === 0
      && Array.isArray(ps.params?.validIids) && ps.params.validIids.length === 0 && ps.params?.viewOnly === true
      && ps.params?.label === `${c.label}（檢視牌庫）`;
    return { k: c.k, good, logOk: logHas(r, c.log), params: ps?.params };
  });
  // 百變怪｜整人變身：擲幣正面才搜尋 ⇒ 最多試 40 次取一次正面（牌庫只有物品卡＝沒有可互換的寶可夢卡）
  {
    const fn = post('百變怪|整人變身');
    let got = null;
    for (let t = 0; t < 40 && typeof fn === 'function' && !got; t++) {
      let r; try { r = fn(ST({ active: I(PLAIN), deck: [I(ITEM), I(ITEM)] }, { active: I(PLAIN) }), 0, pool, {}); } catch (e) { got = { k: '百變怪|整人變身', why: e.message }; break; }
      if (logHas(r, '整人變身：反面')) continue;
      const ps = r?.pendingSelection;
      got = { k: '百變怪|整人變身', good: ps?.type === 'deck-search' && ps.effectKey === 'search-to-hand-reshuffle' && ps.maxCount === 0 && Array.isArray(ps.params?.validIids) && ps.params.validIids.length === 0 && ps.params?.label === '整人變身（檢視牌庫）',
        logOk: logHas(r, '整人變身：牌庫沒有寶可夢卡，檢視牌庫後重洗'), params: ps?.params };
    }
    res.push(got ?? { k: '百變怪|整人變身', why: typeof fn === 'function' ? '40 次都反面' : '沒註冊' });
  }
  ok(`★★★ C1${tag} 收斂點（${res.length} 招，含站長裁定統一先檢視的籌備×2／築窩／整人變身）牌庫無符合卡 ⇒ validIids []、viewOnly、標題「○○（檢視牌庫）」`, res.every((x) => x.good), JSON.stringify(res.filter((x) => !x.good)));
  ok(`★★ C2${tag} 紀錄字樣（原有的逐字不變；四招新寫「檢視牌庫後重洗」）`, res.every((x) => x.logOk), JSON.stringify(res.filter((x) => !x.logOk).map((x) => x.k)));
  // 牌庫空 ⇒ 不開 pending、只寫「牌庫已空」（與收斂前相同）
  const fn = post('超級沙奈朵ex|盈溢祈願');
  let re; try { re = fn?.(ST({ active: I(PSYMON), bench: [I(PLAIN)], deck: [] }, { active: I(PLAIN) }), 0, pool, {}); } catch (e) { re = { err: e.message }; }
  ok(`★ C3${tag} 牌庫空 ⇒ 不開 pending、紀錄「盈溢祈願：牌庫已空」（與收斂前相同）`, re && !re.pendingSelection && logHas(re, '盈溢祈願：牌庫已空'), JSON.stringify(re?.err ?? lastLog(re ?? {})));
}

// ── D：靜態掃描 deck-search 物件字面量
function scanDeckSearch(srcRoot) {
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
  walk(join(srcRoot, 'src/lib/game'));
  const out = [];
  for (const f of files) out.push(...scanText(stripCommentsBlankChecked(normEol(readFileSync(f, 'utf8')), 'ts'), f.slice(srcRoot.length + 1)));
  return out;
}
function scanText(s, name) {
  const out = [];
  for (const m of s.matchAll(/type:\s*'deck-search'/g)) {
    // 以唯一錨點往回配對出物件開頭（不往後找第一個 {，避免 template literal 的 ${ 打亂配對）
    let d = 0, i = m.index;
    for (; i >= 0; i--) { if (s[i] === '}') d++; else if (s[i] === '{') { if (d === 0) break; d--; } }
    let e = i, dd = 0;
    for (; e < s.length; e++) { if (s[e] === '{') dd++; else if (s[e] === '}') { dd--; if (dd === 0) break; } }
    const obj = s.slice(i, e + 1);
    out.push({ name, line: s.slice(0, i).split('\n').length, max0: /maxCount:\s*0\s*[,}\n]/.test(obj), vi: /\bvalidIids\b/.test(obj), obj });
  }
  return out;
}
function checkD(srcRoot, tag) {
  const all = scanDeckSearch(srcRoot);
  ok(`前提${tag} 掃描器掃到的 deck-search 物件字面量 ≥ 150（目前約 200；少了代表掃描器壞了）`, all.length >= 150, all.length);
  const bad = all.filter((o) => o.max0 && !o.vi).map((o) => `${o.name}:${o.line}`);
  ok(`★★★ D1${tag} maxCount 寫死 0（只能檢視）的 deck-search 一律宣告 validIids（否則選擇區會列出整副牌庫）`, bad.length === 0, bad.join(' '));
  // 正對照：餵一個違規樣本，掃描器必須抓到；合規樣本不得誤紅
  const neg = scanText("withPending(s, { type: 'deck-search', actorIdx: 0, filter: 'any', minCount: 0, maxCount: 0, effectKey: 'x', params: { label: `${a}` } });", 'probe');
  const posi = scanText("withPending(s, { type: 'deck-search', filter: 'any', minCount: 0, maxCount: 0, params: { validIids: [] } });", 'probe');
  ok(`★ D2${tag} 掃描器正對照：違規樣本被抓到、合規樣本不誤紅`, neg.length === 1 && neg[0].max0 && !neg[0].vi && posi.length === 1 && posi[0].vi);
  // 收斂：「檢視後重洗」（search-to-hand-reshuffle ＋ maxCount 0）只能有中央一份
  const views = all.filter((o) => o.max0 && /effectKey:\s*'search-to-hand-reshuffle'/.test(o.obj)).map((o) => `${o.name}:${o.line}`);
  ok(`★★ D3${tag} 「檢視後重洗」的 pending 字面量只剩中央 openDeckViewReshuffle 一份（Rule 38）`, views.length === 1 && /effects\/_shared\.ts/.test(views[0]), views.join(' '));
}

function checkE(M, tag) {
  const ENG = M.ENG, SC = M.SC;
  const vis = typeof SC?.deckSearchVisible === 'function' ? SC.deckSearchVisible : MISSING;
  const san = typeof ENG?.sanitizeSelectedIids === 'function' ? ENG.sanitizeSelectedIids : null;
  ok(`前提${tag} 引擎 export sanitizeSelectedIids`, !!san);
  if (!san) return;
  let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let checked = 0, bad = [];
  for (let t = 0; t < 300; t++) {
    const deck = Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => I(rnd() < .5 ? PLAIN : ITEM));
    const vi = rnd() < .2 ? undefined : deck.filter(() => rnd() < .4).map((c) => c.iid).concat(rnd() < .3 ? ['ghost'] : []);
    const pend = { type: 'deck-search', actorIdx: 0, sourcePlayerIdx: 0, filter: 'any', minCount: 0, maxCount: deck.length, effectKey: 'x', params: vi === undefined ? {} : { validIids: vi } };
    const st = ST({ deck }, {});
    let shown; try { shown = new Set(vis(deck, pend.params).map((c) => c.iid)); } catch { bad.push('MISSING'); break; }
    for (const c of deck) {
      const acc = san(st, pend, [c.iid], pool).includes(c.iid);
      checked++;
      if (acc !== shown.has(c.iid)) bad.push(`${c.iid}:shown=${shown.has(c.iid)} acc=${acc}`);
    }
  }
  // E2：消毒閘先判上限再收——maxCount 0（只能檢視）時，就算沒宣告 validIids 也一張都收不到
  {
    const deck = [I(PLAIN), I(ITEM), I(PLAIN)];
    const st = ST({ deck, hand: deck.map((c) => ({ ...c, iid: c.iid + 'h' })) }, {});
    const ds0 = san(st, { type: 'deck-search', actorIdx: 0, sourcePlayerIdx: 0, filter: 'any', minCount: 0, maxCount: 0, effectKey: 'x', params: {} }, [deck[0].iid], pool);
    const hd0 = san(st, { type: 'hand-discard', actorIdx: 0, sourcePlayerIdx: 0, minCount: 0, maxCount: 0, effectKey: 'x', params: {} }, [deck[0].iid + 'h'], pool);
    const ds2 = san(st, { type: 'deck-search', actorIdx: 0, sourcePlayerIdx: 0, filter: 'any', minCount: 0, maxCount: 2, effectKey: 'x', params: {} }, [deck[2].iid, deck[0].iid, deck[1].iid], pool);
    ok(`★★★ E2${tag} 消毒閘：maxCount 0 ⇒ deck-search／hand-discard 都收 0 張（原本先收再比會收 1 張）`, ds0.length === 0 && hd0.length === 0, JSON.stringify({ ds0, hd0 }));
    ok(`★★ E3${tag} 零回歸：maxCount 2、送 3 張 ⇒ 依序收前 2 張（與原本相同）`, JSON.stringify(ds2) === JSON.stringify([deck[2].iid, deck[0].iid]), JSON.stringify(ds2));
  }
  ok(`★★★ E1${tag} 性質（300 個隨機盤面、filter 'any'）：選擇區顯示的 ＝ 引擎接受的（拿掉的一律拒收、留下的一律接受）`, bad.length === 0 && checked > 500, `${checked} ${bad.slice(0, 5).join(' ')}`);
}

function checkF(pageRaw, mobRaw, tag) {
  const page = stripCommentsBlankChecked(normEol(pageRaw), 'svelte');
  const mob = stripCommentsBlankChecked(normEol(mobRaw), 'svelte');
  const imp = /import \{[^}]*\bdeckSearchVisible\b[^}]*\} from '\$lib\/game\/selection-candidates';/.test(page);
  const derived = /const selectionItems = \$derived\.by\(\(\) => dedupeByIid\(pendingSelection\?\.type === 'deck-search'\s*\?\s*deckSearchVisible\(selectionItemsRaw, pendingSelection\.params as Record<string, unknown> \| undefined\)\s*:\s*selectionItemsRaw\)\);/.test(page);
  ok(`★★★ F1${tag} selectionItems 對 deck-search 套 deckSearchVisible（從 selection-candidates import，判準只有一份）`, imp && derived, JSON.stringify({ imp, derived }));
  // 下拉「查看牌庫剩餘全部」：deck-search 那一塊在候選為 0 時自動展開（既有行為，確認仍綁在同一份 selectionItems 上）
  const i = page.indexOf("{#if pendingSelection.type==='deck-search' && game");
  const blk = i >= 0 ? page.slice(i, i + 6000) : '';
  ok(`★★ F2${tag} deck-search 區塊的「查看牌庫剩餘全部」在候選為 0 時自動展開`, /<details class="full-deck-view" open=\{selectionItems\.length === 0\}>/.test(blk), blk.slice(0, 120));
  // 手機版吃同一份 selectionItems，不自己從牌庫算 deck-search 候選
  ok(`★★ F3${tag} 手機版不自己畫牌庫搜尋的選擇視窗（選擇視窗一律由 +page.svelte 畫，吃同一份 selectionItems）`, mob.length > 10000 && !/deck-search/.test(mob) && /pendingSelection/.test(mob));
  // 判準只有一份：頁面沒有自己再寫 validIids 的通用交集
  ok(`★ F4${tag} 頁面沒有第二份「deck-search 與 validIids 取交集」的通用寫法`, (page.match(/deckSearchVisible\(/g) || []).length === 1);
}

// 【G】（Opus 審查 P2-1）「查看牌庫上方 N 張」型：下方「📖 查看牌庫剩餘全部」不可攤開整副牌庫（卡面只准看上方 N 張）
//   G1 岩狗狗｜挖回、燭光靈｜光照燃燒（中央 openDeckTopRevealOptionalDiscard）的 filter 是 TOP 型（頁面據此隱藏全牌庫下拉），
//      選擇區＝上方 N 張；中央述詞 TOP_N 只認 params.topIids
//   G2 lint：H/I/J 的 deck-search 只要帶 top*Iids／topIids（＝查看牌庫頂），filter 一律是 TOP 型（G 標的辛俐、正輝的輸送除外）
const ROCK = findId('岩狗狗', (c) => c.attacks?.some((a) => a.name === '挖回'));
const pageHidesFullDeck = (f) => !!f && (f.startsWith('TOP') || f.includes(':TOP'));   // ＝ +page.svelte 全牌庫下拉的隱藏條件（F5 逐字比對）
function checkG(M, srcRoot, pageRaw, tag) {
  const EFF = M.EFF, SF = M.SF, SC = M.SC;
  const vis = typeof SC?.deckSearchVisible === 'function' ? SC.deckSearchVisible : (x) => x;
  const res = [];
  for (const k of ['岩狗狗|挖回', '燭光靈|光照燃燒']) {
    const fn = EFF?.ATTACK_POST?.get?.(k);
    if (typeof fn !== 'function') { res.push({ k, why: '沒註冊' }); continue; }
    const deck = [I(PLAIN), I(ITEM), I(PLAIN), I(ITEM)];
    let r; try { r = fn(ST({ active: I(ROCK ?? PLAIN), deck: deck.slice() }, { active: I(PLAIN) }), 0, pool, {}); } catch (e) { res.push({ k, why: e.message }); continue; }
    const ps = r?.pendingSelection;
    const raw = r?.players?.[0]?.deck?.filter((c) => { try { return SF.evaluateSelectionFilter('deck-search', ps.filter, c, pool.get(c.cardId), { params: ps.params }) !== false; } catch { return true; } }) ?? [];
    const shown = vis(raw, ps?.params).map((c) => c.iid);
    const n = ps?.maxCount;
    res.push({ k, hide: pageHidesFullDeck(ps?.filter), filter: ps?.filter, shownOk: n >= 1 && JSON.stringify(shown) === JSON.stringify(deck.slice(0, n).map((c) => c.iid)) });
  }
  ok(`★★★ G1${tag} 挖回／光照燃燒：filter 是 TOP 型（全牌庫下拉隱藏），選擇區＝牌庫上方 N 張`, res.length === 2 && res.every((x) => x.hide && x.shownOk), JSON.stringify(res));
  let g1b = false;
  try { const top = I(PLAIN), other = I(PLAIN); const ctx = { params: { topIids: [top.iid] } };
    g1b = SF.evaluateSelectionFilter('deck-search', 'TOP_N', top, pool.get(PLAIN), ctx) === true && SF.evaluateSelectionFilter('deck-search', 'TOP_N', other, pool.get(PLAIN), ctx) === false
      && SF.isKnownSelectionFilter('deck-search', 'TOP_N') === true; } catch { g1b = false; }
  ok(`★★ G1b${tag} 中央述詞 TOP_N：上方 N 張內 true、之外 false，且列為已收錄 filter（引擎消毒閘會驗）`, g1b);
  const page = stripCommentsBlankChecked(normEol(pageRaw), 'svelte');
  ok(`★ G1c${tag} 頁面全牌庫下拉的隱藏條件仍是「TOP 開頭或含 :TOP」（與本檔 pageHidesFullDeck 同一條）`,
    /\{#if pendingSelection\.type==='deck-search' && game\s*&& !\(pendingSelection\.filter\?\.startsWith\('TOP'\) \|\| pendingSelection\.filter\?\.includes\(':TOP'\)\)\}/.test(page));
  const G_MARK_KEYS = new Set(['shinli-pick', 'masaki-transport']);   // 辛俐、正輝的輸送：G 標（不在標準賽範圍，站長裁定不處理）
  const all = scanDeckSearch(srcRoot);
  const peeks = all.filter((o) => /\btop\w*Iids\b|\bpeekIids\b/.test(o.obj));
  const bad = peeks.filter((o) => { const fl = (o.obj.match(/filter:\s*'([^']*)'/) || [])[1]; const ek = (o.obj.match(/effectKey:\s*'([^']*)'/) || [])[1];
    if (G_MARK_KEYS.has(ek)) return false;
    if (fl === undefined) return /filter:\s*[^'\s]/.test(o.obj) ? false : true;   // 動態 filter（變數）交給行為端；沒寫 filter ⇒ 違規
    return !pageHidesFullDeck(fl); }).map((o) => `${o.name}:${o.line}`);
  ok(`★★ G2${tag} 查看牌庫頂的 deck-search（${peeks.length} 處）filter 一律 TOP 型（G 標兩張除外）`, peeks.length >= 8 && bad.length === 0, bad.join(' '));
}

// ═════ 現行版
console.log('【A】deckSearchVisible 單元');
const HEAD = await loadBundle(ROOT, 'head');
checkA(HEAD.SC, '');
console.log('【B】感應【超】能量（實跑）');
checkB(HEAD, '');
console.log('【C】三處收斂點（實跑）');
checkC(HEAD, '');
console.log('【D】靜態 lint');
checkD(ROOT, '');
console.log('【E】性質：看得到的＝勾得動的');
checkE(HEAD, '');
console.log('【F】UI 接線');
checkF(readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8'), readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8'), '');
console.log('【G】查看牌庫頂 N 張不攤開全牌庫');
checkG(HEAD, ROOT, readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8'), '');

// ═════ HEAD-FAIL
console.log('【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('H（缺 BASE ' + BASE_SHA + '）');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6644-'));
  try {
    execSync(`git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`, { stdio: 'ignore', shell: '/bin/bash' });
    const before = pass, fb = fail; const log = console.log; const lines = []; console.log = (s) => lines.push(String(s));
    let B = null; try { B = await loadBundle(tmp, 'base'); } catch (e) { lines.push('  FAIL 前提@BASE bundle ' + e.message); }
    if (B) { checkA(B.SC, '@BASE'); checkB(B, '@BASE'); checkC(B, '@BASE'); checkE(B, '@BASE'); checkG(B, tmp, readFileSync(join(tmp, 'src/routes/game/+page.svelte'), 'utf8'), '@BASE'); }
    checkD(tmp, '@BASE');
    checkF(readFileSync(join(tmp, 'src/routes/game/+page.svelte'), 'utf8'), readFileSync(join(tmp, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8'), '@BASE');
    console.log = log;
    const reds = lines.filter((l) => /FAIL/.test(l)).map((l) => l.trim().slice(5, 40));
    if (process.env.V6644_DEBUG) for (const l of lines) if (/FAIL/.test(l)) log(l);
    const bp = pass - before; pass = before; fail = fb;
    console.log('    BASE 紅：' + reds.join('｜'));
    ok('★★★ H1 BASE 上 A1／A2／A3／A4／B1／B3／C1／C2／D1／D3／E1／E2／F1／G1／G1b／G2 都紅（本版修的正是這些；B3＝舊版送 1 張 iid 真的會從牌庫拿到手牌）',
      ['A1@', 'A2@', 'A3@', 'A4@', 'B1@', 'B3@', 'C1@', 'C2@', 'D1@', 'D3@', 'E1@', 'E2@', 'F1@', 'G1@', 'G1b@', 'G2@'].every((k) => reds.some((r) => r.includes(k))), reds.join(','));
    ok('★★ H2 BASE 上「前提」、B2（正對照）、C3（紀錄字樣）、D2（掃描器）、E3（零回歸）、F2／F3 綠',
      !reds.some((r) => /前提|B2@|C3@|D2@|E3@|F2@|F3@|G1c@/.test(r)) && bp >= 8, reds.join(',') + ' ' + bp);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
console.log(`=== v6.644 牌庫檢視選擇區留空：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
