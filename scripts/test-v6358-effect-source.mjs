// v6.358 守衛 —— 站長裁定 D-9：「**招式**的效果」免疫不該擋住「**特性**的效果」
//
// 站長裁定逐字：
//   「耿鬼ex的死亡宣告是『特性』的效果，不該被只寫『不會受到對手寶可夢的「招式」的效果影響』
//     的內容擋住，請修正」
//
// 官方判例（PTCG RULES/PTCG_RULES.md）：
//   ・L2308–L2309 ⭐直接判例：對手戰鬥場有「陳舊的背蓋化石」時，**特性**「熱浪鱗粉」照樣可以用 ⇒
//     卡面只寫「招式的效果」的免疫擋不住**特性**的效果。
//   ・L1669「因**特性**『咒詛炸彈』的效果…」／L2544「因**招式的效果**[昏厥]…」⇒ 官方分兩個來源寫。
//
// ⚠ 本檔全部是**行為端**斷言（盤面 active/bench/discard/prizes + log 內容），
//   不用「registry 有沒有 key」判斷覆蓋率（Rule 33），也沒有恆真斷言（安慰劑 #27）。
//   旗標／表格層的檢查一律標記為「補充」，且都另有行為端斷言（安慰劑 #28）。
// ⚠ 卡面逐字錨（【F】）自己會做「掃描器自驗」：故意弄髒的 face 必須抓不到，
//   否則整組 face 斷言就是恆真。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6358-s.js'), E = join(ROOT, '.v6358-e.ts'), O = join(ROOT, '.v6358-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E,
  "export { applyAction } from './src/lib/game/engine';\n"
  + "export { EFFECT_SOURCE_IMMUNITY, effectSourceBlocks, ATTACK_EFFECT_IMMUNITY,\n"
  + "         canApplyAttackEffectToTarget } from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);
const { applyAction, EFFECT_SOURCE_IMMUNITY, effectSourceBlocks, ATTACK_EFFECT_IMMUNITY } = M;

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
const byId = (id) => { const c = pool.get(String(id)); if (!c) throw new Error('卡池抓不到 id ' + id); return c; };
const byName = (n) => { const c = all.find((x) => x.name === n); if (!c) throw new Error('卡池抓不到 ' + n); return c; };

const GENG  = byId('19988');            // 耿鬼ex M6a 076/103 HP280 Stage2【惡】弱點【鬥】×2｜死亡宣告
const ICE   = byId('19924');            // 急凍鳥 M6a HP120 Basic【水】非 ex｜冰雹 30（全體）
const LUCA  = byId('13986');            // 超級路卡利歐ex M1L HP340 Stage1【鬥】ex｜超級勇氣 270
const NAPO  = byId('14376');            // 帝王拿波ex M2 ｜皇帝之勢（A 類 self-ability）
const SNAKE = byId('12669');            // 蜜集大蛇 SV9a Stage2【草】｜大蛇吐息（棄手牌6張基本草 → 對手戰鬥昏厥）
const DOLL  = byId('19175');            // 怨影娃娃 M5 HP50 Basic【超】｜化隱（C 類）｜垂吊 10
const MONK  = byId('11242');            // 棄世猴 SV8 Stage2｜同命戰鬥（**直接**呼叫閘門、省略 source ⇒ 吃預設值）
const MIST  = byName('薄霧能量');        // A 類特殊能量（無屬性條件）
const HARD  = byName('硬岩【鬥】能量');   // A 類特殊能量（限【鬥】寶可夢）
const PLAIN = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic'
  && !(c.abilities || []).length && !(c.tags || []).includes('太晶')
  && Number(c.hp) >= 60 && c.pokemonType === 'Colorless');

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
  name: 'P', active: null, bench: [], hand: [], deck: [], discard: [],
  prizes: [], abilityNamesUsedThisTurn: [], ...o,
});
const prizes = (n) => Array.from({ length: n }, () => inst(PLAIN.id));
const deck3 = () => [inst(PLAIN.id), inst(PLAIN.id), inst(PLAIN.id)];
const mk = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
  coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
  activeStadium: null, activeStadiumOwnerIdx: 0,
  players: [P({ name: 'A', deck: deck3(), prizes: prizes(6), ...p0 }),
            P({ name: 'B', deck: deck3(), prizes: prizes(6), ...p1 })],
  ...extra,
});

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; console.log('  ✓', t); } else { fail++; console.log('  ❌', t, extra); } };

const withCoin = (heads, fn) => {
  const orig = Math.random;
  Math.random = () => (heads ? 0.1 : 0.9);
  try { return fn(); } finally { Math.random = orig; }
};
const act = (st, a, heads) => withCoin(heads !== false, () => {
  try { return applyAction(st, a, pool); }
  catch (e) { return { __err: e.message, log: [{ message: 'ERR ' + e.message }], players: [P(), P()] }; }
});
const LOGS = (r) => (r?.log ?? []).map((l) => String(l?.message ?? l?.text ?? l));
const nLog = (r, s) => LOGS(r).filter((x) => x.includes(s)).length;
const A0 = (r) => r?.players?.[0]?.active;
const D0 = (r) => r?.players?.[1]?.active;
const PZ = (r, i) => r?.players?.[i]?.prizes?.length;
const atkIdx = (card, name) => (card.attacks || []).findIndex((a) => a.name === name);
const energyFor = (card, atkName) =>
  ((card.attacks || []).find((a) => a.name === atkName)?.cost ?? []).map((t) => inst(EID[t] ?? EID.Water));

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【0】harness 自驗（fixture 抓錯 ⇒ 後面全是假綠）');
{
  chk('0a 耿鬼ex＝M6a、HP280、Stage2、【惡】、弱點【鬥】×2、印著「死亡宣告」',
    String(GENG.setCode) === 'M6a' && Number(GENG.hp) === 280 && GENG.stage === 'Stage2'
    && GENG.pokemonType === 'Darkness' && GENG.weakness?.type === 'Fighting'
    && (GENG.abilities || []).some((a) => a.name === '死亡宣告'),
    JSON.stringify([GENG.setCode, GENG.hp, GENG.stage, GENG.pokemonType]));
  chk('0b ⭐死亡宣告卡面逐字錨（abilities[].effect；卡面改版／抓錯印刷會紅）',
    (GENG.abilities || []).find((a) => a.name === '死亡宣告')?.effect
      === '這隻寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，自己擲1次硬幣。若為正面，則將使用招式的寶可夢【昏厥】。',
    String((GENG.abilities || []).find((a) => a.name === '死亡宣告')?.effect));
  chk('0c 超級路卡利歐ex 是【鬥】（硬岩【鬥】能量 的屬性 gate 才會成立）＋ 超級勇氣 270',
    LUCA.pokemonType === 'Fighting' && atkIdx(LUCA, '超級勇氣') >= 0,
    JSON.stringify([LUCA.pokemonType, LUCA.hp]));
  chk('0d 蜜集大蛇｜大蛇吐息 抓得到（本檔的「真正招式效果昏厥」正對照，無擲幣、無自傷）',
    atkIdx(SNAKE, '大蛇吐息') >= 0 && SNAKE.pokemonType === 'Grass', JSON.stringify([SNAKE.name, SNAKE.pokemonType]));
  chk('0e 怨影娃娃印著「化隱」（C 類）＋ 垂吊 10；帝王拿波ex 印著「皇帝之勢」（A 類）',
    (DOLL.abilities || []).some((a) => a.name === '化隱') && atkIdx(DOLL, '垂吊') >= 0
    && (NAPO.abilities || []).some((a) => a.name === '皇帝之勢') && atkIdx(NAPO, '鐵羽毛') >= 0,
    JSON.stringify([DOLL.name, NAPO.name]));
  chk('0f 能量 id 依名稱查得到（硬編會付不出費用 → ATTACK 靜默 return → 假綠）',
    !!EID.Water && !!EID.Grass && !!EID.Fighting && !!EID.Metal && !!EID.Psychic && !!EID.Lightning,
    JSON.stringify(EID));
  chk('0g 中立填充卡抓得到', !!PLAIN, String(PLAIN?.name));
  chk('0h2 棄世猴｜同命戰鬥 抓得到（官方判例 PTCG_RULES L1921：薄霧能量擋得住它）',
    atkIdx(MONK, '同命戰鬥') >= 0, JSON.stringify([MONK.name, (MONK.attacks || []).map((a) => a.name)]));
  chk('0h 薄霧能量／硬岩【鬥】能量 是特殊能量（Special）',
    MIST.subtype === 'Special' && HARD.subtype === 'Special',
    JSON.stringify([MIST.subtype, HARD.subtype]));
}

// ── 共用盤面 ────────────────────────────────────────────────────────────────
/** 超級路卡利歐ex（【鬥】）用 超級勇氣 270 打 耿鬼ex（damage 20）⇒ 招式傷害 KO ⇒ 死亡宣告 */
const boardLuca = (atkExtraEnergy = []) => mk(
  { active: inst(LUCA.id, { energyAttached: [...energyFor(LUCA, '超級勇氣'), ...atkExtraEnergy] }),
    bench: [inst(PLAIN.id)] },
  { active: inst(GENG.id, { damage: 20 }), bench: [inst(PLAIN.id)] });
const runLuca = (atkExtraEnergy = [], heads) =>
  act(boardLuca(atkExtraEnergy), { type: 'ATTACK', attackIndex: atkIdx(LUCA, '超級勇氣') }, heads);

/** 急凍鳥（【水】非 ex）用 冰雹 30 打 耿鬼ex（damage HP-30）⇒ 招式傷害 KO ⇒ 死亡宣告 */
const boardIce = (atkExtra = {}) => mk(
  { active: inst(ICE.id, { energyAttached: energyFor(ICE, '冰雹'), ...atkExtra }), bench: [inst(PLAIN.id)] },
  { active: inst(GENG.id, { damage: Number(GENG.hp) - 30 }), bench: [inst(PLAIN.id)] });
const runIce = (atkExtra = {}, heads) =>
  act(boardIce(atkExtra), { type: 'ATTACK', attackIndex: atkIdx(ICE, '冰雹') }, heads);

/** 蜜集大蛇｜大蛇吐息：棄手牌 6 張基本【草】⇒ 對手戰鬥寶可夢「因**招式的效果**昏厥」 */
const boardSnake = (defInst) => mk(
  { active: inst(SNAKE.id, { energyAttached: energyFor(SNAKE, '大蛇吐息') }),
    bench: [inst(PLAIN.id)],
    hand: Array.from({ length: 6 }, () => inst(EID.Grass)) },
  { active: defInst, bench: [inst(PLAIN.id)] });
const runSnake = (defInst) => act(boardSnake(defInst), { type: 'ATTACK', attackIndex: atkIdx(SNAKE, '大蛇吐息') });

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【A】⭐⭐⭐站長裁定主情境：攻擊方附「硬岩【鬥】能量」⇒ 死亡宣告（**特性**）照樣讓它昏厥');
{
  const H  = runLuca([inst(HARD.id)]);   // 攻擊方（【鬥】）身上附硬岩【鬥】能量
  const S0 = runLuca();                  // 哨兵：同盤面**不附**那張卡
  const T  = runLuca([inst(HARD.id)], false); // 反對照：同盤面只差擲幣結果

  chk('A0 哨兵：兩邊的耿鬼ex 都確實因**招式傷害**昏厥（fixture 沒打死 ⇒ 整組無效）',
    D0(H) == null && D0(S0) == null, JSON.stringify([D0(H), D0(S0)]));
  chk('A0 哨兵：攻擊方都取得 2 張獎賞（耿鬼ex 是 ex）⇒ 6 − 2 = 4',
    PZ(H, 0) === 4 && PZ(S0, 0) === 4, JSON.stringify([PZ(H, 0), PZ(S0, 0)]));
  chk('A0 哨兵：硬岩【鬥】能量 真的附在攻擊方身上（昏厥後隨本體進棄牌區；沒進去 ⇒ 這組沒測到那一維）',
    H.players[0].discard.some((c) => String(c.cardId) === String(HARD.id)),
    JSON.stringify(H.players[0].discard.map((c) => c.cardId)));

  chk('A1 ⭐⭐攻擊方附硬岩【鬥】能量 + 正面 ⇒ **仍然昏厥**（特性效果不該被招式效果免疫擋住）',
    A0(H) == null, JSON.stringify([!!A0(H), A0(H)?.damage, LOGS(H).filter((x) => x.includes('死亡宣告'))]));
  chk('A1 ⭐攻擊方（超級進化ex）本體進了棄牌區',
    H.players[0].discard.some((c) => String(c.cardId) === String(LUCA.id)));
  chk('A1 ⭐耿鬼ex 那一側取得 **3** 張獎賞（超級進化ex）⇒ 6 − 3 = 3', PZ(H, 1) === 3, String(PZ(H, 1)));
  chk('A1 ⭐完全沒有出現「不昏厥」的免疫 log',
    nLog(H, '（不昏厥）') === 0 && nLog(H, '硬岩') === 0,
    LOGS(H).filter((x) => x.includes('不昏厥') || x.includes('硬岩')).join(' / '));

  chk('A2 ⭐哨兵：同一盤面**不附**硬岩 ⇒ 結果一模一樣（證明差異不是來自那張卡以外的東西）',
    A0(S0) == null && PZ(S0, 1) === 3 && PZ(S0, 1) === PZ(H, 1),
    JSON.stringify([!!A0(S0), PZ(S0, 1), PZ(H, 1)]));
  chk('A3 ⭐反對照：同盤面只差擲幣反面 ⇒ 攻擊方仍在場（證明 A1 的昏厥真的來自死亡宣告）',
    !!A0(T) && PZ(T, 1) === 6, JSON.stringify([!!A0(T), PZ(T, 1)]));
  chk('A3 ⭐反面也留下 log', nLog(T, '「死亡宣告」啟動：硬幣反面') === 1,
    LOGS(T).filter((x) => x.includes('死亡宣告')).join(' / '));
  chk('A4 ⭐「死亡宣告」恰好啟動 1 次（雙觸發會變 ≥2）',
    nLog(H, '「死亡宣告」啟動') === 1, String(nLog(H, '「死亡宣告」啟動')));
}

console.log('\n【B】⭐A 類第二筆：攻擊方附「薄霧能量」（無屬性條件）⇒ 死亡宣告照樣讓它昏厥');
{
  const H  = runIce({ energyAttached: [...energyFor(ICE, '冰雹'), inst(MIST.id)] });
  const S0 = runIce();
  chk('B0 哨兵：兩邊耿鬼ex 都因招式傷害昏厥、攻擊方都取 2 張獎賞',
    D0(H) == null && D0(S0) == null && PZ(H, 0) === 4 && PZ(S0, 0) === 4,
    JSON.stringify([D0(H), D0(S0), PZ(H, 0), PZ(S0, 0)]));
  chk('B1 ⭐附薄霧能量的攻擊方（急凍鳥）**仍然昏厥**', A0(H) == null,
    JSON.stringify([!!A0(H), LOGS(H).filter((x) => x.includes('死亡宣告'))]));
  chk('B1 ⭐耿鬼ex 那一側取得 1 張獎賞（急凍鳥非 ex）⇒ 6 − 1 = 5', PZ(H, 1) === 5, String(PZ(H, 1)));
  chk('B2 ⭐哨兵：不附薄霧能量 ⇒ 結果一模一樣',
    A0(S0) == null && PZ(S0, 1) === 5, JSON.stringify([!!A0(S0), PZ(S0, 1)]));
}

console.log('\n【C】⭐A 類第三筆（self-ability）：攻擊方是「皇帝之勢」的帝王拿波ex ⇒ 死亡宣告照樣讓它昏厥');
{
  const board = () => mk(
    { active: inst(NAPO.id, { energyAttached: energyFor(NAPO, '鐵羽毛') }), bench: [inst(PLAIN.id)] },
    { active: inst(GENG.id, { damage: Number(GENG.hp) - 210 }), bench: [inst(PLAIN.id)] });
  const H = act(board(), { type: 'ATTACK', attackIndex: atkIdx(NAPO, '鐵羽毛') });
  const T = act(board(), { type: 'ATTACK', attackIndex: atkIdx(NAPO, '鐵羽毛') }, false);
  chk('C0 哨兵：鐵羽毛 210 確實把耿鬼ex 打昏厥', D0(H) == null, JSON.stringify([D0(H)?.damage]));
  chk('C1 ⭐皇帝之勢（卡面只寫「招式的效果」）擋不住死亡宣告 ⇒ 帝王拿波ex 昏厥',
    A0(H) == null, JSON.stringify([!!A0(H), LOGS(H).filter((x) => x.includes('皇帝之勢') || x.includes('死亡宣告'))]));
  chk('C1 ⭐耿鬼ex 那一側取得 2 張獎賞（帝王拿波ex 是 ex）⇒ 6 − 2 = 4', PZ(H, 1) === 4, String(PZ(H, 1)));
  chk('C2 ⭐反對照：反面 ⇒ 帝王拿波ex 仍在場、獎賞不變',
    !!A0(T) && PZ(T, 1) === 6, JSON.stringify([!!A0(T), PZ(T, 1)]));
}

console.log('\n【D】⭐A 類 per-turn 旗標（純樸／飛翔躲藏類）⇒ 死亡宣告照樣讓它昏厥');
{
  const HpuLe = runIce({ energyAttached: energyFor(ICE, '冰雹'), immuneToAttackEffectsThisTurn: true });
  const HallA = runIce({ energyAttached: energyFor(ICE, '冰雹'), immuneToAllAttackThisTurn: true });
  chk('D0 哨兵：兩邊的耿鬼ex 都因招式傷害昏厥',
    D0(HpuLe) == null && D0(HallA) == null, JSON.stringify([D0(HpuLe), D0(HallA)]));
  chk('D1 ⭐攻擊方帶 immuneToAttackEffectsThisTurn（純樸）⇒ 死亡宣告仍讓它昏厥',
    A0(HpuLe) == null && PZ(HpuLe, 1) === 5,
    JSON.stringify([!!A0(HpuLe), PZ(HpuLe, 1), LOGS(HpuLe).filter((x) => x.includes('純樸'))]));
  chk('D2 ⭐攻擊方帶 immuneToAllAttackThisTurn（飛翔／躲藏／要害斬）⇒ 死亡宣告仍讓它昏厥',
    A0(HallA) == null && PZ(HallA, 1) === 5,
    JSON.stringify([!!A0(HallA), PZ(HallA, 1), LOGS(HallA).filter((x) => x.includes('飛翔'))]));
}

console.log('\n【E】⭐⭐⭐「招式」來源**完全不變**（這是「既有行為零變更」的主證明）');
{
  // E-a 真正的招式效果昏厥（蜜集大蛇｜大蛇吐息）對上 A 類免疫卡 ⇒ 照舊被擋
  const blkHard = runSnake(inst(LUCA.id, { energyAttached: [inst(HARD.id)] }));  // 【鬥】+硬岩
  const okHard  = runSnake(inst(LUCA.id));                                        // 哨兵：同盤面不附
  chk('Ea0 哨兵：不附硬岩時，大蛇吐息**確實**把對手戰鬥寶可夢昏厥（招式效果昏厥管線是通的）',
    D0(okHard) == null, JSON.stringify([D0(okHard)?.damage, LOGS(okHard).filter((x) => x.includes('大蛇吐息'))]));
  chk('Ea1 ⭐⭐附「硬岩【鬥】能量」的【鬥】寶可夢 **照舊**擋得住招式效果昏厥（行為零變更）',
    !!D0(blkHard) && D0(blkHard).damage === 0,
    JSON.stringify([!!D0(blkHard), LOGS(blkHard).filter((x) => x.includes('大蛇吐息'))]));
  chk('Ea1 ⭐擋住時 log 逐字含「硬岩【鬥】能量 免疫招式效果」＋「（不昏厥）」',
    LOGS(blkHard).some((x) => x.includes('硬岩【鬥】能量 免疫招式效果') && x.includes('不昏厥')),
    LOGS(blkHard).filter((x) => x.includes('大蛇吐息')).join(' / '));

  const blkMist = runSnake(inst(PLAIN.id, { energyAttached: [inst(MIST.id)] }));
  const okMist  = runSnake(inst(PLAIN.id));
  chk('Eb0 哨兵：不附薄霧能量時，大蛇吐息確實把對手戰鬥寶可夢昏厥', D0(okMist) == null,
    JSON.stringify([D0(okMist)]));
  chk('Eb1 ⭐⭐附「薄霧能量」**照舊**擋得住招式效果昏厥（官方 PTCG_RULES L2470–L2471 同型）',
    !!D0(blkMist) && LOGS(blkMist).some((x) => x.includes('薄霧能量 免疫招式效果')),
    JSON.stringify([!!D0(blkMist), LOGS(blkMist).filter((x) => x.includes('大蛇吐息'))]));

  const blkNapo = runSnake(inst(NAPO.id));
  chk('Ec1 ⭐⭐「皇帝之勢」**照舊**擋得住招式效果昏厥（官方 PTCG_RULES L2911–L2912 同型）',
    !!D0(blkNapo) && LOGS(blkNapo).some((x) => x.includes('皇帝之勢 免疫招式效果')),
    JSON.stringify([!!D0(blkNapo), LOGS(blkNapo).filter((x) => x.includes('大蛇吐息'))]));

  // E-e ⭐⭐**直接**呼叫閘門、且**省略 source 參數**（吃預設值）的招式：棄世猴｜同命戰鬥。
  //   ⇒ 這一組專門釘住「閘門預設值必須是 'attack'」這一維（官方判例 PTCG_RULES L1921）。
  const boardMonk = (defInst) => mk(
    { active: inst(MONK.id, { energyAttached: energyFor(MONK, '同命戰鬥') }), bench: [inst(PLAIN.id)] },
    { active: defInst, bench: [inst(PLAIN.id)] });
  const runMonk = (defInst) => act(boardMonk(defInst), { type: 'ATTACK', attackIndex: atkIdx(MONK, '同命戰鬥') });
  const monkOk  = runMonk(inst(PLAIN.id));
  const monkBlk = runMonk(inst(PLAIN.id, { energyAttached: [inst(MIST.id)] }));
  chk('Ee0 哨兵：不附薄霧能量時，同命戰鬥確實把對手戰鬥寶可夢昏厥（管線是通的）',
    D0(monkOk) == null, JSON.stringify([D0(monkOk), LOGS(monkOk).filter((x) => x.includes('同命戰鬥'))]));
  chk('Ee1 ⭐⭐直接呼叫閘門（省略 source 參數 ⇒ 吃**預設值**）的招式 **照舊**擋得住：'
    + '同命戰鬥打不昏厥附薄霧能量的對手（官方 PTCG_RULES L1921）',
    !!D0(monkBlk) && LOGS(monkBlk).some((x) => x.includes('同命戰鬥：') && x.includes('薄霧能量 免疫招式效果')),
    JSON.stringify([!!D0(monkBlk), LOGS(monkBlk).filter((x) => x.includes('同命戰鬥'))]));

  const blkPure = runSnake(inst(PLAIN.id, { immuneToAttackEffectsThisTurn: true }));
  const blkAll  = runSnake(inst(PLAIN.id, { immuneToAllAttackThisTurn: true }));
  chk('Ed1 ⭐⭐per-turn 旗標（純樸／飛翔躲藏類）**照舊**擋得住招式效果昏厥',
    !!D0(blkPure) && !!D0(blkAll)
    && LOGS(blkPure).some((x) => x.includes('免疫招式的效果（純樸類）'))
    && LOGS(blkAll).some((x) => x.includes('免疫招式的傷害與效果（飛翔/要害斬/躲藏類）')),
    JSON.stringify([!!D0(blkPure), !!D0(blkAll)]));
}

console.log('\n【F】⭐C 類（化隱：卡面寫「招式**與**特性」）⇒ 兩種來源都要擋');
{
  // 怨影娃娃（化隱、HP50）用 垂吊 10 打 耿鬼ex（damage HP−10）⇒ 招式傷害 KO ⇒ 死亡宣告（特性來源）
  const boardDoll = () => mk(
    { active: inst(DOLL.id, { energyAttached: energyFor(DOLL, '垂吊') }), bench: [inst(PLAIN.id)] },
    { active: inst(GENG.id, { damage: Number(GENG.hp) - 10 }), bench: [inst(PLAIN.id)] });
  const H = act(boardDoll(), { type: 'ATTACK', attackIndex: atkIdx(DOLL, '垂吊') });
  chk('F0 哨兵：垂吊 10 確實把耿鬼ex 打昏厥、攻擊方取 2 張獎賞（6 − 2 = 4）',
    D0(H) == null && PZ(H, 0) === 4, JSON.stringify([D0(H), PZ(H, 0)]));
  chk('F1 ⭐⭐化隱是 C 類 ⇒ 擋得住**特性**來源：怨影娃娃 **不**昏厥、耿鬼側不取獎賞',
    !!A0(H) && A0(H).damage === 0 && PZ(H, 1) === 6,
    JSON.stringify([!!A0(H), A0(H)?.damage, PZ(H, 1)]));
  chk('F1 ⭐擋住時 log 逐字寫的是「化隱 免疫**特性**效果」（來源說對，不是沿用招式字樣）',
    LOGS(H).some((x) => x.includes('死亡宣告：') && x.includes('化隱 免疫特性效果') && x.includes('不昏厥')),
    LOGS(H).filter((x) => x.includes('死亡宣告')).join(' / '));
  chk('F1 ⭐死亡宣告仍然**有啟動**（擲幣照擲），只是目標免疫 ⇒ 不是「整個沒觸發」',
    nLog(H, '「死亡宣告」啟動：硬幣正面') === 1,
    LOGS(H).filter((x) => x.includes('死亡宣告')).join(' / '));

  // 反向：同一張化隱，對**招式**來源也照擋
  const blkDoll = runSnake(inst(DOLL.id));
  chk('F2 ⭐⭐同一筆 C 類對**招式**來源也照擋（大蛇吐息 打不昏厥怨影娃娃）',
    !!D0(blkDoll) && LOGS(blkDoll).some((x) => x.includes('化隱 免疫招式效果')),
    JSON.stringify([!!D0(blkDoll), LOGS(blkDoll).filter((x) => x.includes('大蛇吐息'))]));

  // 正對照：把攻擊方換成**沒有**化隱的急凍鳥 ⇒ 死亡宣告成功（證明 F1 的差異來自化隱）
  const C = runIce();
  chk('F3 ⭐正對照：同樣「招式傷害 KO 耿鬼ex + 正面」但攻擊方沒有化隱 ⇒ 攻擊方昏厥',
    A0(C) == null && PZ(C, 1) === 5, JSON.stringify([!!A0(C), PZ(C, 1)]));
}

console.log('\n【G】⭐逐筆卡面逐字錨（每一筆 face 必須與 static/cards 台灣官方卡面逐字相同）');
{
  /**
   * 蒐集「卡名 = cardName、而且**確實印著** member 這個特性／招式」的所有 live 印刷的那一欄文字。
   * （同名不同卡是常態 —— 例如另一張同名寶可夢印的是別的特性，不能拿來要求含有本 face。）
   * rulesText 型（訓練家／特殊能量）沒有 member，直接取 rulesText。
   */
  const fieldTexts = (cardName, field, member) => {
    const out = [];
    for (const c of all) {
      if (c.name !== cardName) continue;
      if (field === 'ability') for (const a of (c.abilities || [])) { if (a.name === member) out.push(String(a.effect ?? '')); }
      else if (field === 'attack') for (const a of (c.attacks || [])) { if (a.name === member) out.push(String(a.effect ?? '')); }
      else out.push(String(c.rulesText ?? c.effect ?? ''));
    }
    return out;
  };
  /** face 必須逐字出現在**每一個**印著它的 live 印刷（且至少要有 1 個）；卡面漂移／抓錯印刷就紅 */
  const faceOk = (cardName, field, member, face) => {
    const texts = fieldTexts(cardName, field, member);
    if (texts.length === 0) return false;
    return texts.every((t) => t.includes(face));
  };

  // ⭐掃描器自驗：弄髒的 face 必須抓不到，否則整組 face 斷言恆真（安慰劑 #27）
  const firstKey = [...EFFECT_SOURCE_IMMUNITY.keys()][0];
  const firstDecl = EFFECT_SOURCE_IMMUNITY.get(firstKey);
  chk('G0 ⭐掃描器自驗：正確 face 抓得到、弄髒 1 個字的 face 抓不到（否則下面全是恆真）',
    faceOk(firstDecl.card, firstDecl.field, firstDecl.member, firstDecl.face)
    && !faceOk(firstDecl.card, firstDecl.field, firstDecl.member, firstDecl.face.replace('不會', '⛔不會'))
    && !faceOk(firstDecl.card, firstDecl.field, firstDecl.member, firstDecl.face + '※'),
    JSON.stringify([firstKey, firstDecl.card, firstDecl.field, firstDecl.member]));
  chk('G0 ⭐掃描器自驗：不存在的卡名／抓錯特性名 一定抓不到',
    !faceOk('不存在的卡名XYZ', 'ability', '化隱', '不會受到')
    && !faceOk(firstDecl.card, firstDecl.field, '不存在的特性名XYZ', firstDecl.face));

  chk('G1 表至少有 11 筆（漏登記會讓分類表形同虛設）',
    EFFECT_SOURCE_IMMUNITY.size >= 11, String(EFFECT_SOURCE_IMMUNITY.size));
  for (const [key, d] of EFFECT_SOURCE_IMMUNITY) {
    chk(`G2 ⭐卡面逐字錨：${key} ← ${d.card}｜${d.member ?? d.field}`,
      faceOk(d.card, d.field, d.member, d.face),
      JSON.stringify({ card: d.card, field: d.field, member: d.member, face: d.face,
        actual: fieldTexts(d.card, d.field, d.member) }));
    chk(`G3 ⭐分類與卡面自洽：${key} → blocks=${JSON.stringify(d.blocks)}`,
      (() => {
        const hasAtk = d.face.includes('招式');
        const hasAbi = d.face.includes('特性');
        const wantAtk = d.blocks.includes('attack');
        const wantAbi = d.blocks.includes('ability');
        // 卡面提到「招式」⇒ 必須擋 attack；沒提到「特性」⇒ 一定不可以擋 ability
        return (hasAtk === wantAtk) && (hasAbi === wantAbi) && d.blocks.length > 0;
      })(),
      JSON.stringify({ face: d.face, blocks: d.blocks }));
  }
  chk('G4 blocks 值域只有 attack/ability，且不得重複',
    [...EFFECT_SOURCE_IMMUNITY.values()].every((d) =>
      d.blocks.length === new Set(d.blocks).size
      && d.blocks.every((b) => b === 'attack' || b === 'ability')));
  chk('G5 ⭐目前沒有 B 類（只擋特性）；若未來新增 B 類，本行會紅 ⇒ 必須回來補反向行為驗證',
    [...EFFECT_SOURCE_IMMUNITY.values()].every((d) => d.blocks.includes('attack')),
    JSON.stringify([...EFFECT_SOURCE_IMMUNITY].filter(([, d]) => !d.blocks.includes('attack')).map(([k]) => k)));
}

console.log('\n【H】⭐中央性：來源判準只有一份，沒有任何地方用 bypass 繞過閘（靜態）');
{
  const src = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  chk('H1 ⭐EFFECT_SOURCE_IMMUNITY 只被**一個**地方讀（唯一判準 effectSourceBlocks）',
    (code.match(/EFFECT_SOURCE_IMMUNITY\.get\(/g) || []).length === 1,
    String((code.match(/EFFECT_SOURCE_IMMUNITY\.get\(/g) || []).length));
  chk('H2 ⭐閘門的 source 預設值**必須**是 \'attack\'（改成 ability 會讓既有招式全部漏免疫）',
    /source: EffectSource = 'attack',/.test(code)
    && (code.match(/source: EffectSource = 'attack',/g) || []).length === 2,
    String((code.match(/source: EffectSource = '\w+',/g) || [])));
  chk('H3 ⭐koTargetByAttackEffect 只**透傳** source，內部不得認得任何卡名（第二份判準）',
    (() => {
      const i = code.indexOf('export function koTargetByAttackEffect(');
      const body = code.slice(i, i + 2200);
      return i > 0 && !body.includes('死亡宣告') && !body.includes('薄霧') && !body.includes('化隱');
    })());
  chk('H4 ⭐沒有任何 bypass／skipImmunity／forceKO 之類的第二條繞道',
    !/bypassImmun|skipImmun|ignoreImmun|forceKoIgnore/i.test(code));
  chk('H5 ⭐每一筆登記都真的會被消費（不是死表）：key 要嘛在 ATTACK_EFFECT_IMMUNITY，'
    + '要嘛在 effects.ts 被 effectSourceBlocks(\'key\') 直接問',
    [...EFFECT_SOURCE_IMMUNITY.keys()].every((k) =>
      ATTACK_EFFECT_IMMUNITY.has(k) || code.includes(`effectSourceBlocks('${k}'`)),
    JSON.stringify([...EFFECT_SOURCE_IMMUNITY.keys()].filter((k) =>
      !ATTACK_EFFECT_IMMUNITY.has(k) && !code.includes(`effectSourceBlocks('${k}'`))));
  // 補充（非取代）：述詞本身對兩個方向都要是真的「函數」，不是常數
  chk('H6 補充（行為端已由 A–F 釘住）：effectSourceBlocks 對 A 類／C 類回答不同',
    effectSourceBlocks('薄霧能量', 'attack') === true
    && effectSourceBlocks('薄霧能量', 'ability') === false
    && effectSourceBlocks('化隱', 'attack') === true
    && effectSourceBlocks('化隱', 'ability') === true
    && effectSourceBlocks('查無此登記XYZ', 'ability') === true,   // fail-closed
    JSON.stringify([effectSourceBlocks('薄霧能量', 'ability'), effectSourceBlocks('化隱', 'ability')]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
