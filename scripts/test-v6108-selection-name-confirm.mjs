// v6.108 守衛：選卡防呆 —— 已選卡名必須在「按下確定之前」就看得見，且選卡清單必須有穩定 key。
//
// 事件：玩家 DCG_Bear（錦標賽 evt_msb1nw9i_r1_m14）回報「第 11 步我要拿的是祭典會場，
//   結果卻變成捕蟲組合」。回放盤面 diff 證實：那回合牌庫的捕蟲組合 -1、兩張祭典會場完全沒動。
//   但引擎與送出路徑逐項查證都正確：
//     - 全程綁 iid（toggleSelection(iid) → selectionPicked → selectedIids → server 端 deck.filter by iid）
//     - 11 個快照、雙方所有區域掃描，iid 零碰撞
//     - 錦標賽 client 完全不跑本地 applyAction，不會自己洗牌 → 不存在「順序錯位」窗口
//     - 不是 v6.101 的卡圖重試 action（那是這場比賽之後才上線的）
//   ⇒ 找不到「顯示 A、實得 B」的成立路徑。最可能是單選 picker 的 v2.86「點第二張會靜默
//     換掉選取」＋「確認前完全不顯示選了什麼」造成誤選。本版做的是**防呆**，不是修引擎。
//
// ⚠ 本檔是純靜態守衛（讀 .svelte 原始碼）——UI 行為無法在 node 端跑，但「消費點有沒有接」
//   可以釘死。記憶教訓：中央述詞寫好 ≠ 消費點有接（v6.088/6.098），所以**提示列與確認鈕
//   兩個消費點各斷言一次**。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GP = join(ROOT, 'src/routes/game/+page.svelte');
const src = readFileSync(GP, 'utf8');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}

console.log('① 選卡清單必須有穩定 key（v6.101 已證非 keyed 節點重用會咬人）');

T('⭐ 每一個 {#each selectionItems ...} 都帶 (item.iid) key', () => {
  const all = src.match(/\{#each selectionItems as [^}]*\}/g) ?? [];
  assert.ok(all.length >= 4, '找不到 selectionItems 的 each（選卡清單被改寫了？請同步更新本守衛）');
  const bad = all.filter(m => !/\(item\.iid\)/.test(m));
  assert.strictEqual(bad.length, 0, '這些 each 沒有 iid key：\n        ' + bad.join('\n        '));
});

T('正對照：沒有 key 的樣本會被抓出來', () => {
  const probe = '{#each selectionItems as item}{@const c=getCard(item.cardId)}';
  const all = [probe, '{#each selectionItems as item (item.iid)}'];
  const bad = all.filter(m => !/\(item\.iid\)/.test(m));
  assert.strictEqual(bad.length, 1, '判準抓不到無 key 的樣本 ⇒ 這條守衛是假綠');
});

console.log('② 已選卡名：單一來源 + 兩個消費點都要接');

T('⭐ 中央來源 selectedNamesLabel / selectedCardNames 存在', () => {
  assert.ok(/const selectedCardNames = \$derived/.test(src), '缺少 selectedCardNames');
  assert.ok(/const selectedNamesLabel = \$derived/.test(src), '缺少 selectedNamesLabel');
});

T('⭐ 卡名一律用 iid 比對取得（不得用位置／index 反查）', () => {
  const m = src.match(/const selectedCardNames = \$derived\.by\(\(\) => \{[\s\S]{0,900}?\n  \}\);/);
  assert.ok(m, '抓不到 selectedCardNames 的實作');
  const body = m[0];
  assert.ok(/selectionPicked\.has\(it\.iid\)/.test(body), '要用 selectionPicked.has(it.iid) 過濾');
  assert.ok(!/selectionItems\[/.test(body), '不得用 selectionItems[index] 反查（位置不是卡的身分）');
});

T('⭐ 消費點 A（判定前的提示列）：「已選 N」旁邊要接卡名', () => {
  const i = src.indexOf('· 已選 {selectionPicked.size}');
  assert.ok(i >= 0, '找不到提示列的「已選」');
  const window = src.slice(i, i + 200);
  assert.ok(window.includes('selectedNamesLabel'),
    '提示列沒有接 selectedNamesLabel —— 玩家在按確定前仍然看不到自己選了什麼');
});

T('⭐ 消費點 B（動作端的確定鈕）：按鈕文字要寫出卡名', () => {
  const m = src.match(/<button class="btn-act primary"[^>]*onclick=\{confirmSelection\}>\{[^<]*?\}<\/button>/);
  assert.ok(m, '找不到通用的「確定」按鈕（結構被改寫？請同步更新本守衛）');
  assert.ok(m[0].includes('selectedNamesLabel'),
    '確定鈕仍只顯示張數 —— 這正是 DCG_Bear 事件裡「按下去才知道拿錯」的那一步');
});

T('⭐ 通用確定鈕不得退回「只顯示張數」的舊寫法', () => {
  assert.ok(!/onclick=\{confirmSelection\}>確定（\{selectionPicked\.size\}張）<\/button>/.test(src),
    '偵測到舊版純張數確定鈕');
});

console.log('③ 不得因此洩漏對手看不到的資訊');

// ⭐⭐ Fable 5 審 v6.108 抓到：concealed = 卡面「在**不看正面**的情況下選擇」
//   （拍落／精神出局／咬棄／占為己有）。那些 picker 顯示卡背 + ???，若把真名寫進提示列，
//   玩家可以逐張 toggle 讀卡名，把對手整副手牌掃一遍 —— 防呆變成作弊工具。
//   ⚠ 原本的「不得流進 addLog/dispatch」那條**抓不到這個洩漏**（是假綠），所以要單獨釘。
T('⭐ concealed（不看正面）picker 一律不得顯示卡名', () => {
  const m = src.match(/const selectedCardNames = \$derived\.by\(\(\) => \{[\s\S]{0,900}?\n  \}\);/);
  assert.ok(m, '抓不到 selectedCardNames 的實作');
  assert.ok(/params\?\.concealed === true\)\s*return/.test(m[0]),
    'selectedCardNames 沒有 concealed 早退 —— 對手蓋著的手牌卡名會被印出來');
});

T('正對照：拿掉 concealed 早退的樣本會被抓出來', () => {
  const probe = 'const selectedCardNames = $derived.by(() => {\n    if (!pendingSelection) return [];\n    return [];\n  });';
  assert.ok(!/params\?\.concealed === true\)\s*return/.test(probe), '判準抓不到缺 gate 的樣本 ⇒ 假綠');
});

T('⭐ 選卡清單出口有 dedupeByIid（keyed each 撞 key 會整頁白屏）', () => {
  assert.ok(/const selectionItems = \$derived\.by\(\(\) => dedupeByIid\(/.test(src),
    'selectionItems 沒有套 dedupeByIid');
});


T('卡名只出現在「自己的」選卡面板，不進公開 log', () => {
  // selectedNamesLabel 是純 UI 顯示（本地渲染），不得被塞進任何 addLog/dispatch payload。
  const bad = src.match(/(addLog|dispatch|tournamentDispatch)\([^)]*selectedNamesLabel/g);
  assert.strictEqual(bad, null, 'selectedNamesLabel 流進了 log／action：' + (bad || []).join('、'));
});

console.log('\n=== v6.108 選卡防呆：PASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
