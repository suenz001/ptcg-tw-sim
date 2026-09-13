// v6.376 守衛：站長裁定 A-1 第三步 —— 加傷 8 張 ＋ 弱點 2 張 ＋ 最大 HP 1 張
//   接上 v6.373 的中央述詞 src/lib/game/as-of-declaration.ts。
//
// ⭐⭐⭐ 病灶複驗（**全部行為端實測**，與簡報的預判一致／不一致都逐條記在這裡）：
//
//   (丙) 最大 HP 1 張 —— **病灶成立，本版真修**。
//     樂天河童｜生機森巴（MC 16648，標 I，HP140，2 階）「自己場上所有寶可夢的最大 HP 各 +40」。
//     真卡 三首惡龍ex｜黑曜石（戰鬥位 130 ＋ 對手 2 隻備戰各 130）：
//       樂天河童（140+40=180、damage 60 ⇒ 190 ≥ 180）在戰鬥位被同一招打死之後，
//       BASE 的備戰兩隻 HP130 最大 HP 掉回 130 ⇒ **全部被 KO、獎賞 3 張**；
//       持有者活著時同一盤面是 170 ⇒ 存活、獎賞 0 張。
//     ⚠⚠ 真因有**兩層**（第二層是插樁實測才抓到的，見 __m6a/probe376l.mjs）：
//       ① getEffectiveHP 只問「現在」場上有沒有有效的生機森巴；
//       ② 就算 ① 修好，applyActionImpl 尾段的 **sanityKOSweep**（本 action 最後一個 KO 判定點）
//          跑在 `_attackTimeHolders` 的 clear **之後** ⇒ 它用「沒有快照」的 state 重算最大 HP，
//          把剛救活的備戰又殺一次。⇒ clear 必須搬到 sanityKOSweep 之後。
//       （v6.373~v6.375 六個特性的消費點全是「傷害量」，算完寫進 damage 就不再重算 ⇒ 感覺不到 ②。）
//
//   (甲) 加傷 8 張 —— **病灶不成立**（簡報的預判被實測**證實**）。
//     這 8 張的持有者都在**攻擊方**，而「對對手的戰鬥寶可夢造成的傷害」在引擎主管線一次算完，
//     排在任何攻擊方寶可夢昏厥離場**之前**。行為端實測（真卡 赫普的沙螺蟒｜大地裂破
//     140 ＋ **自己**所有備戰各 20）：赫普的卡比獸｜大方（HP150、damage 130 ⇒ 160 ≥ 150 被同一招打死）
//     ⇒ 對手戰鬥位**照樣 170**（＝140+30），與持有者活著時逐字相同。
//     ⇒ 本版對這 8 張**不做任何改動**，只下**行為鎖**＋資料驅動的不可觸發性斷言（【B5】【B6】）。
//
//   (乙) 弱點 2 張 —— **病灶不成立**。
//     ・莉莉艾的皮皮ex｜妖精領域：持有者同樣在攻擊方側（hasFairyZoneField(state, actorIdx)）。
//       真卡 麒麟奇｜雙向頭擊（【超】30 ＋ 自己的 1 隻備戰受 10）：皮皮ex（HP190、damage 180）
//       被同一招打死 ⇒ 對【龍】靶照樣 60（＝30×2，弱點已改【超】），與活著時相同。
//     ・甜甜螢｜絕佳費洛蒙（「**雙方**的戰鬥寶可夢」×3）：兩側都測過 ——
//       攻擊方側（雙向頭擊，甜甜螢 HP80 damage 70 被打死）⇒ 照樣 90；
//       防守方側（急凍鳥｜冰雹 對手所有各 30，甜甜螢在備戰被打死）⇒ 照樣 90。
//       ⚠ 連**前提卡**「電螢蟲」被同一招打死也照樣 ×3（戰鬥位那一份永遠排在備戰之前）。
//
// ⚠⚠ 與簡報不一致之處：
//   ・簡報 (乙) 妖精領域卡面逐字少了尾綴 —— static/cards 的 effect 實際是
//     「…全部改爲【超】屬性。[弱點以「×2」計算傷害。]」（多了方括號那一句，且是「改爲」不是「改為」）。
//   ・簡報說「加傷 8 張很可能沒有病灶」——**實測證實**（不是推翻）。
//
// 斷言分層：
//   【0】fixture 自驗（卡面逐字，一律取自 abilities[].effect）
//   【A】⭐⭐⭐(丙) 生機森巴：病灶情境 ＋ 條件／不重複／主動移除／特性消除 反對照
//   【B】⭐⭐(甲) 加傷 8 張：行為鎖 ＋ 各自條件反對照 ＋ 不可觸發性（資料驅動）
//   【C】⭐(乙) 弱點 2 張：行為鎖 ＋ 條件反對照
//   【D】⭐ 中央性（名單／單一判準／clear 只有一處且在 sanityKOSweep 之後）
//   【E】HEAD-FAIL 對 BASE(0d1aa3d7 ＝ v6.375)，hasBaseCommit 保護、淺複製 shallowSkip
//
// ⛔ 本守衛不寫任何東西進 src/；合成盤面只在記憶體裡。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, readBaseBlob, restoreBaseSubtree, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '0d1aa3d7a27f931f48850e74b18d8cd7819ae6c9';   // v6.375（本版的上一版）

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
const NEUT = (c) => c.supertype === 'Pokemon' && HIJ(c) && !(c.abilities || []).length && !(c.tags || []).length && NONRULE(c);

// ── 真卡 fixture（全部 H/I/J）─────────────────────────────────────────────────
const SAMBA = byId('16648');   // 樂天河童        MC  標I HP140 2階【水】｜生機森巴 最大HP+40（不重複）
const VICT  = byId('11192');   // 比克提尼        SV8 標H HP70  基礎【火】｜勝利聲援 +10（自方【火】進化）
const ROSE  = byId('14670');   // 竹蘭的羅絲雷朵  M2a 標I HP130 1階【草】｜輝煌聲援 +30（竹蘭的）
const TURT  = byId('10918');   // 肋骨海龜        SV7 標H HP160 2階【水】｜原始心得 +30（對進化）
const SERP  = byId('16513');   // 君主蛇ex        MC  標I HP320 2階【草】｜皇家聲援 +20（無條件）
const SKIRT = byId('12078');   // 裙兒小姐        SVM 標H HP110 1階【草】｜大晴天 +20（自方草/火）
const KABI  = byId('14796');   // 赫普的卡比獸    M2a 標I HP150 基礎【無】｜大方 +30（赫普的，不重複）
const IRON  = byId('16832');   // 鐵頭殼ex        MC  標H HP220 基礎【超】｜鈷藍指令 +20（未來，自己除外）
const SALT  = byId('13993');   // 鹽石巨靈        M1L 標I HP180 2階【鬥】｜力之鹽 +30（自方鬥）
const HOTA  = byId('19916');   // 甜甜螢          M6a 標J HP80  基礎【草】｜絕佳費洛蒙 弱點×3（需電螢蟲）
const DENJI = byId('19915');   // 電螢蟲          M6a 標J HP80（絕佳費洛蒙的前提卡）
const PIPPI = byId('14720');   // 莉莉艾的皮皮ex  M2a 標I HP190 基礎【超】｜妖精領域（對手【龍】弱點改【超】）

const HYD   = byId('11252');   // 三首惡龍ex   標H｜黑曜石 130 ＋ 對手 2 隻備戰各 130
const ZAPD  = byId('19924');   // 急凍鳥       標J｜冰雹 對手的所有寶可夢各受到 30 點傷害
const SNAKE = byId('12516');   // 赫普的沙螺蟒 標I｜大地裂破 140 ＋ **自己**所有備戰各 20
const KIRIN = byId('16772');   // 麒麟奇       標H｜雙向頭擊【超】30 ＋ **自己**的 1 隻備戰受 10
const CAVE  = byId('19623');   // 傳說的熔岩洞（雙方場上所有**進化**寶可夢特性全部消除）
const TOWER = all.find(c => c.name === '火箭隊的監視塔' && c.supertype === 'Trainer');
const aIdxOf = (c, n) => (c?.attacks || []).findIndex(a => a.name === n);

console.log('\n【0】fixture 自驗（Rule 25：抽不到卡／卡面對不上要大聲紅，不可以靜默全綠）');
const faceOf = (c, ab) => (c?.abilities || []).find(a => a.name === ab)?.effect;
const face = (tag, c, ab, id, mark, hp, stage, effect) => chk(tag, 
  c?.id != null && String(c.id) === id && c?.regulationMark === mark && Number(c?.hp) === hp
  && (c?.stage ?? c?.subtype) === stage && faceOf(c, ab) === effect,
  JSON.stringify({ n: c?.name, m: c?.regulationMark, hp: c?.hp, s: c?.stage ?? c?.subtype, e: faceOf(c, ab) }));

face('0a ⭐⭐⭐樂天河童（MC id 16648，標 I，HP140，2階）｜生機森巴 卡面逐字（明文「不會重複」）',
  SAMBA, '生機森巴', '16648', 'I', 140, 'Stage2',
  '只要這隻寶可夢在場上，自己場上所有寶可夢的最大HP各「+40」。無論有多少隻擁有這個特性的寶可夢，這個效果也不會重複。');
face('0b 比克提尼（SV8 id 11192，標 H，HP70，基礎）｜勝利聲援 卡面逐字',
  VICT, '勝利聲援', '11192', 'H', 70, 'Basic',
  '只要這隻寶可夢在場上，自己的【火】屬性的進化寶可夢使用的招式，對對手的戰鬥寶可夢造成的傷害「+10」點。');
face('0c 竹蘭的羅絲雷朵（M2a id 14670，標 I，HP130，1階）｜輝煌聲援 卡面逐字',
  ROSE, '輝煌聲援', '14670', 'I', 130, 'Stage1',
  '只要這隻寶可夢在場上，自己的「竹蘭的寶可夢」使用的招式，對對手的戰鬥寶可夢造成的傷害「+30」點。');
face('0d 肋骨海龜（SV7 id 10918，標 H，HP160，2階）｜原始心得 卡面逐字（對戰鬥場的**進化**寶可夢）',
  TURT, '原始心得', '10918', 'H', 160, 'Stage2',
  '只要這隻寶可夢在場上，自己的寶可夢使用的招式，對對手的戰鬥場的進化寶可夢造成的傷害「+30」點。');
face('0e 君主蛇ex（MC id 16513，標 I，HP320，2階）｜皇家聲援 卡面逐字（無條件 +20）',
  SERP, '皇家聲援', '16513', 'I', 320, 'Stage2',
  '只要這隻寶可夢在場上，自己的寶可夢使用的招式，對對手的戰鬥寶可夢造成的傷害「+20」點。');
face('0f 裙兒小姐（SVM id 12078，標 H，HP110，1階）｜大晴天 卡面逐字（自方【草】或【火】）',
  SKIRT, '大晴天', '12078', 'H', 110, 'Stage1',
  '只要這隻寶可夢在場上，自己的【草】或者【火】寶可夢使用的招式，對對手的戰鬥寶可夢造成的傷害「+20」點。');
face('0g ⭐赫普的卡比獸（M2a id 14796，標 I，HP150，基礎）｜大方 卡面逐字（明文「不會重複」）',
  KABI, '大方', '14796', 'I', 150, 'Basic',
  '只要這隻寶可夢在場上，自己的「赫普的寶可夢」使用的招式，對對手的戰鬥寶可夢造成的傷害「+30」點。無論有多少隻擁有這個特性的寶可夢，這個效果也不會重複。');
face('0h 鐵頭殼ex（MC id 16832，標 H，HP220，基礎）｜鈷藍指令 卡面逐字（「鐵頭殼ex」除外）',
  IRON, '鈷藍指令', '16832', 'H', 220, 'Basic',
  '只要這隻寶可夢在場上，自己的「未來」寶可夢（「鐵頭殼ex」除外）使用的招式，對對手的戰鬥寶可夢造成的傷害「+20」點。');
face('0i 鹽石巨靈（M1L id 13993，標 I，HP180，2階）｜力之鹽 卡面逐字（自方【鬥】）',
  SALT, '力之鹽', '13993', 'I', 180, 'Stage2',
  '只要這隻寶可夢在場上，自己的【鬥】寶可夢使用的招式，對對手的戰鬥寶可夢造成的傷害「+30」點。');
face('0j ⭐甜甜螢（M6a id 19916，標 J，HP80，基礎）｜絕佳費洛蒙 卡面逐字（前提「電螢蟲」＋**雙方**×3）',
  HOTA, '絕佳費洛蒙', '19916', 'J', 80, 'Basic',
  '若自己的場上有「電螢蟲」則生效。只要這隻寶可夢在場上，雙方的戰鬥寶可夢的弱點以「×3」計算傷害。');
face('0k ⭐莉莉艾的皮皮ex（M2a id 14720，標 I，HP190，基礎）｜妖精領域 卡面逐字'
  + '（⚠ 與簡報不一致：實際 effect 還有尾綴「[弱點以「×2」計算傷害。]」，且是「改爲」不是「改為」）',
  PIPPI, '妖精領域', '14720', 'I', 190, 'Basic',
  '只要這隻寶可夢在場上，對手的場上的所有【龍】寶可夢的弱點全部改爲【超】屬性。[弱點以「×2」計算傷害。]');
chk('0l ⭐電螢蟲（M6a id 19915，標 J，HP80，基礎）存在且**沒有**任何特性（它只是絕佳費洛蒙的前提卡）',
  DENJI?.name === '電螢蟲' && DENJI?.regulationMark === 'J' && Number(DENJI?.hp) === 80
  && (DENJI?.abilities?.length ?? 0) === 0,
  JSON.stringify({ n: DENJI?.name, m: DENJI?.regulationMark, hp: DENJI?.hp, ab: DENJI?.abilities }));
chk('0m ⭐招式 fixture：黑曜石／冰雹／大地裂破／雙向頭擊 的卡面逐字（attacks[].effect）',
  HYD?.attacks?.[aIdxOf(HYD, '黑曜石')]?.effect === '對手的2隻備戰寶可夢也各受到130點傷害。[在備戰區不計算弱點・抵抗力。]'
  && String(HYD?.attacks?.[aIdxOf(HYD, '黑曜石')]?.damage) === '130'
  && ZAPD?.attacks?.[aIdxOf(ZAPD, '冰雹')]?.effect === '對手的所有寶可夢各受到30點傷害。[在備戰區不計算弱點・抵抗力。]'
  && SNAKE?.attacks?.[aIdxOf(SNAKE, '大地裂破')]?.effect === '自己的所有備戰寶可夢也各受到20點傷害。[在備戰區不計算弱點・抵抗力。]'
  && String(SNAKE?.attacks?.[aIdxOf(SNAKE, '大地裂破')]?.damage) === '140'
  && KIRIN?.attacks?.[aIdxOf(KIRIN, '雙向頭擊')]?.effect === '自己的1隻備戰寶可夢也受到10點傷害。[在備戰區不計算弱點・抵抗力。]'
  && String(KIRIN?.attacks?.[aIdxOf(KIRIN, '雙向頭擊')]?.damage) === '30'
  && KIRIN?.pokemonType === 'Psychic' && SNAKE?.name === '赫普的沙螺蟒',
  JSON.stringify({ hyd: HYD?.attacks?.[aIdxOf(HYD, '黑曜石')], zapd: ZAPD?.attacks?.[aIdxOf(ZAPD, '冰雹')] }));

// ── 中性靶 ────────────────────────────────────────────────────────────────────
/** HP 剛好 130：受 130 正好 KO；有生機森巴 +40 ⇒ 170 ⇒ 存活。 */
const V130 = all.find(c => NEUT(c) && (c.stage ?? c.subtype) === 'Basic' && Number(c.hp) === 130);
/** 高 HP 中性靶（撐得住 140+30）。 */
const BIG = all.filter(c => NEUT(c) && Number(c.hp) >= 180 && c.weakness?.type !== 'Fighting'
  && c.weakness?.type !== 'Darkness').sort((a, b) => Number(b.hp) - Number(a.hp))[0];
/** 【龍】靶（妖精領域：弱點改【超】）。 */
const DRAG = all.filter(c => NEUT(c) && c.pokemonType === 'Dragon' && Number(c.hp) >= 120)
  .sort((a, b) => Number(b.hp) - Number(a.hp))[0];
/** 弱【超】靶（絕佳費洛蒙 ×2 vs ×3）。 */
const WEAKP = all.filter(c => NEUT(c) && c.weakness?.type === 'Psychic'
  && String(c.weakness?.value || '').startsWith('×') && Number(c.hp) >= 120)
  .sort((a, b) => Number(b.hp) - Number(a.hp))[0];
/** 弱【水】靶（冰雹 ×2 vs ×3）。 */
const WEAKW = all.filter(c => NEUT(c) && c.weakness?.type === 'Water'
  && String(c.weakness?.value || '').startsWith('×') && Number(c.hp) >= 150)
  .sort((a, b) => Number(b.hp) - Number(a.hp))[0];
/** 【火】屬性的**進化**寶可夢（勝利聲援的受惠者）。 */
const FIREEVO = all.find(c => c.supertype === 'Pokemon' && HIJ(c) && c.pokemonType === 'Fire'
  && !(c.abilities || []).length && NONRULE(c) && (c.stage ?? c.subtype) === 'Stage1'
  && (c.attacks || []).some(a => /^\d+$/.test(String(a.damage || '')) && Number(a.damage) > 0));
chk('0n ⭐中性靶抽得到（V130／BIG／DRAG／WEAKP／WEAKW／FIREEVO）',
  !!V130 && !!BIG && !!DRAG && !!WEAKP && !!WEAKW && !!FIREEVO,
  JSON.stringify({ V130: V130?.name, BIG: BIG?.name, DRAG: DRAG?.name, WEAKP: WEAKP?.name, WEAKW: WEAKW?.name, FIREEVO: FIREEVO?.name }));

// ── bundle harness ────────────────────────────────────────────────────────────
const TMP = mkdtempSync(join(tmpdir(), 'v6376-'));
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* noop */ } });
const STRAY = [];
process.on('exit', () => { for (const p of STRAY) { try { unlinkSync(p); } catch { /* noop */ } } });

/** ⚠ entry 要寫在 srcDir 的父目錄、用相對路徑 import（Windows 的 E:/… 會被 esbuild 當成套件名）。 */
async function bundleFrom(srcDir, tag) {
  const parent = dirname(srcDir);
  const name = srcDir.slice(parent.length + 1).replace(/\\/g, '/');
  const p = './' + name;
  const S = join(parent, '.v6376-s-' + tag + '.js'), E = join(parent, '.v6376-e-' + tag + '.ts'), O = join(parent, '.v6376-o-' + tag + '.mjs');
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
const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼', Dragon: '龍' };
const EID = {};
for (const c of all) { if (c.supertype !== 'Energy') continue; for (const [k, z] of Object.entries(ZH)) if (c.name === '基本【' + z + '】能量' && !EID[k]) EID[k] = String(c.id); }
EID.Colorless = EID.Water;
const eCost = (c, n) => ((c?.attacks || []).find(a => a.name === n)?.cost ?? []).map(t => inst(EID[t] ?? EID.Water));
const filler = (n, id) => Array.from({ length: n }, () => inst(id));

/**
 * ⭐(丙) 生機森巴情境 A：三首惡龍ex｜黑曜石（戰鬥位 130 ＋ pendingSelection 選 2 隻備戰各 130）。
 * @returns { benchN, prizes, err }  benchN ＝ 防守方備戰存活隻數；prizes ＝ 攻擊方本次拿走的獎賞數
 */
function sambaPick(MOD, o) {
  const st = mk(
    { active: inst(HYD.id, { energyAttached: eCost(HYD, '黑曜石') }), bench: [inst(V130.id)], deck: filler(3, V130.id), prizes: filler(6, V130.id) },
    { active: o.defActive, bench: o.defBench, deck: filler(3, V130.id), prizes: filler(6, V130.id) },
    o.stadium ? { activeStadium: inst(o.stadium), activeStadiumOwnerIdx: 1 } : {});
  let r = run(MOD, st, { type: 'ATTACK', attackIndex: aIdxOf(HYD, '黑曜石') });
  if (r?.__err) return { benchN: -999, prizes: -999, err: r.__err };
  // 「被主動移除」：把昏厥進棄牌區的持有者改搬到手牌／牌庫（純 harness 操作，不碰 src）
  if (o.move) {
    const dp = { ...r.players[1] };
    const i = dp.discard.findIndex(c => String(c.cardId) === String(SAMBA.id));
    if (i >= 0) {
      const moved = dp.discard[i];
      dp.discard = dp.discard.filter((_, k) => k !== i);
      if (o.move === 'hand') dp.hand = [...dp.hand, moved]; else dp.deck = [...dp.deck, moved];
      const players = [...r.players]; players[1] = dp;
      r = { ...r, players };
    }
  }
  if (r?.pendingSelection?.type !== 'opp-bench-choose') return { benchN: -998, prizes: -998, err: 'no-pending:' + (r?.pendingSelection?.type ?? 'null') };
  const ps = r.pendingSelection;
  const ids = (r.players[1].bench || []).slice(0, ps.maxCount).map(b => b.iid);
  r = run(MOD, r, { type: 'RESOLVE_SELECTION', selectedIids: ids, senderIdx: ps.actorIdx ?? 0, pendingToken: ps.token });
  if (r?.__err) return { benchN: -997, prizes: -997, err: r.__err };
  return { benchN: (r.players?.[1]?.bench ?? []).length, prizes: 6 - (r.players?.[0]?.prizes ?? []).length, err: '' };
}

/** ⭐(丙) 生機森巴情境 B：急凍鳥｜冰雹（**無** pendingSelection；對手全體各 30）。 */
function sambaHail(MOD, o) {
  const st = mk(
    { active: inst(ZAPD.id, { energyAttached: eCost(ZAPD, '冰雹') }), bench: [inst(V130.id)], deck: filler(3, V130.id), prizes: filler(6, V130.id) },
    { active: o.defActive, bench: o.defBench, deck: filler(3, V130.id), prizes: filler(6, V130.id) },
    o.stadium ? { activeStadium: inst(o.stadium), activeStadiumOwnerIdx: 1 } : {});
  const r = run(MOD, st, { type: 'ATTACK', attackIndex: aIdxOf(ZAPD, '冰雹') });
  if (r?.__err) return { benchN: -999, prizes: -999, activeDmg: -999 };
  return {
    benchN: (r.players?.[1]?.bench ?? []).length,
    prizes: 6 - (r.players?.[0]?.prizes ?? []).length,
    activeDmg: r.players?.[1]?.active ? r.players[1].active.damage : -1,
  };
}

/**
 * ⭐(甲)(乙) 攻擊方側情境：赫普的沙螺蟒｜大地裂破（140 ＋ **自己**所有備戰各 20）。
 *   持有者放攻擊方備戰、把 damage 墊到「受 20 就昏厥」⇒ 測「持有者被同一招打死」。
 */
function atkSide(MOD, o) {
  const st = mk(
    { active: inst(o.atkCard ?? SNAKE.id, { energyAttached: eCost(o.atkCard ? byId(o.atkCard) : SNAKE, o.atkName ?? '大地裂破') }),
      bench: o.atkBench, deck: filler(3, V130.id), prizes: filler(6, V130.id) },
    { active: inst(o.defCard, o.defExtra ?? {}), bench: [inst(V130.id)], deck: filler(3, V130.id), prizes: filler(6, V130.id) },
    o.stadium ? { activeStadium: inst(o.stadium), activeStadiumOwnerIdx: 1 } : {});
  const r = run(MOD, st, { type: 'ATTACK', attackIndex: aIdxOf(o.atkCard ? byId(o.atkCard) : SNAKE, o.atkName ?? '大地裂破') });
  if (r?.__err) return { dmg: -999, benchAlive: -999 };
  return {
    dmg: r.players?.[1]?.active ? r.players[1].active.damage : -1,
    benchAlive: (r.players?.[0]?.bench ?? []).length,
  };
}

/** ⭐(乙) 麒麟奇｜雙向頭擊（【超】30 ＋ 自己的 1 隻備戰受 10；bench-choose 選 bench[0]）。 */
function kirin(MOD, o) {
  const st = mk(
    { active: inst(KIRIN.id, { energyAttached: eCost(KIRIN, '雙向頭擊') }), bench: o.atkBench, deck: filler(3, V130.id), prizes: filler(6, V130.id) },
    { active: inst(o.defCard), bench: [inst(V130.id)], deck: filler(3, V130.id), prizes: filler(6, V130.id) },
    o.stadium ? { activeStadium: inst(o.stadium), activeStadiumOwnerIdx: 1 } : {});
  let r = run(MOD, st, { type: 'ATTACK', attackIndex: aIdxOf(KIRIN, '雙向頭擊') });
  if (r?.__err) return { dmg: -999, benchAlive: -999 };
  const dmgBefore = r.players?.[1]?.active ? r.players[1].active.damage : -1;
  if (r?.pendingSelection?.type === 'bench-choose') {
    const ps = r.pendingSelection;
    const b = (r.players[0].bench || [])[0];
    r = run(MOD, r, { type: 'RESOLVE_SELECTION', selectedIids: b ? [b.iid] : [], senderIdx: ps.actorIdx ?? 0, pendingToken: ps.token });
    if (r?.__err) return { dmg: -997, benchAlive: -997 };
  }
  return { dmg: dmgBefore, benchAlive: (r.players?.[0]?.bench ?? []).length };
}

// ── 行為矩陣（HEAD 與 BASE 共用同一份情境，【E】段逐項對拍）──────────────────
function matrix(MOD) {
  const m = {};
  // ── (丙) 生機森巴 ────────────────────────────────────────────────────────
  // 樂天河童 HP140 ＋40 ＝ 180；damage 60 ⇒ 受 130 ＝ 190 ≥ 180 ⇒ 昏厥
  const S = (k, o) => { const r = sambaPick(MOD, o); m[k] = r.benchN * 100 + r.prizes; };
  S('sb_ko_active',   { defActive: inst(SAMBA.id, { damage: 60 }), defBench: [inst(V130.id), inst(V130.id)] });
  S('sb_alive_active',{ defActive: inst(SAMBA.id), defBench: [inst(V130.id), inst(V130.id)] });
  S('sb_stay_bench',  { defActive: inst(BIG.id), defBench: [inst(V130.id), inst(SAMBA.id)] });
  S('sb_none',        { defActive: inst(BIG.id), defBench: [inst(V130.id), inst(V130.id)] });
  S('sb_ko_bench',    { defActive: inst(BIG.id), defBench: [inst(SAMBA.id, { damage: 60 }), inst(V130.id)] });
  S('sb_hand',        { defActive: inst(SAMBA.id, { damage: 60 }), defBench: [inst(V130.id), inst(V130.id)], move: 'hand' });
  S('sb_deck',        { defActive: inst(SAMBA.id, { damage: 60 }), defBench: [inst(V130.id), inst(V130.id)], move: 'deck' });
  S('sb_cave',        { defActive: inst(SAMBA.id, { damage: 60 }), defBench: [inst(V130.id), inst(V130.id)], stadium: CAVE.id });
  S('sb_cave_stay',   { defActive: inst(BIG.id), defBench: [inst(V130.id), inst(SAMBA.id)], stadium: CAVE.id });
  S('sb_dup_ko',      { defActive: inst(SAMBA.id, { damage: 60 }), defBench: [inst(V130.id), inst(SAMBA.id)] });
  // 「不重複」：兩隻都被同一招打死 ⇒ 仍然只 +40（HP 170）⇒ 備戰 V130 存活；若誤疊成 +80（210）也是存活，
  //   所以另外用 sb_dup_both_ko_hp210 這個**數值**情境把它分開（見 A5）。
  S('sb_dup_both_ko', { defActive: inst(SAMBA.id, { damage: 60 }), defBench: [inst(SAMBA.id, { damage: 60 }), inst(V130.id)] });
  // ⭐⭐**數值鎖**：受惠者 damage 50 ⇒ 受 130 ＝ 180。
  //   ・+40（最大 HP 170）⇒ 180 ≥ 170 ⇒ **被 KO**
  //   ・若誤疊成 +80（210）或把 +40 改大 ⇒ 存活 ⇒ 下面 A6b/A6c 立刻紅
  //   （前兩個情境的持有者**活著**，所以與本版修法無關 ⇒ BASE ≡ HEAD，純粹鎖數值與「不重複」。）
  S('sb_amt_one', { defActive: inst(BIG.id), defBench: [inst(V130.id, { damage: 50 }), inst(SAMBA.id)] });
  S('sb_amt_two', { defActive: inst(BIG.id), defBench: [inst(V130.id, { damage: 50 }), inst(SAMBA.id), inst(SAMBA.id)] });
  S('sb_amt_ko',  { defActive: inst(SAMBA.id, { damage: 60 }), defBench: [inst(V130.id, { damage: 50 }), inst(V130.id, { damage: 50 })] });
  // 冰雹（無 pending）：樂天河童 damage 155 ⇒ 185 ≥ 180 昏厥；V130 damage 120 ⇒ 150（<170 存活／≥130 昏厥）
  const H = (k, o) => { const r = sambaHail(MOD, o); m[k] = r.benchN * 100 + r.prizes; };
  H('sh_ko_active',   { defActive: inst(SAMBA.id, { damage: 155 }), defBench: [inst(V130.id, { damage: 120 })] });
  H('sh_alive',       { defActive: inst(SAMBA.id), defBench: [inst(V130.id, { damage: 120 })] });
  H('sh_none',        { defActive: inst(V130.id, { damage: 155 }), defBench: [inst(V130.id, { damage: 120 })] });
  H('sh_cave',        { defActive: inst(SAMBA.id, { damage: 155 }), defBench: [inst(V130.id, { damage: 120 })], stadium: CAVE.id });
  // ⭐「自己場上」：持有者在**攻擊方**時，防守方備戰不該受惠
  H('sh_oppside',     { defActive: inst(V130.id, { damage: 155 }), defBench: [inst(V130.id, { damage: 120 })], });
  // ── (甲) 加傷 ───────────────────────────────────────────────────────────
  const A = (k, o) => { m[k] = atkSide(MOD, o).dmg; };
  // 大方（+30，「赫普的寶可夢」；赫普的卡比獸 HP150 damage 130 ⇒ 受 20 ＝ 160 ≥ 150 昏厥）
  A('gf_ko',    { atkBench: [inst(KABI.id, { damage: 130 })], defCard: BIG.id });
  A('gf_alive', { atkBench: [inst(KABI.id)], defCard: BIG.id });
  A('gf_none',  { atkBench: [], defCard: BIG.id });
  A('gf_dup',   { atkBench: [inst(KABI.id), inst(KABI.id)], defCard: BIG.id });
  A('gf_tower', { atkBench: [inst(KABI.id)], defCard: BIG.id, stadium: TOWER?.id });
  // 力之鹽（+30，自方【鬥】；沙螺蟒是【鬥】⇒ 生效）
  A('ps_alive', { atkBench: [inst(SALT.id)], defCard: BIG.id });
  A('ps_ko',    { atkBench: [inst(SALT.id, { damage: 160 })], defCard: BIG.id });
  A('ps_cave',  { atkBench: [inst(SALT.id)], defCard: BIG.id, stadium: CAVE.id });
  // 皇家聲援（+20，無條件）
  A('rc_alive', { atkBench: [inst(SERP.id)], defCard: BIG.id });
  A('rc_cave',  { atkBench: [inst(SERP.id)], defCard: BIG.id, stadium: CAVE.id });
  // 原始心得（+30，只對對手戰鬥場的**進化**寶可夢）
  A('pm_evo',   { atkBench: [inst(TURT.id)], defCard: BIG.id });
  A('pm_basic', { atkBench: [inst(TURT.id)], defCard: V130.id });
  // 輝煌聲援（+30，只對「竹蘭的寶可夢」；沙螺蟒是「赫普的」⇒ 不生效）
  A('bs_no',    { atkBench: [inst(ROSE.id)], defCard: BIG.id });
  // 大晴天（+20，自方【草】或【火】；沙螺蟒是【鬥】⇒ 不生效）
  A('sd_no',    { atkBench: [inst(SKIRT.id)], defCard: BIG.id });
  // 鈷藍指令（+20，只對「未來」寶可夢；沙螺蟒沒有「未來」tag ⇒ 不生效）
  A('cb_no',    { atkBench: [inst(IRON.id)], defCard: BIG.id });
  // 勝利聲援（+10，只對自方【火】屬性的**進化**寶可夢；沙螺蟒是【鬥】基礎 ⇒ 不生效）
  A('vc_no',    { atkBench: [inst(VICT.id)], defCard: BIG.id });
  // ── (乙) 妖精領域／絕佳費洛蒙（麒麟奇｜雙向頭擊【超】30）────────────────
  const K = (k, o) => { m[k] = kirin(MOD, o).dmg; };
  K('fz_ko',      { atkBench: [inst(PIPPI.id, { damage: 180 })], defCard: DRAG.id });
  K('fz_alive',   { atkBench: [inst(PIPPI.id)], defCard: DRAG.id });
  K('fz_none',    { atkBench: [inst(V130.id)], defCard: DRAG.id });
  K('fz_cave',    { atkBench: [inst(PIPPI.id)], defCard: DRAG.id, stadium: CAVE.id });
  K('fz_tower',   { atkBench: [inst(PIPPI.id)], defCard: DRAG.id, stadium: TOWER?.id });
  K('ph_ko',      { atkBench: [inst(HOTA.id, { damage: 70 }), inst(DENJI.id)], defCard: WEAKP.id });
  K('ph_alive',   { atkBench: [inst(HOTA.id), inst(DENJI.id)], defCard: WEAKP.id });
  K('ph_nodenji', { atkBench: [inst(HOTA.id)], defCard: WEAKP.id });
  K('ph_nohota',  { atkBench: [inst(DENJI.id)], defCard: WEAKP.id });
  K('ph_denjiko', { atkBench: [inst(DENJI.id, { damage: 70 }), inst(HOTA.id)], defCard: WEAKP.id });
  K('ph_cave',    { atkBench: [inst(HOTA.id), inst(DENJI.id)], defCard: WEAKP.id, stadium: CAVE.id });
  // 絕佳費洛蒙的「**雙方**」那一半：持有者在防守方備戰、被同一招（冰雹）打死
  const W = (k, o) => { m[k] = sambaHail(MOD, o).activeDmg; };
  W('pw_ko',     { defActive: inst(WEAKW.id), defBench: [inst(HOTA.id, { damage: 50 }), inst(DENJI.id)] });
  W('pw_alive',  { defActive: inst(WEAKW.id), defBench: [inst(HOTA.id), inst(DENJI.id)] });
  W('pw_nohota', { defActive: inst(WEAKW.id), defBench: [inst(DENJI.id)] });
  W('pw_denjiko',{ defActive: inst(WEAKW.id), defBench: [inst(HOTA.id), inst(DENJI.id, { damage: 50 })] });
  return m;
}

const HEAD = await bundleFrom(join(ROOT, 'src'), 'head');
const H = matrix(HEAD);
// benchN*100 + prizes ⇒ 例：2 隻備戰存活 ＋ 拿 1 張獎賞 ＝ 201
const B2 = (n, p) => n * 100 + p;

console.log('\n【A】⭐⭐⭐(丙) 樂天河童｜生機森巴 —— 持有者被**同一招**打死 ⇒ 最大 HP +40 仍然算數');
chk('A1 ⭐⭐⭐病灶情境（黑曜石，pendingSelection 路徑）：持有者在戰鬥位被同一招打死 ⇒ '
  + '備戰兩隻 HP130 仍以 170 判定 ⇒ **全部存活**、獎賞只有 1 張（樂天河童自己）',
  H.sb_ko_active === B2(2, 1), 'got=' + H.sb_ko_active + ' want=' + B2(2, 1));
chk('A2 ⭐⭐病灶情境（黑曜石）：持有者在**備戰**被同一招打死 ⇒ 另一隻備戰仍然存活、獎賞 1 張',
  H.sb_ko_bench === B2(1, 1), 'got=' + H.sb_ko_bench + ' want=' + B2(1, 1));
chk('A3 ⭐⭐⭐病灶情境（冰雹，**無** pendingSelection 路徑 —— 真因第二層 sanityKOSweep 就在這裡）：'
  + '持有者在戰鬥位被同一招打死 ⇒ 備戰（damage 120 ＋30 ＝150）以 170 判定 ⇒ 存活、獎賞 1 張',
  H.sh_ko_active === B2(1, 1), 'got=' + H.sh_ko_active + ' want=' + B2(1, 1));
chk('A4 ⭐正對照：持有者活著 ⇒ 同一盤面備戰照樣存活（黑曜石 2 隻 0 獎賞／冰雹 1 隻 0 獎賞）',
  H.sb_alive_active === B2(2, 0) && H.sb_stay_bench === B2(2, 0) && H.sh_alive === B2(1, 0),
  JSON.stringify([H.sb_alive_active, H.sb_stay_bench, H.sh_alive]));
chk('A5 ⭐條件反對照：場上**沒有**生機森巴 ⇒ 備戰全部被 KO（黑曜石 0 隻 2 獎賞／冰雹 0 隻 2 獎賞）',
  H.sb_none === B2(0, 2) && H.sh_none === B2(0, 2), JSON.stringify([H.sb_none, H.sh_none]));
chk('A6 ⭐⭐「不重複」：兩隻樂天河童都被同一招打死 ⇒ 仍然只 +40（若誤疊成 +80 這一條也會綠，'
  + '所以真正把兩者分開的是 A7 的獎賞數）；此處鎖住「備戰存活 ＋ 獎賞 ＝ 兩隻持有者」',
  H.sb_dup_both_ko === B2(1, 2), 'got=' + H.sb_dup_both_ko + ' want=' + B2(1, 2));
chk('A6b ⭐⭐⭐**數值鎖**＋「不重複」：受惠者 damage 50 ⇒ 受 130 ＝ 180，以最大 HP 170 判定 ⇒ **被 KO**。'
  + '場上 1 隻持有者與 2 隻持有者的結果**完全一樣**（都 KO）⇒ 沒有疊加成 +80（那會變成 210 ⇒ 存活）',
  H.sb_amt_one === B2(1, 1) && H.sb_amt_two === B2(2, 1),
  JSON.stringify({ one: H.sb_amt_one, two: H.sb_amt_two, wantOne: B2(1, 1), wantTwo: B2(2, 1) }));
chk('A6c ⭐⭐**數值鎖**：持有者被同一招打死時，救回來的是「**剛好 +40**」而不是「無限」——'
  + '備戰兩隻 damage 50 的受 130 ＝ 180，仍然以 170 判定 ⇒ 照樣被 KO（0 隻存活、獎賞 3 張）',
  H.sb_amt_ko === B2(0, 3), 'got=' + H.sb_amt_ko + ' want=' + B2(0, 3));
chk('A7 ⭐⭐零變更（v6.375 的教訓）：兩隻持有者、只死一隻（另一隻還活著）⇒ live 那一半本來就成立 '
  + '⇒ 備戰 2 隻存活、獎賞 1 張',
  H.sb_dup_ko === B2(2, 1), 'got=' + H.sb_dup_ko + ' want=' + B2(2, 1));
chk('A8 ⭐⭐主動移除反對照：持有者被搬到**手牌／牌庫** ⇒ **不**算數（備戰全滅、獎賞 3 張）',
  H.sb_hand === B2(0, 3) && H.sb_deck === B2(0, 3), JSON.stringify([H.sb_hand, H.sb_deck]));
chk('A9 ⭐⭐特性消除反對照：【傳說的熔岩洞】消除進化寶可夢特性（樂天河童是 2 階）⇒ **不**生效；'
  + '持有者活著時同樣不生效',
  H.sb_cave === B2(0, 3) && H.sh_cave === B2(0, 2) && H.sb_cave_stay === B2(1, 1),
  JSON.stringify([H.sb_cave, H.sh_cave, H.sb_cave_stay]));

console.log('\n【B】⭐⭐(甲) 加傷 8 張 —— **實測沒有病灶**，本版只下行為鎖');
chk('B1 ⭐⭐⭐行為鎖：赫普的卡比獸｜大方 的持有者在**攻擊方備戰**被同一招（大地裂破的自方備戰 20）'
  + '打死 ⇒ 對手戰鬥位**照樣 170**（140+30），與持有者活著時逐字相同 ⇒ 加傷這一側不可能有病灶',
  H.gf_ko === 170 && H.gf_alive === 170 && H.gf_none === 140,
  JSON.stringify({ ko: H.gf_ko, alive: H.gf_alive, none: H.gf_none }));
chk('B2 ⭐卡面明文「不重複」：兩隻赫普的卡比獸 ⇒ 仍然只 +30（170，不是 200）',
  H.gf_dup === 170, 'got=' + H.gf_dup);
chk('B3 ⭐特性消除反對照：【火箭隊的監視塔】壓制【無】屬性持有者（赫普的卡比獸是【無】）⇒ 不加成',
  H.gf_tower === 140, 'got=' + H.gf_tower);
chk('B4 ⭐力之鹽（自方【鬥】）：沙螺蟒是【鬥】⇒ +30；持有者被同一招打死照樣 +30；'
  + '【傳說的熔岩洞】消除 2 階持有者 ⇒ 不加成',
  H.ps_alive === 170 && H.ps_ko === 170 && H.ps_cave === 140,
  JSON.stringify([H.ps_alive, H.ps_ko, H.ps_cave]));
chk('B5 ⭐皇家聲援（無條件 +20）：170 →（熔岩洞消除 2 階持有者）140',
  H.rc_alive === 160 && H.rc_cave === 140, JSON.stringify([H.rc_alive, H.rc_cave]));
chk('B6 ⭐原始心得（只對對手戰鬥場的**進化**寶可夢）：對進化靶 +30、對【基礎】靶 +0',
  H.pm_evo === (Number(BIG.hp) >= 0 ? 170 : -1) && H.pm_basic === -1,
  JSON.stringify({ evo: H.pm_evo, basic: H.pm_basic, bigStage: BIG?.stage ?? BIG?.subtype, v130Stage: V130?.stage ?? V130?.subtype }));
chk('B7 ⭐條件反對照（四張各自的條件都不成立 ⇒ 一律不加成，維持 140）：'
  + '輝煌聲援（要「竹蘭的」）／大晴天（要【草】或【火】）／鈷藍指令（要「未來」）／勝利聲援（要【火】進化）',
  H.bs_no === 140 && H.sd_no === 140 && H.cb_no === 140 && H.vc_no === 140,
  JSON.stringify([H.bs_no, H.sd_no, H.cb_no, H.vc_no]));

console.log('\n【B-scan】⭐ 不可觸發性（資料驅動 —— 卡池一變就紅）');
{
  const atks = [];
  for (const c of all) {
    if (c.supertype !== 'Pokemon' || !HIJ(c)) continue;
    for (const a of (c.attacks || [])) atks.push({ c, a, e: String(a.effect || '') });
  }
  // (1) 會讓「自己的備戰寶可夢受到傷害」的招式 —— 它們的 damage 欄位必須全部非空
  //     （＝對對手戰鬥位的主傷害先結算完，攻擊方備戰才受傷）。
  const selfBench = atks.filter(x => /自己的.{0,8}(所有備戰寶可夢|[0-9１-９]隻備戰寶可夢).{0,8}(也各?受到|受到)/.test(x.e));
  const noDamage = selfBench.filter(x => !String(x.a.damage || '').trim());
  chk('B8 ⭐⭐⭐不可觸發性①：全卡池 H/I/J 中「讓**自己的**備戰寶可夢受到傷害」的招式共 '
    + selfBench.length + ' 條，**每一條的 damage 欄位都非空** ⇒ 對對手戰鬥寶可夢的主傷害'
    + '（含加傷與弱點）必定先結算 ⇒ 攻擊方的持有者不可能在那之前昏厥離場',
    selfBench.length >= 15 && noDamage.length === 0,
    JSON.stringify({ n: selfBench.length, bad: noDamage.map(x => x.c.name + '｜' + x.a.name) }));
  // (2) 反擊型特性一律只打「使用招式的寶可夢」＝攻擊者本人（戰鬥位），打不到攻擊方備戰。
  const abil = [];
  for (const c of all) { if (c.supertype !== 'Pokemon' || !HIJ(c)) continue; for (const a of (c.abilities || [])) abil.push({ c, a, e: String(a.effect || '') }); }
  const counters = abil.filter(x => /受到.{0,12}招式.{0,12}傷害時/.test(x.e) && /傷害指示物|點傷害/.test(x.e));
  // ⚠ 卡面有兩種措辭：「**在**使用招式的寶可夢身上放置 N 個」與「…放置**於**使用招式的
  //   寶可夢身上」（布里卡隆｜尖刺盔甲、拖拖蚓ex｜快掃拳返）。兩種的主詞都是攻擊者本人。
  const notSelfOnly = counters.filter(x => !/使用招式的寶可夢身上/.test(x.e));
  chk('B9 ⭐⭐不可觸發性②：全卡池 H/I/J 的「受到招式傷害時反擊」特性共 ' + counters.length
    + ' 條，**每一條**都只在「使用招式的寶可夢」（＝攻擊者本人、必在戰鬥位）身上放指示物 '
    + '⇒ 反擊打不到攻擊方的備戰持有者',
    counters.length >= 10 && notSelfOnly.length === 0,
    JSON.stringify({ n: counters.length, bad: notSelfOnly.map(x => x.c.name + '｜' + x.a.name) }));
}

console.log('\n【C】⭐(乙) 弱點 2 張 —— **實測沒有病灶**，本版只下行為鎖');
chk('C1 ⭐⭐行為鎖：莉莉艾的皮皮ex｜妖精領域 的持有者在攻擊方備戰被同一招打死 ⇒ '
  + '對【龍】靶照樣 60（＝【超】30 ×2，弱點已改【超】），與活著時逐字相同；沒有持有者 ⇒ 30',
  H.fz_ko === 60 && H.fz_alive === 60 && H.fz_none === 30,
  JSON.stringify({ ko: H.fz_ko, alive: H.fz_alive, none: H.fz_none }));
chk('C2 ⭐特性消除反對照：皮皮ex 是【基礎】⇒【傳說的熔岩洞】打不到它；是【超】⇒【火箭隊的監視塔】'
  + '（只壓制【無】）也打不到它 ⇒ 兩種競技場卡下都仍然 60（這正是 v6.202 的既有行為）',
  H.fz_cave === 60 && H.fz_tower === 60, JSON.stringify([H.fz_cave, H.fz_tower]));
chk('C3 ⭐⭐行為鎖：甜甜螢｜絕佳費洛蒙（攻擊方側）持有者被同一招打死 ⇒ 弱【超】靶照樣 90（30×3）；'
  + '**前提卡「電螢蟲」**被同一招打死也照樣 90',
  H.ph_ko === 90 && H.ph_alive === 90 && H.ph_denjiko === 90,
  JSON.stringify({ ko: H.ph_ko, alive: H.ph_alive, denjiko: H.ph_denjiko }));
chk('C4 ⭐條件反對照：沒有「電螢蟲」⇒ 只有 ×2（60）；沒有甜甜螢 ⇒ 也是 60；'
  + '熔岩洞打不到【基礎】的甜甜螢 ⇒ 仍 90',
  H.ph_nodenji === 60 && H.ph_nohota === 60 && H.ph_cave === 90,
  JSON.stringify([H.ph_nodenji, H.ph_nohota, H.ph_cave]));
chk('C5 ⭐⭐卡面「**雙方**的戰鬥寶可夢」那一半：持有者在**防守方備戰**被同一招（冰雹）打死 ⇒ '
  + '防守方戰鬥位照樣 ×3（90）；沒有甜甜螢 ⇒ 60',
  H.pw_ko === 90 && H.pw_alive === 90 && H.pw_denjiko === 90 && H.pw_nohota === 60,
  JSON.stringify({ ko: H.pw_ko, alive: H.pw_alive, denjiko: H.pw_denjiko, nohota: H.pw_nohota }));

console.log('\n【D】⭐ 中央性（Rule 38：一個判準一份）');
const readSrc = (rel) => readFileSync(join(ROOT, 'src', rel), 'utf8');
const engSrc = readSrc('lib/game/engine.ts');
const asof = readSrc('lib/game/as-of-declaration.ts');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
const count = (t, s) => t.split(s).length - 1;
chk('D1 ⭐⭐「生機森巴」在 AS_OF_DECLARATION_ABILITIES 名單裡（而且只登記一次）',
  /AS_OF_DECLARATION_ABILITIES[\s\S]*?'生機森巴',[\s\S]*?\n\];/.test(asof)
  && count(stripComments(asof), "'生機森巴'") === 1,
  'count=' + count(stripComments(asof), "'生機森巴'"));
/** 擷取 `export const <NAME>: readonly string[] = [` 到最近一個 `\n];` 之間的清單本體。 */
const listBody = (src, name) => {
  const a = src.indexOf('export const ' + name);
  if (a < 0) return null;
  const b = src.indexOf('\n];', a);
  return b < 0 ? null : src.slice(a, b);
};
{
  const bodyAll = listBody(asof, 'AS_OF_DECLARATION_ABILITIES');
  const bodyActive = listBody(asof, 'AS_OF_DECLARATION_ACTIVE_ONLY_ABILITIES');
  const bodyCounted = listBody(asof, 'AS_OF_DECLARATION_COUNTED_CARD_NAMES');
  chk('D2 ⭐⭐它在 AS_OF_DECLARATION_ABILITIES 裡，但**不是** active-only、也**不是**依卡名計數'
    + '（卡面是「只要這隻寶可夢在**場上**」、「無論有多少隻擁有這個特性的寶可夢」）',
    !!bodyAll && !!bodyActive && !!bodyCounted
    && bodyAll.includes("'生機森巴'")
    && !bodyActive.includes("'生機森巴'")
    && !bodyCounted.includes("'樂天河童'") && !bodyCounted.includes("'生機森巴'"),
    JSON.stringify({ inAll: bodyAll?.includes("'生機森巴'"), inActive: bodyActive?.includes("'生機森巴'"),
      inCounted: bodyCounted?.includes("'樂天河童'") }));
}
{
  const eng = stripComments(engSrc);
  chk('D3 ⭐⭐engine.ts 的消費點**沒有**自己讀 `_attackTimeHolders`（只透過中央入口 '
    + 'asOfDeclarationHolderIids）—— 全檔只在「set」與「clear」兩處出現',
    count(eng, '_attackTimeHolders') === 3 && count(eng, '_v6376HolderIids(') === 1,
    JSON.stringify({ holders: count(eng, '_attackTimeHolders'), entry: count(eng, '_v6376HolderIids(') }));
  chk('D4 ⭐⭐⭐clear 只有一處，而且排在 **sanityKOSweep 之後**（本版的真因第二層；'
    + '排在前面 ⇒ 剛救活的備戰會被 sweep 用「沒有快照」的最大 HP 再殺一次）',
    count(eng, 'delete cleared._attackTimeHolders') === 1
    && eng.indexOf('delete cleared._attackTimeHolders') > eng.lastIndexOf('sanityKOSweep(next,'),
    JSON.stringify({
      clears: count(eng, 'delete cleared._attackTimeHolders'),
      clearAt: eng.indexOf('delete cleared._attackTimeHolders'),
      sweepAt: eng.lastIndexOf('sanityKOSweep(next,'),
    }));
  chk('D5 ⭐clear 仍然保留「pendingSelection 還在時不清」（跨 picker 的 resolver 要讀得到）',
    /delete cleared\._attackTimeHolders/.test(eng)
    && /_attackTimeHolders !== undefined && !next\.pendingSelection/.test(eng),
    'ok');
  chk('D6 ⭐哨兵：本版對 engine.ts 的每一處改動都有 v6376 標記（三個哨兵區塊 ＋ 兩行 ⭐v6376 標註）',
    count(engSrc, '>>> v6376-') === 4 && count(engSrc, '<<< v6376-') === 4
    && count(engSrc, '// ⭐v6376-samba-side-index') === 1
    && count(engSrc, '// ⭐v6376-samba-as-of') === 1,
    JSON.stringify({ open: count(engSrc, '>>> v6376-'), close: count(engSrc, '<<< v6376-') }));
}
chk('D7 ⭐ test-v6265 的剝除鏈最外層已經是 stripV6376Engine',
  (() => {
    const t = readFileSync(join(ROOT, 'scripts/test-v6265-phantom-start-race.mjs'), 'utf8');
    return t.includes('const stripV6376Engine = (src) => {')
      && count(t, 'const s0 = stripV6376Engine(stripV6373Engine(') === 2;
  })(), 'ok');

// ══════════════════════════════════════════════════════════════════════════════
// 【E】HEAD-FAIL 對 BASE（hasBaseCommit 保護、淺複製 shallowSkip）
// ══════════════════════════════════════════════════════════════════════════════
const BASE = process.env.V6376_BASE || BASE_SHA;
console.log('\n【E】HEAD-FAIL：對 BASE(' + BASE.slice(0, 8) + ' ＝ v6.375，本版的上一版) 重跑整個行為矩陣');
if (!hasBaseCommit(ROOT, BASE)) {
  shallowSkip('【E】HEAD-FAIL 對 BASE 的重建比對', '【0】~【D】都不需要歷史，仍在守');
} else {
  const baseSrc = join(TMP, 'base-src');
  cpSync(join(ROOT, 'src'), baseSrc, { recursive: true });
  const r = restoreBaseSubtree(ROOT, BASE, baseSrc, 'src');
  if (chk('E0 BASE 樹重建成功（整個 src/ 子樹）', r.ok, r.reason ?? ('replaced=' + r.replaced + ' removed=' + r.removed))) {
    const bAsof = readBaseBlob(ROOT, BASE, 'src/lib/game/as-of-declaration.ts');
    chk('E0b ⭐結構 BASE 一定要紅：BASE 的 AS_OF_DECLARATION_ABILITIES **沒有**「生機森巴」；HEAD 有',
      bAsof.ok && !bAsof.out.includes("'生機森巴'") && asof.includes("'生機森巴'"),
      bAsof.ok ? 'ok' : 'readBaseBlob failed');
    const BMOD = await bundleFrom(baseSrc, 'base');
    const B = matrix(BMOD);
    chk('E1 哨兵：BASE bundle 是活的（不涉及本版修法的情境照樣綠，不是整支爆掉造成的「全紅」）',
      B.sb_alive_active === B2(2, 0) && B.sb_none === B2(0, 2) && B.gf_alive === 170 && B.fz_alive === 60
      && B.ph_alive === 90 && B.pw_alive === 90,
      JSON.stringify({ alive: B.sb_alive_active, none: B.sb_none, gf: B.gf_alive, fz: B.fz_alive, ph: B.ph_alive, pw: B.pw_alive }));
    chk('E2 ⭐⭐⭐(丙) BASE 一定要紅①（黑曜石／pendingSelection 路徑）：持有者在戰鬥位被同一招打死 '
      + '⇒ BASE 備戰**全滅、獎賞 3 張**；HEAD 備戰 2 隻存活、獎賞 1 張',
      B.sb_ko_active === B2(0, 3) && H.sb_ko_active === B2(2, 1),
      'BASE=' + B.sb_ko_active + ' HEAD=' + H.sb_ko_active);
    chk('E3 ⭐⭐⭐(丙) BASE 一定要紅②（冰雹／無 pending 路徑，真因第二層）：'
      + 'BASE 備戰被 KO（0 隻、獎賞 2 張）；HEAD 存活（1 隻、獎賞 1 張）',
      B.sh_ko_active === B2(0, 2) && H.sh_ko_active === B2(1, 1),
      'BASE=' + B.sh_ko_active + ' HEAD=' + H.sh_ko_active);
    chk('E4 ⭐⭐(丙) BASE 一定要紅③：持有者在**備戰**被同一招打死 ⇒ BASE 0 隻/2 張、HEAD 1 隻/1 張',
      B.sb_ko_bench === B2(0, 2) && H.sb_ko_bench === B2(1, 1),
      'BASE=' + B.sb_ko_bench + ' HEAD=' + H.sb_ko_bench);
    chk('E5 ⭐⭐(丙) BASE 一定要紅④：兩隻持有者都被同一招打死 ⇒ BASE 0 隻/3 張、HEAD 1 隻/2 張',
      B.sb_dup_both_ko === B2(0, 3) && H.sb_dup_both_ko === B2(1, 2),
      'BASE=' + B.sb_dup_both_ko + ' HEAD=' + H.sb_dup_both_ko);
    chk('E6 ⭐⭐零變更（v6.375 的教訓）：兩隻持有者只死一隻 ⇒ live 那一半本來就成立 ⇒ BASE ≡ HEAD',
      B.sb_dup_ko === H.sb_dup_ko && H.sb_dup_ko === B2(2, 1),
      JSON.stringify([B.sb_dup_ko, H.sb_dup_ko]));
    chk('E7 ⭐⭐零變更：持有者活著／沒有持有者 ⇒ BASE 與 HEAD 逐條相同',
      B.sb_alive_active === H.sb_alive_active && B.sb_stay_bench === H.sb_stay_bench
      && B.sb_none === H.sb_none && B.sh_alive === H.sh_alive && B.sh_none === H.sh_none
      && B.sh_oppside === H.sh_oppside
      // ⭐數值情境：持有者活著（前兩個）⇒ 與本版修法無關，必須逐字相同；
      //   sb_amt_ko 是「持有者死了但受惠者照樣該死」⇒ BASE 與 HEAD 也必須相同（沒有過度救活）。
      && B.sb_amt_one === H.sb_amt_one && B.sb_amt_two === H.sb_amt_two
      && B.sb_amt_ko === H.sb_amt_ko,
      JSON.stringify([B.sb_alive_active, B.sb_stay_bench, B.sb_none, B.sh_alive, B.sh_none]));
    chk('E8 ⭐⭐零變更：被主動移除（手牌／牌庫）與特性被消除（熔岩洞）⇒ BASE 與 HEAD 都不生效',
      B.sb_hand === H.sb_hand && B.sb_deck === H.sb_deck && B.sb_cave === H.sb_cave
      && B.sh_cave === H.sh_cave && B.sb_cave_stay === H.sb_cave_stay,
      JSON.stringify([B.sb_hand, B.sb_deck, B.sb_cave, B.sh_cave, B.sb_cave_stay]));
    chk('E9 ⭐⭐⭐零變更：(甲) 加傷 8 張的**每一個**情境 BASE 與 HEAD 逐條相同'
      + '（本版對它們一個字都沒改，只下行為鎖）',
      ['gf_ko', 'gf_alive', 'gf_none', 'gf_dup', 'gf_tower', 'ps_alive', 'ps_ko', 'ps_cave',
        'rc_alive', 'rc_cave', 'pm_evo', 'pm_basic', 'bs_no', 'sd_no', 'cb_no', 'vc_no']
        .every(k => B[k] === H[k]),
      JSON.stringify(['gf_ko', 'gf_alive', 'gf_none', 'gf_dup', 'gf_tower', 'ps_alive', 'ps_ko', 'ps_cave',
        'rc_alive', 'rc_cave', 'pm_evo', 'pm_basic', 'bs_no', 'sd_no', 'cb_no', 'vc_no']
        .filter(k => B[k] !== H[k]).map(k => k + ':' + B[k] + '/' + H[k])));
    chk('E10 ⭐⭐⭐零變更：(乙) 弱點 2 張的**每一個**情境 BASE 與 HEAD 逐條相同',
      ['fz_ko', 'fz_alive', 'fz_none', 'fz_cave', 'fz_tower', 'ph_ko', 'ph_alive', 'ph_nodenji',
        'ph_nohota', 'ph_denjiko', 'ph_cave', 'pw_ko', 'pw_alive', 'pw_nohota', 'pw_denjiko']
        .every(k => B[k] === H[k]),
      JSON.stringify(['fz_ko', 'fz_alive', 'fz_none', 'fz_cave', 'fz_tower', 'ph_ko', 'ph_alive', 'ph_nodenji',
        'ph_nohota', 'ph_denjiko', 'ph_cave', 'pw_ko', 'pw_alive', 'pw_nohota', 'pw_denjiko']
        .filter(k => B[k] !== H[k]).map(k => k + ':' + B[k] + '/' + H[k])));
  }
}

console.log('\n=== v6.376 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail === 0 ? 0 : 1);
