/**
 * v6.421 守衛：招式的自傷／打到自己備戰 × 終局判定 × 獎賞歸屬
 *
 * 【站長裁定（逐字）】自傷招式取完獎賞、同時自己昏厥且沒有備戰 ⇒「也判平手（推薦）」。
 *   延伸自 v6.420：「單方取完6張獎賞、而同一瞬間該方自己也沒有寶可夢可上場 … 應該判定為雙方平手」。
 * 【官方依據】PTCG_RULES.md L622-624（利歐路｜突擊 自傷＋打倒對手）：
 *   「可以從備戰區放置寶可夢至戰鬥場上的玩家獲勝。若雙方皆可以放置，或雙方皆不可放置，則為平手。」
 *   ⇒ 自傷造成的昏厥**必須**被結算、並進入勝負判定，不可以被「對手已全滅」直接跳過。
 *
 * 【本版修的三個 bug（BASE v6.420 皆可重現）】
 *   ① 防守方最後一隻被打倒時 engine 直接 `return _koEnd` ⇒ 招式剩下的效果（postFn）整段被跳過：
 *      密勒頓｜打雷（卡面：這隻寶可夢也受到30點傷害。）的自傷根本沒套上 ⇒ 判攻擊方勝。
 *      未知圖騰｜神秘信號（卡面：若對手的寶可夢因這個招式的傷害而【昏厥】了，則多獲得1張獎賞卡。）
 *      的「多獲得1張」也被跳過。
 *   ② 取完獎賞當下即 game-over ⇒ sanityKOSweep 被 gate 掉 ⇒ 攻擊方帶著「傷害 ≥ HP」留在場上（zombie）。
 *   ③ 招式打倒**自己的**備戰時，攻擊方替自己的昏厥取獎賞（hitBenchAll／bench-hit 寫死 attackerIdx）：
 *      固拉多｜大地裂破、穿山王｜地震、焚焰蚣｜燃燒熱浪、電飛鼠｜天空波。
 *
 * 【審查後補修（fable 5.1 抓到、自行重現屬實）】
 *   ④ 最後一張獎賞正面朝上（開 take-prize-choose picker）時，延後與 sweep 都被 picker 擋住，
 *      zombie 沒人掃 ⇒ 判 A 勝 ⇒ 補 `v6421-sweep-zombie-under-picker`（R10／R11；位置在 v6.376 clear 之前）。
 *   ⑤ 自己離場（喵喵ex｜夾尾巴逃跑 放回手牌）＋取完＋沒有備戰：v6.420 裁定原文同樣涵蓋，
 *      但 addPendingPrize 當場寫的終局沒有重判點 ⇒ 延後條件加「中央判定會判平手」
 *      （centralVerdictIsDrawV6421 直接呼叫 judgeEndgameV6361）（R13、Z8）。
 *
 * 【HEAD-FAIL】把 engine.ts／effects.ts 還原成 BASE（v6.420）後，本守衛逐條紅（Rule 41：不整支 throw）：
 *   實測 PASS 12 / FAIL 32。在 BASE 也綠的是刻意的：P1／P2（前置）、R4／R14（零回歸）、
 *   R11（BASE 的自傷沒套上所以碰巧沒有 zombie）、U2（對照）、Z0／Z5（掃描器下限）、
 *   Z1／Z6（不丟例外）、Z4（白名單證明）。
 * 【突變】退回直接 return／延後不看 zombie／判準 off-by-one／拿掉 picker 下的 zombie 掃除／延後不看中央平手／
 *   hasUnresolvedKnockout 不掃備戰／任一處獎賞歸屬退回 —— 皆紅。
 *   存活 1 個（誠實記錄）：centralVerdictIsDrawV6421 改成「中央判出任何勝負都收回」——
 *   同一勝方時收回後重判結果相同，不同勝方的盤面在現行卡池裡構造不出來 ⇒ 視為等價突變。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6421-s.js'), E = join(ROOT, '.v6421-e.ts'), O = join(ROOT, '.v6421-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\n"
  + "export { ATTACK_POST } from './src/lib/game/effects/_shared';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);

let pass = 0, fail = 0; const failed = [];
const chk = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; failed.push(name.split(' ')[0]); console.log('  FAIL', name, detail ? ' :: ' + detail : ''); }
};
const T = (name, fn) => { let r, d = ''; try { const o = fn(); r = o === true || (o && o.ok); d = o && o.d || ''; } catch (e) { r = false; d = 'throw: ' + String(e && e.message).slice(0, 160); } chk(name, r, d); };

// ── 卡池（只收 live ＋ H/I/J）──
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const hij = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (!c || c.id == null) continue;
    pool.set(String(c.id), c);
    if (['H', 'I', 'J'].includes(c.regulationMark || '')) hij.push(c);
  }
}
const eid = (n) => { for (const [id, c] of pool) if (c.name === n) return id; return null; };
const EN = { Colorless: eid('基本【惡】能量'), Water: eid('基本【水】能量'), Grass: eid('基本【草】能量'),
  Lightning: eid('基本【雷】能量'), Fighting: eid('基本【鬥】能量'), Darkness: eid('基本【惡】能量'),
  Fire: eid('基本【火】能量'), Psychic: eid('基本【超】能量'), Metal: eid('基本【鋼】能量') };
const isPlainBasic = (c) => c.supertype === 'Pokemon' && !(c.abilities || []).length && !c.evolvesFrom
  && !/ex$|ex\b/.test(c.name || '') && !c.rulesText;
const TINY = hij.find((c) => isPlainBasic(c) && Number(c.hp) === 30);
const WEAK = hij.find((c) => isPlainBasic(c) && Number(c.hp) <= 40);
const TANK = hij.filter((c) => c.supertype === 'Pokemon' && !(c.abilities || []).length)
  .sort((a, b) => Number(b.hp) - Number(a.hp))[0];
const findAtk = (id, atk) => { const c = pool.get(String(id)); return [c, (c?.attacks || []).findIndex((a) => a.name === atk)]; };
const findByName = (name, atk) => hij.find((c) => c.name === name && (c.attacks || []).some((a) => a.name === atk));

let n = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (t) => ({ iid: 'e' + (++n), cardId: String(EN[t] ?? EN.Darkness), damage: 0, energyAttached: [] });
const energiesFor = (card, ai, extra = 4) => { const es = []; for (const t of (card.attacks[ai].cost || [])) es.push(en(t)); for (let i = 0; i < extra; i++) es.push(en('Darkness')); return es; };
const mulberry32 = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const hashStr = (x) => { let h = 2166136261; for (let i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const attack = (st, ai) => { const o = M.applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool); return o?.state ?? o; };
const baseState = (P0, P1) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null, players: [P0, P1] });
const logText = (s) => (s.log || []).map((l) => (typeof l === 'string' ? l : l?.message ?? '')).join('\n');

console.log('\n【P】前置條件（測資本身必須成立，否則下面全是空真）');
const [MIRA, MIRA_AI] = findAtk('19171', '打雷');
chk('P1 密勒頓（19171）存在且有「打雷」，卡面寫自傷 30', !!MIRA && MIRA_AI >= 0
  && /這隻寶可夢也受到30點傷害/.test(MIRA.attacks[MIRA_AI].effect || '') && Number(MIRA.hp) === 120);
chk('P2 測資卡（TINY hp30／WEAK hp≤40／TANK 高 HP）都找得到', !!TINY && !!WEAK && !!TANK && Number(TANK.hp) >= 300,
  JSON.stringify([TINY?.name, WEAK?.name, TANK?.name, TANK?.hp]));

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【R】密勒頓｜打雷（自傷 30）× 取完獎賞 × 雙方有無備戰 —— 七格真值表');
// A：密勒頓（已受 aDmg）、備戰 aBench 隻；B：戰鬥場 WEAK（必被 90 打倒）、備戰 bBench 隻。
function runMira(aBench, bBench, aDmg, aPrizes, bPrizes = 3) {
  const P0 = { name: 'A', active: inst(MIRA.id, energiesFor(MIRA, MIRA_AI, 0), { damage: aDmg }),
    bench: Array.from({ length: aBench }, () => inst(WEAK.id)), hand: [], deck: [inst(WEAK.id), inst(WEAK.id)], discard: [],
    prizes: Array.from({ length: aPrizes }, () => inst(WEAK.id)) };
  const P1 = { name: 'B', active: inst(WEAK.id), bench: Array.from({ length: bBench }, () => inst(WEAK.id)), hand: [],
    deck: [inst(WEAK.id)], discard: [], prizes: Array.from({ length: bPrizes }, () => inst(WEAK.id)) };
  return attack(baseState(P0, P1), MIRA_AI);
}
const isDraw = (s) => s.phase === 'game-over' && s.isDraw === true && !Object.prototype.hasOwnProperty.call(s, 'winner');
const won = (s, w) => s.phase === 'game-over' && s.winner === w && !s.isDraw;
const tag = (s) => JSON.stringify({ ph: s.phase, w: s.winner, d: !!s.isDraw, aAct: s.players[0].active ? s.players[0].active.damage : null,
  aBench: s.players[0].bench.length, aPz: s.players[0].prizes.length, bPz: s.players[1].prizes.length, why: s.winReason });
const noZombie = (s) => s.players.every((p) => [p.active, ...p.bench].filter(Boolean).every((x) => {
  const hp = Number(pool.get(String(x.cardId))?.hp || 0); return !(hp > 0 && x.damage >= hp); }));
const noTempFlags = (s) => s._v6361NeedsVerdict === undefined && s._v6361LiftedWinner === undefined && s._v6361LiftedReason === undefined;

T('R1 ⭐⭐⭐【HEAD-FAIL】A 取完＋A 自傷昏厥＋A 無備戰＋B 無備戰 ⇒ 平手（雙方皆不可放置）', () => {
  const s = runMira(0, 0, 90, 1); return { ok: isDraw(s) && s.players[0].active === null && noZombie(s) && noTempFlags(s), d: tag(s) }; });
T('R2 ⭐⭐【HEAD-FAIL】A 取完＋A 自傷昏厥＋A 有備戰＋B 無備戰 ⇒ A 勝（且密勒頓確實昏厥、沒有 zombie）', () => {
  const s = runMira(1, 0, 90, 1); return { ok: won(s, 0) && noZombie(s) && noTempFlags(s)
    && !(s.players[0].active && String(s.players[0].active.cardId) === String(MIRA.id)), d: tag(s) }; });
T('R3 ⭐⭐【HEAD-FAIL】A 取完＋A 不昏厥＋B 無備戰 ⇒ A 勝，且自傷 30 **有套上**（0 → 30）', () => {
  const s = runMira(0, 0, 0, 1); return { ok: won(s, 0) && s.players[0].active?.damage === 30, d: tag(s) }; });
T('R4 ⭐A 沒取完＋A 自傷昏厥＋A 無備戰＋B 有備戰 ⇒ B 勝（零回歸）', () => {
  const s = runMira(0, 1, 90, 2); return { ok: won(s, 1) && noZombie(s) && noTempFlags(s), d: tag(s) }; });
T('R5 ⭐⭐⭐【HEAD-FAIL】A 取完＋A 自傷昏厥＋A 無備戰＋B 有備戰 ⇒ 平手（站長裁定：各自滿足一個勝利條件）', () => {
  const s = runMira(0, 1, 90, 1); return { ok: isDraw(s) && noZombie(s) && noTempFlags(s), d: tag(s) }; });
T('R6 ⭐⭐【HEAD-FAIL】A 取完＋A 自傷昏厥＋A 有備戰＋B 有備戰 ⇒ A 勝', () => {
  const s = runMira(1, 1, 90, 1); return { ok: won(s, 0) && noZombie(s) && noTempFlags(s), d: tag(s) }; });
T('R7 ⭐⭐【HEAD-FAIL】A 沒取完＋B 全滅 ⇒ A 勝，且自傷 30 **有套上**（防守方全滅不再跳過 postFn）', () => {
  const s = runMira(0, 0, 0, 2); return { ok: won(s, 0) && s.players[0].active?.damage === 30, d: tag(s) }; });
T('R8 ⭐⭐【HEAD-FAIL】反安慰劑：R1 與 R3 只差「已受 90」⇒ 結果必須不同（證明 aDmg 真的被讀到）', () => {
  const a = runMira(0, 0, 90, 1), b = runMira(0, 0, 0, 1);
  return { ok: isDraw(a) && won(b, 0), d: tag(a) + ' vs ' + tag(b) }; });

T('R9 ⭐⭐【HEAD-FAIL】備戰的 zombie 也算：焚焰蚣｜燃燒熱浪 取完最後 1 張＋自己的備戰被自傷打倒 ⇒ 終局盤面沒有 zombie、B 取得 1 張', () => {
  const C = findByName('焚焰蚣', '燃燒熱浪'); if (!C) return { ok: false, d: '找不到卡' };
  const ai = C.attacks.findIndex((a) => a.name === '燃燒熱浪');
  const P0 = { name: 'A', active: inst(C.id, energiesFor(C, ai, 0)), bench: [inst(TINY.id, [], { damage: 20 })], hand: [], deck: [inst(WEAK.id), inst(WEAK.id)], discard: [], prizes: [inst(WEAK.id)] };
  const P1 = { name: 'B', active: inst(WEAK.id), bench: [], hand: [], deck: [inst(WEAK.id)], discard: [], prizes: [inst(WEAK.id), inst(WEAK.id), inst(WEAK.id)] };
  const s = attack(baseState(P0, P1), ai);
  const bPending = s.pendingSelection?.effectKey === 'take-prize-choose' ? 1 : 0;
  return { ok: won(s, 0) && noZombie(s) && noTempFlags(s) && s.players[0].bench.length === 0
    && (3 - s.players[1].prizes.length) + bPending === 1 && !s.pendingSelection, d: tag(s) + ' pending=' + (s.pendingSelection?.effectKey ?? '-') };
});

// ── 正面朝上的最後一張獎賞（克雷色利亞｜弦月光芒、火箭隊的妨礙機器人 會造成）──
//   ⭐ fable 審查抓到：picker 擋住延後與 sweep、v6419 結清後沒人再掃 zombie ⇒ 判 A 勝（應平手）。
function runMiraFace(aBench, bBench, aFace, bFace) {
  const P0 = { name: 'A', active: inst(MIRA.id, energiesFor(MIRA, MIRA_AI, 0), { damage: 90 }),
    bench: Array.from({ length: aBench }, () => inst(WEAK.id)), hand: [], deck: [inst(WEAK.id), inst(WEAK.id)], discard: [],
    prizes: [inst(WEAK.id, [], aFace ? { faceUp: true } : {})] };
  const P1 = { name: 'B', active: inst(WEAK.id), bench: Array.from({ length: bBench }, () => inst(WEAK.id)), hand: [],
    deck: [inst(WEAK.id)], discard: [], prizes: Array.from({ length: 3 }, () => inst(WEAK.id, [], bFace ? { faceUp: true } : {})) };
  let st = attack(baseState(P0, P1), MIRA_AI);
  for (let g = 0; g < 5 && st.pendingSelection && st.phase !== 'game-over'; g++) {
    const ps = st.pendingSelection; const opt = ps.params?.options?.[0]?.id;
    const cand = ps.effectKey === 'take-prize-choose' ? st.players[ps.actorIdx].prizes.slice(0, 1).map((c) => c.iid) : (opt ? [opt] : []);
    const o = M.applyAction(st, { type: 'RESOLVE_SELECTION', playerIndex: ps.actorIdx, selectedIids: cand, selectedOptionId: opt }, pool);
    st = o?.state ?? o;
  }
  return st;
}
T('R10 ⭐⭐⭐【HEAD-FAIL】R1 ＋ A 的最後一張獎賞正面朝上 ⇒ 仍然平手，終局沒有 zombie、沒有殘留 picker', () => {
  const s = runMiraFace(0, 0, true, false); return { ok: isDraw(s) && noZombie(s) && noTempFlags(s) && !s.pendingSelection, d: tag(s) }; });
T('R11 ⭐⭐R2 ＋ A 正面朝上（A 有備戰）⇒ A 勝，密勒頓確實昏厥（沒有 zombie）', () => {
  const s = runMiraFace(1, 0, true, false); return { ok: won(s, 0) && noZombie(s) && noTempFlags(s) && !s.pendingSelection, d: tag(s) }; });
T('R12 ⭐⭐R5 ＋ A 正面朝上（B 有備戰，picker 走完）⇒ 平手', () => {
  const s = runMiraFace(0, 1, true, false); return { ok: isDraw(s) && noZombie(s) && noTempFlags(s) && !s.pendingSelection, d: tag(s) }; });

// ── 「自己離場（不是昏厥）」＋取完獎賞＋沒有備戰：v6.420 裁定原文同樣涵蓋 ──
T('R13 ⭐⭐⭐【HEAD-FAIL】喵喵ex｜夾尾巴逃跑（卡面：將這隻寶可夢與附加的卡，全部放回手牌。）取完最後一張、A 無備戰、B 有備戰 ⇒ 平手', () => {
  const C = findByName('喵喵ex', '夾尾巴逃跑'); if (!C) return { ok: false, d: '找不到卡' };
  const ai = C.attacks.findIndex((a) => a.name === '夾尾巴逃跑');
  if (!/放回手牌/.test(C.attacks[ai].effect || '')) return { ok: false, d: '卡面不符：' + C.attacks[ai].effect };
  const P0 = { name: 'A', active: inst(C.id, energiesFor(C, ai, 0)), bench: [], hand: [], deck: [inst(WEAK.id), inst(WEAK.id)], discard: [], prizes: [inst(WEAK.id)] };
  const P1 = { name: 'B', active: inst(WEAK.id), bench: [inst(TANK.id)], hand: [], deck: [inst(WEAK.id)], discard: [], prizes: [inst(WEAK.id), inst(WEAK.id), inst(WEAK.id)] };
  const s = attack(baseState(P0, P1), ai);
  return { ok: isDraw(s) && s.players[0].active === null && noTempFlags(s), d: tag(s) };
});
T('R14 ⭐⭐R13 的對照：A 還有備戰 ⇒ A 勝（只轉平手、不誤殺正常勝局）', () => {
  const C = findByName('喵喵ex', '夾尾巴逃跑'); if (!C) return { ok: false, d: '找不到卡' };
  const ai = C.attacks.findIndex((a) => a.name === '夾尾巴逃跑');
  const P0 = { name: 'A', active: inst(C.id, energiesFor(C, ai, 0)), bench: [inst(WEAK.id)], hand: [], deck: [inst(WEAK.id), inst(WEAK.id)], discard: [], prizes: [inst(WEAK.id)] };
  const P1 = { name: 'B', active: inst(WEAK.id), bench: [inst(TANK.id)], hand: [], deck: [inst(WEAK.id)], discard: [], prizes: [inst(WEAK.id), inst(WEAK.id), inst(WEAK.id)] };
  const s = attack(baseState(P0, P1), ai);
  return { ok: won(s, 0) && noTempFlags(s), d: tag(s) };
});

// ── 備戰的 zombie（hasUnresolvedKnockout 的備戰分支必須有行為端覆蓋）──
T('R15 ⭐⭐【HEAD-FAIL】掘地兔｜地震 取完最後 1 張＋自己的備戰被 30 打倒（B 有備戰）⇒ 終局沒有備戰 zombie', () => {
  const C = findByName('掘地兔', '地震'); if (!C) return { ok: false, d: '找不到卡' };
  const ai = C.attacks.findIndex((a) => a.name === '地震');
  const P0 = { name: 'A', active: inst(C.id, energiesFor(C, ai)), bench: [inst(TINY.id, [], { damage: 20 }), inst(TINY.id, [], { damage: 20 })], hand: [], deck: [inst(TINY.id), inst(TINY.id)], discard: [], prizes: [inst(TINY.id)] };
  const P1 = { name: 'B', active: inst(WEAK.id), bench: [inst(TANK.id)], hand: [], deck: [inst(TINY.id), inst(TINY.id)], discard: [], prizes: [inst(TINY.id), inst(TINY.id), inst(TINY.id)] };
  const s = attack(baseState(P0, P1), ai);
  return { ok: s.phase === 'game-over' && won(s, 0) && noZombie(s) && s.players[0].bench.length === 0 && noTempFlags(s), d: tag(s) };
});

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【U】未知圖騰｜神秘信號「多獲得1張」在防守方全滅時也要照發');
{
  const U = findByName('未知圖騰', '神秘信號');
  T('U1 ⭐⭐【HEAD-FAIL】B 只剩戰鬥場一隻被打倒 ⇒ A 取 1＋多取 1 ＝ 共 2 張（3 → 1）', () => {
    if (!U) return { ok: false, d: '找不到未知圖騰｜神秘信號' };
    const ai = U.attacks.findIndex((a) => a.name === '神秘信號');
    const P0 = { name: 'A', active: inst(U.id, energiesFor(U, ai, 0)), bench: [inst(WEAK.id)], hand: [], deck: [inst(WEAK.id), inst(WEAK.id)], discard: [], prizes: [inst(WEAK.id), inst(WEAK.id), inst(WEAK.id)] };
    const P1 = { name: 'B', active: inst(WEAK.id), bench: [], hand: [], deck: [inst(WEAK.id)], discard: [], prizes: [inst(WEAK.id), inst(WEAK.id), inst(WEAK.id)] };
    const s = attack(baseState(P0, P1), ai);
    return { ok: won(s, 0) && s.players[0].prizes.length === 1, d: tag(s) };
  });
  T('U2 ⭐對照：B 還有備戰時同一招本來就會多取 1（3 → 1），確認 U1 的期望值不是憑空想像', () => {
    if (!U) return { ok: false, d: '找不到卡' };
    const ai = U.attacks.findIndex((a) => a.name === '神秘信號');
    const P0 = { name: 'A', active: inst(U.id, energiesFor(U, ai, 0)), bench: [inst(WEAK.id)], hand: [], deck: [inst(WEAK.id), inst(WEAK.id)], discard: [], prizes: [inst(WEAK.id), inst(WEAK.id), inst(WEAK.id)] };
    const P1 = { name: 'B', active: inst(WEAK.id), bench: [inst(TANK.id)], hand: [], deck: [inst(WEAK.id)], discard: [], prizes: [inst(WEAK.id), inst(WEAK.id), inst(WEAK.id)] };
    let s = attack(baseState(P0, P1), ai);
    return { ok: s.players[0].prizes.length === 1, d: tag(s) };
  });
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【S】打到自己備戰的招式：昏厥的是 A 的寶可夢 ⇒ 由 B 取獎賞，A 一張都不能拿');
// A：攻擊者＋兩隻 TINY（hp30、已受 20）備戰；B：TANK ×3（不會倒）。雙方各 6 張獎賞。
function runSelfBench(card, ai, seedKey) {
  Math.random = mulberry32(hashStr(seedKey));
  const pz = () => Array.from({ length: 6 }, () => inst(TINY.id));
  const P0 = { name: 'A', active: inst(card.id, energiesFor(card, ai)), bench: [inst(TINY.id, [], { damage: 20 }), inst(TINY.id, [], { damage: 20 })],
    hand: [], deck: [inst(TINY.id), inst(TINY.id)], discard: [], prizes: pz() };
  const P1 = { name: 'B', active: inst(TANK.id), bench: [inst(TANK.id), inst(TANK.id)], hand: [], deck: [inst(TINY.id), inst(TINY.id)], discard: [], prizes: pz() };
  return attack(baseState(P0, P1), ai);
}
const origRandom = Math.random;
for (const [nm, atk] of [['固拉多', '大地裂破'], ['穿山王', '地震'], ['焚焰蚣', '燃燒熱浪'], ['電飛鼠', '天空波']]) {
  T(`S ⭐⭐⭐【HEAD-FAIL】${nm}｜${atk}：A 自己的備戰昏厥 ⇒ A 的獎賞一張不少、B 取得對應張數`, () => {
    const c = findByName(nm, atk); if (!c) return { ok: false, d: '找不到卡' };
    const ai = c.attacks.findIndex((a) => a.name === atk);
    const s = runSelfBench(c, ai, nm + '|' + atk);
    const aLost = 2 - s.players[0].bench.length;
    const bTook = 6 - s.players[1].prizes.length;
    const bPending = s.pendingSelection?.effectKey === 'take-prize-choose' ? (s.pendingSelection.params?.remaining ?? s.pendingSelection.maxCount ?? 0) : 0;
    return { ok: aLost >= 1 && s.players[0].prizes.length === 6 && (bTook + bPending) === aLost,
      d: JSON.stringify({ aLost, aPz: s.players[0].prizes.length, bTook, bPending }) + '\n' + logText(s).split('\n').slice(-4).join(' / ') };
  });
}
T('S5 ⭐⭐⭐【HEAD-FAIL】麒麟奇｜雙向頭擊（卡面：自己的1隻備戰寶可夢也受到10點傷害。）選自己的備戰打倒 ⇒ 由 B 取獎賞（bench-hit 那一處）', () => {
  const c = findByName('麒麟奇', '雙向頭擊'); if (!c) return { ok: false, d: '找不到卡' };
  const ai = c.attacks.findIndex((a) => a.name === '雙向頭擊');
  Math.random = mulberry32(3);
  const pz = () => Array.from({ length: 6 }, () => inst(TINY.id));
  const P0 = { name: 'A', active: inst(c.id, energiesFor(c, ai)), bench: [inst(TINY.id, [], { damage: 20 }), inst(TINY.id, [], { damage: 20 })], hand: [], deck: [inst(TINY.id)], discard: [], prizes: pz() };
  const P1 = { name: 'B', active: inst(TANK.id), bench: [inst(TANK.id)], hand: [], deck: [inst(TINY.id)], discard: [], prizes: pz() };
  let st = attack(baseState(P0, P1), ai);
  const ps = st.pendingSelection;
  if (!ps) return { ok: false, d: '沒有開出選備戰的 picker（前置不成立）' };
  const o = M.applyAction(st, { type: 'RESOLVE_SELECTION', playerIndex: ps.actorIdx, selectedIids: [st.players[0].bench[0].iid] }, pool);
  st = o?.state ?? o;
  const bPending = st.pendingSelection?.effectKey === 'take-prize-choose' ? 1 : 0;
  return { ok: st.players[0].bench.length === 1 && st.players[0].prizes.length === 6 && (6 - st.players[1].prizes.length) + bPending === 1,
    d: JSON.stringify({ aBench: st.players[0].bench.length, aPz: st.players[0].prizes.length, bPz: st.players[1].prizes.length }) };
});
Math.random = origRandom;

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【Z】全卡掃描（語義，不是字面）：所有 ATTACK_POST 招式');
{
  const byName = new Map();
  for (const c of hij) if (c.supertype === 'Pokemon') { if (!byName.has(c.name)) byName.set(c.name, []); byName.get(c.name).push(c); }
  const keys = [...M.ATTACK_POST.keys()];
  let triedZ = 0, triedS = 0; const thrown = [], badOwner = [], zombie = [];
  for (const key of keys) {
    const [cn, an] = key.split('|');
    const cand = (byName.get(cn) || []).find((c) => (c.attacks || []).some((a) => a.name === an));
    if (!cand) continue;
    const ai = cand.attacks.findIndex((a) => a.name === an);
    // Z-a：防守方只剩一隻極弱的 ⇒ 一定走「防守方全滅 → lift → postFn 照跑」的新路徑
    Math.random = mulberry32(hashStr(key));
    triedZ++;
    try {
      const P0 = { name: 'A', active: inst(cand.id, energiesFor(cand, ai)), bench: [inst(WEAK.id)], hand: [inst(WEAK.id)], deck: [inst(WEAK.id), inst(WEAK.id), inst(WEAK.id)], discard: [inst(WEAK.id)], prizes: [inst(WEAK.id), inst(WEAK.id), inst(WEAK.id)] };
      const P1 = { name: 'B', active: inst(WEAK.id), bench: [], hand: [inst(WEAK.id)], deck: [inst(WEAK.id), inst(WEAK.id), inst(WEAK.id)], discard: [inst(WEAK.id)], prizes: [inst(WEAK.id), inst(WEAK.id), inst(WEAK.id)] };
      const s = attack(baseState(P0, P1), ai);
      if (!s || !s.players) throw new Error('回傳不是盤面');
      if (s.phase === 'game-over' && !noZombie(s)) zombie.push(key);
      if (!noTempFlags(s)) zombie.push(key + '（暫存旗標外洩）');
    } catch (e) { thrown.push(key + ' :: ' + String(e && e.message).split('\n')[0].slice(0, 100)); }
    // Z-b：B 全是坦克（不會倒）⇒ A 若取了獎賞，一定是替「自己的」昏厥取的
    Math.random = mulberry32(hashStr('S' + key));
    triedS++;
    try {
      const pz = () => Array.from({ length: 6 }, () => inst(TINY.id));
      const P0 = { name: 'A', active: inst(cand.id, energiesFor(cand, ai)), bench: [inst(TINY.id, [], { damage: 20 }), inst(TINY.id, [], { damage: 20 })], hand: [], deck: [inst(TINY.id), inst(TINY.id)], discard: [], prizes: pz() };
      const P1 = { name: 'B', active: inst(TANK.id), bench: [inst(TANK.id), inst(TANK.id)], hand: [], deck: [inst(TINY.id), inst(TINY.id)], discard: [], prizes: pz() };
      const s = attack(baseState(P0, P1), ai);
      const aTook = 6 - s.players[0].prizes.length;
      const bLost = 2 - s.players[1].bench.length + (s.players[1].active ? 0 : 1);
      if (aTook > 0 && bLost === 0) badOwner.push(key + ` :: A 取了 ${aTook} 張，但 B 一隻都沒倒`);
    } catch { /* Z-a 已涵蓋例外 */ }
  }
  // Z-c／Z-d：全部 H/I/J 招式（不只 ATTACK_POST），A 只剩 1 張獎賞
  //   Z-c：A 備戰兩隻 TINY（已受 20）⇒ 終局盤面不得留有 zombie（含備戰）
  //   Z-d：A 沒有備戰、B 有坦克備戰 ⇒ 終局若 A 取完且 A 沒有寶可夢 ⇒ 必須平手（v6.420／v6.421 裁定）
  //   ⚠ 前提（fable 審查提醒）：A 滿血、B 還剩 3 張獎賞 ⇒ B 不可能因 A 的昏厥同時取完。
  //     若日後改成 A 預傷或 B 獎賞 ≤ 2，會出現「雙方同時取完、只有 B 可放置 ⇒ B 勝」
  //     （超級炎武王ex｜深紅炸彈，官方 L622-624）⇒ 屆時 Z8 的「一律平手」必須改成與中央判定一致。
  const seen = new Set(); let triedAll = 0; const zombieAll = [], notDraw = [], thrownAll = [];
  for (const c of hij) {
    if (c.supertype !== 'Pokemon') continue;
    for (let ai = 0; ai < (c.attacks || []).length; ai++) {
      const key = c.name + '|' + c.attacks[ai].name; if (seen.has(key)) continue; seen.add(key); triedAll++;
      try {
        Math.random = mulberry32(hashStr('C' + key));
        const P0 = { name: 'A', active: inst(c.id, energiesFor(c, ai)), bench: [inst(TINY.id, [], { damage: 20 }), inst(TINY.id, [], { damage: 20 })], hand: [], deck: [inst(TINY.id), inst(TINY.id)], discard: [], prizes: [inst(TINY.id)] };
        const P1 = { name: 'B', active: inst(WEAK.id), bench: [inst(TANK.id), inst(TINY.id, [], { damage: 20 })], hand: [], deck: [inst(TINY.id), inst(TINY.id)], discard: [], prizes: [inst(TINY.id), inst(TINY.id), inst(TINY.id)] };
        const s = attack(baseState(P0, P1), ai);
        if (s.phase === 'game-over' && !noZombie(s)) zombieAll.push(key);
      } catch (e) { thrownAll.push(key + ' :: ' + String(e && e.message).slice(0, 80)); }
      try {
        Math.random = mulberry32(hashStr('D' + key));
        const P0 = { name: 'A', active: inst(c.id, energiesFor(c, ai)), bench: [], hand: [], deck: [inst(TINY.id), inst(TINY.id)], discard: [], prizes: [inst(TINY.id)] };
        const P1 = { name: 'B', active: inst(WEAK.id), bench: [inst(TANK.id)], hand: [], deck: [inst(TINY.id), inst(TINY.id)], discard: [], prizes: [inst(TINY.id), inst(TINY.id), inst(TINY.id)] };
        const s = attack(baseState(P0, P1), ai);
        const aOutNoMon = s.players[0].prizes.length === 0 && s.players[0].active === null && s.players[0].bench.length === 0;
        if (s.phase === 'game-over' && aOutNoMon && !isDraw(s)) notDraw.push(key + ' ' + tag(s));
      } catch (e) { thrownAll.push(key + ' :: ' + String(e && e.message).slice(0, 80)); }
    }
  }
  Math.random = origRandom;
  // ⚠ 月亮伊布ex｜縞瑪瑙：卡面本身就是「獲得1張獎賞卡」（不是 KO 獎賞）⇒ 已人工核對卡面，排除。
  const ALLOW_OWNER = new Set(['月亮伊布ex|縞瑪瑙']);
  const badOwnerReal = badOwner.filter((x) => !ALLOW_OWNER.has(x.split(' :: ')[0]));
  chk('Z0 ⭐掃描器下限：真的掃到大量招式（防掃描器壞掉的空真）', triedZ > 800 && triedS > 800, JSON.stringify([triedZ, triedS, keys.length]));
  chk('Z1 ⭐⭐⭐防守方全滅時 postFn 照跑：全卡 0 個丟例外', thrown.length === 0, thrown.slice(0, 8).join('\n'));
  chk('Z2 ⭐⭐⭐【HEAD-FAIL】終局盤面不得留有 zombie（傷害 ≥ HP 仍在場）或暫存旗標', zombie.length === 0, zombie.slice(0, 8).join('\n'));
  chk('Z3 ⭐⭐⭐【HEAD-FAIL】全卡：攻擊方不得替自己的昏厥取獎賞', badOwnerReal.length === 0, badOwnerReal.slice(0, 8).join('\n'));
  chk('Z5 ⭐掃描器下限：全部 H/I/J 招式真的掃到', triedAll > 2000, String(triedAll));
  chk('Z6 ⭐⭐⭐全招式：A 只剩 1 張獎賞的兩種盤面 0 個丟例外', thrownAll.length === 0, thrownAll.slice(0, 8).join('\n'));
  chk('Z7 ⭐⭐⭐【HEAD-FAIL】全招式：終局盤面沒有 zombie（含備戰；hasUnresolvedKnockout 的備戰分支在這裡有行為端覆蓋）', zombieAll.length === 0, zombieAll.slice(0, 8).join('\n'));
  chk('Z8 ⭐⭐⭐【HEAD-FAIL】全招式：取完最後一張但自己沒有寶可夢 ⇒ 一律平手（自傷昏厥／自己離場都算）', notDraw.length === 0, notDraw.slice(0, 8).join('\n'));
  // 白名單的「為什麼安全」行為端證明：卡面逐字確實是自己獲得獎賞卡
  const moon = hij.find((c) => c.name === '月亮伊布ex' && (c.attacks || []).some((a) => a.name === '縞瑪瑙'));
  chk('Z4 ⭐白名單證明：月亮伊布ex｜縞瑪瑙 卡面確實寫「獲得…獎賞卡」（不是 KO 獎賞）',
    !!moon && /獎賞卡/.test(moon.attacks.find((a) => a.name === '縞瑪瑙').effect || ''), moon ? moon.attacks.find((a) => a.name === '縞瑪瑙').effect : '找不到');
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【K】結構／中央性（Rule 38：判準只有一份）');
{
  const ENG = normEol(readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8'));
  const EFF = normEol(readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8'));
  const ENGc = stripCommentsBlankChecked(ENG), EFFc = stripCommentsBlankChecked(EFF);
  const cnt = (s, re) => (s.match(re) || []).length;
  chk('K1 ⭐⭐zombie 判準 isZombieKO 恰好定義一次', cnt(ENGc, /function isZombieKO\(/g) === 1, String(cnt(ENGc, /function isZombieKO\(/g)));
  const i0 = ENGc.indexOf('function sanityKOSweep(');
  const i1 = i0 >= 0 ? ENGc.indexOf('\nfunction ', i0 + 10) : -1;
  const i1b = i0 >= 0 ? ENGc.indexOf('\nexport function ', i0 + 10) : -1;
  const end = [i1, i1b].filter((x) => x > 0).sort((a, b) => a - b)[0] ?? -1;
  const sweep = i0 >= 0 && end > i0 ? ENGc.slice(i0, end) : '';
  chk('K2 ⭐⭐sanityKOSweep 抓得到且範圍合理（anchor 自檢）', sweep.length > 1500 && sweep.length < 20000 && sweep.includes('anyKO = true'), String(sweep.length));
  chk('K3 ⭐⭐⭐【HEAD-FAIL】sanityKOSweep 戰鬥場／備戰兩處都走 isZombieKO，沒有就地再寫一份 `damage >= hp`',
    cnt(sweep, /isZombieKO\(inst, pool, s\)/g) === 2 && !/\.damage\s*>=\s*hp\b/.test(sweep),
    JSON.stringify([cnt(sweep, /isZombieKO\(inst, pool, s\)/g), /\.damage\s*>=\s*hp\b/.test(sweep)]));
  const h0 = ENGc.indexOf('function hasUnresolvedKnockout(');
  const hBody = h0 >= 0 ? ENGc.slice(h0, ENGc.indexOf('\n}', h0) + 2) : '';
  chk('K4 ⭐⭐【HEAD-FAIL】hasUnresolvedKnockout 只呼叫 isZombieKO（不自己比 HP）',
    hBody.length > 0 && cnt(hBody, /isZombieKO\(/g) === 2 && !/damage\s*>=/.test(hBody), hBody.slice(0, 200));
  // v6.421 審查後：兩個呼叫點 ＝ 終局延後條件 ＋ picker 下的 zombie 掃除（各恰好一次）
  const deferBlk = (ENG.match(/\/\/ >>> v6421-defer-endgame-zombie\n[\s\S]*?\/\/ <<< v6421-defer-endgame-zombie/) || [''])[0];
  const settleBlk = (ENG.match(/\/\/ >>> v6421-sweep-zombie-under-picker\n[\s\S]*?\/\/ <<< v6421-sweep-zombie-under-picker/) || [''])[0];
  chk('K5 ⭐⭐【HEAD-FAIL】hasUnresolvedKnockout(next, pool) 恰好兩個呼叫點：延後條件＋picker 下的 zombie 掃除',
    cnt(ENGc, /hasUnresolvedKnockout\(next, pool\)/g) === 2
    && deferBlk.includes('hasUnresolvedKnockout(next, pool)') && settleBlk.includes('hasUnresolvedKnockout(next, pool)'),
    String(cnt(ENGc, /hasUnresolvedKnockout\(next, pool\)/g)));
  chk('K5b ⭐⭐【HEAD-FAIL】「中央會判平手」的延後判準直接呼叫 judgeEndgameV6361（Rule 38：不另寫 noMon）',
    deferBlk.includes('centralVerdictIsDrawV6421(next)')
    && /function centralVerdictIsDrawV6421\([^)]*\)[^{]*\{[^}]*judgeEndgameV6361\(s, true\)/.test(ENGc)
    && cnt(ENGc, /function centralVerdictIsDrawV6421\(/g) === 1);
  chk('K6 ⭐⭐【HEAD-FAIL】防守方全滅不再直接 return（`if (_koEnd) return _koEnd;` 已不存在）',
    !ENGc.includes('if (_koEnd) return _koEnd;') && ENGc.includes('if (_koEnd) newState = liftEndgameForOnKoV6361(_koEnd);'));
  chk('K7 ⭐⭐獎賞歸屬 koPrizeTaker 恰好定義一次，且公式是「KO 方的對手」',
    cnt(EFFc, /function koPrizeTaker\(/g) === 1 && EFFc.includes('return (1 - koOwnerIdx) as 0 | 1;'));
  chk('K8 ⭐⭐【HEAD-FAIL】hitBenchAll／bench-hit 兩處的 KO 獎賞都走 koPrizeTaker(targetIdx)',
    cnt(EFFc, /addPendingPrize\(s, koPrizeTaker\(targetIdx\), morePrizes, pool\)/g) === 2,
    String(cnt(EFFc, /addPendingPrize\(s, koPrizeTaker\(targetIdx\), morePrizes, pool\)/g)));
  chk('K9 ⭐engine.ts 的 v6421 哨兵成對（4 組區塊）', cnt(ENG, />>> v6421-/g) === 4 && cnt(ENG, /<<< v6421-/g) === 4,
    JSON.stringify([cnt(ENG, />>> v6421-/g), cnt(ENG, /<<< v6421-/g)]));
  // 反安慰劑：K3 的判準要真的抓得到「就地寫一份」的樣本
  const mutant = sweep.replace('isZombieKO(inst, pool, s)', 'hp > 0 && inst.damage >= hp');
  chk('K10 ⭐反安慰劑：把其中一處換回就地判準 ⇒ K3 的判準必須判為違規',
    mutant !== sweep && (cnt(mutant, /isZombieKO\(inst, pool, s\)/g) !== 2 || /\.damage\s*>=\s*hp\b/.test(mutant)));
}

console.log(`\nv6.421 守衛：PASS ${pass} / FAIL ${fail}` + (fail ? '（紅：' + failed.join('、') + '）' : ''));
if (fail) process.exit(1);
