// v6.427 守衛：「不受對手特性效果影響」（化隱／光之翼）的寶可夢，不會被對手的受傷反擊特性放傷害指示物
//
// 玩家回報（逐字）：詛咒娃娃[特性]化隱，這隻寶可夢不會受到對手的招式與特性的效果的影響，但當詛咒娃娃使用招式
//   玩偶捕捉 攻擊對手的 弱丁魚 [特性]群聚反擊 時，會受到 放置3個傷害指示物 的特性效果。
// 卡面（static/cards 逐字）：
//   詛咒娃娃（M5 19176，J）｜化隱：「這隻寶可夢不會受到對手的招式與特性的效果的影響。」
//   弱丁魚（M6a 19928，J）｜群聚反擊：「只要這隻寶可夢在場上，自己戰鬥場的「弱丁魚（包含『寶可夢【ex】』）」受到對手的寶可夢招式的傷害時，在使用招式的寶可夢身上放置3個傷害指示物。」
// 官方（PTCG_RULES，光之翼 × 咒詛炸彈）：不受對手特性效果影響的寶可夢，不會因對手的特性被放置傷害指示物。
// 真因：受傷反擊的豁免在 5 個消費點寫死 `'光之翼'`（化隱沒被問到）；備戰 anywhere 型反擊（快掃拳返）連光之翼都沒問；
//   冰冷之帳則把光之翼寫成「兩邊的雪妖女都不放」（自家的應該照放）、化隱只看印刷（特性被消除時仍擋）。
// 修法：全部改問 defense.ts 的中央 isImmuneToOppAbilityEffect（＝canApplyEffectToTarget(kind='ability-effect')）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6427-s.js'), E = join(ROOT, '.v6427-e.ts'), O = join(ROOT, '.v6427-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nexport * as DEF from './src/lib/game/defense';\nexport * as EFF from './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, DEF, EFF } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) { if (c?.id == null) continue; pool.set(String(c.id), c); all.push(c); }
}
const byId = (id) => { const c = pool.get(String(id)); if (!c) throw new Error('fixture 找不到 ' + id); return c; };
const byName = (n) => { const c = all.find((x) => x.name === n); if (!c) throw new Error('fixture 找不到 ' + n); return c; };
const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {};
for (const c of all) { if (c.supertype !== 'Energy') continue; for (const [k, z] of Object.entries(ZH)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = String(c.id); }
EID.Colorless = EID.Water;
let nn = 0;
const inst = (cid, extra = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [],
  abilityUsedThisTurn: false, evolvedThisTurn: false, playedFromHand: false, movedToActiveThisTurn: false, evolvedFromStack: [], ...extra });
const P = (o = {}) => ({ name: 'P', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [], ...o });
const mk = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null,
  setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
  activeStadium: null, activeStadiumOwnerIdx: 0, players: [P(p0), P(p1)], ...extra });
let pass = 0, fail = 0; const failed = [];
const chk = (t, c, extra = '') => { if (c) { pass++; console.log('  ✓', t); } else { fail++; failed.push(t.split(' ')[0]); console.log('  ❌', t, extra); } };
const withCoin = (h, fn) => { const o = Math.random; Math.random = () => (h ? 0.1 : 0.9); try { return fn(); } finally { Math.random = o; } };
const act = (st, a) => withCoin(true, () => { try { return applyAction(st, a, pool); } catch (e) { return { __err: e.message, log: [] }; } });
const atkIdx = (c, n) => (c.attacks || []).findIndex((a) => a.name === n);
const eFor = (c, n) => ((c.attacks || []).find((a) => a.name === n)?.cost ?? []).map((t) => inst(EID[t] ?? EID.Water));

const CURSOLA = byId('19176');   // 詛咒娃娃｜化隱｜玩偶捕捉（Stage1 80HP）
const FEEB = byId('19928');      // 弱丁魚｜群聚反擊（30HP）
const FEEBEX = byName('弱丁魚ex');
const PIXI = byId('18007');      // 超級皮可西ex｜光之翼｜射攻月亮
const SPIKE = byId('19586');     // 穿山王｜反擊針（110HP）
const LAVA = byName('傳說的熔岩洞');
const PLAIN = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length && !(c.tags || []).includes('太晶')
  && Number(c.hp) >= 70 && c.pokemonType === 'Colorless' && c.weakness?.type !== 'Colorless' && c.resistance?.type !== 'Colorless');
const MORT = all.find((c) => c.name === '摩托蜥' && (c.attacks || []).some((a) => a.name === '尾鞭'));
const filler = (n) => Array.from({ length: n }, () => inst(PLAIN.id));
const run = (atkCard, atkName, p1Active, p1Bench, extra = {}, atkExtra = {}) => {
  const a = inst(atkCard.id, { energyAttached: eFor(atkCard, atkName), ...atkExtra });
  const st = mk({ active: a, bench: [inst(PLAIN.id)], deck: filler(5), prizes: filler(6) },
    { active: p1Active, bench: p1Bench, deck: filler(5), prizes: filler(6) }, extra);
  let r = act(st, { type: 'ATTACK', attackIndex: atkIdx(atkCard, atkName) });
  // 玩偶捕捉「若希望…」會開牌庫 picker：選 0 張結束
  for (let k = 0; k < 3 && r?.pendingSelection && r.pendingSelection.actorIdx === 0; k++) r = act(r, { type: 'RESOLVE_SELECTION', selectedIids: [], senderIdx: 0 });
  return r;
};
const atkDmg = (r) => r?.players?.[0]?.active?.damage ?? null;
const logs = (r) => (r?.log ?? []).map((l) => String(l?.message ?? l));

console.log('\n【0】harness 自驗');
chk('0a 卡面逐字：化隱／群聚反擊（static/cards）',
  (CURSOLA.abilities || []).some((a) => a.name === '化隱' && a.effect === '這隻寶可夢不會受到對手的招式與特性的效果的影響。')
  && (FEEB.abilities || []).some((a) => a.name === '群聚反擊' && /在使用招式的寶可夢身上放置3個傷害指示物/.test(a.effect)));
chk('0b 有無豁免判準的中央函式（BASE 上沒有 ⇒ 本條紅）', typeof DEF.isImmuneToOppAbilityEffect === 'function');

console.log('\n【A】玩家回報：詛咒娃娃｜化隱 打弱丁魚｜群聚反擊');
{
  const ctrl = run(MORT, '尾鞭', inst(FEEBEX.id), [inst(FEEB.id)]);
  chk('A0 正對照：一般攻擊方打「弱丁魚ex（戰鬥）＋弱丁魚（備戰，群聚反擊）」⇒ 攻擊方被放 3 個（+30）', atkDmg(ctrl) === 30, 'dmg=' + atkDmg(ctrl) + ' ' + (ctrl.__err ?? ''));
  const r1 = run(CURSOLA, '玩偶捕捉', inst(FEEB.id), []);
  chk('A1 ⭐⭐⭐【HEAD-FAIL】玩偶捕捉擊倒戰鬥場的弱丁魚（KO 分支）⇒ 詛咒娃娃 0 傷害', atkDmg(r1) === 0, 'dmg=' + atkDmg(r1) + ' ' + (r1.__err ?? '') + ' ' + logs(r1).slice(-4).join(' / '));
  const r2 = run(CURSOLA, '玩偶捕捉', inst(FEEBEX.id), [inst(FEEB.id)]);
  chk('A2 ⭐⭐⭐【HEAD-FAIL】打弱丁魚ex（沒擊倒；群聚反擊在備戰，field-wide 非 KO 分支）⇒ 詛咒娃娃 0 傷害', atkDmg(r2) === 0, 'dmg=' + atkDmg(r2));
  chk('A3 ⭐【HEAD-FAIL】log 說明擋下的是化隱（舊碼寫死「光之翼：」）', logs(r2).some((m) => m.startsWith('化隱：詛咒娃娃 不受對手特性效果影響')), logs(r2).slice(-3).join(' / '));
  // 化隱被【傳說的熔岩洞】消除（詛咒娃娃是 1 階進化）⇒ 反擊照放
  const r3 = run(CURSOLA, '玩偶捕捉', inst(FEEBEX.id), [inst(FEEB.id)], { activeStadium: inst(LAVA.id), activeStadiumOwnerIdx: 1 });
  chk('A4 ⭐⭐ 化隱被熔岩洞消除 ⇒ 群聚反擊照放（+30）——豁免跟著特性有效性走', atkDmg(r3) === 30, 'dmg=' + atkDmg(r3));
}

console.log('\n【B】同型：其他受傷反擊特性');
{
  const ctrl = run(MORT, '尾鞭', inst(SPIKE.id), []);
  const ctrlD = atkDmg(ctrl);
  chk('B0 正對照：一般攻擊方打穿山王｜反擊針 ⇒ 被放指示物', ctrlD > 0, 'dmg=' + ctrlD);
  const r = run(CURSOLA, '玩偶捕捉', inst(SPIKE.id), []);
  chk('B1 ⭐⭐【HEAD-FAIL】詛咒娃娃打穿山王｜反擊針 ⇒ 0 傷害（PASSIVE_RETALIATION 非 KO 分支）', atkDmg(r) === 0, 'dmg=' + atkDmg(r));
  const rp = run(PIXI, '射攻月亮', inst(FEEBEX.id), [inst(FEEB.id)]);
  chk('B2 零回歸：超級皮可西ex｜光之翼 打弱丁魚ex（群聚反擊在備戰）仍然 0 傷害', atkDmg(rp) === 0, 'dmg=' + atkDmg(rp));
}

console.log('\n【C】中央判準與消費點');
{
  const st = mk({ active: inst(CURSOLA.id), bench: [], deck: [], prizes: [] }, { active: inst(FEEB.id), bench: [], deck: [], prizes: [] });
  const f = DEF.isImmuneToOppAbilityEffect ?? (() => null);
  chk('C1 ⭐【HEAD-FAIL】對手（座位 1）的特性效果 ⇒ 化隱擋', f(st, 1, st.players[0].active, pool, true) === true);
  chk('C2 自己（座位 0）的特性效果 ⇒ 不擋（卡面「對手的」）', f(st, 0, st.players[0].active, pool, true) === false);
  const st2 = mk({ active: inst(MORT.id), bench: [], deck: [], prizes: [] }, { active: inst(FEEB.id), bench: [], deck: [], prizes: [] });
  chk('C3 沒有豁免特性 ⇒ 不擋', f(st2, 1, st2.players[0].active, pool, true) === false);
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const eff = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
  const lit = (s) => (s.match(/hasEffectiveAbilityByInst\([^)]*'光之翼'\)/g) || []).length;
  chk('C4 ⭐⭐【HEAD-FAIL】engine／effects 不再寫死 `hasEffectiveAbilityByInst(…, \'光之翼\')`（判準只剩 defense.ts 一份）',
    lit(eng) === 0 && lit(eff.replace(/_v6196HasEffAbilByInst/g, 'hasEffectiveAbilityByInst')) === 0, `engine ${lit(eng)}／effects ${lit(eff.replace(/_v6196HasEffAbilByInst/g, 'hasEffectiveAbilityByInst'))}`);
  const iAny = eff.indexOf('if (ANYWHERE_RETALIATION.has(ab.name) && isAbilityHolderEffective(st, _bt');
  chk('C5 ⭐【HEAD-FAIL】備戰 anywhere 型反擊（快掃拳返）也問攻擊方豁免', iAny > 0 && /isImmuneToOppAbilityEffect\(st, dIdx, st\.players\[actorIdx\]\.active, pool, true\)/.test(eff.slice(iAny, iAny + 400)));
}

console.log('\n【D】冰冷之帳（雪妖女）');
{
  const FROS = all.find((c) => c.name === '雪妖女' && (c.abilities || []).some((a) => a.name === '冰冷之帳'));
  // 回合結束的寶可夢檢查：P0 場上 超級皮可西ex（光之翼）＋自家雪妖女；P1 場上詛咒娃娃（化隱）＋對手雪妖女
  const st = mk(
    { active: inst(PIXI.id), bench: [inst(FROS.id)], deck: filler(5), prizes: filler(6) },
    { active: inst(CURSOLA.id), bench: [inst(FROS.id)], deck: filler(5), prizes: filler(6) });
  const r = act(st, { type: 'END_TURN' });
  const pixiD = r?.players?.[0]?.active?.damage, cursD = r?.players?.[1]?.active?.damage;
  chk('D1 ⭐⭐【HEAD-FAIL】光之翼只擋「對手的」雪妖女：自家雪妖女照放（皮可西 +10）', pixiD === 10, 'pixi=' + pixiD + ' ' + (r.__err ?? ''));
  chk('D2 化隱只擋對手的雪妖女：自家雪妖女照放（詛咒娃娃 +10）', cursD === 10, 'curs=' + cursD);
}

console.log('\n【E】不作用在攻擊方的受傷觸發特性（警備濁霧）不可以被攻擊方的豁免擋掉');
{
  const WEEZ = byId('12819');   // 火箭隊的瓦斯彈｜警備濁霧：受傷後從自己的牌庫找「瓦斯彈」寶可夢放備戰
  const deckWeez = [inst(WEEZ.id), inst(WEEZ.id), ...filler(3)];
  const mkRun = (atk, name) => {
    const a = inst(atk.id, { energyAttached: eFor(atk, name) });
    const st = mk({ active: a, bench: [inst(PLAIN.id)], deck: filler(5), prizes: filler(6) },
      { active: inst(WEEZ.id, { damage: 0 }), bench: [], deck: deckWeez.map((c) => ({ ...c, iid: 'w' + (++nn) })), prizes: filler(6) });
    let r = act(st, { type: 'ATTACK', attackIndex: atkIdx(atk, name) });
    for (let k = 0; k < 3 && r?.pendingSelection && r.pendingSelection.actorIdx === 0; k++) r = act(r, { type: 'RESOLVE_SELECTION', selectedIids: [], senderIdx: 0 });
    return r;
  };
  const fired = (r) => (r?.pendingSelection && r.pendingSelection.actorIdx === 1) || logs(r).some((m) => /警備濁霧/.test(m));
  const ctrl = mkRun(MORT, '尾鞭');
  chk('E0 正對照：一般攻擊方打瓦斯彈 ⇒ 警備濁霧觸發', fired(ctrl), logs(ctrl).slice(-3).join(' / ') + (ctrl.__err ?? ''));
  const r = mkRun(CURSOLA, '玩偶捕捉');
  chk('E1 ⭐⭐ 詛咒娃娃（化隱）打瓦斯彈 ⇒ 警備濁霧照常觸發（它只作用在瓦斯彈自己那一側）', fired(r), logs(r).slice(-3).join(' / '));
  const rp = mkRun(PIXI, '射攻月亮');
  chk('E2 ⭐⭐【HEAD-FAIL】超級皮可西ex（光之翼）打瓦斯彈 ⇒ 警備濁霧照常觸發（舊碼跟著反擊一起擋掉）', fired(rp), logs(rp).slice(-3).join(' / '));
}

// ════════════════════════════════════════════════════════════════════════════
// 【F】⭐⭐ 審查（fable 5.1）補的**行為端**案例：
//   A／B 用的「玩偶捕捉」帶「若希望」picker ⇒ 實際走 resolver → effects.dealAttackDamageToTarget，
//   **不經過 engine.ts 的 KO／非 KO 主管線**。這裡改用**沒有 picker** 的「怨影娃娃｜垂吊」（化隱、10 傷害）
//   逼 engine 主管線跑一次；並補 炸裂針（被擊倒反擊）、備戰 anywhere 型（快掃拳返）、
//   陳舊的頭蓋化石｜頭蓋尖刺（卡面印的是**特性**）、耿鬼ex｜死亡宣告（特性來源的效果昏厥 vs 光之翼）。
// ════════════════════════════════════════════════════════════════════════════
console.log('\n【F】engine 主管線＋其他反擊型態（無 picker 的招式）');
{
  const HANG = byId('19175');      // 怨影娃娃｜化隱｜垂吊 10（基礎 50HP）
  const CACT = byId('12468');      // 沙鈴仙人掌｜炸裂針（110HP）：在戰鬥場上被擊倒 ⇒ 攻擊方 6 個
  const ORTH = byId('17004');      // 拖拖蚓ex｜快掃拳返（anywhere 型；鋼能量數×2 個）
  const FOSSIL = byId('19215');    // 陳舊的頭蓋化石｜頭蓋尖刺（HP60【無】基礎；特性）
  const GENG = byId('19988');      // 耿鬼ex｜死亡宣告（280HP）
  const TOWER = byName('火箭隊的監視塔');
  const FROS = all.find((c) => c.name === '雪妖女' && (c.abilities || []).some((a) => a.name === '冰冷之帳'));
  chk('F0 卡面逐字：頭蓋尖刺印成「特性」／炸裂針／死亡宣告（static/cards）',
    FOSSIL.abilities?.[0]?.label === '特性' && FOSSIL.abilities?.[0]?.name === '頭蓋尖刺'
    && /在使用招式的寶可夢身上放置3個傷害指示物/.test(FOSSIL.abilities[0].effect)
    && (CACT.abilities || []).some((a) => a.name === '炸裂針') && (GENG.abilities || []).some((a) => a.name === '死亡宣告')
    && (HANG.abilities || []).some((a) => a.name === '化隱') && (HANG.attacks || [])[0]?.name === '垂吊');
  const koed = (r, cid) => !(r?.players?.[1]?.active?.cardId === String(cid));

  // F1 非 KO 主管線：反擊針
  const c1 = run(MORT, '尾鞭', inst(SPIKE.id), []);
  const r1 = run(HANG, '垂吊', inst(SPIKE.id), []);
  chk('F1 ⭐⭐⭐【HEAD-FAIL】engine 非 KO 分支：怨影娃娃（化隱）打穿山王｜反擊針 ⇒ 0（正對照摩托蜥 >0）',
    atkDmg(c1) > 0 && atkDmg(r1) === 0 && !koed(r1, SPIKE.id), `ctrl=${atkDmg(c1)} hang=${atkDmg(r1)} ${r1.__err ?? ''}`);
  chk('F1b log 只列本來會觸發的反擊（「化隱：怨影娃娃 不受對手特性效果影響（反擊針 無效）」）',
    logs(r1).some((m) => m === '化隱：怨影娃娃 不受對手特性效果影響（反擊針 無效）'), logs(r1).slice(-3).join(' / '));

  // F2 KO 主管線：炸裂針（預傷到 10 就倒）
  const pre = (Number(CACT.hp) - 10);
  const c2 = run(MORT, '尾鞭', inst(CACT.id, { damage: pre }), [inst(PLAIN.id)]);
  const r2 = run(HANG, '垂吊', inst(CACT.id, { damage: pre }), [inst(PLAIN.id)]);
  chk('F2 ⭐⭐⭐【HEAD-FAIL】engine KO 分支：怨影娃娃擊倒沙鈴仙人掌｜炸裂針 ⇒ 0（正對照 +60）',
    koed(c2, CACT.id) && atkDmg(c2) === 60 && koed(r2, CACT.id) && atkDmg(r2) === 0, `ctrl=${atkDmg(c2)} hang=${atkDmg(r2)} ko=${koed(r2, CACT.id)}`);
  chk('F2b KO 分支擋下也留一行（炸裂針 無效）', logs(r2).some((m) => m === '化隱：怨影娃娃 不受對手特性效果影響（炸裂針 無效）'), logs(r2).slice(-4).join(' / '));
  // F2c effects.fireDefenderOnKO 路徑（玩偶捕捉走 resolver）
  const r2c = run(CURSOLA, '玩偶捕捉', inst(CACT.id, { damage: pre }), [inst(PLAIN.id)]);
  chk('F2c ⭐⭐【HEAD-FAIL】effects 路徑：詛咒娃娃（玩偶捕捉）擊倒沙鈴仙人掌 ⇒ 0', koed(r2c, CACT.id) && atkDmg(r2c) === 0, `dmg=${atkDmg(r2c)}`);

  // F3 field-wide（engine 非 KO）
  const r3 = run(HANG, '垂吊', inst(FEEBEX.id), [inst(FEEB.id)]);
  chk('F3 ⭐⭐⭐【HEAD-FAIL】engine：怨影娃娃打弱丁魚ex（群聚反擊在備戰）⇒ 0，log 列「群聚反擊 無效」',
    atkDmg(r3) === 0 && logs(r3).some((m) => /^化隱：怨影娃娃 不受對手特性效果影響（.*群聚反擊.*無效）$/.test(m)), `dmg=${atkDmg(r3)} ${logs(r3).slice(-2).join(' / ')}`);

  // F4 備戰 anywhere 型（快掃拳返）：直呼 dealAttackDamageToTarget 打備戰
  const mkBench = (atk) => mk({ active: inst(atk.id), bench: [], deck: filler(5), prizes: filler(6) },
    { active: inst(PLAIN.id), bench: [inst(ORTH.id, { iid: 'orth', energyAttached: [inst(EID.Metal), inst(EID.Metal)] })], deck: filler(5), prizes: filler(6) });
  const b0 = EFF.dealAttackDamageToTarget(mkBench(MORT), 0, 'orth', 30, pool);
  const b1 = EFF.dealAttackDamageToTarget(mkBench(CURSOLA), 0, 'orth', 30, pool);
  const b2 = EFF.dealAttackDamageToTarget(mkBench(PIXI), 0, 'orth', 30, pool);
  chk('F4 ⭐⭐【HEAD-FAIL】備戰的拖拖蚓ex｜快掃拳返：一般攻擊方 +40；化隱 0；光之翼 0',
    b0.players[0].active.damage === 40 && b1.players[0].active.damage === 0 && b2.players[0].active.damage === 0,
    `mort=${b0.players[0].active.damage} curs=${b1.players[0].active.damage} pixi=${b2.players[0].active.damage}`);

  // F5 陳舊的頭蓋化石｜頭蓋尖刺（特性）
  const fos = (extra = {}) => inst(FOSSIL.id, { fossilOnField: true, ...extra });
  const c5 = run(MORT, '尾鞭', fos(), [inst(PLAIN.id)]);
  const r5 = run(HANG, '垂吊', fos(), [inst(PLAIN.id)]);
  chk('F5 ⭐⭐⭐【HEAD-FAIL】頭蓋尖刺是特性：怨影娃娃（化隱）打化石 ⇒ 0（正對照摩托蜥 +30）',
    atkDmg(c5) === 30 && atkDmg(r5) === 0, `ctrl=${atkDmg(c5)} hang=${atkDmg(r5)} ${logs(r5).slice(-2).join(' / ')}`);
  chk('F5b 擋下只留一行、且沒有自相矛盾的「放置 3 個」', logs(r5).filter((m) => /頭蓋尖刺 無效/.test(m)).length === 1
    && !logs(r5).some((m) => /^陳舊的頭蓋化石：在 /.test(m)), logs(r5).slice(-3).join(' / '));
  const r5k = run(HANG, '垂吊', fos({ damage: Number(FOSSIL.hp ?? 60) - 10 }), [inst(PLAIN.id)]);
  chk('F5c ⭐⭐【HEAD-FAIL】KO 分支：怨影娃娃擊倒化石 ⇒ 0', koed(r5k, FOSSIL.id) && atkDmg(r5k) === 0, `dmg=${atkDmg(r5k)}`);
  const r5p = run(PIXI, '射攻月亮', fos(), [inst(PLAIN.id)]);
  chk('F5d ⭐⭐【HEAD-FAIL】光之翼擊倒化石 ⇒ 0', atkDmg(r5p) === 0, `dmg=${atkDmg(r5p)}`);
  const r5t = run(MORT, '尾鞭', fos(), [inst(PLAIN.id)], { activeStadium: inst(TOWER.id), activeStadiumOwnerIdx: 1 });
  chk('F5e ⭐【HEAD-FAIL】火箭隊的監視塔（【無】特性全部消除；化石是【無】）⇒ 頭蓋尖刺不觸發（0）', atkDmg(r5t) === 0, `dmg=${atkDmg(r5t)}`);

  // F6 耿鬼ex｜死亡宣告（特性來源的效果昏厥）
  const gpre = Number(GENG.hp) - 10;
  const c6 = run(MORT, '尾鞭', inst(GENG.id, { damage: gpre }), [inst(PLAIN.id)]);
  const r6 = run(PIXI, '射攻月亮', inst(GENG.id, { damage: gpre }), [inst(PLAIN.id)]);
  const pixiAlive = r6?.players?.[0]?.active?.cardId === String(PIXI.id);
  chk('F6 ⭐⭐⭐【HEAD-FAIL】耿鬼ex｜死亡宣告（正面）：光之翼 ⇒ 超級皮可西ex 不昏厥（正對照：摩托蜥被昏厥）',
    koed(c6, GENG.id) && logs(c6).some((m) => /死亡宣告：摩托蜥 被昏厥/.test(m))
    && koed(r6, GENG.id) && pixiAlive && !logs(r6).some((m) => /死亡宣告：超級皮可西ex 被昏厥/.test(m)),
    `ctrl=${logs(c6).filter((m) => /死亡宣告/.test(m)).join('|')} pixi=${logs(r6).filter((m) => /死亡宣告/.test(m)).join('|')}`);

  // F7 log 不再把不相干的特性列成「無效」（engine 非 KO 分支原本列出防守方全部特性）
  const r7 = run(HANG, '垂吊', inst(FROS.id), [inst(PLAIN.id)]);
  chk('F7 ⭐ 怨影娃娃打雪妖女（冰冷之帳不是受傷反擊）⇒ 不留「…無效」', !logs(r7).some((m) => /不受對手特性效果影響/.test(m)), logs(r7).slice(-3).join(' / '));

  // F8 engine **非 KO** 分支的警備濁霧（E 組只走到 effects 路徑與 engine KO 分支；審查突變 M3a 在這裡存活）
  const WEEZ = byId('12819');
  const stW = mk({ active: inst(HANG.id, { energyAttached: eFor(HANG, '垂吊') }), bench: [inst(PLAIN.id)], deck: filler(5), prizes: filler(6) },
    { active: inst(WEEZ.id), bench: [], deck: [inst(WEEZ.id), inst(WEEZ.id), ...filler(3)], prizes: filler(6) });
  const r8 = act(stW, { type: 'ATTACK', attackIndex: atkIdx(HANG, '垂吊') });
  const weezFired = (r8?.pendingSelection && r8.pendingSelection.actorIdx === 1) || logs(r8).some((m) => /警備濁霧/.test(m));
  chk('F8 ⭐⭐ engine 非 KO 分支：怨影娃娃（化隱）打瓦斯彈（沒擊倒）⇒ 警備濁霧照常觸發',
    r8?.players?.[1]?.active?.cardId === String(WEEZ.id) && weezFired, logs(r8).slice(-3).join(' / ') + (r8.__err ?? ''));
}

console.log(`\n=== v6.427 不受對手特性效果影響 × 受傷反擊：PASS ${pass} / FAIL ${fail} ===` + (fail ? '（紅：' + failed.join('、') + '）' : ''));
if (fail) process.exit(1);
