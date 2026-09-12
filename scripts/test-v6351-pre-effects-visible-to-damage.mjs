// v6.351 守衛：「在造成傷害前…」的 ATTACK_PRE 效果，必須被**同一次**的傷害結算看見。
//
// ⚠⚠ 根因：`const defender = { ...players[dIdx] }` 是在 applyAction 最上面就抓走的快照，
//   而整條傷害管線（弱點／抵抗力、減傷道具、有效 HP、免疫閘…）讀的全是那個快照
//   ⇒ 凡是卡面寫「在造成傷害前…」的 PRE 效果，對**這一次**的傷害完全無效。
//   修正：PRE 跑完後 `Object.assign(defender, workingState.players[dIdx])`（engine.ts 哨兵
//   `v6351-resync-defender-after-pre`）。
//
// 本檔一律用**行為端數字**驗證，並對「造成傷害前丟對手道具」家族的**全部 9 張**各驗一次。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6351-s.js'), E = join(ROOT, '.v6351-e.ts'), O = join(ROOT, '.v6351-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) { if (c?.id == null) continue; pool.set(String(c.id), c); all.push(c); }
}
const byId = (id) => { const c = pool.get(String(id)); if (!c) throw new Error('fixture 找不到 ' + id); return c; };
const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {};
for (const c of all) { if (c.supertype !== 'Energy') continue;
  for (const [k, z] of Object.entries(ZH)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = String(c.id); }
EID.Colorless = EID.Water;
let nn = 0;
const inst = (cid, extra = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [],
  abilityUsedThisTurn: false, evolvedThisTurn: false, playedFromHand: false, movedToActiveThisTurn: false,
  evolvedFromStack: [], ...extra });
const P = (o = {}) => ({ name: 'P', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [], ...o });
const mk = (p0, p1) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true], pendingMulliganDraw: [0, 0],
  pendingPrizes: [0, 0], coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
  activeStadium: null, activeStadiumOwnerIdx: 0, players: [P(p0), P(p1)] });
let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; console.log('  ✓', t); } else { fail++; console.log('  ❌', t, extra); } };
const heads = (fn) => { const o = Math.random; Math.random = () => 0.1; try { return fn(); } finally { Math.random = o; } };
const act = (st, a) => heads(() => { try { return applyAction(st, a, pool); } catch (e) { return { __err: e.message, log: [], players: st.players }; } });
const A0 = (r) => r?.players?.[0]?.active;
const D0 = (r) => r?.players?.[1]?.active;
const atkIdx = (card, name) => (card.attacks || []).findIndex((a) => a.name === name);
const costE = (card, name) => ((card.attacks || []).find((a) => a.name === name)?.cost ?? []).map((t) => inst(EID[t] ?? EID.Water));

// ── fixtures ────────────────────────────────────────────────────────────────
const CAPE = byId(17164 === 17164 ? (all.find((c) => c.name === '英雄斗篷')?.id) : 0);  // 英雄斗篷：最大HP +100（無任何限制）
const HEART = byId(17164);                                        // 霹霹果：受【鋼】招式傷害 -60 並丟棄自己
const PLAIN = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length
  && !(c.tags || []).includes('太晶') && Number(c.hp) >= 60 && c.pokemonType === 'Colorless');

/** 「在造成傷害前，將對手的戰鬥寶可夢身上附加的『寶可夢道具』卡丟棄。」家族（逐字或同族措辭）。 */
const FAMILY = [
  ['烈雀', '啄食', 10],
  ['拉達', '削落', 20],
  ['燃燒蟲', '啄落', 10],
  ['金魚王', '啄落', 50],
  ['破破舵輪', '破壞船錨', 80],
  ['派帕的貪心栗鼠', '咬取', 10],
  ['藏瑪然特', '彈落', 20],
  ['切割洛托姆', '割除衝刺', 30],
  ['N的電電蟲', '劈哩啪啦短路', 30],
];
const findAtk = (n, a) => {
  const hits = all.filter((c) => c.name === n && (c.attacks || []).some((x) => x.name === a));
  if (!hits.length) throw new Error(`fixture 找不到 ${n}｜${a}`);
  return hits[0];
};

console.log('\n【0】harness 自驗');
chk('0a 英雄斗篷（最大HP +100，無限制）與 霹霹果（受【鋼】招式 -60）都抓得到',
  !!CAPE && String(CAPE.rulesText).includes('+100') && String(HEART.rulesText).includes('-60'),
  JSON.stringify([CAPE?.name, HEART?.name]));
chk('0b 家族 9 張都在卡庫裡，而且卡面逐字都有「在造成傷害前」',
  FAMILY.every(([n, a]) => String(findAtk(n, a).attacks.find((x) => x.name === a).effect ?? '').includes('在造成傷害前')),
  FAMILY.map(([n, a]) => `${n}|${a}`).join('、'));
chk('0c 有乾淨的【無】屬性 fixture', !!PLAIN, String(PLAIN?.name));

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【A】通用判準：道具在傷害前被丟掉 ⇒ 它給的「最大HP +100」這一次就不算');
{
  /** 靶：Basic／無特性／對出招者屬性中立（弱抗會把數字打歪）／HP >= 這一招的基礎傷害。 */
  const targetFor = (A, base) => all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic'
    && !(c.abilities || []).length && !(c.tags || []).includes('太晶')
    && Number(c.hp) >= base && Number(c.hp) <= base + 60
    && c.weakness?.type !== A.pokemonType && c.resistance?.type !== A.pokemonType);
  /** 建盤面：靶的**剩餘 HP 剛好等於這一招的基礎傷害** ⇒ 沒有斗篷就昏厥、有斗篷就活。 */
  const run = (name, atkName, base, withCape) => {
    const A = findAtk(name, atkName);
    const T = targetFor(A, base);
    const a = inst(A.id, { energyAttached: [...costE(A, atkName), ...costE(A, atkName)] });
    const hp = Number(T.hp);
    const d = inst(T.id, { damage: Math.max(0, hp - base), ...(withCape ? { toolAttached: inst(CAPE.id) } : {}) });
    const st = mk(
      { active: a, bench: [inst(PLAIN.id)], deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) },
      { active: d, bench: [inst(PLAIN.id)], deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) });
    return act(st, { type: 'ATTACK', attackIndex: atkIdx(A, atkName) });
  };
  for (const [name, atkName, base] of FAMILY) {
    const A = findAtk(name, atkName);
    const T = targetFor(A, base);
    if (!T) { chk(`A ${name}｜${atkName}：找不到合用的中立靶（harness 設計錯誤）`, false, `base=${base}`); continue; }
    // 哨兵：不戴斗篷時這一擊本來就會昏厥（證明「剩餘 HP = 基礎傷害」的盤面成立）
    const r0 = run(name, atkName, base, false);
    chk(`A-s ${name}｜${atkName} 哨兵：不戴道具時這一擊就會昏厥（靶 ${T.name} HP${T.hp}）`,
      D0(r0) == null, JSON.stringify(D0(r0)?.damage));
    const r = run(name, atkName, base, true);
    chk(`A ⭐⭐${name}｜${atkName}：戴著英雄斗篷 ⇒ 道具先被丟掉 ⇒ 這一擊仍然昏厥`,
      D0(r) == null, JSON.stringify([D0(r)?.damage, !!D0(r)?.toolAttached]));
  }
  // ⭐ 反對照：同樣的盤面，但攻擊方**不丟道具**（用一般招式）⇒ 斗篷仍然算 ⇒ 活下來
  {
    const Z = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic'
      && (c.attacks || []).some((x) => String(x.damage) === '20' && !String(x.effect ?? '').trim())
      && !(c.abilities || []).length);
    const atkName = (Z.attacks.find((x) => String(x.damage) === '20' && !String(x.effect ?? '').trim())).name;
    const a = inst(Z.id, { energyAttached: [...costE(Z, atkName), ...costE(Z, atkName), ...costE(Z, atkName)] });
    const hp = Number(PLAIN.hp);
    const d = inst(PLAIN.id, { damage: hp - 20, toolAttached: inst(CAPE.id) });
    const st = mk({ active: a, bench: [inst(PLAIN.id)], deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) },
      { active: d, bench: [inst(PLAIN.id)], deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) });
    const r = act(st, { type: 'ATTACK', attackIndex: atkIdx(Z, atkName) });
    chk(`A-ctl ⭐⭐反對照：${Z.name}｜${atkName}（不丟道具，同樣 20 點）⇒ 斗篷仍算 ⇒ **不**昏厥`,
      !!D0(r) && !!D0(r).toolAttached, JSON.stringify([D0(r)?.damage, !!D0(r)?.toolAttached]));
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【B】減傷道具：霹霹果（受【鋼】招式傷害 -60 並丟棄自己）');
{
  const Z = findAtk('藏瑪然特', '彈落');   // 【鋼】屬性、彈落 20
  const TGT = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length
    && !(c.tags || []).includes('太晶') && Number(c.hp) >= 120
    && c.weakness?.type !== 'Metal' && c.resistance?.type !== 'Metal');
  const run = (withTool) => {
    const a = inst(Z.id, { energyAttached: costE(Z, '彈落') });
    const d = inst(TGT.id, withTool ? { toolAttached: inst(HEART.id) } : {});
    const st = mk({ active: a, bench: [inst(PLAIN.id)], deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) },
      { active: d, bench: [inst(PLAIN.id)], deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) });
    return act(st, { type: 'ATTACK', attackIndex: atkIdx(Z, '彈落') });
  };
  const a0 = run(false), a1 = run(true);
  chk('B1 哨兵：無道具時 彈落 造成 20（靶對【鋼】中立）', D0(a0)?.damage === 20, String(D0(a0)?.damage));
  chk('B2 ⭐⭐⭐戴霹霹果時**仍然** 20（道具在傷害前已被丟掉，-60 不該再套）',
    D0(a1)?.damage === 20, String(D0(a1)?.damage));
  chk('B3 哨兵：霹霹果真的進了棄牌區、不在身上',
    !D0(a1)?.toolAttached && a1.players[1].discard.length === 1,
    JSON.stringify([!!D0(a1)?.toolAttached, a1.players[1].discard.length]));
  chk('B4 ⭐⭐不得再出現「霹霹果：招式傷害 -N」那一行 log（舊 bug 的指紋）',
    !(a1.log ?? []).some((l) => String(l?.message ?? l?.text ?? l).includes('霹霹果：招式傷害')),
    JSON.stringify((a1.log ?? []).map((l) => String(l?.message ?? l?.text ?? l)).slice(-4)));
  // ⭐⭐ 多重轉接：身上**兩張**霹霹果（toolAttached + extraTools），卡面是「全部丟棄」
  //   （v5.779 §17.46.D）⇒ 只丟第一張的話，剩下那張的 -60 會把傷害壓成 0。
  //   ⚠ 這裡刻意用**不會昏厥**的盤面：昏厥時身上所有卡本來就會一起進棄牌區，
  //     用棄牌區張數當判準會被 KO 洗掉（第一版就踩到，突變 M5 沒紅）。
  {
    const a = inst(Z.id, { energyAttached: costE(Z, '彈落') });
    const d = inst(TGT.id, { toolAttached: inst(HEART.id), extraTools: [inst(HEART.id)] });
    const st = mk({ active: a, bench: [inst(PLAIN.id)], deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) },
      { active: d, bench: [inst(PLAIN.id)], deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) });
    const r = act(st, { type: 'ATTACK', attackIndex: atkIdx(Z, '彈落') });
    chk('B-multi ⭐⭐多重轉接：身上 2 張霹霹果 ⇒ **全部**丟棄 ⇒ 仍然造成 20（不是 0）',
      D0(r)?.damage === 20
      && r.players[1].discard.filter((c) => c.cardId === String(HEART.id)).length === 2
      && !D0(r)?.toolAttached && (D0(r)?.extraTools ?? []).length === 0,
      JSON.stringify([D0(r)?.damage, r.players[1].discard.length, !!D0(r)?.toolAttached, (D0(r)?.extraTools ?? []).length]));
  }
  // ⭐正對照：霹霹果本身是有效的 —— 換一張**不丟道具**的【鋼】招式，-60 必須照樣生效
  {
    const M = all.find((c) => c.supertype === 'Pokemon' && c.pokemonType === 'Metal' && c.stage === 'Basic'
      && !(c.abilities || []).length
      && (c.attacks || []).some((x) => /^\d+$/.test(String(x.damage)) && Number(x.damage) >= 60 && !String(x.effect ?? '').trim()));
    const mn = (M.attacks.find((x) => /^\d+$/.test(String(x.damage)) && Number(x.damage) >= 60 && !String(x.effect ?? '').trim())).name;
    const mBase = Number(M.attacks.find((x) => x.name === mn).damage);
    const a = inst(M.id, { energyAttached: [...costE(M, mn), ...costE(M, mn), ...costE(M, mn)] });
    const d = inst(TGT.id, { toolAttached: inst(HEART.id) });
    const st = mk({ active: a, bench: [inst(PLAIN.id)], deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) },
      { active: d, bench: [inst(PLAIN.id)], deck: [inst(PLAIN.id)], prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)) });
    const r = act(st, { type: 'ATTACK', attackIndex: atkIdx(M, mn) });
    chk(`B5 ⭐⭐正對照：${M.name}｜${mn}（【鋼】${mBase}，不丟道具）⇒ 霹霹果 -60 照樣生效`,
      D0(r)?.damage === Math.max(0, mBase - 60), `${mBase} → ${D0(r)?.damage}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n【C】中央性：engine 只有一處對齊，而且在 PRE 之後');
{
  const eng = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const src = strip(eng);
  const n = src.split('Object.assign(defender, workingState.players[dIdx]);').length - 1;
  chk('C1 ⭐全檔只有一處對齊', n === 1, `${n} 處`);
  chk('C2 ⭐掃描器正對照：樣本裡有這段字面時必須算得到',
    ('x Object.assign(defender, workingState.players[dIdx]); y'
      .split('Object.assign(defender, workingState.players[dIdx]);').length - 1) === 1);
  chk('C3 ⭐⭐對齊必須在 preFn 之後（在它之前等於沒修）',
    src.indexOf('preFn(workingState, aIdx, pool, action)') > 0
    && src.indexOf('Object.assign(defender, workingState.players[dIdx]);') > src.indexOf('preFn(workingState, aIdx, pool, action)'));
  chk('C4 ⭐只對齊 defender、不動 attacker（attacker 側在 PRE 之前已被本函式動過）',
    (src.split('Object.assign(attacker, workingState.players[aIdx]);').length - 1) === 0);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} v6.351「造成傷害前」效果對傷害生效：${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
