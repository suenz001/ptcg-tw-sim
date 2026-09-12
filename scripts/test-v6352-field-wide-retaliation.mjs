// v6.352 守衛：「field-wide 受傷反擊」收斂成中央管線（FIELD_WIDE_RETALIATION +
//   fireFieldWideRetaliation），並實裝「弱丁魚｜群聚反擊」。
//
// 卡面家族（逐字）：
//   花岩怪｜怨恨旋渦（M1L 13996／M1L 14189／MC 16926）
//     「只要這隻寶可夢在場上，自己戰鬥場的【惡】寶可夢受到對手的寶可夢招式的傷害時，
//       在使用招式的寶可夢身上放置1個傷害指示物。」
//   弱丁魚｜群聚反擊（M6a 19928）
//     「只要這隻寶可夢在場上，自己戰鬥場的「弱丁魚（包含『寶可夢【ex】』）」受到對手的
//       寶可夢招式的傷害時，在使用招式的寶可夢身上放置3個傷害指示物。」
//
// ⭐ 本檔**全部行為端**（真的建盤面 → applyAction('ATTACK') → 讀盤面數字），
//   只有 C 組是「中央性」靜態斷言（Rule 38：同一個判準只能有一份）。
// ⭐⭐ A 組的每一個數字都是**收斂前**用 __m6a/probe352.mjs 在未改動的工作樹上實測出來的，
//   不是事後補寫的期望值 ⇒ A 組全綠 ＝「怨恨旋渦零行為變更」。
// ⭐ 每一條效果斷言都配哨兵：靶身上必須有卡面傷害（招式沒被執行時效果斷言會是空真）。
// ⚠ 攻擊方一律用「摩托蜥｜尾鞭」（【無】10 點、無效果、無特性、HP110）——
//   對【惡】（弱點【草】）與【水】（弱點【雷】）的靶都中立，且 HP 夠高不會被反擊反殺。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6352-s.js'), E = join(ROOT, '.v6352-e.ts'), O = join(ROOT, '.v6352-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { applyAction } from './src/lib/game/engine';\n"
  + "export { FIELD_WIDE_RETALIATION } from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, FIELD_WIDE_RETALIATION } = await import(pathToFileURL(O).href);

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
const withAb = (ab) => all.filter((c) => (c.abilities || []).some((a) => a.name === ab));
const findAb = (n, ab) => {
  const hits = all.filter((c) => c.name === n && (c.abilities || []).some((a) => a.name === ab));
  if (!hits.length) throw new Error(`fixture 找不到 ${n}｜${ab}`);
  return hits.find((c) => String(c.setCode) === 'M6a') ?? hits[0];
};
const findAtk = (n, a) => {
  const hits = all.filter((c) => c.name === n && (c.attacks || []).some((x) => x.name === a));
  if (!hits.length) throw new Error(`fixture 找不到 ${n}｜${a}`);
  return hits[0];
};
const byName = (n) => { const c = all.find((x) => x.name === n); if (!c) throw new Error('fixture 找不到 ' + n); return c; };

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
const P = (o = {}) => ({ name: 'P', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [], ...o });
const mk = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
  coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
  activeStadium: null, activeStadiumOwnerIdx: 0,
  players: [P(p0), P(p1)], ...extra,
});

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; console.log('  ✓', t); } else { fail++; console.log('  ❌', t, extra); } };

const withCoin = (h, fn) => { const o = Math.random; Math.random = () => (h ? 0.1 : 0.9); try { return fn(); } finally { Math.random = o; } };
const act = (st, a) => withCoin(true, () => { try { return applyAction(st, a, pool); } catch (e) { return { __err: e.message, log: [] }; } });
const atkIdx = (c, n) => (c.attacks || []).findIndex((a) => a.name === n);
const eForCost = (c, n) => ((c.attacks || []).find((a) => a.name === n)?.cost ?? []).map((t) => inst(EID[t] ?? EID.Water));

// ── fixtures ────────────────────────────────────────────────────────────────
const GEODE  = findAb('花岩怪', '怨恨旋渦');        // Basic 80HP【惡】
const FEEB   = findAb('弱丁魚', '群聚反擊');        // M6a 19928 Basic 30HP【水】
const FEEBEX = byName('弱丁魚ex');                  // M6 19571 Basic 260HP【水】（特性是「大洋增輝」，不是群聚反擊）
const MORT   = findAtk('摩托蜥', '尾鞭');           // 攻擊方：【無】10 點、無效果、無特性、HP110
const ARTI   = findAtk('急凍鳥', '冰雹');           // 多目標：戰鬥場走 engine mainline、備戰走 hitBenchAll
const UMB    = findAtk('月亮伊布', '出奇一擊');     // multiSnipePost → snipe-multi resolver → fireDefenderOnDamaged
const PIXI   = findAb('超級皮可西ex', '光之翼');    // 攻擊方持有「不受對手特性效果影響」
const LAVA   = byName('傳說的熔岩洞');              // 進化寶可夢特性全消除（超級皮可西ex 是 Stage1）
const TOWER  = byName('火箭隊的監視塔');            // 【無】寶可夢特性全消除
const PLAIN  = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length
  && !(c.tags || []).includes('太晶') && Number(c.hp) >= 70 && c.pokemonType === 'Colorless'
  && c.weakness?.type !== 'Colorless' && c.resistance?.type !== 'Colorless');
const DARKP  = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length
  && !(c.tags || []).includes('太晶') && c.pokemonType === 'Darkness' && Number(c.hp) >= 130
  && c.weakness?.type !== 'Colorless' && c.resistance?.type !== 'Colorless' && c.weakness?.type !== 'Psychic');

const filler = (n) => Array.from({ length: n }, () => inst(PLAIN.id));
/** p0 出招打 p1 的戰鬥場。回傳結算後的 state。 */
const run = (atkCard, atkName, p1Active, p1Bench, extra = {}) => {
  const a = inst(atkCard.id, { energyAttached: eForCost(atkCard, atkName) });
  const st = mk(
    { active: a, bench: [inst(PLAIN.id)], deck: filler(3), prizes: filler(6) },
    { active: p1Active, bench: p1Bench, deck: filler(3), prizes: filler(6) }, extra);
  return act(st, { type: 'ATTACK', attackIndex: atkIdx(atkCard, atkName) });
};
const A0 = (r) => r?.players?.[0]?.active;
const D0 = (r) => r?.players?.[1]?.active;
const atkDmg = (r) => A0(r)?.damage ?? null;
const defDmg = (r) => (D0(r) == null ? 'KO' : D0(r).damage);
const retalLogs = (r) => (r?.log ?? []).map((l) => String(l?.message ?? l)).filter((m) => /怨恨旋渦|群聚反擊/.test(m));

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【0】harness 自驗');
{
  chk('0a 抓得到兩張卡（花岩怪｜怨恨旋渦、弱丁魚｜群聚反擊）',
    String(GEODE.id) && String(FEEB.id) === '19928', `${GEODE?.id}/${FEEB?.id}`);
  chk('0b 弱丁魚ex 存在且**沒有**「群聚反擊」（B3 靠它證明「包含寶可夢【ex】」）',
    !!FEEBEX && !(FEEBEX.abilities || []).some((a) => a.name === '群聚反擊'),
    JSON.stringify([FEEBEX?.id, (FEEBEX?.abilities || []).map((a) => a.name)]));
  chk('0c 攻擊方「摩托蜥｜尾鞭」是【無】10 點無效果無特性',
    MORT.pokemonType === 'Colorless' && !(MORT.abilities || []).length
    && MORT.attacks.find((a) => a.name === '尾鞭').damage === '10'
    && !MORT.attacks.find((a) => a.name === '尾鞭').effect,
    JSON.stringify([MORT.pokemonType, MORT.attacks.find((a) => a.name === '尾鞭')]));
  chk('0d 靶對攻擊方【無】都中立（無弱點也無抵抗力）',
    [GEODE, FEEB, FEEBEX, DARKP, PLAIN].every((c) => c.weakness?.type !== 'Colorless' && c.resistance?.type !== 'Colorless'),
    JSON.stringify([GEODE, FEEB, FEEBEX, DARKP, PLAIN].map((c) => [c.name, c.weakness?.type, c.resistance?.type])));
  chk('0f 月亮伊布｜出奇一擊 是「不計弱點・抵抗力」的 50 點單目標狙擊（D 組靠它走 effects 那個消費點）',
    UMB.attacks.find((a) => a.name === '出奇一擊')?.effect
      === '對手的1隻寶可夢受到50點傷害。這個招式的傷害不計算弱點・抵抗力與受到傷害的寶可夢身上的附加效果。',
    String(UMB.attacks.find((a) => a.name === '出奇一擊')?.effect));
  chk('0e 有【惡】對照靶（非怨恨旋渦持有者）與【無】對照靶',
    !!DARKP && DARKP.pokemonType === 'Darkness' && !!PLAIN && PLAIN.pokemonType === 'Colorless',
    JSON.stringify([DARKP?.name, PLAIN?.name]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【A】花岩怪｜怨恨旋渦 —— 收斂後**零行為變更**（數字全部取自收斂前的實測基準）');
{
  const rA1 = run(MORT, '尾鞭', inst(GEODE.id), [inst(PLAIN.id)]);
  chk('A1 哨兵：花岩怪在戰鬥場確實吃到卡面 10 點', defDmg(rA1) === 10, String(defDmg(rA1)));
  chk('A1 ⭐花岩怪在**戰鬥場**被打 ⇒ 攻擊方 +10', atkDmg(rA1) === 10, String(atkDmg(rA1)));

  const rA2 = run(MORT, '尾鞭', inst(DARKP.id), [inst(GEODE.id), inst(PLAIN.id)]);
  chk('A2 哨兵：戰鬥場的【惡】靶確實吃到 10 點', defDmg(rA2) === 10, String(defDmg(rA2)));
  chk('A2 ⭐花岩怪在**備戰**、戰鬥場是另一隻【惡】 ⇒ 攻擊方 +10', atkDmg(rA2) === 10, String(atkDmg(rA2)));

  const rA3 = run(MORT, '尾鞭', inst(PLAIN.id), [inst(GEODE.id), inst(PLAIN.id)]);
  chk('A3 哨兵：非【惡】靶確實吃到 10 點', defDmg(rA3) === 10, String(defDmg(rA3)));
  chk('A3 ⭐反對照：戰鬥場是**非【惡】** ⇒ 攻擊方 0', atkDmg(rA3) === 0, String(atkDmg(rA3)));

  const rA4 = run(MORT, '尾鞭', inst(DARKP.id, { damage: Number(DARKP.hp) - 10 }), [inst(GEODE.id), inst(PLAIN.id)]);
  chk('A4 哨兵：戰鬥場的【惡】靶真的被這一擊打到昏厥', defDmg(rA4) === 'KO', String(defDmg(rA4)));
  chk('A4 ⭐⭐**KO 分支**：戰鬥場那隻被一擊打死 ⇒ 備戰的花岩怪照樣反擊（engine KO branch）',
    atkDmg(rA4) === 10, String(atkDmg(rA4)));

  const rA4b = run(MORT, '尾鞭', inst(GEODE.id, { damage: Number(GEODE.hp) - 10 }), [inst(PLAIN.id)]);
  chk('A4b 哨兵：花岩怪自己在戰鬥場被打到昏厥', defDmg(rA4b) === 'KO', String(defDmg(rA4b)));
  chk('A4b ⭐KO 分支（持有者自己就是戰鬥位）⇒ 攻擊方 +10', atkDmg(rA4b) === 10, String(atkDmg(rA4b)));

  chk('A5 ⭐⭐log 逐字未變：`怨恨旋渦：摩托蜥 身上放置 1 個傷害指示物（+10）`',
    retalLogs(rA1).length === 1 && retalLogs(rA1)[0] === '怨恨旋渦：摩托蜥 身上放置 1 個傷害指示物（+10）',
    JSON.stringify(retalLogs(rA1)));

  const rA5b = run(MORT, '尾鞭', inst(GEODE.id), [inst(GEODE.id), inst(PLAIN.id)]);
  chk('A5b 哨兵：戰鬥場的花岩怪確實吃到 10 點', defDmg(rA5b) === 10, String(defDmg(rA5b)));
  chk('A5b ⭐兩隻花岩怪（戰鬥場＋備戰）各觸發一次 ⇒ +20、log 兩行',
    atkDmg(rA5b) === 20 && retalLogs(rA5b).length === 2,
    JSON.stringify([atkDmg(rA5b), retalLogs(rA5b).length]));

  const rA5c = run(MORT, '尾鞭', inst(GEODE.id), [inst(GEODE.id), inst(GEODE.id), inst(PLAIN.id)]);
  chk('A5c 哨兵：戰鬥場的花岩怪確實吃到 10 點', defDmg(rA5c) === 10, String(defDmg(rA5c)));
  chk('A5c ⭐⭐備戰的**每一隻**持有者都要各掃到：三隻花岩怪 ⇒ +30、log 三行',
    atkDmg(rA5c) === 30 && retalLogs(rA5c).length === 3,
    JSON.stringify([atkDmg(rA5c), retalLogs(rA5c).length]));

  // ⚠ 對「Basic 非規則寶可夢的**備戰**持有者」而言，站上唯一能消除它特性的來源是
  //   【火箭隊的監視塔】×【化石在場上＝HP60 的【無】寶可夢】（v6.145 的 fossilOnField）。
  //   傳說的熔岩洞只消除**進化**寶可夢、初始化只消除**規則**寶可夢、暗夜羽擊只作用於**戰鬥場**、
  //   黏著束縛只作用於**備戰的 2 階** ⇒ 花岩怪（Basic【惡】）全都碰不到。
  const foss = { fossilOnField: true };
  const rA6 = run(MORT, '尾鞭', inst(DARKP.id), [inst(GEODE.id, foss), inst(PLAIN.id)],
    { activeStadium: inst(TOWER.id), activeStadiumOwnerIdx: 0 });
  const rA6c = run(MORT, '尾鞭', inst(DARKP.id), [inst(GEODE.id, foss), inst(PLAIN.id)]);
  chk('A6 哨兵：兩組的戰鬥場靶都確實吃到 10 點', defDmg(rA6) === 10 && defDmg(rA6c) === 10,
    JSON.stringify([defDmg(rA6), defDmg(rA6c)]));
  chk('A6 ⭐備戰持有者特性被消除（火箭隊的監視塔 × 化石在場上＝【無】）⇒ 不反擊',
    atkDmg(rA6) === 0, String(atkDmg(rA6)));
  chk('A6c ⭐正對照：同一個盤面拿掉競技場 ⇒ 照樣 +10（證明差異來自特性消除閘）',
    atkDmg(rA6c) === 10, String(atkDmg(rA6c)));

  const rA7 = run(MORT, '尾鞭', inst(GEODE.id, { abilityNullifiedThisTurn: true }), [inst(PLAIN.id)]);
  chk('A7 哨兵：戰鬥場的花岩怪確實吃到 10 點', defDmg(rA7) === 10, String(defDmg(rA7)));
  chk('A7 ⭐戰鬥位持有者特性被招式消除（abilityNullifiedThisTurn）⇒ 不反擊',
    atkDmg(rA7) === 0, String(atkDmg(rA7)));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【B】弱丁魚｜群聚反擊（M6a 19928）—— 3 個傷害指示物');
{
  const rB1 = run(MORT, '尾鞭', inst(FEEB.id), [inst(PLAIN.id)]);
  chk('B1 哨兵：弱丁魚在戰鬥場確實吃到卡面 10 點（HP30 ⇒ 存活）', defDmg(rB1) === 10, String(defDmg(rB1)));
  chk('B1 ⭐弱丁魚在戰鬥場被打 ⇒ 攻擊方 **+30**（3 個指示物）', atkDmg(rB1) === 30, String(atkDmg(rB1)));
  chk('B1 log 逐字：`群聚反擊：摩托蜥 身上放置 3 個傷害指示物（+30）`',
    retalLogs(rB1).length === 1 && retalLogs(rB1)[0] === '群聚反擊：摩托蜥 身上放置 3 個傷害指示物（+30）',
    JSON.stringify(retalLogs(rB1)));

  const rB2 = run(MORT, '尾鞭', inst(FEEB.id), [inst(FEEB.id), inst(PLAIN.id)]);
  chk('B2 哨兵：戰鬥場的弱丁魚確實吃到 10 點', defDmg(rB2) === 10, String(defDmg(rB2)));
  chk('B2/B5 ⭐⭐弱丁魚在備戰、戰鬥場是另一隻弱丁魚 ⇒ **各觸發一次**（+60、log 兩行）',
    atkDmg(rB2) === 60 && retalLogs(rB2).length === 2,
    JSON.stringify([atkDmg(rB2), retalLogs(rB2).length]));

  const rB3 = run(MORT, '尾鞭', inst(FEEBEX.id), [inst(FEEB.id), inst(PLAIN.id)]);
  chk('B3 哨兵：戰鬥場的弱丁魚ex 確實吃到 10 點', defDmg(rB3) === 10, String(defDmg(rB3)));
  chk('B3 ⭐⭐戰鬥場是 **弱丁魚ex** ⇒ 備戰的弱丁魚照樣觸發（卡面「包含寶可夢【ex】」）+30',
    atkDmg(rB3) === 30, String(atkDmg(rB3)));
  chk('B3b ⭐哨兵：弱丁魚ex 自己沒有群聚反擊 ⇒ 只有一行 log（不是兩行）',
    retalLogs(rB3).length === 1, JSON.stringify(retalLogs(rB3)));

  const rB4 = run(MORT, '尾鞭', inst(PLAIN.id), [inst(FEEB.id), inst(PLAIN.id)]);
  chk('B4 哨兵：戰鬥場的對照靶確實吃到 10 點', defDmg(rB4) === 10, String(defDmg(rB4)));
  chk('B4 ⭐反對照：戰鬥場是別的寶可夢 ⇒ 攻擊方 0', atkDmg(rB4) === 0, String(atkDmg(rB4)));

  const rB4b = run(MORT, '尾鞭', inst(DARKP.id), [inst(FEEB.id), inst(PLAIN.id)]);
  chk('B4b ⭐交叉反對照：戰鬥場是【惡】（怨恨旋渦的主詞）但備戰只有弱丁魚 ⇒ 0',
    atkDmg(rB4b) === 0 && defDmg(rB4b) === 10, JSON.stringify([atkDmg(rB4b), defDmg(rB4b)]));

  const rB6 = run(MORT, '尾鞭', inst(FEEBEX.id, { damage: Number(FEEBEX.hp) - 10 }), [inst(FEEB.id), inst(PLAIN.id)]);
  chk('B6 哨兵：弱丁魚ex 真的被這一擊打到昏厥', defDmg(rB6) === 'KO', String(defDmg(rB6)));
  chk('B6 ⭐**KO 分支**也要生效 ⇒ 攻擊方 +30', atkDmg(rB6) === 30, String(atkDmg(rB6)));

  const rB6b = run(MORT, '尾鞭', inst(FEEB.id, { damage: Number(FEEB.hp) - 10 }), [inst(FEEB.id), inst(PLAIN.id)]);
  chk('B6b 哨兵：戰鬥場的弱丁魚被打到昏厥', defDmg(rB6b) === 'KO', String(defDmg(rB6b)));
  chk('B6b ⭐KO 分支 × 兩隻持有者 ⇒ +60', atkDmg(rB6b) === 60, String(atkDmg(rB6b)));

  const rB5c = run(MORT, '尾鞭', inst(FEEBEX.id), [inst(FEEB.id), inst(FEEB.id), inst(PLAIN.id)]);
  chk('B5c 哨兵：戰鬥場的弱丁魚ex 確實吃到 10 點', defDmg(rB5c) === 10, String(defDmg(rB5c)));
  chk('B5c ⭐⭐備戰兩隻弱丁魚各觸發一次 ⇒ +60、log 兩行（持有者不是「有一隻就好」）',
    atkDmg(rB5c) === 60 && retalLogs(rB5c).length === 2,
    JSON.stringify([atkDmg(rB5c), retalLogs(rB5c).length]));

  const rB8 = run(MORT, '尾鞭', inst(FEEBEX.id), [inst(FEEB.id, { fossilOnField: true }), inst(PLAIN.id)],
    { activeStadium: inst(TOWER.id), activeStadiumOwnerIdx: 0 });
  chk('B8 哨兵：戰鬥場的弱丁魚ex 確實吃到 10 點', defDmg(rB8) === 10, String(defDmg(rB8)));
  chk('B8 ⭐備戰的弱丁魚特性被消除 ⇒ 不反擊（與 A6 同一支中央閘）', atkDmg(rB8) === 0, String(atkDmg(rB8)));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【D】effects.fireDefenderOnDamaged 路徑（月亮伊布｜出奇一擊 → multiSnipePost → snipe-multi resolver）');
{
  // ⚠ 這一組打的是 **effects.ts 那個消費點**：招式的傷害不走 engine 主管線，而是由
  //   `snipe-multi` resolver 呼叫 `fireDefenderOnDamaged` ⇒ 3b 的 field-wide 反擊在這裡生效。
  //   （急凍鳥｜冰雹 的戰鬥場那一份是 regPre 走 engine mainline，測不到這個點 —— 見下方 D5/D6。）
  // ⭐ picker 一定要真的 RESOLVE_SELECTION 解掉，只驗「有開 picker」＝安慰劑。
  const runSnipe = (p1Active, p1Bench) => {
    const st = mk(
      { active: inst(UMB.id, { energyAttached: eForCost(UMB, '出奇一擊') }), bench: [inst(PLAIN.id)], deck: filler(3), prizes: filler(6) },
      { active: p1Active, bench: p1Bench, deck: filler(3), prizes: filler(6) });
    const r0 = act(st, { type: 'ATTACK', attackIndex: atkIdx(UMB, '出奇一擊') });
    const key = r0?.pendingSelection?.effectKey ?? null;
    const r = key ? act(r0, { type: 'RESOLVE_SELECTION', selectedIids: [p1Active.iid], actorIdx: 0 }) : r0;
    return { r, key };
  };
  const d1 = runSnipe(inst(DARKP.id), [inst(GEODE.id), inst(PLAIN.id)]);
  chk('D0 哨兵：出奇一擊真的開了 `snipe-multi` picker 並且被解掉（不是「有開就算」）',
    d1.key === 'snipe-multi' && d1.r?.pendingSelection == null, JSON.stringify([d1.key, d1.r?.pendingSelection?.effectKey ?? null]));
  chk('D1 哨兵：戰鬥場的【惡】靶確實吃到 50 點（出奇一擊不計弱抗）', defDmg(d1.r) === 50, String(defDmg(d1.r)));
  chk('D1 ⭐⭐effects.fireDefenderOnDamaged 路徑：備戰花岩怪照樣反擊 ⇒ +10（只一次）',
    atkDmg(d1.r) === 10 && retalLogs(d1.r).length === 1, JSON.stringify([atkDmg(d1.r), retalLogs(d1.r).length]));

  const d2 = runSnipe(inst(PLAIN.id), [inst(GEODE.id), inst(PLAIN.id)]);
  chk('D2 哨兵：對照靶照樣吃到 50 點', defDmg(d2.r) === 50, String(defDmg(d2.r)));
  chk('D2 ⭐反對照：戰鬥場非【惡】⇒ 0', atkDmg(d2.r) === 0, String(atkDmg(d2.r)));

  const d3 = runSnipe(inst(FEEBEX.id), [inst(FEEB.id), inst(PLAIN.id)]);
  chk('D3 哨兵：弱丁魚ex 確實吃到 50 點', defDmg(d3.r) === 50, String(defDmg(d3.r)));
  chk('D3 ⭐⭐群聚反擊在同一條路徑上也生效 ⇒ +30', atkDmg(d3.r) === 30, String(atkDmg(d3.r)));

  const d4 = runSnipe(inst(FEEB.id), [inst(FEEB.id), inst(PLAIN.id)]);
  chk('D4 哨兵：戰鬥場的弱丁魚被 50 點打到昏厥', defDmg(d4.r) === 'KO', String(defDmg(d4.r)));
  chk('D4 ⭐這條路徑的 KO 情境：戰鬥場＋備戰各觸發一次 ⇒ +60、log 兩行',
    atkDmg(d4.r) === 60 && retalLogs(d4.r).length === 2, JSON.stringify([atkDmg(d4.r), retalLogs(d4.r).length]));

  // ── 急凍鳥｜冰雹（戰鬥場走 engine mainline、備戰走 hitBenchAll）────────────────
  const rD5 = run(ARTI, '冰雹', inst(DARKP.id), [inst(GEODE.id), inst(PLAIN.id)]);
  chk('D5 哨兵：冰雹真的打到戰鬥場（30）與備戰（各 30）',
    defDmg(rD5) === 30 && JSON.stringify(rD5.players[1].bench.map((b) => b.damage)) === '[30,30]',
    JSON.stringify([defDmg(rD5), rD5.players[1].bench.map((b) => b.damage)]));
  chk('D5 ⭐多目標招式（備戰也吃傷害）下備戰花岩怪仍只反擊一次 ⇒ +10',
    atkDmg(rD5) === 10 && retalLogs(rD5).length === 1, JSON.stringify([atkDmg(rD5), retalLogs(rD5).length]));

  // ⚠⚠ v6.357 站長裁定 C-7 ⇒ 依 **Rule 40 把判準上移到意圖層（不是放寬、不是刪除）**。
  //   原本這一條釘的是「卡面前提『在場上』⇒ 備戰持有者被同一招打到離場就不觸發（0）」。
  //   站長逐字裁定：「備戰那一份傷害先結算 ⇒ 弱丁魚先昏厥離場，但還是要計算他當初留下的特性，
  //   因此還是要在使用招式的寶可夢身上放置3個傷害指示物」⇒ 「在不在場上」改依**宣告當時**判定。
  //   ⇒ 這裡從 1 條改成 4 條（比原本**嚴格**）：
  //     ① 哨兵：備戰持有者真的被同一招打到離場（不是活著）
  //     ② 仍然觸發 +30，而且**只放一次**（不可因為同時在「當下盤面」與「宣告當時快照」而 +60）
  //     ③ 哨兵：反對照組的持有者同樣真的離場
  //     ④ 反對照：宣告當時特性**就已經**被消除 ⇒ 即使離場也**不**觸發（證明不是放寬成無條件觸發）
  //   這一維的完整守備在 scripts/test-v6357-field-wide-retal-attack-time.mjs。
  const rD6 = run(ARTI, '冰雹', inst(FEEBEX.id), [inst(FEEB.id), inst(PLAIN.id)]);
  chk('D6 哨兵：冰雹打到戰鬥場的弱丁魚ex（30），備戰的弱丁魚（HP30）被同一招打到昏厥離場',
    defDmg(rD6) === 30 && rD6.players[1].bench.length === 1
    && pool.get(rD6.players[1].bench[0].cardId)?.name !== '弱丁魚',
    JSON.stringify([defDmg(rD6), rD6.players[1].bench.map((b) => [pool.get(b.cardId)?.name, b.damage])]));
  chk('D6 ⭐⭐v6.357 站長裁定 C-7：備戰持有者已離場，但宣告當時在場上且特性生效 ⇒ 仍觸發 +30（且只放一次）',
    atkDmg(rD6) === 30 && retalLogs(rD6).length === 1,
    JSON.stringify([atkDmg(rD6), retalLogs(rD6).length]));
  const rD6b = run(ARTI, '冰雹', inst(FEEBEX.id),
    [inst(FEEB.id, { fossilOnField: true, damage: 30 }), inst(PLAIN.id)],
    { activeStadium: inst(TOWER.id), activeStadiumOwnerIdx: 0 });
  chk('D6b 哨兵：反對照組的備戰持有者同樣被這一招打到昏厥離場',
    defDmg(rD6b) === 30 && rD6b.players[1].bench.length === 1
    && pool.get(rD6b.players[1].bench[0].cardId)?.name !== '弱丁魚',
    JSON.stringify([defDmg(rD6b), rD6b.players[1].bench.map((b) => [pool.get(b.cardId)?.name, b.damage])]));
  chk('D6b ⭐⭐反對照：宣告當時特性就被消除（火箭隊的監視塔×化石在場上）⇒ 即使離場也不觸發（0）',
    atkDmg(rD6b) === 0 && retalLogs(rD6b).length === 0,
    JSON.stringify([atkDmg(rD6b), retalLogs(rD6b).length]));

  const rD7 = run(ARTI, '冰雹', inst(FEEB.id), [inst(FEEB.id), inst(PLAIN.id)]);
  chk('D7 哨兵：戰鬥場的弱丁魚（HP30）被冰雹打到昏厥', defDmg(rD7) === 'KO', String(defDmg(rD7)));
  chk('D7 ⭐⭐冰雹的 KO 分支：戰鬥場＋備戰兩隻弱丁魚各觸發一次 ⇒ +60、log 兩行',
    atkDmg(rD7) === 60 && retalLogs(rD7).length === 2,
    JSON.stringify([atkDmg(rD7), retalLogs(rD7).length]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【E】光之翼豁免**原封保留**（三個消費點各自的條件沒被搬進中央 helper）');
{
  const rE1 = run(PIXI, '射攻月亮', inst(DARKP.id), [inst(GEODE.id), inst(PLAIN.id)]);
  chk('E1 哨兵：超級皮可西ex 的招式確實打中（120）', defDmg(rE1) === 120, String(defDmg(rE1)));
  chk('E1 ⭐攻擊方持有「光之翼」⇒ 備戰花岩怪的反擊被擋（攻擊方 0）', atkDmg(rE1) === 0, String(atkDmg(rE1)));

  const rE2 = run(PIXI, '射攻月亮', inst(DARKP.id), [inst(GEODE.id), inst(PLAIN.id)],
    { activeStadium: inst(LAVA.id), activeStadiumOwnerIdx: 0 });
  chk('E2 哨兵：同一招照樣打中（120）', defDmg(rE2) === 120, String(defDmg(rE2)));
  chk('E2 ⭐正對照：傳說的熔岩洞消除進化寶可夢特性 ⇒ 光之翼失效、反擊恢復（+10）',
    atkDmg(rE2) === 10, String(atkDmg(rE2)));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【C】中央性（Rule 38）—— 同一個判準只能有一份');
{
  const engSrc = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const effSrc = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
  const countOf = (src, needle) => src.split(needle).length - 1;

  // C1：'怨恨旋渦' 這個**字面**（含引號）在兩個大檔裡只剩中央表那一處
  const LIT = "'怨恨旋渦'";
  const nEng = countOf(engSrc, LIT), nEff = countOf(effSrc, LIT);
  chk('C1 ⭐engine.ts 裡沒有任何 `\'怨恨旋渦\'` 字面（4 處手寫已全部收斂）', nEng === 0, String(nEng));
  chk('C1 ⭐effects.ts 裡的 `\'怨恨旋渦\'` 字面只剩 1 處', nEff === 1, String(nEff));
  const specIdx = effSrc.indexOf('export const FIELD_WIDE_RETALIATION');
  const specEnd = effSrc.indexOf('\n];', specIdx);
  chk('C1b ⭐那唯一一處就在 FIELD_WIDE_RETALIATION 表裡',
    specIdx > 0 && specEnd > specIdx && effSrc.slice(specIdx, specEnd).includes(LIT),
    JSON.stringify([specIdx, specEnd]));
  // ⭐正對照：掃描器本身不是恆真的（人造兩處會被數到 2）
  chk('C1c ⭐正對照：同一支掃描器對人造字串會數到 2（證明 C1 不是空真）',
    countOf(`a = '怨恨旋渦'; b = '怨恨旋渦';`, LIT) === 2);

  // C2：每一筆 face 與 static/cards 的卡面逐字相同
  chk('C2 ⭐FIELD_WIDE_RETALIATION 剛好 2 筆（怨恨旋渦／群聚反擊）',
    Array.isArray(FIELD_WIDE_RETALIATION) && FIELD_WIDE_RETALIATION.length === 2,
    JSON.stringify((FIELD_WIDE_RETALIATION || []).map((s) => s.ability)));
  for (const spec of FIELD_WIDE_RETALIATION || []) {
    const prints = withAb(spec.ability);
    chk(`C2 ${spec.ability}：卡庫裡找得到印刷（${prints.length} 張）`, prints.length > 0, String(prints.length));
    const faces = [...new Set(prints.map((c) => (c.abilities || []).find((a) => a.name === spec.ability)?.effect))];
    chk(`C2 ⭐${spec.ability}：spec.face 與 static/cards 的卡面**逐字相同**（全部印刷同一份）`,
      faces.length === 1 && faces[0] === spec.face, JSON.stringify([spec.face, faces]));
    chk(`C2b ${spec.ability}：卡面的「放置N個傷害指示物」與 spec.counters 一致`,
      spec.face.includes(`放置${spec.counters}個傷害指示物`), String(spec.counters));
  }
  // C2c：activeQualifies 真的是卡面主詞（直接餵卡物件）
  const gSpec = (FIELD_WIDE_RETALIATION || []).find((s) => s.ability === '怨恨旋渦');
  const fSpec = (FIELD_WIDE_RETALIATION || []).find((s) => s.ability === '群聚反擊');
  chk('C2c ⭐怨恨旋渦 activeQualifies：【惡】✓／【無】✗',
    !!gSpec && gSpec.activeQualifies(DARKP) === true && gSpec.activeQualifies(PLAIN) === false);
  chk('C2d ⭐群聚反擊 activeQualifies：弱丁魚 ✓／弱丁魚ex ✓／其他 ✗',
    !!fSpec && fSpec.activeQualifies(FEEB) === true && fSpec.activeQualifies(FEEBEX) === true
    && fSpec.activeQualifies(PLAIN) === false && fSpec.activeQualifies(DARKP) === false);

  // C3：三處掃描都改成呼叫同一支 helper
  const CALL = 'fireFieldWideRetaliation(';
  const callLines = (src, file) => src.split(/\r?\n/)
    .map((l, i) => [file, i + 1, l])
    .filter(([, , l]) => l.includes(CALL) && !l.includes('export function ') && !l.includes('* '));
  const sites = [...callLines(engSrc, 'engine.ts'), ...callLines(effSrc, 'effects.ts')];
  chk('C3 ⭐⭐三處掃描都改成呼叫同一支 helper（呼叫點剛好 3 個）',
    sites.length === 3, JSON.stringify(sites.map(([f, n]) => `${f}:${n}`)));
  chk('C3b ⭐engine.ts 2 處（KO／非 KO）＋ effects.ts 1 處（fireDefenderOnDamaged）',
    sites.filter(([f]) => f === 'engine.ts').length === 2 && sites.filter(([f]) => f === 'effects.ts').length === 1,
    JSON.stringify(sites.map(([f, n]) => `${f}:${n}`)));
  chk('C3c ⭐helper 只有一份定義（export function 剛好 1 次，且在 effects.ts）',
    countOf(effSrc, 'export function fireFieldWideRetaliation(') === 1
    && countOf(engSrc, 'export function fireFieldWideRetaliation(') === 0);
  chk('C3d ⭐放指示物／寫 log 的內部 helper 只有一份（1 定義 + 2 呼叫，全在 effects.ts）',
    countOf(effSrc, 'placeFieldWideRetaliationCounters(') === 3
    && countOf(engSrc, 'placeFieldWideRetaliationCounters(') === 0,
    String(countOf(effSrc, 'placeFieldWideRetaliationCounters(')));

  // C4：三處的光之翼豁免逐字還在（③ 決議：條件不逐字相同 ⇒ 留在消費點，不搬進 helper）
  const GUARDS = [
    ['engine.ts KO 分支', engSrc, 'if (!_v456KoMagicalShine && baseDamage > 0) {'],
    ['engine.ts 非 KO 分支', engSrc, 'if (!_v5113RanInKoBranch && baseDamage > 0 && !attackerHasMagicalShine) {'],
    ['effects.ts fireDefenderOnDamaged', effSrc, 'if (!attackerHasMagicalShine) {'],
  ];
  for (const [tag, src, needle] of GUARDS) {
    chk(`C4 ⭐光之翼豁免原封保留：${tag}`, src.includes(needle), needle);
  }
  chk('C4b ⭐豁免**沒有**被搬進中央 helper（helper 本體不提光之翼）',
    !effSrc.slice(effSrc.indexOf('export function fireFieldWideRetaliation('),
      effSrc.indexOf('export const PASSIVE_RETALIATION')).includes('MagicalShine'));

  // C5：PASSIVE_RETALIATION 的兩個成員由中央 spec 產生（不是手寫）
  chk('C5 ⭐PASSIVE_RETALIATION 的成員由中央表展開（`...FIELD_WIDE_RETALIATION.map(`）',
    effSrc.includes('...FIELD_WIDE_RETALIATION.map('));
  chk('C5b ⭐effects.ts 裡沒有 `\'群聚反擊\'` 的第二處手寫（只在中央表）',
    countOf(effSrc, "'群聚反擊'") === 1 && countOf(engSrc, "'群聚反擊'") === 0,
    JSON.stringify([countOf(effSrc, "'群聚反擊'"), countOf(engSrc, "'群聚反擊'")]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
