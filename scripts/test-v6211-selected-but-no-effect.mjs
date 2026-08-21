// ⭐⭐⭐ v6.211（第二支）——「玩家選了、卻沒有生效」與「手機/桌機兩份判定」
//
// 玩家回報：「大蔥鴨【特性】臨場背負使用後，**選擇的「寶可夢道具」不會附於這隻大蔥鴨身上**。」
//
// 卡面（static/cards 台灣官方，逐字）：
//   大蔥鴨（SV6 083/101 · id 10497 · H 標）abilities[0].effect
//     「在自己的回合，從手牌將這張卡放置於備戰區時，可使用1次。從自己的牌庫選擇1張
//       「寶可夢道具」卡，附於這隻寶可夢身上。並且重洗牌庫。」
//
// 真因：`v2998_g2.ts` 的 `regR('farfetchd-on-spot-tool-attach')` 再驗證寫
//   `toolCard?.subtype !== 'Tool'`。但 `'Tool'` 是 **picker 的 filter key**
//   （`selection-filter.ts` `'Tool': (c)=> c.supertype==='Trainer' && c.subtype==='PokemonTool'`），
//   卡庫裡真正的 `subtype` 只有 Basic/Item/PokemonTool/Special/Stadium/Stage1/Stage2/Supporter/ex
//   —— **沒有 'Tool'** ⇒ 這條判斷恆為真 ⇒ 100% 走「所選非寶可夢道具，跳過並重洗」，
//   道具永遠附不上，而且還留在牌庫裡。典型的「picker 顯示什麼」與「resolver 驗證什麼」漂移
//   （＝ v6.109 的 resolver 版）。
//
// 修法：picker 的 `filter` 與 resolver 的再驗證共用同一個常數，再驗證改呼叫中央
//   `evaluateSelectionFilter('deck-search', FARFETCHD_TOOL_FILTER, ...)`。
//
// 順帶掃站長指定的另一個維度：**手機直式與桌機對「能不能做這個動作」的判定是否同源**
//   （招式／撤退／特性／進化／手牌操作）—— 烈箭鷹ex 三度出包全是「第三份判定」造成的。
//
// HEAD-FAIL（BASE = 2255c590a25216366b87a74b0ac99798a03cddf5）：
//   還原 `v2998_g2.ts` → §1 行為端 + §2 全站字面量 皆 FAIL。
//   §3（ATTACK_POST 行為端不覆寫既有 pending）在還原 v2590 / v2490 時 FAIL。
//   §4（UI 同源）本版沒有改那兩個 svelte 檔 ⇒ 沒有 HEAD-FAIL，屬「凍結現況」型守衛，
//     故它的兩個分支各自都配了正對照（合成違規樣本必須被判紅）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x6211b-s.js'), E = join(ROOT, '.x6211b-e.ts'), O = join(ROOT, '.x6211b-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { applyAction } from './src/lib/game/engine';\n"
+ "export { ATTACK_POST } from './src/lib/game/effects/_shared';\n"
+ "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('  ✓ ' + n); pass++; } catch (e) { console.log('  ✗ ' + n + '\n      ' + (e && e.message)); fail++; } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}｜實際=${JSON.stringify(a)} 期望=${JSON.stringify(b)}`); };
let _n = 0;
const I = (id, extra = {}) => ({ iid: 'i' + (++_n), cardId: String(id), damage: 0, energyAttached: [], extraTools: [], ...extra });
const ST = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  players: [
    { name: 'A', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], energyAttachedThisTurn: false, supporterPlayedThisTurn: false, retreatedThisTurn: false, ...p0 },
    { name: 'B', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], energyAttachedThisTurn: false, supporterPlayedThisTurn: false, retreatedThisTurn: false, ...p1 },
  ], ...extra,
});
const HIJ = new Set(['H', 'I', 'J']);
const findId = (name, pred) => { for (const [id, c] of pool) if (c.name === name && HIJ.has(c.regulationMark) && (!pred || pred(c))) return id; return null; };
const logs = (s) => s.log.map((l) => (typeof l === 'string' ? l : (l && l.message) || '')).join('\n');

// ══════════════════════════════════════════════════════════════════════════════
// §1 大蔥鴨｜臨場背負：選了道具就必須真的附上（行為端，完整三段流程）
// ══════════════════════════════════════════════════════════════════════════════
console.log('§1 臨場背負：選了要真的生效');
const FAR = findId('大蔥鴨', (c) => c.abilities?.some((a) => a.name === '臨場背負'));
const FAN = findId('手持循環扇');
const PIKA = findId('皮卡丘');
ok(FAR && FAN && PIKA, '卡池載入壞了（大蔥鴨 / 手持循環扇 / 皮卡丘 找不到）');

function runOnSpotCarry(deckCards, pickIdx) {
  const hand = I(FAR);
  let s = ST({ hand: [hand], active: I(PIKA), deck: deckCards }, { active: I(PIKA) });
  s = mod.applyAction(s, { type: 'PLAY_BASIC', iid: hand.iid }, pool);
  eq(s.pendingSelection?.effectKey, 'resolve-play-ability-prompt', '放備戰後應先問是否使用特性');
  s = mod.applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: ['yes'] }, pool);
  return { s, hand };
}

T('卡面前提：大蔥鴨【臨場背負】逐字＝「從自己的牌庫選擇1張「寶可夢道具」卡，附於這隻寶可夢身上。並且重洗牌庫。」', () => {
  const eff = pool.get(FAR).abilities.find((a) => a.name === '臨場背負').effect;
  ok(eff.includes('從自己的牌庫選擇1張「寶可夢道具」卡，附於這隻寶可夢身上'), '卡面文字對不上：' + eff);
  eq(pool.get(FAN).subtype, 'PokemonTool', '手持循環扇的 subtype（證明卡庫用的是 PokemonTool 不是 Tool）');
});

T('⭐⭐⭐ 選了牌庫裡的寶可夢道具 → 真的附到這隻大蔥鴨身上，且離開牌庫', () => {
  const tool = I(FAN), filler = I(findId('基本【草】能量'));
  let { s } = runOnSpotCarry([tool, filler]);
  eq(s.pendingSelection?.effectKey, 'farfetchd-on-spot-tool-attach', '應開牌庫搜尋 picker');
  eq(s.pendingSelection?.filter, 'Tool', 'picker filter');
  s = mod.applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [tool.iid] }, pool);
  const host = s.players[0].bench.find((b) => b.cardId === String(FAR));
  ok(host, '大蔥鴨不在備戰區');
  ok(host.toolAttached, '⚠ 玩家回報症狀：選了道具卻沒附上');
  eq(host.toolAttached.cardId, String(FAN), '附上的道具');
  ok(!s.players[0].deck.some((c) => c.iid === tool.iid), '道具不該還留在牌庫');
  ok(!logs(s).includes('所選非寶可夢道具'), '不該走「所選非寶可夢道具」分支');
  ok(logs(s).includes('將「手持循環扇」附給'), '缺少附加成功的公開 log');
});

T('⭐正對照：不選（送 []）時維持原行為 —— 不附加、重洗、牌庫張數不變', () => {
  const tool = I(FAN), filler = I(findId('基本【草】能量'));
  let { s } = runOnSpotCarry([tool, filler]);
  s = mod.applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [] }, pool);
  const host = s.players[0].bench.find((b) => b.cardId === String(FAR));
  ok(host && !host.toolAttached, '沒選就不該附');
  eq(s.players[0].deck.length, 2, '牌庫張數');
  ok(logs(s).includes('臨場背負：未附加道具，重洗牌庫'), '缺少未附加的 log');
});

T('⭐正對照：送一張非道具（能量）進來時仍必須被擋下 —— 修法不是把驗證整條拿掉', () => {
  // ⚠ 實際會先被 engine 的中央消毒閘（v6.009 resolver 自驗）濾掉，resolver 收到空陣列
  //   ⇒ 走「未附加道具，重洗牌庫」。resolver 內的 evaluateSelectionFilter 是第二道防線。
  //   本條斷言的是**不變式**（能量絕不可能被當成寶可夢道具附上），不綁哪一條 log。
  const tool = I(FAN), filler = I(findId('基本【草】能量'));
  let { s } = runOnSpotCarry([tool, filler]);
  s = mod.applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [filler.iid] }, pool);
  const host = s.players[0].bench.find((b) => b.cardId === String(FAR));
  ok(host && !host.toolAttached, '能量不是寶可夢道具，不該附上');
  ok(s.players[0].deck.some((c) => c.iid === filler.iid), '能量應留在牌庫');
  ok(!logs(s).includes('將「基本【草】能量」附給'), '不可以把能量當道具附上');
});

// ══════════════════════════════════════════════════════════════════════════════
// §2 靜態：拿「picker 的 filter key」去比 card.subtype 是恆真/恆假的死判斷
// ══════════════════════════════════════════════════════════════════════════════
console.log('§2 subtype/supertype 字面量必須是卡庫真的存在的值');
const LIVE_SUB = new Set(), LIVE_SUP = new Set();
for (const c of pool.values()) { if (c.subtype) LIVE_SUB.add(c.subtype); if (c.supertype) LIVE_SUP.add(c.supertype); }
// 歷史遺留、且**只出現在排除路徑**（判為 false 只會更寬鬆，不會吃掉玩家的選擇）：
//   'Other'   舊資料形狀（道具卡曾是 supertype='Pokemon' subtype='Other'）
//   'Pokémon' 舊 scraper 的重音寫法，永遠是 `||` 的備選
//   'None'    卡片頁顯示用的空值
const LEGACY_OK = new Set(['Other', 'Pokémon', 'None']);
// ⚠ 保留行號：註解換成等長空白，不刪行。`(^|[^:])` 讓「檔案第一個字元就是 //」也砍得掉，
//   同時不會誤砍 URL 裡的 `https://`。
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
          .replace(/(^|[^:])\/\/[^\n]*/gm, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}
function walkSrc(rel, acc = []) {
  for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = rel + '/' + e.name;
    if (e.isDirectory()) walkSrc(p, acc); else if (e.name.endsWith('.ts') || e.name.endsWith('.svelte')) acc.push(p);
  }
  return acc;
}
// ⭐ 吃 [名稱, 原始碼] 陣列（不寫任何暫存檔 —— 寫檔的守衛崩掉時會在 repo 留垃圾，
//   而 walkSrc 自己會跳過點開頭檔名 ⇒ 連自己都偵測不到）。
function scanSubtypeLiterals(srcs) {
  const bad = []; let n = 0;
  for (const [rel, raw] of srcs) {
    const src = stripComments(raw);
    for (const [re, valid, what] of [
      [/\.subtype\s*(?:===|!==|==|!=)\s*'([^']*)'/g, LIVE_SUB, 'subtype'],
      [/\.supertype\s*(?:===|!==|==|!=)\s*'([^']*)'/g, LIVE_SUP, 'supertype'],
    ]) {
      let m;
      while ((m = re.exec(src))) {
        n++;
        if (valid.has(m[1]) || LEGACY_OK.has(m[1])) continue;
        bad.push(`${rel}:${src.slice(0, m.index).split('\n').length} — .${what} 比對 '${m[1]}'（卡庫沒有這個值）`);
      }
    }
  }
  return { bad, n };
}
const SRC = walkSrc('src').map((rel) => [rel, readFileSync(join(ROOT, rel), 'utf8')]);
T('⭐ 掃描器下限：至少掃到 880 處 subtype/supertype 比對（實測 900+；掃不到＝安慰劑）', () => {
  const { n } = scanSubtypeLiterals(SRC);
  ok(n >= 880, `只掃到 ${n} 處`);
});
T('⭐ 正對照：合成一段含 `.subtype === \'Tool\'` 的原始碼，必須被抓到', () => {
  const { bad } = scanSubtypeLiterals([['probe.ts', "export const f=(c)=>c.subtype === 'Tool';\n"]]);
  ok(bad.length === 1 && bad[0].includes("'Tool'"), '正對照沒被抓到 ⇒ 掃描器失效');
});
T('⭐ 正對照：`https://x//y` 這種 URL 不可以被誤判成註解（否則掃描器會少掃）', () => {
  const { n } = scanSubtypeLiterals([['probe2.ts', "const u='https://a.b/c'; export const f=(c)=>c.subtype === 'Item';\n"]]);
  eq(n, 1, 'URL 被當成註解砍掉了 ⇒ 掃描器會漏掃');
});
T('⭐⭐⭐ 全站：沒有拿卡庫不存在的字面量去比 subtype/supertype', () => {
  const { bad } = scanSubtypeLiterals(SRC);
  ok(bad.length === 0, `${bad.length} 處：\n      ` + bad.join('\n      '));
});

// ══════════════════════════════════════════════════════════════════════════════
// §3 行為端：任何 ATTACK_POST 都不得覆寫既有的 pendingSelection
//    （C 段靜態掃描擋的是「寫物件字面量」；這裡擋的是「不管用什麼寫法，行為上蓋掉了」）
// ══════════════════════════════════════════════════════════════════════════════
console.log('§3 ATTACK_POST 行為端：不得覆寫既有 pending');
const PROBE_KEY = '__v6211_probe_prior_pending__';
function clobberScan(extraEntries = []) {
  const eG = findId('基本【草】能量'), eF = findId('基本【火】能量'), eW = findId('基本【水】能量');
  // ⚠ 獎賞卡故意設 faceUp —— 取獎 picker（addPendingPrize）只有在有正面朝上的獎賞時才會開，
  //   不設的話這條路徑幾乎掃不到（實測覆蓋差 10 倍）。
  const mk = () => {
    const att = I(PIKA); att.energyAttached = [{ cardId: eG }, { cardId: eF }, { cardId: eW }, { cardId: eG }, { cardId: eF }];
    const st = ST(
      { active: att, bench: [I(PIKA), I(PIKA)], hand: [I(eG), I(eF)], deck: [I(eG), I(eF), I(eW), I(PIKA), I(PIKA)],
        discard: [I(eG), I(PIKA)], prizes: [I(eG, { faceUp: true }), I(eF)] },
      { active: I(PIKA, { damage: 10 }), bench: [I(PIKA), I(PIKA)], hand: [I(eG)], deck: [I(eG), I(eF), I(PIKA)],
        discard: [I(eF)], prizes: [I(eG, { faceUp: true }), I(eF)] },
    );
    st.pendingSelection = { type: 'modal-choice', actorIdx: 0, sourcePlayerIdx: 0, minCount: 1, maxCount: 1,
      effectKey: PROBE_KEY, params: { options: [{ id: 'a', text: 'a' }] }, token: 999 };
    return st;
  };
  // ⚠ 「不開 picker」的 post fn 對本檢定是恆真式（它不可能蓋掉任何東西）。
  //   所以另外量 openers＝「在沒有既存 pending 的乾淨盤面上，真的會開 picker」的個數——
  //   那才是本掃描的**真分母**。只看 scanned 會把恆真項目算進去（分母污染）。
  const clean = () => { const s = mk(); s.pendingSelection = null; return s; };
  const bad = [], threw = [], nonstate = [];
  let scanned = 0, openers = 0;
  for (const [k, fn] of [...mod.ATTACK_POST.entries(), ...extraEntries]) {
    let out;
    try { out = fn(mk(), 0, pool, {}); } catch (e) { threw.push(k); continue; }
    const st = out?.state ?? out;
    if (!st || typeof st !== 'object' || !('players' in st)) { nonstate.push(k); continue; }
    scanned++;
    try { const c = fn(clean(), 0, pool, {}); const cs = c?.state ?? c; if (cs?.pendingSelection) openers++; } catch { /* 乾淨盤面炸掉不影響本檢定 */ }
    if (st.pendingSelection?.effectKey === PROBE_KEY) continue;
    if ((st.pendingChainQueue ?? []).some((x) => x.effectKey === PROBE_KEY)) continue;
    bad.push(`${k} → ${st.pendingSelection?.effectKey ?? '(清空)'}`);
  }
  return { bad, scanned, openers, threw, nonstate };
}
T('⭐ 掃描器下限①：ATTACK_POST 全部跑得完（沒有例外被靜默跳過）', () => {
  const { threw, nonstate, scanned } = clobberScan();
  ok(threw.length === 0, `${threw.length} 個丟例外被跳過（＝靜默豁免）：` + threw.slice(0, 5).join('、'));
  ok(nonstate.length === 0, `${nonstate.length} 個回傳不是 state：` + nonstate.slice(0, 5).join('、'));
  ok(scanned >= 1100, `只掃到 ${scanned} 個`);
});
T('⭐⭐ 掃描器下限②：真的會開 picker 的 ATTACK_POST ≥ 300（這才是本檢定的分母）', () => {
  const { openers } = clobberScan();
  ok(openers >= 300, `只有 ${openers} 個會開 picker —— 測試盤面退化了，本掃描已經名存實亡`);
});
T('⭐ 正對照：塞一個會覆寫 pending 的假 ATTACK_POST，掃描器必須抓到', () => {
  const evil = ['__probe_evil__', (s) => ({ ...s, pendingSelection: { type: 'modal-choice', actorIdx: 0, sourcePlayerIdx: 0, minCount: 1, maxCount: 1, effectKey: '__evil__' } })];
  const { bad } = clobberScan([evil]);
  ok(bad.some((b) => b.startsWith('__probe_evil__')), '正對照沒被抓到 ⇒ 掃描器失效');
});
T('⭐⭐⭐ 全站：沒有任何 ATTACK_POST 會覆寫既有的 pendingSelection', () => {
  const { bad } = clobberScan();
  ok(bad.length === 0, `${bad.length} 個會蓋掉前一個 picker：\n      ` + bad.join('\n      '));
});

// ══════════════════════════════════════════════════════════════════════════════
// §4 手機直式 vs 桌機：「能不能做這個動作」必須同源（站長指定維度）
// ══════════════════════════════════════════════════════════════════════════════
console.log('§4 手機/桌機動作判定同源');
const GATES = [
  ['招式（可用 index）', 'getAvailableAttacks', ['getAvailableAttacks']],
  ['招式（有效清單）',   'getEffectiveAttacks', ['getEffectiveAttacks']],
  ['撤退',               'canRetreat',          ['canRetreat', 'engineCanRetreat']],
  ['特性',               'getUsableAbilities',  ['getUsableAbilities']],
  ['進化',               'getEvolvableTargets', ['getEvolvableTargets']],
  ['手牌操作',           'getHandCardOps',      ['getHandCardOps']],
];
function checkSameSource(srcs) {
  const bad = [];
  for (const [label, fn, names] of GATES) {
    for (const [file, raw] of srcs) {
      const src = stripComments(raw);
      // import 必須真的來自中央模組（$lib/game/engine 或 $lib/game/hand-card-ops），
      // 不能只是「檔案某處出現過這個字」——所以只在 import 區塊裡找。
      const importBlocks = [...src.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*'(\$lib\/game\/engine|\$lib\/game\/hand-card-ops)'/g)]
        .map((m) => m[1]).join(',');
      const imported = new RegExp(`\\b${fn}\\b`).test(importBlocks);
      const called = names.some((n) => new RegExp(`\\b${n}\\s*\\(`).test(src));
      if (!imported) bad.push(`${file}：${label} 沒有從中央模組 import ${fn}`);
      if (!called) bad.push(`${file}：${label} import 了 ${fn} 卻沒有實際呼叫（死 import）`);
      for (const n of names) {
        if (new RegExp(`\\bfunction\\s+${n}\\s*\\(`).test(src)) bad.push(`${file}：本地重新實作了 ${n}`);
        if (new RegExp(`\\b(const|let)\\s+${n}\\s*=\\s*(\\([^)]*\\)\\s*=>|function|async)`).test(src)) bad.push(`${file}：本地重新實作了 ${n}`);
      }
    }
  }
  return bad;
}
// ⚠ 用 glob 取檔（寫死檔名的話，日後新增第三個版面分支＝零偵測）。
const UI_FILES = readdirSync(join(ROOT, 'src/routes/game')).filter((f) => f.endsWith('.svelte')).sort();
T('⭐⭐ 對戰版面檔凍結為 2 個（新增第三個版面分支時本守衛必須被回來更新，不能靜默漏掉）', () => {
  eq(JSON.stringify(UI_FILES), JSON.stringify(['+page.svelte', 'MobilePortraitBattle.svelte']),
    '對戰版面檔清單變了 —— 新版面也必須讀同一批中央述詞，請把它加進來一起檢查');
});
const UI_SRCS = UI_FILES.map((f) => [f, readFileSync(join(ROOT, 'src/routes/game', f), 'utf8')]);
const GOOD_PROBE = "import { getAvailableAttacks, getEffectiveAttacks, canRetreat, getUsableAbilities, getEvolvableTargets } from '$lib/game/engine';\n"
  + "import { getHandCardOps } from '$lib/game/hand-card-ops';\n"
  + "getAvailableAttacks(); getEffectiveAttacks(); canRetreat(); getUsableAbilities(); getEvolvableTargets(); getHandCardOps();\n";
T('⭐ 正對照 A：合成一份「本地自己寫一份 getAvailableAttacks」的檔，必須被判紅', () => {
  const bad = checkSameSource([['probe.svelte', GOOD_PROBE + 'function getAvailableAttacks(g){ return []; }\n']]);
  ok(bad.some((b) => b.includes('本地重新實作了 getAvailableAttacks')), '正對照 A 沒被抓到');
});
T('⭐ 正對照 B：合成一份「改從本地檔 import canRetreat」的檔，必須被判紅', () => {
  const evil = GOOD_PROBE.replace("import { getHandCardOps } from '$lib/game/hand-card-ops';",
    "import { getHandCardOps } from './my-local-hand-ops';");
  const bad = checkSameSource([['probe.svelte', evil]]);
  ok(bad.some((b) => b.includes('沒有從中央模組 import getHandCardOps')), '正對照 B 沒被抓到');
});
T('⭐ 正對照 C：合成一份「只在字串裡出現、其實沒 import」的檔，必須被判紅', () => {
  const bad = checkSameSource([['probe.svelte', "const s = 'getAvailableAttacks, getEffectiveAttacks, canRetreat';\n"]]);
  ok(bad.length >= 6, '正對照 C 沒被抓到（字串騙過了 import 檢查）');
});
T('⭐⭐⭐ 桌機與手機直式的六個動作判定全部讀同一份中央述詞、且無本地重寫', () => {
  const bad = checkSameSource(UI_SRCS);
  ok(bad.length === 0, `${bad.length} 處：\n      ` + bad.join('\n      '));
});

console.log(`\nv6.211 臨場背負／filter-key 死判斷／UI 同源：PASS ${pass}, FAIL ${fail}`);
console.log('=== test-v6211-selected-but-no-effect END ===');
if (fail > 0) process.exit(1);
