// ═══════════════════════════════════════════════════════════════════════════
// v6.388 守衛：MF「頂級牌組組合 「太陽伊布・月亮伊布」」實裝 批次 1
//
// 站長交辦：「我發現我們還有擴充包沒有抓到也沒有實裝」（MF，2026-09-16 與 M6a 同日發售）。
//
// 本版做的事：
//   ・資料層：MF.json 進 static/cards、index.json 登記、card-set-map 補 49 筆、
//     「老大的指令（烏羽）」沿用站長 2026-08-15 的裁定改名成「老大的指令」
//   ・效果層：10 個招式（全部復用既有中央 helper）＋ 1 個被動特性（與森林秘道共用判準）
//
// 分層：
//   【0】fixture 自驗（卡面逐字取自 static/cards/MF.json）
//   【A】行為端：逐招實跑 applyAction
//   【B】⭐⭐ 收斂：夜之秘道與森林秘道必須是**同一個函式參照**（Rule 38）
//   【C】不得矯枉過正
//   【D】資料層
//   【E】⭐⭐⭐ HEAD-FAIL：對 BASE 的 src 樹重跑【A】必紅
//   【F】在 npm test chain 裡
//
// ⚠ 擲幣型招式一律覆寫 Math.random 取得確定性，禁靠真隨機（會 flaky，見 v6.336）。
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync, unlinkSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
// ⚠ 讀歷史一律走中央 helper（test-v6263 ★★ 在守：禁自己 shell out git ＋ 寫死歷史 sha）
import { hasBaseCommit, restoreBaseSubtree, shallowSkip } from './lib/base-blob.mjs';
import { build } from 'esbuild';

// ⚠⚠v6.388b：這裡原本寫 join(dirname(new URL(import.meta.url).pathname.slice(1)), '..')
//   —— `.slice(1)` 只在 **Windows** 對（pathname 是 `/E:/x/...`，要砍掉開頭那個 '/'）；
//   在 **Linux** pathname 是 `/home/...`，砍掉就變成**相對路徑** ⇒ CI 上 ENOENT。
//   本機（Windows）永遠測不出來，v6.388 的 CI 因此整個 build job 紅、deploy 被 skip。
//   ⇒ 一律用 Node 官方跨平台 API fileURLToPath（全 repo 568 支守衛都是這個寫法）。
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ⚠⚠ BASE_SHA 必須是**留在 main 上的那一顆**，不可以填 amend／rebase 前的中途 sha ——
//    那種 commit 不被任何 ref 保護，本機 git gc 後就消失，hasBaseCommit() 會轉成
//    SHALLOW-SKIP，整個【E】HEAD-FAIL 靜默失效（守衛看起來還是綠的）。IRON_RULES Rule 45。
//    驗法：git branch -a --contains <sha> 必須印得出 main。
const BASE_SHA = 'af36811389c5a546e9da86ddbc2f35487a0aadfa';   // v6.387（本版的上一版）

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  PASS ' + name); return true; }
  fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : ''));
  return false;
};

const STRAY = [];
const TMP = mkdtempSync(join(tmpdir(), 'v6388-'));
process.on('exit', () => {
  for (const p of STRAY) { try { unlinkSync(p); } catch { /* */ } }
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* */ }
});

async function bundleFrom(srcDir, tag) {
  const parent = dirname(srcDir);
  const name = srcDir.slice(parent.length + 1).replace(/\\/g, '/');
  const p = './' + name;
  const S = join(parent, '.v6388-s-' + tag + '.js');
  const E = join(parent, '.v6388-e-' + tag + '.ts');
  const O = join(parent, '.v6388-o-' + tag + '.mjs');
  STRAY.push(S, E, O);
  writeFileSync(S, 'export const base="";export const assets="";');
  writeFileSync(E,
    "export { applyAction } from '" + p + "/lib/game/engine';\n"
    + "export { ABILITY_RETREAT_MOD, ATTACK_PRE, ATTACK_POST } from '" + p + "/lib/game/effects';\n"
    + "import '" + p + "/lib/game/effects';\n");
  await build({
    entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(srcDir, 'lib'), '$app/paths': S }, logLevel: 'silent',
  });
  return import(pathToFileURL(O).href);
}

// ── 卡池 ────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) { if (c?.id == null) continue; pool.set(String(c.id), c); all.push(c); }
}
const byId = (id) => pool.get(String(id));
const HIJ = (c) => ['H', 'I', 'J'].includes(c?.regulationMark);
const mf = (id) => byId(id);

// ── fixture（MF 卡 id）──────────────────────────────────────────────────────
const TROPIUS = mf('19671');   // 熱帶龍｜捲土重來 30+（復仇 +90）／利刃之風 90
const CHERUBI = mf('19672');   // 櫻花寶｜躲藏（擲幣正面 → 完全免疫）／活蹦亂跳 10
const CHERRIM = mf('19673');   // 櫻花兒｜能量之禮（牌庫 2 基本能量任意附）／樹葉 50
const VULPIX = mf('19674');    // 六尾｜踹 30（反面失敗）
const VICTINI = mf('19676');   // 比克提尼｜呼朋引伴（牌庫 2 基礎放備戰）／V型火焰 50
const ZERAORA = mf('19677');   // 捷拉奧拉｜快速抽出 20（抽 1）／電氣子彈 50（備戰 20）
const AZUMA = mf('19683');     // 瑪力露麗｜泰山壓頂 90（擲幣正面麻痺）
const CRESSELIA = mf('19685'); // 克雷色利亞｜極光增輝 30（自回 30）／月光爆破 100
const ZOROARK = mf('19690');   // 索羅亞克｜夜之秘道（備戰時自方戰鬥撤退 -2）／利爪揮砍 90
const MINIOR = mf('19697');    // 小隕星｜流星射擊（丟光能量、對手 1 隻 120）
const BOSS = mf('19709');      // 老大的指令（MF 039/040）
// ── 批次2（需要新中央 helper 的 6 招）──────────────────────────────────────
const SUNNY = mf('19684');     // 太陽伊布ex｜陽光律動 30×（自己場上寶可夢數 ×30）
const COMFEY = mf('19686');    // 花療環環｜平和芳香（選 1 隻自己備戰恢復 80）
const UMBRE = mf('19687');     // 月亮伊布ex｜月光利爪 100+（對手有指示物 +140）
const ROOK = mf('19688');      // 黑暗鴉｜抓一下 20（擲幣正面 → 對手無法撤退）
const HYDREI = mf('19693');    // 三首惡龍｜三首啃咬（擲 3 幣 → 丟對手能量）
const KANGA = mf('19694');     // 袋獸｜憤怒 20+（自身指示物 ×10）

console.log('\n【0】fixture 自驗（卡面逐字取自 static/cards/MF.json）');
const atkOf = (c, n) => (c?.attacks || []).find((a) => a.name === n);
chk('0a 11 張 fixture 都抓得到，且都在 MF',
  [TROPIUS, CHERUBI, CHERRIM, VULPIX, VICTINI, ZERAORA, AZUMA, CRESSELIA, ZOROARK, MINIOR, BOSS]
    .every((c) => c && c.setCode === 'MF'),
  JSON.stringify([TROPIUS, CHERUBI, CHERRIM, VULPIX, VICTINI, ZERAORA, AZUMA, CRESSELIA, ZOROARK, MINIOR, BOSS].map((c) => c?.name ?? null)));
chk('0b 全部是 H/I/J 標（G 標不在標準賽範圍，本專案不處理）',
  [TROPIUS, CHERUBI, CHERRIM, VULPIX, VICTINI, ZERAORA, AZUMA, CRESSELIA, ZOROARK, MINIOR, BOSS].every(HIJ));
chk('0c 熱帶龍｜捲土重來 卡面逐字 ＋ damage=30+',
  atkOf(TROPIUS, '捲土重來')?.effect === '在上個對手的回合，若自己的寶可夢因招式的傷害而【昏厥】了，則增加90點傷害。'
  && atkOf(TROPIUS, '捲土重來')?.damage === '30+');
chk('0d 櫻花寶｜躲藏 卡面逐字（含「傷害**與效果**」）',
  atkOf(CHERUBI, '躲藏')?.effect === '擲1次硬幣若為正面，則在下個對手的回合，這隻寶可夢不會受到招式的傷害與效果的影響。');
chk('0e 六尾｜踹 卡面逐字 ＋ damage=30',
  atkOf(VULPIX, '踹')?.effect === '擲1次硬幣若為反面，則這個招式失敗。' && atkOf(VULPIX, '踹')?.damage === '30');
chk('0f 捷拉奧拉｜電氣子彈 卡面逐字（主詞是**備戰**寶可夢）',
  atkOf(ZERAORA, '電氣子彈')?.effect === '對手的1隻備戰寶可夢也受到20點傷害。[在備戰區不計算弱點・抵抗力。]');
chk('0g 索羅亞克｜夜之秘道 卡面逐字，與 陸地水母｜森林秘道 相同',
  (ZOROARK?.abilities || []).find((a) => a.name === '夜之秘道')?.effect
    === '只要這隻寶可夢在備戰區，自己的戰鬥寶可夢【撤退】所需的能量減少2個。');
{
  const sea = all.find((c) => (c.abilities || []).some((a) => a.name === '森林秘道'));
  chk('0g2 ★ 對照組：森林秘道那張卡的 effect 與夜之秘道**逐字相同**（這是共用判準的前提）',
    (sea?.abilities || []).find((a) => a.name === '森林秘道')?.effect
      === (ZOROARK?.abilities || []).find((a) => a.name === '夜之秘道')?.effect,
    String(sea?.name));
}
chk('0h 小隕星｜流星射擊 卡面逐字（主詞是對手的**1隻寶可夢**，不限備戰）',
  atkOf(MINIOR, '流星射擊')?.effect === '將這隻寶可夢身上附加的能量全部丟棄，對手的1隻寶可夢受到120點傷害。[在備戰區不計算弱點・抵抗力。]');
chk('0i ⭐ 老大的指令已沿用站長裁定改名（卡面效果未動）',
  BOSS?.name === '老大的指令' && BOSS?.rulesText === '選擇1隻對手的備戰寶可夢，與戰鬥寶可夢互換。',
  JSON.stringify({ n: BOSS?.name, r: BOSS?.rulesText }));

// ── 盤面 helper ─────────────────────────────────────────────────────────────
const eName = (n) => { for (const c of all) if (c.name === n && c.supertype === 'Energy') return String(c.id); return null; };
const GRASS = eName('基本【草】能量');
const PSY = eName('基本【超】能量');
// ⚠ 能量屬性要對得上招式 cost，否則招式根本打不出來（實測：傷害靜默變 0，不會 throw）
const FIRE = eName('基本【火】能量');
const LIGHT = eName('基本【雷】能量');
const DARK = eName('基本【惡】能量');
// ⚠ 預設肉盾 19680（超夢）弱點是【惡】⇒ 打【惡】招式會吃 ×2，傷害斷言會對不上；
//   而且 HP 不夠厚，加傷型招式會直接把它打死（active 變 null ⇒ 讀不到 damage）。
//   ⇒ 【惡】系與高傷招式改用這一隻：HP≥300、弱點**不是**【惡】。
const TANKY = all.find((c) => c.supertype === 'Pokemon' && HIJ(c)
  && Number(c.hp) >= 300 && c.weakness?.type !== 'Darkness');
chk('0k ★ fixture：找得到 HP≥300 且弱點不是【惡】的肉盾', !!TANKY,
  JSON.stringify({ n: TANKY?.name, hp: TANKY?.hp, w: TANKY?.weakness?.type }));
chk('0j 抓得到本檔要用的四種基本能量', !!GRASS && !!PSY && !!FIRE && !!LIGHT,
  JSON.stringify({ GRASS, PSY, FIRE, LIGHT }));

const en = (cid, iid) => ({ iid, cardId: cid, damage: 0, energyAttached: [] });
const mon = (cid, iid, o = {}) => ({ iid, cardId: cid, damage: 0, energyAttached: [], ...o });
const PL = (name, o = {}) => ({ name, active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...o });
const ST = (p0, p1, extra = {}) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
  turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  players: [p0, p1], ...extra,
});
const E6 = (cid) => [1, 2, 3, 4, 5, 6].map((i) => en(cid, 'ae' + i));
const DECK = (cid) => ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) => en(cid, 'dk' + n));

const ORND = Math.random;
const withCoin = (v, fn) => { Math.random = () => v; try { return fn(); } finally { Math.random = ORND; } };
const HEADS = 0.1, TAILS = 0.9;   // flipCoinsWithLog 的判準由引擎決定，兩個極端值各取一

/** 打一招，回傳可斷言的切片。defId 省略時用一隻厚血肉盾。 */
function hit(M, atkId, atkIdx, { defId = '19680', ownBench = [], oppBench = [], extra = {}, energyCid = GRASS, hand = [] } = {}) {
  const st = ST(
    PL('P0', {
      active: mon(atkId, 'atk', { energyAttached: E6(energyCid) }),
      bench: ownBench, deck: DECK(energyCid), hand,
    }),
    PL('P1', { active: mon(defId, 'def'), bench: oppBench, deck: DECK(energyCid) }),
    extra,
  );
  try {
    const s = M.applyAction(st, { type: 'ATTACK', attackIndex: atkIdx, actorIdx: 0 }, pool);
    return {
      s,
      defDamage: s.players[1].active?.damage ?? null,
      defStatus: s.players[1].active?.status ?? null,
      atkDamage: s.players[0].active?.damage ?? null,
      atkEnergy: s.players[0].active?.energyAttached?.length ?? null,
      atkImmuneAll: s.players[0].active?.immuneToAllAttackNextTurn === true,
      atkImmuneDmgOnly: s.players[0].active?.immuneToAttackDamageNextTurn === true,
      hand: s.players[0].hand.length,
      pend: s.pendingSelection?.effectKey ?? null,
      pendType: s.pendingSelection?.type ?? null,
      log: s.log.map((l) => String(l.message ?? '')),
    };
  } catch (e) { return { err: String(e && e.message) }; }
}
const said = (r, t) => !r.err && r.log.some((l) => l.includes(t));

const HEAD = await bundleFrom(join(ROOT, 'src'), 'head');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A】行為端：逐招實跑');
// ═══════════════════════════════════════════════════════════════════════════

// A1 熱帶龍｜捲土重來 —— 上個對手回合有自己的寶可夢被招式 KO ⇒ 30+90=120
{
  const idxOf = (c, n) => (c.attacks || []).findIndex((a) => a.name === n);
  // ⚠ 讀的是 oppDamageKOdMeInLastOppTurn（只計「招式**傷害**KO」）——
  //   oppAttackKOdMeInLastOppTurn 是**含效果 KO**的另一個欄位，給措辭不同的卡（古玉魚｜嫉妒業火）用，
  //   兩者不可互換（effects.ts revengeDamageKOPre 的檔頭寫死了這一點）。
  const noKO = hit(HEAD, String(TROPIUS.id), idxOf(TROPIUS, '捲土重來'), { extra: { oppDamageKOdMeInLastOppTurn: [0, 0] } });
  const yesKO = hit(HEAD, String(TROPIUS.id), idxOf(TROPIUS, '捲土重來'), { extra: { oppDamageKOdMeInLastOppTurn: [1, 0] } });
  chk('A1 ⭐ 捲土重來：上回合沒有被招式 KO ⇒ 30', noKO.defDamage === 30, JSON.stringify(noKO.defDamage ?? noKO.err));
  chk('A1b ⭐⭐ 捲土重來：上回合有被招式 KO ⇒ 30+90 = 120', yesKO.defDamage === 120, JSON.stringify(yesKO.defDamage ?? yesKO.err));
}

// A2 六尾｜踹 —— 反面失敗
{
  const i = (VULPIX.attacks || []).findIndex((a) => a.name === '踹');
  // 六尾｜踹 cost=【火】
  const h = withCoin(HEADS, () => hit(HEAD, String(VULPIX.id), i, { energyCid: FIRE }));
  const t = withCoin(TAILS, () => hit(HEAD, String(VULPIX.id), i, { energyCid: FIRE }));
  chk('A2 ⭐ 踹：正面 ⇒ 30 傷害', h.defDamage === 30, JSON.stringify(h.defDamage ?? h.err));
  chk('A2b ⭐⭐ 踹：反面 ⇒ 招式失敗、0 傷害', t.defDamage === 0, JSON.stringify(t.defDamage ?? t.err));
}

// A3 櫻花寶｜躲藏 —— 正面 ⇒ 下個對手回合免疫「傷害與效果」
{
  const i = (CHERUBI.attacks || []).findIndex((a) => a.name === '躲藏');
  const h = withCoin(HEADS, () => hit(HEAD, String(CHERUBI.id), i));
  const t = withCoin(TAILS, () => hit(HEAD, String(CHERUBI.id), i));
  chk('A3 ⭐⭐ 躲藏：正面 ⇒ immuneToAllAttackNextTurn', h.atkImmuneAll === true, JSON.stringify(h.err ?? h.atkImmuneAll));
  chk('A3b ⭐⭐ 躲藏：正面時**不是**只免傷害的那一種（卡面寫「傷害與效果」）',
    h.atkImmuneAll === true && h.atkImmuneDmgOnly !== true);
  chk('A3c ★ 躲藏：反面 ⇒ 沒有任何免疫旗標', t.atkImmuneAll === false && t.atkImmuneDmgOnly !== true);
}

// A4 櫻花兒｜能量之禮 —— 開牌庫搜尋 picker
{
  const i = (CHERRIM.attacks || []).findIndex((a) => a.name === '能量之禮');
  const r = hit(HEAD, String(CHERRIM.id), i);
  chk('A4 ⭐ 能量之禮：開了牌庫搜尋 picker', r.pendType === 'deck-search', JSON.stringify({ t: r.pendType, k: r.pend, e: r.err }));
  chk('A4b ⭐ 能量之禮：picker 上限 2 張、可以選 0（卡面「最多2張」）',
    r.s?.pendingSelection?.maxCount === 2 && (r.s?.pendingSelection?.minCount ?? 1) === 0,
    JSON.stringify({ max: r.s?.pendingSelection?.maxCount, min: r.s?.pendingSelection?.minCount }));
}

// A5 比克提尼｜呼朋引伴 —— 開牌庫搜尋 picker（放備戰，卡面「最多2張【基礎】」）
// ⚠⚠v6.388a（Fable 5 複審 Y1）：原本這一條是
//     r.pendType === 'deck-search' || said(r, '呼朋引伴')
//   —— 後半段**恆真**（招式名一定會出現在 log 裡），所以把整支 regPost 刪掉照樣 PASS＝安慰劑。
//   改成自建牌庫（放 2 張【基礎】寶可夢）硬斷言 picker 的形狀，並補一條反對照。
//   斷言值逐一對過 effects.ts recruitBasicToBenchPost（type/effectKey/minCount/maxCount/filter）。
{
  const i = (VICTINI.attacks || []).findIndex((a) => a.name === '呼朋引伴');
  const BASIC2 = all.filter((c) => c.supertype === 'Pokemon' && HIJ(c) && c.stage === 'Basic').slice(0, 2);
  chk('A5-0 ★ fixture：找得到 2 張【基礎】寶可夢可以放進牌庫', BASIC2.length === 2,
    JSON.stringify(BASIC2.map((c) => c?.name ?? null)));
  const st = ST(
    PL('P0', {
      active: mon(String(VICTINI.id), 'atk', { energyAttached: E6(GRASS) }),
      deck: [...BASIC2.map((c, k) => mon(String(c.id), 'bk' + k)), ...DECK(GRASS)],
    }),
    PL('P1', { active: mon('19680', 'def'), deck: DECK(GRASS) }),
  );
  let ps = null, e5 = null;
  try { ps = HEAD.applyAction(st, { type: 'ATTACK', attackIndex: i, actorIdx: 0 }, pool).pendingSelection ?? null; }
  catch (e) { e5 = String(e && e.message); }
  chk('A5 ⭐⭐ 呼朋引伴：牌庫有【基礎】⇒ 開 deck-search picker，走中央 effectKey=recruit-to-bench',
    ps?.type === 'deck-search' && ps?.effectKey === 'recruit-to-bench',
    JSON.stringify({ t: ps?.type, k: ps?.effectKey, e: e5 }));
  chk('A5b ⭐⭐ 呼朋引伴：卡面「**最多**2張」⇒ minCount=0（可以選 0 張）、maxCount=2',
    (ps?.minCount ?? -1) === 0 && ps?.maxCount === 2,
    JSON.stringify({ min: ps?.minCount, max: ps?.maxCount }));
  chk('A5c ⭐ 呼朋引伴：候選過濾器是【基礎】寶可夢（不是全牌庫）',
    ps?.filter === 'BasicPokemon', JSON.stringify(ps?.filter ?? null));
  // ★ 反對照：牌庫全是能量 ⇒ **不得**開 picker（避免空視窗），且要據實 log
  const none = hit(HEAD, String(VICTINI.id), i, { energyCid: GRASS });
  chk('A5d ★ 反對照：牌庫裡沒有【基礎】寶可夢 ⇒ 不開 picker，據實 log',
    none.pendType === null && said(none, '牌庫內無可選的基礎寶可夢'),
    JSON.stringify({ t: none.pendType, log: (none.log || []).slice(-2), e: none.err }));
}

// A6 捷拉奧拉｜快速抽出 —— 手牌 +1、傷害 20
{
  const i = (ZERAORA.attacks || []).findIndex((a) => a.name === '快速抽出');
  const r = hit(HEAD, String(ZERAORA.id), i, { energyCid: LIGHT });   // cost=【無】，用【雷】也付得起
  chk('A6 ⭐ 快速抽出：傷害 20', r.defDamage === 20, JSON.stringify(r.defDamage ?? r.err));
  chk('A6b ⭐⭐ 快速抽出：手牌 +1（從 0 變 1）', r.hand === 1, JSON.stringify(r.hand ?? r.err));
}

// A7 捷拉奧拉｜電氣子彈 —— 主傷害 50 ＋ 備戰狙擊 20
{
  const i = (ZERAORA.attacks || []).findIndex((a) => a.name === '電氣子彈');
  // 捷拉奧拉｜電氣子彈 cost=【雷】【無】
  const r = hit(HEAD, String(ZERAORA.id), i, { oppBench: [mon('19680', 'ob1')], energyCid: LIGHT });
  chk('A7 ⭐ 電氣子彈：戰鬥位主傷害 50', r.defDamage === 50, JSON.stringify(r.defDamage ?? r.err));
  const benched = r.s?.players?.[1]?.bench?.[0];
  chk('A7b ⭐⭐ 電氣子彈：對手備戰也吃到 20（或開了選備戰的 picker）',
    (benched?.damage === 20) || r.pendType === 'opp-bench-choose',
    JSON.stringify({ benchDmg: benched?.damage, t: r.pendType, e: r.err }));
}

// A8 瑪力露麗｜泰山壓頂 —— 正面麻痺
{
  const i = (AZUMA.attacks || []).findIndex((a) => a.name === '泰山壓頂');
  const h = withCoin(HEADS, () => hit(HEAD, String(AZUMA.id), i, { energyCid: PSY }));
  const t = withCoin(TAILS, () => hit(HEAD, String(AZUMA.id), i, { energyCid: PSY }));
  chk('A8 ⭐⭐ 泰山壓頂：正面 ⇒ 對手【麻痺】', h.defStatus === 'paralyzed', JSON.stringify(h.defStatus ?? h.err));
  chk('A8b ★ 泰山壓頂：反面 ⇒ 沒有狀態', t.defStatus === null || t.defStatus === undefined, JSON.stringify(t.defStatus));
  chk('A8c ⭐ 泰山壓頂：主傷害 90（兩種擲幣結果都一樣）', h.defDamage === 90 && t.defDamage === 90,
    JSON.stringify({ h: h.defDamage, t: t.defDamage }));
}

// A9 克雷色利亞｜極光增輝 —— 自身回 30
{
  const i = (CRESSELIA.attacks || []).findIndex((a) => a.name === '極光增輝');
  const st = ST(
    PL('P0', { active: mon(String(CRESSELIA.id), 'atk', { energyAttached: E6(PSY), damage: 50 }), deck: DECK(PSY) }),
    PL('P1', { active: mon('19680', 'def'), deck: DECK(PSY) }),
  );
  let r = null;
  try { r = HEAD.applyAction(st, { type: 'ATTACK', attackIndex: i, actorIdx: 0 }, pool); } catch (e) { r = { err: String(e.message) }; }
  chk('A9 ⭐⭐ 極光增輝：自身 50 傷害 → 回 30 ⇒ 剩 20', r?.players?.[0]?.active?.damage === 20,
    JSON.stringify(r?.players?.[0]?.active?.damage ?? r?.err));
  chk('A9b ⭐ 極光增輝：對手吃 30', r?.players?.[1]?.active?.damage === 30,
    JSON.stringify(r?.players?.[1]?.active?.damage));
}

// A10 小隕星｜流星射擊 —— 能量丟光 ＋ 指定 1 隻 120
{
  const i = (MINIOR.attacks || []).findIndex((a) => a.name === '流星射擊');
  const r = hit(HEAD, String(MINIOR.id), i, { oppBench: [mon('19680', 'ob1')] });
  chk('A10 ⭐⭐ 流星射擊：自身能量全部丟光（6 → 0）', r.atkEnergy === 0, JSON.stringify(r.atkEnergy ?? r.err));
  const bd = r.s?.players?.[1]?.bench?.[0]?.damage ?? 0;
  chk('A10b ⭐⭐ 流星射擊：對手有一隻吃到 120（或開了選目標的 picker）',
    r.defDamage === 120 || bd === 120 || (r.pendType && String(r.pendType).includes('choose')),
    JSON.stringify({ act: r.defDamage, bench: bd, t: r.pendType, e: r.err }));
}

// A11 索羅亞克｜夜之秘道 —— 備戰時，自己的戰鬥寶可夢撤退費 -2
{
  // 找一隻撤退費恰好 2 的 H/I/J 基礎寶可夢當戰鬥位
  const R2 = all.find((c) => c.supertype === 'Pokemon' && HIJ(c)
    && (c.retreatCost || []).length === 2 && (c.stage ?? c.subtype) === 'Basic' && Number(c.hp) >= 60);
  chk('A11-0 ★ fixture：找得到撤退費恰好 2 的 H/I/J 基礎寶可夢', !!R2, String(R2?.name));
  const mk = (withZoro) => ST(
    PL('P0', {
      active: mon(String(R2.id), 'act'),                       // ⚠ 身上 0 能量
      bench: withZoro ? [mon(String(ZOROARK.id), 'zo'), mon('19680', 'b2')] : [mon('19680', 'b2')],
      deck: DECK(PSY),
    }),
    PL('P1', { active: mon('19680', 'def'), deck: DECK(PSY) }),
  );
  const run = (withZoro, target) => {
    try {
      const s = HEAD.applyAction(mk(withZoro), { type: 'RETREAT', newActiveIid: target }, pool);
      return { ok: s.players[0].active?.iid === target, pend: s.pendingSelection?.type ?? null };
    } catch (e) { return { err: String(e.message) }; }
  };
  const withZ = run(true, 'b2');
  const without = run(false, 'b2');
  chk('A11 ⭐⭐⭐ 夜之秘道：索羅亞克在備戰 ⇒ 撤退費 2-2=0，0 能量也撤得掉',
    withZ.ok === true, JSON.stringify(withZ));
  chk('A11b ⭐⭐ 反對照：索羅亞克不在備戰 ⇒ 0 能量撤不掉（撤退費仍是 2）',
    without.ok === false, JSON.stringify(without));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【A2】批次2：需要新中央 helper 的 6 招');
// ═══════════════════════════════════════════════════════════════════════════
const idxA = (c, nm) => (c.attacks || []).findIndex((a) => a.name === nm);

// A2-1 太陽伊布ex｜陽光律動 30× —— 自己場上寶可夢數量 × 30
{
  const i = idxA(SUNNY, '陽光律動');
  // 自己只有戰鬥位 ⇒ 1 隻 ⇒ 30
  const one = hit(HEAD, String(SUNNY.id), i, { energyCid: PSY });
  // 自己戰鬥位 ＋ 3 隻備戰 ⇒ 4 隻 ⇒ 120
  const four = hit(HEAD, String(SUNNY.id), i, { energyCid: PSY, ownBench: [mon('19680', 'b1'), mon('19680', 'b2'), mon('19680', 'b3')] });
  chk('A2-1 ⭐⭐ 陽光律動：自己場上 1 隻 ⇒ 1×30 = 30', one.defDamage === 30, JSON.stringify(one.defDamage ?? one.err));
  chk('A2-1b ⭐⭐ 陽光律動：自己場上 4 隻 ⇒ 4×30 = 120', four.defDamage === 120, JSON.stringify(four.defDamage ?? four.err));
  chk('A2-1c ⭐ 倍率是 30 不是 20（既有同措辭卡都是 ×20，不得照抄範本參數）', four.defDamage === 120 && four.defDamage !== 80);
}

// A2-2 花療環環｜平和芳香 —— 選 1 隻自己備戰恢復 80
{
  const i = idxA(COMFEY, '平和芳香');
  const hurt = hit(HEAD, String(COMFEY.id), i, { energyCid: PSY, ownBench: [mon('19680', 'b1', { damage: 100 })] });
  const fine = hit(HEAD, String(COMFEY.id), i, { energyCid: PSY, ownBench: [mon('19680', 'b1')] });
  chk('A2-2 ⭐⭐ 平和芳香：備戰有受傷 ⇒ 開 heal-target picker', hurt.pendType === 'heal-target',
    JSON.stringify({ t: hurt.pendType, k: hurt.pend, e: hurt.err }));
  chk('A2-2b ⭐ 平和芳香：走的是**帶量**的新 key（不是全恢復那一支）',
    hurt.pend === 'heal-bench-one-amount', String(hurt.pend));
  chk('A2-2c ⭐⭐ 平和芳香：恢復量 80 有進 params（不是硬編在 resolver 裡）',
    hurt.s?.pendingSelection?.params?.amount === 80, JSON.stringify(hurt.s?.pendingSelection?.params?.amount));
  chk('A2-2d ★ 備戰都沒受傷 ⇒ 不開 picker（卡面沒寫「否則招式失敗」，只記一行 log）',
    fine.pendType !== 'heal-target' && said(fine, '平和芳香'), JSON.stringify({ t: fine.pendType, log: (fine.log || []).slice(-1) }));
}

// A2-3 月亮伊布ex｜月光利爪 100+ —— 對手有傷害指示物則 +140
{
  const i = idxA(UMBRE, '月光利爪');
  const clean = hit(HEAD, String(UMBRE.id), i, { energyCid: DARK, defId: String(TANKY.id) });
  const st = ST(
    PL('P0', { active: mon(String(UMBRE.id), 'atk', { energyAttached: E6(DARK) }), deck: DECK(DARK) }),
    PL('P1', { active: mon(String(TANKY.id), 'def', { damage: 30 }), deck: DECK(DARK) }),
  );
  let hurtDmg = null;
  try { const r = HEAD.applyAction(st, { type: 'ATTACK', attackIndex: i, actorIdx: 0 }, pool); hurtDmg = r.players[1].active?.damage ?? null; } catch (e) { hurtDmg = String(e.message); }
  chk('A2-3 ⭐ 月光利爪：對手身上沒有指示物 ⇒ 100', clean.defDamage === 100, JSON.stringify(clean.defDamage ?? clean.err));
  chk('A2-3b ⭐⭐ 月光利爪：對手身上有 30 傷害 ⇒ 100+140 = 240，累計 270', hurtDmg === 270, JSON.stringify(hurtDmg));

  // ★★v6.388a（Fable 5 複審 Y2）補反對照 —— 上面兩條只能證明「有人身上有傷就加傷」，
  //   分不出 defHasCountersBonusPre 讀的是「對手的戰鬥寶可夢」還是「自己」或「對手全隊」。
  //   ⇒ 這兩條把『讀錯人』『讀錯位置』的突變抓出來（卡面主詞是「對手的戰鬥寶可夢」）。
  const selfHurt = ST(
    PL('P0', { active: mon(String(UMBRE.id), 'atk', { energyAttached: E6(DARK), damage: 50 }), deck: DECK(DARK) }),
    PL('P1', { active: mon(String(TANKY.id), 'def'), deck: DECK(DARK) }),
  );
  let selfDmg = null;
  try { selfDmg = HEAD.applyAction(selfHurt, { type: 'ATTACK', attackIndex: i, actorIdx: 0 }, pool).players[1].active?.damage ?? null; }
  catch (e) { selfDmg = String(e && e.message); }
  chk('A2-3c ★★ 反對照：**自己**身上有 50 傷害、對手 0 ⇒ 仍是 100（讀的是對手，不是自己）',
    selfDmg === 100, JSON.stringify(selfDmg));

  const benchHurt = ST(
    PL('P0', { active: mon(String(UMBRE.id), 'atk', { energyAttached: E6(DARK) }), deck: DECK(DARK) }),
    PL('P1', { active: mon(String(TANKY.id), 'def'), bench: [mon(String(TANKY.id), 'defb', { damage: 60 })], deck: DECK(DARK) }),
  );
  let benchDmg = null;
  try { benchDmg = HEAD.applyAction(benchHurt, { type: 'ATTACK', attackIndex: i, actorIdx: 0 }, pool).players[1].active?.damage ?? null; }
  catch (e) { benchDmg = String(e && e.message); }
  chk('A2-3d ★★ 反對照：對手**備戰**有 60 傷害、戰鬥場 0 ⇒ 仍是 100（讀的是戰鬥寶可夢，不是全隊）',
    benchDmg === 100, JSON.stringify(benchDmg));
}

// A2-4 黑暗鴉｜抓一下 20 —— 擲幣正面則對手下回合無法撤退
{
  const i = idxA(ROOK, '抓一下');
  const h = withCoin(HEADS, () => hit(HEAD, String(ROOK.id), i, { energyCid: DARK, defId: String(TANKY.id) }));
  const t = withCoin(TAILS, () => hit(HEAD, String(ROOK.id), i, { energyCid: DARK, defId: String(TANKY.id) }));
  // ⚠v6.388a：原本判準是「旗標 **或** log 有『無法撤退』字樣」——
  //   後半段會讓「只寫 log、沒真的設旗標」的壞實作矇混過關 ⇒ 收緊成只看旗標。
  const defCant = (r) => r.s?.players?.[1]?.active?.cantRetreatNextTurn === true;
  chk('A2-4 ⭐⭐ 抓一下：正面 ⇒ 對手下回合無法撤退（看**旗標**，不看 log 字串）', defCant(h) === true,
    JSON.stringify({ flag: h.s?.players?.[1]?.active?.cantRetreatNextTurn, log: (h.log || []).slice(-3) }));
  chk('A2-4b ★ 抓一下：反面 ⇒ 沒有那個效果', defCant(t) !== true, JSON.stringify((t.log || []).slice(-2)));
  chk('A2-4c ⭐ 抓一下：兩種擲幣結果主傷害都是 20', h.defDamage === 20 && t.defDamage === 20,
    JSON.stringify({ h: h.defDamage, t: t.defDamage }));
  // ★v6.388a（Fable 5 複審 Y5）回歸守衛：coinHeadsDefCantRetreatPost 曾自己 addLog 一行，
  //   而它呼叫的 defCantRetreatNextPost(label) 內部也會寫一行 ⇒ 對戰紀錄連續兩行講同一件事。
  chk('A2-4d ★★ 抓一下：「無法撤退」在對戰紀錄裡**只出現一行**（不得 helper 與中央各寫一次）',
    (h.log || []).filter((l) => l.includes('無法撤退')).length === 1,
    JSON.stringify((h.log || []).filter((l) => l.includes('無法撤退'))));
}

// A2-5 三首惡龍｜三首啃咬 —— 擲 3 幣，正面數 = 丟對手能量個數
{
  const i = idxA(HYDREI, '三首啃咬');
  const mk = () => ST(
    PL('P0', { active: mon(String(HYDREI.id), 'atk', { energyAttached: E6(DARK) }), deck: DECK(DARK) }),
    PL('P1', { active: mon(String(TANKY.id), 'def', { energyAttached: [en(DARK, 'de1'), en(DARK, 'de2'), en(DARK, 'de3')] }), deck: DECK(DARK) }),
  );
  const run = (coin) => withCoin(coin, () => {
    try { const r = HEAD.applyAction(mk(), { type: 'ATTACK', attackIndex: i, actorIdx: 0 }, pool);
      return { energy: r.players[1].active?.energyAttached?.length ?? null,
        pend: r.pendingSelection?.effectKey ?? null, pendType: r.pendingSelection?.type ?? null,
        log: r.log.map((l) => String(l.message ?? '')) };
    } catch (e) { return { err: String(e.message) }; }
  });
  const allTails = run(TAILS);
  const allHeads = run(HEADS);
  chk('A2-5 ⭐⭐ 三首啃咬：3 次全反面 ⇒ 一個能量都不丟', allTails.energy === 3,
    JSON.stringify({ e: allTails.energy, err: allTails.err, log: (allTails.log || []).slice(-2) }));
  chk('A2-5b ⭐ 三首啃咬：全反面時 log 要據實說「不丟棄」', (allTails.log || []).some((l) => l.includes('不丟棄能量')));
  chk('A2-5c ⭐⭐⭐ 三首啃咬：3 次全正面 ⇒ 丟掉 3 個（或開 picker 讓攻擊方選）',
    allHeads.energy === 0 || (allHeads.pendType && String(allHeads.pendType).includes('energy')),
    JSON.stringify({ e: allHeads.energy, t: allHeads.pendType, k: allHeads.pend, log: (allHeads.log || []).slice(-3) }));
}

// A2-6 袋獸｜憤怒 20+ —— 自身傷害指示物數 × 10
{
  const i = idxA(KANGA, '憤怒');
  const mk = (dmg) => ST(
    PL('P0', { active: mon(String(KANGA.id), 'atk', { energyAttached: E6(GRASS), damage: dmg }), deck: DECK(GRASS) }),
    PL('P1', { active: mon('19680', 'def'), deck: DECK(GRASS) }),
  );
  const run = (dmg) => {
    try { const r = HEAD.applyAction(mk(dmg), { type: 'ATTACK', attackIndex: i, actorIdx: 0 }, pool);
      return r.players[1].active?.damage ?? null; } catch (e) { return String(e.message); }
  };
  chk('A2-6 ⭐ 憤怒：自身沒受傷 ⇒ 20', run(0) === 20, JSON.stringify(run(0)));
  chk('A2-6b ⭐⭐ 憤怒：自身 50 傷害（5 個指示物）⇒ 20+5×10 = 70', run(50) === 70, JSON.stringify(run(50)));
  chk('A2-6c ⭐ 憤怒：指示物數是 floor(damage/10)，不是 damage 本身', run(50) === 70 && run(50) !== 520);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】⭐⭐ 收斂：同一個判準只能有一份（Rule 38）');
// ═══════════════════════════════════════════════════════════════════════════
{
  const m = HEAD.ABILITY_RETREAT_MOD;
  const night = m.get('夜之秘道');
  const forest = m.get('森林秘道');
  chk('B1 ⭐ 兩個特性都在 ABILITY_RETREAT_MOD 裡', typeof night === 'function' && typeof forest === 'function');
  chk('B2 ⭐⭐⭐ 兩者是**同一個函式參照**（===），不是各抄一份', night === forest);
  // 行為層：直接餵同一組 params，兩邊必須回相同結果
  const P1 = { holderOwnerIdx: 0, retreatingOwnerIdx: 0, holderPosition: 'bench' };
  const P2 = { holderOwnerIdx: 0, retreatingOwnerIdx: 0, holderPosition: 'active' };
  const P3 = { holderOwnerIdx: 0, retreatingOwnerIdx: 1, holderPosition: 'bench' };
  chk('B3 ⭐ 持有者在備戰、同陣營 ⇒ reduceBy 2', night?.(P1)?.reduceBy === 2, JSON.stringify(night?.(P1)));
  chk('B4 ⭐ 持有者在戰鬥場 ⇒ 不生效（卡面寫「只要這隻寶可夢在備戰區」）',
    JSON.stringify(night?.(P2)) === '{}', JSON.stringify(night?.(P2)));
  chk('B5 ⭐ 撤退者是對手 ⇒ 不生效（卡面寫「**自己的**戰鬥寶可夢」）',
    JSON.stringify(night?.(P3)) === '{}', JSON.stringify(night?.(P3)));

  // 靜態掃描：effects.ts 裡不得出現第二份同判準的函式本體
  const eff = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8');
  const bodyCount = (eff.match(/holderPosition !== 'bench'\) return \{\};\s*\r?\n\s*return \{ reduceBy: 2 \}/g) || []).length;
  chk('B6 ⭐⭐ effects.ts 裡這個判準的函式本體**只有一份**', bodyCount === 1, `找到 ${bodyCount} 份`);
  chk('B6b ★ 掃描器正對照：把同樣的文字餵給它，要數得出來',
    ("if (p.holderPosition !== 'bench') return {};\n  return { reduceBy: 2 };")
      .match(/holderPosition !== 'bench'\) return \{\};\s*\r?\n\s*return \{ reduceBy: 2 \}/g)?.length === 1);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】不得矯枉過正');
// ═══════════════════════════════════════════════════════════════════════════
{
  // 本版新註冊的 key 必須**恰好**是這 10 個，不得順手改到別人
  const WANT = [
    '熱帶龍|捲土重來', '六尾|踹', '櫻花寶|躲藏', '櫻花兒|能量之禮', '比克提尼|呼朋引伴',
    '捷拉奧拉|快速抽出', '捷拉奧拉|電氣子彈', '瑪力露麗|泰山壓頂', '克雷色利亞|極光增輝', '小隕星|流星射擊',
  ];
  const has = (k) => HEAD.ATTACK_PRE.has(k) || HEAD.ATTACK_POST.has(k);
  chk('C1 ⭐ 本版要接的 10 個 key 全部接上了', WANT.every(has),
    JSON.stringify(WANT.filter((k) => !has(k))));
  // 純傷害招式不該被註冊（卡面沒有效果，引擎讀 damage 欄就夠）
  const PURE = ['熱帶龍|利刃之風', '櫻花兒|樹葉', '索羅亞克|利爪揮砍', '克雷色利亞|月光爆破'];
  chk('C2 ⭐⭐ 純傷害招式**沒有**被多此一舉地註冊（硬編傷害是技術債）',
    PURE.every((k) => !has(k)), JSON.stringify(PURE.filter(has)));
  // 既有卡不得被本版改到
  chk('C3 ★ 既有的 陸地水母｜森林秘道 仍在表裡且行為不變',
    HEAD.ABILITY_RETREAT_MOD.get('森林秘道')?.({ holderOwnerIdx: 0, retreatingOwnerIdx: 0, holderPosition: 'bench' })?.reduceBy === 2);
  chk('C4 ★ 空白對照：不存在的特性名查不到東西', HEAD.ABILITY_RETREAT_MOD.get('不存在的特性') === undefined);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】資料層');
// ═══════════════════════════════════════════════════════════════════════════
{
  const idx = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  const e = idx.find((x) => x.code === 'MF');
  chk('D1 ⭐ index.json 有 MF 這一筆', !!e);
  chk('D2 ⭐ MF 的張數與實際檔案一致', e && e.cardCount === 49 && e.count === 49, JSON.stringify({ c: e?.cardCount, n: e?.count }));
  chk('D3 ⭐ MF 的發售日與 M6a 同為 2026-09-16', e?.releaseDate === '2026-09-16', String(e?.releaseDate));
  chk('D4 ⭐ MF 的 supertypeCounts 與實際相符',
    e && e.supertypeCounts?.Pokemon === 31 && e.supertypeCounts?.Trainer === 13 && e.supertypeCounts?.Energy === 5,
    JSON.stringify(e?.supertypeCounts));
  const map = JSON.parse(readFileSync(join(ROOT, 'static/card-set-map.json'), 'utf8'));
  const mfCards = JSON.parse(readFileSync(join(dir, 'MF.json'), 'utf8'));
  chk('D5 ⭐⭐ card-set-map 對 MF 的 49 張零落差', mfCards.every((c) => map[String(c.id)] === 'MF'),
    JSON.stringify(mfCards.filter((c) => map[String(c.id)] !== 'MF').map((c) => c.id)));
  chk('D6 ⭐⭐ MF 裡沒有任何卡叫「老大的指令（烏羽）」（已沿用站長裁定改名）',
    !mfCards.some((c) => c.name === '老大的指令（烏羽）'));
  chk('D7 ★ 反對照：改名後那張卡仍在（只是換了 name，不是被刪掉）',
    mfCards.some((c) => String(c.id) === '19709' && c.name === '老大的指令'));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【E】⭐⭐⭐ HEAD-FAIL：對 BASE 的 src 重跑【A】必紅');
// ═══════════════════════════════════════════════════════════════════════════
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('【E】HEAD-FAIL 對 BASE 的 src 重建', '【0】~【D】都不需要歷史，仍在守');
} else {
  const baseSrc = join(TMP, 'base-src');
  cpSync(join(ROOT, 'src'), baseSrc, { recursive: true });
  // ⚠ 本版動了 effects.ts、新增 mf_wave1／mf_wave2，還把三個既有卡檔收斂到新 export ——
  //   只換 effects.ts 是不夠的（BASE 的 effects.ts 沒有那些 export ⇒ 整包 build 失敗）。
  //   ⇒ 直接把整個 src/lib/game 子樹還原成 BASE（中央 helper 會連「BASE 沒有的檔案」一起移除）。
  const rs = restoreBaseSubtree(ROOT, BASE_SHA, baseSrc, 'src/lib/game');
  chk('E0 ⭐ BASE 子樹還原成功（replaced=' + rs.replaced + '，removed=' + rs.removed + '）', rs.ok, rs.reason ?? '');
  const B = await bundleFrom(baseSrc, 'base');

  const i踹 = (VULPIX.attacks || []).findIndex((a) => a.name === '踹');
  const bTail = withCoin(TAILS, () => hit(B, String(VULPIX.id), i踹, { energyCid: FIRE }));
  chk('E1 ★ 哨兵：BASE bundle 是活的（同一招在 BASE 也跑得完，不是整支爆掉）', !bTail.err, String(bTail.err));
  chk('E2 ⭐⭐⭐ BASE 一定要紅：六尾｜踹 反面時 BASE 照樣打 30（HEAD 是 0）',
    bTail.defDamage === 30, JSON.stringify(bTail.defDamage));

  const iZ = (ZERAORA.attacks || []).findIndex((a) => a.name === '快速抽出');
  const bDraw = hit(B, String(ZERAORA.id), iZ, { energyCid: LIGHT });
  chk('E3 ⭐⭐⭐ BASE 一定要紅：快速抽出在 BASE **不抽牌**（HEAD 抽 1）', bDraw.hand === 0, JSON.stringify(bDraw.hand));

  chk('E4 ⭐⭐⭐ BASE 一定要紅：夜之秘道在 BASE 根本不在 ABILITY_RETREAT_MOD 裡',
    B.ABILITY_RETREAT_MOD.get('夜之秘道') === undefined);
  chk('E5 ★ 零變更對照：森林秘道在 BASE 與 HEAD 都在（本版沒有動到它的行為）',
    typeof B.ABILITY_RETREAT_MOD.get('森林秘道') === 'function');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【F】在 npm test chain 裡');
// ═══════════════════════════════════════════════════════════════════════════
{
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const hits = String(pkg.scripts.test).split('&&').filter((c) => c.includes('test-v6388-mf-wave1.mjs')).length;
  chk('F1 ⭐ scripts.test 裡**恰好**有本檔一次', hits === 1, `找到 ${hits} 次`);
}

console.log(`\n=== v6.388 守衛：PASS ${pass} / FAIL ${fail} ===`);
process.exit(fail === 0 ? 0 : 1);
