// v6.344 守衛（M6a 批次4）：8 招「換位／回牌庫／退化／道具移除」，一律走**完整 ATTACK 流程**驗行為，不驗字串存在。
//   ⭐ 每一招都配「哨兵」：卡面有傷害的驗傷害真的結算了；卡面 damage 為空的驗
//     「對手身上一點傷害都沒有多出來」＋「效果真的發生」。
//   ⭐⭐ 會開 picker 的招式一律**真的 RESOLVE_SELECTION 解掉**再看結果；
//     「有開 picker 就算過」＝安慰劑（方向／目標改錯照樣全綠）。
//     本批三個換位方向各自要驗「誰被換到哪裡」，不能只驗「有開 picker」。
//   ⭐⭐ 「若希望」兩招**正反都驗**：選「否」時效果**不可以**發生（v6.339 高傲指令事故：
//     「只有一個候選就直接執行」的 fast-path 會把玩家的「不發動」選擇吃掉）。
//   ⭐⭐ 彈落的「**在造成傷害前**」用「對手戴著霹霹果（受【鋼】招式傷害 -60）」來驗順序：
//     先丟道具 ⇒ 20 點照樣落地；若做成 POST（先算傷害再丟）⇒ 20-60 = 0，守衛立刻紅。
//   ⚠ 靶一律挑對出招者屬性中立的（弱點×2、抵抗-20 會讓數字對不上）。
//   ⚠ 基本能量 id 依名稱查（硬編會付不出費用 → ATTACK 靜默 return → 假 FAIL）。
//   ⚠ state 一律由 createGame 產生再覆蓋（手刻會缺欄位 → ATTACK 靜默不執行）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.m6aw4-s.js'), E = join(ROOT, '.m6aw4-e.ts'), O = join(ROOT, '.m6aw4-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction, createGame } from './src/lib/game/engine';\nexport { ATTACK_PRE, ATTACK_PRE_DISCARD_CHOICE } from './src/lib/game/effects';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, createGame, ATTACK_PRE, ATTACK_PRE_DISCARD_CHOICE } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const byName = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c);
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(c);
  }
}
/** 依「卡名＋招式名」找印刷；**優先 M6a**（本批要驗的就是 M6a 那一張）。 */
const find = (n, a) => {
  const hits = (byName.get(n) || []).filter((c) => (c.attacks || []).some((x) => x.name === a));
  return hits.find((c) => String(c.setCode) === 'M6a') ?? hits[0];
};
const findCard = (n, f = () => true) => (byName.get(n) || []).find(f);
const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {};
for (const [id, c] of pool) {
  if (c.supertype !== 'Energy') continue;
  for (const [k, z] of Object.entries(ZH)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = id;
}
EID.Colorless = EID.Water; const FILL = EID.Water;
let n = 0; const inst = (cid, e = {}) => ({ iid: `w${++n}`, cardId: String(cid), damage: 0, energyAttached: [], ...e });
let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; console.log('  ✓', t); } else { fail++; console.log('  ❌', t, extra); } };

const pick = (f) => { const a = [...pool.values()].filter(f); a.sort((x, y) => Number(y.hp) - Number(x.hp)); return a[0]; };
const isEx = (c) => c?.subtype === 'ex' || /(ex|EX)$/.test(c?.name || '');
const BASE_OK = (c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length && !isEx(c);
const PLAIN = pick(BASE_OK);
if (!PLAIN) throw new Error('harness 找不到測試用受方寶可夢');
const typeOf = (c) => c?.pokemonType ?? null;
const neutral = (c, t) => !t || (c.weakness?.type !== t && c.resistance?.type !== t);
/** ⚠⚠ 受方一律挑「對出招者屬性**中立**」的（弱點×2、抵抗-20）。避開修正子，不是重寫弱抗公式。 */
const neutralFor = (atk) => pick((x) => BASE_OK(x) && neutral(x, typeOf(atk))) ?? PLAIN;
/** 另一隻「和 def 不同卡」的中立基礎寶可夢 —— 換位測試要分得出「誰上場了」。 */
const otherNeutral = (atk, notId) => pick((x) => BASE_OK(x) && neutral(x, typeOf(atk)) && String(x.id) !== String(notId)) ?? PLAIN;
/** 沒有特性的 1 階進化卡（退化測試的靶）。 */
const PLAIN_S1 = pick((c) => c.supertype === 'Pokemon' && c.stage === 'Stage1' && !(c.abilities || []).length && !isEx(c));
const PLAIN_S1B = pick((c) => c.supertype === 'Pokemon' && c.stage === 'Stage1' && !(c.abilities || []).length && !isEx(c) && String(c.id) !== String(PLAIN_S1?.id));
/** 化隱（不受招式效果）：來悲粗茶 Stage1 + 斯魔茶 Basic。 */
const HIDDEN_S1 = findCard('來悲粗茶', (c) => (c.abilities || []).some((a) => a.name === '化隱'));
const HIDDEN_BASIC = findCard('斯魔茶', (c) => (c.abilities || []).some((a) => a.name === '化隱'));
const PEPPER = findCard('霹霹果');   // 受【鋼】招式傷害 -60（討論「造成傷害前」順序用）

function run(atkName, atk, opt = {}) {
  const def = opt.def ?? neutralFor(atk);
  const ai = (atk.attacks || []).findIndex((a) => a.name === atkName);
  if (ai < 0) return { __err: '找不到招式 ' + atkName };
  const A = inst(atk.id, opt.atkPatch || {});
  A.energyAttached = [
    ...((atk.attacks[ai].cost) || []).map((t) => inst(EID[t] ?? FILL)),
    ...(opt.atkEnergyTypes || []).map((t) => inst(EID[t] ?? FILL)),
  ];
  const D = inst(def.id, opt.defPatch || {});
  const s0 = createGame({ name: 'P1', entries: [{ cardId: String(atk.id), count: 1 }] },
    { name: 'P2', entries: [{ cardId: String(def.id), count: 1 }] }, pool);
  // ⭐ oppBenchSpec / selfBenchSpec：換位測試必須讓備戰是**不同卡**，否則「誰上場了」驗不出來。
  const mk = (spec, fallbackId) => inst(spec.cid ?? fallbackId, {
    energyAttached: (spec.energy || []).map((t) => inst(EID[t] ?? FILL)),
    ...(spec.patch || {}),
  });
  const oppBench = opt.oppBenchSpec
    ? opt.oppBenchSpec.map((s) => mk(s, def.id))
    : Array.from({ length: opt.oppBench ?? 1 }, () => inst(def.id));
  const selfBench = opt.selfBenchSpec
    ? opt.selfBenchSpec.map((s) => mk(s, atk.id))
    : Array.from({ length: opt.selfBench ?? 0 }, () => inst(atk.id));
  const st = {
    ...s0, phase: 'playing', turnPhase: 'main', turn: 5, activePlayerIndex: 0, firstPlayerIdx: 0,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
    activeStadium: null, activeStadiumOwnerIdx: 0, pendingSelection: null, pendingChainQueue: [], log: [],
    players: [
      { ...s0.players[0], active: A, bench: selfBench,
        hand: (opt.handCards || []).map((cid) => inst(cid)),
        deck: (opt.deckCards || Array.from({ length: opt.deckN ?? 3 }, () => PLAIN.id)).map((cid) => inst(cid)),
        discard: [], prizes: Array.from({ length: 6 }, () => inst(def.id)) },
      { ...s0.players[1], active: D, bench: oppBench, hand: [],
        deck: (opt.oppDeckCards || Array.from({ length: 3 }, () => def.id)).map((cid) => inst(cid)),
        discard: [], prizes: Array.from({ length: 6 }, () => inst(def.id)) },
    ],
    ...(opt.statePatch || {}),
  };
  // ⭐ 「若希望」binary-yes-no：真的把玩家的答覆送進 ATTACK（['yes-token'] = 是、[] = 否）。
  const action = { type: 'ATTACK', attackIndex: ai };
  if (opt.optIn !== undefined) action.discardedEnergyIids = opt.optIn ? ['yes-token'] : [];
  const orig = Math.random;
  let seqI = 0;
  const seq = opt.randomSeq;
  Math.random = () => (seq ? (seqI < seq.length ? seq[seqI++] : seq[seq.length - 1]) : (opt.heads === false ? 0.9 : 0.1));
  let out;
  try { out = applyAction(st, action, pool); }
  catch (e) { out = { __err: e.message }; }
  finally { Math.random = orig; }
  if (out && out.players) { out.__atkIid = A.iid; out.__defIid = D.iid; }
  return out;
}
const dmgOf = (r) => r?.players?.[1]?.active?.damage ?? -1;
const benchDmg = (r, i = 0) => r?.players?.[1]?.bench?.[i]?.damage ?? -1;
const oppActiveCid = (r) => String(r?.players?.[1]?.active?.cardId ?? '');
const selfActiveCid = (r) => String(r?.players?.[0]?.active?.cardId ?? '');
const pend = (r) => r?.pendingSelection ?? null;
/** 把 pending picker 解掉（真的走一次 RESOLVE_SELECTION）。actor 預設 0；對手自選的 picker 要傳 1。 */
const resolveAs = (r, iids, actor = 0) => applyAction(r, { type: 'RESOLVE_SELECTION', selectedIids: iids, actorIdx: actor }, pool);
const faceRaw = (card, atkName) => String((card.attacks || []).find((x) => x.name === atkName)?.damage ?? '');
const faceDmg = (card, atkName) => { const m = /^(\d+)/.exec(faceRaw(card, atkName)); return m ? Number(m[1]) : 0; };
/** 場上所有對手寶可夢的傷害總和（damage=='' 的純效果招式的哨兵：一點都不該多出來）。 */
const oppTotalDmg = (r) => [r?.players?.[1]?.active, ...(r?.players?.[1]?.bench ?? [])]
  .filter(Boolean).reduce((a, c) => a + (c.damage ?? 0), 0);
const stackOf = (cid) => [{ iid: `st_${cid}_${Math.random().toString(36).slice(2, 7)}`, cardId: String(cid), damage: 0, energyAttached: [] }];

console.log('\n【0】harness 自驗（沒有這一段，下面全部可能是空真）');
{
  const c = find('帕路奇亞', '蟲洞');
  chk('0a fixture：抓得到 M6a 的帕路奇亞｜蟲洞（100）',
    !!c && String(c.setCode) === 'M6a' && faceRaw(c, '蟲洞') === '100', `${c?.setCode}/${faceRaw(c, '蟲洞')}`);
  chk('0b ⭐反安慰劑：不存在的招式名會回 __err（run() 不會默默成功）', !!run('這招不存在', c).__err);
  const t = typeOf(c), nd = neutralFor(c);
  chk('0c ⭐harness 自驗：中立靶對出招者屬性既不弱也不抗',
    !!t && neutral(nd, t), `atkType=${t} target=${nd?.name} weak=${nd?.weakness?.type} res=${nd?.resistance?.type}`);
  chk('0d ⭐反安慰劑：拿「弱點正好是出招者屬性」的靶，傷害真的會變兩倍（證明 0c 有意義）',
    (() => {
      // ⚠ 用小傷害的招式驗弱點（蟲洞 100×2=200 會把靶打死 → active=null → dmgOf 讀到 -1，假 FAIL）。
      const zm = find('藏瑪然特', '彈落');           // 【鋼】20
      const weakTarget = pick((x) => BASE_OK(x) && x.weakness?.type === typeOf(zm) && Number(x.hp) >= 60);
      if (!zm || !weakTarget) return false;
      return dmgOf(run('彈落', zm, { def: weakTarget, oppBench: 0 })) === 40;
    })());
  chk('0e fixture：退化／化隱／霹霹果 三組 fixture 都抓得到',
    !!PLAIN_S1 && !!PLAIN_S1B && !!HIDDEN_S1 && !!HIDDEN_BASIC && !!PEPPER,
    `${PLAIN_S1?.name}/${PLAIN_S1B?.name}/${HIDDEN_S1?.name}/${HIDDEN_BASIC?.name}/${PEPPER?.name}`);
  chk('0f ⭐harness 自驗：oppBenchSpec 真的換得掉備戰的卡（否則換位方向驗不出來）',
    (() => {
      const other = otherNeutral(c, neutralFor(c).id);
      const r = run('蟲洞', c, { oppBenchSpec: [{ cid: other.id }] });
      return String(r?.players?.[1]?.bench?.[0]?.cardId) === String(other.id);
    })());
}

console.log('\n【A】gust 方向：選「對手的備戰」與對手戰鬥場互換（電螢蟲｜誘導之光）');
{
  const c = find('電螢蟲', '誘導之光');
  const def = neutralFor(c);
  const other = otherNeutral(c, def.id);
  const r = run('誘導之光', c, { def, oppBenchSpec: [{ cid: other.id }] });
  chk('A1 ⭐開的是「對手備戰」picker，且走中央 opp-swap-dmg（不是 do-switch／force-opp-swap）',
    pend(r)?.type === 'opp-bench-choose' && pend(r)?.effectKey === 'opp-swap-dmg',
    `${pend(r)?.type}/${pend(r)?.effectKey}`);
  chk('A2 中央 gust 一定帶 validIids（免疫的對手備戰要被排除，test-gust-immunity 同一條）',
    Array.isArray(pend(r)?.params?.validIids) && pend(r).params.validIids.length === 1);
  const after = resolveAs(r, [r.players[1].bench[0].iid]);
  chk('A3 ⭐解完 picker：**被選中的對手備戰**真的上了對手戰鬥場',
    oppActiveCid(after) === String(other.id), `${oppActiveCid(after)} vs ${other.id}`);
  chk('A4 ⭐方向對照：原本的對手戰鬥寶可夢退回**對手備戰**（不是被我方換走）',
    String(after?.players?.[1]?.bench?.[0]?.cardId) === String(def.id) && selfActiveCid(after) === String(c.id),
    `bench=${after?.players?.[1]?.bench?.[0]?.cardId} selfActive=${selfActiveCid(after)}`);
  chk('A5 哨兵：卡面 damage 為空 ⇒ 對手場上一點傷害都不該多出來', oppTotalDmg(after) === 0, String(oppTotalDmg(after)));
  const r0 = run('誘導之光', c, { def, oppBench: 0 });
  chk('A6 ⭐對手沒有備戰 ⇒ 不開 picker、不當掉', !r0.__err && pend(r0) === null, r0.__err ?? String(pend(r0)?.type));
}

console.log('\n【B】自己換自己（selfSwapPost / do-switch）（皮卡丘｜逃來逃去）');
{
  const c = find('皮卡丘', '逃來逃去');
  const mine = otherNeutral(c, c.id);
  const r = run('逃來逃去', c, { selfBenchSpec: [{ cid: mine.id }] });
  chk('B1 ⭐開的是「自己的備戰」picker，effectKey=do-switch（不是 gust、不是 force-opp-swap）',
    pend(r)?.type === 'bench-choose' && pend(r)?.effectKey === 'do-switch' && pend(r)?.actorIdx === 0,
    `${pend(r)?.type}/${pend(r)?.effectKey}/actor=${pend(r)?.actorIdx}`);
  const after = resolveAs(r, [r.players[0].bench[0].iid]);
  chk('B2 ⭐解完 picker：換上來的是**自己的**備戰，對手戰鬥場完全沒動',
    selfActiveCid(after) === String(mine.id) && oppActiveCid(after) === oppActiveCid(r),
    `self=${selfActiveCid(after)} opp=${oppActiveCid(after)}`);
  chk('B3 ⭐原本的自己戰鬥寶可夢退回自己備戰',
    String(after?.players?.[0]?.bench?.[0]?.cardId) === String(c.id));
  chk('B4 哨兵：卡面 damage 為空 ⇒ 對手一點傷害都不該多出來', oppTotalDmg(after) === 0, String(oppTotalDmg(after)));
  const r0 = run('逃來逃去', c, { selfBench: 0 });
  chk('B5 ⭐自己沒有備戰 ⇒ 不開 picker、不當掉', !r0.__err && pend(r0) === null, r0.__err ?? String(pend(r0)?.type));
  // ⭐ 正對照：既有同措辭卡走同一支 helper
  const px = find('粉蝶蛹', '走來走去');
  if (px) {
    const rx = run('走來走去', px, { selfBenchSpec: [{ cid: otherNeutral(px, px.id).id }] });
    chk('B6 ⭐正對照：既有「粉蝶蛹｜走來走去」同樣開 do-switch', pend(rx)?.effectKey === 'do-switch', String(pend(rx)?.effectKey));
  } else chk('B6 正對照卡存在', false, '找不到 粉蝶蛹|走來走去');
}

console.log('\n【C】兩段兩方向（帕路奇亞｜蟲洞）—— 先自己換，再叫對手換');
{
  const c = find('帕路奇亞', '蟲洞');
  const def = neutralFor(c);
  const mine = otherNeutral(c, c.id);
  const oppB = otherNeutral(c, def.id);
  const r = run('蟲洞', c, { def, selfBenchSpec: [{ cid: mine.id }], oppBenchSpec: [{ cid: oppB.id }] });
  chk('C1 哨兵：卡面 100 點真的結算在對手戰鬥寶可夢身上', dmgOf(r) === 100, String(dmgOf(r)));
  chk('C2 ⭐第一段是「自己換自己」（do-switch，actorIdx=0）', pend(r)?.effectKey === 'do-switch' && pend(r)?.actorIdx === 0,
    `${pend(r)?.effectKey}/actor=${pend(r)?.actorIdx}`);
  chk('C3 ⭐第二段已排進 pendingChainQueue，且是「對手自選」（force-opp-swap，actorIdx=1）',
    (r.pendingChainQueue ?? []).length === 1
    && r.pendingChainQueue[0].effectKey === 'force-opp-swap' && r.pendingChainQueue[0].actorIdx === 1,
    JSON.stringify((r.pendingChainQueue ?? []).map((x) => [x.effectKey, x.actorIdx])));
  const s1 = resolveAs(r, [r.players[0].bench[0].iid], 0);
  chk('C4 ⭐解完第一段：自己的備戰上場，第二段自動浮上來', selfActiveCid(s1) === String(mine.id)
    && pend(s1)?.effectKey === 'force-opp-swap', `${selfActiveCid(s1)}/${pend(s1)?.effectKey}`);
  const s2 = resolveAs(s1, [s1.players[1].bench[0].iid], 1);
  chk('C5 ⭐解完第二段：**對手選的**備戰上場，吃了 100 的那一隻退回對手備戰',
    oppActiveCid(s2) === String(oppB.id) && s2.players[1].active.damage === 0
    && s2.players[1].bench.some((b) => String(b.cardId) === String(def.id) && b.damage === 100),
    `active=${oppActiveCid(s2)}(${s2.players[1].active.damage}) bench=${JSON.stringify(s2.players[1].bench.map((b) => [b.cardId, b.damage]))}`);
  // ⚠ 對手沒有備戰時後半不執行，但前半照做、也不可以當掉
  const rNoOpp = run('蟲洞', c, { def, selfBenchSpec: [{ cid: mine.id }], oppBench: 0 });
  chk('C6 ⭐對手沒備戰 ⇒ 只有自己換那一段（chain queue 空），不當掉',
    !rNoOpp.__err && pend(rNoOpp)?.effectKey === 'do-switch' && (rNoOpp.pendingChainQueue ?? []).length === 0,
    `${rNoOpp.__err ?? ''}${pend(rNoOpp)?.effectKey}/${(rNoOpp.pendingChainQueue ?? []).length}`);
  // ⚠ 自己沒有備戰時前半不執行，後半照做
  const rNoSelf = run('蟲洞', c, { def, selfBench: 0, oppBenchSpec: [{ cid: oppB.id }] });
  chk('C7 ⭐自己沒備戰 ⇒ 只有「叫對手換」那一段，不當掉',
    !rNoSelf.__err && pend(rNoSelf)?.effectKey === 'force-opp-swap' && pend(rNoSelf)?.actorIdx === 1,
    `${rNoSelf.__err ?? ''}${pend(rNoSelf)?.effectKey}`);
  chk('C8 哨兵（無備戰分支）：100 點照樣結算', dmgOf(rNoSelf) === 100, String(dmgOf(rNoSelf)));
}

console.log('\n【D】「若希望」自己換自己（夢幻ex｜瞬間移動突擊）—— 正反都要驗');
{
  const c = find('夢幻ex', '瞬間移動突擊');
  const mine = otherNeutral(c, c.id);
  const spec = ATTACK_PRE_DISCARD_CHOICE.get('夢幻ex|瞬間移動突擊');
  chk('D1 ⭐UI 端真的會問（binary-yes-no 宣告表有這一筆，且預估傷害＝卡面 30）—— 沒有這一筆 ⇒ 玩家沒得選',
    spec?.scope === 'binary-yes-no' && spec?.min === 0 && spec?.baseDamage === faceDmg(c, '瞬間移動突擊'),
    `${spec?.scope}/${spec?.min}/${spec?.baseDamage}`);
  const rYes = run('瞬間移動突擊', c, { optIn: true, selfBenchSpec: [{ cid: mine.id }] });
  chk('D2 選「是」 → 開 do-switch picker', pend(rYes)?.effectKey === 'do-switch', String(pend(rYes)?.effectKey));
  const after = resolveAs(rYes, [rYes.players[0].bench[0].iid]);
  chk('D3 ⭐選「是」解完 picker：自己的備戰真的上場', selfActiveCid(after) === String(mine.id), selfActiveCid(after));
  const rNo = run('瞬間移動突擊', c, { optIn: false, selfBenchSpec: [{ cid: mine.id }] });
  chk('D4 ⭐⭐選「否」 → **完全不互換、也不開 picker**（v6.339：不可被 fast-path 吃掉玩家的「不發動」）',
    pend(rNo) === null && selfActiveCid(rNo) === String(c.id),
    `${pend(rNo)?.effectKey ?? 'null'}/${selfActiveCid(rNo)}`);
  chk('D5 哨兵：兩種選擇都照樣結算卡面 30 點',
    dmgOf(rYes) === faceDmg(c, '瞬間移動突擊') && dmgOf(rNo) === faceDmg(c, '瞬間移動突擊'),
    `${dmgOf(rYes)}/${dmgOf(rNo)} face=${faceDmg(c, '瞬間移動突擊')}`);
  chk('D6 ⭐沒有登記 regPre（傷害讓引擎讀卡面；v6.333 硬寫傷害的前科）',
    !ATTACK_PRE.has('夢幻ex|瞬間移動突擊'));
}

console.log('\n【E】「若希望」自身連附加回牌庫並重洗（飄飄球｜飄舞）—— 正反都要驗');
{
  const c = find('飄飄球', '飄舞');
  const mine = otherNeutral(c, c.id);
  const spec = ATTACK_PRE_DISCARD_CHOICE.get('飄飄球|飄舞');
  chk('E1 ⭐UI 端真的會問（binary-yes-no，且預估傷害＝卡面 20）',
    spec?.scope === 'binary-yes-no' && spec?.baseDamage === faceDmg(c, '飄舞'),
    `${spec?.scope}/${spec?.baseDamage}`);
  const rYes = run('飄舞', c, { optIn: true, selfBenchSpec: [{ cid: mine.id }], deckN: 3 });
  const deckYes = rYes?.players?.[0]?.deck ?? [];
  chk('E2 ⭐選「是」：自己離場（active 清空或已換人），牌庫多了 2 張（本體 + 1 顆附加能量）',
    deckYes.length === 5 && selfActiveCid(rYes) !== String(c.id),
    `deck=${deckYes.length} active=${selfActiveCid(rYes)}`);
  chk('E3 ⭐回牌庫的本體是**裸卡**（damage 0 / 無能量 —— 離場必須清乾淨，防旗標外洩）',
    (() => {
      const back = deckYes.find((x) => String(x.cardId) === String(c.id));
      return !!back && back.damage === 0 && (back.energyAttached ?? []).length === 0
        && back.status === undefined && back.toolAttached === undefined;
    })(), JSON.stringify(deckYes.find((x) => String(x.cardId) === String(c.id))));
  chk('E4 ⭐「附加的卡**全部**」：那顆基本能量也進了牌庫（漏掉＝把卡吃掉）',
    deckYes.filter((x) => String(x.cardId) === String(EID.Psychic)).length === 1,
    JSON.stringify(deckYes.map((x) => x.cardId)));
  const rNo = run('飄舞', c, { optIn: false, selfBenchSpec: [{ cid: mine.id }], deckN: 3 });
  chk('E5 ⭐⭐選「否」 → 留在戰鬥位、牌庫一張都沒動',
    selfActiveCid(rNo) === String(c.id) && (rNo?.players?.[0]?.deck ?? []).length === 3,
    `${selfActiveCid(rNo)}/${(rNo?.players?.[0]?.deck ?? []).length}`);
  chk('E6 哨兵：兩種選擇都照樣結算卡面 20 點',
    dmgOf(rYes) === faceDmg(c, '飄舞') && dmgOf(rNo) === faceDmg(c, '飄舞'),
    `${dmgOf(rYes)}/${dmgOf(rNo)} face=${faceDmg(c, '飄舞')}`);
  chk('E7 ⭐是回**牌庫**不是回手牌（走錯 helper 會進手牌）',
    (rYes?.players?.[0]?.hand ?? []).length === 0, String((rYes?.players?.[0]?.hand ?? []).length));
}

console.log('\n【F】退化（太陽伊布｜奇跡璨耀）');
{
  const c = find('太陽伊布', '奇跡璨耀');
  // 對手：戰鬥場 1 階（有堆疊）、備戰 1 階（有堆疊）、備戰基礎（沒堆疊）
  const r = run('奇跡璨耀', c, {
    def: PLAIN_S1,
    defPatch: { evolvedFromStack: stackOf(PLAIN.id) },
    oppBenchSpec: [
      { cid: PLAIN_S1B.id, patch: { evolvedFromStack: stackOf(PLAIN.id) } },
      { cid: PLAIN.id },
    ],
  });
  chk('F1 ⭐對手**所有**進化寶可夢各退 1 層（戰鬥場 + 備戰都要退）',
    oppActiveCid(r) === String(PLAIN.id) && String(r?.players?.[1]?.bench?.[0]?.cardId) === String(PLAIN.id),
    `active=${oppActiveCid(r)} bench0=${r?.players?.[1]?.bench?.[0]?.cardId}`);
  chk('F2 ⭐沒有進化堆疊的（基礎）不受影響 —— 也不會憑空生出一張卡',
    String(r?.players?.[1]?.bench?.[1]?.cardId) === String(PLAIN.id)
    && (r?.players?.[1]?.bench?.[1]?.evolvedFromStack ?? undefined) === undefined);
  chk('F3 ⭐移除的卡放回**對手的手牌**，且剛好 2 張（＝退化的隻數，不是全場隻數）',
    (r?.players?.[1]?.hand ?? []).length === 2
    && r.players[1].hand.every((x) => [String(PLAIN_S1.id), String(PLAIN_S1B.id)].includes(String(x.cardId))),
    JSON.stringify((r?.players?.[1]?.hand ?? []).map((x) => x.cardId)));
  chk('F4 ⭐「各移除 1 張」＝只退一層（堆疊清空後就不再往下退）',
    (r?.players?.[1]?.active?.evolvedFromStack ?? undefined) === undefined);
  chk('F5 哨兵：卡面 damage 為空 ⇒ 對手一點傷害都不該多出來', oppTotalDmg(r) === 0, String(oppTotalDmg(r)));
  // ⚠ 逐隻過免疫閘：化隱的那一隻不退化，其餘照退
  const rImm = run('奇跡璨耀', c, {
    def: HIDDEN_S1,
    defPatch: { evolvedFromStack: stackOf(HIDDEN_BASIC.id) },
    oppBenchSpec: [{ cid: PLAIN_S1.id, patch: { evolvedFromStack: stackOf(PLAIN.id) } }],
  });
  chk('F6 ⭐⭐化隱（不受招式效果）那一隻**不退化**，但同場的其他進化照退（逐隻各過一次閘）',
    oppActiveCid(rImm) === String(HIDDEN_S1.id)
    && String(rImm?.players?.[1]?.bench?.[0]?.cardId) === String(PLAIN.id)
    && (rImm?.players?.[1]?.hand ?? []).length === 1,
    `active=${oppActiveCid(rImm)} bench0=${rImm?.players?.[1]?.bench?.[0]?.cardId} hand=${(rImm?.players?.[1]?.hand ?? []).length}`);
  // ⚠ 對手全是基礎 ⇒ 無效果，不當掉
  const rNone = run('奇跡璨耀', c, { def: PLAIN, oppBenchSpec: [{ cid: PLAIN.id }] });
  chk('F7 ⭐對手場上沒有進化寶可夢 ⇒ 不當掉、也不生卡',
    !rNone.__err && (rNone?.players?.[1]?.hand ?? []).length === 0, rNone.__err ?? '');
  // ⭐ 正對照：逐字同措辭的既有卡（阿賽斯特萊石）走同一支中央 helper，但移除的卡回**牌庫**
  const ex = find('太陽伊布ex', '阿賽斯特萊石');
  if (ex) {
    const rEx = run('阿賽斯特萊石', ex, {
      def: PLAIN_S1,
      defPatch: { evolvedFromStack: stackOf(PLAIN.id) },
      oppBenchSpec: [{ cid: PLAIN_S1B.id, patch: { evolvedFromStack: stackOf(PLAIN.id) } }],
      oppDeckCards: [PLAIN.id, PLAIN.id, PLAIN.id],
    });
    chk('F8 ⭐正對照：既有「太陽伊布ex｜阿賽斯特萊石」同樣全場退 1 層',
      oppActiveCid(rEx) === String(PLAIN.id) && String(rEx?.players?.[1]?.bench?.[0]?.cardId) === String(PLAIN.id),
      `${oppActiveCid(rEx)}/${rEx?.players?.[1]?.bench?.[0]?.cardId}`);
    chk('F9 ⭐⭐方向對照：阿賽斯特萊石是回**牌庫**（3→5），奇跡璨耀是回**手牌** —— 兩者不可混用',
      (rEx?.players?.[1]?.deck ?? []).length === 5 && (rEx?.players?.[1]?.hand ?? []).length === 0,
      `deck=${(rEx?.players?.[1]?.deck ?? []).length} hand=${(rEx?.players?.[1]?.hand ?? []).length}`);
  } else chk('F8 正對照卡存在', false, '找不到 太陽伊布ex|阿賽斯特萊石');
  // ⚠⚠ 「將移除的卡放回對手的**手牌**」⇒ 要過【平穩境地】（美納斯）閘。
  //   中央述詞吃的是「**被回手那張卡的持有者**」idx ⇒ 被回手的是對手的進化卡 ⇒ 守門的美納斯
  //   在**攻擊方**這一側（＝我自己場上有美納斯時，我的奇跡璨耀回手效果被自己擋住）。
  //   這是 v5.985 既定判準（念力土偶｜退化光線 同一份），不是本批發明的。
  const MENAS = findCard('美納斯', (x) => (x.abilities || []).some((a) => a.name === '平穩境地'));
  if (MENAS) {
    const rCg = run('奇跡璨耀', c, {
      def: PLAIN_S1,
      defPatch: { evolvedFromStack: stackOf(PLAIN.id) },
      oppBenchSpec: [{ cid: PLAIN.id }],
      selfBenchSpec: [{ cid: MENAS.id }],
    });
    chk('F10 ⭐⭐【平穩境地】在場 ⇒ 整個效果不執行（進化卡不可放回手牌）',
      oppActiveCid(rCg) === String(PLAIN_S1.id) && (rCg?.players?.[1]?.hand ?? []).length === 0,
      `${oppActiveCid(rCg)} hand=${(rCg?.players?.[1]?.hand ?? []).length}`);
    // ⭐ 反安慰劑：同一盤面把美納斯換成普通寶可夢，效果就該正常發生（證明 F10 抓的是平穩境地）
    const rCtl = run('奇跡璨耀', c, {
      def: PLAIN_S1,
      defPatch: { evolvedFromStack: stackOf(PLAIN.id) },
      oppBenchSpec: [{ cid: PLAIN.id }],
      selfBenchSpec: [{ cid: PLAIN.id }],
    });
    chk('F11 ⭐反安慰劑：換成普通備戰寶可夢 ⇒ 照樣退化（證明 F10 有意義）',
      oppActiveCid(rCtl) === String(PLAIN.id) && (rCtl?.players?.[1]?.hand ?? []).length === 1,
      `${oppActiveCid(rCtl)} hand=${(rCtl?.players?.[1]?.hand ?? []).length}`);
  } else chk('F10 平穩境地 fixture 存在', false, '找不到 美納斯｜平穩境地');
}

console.log('\n【G】與牌庫的寶可夢卡互換（百變怪｜整人變身）');
{
  const c = find('百變怪', '整人變身');
  const target = otherNeutral(c, c.id);
  const opt = {
    atkPatch: { damage: 30, status: 'poisoned' },
    deckCards: [target.id, PLAIN.id],
  };
  const rH = run('整人變身', c, { ...opt, heads: true });
  chk('G1 ⭐正面 → 開牌庫 picker（effectKey=ditto-transform-swap），候選只列寶可夢卡，且是「選 1 張、可宣告找不到」',
    pend(rH)?.type === 'deck-search' && pend(rH)?.effectKey === 'ditto-transform-swap'
    && (pend(rH)?.params?.validIids ?? []).length === 2
    && pend(rH)?.minCount === 0 && pend(rH)?.maxCount === 1,
    `${pend(rH)?.type}/${pend(rH)?.effectKey}/${(pend(rH)?.params?.validIids ?? []).length}/min=${pend(rH)?.minCount}/max=${pend(rH)?.maxCount}`);
  const after = resolveAs(rH, [rH.players[0].deck[0].iid]);
  const act = after?.players?.[0]?.active;
  chk('G2 ⭐互換的是「卡片本體」：場上那一格的 cardId 換成牌庫那張，iid 不變',
    String(act?.cardId) === String(target.id) && act?.iid === rH.__atkIid,
    `${act?.cardId}(${act?.iid}) vs ${target.id}(${rH.__atkIid})`);
  chk('G3 ⭐⭐「所附加的卡・傷害指示物・特殊狀態・效果等全部保留」—— 身上的東西原封不動',
    act?.damage === 30 && (act?.energyAttached ?? []).length === 2 && act?.status === 'poisoned',
    `dmg=${act?.damage} energy=${(act?.energyAttached ?? []).length} status=${act?.status}`);
  chk('G4 ⭐「若互換了，則這張卡放回牌庫」：換下來的百變怪以**裸卡**回牌庫（牌庫仍 2 張）',
    (() => {
      const deck = after?.players?.[0]?.deck ?? [];
      const back = deck.find((x) => String(x.cardId) === String(c.id));
      return deck.length === 2 && !!back && back.damage === 0 && (back.energyAttached ?? []).length === 0
        && !deck.some((x) => x.iid === rH.players[0].deck[0].iid);
    })(), JSON.stringify((after?.players?.[0]?.deck ?? []).map((x) => x.cardId)));
  const rT = run('整人變身', c, { ...opt, heads: false });
  chk('G5 ⭐⭐反面 → 不開 picker、不互換（正反對照）',
    pend(rT) === null && selfActiveCid(rT) === String(c.id),
    `${pend(rT)?.effectKey ?? 'null'}/${selfActiveCid(rT)}`);
  chk('G6 哨兵：卡面 damage 為空 ⇒ 對手一點傷害都不該多出來（正反皆然）',
    oppTotalDmg(rH) === 0 && oppTotalDmg(rT) === 0, `${oppTotalDmg(rH)}/${oppTotalDmg(rT)}`);
  const rNoPick = resolveAs(rH, []);
  chk('G7 ⭐正面但選 0 張（宣告找不到）⇒ 不互換、牌庫不多不少（仍要重洗）',
    selfActiveCid(rNoPick) === String(c.id) && (rNoPick?.players?.[0]?.deck ?? []).length === 2,
    `${selfActiveCid(rNoPick)}/${(rNoPick?.players?.[0]?.deck ?? []).length}`);
}

console.log('\n【H】在造成傷害前丟對手道具（藏瑪然特｜彈落）');
{
  const c = find('藏瑪然特', '彈落');
  const def = neutralFor(c);
  chk('H1 ⭐必須落在 PRE（卡面「在造成傷害前」）—— 只有 POST 的話這一條就紅',
    ATTACK_PRE.has('藏瑪然特|彈落'));
  const t1 = inst(PEPPER.id), t2 = inst(PEPPER.id);
  const r = run('彈落', c, { def, defPatch: { toolAttached: t1, extraTools: [t2] }, oppBench: 0 });
  const d = r?.players?.[1]?.active;
  chk('H2 ⭐道具全部丟棄（toolAttached + extraTools 都要清，走 getAllAttachedTools）',
    !d?.toolAttached && (d?.extraTools ?? []).length === 0
    && (r?.players?.[1]?.discard ?? []).filter((x) => String(x.cardId) === String(PEPPER.id)).length === 2,
    `tool=${!!d?.toolAttached} extra=${(d?.extraTools ?? []).length} discard=${(r?.players?.[1]?.discard ?? []).length}`);
  // ⭐⭐ 順序：直接驗 PRE 這一層 —— PRE 回傳的當下，道具已經不在對手身上了，
  //   而回傳的 base 就是卡面 20 ⇒ 「丟棄」確實排在「造成傷害」之前。
  //   ⚠⚠ 已知站上限制（本批發現，見回報「待站長裁示」）：引擎算減傷時讀的是
  //     **applyAction 開頭**就抓好的 `defender` 快照，PRE 丟掉的道具在那份快照裡還在，
  //     所以端到端（霹霹果 -60）目前仍會把 20 減成 0。這是 defToolDiscardPre **整個家族**
  //     （金魚王｜啄落／拉達｜削落／烈雀｜啄食／破破舵輪｜破壞船錨／派帕的貪心栗鼠｜咬取）
  //     共有的既有行為，不是本批引入的；要修得動 engine.ts 的核心快照 ⇒ 留給站長裁示。
  //     ⇒ 這裡**不**斷言「20 點落地」（那會是把已知錯誤寫死成守衛），
  //       也**不**斷言「0 點」（那會把錯誤當規格封存）。只驗我們這一層的順序與 base。
  {
    const pre = ATTACK_PRE.get('藏瑪然特|彈落');
    const st0 = {
      phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
      isFirstTurn: false, log: [], pendingSelection: null, activeStadium: null,
      players: [
        { name: 'P1', active: inst(c.id), bench: [], hand: [], deck: [], discard: [], prizes: [1] },
        { name: 'P2', active: inst(def.id, { toolAttached: inst(PEPPER.id), extraTools: [inst(PEPPER.id)] }), bench: [], hand: [], deck: [], discard: [], prizes: [1] },
      ],
    };
    const pr = pre ? pre(st0, 0, pool, {}) : null;
    const dd = pr?.state?.players?.[1]?.active;
    chk('H3 ⭐⭐順序：PRE 回傳的當下「道具已經被丟掉」且 base = 卡面 20（＝在造成傷害前丟）',
      !!pr && pr.damage === 20 && !dd?.toolAttached && (dd?.extraTools ?? []).length === 0
      && (pr.state.players[1].discard ?? []).length === 2,
      `damage=${pr?.damage} tool=${!!dd?.toolAttached} extra=${(dd?.extraTools ?? []).length}`);
  }
  chk('H4 ⭐反安慰劑：同一張霹霹果掛在**不丟道具**的招式下，傷害真的會被減 60（證明 H2/H3 的 fixture 有效）',
    (() => {
      const plainAtk = find('藏瑪然特', '盾牌壓制');
      if (!plainAtk) return false;
      const rr = run('盾牌壓制', plainAtk, { def: pick((x) => BASE_OK(x) && neutral(x, 'Metal') && Number(x.hp) >= 120), defPatch: { toolAttached: inst(PEPPER.id) }, oppBench: 0 });
      return dmgOf(rr) === 40; // 卡面 100 − 60
    })());
  const r0 = run('彈落', c, { def, oppBench: 0 });
  chk('H5 ⭐哨兵：對手沒有道具 ⇒ 端到端照樣結算卡面 20 點、不當掉', !r0.__err && dmgOf(r0) === 20, r0.__err ?? String(dmgOf(r0)));
  chk('H6 ⭐base = 卡面 20（不是硬寫別的數字；test-fixed-damage-base 同一條）',
    ATTACK_PRE.has('藏瑪然特|彈落') && faceDmg(c, '彈落') === 20, faceRaw(c, '彈落'));
}

console.log(`\nm6a-wave4：PASS ${pass} / FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
