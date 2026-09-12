// v6.357 守衛：站長裁定 C-7 —— field-wide 受傷反擊改用「宣告當時」快照。
//
// 站長裁定（逐字）：
//   「備戰那一份傷害先結算 ⇒ 弱丁魚先昏厥離場，但還是要計算他當初留下的特性，
//     因此還是要在使用招式的寶可夢身上放置3個傷害指示物」
//
// 卡面家族（逐字，取自 static/cards）：
//   花岩怪｜怨恨旋渦（M1L 13996／M1L 14189／MC 16926，Basic 80HP【惡】）
//     「只要這隻寶可夢在場上，自己戰鬥場的【惡】寶可夢受到對手的寶可夢招式的傷害時，
//       在使用招式的寶可夢身上放置1個傷害指示物。」
//   弱丁魚｜群聚反擊（M6a 19928，Basic 30HP【水】）
//     「只要這隻寶可夢在場上，自己戰鬥場的「弱丁魚（包含『寶可夢【ex】』）」受到對手的
//       寶可夢招式的傷害時，在使用招式的寶可夢身上放置3個傷害指示物。」
//   急凍鳥｜冰雹（M6a 19924／20019）
//     「對手的所有寶可夢各受到30點傷害。[在備戰區不計算弱點・抵抗力。]」
//   謝米｜花之帷幔（M-P-I 18559 等）
//     「只要這隻寶可夢在場上，自己的所有備戰寶可夢（「擁有規則的寶可夢」除外）
//       不會受到對手的招式的傷害。」
//
// ⭐ 本檔**主判準全部是行為端**（真的建盤面 → applyAction → 讀盤面上的傷害指示物數）；
//   只有 H 組是中央性（Rule 38）靜態斷言，E3 是**輔助**旗標斷言（已標示）。
// ⭐ 每一條效果斷言都配哨兵（招式真的打中、持有者真的離場／真的還在），
//   否則效果斷言會變成空真（安慰劑 #27）。
// ⚠ 跨回合那一組（E）的主判準是**盤面指示物數**，不是旗標值（安慰劑 #28）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6357-s.js'), E = join(ROOT, '.v6357-e.ts'), O = join(ROOT, '.v6357-o.mjs');
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
const act = (st, a) => withCoin(true, () => { try { return applyAction(st, a, pool); } catch (e) { return { __err: e.message, log: [], players: [P(), P()] }; } });
const atkIdx = (c, n) => (c.attacks || []).findIndex((a) => a.name === n);
const eForCost = (c, n) => ((c.attacks || []).find((a) => a.name === n)?.cost ?? []).map((t) => inst(EID[t] ?? EID.Water));

// ── fixtures ────────────────────────────────────────────────────────────────
const GEODE  = findAb('花岩怪', '怨恨旋渦');        // Basic 80HP【惡】
const FEEB   = findAb('弱丁魚', '群聚反擊');        // M6a 19928 Basic 30HP【水】
const FEEBEX = byName('弱丁魚ex');                  // M6 19571 Basic 260HP【水】（特性是「大洋增輝」）
const MORT   = findAtk('摩托蜥', '尾鞭');           // 攻擊方：【無】10 點、無效果、無特性、HP110（**不打備戰**）
const ARTI   = findAtk('急凍鳥', '冰雹');           // 對手全體各 30（備戰不計弱抗）
const UMB    = findAtk('月亮伊布', '出奇一擊');     // picker 路徑（snipe-multi → fireDefenderOnDamaged）
const SHAY   = findAb('謝米', '花之帷幔');          // 備戰保護（非規則寶可夢）⇒ 持有者不會離場
const TOWER  = byName('火箭隊的監視塔');            // 【無】寶可夢特性全消除（配 fossilOnField）
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
const benchNames = (r) => (r?.players?.[1]?.bench ?? []).map((b) => pool.get(b.cardId)?.name);
const holderGone = (r, name) => !benchNames(r).includes(name);
const retalLogs = (r) => (r?.log ?? []).map((l) => String(l?.message ?? l)).filter((m) => /怨恨旋渦|群聚反擊/.test(m));

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【0】harness 自驗（卡面事實全部來自 static/cards）');
{
  chk('0a 弱丁魚｜群聚反擊 ＝ M6a 19928、HP30【水】【基礎】（HP30 才會被冰雹的 30 打死）',
    String(FEEB.id) === '19928' && Number(FEEB.hp) === 30 && FEEB.pokemonType === 'Water' && FEEB.stage === 'Basic',
    JSON.stringify([FEEB.id, FEEB.hp, FEEB.pokemonType, FEEB.stage]));
  chk('0b 弱丁魚ex HP260 且**沒有**群聚反擊（當戰鬥場主詞、且不會被 30 打死）',
    Number(FEEBEX.hp) === 260 && !(FEEBEX.abilities || []).some((a) => a.name === '群聚反擊'),
    JSON.stringify([FEEBEX.id, FEEBEX.hp, (FEEBEX.abilities || []).map((a) => a.name)]));
  chk('0c 急凍鳥｜冰雹 卡面逐字＝「對手的所有寶可夢各受到30點傷害。[在備戰區不計算弱點・抵抗力。]」',
    ARTI.attacks.find((a) => a.name === '冰雹')?.effect === '對手的所有寶可夢各受到30點傷害。[在備戰區不計算弱點・抵抗力。]',
    String(ARTI.attacks.find((a) => a.name === '冰雹')?.effect));
  chk('0d 摩托蜥｜尾鞭 是【無】10 點、無效果、無特性（**不打備戰** ⇒ 持有者不會離場）',
    MORT.pokemonType === 'Colorless' && !(MORT.abilities || []).length
    && MORT.attacks.find((a) => a.name === '尾鞭').damage === '10'
    && !MORT.attacks.find((a) => a.name === '尾鞭').effect,
    JSON.stringify([MORT.pokemonType, MORT.attacks.find((a) => a.name === '尾鞭')]));
  chk('0e 謝米｜花之帷幔 卡面逐字（A2 靠它讓備戰持有者**不**離場）',
    (SHAY.abilities || []).find((a) => a.name === '花之帷幔')?.effect
      === '只要這隻寶可夢在場上，自己的所有備戰寶可夢（「擁有規則的寶可夢」除外）不會受到對手的招式的傷害。',
    String((SHAY.abilities || []).find((a) => a.name === '花之帷幔')?.effect));
  chk('0f 花岩怪｜怨恨旋渦 HP80【惡】；有【惡】對照靶與【無】對照靶',
    Number(GEODE.hp) === 80 && GEODE.pokemonType === 'Darkness' && !!DARKP && !!PLAIN,
    JSON.stringify([GEODE.hp, DARKP?.name, PLAIN?.name]));
  chk('0g 靶對攻擊方【無】／【水】都不吃弱點（數字才乾淨）',
    [GEODE, FEEB, FEEBEX, DARKP, PLAIN].every((c) => c.weakness?.type !== 'Colorless' && c.weakness?.type !== 'Water'),
    JSON.stringify([GEODE, FEEB, FEEBEX, DARKP, PLAIN].map((c) => [c.name, c.weakness?.type])));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【A】⭐⭐站長裁定 C-7 主情境：備戰持有者被同一招打到昏厥離場，仍然要放指示物');
{
  const rA1 = run(ARTI, '冰雹', inst(FEEBEX.id), [inst(FEEB.id), inst(PLAIN.id)]);
  chk('A1 哨兵：冰雹確實打到戰鬥場的弱丁魚ex（30 點）',
    defDmg(rA1) === 30, String(defDmg(rA1)));
  chk('A1 哨兵：備戰那隻 HP30 的弱丁魚**真的**被同一招打到昏厥離場（備戰名單裡沒有它了）',
    holderGone(rA1, '弱丁魚') && (rA1.players?.[1]?.bench ?? []).length === 1,
    JSON.stringify(benchNames(rA1)));
  chk('A1 ⭐⭐站長裁定：持有者已離場，但「宣告當時」在場上且特性生效 ⇒ 攻擊方 **+30**',
    atkDmg(rA1) === 30, String(atkDmg(rA1)));
  chk('A1 ⭐只放**一次**（log 恰好一行，不是當下盤面＋快照各一次）',
    retalLogs(rA1).length === 1, JSON.stringify(retalLogs(rA1)));
  chk('A1 log 逐字：`群聚反擊：急凍鳥 身上放置 3 個傷害指示物（+30）`',
    retalLogs(rA1)[0] === '群聚反擊：急凍鳥 身上放置 3 個傷害指示物（+30）',
    JSON.stringify(retalLogs(rA1)));

  // ⭐哨兵／正對照：**同一招、同一張持有者**，只把「離場」這一維拿掉（花之帷幔保住備戰）
  const rA2 = run(ARTI, '冰雹', inst(FEEBEX.id), [inst(FEEB.id), inst(SHAY.id), inst(PLAIN.id)]);
  chk('A2 哨兵：同一招照樣打到戰鬥場（30），但備戰被花之帷幔保住 ⇒ 持有者**還在**且 0 傷害',
    defDmg(rA2) === 30 && !holderGone(rA2, '弱丁魚')
    && (rA2.players[1].bench.find((b) => pool.get(b.cardId)?.name === '弱丁魚')?.damage) === 0,
    JSON.stringify([defDmg(rA2), rA2.players[1].bench.map((b) => [pool.get(b.cardId)?.name, b.damage])]));
  chk('A2 ⭐正對照：持有者沒離場 ⇒ 同樣 +30、同樣一行 log（證明 A1 的差異只在「離場」這一維）',
    atkDmg(rA2) === 30 && retalLogs(rA2).length === 1,
    JSON.stringify([atkDmg(rA2), retalLogs(rA2).length]));

  // 站長原話的盤面：戰鬥場也是弱丁魚（HP30），兩隻都被冰雹打死
  const rA3 = run(ARTI, '冰雹', inst(FEEB.id), [inst(FEEB.id), inst(PLAIN.id)]);
  chk('A3 哨兵：戰鬥場的弱丁魚（HP30）也被冰雹打到昏厥，備戰那隻同樣離場',
    defDmg(rA3) === 'KO' && holderGone(rA3, '弱丁魚'),
    JSON.stringify([defDmg(rA3), benchNames(rA3)]));
  chk('A3 ⭐戰鬥場（主 loop）＋備戰（快照）各觸發一次 ⇒ +60、log 兩行',
    atkDmg(rA3) === 60 && retalLogs(rA3).length === 2,
    JSON.stringify([atkDmg(rA3), retalLogs(rA3).length]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【B】反對照：宣告當時根本沒有持有者／戰鬥場主詞不符');
{
  const rB1 = run(ARTI, '冰雹', inst(FEEBEX.id), [inst(PLAIN.id), inst(PLAIN.id)]);
  chk('B1 哨兵：冰雹確實打到戰鬥場（30）與備戰（各 30）',
    defDmg(rB1) === 30 && JSON.stringify(rB1.players[1].bench.map((b) => b.damage)) === '[30,30]',
    JSON.stringify([defDmg(rB1), rB1.players[1].bench.map((b) => b.damage)]));
  chk('B1 ⭐宣告當時備戰**沒有**持有者 ⇒ 0 點', atkDmg(rB1) === 0 && retalLogs(rB1).length === 0,
    JSON.stringify([atkDmg(rB1), retalLogs(rB1)]));

  const rB2 = run(ARTI, '冰雹', inst(PLAIN.id), [inst(FEEB.id), inst(PLAIN.id)]);
  chk('B2 哨兵：對照靶確實吃到 30，備戰的弱丁魚同樣被打到離場',
    defDmg(rB2) === 30 && holderGone(rB2, '弱丁魚'),
    JSON.stringify([defDmg(rB2), benchNames(rB2)]));
  chk('B2 ⭐⭐「自己**戰鬥場**的〈X〉」這一維**沒有**被誤放寬：戰鬥場不是弱丁魚 ⇒ 0 點',
    atkDmg(rB2) === 0 && retalLogs(rB2).length === 0,
    JSON.stringify([atkDmg(rB2), retalLogs(rB2)]));

  const rB3 = run(MORT, '尾鞭', inst(DARKP.id), [inst(GEODE.id), inst(FEEB.id), inst(PLAIN.id)]);
  chk('B3 哨兵：戰鬥場的【惡】靶確實吃到 10 點，兩隻持有者都還在備戰',
    defDmg(rB3) === 10 && benchNames(rB3).includes('花岩怪') && benchNames(rB3).includes('弱丁魚'),
    JSON.stringify([defDmg(rB3), benchNames(rB3)]));
  chk('B3 ⭐⭐快照條目必須**認特性名**：戰鬥場是【惡】⇒ 只有怨恨旋渦觸發（+10、一行），弱丁魚那筆不可以被算進來',
    atkDmg(rB3) === 10 && retalLogs(rB3).length === 1 && /怨恨旋渦/.test(retalLogs(rB3)[0] ?? ''),
    JSON.stringify([atkDmg(rB3), retalLogs(rB3)]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【C】特性消除：快照存的是「宣告當時的判定結果」，不是卡名');
{
  // ⚠ 對「Basic 非規則寶可夢的備戰持有者」而言，站上唯一能消除它特性的來源是
  //   【火箭隊的監視塔】×【化石在場上＝HP60 的【無】寶可夢】（v6.145 的 fossilOnField）。
  //   fossilOnField ⇒ HP 固定 60，故預先放 30 點傷害，冰雹的 30 才會把它打到離場。
  const foss = { fossilOnField: true, damage: 30 };
  const rC1 = run(ARTI, '冰雹', inst(FEEBEX.id), [inst(FEEB.id, foss), inst(PLAIN.id)],
    { activeStadium: inst(TOWER.id), activeStadiumOwnerIdx: 0 });
  chk('C1 哨兵：冰雹打到戰鬥場（30），而且這隻持有者**真的**被打到離場',
    defDmg(rC1) === 30 && holderGone(rC1, '弱丁魚'),
    JSON.stringify([defDmg(rC1), benchNames(rC1)]));
  chk('C1 ⭐⭐宣告當時特性已被消除（監視塔×化石在場上）⇒ 即使離場也**不**觸發（0 點）',
    atkDmg(rC1) === 0 && retalLogs(rC1).length === 0,
    JSON.stringify([atkDmg(rC1), retalLogs(rC1)]));

  const rC2 = run(ARTI, '冰雹', inst(FEEBEX.id), [inst(FEEB.id, foss), inst(PLAIN.id)]);
  chk('C2 哨兵：同一個盤面拿掉競技場後，持有者同樣被打到離場',
    defDmg(rC2) === 30 && holderGone(rC2, '弱丁魚'),
    JSON.stringify([defDmg(rC2), benchNames(rC2)]));
  chk('C2 ⭐正對照：拿掉競技場 ⇒ 照樣 +30（證明 C1 的 0 來自特性消除閘，不是「化石／預傷」讓管線失效）',
    atkDmg(rC2) === 30 && retalLogs(rC2).length === 1,
    JSON.stringify([atkDmg(rC2), retalLogs(rC2).length]));

  // 持有者**沒有**離場、只是宣告當時被消除 ⇒ 一樣 0（當下盤面那一路也被同一支閘擋住）
  const rC3 = run(MORT, '尾鞭', inst(FEEBEX.id), [inst(FEEB.id, { fossilOnField: true }), inst(PLAIN.id)],
    { activeStadium: inst(TOWER.id), activeStadiumOwnerIdx: 0 });
  chk('C3 哨兵：尾鞭打到戰鬥場（10），持有者還在備戰（沒離場）',
    defDmg(rC3) === 10 && !holderGone(rC3, '弱丁魚'),
    JSON.stringify([defDmg(rC3), benchNames(rC3)]));
  chk('C3 ⭐持有者在場但宣告當時特性被消除 ⇒ 0 點', atkDmg(rC3) === 0, String(atkDmg(rC3)));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【D】不重複觸發：「當下盤面 ∪ 宣告當時快照」必須以持有者 iid 去重');
{
  const rD1 = run(MORT, '尾鞭', inst(FEEBEX.id), [inst(FEEB.id), inst(PLAIN.id)]);
  chk('D1 哨兵：尾鞭打到戰鬥場（10），持有者**沒有**被 KO（兩邊都有它）',
    defDmg(rD1) === 10 && !holderGone(rD1, '弱丁魚'),
    JSON.stringify([defDmg(rD1), benchNames(rD1)]));
  chk('D1 ⭐⭐持有者同時出現在「當下盤面」與「宣告當時快照」⇒ 只放 3 個（+30），不是 6 個',
    atkDmg(rD1) === 30 && retalLogs(rD1).length === 1,
    JSON.stringify([atkDmg(rD1), retalLogs(rD1).length]));

  const rD2 = run(MORT, '尾鞭', inst(FEEBEX.id), [inst(FEEB.id), inst(FEEB.id), inst(PLAIN.id)]);
  chk('D2 哨兵：兩隻持有者都還在備戰', benchNames(rD2).filter((n) => n === '弱丁魚').length === 2,
    JSON.stringify(benchNames(rD2)));
  chk('D2 ⭐去重鍵是**持有者 iid** 不是特性名：兩隻都活著 ⇒ +60、log 兩行',
    atkDmg(rD2) === 60 && retalLogs(rD2).length === 2,
    JSON.stringify([atkDmg(rD2), retalLogs(rD2).length]));

  // 一隻離場（HP30）、一隻活著（化石在場上 ⇒ HP60，吃 30 不死）
  const rD3 = run(ARTI, '冰雹', inst(FEEBEX.id),
    [inst(FEEB.id), inst(FEEB.id, { fossilOnField: true }), inst(PLAIN.id)]);
  chk('D3 哨兵：一隻持有者離場、另一隻還在（且吃到 30）',
    benchNames(rD3).filter((n) => n === '弱丁魚').length === 1
    && rD3.players[1].bench.find((b) => pool.get(b.cardId)?.name === '弱丁魚')?.damage === 30,
    JSON.stringify(rD3.players[1].bench.map((b) => [pool.get(b.cardId)?.name, b.damage])));
  chk('D3 ⭐⭐一隻被 KO、一隻活著 ⇒ 各觸發一次（+60、log 兩行）',
    atkDmg(rD3) === 60 && retalLogs(rD3).length === 2,
    JSON.stringify([atkDmg(rD3), retalLogs(rD3).length]));

  const rD4 = run(ARTI, '冰雹', inst(FEEBEX.id), [inst(FEEB.id), inst(FEEB.id), inst(PLAIN.id)]);
  chk('D4 哨兵：兩隻持有者都被冰雹打到離場', holderGone(rD4, '弱丁魚'), JSON.stringify(benchNames(rD4)));
  chk('D4 ⭐兩隻都離場 ⇒ 各觸發一次（+60、log 兩行）',
    atkDmg(rD4) === 60 && retalLogs(rD4).length === 2,
    JSON.stringify([atkDmg(rD4), retalLogs(rD4).length]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【E】跨回合不殘留（主判準＝盤面指示物數，旗標只是輔助）');
{
  const GHOST = { _attackTimeFieldWideRetal: [[], [{ iid: 'ghost-prev-turn', ability: '群聚反擊' }]] };
  const rE1 = run(MORT, '尾鞭', inst(FEEBEX.id), [inst(PLAIN.id)], GHOST);
  chk('E1 哨兵：尾鞭確實打到戰鬥場（10）', defDmg(rE1) === 10, String(defDmg(rE1)));
  chk('E1 ⭐⭐上一回合殘留的快照**不可以**讓這一回合誤觸發（盤面沒有持有者 ⇒ 0 點）',
    atkDmg(rE1) === 0 && retalLogs(rE1).length === 0,
    JSON.stringify([atkDmg(rE1), retalLogs(rE1)]));

  const rE2 = run(MORT, '尾鞭', inst(FEEBEX.id), [inst(FEEB.id), inst(PLAIN.id)], GHOST);
  chk('E2 哨兵：這一組盤面上**有**一隻持有者', !holderGone(rE2, '弱丁魚'), JSON.stringify(benchNames(rE2)));
  chk('E2 ⭐正對照：同樣帶著殘留快照，但盤面有 1 隻持有者 ⇒ 恰好 +30（不是 +60）⇒ 殘留那筆真的沒被讀進去',
    atkDmg(rE2) === 30 && retalLogs(rE2).length === 1,
    JSON.stringify([atkDmg(rE2), retalLogs(rE2).length]));

  const rE3 = run(ARTI, '冰雹', inst(FEEBEX.id), [inst(FEEB.id), inst(PLAIN.id)]);
  chk('E3 （輔助，非主判準）attack flow 結束且沒有 pendingSelection ⇒ 快照已清除',
    rE3._attackTimeFieldWideRetal === undefined && rE3.pendingSelection == null,
    JSON.stringify([rE3._attackTimeFieldWideRetal ?? null, rE3.pendingSelection?.effectKey ?? null]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【F】花岩怪｜怨恨旋渦 —— 一般情境零行為變更；同一條裁定也適用於它');
{
  const rF1 = run(MORT, '尾鞭', inst(DARKP.id), [inst(GEODE.id), inst(PLAIN.id)]);
  chk('F1 哨兵：戰鬥場的【惡】靶確實吃到 10 點，花岩怪還在備戰',
    defDmg(rF1) === 10 && !holderGone(rF1, '花岩怪'),
    JSON.stringify([defDmg(rF1), benchNames(rF1)]));
  chk('F1 ⭐一般情境（持有者沒被 KO）數字與 log **逐字**未變：+10 且 `怨恨旋渦：摩托蜥 身上放置 1 個傷害指示物（+10）`',
    atkDmg(rF1) === 10 && retalLogs(rF1).length === 1
    && retalLogs(rF1)[0] === '怨恨旋渦：摩托蜥 身上放置 1 個傷害指示物（+10）',
    JSON.stringify([atkDmg(rF1), retalLogs(rF1)]));

  const rF2 = run(ARTI, '冰雹', inst(DARKP.id), [inst(GEODE.id), inst(PLAIN.id)]);
  chk('F2 哨兵：冰雹打到戰鬥場（30）＋備戰（各 30），花岩怪（HP80）活著',
    defDmg(rF2) === 30 && !holderGone(rF2, '花岩怪')
    && rF2.players[1].bench.find((b) => pool.get(b.cardId)?.name === '花岩怪')?.damage === 30,
    JSON.stringify([defDmg(rF2), rF2.players[1].bench.map((b) => [pool.get(b.cardId)?.name, b.damage])]));
  chk('F2 ⭐多目標招式下持有者活著 ⇒ 仍只 +10、一行 log（零行為變更）',
    atkDmg(rF2) === 10 && retalLogs(rF2).length === 1,
    JSON.stringify([atkDmg(rF2), retalLogs(rF2).length]));

  // HP80 − 預傷 50 = 30 ⇒ 冰雹的 30 剛好打死它
  const rF3 = run(ARTI, '冰雹', inst(DARKP.id), [inst(GEODE.id, { damage: 50 }), inst(PLAIN.id)]);
  chk('F3 哨兵：備戰的花岩怪（HP80、已有 50 點）被冰雹打到昏厥離場',
    defDmg(rF3) === 30 && holderGone(rF3, '花岩怪'),
    JSON.stringify([defDmg(rF3), benchNames(rF3)]));
  chk('F3 ⭐⭐同一條裁定也適用於怨恨旋渦：持有者離場仍 +10、log 逐字',
    atkDmg(rF3) === 10 && retalLogs(rF3).length === 1
    && retalLogs(rF3)[0] === '怨恨旋渦：急凍鳥 身上放置 1 個傷害指示物（+10）',
    JSON.stringify([atkDmg(rF3), retalLogs(rF3)]));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【G】picker 路徑（月亮伊布｜出奇一擊 → snipe-multi → effects.fireDefenderOnDamaged）');
{
  const a = inst(UMB.id, { energyAttached: eForCost(UMB, '出奇一擊') });
  const dActive = inst(FEEBEX.id);
  const st = mk(
    { active: a, bench: [inst(PLAIN.id)], deck: filler(3), prizes: filler(6) },
    { active: dActive, bench: [inst(FEEB.id), inst(PLAIN.id)], deck: filler(3), prizes: filler(6) });
  const r0 = act(st, { type: 'ATTACK', attackIndex: atkIdx(UMB, '出奇一擊') });
  chk('G0 哨兵：出奇一擊真的開了 `snipe-multi` picker（傷害還沒結算）',
    r0?.pendingSelection?.effectKey === 'snipe-multi',
    JSON.stringify(r0?.pendingSelection?.effectKey ?? null));
  chk('G1 ⭐picker 未解時快照**必須保留**給 resolver（比照花之帷幔的跨 dispatch 規則）',
    Array.isArray(r0?._attackTimeFieldWideRetal) && r0._attackTimeFieldWideRetal.length === 2
    && r0._attackTimeFieldWideRetal[1].some((h) => h.ability === '群聚反擊'),
    JSON.stringify(r0?._attackTimeFieldWideRetal ?? null));
  const r = act(r0, { type: 'RESOLVE_SELECTION', selectedIids: [dActive.iid], actorIdx: 0 });
  chk('G2 哨兵：picker 解掉了，戰鬥場的弱丁魚ex 吃到 50 點（出奇一擊不計弱抗）',
    r?.pendingSelection == null && defDmg(r) === 50,
    JSON.stringify([r?.pendingSelection?.effectKey ?? null, defDmg(r)]));
  chk('G3 ⭐這條路徑一樣只觸發一次 ⇒ +30、log 一行',
    atkDmg(r) === 30 && retalLogs(r).length === 1,
    JSON.stringify([atkDmg(r), retalLogs(r).length]));
  chk('G4 （輔助）resolver 跑完、pending 已消 ⇒ 快照由 applyAction wrapper 清掉',
    r._attackTimeFieldWideRetal === undefined, JSON.stringify(r._attackTimeFieldWideRetal ?? null));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【H】中央性（Rule 38）—— 同一個判準只能有一份');
{
  const engSrc = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const effSrc = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
  const typSrc = readFileSync(join(ROOT, 'src/lib/game/types.ts'), 'utf8');
  const countOf = (src, needle) => src.split(needle).length - 1;

  chk('H1 ⭐快照產生器只有一份定義（effects.ts `export function snapshotFieldWideRetalHolders(` 恰好 1 次、engine.ts 0 次）',
    countOf(effSrc, 'export function snapshotFieldWideRetalHolders(') === 1
    && countOf(engSrc, 'export function snapshotFieldWideRetalHolders(') === 0,
    JSON.stringify([countOf(effSrc, 'export function snapshotFieldWideRetalHolders('), countOf(engSrc, 'export function snapshotFieldWideRetalHolders(')]));
  chk('H1b ⭐engine.ts 只有**一個**設定點（兩次呼叫＝兩側玩家，且在同一行）',
    countOf(engSrc, 'snapshotFieldWideRetalHolders(state, 0, pool), snapshotFieldWideRetalHolders(state, 1, pool),') === 1
    && countOf(engSrc, 'snapshotFieldWideRetalHolders(') === 2,   // 全檔只有那一行的兩次呼叫（import 那一行沒有括號）
    String(countOf(engSrc, 'snapshotFieldWideRetalHolders(')));
  chk('H1c ⭐⭐設定點就沿用 `_attackTimeCalmGround` 那一個 ATTACK 宣告點（Rule 38：不另開 hook）',
    (() => {
      const i = engSrc.indexOf('_attackTimeCalmGround: [');
      const j = engSrc.indexOf('_attackTimeFieldWideRetal: [');
      return i > 0 && j > i && (engSrc.slice(i, j).split('\n').length - 1) < 20;
    })(), '兩個設定點相隔超過 20 行 ⇒ 可能另開了新的 ATTACK 起點 hook');

  chk('H2 ⭐消費點只有一處（effects.ts 讀 `state._attackTimeFieldWideRetal` 恰好 1 次）',
    countOf(effSrc, 'state._attackTimeFieldWideRetal') === 1,
    String(countOf(effSrc, 'state._attackTimeFieldWideRetal')));
  chk('H2b ⭐fireFieldWideRetaliation 的呼叫點數量**沒有變**（engine 2 ＋ effects 1 ＝ 3；與 v6.352 守衛 C3 同一判準）',
    (() => {
      const lines = (src, file) => src.split(/\r?\n/).map((l, i) => [file, i + 1, l])
        .filter(([, , l]) => l.includes('fireFieldWideRetaliation(') && !l.includes('export function ') && !l.includes('* '));
      const sites = [...lines(engSrc, 'engine.ts'), ...lines(effSrc, 'effects.ts')];
      return sites.length === 3 && sites.filter(([f]) => f === 'engine.ts').length === 2;
    })(), 'fireFieldWideRetaliation 呼叫點數量變了');

  chk('H3 ⭐clear 只有一處（engine.ts `delete cleared._attackTimeFieldWideRetal;` 恰好 1 次）',
    countOf(engSrc, 'delete cleared._attackTimeFieldWideRetal;') === 1,
    String(countOf(engSrc, 'delete cleared._attackTimeFieldWideRetal;')));
  chk('H3b ⭐⭐clear **必須**在「非 KO 分支的 field-wide 反擊消費點」之後（放在上方那一疊 snapshot clear 會在消費前就清掉）',
    (() => {
      const consume = engSrc.indexOf('v6352-field-wide-retal-nonko');
      const clear = engSrc.indexOf('delete cleared._attackTimeFieldWideRetal;');
      return consume > 0 && clear > consume;
    })(), 'clear 的位置早於非 KO 消費點 ⇒ 快照會在被讀之前就被刪掉');

  chk('H4 ⭐型別只有一份（types.ts `export interface FieldWideRetalHolderSnapshot` 1 次，欄位 1 次）',
    countOf(typSrc, 'export interface FieldWideRetalHolderSnapshot') === 1
    && countOf(typSrc, '_attackTimeFieldWideRetal?:') === 1,
    JSON.stringify([countOf(typSrc, 'export interface FieldWideRetalHolderSnapshot'), countOf(typSrc, '_attackTimeFieldWideRetal?:')]));

  chk('H5 ⭐指示物個數／log 仍然只由中央表產生（FIELD_WIDE_RETALIATION 恰好 2 筆、counters 與卡面一致）',
    Array.isArray(FIELD_WIDE_RETALIATION) && FIELD_WIDE_RETALIATION.length === 2
    && FIELD_WIDE_RETALIATION.every((s) => s.face.includes(`放置${s.counters}個傷害指示物`)),
    JSON.stringify((FIELD_WIDE_RETALIATION || []).map((s) => [s.ability, s.counters])));

  chk('H6 ⭐正對照：同一支掃描器對人造字串會數到 2（證明 H1~H4 不是空真）',
    countOf('a = state._attackTimeFieldWideRetal; b = state._attackTimeFieldWideRetal;', 'state._attackTimeFieldWideRetal') === 2);
}

console.log(`\n═══ v6.357 field-wide 反擊「宣告當時」快照：${pass} passed, ${fail} failed ═══`);
process.exit(fail ? 1 : 0);
