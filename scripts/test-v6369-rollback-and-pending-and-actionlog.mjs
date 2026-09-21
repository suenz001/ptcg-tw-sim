#!/usr/bin/env node
/**
 * v6.369 守衛：站長裁定 六-5／六-12／六-13（三個 stale／時序缺口）
 *
 * (甲) 六-5「要修」：markHealsByDamageDecrease 的 diff 基準要是「**回血發生的前一刻**」，
 *      不是「這個 action 開始時」。同一個 END_TURN 裡「中毒 +10 → 被【生命制約】擋下的
 *      好眠恢復」，BASE 回捲到 100（中毒那 10 點被一起捲掉），正解是 110。
 * (乙) 六-12「依你的建議就好」：v6.361 刻意留下的 fail-safe 缺口 ——
 *      終局已判出 ＋ on-KO 佇列（耿鬼ex｜死亡宣告）未結算 ＋ 同時開著取獎 picker
 *      ⇒ BASE 整支死亡宣告不結算、佇列還殘留在回傳盤面上。
 * (丙) 六-13「依你的建議就好」：被引擎退回的**非法打出**不可以記進 currentTurnActions。
 *      BASE 兩條競技場非法路徑不一致（額度那條不記、同名覆蓋那條記）。
 *
 * ⭐ 全部**行為端**：真的建盤面 → 跑 END_TURN／ATTACK／PLAY_TRAINER → 看盤面數字、
 *   看 log、看流水帳內容。結構掃描只作為補充（Rule 28）。
 * ⚠ 每一條效果斷言都配哨兵／反對照：同盤面的對照組數字必須是「沒有這個修正時的值」。
 * ⚠ 禁止恆真斷言（#27）、禁止用 `||` 放寬（#26）。非恆真由 __m6a/mutcheck_v6369.mjs 證明。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// ⭐v6.419（Rule 40）：D5 的意圖是「(乙) v6.369 沒有動 v6.361 的架構」。v6.419 在
//   engine.ts 新增了第二個合法呼叫點（v6419-settle-queued-prizes，站長裁定）
//   ⇒ 先把本版的哨兵區塊剝掉再數，原判準（恰 1 個）一個字都沒有放寬。
import { stripV6419Engine } from './lib/engine-strip-v6419.mjs';
// ⭐v6.421（Rule 40）：v6.421 在延後條件合法加了一條 zombie 分支（由 test-v6421 守）⇒ D5／D7 先剝 v6.421 再比對。
import { stripV6421Engine } from './lib/engine-strip-v6421.mjs';
import { normEol as _normEol419 } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6369-s.js'), E = join(ROOT, '.v6369-e.ts'), O = join(ROOT, '.v6369-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { applyAction, markHealsByDamageDecrease } from './src/lib/game/engine';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, markHealsByDamageDecrease } = await import(pathToFileURL(O).href);

// ── 卡池 ─────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c); all.push(c);
  }
}
const byId = (id) => { const c = pool.get(String(id)); if (!c) throw new Error('fixture 找不到 id ' + id); return c; };
const byName = (n) => { const c = all.find((x) => x.name === n); if (!c) throw new Error('fixture 找不到 ' + n); return c; };
const findAb = (n, ab) => {
  const h = all.filter((c) => c.name === n && (c.abilities || []).some((a) => a.name === ab));
  if (!h.length) throw new Error(`fixture 找不到 ${n}｜${ab}`);
  return h.find((c) => String(c.setCode) === 'M6a') ?? h[0];
};

const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {};
for (const c of all) {
  if (c.supertype !== 'Energy') continue;
  for (const [k, z] of Object.entries(ZH)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = String(c.id);
}
EID.Colorless = EID.Water;

let nn = 0;
const inst = (cid, extra = {}) => ({
  iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [],
  abilityUsedThisTurn: false, evolvedThisTurn: false, playedFromHand: false,
  movedToActiveThisTurn: false, evolvedFromStack: [], ...extra,
});
const P = (o = {}) => ({
  name: 'P', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [],
  abilityNamesUsedThisTurn: [], currentTurnActions: [], turnActionsLog: [], ...o,
});
const mk = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
  coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
  activeStadium: null, activeStadiumOwnerIdx: 0,
  players: [P({ name: 'A', ...p0 }), P({ name: 'B', ...p1 })], ...extra,
});

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => {
  if (ok) { console.log('  PASS ' + name); pass++; } else { console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); fail++; }
  return !!ok;
};
/** heads=false ⇒ 每一次擲幣都反面 */
const act = (st, a, heads = true) => {
  const o = Math.random; Math.random = () => (heads ? 0.1 : 0.9);
  try { return applyAction(st, a, pool); }
  catch (e) { return { __err: e.message, log: [], players: st.players, phase: 'err' }; }
  finally { Math.random = o; }
};
const LOGS = (r) => (r?.log ?? []).map((x) => String(x?.message ?? ''));
const L = (r) => LOGS(r).join(' | ');
const nLog = (r, s) => LOGS(r).filter((x) => x.includes(s)).length;
const A0 = (r) => r?.players?.[0]?.active;
const D0 = (r) => r?.players?.[1]?.active;
const BN = (r, i) => r?.players?.[i]?.bench?.length;
const PZ = (r, i) => r?.players?.[i]?.prizes?.length;
const QLEN = (r) => (r?._onKoAfterPrize ?? []).length;
const HASWIN = (r) => Object.prototype.hasOwnProperty.call(r ?? {}, 'winner') && r.winner != null;
const JOURNAL = (s, i) => JSON.stringify((s.players[i].currentTurnActions ?? []).map((a) => a.type + ':' + a.cardId));
const atkIdx = (c, n) => (c.attacks || []).findIndex((a) => a.name === n);
const energyFor = (card, n) => ((card.attacks || []).find((a) => a.name === n)?.cost ?? []).map((t) => inst(EID[t] ?? EID.Water));

// ── fixtures ────────────────────────────────────────────────────────────────
const YVEL = findAb('伊裴爾塔爾', '生命制約');   // M6a 079/103（id 19991）
const SNOR = findAb('卡比獸', '好眠');           // M6a 095/103（id 20007，HP160）
const TRENCH = byName('傳說的海溝');             // 恢復的HP改為 2 倍（v6.077）
const GENG = byId('19988');                      // 耿鬼ex｜死亡宣告（M6a 076/103，HP280）
const ICE = byId('19924');                       // 急凍鳥｜冰雹 30
/** 乾淨對照靶：Basic／無特性／非太晶／非 ex／【無】屬性／HP≥120 */
const PLAIN = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length
  && !(c.tags || []).includes('太晶') && Number(c.hp) >= 120 && c.pokemonType === 'Colorless'
  && c.subtype !== 'ex' && !/ex$/i.test(c.name));
const deckN = (n) => Array.from({ length: n }, () => inst(PLAIN.id));
const SIDE = (o) => ({ deck: deckN(3), prizes: deckN(6), ...o });

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【0】fixture 自驗（Rule 25：抽不到卡／卡面對不上要大聲紅，不可以靜默全綠）');
// ══════════════════════════════════════════════════════════════════════════════
chk('0a ⭐伊裴爾塔爾（M6a 079/103，id 19991）｜生命制約 卡面逐字',
  String(YVEL.id) === '19991'
  && (YVEL.abilities || []).find((a) => a.name === '生命制約')?.effect
     === '只要這隻寶可夢在場上，對手的戰鬥寶可夢的HP無法恢復。',
  JSON.stringify([YVEL.id, (YVEL.abilities || [])[0]?.effect]));
chk('0b ⭐卡比獸｜好眠 卡面逐字 ＋ HP160（(甲) 的「同一個 action 內部恢復」就是它）',
  Number(SNOR.hp) === 160
  && (SNOR.abilities || []).find((a) => a.name === '好眠')?.effect
     === '這隻寶可夢【睡眠】時，若在寶可夢檢查中這隻寶可夢沒有從【睡眠】恢復，則將這隻寶可夢的HP全部恢復。',
  JSON.stringify([SNOR.hp, (SNOR.abilities || [])[0]?.effect]));
chk('0c ⭐耿鬼ex｜死亡宣告 卡面逐字 ＋ HP280（(乙) 的 on-KO 佇列就是它）',
  Number(GENG.hp) === 280
  && (GENG.abilities || []).find((a) => a.name === '死亡宣告')?.effect
     === '這隻寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，自己擲1次硬幣。若為正面，則將使用招式的寶可夢【昏厥】。',
  JSON.stringify([GENG.hp, (GENG.abilities || [])[0]?.effect]));
chk('0d 急凍鳥｜冰雹（非 ex，30 傷害）、傳說的海溝、乾淨對照靶都抓得到',
  ICE.subtype !== 'ex' && atkIdx(ICE, '冰雹') >= 0 && TRENCH.subtype === 'Stadium'
  && !!PLAIN && Number(PLAIN.hp) >= 120,
  JSON.stringify([ICE?.name, atkIdx(ICE, '冰雹'), PLAIN?.name, PLAIN?.hp]));

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【A】(甲) 六-5：回捲要回到「**回血發生的前一刻**」，不是「這個 action 開始時」');
// ══════════════════════════════════════════════════════════════════════════════
/** heads=false ⇒ 睡眠擲幣反面（沒醒來 ⇒ 好眠觸發）＋ 燒傷擲幣反面（灼傷持續） */
const endTurn = (st) => act(st, { type: 'END_TURN' }, false);
/** p0 的卡比獸睡著且受傷 dmg；p1 備戰放 p1Bench（YVEL ⇒ 生命制約生效） */
const runSleep = (p1Bench, dmg, extra = {}, stadium = null) => {
  const sn = inst(SNOR.id, { damage: dmg, status: 'asleep', ...extra });
  return endTurn(mk(
    SIDE({ active: sn, bench: [inst(PLAIN.id)] }),
    SIDE({ active: inst(PLAIN.id), bench: p1Bench.map((c) => inst(c.id)) }),
    stadium ? { activeStadium: inst(stadium.id), activeStadiumOwnerIdx: 0, stadiumUsedThisTurn: [false, false] } : {}));
};
{
  // A1 ⭐⭐⭐ 站長舉的那個盤面：damage 100 ＋ 中毒 ＋ 對手伊裴爾塔爾
  const a1 = runSleep([YVEL], 100, { secondaryStatus: 'poisoned' });
  chk('A1 ⭐⭐⭐中毒 +10 後被擋下的好眠 ⇒ damage 必須是 110（BASE：100，中毒那 10 點被一起捲掉）',
    A0(a1)?.damage === 110, String(A0(a1)?.damage));
  chk('A1b 哨兵：中毒真的結算了（log 有「中毒：…受到 10 傷害」）',
    nLog(a1, '中毒：') === 1 && L(a1).includes('受到 10 傷害'), L(a1).slice(0, 160));
  chk('A1c 哨兵：好眠真的觸發了、而且中央閘真的把它擋下（兩行 log 都要在）',
    nLog(a1, 'HP 全部恢復') === 1 && nLog(a1, '生命制約：') === 1, L(a1).slice(0, 300));
  chk('A1d ⭐被擋下時不標 healedThisTurn（否則對手一張被擋下的回血就滿足「本回合曾恢復過HP」）',
    A0(a1)?.healedThisTurn !== true, String(A0(a1)?.healedThisTurn));

  const a1c = runSleep([PLAIN], 100, { secondaryStatus: 'poisoned' });
  chk('A1e ⭐反對照：同盤面**沒有**伊裴爾塔爾 ⇒ 好眠照樣回滿（damage 0）、healedThisTurn 標起來',
    A0(a1c)?.damage === 0 && A0(a1c)?.healedThisTurn === true,
    JSON.stringify([A0(a1c)?.damage, A0(a1c)?.healedThisTurn]));

  // A2 灼傷版本
  const a2 = runSleep([YVEL], 100, { secondaryStatus: 'burned' });
  const a2c = runSleep([PLAIN], 100, { secondaryStatus: 'burned' });
  chk('A2 ⭐⭐灼傷 +20 後被擋下的好眠 ⇒ damage 必須是 120（BASE：100）',
    A0(a2)?.damage === 120, String(A0(a2)?.damage));
  chk('A2b 哨兵：灼傷真的結算了（20 傷害 ＋ 反面：燒傷持續）',
    L(a2).includes('燒傷：') && L(a2).includes('受到 20 傷害') && L(a2).includes('反面：燒傷持續'),
    L(a2).slice(0, 300));
  chk('A2c ⭐反對照：同盤面沒有伊裴爾塔爾 ⇒ 0',
    A0(a2c)?.damage === 0, String(A0(a2c)?.damage));

  // A3 中毒＋灼傷一起（兩格都要疊上去，不是只疊最後一格）
  const a3 = runSleep([YVEL], 100, { secondaryStatus: 'poisoned', tertiaryStatus: 'burned' });
  const a3c = runSleep([PLAIN], 100, { secondaryStatus: 'poisoned', tertiaryStatus: 'burned' });
  chk('A3 ⭐⭐中毒 +10 ＋ 灼傷 +20 後被擋下的好眠 ⇒ damage 必須是 130（不是 110、不是 120、不是 100）',
    A0(a3)?.damage === 130, String(A0(a3)?.damage));
  chk('A3b ⭐反對照：同盤面沒有伊裴爾塔爾 ⇒ 0',
    A0(a3c)?.damage === 0, String(A0(a3c)?.damage));

  // A4 沒有 checkup 傷害時，回捲值必須**完全不變**（＝這個修正不是無條件加數字）
  const a4 = runSleep([YVEL], 100);
  chk('A4 ⭐⭐反對照：同盤面**沒有**中毒／灼傷 ⇒ 回捲值仍然是 100（不可以憑空多 10）',
    A0(a4)?.damage === 100, String(A0(a4)?.damage));
  chk('A4b 哨兵：這一局好眠一樣有觸發、一樣被擋（證明 A4 的 100 不是「整條路徑沒跑」）',
    nLog(a4, 'HP 全部恢復') === 1 && nLog(a4, '生命制約：') === 1, L(a4).slice(0, 300));

  // A5 ⭐⭐⭐ 反安慰劑：中毒造成的 damage **上升**絕不可以被當成 heal
  const a5 = endTurn(mk(
    SIDE({ active: inst(PLAIN.id, { damage: 100, status: 'poisoned' }), bench: [inst(PLAIN.id)] }),
    SIDE({ active: inst(PLAIN.id), bench: [inst(YVEL.id)] })));
  chk('A5 ⭐⭐⭐只中毒、沒有任何恢復 ⇒ damage 110（不可以被回捲成 100）',
    A0(a5)?.damage === 110, String(A0(a5)?.damage));
  chk('A5b ⭐⭐⭐而且不可以被當成 heal：沒有「生命制約」log、也沒有標 healedThisTurn',
    nLog(a5, '生命制約：') === 0 && A0(a5)?.healedThisTurn !== true,
    JSON.stringify([nLog(a5, '生命制約：'), A0(a5)?.healedThisTurn]));

  // A6 海溝（恢復量 ×2）仍然排在禁止恢復**之後**（v6.354【M】的性質不可以被本版打壞）
  const a6 = runSleep([YVEL], 100, { secondaryStatus: 'poisoned' }, TRENCH);
  const a6c = runSleep([PLAIN], 100, { secondaryStatus: 'poisoned' }, TRENCH);
  chk('A6 ⭐海溝在場 ＋ 伊裴爾塔爾 ⇒ 一點都不恢復，停在 110（沒有恢復就沒有加倍）',
    A0(a6)?.damage === 110, String(A0(a6)?.damage));
  chk('A6b ⭐被擋下時不可以留下海溝的加倍 log',
    nLog(a6, '傳說的海溝：恢復的HP改為 2 倍') === 0, L(a6).slice(0, 300));
  chk('A6c 反對照：同盤面沒有伊裴爾塔爾 ⇒ 中毒 +10 後被好眠清光 ⇒ 0',
    A0(a6c)?.damage === 0, String(A0(a6c)?.damage));

  // A7 per-action 暫存基準線絕不可以殘留在回傳盤面（會被推上 Firestore／Mongo）
  const leaks = [a1, a1c, a2, a2c, a3, a3c, a4, a5, a6, a6c]
    .filter((r) => r._v6369CheckupDmgUp !== undefined
      || Object.prototype.hasOwnProperty.call(r, '_v6369CheckupDmgUp'));
  chk('A7 ⭐⭐暫存基準線 _v6369CheckupDmgUp 不可以留在任何一次回傳的盤面上',
    leaks.length === 0, String(leaks.length));

  // A8 跨 action 不殘留：中毒過的那一回合結束後，下一個 action 的真回血照樣算 heal
  const a8base = runSleep([PLAIN], 100, { secondaryStatus: 'poisoned' });
  chk('A8 ⭐跨 action 不汙染：上一個 action 的中毒量沒有被帶到下一個 action 當基準',
    a8base._v6369CheckupDmgUp === undefined
    && A0(act(a8base, { type: 'END_TURN' }, false))?.damage !== undefined,
    String(a8base._v6369CheckupDmgUp));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【B】(乙) 六-12：終局 ＋ on-KO 佇列 ＋ 取獎 picker 同時成立時，死亡宣告仍要結算');
// ══════════════════════════════════════════════════════════════════════════════
const prizeSet = (faceUp) => (faceUp
  ? [inst(PLAIN.id, { faceUp: true }), ...deckN(5)]
  : deckN(6));
/** 攻擊方＝急凍鳥（冰雹 30）；防守方戰鬥位＝耿鬼ex（差 30 就昏厥） */
const board = ({ b0 = 0, b1 = 0, faceUp = true, defPlain = false } = {}) => mk(
  { active: inst(ICE.id, { energyAttached: energyFor(ICE, '冰雹') }),
    bench: Array.from({ length: b0 }, () => inst(PLAIN.id)), prizes: prizeSet(faceUp), deck: deckN(3) },
  { active: defPlain ? inst(PLAIN.id, { damage: Number(PLAIN.hp) - 30 })
                     : inst(GENG.id, { damage: Number(GENG.hp) - 30 }),
    bench: Array.from({ length: b1 }, () => inst(PLAIN.id)), prizes: deckN(6), deck: deckN(3) });
const runAtk = (st, heads) => act(st, { type: 'ATTACK', attackIndex: atkIdx(ICE, '冰雹') }, heads);
{
  // B1 ⭐⭐⭐ 主情境：耿鬼ex 是 B 最後一隻 ＋ A 也只剩戰鬥位 ＋ A 的獎賞有正面朝上的卡
  const H = runAtk(board({ b0: 0, b1: 0, faceUp: true }));
  chk('B1 ⭐⭐⭐死亡宣告仍然結算（硬幣恰好擲 1 次；BASE：0 次，整支消失）',
    nLog(H, '「死亡宣告」啟動') === 1, LOGS(H).filter((x) => x.includes('死亡宣告')).join(' / '));
  chk('B1b ⭐⭐⭐攻擊方（急凍鳥）真的昏厥離場（BASE：完好留在場上）',
    A0(H) == null && H.players[0].discard.some((c) => String(c.cardId) === String(ICE.id)),
    JSON.stringify([!!A0(H), H.players[0].discard.map((c) => c.cardId)]));
  chk('B1c ⭐⭐⭐結算完才判勝負：雙方都沒有可上場的寶可夢 ⇒ 平手（BASE：winner=0）',
    H.phase === 'game-over' && !HASWIN(H) && !Object.prototype.hasOwnProperty.call(H, 'winner')
    && H.isDraw === true && String(H.winReason).includes('雙方'),
    JSON.stringify([H.phase, H.winner, H.isDraw, H.winReason]));
  chk('B1d ⭐⭐佇列必須被排乾淨（BASE：_onKoAfterPrize 還留 1 筆在回傳盤面上，永遠不會再觸發）',
    QLEN(H) === 0, String(QLEN(H)));
  chk('B1e ⭐⭐終局時那個永遠解不掉的 picker 要被清掉（不可以留一個按不動的視窗）',
    !H.pendingSelection, JSON.stringify(H.pendingSelection?.effectKey ?? null));
  chk('B1f ⭐三個 v6.361 暫存旗標不可以外洩到回傳盤面',
    H._v6361NeedsVerdict === undefined && H._v6361LiftedWinner === undefined
    && H._v6361LiftedReason === undefined, JSON.stringify([H._v6361NeedsVerdict, H._v6361LiftedWinner]));

  // B2 同盤面只差擲幣：反面 ⇒ 死亡宣告照樣「有結算」，只是目標不昏厥
  const T = runAtk(board({ b0: 0, b1: 0, faceUp: true }), false);
  chk('B2 ⭐反對照（反面）：死亡宣告一樣有結算（有反面 log），但攻擊方完好、A 獲勝、不是平手',
    nLog(T, '「死亡宣告」啟動') === 1 && L(T).includes('硬幣反面')
    && !!A0(T) && T.phase === 'game-over' && T.winner === 0 && T.isDraw === undefined,
    JSON.stringify([nLog(T, '「死亡宣告」啟動'), !!A0(T), T.phase, T.winner, T.isDraw]));

  // B3 ⭐ A 還有備戰時：死亡宣告照樣結算，但勝負仍是 A 贏（差別在盤面與獎賞）
  const R = runAtk(board({ b0: 1, b1: 0, faceUp: true }));
  chk('B3 ⭐⭐A 還有備戰：死亡宣告照樣結算、攻擊方昏厥、B 那側取到 1 張獎賞（BASE：0 次／不昏厥／6 張）',
    nLog(R, '「死亡宣告」啟動') === 1 && A0(R) == null && PZ(R, 1) === 5
    && R.phase === 'game-over' && R.winner === 0,
    JSON.stringify([nLog(R, '「死亡宣告」啟動'), !!A0(R), PZ(R, 1), R.phase, R.winner]));

  // B4 ⭐⭐⭐ 反對照：**沒有** on-KO 佇列時，v6.369 的那條路徑（drain／lift）完全不介入
  //   ⭐v6.419（Rule 40：意圖不變、觀測點被新版蓋住）：本版起「終局時還沒兌現的取獎賞」
  //     會被結清、picker 收掉（站長裁定：同時取完一律平手、終局不留點不動的視窗）
  //     ⇒ 原本斷言的「picker 照開、獎賞還沒取（6 張）」變成「picker 已收、獎賞已取（6−1=5）」。
  //   ⚠ **這一條真正要守的東西沒有鬆**：勝負（winner=0）、攻擊方完好、防守方昏厥
  //     三件事逐字保留；本版的新行為另外由 test-v6419 的 C1 釘住。
  const C = runAtk(board({ b0: 1, b1: 0, faceUp: true, defPlain: true }));
  chk('B4 ⭐⭐⭐沒有 on-KO 佇列 ⇒ v6.369 的路徑不介入：攻擊方完好、防守方昏厥、A 獲勝；'
    + '（v6.419 起）終局時未兌現的取獎賞被結清、picker 收掉',
    C.phase === 'game-over' && C.winner === 0 && !!A0(C) && D0(C) == null
    && !C.pendingSelection && PZ(C, 0) === 5 && QLEN(C) === 0,
    JSON.stringify([C.phase, C.winner, !!A0(C), C.pendingSelection?.effectKey ?? null, PZ(C, 0), QLEN(C)]));

  // B5 ⭐⭐⭐ 反對照：沒有正面朝上獎賞（＝沒有 picker）時，v6.361 原本的路徑照舊
  const N = runAtk(board({ b0: 0, b1: 0, faceUp: false }));
  chk('B5 ⭐⭐⭐沒有 picker 的同一盤面 ⇒ 仍然是 v6.361 的平手結果、獎賞照取（6−2=4）',
    N.phase === 'game-over' && N.isDraw === true && !HASWIN(N)
    && nLog(N, '「死亡宣告」啟動') === 1 && PZ(N, 0) === 4,
    JSON.stringify([N.phase, N.isDraw, nLog(N, '「死亡宣告」啟動'), PZ(N, 0)]));

  // B6 ⭐⭐ 反對照：phase 仍是 'playing' 的一般 picker 路徑**完全不變**
  //   （本版刻意不動 sanityKOSweep 的 pendingSelection gate；這一條就是它的哨兵）
  const st6 = board({ b0: 1, b1: 1, faceUp: true });
  const P6 = runAtk(st6);
  chk('B6 ⭐⭐未終局 ＋ picker：維持既有行為（phase 仍 playing、picker 開著）',
    P6.phase === 'playing' && P6.pendingSelection?.effectKey === 'take-prize-choose'
    && !HASWIN(P6) && PZ(P6, 0) === 6,
    JSON.stringify([P6.phase, P6.pendingSelection?.effectKey, PZ(P6, 0)]));
  const fu6 = P6.players[0].prizes.find((c) => c.faceUp);
  const P6b = act(P6, { type: 'RESOLVE_SELECTION', selectedIids: [fu6.iid], senderIdx: 0 });
  chk('B6b ⭐玩家解完 picker 之後，那一側的獎賞照樣取滿 2 張（6−2=4）、picker 關掉',
    PZ(P6b, 0) === 4 && !P6b.pendingSelection && P6b.phase === 'playing',
    JSON.stringify([PZ(P6b, 0), P6b.pendingSelection?.effectKey ?? null, P6b.phase]));

  // B7 「絕不把一局吊在半空」：本節每一個終局盤面都必須有明確結果、且佇列排乾淨
  const ENDED = [H, T, R, C, N];
  chk('B7 ⭐⭐⭐不可以把一局吊在半空：每一個 game-over 盤面都有 winner 或 isDraw，且佇列為 0',
    ENDED.every((r) => r.phase === 'game-over' && (HASWIN(r) || r.isDraw === true) && QLEN(r) === 0),
    JSON.stringify(ENDED.map((r) => [r.phase, r.winner ?? null, r.isDraw ?? null, QLEN(r)])));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【C】(丙) 六-13：被引擎退回的非法打出不可以記進 currentTurnActions');
// ══════════════════════════════════════════════════════════════════════════════
/** 動態 fixture：能乾淨落地（不開 picker、不動獎賞）的競技場 */
const probeStadium = (card) => {
  const c = inst(card.id);
  const base = mk(SIDE({ active: inst(PLAIN.id), hand: [c] }), SIDE({ active: inst(PLAIN.id) }));
  let out;
  try { out = act(base, { type: 'PLAY_TRAINER', iid: c.iid }); } catch { return false; }
  return out !== base && !out.pendingSelection
    && String(out.activeStadium?.cardId ?? '') === String(card.id)
    && out.players[0].prizes.length === 6 && out.players[1].prizes.length === 6;
};
let STAD1 = null, STAD2 = null;
for (const card of all) {
  if (card.subtype !== 'Stadium') continue;
  if (STAD1 && card.name === STAD1.name) continue;
  if (!probeStadium(card)) continue;
  if (!STAD1) STAD1 = card; else if (!STAD2) { STAD2 = card; break; }
}
chk('C0 找得到兩張不同名、可乾淨落地的競技場（動態 fixture）',
  !!STAD1 && !!STAD2 && STAD1.name !== STAD2.name, JSON.stringify([STAD1?.name, STAD2?.name]));
if (STAD1 && STAD2) {
  // C1 路徑①：每回合 1 張的額度（BASE 回傳同一個 state 物件 ⇒ 本來就不記）
  const c1 = inst(STAD1.id), c2 = inst(STAD2.id);
  const s1 = mk(SIDE({ active: inst(PLAIN.id), hand: [c1, c2] }), SIDE({ active: inst(PLAIN.id) }));
  const r1 = act(s1, { type: 'PLAY_TRAINER', iid: c1.iid });
  const r2 = act(r1, { type: 'PLAY_TRAINER', iid: c2.iid });
  chk('C1 ⭐正對照：第一張競技場是合法打出 ⇒ 流水帳恰好記 1 筆 play_hand，cardId 正確',
    JOURNAL(r1, 0) === JSON.stringify(['play_hand:' + STAD1.id]), JOURNAL(r1, 0));
  chk('C1b 哨兵：第一張真的落地了（activeStadium 換成它）',
    String(r1.activeStadium?.cardId ?? '') === String(STAD1.id), String(r1.activeStadium?.cardId));
  chk('C1c ⭐路徑①（每回合額度）被退回 ⇒ 流水帳完全沒有新增',
    JOURNAL(r2, 0) === JOURNAL(r1, 0), JOURNAL(r2, 0));
  chk('C1d 哨兵：那張卡真的還在手上（＝真的沒有被使出）',
    r2.players[0].hand.some((c) => c.iid === c2.iid) && String(r2.activeStadium?.cardId ?? '') === String(STAD1.id),
    JSON.stringify([r2.players[0].hand.map((c) => c.iid), r2.activeStadium?.cardId]));

  // C2 路徑②：同名競技場不可覆蓋（BASE 多寫一行 log ⇒ 回傳新 state ⇒ 記上一筆）
  const a1 = inst(STAD1.id), a2 = inst(STAD1.id);
  const s2 = mk(SIDE({ active: inst(PLAIN.id), hand: [a1, a2] }), SIDE({ active: inst(PLAIN.id) }));
  const q1 = act(s2, { type: 'PLAY_TRAINER', iid: a1.iid });
  const q1b = { ...q1, stadiumPlayedThisTurn: [false, false] };   // 清掉額度 ⇒ 一定走「同名」那一條
  const q2 = act(q1b, { type: 'PLAY_TRAINER', iid: a2.iid });
  chk('C2 ⭐⭐⭐路徑②（同名競技場覆蓋）被退回 ⇒ 流水帳也完全沒有新增（BASE：多記一筆 play_hand）',
    JOURNAL(q2, 0) === JOURNAL(q1b, 0)
    && JOURNAL(q2, 0) === JSON.stringify(['play_hand:' + STAD1.id]),
    JOURNAL(q2, 0));
  chk('C2b 哨兵：真的走到了「同名」那一條（規則 log 有寫、盤面有變、卡還在手上）',
    q2 !== q1b && L(q2).includes('場上已有相同名稱的競技場')
    && q2.players[0].hand.some((c) => c.iid === a2.iid),
    JSON.stringify([q2 !== q1b, L(q2).slice(-80), q2.players[0].hand.length]));
  chk('C2c ⭐⭐兩條非法路徑的流水帳結果**一致**（Rule 38：不可以一條記、一條不記）',
    JOURNAL(r2, 0) === JOURNAL(q2, 0), JSON.stringify([JOURNAL(r2, 0), JOURNAL(q2, 0)]));

  // C3 正對照：其他「從手牌打出」的動作照樣記
  const b3 = inst(PLAIN.id), e3 = inst(EID.Water);
  const s3 = mk(SIDE({ active: inst(PLAIN.id), hand: [b3, e3] }), SIDE({ active: inst(PLAIN.id) }));
  const t1 = act(s3, { type: 'PLAY_BASIC', iid: b3.iid });
  const t2 = act(t1, { type: 'ATTACH_ENERGY', energyIid: e3.iid, targetIid: t1.players[0].active.iid });
  chk('C3 ⭐⭐正對照：PLAY_BASIC ＋ ATTACH_ENERGY 這兩條合法路徑照樣各記 1 筆（不可以連合法的也不記）',
    JOURNAL(t2, 0) === JSON.stringify(['play_hand:' + PLAIN.id, 'play_hand:' + EID.Water]),
    JOURNAL(t2, 0));
  chk('C3b 哨兵：那兩張卡真的離開手牌了（備戰 +1、能量真的附上去）',
    t2.players[0].bench.length === 1 && t2.players[0].active.energyAttached.length === 1
    && t2.players[0].hand.length === 0,
    JSON.stringify([t2.players[0].bench.length, t2.players[0].active.energyAttached.length]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【D】中央性／結構（補充層，Rule 28：不單獨成立，每一條都配行為端）');
// ══════════════════════════════════════════════════════════════════════════════
{
  const ENG = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const TYP = readFileSync(join(ROOT, 'src/lib/game/types.ts'), 'utf8');
  const cnt = (s, re) => (s.match(re) || []).length;
  chk('D1 ⭐engine.ts 的 v6369 哨兵成對（七段）',
    cnt(ENG, />>> v6369-/g) === 7 && cnt(ENG, /<<< v6369-/g) === 7,
    JSON.stringify([cnt(ENG, />>> v6369-/g), cnt(ENG, /<<< v6369-/g)]));
  chk('D2 ⭐⭐(甲) 基準線的**寫入點只有 2 個**（中毒／灼傷各一），而且都走同一支 helper',
    cnt(ENG, /noteCheckupDamageUpV6369\(/g) === 3   // 1 宣告 + 2 呼叫
    && ENG.includes('state = noteCheckupDamageUpV6369(state, poisonPlayer.active.iid, poisonTotalDmg);')
    && ENG.includes('state = noteCheckupDamageUpV6369(state, burnedPlayer.active.iid, burnTotalDmg);'),
    String(cnt(ENG, /noteCheckupDamageUpV6369\(/g)));
  chk('D3 ⭐⭐(甲) 消費點與清除點各只有 1 個（per-action 暫存，不可跨 action）',
    cnt(ENG, /next\._v6369CheckupDmgUp \?\? \{\}/g) === 1
    && cnt(ENG, /delete _c369\._v6369CheckupDmgUp;/g) === 1,
    JSON.stringify([cnt(ENG, /next\._v6369CheckupDmgUp \?\? \{\}/g), cnt(ENG, /delete _c369\._v6369CheckupDmgUp;/g)]));
  chk('D4 ⭐⭐⭐(乙) v6.355「全站唯一 drain 點」架構一個字沒動（engine.ts 仍然只有 1 個呼叫點）',
    cnt(ENG, /drainOnKoAfterPrize\(/g) === 1
    && ENG.includes('  state = drainOnKoAfterPrize(state, pool);'),
    String(cnt(ENG, /drainOnKoAfterPrize\(/g)));
  let _eng369No421 = null;
  try { _eng369No421 = stripV6421Engine(_normEol419(ENG)); } catch { _eng369No421 = null; }
  const _eng369No419 = stripV6419Engine(_eng369No421 ?? _normEol419(ENG));
  chk('D5 ⭐⭐⭐(乙) 收回終局的呼叫點也沒有新增（剝掉 v6.419 的合法新增後仍只有 v6.361 那 1 個）',
    cnt(_eng369No419, /liftEndgameForOnKoV6361\(next\)/g) === 1
    && cnt(ENG, /export function liftEndgameForOnKoV6361\(/g) === 0
    && _eng369No419 !== (_eng369No421 ?? _normEol419(ENG)),   // 剝除器過期時大聲紅，不讓這一條變恆真
    String(cnt(_eng369No419, /liftEndgameForOnKoV6361\(next\)/g)));
  chk('D6 ⭐⭐(乙) 放行條件只對「已判出終局 ＋ 有 picker ＋ 佇列非空」成立（不可以改寬）',
    ENG.includes("  const _v6369NeedDrain = next.phase === 'game-over' && state.phase === 'playing'")
    && ENG.includes('    && !!next.pendingSelection && (next._onKoAfterPrize?.length ?? 0) > 0;'),
    '放行條件被改寬了');
  chk('D7 ⭐⭐v6.361 原本的延後條件**逐字未動**（本版只加一條旁路，不動既有那一格）',
    _eng369No421 !== null && _eng369No421 !== _normEol419(ENG)
    && _eng369No421.includes("  if (next.phase === 'game-over' && state.phase === 'playing'")
    && _eng369No421.includes('      && !next.pendingSelection && (next._onKoAfterPrize?.length ?? 0) > 0) {'),
    'v6.361 的延後條件被動過了（或 v6.421 剝除器過期）');
  chk('D8 ⭐Firestore 禁令：_v6369CheckupDmgUp 是 iid→number 的物件 map，不是陣列／不是 per-player 陣列',
    /_v6369CheckupDmgUp\?: Record<string, number>;/.test(TYP)
    && !/_v6369CheckupDmgUp\?:\s*(\[|number\[\]|\w+\[\]\[\])/.test(TYP),
    'types.ts 的型別不對');
  {
    const V6265 = readFileSync(join(ROOT, 'scripts/test-v6265-phantom-start-race.mjs'), 'utf8');
    const s0line = (V6265.split(/\r?\n/).find((l) => l.includes('const s0 = strip')) ?? '');
    // ⭐v6.373：原本斷言「**最外層**是 stripV6369Engine」。剝除鏈的慣例是每一版把自己
    //   那一層包在最外面 ⇒ 只要有下一版動到 engine.ts 的 BASE 既有行，這條必然翻紅。
    //   ⇒ 改成斷言本版該負責的事實本身：**恰好一份定義**，而且**緊貼在 stripV6368Engine 外面**
    //     （順序正確、沒有被跳過）。「最外層」由當版守衛負責（v6.373 的 G4 在守 stripV6373Engine）。
    chk('D10 ⭐⭐test-v6265 的剝除鏈裡 stripV6369Engine 恰好一份，且緊貼在 stripV6368Engine 外面',
      (V6265.match(/const stripV6369Engine = \(src\) => \{/g) || []).length === 1
      && s0line.includes('stripV6369Engine(stripV6368Engine(')
      && s0line.startsWith('        const s0 = strip'),
      s0line.slice(0, 120));
  }
  chk('D9 ⭐(丙) 判準是**行為層**（卡還在手上），不是逐條路徑列舉',
    ENG.includes('  if (rec !== null && justPlayedIid !== undefined')
    && ENG.includes('      && (after.players[aIdx].hand ?? []).some(c => c.iid === justPlayedIid)) {'),
    '(丙) 的判準不是預期的樣子');
}

console.log(`\nv6.369 守衛：PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
