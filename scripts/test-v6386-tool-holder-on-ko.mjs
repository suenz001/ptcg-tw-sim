// ═══════════════════════════════════════════════════════════════════════════
// v6.386 守衛：「在戰鬥場受到對手的寶可夢招式的傷害時」型寶可夢道具 ——
//   **持有者被這一招打死時，效果仍然必須觸發**。
//
// 玩家回報：附「火箭隊的催眠裝置」的火箭隊寶可夢被對手招式打死時，對手沒有【睡眠】。
//
// 官方依據（PTCG RULES/PTCG_RULES.md，逐字）：
//   §17.2.B L619-620
//     Q: 擁有特性「反擊針」的刺球仙人掌若受到來自對手的寶可夢的招式的傷害昏厥了，
//        可以因特性「反擊針」的效果，在使用招式的寶可夢身上放置3個傷害指示物嗎？
//     A: 可以。
//   §17.20.B L1472-1473
//     Q: 對手的稚山雀使出招式「送回」，將附有寶可夢道具卡「沉重接力棒」的自己的鐵臂膀ex[昏厥]了。
//        此時，因寶可夢道具卡「沉重接力棒」的效果，可以將[昏厥]的鐵臂膀ex身上附加的
//        基本能量卡改附給備戰寶可夢嗎？
//     A: 可以。
//   §16.2 L558（站長裁定 六-14, v6.368）：招式效果視為同時發生，持有者即使被**這一次**招式
//     打到[昏厥]離場，該效果對**這一次**招式仍然生效。
//
// ⭐⭐⭐ 根因（維度＝「KO 之後 state 上已經沒有 holder 了」）：
//   `registerToolOnDamagedAndKO` 的 KO 鏡射寫成
//     TOOL_ON_KO.set(name, (state, dIdx, aIdx, pool, _koInst, atk) => fn(state, dIdx, aIdx, 0, pool, atk))
//   —— **把 koInst 丟掉**。而 fn 內部用 `state.players[dIdx].active` 取 holder，
//   引擎主管線跑到 TOOL_ON_KO 時 active 已是 null ⇒ 條件判斷靜默失敗、整個效果不發動。
//   受害：火箭隊的催眠裝置（判「是不是『火箭隊的』」）、逆境保險（讀 holder 的弱點屬性）。
//   幸運頭盔／凸凸頭盔／手持循環扇沒事，純粹因為它們不讀 holder —— 運氣，不是設計。
//
// 收斂（Rule 38）：holder 由 `registerToolOnDamagedAndKO` **統一解析**後傳給 fn
//   （非 KO ⇒ players[dIdx].active；KO ⇒ koInst 快照），fn 一律不准自己讀 active。
//
// 斷言分層：
//   【0】fixture 自驗（卡面逐字，全部取自 static/cards 的 rulesText）
//   【A】⭐⭐⭐ 行為端：火箭隊的催眠裝置 / 逆境保險 的 KO × 非KO 矩陣 ＋ 條件反對照
//   【B】⭐⭐⭐ 卡池自動枚舉：每一張「受到…招式的傷害時」型且有實裝的道具，
//        KO 與非 KO 的觸發結果必須一致（未來新卡自動納入）
//   【C】⭐⭐ 不得矯枉過正：幸運頭盔／手持循環扇／奢華炸彈 的既有行為逐條不變
//   【D】⭐⭐ 收斂：helper 必須把 koInst 傳給 fn；註冊的 fn 區塊內不得再讀 players[dIdx].active
//   【E】⭐ 官方規則逐字錨（規則檔被改寫就紅）
//   【F】⭐⭐⭐ HEAD-FAIL：對 BASE 的 tools.ts 重跑【A】必紅
//   【G】⭐ 本守衛在 npm test chain 裡
//
// ⛔ 本守衛不寫任何東西進 src/；合成盤面只在記憶體裡。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '82f40f570ebfca67c17fd1ce9abf2830035ff622';   // v6.385（本版的上一版）

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => {
  if (ok) { console.log('  PASS ' + name); pass++; }
  else { console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); fail++; }
  return !!ok;
};

const STRAY = [];
const TMP = mkdtempSync(join(tmpdir(), 'v6386-'));
process.on('exit', () => {
  for (const p of STRAY) { try { unlinkSync(p); } catch { /* */ } }
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* */ }
});

async function bundleFrom(srcDir, tag) {
  const parent = dirname(srcDir);
  const name = srcDir.slice(parent.length + 1).replace(/\\/g, '/');
  const p = './' + name;
  const S = join(parent, '.v6386-s-' + tag + '.js'), E = join(parent, '.v6386-e-' + tag + '.ts'), O = join(parent, '.v6386-o-' + tag + '.mjs');
  STRAY.push(S, E, O);
  writeFileSync(S, 'export const base="";export const assets="";');
  writeFileSync(E,
    "export { applyAction } from '" + p + "/lib/game/engine';\n"
    + "export { TOOL_ON_DAMAGED, TOOL_ON_KO } from '" + p + "/lib/game/effects';\n"
    + "import '" + p + "/lib/game/effects';\n");
  await build({
    entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(srcDir, 'lib'), '$app/paths': S }, logLevel: 'silent',
  });
  return import(pathToFileURL(O).href);
}

// ── 卡池 ────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) { if (c?.id == null) continue; pool.set(String(c.id), c); all.push(c); }
}
const byId = (id) => pool.get(String(id));
const HIJ = (c) => ['H', 'I', 'J'].includes(c?.regulationMark);
const count = (t, s) => t.split(s).length - 1;

// ── 真卡 fixture（全部 live H/I/J）──────────────────────────────────────────
const HYPNO = byId('12857');   // 火箭隊的催眠裝置（I）
const INSUR = byId('14466');   // 逆境保險（I）
const LUX   = byId('17155');   // 奢華炸彈（H）
const HELM  = byId('10307');   // 幸運頭盔（H）
const FAN   = byId('10509');   // 手持循環扇（H）
const MEW   = byId('14723');   // 火箭隊的超夢ex（I）280HP 弱點【惡】×2
const HYD   = byId('11252');   // 三首惡龍ex（H）330HP【惡】｜粉碎頭 200
const KOU   = byId('13410');   // 酷豹（I）110HP【惡】｜拍落 50

console.log('\n【0】fixture 自驗（卡面逐字取自 static/cards）');
chk('0a 五張道具都在 live H/I/J 卡池',
  [HYPNO, INSUR, LUX, HELM, FAN].every(c => c && HIJ(c)),
  JSON.stringify([HYPNO, INSUR, LUX, HELM, FAN].map(c => c?.name ?? null)));
chk('0b ⭐火箭隊的催眠裝置卡面逐字（條件＝「火箭隊的」寶可夢、在戰鬥場、受到招式的傷害時）',
  HYPNO?.rulesText === '附有這張卡的「火箭隊的寶可夢」在戰鬥場受到對手的寶可夢招式的傷害時，將使用招式的寶可夢【睡眠】。',
  String(HYPNO?.rulesText));
chk('0c ⭐卡面**沒有**「而【昏厥】時」的限制（＝「受到傷害時」含被打死的情況）',
  !/昏厥/.test(String(HYPNO?.rulesText)) && !/昏厥/.test(String(INSUR?.rulesText)),
  String(HYPNO?.rulesText).slice(0, 60));
chk('0d ⭐攻擊方 fixture：三首惡龍ex 粉碎頭 200（attackIndex 0）／酷豹 拍落 50（attackIndex 0）',
  HYD?.attacks?.[0]?.name === '粉碎頭' && String(HYD.attacks[0].damage) === '200'
  && KOU?.attacks?.[0]?.name === '拍落' && String(KOU.attacks[0].damage) === '50',
  JSON.stringify([HYD?.attacks?.[0]?.name, HYD?.attacks?.[0]?.damage, KOU?.attacks?.[0]?.name, KOU?.attacks?.[0]?.damage]));
chk('0e ⭐holder fixture：火箭隊的超夢ex 名稱以「火箭隊的」起頭、HP280、弱點【惡】',
  MEW?.name?.startsWith('火箭隊的') && Number(MEW.hp) === 280 && MEW.weakness?.type === 'Darkness',
  JSON.stringify({ n: MEW?.name, hp: MEW?.hp, w: MEW?.weakness?.type }));
chk('0f ⭐⭐傷害算式成立：粉碎頭 200×2 = 400 ≥ 280 ⇒ KO；拍落 50×2 = 100 < 280 ⇒ 不 KO',
  200 * 2 >= Number(MEW?.hp) && 50 * 2 < Number(MEW?.hp));

// 反對照用：非「火箭隊的」、弱點【惡】、HP 與超夢ex 同級（KO／非KO 兩種情境都要能重現）
const NOTROCKET = all.find(c => c.supertype === 'Pokemon' && HIJ(c) && !c.name.startsWith('火箭隊的')
  && c.weakness?.type === 'Darkness' && Number(c.hp) >= 200 && Number(c.hp) <= 300
  && (c.stage ?? c.subtype) === 'Basic');
chk('0g ⭐反對照 holder：找得到「非火箭隊的、弱點【惡】、HP 200~300 的基礎寶可夢」',
  !!NOTROCKET, String(NOTROCKET?.name));

const eName = (n) => { for (const c of all) if (c.name === n && c.supertype === 'Energy') return String(c.id); return null; };
const DARK = eName('基本【惡】能量');
chk('0h 抓得到基本【惡】能量', !!DARK, String(DARK));

// ── 盤面 helper ─────────────────────────────────────────────────────────────
const en = (cid, iid) => ({ iid, cardId: cid, damage: 0, energyAttached: [] });
const mon = (cid, iid, o = {}) => ({ iid, cardId: cid, damage: 0, energyAttached: [], ...o });
const PL = (name, o = {}) => ({ name, active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...o });
const ST = (p0, p1) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
  turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true], players: [p0, p1] });
// ⚠ 牌庫要夠深：KO 情境用的是 三首惡龍ex｜粉碎頭，它的招式效果會**先磨掉對手牌庫頂 3 張**，
//   牌庫只有 5 張的話逆境保險就只抽得到 2 張 ⇒ A4／F3 會因為 fixture 而假紅（實測到）。
const DECK5 = () => ['A','B','C','D','E','F','G','H','I','J','K','L'].map(n => en(DARK, 'dk' + n));
const DARK5 = () => [1, 2, 3, 4, 5].map(i => en(DARK, 'ae' + i));

/**
 * 打一招，回傳可斷言的結果切片。
 * @param M     bundle（HEAD 或 BASE）
 * @param atk   攻擊方卡 id（attackIndex 0）
 * @param def   防守方（holder）卡 id
 * @param tool  holder 身上的道具 id（null ⇒ 不帶道具）
 */
function hit(M, atk, def, tool) {
  const st = ST(
    PL('P0', { active: mon(atk, 'atk', { energyAttached: DARK5() }), bench: [mon(String(HYD.id), 'ab1')], deck: DECK5() }),
    PL('P1', {
      active: mon(def, 'def', tool ? { toolAttached: { iid: 'tool1', cardId: tool } } : {}),
      bench: [mon(String(HYD.id), 'db1')], deck: DECK5(),
    }),
  );
  try {
    const s = M.applyAction(st, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
    const a = s.players[0].active;
    return {
      ko: s.log.some(l => String(l.message ?? '').includes('被擊倒')),
      atkStatus: a?.status ?? null,
      atkDamage: a?.damage ?? null,
      defHand: s.players[1].hand.length,
      pend: s.pendingSelection?.effectKey ?? null,
      log: s.log.map(l => String(l.message ?? '')),
    };
  } catch (e) { return { err: String(e && e.message) }; }
}
const fired = (r, name) => !r.err && r.log.some(l => l.includes(name));

const HEAD = await bundleFrom(join(ROOT, 'src'), 'head');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】⭐⭐⭐ 行為端：holder 被同一招打死時仍必須觸發');
// ═══════════════════════════════════════════════════════════════════════════
const ID = { HYPNO: String(HYPNO.id), INSUR: String(INSUR.id), LUX: String(LUX.id), HELM: String(HELM.id), FAN: String(FAN.id) };
const A_ko  = hit(HEAD, String(HYD.id), String(MEW.id), ID.HYPNO);   // 400 ⇒ KO
const A_nko = hit(HEAD, String(KOU.id), String(MEW.id), ID.HYPNO);   // 100 ⇒ 不 KO

chk('A0 前提：KO 情境真的 KO 了、非 KO 情境真的沒 KO',
  A_ko.ko === true && A_nko.ko === false, JSON.stringify({ ko: A_ko.ko, nko: A_nko.ko, e1: A_ko.err, e2: A_nko.err }));
chk('A1 ⭐⭐⭐ 火箭隊的催眠裝置：holder 被這一招打死 ⇒ 使用招式的寶可夢仍【睡眠】（BASE 必紅）',
  A_ko.atkStatus === 'asleep' && fired(A_ko, '火箭隊的催眠裝置'),
  JSON.stringify({ status: A_ko.atkStatus, log: A_ko.log.filter(l => l.includes('催眠')) }));
chk('A2 ⭐ 正對照：非 KO 時照樣【睡眠】（本版不得把既有行為弄壞）',
  A_nko.atkStatus === 'asleep' && fired(A_nko, '火箭隊的催眠裝置'),
  JSON.stringify({ status: A_nko.atkStatus }));

const A_notrocket_ko  = NOTROCKET ? hit(HEAD, String(HYD.id), String(NOTROCKET.id), ID.HYPNO) : null;
const A_notrocket_nko = NOTROCKET ? hit(HEAD, String(KOU.id), String(NOTROCKET.id), ID.HYPNO) : null;
chk('A3 ⭐⭐ 反對照：holder **不是**「火箭隊的」寶可夢 ⇒ KO 與非 KO 都不得觸發（不是無條件放行）',
  !!A_notrocket_ko && !fired(A_notrocket_ko, '火箭隊的催眠裝置')
  && !!A_notrocket_nko && !fired(A_notrocket_nko, '火箭隊的催眠裝置')
  && A_notrocket_ko.atkStatus !== 'asleep' && A_notrocket_nko.atkStatus !== 'asleep',
  JSON.stringify({ holder: NOTROCKET?.name, ko: A_notrocket_ko?.atkStatus, nko: A_notrocket_nko?.atkStatus }));
chk('A3b ★ 反對照的前提成立（那兩盤真的一個 KO、一個沒 KO —— 否則 A3 是恆真式）',
  A_notrocket_ko?.ko === true && A_notrocket_nko?.ko === false,
  JSON.stringify({ hp: NOTROCKET?.hp, ko: A_notrocket_ko?.ko, nko: A_notrocket_nko?.ko }));

const B_ko  = hit(HEAD, String(HYD.id), String(MEW.id), ID.INSUR);
const B_nko = hit(HEAD, String(KOU.id), String(MEW.id), ID.INSUR);
chk('A4 ⭐⭐⭐ 逆境保險（同型，audit 挖出）：holder 被打死 ⇒ 仍抽 3 張（BASE 必紅）',
  B_ko.defHand === 3 && fired(B_ko, '逆境保險'),
  JSON.stringify({ hand: B_ko.defHand, log: B_ko.log.filter(l => l.includes('逆境')) }));
chk('A5 ⭐ 正對照：逆境保險非 KO 時照樣抽 3 張',
  B_nko.defHand === 3 && fired(B_nko, '逆境保險'), JSON.stringify({ hand: B_nko.defHand }));

// 弱點不匹配的反對照：holder 的弱點不是攻擊方屬性
const NOTWEAK = all.find(c => c.supertype === 'Pokemon' && HIJ(c) && c.weakness?.type && c.weakness.type !== 'Darkness'
  && Number(c.hp) >= 200 && Number(c.hp) <= 300 && (c.stage ?? c.subtype) === 'Basic');
const B_nw = NOTWEAK ? hit(HEAD, String(HYD.id), String(NOTWEAK.id), ID.INSUR) : null;
chk('A6 ⭐⭐ 反對照：holder 弱點屬性 ≠ 攻擊方屬性 ⇒ 不得抽牌（KO 情境）',
  !!B_nw && B_nw.defHand === 0 && !fired(B_nw, '逆境保險'),
  JSON.stringify({ holder: NOTWEAK?.name, w: NOTWEAK?.weakness?.type, hand: B_nw?.defHand }));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】⭐⭐⭐ 卡池自動枚舉：每一張「受到…招式的傷害時」型道具，KO 與非 KO 一致');
// ═══════════════════════════════════════════════════════════════════════════
// ⚠ 判準取自**卡面**，不是寫死的名單 —— 未來新卡自動納入。
const isKOType  = (t) => /傷害而【昏厥】時/.test(t);
const isDmgType = (t) => !isKOType(t) && /受到[^。]{0,40}招式[^。]{0,10}傷害時/.test(t);
const TOOLS = [];
for (const c of all) {
  if (c.supertype !== 'Trainer' || !/Tool/i.test(String(c.subtype || '')) || !HIJ(c)) continue;
  if (TOOLS.some(t => t.name === c.name)) continue;
  TOOLS.push({ id: String(c.id), name: c.name, text: String(c.rulesText || '') });
}
chk('B0 ★ 枚舉器活著：H/I/J 寶可夢道具 ≥ 30 種，其中「受到…傷害時」型 ≥ 10 種',
  TOOLS.length >= 30 && TOOLS.filter(t => isDmgType(t.text)).length >= 10,
  `tools=${TOOLS.length} dmgType=${TOOLS.filter(t => isDmgType(t.text)).length}`);

// 「有實裝」＝ TOOL_ON_DAMAGED 有註冊。沒實裝的不在本守衛範圍（由各自的卡片守衛負責）。
const IMPL = TOOLS.filter(t => isDmgType(t.text) && HEAD.TOOL_ON_DAMAGED.has(t.name));
chk('B0b ★ 有實裝的「受到…傷害時」型道具 ≥ 5 張（枚舉沒有整個落空）', IMPL.length >= 5,
  IMPL.map(t => t.name).join('/'));

// ⚠ 白名單：holder 條件在本 fixture 下不可能成立的道具（必須逐張寫理由）。
//   白名單空 ⇒ 每一張都要在 fixture 下真的觸發；非空 ⇒ 名單內的才准「兩邊都不觸發」。
const B_SKIP = new Map([
  ['豪邁炸彈', '卡面要求攻擊方是「超級進化ex」且傷害 ≥240，本 fixture 的三首惡龍ex 不是 ⇒ 兩邊都不觸發'],
  ['龐克頭盔', '卡面要求 holder 是【惡】寶可夢，本 fixture 的 holder 是【超】⇒ 兩邊都不觸發'],
]);
for (const t of IMPL) {
  const rko  = hit(HEAD, String(HYD.id), String(MEW.id), t.id);
  const rnko = hit(HEAD, String(KOU.id), String(MEW.id), t.id);
  const fko = fired(rko, t.name), fnko = fired(rnko, t.name);
  if (rko.err || rnko.err) { chk(`B1 [${t.name}] 兩盤都要跑得起來（ERR 一律判紅）`, false, String(rko.err || rnko.err)); continue; }
  if (!fko && !fnko) {
    chk(`B1 [${t.name}] 兩邊都沒觸發 ⇒ 必須在白名單內並附理由`, B_SKIP.has(t.name), B_SKIP.get(t.name) ?? '（不在白名單）');
    continue;
  }
  chk(`B1 ⭐⭐ [${t.name}] KO 與非 KO 的觸發結果一致（卡面是「受到…傷害時」⇒ 含被打死）`,
    fko === fnko && fko === true, `KO=${fko} 非KO=${fnko}`);
}
chk('B2 ★ 白名單只准放「本 fixture 條件不成立」的道具，且每一張都要有理由',
  [...B_SKIP.values()].every(v => typeof v === 'string' && v.length > 10),
  JSON.stringify([...B_SKIP.keys()]));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】⭐⭐ 不得矯枉過正：既有行為逐條不變');
// ═══════════════════════════════════════════════════════════════════════════
const C_helm_ko = hit(HEAD, String(HYD.id), String(MEW.id), ID.HELM);
const C_helm_nk = hit(HEAD, String(KOU.id), String(MEW.id), ID.HELM);
chk('C1 幸運頭盔：KO 與非 KO 都**恰好**抽 2 張（不得變成 0 或 4）',
  C_helm_ko.defHand === 2 && C_helm_nk.defHand === 2,
  JSON.stringify({ ko: C_helm_ko.defHand, nko: C_helm_nk.defHand }));
const C_fan_ko = hit(HEAD, String(HYD.id), String(MEW.id), ID.FAN);
const C_fan_nk = hit(HEAD, String(KOU.id), String(MEW.id), ID.FAN);
chk('C2 手持循環扇：KO 與非 KO 都恰好開 1 個 pending（cycle-fan-step1-pick-energy）',
  C_fan_ko.pend === 'cycle-fan-step1-pick-energy' && C_fan_nk.pend === 'cycle-fan-step1-pick-energy'
  && count(C_fan_ko.log.join('|'), '手持循環扇：選 1 個') === 1,
  JSON.stringify({ ko: C_fan_ko.pend, nko: C_fan_nk.pend }));
const C_lux_ko = hit(HEAD, String(HYD.id), String(MEW.id), ID.LUX);
chk('C3 奢華炸彈：KO 時仍反彈 120（本來就對，不得被 holder 收斂弄壞）',
  C_lux_ko.atkDamage === 120 && fired(C_lux_ko, '奢華炸彈'),
  JSON.stringify({ dmg: C_lux_ko.atkDamage }));
const C_none = hit(HEAD, String(HYD.id), String(MEW.id), null);
chk('C4 ★ 空白對照：holder 沒帶道具 ⇒ 攻擊方毫髮無傷、沒有任何道具 log',
  C_none.atkStatus === null && (C_none.atkDamage === 0 || C_none.atkDamage === null)
  && !C_none.log.some(l => /催眠裝置|逆境保險|奢華炸彈|幸運頭盔|手持循環扇/.test(l)),
  JSON.stringify({ st: C_none.atkStatus, dmg: C_none.atkDamage }));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】⭐⭐ 收斂：holder 只有一份判準');
// ═══════════════════════════════════════════════════════════════════════════
const TOOLS_TS = readFileSync(join(ROOT, 'src/lib/game/effects/cards/tools.ts'), 'utf8');
chk('D1 ⭐⭐⭐ KO 鏡射必須把 koInst 傳給 fn（不得再寫成 `_koInst` 丟掉）',
  /TOOL_ON_KO\.set\(name,\s*\(state,\s*dIdx,\s*aIdx,\s*pool,\s*koInst,\s*attackerIid\)/.test(TOOLS_TS)
  && !/TOOL_ON_KO\.set\(name,[^\n]*_koInst/.test(TOOLS_TS),
  (TOOLS_TS.match(/TOOL_ON_KO\.set\(name,[^\n]*/) ?? ['(找不到)'])[0]);
chk('D2 ⭐⭐ 非 KO 路徑的 holder 也由 helper 算（TOOL_ON_DAMAGED 不再直接塞 fn）',
  /TOOL_ON_DAMAGED\.set\(name,\s*\(state,\s*dIdx,\s*aIdx,\s*damage,\s*pool,\s*attackerIid\)/.test(TOOLS_TS)
  && !/TOOL_ON_DAMAGED\.set\(name,\s*fn\);/.test(TOOLS_TS),
  (TOOLS_TS.match(/TOOL_ON_DAMAGED\.set\(name,[^\n]*/) ?? ['(找不到)'])[0]);

// 掃描每一個 registerToolOnDamagedAndKO(...) 區塊：不得再從 state 取 holder
function blockAt(text, startIdx) {
  let depth = 0, started = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') { depth++; started = true; }
    else if (ch === ')') { depth--; if (started && depth === 0) return text.slice(startIdx, i + 1); }
  }
  return text.slice(startIdx);
}
const RISK = /players\s*\[\s*(?:dIdx|_dIdx)\s*\]\s*\.active|\bdp\.active\b/;
let scanned = 0, risky = [];
{
  const re = /registerToolOnDamagedAndKO\(\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(TOOLS_TS)) !== null) {
    scanned++;
    const blk = blockAt(TOOLS_TS, m.index);
    // 只看程式碼行（跳過註解行）—— 註解裡講「原本讀 players[dIdx].active」不該判紅
    const codeOnly = blk.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    if (RISK.test(codeOnly)) risky.push(m[1]);
  }
}
chk('D3 ★ 掃描器活著：至少掃到 5 個 registerToolOnDamagedAndKO 註冊', scanned >= 5, 'scanned=' + scanned);
chk('D4 ⭐⭐⭐ 沒有任何 registerToolOnDamagedAndKO 的 fn 再從 state 取 holder',
  risky.length === 0, risky.join(', '));
chk('D4b ★ 掃描器正對照：合成一段「讀 dp.active」的假註冊，掃描器要抓得到',
  RISK.test("registerToolOnDamagedAndKO('X', (state, dIdx) => {\n  const dp = state.players[dIdx];\n  const h = dp.active;\n});"));
chk('D4c ★ 掃描器負對照：註解裡提到 players[dIdx].active 不算',
  !RISK.test("  // 原本讀 xxx 的地方\n  const h = holder;"));

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】⭐ 官方規則逐字錨');
// ═══════════════════════════════════════════════════════════════════════════
const RULES = readFileSync(join(ROOT, 'PTCG RULES/PTCG_RULES.md'), 'utf8');
chk('E1 ⭐§17.2.B：反擊針持有者受招式傷害昏厥了 ⇒ 仍可在使用招式的寶可夢身上放 3 個指示物',
  RULES.includes('擁有特性「反擊針」的刺球仙人掌若受到來自對手的寶可夢的招式的傷害昏厥了，可以因特性「反擊針」的效果，在使用招式的寶可夢身上放置3個傷害指示物嗎？'),
  '(規則檔找不到該問答)');
chk('E2 ⭐§17.20.B：沉重接力棒的持有者[昏厥]時可以發動',
  RULES.includes('因寶可夢道具卡「沉重接力棒」的效果，可以將[昏厥]的鐵臂膀ex身上附加的基本能量卡改附給備戰寶可夢嗎？'),
  '(規則檔找不到該問答)');
chk('E3 ⭐§16.2 站長裁定六-14：持有者被**這一次**招式打到昏厥離場，效果對這一次招式仍生效',
  RULES.includes('特性持有者即使被**這一次**招式打到[昏厥]離場，該特性對**這一次**招式仍然生效'),
  '(規則檔找不到該裁定)');
chk('E4 ⭐反面：道具效果被競技場卡壓制時**不**發動（本版沒有放寬 toolsJammed）',
  RULES.includes('場上放置有競技場卡「災禍荒野」時，若附有寶可夢道具卡「沉重接力棒」的戰鬥場上的鐵臂膀ex受到了對手寶可夢的招式的傷害[昏厥]了'),
  '(規則檔找不到該問答)');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】⭐⭐⭐ HEAD-FAIL：對 BASE 的 tools.ts 重跑【A】必紅');
// ═══════════════════════════════════════════════════════════════════════════
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('【F】HEAD-FAIL 對 BASE 的重建比對', '【A】~【E】都不需要歷史，仍在守');
} else {
  const bBlob = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/effects/cards/tools.ts');
  if (chk('F0 讀得到 BASE 的 tools.ts', bBlob.ok, bBlob.reason ?? '')) {
    // ⚠ 本版**只動 tools.ts**（其餘 src/ 逐字未動）⇒ 只換這一個檔就是自洽的 BASE 樹。
    const baseSrc = join(TMP, 'base-src');
    cpSync(join(ROOT, 'src'), baseSrc, { recursive: true });
    writeFileSync(join(baseSrc, 'lib/game/effects/cards/tools.ts'), bBlob.out);
    const B = await bundleFrom(baseSrc, 'base');
    const bA_ko = hit(B, String(HYD.id), String(MEW.id), ID.HYPNO);
    const bA_nk = hit(B, String(KOU.id), String(MEW.id), ID.HYPNO);
    const bB_ko = hit(B, String(HYD.id), String(MEW.id), ID.INSUR);
    const bB_nk = hit(B, String(KOU.id), String(MEW.id), ID.INSUR);
    chk('F1 哨兵：BASE bundle 是活的（非 KO 情境照樣綠，不是整支爆掉造成的「全紅」）',
      bA_nk.atkStatus === 'asleep' && bB_nk.defHand === 3,
      JSON.stringify({ st: bA_nk.atkStatus, hand: bB_nk.defHand, e1: bA_nk.err, e2: bB_nk.err }));
    chk('F2 ⭐⭐⭐ BASE 一定要紅：火箭隊的催眠裝置在 KO 情境**不觸發**（HEAD 觸發）',
      bA_ko.atkStatus !== 'asleep' && A_ko.atkStatus === 'asleep',
      'BASE=' + String(bA_ko.atkStatus) + ' HEAD=' + String(A_ko.atkStatus));
    chk('F3 ⭐⭐⭐ BASE 一定要紅：逆境保險在 KO 情境**不抽牌**（HEAD 抽 3）',
      bB_ko.defHand === 0 && B_ko.defHand === 3,
      'BASE=' + String(bB_ko.defHand) + ' HEAD=' + String(B_ko.defHand));
    chk('F4 ⭐⭐ BASE 的 tools.ts 確實把 koInst 丟掉了（根因逐字）',
      /_koInst/.test(bBlob.out) && !/koInst \?\? null/.test(bBlob.out),
      (bBlob.out.match(/TOOL_ON_KO\.set\(name,[^\n]*/) ?? ['(找不到)'])[0]);
    chk('F5 ⭐ 零變更對照：幸運頭盔在 BASE 與 HEAD 的 KO 情境結果相同（本版沒有改到它）',
      hit(B, String(HYD.id), String(MEW.id), ID.HELM).defHand === C_helm_ko.defHand,
      'BASE=' + hit(B, String(HYD.id), String(MEW.id), ID.HELM).defHand + ' HEAD=' + C_helm_ko.defHand);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【G】⭐ 本守衛在 npm test chain 裡');
// ═══════════════════════════════════════════════════════════════════════════
{
  const pkg = readFileSync(join(ROOT, 'package.json'), 'utf8');
  chk('G1 ⭐ scripts.test 裡**恰好**有本檔一次',
    count(pkg, 'node scripts/test-v6386-tool-holder-on-ko.mjs') === 1,
    String(count(pkg, 'node scripts/test-v6386-tool-holder-on-ko.mjs')));
}

console.log(`\n=== v6.386 守衛：PASS ${pass} / FAIL ${fail} ===`);
process.exit(fail === 0 ? 0 : 1);
