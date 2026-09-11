// v6.340 守衛 —— 卡牌政策（賽季容許的標 ＋ 暫不開放的卡包）可由後台設定
//
// 站長交辦（2026-09-11）：
//   ①「可以設定哪些卡包不能在牌組編輯器及對戰裡面使用（用了就會被判定為不合格卡牌）」
//   ②「目前賽季開放 H/I/J，明年會改成 I/J/K，我只要把 H 標的容許關掉就好」
//   ③「M6a 先把功能做出來，但先不要開放讓玩家使用」⇒ 卡包容許要能單獨開關
//   ④「牌組的賽季篩選拿掉【G 標】，加一個【已退標】（含 A~G）」
//
// 架構：政策存 Firebase `config/cardPolicy`（同 config/broadcast、config/homeChangelog 的
//   既有管道），玩家端 `policy-loader.ts` 與**錦標賽伺服器** `server_admin_patch.js` 讀**同一份**
//   ⇒ 不會出現「前端說不合法、伺服器說合法」的分裂。
//
// ⚠⚠ 這是合法性判定，所以每一條 fail 路徑都必須 **fail-closed**：
//   讀不到／格式壞掉／被拒絕 ⇒ 退回程式內建的 H/I/J ＋ M6a 鎖住，**絕不可以變成全部放行**。
//   （v6.333 的 `if (card.regulationMark && !STANDARD_MARKS.has(...))` 就是 fail-open 的前科。）
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
// ⚠⚠ 【C】的接線判準是字串比對，**一定要先剝註解**：本版寫的中文註解裡就有
//   `loadCardPolicyOnce()`、`getCardPolicy().allowedMarks`、`_syncCardPolicy` 這些字，
//   不剝的話「把真正的呼叫整行註解掉」會照樣全綠（Opus 5 對抗性審查實測 M2 沒抓到）。
import { stripCommentsBlank } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = 'a1f2c5e71b7be017f1c16bcf00ee38d21c544b6a';   // v6.339（v6.340 的上一版）

let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => {
  if (ok) { console.log('  PASS ' + name); pass++; } else { console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); fail++; }
  return !!ok;
};

// ── harness：把 validation + regulation 打包起來跑真的函式 ────────────────────
const STRAY = [];
process.on('exit', () => { for (const p of STRAY) { try { unlinkSync(p); } catch { /* noop */ } } });
async function bundleLib() {
  const parent = dirname(join(ROOT, 'src'));
  const S = join(parent, '.v6340-s.js'), E = join(parent, '.v6340-e.ts'), O = join(parent, '.v6340-o.mjs');
  STRAY.push(S, E, O);
  writeFileSync(S, 'export const base="";export const assets="";');
  writeFileSync(E,
    `export { validateDeck, isBasicEnergy, isStandardReprintLegal, hasIneligibleCardIssue } from './src/lib/decks/validation';\n`
    + `export * from './src/lib/cards/regulation';\n`);
  await build({
    entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'silent',
  });
  return import(pathToFileURL(O).href);
}
const V = await bundleLib();

// ── 卡池 ──────────────────────────────────────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const all = [...pool.values()];
const H_BASIC = all.find((c) => c.regulationMark === 'H' && c.supertype === 'Pokemon' && c.stage === 'Basic');
const ENERGY = all.find((c) => c.name === '基本【超】能量');
const M6A_CARD = all.find((c) => String(c.setCode) === 'M6a');
chk('fixture：抓得到 H 標基礎寶可夢／基本能量／M6a 的卡',
  !!(H_BASIC && ENERGY && M6A_CARD),
  JSON.stringify({ H: H_BASIC?.name, E: ENERGY?.name, M6a: M6A_CARD?.name }));

const deckOf = (entries) => ({ id: 'd', name: '測試牌組', entries, createdAt: 0, updatedAt: 0 });
/** 4 張 H 標基礎寶可夢 ＋ 56 張基本能量 ＝ 合法的 60 張 */
const LEGAL_DECK = () => deckOf([
  { cardId: String(H_BASIC.id), count: 4 },
  { cardId: String(ENERGY.id), count: 56 },
]);

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【A】政策本身：預設值、驗證、fail-closed');
V.resetCardPolicy();
{
  // ⭐⭐⭐ A0：這是 v6.333 的原始前科（`if (card.regulationMark && !STANDARD_MARKS.has(...))`
  //   ——「標是空的」就整段跳過 ＝ 把無標卡判成合法）。本版把 regulation.ts **整檔改寫**，
  //   所以這道網一定要在自己的守衛裡重建：把 `if (!mark) return false` 改成 `return true`
  //   必須有東西紅。（Opus 5 對抗性審查實測：沒有這一條時整支 36/0 全綠。）
  const falsy = [undefined, null, '', 0, false, NaN];
  const leaked = falsy.filter((v) => V.isCardMarkStandardLegal(v) !== false);
  chk('A0 ⭐⭐⭐ 標缺席一律 fail-closed（無標的純收藏卡不能打）',
    leaked.length === 0, JSON.stringify(leaked));
  const p = V.getCardPolicy();
  chk('A1 程式內建預設政策＝H/I/J ＋ M6a 暫不開放',
    p.allowedMarks.slice().sort().join(',') === 'H,I,J' && p.lockedSets.join(',') === 'M6a',
    JSON.stringify(p));
  chk('A2 DEFAULT_CARD_POLICY 與 getCardPolicy() 一致（預設狀態）',
    [...V.DEFAULT_CARD_POLICY.allowedMarks].sort().join(',') === p.allowedMarks.slice().sort().join(',')
    && [...V.DEFAULT_CARD_POLICY.lockedSets].join(',') === p.lockedSets.join(','));

  // ⚠ fail-closed：不合格的設定一律整包忽略，而且**不可以**改變現行政策
  const bad = [
    ['null', null],
    ['{}（缺欄位）', {}],
    ['allowedMarks 不是陣列', { allowedMarks: 'HIJ', lockedSets: [] }],
    ['allowedMarks 空陣列（全部關掉）', { allowedMarks: [], lockedSets: [] }],
    ['標不是單一字母', { allowedMarks: ['HH'], lockedSets: [] }],
    ['標是數字', { allowedMarks: [1], lockedSets: [] }],
    ['lockedSets 不是陣列', { allowedMarks: ['H'], lockedSets: 'M6a' }],
    ['lockedSets 含空字串', { allowedMarks: ['H'], lockedSets: ['  '] }],
  ];
  const wrong = bad.filter(([, v]) => V.setCardPolicy(v) !== false).map(([n]) => n);
  chk('A3 ⭐⭐⭐ 不合格的設定一律被拒絕（含「全部關掉」）', wrong.length === 0, wrong.join('、'));
  const after = V.getCardPolicy();
  chk('A4 ⭐⭐⭐ 被拒絕之後現行政策**完全沒變**（fail-closed，不是半套套用）',
    after.allowedMarks.slice().sort().join(',') === 'H,I,J' && after.lockedSets.join(',') === 'M6a',
    JSON.stringify(after));

  chk('A5 合格的設定會被接受', V.setCardPolicy({ allowedMarks: ['I', 'J', 'K'], lockedSets: ['M6a', 'M7'] }) === true);
  chk('A6 ⭐關掉 H 之後 H 標卡判為不合法、I/J/K 合法',
    V.isCardMarkStandardLegal('H') === false && V.isCardMarkStandardLegal('I') === true
    && V.isCardMarkStandardLegal('K') === true);
  chk('A7 ⭐鎖住的卡包會被 isDeckLockedCard 認出來',
    V.isDeckLockedCard({ setCode: 'M7' }) === true && V.isDeckLockedCard({ setCode: 'M6' }) === false);
  chk('A8 標記正規化：小寫／前後空白也吃得下（後台手打不會踩雷）',
    V.setCardPolicy({ allowedMarks: [' h ', 'i'], lockedSets: [] }) === true
    && V.isCardMarkStandardLegal('H') === true && V.isCardMarkStandardLegal('J') === false);
  chk('A9 ⭐lockedSets 可以清空（＝站長把 M6a 開放）',
    V.setCardPolicy({ allowedMarks: ['H', 'I', 'J'], lockedSets: [] }) === true
    && V.isDeckLockedCard({ setCode: 'M6a' }) === false);
  V.resetCardPolicy();
  chk('A10 resetCardPolicy 回到程式內建值',
    V.isCardMarkStandardLegal('H') === true && V.isDeckLockedCard({ setCode: 'M6a' }) === true);
  chk('A11 篩選鈕順序＝無標/已退標/目前容許的標',
    V.regMarkFilterKeys().join(',') === 'none,rotated,H,I,J', V.regMarkFilterKeys().join(','));
  chk('A12 【已退標】是動態的：關掉 H 之後 H 就進【已退標】',
    (() => {
      V.setCardPolicy({ allowedMarks: ['I', 'J', 'K'], lockedSets: ['M6a'] });
      const r = V.cardRegMarkFilterKey('H') === 'rotated' && V.regMarkFilterKeys().join(',') === 'none,rotated,I,J,K';
      V.resetCardPolicy();
      return r;
    })());
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【B】行為端：validateDeck（前端與錦標賽伺服器跑的是同一支）真的吃政策');
if (H_BASIC && ENERGY && M6A_CARD) {
  V.resetCardPolicy();
  const base = V.validateDeck(LEGAL_DECK(), pool);
  chk('B0 ⭐哨兵：預設政策下這副 60 張是合法的（否則下面全是空真）',
    base.issues.length === 0, base.issues.join(' / '));

  V.setCardPolicy({ allowedMarks: ['I', 'J'], lockedSets: ['M6a'] });
  const afterOff = V.validateDeck(LEGAL_DECK(), pool);
  chk('B1 ⭐⭐⭐ 把 H 關掉之後，同一副牌變成不合法（明年賽季的操作）',
    afterOff.issues.length > 0 && afterOff.issues.some((s) => /已退出標準賽/.test(s)),
    afterOff.issues.join(' / '));

  V.resetCardPolicy();
  const backOn = V.validateDeck(LEGAL_DECK(), pool);
  chk('B2 把 H 打開之後又變回合法（政策是雙向的，不是單向鎖死）', backOn.issues.length === 0, backOn.issues.join(' / '));

  // 卡包鎖：M6a 的卡本來就進不了牌組
  const m6aDeck = deckOf([{ cardId: String(M6A_CARD.id), count: 4 }, { cardId: String(ENERGY.id), count: 56 }]);
  const locked = V.validateDeck(m6aDeck, pool);
  chk('B3 ⭐M6a 的卡被擋（預設政策）', locked.issues.length > 0, locked.issues.slice(0, 2).join(' / '));

  V.setCardPolicy({ allowedMarks: ['H', 'I', 'J'], lockedSets: [] });
  const unlocked = V.validateDeck(m6aDeck, pool);
  const m6aLegalMark = V.isCardMarkStandardLegal(M6A_CARD.regulationMark);
  chk('B4 ⭐⭐⭐ 把 M6a 從「暫不開放」拿掉之後，卡包這一關就過了（站長之後要用的開關）',
    !unlocked.issues.some((s) => /不開放用於對戰/.test(s)),
    `mark=${M6A_CARD.regulationMark} markLegal=${m6aLegalMark} issues=${unlocked.issues.slice(0, 2).join(' / ')}`);
  // ⭐⭐⭐ B5/B6：站長交辦的第②件事（「哪些卡包暫不開放組牌」）在 **UI 候選清單**的落地。
  //   `filterDeckSelectable` 是 /decks 候選池的唯一執行點；把它改成 `return [...cards]`
  //   原本整支守衛都不會紅（Opus 5 對抗性審查 M3 實測）。
  V.resetCardPolicy();
  const poolAll = [...pool.values()];
  const lockedNow = V.filterDeckSelectable(poolAll);
  chk('B5 ⭐⭐⭐ 候選池真的濾掉 M6a（不是只有 validateDeck 事後擋）',
    lockedNow.length < poolAll.length && lockedNow.every((c) => String(c.setCode) !== 'M6a'),
    `${poolAll.length} → ${lockedNow.length}`);
  V.setCardPolicy({ allowedMarks: ['H', 'I', 'J'], lockedSets: [] });
  chk('B6 ⭐解鎖之後候選池完全復原（開關是雙向的）',
    V.filterDeckSelectable(poolAll).length === poolAll.length);
  V.setCardPolicy({ allowedMarks: ['H', 'I', 'J'], lockedSets: ['M6'] });
  const m6locked = V.filterDeckSelectable(poolAll);
  chk('B7 ⭐鎖別的卡包一樣有效（不是對 "M6a" 這個字串硬寫的）',
    m6locked.every((c) => String(c.setCode) !== 'M6') && m6locked.some((c) => String(c.setCode) === 'M6a'),
    String(m6locked.length));
  // ⚠ setCode 缺席的卡不可以被「誤打的卡包代號」整批鎖掉
  V.setCardPolicy({ allowedMarks: ['H', 'I', 'J'], lockedSets: ['undefined', 'null'] });
  chk('B8 ⭐setCode 缺席的卡不會被字串 "undefined"／"null" 鎖掉',
    V.isDeckLockedCard({}) === false && V.isDeckLockedCard({ setCode: null }) === false);

  // ⭐⭐⭐ B9：v3.61 的「重印例外」名單（寶可夢交替、高級球、老大的指令…）語意是
  //   「這個卡名**有當期合法的重印**，所以舊印刷也能用」。舊寫法只看名字在不在名單裡，
  //   一旦站長把某個標關掉，名單上那些卡就會**靜默地繼續合法** ——
  //   站長「明年只要把 H 的容許關掉就好」的承諾當場破功（Fable 5.1 對抗性審查抓到）。
  //   這裡用真的卡池 ＋ 真的 validateDeck 走一遍，不是對著實作重寫一次判準。
  const bareName = (n) => String(n).replace(/（[^（）]*）$/u, '');
  const UB_ALL = all.filter((c) => bareName(c.name) === '高級球');
  const UB_G = UB_ALL.find((c) => c.regulationMark === 'G');
  const UB_MARKS = [...new Set(UB_ALL.map((c) => c.regulationMark))].sort().join(',');
  chk('B9-fixture ⭐哨兵：卡池裡「高級球」有 G 標印刷、合法印刷只有 I 標（B9 判準成立的前提）',
    !!UB_G && UB_MARKS === 'G,I', UB_MARKS);
  if (UB_G) {
    const ubDeck = deckOf([
      { cardId: String(UB_G.id), count: 4 },
      { cardId: String(H_BASIC.id), count: 4 },
      { cardId: String(ENERGY.id), count: 52 },
    ]);
    V.resetCardPolicy();
    const ubOn = V.validateDeck(ubDeck, pool).issues;
    chk('B9a ⭐哨兵：預設政策（含 I）下，G 標的高級球靠重印豁免仍然合法',
      ubOn.length === 0, ubOn.join(' / '));
    V.setCardPolicy({ allowedMarks: ['H', 'J'], lockedSets: ['M6a'] });
    const ubOff = V.validateDeck(ubDeck, pool).issues;
    chk('B9 ⭐⭐⭐ 把 I 關掉之後，G 標高級球的重印豁免**跟著失效**（名單不是只看名字）',
      ubOff.some((s) => s.includes('高級球') && /已退出標準賽/.test(s)), ubOff.join(' / '));
    V.resetCardPolicy();
    chk('B9b ⭐豁免是雙向的：I 標打開之後又恢復合法',
      V.validateDeck(ubDeck, pool).issues.length === 0);
  }

  // ⭐⭐⭐ B10：線上連線房 lobby 的閘門述詞 hasIneligibleCardIssue。
  //   v5.217 起 lobby 用的是 /為 [A-Z]+ 標/ 這條 regex，它**認不得**「卡包未開放」
  //   與「沒有賽制標記」⇒ 站長鎖起來的卡包在線上對戰完全擋不住。
  //   這裡逐一拿**真的 validateDeck 產生的訊息**去餵它（不是自己造字串），
  //   三種資格問題都要認得；而「張數超過」這類構築規則**不可以**被它收進來。
  const NOMARK = all.find((c) => !c.regulationMark && String(c.setCode) === 'M6a');
  V.setCardPolicy({ allowedMarks: ['I', 'J'], lockedSets: ['M6a'] });
  const gRetired = V.validateDeck(LEGAL_DECK(), pool).issues;
  V.resetCardPolicy();
  const gLocked = V.validateDeck(m6aDeck, pool).issues;
  V.setCardPolicy({ allowedMarks: ['H', 'I', 'J'], lockedSets: [] });
  const gNoMark = NOMARK ? V.validateDeck(deckOf([
    { cardId: String(NOMARK.id), count: 4 },
    { cardId: String(H_BASIC.id), count: 4 },
    { cardId: String(ENERGY.id), count: 52 },
  ]), pool).issues : [];
  V.resetCardPolicy();
  const gCount = V.validateDeck(deckOf([
    { cardId: String(H_BASIC.id), count: 5 },
    { cardId: String(ENERGY.id), count: 55 },
  ]), pool).issues;
  chk('B10-fixture ⭐哨兵：抓得到 M6a 的無標卡，而且四種情境都真的產生了問題訊息',
    !!NOMARK && gRetired.length > 0 && gLocked.length > 0 && gNoMark.length > 0 && gCount.length > 0,
    JSON.stringify({ NOMARK: NOMARK?.name, gRetired: gRetired.length, gLocked: gLocked.length, gNoMark: gNoMark.length, gCount: gCount.length }));
  chk('B10 ⭐⭐⭐ 線上房閘門認得「退標／卡包未開放／無標」三種資格問題',
    V.hasIneligibleCardIssue(gRetired) === true
    && V.hasIneligibleCardIssue(gLocked) === true
    && V.hasIneligibleCardIssue(gNoMark) === true,
    JSON.stringify([gRetired[0], gLocked[0], gNoMark[0]]));
  chk('B10b ⭐⭐ 反安慰劑：純構築規則（同名超過 4 張）**不會**被閘門收進來（線上房既有行為不動）',
    V.hasIneligibleCardIssue(gCount) === false, gCount.join(' / '));

  V.resetCardPolicy();
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【C】接線：玩家端三頁、後台、錦標賽伺服器、引擎 bundle');
const readRaw = (rel) => readFileSync(join(ROOT, rel), 'utf8');
/** 判準一律看**剝掉註解**的原始碼（BASE 也套同一支 ⇒ HEAD-FAIL 才對稱）。 */
const read = (rel) => stripCommentsBlank(readRaw(rel));
const CRITERIA = {
  loaderWired(src) { return /loadCardPolicyOnce\(\)/.test(src); },
  cardsCentral(src) { return /regMarkFilterKeys\(\)/.test(src) && /regMarkFilterLabel\(/.test(src) && !/'G 標'/.test(src); },
  decksDynamic(src) { return /getCardPolicy\(\)\.allowedMarks/.test(src); },
  gameAwait(src) { return /await loadCardPolicyOnce\(\);/.test(src); },
  adminTab(src) { return /data-tab="card-policy"/.test(src) && /'config', 'cardPolicy'/.test(src) && /loadCardPolicyAdmin/.test(src); },
  serverSync(src) { return /_syncCardPolicy/.test(src) && /config'\)\.doc\('cardPolicy'\)/.test(src); },
  engineExport(src) { return /export \{ setCardPolicy, getCardPolicy, resetCardPolicy, DEFAULT_CARD_POLICY \}/.test(src); },
  // ⭐⭐ v6.340 r2：/cards 的 ?set=ALL 虛擬卡包原本把 H/I/J 三個字串寫死在 load 裡，
  //   賽季一換就會少掉新標的卡包（Fable 5.1 抓到）。
  cardsAllPolicy(src) {
    return /isCardMarkStandardLegal\(s\.regulationMark\)/.test(src)
      && !/regulationMark === 'H'/.test(src);
  },
};
{
  const cards = read('src/routes/cards/+page.svelte');
  const decks = read('src/routes/decks/+page.svelte');
  const game = read('src/routes/game/+page.svelte');
  const admin = read('oracle-admin/admin.html');
  const server = read('oracle-admin/server_admin_patch.js');
  const bse = read('scripts/build-server-engine.mjs');
  chk('C1 /cards 走中央的篩選鈕 API，且【G 標】鈕已移除', CRITERIA.cardsCentral(cards));
  chk('C2 /cards 有載入政策', CRITERIA.loaderWired(cards));
  chk('C3 /decks 的可選標跟著政策走', CRITERIA.decksDynamic(decks) && CRITERIA.loaderWired(decks));
  chk('C4 ⭐/game 開戰前 await 政策（不能拿舊政策判合法性）', CRITERIA.gameAwait(game));
  chk('C4b ⭐/deck-posts 也要載政策（否則公布欄說合法、牌組編輯器說不合法）',
    CRITERIA.loaderWired(read('src/routes/deck-posts/+page.svelte')));
  chk('C4c ⭐⭐ /decks 的候選池會跟著政策重算（pool 是一次性賦值，不重算就是收緊方向的破口）',
    /_rawAllCards\.length > 0\) pool = filterDeckSelectable/.test(decks));
  chk('C5 後台有「卡包與賽季」分頁，且寫的是 config/cardPolicy', CRITERIA.adminTab(admin));
  // ⚠ 用字要與事實一致：server_admin_patch.js 同步政策之後，**目前真的吃到它的**
  //   是牌組公布欄的投稿驗證（走 validateDeck）；錦標賽的報名／開戰端點目前只檢查 60 張，
  //   那一側靠玩家端擋。要不要把 dpValidateDeck 接上那三個端點，等站長裁示。
  chk('C6 ⭐⭐⭐ 伺服器端會自己同步 config/cardPolicy（公布欄投稿驗證與玩家端吃同一份）',
    CRITERIA.serverSync(server));
  chk('C6b ⭐/cards 的 ?set=ALL 跟著政策走（不是寫死 H/I/J）',
    CRITERIA.cardsAllPolicy(read('src/routes/cards/+page.ts')));
  chk('C7 引擎 bundle 有把政策 setter export 給伺服器用', CRITERIA.engineExport(bse));
  chk('C8 ⭐伺服器端是 fail-closed：舊 bundle／沒金鑰／讀失敗都只是維持現值',
    /typeof TENG\.setCardPolicy !== 'function'\) return;/.test(server)
    && /維持現值/.test(server));
  chk('C9 後台不接受「一個標都不勾」（與 setCardPolicy 的規則一致）',
    /至少要勾一個標/.test(admin));
  // ⭐⭐ C11：本版在 /decks 的**模組頂層**加了政策載入呼叫（因為 v6.267／v6.271 禁止
  //   /decks 新增 $effect／onMount），而 v6.277 Gb 的量測只看 onMount ＋ $state 兩塊、
  //   看不到頂層 ⇒ 那個破口由這裡補：三頁的網路呼叫 token 計數必須與 v6.339 完全相同。
  //   （政策載入走 policy-loader，一個分頁只讀一次，不新增任何網路呼叫點。）
  // ⚠⚠ 原本這裡的 NET_TOKENS **沒有** `loadCardPolicyOnce(` ⇒ 本版把新的 getDoc 搬到
  //   另一個檔（policy-loader.ts），三頁的 token 數當然不變 —— 那是**恆真**，不是量測
  //   （Opus 5 對抗性審查抓到）。老實把它算進去：本版**確實**替每個分頁多加了一次
  //   Firestore 讀取（有 10 分鐘 TTL ＋ 負快取），期望值逐檔寫死，多一個就紅。
  const NET_TOKENS = ['fetch(', 'getDoc(', 'getDocs(', 'setDoc(', 'updateDoc(', 'deleteDoc(',
    'onSnapshot(', 'addDoc(', 'loadAllSets(', 'loadIndex(', 'loadDecksFromCloud(',
    'syncDeckToCloud(', 'removeDeckFromCloud(', 'loadFavoritesFromCloud(', 'saveFavoritesToCloud(',
    'signInAnonymously(', 'onAuthStateChanged(', 'fetchDeckStats(', 'loadCardPolicyOnce('];
  const LOADER = 'loadCardPolicyOnce(';
  const countOf = (src) => Object.fromEntries(NET_TOKENS.map((t) => [t, src.split(t).length - 1]));
  /** 本版**刻意**新增的政策載入呼叫次數（逐檔寫死；多一個或少一個都紅） */
  const EXPECT_LOADER = {
    'src/routes/decks/+page.svelte': 1,
    'src/routes/cards/+page.svelte': 1,
    'src/routes/game/+page.svelte': 2,       // $effect 一次 ＋ 開戰前 await 一次
    'src/routes/deck-posts/+page.svelte': 1,
  };
  if (hasBaseCommit(ROOT, BASE_SHA)) {
    const drift = [];
    for (const [rel, want] of Object.entries(EXPECT_LOADER)) {
      const b = readBaseBlob(ROOT, BASE_SHA, rel);
      if (!b.ok) { drift.push(rel + '(讀不到 BASE)'); continue; }
      const now = countOf(read(rel));
      const base = countOf(stripCommentsBlank(b.out));
      if (base[LOADER] !== 0) drift.push(`${rel}:BASE 竟然已經有 ${LOADER}`);
      if (now[LOADER] !== want) drift.push(`${rel}:政策載入呼叫 ${now[LOADER]} 次（期望 ${want}）`);
      for (const t of NET_TOKENS) {
        if (t === LOADER) continue;
        if (now[t] !== base[t]) drift.push(`${rel}:${t} ${base[t]}→${now[t]}`);
      }
    }
    chk('C11 ⭐⭐⭐ 四頁除了「政策載入」之外沒有新增任何網路呼叫，而政策載入的次數逐檔對得上',
      drift.length === 0, drift.join('、'));
    // 反安慰劑：判準真的分辨得出差異
    chk('C11b ⭐反安慰劑：countOf 對「多一個 fetch(」判得出來',
      countOf('a fetch( b')['fetch('] === 1 && countOf('a b')['fetch('] === 0);
  } else {
    shallowSkip('C11 四頁網路呼叫 token 與 BASE 比對', '需要歷史 commit');
  }
  // ⭐⭐⭐ C13：玩家看得到的「H / I / J」字樣一律由政策產生（Rule 38：一個判準一份）。
  //   ⚠ 判準看的是**剝掉註解**的原始碼，所以註解裡寫 H/I/J 說明不會誤判。
  {
    const UI_FILES = ['src/routes/cards/+page.svelte', 'src/routes/cards/+page.ts',
      'src/routes/+page.svelte', 'src/routes/decks/+page.svelte'];
    const bad = [];
    for (const rel of UI_FILES) {
      const src = read(rel);
      if (/H \/ I \/ J/.test(src)) bad.push(rel + ':字樣');
      if (/regulationMark === 'H'/.test(src)) bad.push(rel + ':硬寫的標判斷');
    }
    chk('C13 ⭐⭐⭐ 四個玩家頁面沒有殘留寫死的「H / I / J」字樣或標判斷', bad.length === 0, bad.join('、'));
    chk('C13b ⭐反安慰劑：判準真的分辨得出來',
      /H \/ I \/ J/.test('標準賽 H / I / J 標') === true && /H \/ I \/ J/.test('標準賽 {MARKS_LABEL} 標') === false);
  }
  chk('C10 ⭐政策是 10 分鐘 TTL 的單次讀取（不可每次驗證都打 Firestore）',
    /const TTL_MS = 10 \* 60 \* 1000;/.test(read('src/lib/cards/policy-loader.ts'))
    && /if \(_once\) return _once;/.test(read('src/lib/cards/policy-loader.ts')));
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n【D】HEAD-FAIL：對 BASE(' + BASE_SHA.slice(0, 8) + ' ＝ v6.339)');
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('【D】HEAD-FAIL 對 BASE 的比對', '需要歷史 commit；【A】【B】【C】不需要歷史，仍在守');
} else {
  const files = {
    'src/routes/cards/+page.svelte': ['cardsCentral', 'loaderWired'],
    'src/routes/decks/+page.svelte': ['decksDynamic', 'loaderWired'],
    'src/routes/game/+page.svelte': ['gameAwait'],
    'oracle-admin/admin.html': ['adminTab'],
    'oracle-admin/server_admin_patch.js': ['serverSync'],
    'scripts/build-server-engine.mjs': ['engineExport'],
    'src/routes/cards/+page.ts': ['cardsAllPolicy'],
  };
  const reds = [];
  let readable = 0;
  for (const [rel, keys] of Object.entries(files)) {
    const b = readBaseBlob(ROOT, BASE_SHA, rel);
    if (!b.ok) { reds.push(rel + '(讀不到)'); continue; }
    readable++;
    for (const k of keys) if (!CRITERIA[k](stripCommentsBlank(b.out))) reds.push(`${rel}:${k}`);
  }
  chk('D0 七個檔案的 BASE blob 都讀得到', readable === 7, String(readable));
  console.log('      BASE 上紅掉的判準：' + (reds.length ? reds.join('／') : '（無）'));
  chk('D1 ⭐⭐⭐ BASE 上九條接線判準**全部**必須紅（本版真的做了東西）',
    reds.length === 9, reds.join('／') || '一條都沒紅');
  const baseReg = readBaseBlob(ROOT, BASE_SHA, 'src/lib/cards/regulation.ts');
  chk('D2 ⭐Rule 41 哨兵：BASE 的 regulation.ts 讀得到，而且沒有 setCardPolicy（本版才加的）',
    baseReg.ok === true && !/export function setCardPolicy/.test(baseReg.out));
  chk('D3 ⭐哨兵：BASE 的 regulation.ts 已經有 isCardMarkStandardLegal（v6.333 就在，不是本版才有）',
    baseReg.ok === true && /export function isCardMarkStandardLegal/.test(baseReg.out));
}

// ══════════════════════════════════════════════════════════════════════════════
{
  const v = readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8');
  chk('E1 版本已 bump 到 6.340 以上', /VERSION = '6\.(34\d|3[5-9]\d|[4-9]\d\d)'/.test(v),
    v.match(/VERSION = '[^']+'/)?.[0] ?? '');
  const mjs = readFileSync(join(ROOT, 'scripts/lib/deck-locked-sets.mjs'), 'utf8');
  chk('E2 守衛端的預設清單與 DEFAULT_CARD_POLICY.lockedSets 一致',
    [...V.DEFAULT_CARD_POLICY.lockedSets].every((s) => mjs.includes(`'${s}'`)));

  // ⭐⭐⭐ E3：後台 admin.html 是**獨立的一份**常數（它不吃 $lib，是純 HTML+ESM）。
  //   兩邊漂掉的話，站長在後台看到的勾選預設值會與全站實際行為不一樣 —— 最難察覺的一種錯。
  const parseArr = (s) => String(s || '').split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
  const adminRaw = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');
  const mAll = adminRaw.match(/const CARD_POLICY_ALL_MARKS = \[([^\]]*)\];/);
  const mDef = adminRaw.match(/const CARD_POLICY_DEFAULT = \{ allowedMarks: \[([^\]]*)\], lockedSets: \[([^\]]*)\] \};/);
  const got = { all: parseArr(mAll?.[1]), marks: parseArr(mDef?.[1]), sets: parseArr(mDef?.[2]) };
  chk('E3 ⭐⭐⭐ 後台的 CARD_POLICY_ALL_MARKS／CARD_POLICY_DEFAULT 與 regulation.ts 逐字一致',
    !!mAll && !!mDef
    && got.all.join(',') === [...V.ALL_REGULATION_MARKS].join(',')
    && got.marks.join(',') === [...V.DEFAULT_CARD_POLICY.allowedMarks].join(',')
    && got.sets.join(',') === [...V.DEFAULT_CARD_POLICY.lockedSets].join(','),
    JSON.stringify(got));

  // ⭐ E4：卡包顯示順序。MARK_ORDER 少一個標時，那個標的卡包會落進 fallback 被排到最後面
  //   —— 明年 K 標上市卻沉底在 H 標下面就是錯的。
  const so = readFileSync(join(ROOT, 'src/lib/cards/set-order.ts'), 'utf8');
  const order = parseArr(so.match(/export const MARK_ORDER = \[([^\]]*)\] as const;/)?.[1]);
  chk('E4 ⭐卡包顯示順序含 H~K，而且照 A~K 的倒序排（新卡包不會沉底）',
    ['H', 'I', 'J', 'K'].every((m) => order.includes(m))
    && order.join(',') === [...V.ALL_REGULATION_MARKS].filter((m) => order.includes(m)).reverse().join(','),
    order.join(','));
}

console.log(`\nv6.340 卡牌政策守衛：PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
