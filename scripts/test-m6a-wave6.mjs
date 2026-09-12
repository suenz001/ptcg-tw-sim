// v6.346 守衛（M6a 批次6）：15 招，一律用**完整 ATTACK 流程**驗證行為，不驗字串存在。
//   ⭐ 每一條都附「哨兵」：卡面傷害真的結算了 ／ `active.attackUsedThisTurn === 招式名`
//     （後者是 0 傷害招式的哨兵 —— 招式若根本沒被執行（key 打錯／import 漏接／費用付不出來
//      ⇒ ATTACK 靜默 return），效果斷言會是空真，dmg===0 也會「剛好」成立）。
//   ⭐ 每一型都附正對照：同一支 helper 的**既有卡**必須同樣通過，harness 自己壞掉時會一起紅；
//     並盡量附**反對照**（同一支 helper 的另一個數值／另一種旗標），證明數字不是寫死在 helper 裡。
//   ⭐⭐ 本批三個「主詞」不同的旗標（自己受傷 -／對手出招 -／對手受傷 +）一律**交叉互斥斷言**：
//      該設的那一個要對，另外兩個必須不存在 —— 機制互換的突變才會紅。
//   ⚠ 基本能量 id 依名稱查（硬編會付不出費用 → ATTACK 靜默 return → 假 FAIL）。
//   ⚠ state 一律由 createGame 產生再覆蓋（手刻會缺欄位 → ATTACK 靜默不執行）。
//   ⚠ 靶一律用 neutralFor(atk)：弱點×2／抵抗-20 會把哨兵打歪（批次1 踩過四次）。
//   ⚠ 大傷害招式的靶要挑 HP 夠高的（打死了 players[1].active 變 null，damage 讀成 -1 ⇒ 假 FAIL）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.m6aw6-s.js'), E = join(ROOT, '.m6aw6-e.ts'), O = join(ROOT, '.m6aw6-o.mjs');
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
/** 乾淨靶：沒有特性、不是太晶 ⇒ 不會有額外免疫／減傷把數字打歪。 */
const CLEAN_ANY = (c) => c.supertype === 'Pokemon' && !(c.abilities || []).length
  && !(c.tags || []).includes('太晶');
const CLEAN = (c) => CLEAN_ANY(c) && !isEx(c);
const BASE_OK = (c) => CLEAN(c) && c.stage === 'Basic';
const PLAIN = pick(BASE_OK);
if (!PLAIN) throw new Error('harness 找不到測試用受方寶可夢');
const typeOf = (c) => c?.pokemonType ?? null;
const isNeutral = (x, t) => !t || (x.weakness?.type !== t && x.resistance?.type !== t);
/** ⚠⚠ 受方一律挑「對出招者的屬性**中立**」的寶可夢（弱點×2／抵抗-20 會把哨兵打歪）。 */
const neutralFor = (atk) => pick((x) => BASE_OK(x) && isNeutral(x, typeOf(atk))) ?? PLAIN;
/** 高 HP 中立靶：給大傷害招式當哨兵用（打死了就讀不到 damage）。允許 ex（HP 夠高的只有 ex）。 */
const bigNeutralFor = (atk, minHp) =>
  pick((x) => CLEAN_ANY(x) && Number(x.hp) >= minHp && isNeutral(x, typeOf(atk)));
/** 高 HP + 弱點正好是出招者屬性的靶（驗「弱點有沒有被跳過」）。 */
const bigWeakFor = (atk, minHp) =>
  pick((x) => CLEAN_ANY(x) && Number(x.hp) >= minHp && x.weakness?.type === typeOf(atk));
/** 低 HP 中立靶：給「要打死對手」的招式用。 */
const smallNeutralFor = (atk, maxHp) =>
  pick((x) => BASE_OK(x) && Number(x.hp) <= maxHp && isNeutral(x, typeOf(atk)));

const HIDDEN = '19149';  // 斯魔茶｜化隱（招式效果免疫；test-oppdebuff-immunity-converge.mjs 同一張）

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
  // ⚠ opt.oppBenchCards：逐格指定對手備戰用哪張卡（光子彈要驗「ex 才打、非 ex 不打」）
  const oppBench = opt.oppBenchCards
    ? opt.oppBenchCards.map((c) => inst(c.id))
    : Array.from({ length: opt.oppBench ?? 1 }, () => inst(def.id));
  const selfBench = Array.from({ length: opt.selfBench ?? 0 }, () => inst((opt.selfBenchCard ?? atk).id));
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
  const orig = Math.random;
  Math.random = () => (opt.heads === false ? 0.9 : 0.1);
  let out;
  try { out = applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool); }
  catch (e) { out = { __err: e.message }; }
  finally { Math.random = orig; }
  return out;
}
const dmgOf = (r) => r?.players?.[1]?.active?.damage ?? -1;
const benchDmg = (r, i = 0) => r?.players?.[1]?.bench?.[i]?.damage ?? -1;
const selfBenchDmg = (r, i = 0) => r?.players?.[0]?.bench?.[i]?.damage ?? -1;
const prizesLeft = (r) => r?.players?.[0]?.prizes?.length ?? -1;
/** ⭐ 通用哨兵：招式真的被引擎執行完（v2.69 於 ATTACK_POST 後寫入攻擊方 active）。 */
const usedAtk = (r) => r?.players?.[0]?.active?.attackUsedThisTurn ?? null;
const logHas = (r, s) => (r?.log ?? []).some((l) => String(l?.message ?? l?.text ?? l).includes(s));
const resolve = (r, iids) => applyAction(r, { type: 'RESOLVE_SELECTION', selectedIids: iids, actorIdx: 0 }, pool);
const faceDmg = (card, atkName) => {
  const a = (card.attacks || []).find((x) => x.name === atkName);
  const m = /^(\d+)/.exec(String(a?.damage ?? ''));
  return m ? Number(m[1]) : 0;
};
const A0 = (r) => r?.players?.[0]?.active;
const D0 = (r) => r?.players?.[1]?.active;

console.log('\n【0】harness 自驗（沒有這一段，下面全部可能是空真）');
{
  const c = find('閃電鳥', '雷轟');
  chk('0a fixture：抓得到 M6a 的閃電鳥｜雷轟', !!c && String(c.setCode) === 'M6a', String(c?.setCode));
  const r = run('雷轟', c);
  chk('0b ⭐哨兵：卡面 210 點傷害真的結算了', dmgOf(r) === 210, String(dmgOf(r)));
  chk('0c ⭐反安慰劑：不存在的招式名會回 __err', !!run('這招不存在', c).__err);
  const luc = find('路卡利歐', '波導彈');
  const t = typeOf(luc), nd = neutralFor(luc);
  chk('0d ⭐harness 自驗：中立靶對出招者屬性既不弱也不抗',
    !!t && nd.weakness?.type !== t && nd.resistance?.type !== t, `atkType=${t} target=${nd.name}`);
  chk('0e ⭐反安慰劑：拿「弱點正好是出招者屬性」的靶，傷害真的變兩倍（證明 0d 有意義）',
    (() => {
      const weakTarget = pick((x) => BASE_OK(x) && x.weakness?.type === t);
      return !!weakTarget && dmgOf(run('波導彈', luc, { def: weakTarget })) === 200;
    })());
  chk('0f ⭐哨兵自驗：0 傷害招式跑完後 attackUsedThisTurn 會等於招式名',
    usedAtk(run('催眠術', find('蛋蛋', '催眠術'))) === '催眠術');
  chk('0g ⭐反安慰劑：沒跑招式的原始 state，attackUsedThisTurn 是 null',
    usedAtk({ players: [{ active: { damage: 0 } }, {}] }) === null);
  chk('0h ⭐harness 自驗：化隱（斯魔茶）fixture 抓得到', pool.get(HIDDEN)?.name === '斯魔茶', String(pool.get(HIDDEN)?.name));
}

console.log('\n【A】擲幣正面 → 下個對手回合「不會受到招式的傷害與效果的影響」（2 招）');
for (const [cn, an] of [['呆呆獸', '藏入井裡'], ['皮卡丘', '高速移動']]) {
  const c = find(cn, an);
  const rH = run(an, c, { heads: true }), rT = run(an, c, { heads: false });
  chk(`A ${cn}｜${an} 正面 → immuneToAllAttackNextTurn`,
    A0(rH)?.immuneToAllAttackNextTurn === true, JSON.stringify(A0(rH)?.immuneToAllAttackNextTurn));
  chk(`A ⭐${cn}｜${an} 正面 → **不是**「只免傷害」那一支（immuneToAttackDamageNextTurn 必須沒有）`,
    !A0(rH)?.immuneToAttackDamageNextTurn, JSON.stringify(A0(rH)?.immuneToAttackDamageNextTurn));
  chk(`A ⭐${cn}｜${an} 反面 → 兩個免疫旗標都沒有（正反對照）`,
    !A0(rT)?.immuneToAllAttackNextTurn && !A0(rT)?.immuneToAttackDamageNextTurn,
    JSON.stringify([A0(rT)?.immuneToAllAttackNextTurn, A0(rT)?.immuneToAttackDamageNextTurn]));
  chk(`A ${cn}｜${an} 哨兵：卡面傷害 ${faceDmg(c, an)} 有結算 + 招式真的跑過`,
    dmgOf(rH) === faceDmg(c, an) && usedAtk(rH) === an, `dmg=${dmgOf(rH)} used=${usedAtk(rH)}`);
}
{
  const c = find('土龍弟弟', '挖洞');
  chk('A ⭐正對照：既有「土龍弟弟｜挖洞」同樣是 immuneToAllAttackNextTurn',
    A0(run('挖洞', c, { heads: true }))?.immuneToAllAttackNextTurn === true);
  const w = find('七夕青鳥', '棉花之翼');
  const rw = run('棉花之翼', w, { heads: true });
  chk('A ⭐反對照：既有「七夕青鳥｜棉花之翼」是**只免傷害**（證明兩支 helper 分得開）',
    A0(rw)?.immuneToAttackDamageNextTurn === true && !A0(rw)?.immuneToAllAttackNextTurn);
}

console.log('\n【B】將這隻寶可夢的特殊狀態全部恢復（1 招 + 收斂後的既有卡）');
{
  const THREE = { status: 'confused', secondaryStatus: 'burned', tertiaryStatus: 'poisoned' };
  const c = find('皮卡丘', '吹吹風');
  const r = run('吹吹風', c, { atkPatch: { ...THREE } });
  chk('B 皮卡丘｜吹吹風 → 自己身上的特殊狀態全部恢復（⭐三槽都要清）',
    !!A0(r) && !A0(r).status && !A0(r).secondaryStatus && !A0(r).tertiaryStatus,
    JSON.stringify([A0(r)?.status, A0(r)?.secondaryStatus, A0(r)?.tertiaryStatus]));
  chk('B 皮卡丘｜吹吹風 哨兵：招式真的跑過', usedAtk(r) === '吹吹風', String(usedAtk(r)));
  chk('B ⭐反安慰劑：同一張卡不使用吹吹風（改用「踢飛」）時，三槽狀態原封不動',
    (() => { const r2 = run('踢飛', c, { atkPatch: { ...THREE } }); return A0(r2)?.secondaryStatus === 'burned' && A0(r2)?.tertiaryStatus === 'poisoned'; })());
  const o = find('奧利瓦ex', '芳香射擊');
  const ro = run('芳香射擊', o, { atkPatch: { ...THREE } });
  chk('B ⭐正對照（本版收斂）：既有「奧利瓦ex｜芳香射擊」同樣三槽全清',
    !!A0(ro) && !A0(ro).status && !A0(ro).secondaryStatus && !A0(ro).tertiaryStatus,
    JSON.stringify([A0(ro)?.status, A0(ro)?.secondaryStatus, A0(ro)?.tertiaryStatus]));
  chk('B 奧利瓦ex｜芳香射擊 哨兵：卡面 160 有結算', dmgOf(ro) === 160, String(dmgOf(ro)));
}

console.log('\n【C】⭐⭐ 三個「主詞」不同的跨回合旗標（互斥交叉斷言）');
// self  = 自己受招式傷害 -N（damageReduceNextHit）
// defAtk= 受招者**使用**招式傷害 -N（nextOwnAttackPenalty，寫在對手身上）
// defTk = 受招者**受到**招式傷害 +N（takeExtraDamageNextTurn，寫在對手身上）
const FLAGS = (r) => ({
  self: A0(r)?.damageReduceNextHit,
  defAtk: D0(r)?.nextOwnAttackPenalty,
  defTk: D0(r)?.takeExtraDamageNextTurn,
});
for (const [cn, an, kind, val] of [
  ['科斯莫姆', '凝固', 'self', 60],
  ['藏瑪然特', '盾牌壓制', 'self', 50],
  ['尼多蘭', '叫聲', 'defAtk', 30],
  ['心鱗寶', '刺耳聲', 'defTk', 30],
]) {
  const c = find(cn, an); const r = run(an, c);
  const f = FLAGS(r);
  chk(`C ${cn}｜${an} → ${kind} = ${val}`, f[kind] === val, JSON.stringify(f));
  chk(`C ⭐${cn}｜${an} 主詞互斥：另外兩個旗標必須完全沒有`,
    Object.entries(f).every(([k, v]) => k === kind || v === undefined), JSON.stringify(f));
  chk(`C ${cn}｜${an} 哨兵：卡面傷害 ${faceDmg(c, an)} 有結算 + 招式真的跑過`,
    dmgOf(r) === faceDmg(c, an) && usedAtk(r) === an, `dmg=${dmgOf(r)} used=${usedAtk(r)}`);
}
{
  chk('C ⭐正對照：既有「樹林龜｜甲殼衝撞」= 自己受傷 -20',
    FLAGS(run('甲殼衝撞', find('樹林龜', '甲殼衝撞'))).self === 20);
  chk('C ⭐正對照：既有「嘎啦嘎啦｜叫聲」= 對手出招 -40',
    FLAGS(run('叫聲', find('嘎啦嘎啦', '叫聲'))).defAtk === 40);
  chk('C ⭐正對照：既有「超音波幼蟲｜刺耳聲」= 對手受傷 +50',
    FLAGS(run('刺耳聲', find('超音波幼蟲', '刺耳聲'))).defTk === 50);
}
for (const [cn, an, kind] of [['尼多蘭', '叫聲', 'defAtk'], ['心鱗寶', '刺耳聲', 'defTk']]) {
  const r = run(an, find(cn, an), { def: pool.get(HIDDEN) });
  chk(`C ⭐免疫閘：${cn}｜${an} 對「斯魔茶｜化隱」不施加 ${kind}`,
    FLAGS(r)[kind] === undefined, JSON.stringify(FLAGS(r)));
  chk(`C ${cn}｜${an} 免疫閘哨兵：招式本身確實跑過（不是靜默 return）`, usedAtk(r) === an, String(usedAtk(r)));
}

console.log('\n【D】受招者弱點改為【雷】屬性（1 招）');
{
  const c = find('皮卡丘', '覆蓋伏特'); const r = run('覆蓋伏特', c);
  chk('D 皮卡丘｜覆蓋伏特 → 對手 weaknessOverrideTypeNextTurn = Lightning',
    D0(r)?.weaknessOverrideTypeNextTurn === 'Lightning', JSON.stringify(D0(r)?.weaknessOverrideTypeNextTurn));
  chk('D 皮卡丘｜覆蓋伏特 哨兵：卡面 10 有結算', dmgOf(r) === 10, String(dmgOf(r)));
  const ri = run('覆蓋伏特', c, { def: pool.get(HIDDEN) });
  chk('D ⭐免疫閘：對「斯魔茶｜化隱」不改弱點',
    D0(ri)?.weaknessOverrideTypeNextTurn === undefined, JSON.stringify(D0(ri)?.weaknessOverrideTypeNextTurn));
  const z = find('智揮猩', '掌握弱點');
  chk('D ⭐正／反對照：既有「智揮猩｜掌握弱點」改為【無】（Colorless），不是【雷】',
    D0(run('掌握弱點', z))?.weaknessOverrideTypeNextTurn === 'Colorless',
    JSON.stringify(D0(run('掌握弱點', z))?.weaknessOverrideTypeNextTurn));
}

console.log('\n【E】全體／備戰「受到 N 點傷害」（⭐ 傷害型，不是指示物型）');
{
  // 068/103 固拉多｜大地裂破 250 — 自己的所有備戰各 20（⚠ 方向：自己，不是對手）
  const c = find('固拉多', '大地裂破');
  const big = bigNeutralFor(c, 260);
  chk('E fixture：找得到 HP≥260 的中立靶（哨兵要讀得到 250 傷害）', !!big, String(big?.hp));
  const r = run('大地裂破', c, { def: big, selfBench: 2, oppBench: 2 });
  chk('E 固拉多｜大地裂破 → **自己**所有備戰各 20',
    selfBenchDmg(r, 0) === 20 && selfBenchDmg(r, 1) === 20,
    `b0=${selfBenchDmg(r, 0)} b1=${selfBenchDmg(r, 1)}`);
  chk('E ⭐方向：對手的備戰完全**不**受影響（卡面是「自己的所有備戰」）',
    benchDmg(r, 0) === 0 && benchDmg(r, 1) === 0, `opp b0=${benchDmg(r, 0)} b1=${benchDmg(r, 1)}`);
  chk('E 固拉多｜大地裂破 哨兵：對手戰鬥場照樣受到卡面 250', dmgOf(r) === 250, String(dmgOf(r)));
  const az = find('穿山王', '地震');
  const rz = run('地震', az, { def: bigNeutralFor(az, 130), selfBench: 1 });
  chk('E ⭐正對照：既有「穿山王｜地震」同樣打自己的備戰 10（不是 20）',
    selfBenchDmg(rz, 0) === 10, String(selfBenchDmg(rz, 0)));
}
{
  // 083/103 堅果啞鈴｜轟爆尖刺 — 對手全體各 50 + 自己 130
  const c = find('堅果啞鈴', '轟爆尖刺');
  const r = run('轟爆尖刺', c, { oppBench: 2 });
  chk('E 堅果啞鈴｜轟爆尖刺 → 對手戰鬥場 50（走 mainline）', dmgOf(r) === 50, String(dmgOf(r)));
  chk('E 堅果啞鈴｜轟爆尖刺 → 對手**所有**備戰各 50',
    benchDmg(r, 0) === 50 && benchDmg(r, 1) === 50, `b0=${benchDmg(r, 0)} b1=${benchDmg(r, 1)}`);
  chk('E ⭐堅果啞鈴｜轟爆尖刺 → 自身受到 130 點傷害（log 逐字釘住數字）',
    logHas(r, '轟爆尖刺：自身受到 130 點傷害'), JSON.stringify((r?.log ?? []).slice(-6)));
  chk('E ⭐自傷 130 ≥ 自身 HP 130 → 攻擊方自我昏厥（active 已清空）',
    A0(r) === null || A0(r) === undefined, JSON.stringify(A0(r)?.damage));
  const weakT = pick((x) => BASE_OK(x) && x.weakness?.type === typeOf(c));
  if (weakT) {
    const rw = run('轟爆尖刺', c, { def: weakT, oppBench: 1 });
    chk('E ⭐轟爆尖刺 戰鬥場吃弱點 ×2 = 100，備戰仍是 50（卡面：備戰不計弱抗）',
      dmgOf(rw) === 100 && benchDmg(rw, 0) === 50, `active=${dmgOf(rw)} bench=${benchDmg(rw, 0)}`);
  } else chk('E 轟爆尖刺弱點對照組存在', false, '找不到弱鋼的基礎寶可夢');
}
{
  // 055/103 超夢ex｜光子彈 — 對手所有「寶可夢【ex】」各 50（戰鬥位**要**算弱抗）
  const c = find('超夢ex', '光子彈');
  const t = typeOf(c);  // Psychic
  const exOk = (x) => x.supertype === 'Pokemon' && isEx(x) && !(x.abilities || []).length
    && !(x.tags || []).includes('太晶') && Number(x.hp) >= 120;
  const exNeutral = pick((x) => exOk(x) && isNeutral(x, t));
  const exWeak = pick((x) => exOk(x) && x.weakness?.type === t);
  const nonEx = pick((x) => BASE_OK(x) && isNeutral(x, t));
  chk('E fixture：找得到中立 ex／弱超 ex／非 ex 三種靶',
    !!exNeutral && !!exWeak && !!nonEx, `${exNeutral?.name} / ${exWeak?.name} / ${nonEx?.name}`);
  const r = run('光子彈', c, { def: exNeutral, oppBenchCards: [exNeutral, nonEx] });
  chk('E 超夢ex｜光子彈 → 對手戰鬥位的 ex 受到 50', dmgOf(r) === 50, String(dmgOf(r)));
  chk('E 超夢ex｜光子彈 → 對手備戰的 ex 受到 50', benchDmg(r, 0) === 50, String(benchDmg(r, 0)));
  chk('E ⭐光子彈只打「寶可夢【ex】」：備戰的非 ex 完全不受傷害', benchDmg(r, 1) === 0, String(benchDmg(r, 1)));
  const rNon = run('光子彈', c, { def: nonEx, oppBenchCards: [nonEx] });
  chk('E ⭐光子彈：對手戰鬥位不是 ex ⇒ 0 傷害', dmgOf(rNon) === 0, String(dmgOf(rNon)));
  chk('E 光子彈 哨兵：招式真的跑過（0 傷害那一組也要跑過）', usedAtk(rNon) === '光子彈', String(usedAtk(rNon)));
  const rW = run('光子彈', c, { def: exWeak, oppBenchCards: [exWeak] });
  chk('E ⭐⭐光子彈 戰鬥位吃弱點 ×2 = 100（卡面只有「[在備戰區不計算弱點・抵抗力]」），備戰仍 50',
    dmgOf(rW) === 100 && benchDmg(rW, 0) === 50, `active=${dmgOf(rW)} bench=${benchDmg(rW, 0)}`);
  // ⭐ 反對照：既有 水伊布ex｜重磅驟雨 卡面另有「這個招式的傷害不計算弱點・抵抗力」⇒ 整招 flat
  const v = find('水伊布ex', '重磅驟雨');
  const exWeakW = pick((x) => exOk(x) && x.weakness?.type === typeOf(v));
  if (exWeakW) {
    const rv = run('重磅驟雨', v, { def: exWeakW, oppBenchCards: [exWeakW] });
    chk('E ⭐反對照：既有「水伊布ex｜重磅驟雨」戰鬥位**不**吃弱點（整招 flat）＝ 60，不是 120',
      dmgOf(rv) === 60, String(dmgOf(rv)));
  } else chk('E 重磅驟雨反對照組存在', false, '找不到弱水的 ex');
}

console.log('\n【F】放置傷害指示物（⭐ 指示物型，不計弱抗、不報預估）');
{
  // 076/103 耿鬼ex｜渾沌傷痛 — 對手 1 隻寶可夢放 13 個指示物（= 130）
  const c = find('耿鬼ex', '渾沌傷痛');
  const big = bigNeutralFor(c, 140);
  const r = run('渾沌傷痛', c, { def: big, oppBench: 2 });
  chk('F 耿鬼ex｜渾沌傷痛 → 開「對手 1 隻**寶可夢**」picker（含戰鬥場）',
    r?.pendingSelection?.type === 'opp-poke-choose', JSON.stringify(r?.pendingSelection?.type));
  const onActive = resolve(r, [r.players[1].active.iid]);
  chk('F ⭐渾沌傷痛 選戰鬥場 → 13 個指示物 = 130 點',
    onActive?.players?.[1]?.active?.damage === 130, String(onActive?.players?.[1]?.active?.damage));
  const onBench = resolve(r, [r.players[1].bench[1].iid]);
  chk('F 渾沌傷痛 選備戰 → 那一隻吃 130 點', benchDmg(onBench, 1) === 130, String(benchDmg(onBench, 1)));
  const weakBig = bigWeakFor(c, 150);
  if (weakBig) {
    const rw = run('渾沌傷痛', c, { def: weakBig, oppBench: 1 });
    const aw = resolve(rw, [rw.players[1].active.iid]);
    chk('F ⭐⭐渾沌傷痛 對弱惡的靶仍是 130（放指示物**不計弱點**，不是 260）',
      aw?.players?.[1]?.active?.damage === 130, String(aw?.players?.[1]?.active?.damage));
  } else chk('F 渾沌傷痛弱點對照組存在', false, '找不到 HP≥150 且弱惡的寶可夢');
  const s = find('綿綿泡芙', '悄聲加害');
  const rs = run('悄聲加害', s, { oppBench: 1 });
  const as_ = rs?.pendingSelection ? resolve(rs, [rs.players[1].active.iid]) : rs;
  chk('F ⭐正／反對照：既有「綿綿泡芙｜悄聲加害」＝ 2 個指示物 = 20 點（證明 13 不是寫死在 helper 裡）',
    as_?.players?.[1]?.active?.damage === 20, String(as_?.players?.[1]?.active?.damage));
}
{
  // 099/103 洗翠 索羅亞克｜嗟怨漩渦 — 放到剩餘 HP = 50
  const c = find('洗翠 索羅亞克', '嗟怨漩渦');
  const big = bigNeutralFor(c, 150);
  const r = run('嗟怨漩渦', c, { def: big });
  chk('F 洗翠 索羅亞克｜嗟怨漩渦 → 對手剩餘 HP 變成 50',
    dmgOf(r) === Number(big.hp) - 50, `hp=${big?.hp} dmg=${dmgOf(r)}`);
  const pre = Number(big.hp) - 40;
  const r2 = run('嗟怨漩渦', c, { def: big, defPatch: { damage: pre } });
  chk('F ⭐嗟怨漩渦：對手剩餘 HP 已經 40（≤50）⇒ 一個指示物都不放',
    dmgOf(r2) === pre, `before=${pre} after=${dmgOf(r2)}`);
  chk('F 嗟怨漩渦 哨兵：招式真的跑過', usedAtk(r) === '嗟怨漩渦', String(usedAtk(r)));
  const q = find('恰雷姆ex', '氣功指壓');
  const bq = bigNeutralFor(q, 150);
  const rq = run('氣功指壓', q, { def: bq });
  chk('F ⭐正對照：既有「恰雷姆ex｜氣功指壓」同樣放到剩 50',
    rq?.players?.[1]?.active?.damage === Number(bq.hp) - 50, `hp=${bq?.hp} dmg=${rq?.players?.[1]?.active?.damage}`);
  const w = find('蜈蚣王', '偏道一回');
  const bw = bigNeutralFor(w, 150);
  const rw2 = run('偏道一回', w, { def: bw });
  chk('F ⭐反對照：既有「蜈蚣王｜偏道一回」是放到剩 **10**（證明 50 不是寫死在 helper 裡）',
    rw2?.players?.[1]?.active?.damage === Number(bw.hp) - 10, `hp=${bw?.hp} dmg=${rw2?.players?.[1]?.active?.damage}`);
}

console.log('\n【G】因這個招式的傷害而昏厥 → 多獲得 1 張獎賞卡（1 招）');
{
  const c = find('未知圖騰', '神秘信號');
  const small = smallNeutralFor(c, 40);
  chk('G fixture：找得到 HP≤40 的中立非 ex 靶（40 點傷害要打得死、基本獎賞只有 1 張）',
    !!small && !isEx(small), `${small?.name} hp=${small?.hp}`);
  const rKO = run('神秘信號', c, { def: small, oppBench: 1 });
  chk('G ⭐未知圖騰｜神秘信號 打倒對手 → 取走 2 張獎賞（1 基本 + 1 加碼）',
    prizesLeft(rKO) === 4, String(prizesLeft(rKO)));
  // ⭐⭐ 反安慰劑：同一隻靶被**沒有加碼**的招式打死，只取 1 張 —— 證明上面那 2 張是加碼來的
  const z = find('閃電鳥', '雷轟');
  const rPlain = run('雷轟', z, { def: small, oppBench: 1 });
  chk('G ⭐⭐反安慰劑：同一隻靶被「閃電鳥｜雷轟」（無加碼）打死只取 1 張',
    prizesLeft(rPlain) === 5, String(prizesLeft(rPlain)));
  const big = bigNeutralFor(c, 100);
  const rNo = run('神秘信號', c, { def: big, oppBench: 1 });
  chk('G ⭐沒打倒對手 → 一張獎賞都不取（正反對照）', prizesLeft(rNo) === 6, String(prizesLeft(rNo)));
  chk('G 未知圖騰｜神秘信號 哨兵：卡面 40 有結算', dmgOf(rNo) === 40, String(dmgOf(rNo)));
  const t = find('鐵臂膀ex', '感激放大');
  const st = smallNeutralFor(t, 120);
  const rt = run('感激放大', t, { def: st, oppBench: 1 });
  chk('G ⭐正對照：既有「鐵臂膀ex｜感激放大」同樣是 1 基本 + 1 加碼 = 2 張',
    prizesLeft(rt) === 4, String(prizesLeft(rt)));
}

console.log('\n【H】不計算弱點・抵抗力與對手戰鬥位身上的附加效果（1 招）');
{
  const c = find('基拉祈ex', '高速星星');
  const t = typeOf(c);  // Metal
  const r = run('高速星星', c);
  chk('H 基拉祈ex｜高速星星 → 中立靶 150（卡面印刷值）', dmgOf(r) === 150, String(dmgOf(r)));
  const weakT = bigWeakFor(c, 160);
  if (weakT) chk('H ⭐skipWeakRes：弱鋼的靶仍然只有 150（不是 300）',
    dmgOf(run('高速星星', c, { def: weakT })) === 150, `${weakT.name} hp=${weakT.hp} dmg=${dmgOf(run('高速星星', c, { def: weakT }))}`);
  else chk('H 高速星星弱點對照組存在', false, '找不到 HP≥160 且弱鋼的寶可夢');
  const resT = pick((x) => CLEAN_ANY(x) && Number(x.hp) >= 160 && x.resistance?.type === t);
  if (resT) chk('H ⭐skipWeakRes：抗鋼的靶仍然是 150（不是 120）',
    dmgOf(run('高速星星', c, { def: resT })) === 150, `${resT.name} dmg=${dmgOf(run('高速星星', c, { def: resT }))}`);
  else chk('H 高速星星抵抗力對照組存在', false, '找不到 HP≥160 且抗鋼的寶可夢');
  const rd = run('高速星星', c, { defPatch: { damageReduceNextHit: 40 } });
  chk('H ⭐skipDefEffects：對手身上「下次被擊 -40」被忽略 ⇒ 仍是 150', dmgOf(rd) === 150, String(dmgOf(rd)));
  const z = find('閃電鳥', '雷轟');
  const rz = run('雷轟', z, { defPatch: { damageReduceNextHit: 40 } });
  chk('H ⭐反安慰劑：一般招式（閃電鳥｜雷轟 210）會被 -40 扣成 170（證明 H 的 -40 真的有掛上去）',
    dmgOf(rz) === 170, String(dmgOf(rz)));
  const a = find('安瓢蟲', '高速星星');
  chk('H ⭐正／反對照：既有「安瓢蟲｜高速星星」是 70（證明 150 不是寫死在 helper 裡）',
    dmgOf(run('高速星星', a)) === 70, String(dmgOf(run('高速星星', a))));
}

console.log('\n【I】静態接線（⚠ 縱深防禦層，行為端偵測不到 —— 誠實標註）');
// ⚠⚠ 實測（__m6a/mutcheck_w6.mjs M16／M17／M20）：把本批三招改成「手刻直接寫旗標、
//   繞過中央免疫閘」之後，上面【C】【D】的免疫斷言**仍然全綠** ——
//   因為 engine.ts 在 ATTACK_POST 之後還有一道由 `OPP_ATTACK_DEBUFF_FLAGS` 驅動的
//   「免疫還原 sweep」（v5.344／v6.046），會把免疫防守者身上本次新加的 debuff 旗標整批還原。
//   ⇒ 中央 helper 裡的免疫閘在行為上是**冗餘的第一層**。
//   這與 v6.210 `hitBenchAll` 的 inline bench guard 完全同型，處置照抄它的結論：
//   **不因為「測不出來」就把它拆掉或放著不管，而是用静態接線斷言把兩層都釘住**。
{
  const effSrc = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
  const w6Src = readFileSync(join(ROOT, 'src/lib/game/effects/cards/m6a_wave6.ts'), 'utf8');
  const flagSrc = readFileSync(join(ROOT, 'src/lib/game/instance-flags.ts'), 'utf8');
  const engSrc = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  // ⚠ 卡檔的說明註解本來就會逐字提到旗標名 ⇒ 負面斷言前先把註解行剝掉，否則是假 FAIL。
  const noComment = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const w6Code = noComment(w6Src);
  chk('I1 尼多蘭｜叫聲 走中央 defNextAtkReducePost（不得手刻寫 nextOwnAttackPenalty）',
    w6Src.includes("regPost('尼多蘭|叫聲', defNextAtkReducePost(30, '叫聲'));")
    && !/nextOwnAttackPenalty/.test(w6Code));
  chk('I2 心鱗寶｜刺耳聲 走中央 oppTargetTakeExtraNextPost（不得手刻寫 takeExtraDamageNextTurn）',
    effSrc.includes("regPost('心鱗寶|刺耳聲', oppTargetTakeExtraNextPost(30, '刺耳聲'));"));
  chk('I3 皮卡丘｜覆蓋伏特 走中央 applyOppActiveDebuffPost（不得手刻寫 weaknessOverrideTypeNextTurn）',
    /regPost\('皮卡丘\|覆蓋伏特', applyOppActiveDebuffPost\(/.test(w6Src)
    && (w6Code.match(/weaknessOverrideTypeNextTurn/g) || []).length === 1);
  // 三支中央 helper 各自的函式本體都必須「過閘 → blocked 就 return」
  const bodyOf = (s, sig) => {
    const i = s.indexOf(sig);
    if (i < 0) return '';
    const j = s.indexOf('\nfunction ', i + 1), k = s.indexOf('\nexport function ', i + 1);
    const end = Math.min(j < 0 ? s.length : j, k < 0 ? s.length : k);
    return s.slice(i, end);
  };
  for (const [sig, nm] of [
    ['export function defNextAtkReducePost(', 'defNextAtkReducePost'],
    ['function oppTargetTakeExtraNextPost(', 'oppTargetTakeExtraNextPost'],
    ['export function applyOppActiveDebuffPost(', 'applyOppActiveDebuffPost'],
  ]) {
    const body = bodyOf(effSrc, sig);
    // ⚠ 必須精準取出 `if (guard.blocked) { … }` **這個區塊**再找 return ——
    //   用 [\s\S]{0,N}?return 會被區塊外面的其他 return 滿足（＝安慰劑，mutcheck M46 抓到過）。
    const gi = body.indexOf('if (guard.blocked) {');
    const gj = gi < 0 ? -1 : body.indexOf('\n    }', gi);
    const blocked = gi >= 0 && gj > gi ? body.slice(gi, gj) : '';
    chk(`I4 ${nm} 本體含 attack-effect 免疫閘且 blocked 分支確實 return`,
      body.includes('canApplyAttackEffectToTarget(') && blocked.includes('return '),
      `blockedLen=${blocked.length} :: ${blocked.slice(0, 80)}`);
  }
  // 第二層（engine 的免疫還原 sweep）也要釘住 —— 它是行為端真正擋下來的那一層
  chk('I5 engine 的免疫還原 sweep 仍由 OPP_ATTACK_DEBUFF_FLAGS 驅動',
    engSrc.includes('for (const _f of OPP_ATTACK_DEBUFF_FLAGS)'));
  for (const f of ['nextOwnAttackPenalty', 'takeExtraDamageNextTurn', 'weaknessOverrideTypeNextTurn']) {
    const list = /OPP_ATTACK_DEBUFF_FLAGS: readonly \(keyof CardInstance\)\[\] = \[([\s\S]*?)\];/.exec(flagSrc)?.[1] ?? '';
    chk(`I6 ${f} 在 OPP_ATTACK_DEBUFF_FLAGS 清單內（免疫還原 sweep 才涵蓋得到）`,
      list.includes(`'${f}'`), `listLen=${list.length}`);
  }
}

console.log(`\nm6a-wave6：PASS ${pass} / FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
