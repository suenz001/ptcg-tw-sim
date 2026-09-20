// v6.375 守衛：站長裁定 A-1（field-wide 減傷 5 張）＋ A-2 延伸（夢妖魔ex｜漩渦言靈）
//   接上 v6.373 的中央述詞 src/lib/game/as-of-declaration.ts。
//
// ⭐⭐ 病灶複驗（行為端實測，與簡報一致 —— 本版簡報的前提**成立**）：
//   真卡 三首惡龍ex｜黑曜石（對戰鬥位 130 ＋ 對手 2 隻備戰各 130），持有者在戰鬥位被
//   同一招打死之後，BASE(80bb55ab) 的備戰那一段完全讀不到它：
//     守護之鐘 備戰 130（應 120）／齒輪塗層 130（應 110）／凍原堡壘 130（應 80）／
//     垃圾洩氣 130（應 110）／捲牆 備戰的爆炸頭水牛直接被 KO（應 -60 存活於 70）。
//   真卡 超級捷拉奧拉ex｜介秒迴轉（150 ＋ 自我互換），夢妖魔ex 在戰鬥場被同一招打死之後，
//   BASE 的新上場寶可夢**不混亂**（應混亂）。
//
// ⚠⚠ 與簡報不一致之處：無。五張減傷 ＋ 漩渦言靈，六個病灶全部行為端複驗成立。
//
// ⭐ 本版**沒有動 engine.ts 一個字**。理由（資料驅動，見【D】）：
//   engine.ts 的 applyDefenderReductionsBlockA 只處理**戰鬥位**那一份傷害，而戰鬥位那一份
//   永遠排在備戰之前（實測 W1：急凍鳥｜冰雹 的 active 20 點先於備戰結算）。要讓它讀到
//   「宣告當時有效、現在已離場」的持有者，必須有招式在**造成傷害前**把對手的寶可夢本體
//   移出場 —— 全卡池 H/I/J 掃描：「在造成傷害前」共 11 條，**全部**只丟棄「身上附加的」
//   道具／特殊能量；唯一把對手寶可夢移出場的 仙子伊布ex｜天仙石 damage 是空字串（0 傷害）。
//   ⇒ 今天無可觸發情境，硬接只會得到恆真斷言（安慰劑 #27）。改用可翻紅的不可觸發性斷言釘住。
//
// 斷言分層：
//   【0】fixture 自驗（卡面逐字，一律取自 abilities[].effect／attacks[].effect）
//   【A】⭐⭐⭐(甲) 五張減傷：持有者被同一招 KO ⇒ 仍然減；各自的條件反對照；不重複
//   【B】⭐⭐(乙) 漩渦言靈：戰鬥場持有者被同一招 KO ⇒ 新上場仍【混亂】；在備戰 ⇒ 不混亂
//   【C】⭐ 主動移除（回手／洗回牌庫）與特性被消除 ⇒ 一律不生效
//   【D】⭐ engine.ts 零改動 ＋ 戰鬥位路徑的不可觸發性（資料驅動，卡池一變就紅）
//   【E】⭐ 中央性（名單／單一判準／沒有人自寫 state._attackTime…）
//   【F】HEAD-FAIL 對 BASE(80bb55ab ＝ v6.374)，hasBaseCommit 保護、淺複製 shallowSkip
//
// ⛔ 本守衛不寫任何東西進 src/；合成盤面只在記憶體裡。
import { stripV6394Engine } from './lib/engine-strip-v6394.mjs';
import { stripV6398Engine } from './lib/engine-strip-v6398.mjs';
import { stripV6400Engine } from './lib/engine-strip-v6400.mjs';
import { stripV6402Engine } from './lib/engine-strip-v6402.mjs';
import { stripV6403Engine } from './lib/engine-strip-v6403.mjs';   // ⭐v6.403 ex 判準收斂（12 組）
import { stripV6408Engine } from './lib/engine-strip-v6408.mjs';   // ⭐v6.408 攻擊方加成收斂成一份（2 組）
import { stripV6413Engine } from './lib/engine-strip-v6413.mjs';   // ⭐v6.413 招致削傷本次攻擊快照重置（1 組）
import { stripV6410Engine } from './lib/engine-strip-v6410.mjs';   // ⭐v6.410 祭典樂舞判準收斂成一份（3 組）
import { stripV6407Engine } from './lib/engine-strip-v6407.mjs';   // ⭐v6.407 自身能量付出延後（3 組）
import { stripV6401Engine } from './lib/engine-strip-v6401.mjs';
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, cpSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, readBaseBlob, restoreBaseSubtree, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '80bb55ab34957b4b44af969137352c9299b9369e';   // v6.374（本版的上一版）

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => {
  if (ok) { console.log('  PASS ' + name); pass++; }
  else { console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); fail++; }
  return !!ok;
};

// ── 卡池 ──────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) { if (c?.id == null) continue; pool.set(String(c.id), c); all.push(c); }
}
const byId = (id) => pool.get(String(id));
const HIJ = (c) => ['H', 'I', 'J'].includes(c?.regulationMark);
const NONRULE = (c) => c.subtype !== 'ex' && !/(ex|EX|V|VMAX|VSTAR)$/.test(String(c.name));
const count = (t, s) => t.split(s).length - 1;

// ── 真卡 fixture（全部 H/I/J）─────────────────────────────────────────────────
const BRONZ = byId('12152');   // 青銅鐘        SVM 標H HP130 1階【鋼】｜守護之鐘 -10
const FROST = byId('18000');   // 冰雪巨龍      M3  標J HP170 2階【水】｜凍原堡壘 -50（不重複）
const GEAR  = byId('16979');   // 齒輪怪        MC  標I HP150 2階【鋼】｜齒輪塗層 -20
const BUF   = byId('14800');   // 爆炸頭水牛    M2a 標H HP100 基礎【無】｜捲牆 -60（不重複）
const BUF8  = byId('11267');   // 爆炸頭水牛SV8 標H HP130 基礎【無】｜**沒有捲牆特性**（算隻數）
const DUST  = byId('18475');   // 灰塵山        M4  標J HP140 1階【惡】｜垃圾洩氣 -20
const MUMA  = byId('14354');   // 夢妖魔ex      M2  標I HP260 1階【超】｜漩渦言靈（戰鬥場 only）
const HYD   = byId('11252');   // 三首惡龍ex    標H｜黑曜石 130 ＋ 對手 2 隻備戰各 130
const ZER   = byId('19170');   // 超級捷拉奧拉ex 標J｜介秒迴轉 150 ＋ 自我互換
const CAVE  = byId('19623');   // 傳說的熔岩洞（雙方場上所有**進化**寶可夢特性全部消除）
const TOWER = all.find(c => c.name === '火箭隊的監視塔' && c.supertype === 'Trainer');
const HYD_I = HYD ? HYD.attacks.findIndex(a => a.name === '黑曜石') : -1;
const ZER_I = ZER ? ZER.attacks.findIndex(a => a.name === '介秒迴轉') : -1;

const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼', Dragon: '龍' };
const EID = {};
for (const c of all) { if (c.supertype !== 'Energy') continue; for (const [k, z] of Object.entries(ZH)) if (c.name === '基本【' + z + '】能量' && !EID[k]) EID[k] = String(c.id); }
EID.Colorless = EID.Water;

/** 中性靶：H/I/J、基礎、無特性、無 tags、非規則、HP>=150、不吃【惡】弱點（黑曜石是惡）。 */
const NEU = all.find(c => c.supertype === 'Pokemon' && HIJ(c) && !(c.abilities || []).length && !(c.tags || []).length
  && NONRULE(c) && (c.stage ?? c.subtype) === 'Basic' && Number(c.hp) >= 150
  && c.weakness?.type !== 'Darkness' && c.weakness?.type !== 'Lightning');
/** 捲牆的受惠者：【無】屬性【基礎】中性靶，HP 要能撐住未減傷的 130。 */
const NEUC = all.find(c => c.supertype === 'Pokemon' && HIJ(c) && !(c.abilities || []).length && !(c.tags || []).length
  && NONRULE(c) && (c.stage ?? c.subtype) === 'Basic' && c.pokemonType === 'Colorless'
  && Number(c.hp) >= 140 && c.weakness?.type !== 'Darkness');
/** 攻擊方備戰用（介秒迴轉換上場後要能被【混亂】）。 */
const NEUB = all.find(c => c.supertype === 'Pokemon' && HIJ(c) && !(c.abilities || []).length && !(c.tags || []).length
  && NONRULE(c) && (c.stage ?? c.subtype) === 'Basic' && Number(c.hp) >= 100 && c.name !== NEU?.name);
/** 寶可夢道具（垃圾洩氣的觸發條件）。 */
const TOOL = all.find(c => c.supertype === 'Trainer' && c.subtype === 'PokemonTool' && HIJ(c));

console.log('\n【0】fixture 自驗（Rule 25：抽不到卡／卡面對不上要大聲紅，不可以靜默全綠）');
chk('0a ⭐青銅鐘（SVM id 12152，標 H，HP130，1階）｜守護之鐘 卡面逐字',
  BRONZ?.name === '青銅鐘' && BRONZ?.regulationMark === 'H' && Number(BRONZ?.hp) === 130
  && (BRONZ?.stage ?? BRONZ?.subtype) === 'Stage1'
  && BRONZ?.abilities?.[0]?.name === '守護之鐘'
  && BRONZ?.abilities?.[0]?.effect === '只要這隻寶可夢在場上，自己的所有寶可夢受到對手的寶可夢招式的傷害「-10」點。',
  JSON.stringify({ n: BRONZ?.name, m: BRONZ?.regulationMark, e: BRONZ?.abilities?.[0]?.effect }));
chk('0b ⭐冰雪巨龍（M3 id 18000，標 J，HP170，2階）｜凍原堡壘 卡面逐字（明文「效果不會重複」）',
  FROST?.name === '冰雪巨龍' && FROST?.regulationMark === 'J' && Number(FROST?.hp) === 170
  && (FROST?.stage ?? FROST?.subtype) === 'Stage2'
  && FROST?.abilities?.[0]?.name === '凍原堡壘'
  && FROST?.abilities?.[0]?.effect === '只要這隻寶可夢在場上，自己的所有身上附有【水】能量卡的寶可夢，受到對手的寶可夢招式的傷害「-50」點。這個特性的效果不會重複。',
  JSON.stringify({ n: FROST?.name, e: FROST?.abilities?.[0]?.effect }));
chk('0c ⭐齒輪怪（MC id 16979，標 I，HP150，2階）｜齒輪塗層 卡面逐字',
  GEAR?.name === '齒輪怪' && GEAR?.regulationMark === 'I' && Number(GEAR?.hp) === 150
  && (GEAR?.stage ?? GEAR?.subtype) === 'Stage2'
  && GEAR?.abilities?.[0]?.name === '齒輪塗層'
  && GEAR?.abilities?.[0]?.effect === '只要這隻寶可夢在場上，自己的所有身上附有【鋼】能量卡的寶可夢，受到對手的寶可夢招式的傷害「-20」點。',
  JSON.stringify({ n: GEAR?.name, e: GEAR?.abilities?.[0]?.effect }));
chk('0d ⭐⭐爆炸頭水牛（M2a id 14800，標 H，HP100，基礎【無】）｜捲牆 卡面逐字；'
  + '且 SV8 id 11267（標 H，HP130，基礎【無】）**沒有捲牆特性**卻同名 ⇒ 算隻數（v5.614 玩家回報）',
  BUF?.name === '爆炸頭水牛' && BUF?.regulationMark === 'H' && Number(BUF?.hp) === 100
  && BUF?.pokemonType === 'Colorless' && (BUF?.stage ?? BUF?.subtype) === 'Basic'
  && BUF?.abilities?.[0]?.name === '捲牆'
  && BUF?.abilities?.[0]?.effect === '只要這隻寶可夢與自己的其他「爆炸頭水牛」在場上，自己的所有【無】屬性的【基礎】寶可夢受到對手的寶可夢招式的傷害「-60」點。無論有多少隻擁有這個特性的寶可夢，這個效果也不會重複。'
  && BUF8?.name === '爆炸頭水牛' && Number(BUF8?.hp) === 130 && BUF8?.pokemonType === 'Colorless'
  && (BUF8?.abilities ?? []).length === 0,
  JSON.stringify({ e: BUF?.abilities?.[0]?.effect, sv8hp: BUF8?.hp, sv8ab: (BUF8?.abilities ?? []).map(a => a.name) }));
chk('0e ⭐灰塵山（M4 id 18475，標 J，HP140，1階）｜垃圾洩氣 卡面逐字（判的是**攻擊方**有沒有道具）',
  DUST?.name === '灰塵山' && DUST?.regulationMark === 'J' && Number(DUST?.hp) === 140
  && (DUST?.stage ?? DUST?.subtype) === 'Stage1'
  && DUST?.abilities?.[0]?.name === '垃圾洩氣'
  && DUST?.abilities?.[0]?.effect === '只要這隻寶可夢在場上，對手身上附有「寶可夢道具」卡的戰鬥寶可夢使用的招式的傷害「-20」點。',
  JSON.stringify({ n: DUST?.name, e: DUST?.abilities?.[0]?.effect }));
chk('0f ⭐⭐夢妖魔ex（M2 id 14354，標 I，HP260，1階）｜漩渦言靈 卡面逐字 —— 條件是「在**戰鬥場**上」'
  + '（不是「在場上」）；另一印刷 id 18582 逐字相同',
  MUMA?.name === '夢妖魔ex' && MUMA?.regulationMark === 'I' && Number(MUMA?.hp) === 260
  && MUMA?.abilities?.[0]?.name === '漩渦言靈'
  && MUMA?.abilities?.[0]?.effect === '只要這隻寶可夢在戰鬥場上，在對手的回合，每次對手的戰鬥寶可夢回到備戰區時，將新上場的寶可夢【混亂】。'
  && byId('18582')?.abilities?.[0]?.effect === MUMA?.abilities?.[0]?.effect,
  JSON.stringify({ n: MUMA?.name, e: MUMA?.abilities?.[0]?.effect }));
chk('0g ⭐攻擊手卡面逐字：三首惡龍ex｜黑曜石（130 ＋ 對手 2 隻備戰各 130）／'
  + '超級捷拉奧拉ex｜介秒迴轉（150 ＋ 自我互換）',
  HYD_I >= 0 && String(HYD.attacks[HYD_I].damage) === '130'
  && HYD.attacks[HYD_I].effect === '對手的2隻備戰寶可夢也各受到130點傷害。[在備戰區不計算弱點・抵抗力。]'
  && ZER_I >= 0 && String(ZER.attacks[ZER_I].damage) === '150'
  && ZER.attacks[ZER_I].effect === '將這隻寶可夢與備戰寶可夢互換。',
  JSON.stringify({ h: HYD?.attacks?.[HYD_I]?.effect, z: ZER?.attacks?.[ZER_I]?.effect }));
chk('0h 抓得到中性靶／【無】基礎靶／攻擊方備戰／寶可夢道具／兩張特性消除競技場卡',
  !!NEU && !!NEUC && !!NEUB && !!TOOL && !!CAVE && !!TOWER,
  JSON.stringify({ neu: NEU?.name, neuc: NEUC?.name + '/' + NEUC?.hp, neub: NEUB?.name, tool: TOOL?.name, cave: CAVE?.name, tower: TOWER?.name }));
if (!BRONZ || !FROST || !GEAR || !BUF || !BUF8 || !DUST || !MUMA || !HYD || !ZER || !CAVE || !TOWER
  || HYD_I < 0 || ZER_I < 0 || !NEU || !NEUC || !NEUB || !TOOL) {
  console.log('\n❌ fixture 不齊，無法繼續'); process.exit(1);
}

// ── harness ──────────────────────────────────────────────────────────────────
const TMP = mkdtempSync(join(tmpdir(), 'v6375-'));
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* noop */ } });
const STRAY = [];
process.on('exit', () => { for (const p of STRAY) { try { unlinkSync(p); } catch { /* noop */ } } });

/** ⚠ entry 要寫在 srcDir 的父目錄、用相對路徑 import（Windows 的 E:/… 會被 esbuild 當成套件名）。 */
async function bundleFrom(srcDir, tag) {
  const parent = dirname(srcDir);
  const name = srcDir.slice(parent.length + 1).replace(/\\/g, '/');
  const p = './' + name;
  const S = join(parent, '.v6375-s-' + tag + '.js'), E = join(parent, '.v6375-e-' + tag + '.ts'), O = join(parent, '.v6375-o-' + tag + '.mjs');
  STRAY.push(S, E, O);
  writeFileSync(S, 'export const base="";export const assets="";');
  writeFileSync(E,
    "export { applyAction } from '" + p + "/lib/game/engine';\n"
    + "import '" + p + "/lib/game/effects';\n");
  await build({
    entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(srcDir, 'lib'), '$app/paths': S }, logLevel: 'silent',
  });
  return import(pathToFileURL(O).href);
}

let seq = 0;
const inst = (id, extra = {}) => ({
  cardId: String(id), iid: 'i' + (++seq), damage: 0, energyAttached: [], toolAttached: null,
  abilityUsedThisTurn: false, evolvedThisTurn: false, playedFromHand: false, movedToActiveThisTurn: false,
  evolvedFromStack: [], ...extra,
});
const P = (o = {}) => ({ name: 'P', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [], ...o });
const mk = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true], pendingMulliganDraw: [0, 0],
  pendingPrizes: [0, 0], coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
  activeStadium: null, activeStadiumOwnerIdx: 0, players: [P(p0), P(p1)], ...extra,
});
const heads = (fn) => { const o = Math.random; Math.random = () => 0.1; try { return fn(); } finally { Math.random = o; } };
const run = (MOD, st, a) => heads(() => {
  try { return MOD.applyAction(st, a, pool); }
  catch (e) { return { __err: String(e && e.message ? e.message : e), players: st.players, log: [] }; }
});
const eCost = (c, n) => ((c.attacks || []).find(a => a.name === n)?.cost ?? []).map(t => inst(EID[t] ?? EID.Water));
const filler = (n, id) => Array.from({ length: n }, () => inst(id));
const eMetal = () => inst(EID.Metal);
const eWater = () => inst(EID.Water);

/**
 * ⭐ 減傷情境：三首惡龍ex｜黑曜石。戰鬥位 130（持有者放這裡就會被同一招打死），
 *   接著 pendingSelection(opp-bench-choose) 選 2 隻備戰各 130 —— 那一段就是病灶所在。
 * @param opts.defActive 防守方戰鬥位 inst
 * @param opts.defBench  防守方備戰（前 2 隻會被選中）
 * @param opts.atkTool   攻擊方要不要附寶可夢道具（垃圾洩氣用）
 * @param opts.stadium   競技場卡 id（特性消除反對照用）
 * @param opts.move      'hand' | 'deck' —— 在備戰那一段結算**之前**，把已昏厥的持有者
 *                        從棄牌區改搬到手牌／牌庫（＝模擬「被主動移出場」）
 * @param opts.moveCardId 要搬的 cardId
 * @returns { benchDmg: number[], activeDmg, koCards: string[], err }
 */
function dmgCase(MOD, opts) {
  const atk = inst(HYD.id, {
    energyAttached: eCost(HYD, '黑曜石'),
    ...(opts.atkTool ? { toolAttached: inst(opts.atkTool) } : {}),
  });
  const st = mk(
    { active: atk, bench: [inst(NEU.id)], deck: filler(3, NEU.id), prizes: filler(6, NEU.id) },
    { active: opts.defActive, bench: opts.defBench, deck: filler(3, NEU.id), prizes: filler(6, NEU.id) },
    opts.stadium ? { activeStadium: inst(opts.stadium), activeStadiumOwnerIdx: 1 } : {});
  let r = run(MOD, st, { type: 'ATTACK', attackIndex: HYD_I });
  if (r?.__err) return { benchDmg: [], activeDmg: -999, koCards: [], err: r.__err };
  // 「被主動移除」：把昏厥進棄牌區的持有者改搬到手牌／牌庫（純 harness 操作，不碰 src）
  if (opts.move) {
    const dp = { ...r.players[1] };
    const i = dp.discard.findIndex(c => String(c.cardId) === String(opts.moveCardId));
    if (i >= 0) {
      const moved = dp.discard[i];
      dp.discard = dp.discard.filter((_, k) => k !== i);
      if (opts.move === 'hand') dp.hand = [...dp.hand, moved]; else dp.deck = [...dp.deck, moved];
      const players = [...r.players]; players[1] = dp;
      r = { ...r, players };
    }
  }
  if (r?.pendingSelection?.type === 'opp-bench-choose') {
    const ps = r.pendingSelection;
    const ids = (r.players[1].bench || []).slice(0, ps.maxCount).map(b => b.iid);
    r = run(MOD, r, { type: 'RESOLVE_SELECTION', selectedIids: ids, senderIdx: ps.actorIdx ?? 0, pendingToken: ps.token });
  } else {
    return { benchDmg: [], activeDmg: -998, koCards: [], err: 'no-pending' };
  }
  if (r?.__err) return { benchDmg: [], activeDmg: -997, koCards: [], err: r.__err };
  return {
    benchDmg: (r.players?.[1]?.bench ?? []).map(b => b.damage),
    activeDmg: r.players?.[1]?.active ? r.players[1].active.damage : -1,   // -1 ＝ 戰鬥位已昏厥
    koCards: (r.players?.[1]?.discard ?? []).map(d => String(d.cardId)).sort(),
    err: '',
  };
}
/** 取「第一隻受惠備戰」的傷害（每個情境都刻意把受惠者排在 bench[0]）。 */
const b0 = (x) => (x.benchDmg.length > 0 ? x.benchDmg[0] : (x.err ? -996 : -995));

/**
 * ⭐ 漩渦言靈情境：超級捷拉奧拉ex｜介秒迴轉（150 ＋ 自我互換）。
 *   持有者放在**防守方戰鬥位**（＝卡面的「這隻寶可夢在戰鬥場上」），攻擊方打完自我互換
 *   ⇒ applyActionImpl 尾段的中央偵測觸發 applyOppActiveReturnedToBenchTriggers。
 */
function confuseCase(MOD, opts) {
  const st = mk(
    { active: inst(ZER.id, { energyAttached: eCost(ZER, '介秒迴轉') }), bench: [inst(NEUB.id)],
      deck: filler(3, NEU.id), prizes: filler(6, NEU.id) },
    { active: opts.defActive, bench: opts.defBench ?? [inst(NEU.id)], deck: filler(3, NEU.id), prizes: filler(6, NEU.id) },
    opts.stadium ? { activeStadium: inst(opts.stadium), activeStadiumOwnerIdx: 1 } : {});
  let r = run(MOD, st, { type: 'ATTACK', attackIndex: ZER_I });
  if (r?.__err) return { confused: -999, err: r.__err };
  if (opts.move) {
    const dp = { ...r.players[1] };
    const i = dp.discard.findIndex(c => String(c.cardId) === String(MUMA.id));
    if (i >= 0) {
      const moved = dp.discard[i];
      dp.discard = dp.discard.filter((_, k) => k !== i);
      if (opts.move === 'hand') dp.hand = [...dp.hand, moved]; else dp.deck = [...dp.deck, moved];
      const players = [...r.players]; players[1] = dp;
      r = { ...r, players };
    }
  }
  if (r?.pendingSelection?.type !== 'bench-choose') return { confused: -998, err: 'no-pending:' + (r?.pendingSelection?.type ?? 'null') };
  const ps = r.pendingSelection;
  const ids = (r.players[0].bench || []).slice(0, Math.max(1, ps.minCount ?? 1)).map(b => b.iid);
  r = run(MOD, r, { type: 'RESOLVE_SELECTION', selectedIids: ids, senderIdx: ps.actorIdx ?? 0, pendingToken: ps.token });
  if (r?.__err) return { confused: -997, err: r.__err };
  return { confused: r.players?.[0]?.active?.status === 'confused' ? 1 : 0, err: '' };
}

/** 非 ATTACK 路徑（撤退）—— 沒有 _attackTimeHolders，行為必須與 BASE 逐字相同。 */
function retreatCase(MOD, holderPresent) {
  const bIid = 'RB1';
  const st = mk(
    { active: inst(NEUB.id, { energyAttached: filler(4, EID.Colorless) }),
      bench: [inst(NEU.id, { iid: bIid })], deck: filler(3, NEU.id), prizes: filler(6, NEU.id) },
    { active: holderPresent ? inst(MUMA.id) : inst(NEU.id), bench: [inst(NEU.id)],
      deck: filler(3, NEU.id), prizes: filler(6, NEU.id) });
  const r = run(MOD, st, { type: 'RETREAT', newActiveIid: bIid });
  if (r?.__err) return -999;
  return r.players?.[0]?.active?.status === 'confused' ? 1 : 0;
}

// ── 行為矩陣（HEAD 與 BASE 共用同一份情境，F 段逐項對拍）────────────────────
function matrix(MOD) {
  const m = {};
  const D = (k, o) => { m[k] = b0(dmgCase(MOD, o)); };
  const withM = () => inst(NEU.id, { energyAttached: [eMetal()] });
  const withW = () => inst(NEU.id, { energyAttached: [eWater()] });
  // ── 守護之鐘（-10，卡面未寫不重複 ⇒ 按隻數疊加，v5.193）──
  D('bz_ko',        { defActive: inst(BRONZ.id, { damage: 20 }), defBench: [inst(NEU.id), inst(NEU.id)] });
  D('bz_stay',      { defActive: inst(NEU.id), defBench: [inst(NEU.id), inst(BRONZ.id)] });
  D('bz_none',      { defActive: inst(NEU.id), defBench: [inst(NEU.id), inst(NEU.id)] });
  D('bz_hand',      { defActive: inst(BRONZ.id, { damage: 20 }), defBench: [inst(NEU.id), inst(NEU.id)], move: 'hand', moveCardId: BRONZ.id });
  D('bz_deck',      { defActive: inst(BRONZ.id, { damage: 20 }), defBench: [inst(NEU.id), inst(NEU.id)], move: 'deck', moveCardId: BRONZ.id });
  D('bz_cave',      { defActive: inst(BRONZ.id, { damage: 20 }), defBench: [inst(NEU.id), inst(NEU.id)], stadium: CAVE.id });
  D('bz_cave_stay', { defActive: inst(NEU.id), defBench: [inst(NEU.id), inst(BRONZ.id)], stadium: CAVE.id });
  D('bz_dup_ko',    { defActive: inst(BRONZ.id, { damage: 20 }), defBench: [inst(NEU.id), inst(BRONZ.id)] });
  // ── 齒輪塗層（-20，受惠者要附【鋼】能量；按隻數疊加）──
  D('gc_ko',        { defActive: inst(GEAR.id, { damage: 20 }), defBench: [withM(), withM()] });
  D('gc_stay',      { defActive: inst(NEU.id), defBench: [withM(), inst(GEAR.id)] });
  D('gc_nometal',   { defActive: inst(GEAR.id, { damage: 20 }), defBench: [inst(NEU.id), inst(NEU.id)] });
  D('gc_hand',      { defActive: inst(GEAR.id, { damage: 20 }), defBench: [withM(), withM()], move: 'hand', moveCardId: GEAR.id });
  D('gc_cave',      { defActive: inst(GEAR.id, { damage: 20 }), defBench: [withM(), withM()], stadium: CAVE.id });
  D('gc_dup_ko',    { defActive: inst(GEAR.id, { damage: 20 }), defBench: [withM(), inst(GEAR.id)] });
  // ── 凍原堡壘（-50，受惠者要附【水】能量；卡面明文**不重複**）──
  D('fz_ko',        { defActive: inst(FROST.id, { damage: 40 }), defBench: [withW(), withW()] });
  D('fz_stay',      { defActive: inst(NEU.id), defBench: [withW(), inst(FROST.id)] });
  D('fz_nowater',   { defActive: inst(FROST.id, { damage: 40 }), defBench: [inst(NEU.id), inst(NEU.id)] });
  D('fz_hand',      { defActive: inst(FROST.id, { damage: 40 }), defBench: [withW(), withW()], move: 'hand', moveCardId: FROST.id });
  D('fz_cave',      { defActive: inst(FROST.id, { damage: 40 }), defBench: [withW(), withW()], stadium: CAVE.id });
  D('fz_dup_ko',    { defActive: inst(FROST.id, { damage: 40 }), defBench: [withW(), inst(FROST.id)] });
  // ── 捲牆（-60，需場上 ≥2 隻「爆炸頭水牛」＋ 受惠者是【無】基礎；卡面明文**不重複**）──
  D('cw_ko',        { defActive: inst(BUF.id, { damage: 30 }), defBench: [inst(NEUC.id), inst(BUF.id)] });
  D('cw_two_stay',  { defActive: inst(BUF.id), defBench: [inst(NEUC.id), inst(BUF.id)] });
  D('cw_one',       { defActive: inst(NEU.id), defBench: [inst(NEUC.id), inst(BUF.id)] });
  D('cw_sv8_ko',    { defActive: inst(BUF8.id, { damage: 60 }), defBench: [inst(NEUC.id), inst(BUF.id)] });
  // ⭐⭐唐邊：場上唯一「有捲牆特性」的那隻被同招打死，剩下的 SV8 只算隻數、**沒有特性**
  //   ⇒ 卡名計數靠 COUNTED_CARD_NAMES 快照、特性持有者靠 AS_OF_DECLARATION_ABILITIES 快照，**兩半都要在**才減得成。
  D('cw_onlywall_ko', { defActive: inst(BUF.id, { damage: 30 }), defBench: [inst(NEUC.id), inst(BUF8.id)] });
  D('cw_none',      { defActive: inst(NEU.id), defBench: [inst(NEUC.id), inst(NEU.id)] });
  D('cw_hand',      { defActive: inst(BUF.id, { damage: 30 }), defBench: [inst(NEUC.id), inst(BUF.id)], move: 'hand', moveCardId: BUF.id });
  D('cw_deck',      { defActive: inst(BUF.id, { damage: 30 }), defBench: [inst(NEUC.id), inst(BUF.id)], move: 'deck', moveCardId: BUF.id });
  D('cw_tower',     { defActive: inst(BUF.id, { damage: 30 }), defBench: [inst(NEUC.id), inst(BUF.id)], stadium: TOWER.id });
  D('cw_dup_ko',    { defActive: inst(BUF.id, { damage: 30 }), defBench: [inst(NEUC.id), inst(BUF.id), inst(BUF.id)] });
  // ── 垃圾洩氣（-20，判的是**攻擊方**身上有沒有寶可夢道具；不重複）──
  D('gb_ko',        { defActive: inst(DUST.id, { damage: 30 }), defBench: [inst(NEU.id), inst(NEU.id)], atkTool: TOOL.id });
  D('gb_stay',      { defActive: inst(NEU.id), defBench: [inst(NEU.id), inst(DUST.id)], atkTool: TOOL.id });
  D('gb_notool',    { defActive: inst(DUST.id, { damage: 30 }), defBench: [inst(NEU.id), inst(NEU.id)] });
  D('gb_hand',      { defActive: inst(DUST.id, { damage: 30 }), defBench: [inst(NEU.id), inst(NEU.id)], atkTool: TOOL.id, move: 'hand', moveCardId: DUST.id });
  D('gb_cave',      { defActive: inst(DUST.id, { damage: 30 }), defBench: [inst(NEU.id), inst(NEU.id)], atkTool: TOOL.id, stadium: CAVE.id });
  D('gb_dup_ko',    { defActive: inst(DUST.id, { damage: 30 }), defBench: [inst(NEU.id), inst(DUST.id)], atkTool: TOOL.id });
  // ── (乙) 漩渦言靈（戰鬥場 only）──
  const C = (k, o) => { m[k] = confuseCase(MOD, o).confused; };
  C('mm_ko',        { defActive: inst(MUMA.id, { damage: 110 }) });
  C('mm_stay',      { defActive: inst(MUMA.id) });
  C('mm_bench',     { defActive: inst(NEU.id), defBench: [inst(MUMA.id)] });
  C('mm_none',      { defActive: inst(NEU.id) });
  C('mm_hand',      { defActive: inst(MUMA.id, { damage: 110 }), move: 'hand' });
  C('mm_deck',      { defActive: inst(MUMA.id, { damage: 110 }), move: 'deck' });
  C('mm_cave',      { defActive: inst(MUMA.id, { damage: 110 }), stadium: CAVE.id });
  C('mm_cave_stay', { defActive: inst(MUMA.id), stadium: CAVE.id });
  // ── 非 ATTACK 路徑 ──
  m.rt_muma = retreatCase(MOD, true);
  m.rt_none = retreatCase(MOD, false);
  return m;
}

const HEAD = await bundleFrom(join(ROOT, 'src'), 'head');
const H = matrix(HEAD);

console.log('\n【A】⭐⭐⭐(甲) 五張 field-wide 減傷：持有者在戰鬥位被**同一招**打死 ⇒ 備戰那一段仍然要減');
chk('A0 哨兵：矩陣真的跑起來了（沒有情境回到 -99x 的錯誤碼）',
  Object.entries(H).every(([, v]) => v > -900), JSON.stringify(Object.entries(H).filter(([, v]) => v <= -900)));
chk('A1 ⭐⭐⭐守護之鐘：青銅鐘在戰鬥位被同招打死 ⇒ 備戰仍 -10（130 → 120）',
  H.bz_ko === 120, 'got=' + H.bz_ko);
chk('A2 ⭐⭐⭐齒輪塗層：齒輪怪在戰鬥位被同招打死 ⇒ 附【鋼】能量的備戰仍 -20（130 → 110）',
  H.gc_ko === 110, 'got=' + H.gc_ko);
chk('A3 ⭐⭐⭐凍原堡壘：冰雪巨龍在戰鬥位被同招打死 ⇒ 附【水】能量的備戰仍 -50（130 → 80）',
  H.fz_ko === 80, 'got=' + H.fz_ko);
chk('A4 ⭐⭐⭐捲牆：一隻爆炸頭水牛在戰鬥位被同招打死（場上剩 1 隻）⇒ 備戰【無】基礎仍 -60（130 → 70）',
  H.cw_ko === 70, 'got=' + H.cw_ko);
chk('A5 ⭐⭐⭐垃圾洩氣：灰塵山在戰鬥位被同招打死 ⇒ 攻擊方附道具時備戰仍 -20（130 → 110）',
  H.gb_ko === 110, 'got=' + H.gb_ko);
chk('A6 ⭐⭐捲牆的 SV8 例外：**沒有捲牆特性**的爆炸頭水牛(11267)在戰鬥位被同招打死 ⇒ '
  + '宣告當時仍是 2 隻 ⇒ 備戰仍 -60（130 → 70）。⚠ 這一條只有「依卡名」的快照才守得住',
  H.cw_sv8_ko === 70, 'got=' + H.cw_sv8_ko);
chk('A6b ⭐⭐捲牆的另一半：場上**唯一帶捲牆特性**的爆炸頭水牛在戰鬥位被同招打死（剩下的 SV8 只算隻數）'
  + ' ⇒ 備戰【無】基礎仍 -60（130 → 70）。⚠ 這一條只有「特性持有者快照」守得住',
  H.cw_onlywall_ko === 70, 'got=' + H.cw_onlywall_ko);
chk('A7 ⭐正對照：持有者留在備戰（活著）⇒ 五張逐條與卡面一致（-10／-20／-50／-60／-20）',
  H.bz_stay === 120 && H.gc_stay === 110 && H.fz_stay === 80 && H.cw_two_stay === 70 && H.gb_stay === 110,
  JSON.stringify([H.bz_stay, H.gc_stay, H.fz_stay, H.cw_two_stay, H.gb_stay]));
chk('A8 ⭐反對照：場上根本沒有持有者 ⇒ 一點都不減（130）',
  H.bz_none === 130 && H.cw_none === 130, JSON.stringify([H.bz_none, H.cw_none]));

console.log('\n【A-cond】⭐各自的**持有者／受惠者條件**反對照（判準各不相同，不可以互相套用）');
chk('A9 ⭐齒輪塗層：受惠者**沒附【鋼】能量** ⇒ 不減（130）', H.gc_nometal === 130, 'got=' + H.gc_nometal);
chk('A10 ⭐凍原堡壘：受惠者**沒附【水】能量** ⇒ 不減（130）', H.fz_nowater === 130, 'got=' + H.fz_nowater);
chk('A11 ⭐捲牆：場上只有**一隻**爆炸頭水牛 ⇒ 不減（130）', H.cw_one === 130, 'got=' + H.cw_one);
chk('A12 ⭐垃圾洩氣：**攻擊方沒有寶可夢道具** ⇒ 不減（130）', H.gb_notool === 130, 'got=' + H.gb_notool);

console.log('\n【A-dup】⭐「效果不會重複」vs「按隻數疊加」—— 兩種語意都要在收緊之後仍然正確');
chk('A13 ⭐⭐凍原堡壘卡面明文「這個特性的效果不會重複」：兩隻（一隻被同招打死）⇒ 仍然只 -50（80）',
  H.fz_dup_ko === 80, 'got=' + H.fz_dup_ko);
chk('A14 ⭐⭐捲牆卡面明文「無論有多少隻…也不會重複」：三隻（一隻被同招打死）⇒ 仍然只 -60（70）',
  H.cw_dup_ko === 70, 'got=' + H.cw_dup_ko);
chk('A15 ⭐⭐垃圾洩氣（v2.217 起就用 has 而非 count）：兩隻（一隻被同招打死）⇒ 仍然只 -20（110）',
  H.gb_dup_ko === 110, 'got=' + H.gb_dup_ko);
chk('A16 ⭐⭐守護之鐘卡面**未寫**不重複（v5.193 按隻數疊加）：兩隻（一隻被同招打死）⇒ -20（110）',
  H.bz_dup_ko === 110, 'got=' + H.bz_dup_ko);
chk('A17 ⭐⭐齒輪塗層卡面**未寫**不重複（v5.193 按隻數疊加）：兩隻（一隻被同招打死）⇒ -40（90）',
  H.gc_dup_ko === 90, 'got=' + H.gc_dup_ko);

console.log('\n【B】⭐⭐(乙) 夢妖魔ex｜漩渦言靈 —— 條件是「在**戰鬥場**上」，不是「在場上」');
chk('B1 ⭐⭐⭐持有者在戰鬥場被同一招打死 ⇒ 新上場的寶可夢仍然【混亂】',
  H.mm_ko === 1, 'got=' + H.mm_ko);
chk('B2 ⭐正對照：持有者活著在戰鬥場 ⇒ 混亂', H.mm_stay === 1, 'got=' + H.mm_stay);
chk('B3 ⭐⭐反對照：宣告當時就**在備戰**（不在戰鬥場）⇒ **不**混亂'
  + '（⚠ 這一條擋住「快照連備戰持有者也收」的錯誤實作）', H.mm_bench === 0, 'got=' + H.mm_bench);
chk('B4 ⭐反對照：場上沒有夢妖魔ex ⇒ 不混亂', H.mm_none === 0, 'got=' + H.mm_none);

console.log('\n【C】⭐「被主動移除」與「特性被消除」—— 一律**不**生效（v6.373 判準，本版不得放寬）');
chk('C1 ⭐持有者被放回**手牌** ⇒ 五張全部不減（130）',
  H.bz_hand === 130 && H.gc_hand === 130 && H.fz_hand === 130 && H.cw_hand === 130 && H.gb_hand === 130,
  JSON.stringify([H.bz_hand, H.gc_hand, H.fz_hand, H.cw_hand, H.gb_hand]));
chk('C2 ⭐持有者被洗回**牌庫** ⇒ 不減（130）—— 仙子伊布ex｜天仙石家族',
  H.bz_deck === 130 && H.cw_deck === 130, JSON.stringify([H.bz_deck, H.cw_deck]));
chk('C3 ⭐漩渦言靈：持有者被放回手牌／洗回牌庫 ⇒ 不混亂',
  H.mm_hand === 0 && H.mm_deck === 0, JSON.stringify([H.mm_hand, H.mm_deck]));
chk('C4 ⭐⭐特性在**宣告當時**就被【傳說的熔岩洞】消除（青銅鐘/齒輪怪/冰雪巨龍/灰塵山 都是進化）'
  + ' ⇒ 打死也不會復活（130）',
  H.bz_cave === 130 && H.gc_cave === 130 && H.fz_cave === 130 && H.gb_cave === 130,
  JSON.stringify([H.bz_cave, H.gc_cave, H.fz_cave, H.gb_cave]));
chk('C5 ⭐⭐捲牆的持有者是【無】【基礎】⇒ 熔岩洞打不到它，改用【火箭隊的監視塔】（消【無】特性）'
  + ' ⇒ 不減（130）', H.cw_tower === 130, 'got=' + H.cw_tower);
chk('C6 ⭐持有者還**在場上**但特性被熔岩洞消除 ⇒ 也不減（擋住「只測已離場」的漏網，v6.374 M10 教訓）',
  H.bz_cave_stay === 130 && H.mm_cave_stay === 0, JSON.stringify([H.bz_cave_stay, H.mm_cave_stay]));
chk('C7 ⭐漩渦言靈：宣告當時就被熔岩洞消除（夢妖魔ex 是 1 階進化）⇒ 打死也不混亂',
  H.mm_cave === 0, 'got=' + H.mm_cave);
chk('C8 ⭐非 ATTACK 路徑（撤退）：沒有 _attackTimeHolders ⇒ 純 live 判定，行為不變',
  H.rt_muma === 1 && H.rt_none === 0, JSON.stringify([H.rt_muma, H.rt_none]));

// ══════════════════════════════════════════════════════════════════════════════
// 【D】engine.ts 零改動 ＋ 戰鬥位路徑的不可觸發性（資料驅動 ⇒ 卡池一變就翻紅）
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【D】⭐ engine.ts 零改動 ＋ 戰鬥位（applyDefenderReductionsBlockA）今天無可觸發情境');
const readSrc = (rel) => readFileSync(join(ROOT, 'src', rel), 'utf8');
const engSrc = readSrc('lib/game/engine.ts');
const effSrc = readSrc('lib/game/effects.ts');
const g3Src  = readSrc('lib/game/effects/cards/v3001_g3_wave3.ts');
const g1Src  = readSrc('lib/game/effects/cards/v2999_g3_wave1.ts');
const asof   = readSrc('lib/game/as-of-declaration.ts');
const typSrc = readSrc('lib/game/types.ts');

/** 「在造成傷害前」家族：全部只動「身上附加的」卡，沒有一條把**寶可夢本體**移出場。 */
const preAttacks = [];
for (const c of all) {
  if (c.supertype !== 'Pokemon' || !HIJ(c)) continue;
  for (const a of (c.attacks || [])) {
    const e = String(a.effect ?? '');
    if (!/在造成傷害前/.test(e)) continue;
    preAttacks.push({ id: c.id, name: c.name, atk: a.name, d: String(a.damage ?? ''), e });
  }
}
const firstSentenceAfter = (e) => {
  const i = e.indexOf('在造成傷害前');
  const seg = i < 0 ? e : e.slice(i);
  const j = seg.indexOf('。');
  return j < 0 ? seg : seg.slice(0, j);
};
const isRiskyPre = (e) => {
  const s = firstSentenceAfter(e);
  if (!/(丟棄|放回手牌|放回牌庫)/.test(s)) return false;
  return !/身上附加的/.test(s);   // 只動「身上附加的」卡 ⇒ 不會讓持有者離場
};
const RISKY_PRE = preAttacks.filter(x => isRiskyPre(x.e));
chk('D1 ⭐哨兵：「在造成傷害前」家族抓得到（不是掃到 0 條就綠）', preAttacks.length >= 8,
  'n=' + preAttacks.length);
chk('D2 ⭐⭐卡池裡**沒有**「在造成傷害前把寶可夢本體移出場」的 H/I/J 招式 ⇒ engine.ts 的戰鬥位'
  + '減傷不可能讀到「宣告當時有效、現在已離場」的持有者 ⇒ 本版不動 engine.ts。'
  + '⚠ 未來卡池一旦出現這種招式，這一條立刻翻紅、強迫重新裁示',
  RISKY_PRE.length === 0, JSON.stringify(RISKY_PRE.map(x => x.name + '|' + x.atk + '::' + x.e)));
chk('D2b ⭐正對照：isRiskyPre 真的會判紅（D2 不是恆真斷言）',
  isRiskyPre('在造成傷害前，將對手的戰鬥寶可夢放回手牌。')
  && isRiskyPre('在造成傷害前，將對手的1隻備戰寶可夢與附加的卡全部丟棄。')
  && !isRiskyPre('在造成傷害前，將對手的戰鬥寶可夢身上附加的「寶可夢道具」卡丟棄。'));
/** 把對手寶可夢本體移出場、**且有數值傷害**的招式：今天 0 條（天仙石 damage 是空字串）。 */
const MOVERS = [];
for (const c of all) {
  if (c.supertype !== 'Pokemon' || !HIJ(c)) continue;
  for (const a of (c.attacks || [])) {
    const e = String(a.effect ?? '');
    if (!/對手/.test(e)) continue;
    if (!/(那些寶可夢|那隻寶可夢|備戰寶可夢|戰鬥寶可夢)[^。]{0,24}(放回牌庫|放回手牌)/.test(e)) continue;
    if (!/^\d+$/.test(String(a.damage ?? ''))) continue;
    MOVERS.push(c.name + '|' + a.name + '|' + a.damage);
  }
}
chk('D3 ⭐⭐「把對手寶可夢本體放回牌庫／手牌」且**同時有數值傷害**的 H/I/J 招式：0 條',
  MOVERS.length === 0, JSON.stringify(MOVERS));
chk('D3b ⭐正對照：那個 regexp 真的抓得到 仙子伊布ex｜天仙石（它只是 damage 為空 ⇒ 被 gate 排除）',
  /(那些寶可夢|那隻寶可夢|備戰寶可夢|戰鬥寶可夢)[^。]{0,24}(放回牌庫|放回手牌)/
    .test(String(byId('16770')?.attacks?.find(a => a.name === '天仙石')?.effect ?? ''))
  && String(byId('16770')?.attacks?.find(a => a.name === '天仙石')?.damage ?? 'x') === '',
  JSON.stringify({ d: byId('16770')?.attacks?.find(a => a.name === '天仙石')?.damage }));

// ══════════════════════════════════════════════════════════════════════════════
// 【E】中央性（Rule 38：一個判準一份；⛔ 消費點不得自寫 state._attackTime…）
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【E】中央性');
const SRC_FILES = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts') || e.name.endsWith('.svelte')) SRC_FILES.push(p);
  }
})(join(ROOT, 'src'));
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
chk('E0 哨兵：掃得到 src/ 的檔案', SRC_FILES.length > 100, 'n=' + SRC_FILES.length);
chk('E1 ⭐⭐本版接上的 6 個特性全部在 AS_OF_DECLARATION_ABILITIES 名單裡（全站唯一一份）',
  ['守護之鐘', '凍原堡壘', '齒輪塗層', '捲牆', '垃圾洩氣', '漩渦言靈']
    .every(n => new RegExp("'" + n + "',").test(asof))
  && count(asof, 'export const AS_OF_DECLARATION_ABILITIES') === 1,
  JSON.stringify(['守護之鐘', '凍原堡壘', '齒輪塗層', '捲牆', '垃圾洩氣', '漩渦言靈']
    .filter(n => !new RegExp("'" + n + "',").test(asof))));
chk('E2 ⭐AS_OF_DECLARATION_ACTIVE_ONLY_ABILITIES 只收「卡面寫在戰鬥場上」的漩渦言靈，'
  + '且快照端真的用它過濾（loc !== active 就 continue）',
  count(asof, 'export const AS_OF_DECLARATION_ACTIVE_ONLY_ABILITIES') === 1
  && /AS_OF_DECLARATION_ACTIVE_ONLY_ABILITIES: readonly string\[\] = \[\s*\r?\n\s*'漩渦言靈',/.test(asof)
  && count(stripComments(g3Src), "loc !== 'active' && AS_OF_DECLARATION_ACTIVE_ONLY_ABILITIES.includes(name)") === 1,
  JSON.stringify([count(asof, 'export const AS_OF_DECLARATION_ACTIVE_ONLY_ABILITIES'),
    count(stripComments(g3Src), "loc !== 'active' && AS_OF_DECLARATION_ACTIVE_ONLY_ABILITIES.includes(name)")]));
chk('E3 ⭐AS_OF_DECLARATION_COUNTED_CARD_NAMES 只收「依卡名計數」的爆炸頭水牛，'
  + '且 key 由 asOfDeclarationCardNameKey 統一產生（不得散落字面值）',
  count(asof, 'export const AS_OF_DECLARATION_COUNTED_CARD_NAMES') === 1
  && /AS_OF_DECLARATION_COUNTED_CARD_NAMES: readonly string\[\] = \[\s*\r?\n\s*'爆炸頭水牛',/.test(asof)
  && count(asof, 'export const asOfDeclarationCardNameKey') === 1
  && count(stripComments(asof) + stripComments(g3Src), "'@卡名'") === 1,
  JSON.stringify([count(asof, 'export const AS_OF_DECLARATION_COUNTED_CARD_NAMES'),
    count(stripComments(asof) + stripComments(g3Src), "'@卡名'")]));
const holderReaders = SRC_FILES.filter(p => stripComments(readFileSync(p, 'utf8')).includes('_attackTimeHolders'))
  .map(p => p.slice(ROOT.length).replace(/\\/g, '/')).sort();
chk('E4 ⭐⭐直接碰 _attackTimeHolders 的檔案仍然恰好 3 個：types.ts（宣告）／engine.ts（設定＋清除）／'
  + 'as-of-declaration.ts（唯一消費入口）—— 本版新接的 4 個檔案一律透過中央述詞',
  holderReaders.length === 3
  && holderReaders.includes('src/lib/game/types.ts')
  && holderReaders.includes('src/lib/game/engine.ts')
  && holderReaders.includes('src/lib/game/as-of-declaration.ts'),
  JSON.stringify(holderReaders));
const asofReaders = SRC_FILES.filter(p => /state\._attackTime|\._attackTime[A-Z]/.test(stripComments(readFileSync(p, 'utf8'))))
  .map(p => p.slice(ROOT.length).replace(/\\/g, '/')).sort();
chk('E4b ⭐正對照：stripComments 有作用，且掃描器對「自寫 state._attackTime…」的樣本會命中',
  stripComments('const x = state._attackTimeHolders;').includes('_attackTimeHolders')
  && !stripComments('// const x = state._attackTimeHolders;').includes('_attackTimeHolders')
  && asofReaders.length > 0, JSON.stringify(asofReaders.length));
const g1Times = stripComments(g1Src).match(/state\._attackTime\w*/g) ?? [];
const g3Times = stripComments(g3Src).match(/state\._attackTime\w*/g) ?? [];
chk('E5 ⭐⭐本版動到的檔案**沒有任何一個**自寫 state._attackTime…：v2999_g3_wave1.ts 0 處；'
  + 'v3001_g3_wave3.ts 仍然只有 v6.373 既有的 2 處（_attackTimeCalmGround／_attackTimeLifeRestraint，'
  + '都是餵給 isEffectiveAsOfDeclaration 的 declaredEffective 參數），**沒有**任何人碰 _attackTimeHolders',
  g1Times.length === 0
  && g3Times.length === 2
  && g3Times.every(x => x === 'state._attackTimeCalmGround' || x === 'state._attackTimeLifeRestraint')
  && !stripComments(g3Src).includes('_attackTimeHolders')
  && !stripComments(g1Src).includes('_attackTimeHolders'),
  JSON.stringify({ g1: g1Times, g3: g3Times }));
chk('E5b ⭐正對照：那個 regexp 抓得到「自寫」的樣本（E5 不是恆真斷言）',
  (stripComments('if (x || state._attackTimeHolders) {}').match(/state\._attackTime\w*/g) ?? []).length === 1
  && (stripComments('// if (x || state._attackTimeHolders) {}').match(/state\._attackTime\w*/g) ?? []).length === 0);
chk('E6 ⭐⭐判準核心仍然只有一份：declarationHolderStillCounts 定義 1 處；本版三個新入口'
  + '（asOfDeclarationEffectiveHolderIids／asOfDeclarationActiveOnlyHolderIids／asOfDeclarationSameNameIids）'
  + '全部把判斷交給 asOfDeclarationHolderIids，**沒有**自寫第二份區位判斷',
  count(asof, 'export function declarationHolderStillCounts(') === 1
  && count(g3Src, 'export function asOfDeclarationEffectiveHolderIids(') === 1
  && count(g3Src, 'export function asOfDeclarationActiveOnlyHolderIids(') === 1
  && count(g3Src, 'export function asOfDeclarationSameNameIids(') === 1
  && !/\b(hand|deck|discard)\b/.test(stripComments(g3Src).slice(
    stripComments(g3Src).indexOf('export function asOfDeclarationEffectiveHolderIids('),
    stripComments(g3Src).indexOf('export function getOppRetreatTriggers('))),
  JSON.stringify([count(asof, 'export function declarationHolderStillCounts('),
    count(g3Src, 'export function asOfDeclarationSameNameIids(')]));
chk('E7 ⭐v6.373／v6.374 的既有消費點都沒有被動到'
  + '（effects.ts 5 處 isEffectiveAsOfDeclaration、v3001 2 處、凹洞/熔岩地域 2 處 asOfDeclarationHolderIids）',
  count(effSrc, 'isEffectiveAsOfDeclaration(') === 5
  && count(g3Src, 'isEffectiveAsOfDeclaration(') === 2
  && count(g3Src, 'asOfDeclarationHolderIids(state, oppIdx,') === 2,
  JSON.stringify([count(effSrc, 'isEffectiveAsOfDeclaration('), count(g3Src, 'isEffectiveAsOfDeclaration('),
    count(g3Src, 'asOfDeclarationHolderIids(state, oppIdx,')]));
chk('E8 ⭐⭐五張減傷的持有者判定全部走中央入口：守護之鐘／齒輪塗層 用 asOfDeclarationEffectiveHolderIids，'
  + '捲牆 用 asOfDeclarationSameNameIids ＋ asOfDeclarationHolderIids，'
  + '凍原堡壘／垃圾洩氣（effects.ts bench 路徑）用 asOfDeclarationHolderIids',
  count(g1Src, "asOfDeclarationEffectiveHolderIids(state, defenderIdx, pool, '守護之鐘')") === 1
  && count(g1Src, "asOfDeclarationEffectiveHolderIids(state, defenderIdx, pool, '齒輪塗層')") === 1
  && count(g1Src, "asOfDeclarationSameNameIids(state, defenderIdx, pool, '爆炸頭水牛')") === 1
  && count(g1Src, "asOfDeclarationHolderIids(state, defenderIdx, '捲牆', _liveWallIids)") === 1
  && count(effSrc, "asOfDeclarationHolderIids(state, defenderIdx, '凍原堡壘', _liveFrostIids)") === 1
  && count(effSrc, "asOfDeclarationHolderIids(state, defenderIdx, '垃圾洩氣', _liveGarbageIids)") === 1
  && count(g3Src, "asOfDeclarationActiveOnlyHolderIids(state, oppIdx, pool, '漩渦言靈')") === 1);
chk('E9 ⭐本版**沒有**新增 GameState 欄位（沿用 v6.373 的 _attackTimeHolders，形狀仍是 { p1, p2 } 物件 map；'
  + '⚠ Firestore 禁止巢狀陣列，禁用 T[][]）',
  /_attackTimeHolders\?:\s*\{\s*p1:\s*Record<string,\s*string\[\]>;\s*p2:\s*Record<string,\s*string\[\]>;?\s*\}/.test(typSrc)
  && count(typSrc, '_attackTimeHolders') === 1,
  (typSrc.match(/_attackTimeHolders\?:[^\n]*/) ?? ['(找不到)'])[0]);

// ══════════════════════════════════════════════════════════════════════════════
// 【F】HEAD-FAIL 對 BASE（hasBaseCommit 保護、淺複製 shallowSkip）
// ══════════════════════════════════════════════════════════════════════════════
const BASE = process.env.V6375_BASE || BASE_SHA;
console.log('\n【F】HEAD-FAIL：對 BASE(' + BASE.slice(0, 8) + ' ＝ v6.374，本版的上一版) 重跑整個行為矩陣');
if (!hasBaseCommit(ROOT, BASE)) {
  shallowSkip('【F】HEAD-FAIL 對 BASE 的重建比對', '【A】~【E】都不需要歷史，仍在守');
} else {
  const baseSrc = join(TMP, 'base-src');
  cpSync(join(ROOT, 'src'), baseSrc, { recursive: true });
  const r = restoreBaseSubtree(ROOT, BASE, baseSrc, 'src');
  if (chk('F0 BASE 樹重建成功（整個 src/ 子樹）', r.ok, r.reason ?? ('replaced=' + r.replaced + ' removed=' + r.removed))) {
    const bEng = readBaseBlob(ROOT, BASE, 'src/lib/game/engine.ts');
    // ⭐⭐v6.376 更新（既有守衛因為**下一版的合法改動**而紅，不是回歸）：
    //   v6.375 本身確實一個字都沒動 engine.ts；但 v6.376 把 樂天河童｜生機森巴（**最大 HP** 型）
    //   接進同一個中央述詞，必須動 engine.ts 兩處：
    //     ① getEffectiveHP 裡生機森巴的持有者判準（哨兵區塊 ＋ 兩行 swap 還原）
    //     ② _attackTimeHolders 的 clear 位置搬到 sanityKOSweep **之後**
    //        （最大 HP 型會被 sanityKOSweep 重算，clear 排在它前面 ⇒ 剛救活的又被殺掉）
    //   ⇒ 這一條改成「**剝掉 v6.376 的合法改動之後**仍與 BASE 逐位元組相同」：
    //     v6.375 的守備力一點沒少（v6.376 以外的任何改動照樣紅），
    //     而且剝除器一過期（哨兵不在／swap 字面對不上）也會立刻紅（下面第二個條件）。
    const _v6376StripBlocks = (src, tag) => {
      let t = src;
      for (let guard = 0; ; guard++) {
        if (guard > 50) throw new Error('哨兵剝除迴圈：' + tag);
        const a = t.indexOf('>>> ' + tag);
        if (a < 0) return t;
        const b = t.indexOf('<<< ' + tag, a);
        if (b < 0) throw new Error('哨兵不成對（只有 >>>）：' + tag);
        const ls = t.lastIndexOf('\n', a) + 1;
        const le = t.indexOf('\n', b) + 1;
        if (le <= 0) throw new Error('哨兵收尾行沒有換行：' + tag);
        t = t.slice(0, ls) + t.slice(le);
      }
    };
    const _v6376Strip = (src) => {
      // ⭐⭐ v6.408 必須排在**整條鏈的最前面**（Rule 54 的極端情形）：它刪掉的那一整段
      //   inline 加成裡，含有 v6.368／v6.402／v6.403／v6.407 的哨兵與字面。晚於它們剝除的話，
      //   那幾支會在「已經被刪掉的內容」上找不到自己的錨點（命中 0 次）。
      //   ⇒ 先把 v6.408 換回 v6.407a 的 185 行，後面的剝除器才看得到自己的錨點。
      //   ⭐ Rule 54（由新到舊）：v6.410 排在 v6.408 之前（理由同 test-v6265 F4c）。
      let t = _v6376StripBlocks(stripV6408Engine(stripV6410Engine(stripV6413Engine(src))), 'v6376-');
      // ⚠ v6.376 把 v6.373 的 clear 區塊從「太古防壁快照清除」旁邊**搬到** sanityKOSweep 之後
      //   （最大 HP 型會被 sanityKOSweep 重算 ⇒ clear 排在它前面等於白救）。上一行已經把
      //   新位置那一塊（v6376- 哨兵）剝掉，這裡要把它**插回原位置**，否則會比 BASE 少一整段。
      const _anchorV6373 = "    delete cleared._attackTimeAttackerEnergyUnits;\n    next = cleared;\n  }\n";
      const _v6373Clear = "  // >>> v6373-as-of-declaration-holders-clear\n"
        + "  // ⭐v6.373：持有者 iid 快照的 clear **只有這一處**（applyActionImpl 尾段，比照 v6.357／v6.368）。\n"
        + "  //   pendingSelection 還在時保留給 resolver（比照花之帷幔／平穩境地）。\n"
        + "  if (next._attackTimeHolders !== undefined && !next.pendingSelection) {\n"
        + "    const cleared = { ...next };\n"
        + "    delete cleared._attackTimeHolders;\n"
        + "    next = cleared;\n"
        + "  }\n"
        + "  // <<< v6373-as-of-declaration-holders-clear\n";
      if (t.split(_anchorV6373).length - 1 !== 1) throw new Error('v6376 剝除器：找不到唯一的 v6.373 clear 原位置錨點');
      t = t.split(_anchorV6373).join(_anchorV6373 + _v6373Clear);
      t = t.split("    for (let _v6376k = 0 as 0 | 1; _v6376k <= 1; _v6376k = (_v6376k + 1) as 0 | 1) {   // ⭐v6376-samba-side-index\n")
        .join("    for (const p of state.players) {\n");
      t = t.split("      const hasSamba = _v6376HolderIids(state, _v6376k, '生機森巴', _v6376Live).length > 0;   // ⭐v6376-samba-as-of\n")
        .join("      const hasSamba = allP.some(c => {\n"
          + "        const cc = pool.get(c.cardId);\n"
          + "        if (!cc?.abilities?.some(a => a.name === '生機森巴')) return false;\n"
          + "        return hpAbilityEffective(c, cc, '生機森巴');\n"
          + "      });\n");
      // ⭐v6.385b（既有守衛因**更後面那一版的合法改動**而紅，不是回歸）：
      //   v6.385b 把 getEffectiveHP 裡 修建老匠｜大師工藝 的【鬥】能量計數改走中央述詞
      //   countEnergyTypeHostAware（Rule 38），並在既有的 v6347- import 區塊內加一行 import。
      //   兩處都逐字換回 BASE 的樣子；字面一對不上，F0b 的第二個條件照樣會紅。
      t = t.split("  countEnergyTypeHostAware,                   // \u2b50v6.385b \u5927\u5e2b\u5de5\u85dd\uff1a\u3010\u9b25\u3011\u80fd\u91cf**\u500b\u6578**\uff08\u540c\u4e00\u652f\u4e2d\u592e\u8ff0\u8a5e\uff09\n").join('');
      t = t.split(
        "    // \u2b50\u2b50v6.385b\uff08Fable 5 \u8907\u5be9 \ud83d\udfe17\uff09\uff1a\u539f\u672c inline \u5224\u300c\u57fa\u672c\u3010\u9b25\u3011\u6216 pokemonType===Fighting\u300d\uff0c\n"
        + "    //   \u6f0f\u6389 host-aware \u7684\u7279\u6b8a\u80fd\u91cf \u2014\u2014 \u786c\u5ca9\u3010\u9b25\u3011\u80fd\u91cf\uff08Special\uff0cpokemonType \u53ef\u80fd\u662f null\uff09\u3001\n"
        + "    //   \u53e4\u820a\u80fd\u91cf\uff08\u8996\u70ba\u63d0\u4f9b\u6240\u6709\u5c6c\u6027\uff09\u3001\u65b0\u885d\u5929\u80fd\u91cf\uff08\u9644 2 \u968e\u9032\u5316\u8996\u70ba 2 \u500b\uff09\u3002\u5be6\u6e2c\u90fd\u7b97 0 \u500b\u3002\n"
        + "    //   \u21d2 \u8d70\u8207\u300c\u4e00\u9577\u518d\u9577\u300d\u300c\u6728\u4e4b\u91cd\u58d3\u300d\u540c\u4e00\u652f\u4e2d\u592e\u8ff0\u8a5e\uff08Rule 38\uff09\u3002\n"
        + "    const fightingCount = countEnergyTypeHostAware(inst, 'Fighting', pool,\n"
        + "      { state: state ?? null, ownerIdx: _v6206OwnerIdx ?? null });\n"
      ).join(
        "    let fightingCount = 0;\n"
        + "    for (const e of inst.energyAttached) {\n"
        + "      const ec = pool.get(e.cardId);\n"
        + "      if (!ec || ec.supertype !== 'Energy') continue;\n"
        + "      if (ec.subtype === 'Basic' && (ec.pokemonType === 'Fighting' || /\u3010\u9b25\u3011/.test(ec.name))) fightingCount++;\n"
        + "      else if (ec.pokemonType === 'Fighting') fightingCount++;\n"
        + "    }\n"
      );
      // ⭐⭐ Rule 54（由新到舊）：v6.402 動到了 v6.394 型別清理過的那一段
      //   ⇒ stripV6402Engine 必須排在 stripV6394Engine **之前**。
      // ⭐v6.403：ex 判準收斂對 engine.ts 的 12 組合法改動（與 test-v6265 F4c 共用同一份）。
      //   Rule 54 由新到舊 ⇒ 排在 stripV6402Engine 之前。
      // ⭐v6.407：自身能量付出延後（與 test-v6265 F4c 共用同一份）。Rule 54 由新到舊 ⇒ 排最前。
      t = stripV6407Engine(t);
      t = stripV6403Engine(t);
      // ⭐v6.402：判準收斂對 engine.ts 的 11 組合法改動（與 test-v6265 F4c 共用同一份）
      t = stripV6402Engine(t);
      // ⭐v6.394：型別清理（站長裁示 ④）對 engine.ts 的 8 組合法改動 ——
      //   還原內容與 test-v6265 F4c **共用同一份** scripts/lib/engine-strip-v6394.mjs（Rule 38）。
      t = stripV6394Engine(t);
    // ⭐⭐ v6.398／v6.400／v6.401 動到同一段 ⇒ 剝除必須**由新到舊**（順序寫反會 throw）。
    // ⭐v6.401：能量單位收斂對 engine.ts 的 8 組合法改動（與 test-v6265 F4c 共用同一份）
    t = stripV6401Engine(t);
    // ⭐v6.400：特殊能量表收斂對 engine.ts 的 2 組合法改動（與 test-v6265 F4c 共用同一份）
    t = stripV6400Engine(t);
    // ⭐v6.398：host-aware 能量卡述詞收斂對 engine.ts 的 3 組合法改動（與 test-v6265 F4c 共用同一份）
    t = stripV6398Engine(t);
      return t;
    };
    const _engHeadLf = engSrc.replace(/\r\n/g, '\n');
    const _engStripped = _v6376Strip(_engHeadLf);
    chk('F0b ⭐⭐engine.ts 除了 **v6.376／v6.385b 的合法改動**（三個 v6376- 哨兵區塊 ＋ 兩行 swap 還原 ＋ v6.385b 大師工藝兩處逐字還原）'
      + '之外一個字都沒有動（剝除後與 BASE 逐位元組相同）—— v6.375 本身刻意不碰它，理由見【D】；'
      + '剝除器若過期（哨兵不在／swap 字面對不上）這一條同樣會紅',
      bEng.ok && _engStripped !== _engHeadLf
      && bEng.out.replace(/\r\n/g, '\n') === _engStripped,
      bEng.ok ? ('len base=' + bEng.out.length + ' head=' + engSrc.length + ' stripped=' + _engStripped.length
        + ' strippedChanged=' + (_engStripped !== _engHeadLf)) : 'readBaseBlob failed');
    const BMOD = await bundleFrom(baseSrc, 'base');
    const B = matrix(BMOD);
    chk('F1 哨兵：BASE bundle 是活的（哨兵情境照樣綠，不是整支爆掉造成的「全紅」）',
      B.bz_stay === 120 && B.gc_stay === 110 && B.fz_stay === 80 && B.cw_two_stay === 70
      && B.gb_stay === 110 && B.mm_stay === 1 && B.bz_none === 130,
      JSON.stringify({ bz: B.bz_stay, gc: B.gc_stay, fz: B.fz_stay, cw: B.cw_two_stay, gb: B.gb_stay, mm: B.mm_stay }));
    chk('F2 ⭐⭐⭐(甲) BASE 一定要紅：守護之鐘持有者被同招打死 ⇒ BASE **130（完全不減）**、HEAD 120',
      B.bz_ko === 130 && H.bz_ko === 120, 'BASE=' + B.bz_ko + ' HEAD=' + H.bz_ko);
    chk('F3 ⭐⭐⭐(甲) BASE 一定要紅：齒輪塗層 ⇒ BASE 130、HEAD 110',
      B.gc_ko === 130 && H.gc_ko === 110, 'BASE=' + B.gc_ko + ' HEAD=' + H.gc_ko);
    chk('F4 ⭐⭐⭐(甲) BASE 一定要紅：凍原堡壘 ⇒ BASE 130、HEAD 80',
      B.fz_ko === 130 && H.fz_ko === 80, 'BASE=' + B.fz_ko + ' HEAD=' + H.fz_ko);
    chk('F5 ⭐⭐⭐(甲) BASE 一定要紅：捲牆 ⇒ BASE 130、HEAD 70',
      B.cw_ko === 130 && H.cw_ko === 70, 'BASE=' + B.cw_ko + ' HEAD=' + H.cw_ko);
    chk('F6 ⭐⭐⭐(甲) BASE 一定要紅：垃圾洩氣 ⇒ BASE 130、HEAD 110',
      B.gb_ko === 130 && H.gb_ko === 110, 'BASE=' + B.gb_ko + ' HEAD=' + H.gb_ko);
    chk('F7 ⭐⭐(甲) BASE 一定要紅：捲牆的 SV8（無捲牆特性、只算隻數）被打死 ⇒ BASE 130、HEAD 70',
      B.cw_sv8_ko === 130 && H.cw_sv8_ko === 70, 'BASE=' + B.cw_sv8_ko + ' HEAD=' + H.cw_sv8_ko);
    chk('F7b ⭐⭐(甲) BASE 一定要紅：場上唯一帶捲牆特性的那隻被打死（剩 SV8 只算隻數）⇒ BASE 130、HEAD 70',
      B.cw_onlywall_ko === 130 && H.cw_onlywall_ko === 70,
      'BASE=' + B.cw_onlywall_ko + ' HEAD=' + H.cw_onlywall_ko);
    chk('F8 ⭐⭐(甲) BASE 一定要紅：疊加型兩隻、一隻被打死 ⇒ 守護之鐘 BASE 120/HEAD 110、'
      + '齒輪塗層 BASE 110/HEAD 90',
      B.bz_dup_ko === 120 && H.bz_dup_ko === 110 && B.gc_dup_ko === 110 && H.gc_dup_ko === 90,
      JSON.stringify({ bzB: B.bz_dup_ko, bzH: H.bz_dup_ko, gcB: B.gc_dup_ko, gcH: H.gc_dup_ko }));
    // ⚠⭐ 實測結論（與直覺相反，記下來免得下一版又寫錯）：
    //   「效果不會重複」型放兩隻時，BASE **本來就是對的**
    //   —— 死一隻還有另一隻活著，live 那一半就成立了。
    //   ⇒ 這一組的正確斷言是**零變更**（BASE ≡ HEAD），
    //   而且 HEAD 不可以變成疊加。真正能讓 BASE 翻紅的是
    //   F5（捲牆只剩 1 隻）與 F7（SV8 只算隻數）那兩條。
    chk('F9 ⭐⭐零變更＋不重複：不重複型放兩／三隻、其中一隻被同招打死（另一隻還活著）⇒ '
      + 'BASE 與 HEAD 逐條相同，且 HEAD 仍然只減一次（凍原堡壘 80／捲牆 70／垃圾洩氣 110，'
      + '不是 30／10／90）',
      B.fz_dup_ko === H.fz_dup_ko && H.fz_dup_ko === 80
      && B.cw_dup_ko === H.cw_dup_ko && H.cw_dup_ko === 70
      && B.gb_dup_ko === H.gb_dup_ko && H.gb_dup_ko === 110,
      JSON.stringify({ fz: [B.fz_dup_ko, H.fz_dup_ko], cw: [B.cw_dup_ko, H.cw_dup_ko], gb: [B.gb_dup_ko, H.gb_dup_ko] }));
    chk('F10 ⭐⭐⭐(乙) BASE 一定要紅：漩渦言靈持有者在戰鬥場被同招打死 ⇒ BASE **不混亂**、HEAD 混亂',
      B.mm_ko === 0 && H.mm_ko === 1, 'BASE=' + B.mm_ko + ' HEAD=' + H.mm_ko);
    chk('F11 ⭐⭐零變更：持有者留在場上（五張＋漩渦言靈）BASE 與 HEAD 逐條相同',
      B.bz_stay === H.bz_stay && B.gc_stay === H.gc_stay && B.fz_stay === H.fz_stay
      && B.cw_two_stay === H.cw_two_stay && B.gb_stay === H.gb_stay
      && B.mm_stay === H.mm_stay && B.mm_bench === H.mm_bench,
      JSON.stringify([B.bz_stay, B.gc_stay, B.fz_stay, B.cw_two_stay, B.gb_stay, B.mm_stay, B.mm_bench]));
    chk('F12 ⭐⭐零變更：條件反對照（沒鋼能量／沒水能量／只有一隻水牛／攻擊方沒道具／沒有持有者）'
      + ' BASE 與 HEAD 逐條相同',
      B.gc_nometal === H.gc_nometal && B.fz_nowater === H.fz_nowater && B.cw_one === H.cw_one
      && B.gb_notool === H.gb_notool && B.bz_none === H.bz_none && B.cw_none === H.cw_none
      && B.mm_none === H.mm_none,
      JSON.stringify([B.gc_nometal, B.fz_nowater, B.cw_one, B.gb_notool, B.bz_none, B.cw_none, B.mm_none]));
    chk('F13 ⭐⭐零變更：被主動移除（手牌／牌庫）BASE 與 HEAD 都不生效',
      B.bz_hand === H.bz_hand && B.gc_hand === H.gc_hand && B.fz_hand === H.fz_hand
      && B.cw_hand === H.cw_hand && B.gb_hand === H.gb_hand
      && B.bz_deck === H.bz_deck && B.cw_deck === H.cw_deck
      && B.mm_hand === H.mm_hand && B.mm_deck === H.mm_deck,
      JSON.stringify([B.bz_hand, B.gc_hand, B.fz_hand, B.cw_hand, B.gb_hand, B.mm_hand]));
    chk('F14 ⭐⭐零變更：特性被【傳說的熔岩洞】／【火箭隊的監視塔】消除，BASE 與 HEAD 都不生效',
      B.bz_cave === H.bz_cave && B.gc_cave === H.gc_cave && B.fz_cave === H.fz_cave
      && B.gb_cave === H.gb_cave && B.cw_tower === H.cw_tower
      && B.bz_cave_stay === H.bz_cave_stay && B.mm_cave === H.mm_cave && B.mm_cave_stay === H.mm_cave_stay,
      JSON.stringify([B.bz_cave, B.gc_cave, B.fz_cave, B.gb_cave, B.cw_tower, B.mm_cave]));
    chk('F15 ⭐⭐零變更：非 ATTACK 路徑（撤退）BASE 與 HEAD 逐條相同',
      B.rt_muma === H.rt_muma && B.rt_none === H.rt_none, JSON.stringify([B.rt_muma, B.rt_none]));
    const baseAsof = readFileSync(join(baseSrc, 'lib/game/as-of-declaration.ts'), 'utf8');
    chk('F16 ⭐結構 BASE 一定要紅：BASE 的 AS_OF_DECLARATION_ABILITIES 沒有這 6 個特性，'
      + '也沒有 AS_OF_DECLARATION_ACTIVE_ONLY_ABILITIES／AS_OF_DECLARATION_COUNTED_CARD_NAMES；HEAD 都有',
      ['守護之鐘', '凍原堡壘', '齒輪塗層', '捲牆', '垃圾洩氣', '漩渦言靈'].every(n => !baseAsof.includes("'" + n + "',"))
      && !baseAsof.includes('AS_OF_DECLARATION_ACTIVE_ONLY_ABILITIES')
      && !baseAsof.includes('AS_OF_DECLARATION_COUNTED_CARD_NAMES')
      && ['守護之鐘', '凍原堡壘', '齒輪塗層', '捲牆', '垃圾洩氣', '漩渦言靈'].every(n => asof.includes("'" + n + "',"))
      && asof.includes('AS_OF_DECLARATION_ACTIVE_ONLY_ABILITIES')
      && asof.includes('AS_OF_DECLARATION_COUNTED_CARD_NAMES'));
  }
}

console.log('\n=== v6.375 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail === 0 ? 0 : 1);
