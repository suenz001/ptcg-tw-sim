#!/usr/bin/env node
/**
 * v6.441 守衛：桌機第四種對戰版面「藍桌墊」（battleLayout === 'blue'）
 *
 * 站長交辦（2026-09-29）：參考其他玩家自製模擬器的深藍桌面＋白框格線，新增一種對戰版面；
 *   經典版、Fable 版都保留；手機版維持現況。站長定稿：
 *   ① 以第一版示意圖為底 ② HP 條放戰鬥寶可夢下方 ③ 備戰卡不顯示名稱（滑鼠移上才顯示）
 *   ④ 能量「同屬性合併 圖示×N」，特殊能量只顯示「特」 ⑤ 寶可夢道具以白框縮圖貼卡片右下（備戰也要）
 *
 * 設計：藍桌墊沿用 Fable 版的幾何（playmat 同時掛 layout-fable 與 layout-blue），
 *   外觀與格線另套 .layout-blue；傷害／能量／道具只在藍桌墊時 render（snippet blueDeco）。
 *
 * 這支守衛怎麼避免自己說謊
 * ──────────────────────────────────────────────────────────────────────────
 *   [A 零回歸・剝除器] 把本版所有改動還原（哨兵區塊整段剝掉＋逐條把替換改回去），
 *        結果必須與 BASE 的 +page.svelte **逐位元相同** ⇒ 證明經典版／桌墊版／Fable 版／手機版
 *        沒有任何一個位元組被動到。並斷言「剝除前後確實不同」（剝除器過期會靜默 no-op）。
 *   [B 接線] 藍桌墊能被選到、會被記住、吃 Fable 幾何（縮放鎖、平板絕緣、卡牌大小滑桿）。
 *   [C 範圍] 藍桌墊的每一條 CSS 選擇器都必須 scope 在 .layout-blue 底下（不外洩到其他版面）；
 *        blueDeco 的四個呼叫點都包在 battleLayout === 'blue' 裡；CSS 區塊在樣式最尾端。
 *   [D 卡面規則] 特殊能量一律顯示「特」、基本能量依屬性合併；裝飾不吃滑鼠（不擋點擊與拖放落點）。
 *   [E 衛生] 雲端截圖用的暫時掛鉤不可以進 commit。
 *   ⭐ HEAD-FAIL：B／C／D 在 BASE 上必紅（BASE 沒有藍桌墊）。
 *
 * ⭐v6.442 藍桌墊重製（IRON_RULES Rule 40：守的意圖不變 —— 其他版面零位元組變動、CSS 不外洩、卡面裁定）：
 *   新增 ① blueDiscTop snippet（同一組哨兵內）＋兩個棄牌堆呼叫點 ② <1024 後備排版內的 v6442-blue-fallback 哨兵區塊
 *   ③ HP 條位置改成固定 px（站長要求「版面永久固定」）。本版的新要求另由 test-v6442-blue-fixed-mat 守。
 *
 * Run: node scripts/test-v6441-blue-layout.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { styleEndIndex } from './lib/svelte-style-block.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/routes/game/+page.svelte';
const SRC = readFileSync(join(ROOT, REL), 'utf8').replace(/\r\n/g, '\n');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）；驗法：git branch -a --contains <sha> 要印得出 main。
const BASE_SHA = '3532ad45551b222da9f22385b50b6c98476e00a6'; // v6.440

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const count = (s, sub) => s.split(sub).length - 1;

console.log('0) 前提');
ok('[前提] 讀得到對戰頁', SRC.length > 900000, String(SRC.length));

// ══════════════════════════════════════════════════════════════════════════
// A. 剝除器：本版改動全部還原後必須逐位元等於 BASE
// ══════════════════════════════════════════════════════════════════════════
console.log('\nA) 零回歸：剝除本版改動後與 BASE 逐位元相同');
// 逐條把「本版的寫法」改回「BASE 的寫法」。每一條都必須恰好命中 1 次（命中 0 次＝剝除器過期）。
const REVERT = [
  ["  let battleLayout = $state<'classic' | 'tabletop' | 'fable' | 'blue'>('classic');\n", "  let battleLayout = $state<'classic' | 'tabletop' | 'fable'>('classic');\n"],
  ["  function setBattleLayout(v: 'classic' | 'tabletop' | 'fable' | 'blue'): void {", "  function setBattleLayout(v: 'classic' | 'tabletop' | 'fable'): void {"],
  ["    if (battleLayout === 'fable' || battleLayout === 'blue') { gameZoom = 1; return; }  // fable／藍桌墊自帶 clamp/vw/vh 尺寸,鎖 gameZoom=1 避免雙重縮放",
   "    if (battleLayout === 'fable') { gameZoom = 1; return; }  // fable 版自帶 clamp/vw/vh 尺寸,鎖 gameZoom=1 避免雙重縮放"],
  ["savedLayout === 'fable' || savedLayout === 'blue') battleLayout = savedLayout;", "savedLayout === 'fable') battleLayout = savedLayout;"],
  ["class:tablet-layout={isTabletLayout && !isFableGeom}", "class:tablet-layout={isTabletLayout && battleLayout !== 'fable'}"],
  ["class:layout-fable={isFableGeom} class:layout-blue={battleLayout === 'blue'}", "class:layout-fable={battleLayout === 'fable'}"],
  ["setBattleLayout(e.currentTarget.value as 'classic' | 'tabletop' | 'fable' | 'blue')}>", "setBattleLayout(e.currentTarget.value as 'classic' | 'tabletop' | 'fable')}>"],
  ["              <option value=\"blue\">🟦 新版桌墊（預設 — 固定格線、能量合併顯示）</option>\n", ""],  // v6.446 正名「新版桌墊」
  // v6.446 站長裁定：桌機預設版面改為新版桌墊（說明註解在 v6446-default-blue 哨兵內，由剝除器拿掉）
  ["      else if (typeof window !== 'undefined' && window.innerWidth >= 1024) battleLayout = 'blue';\n", "      else if (typeof window !== 'undefined' && window.innerWidth >= 1024) battleLayout = 'fable';\n"],
  ["          {#if isFableGeom}\n            <div class=\"setting-row\">\n              <label for=\"fable-card-scale\">", "          {#if battleLayout === 'fable'}\n            <div class=\"setting-row\">\n              <label for=\"fable-card-scale\">"],
];
// ⭐v6.448 起：站長裁定的「選擇視窗（picker）全版面統一化」會**刻意**改到所有版面（不是藍桌墊的東西）。
//   為了讓本支【A】繼續守「藍桌墊的程式只活在哨兵裡」這個原意（IRON_RULES Rule 40：改守衛要保留意圖），
//   這些後續版本的改動在這裡逐條還原（每條恰好命中 1 次；內容正確性由各版自己的守衛鎖：test-v6448…）。
//   ⚠ 只准放「非藍桌墊」的全版面改動；藍桌墊的改動一律寫進哨兵。
const LATER = [
  // v6.448 起 picker 統一化的全版面改動（相對 v6.447，由工具逐段產生；內容由 test-v6448／v6449… 各自鎖）
  ["    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();\n    // ⭐v6.448：選單是 translate(-50%,-105%) 往上長 ⇒ 按鈕靠近畫面上緣、選項又多時會超出畫面頂端\n    //   （modalDrag 的 clamp:'contain' 只管拖曳，不管初始位置）。依選項數估高度，把錨點往下推到放得下為止；\n    //   左右也夾在視窗內。估值：標題列＋內距約 60px＋每個選項約 125px（70px 寬卡圖＋名稱＋間距；實測 2 個選項＝293px）。\n    const estH = 60 + evoOpts.length * 125;\n    const vw = typeof window !== 'undefined' ? window.innerWidth : 1366;\n    const vh = typeof window !== 'undefined' ? window.innerHeight : 768;\n    const y = Math.min(Math.max(rect.top, estH * 1.05 + 8), vh - 8);\n    const x = Math.min(Math.max(rect.left + rect.width / 2, 90), vw - 90);\n    floatingEvoMenu = { fromIid, evoOpts, x, y };\n", "    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();\n    floatingEvoMenu = { fromIid, evoOpts, x: rect.left + rect.width / 2, y: rect.top };\n"],
  ["      onOpenPrizes={openPrizeView}\n      onOpenDiscard={(who) => { viewDiscardFor = who === 'me' ? myIdx : oppIdx; }}\n      onOpenRetreat={() => { floatingRetreatMenu = { x: innerWidth / 2, y: innerHeight / 2 }; }}\n", "      onOpenPrizes={openPrizeView}\n"],
  ["{#if showForfeitConfirm}\n  <!-- ⭐v6.453：宣告對手棄權是「要做決定」的視窗 ⇒ 點遮罩不關閉（用「再等等」關；UI 統一化關閉規則） -->\n  <div class=\"forfeit-modal-backdrop\" role=\"presentation\">\n", "{#if showForfeitConfirm}\n  <div class=\"forfeit-modal-backdrop\" onclick={() => showForfeitConfirm = false} role=\"presentation\">\n"],
  ["    <div class=\"selection-overlay\">\n      <div class=\"selection-modal\" class:retreat-modal={isPokePicker || isDmgDist || isEnergyDist} class:pk-s={pendingSelection.type === 'modal-choice'} use:modalDrag={{ resetKey: pendingSelection?.token ?? pendingSelection?.effectKey }}>\n", "    <div class=\"selection-overlay\">\n      <div class=\"selection-modal\" class:retreat-modal={isPokePicker || isDmgDist || isEnergyDist} use:modalDrag={{ resetKey: pendingSelection?.token ?? pendingSelection?.effectKey }}>\n"],
  ["            </div>\n          {:else if pendingSelection.type === 'modal-choice'}\n            <!-- ⭐v6.448：modal-choice 是選「選項／數字」不是選卡 ⇒ 不顯示「選 1 張 · 已選 0」 -->\n            <p class=\"sel-hint\">{pendingSelection.params?.stepper ? '用 ＋／－ 選好數字後按「確認」' : '點一下要執行的選項'}</p>\n", "            </div>\n"],
  ["            <!-- v5.208：加 type gate 避免在 modal-choice（如道具拆除器）誤顯示「沒有符合條件」-->\n            <!-- ⭐v6.448：排序牌庫頂（reorder-deck-top）的卡片清單畫在下方的排序區，這裡本來就是空的 ⇒ 不可以顯示「沒有符合條件」（站長回報的 UI 調查） -->\n            {#if selectionItems.length===0 && pendingSelection.type !== 'modal-choice' && pendingSelection.type !== 'reorder-deck-top'}<p class=\"sel-empty\">（沒有符合條件的卡牌）</p>{/if}\n", "            <!-- v5.208：加 type gate 避免在 modal-choice（如道具拆除器）誤顯示「沒有符合條件」-->\n            {#if selectionItems.length===0 && pendingSelection.type !== 'modal-choice'}<p class=\"sel-empty\">（沒有符合條件的卡牌）</p>{/if}\n"],
  ["          </div>\n          <!-- ⭐v6.451：三套 stepper 合一（原本 .mulligan-stepper 自己一套尺寸） -->\n          <div class=\"modal-choice-stepper\">\n            <button class=\"stepper-btn stepper-minus\"\n", "          </div>\n          <div class=\"mulligan-stepper\">\n            <button class=\"btn-ghost stepper-btn\"\n"],
  ["            <div class=\"stepper-value\">{pickCount}</div>\n            <button class=\"stepper-btn stepper-plus\"\n", "            <div class=\"stepper-value\">{pickCount}</div>\n            <button class=\"btn-ghost stepper-btn\"\n"],
  ["    {@const estSelfDmg = currentN * (spec.selfDamagePerCounter ?? 0)}\n    <div class=\"selection-overlay\">\n      <div class=\"selection-modal pk-s\" use:modalDrag={{ resetKey: pendingSelection?.token ?? pendingSelection?.effectKey }}>\n", "    {@const estSelfDmg = currentN * (spec.selfDamagePerCounter ?? 0)}\n    <div class=\"selection-overlay\">\n      <div class=\"selection-modal\" use:modalDrag={{ resetKey: pendingSelection?.token ?? pendingSelection?.effectKey }}>\n"],
  ["        </div>\n        <!-- ⭐v6.451：三套 stepper 合一 ⇒ 與 modal-choice 的 stepper 同一套 class（原本整段 inline style） -->\n        <div class=\"modal-choice-stepper\">\n          <button class=\"stepper-btn stepper-minus\"\n", "        </div>\n        <div class=\"sel-actions\" style=\"justify-content:center;gap:16px;padding:24px;align-items:center\">\n          <button class=\"btn-ghost\" style=\"padding:8px 18px;font-size:18px;font-weight:bold\"\n"],
  ["            }}>−</button>\n          <div class=\"stepper-value\">{currentN}</div>\n          <button class=\"stepper-btn stepper-plus\"\n", "            }}>−</button>\n          <div style=\"font-size:32px;font-weight:bold;min-width:64px;text-align:center\">{currentN}</div>\n          <button class=\"btn-ghost\" style=\"padding:8px 18px;font-size:18px;font-weight:bold\"\n"],
  ["            }}>+</button>\n          <button class=\"btn-act primary stepper-confirm\"\n", "            }}>+</button>\n          <button class=\"btn-primary\" style=\"padding:12px 24px;font-size:16px;margin-left:24px\"\n"],
  ["        </div>\n        <!-- ⭐v6.452 站長裁定（2026-09-30）：攻擊前的數字視窗補「取消」——按了回到出招前（這回合還能做別的事），\n             與攻擊前選能量的視窗一致；避免手滑按錯招式就非出不可。 -->\n        <div class=\"sel-footer\">\n          <button class=\"btn-act secondary pre-attack-cancel\" title=\"不使用這個招式，回到出招前（這回合還能做別的事）\" onclick={cancelPreAttackDiscard}>取消出招</button>\n        </div>\n", "        </div>\n"],
  ["    {@const noLabel = spec.choiceNoLabel ?? '否'}\n    <div class=\"selection-overlay\">\n      <div class=\"selection-modal pk-s\" use:modalDrag={{ resetKey: pendingSelection?.token ?? pendingSelection?.effectKey }}>\n", "    {@const noLabel = spec.choiceNoLabel ?? '否'}\n    <div class=\"selection-overlay\">\n      <div class=\"selection-modal\" use:modalDrag={{ resetKey: pendingSelection?.token ?? pendingSelection?.effectKey }}>\n"],
  ["        </div>\n        <!-- ⭐v6.451：原本 inline style 的置中大按鈕 ⇒ 共用按鈕列（主要在右、次要在左；手機等寬並排） -->\n        <div class=\"sel-footer\">\n          <button class=\"btn-act primary\"\n", "        </div>\n        <div class=\"sel-actions\" style=\"justify-content:center;gap:24px;padding:24px\">\n          <button class=\"btn-primary\" style=\"padding:12px 32px;font-size:16px\"\n"],
  ["            }}>{yesLabel}</button>\n          <button class=\"btn-act secondary\"\n", "            }}>{yesLabel}</button>\n          <button class=\"btn-ghost\" style=\"padding:12px 32px;font-size:16px\"\n"],
  ["            }}>{noLabel}</button>\n          <!-- ⭐v6.452 站長裁定：是否視窗也補「取消」（回到出招前；「否」是這個招式的一個選項，會照樣出招） -->\n          <button class=\"btn-act secondary pre-attack-cancel\" title=\"不使用這個招式，回到出招前（這回合還能做別的事）\" onclick={cancelPreAttackDiscard}>取消出招</button>\n", "            }}>{noLabel}</button>\n"],
  ["  {#if floatingRetreatMenu && myPlayer?.active}\n    <!-- ⭐v6.449：撤退選單是「要做決定」的視窗 ⇒ 點遮罩不關閉（統一規則；用下方「取消」鈕關閉） -->\n    <div class=\"selection-overlay\">\n", "  {#if floatingRetreatMenu && myPlayer?.active}\n    <div class=\"selection-overlay\" onclick={() => floatingRetreatMenu = null}>\n"],
  ["        </div>\n        {@render promoteGrid(myPlayer.bench, null, (iid) => { dispatch(GameActions.retreat(iid)); floatingRetreatMenu = null; }, actionBusy)}\n", "        </div>\n        <div class=\"retreat-grid\">\n          {#each myPlayer.bench as b}{@const bc=getCard(b.cardId)}\n            {#if bc}\n              {@const eff=hpTotal(b)}\n              {@const rem=hpRemaining(b)}\n              <div class=\"retreat-card\">\n                <button class=\"retreat-zoom\" title=\"放大檢視：{bc.name}\"\n                  onclick={(e)=>{e.stopPropagation();openZoom(b.cardId, b);}}>🔍</button>\n                <button class=\"retreat-pick\" disabled={actionBusy} onclick={(e)=>{e.stopPropagation();dispatch(GameActions.retreat(b.iid));floatingRetreatMenu=null;}}>\n                  <img use:retryImg={bc.imageUrl} src={bc.imageUrl} alt={bc.name}/>\n                  <div class=\"retreat-name\">{bc.name}</div>\n                  <div class=\"retreat-hp\">HP {rem}/{eff}</div>\n                  <div class=\"retreat-nrg\" title=\"附加的能量\">⚡ {energySummary(b)}</div>\n                  {#if b.toolAttached}{@const tc=getCard(b.toolAttached.cardId)}<div class=\"retreat-tool\" title=\"附加道具\">🔧 道具：{tc?.name ?? '?'}</div>{/if}\n                  {#each (b.extraTools ?? []) as etRM}{@const tcRM=getCard(etRM.cardId)}<div class=\"retreat-tool\" title=\"附加道具（多重轉接）\">🔧 道具：{tcRM?.name ?? '?'}</div>{/each}\n                  {#if b.status}<div class=\"retreat-status\" title=\"特殊狀態\">\n                    ⚠️ 狀態：{b.status==='poisoned'?'☠️ 中毒':b.status==='burned'?'🔥 灼傷':b.status==='asleep'?'💤 睡眠':b.status==='confused'?'😵 混亂':b.status==='paralyzed'?'⚡ 麻痺':b.status}\n                  </div>{/if}\n                </button>\n              </div>\n            {/if}\n          {/each}\n          {#if myPlayer.bench.length===0}\n            <p class=\"sel-empty\">（備戰區沒有可上場的寶可夢）</p>\n          {/if}\n        </div>\n"],
  ["       pick／onPick 由呼叫端各自傳入自己的 state —— 不共用（見 confirmSendNewActive 上方註解）。 -->\n  <!-- ⭐v6.451：撤退選單也用這份（原本各抄一份一模一樣的卡片格子）；busy＝送出中時卡片不能按（撤退用 actionBusy，補位固定 false） -->\n  {#snippet promoteGrid(bench: any[], pick: string | null, onPick: (iid: string) => void, busy: boolean = false)}\n", "       pick／onPick 由呼叫端各自傳入自己的 state —— 不共用（見 confirmSendNewActive 上方註解）。 -->\n  {#snippet promoteGrid(bench: any[], pick: string | null, onPick: (iid: string) => void)}\n"],
  ["              onclick={(e)=>{e.stopPropagation();openZoom(b.cardId, b);}}>🔍</button>\n            <button class=\"retreat-pick\" disabled={busy} onclick={(e)=>{e.stopPropagation();onPick(b.iid);}}>\n", "              onclick={(e)=>{e.stopPropagation();openZoom(b.cardId, b);}}>🔍</button>\n            <button class=\"retreat-pick\" onclick={(e)=>{e.stopPropagation();onPick(b.iid);}}>\n"],
  ["  }\n  /* ⭐v6.453 UI 統一化：原本是全站唯一的白底視窗 ⇒ 改成與賽事通知／悔棋請求同一套深色系統視窗（強調色＝紅）；\n     按鈕列同其他視窗：主要（確定獲勝）在右、次要（再等等）在左。 */\n", "  }\n"],
  ["  .forfeit-modal {\n    background: #1a1a2e;\n    border: 2px solid #dc2626;\n    color: #e0e0e0;\n", "  .forfeit-modal {\n    background: #fff;\n"],
  ["    padding: 24px 28px;\n    border-radius: 12px;\n", "    padding: 24px 28px;\n    border-radius: 8px;\n"],
  ["    width: 90%;\n    box-shadow: 0 8px 32px rgba(220, 38, 38, 0.3);\n", "    width: 90%;\n    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);\n"],
  ["    font-size: 18px;\n    color: #fca5a5;\n", "    font-size: 18px;\n    color: #1f1f1f;\n"],
  ["    font-size: 14px;\n    color: #c3c8d0;\n", "    font-size: 14px;\n    color: #4b5563;\n"],
  ["    gap: 12px;\n    justify-content: space-between;\n", "    gap: 12px;\n    justify-content: flex-end;\n"],
  ["  .forfeit-cancel {\n    order: -1;\n", "  .forfeit-cancel {\n"],
  ["    padding: 8px 16px;\n    background: #2a3a5a;\n    color: #ccddff;\n    border: 1px solid #4a5a8a;\n", "    padding: 8px 16px;\n    background: #e5e7eb;\n    color: #1f1f1f;\n    border: none;\n"],
  ["  }\n  .forfeit-cancel:hover { background: #34487a; }\n", "  }\n  .forfeit-cancel:hover { background: #d1d5db; }\n"],
  ["       .playmat.layout-fable .action-bar > .log-col none）＋ .scroll-list 自己 1。\n     ⚠ **遷移後**現況（守衛 C5 盯住這個數字，不是盯註解）：那 18 條會剩 **13 條** ＝\n       modal 容器 8（⭐v6.449 多了 v6449-picker-shell 的桌機 .selection-modal 外框：85dvh＋視窗內捲動；\n       ⭐v6.450 多了 v6450-picker-sheet 的手機棄牌區／獎賞 sheet .zoom-modal.discard-modal）＋\n       非 vh 清單 4 ＋ 下面這條群組規則自己 1；被遷移的 7 個清單 class 一條都不在。\n", "       .playmat.layout-fable .action-bar > .log-col none）＋ .scroll-list 自己 1。\n     ⚠ **遷移後**現況（守衛 C5 盯住這個數字，不是盯註解）：那 18 條會剩 **11 條** ＝\n       modal 容器 6 ＋ 非 vh 清單 4 ＋ 下面這條群組規則自己 1；被遷移的 7 個清單 class 一條都不在。\n"],
  ["  .modal-choice-btn-flex{ flex:1; }\n  /* ⭐v6.448 站長回報的 UI 調查：選項清單與選項按鈕原本**沒有任何樣式**（瀏覽器預設白色按鈕、橫排擠成一列）\n     ⇒ 改成整列可點的清單按鈕（一個選項一列、文字可換行、停用時變暗）。 */\n  .modal-choice-list{ display:flex; flex-direction:column; gap:.45rem; margin:.4rem 0 .2rem; }\n  .modal-choice-row{ display:flex; gap:.45rem; align-items:stretch; }\n  .btn-act.modal-choice-btn{\n    width:100%; justify-content:flex-start; text-align:left; white-space:normal; line-height:1.35;\n    padding:.6rem .9rem; background:#243a5a; color:#e6eeff; border:1px solid #4a6a9a; border-radius:8px;\n  }\n  .btn-act.modal-choice-btn:hover:not(:disabled){ background:#2f4c76; border-color:#7aa4ff; }\n  .btn-act.modal-choice-btn:disabled{ opacity:.45; cursor:not-allowed; }\n  .btn-act.modal-choice-inspect{ flex:0 0 auto; padding:.4rem .7rem; background:#12202e; border:1px solid #3a5a7a; border-radius:8px; }\n", "  .modal-choice-btn-flex{ flex:1; }\n"],
  ["  /* v4.923：mulligan stepper — +/- 計數器 UI */\n  /* ⭐v6.451：.mulligan-stepper 併入 .modal-choice-stepper（三套 stepper 合一），原本的三條尺寸規則移除 */\n", "  /* v4.923：mulligan stepper — +/- 計數器 UI */\n  .mulligan-stepper{ display:flex; align-items:center; justify-content:center; gap:18px; padding:6px 0 2px; }\n  .mulligan-stepper .stepper-btn{ padding:8px 22px; font-size:22px; font-weight:bold; min-width:64px; border-radius:8px; }\n  .mulligan-stepper .stepper-value{ font-size:42px; font-weight:bold; min-width:80px; text-align:center; color:#ffd070; line-height:1; }\n"],
  ["  .prize-view-btn:hover{ background:rgba(255,210,63,.28); }\n\n  /* >>> v6449-picker-shell */\n  /* ═══════════════════════════════════════════════════════════════════\n     ⭐v6.449 選擇視窗（picker）桌機統一化 —— 站長 2026-09-30 採用 claude/UI統一化-picker調查報告.md 的建議\n       ① 外框只有三級寬度：S 480（是否／數字／選項）、M 760（選卡、選寶可夢；預設）、L 960（棄牌區、獎賞檢視）\n          一律 min(尺寸, 100vw − 32px)、box-sizing:border-box（寬度就是看到的寬度）；高度上限 85dvh，超出時視窗內捲動、\n          按鈕列黏在底部永遠看得到（1366×657 筆電先前會被切掉最後一列）。\n       ② 可選的卡圖一律 96px（牌庫／手牌／棄牌搜尋原本 64、能量 88、棄牌區 108、暗黑底牌 80）；卡圖不超過格子寬\n          ⇒ 任何寬度都不會疊到隔壁張。\n       ③ 按鈕列：主要動作（確認）在右、次要動作（取消／跳過／放棄）在左；沒有樣式的 btn-ghost 與不帶 primary 的 btn-act\n          一律用「次要」樣式（原本是瀏覽器預設灰鈕）。\n       ④ 遮罩深淺統一 .82（放大檢視類原本 .88）。\n     ⚠ 這一段放在所有桌機 picker 規則之後、手機直式／手機橫式媒體查詢之前：\n       同特異度時桌機由這裡決定；手機兩個媒體查詢在後面，照舊由它們蓋回（手機改版是 v6.450 的事）。\n       所以這裡的選擇器**刻意維持低特異度**（寬度用 :where() 包住變體 class），不可以隨手加長。\n     ⚠ 本頁媒體查詢數量被 test-v6187／v6195／v6199 釘住 ⇒ 這裡不新增任何媒體查詢。\n     ═══════════════════════════════════════════════════════════════════ */\n  /* ⭐v6.453 視窗層級（z-index）刻度——新視窗照這張表挑數字，不要再自創：\n       棋盤內元素（各版面自己的疊放，都關在 .playmat 自己的層級裡）＜ 50 浮動進化選單（50／51）\n       ＜ 100 選擇視窗（.selection-overlay，要做決定）＜ 200 檢視視窗（.zoom-overlay：放大／棄牌區／獎賞／設定）\n       ＜ 2000 宣告棄權確認 ＜ 9000～9999 動畫／提示／預覽（擲幣、飛卡、傷害數字、吐司、拖曳預覽、燈箱）\n       ＜ 10000 系統詢問（賽事通知、悔棋請求、版本閘）＜ 100000 名人堂全螢幕。\n     盤點（v6.453）：沒有「檢視視窗蓋不過選擇視窗」或「提示被視窗蓋住」的倒置。 */\n  .selection-overlay, .zoom-overlay{ --pk-s:480px; --pk-m:760px; --pk-l:960px; --pk-card:96px; }\n  .zoom-overlay{ background:rgba(0,0,0,.82); }\n\n  /* ① 外框寬度：以 --pk-w 決定，變體只改 --pk-w */\n  .selection-modal{\n    --pk-w:var(--pk-m);\n    box-sizing:border-box; width:100%; max-width:min(var(--pk-w), calc(100vw - 32px));\n    max-height:85dvh; overflow-y:auto; overscroll-behavior:contain;\n  }\n  :where(.selection-modal).pk-s,\n  :where(.selection-modal).mulligan-modal:not(.mulligan-reveal-modal){ --pk-w:var(--pk-s); }\n  :where(.zoom-modal).discard-modal{ --pk-w:var(--pk-l); box-sizing:border-box; width:100%; max-width:min(var(--pk-w), calc(100vw - 32px)); max-height:85dvh; }\n  /* ⭐v6.453：設定面板原本寫了 max-width:500px 但被 .zoom-modal 的 864px 蓋掉（從沒生效）⇒ 收進三級寬度的 M（760） */\n  :where(.zoom-modal).settings-modal{ --pk-w:var(--pk-m); box-sizing:border-box; width:100%; max-width:min(var(--pk-w), calc(100vw - 32px)); }\n  /* 按鈕列黏在視窗底部（內容多到要捲動時仍看得到「確認」） */\n  .selection-modal > .sel-footer{ position:sticky; bottom:0; z-index:2; background:inherit; padding-top:.35rem; }\n\n  /* ② 卡圖 96px、不超過格子 */\n  .sel-grid{ grid-template-columns:repeat(auto-fill,minmax(112px,1fr)); gap:.5rem; }\n  .sel-grid.sel-grid-energy{ grid-template-columns:repeat(auto-fill,minmax(112px,1fr)); }\n  .discard-modal .sel-grid{ grid-template-columns:repeat(auto-fill,minmax(112px,1fr)); }\n  .sel-card img,\n  .sel-grid.sel-grid-energy .sel-card img,\n  .discard-modal .sel-card img{ width:var(--pk-card); max-width:100%; height:auto; }\n  .sel-card{ min-width:0; box-sizing:border-box; }\n  .copy-attack-img{ width:var(--pk-card); }\n  /* 純瀏覽的密集清單（牌庫剩餘全覽）小一級：72px */\n  .full-deck-list{ grid-template-columns:repeat(auto-fill,minmax(72px,1fr)); }\n  .prize-view-cardback{ width:var(--pk-card); height:calc(var(--pk-card) * 1.397); max-width:100%; }\n\n  /* ③ 按鈕列：次要在左、主要在右（::before 當彈簧；警告文字獨佔第一行） */\n  .sel-footer{ justify-content:flex-start; align-items:center; }\n  .sel-footer::before{ content:''; flex:1 1 0; order:0; }\n  .sel-footer > .sel-hint-warn{ order:-4; flex:1 0 100%; margin-bottom:0; }\n  /* ⭐v6.452：攻擊前視窗的「取消（不使用這個招式）」排在最左（「否」是招式的選項，排在它右邊） */\n  .sel-footer > .btn-act.secondary.pre-attack-cancel{ order:-3; }\n  .sel-footer > :is(.btn-act.secondary, .btn-ghost, .btn-act:not(.primary)){ order:-1; }\n  .selection-modal .btn-ghost:not(.stepper-btn),\n  .zoom-modal .btn-ghost:not(.stepper-btn),\n  .sel-footer > .btn-act:not(.primary):not(.secondary){\n    background:#2a3a5a; color:#ccddff; border:1px solid #4a5a8a; border-radius:6px; font:inherit; font-weight:600; cursor:pointer;\n  }\n  .selection-modal .btn-ghost:not(.stepper-btn):hover:not(:disabled),\n  .zoom-modal .btn-ghost:not(.stepper-btn):hover:not(:disabled),\n  .sel-footer > .btn-act:not(.primary):not(.secondary):hover:not(:disabled),\n  .sel-footer > .btn-act.secondary:hover:not(:disabled){ background:#34487a; border-color:#6a7ab0; }\n  .selection-modal .btn-ghost:disabled{ opacity:.4; cursor:not-allowed; }\n  /* <<< v6449-picker-shell */\n", "  .prize-view-btn:hover{ background:rgba(255,210,63,.28); }\n"],
  ["    .sel-grid.sel-grid-energy .sel-energy-source{ font-size:0.62rem; }\n    /* ⭐v6.448：手機格子被壓到 54px 起跳，但卡圖原本固定 64px（棄牌區 108px）⇒ 撐破格子、疊到隔壁張（站長回報的 UI 調查）。\n       卡圖改成跟著格子縮（能量 picker 的 60px 特異度較高、不受影響）。 */\n    .sel-grid .sel-card{ min-width:0; }\n    .sel-grid .sel-card img,\n    .discard-modal .sel-grid .sel-card img{ width:100%; max-width:100%; height:auto; }\n    /* 手機不顯示「💡 按住標題列可拖曳」提示（手機少有拖曳需求，省一行高度） */\n    .selection-overlay .selection-modal::after{ display:none; }\n", "    .sel-grid.sel-grid-energy .sel-energy-source{ font-size:0.62rem; }\n"],
  ["    .seat-area { grid-template-columns: 1fr !important; gap: 0.4rem; }\n\n    /* >>> v6450-picker-sheet */\n    /* ═════════════════════════════════════════════════════════════════\n       ⭐v6.450 手機直式的選擇視窗一律「從底部升起的 sheet」（站長 2026-09-30 裁定；和手機的撤退／附能 sheet 同一套）\n         ・全寬、上方圓角、最高 85dvh、只有 sheet 本身捲動（格子不再自己捲 ⇒ 沒有雙層捲動）、按鈕列黏在 sheet 底部\n         ・每列固定張數：卡片（含能量）4 張、寶可夢 3 隻、牌庫全覽 5 張；卡圖寬＝格寬（永遠不會疊）\n         ・按鈕列的按鈕等寬並排、至少 44px 高（拇指好按）；次要在左、主要在右（沿用 v6.449）\n         ・只看不選的棄牌區／獎賞檢視也改成底部 sheet；卡片放大維持置中\n       ⚠ 寫在這個既有的媒體查詢區塊尾端（本頁媒體查詢數量被 test-v6187／v6195／v6199 釘住，不可新增）。\n       ═════════════════════════════════════════════════════════════════ */\n    .selection-overlay{ align-items:flex-end; padding-top:calc(var(--safe-top, 0px) + .4rem); padding-bottom:0; }\n    .selection-modal{\n      width:100vw; max-width:100vw; max-height:85dvh; margin:0;\n      border-radius:16px 16px 0 0; border-bottom:none;\n      padding:.75rem .85rem calc(.75rem + var(--safe-bottom, 0px));\n    }\n    .selection-overlay .selection-modal{ box-shadow:0 -6px 24px rgba(0,0,0,.55); }\n    /* 子元素不縮（否則會被 flex 壓扁、變成格子自己在捲 ⇒ 雙層捲動） */\n    .selection-modal > *,\n    .zoom-modal.discard-modal > *{ flex-shrink:0; }\n    .selection-modal .sel-grid,\n    .selection-modal .retreat-grid,\n    .selection-modal .copy-attack-list,\n    .selection-modal .full-deck-list{ --scroll-list-max:none; }\n    .sel-grid{ grid-template-columns:repeat(4, minmax(0, 1fr)) !important; gap:.4rem; }\n    .sel-grid.sel-grid-energy{ grid-template-columns:repeat(4, minmax(0, 1fr)) !important; gap:.4rem; }\n    .sel-grid.sel-grid-energy .sel-card img{ width:100%; }\n    .retreat-grid{ grid-template-columns:repeat(3, minmax(0, 1fr)); gap:.4rem; }\n    .retreat-pick{ min-width:0; padding:.35rem .2rem .4rem; font-size:.66rem; }\n    .retreat-pick img{ width:100%; max-width:96px; }\n    .full-deck-list{ grid-template-columns:repeat(5, minmax(0, 1fr)); }\n    .selection-modal > .sel-footer{ padding-top:.5rem; }\n    .sel-footer::before{ display:none; }\n    .sel-footer > :is(button, .btn-act, .btn-primary, .btn-ghost){ flex:1 1 0; min-height:44px; justify-content:center; text-align:center; white-space:normal; box-sizing:border-box; }  /* ⭐v6.453：border-box */\n    /* ⭐v6.453：flex-basis:0 時框線寬度不會被「平分」吃掉（次要鈕有 1px 框、主要鈕沒有 ⇒ 差 2px 不等寬，量測守衛抓到）⇒ 主要鈕補同寬的透明框 */\n    .sel-footer > .btn-act.primary{ border:1px solid transparent; }\n    /* 只看不選的棄牌區／獎賞檢視：也從底部升起 */\n    .zoom-overlay:has(> .discard-modal){ align-items:flex-end; padding:0; padding-top:calc(var(--safe-top, 0px) + .4rem); }\n    .zoom-modal.discard-modal{\n      width:100vw; max-width:100vw; max-height:85dvh; margin:0; margin-top:auto; overflow-y:auto;\n      border-radius:16px 16px 0 0; border-bottom:none;\n      padding:.75rem .85rem calc(.75rem + var(--safe-bottom, 0px));\n    }\n    .discard-modal .sel-grid{ --scroll-list-max:none; }\n    /* <<< v6450-picker-sheet */\n", "    .seat-area { grid-template-columns: 1fr !important; gap: 0.4rem; }\n"],
  ["    /* ── 選擇 modal ── */\n    /* ⭐v6.450：手機橫式的選擇視窗維持置中，高度上限放寬到 90dvh（統一化建議；原本 82vh） */\n    .selection-modal{ max-width:580px; width:96vw; max-height:90dvh; padding:0.6rem; gap:0.4rem; }\n", "    /* ── 選擇 modal ── */\n    .selection-modal{ max-width:580px; width:96vw; max-height:82vh; padding:0.6rem; gap:0.4rem; }\n"],
  ["  /* v6.022 錦標賽通知：首次詢問視窗 */\n  /* ⭐v6.451：賽事通知詢問與對手悔棋請求是同一種「系統詢問」視窗 ⇒ 共用一份外框，只留強調色不同（原本兩份幾乎一樣的規則） */\n  .notify-prompt-overlay,\n  .undo-modal-overlay {\n", "  /* v6.022 錦標賽通知：首次詢問視窗 */\n  .notify-prompt-overlay {\n"],
  ["  }\n  .notify-prompt-modal,\n  .undo-request-modal {\n    --sys-accent: #4a9eff;\n    --sys-glow: rgba(74, 158, 255, 0.3);\n", "  }\n  .notify-prompt-modal {\n"],
  ["    background: #1a1a2e;\n    border: 2px solid var(--sys-accent);\n", "    background: #1a1a2e;\n    border: 2px solid #4a9eff;\n"],
  ["    color: #e0e0e0;\n    box-shadow: 0 8px 32px var(--sys-glow);\n", "    color: #e0e0e0;\n    box-shadow: 0 8px 32px rgba(74, 158, 255, 0.3);\n"],
  ["  }\n  .undo-request-modal { --sys-accent: #f59e0b; --sys-glow: rgba(245, 158, 11, 0.3); }\n", "  }\n"],
  ["  .notify-prompt-btns { display: flex; gap: 12px; margin-top: 18px; justify-content: flex-end; }\n\n", "  .notify-prompt-btns { display: flex; gap: 12px; margin-top: 18px; justify-content: flex-end; }\n\n  .undo-modal-overlay {\n    position: fixed; inset: 0;\n    background: rgba(0, 0, 0, 0.65);\n    z-index: 10000;\n    display: flex; align-items: center; justify-content: center;\n  }\n  .undo-request-modal {\n    background: #1a1a2e;\n    border: 2px solid #f59e0b;\n    border-radius: 12px;\n    padding: 24px 28px;\n    max-width: 460px;\n    width: 90vw;\n    color: #e0e0e0;\n    box-shadow: 0 8px 32px rgba(245, 158, 11, 0.3);\n  }\n"],
];
function strip(src) {
  let s = src;
  const bad = [];
  // ① 哨兵區塊（helper／snippet／CSS）與 isFableGeom 宣告
  const blocks = [
    /\n  \/\/ >>> v6441-blue-helper\n[\s\S]*?\n  \/\/ <<< v6441-blue-helper/,
    /<!-- >>> v6441-blue-snippet -->\n[\s\S]*?<!-- <<< v6441-blue-snippet -->\n/,
    /  \/\* >>> v6441-blue-css \*\/[\s\S]*?  \/\* <<< v6441-blue-css \*\/\n/,
    /  \/\* >>> v6441-blue-geom \*\/[\s\S]*?  \/\* <<< v6441-blue-geom \*\/\n/,
    /    \/\* >>> v6442-blue-fallback \*\/[\s\S]*?    \/\* <<< v6442-blue-fallback \*\/\n/,
    // v6.443：場上卡片放大預覽改放卡片旁邊（只在藍桌墊生效的一段 script，內容由 test-v6443 鎖）
    /    \/\/ >>> v6443-blue-peek\n[\s\S]*?    \/\/ <<< v6443-blue-peek\n/,
    // v6.446：預設版面改新版桌墊的說明註解（哨兵內只准註解，下方另驗）
    /      \/\/ >>> v6446-default-blue\n[\s\S]*?      \/\/ <<< v6446-default-blue\n/,
    /  \/\/ ⭐v6\.441 藍桌墊（blue）＝[\s\S]*?  const isFableGeom = \$derived\(battleLayout === 'fable' \|\| battleLayout === 'blue'\);\n/,
  ];
  for (const re of blocks) { if (!re.test(s)) bad.push(String(re).slice(0, 40)); s = s.replace(re, ''); }
  // ② 四個呼叫點
  const call = /\{#if battleLayout === 'blue'\}\{@render blueDeco\([^)]*\)\}\{\/if\}/g;
  const nCalls = (s.match(call) || []).length;
  s = s.replace(call, '');
  // ②b v6.442 兩個棄牌堆呼叫點
  const dcall = /\{#if battleLayout === 'blue'\}\{@render blueDiscTop\((?:oppPlayer|myPlayer)\?\.discard\)\}\{\/if\}/g;
  const nDisc = (s.match(dcall) || []).length;
  s = s.replace(dcall, '');
  // ③ 逐條還原
  for (const [a, b] of [...LATER, ...REVERT]) { const c = count(s, a); if (c !== 1) bad.push(`還原條目命中 ${c} 次：${a.slice(0, 50)}`); s = s.split(a).join(b); }
  return { s, bad, nCalls, nDisc };
}
const st = strip(SRC);
ok('[剝除器] 每一個哨兵區塊與還原條目都恰好命中（剝除器沒有過期）', st.bad.length === 0, st.bad.join(' ｜ '));
ok('[剝除器] blueDeco 呼叫點恰好 4 個（對手備戰／對手戰鬥／我方戰鬥／我方備戰）', st.nCalls === 4, String(st.nCalls));
ok('[剝除器] blueDiscTop 呼叫點恰好 2 個（對手棄牌／我方棄牌）', st.nDisc === 2, String(st.nDisc));
ok('[剝除器] 剝除後真的有變（否則是靜默 no-op）', st.s !== SRC);
{
  // ⭐ 剝除器只證明「哨兵外面」沒變 ⇒ 哨兵「裡面」要另外鎖內容，否則在哨兵裡夾帶任何東西都會全綠（fable 審查 M7／M8 實證）。
  const hb = /\n  \/\/ >>> v6441-blue-helper\n([\s\S]*?)\n  \/\/ <<< v6441-blue-helper/.exec(SRC);
  const code = hb ? hb[1].split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n') : '';
  const topLevel = [...code.matchAll(/^  (?:const|let|function|\$effect|\$derived)\b[^\n]*/gm)].map((x) => x[0].trim().split(/[\s(<:=]/).slice(0, 2).join(' '));
  ok('★★[哨兵內容] helper 區塊只宣告 BLUE_ZH_TYPE 與 blueEnergyChips 兩個頂層識別字，沒有夾帶其他程式',
    !!hb && JSON.stringify(topLevel) === JSON.stringify(['const BLUE_ZH_TYPE', 'function blueEnergyChips']), JSON.stringify(topLevel));
  ok('★★[哨兵內容] helper 區塊不讀寫任何版面／狀態（無 $effect、$state、battleLayout、fableCardScale、game 寫入）',
    !!hb && !/\$effect|\$state|battleLayout|fableCardScale|setBattleLayout|\bgame\s*=/.test(code));
  const sb = /<!-- >>> v6441-blue-snippet -->\n([\s\S]*?)<!-- <<< v6441-blue-snippet -->/.exec(SRC);
  const sn = sb ? sb[1].replace(/<!--[\s\S]*?-->/g, '').trim() : '';
  // v6.442：哨兵內恰好兩個 snippet（blueDeco、blueDiscTop），snippet 與 snippet 之間沒有夾帶任何 markup
  const between = sn.replace(/\{#snippet [\s\S]*?\{\/snippet\}/g, '').trim();
  ok('★★[哨兵內容] snippet 區塊只有 blueDeco 與 blueDiscTop 兩個 snippet，外面沒有夾帶任何 markup',
    sn.startsWith('{#snippet blueDeco(') && sn.endsWith('{/snippet}') && count(sn, '{#snippet') === 2 && count(sn, '{/snippet}') === 2
      && sn.includes('{#snippet blueDiscTop(') && between === '', sn.slice(0, 60) + ' … ' + JSON.stringify(between.slice(0, 60)));
  const gb = /  \/\/ ⭐v6\.441 藍桌墊（blue）＝([\s\S]*?)  const isFableGeom = /.exec(SRC);
  ok('★[哨兵內容] isFableGeom 宣告前面只有註解行', !!gb && gb[1].split('\n').slice(1).filter((l) => l.trim()).every((l) => /^\s*\/\//.test(l)));
}
let BASE_SRC = null;
if (!hasBaseCommit(ROOT, BASE_SHA)) {
  shallowSkip('v6441 A：剝除後與 BASE 逐位元比對', '需要 BASE commit');
} else {
  const r = readBaseBlob(ROOT, BASE_SHA, REL);
  ok('[前提] 讀得到 BASE 的對戰頁', r.ok && r.out.length > 900000);
  if (r.ok) {
    BASE_SRC = r.out.replace(/\r\n/g, '\n');
    ok('★★★[零回歸] 剝除本版改動後，對戰頁與 BASE（v6.440）逐位元相同 ⇒ 經典／桌墊／Fable／手機版面零位元組變動', st.s === BASE_SRC,
      (() => { let i = 0; while (i < st.s.length && st.s[i] === BASE_SRC[i]) i++; return `第一個差異在字元 ${i}：${JSON.stringify(st.s.slice(i, i + 80))} vs ${JSON.stringify(BASE_SRC.slice(i, i + 80))}`; })());
    ok('★★★[HEAD-FAIL] BASE 沒有藍桌墊', !BASE_SRC.includes("'blue'") && !BASE_SRC.includes('layout-blue'));
  }
}

// ══════════════════════════════════════════════════════════════════════════
// B. 接線
// ══════════════════════════════════════════════════════════════════════════
console.log('\nB) 接線');
ok('★★[HEAD-FAIL] 設定面板有「藍桌墊」選項', SRC.includes('<option value="blue">'));
ok('★★[HEAD-FAIL] 重新整理後記得藍桌墊（localStorage 讀回接受 blue）', SRC.includes("savedLayout === 'blue') battleLayout = savedLayout;"));
ok('★★[HEAD-FAIL] 藍桌墊吃 Fable 幾何：playmat 同時掛 layout-fable 與 layout-blue', SRC.includes('class:layout-fable={isFableGeom} class:layout-blue={battleLayout === \'blue\'}'));
ok('★★[HEAD-FAIL] 藍桌墊鎖 gameZoom=1（避免與 --card-w 雙重縮放）', SRC.includes("if (battleLayout === 'fable' || battleLayout === 'blue') { gameZoom = 1; return; }"));
ok('★[HEAD-FAIL] 藍桌墊與平板縮放絕緣', SRC.includes('class:tablet-layout={isTabletLayout && !isFableGeom}'));
ok('★[HEAD-FAIL] 藍桌墊也有卡牌大小滑桿', SRC.includes('{#if isFableGeom}\n            <div class="setting-row">\n              <label for="fable-card-scale">'));
// ⭐v6.446 站長裁定（Rule 40：原本守「預設仍是 Fable」，站長改判預設＝新版桌墊）：只影響從未選過版面的桌機玩家（行為另由 test-v6223【C】實跑）。
ok('★[站長裁定 v6.446] 桌機新玩家的預設版面是新版桌墊（blue），而且只寫在「從未選過」的分支', SRC.includes("      else if (typeof window !== 'undefined' && window.innerWidth >= 1024) battleLayout = 'blue';\n") && !SRC.includes("battleLayout = 'fable';"));
{
  const db = /      \/\/ >>> v6446-default-blue\n([\s\S]*?)      \/\/ <<< v6446-default-blue\n/.exec(SRC);
  ok('★[哨兵內容] v6446-default-blue 哨兵內只有註解', !!db && db[1].split('\n').filter((l) => l.trim()).every((l) => /^\s*\/\//.test(l)));
}
ok('[正名] 設定選項顯示「新版桌墊」，不再出現「藍桌墊」字樣', SRC.includes('<option value="blue">🟦 新版桌墊') && !/<option[^>]*>[^<]*藍桌墊/.test(SRC));
ok('[正對照] 手機直式元件不讀 battleLayout（手機版面維持現況）',
  !readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8').includes('battleLayout'));

// ══════════════════════════════════════════════════════════════════════════
// C. 範圍
// ══════════════════════════════════════════════════════════════════════════
console.log('\nC) 範圍：藍桌墊的 CSS 不外洩');
const m0 = /  \/\* >>> v6441-blue-css \*\/([\s\S]*?)  \/\* <<< v6441-blue-css \*\//.exec(SRC);
const mg = /  \/\* >>> v6441-blue-geom \*\/([\s\S]*?)  \/\* <<< v6441-blue-geom \*\//.exec(SRC);
const mf = /    \/\* >>> v6442-blue-fallback \*\/([\s\S]*?)    \/\* <<< v6442-blue-fallback \*\//.exec(SRC);
const m = m0 && mg && mf ? [null, m0[1] + '\n' + mg[1] + '\n' + mf[1]] : null;
ok('★★[HEAD-FAIL] 找得到藍桌墊 CSS 區塊（外觀＋幾何＋<1024 後備三塊）', !!m);
if (m) {
  ok('★★[媒體查詢] 藍桌墊的兩塊 CSS 一個 @media 都沒有（本頁 @media 數量被 v6187／v6195／v6199 釘住：不准新增媒體查詢當手機開關）', !/@media/.test(m[1]));
  const iG = SRC.indexOf('/* >>> v6441-blue-geom */');
  const iFb = SRC.indexOf('  @media (max-width: 1023px){\n    .playmat.layout-fable{ --card-w-cap:9999px;');
  ok('★★[順序] 幾何區塊在 Fable 基礎規則之後、Fable 後備排版（<1024）之前 ⇒ 桌機吃藍桌墊 grid、窄視窗由後備排版蓋回',
    iG > SRC.indexOf('.playmat.layout-fable{') && iFb > iG && SRC.slice(SRC.indexOf('/* <<< v6441-blue-geom */') + 26, iFb).trim() === '', `${iG} ${iFb}`);
}
if (m) {
  const css = m[1].replace(/\/\*[\s\S]*?\*\//g, '');
  // 取出所有規則的選擇器（跳過 @media／@keyframes 這種 at-rule 開頭）
  const sels = [];
  let i = 0, buf = '';
  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') {
      const pre = buf.trim(); buf = '';
      if (!pre.startsWith('@')) {
        for (const x of pre.split(',')) sels.push(x.trim());
        let d = 1; i++; while (i < css.length && d > 0) { if (css[i] === '{') d++; else if (css[i] === '}') d--; i++; }
        continue;
      }
      i++; continue;
    }
    if (ch === '}') { buf = ''; i++; continue; }
    buf += ch; i++;
  }
  ok('[自我驗證] 解析得出大量選擇器', sels.length > 60, String(sels.length));
  const leak = sels.filter((x) => !/^\.playmat\.layout-blue(?![\w-])/.test(x) && !/^\.battle-root:has\(\.playmat\.layout-blue\)/.test(x));
  ok('★★★[範圍] 每一條選擇器都 scope 在 .playmat.layout-blue 或 .battle-root:has(.playmat.layout-blue) 底下', leak.length === 0, leak.slice(0, 5).join(' ｜ '));
  const iBlue = SRC.indexOf('/* >>> v6441-blue-css */');
  const iEnd = styleEndIndex(SRC, REL);
  ok('★[順序] 藍桌墊 CSS 在 Fable 規則之後、樣式區塊最尾端（同特異度後者勝）',
    iBlue > SRC.indexOf('.playmat.layout-fable{') && SRC.slice(SRC.indexOf('/* <<< v6441-blue-css */'), iEnd).trim() === '/* <<< v6441-blue-css */');
}
const calls = SRC.match(/\{@render blueDeco\([^)]*\)\}/g) || [];
const guarded = SRC.match(/\{#if battleLayout === 'blue'\}\{@render blueDeco\([^)]*\)\}\{\/if\}/g) || [];
ok('★★[HEAD-FAIL／範圍] blueDeco 四個呼叫點全部包在 battleLayout === \'blue\' 裡（其他版面不 render）', calls.length === 4 && guarded.length === 4, `${calls.length}/${guarded.length}`);

// ══════════════════════════════════════════════════════════════════════════
// D. 卡面規則（站長裁定）
// ══════════════════════════════════════════════════════════════════════════
console.log('\nD) 卡面規則');
const h = /\/\/ >>> v6441-blue-helper\n([\s\S]*?)\/\/ <<< v6441-blue-helper/.exec(SRC);
ok('★★[HEAD-FAIL] 找得到藍桌墊能量分組 helper', !!h);
if (h) {
  const body = h[1];
  ok('★★[裁定] 特殊能量一律只顯示「特」（不依卡名折算屬性）', /else special\+\+;/.test(body) && /label: '特'/.test(body) && !/Rainbow/.test(body));
  ok('★[裁定] 基本能量依屬性合併計數（圖示×N）', /basic\.set\(t, \(basic\.get\(t\) \?\? 0\) \+ 1\)/.test(body));
}
if (m) {
  const css = m[1];
  const noPtr = (cls) => new RegExp('\\.playmat\\.layout-blue \\.' + cls + '\\{[^}]*pointer-events:none').test(css);
  // v6.445（fable 審查語意漂移）：v6.444 起道具縮圖的 <img> 本身吃滑鼠（hover 預覽／點開），外框 .bl-tool 仍不吃；拖放判定走 closest(data-drop-type) 不受影響。
  ok('★★[不擋操作] 傷害黃圓／能量列／道具縮圖外框不吃滑鼠事件（縮圖 img 本身例外：v6.444 hover 預覽）', noPtr('bl-dmg') && noPtr('bl-tool') && noPtr('bl-chips'));
  ok('★[裁定] 備戰卡名稱平常不顯示、滑鼠移上才顯示',
    /\.playmat\.layout-blue \.bench-slot \.bench-name,\s*\n\s*\.playmat\.layout-blue \.bench-slot \.bench-stat,[^{]*\{ display:none; \}/.test(css) && /\.bench-slot:hover \.bench-name\{/.test(css));
  ok('★[裁定] 戰鬥寶可夢 HP 條在卡片下方（固定 px 間距）', /\.active-card \.active-hpbar-bottom\{\s*\n\s*top:calc\(100% \+ \d+px\)/.test(css));
}
ok('★[圖片重試] 道具縮圖的動態 <img> 有掛 use:retryImg', /<span class="bl-tool"[\s\S]{0,300}?<img use:retryImg=\{_tc\?\.imageUrl\}/.test(SRC));
ok('★[圖片重試] 棄牌堆最上面那張的動態 <img> 有掛 use:retryImg', /<img class="bl-disc" use:retryImg=\{_dc\.imageUrl\}/.test(SRC));

// ══════════════════════════════════════════════════════════════════════════
// E. 衛生
// ══════════════════════════════════════════════════════════════════════════
console.log('\nE) 衛生');
ok('★★[衛生] 雲端截圖用的暫時掛鉤沒有進 commit', !SRC.includes('DEV-SHOT-HOOK') && !SRC.includes('__devShot'));

console.log(`\n=== v6.441 藍桌墊版面: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6441-blue-layout ===');
process.exit(fail ? 1 : 0);
