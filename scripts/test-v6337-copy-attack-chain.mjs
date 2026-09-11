// v6.337 守衛 —— 借招（複製他人招式）鏈：中央管線 + 玩家回報的 bug
//
// 玩家回報：「呆呆王｜耀閃挑戰」翻出「火箭隊的謎擬Ｑ」，再用「扮晶晶酒」學對手太晶寶可夢
//   「多龍巴魯托ex」的招式時，**永遠只會用到第 1 招【噴射頭擊】**，選不到第 2 招【幻影奇襲】。
//
// 真因（結構性，不是單張卡）：
//   `action.copyAttackChoice` 是單層 `{pokeIid, attackIndex}`，但借招可以鏈式
//   （官方 PTCG_RULES **L2276~2277** 明文允許），而全站 8 張借招卡**都把同一個 action
//   原封往下傳**，且「怎麼讀 choice」各自手寫一份、驗證程度不一：
//   扮晶晶酒完全不驗 `pokeIid` ⇒ 上一層的「謎擬Ｑ 的第 0 招」被拿去索引多龍巴魯托ex 的招式陣列。
//
// 本版收斂到 `src/lib/game/copy-attack.ts`：
//   `copyAttackCandidates()`（候選枚舉，規則層與 UI 共用）＋ `pickCopiedAttack()`（選招唯一判準）
//   ＋ `_shared.dispatchCopiedAttack()`（轉接被借招式的唯一出口，負責推堆疊與往下傳剩餘鏈）。
//
// 斷言一律走**行為端**（真的 `applyAction`），靜態只用在行為端測不到的地方。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { withSeededRandom } from './lib/seeded-rng.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '3b95c5dc6690da80149ad9375dc7422cf14e93b9';   // v6.336（v6.337 的上一版）

let pass = 0, fail = 0;
const redAtBase = [];
const chk = (name, ok, extra = '') => {
  if (ok) { console.log('  PASS ' + name); pass++; } else { console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); fail++; }
  return !!ok;
};

// ── 卡池 ──────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const byName = (n, pred = () => true) => [...pool.values()].find(c => c.name === n && pred(c));

const SLOWKING = byName('呆呆王', c => (c.attacks ?? []).some(a => a.name === '耀閃挑戰'));
const MIMIKYU = byName('火箭隊的謎擬Ｑ', c => (c.attacks ?? []).some(a => a.name === '扮晶晶酒'));
const DRAGA = byName('多龍巴魯托ex', c => (c.tags ?? []).includes('太晶') && (c.attacks ?? []).length >= 2);
const CLEFABLE = byName('皮可西', c => (c.attacks ?? []).some(a => a.name === '揮指'));
const MEOWTH = byName('火箭隊的貓老大ex', c => (c.attacks ?? []).some(a => a.name === '高傲指令'));
const PSY = byName('基本【超】能量');
const FIRE = byName('基本【火】能量');
// ⚠ 借招卡橫跨【超】【惡】【無】等屬性，測試盤面一律附滿 8 種基本能量各 1 張＋3 張【超】，
//   免得某一張卡因為能量不足而根本出不了招（那會讓斷言「碰巧全綠」＝空真）。
const ALL_BASIC = ['基本【草】能量', '基本【火】能量', '基本【水】能量', '基本【雷】能量',
  '基本【超】能量', '基本【鬥】能量', '基本【惡】能量', '基本【鋼】能量'].map(n => byName(n)).filter(Boolean);
const TM = [...pool.values()].find(c => c.subtype === 'PokemonTool' && (c.attacks ?? []).length > 0);

// Rule 25：fixture 自己要先驗，抽不到卡就大聲紅，不可以靜默全綠
chk('fixture：8 種基本能量都抓得到（盤面附滿，避免因能量不足而出不了招）', ALL_BASIC.length === 8, String(ALL_BASIC.length));
chk('fixture：8 張借招卡與對照卡都抓得到',
  !!(SLOWKING && MIMIKYU && DRAGA && CLEFABLE && MEOWTH && PSY && FIRE),
  JSON.stringify({ SLOWKING: SLOWKING?.id, MIMIKYU: MIMIKYU?.id, DRAGA: DRAGA?.id, CLEFABLE: CLEFABLE?.id, MEOWTH: MEOWTH?.id }));
chk('fixture：多龍巴魯托ex 的兩招順序是 [噴射頭擊, 幻影奇襲]（index 語意的前提）',
  (DRAGA?.attacks ?? []).map(a => a.name).join(',') === '噴射頭擊,幻影奇襲',
  JSON.stringify((DRAGA?.attacks ?? []).map(a => a.name)));

// ── harness ──────────────────────────────────────────────────────────────────
const TMP = mkdtempSync(join(tmpdir(), 'v6337-'));
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* noop */ } });

const STRAY = [];
process.on('exit', () => { for (const p of STRAY) { try { unlinkSync(p); } catch { /* noop */ } } });

/**
 * 從指定的 src 樹 bundle 出 engine。
 * ⚠ entry 必須寫在 srcDir 的**父目錄**、用相對路徑 import ——
 *   Windows 的 `E:/…` 絕對路徑會被 esbuild 當成套件名（踩過）。
 */
async function bundleFrom(srcDir, tag, body) {
  const parent = dirname(srcDir);
  const name = srcDir.slice(parent.length + 1).replace(/\\/g, '/');
  const S = join(parent, `.v6337-s-${tag}.js`), E = join(parent, `.v6337-e-${tag}.ts`), O = join(parent, `.v6337-o-${tag}.mjs`);
  STRAY.push(S, E, O);
  writeFileSync(S, 'export const base="";');
  writeFileSync(E, body(`./${name}`));
  await build({
    entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(srcDir, 'lib'), '$app/paths': S }, logLevel: 'silent',
  });
  return import(pathToFileURL(O).href);
}

const ENGINE_ENTRY = (p) =>
  `export { ATTACK_PRE, ATTACK_POST } from '${p}/lib/game/effects/_shared';\n`
  + `export { applyAction } from '${p}/lib/game/engine';\n`
  + `import '${p}/lib/game/effects';\n`;
// ⚠ BASE 樹沒有 copy-attack.ts ⇒ 只有 HEAD 的 entry 可以 re-export 中央管線
const HEAD_ENTRY = (p) => ENGINE_ENTRY(p)
  + `export { copyAttackCandidates, pickCopiedAttack, copyAttackChainOf, withCopyAttackChain,\n`
  + `         COPY_ATTACK_KEYS, COPY_ATTACK_MAX_DEPTH, isCopyAttackKey, copyAttackDepth } from '${p}/lib/game/copy-attack';\n`;

const HEAD = await bundleFrom(join(ROOT, 'src'), 'head', HEAD_ENTRY);
// 中央管線本身（單元測試用）—— 與 engine 同一個 bundle，少一個會出錯的環節
const CA = typeof HEAD?.pickCopiedAttack === 'function' ? HEAD : null;

// ── 盤面 ─────────────────────────────────────────────────────────────────────
let seq = 0;
const inst = (id, extra = {}) => ({ cardId: String(id), iid: 'i' + (++seq), damage: 0, energyAttached: [], toolAttached: null, ...extra });

function board({ myActive, myDeck = [], oppActive, oppBench = [], oppDeck = [], myHand = [] }) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    players: [
      { name: 'P1', active: myActive, bench: [], hand: myHand, deck: myDeck, discard: [], prizes: Array.from({ length: 6 }, () => inst(MIMIKYU.id)) },
      { name: 'P2', active: oppActive, bench: oppBench, hand: [], deck: oppDeck, discard: [], prizes: Array.from({ length: 6 }, () => inst(DRAGA.id)) },
    ],
  };
}
// ⚠ 每種基本能量各**兩張** —— 「N的索羅亞克ex｜暗黑底牌」的費用是【惡】【惡】，
//   只附一張的話 applyAction 會直接拒絕出招、log 一行都不會有（斷言就變成空真）。
const ENERGIES = () => [inst(PSY.id), inst(PSY.id), inst(PSY.id), inst(FIRE.id), inst(FIRE.id),
  ...ALL_BASIC.map(c => inst(c.id)), ...ALL_BASIC.map(c => inst(c.id))];

/** 玩家回報的那條鏈：呆呆王｜耀閃挑戰 → 火箭隊的謎擬Ｑ｜扮晶晶酒 → 多龍巴魯托ex 的第 n 招 */
function runReportedChain(mod, secondLayerIdx) {
  const slow = inst(SLOWKING.id, { energyAttached: ENERGIES() });
  const mimi = inst(MIMIKYU.id);
  const draga = inst(DRAGA.id);
  const st = board({ myActive: slow, myDeck: [mimi, inst(MIMIKYU.id)], oppActive: draga, oppBench: [inst(DRAGA.id), inst(DRAGA.id)], oppDeck: [inst(DRAGA.id)] });
  const action = { type: 'ATTACK', attackIndex: 0, copyAttackChoice: { pokeIid: mimi.iid, attackIndex: 0 } };
  if (secondLayerIdx != null) action.copyAttackChain = [{ pokeIid: draga.iid, attackIndex: secondLayerIdx }];
  const out = mod.applyAction(st, action, pool);
  return {
    damage: out.players[1].active?.damage ?? -1,
    logs: out.log.map(l => (typeof l === 'string' ? l : (l?.message ?? ''))).join('\n'),
    pending: out.pendingSelection ?? null,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【A】行為端：玩家回報的那條借招鏈（真跑 applyAction）');

const A_NONE = runReportedChain(HEAD, null);
const A0 = runReportedChain(HEAD, 0);
const A1 = runReportedChain(HEAD, 1);

// ⭐ 哨兵（Rule 23/41）：這一條在 BASE 也必須綠 —— 證明 HEAD-FAIL 不是「整支爆掉」
chk('A0 ⭐哨兵：耀閃挑戰確實借到了「火箭隊的謎擬Ｑ｜扮晶晶酒」（BASE 也該綠）',
  /耀閃挑戰：選擇「火箭隊的謎擬Ｑ」的「扮晶晶酒」/.test(A0.logs));

chk('A1 ⭐⭐⭐ 第 2 層選 index 0（噴射頭擊）⇒ 70 傷害（玩家回報選不到的那一邊）',
  A0.damage === 70, '實得 ' + A0.damage);
chk('A2 ⭐ 第 2 層選 index 1（幻影奇襲）⇒ 200 傷害且開 6 指示物 picker',
  A1.damage === 200 && !!A1.pending, '傷害 ' + A1.damage + ' pending=' + (A1.pending ? A1.pending.type : 'null'));
// ⚠ Rule 39：要證明「第 2 層的選擇真的被讀」，兩個選項必須給出**不同**答案
chk('A3 ⭐ 反安慰劑：兩個第 2 層選項給出不同結果（否則 A1/A2 只是碰巧同值）',
  A0.damage !== A1.damage, `${A0.damage} vs ${A1.damage}`);
chk('A4 沒有第 2 層鏈時 fallback＝印刷最高（200），不是把第 1 層的 index 0 拿來用（70）',
  A_NONE.damage === 200, '實得 ' + A_NONE.damage);
chk('A5 log 要說清楚是玩家選的還是 fallback',
  /扮晶晶酒：扮演 多龍巴魯托ex 的「噴射頭擊」（玩家選擇）/.test(A0.logs)
  && /扮晶晶酒：扮演 多龍巴魯托ex 的「幻影奇襲」（自動挑印刷最高）/.test(A_NONE.logs));

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【B】中央判準 pickCopiedAttack / copyAttackCandidates（單元）');

if (!CA) {
  chk('B0 讀得到 src/lib/game/copy-attack.ts', false, 'import 失敗');
} else {
  const C = (ownerIid, attackIndex, damage = 0) => ({ ownerIid, ownerCardId: '1', ownerName: 'X', attackIndex, attackName: 'a' + attackIndex, damage });
  const cands = [C('own1', 0, 30), C('own1', 1, 200), C('own2', 0, 10)];

  const hit = CA.pickCopiedAttack(cands, { copyAttackChoice: { pokeIid: 'own1', attackIndex: 1 }, copyAttackChain: [{ pokeIid: 'z', attackIndex: 9 }] });
  chk('B1 鏈首命中本層候選 ⇒ byPlayer=true、restChain 去掉第一格',
    hit.byPlayer === true && hit.candidate?.attackIndex === 1 && hit.restChain.length === 1 && hit.restChain[0].pokeIid === 'z');

  const miss = CA.pickCopiedAttack(cands, { copyAttackChoice: { pokeIid: '別隻寶可夢', attackIndex: 0 }, copyAttackChain: [{ pokeIid: 'own1', attackIndex: 0 }] });
  chk('B2 ⭐⭐⭐ 鏈首的 pokeIid 不是本層候選的持有者 ⇒ 不採用、且**整條鏈丟掉**（串味擋死點）',
    miss.byPlayer === false && miss.candidate?.attackIndex === 1 && miss.restChain.length === 0,
    JSON.stringify({ byPlayer: miss.byPlayer, idx: miss.candidate?.attackIndex, rest: miss.restChain.length }));

  const missIdx = CA.pickCopiedAttack(cands, { copyAttackChoice: { pokeIid: 'own1', attackIndex: 7 } });
  chk('B3 index 越界 ⇒ fallback（不是丟例外、也不是靜默用第 0 招）',
    missIdx.byPlayer === false && missIdx.candidate?.damage === 200);

  chk('B4 候選為空 ⇒ candidate=null（呼叫端自己寫 log）',
    CA.pickCopiedAttack([], { copyAttackChoice: { pokeIid: 'own1', attackIndex: 0 } }).candidate === null);

  chk('B5 fallback＝印刷傷害最高（同傷害取先出現者，維持 v2.57 起的既有行為）',
    CA.pickCopiedAttack(cands, undefined).candidate?.attackIndex === 1);

  chk('B6 COPY_ATTACK_KEYS 收錄 8 張借招卡（下限斷言，Rule 25）',
    Array.isArray(CA.COPY_ATTACK_KEYS) && CA.COPY_ATTACK_KEYS.length === 8
    && CA.COPY_ATTACK_KEYS.includes('火箭隊的謎擬Ｑ|扮晶晶酒') && CA.COPY_ATTACK_KEYS.includes('呆呆王|耀閃挑戰'),
    String(CA.COPY_ATTACK_KEYS?.length));
  chk('B7 COPY_ATTACK_MAX_DEPTH 有界且 ≥2', CA.COPY_ATTACK_MAX_DEPTH >= 2 && CA.COPY_ATTACK_MAX_DEPTH <= 8, String(CA.COPY_ATTACK_MAX_DEPTH));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【C】候選枚舉的規則正確性（卡面／官方裁定）');

if (CA) {
  const cand = (key, st) => CA.copyAttackCandidates(key, st, 0, pool, 0);

  // C1 扮晶晶酒：卡面限定「對手的戰鬥場的『太晶』寶可夢」
  const notTera = byName('皮可西', c => !(c.tags ?? []).includes('太晶'));
  const stNotTera = board({ myActive: inst(MIMIKYU.id, { energyAttached: ENERGIES() }), oppActive: inst((notTera ?? CLEFABLE).id) });
  const stTera = board({ myActive: inst(MIMIKYU.id, { energyAttached: ENERGIES() }), oppActive: inst(DRAGA.id) });
  chk('C1 扮晶晶酒：對手非「太晶」⇒ 0 候選；是太晶 ⇒ 2 候選',
    cand('火箭隊的謎擬Ｑ|扮晶晶酒', stNotTera).length === 0 && cand('火箭隊的謎擬Ｑ|扮晶晶酒', stTera).length === 2,
    `${cand('火箭隊的謎擬Ｑ|扮晶晶酒', stNotTera).length} / ${cand('火箭隊的謎擬Ｑ|扮晶晶酒', stTera).length}`);

  // C2 耀閃挑戰：卡面「（『擁有規則的寶可夢』除外）」
  const stRule = board({ myActive: inst(SLOWKING.id), myDeck: [inst(DRAGA.id)], oppActive: inst(DRAGA.id) });
  const stOk = board({ myActive: inst(SLOWKING.id), myDeck: [inst(MIMIKYU.id)], oppActive: inst(DRAGA.id) });
  chk('C2 耀閃挑戰：牌庫頂是「擁有規則的寶可夢」⇒ 0 候選；非規則 ⇒ 有候選',
    cand('呆呆王|耀閃挑戰', stRule).length === 0 && cand('呆呆王|耀閃挑戰', stOk).length > 0);

  // C3 揮指／欺詐／試著模仿：排除對手同名招（避免互相遞迴）
  const stMirror = board({ myActive: inst(CLEFABLE.id), oppActive: inst(CLEFABLE.id) });
  const mirrorCands = cand('皮可西|揮指', stMirror);
  chk('C3 揮指：對手也是皮可西時，候選不含「揮指」自己',
    mirrorCands.length === (CLEFABLE.attacks ?? []).length - 1 && !mirrorCands.some(c => c.attackName === '揮指'),
    `${mirrorCands.length} / ${(CLEFABLE.attacks ?? []).length}`);

  // C4 ⭐ 官方 L2059~2060：道具賦予的招式**不算**「這隻寶可夢持有的招式」
  if (TM) {
    const bare = board({ myActive: inst(MIMIKYU.id), oppActive: inst(DRAGA.id) });
    const withTool = board({ myActive: inst(MIMIKYU.id), oppActive: inst(DRAGA.id, { toolAttached: inst(TM.id) }) });
    chk('C4 ⭐官方L2060：對手掛上「' + TM.name + '」（帶招式的道具）後，候選數不變（道具招式不可借）',
      cand('火箭隊的謎擬Ｑ|扮晶晶酒', bare).length === cand('火箭隊的謎擬Ｑ|扮晶晶酒', withTool).length,
      `${cand('火箭隊的謎擬Ｑ|扮晶晶酒', bare).length} vs ${cand('火箭隊的謎擬Ｑ|扮晶晶酒', withTool).length}`);
  } else {
    chk('C4 fixture：找不到帶招式的道具卡（掃描器壞了？）', false);
  }

  // C5 ⭐ 官方 L2276~2277：高傲指令翻到另一張貓老大ex，「可以」選它的高傲指令
  const stMeowth = board({ myActive: inst(MEOWTH.id), oppActive: inst(DRAGA.id), oppDeck: [inst(MEOWTH.id)] });
  chk('C5 ⭐官方L2277：高傲指令的候選**包含**另一張貓老大ex 的「高傲指令」（舊碼把它排掉了）',
    cand('火箭隊的貓老大ex|高傲指令', stMeowth).some(c => c.attackName === '高傲指令'));

  // C6 深度上限：到達上限時排除所有借招招式（避免無界遞迴）
  const deep = CA.copyAttackCandidates('火箭隊的貓老大ex|高傲指令', stMeowth, 0, pool, CA.COPY_ATTACK_MAX_DEPTH - 1);
  chk('C6 到達深度上限時，候選排除所有借招招式（有界遞迴）',
    !deep.some(c => c.attackName === '高傲指令'));

  // C7 技能大盜：卡面 gate「若自己 1 張手牌都沒有」
  const foxCard = byName('狐大盜', c => (c.attacks ?? []).some(a => a.name === '技能大盜'));
  if (foxCard) {
    const empty = board({ myActive: inst(foxCard.id), oppActive: inst(DRAGA.id), myHand: [] });
    const hasHand = board({ myActive: inst(foxCard.id), oppActive: inst(DRAGA.id), myHand: [inst(MIMIKYU.id)] });
    chk('C7 技能大盜：手牌 >0 ⇒ 0 候選（卡面 gate 也收斂進候選枚舉）',
      cand('狐大盜|技能大盜', empty).length > 0 && cand('狐大盜|技能大盜', hasHand).length === 0);
  } else {
    chk('C7 fixture：找不到 狐大盜', false);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【D】POST 逐層回放：中間層的 POST 不可以被跳過');

// 皮可西｜揮指 借 火箭隊的貓老大ex｜高傲指令 ⇒ 卡面要求「翻到正面的卡放回牌庫並重洗」
//   舊碼 pendingCopyAttackKey 是單一槽位，會直接跳到最深那一層 ⇒ 重洗那一段永遠不執行。
function runFlickBorrowsRocket(mod) {
  const me = inst(CLEFABLE.id, { energyAttached: ENERGIES() });
  const meow = inst(MEOWTH.id);
  const deck = Array.from({ length: 12 }, () => inst(DRAGA.id));
  const st = board({ myActive: me, oppActive: meow, oppDeck: deck });
  const before = st.players[1].deck.map(c => c.iid).join(',');
  // 第 1 層：選對手貓老大ex 的「高傲指令」；第 2 層：選牌庫頂某張多龍巴魯托ex 的第 0 招
  const meowIdx = (MEOWTH.attacks ?? []).findIndex(a => a.name === '高傲指令');
  const action = {
    type: 'ATTACK', attackIndex: (CLEFABLE.attacks ?? []).findIndex(a => a.name === '揮指'),
    copyAttackChoice: { pokeIid: meow.iid, attackIndex: meowIdx },
    copyAttackChain: [{ pokeIid: deck[0].iid, attackIndex: 0 }],
  };
  const out = withSeededRandom(0x5eed1337, () => mod.applyAction(st, action, pool));
  return {
    before, after: out.players[1].deck.map(c => c.iid).join(','),
    logs: out.log.map(l => (typeof l === 'string' ? l : (l?.message ?? ''))).join('\n'),
  };
}
const D = runFlickBorrowsRocket(HEAD);
chk('D0 ⭐哨兵：揮指確實借到了「高傲指令」（BASE 也該綠）', /高傲指令/.test(D.logs));
chk('D1 ⭐⭐⭐ 中間層的 POST 有跑到：對手牌庫被重洗（卡面「放回牌庫並重洗」）',
  /高傲指令：對手牌庫重洗/.test(D.logs) && D.before !== D.after);

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【E】HEAD-FAIL：對 BASE(' + BASE_SHA.slice(0, 8) + ') 逐條列出紅了哪幾條');

const CHANGED = [
  'src/lib/game/types.ts',
  'src/lib/game/actions.ts',
  'src/lib/game/effects.ts',
  'src/lib/game/effects/_shared.ts',
  'src/lib/game/effects/cards/slowking_lucario_deck.ts',
  'src/lib/game/effects/cards/v2680_i_wave18_copy_attacks.ts',
  'src/lib/game/effects/cards/v2760_h_wave3_complex.ts',
  'src/lib/game/effects/cards/six_decks.ts',
  'src/lib/game/effects/cards/m5_preview.ts',
];

if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('【E】HEAD-FAIL 對 BASE 的重建比對', '需要歷史 commit；【A】【B】【C】【D】不需要歷史，仍在守');
} else {
  const baseLib = readBaseBlob(ROOT, BASE_SHA, 'src/lib/game/copy-attack.ts');
  chk('E0 ⭐Rule 41 哨兵：BASE 沒有 src/lib/game/copy-attack.ts（本版才新增）', baseLib.ok === false);

  const baseSrc = join(TMP, 'base-src');
  cpSync(join(ROOT, 'src'), baseSrc, { recursive: true });
  let rebuilt = true;
  for (const rel of CHANGED) {
    const b = readBaseBlob(ROOT, BASE_SHA, rel);
    if (!b.ok) { rebuilt = false; break; }
    const to = join(baseSrc, rel.replace(/^src\//, '').replace(/\//g, '/'));
    writeFileSync(to, b.out, 'utf8');
  }
  // 新檔在 BASE 不存在 ⇒ BASE 樹要把它拿掉（否則 BASE 樹其實是「半新半舊」）
  const newFile = join(baseSrc, 'lib/game/copy-attack.ts');
  if (existsSync(newFile)) rmSync(newFile, { force: true });
  chk('E1 BASE 樹重建成功（9 個改過的檔都換回 BASE blob，新檔已移除）', rebuilt && !existsSync(newFile));

  if (rebuilt) {
    const BASE = await bundleFrom(baseSrc, 'base', ENGINE_ENTRY);
    const b0 = runReportedChain(BASE, 0);
    const b1 = runReportedChain(BASE, 1);
    const bN = runReportedChain(BASE, null);
    const bD = runFlickBorrowsRocket(BASE);

    const sentinelOk = /耀閃挑戰：選擇「火箭隊的謎擬Ｑ」的「扮晶晶酒」/.test(b0.logs);
    chk('E2 ⭐哨兵在 BASE 必須**綠**（證明 HEAD-FAIL 不是整支爆掉）', sentinelOk);

    // ⚠⚠ Rule 39 的實例，寫下來給未來的人看：
    //   **A1（第 2 層選 index 0）在 BASE 上也是綠的** —— 因為 BASE 的「串味」剛好也給出 70：
    //   它把第 1 層的 `{謎擬Ｑ, 0}` 誤當成「多龍巴魯托ex 的第 0 招」＝噴射頭擊＝70。
    //   ⇒ A1 **不是**有效的 HEAD-FAIL 判別點（兩條路徑碰巧同值）。
    //   真正能判別的是 A2（選第 2 招）、A4（無鏈 fallback）與 D1（中間層 POST）。
    const reds = [];
    if (b0.damage !== 70) reds.push(`A1(第2層選噴射頭擊)=${b0.damage}≠70`);
    if (!(b1.damage === 200 && b1.pending)) reds.push(`A2(第2層選幻影奇襲)=${b1.damage}/pending=${!!b1.pending}`);
    if (bN.damage !== 200) reds.push(`A4(無鏈 fallback)=${bN.damage}≠200`);
    if (!(/高傲指令：對手牌庫重洗/.test(bD.logs) && bD.before !== bD.after)) reds.push('D1(中間層POST重洗)未發生');
    console.log('      BASE 上紅掉的條目：' + (reds.length ? reds.join(' ／ ') : '（無）'));
    console.log('      （A1 在 BASE 也是綠的 —— BASE 的串味剛好也給出 70，見上方註解）');
    redAtBase.push(...reds);
    chk('E3 ⭐⭐⭐ BASE 上 A2／A4／D1 必須紅（本版真的修好了東西，不是安慰劑）',
      reds.some(r => r.startsWith('A2')) && reds.some(r => r.startsWith('A4')) && reds.some(r => r.startsWith('D1')),
      reds.join(' ／ ') || '一條都沒紅');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【G】補洞（Opus 5 對抗性審查指出的守衛破口）');

// G1 —— key 打錯字不會被 length===8 抓到，但線上會讓那張卡的第 2 層 picker 整個不開
if (CA) {
  const missing = CA.COPY_ATTACK_KEYS.filter(k => !HEAD.ATTACK_PRE.has(k));
  chk('G1 COPY_ATTACK_KEYS 的每一個 key 都真的註冊了 regPre（打錯字必紅）',
    missing.length === 0, missing.join(','));
}

// G2 —— 註解宣稱「同傷害取先出現者」，但原本的測資三筆傷害各異 ⇒ 把 > 改成 >= 也不會紅
if (CA) {
  const C = (iid, idx, dmg) => ({ ownerIid: iid, ownerCardId: '1', ownerName: 'X', attackIndex: idx, attackName: 'a' + idx, damage: dmg });
  const tie = CA.pickCopiedAttack([C('o', 0, 120), C('o', 1, 120), C('o', 2, 30)], undefined);
  chk('G2 fallback tie-break：同傷害取**先出現者**（把 > 改成 >= 必須紅）',
    tie.candidate?.attackIndex === 0, String(tie.candidate?.attackIndex));
}

// G3 —— 另外 4 張借招卡的行為斷言（原本只跑了耀閃挑戰／扮晶晶酒／揮指／高傲指令）
{
  const ZOROARK = byName('索羅亞克', c => (c.attacks ?? []).some(a => a.name === '欺詐'));
  const SUDOWOODO = byName('阿響的樹才怪', c => (c.attacks ?? []).some(a => a.name === '試著模仿'));
  const NZORO = byName('N的索羅亞克ex', c => (c.attacks ?? []).some(a => a.name === '暗黑底牌'));
  const FOX = byName('狐大盜', c => (c.attacks ?? []).some(a => a.name === '技能大盜'));
  const NBENCH = [...pool.values()].find(c => c.name?.startsWith('N的') && c.name !== 'N的索羅亞克ex' && (c.attacks ?? []).length >= 2);
  chk('G3 fixture：欺詐／試著模仿／暗黑底牌／技能大盜 與一隻「N的」備戰寶可夢都抓得到',
    !!(ZOROARK && SUDOWOODO && NZORO && FOX && NBENCH));

  /** 借第 1 層、選對手 active 的第 n 招，回傳 log 與是否清乾淨 */
  const runSimple = (attacker, attackName, owner, ownerIdx, extra = {}) => {
    const me = inst(attacker.id, { energyAttached: ENERGIES() });
    const opp = inst(owner.id);
    const st = board({ myActive: me, oppActive: opp, oppBench: [inst(DRAGA.id)], oppDeck: [inst(DRAGA.id)], ...extra });
    const idx = (attacker.attacks ?? []).findIndex(a => a.name === attackName);
    const out = HEAD.applyAction(st, {
      type: 'ATTACK', attackIndex: idx, copyAttackChoice: { pokeIid: opp.iid, attackIndex: ownerIdx },
    }, pool);
    return {
      logs: out.log.map(l => (typeof l === 'string' ? l : (l?.message ?? ''))).join('\n'),
      leaked: out.pendingCopyAttackKeys,
    };
  };

  if (ZOROARK && SUDOWOODO && NZORO && FOX && NBENCH) {
    const z = runSimple(ZOROARK, '欺詐', DRAGA, 1);
    chk('G3a 索羅亞克｜欺詐：玩家選第 2 招 ⇒ log 寫「玩家選擇」且指名幻影奇襲',
      /欺詐：玩家選擇「多龍巴魯托ex\|幻影奇襲」/.test(z.logs), z.logs.split('\n').filter(l => /欺詐/.test(l)).join(' / '));

    // 試著模仿要先擲幣正面才會借；用固定種子讓它確定性
    const sd = withSeededRandom(0x51ede337, () => runSimple(SUDOWOODO, '試著模仿', DRAGA, 1));
    chk('G3b 阿響的樹才怪｜試著模仿：擲幣結果與借招 log 都出現（固定種子 ⇒ 可重現）',
      /試著模仿/.test(sd.logs));

    // 暗黑底牌：從自己備戰的「N的」寶可夢借
    {
      const me = inst(NZORO.id, { energyAttached: ENERGIES() });
      const nb = inst(NBENCH.id);
      const st = board({ myActive: me, oppActive: inst(DRAGA.id), oppDeck: [inst(DRAGA.id)] });
      st.players[0].bench = [nb];
      const idx = (NZORO.attacks ?? []).findIndex(a => a.name === '暗黑底牌');
      const out = HEAD.applyAction(st, { type: 'ATTACK', attackIndex: idx, copyAttackChoice: { pokeIid: nb.iid, attackIndex: 1 } }, pool);
      const lg = out.log.map(l => (typeof l === 'string' ? l : (l?.message ?? ''))).join('\n');
      chk('G3c N的索羅亞克ex｜暗黑底牌：借備戰「' + NBENCH.name + '」的第 2 招',
        new RegExp('暗黑底牌：使用 ' + NBENCH.name + ' 的「' + (NBENCH.attacks[1].name) + '」').test(lg),
        lg.split('\n').filter(l => /暗黑底牌/.test(l)).join(' / '));
      chk('G4c 暗黑底牌跑完後借招堆疊已清乾淨', out.pendingCopyAttackKeys === undefined, JSON.stringify(out.pendingCopyAttackKeys));
    }

    const fx = runSimple(FOX, '技能大盜', DRAGA, 1);
    chk('G3d 狐大盜｜技能大盜（手牌 0）：借對手戰鬥場的第 2 招',
      /技能大盜：選擇對手「多龍巴魯托ex」的「幻影奇襲」/.test(fx.logs),
      fx.logs.split('\n').filter(l => /技能大盜/.test(l)).join(' / '));

    // G4 —— 借招堆疊不可以殘留到下一個 action（改成陣列後會**累積**，比舊版更嚴重）
    chk('G4a 欺詐跑完後借招堆疊已清乾淨', z.leaked === undefined, JSON.stringify(z.leaked));
    chk('G4b 技能大盜跑完後借招堆疊已清乾淨', fx.leaked === undefined, JSON.stringify(fx.leaked));
  }
}

// G4d —— 玩家回報的那條三層鏈跑完也必須清乾淨
{
  const slow = inst(SLOWKING.id, { energyAttached: ENERGIES() });
  const mimi = inst(MIMIKYU.id);
  const draga = inst(DRAGA.id);
  const st = board({ myActive: slow, myDeck: [mimi], oppActive: draga, oppBench: [inst(DRAGA.id)], oppDeck: [inst(DRAGA.id)] });
  const out = HEAD.applyAction(st, {
    type: 'ATTACK', attackIndex: 0,
    copyAttackChoice: { pokeIid: mimi.iid, attackIndex: 0 },
    copyAttackChain: [{ pokeIid: draga.iid, attackIndex: 0 }],
  }, pool);
  chk('G4d 三層借招鏈跑完後借招堆疊已清乾淨（陣列版若漏清會累積到下一回合）',
    out.pendingCopyAttackKeys === undefined, JSON.stringify(out.pendingCopyAttackKeys));
}

// G5 —— ⭐ v6.338 站長裁示後的新判準：**8 張借招卡一律繼承**被借招式的弱抗旗標。
//   （v6.337 只有扮晶晶酒繼承，其餘 7 張寫死 false —— 那是錯的，見 v6.338 守衛。）
//   作法：暫時把被借招式的 PRE 換成回傳 skipWeakRes:true 的替身，看外層原封回傳什麼。
{
  const KEY = `${DRAGA.name}|${(DRAGA.attacks ?? [])[0].name}`;
  const orig = HEAD.ATTACK_PRE.get(KEY);
  HEAD.ATTACK_PRE.set(KEY, (s) => ({ state: s, damage: 10, skipWeakRes: true }));
  try {
    const mimiInst = inst(MIMIKYU.id, { energyAttached: ENERGIES() });
    const dr = inst(DRAGA.id);
    const st1 = board({ myActive: mimiInst, oppActive: dr, oppDeck: [inst(DRAGA.id)] });
    const r1 = HEAD.ATTACK_PRE.get('火箭隊的謎擬Ｑ|扮晶晶酒')(st1, 0, pool, { type: 'ATTACK', attackIndex: 0, copyAttackChoice: { pokeIid: dr.iid, attackIndex: 0 } });
    chk('G5a 扮晶晶酒**繼承**被借招式的 skipWeakRes（v3.873 起的既有行為）',
      r1.skipWeakRes === true, String(r1.skipWeakRes));

    const slow = inst(SLOWKING.id, { energyAttached: ENERGIES() });
    const topDr = inst(MIMIKYU.id);
    const oppD = inst(DRAGA.id);
    const st2 = board({ myActive: slow, myDeck: [topDr], oppActive: oppD, oppDeck: [inst(DRAGA.id)] });
    // ⚠⚠ 必須**明確給第 2 層的鏈**指到被 stub 的第 1 招 ——
    //   不給鏈的話扮晶晶酒會走 fallback「挑傷害最高的」＝多龍巴魯托ex 的第 2 招，
    //   根本碰不到 stub。v6.337 的這條就是這樣變成安慰劑的（它讀到的是外層寫死的 false）。
    const r2 = HEAD.ATTACK_PRE.get('呆呆王|耀閃挑戰')(st2, 0, pool, {
      type: 'ATTACK', attackIndex: 0,
      copyAttackChoice: { pokeIid: topDr.iid, attackIndex: 0 },
      copyAttackChain: [{ pokeIid: oppD.iid, attackIndex: 0 }],
    });
    chk('G5b0 ⭐哨兵：三層鏈真的打到了被替身接管的那一招（damage=10）', r2.damage === 10, String(r2.damage));
    chk('G5b ⭐v6.338 耀閃挑戰**也要繼承** skipWeakRes（站長裁示：招式自己寫的「不計算弱點・抵抗力」屬於招式本身）',
      r2.skipWeakRes === true, String(r2.skipWeakRes));
  } finally {
    if (orig) HEAD.ATTACK_PRE.set(KEY, orig); else HEAD.ATTACK_PRE.delete(KEY);
  }
}

// G6 —— 官方 L2277 後半句：重洗必須**先於**被借招式的處理
{
  const meowInst = inst(MEOWTH.id, { energyAttached: ENERGIES() });
  const deck = Array.from({ length: 12 }, () => inst(DRAGA.id));
  const st = board({ myActive: meowInst, oppActive: inst(DRAGA.id), oppDeck: deck });
  const idx = (MEOWTH.attacks ?? []).findIndex(a => a.name === '高傲指令');
  const out = withSeededRandom(0x2277, () => HEAD.applyAction(st, {
    type: 'ATTACK', attackIndex: idx, copyAttackChoice: { pokeIid: deck[0].iid, attackIndex: 0 },
  }, pool));
  const ls = out.log.map(l => (typeof l === 'string' ? l : (l?.message ?? '')));
  const iShuffle = ls.findIndex(l => /高傲指令：對手牌庫重洗/.test(l));
  const iUse = ls.findIndex(l => /使出「高傲指令」/.test(l));
  chk('G6 ⭐官方L2277後半句：「放回牌庫並重洗」的紀錄出現在招式結算**之前**',
    iShuffle >= 0 && iUse >= 0 && iShuffle < iUse, `shuffle@${iShuffle} use@${iUse}`);
}

// G7 —— +page.svelte 的接線（這支守衛原本對 UI 一行都沒測）
{
  const page = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
  const cut = (from, to) => { const i = page.indexOf(from); const j = page.indexOf(to, i + 1); return i >= 0 && j > i ? page.slice(i, j) : ''; };
  const skipFn = cut('function skipRocketCommand()', '\n  }');
  chk('G7a skipRocketCommand 必須把已選好的借招鏈一起送出（否則第 2 層按「不複製」會打出別的招）',
    skipFn.length > 50 && /chain/.test(skipFn), String(skipFn.length));
  chk('G7b preAttackDiscard 的每一個出口都帶上 copyAttackChain（5 處）',
    (page.split('ccChain').length - 1) >= 6 && /copyAttackChoice, copyAttackChain, exactRequired/.test(page),
    String(page.split('ccChain').length - 1));
  chk('G7c 暗黑底牌的第 1 層 picker 走中央 copyAttackCandidates（不再手寫 startsWith）',
    /copyAttackCandidates\('N的索羅亞克ex\|暗黑底牌'/.test(page));
  chk('G7d 借招鏈的遞迴推進點存在且唯一（advanceBorrowChain）',
    (page.split('function advanceBorrowChain').length - 1) === 1
    && (page.split('advanceBorrowChain(').length - 1) >= 4);
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【F】版本一致');
{
  const v = /export const VERSION = '([\d.]+)'/.exec(readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8'));
  const hint = /window\.SITE_VERSION_HINT = '([\d.]+)'/.exec(readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8'));
  chk('F1 version.ts ≥ 6.337 且 admin.html 的 SITE_VERSION_HINT 同步',
    !!v && parseFloat(v[1]) >= 6.337 && !!hint && hint[1] === v[1], `${v?.[1]} / ${hint?.[1]}`);
}

console.log(`\n=== v6.337 借招鏈中央管線：PASS ${pass} / FAIL ${fail} ===`);
process.exit(fail ? 1 : 0);
