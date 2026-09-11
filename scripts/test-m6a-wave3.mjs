// v6.343 守衛（M6a 批次3）：11 招「能量操作（丟棄／加速／附加）」，一律走**完整 ATTACK 流程**驗行為，不驗字串存在。
//   ⭐ 每一招都配「哨兵」：卡面有傷害的驗傷害真的結算了；卡面 damage 為空的驗
//     「對手身上一點傷害都沒有多出來」＋「效果真的發生」（招式若沒被執行，兩者會同時是空真，
//      而【0】段的反安慰劑已經證明 run() 打錯招名會回 __err，不會默默成功）。
//   ⭐⭐ 會開 picker 的招式一律真的 RESOLVE_SELECTION 解掉再看結果；
//     「有開 picker 就算過」＝安慰劑（數字/屬性改錯照樣全綠）。
//   ⭐⭐ 「宣告時選能量丟棄」那 4 招**兩端都驗**：
//        (a) ATTACK_PRE_DISCARD_CHOICE 的 spec（UI 端能勾什麼）
//        (b) 真的送 discardedEnergyIids 進 ATTACK（引擎端真的丟了哪幾張）
//     只驗其中一端 ⇒ UI 與引擎漂移時守衛是瞎的。
//   ⚠ 靶一律挑對出招者屬性中立的（弱點×2、抵抗-20 會讓數字對不上）；傷害大的用高 HP 靶，
//     否則靶被打死 → active 變 null → dmgOf 讀到 -1，看起來像數字錯其實是靶死了。
//   ⚠ 基本能量 id 依名稱查（硬編會付不出費用 → ATTACK 靜默 return → 假 FAIL）。
//   ⚠ state 一律由 createGame 產生再覆蓋（手刻會缺欄位 → ATTACK 靜默不執行）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.m6aw3-s.js'), E = join(ROOT, '.m6aw3-e.ts'), O = join(ROOT, '.m6aw3-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction, createGame } from './src/lib/game/engine';\nexport { ATTACK_PRE_DISCARD_CHOICE } from './src/lib/game/effects';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, createGame, ATTACK_PRE_DISCARD_CHOICE } = await import(pathToFileURL(O).href);

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
const findOther = (n, a) => {
  const hits = (byName.get(n) || []).filter((c) => (c.attacks || []).some((x) => x.name === a));
  return hits.find((c) => String(c.setCode) !== 'M6a') ?? hits[0];
};
const findCard = (n) => (byName.get(n) || [])[0];
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
const NOAB = (c) => c.supertype === 'Pokemon' && !(c.abilities || []).length;
/** 高 HP 沙包（本批有 250 的招式，一般基礎靶會被打死 → active=null → 假 FAIL）。 */
const tank = (atk) => pick((x) => NOAB(x) && neutral(x, typeOf(atk))) ?? neutralFor(atk);

function run(atkName, atk, opt = {}) {
  const def = opt.def ?? tank(atk);
  const ai = (atk.attacks || []).findIndex((a) => a.name === atkName);
  if (ai < 0) return { __err: '找不到招式 ' + atkName };
  const A = inst(atk.id, opt.atkPatch || {});
  const clsId = EID[opt.colorlessAs] ?? EID.Colorless;
  A.energyAttached = [
    ...((atk.attacks[ai].cost) || []).map((t) => (t === 'Colorless' ? inst(clsId) : inst(EID[t] ?? FILL))),
    ...(opt.atkEnergyTypes || []).map((t) => inst(EID[t] ?? FILL)),
  ];
  const D = inst(def.id, opt.defPatch || {});
  const s0 = createGame({ name: 'P1', entries: [{ cardId: String(atk.id), count: 1 }] },
    { name: 'P2', entries: [{ cardId: String(def.id), count: 1 }] }, pool);
  const oppBench = Array.from({ length: opt.oppBench ?? 1 },
    (_, i) => inst(def.id, (opt.oppBenchPatch || [])[i] || {}));
  const mkBench = (spec) => inst(spec.cid ?? atk.id, {
    energyAttached: (spec.energy || []).map((t) => inst(EID[t] ?? FILL)),
    ...(spec.patch || {}),
  });
  const selfBench = opt.selfBenchSpec
    ? opt.selfBenchSpec.map(mkBench)
    : Array.from({ length: opt.selfBench ?? 0 }, () => inst(atk.id));
  const st = {
    ...s0, phase: 'playing', turnPhase: 'main', turn: 5, activePlayerIndex: 0, firstPlayerIdx: 0,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
    activeStadium: null, activeStadiumOwnerIdx: 0, pendingSelection: null, log: [],
    players: [
      { ...s0.players[0], active: A, bench: selfBench,
        hand: (opt.handCards || []).map((cid) => inst(cid)),
        deck: (opt.deckCards || Array.from({ length: opt.deckN ?? 3 }, () => PLAIN.id)).map((cid) => inst(cid)),
        discard: (opt.discardCards || []).map((cid) => inst(cid)),
        prizes: Array.from({ length: opt.prizesN ?? 6 }, () => inst(def.id)) },
      { ...s0.players[1], active: D, bench: oppBench, hand: [],
        deck: Array.from({ length: 3 }, () => inst(def.id)), discard: [],
        prizes: Array.from({ length: 6 }, () => inst(def.id)) },
    ],
    ...(opt.statePatch || {}),
  };
  // ⭐ 宣告招式時要選能量丟棄的招式：真的把玩家的選擇送進 ATTACK。
  const action = { type: 'ATTACK', attackIndex: ai };
  if (opt.pickDiscard) action.discardedEnergyIids = opt.pickDiscard(A.energyAttached, pool);
  const orig = Math.random;
  // ⭐ randomSeq：擲幣型招式要逐次控制正反（0.1=正面 / 0.9=反面，見 flipCoinsWithLog 的 <0.5）。
  let seqI = 0;
  const seq = opt.randomSeq;
  Math.random = () => (seq ? (seqI < seq.length ? seq[seqI++] : seq[seq.length - 1]) : (opt.heads === false ? 0.9 : 0.1));
  let out;
  try { out = applyAction(st, action, pool); }
  catch (e) { out = { __err: e.message }; }
  finally { Math.random = orig; }
  if (out && out.players) out.__atkEnergyIids = A.energyAttached.map((e) => e.iid);
  return out;
}
const dmgOf = (r) => r?.players?.[1]?.active?.damage ?? -1;
const benchDmg = (r, i = 0) => r?.players?.[1]?.bench?.[i]?.damage ?? -1;
const selfEnergy = (r) => r?.players?.[0]?.active?.energyAttached ?? [];
const selfEnergyNames = (r) => selfEnergy(r).map((e) => pool.get(e.cardId)?.name ?? '?');
const selfDiscardNames = (r) => (r?.players?.[0]?.discard ?? []).map((e) => pool.get(e.cardId)?.name ?? '?');
const selfBenchDmg = (r, i = 0) => r?.players?.[0]?.bench?.[i]?.damage ?? -1;
/** 把 pending picker 解掉（真的走一次 RESOLVE_SELECTION）。 */
const resolve = (r, iids) => applyAction(r, { type: 'RESOLVE_SELECTION', selectedIids: iids, actorIdx: 0 }, pool);
const faceRaw = (card, atkName) => String((card.attacks || []).find((x) => x.name === atkName)?.damage ?? '');
const pend = (r) => r?.pendingSelection ?? null;

console.log('\n【0】harness 自驗（沒有這一段，下面全部可能是空真）');
{
  const c = find('火焰鳥', '火焰旋渦');
  chk('0a fixture：抓得到 M6a 的火焰鳥｜火焰旋渦（130）', !!c && String(c.setCode) === 'M6a' && faceRaw(c, '火焰旋渦') === '130', `${c?.setCode}/${faceRaw(c, '火焰旋渦')}`);
  chk('0b ⭐反安慰劑：不存在的招式名會回 __err（run() 不會默默成功）', !!run('這招不存在', c).__err);
  const t = typeOf(c), nd = tank(c);
  chk('0c ⭐harness 自驗：高 HP 中立靶對出招者屬性既不弱也不抗，且 HP ≥ 260',
    !!t && neutral(nd, t) && Number(nd.hp) >= 260, `atkType=${t} target=${nd?.name} hp=${nd?.hp}`);
  chk('0d ⭐harness 自驗：randomSeq 真的逐次控制正反（[反面] → 0 正面；[正正反] → 2 正面）',
    (() => {
      const p = find('皮卡丘', '充電衝刺');
      const a = run('充電衝刺', p, { randomSeq: [0.9], deckCards: [EID.Lightning, EID.Lightning] });
      const b = run('充電衝刺', p, { randomSeq: [0.1, 0.1, 0.9], deckCards: [EID.Lightning, EID.Lightning, EID.Lightning] });
      return pend(a) === null && pend(b)?.maxCount === 2;
    })());
  chk('0e ⭐harness 自驗：pickDiscard 真的把玩家選擇送進 ATTACK（沒送＝引擎自動丟末端，測不到玩家選了誰）',
    (() => {
      const r = run('火焰旋渦', c, { pickDiscard: (es) => [es[0].iid, es[1].iid] });
      return selfEnergy(r).length === 1 && selfEnergy(r)[0].iid === r.__atkEnergyIids[2];
    })());
}

console.log('\n【A】「選擇 N 個這隻寶可夢身上附加的（【X】）能量，將其丟棄」（4 招）');
// (a) UI 端：ATTACK_PRE_DISCARD_CHOICE 的 spec
for (const [key, min, max, tf, base] of [
  ['火焰鳥|火焰旋渦', 2, 2, undefined, 130],
  ['密勒頓|閃電猛衝', 2, 2, 'Lightning', 140],
  ['超夢|精神驅動', 1, 1, undefined, 120],
  ['故勒頓|全開猛撞', 2, 2, 'Fighting', 140],
]) {
  const sp = ATTACK_PRE_DISCARD_CHOICE.get(key);
  chk(`A-spec ${key}：picker min/max=${min}/${max}、scope=attacker、countMode=units、屬性=${tf ?? '不限'}、base=${base}`,
    !!sp && sp.min === min && sp.max === max && sp.scope === 'attacker'
    && sp.countMode === 'units' && sp.energyTypeFilter === tf
    && sp.baseDamage === base && sp.damagePerEnergy === 0,
    JSON.stringify(sp));
}
{
  const c = find('火焰鳥', '火焰旋渦');    // cost Fire,Fire,C → 火,火,水
  const r = run('火焰旋渦', c, { pickDiscard: (es) => [es[0].iid, es[2].iid] });
  chk('A 火焰鳥｜火焰旋渦 哨兵：卡面 130 真的結算了', dmgOf(r) === 130, String(dmgOf(r)));
  chk('A ⭐火焰旋渦 丟掉玩家選的那 2 個（剩下的是沒被選的那 1 個【火】）',
    selfEnergy(r).length === 1 && selfEnergyNames(r)[0] === '基本【火】能量'
    && selfDiscardNames(r).filter((x) => x === '基本【火】能量').length === 1
    && selfDiscardNames(r).filter((x) => x === '基本【水】能量').length === 1,
    `留=${selfEnergyNames(r)} 棄=${selfDiscardNames(r)}`);
  chk('A ⭐火焰旋渦 卡面沒有限定屬性：選【水】也丟得掉（filter 是 all，不是 Fire）',
    selfDiscardNames(r).includes('基本【水】能量'), String(selfDiscardNames(r)));
}
{
  const c = find('密勒頓', '閃電猛衝');    // cost L,L,C → 雷,雷,水
  const ok = run('閃電猛衝', c, { pickDiscard: (es) => [es[0].iid, es[1].iid] });
  chk('A 密勒頓｜閃電猛衝 哨兵：卡面 140 真的結算了', dmgOf(ok) === 140, String(dmgOf(ok)));
  chk('A ⭐閃電猛衝 丟 2 個【雷】→ 身上只剩那 1 個【水】',
    selfEnergy(ok).length === 1 && selfEnergyNames(ok)[0] === '基本【水】能量', String(selfEnergyNames(ok)));
  const bad = run('閃電猛衝', c, { pickDiscard: (es) => [es[2].iid, es[0].iid] });  // 水 + 雷
  chk('A ⭐⭐閃電猛衝 卡面限【雷】：送進來的【水】不會被丟（只丟掉那 1 個【雷】）',
    selfEnergy(bad).length === 2 && selfEnergyNames(bad).includes('基本【水】能量')
    && selfDiscardNames(bad).length === 1 && selfDiscardNames(bad)[0] === '基本【雷】能量',
    `留=${selfEnergyNames(bad)} 棄=${selfDiscardNames(bad)}`);
}
{
  const c = find('超夢', '精神驅動');      // cost P,P,C → 超,超,水
  const r = run('精神驅動', c, { pickDiscard: (es) => [es[2].iid] });
  chk('A 超夢｜精神驅動 哨兵：卡面 120 真的結算了', dmgOf(r) === 120, String(dmgOf(r)));
  chk('A ⭐精神驅動 只丟 1 個（不是 2 個）', selfEnergy(r).length === 2 && selfDiscardNames(r).length === 1,
    `留=${selfEnergyNames(r)} 棄=${selfDiscardNames(r)}`);
}
{
  const c = find('故勒頓', '全開猛撞');    // cost F,F,C → 鬥,鬥,水
  const ok = run('全開猛撞', c, { pickDiscard: (es) => [es[0].iid, es[1].iid] });
  chk('A 故勒頓｜全開猛撞 哨兵：卡面 140 真的結算了', dmgOf(ok) === 140, String(dmgOf(ok)));
  chk('A ⭐全開猛撞 丟 2 個【鬥】→ 身上只剩那 1 個【水】',
    selfEnergy(ok).length === 1 && selfEnergyNames(ok)[0] === '基本【水】能量', String(selfEnergyNames(ok)));
  const bad = run('全開猛撞', c, { pickDiscard: (es) => [es[2].iid, es[0].iid] });
  chk('A ⭐⭐全開猛撞 卡面限【鬥】：送進來的【水】不會被丟',
    selfDiscardNames(bad).length === 1 && selfDiscardNames(bad)[0] === '基本【鬥】能量', String(selfDiscardNames(bad)));
}
{
  // ⭐ 正對照：既有同措辭卡（本版沒有動到它們，用來證明 harness 與中央 registrar 沒壞）
  const g = find('蓋歐卡', '漩渦波');      // 130 / 選 2 個（不限屬性）
  const rg = run('漩渦波', g, { pickDiscard: (es) => [es[0].iid, es[1].iid] });
  chk('A ⭐正對照：既有「蓋歐卡｜漩渦波」130＋丟 2 個能量', dmgOf(rg) === 130 && selfDiscardNames(rg).length === 2,
    `${dmgOf(rg)}/${selfDiscardNames(rg).length}`);
  const rl = find('雷丘', '強力伏特');     // 150 / 選 1 個【雷】
  const rr = run('強力伏特', rl, { pickDiscard: (es) => [es[0].iid] });
  chk('A ⭐正對照：既有「雷丘｜強力伏特」150＋丟 1 個【雷】（屬性 filter 的既有判準）',
    dmgOf(rr) === 150 && selfDiscardNames(rr).length === 1, `${dmgOf(rr)}/${selfDiscardNames(rr)}`);
}

console.log('\n【B】「將這隻寶可夢身上附加的能量卡全部丟棄」（索爾迦雷歐｜流星閃衝 220）');
{
  const c = find('索爾迦雷歐', '流星閃衝');  // cost M,M,C,C
  const r = run('流星閃衝', c);
  chk('B 索爾迦雷歐｜流星閃衝 哨兵：卡面 220 真的結算了', dmgOf(r) === 220, String(dmgOf(r)));
  chk('B ⭐流星閃衝 身上能量全部進棄牌區（4 個 → 0 個）',
    selfEnergy(r).length === 0 && selfDiscardNames(r).length === 4, `留=${selfEnergy(r).length} 棄=${selfDiscardNames(r).length}`);
  chk('B ⭐流星閃衝 不開任何 picker（「全部丟棄」不需要玩家選）', pend(r) === null, JSON.stringify(pend(r)?.type));
  const t = find('閃電鳥', '十萬伏特');
  const rt = run('十萬伏特', t);
  chk('B ⭐正對照：既有「閃電鳥｜十萬伏特」190＋丟光能量（同一支中央 helper）',
    dmgOf(rt) === 190 && selfEnergy(rt).length === 0, `${dmgOf(rt)}/${selfEnergy(rt).length}`);
}

console.log('\n【C】鳳王｜神聖之息（丟光能量 ＋ 1 隻備戰 HP 全恢復）');
{
  const c = find('鳳王', '神聖之息');   // cost Fire,Fire，dmg=''
  chk('C0 卡面 damage 為空 ⇒ 不可以有主線傷害', faceRaw(c, '神聖之息') === '', faceRaw(c, '神聖之息'));
  const opt = { selfBenchSpec: [{ patch: { damage: 70 } }, { patch: { damage: 40 } }] };
  const r = run('神聖之息', c, opt);
  chk('C ⭐神聖之息 哨兵：對手身上一點傷害都沒有多出來（卡面沒有傷害）', dmgOf(r) === 0, String(dmgOf(r)));
  chk('C 神聖之息 先把自己身上的能量全部丟棄（2 → 0）',
    selfEnergy(r).length === 0 && selfDiscardNames(r).length === 2, `留=${selfEnergy(r).length} 棄=${selfDiscardNames(r).length}`);
  chk('C 神聖之息 開「自己備戰」picker（heal-target）', pend(r)?.type === 'heal-target', JSON.stringify(pend(r)?.type));
  chk('C ⭐神聖之息 未解 picker 前備戰還是傷的（70/40）', selfBenchDmg(r, 0) === 70 && selfBenchDmg(r, 1) === 40,
    `${selfBenchDmg(r, 0)}/${selfBenchDmg(r, 1)}`);
  const h0 = resolve(r, [r.players[0].bench[0].iid]);
  chk('C ⭐⭐神聖之息 選備戰0 → 它的傷害**歸零**（不是恢復固定點數），備戰1 不受影響',
    selfBenchDmg(h0, 0) === 0 && selfBenchDmg(h0, 1) === 40, `${selfBenchDmg(h0, 0)}/${selfBenchDmg(h0, 1)}`);
  const h1 = resolve(r, [r.players[0].bench[1].iid]);
  chk('C ⭐神聖之息 選備戰1 → 換它歸零（反安慰劑：選不同目標結果不同）',
    selfBenchDmg(h1, 0) === 70 && selfBenchDmg(h1, 1) === 0, `${selfBenchDmg(h1, 0)}/${selfBenchDmg(h1, 1)}`);
  const noBench = run('神聖之息', c, { selfBenchSpec: [] });
  chk('C ⭐⭐神聖之息 沒有備戰寶可夢時**只執行前半段**（能量照丟、不開 picker、不當掉）',
    selfEnergy(noBench).length === 0 && pend(noBench) === null && !noBench.__err,
    `留=${selfEnergy(noBench).length} pending=${JSON.stringify(pend(noBench)?.type)}`);
  const healthy = run('神聖之息', c, { selfBenchSpec: [{ patch: { damage: 0 } }] });
  chk('C ⭐神聖之息 備戰都沒受傷時也不開 picker（選了沒意義），能量照丟',
    selfEnergy(healthy).length === 0 && pend(healthy) === null, JSON.stringify(pend(healthy)?.type));
  // ⭐ 正對照：逐字同措辭的既有卡（本版把它收斂到同一支中央 helper，行為必須不變）
  const w = find('風妖精', '治癒棉絮');
  const rw = run('治癒棉絮', w, { selfBenchSpec: [{ patch: { damage: 60 } }] });
  const rw2 = resolve(rw, [rw.players[0].bench[0].iid]);
  chk('C ⭐正對照：既有「風妖精｜治癒棉絮」仍是 1 隻備戰回滿（收斂後行為不變）',
    pend(rw)?.type === 'heal-target' && selfBenchDmg(rw2, 0) === 0, `${pend(rw)?.type}/${selfBenchDmg(rw2, 0)}`);
}

console.log('\n【D】皮卡丘｜雷電落（丟光【雷】能量 → 對手 1 隻寶可夢 90）');
{
  const c = find('皮卡丘', '雷電落');   // cost L,L,L，dmg=''
  chk('D0 卡面 damage 為空 ⇒ 不可以有主線傷害', faceRaw(c, '雷電落') === '', faceRaw(c, '雷電落'));
  const r = run('雷電落', c, { atkEnergyTypes: ['Psychic'], oppBench: 2 });
  chk('D ⭐雷電落 哨兵：未解 picker 前對手戰鬥場一點傷害都沒有（卡面沒有主線傷害）', dmgOf(r) === 0, String(dmgOf(r)));
  chk('D ⭐⭐雷電落 只丟【雷】：3 個【雷】進棄牌區，額外那 1 個【超】留著',
    selfEnergy(r).length === 1 && selfEnergyNames(r)[0] === '基本【超】能量'
    && selfDiscardNames(r).length === 3 && selfDiscardNames(r).every((x) => x === '基本【雷】能量'),
    `留=${selfEnergyNames(r)} 棄=${selfDiscardNames(r)}`);
  chk('D 雷電落 開「對手 1 隻**寶可夢**」picker（含戰鬥場）', pend(r)?.type === 'opp-poke-choose', JSON.stringify(pend(r)?.type));
  const onActive = resolve(r, [r.players[1].active.iid]);
  chk('D ⭐雷電落 選戰鬥場 → 90 點', dmgOf(onActive) === 90, String(dmgOf(onActive)));
  const onBench = resolve(r, [r.players[1].bench[0].iid]);
  chk('D ⭐雷電落 選備戰 → 備戰吃 90、戰鬥場 0（反安慰劑：選不同目標結果不同）',
    benchDmg(onBench, 0) === 90 && dmgOf(onBench) === 0, `${benchDmg(onBench, 0)}/${dmgOf(onBench)}`);
  // ⭐ 正對照：投羽梟｜羽毛射擊（同一句型，只差它不限屬性）
  const f = find('投羽梟', '羽毛射擊');
  const rf = run('羽毛射擊', f);
  const rf2 = resolve(rf, [rf.players[1].active.iid]);
  chk('D ⭐正對照：既有「投羽梟｜羽毛射擊」丟光能量 → 對手 1 隻寶可夢 90',
    selfEnergy(rf).length === 0 && dmgOf(rf2) === 90, `${selfEnergy(rf).length}/${dmgOf(rf2)}`);
  // ⭐ 正對照：紅蓮鎧騎｜紅蓮引爆（本版一併收斂到 selfDiscardAllEnergyOfTypePost）
  const k = find('紅蓮鎧騎', '紅蓮引爆');
  const rk = run('紅蓮引爆', k, { atkEnergyTypes: ['Psychic'] });
  chk('D ⭐正對照：既有「紅蓮鎧騎｜紅蓮引爆」只丟【火】、非【火】留著（收斂後行為不變）',
    !selfEnergyNames(rk).includes('基本【火】能量') && selfEnergyNames(rk).includes('基本【超】能量')
    && selfDiscardNames(rk).length >= 1 && selfDiscardNames(rk).every((x) => x === '基本【火】能量'),
    `留=${selfEnergyNames(rk)} 棄=${selfDiscardNames(rk)}`);
}

console.log('\n【E】洛奇亞｜元素爆破（【火】【水】【雷】各 1 個）');
{
  const c = find('洛奇亞', '元素爆破');   // cost Fire,Water,Lightning，250
  const r = run('元素爆破', c, { atkEnergyTypes: ['Psychic'] });
  chk('E 洛奇亞｜元素爆破 哨兵：卡面 250 真的結算了', dmgOf(r) === 250, String(dmgOf(r)));
  chk('E ⭐元素爆破 三種屬性各只有 1 個候選 → 直接丟（不彈沒有選擇餘地的視窗）',
    pend(r) === null && selfEnergy(r).length === 1 && selfEnergyNames(r)[0] === '基本【超】能量',
    `pending=${JSON.stringify(pend(r)?.type)} 留=${selfEnergyNames(r)}`);
  chk('E ⭐⭐元素爆破 只丟【火】【水】【雷】各 1 個，其他屬性不動',
    selfDiscardNames(r).sort().join(',') === ['基本【火】能量', '基本【水】能量', '基本【雷】能量'].sort().join(','),
    String(selfDiscardNames(r)));
  // 有 2 個【火】時必須讓玩家選是哪一個
  const r2 = run('元素爆破', c, { atkEnergyTypes: ['Fire'] });
  chk('E ⭐元素爆破 有 2 個【火】→ 開能量 picker 讓玩家選', pend(r2)?.type === 'active-energy-discard', JSON.stringify(pend(r2)?.type));
  chk('E ⭐元素爆破 picker 的候選只列【火】（validIids 限定 2 張）', (pend(r2)?.params?.validIids || []).length === 2,
    JSON.stringify(pend(r2)?.params?.validIids));
  const r2a = resolve(r2, [r2.__atkEnergyIids[0]]);   // 選 cost 那一張【火】
  chk('E ⭐⭐元素爆破 解掉 picker 後：【火】只丟掉玩家選的那 1 張，另 1 張【火】留著（「各1個」≠「全丟」）',
    selfEnergy(r2a).length === 1 && selfEnergyNames(r2a)[0] === '基本【火】能量'
    && selfEnergy(r2a)[0].iid === r2.__atkEnergyIids[3],
    `留=${selfEnergyNames(r2a)}(${selfEnergy(r2a).map((e) => e.iid)}) 棄=${selfDiscardNames(r2a)}`);
  const r2b = resolve(r2, [r2.__atkEnergyIids[3]]);   // 選額外那一張【火】
  chk('E ⭐元素爆破 反安慰劑：選另一張【火】→ 留下的是另一張（真的照玩家選的丟）',
    selfEnergy(r2b).length === 1 && selfEnergy(r2b)[0].iid === r2.__atkEnergyIids[0],
    String(selfEnergy(r2b).map((e) => e.iid)));
}

console.log('\n【F】皮卡丘｜充電衝刺（擲到反面 → 牌庫選最多正面數的「基本【雷】能量」附於自己）');
{
  const c = find('皮卡丘', '充電衝刺');   // cost C，dmg=''
  chk('F0 卡面 damage 為空 ⇒ 不可以有主線傷害', faceRaw(c, '充電衝刺') === '', faceRaw(c, '充電衝刺'));
  const DECK = [EID.Lightning, EID.Lightning, EID.Lightning, EID.Fire];
  const r2 = run('充電衝刺', c, { randomSeq: [0.1, 0.1, 0.9], deckCards: DECK });
  chk('F ⭐充電衝刺 哨兵：對手身上一點傷害都沒有（卡面沒有傷害）', dmgOf(r2) === 0, String(dmgOf(r2)));
  chk('F ⭐⭐充電衝刺 2 次正面 → 牌庫 picker 上限 2（「最多與正面出現的次數相同數量」）',
    pend(r2)?.type === 'deck-search' && pend(r2)?.maxCount === 2 && pend(r2)?.minCount === 0,
    JSON.stringify({ t: pend(r2)?.type, mx: pend(r2)?.maxCount, mn: pend(r2)?.minCount }));
  chk('F ⭐⭐充電衝刺 候選只有「基本【雷】能量」（牌庫裡的【火】不可選）',
    (pend(r2)?.params?.validIids || []).length === 3 && pend(r2)?.filter === 'Energy:Lightning',
    `${pend(r2)?.filter}/${(pend(r2)?.params?.validIids || []).length}`);
  const vi = pend(r2).params.validIids;
  const done = resolve(r2, [vi[0], vi[1]]);
  chk('F ⭐充電衝刺 解掉後：2 張【雷】附到**這隻**寶可夢身上（1 費用 + 2 = 3 個）',
    selfEnergy(done).length === 3 && selfEnergyNames(done).filter((x) => x === '基本【雷】能量').length === 2,
    String(selfEnergyNames(done)));
  chk('F ⭐充電衝刺 附完之後牌庫剩 2 張（4 - 2）', (done?.players?.[0]?.deck || []).length === 2, String((done?.players?.[0]?.deck || []).length));
  const r1 = run('充電衝刺', c, { randomSeq: [0.1, 0.9], deckCards: DECK });
  chk('F ⭐充電衝刺 正反對照：1 次正面 → 上限 1（不是固定值）', pend(r1)?.maxCount === 1, String(pend(r1)?.maxCount));
  // ⚠ randomSeq 第 1 發 0.9 = 擲出反面（0 次正面）；之後固定 0.1 是**餵給 shuffle** 的，
  //   讓「有沒有真的重洗」變成可觀測（Fisher-Yates 在常數 0.1 下是固定且非恆等的排列）。
  const r0 = run('充電衝刺', c, { randomSeq: [0.9, 0.1], deckCards: DECK });
  chk('F ⭐充電衝刺 0 次正面 → 不開 picker、一張也不附（費用那 1 個還在）',
    pend(r0) === null && selfEnergy(r0).length === 1, `pending=${JSON.stringify(pend(r0)?.type)} 能量=${selfEnergy(r0).length}`);
  chk('F ⭐⭐充電衝刺 0 次正面仍「並且重洗牌庫」—— 驗**牌庫真的被重洗**（卡序改變），不是只寫了一行 log',
    (r0?.players?.[0]?.deck || []).length === 4
    && (r0.players[0].deck.map((x) => String(x.cardId)).join(',') !== DECK.map(String).join(','))
    && (r0.log || []).some((l) => String(l.message ?? '').includes('充電衝刺') && String(l.message ?? '').includes('重洗牌庫')),
    `deck=${(r0?.players?.[0]?.deck || []).map((x) => x.cardId).join(',')} 原=${DECK.join(',')}`);
  // ⭐ 正對照：既有同句型卡 卡比獸｜大胃王（差別只在它不限屬性）
  const b = find('卡比獸', '大胃王');
  const rb = run('大胃王', b, { randomSeq: [0.1, 0.1, 0.9], deckCards: DECK });
  chk('F ⭐正對照：既有「卡比獸｜大胃王」2 次正面 → 附 2 張基本能量（收斂沒有波及它）',
    selfEnergy(rb).length - (b.attacks.find((a) => a.name === '大胃王').cost || []).length === 2,
    String(selfEnergy(rb).length));
}

console.log('\n【G】皮卡丘ex｜劈哩劈哩夜狂歡（手牌任意數量基本能量，以任意方式附於自己的寶可夢）');
{
  const c = find('皮卡丘ex', '劈哩劈哩夜狂歡');   // cost L，dmg=''
  chk('G0 卡面 damage 為空 ⇒ 不可以有主線傷害', faceRaw(c, '劈哩劈哩夜狂歡') === '', faceRaw(c, '劈哩劈哩夜狂歡'));
  const HAND = [EID.Lightning, EID.Psychic, PLAIN.id];
  const r = run('劈哩劈哩夜狂歡', c, { handCards: HAND });
  chk('G ⭐劈哩劈哩夜狂歡 哨兵：對手身上一點傷害都沒有（卡面沒有傷害）', dmgOf(r) === 0, String(dmgOf(r)));
  chk('G 劈哩劈哩夜狂歡 開「手牌基本能量」picker', pend(r)?.type === 'hand-discard' && pend(r)?.filter === 'BasicEnergy',
    JSON.stringify({ t: pend(r)?.type, f: pend(r)?.filter }));
  chk('G ⭐⭐劈哩劈哩夜狂歡 卡面「**任意**數量」⇒ minCount=0（可以 1 張都不選）', pend(r)?.minCount === 0, String(pend(r)?.minCount));
  chk('G ⭐劈哩劈哩夜狂歡 候選只有 2 張基本能量（手牌那張寶可夢卡不可選）',
    (pend(r)?.params?.validIids || []).length === 2, JSON.stringify((pend(r)?.params?.validIids || []).length));
  chk('G ⭐⭐劈哩劈哩夜狂歡 卡面「任意數量」＝**沒有上限** ⇒ maxCount 就是手牌可選張數（2），不是寫死的小數字',
    pend(r)?.maxCount === 2, String(pend(r)?.maxCount));
  const vi = pend(r).params.validIids;
  const done = resolve(r, [vi[0], vi[1]]);
  chk('G ⭐劈哩劈哩夜狂歡 解掉後：2 張能量從手牌搬到自己場上（場上只有 1 個合法目標 → 全附）',
    selfEnergy(done).length === 3 && (done?.players?.[0]?.hand || []).length === 1,
    `能量=${selfEnergy(done).length} 手牌=${(done?.players?.[0]?.hand || []).length}`);
  // ⭐ 正對照：逐字同措辭的既有卡
  const t = find('阿羅拉 椰蛋樹ex', '熱帶狂燒');
  const rt = run('熱帶狂燒', t, { handCards: HAND });
  chk('G ⭐正對照：既有「阿羅拉 椰蛋樹ex｜熱帶狂燒」150＋同一條手牌附能鏈',
    dmgOf(rt) === 150 && pend(rt)?.type === 'hand-discard' && pend(rt)?.minCount === 0,
    `${dmgOf(rt)}/${pend(rt)?.type}/${pend(rt)?.minCount}`);
}

console.log('\n【H】超夢｜賦予力量（棄牌區最多 2 張基本能量，附於自己的**1 隻**寶可夢）');
{
  const c = find('超夢', '賦予力量');   // cost P，dmg=''
  chk('H0 卡面 damage 為空 ⇒ 不可以有主線傷害', faceRaw(c, '賦予力量') === '', faceRaw(c, '賦予力量'));
  const DISC = [EID.Psychic, EID.Psychic, EID.Psychic, PLAIN.id];
  const r = run('賦予力量', c, { discardCards: DISC, selfBench: 1 });
  chk('H ⭐賦予力量 哨兵：對手身上一點傷害都沒有（卡面沒有傷害）', dmgOf(r) === 0, String(dmgOf(r)));
  chk('H 賦予力量 開「棄牌區基本能量」picker，上限 2（卡面「最多2張」）',
    pend(r)?.type === 'discard-search' && pend(r)?.maxCount === 2, JSON.stringify({ t: pend(r)?.type, mx: pend(r)?.maxCount }));
  chk('H ⭐⭐賦予力量 卡面**沒有**「任意數量／以任意方式／若希望」⇒ minCount=1（不可選 0）',
    pend(r)?.minCount === 1, String(pend(r)?.minCount));
  const cand = (r.players[0].discard || []).filter((x) => pool.get(x.cardId)?.supertype === 'Energy').map((x) => x.iid);
  const step2 = resolve(r, [cand[0], cand[1]]);
  chk('H ⭐⭐賦予力量 卡面「附於自己的**1隻**寶可夢身上」⇒ 第二段是**單一目標** picker，不是分散分配',
    pend(step2)?.type === 'heal-target' && pend(step2)?.effectKey === 'v158-energy-single-target-attach',
    JSON.stringify({ t: pend(step2)?.type, k: pend(step2)?.effectKey }));
  const onBench = resolve(step2, [step2.players[0].bench[0].iid]);
  chk('H ⭐賦予力量 選備戰 → 2 張能量**全部**附到那一隻（不可拆開）',
    (onBench?.players?.[0]?.bench?.[0]?.energyAttached || []).length === 2 && selfEnergy(onBench).length === 1,
    `備戰=${(onBench?.players?.[0]?.bench?.[0]?.energyAttached || []).length} 戰鬥場=${selfEnergy(onBench).length}`);
  const onActive = resolve(step2, [step2.players[0].active.iid]);
  chk('H ⭐賦予力量 卡面是「自己的1隻**寶可夢**」（含戰鬥場）：選戰鬥場也合法',
    selfEnergy(onActive).length === 3, String(selfEnergy(onActive).length));
  // ⭐ 正對照：措辭不同的既有卡 —— 「**以任意方式**」型必須仍是可分散（minCount=0）
  const m = find('莫魯貝可', '撿拾附上');
  const rm = run('撿拾附上', m, { discardCards: DISC, selfBench: 1 });
  const rm2 = resolve(rm, [(rm.players[0].discard || []).filter((x) => pool.get(x.cardId)?.supertype === 'Energy').map((x) => x.iid).slice(0, 2)].flat());
  chk('H ⭐⭐反對照：既有「莫魯貝可｜撿拾附上」是「以任意方式」⇒ minCount=0 且第二段走**分散**分配（不是單一目標）',
    rm?.pendingSelection?.minCount === 0 && pend(rm2)?.effectKey !== 'v158-energy-single-target-attach',
    JSON.stringify({ mn: rm?.pendingSelection?.minCount, k: pend(rm2)?.effectKey }));
}

console.log(`\nm6a-wave3：PASS ${pass} / FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
