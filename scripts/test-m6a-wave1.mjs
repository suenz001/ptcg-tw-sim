// v6.341 守衛（M6a 批次1）：26 招，一律用**完整 ATTACK 流程**驗證行為，不驗字串存在。
//   ⭐ 每一條都附「哨兵」：斷言卡面傷害真的結算了 —— 沒有哨兵時，招式若根本沒被執行
//     （key 打錯、import 漏接、費用付不出來 ⇒ ATTACK 靜默 return），效果斷言會是空真。
//   ⭐ 每一型都附正對照：同一支 helper 的**既有卡**必須同樣通過，harness 自己壞掉時會一起紅。
//   ⚠ 基本能量 id 依名稱查（硬編會付不出費用 → ATTACK 靜默 return → 假 FAIL）。
//   ⚠ state 一律由 createGame 產生再覆蓋（手刻會缺欄位 → ATTACK 靜默不執行）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.m6aw1-s.js'), E = join(ROOT, '.m6aw1-e.ts'), O = join(ROOT, '.m6aw1-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction, createGame } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, createGame } = await import(pathToFileURL(O).href);

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
const isEx = (c) => /ex$/.test(c.name || '');
const BASE_OK = (c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length && !isEx(c);
const PLAIN = pick(BASE_OK);
if (!PLAIN) throw new Error('harness 找不到測試用受方寶可夢');
/**
 * ⚠⚠ 受方一律挑「對出招者的屬性**中立**」的寶可夢 —— 弱點會把傷害×2、抵抗會-20，
 *   拿隨便一隻當靶，哨兵的「卡面傷害有結算」就會對不上（實測踩到 4 次：
 *   路卡利歐(鬥)打到弱鬥的靶 →200、賽富豪/伽勒爾喵喵(鋼)打到抗鋼的靶 →-20）。
 *   ⭐ 這是**避開**修正子，不是在守衛裡重寫一份弱抗公式（Rule 38）。
 */
const typeOf = (c) => c?.pokemonType ?? null;
const neutralFor = (atk) => {
  const t = typeOf(atk);
  const c = pick((x) => BASE_OK(x) && (!t || (x.weakness?.type !== t && x.resistance?.type !== t)));
  return c ?? PLAIN;
};

function run(atkName, atk, opt = {}) {
  const def = opt.def ?? neutralFor(atk);
  const ai = (atk.attacks || []).findIndex((a) => a.name === atkName);
  if (ai < 0) return { __err: '找不到招式 ' + atkName };
  const A = inst(atk.id, opt.atkPatch || {});
  A.energyAttached = [
    ...((atk.attacks[ai].cost) || []).map((t) => inst(EID[t] ?? FILL)),
    ...Array.from({ length: opt.extraEnergy ?? 0 }, () => inst(FILL)),
  ];
  const D = inst(def.id, opt.defPatch || {});
  if (opt.defEnergy) D.energyAttached = Array.from({ length: opt.defEnergy }, () => inst(FILL));
  const s0 = createGame({ name: 'P1', entries: [{ cardId: String(atk.id), count: 1 }] },
    { name: 'P2', entries: [{ cardId: String(def.id), count: 1 }] }, pool);
  const oppBench = Array.from({ length: opt.oppBench ?? 1 }, () => inst(def.id));
  const selfBench = Array.from({ length: opt.selfBench ?? 0 }, () => inst(atk.id));
  const st = {
    ...s0, phase: 'playing', turnPhase: 'main', turn: 5, activePlayerIndex: 0, firstPlayerIdx: 0,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
    activeStadium: null, activeStadiumOwnerIdx: 0, pendingSelection: null, log: [],
    players: [
      { ...s0.players[0], active: A, bench: selfBench, hand: [],
        deck: Array.from({ length: opt.deckN ?? 3 }, () => inst(PLAIN.id)), discard: [],
        prizes: Array.from({ length: 6 }, () => inst(def.id)) },
      { ...s0.players[1], active: D, bench: oppBench, hand: [],
        deck: Array.from({ length: 3 }, () => inst(def.id)), discard: [],
        prizes: Array.from({ length: 6 }, () => inst(def.id)) },
    ],
  };
  // ⚠ opt.coins：逐次指定硬幣（'H'/'T'），給「擲到反面為止」這種需要**中途停**的招式用；
  //   只用 opt.heads 的話正面會一路擲到安全上限，測不到真正的中間值。
  const seq = opt.coins ? [...opt.coins] : null;
  let ci = 0;
  const orig = Math.random;
  Math.random = () => {
    if (seq) { const v = seq[ci++]; return v === 'H' ? 0.1 : 0.9; }
    return opt.heads === false ? 0.9 : 0.1;
  };
  let out;
  try { out = applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool); }
  catch (e) { out = { __err: e.message }; }
  finally { Math.random = orig; }
  return out;
}
const dmgOf = (r) => r?.players?.[1]?.active?.damage ?? -1;
const selfDmg = (r) => r?.players?.[0]?.active?.damage ?? -1;
const benchDmg = (r, i = 0) => r?.players?.[1]?.bench?.[i]?.damage ?? -1;
const handN = (r) => r?.players?.[0]?.hand?.length ?? -1;
/** 狀態三槽（v5.295）任一槽命中即算 —— 只看 status 主格會漏掉中毒/灼傷被搬到副槽的情形。 */
const hasStatus = (inst2, s) => !!inst2 && (inst2.status === s || inst2.secondaryStatus === s || inst2.tertiaryStatus === s);
const defHas = (r, s) => hasStatus(r?.players?.[1]?.active, s);
/** 卡面傷害（字串可能是 '' / '80' / '10+' / '20×'） */
/** 把 pending picker 解掉（真的走一次 RESOLVE_SELECTION），才算驗到「打了幾點」。 */
const resolve = (r, iids) => applyAction(r, { type: 'RESOLVE_SELECTION', selectedIids: iids, actorIdx: 0 }, pool);
const faceDmg = (card, atkName) => {
  const a = (card.attacks || []).find((x) => x.name === atkName);
  const m = /^(\d+)/.exec(String(a?.damage ?? ''));
  return m ? Number(m[1]) : 0;
};

console.log('\n【0】harness 自驗（沒有這一段，下面全部可能是空真）');
{
  // 既有卡、既有 helper：確認 run() 真的把招式跑完了
  const c = find('閃電鳥', '雷轟');
  chk('0a fixture：抓得到 M6a 的閃電鳥｜雷轟', !!c && String(c.setCode) === 'M6a', String(c?.setCode));
  const r = run('雷轟', c);
  chk('0b ⭐哨兵：卡面 210 點傷害真的結算了（否則下面的效果斷言都是空真）', dmgOf(r) === 210, String(dmgOf(r)));
  chk('0c ⭐反安慰劑：不存在的招式名會回 __err（run() 不會默默成功）',
    !!run('這招不存在', c).__err);
  // ⭐ Rule 25：靶的挑法自己要先驗 —— 中立靶對出招者屬性必須既不弱也不抗
  const luc = find('路卡利歐', '波導彈');
  const t = typeOf(luc), nd = neutralFor(luc);
  chk('0d ⭐harness 自驗：中立靶對出招者屬性既不弱也不抗',
    !!t && nd.weakness?.type !== t && nd.resistance?.type !== t,
    `atkType=${t} target=${nd.name} weak=${nd.weakness?.type} res=${nd.resistance?.type}`);
  chk('0e ⭐反安慰劑：拿「弱點正好是出招者屬性」的靶，傷害真的會變兩倍（證明 0d 有意義）',
    (() => {
      const weakTarget = pick((x) => BASE_OK(x) && x.weakness?.type === t);
      if (!weakTarget) return false;
      return dmgOf(run('波導彈', luc, { def: weakTarget })) === 200;
    })());
}

console.log('\n【A】必中狀態（statusPost）');
for (const [cn, an, st2] of [['蛋蛋', '催眠術', 'asleep'], ['彩粉蝶', '毒粉', 'poisoned'], ['呆火鱷ex', '灼熱', 'burned']]) {
  const c = find(cn, an); const r = run(an, c);
  chk(`A ${cn}｜${an} → 對手【${st2}】`, defHas(r, st2), JSON.stringify(r?.players?.[1]?.active?.status));
  chk(`A ${cn}｜${an} 哨兵：卡面傷害 ${faceDmg(c, an)} 有結算`, dmgOf(r) === faceDmg(c, an), String(dmgOf(r)));
}
{
  const c = find('水晶燈火靈', '奇異燈火'); const r = run('奇異燈火', c);
  chk('A ⭐水晶燈火靈｜奇異燈火 → 灼傷**與**混亂兩種都在（雙狀態不可以只中一個）',
    defHas(r, 'burned') && defHas(r, 'confused'),
    JSON.stringify([r?.players?.[1]?.active?.status, r?.players?.[1]?.active?.secondaryStatus, r?.players?.[1]?.active?.tertiaryStatus]));
  chk('A 水晶燈火靈｜奇異燈火 哨兵：130 點傷害有結算', dmgOf(r) === 130, String(dmgOf(r)));
}
{
  // 正對照：既有卡走同一支 statusPost
  const c = find('隨風球', '不祥之風');
  if (c) chk('A ⭐正對照：既有「隨風球｜不祥之風」同樣中【混亂】', defHas(run('不祥之風', c), 'confused'));
  else chk('A 正對照卡存在', false, '找不到 隨風球|不祥之風');
}

console.log('\n【B】擲幣狀態（coinStatusPost）');
for (const [cn, an] of [['拉普拉斯', '冰凍光束'], ['皮卡丘', '電擊']]) {
  const c = find(cn, an);
  const rH = run(an, c, { heads: true }); const rT = run(an, c, { heads: false });
  chk(`B ${cn}｜${an} 正面 → 【麻痺】`, defHas(rH, 'paralyzed'), JSON.stringify(rH?.players?.[1]?.active?.status));
  chk(`B ⭐${cn}｜${an} 反面 → **不**麻痺（正反對照）`, !defHas(rT, 'paralyzed'), JSON.stringify(rT?.players?.[1]?.active?.status));
  chk(`B ${cn}｜${an} 哨兵：兩面都照樣結算 ${faceDmg(c, an)} 點傷害`,
    dmgOf(rH) === faceDmg(c, an) && dmgOf(rT) === faceDmg(c, an), `${dmgOf(rH)}/${dmgOf(rT)}`);
}

console.log('\n【C】自我恢復（selfHealPost）');
for (const [cn, an, heal] of [['阿羅拉 椰蛋樹', '超級吸取', 50], ['皮卡丘', '小憩', 30]]) {
  const c = find(cn, an);
  const r = run(an, c, { atkPatch: { damage: 100 } });
  chk(`C ${cn}｜${an} → 自己恢復 ${heal}（100 → ${100 - heal}）`, selfDmg(r) === 100 - heal, String(selfDmg(r)));
  const r0 = run(an, c);
  chk(`C ⭐${cn}｜${an} 沒受傷時不會變成負傷害`, selfDmg(r0) === 0, String(selfDmg(r0)));
}

console.log('\n【D】自傷（selfHitPost）—— 代價型，不實裝＝卡比實體卡強');
for (const [cn, an, self] of [['皮卡丘', '伏特攻擊', 30], ['皮卡丘', '撞一下', 10], ['閃電鳥', '雷轟', 60]]) {
  const c = find(cn, an); const r = run(an, c);
  chk(`D ${cn}｜${an} → 自己受到 ${self} 點`, selfDmg(r) === self, String(selfDmg(r)));
  chk(`D ${cn}｜${an} 哨兵：對手照樣受到卡面 ${faceDmg(c, an)} 點`, dmgOf(r) === faceDmg(c, an), String(dmgOf(r)));
}

console.log('\n【E】鎖招（selfCantAttackNextPost vs rechargePost 是兩種機制）');
for (const [cn, an] of [['顫弦蠑螈', '閃電伏特'], ['超夢ex', '超能之力']]) {
  const c = find(cn, an); const r = run(an, c);
  chk(`E ${cn}｜${an} → cantAttackPending（鎖**全部**招式）`,
    r?.players?.[0]?.active?.cantAttackPending === true, JSON.stringify(r?.players?.[0]?.active?.cantAttackPending));
}
{
  const c = find('蒼響', '猛擊在地'); const r = run('猛擊在地', c);
  const blocked = r?.players?.[0]?.active?.blockedAttackNamesNextTurn ?? [];
  chk('E ⭐蒼響｜猛擊在地 → 只鎖「猛擊在地」這一招（不是鎖全部）',
    blocked.includes('猛擊在地') && r?.players?.[0]?.active?.cantAttackPending !== true, JSON.stringify(blocked));
}

console.log('\n【F】擲幣改寫傷害');
{
  const c = find('弱丁魚', '偷襲');
  chk('F 弱丁魚｜偷襲 正面 → 30', dmgOf(run('偷襲', c, { heads: true })) === 30, String(dmgOf(run('偷襲', c, { heads: true }))));
  chk('F ⭐弱丁魚｜偷襲 反面 → 招式失敗（0 傷害）', dmgOf(run('偷襲', c, { heads: false })) === 0, String(dmgOf(run('偷襲', c, { heads: false }))));
}
{
  const c = find('皮卡丘', '嬉鬧');
  chk('F 皮卡丘｜嬉鬧 正面 → 10+20=30', dmgOf(run('嬉鬧', c, { heads: true })) === 30, String(dmgOf(run('嬉鬧', c, { heads: true }))));
  chk('F ⭐皮卡丘｜嬉鬧 反面 → 只有 10', dmgOf(run('嬉鬧', c, { heads: false })) === 10, String(dmgOf(run('嬉鬧', c, { heads: false }))));
}
{
  const c = find('賽富豪', '三重粉碎');
  chk('F 賽富豪｜三重粉碎 三正面 → 3×50=150', dmgOf(run('三重粉碎', c, { heads: true })) === 150, String(dmgOf(run('三重粉碎', c, { heads: true }))));
  chk('F ⭐賽富豪｜三重粉碎 全反面 → 0', dmgOf(run('三重粉碎', c, { heads: false })) === 0, String(dmgOf(run('三重粉碎', c, { heads: false }))));
}
{
  const c = find('皮卡丘', '鐵尾');
  // 擲到反面為止 ⇒ 用逐次序列才測得到「中途停」：HHT = 2 次正面 = 2×20 = 40。
  //   ⚠ 不可以用「一路正面」測 —— 會撞中央 helper 的 20 次安全上限打出 400 直接把靶打死，
  //     dmgOf 讀到的是 null active（-1），看起來像 FAIL 其實是靶死了。
  chk('F 皮卡丘｜鐵尾 正正反 → 2×20 = 40', dmgOf(run('鐵尾', c, { coins: ['H', 'H', 'T'] })) === 40,
    String(dmgOf(run('鐵尾', c, { coins: ['H', 'H', 'T'] }))));
  chk('F ⭐皮卡丘｜鐵尾 第一次就反面 → 0', dmgOf(run('鐵尾', c, { coins: ['T'] })) === 0,
    String(dmgOf(run('鐵尾', c, { coins: ['T'] }))));
  chk('F ⭐反安慰劑：coins 序列真的被吃到（HT 與 HHT 結果不同）',
    dmgOf(run('鐵尾', c, { coins: ['H', 'T'] })) === 20);
}

console.log('\n【G】抽 1 張（drawNPost）');
for (const cn of ['皮卡丘', '阿羅拉 喵喵', '伽勒爾 喵喵', '喵喵']) {
  const an = cn === '皮卡丘' ? '晚間散步' : '聚寶功';
  const c = find(cn, an); const r = run(an, c, { deckN: 3 });
  chk(`G ${cn}｜${an} → 手牌 +1、牌庫 -1`,
    handN(r) === 1 && r?.players?.[0]?.deck?.length === 2, `hand=${handN(r)} deck=${r?.players?.[0]?.deck?.length}`);
  chk(`G ${cn}｜${an} 哨兵：卡面 ${faceDmg(c, an)} 點傷害有結算`, dmgOf(r) === faceDmg(c, an), String(dmgOf(r)));
}

console.log('\n【H】狙擊／全體');
for (const [cn, an, snipe] of [['皮卡丘', '電光', 20], ['路卡利歐', '波導彈', 60]]) {
  const c = find(cn, an); const r = run(an, c, { oppBench: 1 });
  // ⚠⚠ 原本寫成「打到了 **或** 有開 picker」—— 突變 M8 把 60 改成 20 照樣全綠（安慰劑）。
  //   ⇒ 改成**把 picker 真的解掉**再看備戰吃了幾點，數字錯就一定紅。
  const pend = r?.pendingSelection;
  const after = pend?.type === 'opp-bench-choose'
    ? resolve(r, [r.players[1].bench[0].iid])
    : r;
  chk(`H ${cn}｜${an} → 解完 picker 後對手備戰實際受到 ${snipe} 點`,
    benchDmg(after) === snipe,
    `pending=${pend?.type} benchBefore=${benchDmg(r)} benchAfter=${benchDmg(after)}`);
  chk(`H ${cn}｜${an} 哨兵：戰鬥場照樣受到卡面 ${faceDmg(c, an)} 點`, dmgOf(r) === faceDmg(c, an), String(dmgOf(r)));
}
{
  const c = find('皮卡丘', '瞄準電光'); const r = run('瞄準電光', c, { oppBench: 2 });
  chk('H ⭐皮卡丘｜瞄準電光 → 開「對手 1 隻**寶可夢**」picker（卡面含戰鬥場，不是只有備戰）',
    r?.pendingSelection?.type === 'opp-poke-choose', JSON.stringify(r?.pendingSelection?.type));
  // ⭐ 選**戰鬥場**那一隻 → 證明 picker 真的含戰鬥位（用 opp-bench-choose 就選不到）
  const onActive = resolve(r, [r.players[1].active.iid]);
  chk('H ⭐皮卡丘｜瞄準電光 選戰鬥場 → 戰鬥場吃 20 點', dmgOf(onActive) === 20, String(dmgOf(onActive)));
  const onBench = resolve(r, [r.players[1].bench[1].iid]);
  chk('H 皮卡丘｜瞄準電光 選備戰 → 那一隻吃 20 點', benchDmg(onBench, 1) === 20, String(benchDmg(onBench, 1)));
}
{
  const c = find('急凍鳥', '冰雹'); const r = run('冰雹', c, { oppBench: 2 });
  chk('H 急凍鳥｜冰雹 → 對手戰鬥場與**所有**備戰各 30',
    dmgOf(r) === 30 && benchDmg(r, 0) === 30 && benchDmg(r, 1) === 30,
    `active=${dmgOf(r)} b0=${benchDmg(r, 0)} b1=${benchDmg(r, 1)}`);
  // ⭐⭐ 這是「傷害」不是「放置傷害指示物」：戰鬥場那一份必須走 mainline ⇒ **會算弱點**。
  //   （第一版用錯 helper 打成指示物型，弱點不會生效、預估也報不出數字。）
  const weakTarget = pick((x) => BASE_OK(x) && x.weakness?.type === typeOf(c));
  if (weakTarget) {
    const rw = run('冰雹', c, { def: weakTarget, oppBench: 1 });
    chk('H ⭐急凍鳥｜冰雹 戰鬥場吃弱點 ×2 = 60，備戰仍是 30（卡面：備戰不計弱抗）',
      dmgOf(rw) === 60 && benchDmg(rw, 0) === 30, `active=${dmgOf(rw)} bench=${benchDmg(rw, 0)}`);
  } else chk('H 冰雹弱點對照組存在', false, '找不到弱水的基礎寶可夢');
  // ⭐ 正對照：既有同措辭卡（雪絨蛾｜冰凍羽擊）走同一條路
  const sx = find('雪絨蛾', '冰凍羽擊');
  if (sx) {
    const rs = run('冰凍羽擊', sx, { oppBench: 2 });
    chk('H ⭐正對照：既有「雪絨蛾｜冰凍羽擊」同樣是戰鬥場+備戰各 20',
      dmgOf(rs) === 20 && benchDmg(rs, 0) === 20 && benchDmg(rs, 1) === 20,
      `active=${dmgOf(rs)} b0=${benchDmg(rs, 0)} b1=${benchDmg(rs, 1)}`);
  } else chk('H 正對照卡存在', false, '找不到 雪絨蛾|冰凍羽擊');
}

console.log(`\nm6a-wave1：PASS ${pass} / FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
