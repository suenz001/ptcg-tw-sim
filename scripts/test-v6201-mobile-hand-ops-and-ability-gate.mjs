// ⭐⭐⭐ v6.201 守衛（兩件事，一份測試）
//
// ① 手機直式手牌可用性收斂到中央述詞
//    v6.200 建了 `src/lib/game/hand-card-ops.ts` 的 getHandCardOps() 當桌機的唯一述詞，
//    但 `MobilePortraitBattle.svelte` 仍自帶**第三份**：
//      playable{Trainer,Basic,Fossil,Evo}Iids ／ handAbilityActivatableIids ／ aceCancelActiveLocal。
//    手機沒有拖曳所以當下沒 bug，但三份判定遲早漂移（烈箭鷹ex 三度出包 v6.080/v6.098/v6.200
//    全是同一成因）。本版刪掉第三份、改讀中央述詞。
//    ⚠ 手機的 isMyTurn = `activePlayerIndex === myIdx`，而 setup 是**雙方同時擺場** ——
//      所以中央述詞加了 `ctx.isMySetupTurn`（不傳＝沿用 isMyTurn ⇒ 桌機行為不變）。
//
// ② ACE消弭 / 濕氣 的持有者 passive 特性沒過「特性是否生效」的閘（v6.196 那一族的漏網）
//    ・蓋諾賽克特｜ACE消弭（SV6a 040/064，Basic）：engine isAceCancelActive 只比對特性名。
//      ⇒ 被 招式版暗夜羽擊(abilityNullifiedThisTurn) / 振翼髮｜暗夜羽擊 passive 消除後仍生效。
//      ⚠ 它 stage=Basic、pokemonType=Metal ⇒ 傳說的熔岩洞（只消除進化）與火箭隊的監視塔
//        （只消除【無】）本來就不適用；子代理當初舉的「傳說的熔岩洞」例子對這張卡不成立。
//    ・可達鴨／哥達鴨｜濕氣：engine isSelfKOEffectBlocked 同病，且它的姊妹版
//      effects.ts hasPsyduckDamp 早在 v5.220 就有 gate ⇒ 兩份不一致。
//    ⇒ 兩者都改走 v6.196 的中央 helper hasEffectiveAbilityByInst（不另建第四份）。
//    ⇒ _shared.ts canPlayTrainer 裡 v2.113 的**第三份** ACE 判定一併刪除
//      （只比對卡名 + toolAttached，會把上面的修正在 PLAY_TRAINER 這條路上擋回去）。
//    ⚠ v6.196 刻意不對 v3001 的 hasAbilityOnBench 加 gate（黏著束縛偵測走它，加了會無窮遞迴）
//      —— 這個例外用正對照釘住。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6201-s.js'), E = join(ROOT, '.v6201-e.ts'), O = join(ROOT, '.v6201-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) pass++; else { fail++; console.log('  ❌', t, extra); } };

writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { applyAction, isAceCancelActive, isSelfKOEffectBlocked, getPlayableTrainers,\n"
+ "         getPlayableBasics, getPlayableFossils, getEvolvableTargets, getUsableAbilities,\n"
+ "         getHandActivatableAbilities, canBeInitialActiveCard, getBenchLimit } from './src/lib/game/engine';\n"
+ "export { canPlayTrainer } from './src/lib/game/effects/_shared';\n"
+ "export { getHandCardOps } from './src/lib/game/hand-card-ops';\n"
+ "export { isAbilityHolderEffective } from './src/lib/game/effects/cards/v3001_g3_wave3';\n"
+ "import './src/lib/game/effects';");
let M = null;
try {
  await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
    target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
  M = await import(pathToFileURL(O).href);
} catch (e) { chk('bundle 可建置', false, String(e).slice(0, 400)); }

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const find = (p) => { for (const [id, c] of pool) if (p(c)) return id; return null; };
const ab = (n) => (c) => (c.abilities ?? []).some(a => a.name === n);

// ══════════════════════════════════════════════════════════════════════════
// ① 卡面逐字（static/cards 台灣官方卡面；特性讀 abilities[].effect）
// ══════════════════════════════════════════════════════════════════════════
const GENESECT = '10622';
const GOLDUCK  = find(c => c.name === '哥達鴨' && ab('濕氣')(c));
const MOONSENNE = find(c => c.name === '振翼髮' && ab('暗夜羽擊')(c));
const HAUNTER  = find(c => c.name === '彷徨夜靈' && ab('咒詛炸彈')(c));
const SLURPUFF = find(c => c.name === '海兔獸' && ab('黏著束縛')(c));
{
  const g = pool.get(GENESECT);
  chk('①卡面：蓋諾賽克特 10622 存在', !!g);
  chk('①卡面：ACE消弭 effect 逐字',
    (g?.abilities ?? []).some(a => a.name === 'ACE消弭'
      && a.effect === '若這隻寶可夢附有「寶可夢道具」卡，則對手無法從手牌使出「【ACE SPEC】」卡。'),
    JSON.stringify(g?.abilities ?? null));
  chk('①卡面：蓋諾賽克特 stage=Basic（⇒ 傳說的熔岩洞不適用，子代理舉例不成立）',
    g?.stage === 'Basic', String(g?.stage));
  chk('①卡面：蓋諾賽克特 pokemonType=Metal（⇒ 火箭隊的監視塔【無】也不適用）',
    g?.pokemonType === 'Metal', String(g?.pokemonType));
  chk('①卡面：蓋諾賽克特是維護中的 H/I/J 標', ['H','I','J'].includes(String(g?.regulationMark)));
  const gd = pool.get(GOLDUCK);
  chk('①卡面：哥達鴨｜濕氣 effect 逐字',
    (gd?.abilities ?? []).some(a => a.name === '濕氣'
      && a.effect === '只要這隻寶可夢在場上，雙方所有寶可夢的將自己【昏厥】的效果的特性，全部消除。'),
    JSON.stringify(gd?.abilities ?? null));
  chk('①卡面：哥達鴨 stage=Stage1（進化寶可夢 ⇒ 傳說的熔岩洞會消除它）', gd?.stage === 'Stage1', String(gd?.stage));
  const mo = pool.get(MOONSENNE);
  chk('①卡面：振翼髮｜暗夜羽擊 effect 逐字',
    (mo?.abilities ?? []).some(a => a.name === '暗夜羽擊'
      && a.effect === '只要這隻寶可夢在戰鬥場上，對手的戰鬥寶可夢的特性（「暗夜羽擊」除外）全部消除。'),
    JSON.stringify(mo?.abilities ?? null));
  chk('①卡面：彷徨夜靈｜咒詛炸彈 是「將這隻寶可夢【昏厥】」型特性',
    (pool.get(HAUNTER)?.abilities ?? []).some(a => a.name === '咒詛炸彈' && a.effect.includes('將這隻寶可夢【昏厥】')));
  chk('①掃描器下限：本測試依賴的卡都抓得到（抓不到＝安慰劑綠燈）',
    !!GENESECT && !!GOLDUCK && !!MOONSENNE && !!HAUNTER && !!SLURPUFF,
    JSON.stringify({ GENESECT, GOLDUCK, MOONSENNE, HAUNTER, SLURPUFF }));
}

// ══════════════════════════════════════════════════════════════════════════
// ② / ③ 行為端
// ══════════════════════════════════════════════════════════════════════════
let n = 0; const iid = () => 'v' + (++n);
const mk = (cid, x = {}) => ({ iid: iid(), cardId: String(cid), damage: 0, energyAttached: [], ...x });
const TOOL = find(c => c.supertype === 'Trainer' && c.subtype === 'PokemonTool' && !(c.tags ?? []).includes('ACE SPEC'));
const ACE_ITEM = '11150';    // 貴重手推車（ACE SPEC Item）
const ACE_ENERGY = '11094';  // 富裕能量（ACE SPEC Energy）
const PLAIN = find(c => c.supertype === 'Pokemon' && c.stage === 'Basic' && !c.abilities);
const WATER = find(c => c.supertype === 'Energy' && c.subtype === 'Basic');

function baseState(players) {
  return { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    mulliganPostBenchOpen: [false, false], mulliganCounts: [0, 0], pendingPrizes: [0, 0],
    stadiumPlayedThisTurn: [false, false], activeStadium: null, players };
}
/** mode: 'normal' | 'atk-nullify'(招式版暗夜羽擊) | 'passive-nullify'(振翼髮在我方戰鬥場) */
function aceState(mode) {
  const gene = mk(GENESECT, { toolAttached: mk(TOOL) });
  if (mode === 'atk-nullify') gene.abilityNullifiedThisTurn = true;
  const myActive = mode === 'passive-nullify' ? mk(MOONSENNE) : mk(PLAIN);
  const item = mk(ACE_ITEM), energy = mk(ACE_ENERGY);
  return { st: baseState([
    { name: 'P1', active: myActive, bench: [], hand: [item, energy], deck: [mk(WATER)], discard: [], prizes: [],
      abilityNamesUsedThisTurn: [] },
    { name: 'P2', active: gene, bench: [], hand: [], deck: [mk(WATER)], discard: [], prizes: [],
      abilityNamesUsedThisTurn: [] },
  ]), item, energy };
}
if (M) {
  for (const [mode, blockedExpected] of [['normal', true], ['atk-nullify', false], ['passive-nullify', false]]) {
    const { st, item, energy } = aceState(mode);
    const label = mode === 'normal' ? '正對照(特性正常)' : mode === 'atk-nullify' ? '招式版暗夜羽擊' : '振翼髮 passive';
    chk(`②[${label}] isAceCancelActive === ${blockedExpected}`,
      M.isAceCancelActive(st, 0, pool) === blockedExpected, String(M.isAceCancelActive(st, 0, pool)));
    // 消費點 a：getPlayableTrainers（手牌黃框 / AI 可用清單）
    chk(`②[${label}] getPlayableTrainers 含 ACE SPEC 物品 === ${!blockedExpected}`,
      M.getPlayableTrainers(st, pool).includes(item.iid) === !blockedExpected);
    // 消費點 b：PLAY_TRAINER 實跑（⚠ _shared.canPlayTrainer 的第三份判定若還在，這條會紅）
    const afterT = M.applyAction(st, { type: 'PLAY_TRAINER', iid: item.iid, actorIdx: 0 }, pool);
    const played = !afterT.players[0].hand.some(h => h.iid === item.iid);
    chk(`②[${label}] PLAY_TRAINER 實跑：卡真的離開手牌 === ${!blockedExpected}`, played === !blockedExpected);
    // 消費點 c：ATTACH_ENERGY 實跑（ACE SPEC 能量）
    const afterE = M.applyAction(st, { type: 'ATTACH_ENERGY', energyIid: energy.iid, targetIid: st.players[0].active.iid, actorIdx: 0 }, pool);
    const attached = (afterE.players[0].active.energyAttached ?? []).length > 0;
    chk(`②[${label}] ATTACH_ENERGY 實跑：能量真的附上 === ${!blockedExpected}`, attached === !blockedExpected);
    // 消費點 d：UI 唯一述詞 getHandCardOps
    const ops = M.getHandCardOps(st, 0, pool, { isMyTurn: true });
    chk(`②[${label}] getHandCardOps：ACE SPEC 能量有 energy op === ${!blockedExpected}`,
      !!ops.get(energy.iid)?.has('energy') === !blockedExpected, JSON.stringify([...(ops.get(energy.iid) ?? [])]));
  }
  // 正對照：沒附道具的蓋諾賽克特不擋（卡面「若這隻寶可夢附有『寶可夢道具』卡」）
  {
    const st = baseState([
      { name: 'P1', active: mk(PLAIN), bench: [], hand: [mk(ACE_ITEM)], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [] },
      { name: 'P2', active: mk(GENESECT), bench: [], hand: [], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [] },
    ]);
    chk('②正對照：蓋諾賽克特沒附道具 → 不擋', M.isAceCancelActive(st, 0, pool) === false);
  }
  // 正對照：extraTools（engine 版認得，被刪掉的 _shared 第三份不認得）
  {
    const st = baseState([
      { name: 'P1', active: mk(PLAIN), bench: [], hand: [mk(ACE_ITEM)], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [] },
      { name: 'P2', active: mk(GENESECT, { extraTools: [mk(TOOL)] }), bench: [], hand: [], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [] },
    ]);
    chk('②正對照：道具掛在 extraTools 也算「附有寶可夢道具」', M.isAceCancelActive(st, 0, pool) === true);
  }

  // ── ③ 濕氣 ────────────────────────────────────────────────────────
  for (const [mode, blockedExpected] of [['normal', true], ['passive-nullify', false]]) {
    const haunt = mk(HAUNTER);
    const st = baseState([
      { name: 'P1', active: mk(mode === 'passive-nullify' ? MOONSENNE : PLAIN), bench: [haunt], hand: [],
        deck: [mk(WATER)], discard: [], prizes: [], abilityNamesUsedThisTurn: [] },
      { name: 'P2', active: mk(GOLDUCK), bench: [], hand: [], deck: [mk(WATER)], discard: [], prizes: [], abilityNamesUsedThisTurn: [] },
    ]);
    const label = mode === 'normal' ? '正對照(濕氣正常)' : '振翼髮 passive 消除濕氣';
    chk(`③[${label}] isSelfKOEffectBlocked === ${blockedExpected}`,
      M.isSelfKOEffectBlocked(st, pool) === blockedExpected);
    chk(`③[${label}] getUsableAbilities 列出「咒詛炸彈」 === ${!blockedExpected}`,
      M.getUsableAbilities(st, pool).some(a => a.abilityName === '咒詛炸彈') === !blockedExpected);
    const after = M.applyAction(st, { type: 'USE_ABILITY', iid: haunt.iid, abilityIndex: 0, actorIdx: 0 }, pool);
    const lastLog = (after.log ?? []).slice(-1)[0]?.message ?? '';
    chk(`③[${label}] USE_ABILITY 實跑：被濕氣擋 === ${blockedExpected}`,
      lastLog.includes('濕氣') === blockedExpected, lastLog);
  }

  // ── ④ hasAbilityOnBench 的既有例外（v6.196 刻意不加 gate）正對照 ──
  //    黏著束縛偵測走無 gate 的 hasAbilityOnBench；若有人「順手」給它加上 gate，
  //    isAbilityHolderEffective → isAbilityNullifiedBySticky → hasAbilityOnSide → … 會無窮遞迴。
  {
    const STAGE2 = find(c => c.supertype === 'Pokemon' && c.stage === 'Stage2' && (c.abilities ?? []).length > 0);
    const s2 = mk(STAGE2), slur = mk(SLURPUFF);
    const st = baseState([
      { name: 'P1', active: mk(PLAIN), bench: [s2], hand: [], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [] },
      { name: 'P2', active: mk(PLAIN), bench: [slur], hand: [], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [] },
    ]);
    const abName = pool.get(STAGE2).abilities[0].name;
    let threw = '', res = null;
    const t0 = Date.now();
    try { res = M.isAbilityHolderEffective(st, s2, pool.get(STAGE2), 0, abName, 'bench', pool); }
    catch (e) { threw = String(e).slice(0, 120); }
    chk('④例外保住：黏著束縛仍能消除備戰 2 階特性（判定回 false）', res === false, `${res} ${threw}`);
    chk('④例外保住：沒有無窮遞迴（RangeError / 逾時都算紅）', threw === '' && Date.now() - t0 < 3000, threw);
    // 正對照：海兔獸不在備戰時不消除
    const st2 = baseState([
      { name: 'P1', active: mk(PLAIN), bench: [s2], hand: [], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [] },
      { name: 'P2', active: mk(SLURPUFF), bench: [], hand: [], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [] },
    ]);
    chk('④正對照：海兔獸在戰鬥場（非備戰）→ 不消除',
      M.isAbilityHolderEffective(st2, s2, pool.get(STAGE2), 0, abName, 'bench', pool) === true);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ⑤ 手機直式：不得再有第二／第三份可用性判定（枚舉守衛 + 自我驗證）
// ══════════════════════════════════════════════════════════════════════════
const stripComments = (s) => String(s)
  .replace(/[​-‍﻿]/g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const MOB_PATH = join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte');
const mobRaw = readFileSync(MOB_PATH, 'utf8');
const mob = stripComments(mobRaw);

/** 否定型判準：手機端「自己算可用性」的痕跡 */
const BANNED = [
  [/playable(Trainer|Basic|Fossil|Evo)Iids/g, '第三份 playable*Iids'],
  [/handAbilityActivatableIids/g, '第三份手牌特性清單'],
  [/aceCancelActiveLocal/g, '鏡射一份 isAceCancelActive'],
  [/isAceSpecEnergyCard/g, '自己判 ACE SPEC 能量'],
  [/getPlayableTrainers|getPlayableBasics|getPlayableFossils/g, '直接呼叫 engine 可用清單（應該只走 getHandCardOps）'],
];
function bannedHits(src) {
  const out = [];
  for (const [re, why] of BANNED) { const m = String(src).match(re); if (m) out.push(`${why}:${m.length}`); }
  return out;
}
chk('⑤手機直式：沒有第二／第三份手牌可用性判定', bannedHits(mob).length === 0, JSON.stringify(bannedHits(mob)));
chk('⑤手機直式：手牌可用性讀中央 getHandCardOps',
  /import \{ getHandCardOps, type HandCardOp \} from '\$lib\/game\/hand-card-ops';/.test(mob)
  && /getHandCardOps\(game, myIdx as 0 \| 1, pool, \{ isMyTurn, isMySetupTurn: !isSpectator \}\)/.test(mob));
chk('⑤手機直式：sheet 動作清單逐項問 ops',
  ["ops.has('setup-active')", "ops.has('basic')", "ops.has('fossil')", "ops.has('evolve')",
   "ops.has('trainer')", "ops.has('energy')", "ops.has('hand-ability')"].every(k => mob.includes(k)),
  JSON.stringify(["setup-active","basic","fossil","evolve","trainer","energy","hand-ability"].filter(k => !mob.includes(`ops.has('${k}')`))));
chk('⑤手機直式：黃框也只讀 ops（_ops.size > 0）',
  /\{@const _ops = opsOf\(inst\.iid\)\}/.test(mob) && /\{@const playable = _ops\.size > 0\}/.test(mob));
chk('⑤手機直式：仍然沒有卡片拖曳（版面 paradigm 不變）',
  !/startDrag\(/.test(mob) && !/type DragKind/.test(mob));
// 自我驗證（否定型判準必須配正對照）
chk('⑤自我驗證：判準抓得到違規樣本',
  bannedHits("let playableBasicIids = $derived(new Set(getPlayableBasics(game, pool)));").length >= 2,
  JSON.stringify(bannedHits("let playableBasicIids = $derived(new Set(getPlayableBasics(game, pool)));")));
chk('⑤自我驗證：乾淨樣本不誤報', bannedHits("const ops = opsOf(inst.iid); if (ops.has('energy')) {}").length === 0);
chk('⑤自我驗證：stripComments 真的剝得掉註解（否則舊註解會讓判準誤紅/誤綠）',
  !stripComments('// aceCancelActiveLocal\nx').includes('aceCancelActiveLocal')
  && !stripComments('<!-- playableBasicIids -->x').includes('playableBasicIids'));
// 中央述詞本身：桌機不受影響（isMySetupTurn 不傳 = 沿用 isMyTurn）
const OPS_SRC = readFileSync(join(ROOT, 'src/lib/game/hand-card-ops.ts'), 'utf8');
chk('⑤中央述詞：isMySetupTurn 未傳時退回 isMyTurn（桌機行為不變）',
  /const setupTurn = ctx\.isMySetupTurn === undefined \? isMyTurn : !!ctx\.isMySetupTurn;/.test(OPS_SRC));
chk('⑤中央述詞：setup 放備戰有備戰上限 gate（對齊 engine handleSetup 的 BENCH_POKEMON）',
  /const benchFull = \(me\.bench\?\.length \?\? 0\) >= getBenchLimit\(state, myIdx, pool\);/.test(OPS_SRC)
  && /setupOpen && !!me\.active && !benchFull/.test(OPS_SRC));

// ══════════════════════════════════════════════════════════════════════════
// ⑥ 差分實跑：舊述詞 vs 新述詞，每個 mismatch 都必須是「舊的那顆按鈕本來就沒用」
//    ⚠ 舊述詞逐字轉錄自 BASE 4f3c7c2a3282379cb98c441fcddb980c75c37ef7 的
//      MobilePortraitBattle.svelte（L266~296 / L520~575 / L1161~1172）。
// ══════════════════════════════════════════════════════════════════════════
function oldPredicate(game, myIdx, isSpectator) {
  const me = game.players[myIdx], opp = game.players[1 - myIdx];
  const pending = game.pendingSelection;
  const isMyTurn = !isSpectator && game.activePlayerIndex === myIdx;
  const isMainPhase = game.turnPhase === 'main';
  const isSetup = game.phase === 'setup', isPlaying = game.phase === 'playing';
  const limit = M.getBenchLimit(game, myIdx, pool);
  const Sx = (a) => new Set(a);
  const pTrainer = isPlaying && isMyTurn && isMainPhase ? Sx(M.getPlayableTrainers(game, pool)) : Sx([]);
  const pBasic   = isPlaying && isMyTurn && isMainPhase ? Sx(M.getPlayableBasics(game, pool))   : Sx([]);
  const pFossil  = isPlaying && isMyTurn && isMainPhase ? Sx(M.getPlayableFossils(game, pool))  : Sx([]);
  const evoT     = isPlaying && isMyTurn && isMainPhase ? M.getEvolvableTargets(game, pool)     : [];
  const pEvo     = Sx(evoT.flatMap(e => e.toIids));
  const pAbil    = (isPlaying && isMyTurn && isMainPhase && !pending)
    ? Sx(M.getHandActivatableAbilities(game, myIdx, pool).map(a => a.iid)) : Sx([]);
  const aceLocal = [...(opp.active ? [opp.active] : []), ...opp.bench].some(pk => {
    const c = pool.get(pk.cardId);
    if (!c || c.name !== '蓋諾賽克特') return false;
    if (!c.abilities?.some(a => a.name === 'ACE消弭')) return false;
    return [...(pk.toolAttached ? [pk.toolAttached] : []), ...(pk.extraTools ?? [])].length > 0;
  });
  const isEnergy = c => !!c && c.supertype === 'Energy';
  const isTrainer = c => !!c && c.supertype === 'Trainer' && c.subtype !== 'PokemonTool';
  const isTool = c => !!c && c.supertype === 'Trainer' && c.subtype === 'PokemonTool';
  const isBasicMon = c => !!c && c.supertype === 'Pokemon' && !c.evolvesFrom;
  const isEvoMon = c => !!c && c.supertype === 'Pokemon' && !!c.evolvesFrom;
  const isAceE = c => !!c && c.supertype === 'Energy' && !!c.tags?.includes('ACE SPEC');
  const out = new Map();
  for (const inst of me.hand) {
    const c = pool.get(inst.cardId) ?? null, id = inst.iid; const acts = new Set();
    if (isBasicMon(c)) {
      const canPlayBasic = pBasic.has(id) || (isSetup && !me.active);
      const canPlayBench = (isSetup && me.bench.length < limit) || pBasic.has(id);
      if (canPlayBasic && !me.active) acts.add('active');
      if (canPlayBench && me.bench.length < limit) acts.add('bench');
    } else if (isSetup && !me.active && c && M.canBeInitialActiveCard(c)) acts.add('active');
    if (pFossil.has(id)) acts.add('fossil');
    if (isEvoMon(c) && pEvo.has(id) && evoT.filter(e => e.toIids.includes(id)).length >= 1) acts.add('evolve');
    if (pTrainer.has(id) && (isTrainer(c) || isTool(c))) acts.add('trainer');
    if (isEnergy(c) && isPlaying && isMyTurn && isMainPhase && !me.energyAttachedThisTurn && !pending
        && !(isAceE(c) && aceLocal)) acts.add('energy');
    if (isPlaying && isMyTurn && isMainPhase && !pending && c
        && M.getHandActivatableAbilities(game, myIdx, pool).some(a => a.iid === id)) acts.add('ability');
    const playable = (
      pBasic.has(id) || pEvo.has(id) || pTrainer.has(id) || pFossil.has(id) ||
      (isEnergy(c) && isPlaying && isMyTurn && isMainPhase && !me.energyAttachedThisTurn && !pending && !(isAceE(c) && aceLocal)) ||
      (isSetup && !game.setupDone[myIdx] && isBasicMon(c) && (!me.active || me.bench.length < limit)) ||
      (isSetup && !game.setupDone[myIdx] && !me.active && !!c && M.canBeInitialActiveCard(c) && !isBasicMon(c)) ||
      pAbil.has(id));
    out.set(id, { acts: [...acts].sort(), playable });
  }
  return out;
}
function newPredicate(game, myIdx, isSpectator) {
  const isMyTurn = !isSpectator && game.activePlayerIndex === myIdx;
  const ops = M.getHandCardOps(game, myIdx, pool, { isMyTurn, isMySetupTurn: !isSpectator });
  const out = new Map();
  for (const inst of game.players[myIdx].hand) {
    const o = ops.get(inst.iid) ?? new Set(); const acts = new Set();
    if (o.has('setup-active')) acts.add('active');
    // ⭐v6.321 開局重選戰鬥場（站長裁定的新入口）：獨立成一個 act，下方用 engine 實跑證明它不是死按鈕
    if (o.has('setup-active-swap')) acts.add('active-swap');
    if (o.has('basic') || o.has('basic-setup')) acts.add('bench');
    if (o.has('fossil')) acts.add('fossil');
    if (o.has('evolve')) acts.add('evolve');
    if (o.has('trainer') || o.has('tool')) acts.add('trainer');
    if (o.has('energy')) acts.add('energy');
    if (o.has('hand-ability')) acts.add('ability');
    out.set(inst.iid, { acts: [...acts].sort(), playable: o.size > 0 });
  }
  return out;
}
if (M) {
  const C = {
    basic: PLAIN,
    stage1: find(c => c.supertype === 'Pokemon' && c.stage === 'Stage1' && !!c.evolvesFrom),
    fossil: find(c => c.supertype === 'Trainer' && c.subtype === 'Item' && /化石/.test(String(c.name))),
    supporter: find(c => c.supertype === 'Trainer' && c.subtype === 'Supporter' && c.name === '博士的研究'),
    item: find(c => c.supertype === 'Trainer' && c.subtype === 'Item' && c.name === '高級球'),
    tool: TOOL, energy: WATER, aceE: ACE_ENERGY, aceI: ACE_ITEM,
    blaze: find(c => c.name === '閃焰王牌' && ab('瞬間爆發力')(c)),
    klinger: find(c => c.name === '齒輪怪' && ab('緊急迴轉')(c)),
    oppS2: find(c => c.supertype === 'Pokemon' && c.stage === 'Stage2'),
    zero: find(c => c.name === '零之大空洞'),
  };
  const base1 = C.stage1 ? find(c => c.name === pool.get(C.stage1).evolvesFrom && c.stage === 'Basic') : null;
  const HAND = [C.basic, C.stage1, base1, C.fossil, C.supporter, C.item, C.tool, C.energy, C.aceE, C.aceI, C.blaze, C.klinger].filter(Boolean);
  chk('⑥fixture 下限：手牌樣本至少 10 種（抓不到卡＝安慰劑綠燈）', HAND.length >= 10, String(HAND.length));
  chk('⑥fixture：base1（進化來源基礎卡）抓得到', !!base1, String(base1));

  let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const gen = () => {
    const setup = rnd() < 0.4, myIdx = rnd() < 0.5 ? 0 : 1, oppIdx = 1 - myIdx;
    const hand = []; for (let i = 0, k = 1 + Math.floor(rnd() * 4); i < k; i++) hand.push(mk(pick(HAND)));
    const bench = []; for (let i = 0, k = Math.floor(rnd() * 6); i < k; i++) bench.push(mk(rnd() < 0.4 && base1 ? base1 : C.basic));
    const me = { name: 'P1', active: rnd() < 0.75 ? mk(C.basic, { justPlaced: rnd() < 0.3 }) : null, bench, hand,
      deck: [mk(C.basic), mk(C.energy)], discard: [], prizes: [], abilityNamesUsedThisTurn: [],
      energyAttachedThisTurn: rnd() < 0.3, supporterPlayedThisTurn: rnd() < 0.3 };
    const op = { name: 'P2', active: rnd() < 0.25 ? mk(GENESECT, { toolAttached: mk(C.tool) }) : mk(C.basic),
      bench: rnd() < 0.3 && C.oppS2 ? [mk(C.oppS2)] : [], hand: [mk(C.basic)], deck: [mk(C.basic)], discard: [], prizes: [],
      abilityNamesUsedThisTurn: [] };
    const players = []; players[myIdx] = me; players[oppIdx] = op;
    return { st: { ...baseState(players), phase: setup ? 'setup' : 'playing',
      turnPhase: rnd() < 0.85 ? 'main' : 'end', activePlayerIndex: rnd() < 0.6 ? myIdx : oppIdx,
      turn: rnd() < 0.2 ? 1 : 5, isFirstTurn: rnd() < 0.2,
      pendingSelection: rnd() < 0.15 ? { type: 'hand-choose', actorIdx: myIdx, minCount: 1, maxCount: 1, effectKey: 'x' } : null,
      setupDone: [rnd() < 0.5, rnd() < 0.5], mulliganPostBenchOpen: [rnd() < 0.3, rnd() < 0.3],
      activeStadium: rnd() < 0.15 && C.zero ? mk(C.zero) : null },
      myIdx, isSpectator: rnd() < 0.12 };
  };
  const snap = s => JSON.stringify(s.players.map(p => [p.active?.iid ?? null, p.bench.map(b => b.iid), p.hand.map(h => h.iid)]));
  let compared = 0, mismatch = 0, deadButton = 0, spectatorOnly = 0, swapChecked = 0;
  // ⭐ 只有「黃框」不同（動作集合完全一樣）的 mismatch 也要斷言方向 ——
  //   子代理審查指出這個分支原本完全不檢查（＝一塊沒人看的死角）。
  let highlightOnly = 0, highlightGained = 0;
  const regress = [];
  for (let k = 0; k < 4000; k++) {
    const { st, myIdx, isSpectator } = gen();
    const a = oldPredicate(st, myIdx, isSpectator), b = newPredicate(st, myIdx, isSpectator);
    for (const [id, va] of a) {
      compared++;
      const vb = b.get(id) ?? { acts: [], playable: false };
      if (JSON.stringify(va) === JSON.stringify(vb)) continue;
      mismatch++;
      // 結構不變式：新版的黃框 ⟺ 有可用操作（舊版黃框是另一條獨立算式，所以會不一致）
      if (vb.playable !== (vb.acts.length > 0)) { regress.push('新版黃框與動作集合脫鉤'); continue; }
      if (JSON.stringify(va.acts) === JSON.stringify(vb.acts)) {
        highlightOnly++;
        if (!va.playable && vb.playable) highlightGained++;
        // 舊亮新不亮，只有在「新版確實沒有任何可用操作」時才合理（舊黃框是誤導）
        else if (va.playable && !vb.playable && vb.acts.length > 0) regress.push('黃框無故消失（仍有可用動作）');
        continue;
      }
      // 新版**多**出來的動作 → 一律不允許（那才是真的行為漂移）
      // ⭐v6.321 唯一允許的新增動作是 active-swap，且**每一次**都要在 engine 上實跑證明：
      //   PLACE_ACTIVE 真的換上場（新 active = 這張）、原本的戰鬥場寶可夢真的回到手牌。
      //   （白名單條目必須附行為端證明 —— 不是名字對了就放行）
      const extra = vb.acts.filter(x => !va.acts.includes(x) && x !== 'active-swap');
      if (extra.length) { regress.push(`新增動作 ${extra} @ ${st.phase}`); continue; }
      if (vb.acts.includes('active-swap') && !va.acts.includes('active-swap')) {
        swapChecked++;
        const oldActive = st.players[myIdx].active;
        const r = M.applyAction(st, { type: 'PLACE_ACTIVE', iid: id, senderIdx: myIdx }, pool);
        const okSwap = !!oldActive && st.phase === 'setup' && !st.setupDone[myIdx] && !isSpectator
          && r.players[myIdx].active?.iid === id && r.players[myIdx].hand.some(h => h.iid === oldActive.iid);
        if (!okSwap) regress.push(`active-swap 在 engine 上不成立 @ ${st.phase} setupDone=${st.setupDone[myIdx]} active=${!!oldActive} spec=${isSpectator}`);
        const rest = vb.acts.filter(x => x !== 'active-swap');
        if (JSON.stringify(rest) === JSON.stringify(va.acts)) continue;   // 其餘動作完全一致 ⇒ 不再往下比「少掉的」
      }
      // 新版**少**掉的動作 → 必須證明「舊的那顆按鈕本來就沒用」
      for (const act of va.acts.filter(x => !vb.acts.includes(x))) {
        if (isSpectator) { spectatorOnly++; continue; }   // 觀戰唯讀（v6.197 fail-closed）
        let action = null;
        if (act === 'active') action = { type: 'PLACE_ACTIVE', iid: id, senderIdx: myIdx };
        else if (act === 'bench') action = st.phase === 'setup'
          ? { type: 'BENCH_POKEMON', iid: id, senderIdx: myIdx } : { type: 'PLAY_BASIC', iid: id };
        else if (act === 'evolve') {
          const tg = M.getEvolvableTargets(st, pool).filter(e => e.toIids.includes(id))[0];
          if (tg) action = { type: 'EVOLVE', fromIid: tg.fromIid, toIid: id, actorIdx: myIdx };
        }
        if (!action) { regress.push(`無法建構 ${act}`); continue; }
        if (snap(M.applyAction(st, action, pool)) === snap(st)) deadButton++;
        else regress.push(`${act} @ ${st.phase} setupDone=${st.setupDone[myIdx]} mpb=${st.mulliganPostBenchOpen[myIdx]} active=${!!st.players[myIdx].active} pend=${!!st.pendingSelection}`);
      }
    }
  }
  chk('⑥差分實跑：比對量下限（<5000 代表產生器壞了 → 安慰劑綠燈）', compared >= 5000, String(compared));
  chk('⑥差分實跑：新述詞沒有任何**新增**的可執行動作，且所有「少掉的」都是死按鈕或觀戰唯讀',
    regress.length === 0, JSON.stringify([...new Set(regress)].slice(0, 8)));
  chk('⑥差分實跑：確實有跑到每一種 mismatch 分支（全等於 0 表示產生器沒覆蓋到 setup/觀戰）',
    mismatch > 0 && deadButton > 0 && highlightOnly > 0,
    JSON.stringify({ compared, mismatch, deadButton, spectatorOnly, highlightOnly }));
  chk('⑥v6.321 開局換戰鬥場：fuzz 真的走到 active-swap 的 engine 實跑（0 次＝產生器沒覆蓋到「setup＋已有 active」）',
    swapChecked > 0, String(swapChecked));
  chk('⑥差分實跑：只有黃框不同的那些，方向一律是「舊不亮→新亮」（新版沒有無故熄掉黃框）',
    highlightOnly > 0 && highlightGained === highlightOnly, JSON.stringify({ highlightOnly, highlightGained }));
  console.log(`  ℹ 差分實跑：比對 ${compared} 張手牌狀態 / mismatch ${mismatch}`
    + `（死按鈕 ${deadButton}、觀戰唯讀 ${spectatorOnly}、只差黃框 ${highlightOnly}）/ 行為退步 ${regress.length}`);
}

const EXPECTED_MIN_CHECKS = 49;
const total = pass + fail;
if (total < EXPECTED_MIN_CHECKS) {
  fail++;
  console.log(`  ❌ 檢查總數縮水：預期 >=${EXPECTED_MIN_CHECKS}，實際 ${total}（多半是 bundle 失敗，整段被跳過）`);
}
console.log(`\n[test-v6201-mobile-hand-ops-and-ability-gate] pass=${pass} fail=${fail}`);
if (fail > 0) process.exit(1);
