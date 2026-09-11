// v6.342 守衛（M6a 批次2）：16 招「傷害計算類」，一律用**完整 ATTACK 流程**驗證行為，不驗字串存在。
//   ⭐ 本批每一招的傷害都是算出來的 ⇒ 斷言的「數字本身」就是效果＋哨兵；
//     但只驗一組數字＝安慰劑（helper 挑錯／參數填錯照樣可能矇對），所以每一招都驗
//     **至少兩個不同的輸入 → 兩個不同的輸出**（條件成立/不成立、計數 0/N）。
//   ⭐ 會開 picker 的招式（隱密斬）一定要真的 RESOLVE_SELECTION 解掉再看傷害數字。
//   ⭐ 每一支新 helper 都附「既有同措辭卡」的正對照（本版把它們一起收斂到同一支 helper，
//     正對照同時證明「收斂沒有改行為」）。
//   ⚠ 靶一律挑對出招者屬性中立的（弱點會 ×2、抵抗會 -20）；傷害大的用高 HP 靶，
//     否則靶被打死 → active 變 null → dmgOf 讀到 -1，看起來像數字錯其實是靶死了。
//   ⚠ 基本能量 id 依名稱查（硬編會付不出費用 → ATTACK 靜默 return → 假 FAIL）。
//   ⚠ state 一律由 createGame 產生再覆蓋（手刻會缺欄位 → ATTACK 靜默不執行）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.m6aw2-s.js'), E = join(ROOT, '.m6aw2-e.ts'), O = join(ROOT, '.m6aw2-o.mjs');
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
/**
 * ⚠⚠ 受方一律挑「對出招者的屬性**中立**」的寶可夢 —— 弱點會把傷害×2、抵抗會-20。
 *   ⭐ 這是**避開**修正子，不是在守衛裡重寫一份弱抗公式（Rule 38）。
 */
const neutralFor = (atk) => pick((x) => BASE_OK(x) && neutral(x, typeOf(atk))) ?? PLAIN;
/** 高 HP 沙包（本批傷害動輒 150+，用一般基礎靶會被打死 → active=null → 假 FAIL）。 */
const NOAB = (c) => c.supertype === 'Pokemon' && !(c.abilities || []).length;
const tank = (atk) => pick((x) => NOAB(x) && neutral(x, typeOf(atk))) ?? neutralFor(atk);
const tankEx = (atk) => pick((x) => NOAB(x) && x.subtype === 'ex' && neutral(x, typeOf(atk)));
const tankNonEx = (atk) => pick((x) => NOAB(x) && !isEx(x) && neutral(x, typeOf(atk)));

function run(atkName, atk, opt = {}) {
  const def = opt.def ?? tank(atk);
  const ai = (atk.attacks || []).findIndex((a) => a.name === atkName);
  if (ai < 0) return { __err: '找不到招式 ' + atkName };
  const A = inst(atk.id, opt.atkPatch || {});
  // ⚠ cost 的【無】預設用基本【水】付（沿用批次1）；要測「自身有沒有某屬性能量」時
  //   用 opt.colorlessAs 換掉，否則付費用的能量會意外滿足條件（水炮就踩得到）。
  const clsId = EID[opt.colorlessAs] ?? EID.Colorless;
  A.energyAttached = [
    ...((atk.attacks[ai].cost) || []).map((t) => (t === 'Colorless' ? inst(clsId) : inst(EID[t] ?? FILL))),
    ...(opt.atkEnergyTypes || []).map((t) => inst(EID[t] ?? FILL)),
    ...Array.from({ length: opt.extraEnergy ?? 0 }, () => inst(FILL)),
  ];
  const D = inst(def.id, opt.defPatch || {});
  if (opt.defEnergy) D.energyAttached = Array.from({ length: opt.defEnergy }, () => inst(FILL));
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
        hand: Array.from({ length: opt.handN ?? 0 }, () => inst(PLAIN.id)),
        deck: Array.from({ length: opt.deckN ?? 3 }, () => inst(PLAIN.id)),
        discard: (opt.discardCards || []).map((cid) => inst(cid)),
        prizes: Array.from({ length: opt.prizesN ?? 6 }, () => inst(def.id)) },
      { ...s0.players[1], active: D, bench: oppBench, hand: [],
        deck: Array.from({ length: 3 }, () => inst(def.id)), discard: [],
        prizes: Array.from({ length: 6 }, () => inst(def.id)) },
    ],
    ...(opt.statePatch || {}),
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
/** 把 pending picker 解掉（真的走一次 RESOLVE_SELECTION），才算驗到「打了幾點」。 */
const resolve = (r, iids) => applyAction(r, { type: 'RESOLVE_SELECTION', selectedIids: iids, actorIdx: 0 }, pool);
/** 卡面傷害字串（'' / '80+' / '30×'）的前導數字；本批用來驗「卡面就是這個 base」。 */
const faceRaw = (card, atkName) => String((card.attacks || []).find((x) => x.name === atkName)?.damage ?? '');

console.log('\n【0】harness 自驗（沒有這一段，下面全部可能是空真）');
{
  const c = find('皮卡丘', '鬥志雷霆');
  chk('0a fixture：抓得到 M6a 的皮卡丘｜鬥志雷霆（20+）', !!c && String(c.setCode) === 'M6a' && faceRaw(c, '鬥志雷霆') === '20+', `${c?.setCode}/${faceRaw(c, '鬥志雷霆')}`);
  chk('0b ⭐反安慰劑：不存在的招式名會回 __err（run() 不會默默成功）', !!run('這招不存在', c).__err);
  const t = typeOf(c), nd = tank(c);
  chk('0c ⭐harness 自驗：高 HP 中立靶對出招者屬性既不弱也不抗，且 HP ≥ 250',
    !!t && neutral(nd, t) && Number(nd.hp) >= 250, `atkType=${t} target=${nd?.name} hp=${nd?.hp} w=${nd?.weakness?.type} r=${nd?.resistance?.type}`);
  chk('0d ⭐反安慰劑：拿「弱點正好是出招者屬性」的靶，傷害真的會變兩倍（證明 0c 有意義）',
    (() => {
      const weakTarget = pick((x) => NOAB(x) && !isEx(x) && x.weakness?.type === t && Number(x.hp) >= 120);
      return !!weakTarget && dmgOf(run('鬥志雷霆', c, { def: weakTarget })) === 40;
    })());
  chk('0e ⭐harness 自驗：tankEx 真的是「寶可夢【ex】」、tankNonEx 真的不是',
    tankEx(c)?.subtype === 'ex' && !isEx(tankNonEx(c)), `${tankEx(c)?.name} / ${tankNonEx(c)?.name}`);
  chk('0f ⭐harness 自驗：colorlessAs 真的會換掉【無】費用付的能量屬性',
    (() => {
      const g = find('蓋歐卡', '水炮');           // cost 全【無】：預設填水 → 4 水；換超 → 0 水
      return dmgOf(run('水炮', g, {})) === 60 + 4 * 30 && dmgOf(run('水炮', g, { colorlessAs: 'Psychic' })) === 60;
    })());
}

console.log('\n【A】「若身上附有【X】能量卡 → +80」（selfHasEnergyTypePre）');
for (const [cn, an, ty] of [['萊希拉姆', '鐳射火焰', 'Lightning'], ['捷克羅姆', '爆烈閃電', 'Fire']]) {
  const c = find(cn, an);
  const no = dmgOf(run(an, c));
  const yes = dmgOf(run(an, c, { atkEnergyTypes: [ty] }));
  chk(`A ${cn}｜${an} 沒有【${ZH[ty]}】能量 → 卡面 base 80`, no === 80, String(no));
  chk(`A ⭐${cn}｜${an} 附有【${ZH[ty]}】能量 → 80+80=160（正反對照）`, yes === 160, String(yes));
}
{
  // ⭐ 正對照：既有同措辭卡 電蜘蛛｜麻麻羅網（本版一併收斂到同一支 helper）
  const c = find('電蜘蛛', '麻麻羅網');
  chk('A ⭐正對照：既有「電蜘蛛｜麻麻羅網」無雷 50 / 有雷 130（收斂後行為不變）',
    dmgOf(run('麻麻羅網', c)) === 50 && dmgOf(run('麻麻羅網', c, { atkEnergyTypes: ['Lightning'] })) === 130,
    `${dmgOf(run('麻麻羅網', c))}/${dmgOf(run('麻麻羅網', c, { atkEnergyTypes: ['Lightning'] }))}`);
}

console.log('\n【B】已取獎賞張數 × 70（prizesTakenMultiplyPre）');
{
  const c = find('呆火鱷ex', '心情好火焰');
  chk('B 呆火鱷ex｜心情好火焰 已取 0 張 → 0（卡面是「70×」不是「70+」）',
    dmgOf(run('心情好火焰', c, { prizesN: 6 })) === 0, String(dmgOf(run('心情好火焰', c, { prizesN: 6 }))));
  chk('B 呆火鱷ex｜心情好火焰 已取 1 張 → 70', dmgOf(run('心情好火焰', c, { prizesN: 5 })) === 70, String(dmgOf(run('心情好火焰', c, { prizesN: 5 }))));
  chk('B ⭐呆火鱷ex｜心情好火焰 已取 3 張 → 210', dmgOf(run('心情好火焰', c, { prizesN: 3 })) === 210, String(dmgOf(run('心情好火焰', c, { prizesN: 3 }))));
  const g = find('超級大嘴娃ex', '貪心');
  chk('B ⭐正對照：既有「超級大嘴娃ex｜貪心」已取 0 → 0 / 已取 2 → 160（收斂後行為不變）',
    dmgOf(run('貪心', g, { prizesN: 6 })) === 0 && dmgOf(run('貪心', g, { prizesN: 4 })) === 160,
    `${dmgOf(run('貪心', g, { prizesN: 6 }))}/${dmgOf(run('貪心', g, { prizesN: 4 }))}`);
}

console.log('\n【C】能量數量 × N（selfAttachedEnergyMultiplyPre / defActiveEnergyMultiplyPre）');
{
  const c = find('蓋歐卡', '水炮');
  chk('C 蓋歐卡｜水炮 自身 0 個【水】→ 60', dmgOf(run('水炮', c, { colorlessAs: 'Psychic' })) === 60, String(dmgOf(run('水炮', c, { colorlessAs: 'Psychic' }))));
  chk('C ⭐蓋歐卡｜水炮 自身 2 個【水】→ 60+60=120',
    dmgOf(run('水炮', c, { colorlessAs: 'Psychic', atkEnergyTypes: ['Water', 'Water'] })) === 120,
    String(dmgOf(run('水炮', c, { colorlessAs: 'Psychic', atkEnergyTypes: ['Water', 'Water'] }))));
  chk('C ⭐蓋歐卡｜水炮 只算【水】：多附 3 個【超】不加傷（仍是 60）',
    dmgOf(run('水炮', c, { colorlessAs: 'Psychic', atkEnergyTypes: ['Psychic', 'Psychic', 'Psychic'] })) === 60,
    String(dmgOf(run('水炮', c, { colorlessAs: 'Psychic', atkEnergyTypes: ['Psychic', 'Psychic', 'Psychic'] }))));
}
{
  const c = find('夢幻', '精神強念');
  chk('C 夢幻｜精神強念 對手 0 個能量 → 10', dmgOf(run('精神強念', c, { defEnergy: 0 })) === 10, String(dmgOf(run('精神強念', c, { defEnergy: 0 }))));
  chk('C ⭐夢幻｜精神強念 對手 3 個能量 → 10+120=130', dmgOf(run('精神強念', c, { defEnergy: 3 })) === 130, String(dmgOf(run('精神強念', c, { defEnergy: 3 }))));
  chk('C ⭐夢幻｜精神強念 只看**戰鬥位**：對手備戰帶 5 個能量也不加傷（仍是 10）',
    dmgOf(run('精神強念', c, { defEnergy: 0, oppBench: 1, oppBenchPatch: [{ energyAttached: Array.from({ length: 5 }, () => inst(FILL)) }] })) === 10,
    String(dmgOf(run('精神強念', c, { defEnergy: 0, oppBench: 1, oppBenchPatch: [{ energyAttached: Array.from({ length: 5 }, () => inst(FILL)) }] }))));
}

console.log('\n【D】隱密斬 —— 傷害依「選定目標身上的指示物數」而定（picker 必須真的解掉）');
{
  const c = find('甲賀忍蛙ex', '隱密斬');
  chk('D0 卡面 damage 為空 ⇒ 不可以有主線傷害', faceRaw(c, '隱密斬') === '', faceRaw(c, '隱密斬'));
  const opt = { defPatch: { damage: 20 }, oppBench: 2, oppBenchPatch: [{ damage: 30 }, { damage: 0 }] };
  const r = run('隱密斬', c, opt);
  chk('D 甲賀忍蛙ex｜隱密斬 → 開「對手 1 隻**寶可夢**」picker（含戰鬥場）',
    r?.pendingSelection?.type === 'opp-poke-choose', JSON.stringify(r?.pendingSelection?.type));
  chk('D ⭐隱密斬 未解 picker 前，戰鬥場傷害維持原樣（卡面沒有主線傷害）',
    dmgOf(r) === 20, String(dmgOf(r)));
  const onActive = resolve(r, [r.players[1].active.iid]);
  chk('D ⭐隱密斬 選戰鬥場（身上 2 個指示物）→ 2×30=60 → 20+60=80',
    dmgOf(onActive) === 80, String(dmgOf(onActive)));
  const onB0 = resolve(r, [r.players[1].bench[0].iid]);
  chk('D ⭐隱密斬 選備戰0（身上 3 個指示物）→ 3×30=90 → 30+90=120',
    benchDmg(onB0, 0) === 120, String(benchDmg(onB0, 0)));
  const onB1 = resolve(r, [r.players[1].bench[1].iid]);
  chk('D ⭐隱密斬 選備戰1（身上 0 個指示物）→ 0 點（不是固定值）',
    benchDmg(onB1, 1) === 0, String(benchDmg(onB1, 1)));
  chk('D ⭐隱密斬 反安慰劑：選不同目標結果不同（不是每個目標都吃同一個數字）',
    dmgOf(onActive) !== benchDmg(onB0, 0));
}

console.log('\n【E】場上寶可夢計數（selfNamedPokemonMultiplyPre / selfBenchMaxHpMultiplyPre）');
{
  const c = find('皮卡丘', '皮卡連鎖');
  const pikaEx = findCard('皮卡丘ex');
  chk('E 皮卡丘｜皮卡連鎖 場上只有自己 1 隻皮卡丘 → 1×40=40',
    dmgOf(run('皮卡連鎖', c, { selfBenchSpec: [] })) === 40, String(dmgOf(run('皮卡連鎖', c, { selfBenchSpec: [] }))));
  chk('E ⭐皮卡丘｜皮卡連鎖 備戰 2 隻皮卡丘 → 3×40=120',
    dmgOf(run('皮卡連鎖', c, { selfBench: 2 })) === 120, String(dmgOf(run('皮卡連鎖', c, { selfBench: 2 }))));
  chk('E ⭐皮卡丘｜皮卡連鎖 卡面「包含『寶可夢【ex】』」：備戰 1 隻皮卡丘ex 要算進來 → 2×40=80',
    !!pikaEx && dmgOf(run('皮卡連鎖', c, { selfBenchSpec: [{ cid: pikaEx.id }] })) === 80,
    `${pikaEx?.name}/${dmgOf(run('皮卡連鎖', c, { selfBenchSpec: [{ cid: pikaEx?.id }] }))}`);
  chk('E ⭐皮卡丘｜皮卡連鎖 非皮卡丘的備戰**不**算 → 仍是 1×40=40',
    dmgOf(run('皮卡連鎖', c, { selfBenchSpec: [{ cid: PLAIN.id }, { cid: PLAIN.id }] })) === 40,
    String(dmgOf(run('皮卡連鎖', c, { selfBenchSpec: [{ cid: PLAIN.id }, { cid: PLAIN.id }] }))));
}
{
  const c = find('寶寶丁', '軟彈陣');
  chk('E0 寶寶丁｜軟彈陣 沒有能量費用（cost 為空）', ((c.attacks || []).find((a) => a.name === '軟彈陣')?.cost || []).length === 0);
  chk('E 寶寶丁｜軟彈陣 備戰 0 隻 → 0（戰鬥場的自己是 HP30 但卡面只算「備戰」）',
    dmgOf(run('軟彈陣', c, { selfBenchSpec: [] })) === 0, String(dmgOf(run('軟彈陣', c, { selfBenchSpec: [] }))));
  chk('E ⭐寶寶丁｜軟彈陣 備戰 2 隻 HP30 → 2×30=60',
    dmgOf(run('軟彈陣', c, { selfBench: 2 })) === 60, String(dmgOf(run('軟彈陣', c, { selfBench: 2 }))));
  chk('E ⭐寶寶丁｜軟彈陣 備戰 1 隻 HP30 + 1 隻非 HP30 → 只算 1×30=30',
    dmgOf(run('軟彈陣', c, { selfBenchSpec: [{ cid: c.id }, { cid: PLAIN.id }] })) === 30,
    String(dmgOf(run('軟彈陣', c, { selfBenchSpec: [{ cid: c.id }, { cid: PLAIN.id }] }))));
}

console.log('\n【F】對手是【ex】→ +80（defIsExPre）');
{
  const c = find('皮卡丘', '鬥志雷霆');
  const nonEx = tankNonEx(c), ex = tankEx(c);
  chk('F 皮卡丘｜鬥志雷霆 對手非 ex → 20', dmgOf(run('鬥志雷霆', c, { def: nonEx })) === 20, `${nonEx?.name}:${dmgOf(run('鬥志雷霆', c, { def: nonEx }))}`);
  chk('F ⭐皮卡丘｜鬥志雷霆 對手是【ex】→ 20+80=100', dmgOf(run('鬥志雷霆', c, { def: ex })) === 100, `${ex?.name}:${dmgOf(run('鬥志雷霆', c, { def: ex }))}`);
}

console.log('\n【G】自身傷害指示物 × 10（selfCountersMultiplyPre）');
{
  const c = find('皮卡丘', '氣沖沖伏特');
  chk('G 皮卡丘｜氣沖沖伏特 自身 0 個指示物 → 10', dmgOf(run('氣沖沖伏特', c)) === 10, String(dmgOf(run('氣沖沖伏特', c))));
  chk('G ⭐皮卡丘｜氣沖沖伏特 自身 4 個指示物（damage=40）→ 10+40=50',
    dmgOf(run('氣沖沖伏特', c, { atkPatch: { damage: 40 } })) === 50, String(dmgOf(run('氣沖沖伏特', c, { atkPatch: { damage: 40 } }))));
  chk('G ⭐皮卡丘｜氣沖沖伏特 指示物＝damage÷10（damage=60 → 10+60=70，不是 ×60）',
    dmgOf(run('氣沖沖伏特', c, { atkPatch: { damage: 60 } })) === 70, String(dmgOf(run('氣沖沖伏特', c, { atkPatch: { damage: 60 } }))));
}

console.log('\n【H】基本能量「屬性種類」× 50（selfBasicEnergyTypeCountPre）');
{
  const c = find('仙子伊布ex', '鮮豔和聲');
  const a = dmgOf(run('鮮豔和聲', c, { colorlessAs: 'Psychic' }));
  const b = dmgOf(run('鮮豔和聲', c, { colorlessAs: 'Psychic', atkEnergyTypes: ['Fire', 'Fire'] }));
  const d = dmgOf(run('鮮豔和聲', c, { colorlessAs: 'Psychic', atkEnergyTypes: ['Fire', 'Fire'], selfBenchSpec: [{ energy: ['Lightning'] }] }));
  chk('H 仙子伊布ex｜鮮豔和聲 全場只有【超】（3 張）→ 1 種 × 50 = 50', a === 50, String(a));
  chk('H ⭐鮮豔和聲 數的是「種類」不是張數：3【超】+2【火】= 5 張但 2 種 → 100', b === 100, String(b));
  chk('H ⭐鮮豔和聲 卡面「自己的**所有**寶可夢」：備戰帶【雷】→ 3 種 → 150', d === 150, String(d));
}

console.log('\n【I】棄牌區能量卡張數 × 20 / 手牌張數 × 10');
{
  const c = find('露奈雅拉', '午夜之光');
  const e0 = dmgOf(run('午夜之光', c, { discardCards: [] }));
  const e3 = dmgOf(run('午夜之光', c, { discardCards: [EID.Psychic, EID.Fire, EID.Water] }));
  const mix = dmgOf(run('午夜之光', c, { discardCards: [EID.Psychic, EID.Fire, PLAIN.id, PLAIN.id] }));
  chk('I 露奈雅拉｜午夜之光 棄牌區 0 張能量 → 20', e0 === 20, String(e0));
  chk('I ⭐露奈雅拉｜午夜之光 棄牌區 3 張能量 → 20+60=80', e3 === 80, String(e3));
  chk('I ⭐露奈雅拉｜午夜之光 只算能量卡：2 能量 + 2 寶可夢 → 20+40=60', mix === 60, String(mix));
}
{
  const c = find('伽勒爾 喵喵', '寶物猛攻');
  chk('I 伽勒爾 喵喵｜寶物猛攻 手牌 0 張 → 0', dmgOf(run('寶物猛攻', c, { handN: 0 })) === 0, String(dmgOf(run('寶物猛攻', c, { handN: 0 }))));
  chk('I ⭐伽勒爾 喵喵｜寶物猛攻 手牌 5 張 → 50', dmgOf(run('寶物猛攻', c, { handN: 5 })) === 50, String(dmgOf(run('寶物猛攻', c, { handN: 5 }))));
  chk('I ⭐寶物猛攻 數的是**自己**手牌：對手手牌張數不影響（仍是 20）',
    dmgOf(run('寶物猛攻', c, { handN: 2 })) === 20, String(dmgOf(run('寶物猛攻', c, { handN: 2 }))));
}

console.log('\n【J】「上個對手的回合」狀態（沿用既有欄位，本批未新增任何記錄機制）');
{
  const c = find('鬃岩狼人', '雙倍奉還');
  chk('J 鬃岩狼人｜雙倍奉還 上回合沒受傷 → 10', dmgOf(run('雙倍奉還', c)) === 10, String(dmgOf(run('雙倍奉還', c))));
  chk('J ⭐鬃岩狼人｜雙倍奉還 上回合受過 60 → 10+60=70',
    dmgOf(run('雙倍奉還', c, { atkPatch: { damageTakenLastOppTurn: 60 } })) === 70,
    String(dmgOf(run('雙倍奉還', c, { atkPatch: { damageTakenLastOppTurn: 60 } }))));
  const h = find('超級赫拉克羅斯ex', '重裝角擊');
  chk('J ⭐正對照：既有「超級赫拉克羅斯ex｜重裝角擊」100 / 100+60=160（收斂後行為不變）',
    dmgOf(run('重裝角擊', h)) === 100 && dmgOf(run('重裝角擊', h, { atkPatch: { damageTakenLastOppTurn: 60 } })) === 160,
    `${dmgOf(run('重裝角擊', h))}/${dmgOf(run('重裝角擊', h, { atkPatch: { damageTakenLastOppTurn: 60 } }))}`);
}
{
  const c = find('月亮伊布', '報仇');
  const KO = { statePatch: { oppDamageKOdMeInLastOppTurn: [1, 0] } };
  chk('J 月亮伊布｜報仇 上個對手回合沒被招式 KO → 30', dmgOf(run('報仇', c)) === 30, String(dmgOf(run('報仇', c))));
  chk('J ⭐月亮伊布｜報仇 上個對手回合有被招式傷害 KO → 30+100=130', dmgOf(run('報仇', c, KO)) === 130, String(dmgOf(run('報仇', c, KO))));
  chk('J ⭐月亮伊布｜報仇 讀的是「因**傷害**KO」那一格：只填 oppAttackKOdMeInLastOppTurn（含效果 KO）**不**加傷',
    dmgOf(run('報仇', c, { statePatch: { oppAttackKOdMeInLastOppTurn: [1, 0] } })) === 30,
    String(dmgOf(run('報仇', c, { statePatch: { oppAttackKOdMeInLastOppTurn: [1, 0] } }))));
  const rv = find('鐵斑葉', '復仇刀鋒');
  chk('J ⭐正對照：既有「鐵斑葉｜復仇刀鋒」100 / 100+60=160（收斂後行為不變）',
    dmgOf(run('復仇刀鋒', rv)) === 100 && dmgOf(run('復仇刀鋒', rv, KO)) === 160,
    `${dmgOf(run('復仇刀鋒', rv))}/${dmgOf(run('復仇刀鋒', rv, KO))}`);
}

console.log('\n【K】附有「寶可夢道具」卡 → +40（selfHasToolPre）');
{
  const c = find('蒼響', '堅硬利刃');
  const tool = findCard('氣球');   // 只影響撤退，對傷害是中性的道具
  chk('K0 fixture：氣球是「寶可夢道具」卡', tool?.subtype === 'PokemonTool', String(tool?.subtype));
  chk('K 蒼響｜堅硬利刃 沒有道具 → 20', dmgOf(run('堅硬利刃', c)) === 20, String(dmgOf(run('堅硬利刃', c))));
  chk('K ⭐蒼響｜堅硬利刃 附有道具 → 20+40=60',
    dmgOf(run('堅硬利刃', c, { atkPatch: { toolAttached: inst(tool.id) } })) === 60,
    String(dmgOf(run('堅硬利刃', c, { atkPatch: { toolAttached: inst(tool.id) } }))));
  chk('K ⭐蒼響｜堅硬利刃 道具在 extraTools（多重轉接的第 2 張）也算 → 60',
    dmgOf(run('堅硬利刃', c, { atkPatch: { extraTools: [inst(tool.id)] } })) === 60,
    String(dmgOf(run('堅硬利刃', c, { atkPatch: { extraTools: [inst(tool.id)] } }))));
}

console.log(`\nm6a-wave2：PASS ${pass} / FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
