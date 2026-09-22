// v6.122 守衛：補位（派出新的戰鬥寶可夢）必須是「選取 → 確定」兩段式。
//
// 玩家回報：戰鬥寶可夢昏厥或需要替換時，選備戰上場「只要點選就立即上場」，很容易按錯。
//
// ⚠⚠ 這個流程搞砸的後果很嚴重：補位卡住 = 玩家無法行動 → 錦標賽會被**閒置判負**。
//   所以守衛不只釘「有沒有確定鈕」，也釘住幾個「會讓玩家按不到／按了沒用」的坑：
//   ・確定鈕必須存在且有 disabled 條件（未選時不能送空）
//   ・卡片的 onclick **不得**直接 dispatch（否則等於沒有二段確認）
//   ・全檔送出 SEND_NEW_ACTIVE 的地方**只能有一個**（中央出口，送出前會 re-validate）
//   ・手機直式元件不得自己另做一份「點了直送」的補位 UI
//   ・兩個 modal 各自的 pick state 不得共用（本機雙人雙方同時自 KO 時是兩份不同的備戰區）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normEol } from './lib/eol-agnostic.mjs';   // v6.377 C-9: CRLF 工作樹的多行錨點定位

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGE = normEol(readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8'));
const MOBILE = readFileSync(join(ROOT, 'src/routes/game/MobilePortraitBattle.svelte'), 'utf8');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

/** 從 anchor 起、切到該區塊內第一個 </div>\n  </div> 之後（結構終點，不寫死行號/長度）。 */
function modalWindow(anchor) {
  const i = PAGE.indexOf(anchor);
  if (i < 0) return null;
  const end = PAGE.indexOf('{/if}', i);
  return end < 0 ? null : PAGE.slice(i, end);
}

// ⭐v6.425（Rule 40）：A（防守方版）／B（自 KO 版）兩個 modal 收斂成「每個需要補位的座位一個 modal」
//   （我被擊倒時 A、B 同時成立 ⇒ 玩家看到兩個視窗，站長回報）。本守衛的意圖不變：兩段式確認、擋觀戰者、
//   pick state 依備戰區分開（改成依座位各一份）、卡片格子單一 snippet —— 只是錨點改成那一個 {#each} 區塊。
const MODAL = '{#each promoteSeatsList as _ps (_ps)}';
function eachWindow() {
  const i = PAGE.indexOf(MODAL);
  if (i < 0) return null;
  const end = PAGE.indexOf('{/each}', i);
  return end < 0 ? null : PAGE.slice(i, end);
}
const SLOTS = readFileSync(join(ROOT, 'src/lib/game/modal-slots.ts'), 'utf8');

console.log('① 中央出口：全檔只能有一個送出 SEND_NEW_ACTIVE 的地方');

T('⭐⭐⭐ GameActions.sendNewActive 在對戰頁只出現 1 次，且在 confirmSendNewActive 裡', () => {
  const n = (PAGE.match(/GameActions\.sendNewActive/g) || []).length;
  ok(n === 1, '出現 ' + n + ' 次 —— 補位送出必須收斂成單一出口（送出前要 re-validate iid）');
  const i = PAGE.indexOf('function confirmSendNewActive');
  ok(i >= 0, '找不到 confirmSendNewActive');
  const body = PAGE.slice(i, PAGE.indexOf('\n  }', i));
  ok(/GameActions\.sendNewActive/.test(body), '唯一那次 dispatch 不在 confirmSendNewActive 裡');
});

T('⭐⭐ 送出前必須再驗一次 iid 仍在該玩家備戰區（線上盤面會被對手動作 merge 改掉）', () => {
  const i = PAGE.indexOf('function confirmSendNewActive');
  const body = PAGE.slice(i, PAGE.indexOf('\n  }', i));
  ok(/bench\s*\?\?\s*\[\]\)\.some\(\(b\) => b\.iid === iid\)/.test(body),
    'confirmSendNewActive 沒有驗證 iid 還在 bench 裡 —— 送 stale iid 會被引擎拒絕，\n'
    + '      玩家只會看到「按了沒反應」，在錦標賽等同被判負。');
  ok(/if \(!iid\) return;/.test(body), '沒有擋掉「沒選任何一隻就送出」');
});

console.log('② 補位 modal 要有確定鈕，且卡片點擊不得直接送出');

T('⭐⭐⭐ 補位 modal：卡片 onclick 不得直接 dispatch，必須有 disabled 的確定鈕', () => {
  const w = eachWindow();
  ok(w, '找不到補位 modal（' + MODAL + '）');
  ok(!/dispatch\(/.test(w), '補位 modal 裡還有直接 dispatch —— 等於沒有二段確認，玩家還是會按錯');
  ok(/<div class="sel-footer">/.test(w), '沒有 sel-footer（確定鈕列）');
  ok(/disabled=\{(?:[^}]*\|\|)?!_pickOk/.test(w), '確定鈕沒有 disabled 條件（可能送出空選取）');
  ok(/confirmSendNewActive\(_pick, _ps, _bench\)/.test(w), '確定鈕沒有呼叫 confirmSendNewActive(_pick, _ps, _bench)');
});

T('補位 modal：必須擋掉觀戰者（原本會蓋一個點不動也關不掉的 modal 在觀戰畫面上）', () => {
  ok(/promoteModalSeats\(\{[\s\S]{0,400}?[\s,{]isSpectator\s*[,}]/.test(PAGE), '對戰頁呼叫 promoteModalSeats 時沒有把真正的 isSpectator 傳進去（寫成 isSpectator: false 之類不算）');
  ok(/if \(v\.phase !== 'playing' \|\| v\.hasPendingSelection \|\| v\.isSpectator\) return \[\];/.test(SLOTS), 'promoteModalSeats 沒有對觀戰者回空清單');
});

T('⭐⭐ pick state 依座位各一份（本機雙人雙方同時被擊倒時是兩份不同的備戰區）', () => {
  ok(/let promotePick = \$state<\[string \| null, string \| null\]>/.test(PAGE), '缺少依座位的 pick state');
  const w = eachWindow();
  ok(w && /promotePick\[_ps\]/.test(w), 'modal 沒有用 promotePick[_ps]（依座位）');
  ok(!/promotePickDef|promotePickSelf/.test(PAGE), '舊的共用／分開 state 殘留');
});

T('正對照：把「卡片直接 dispatch」的舊寫法餵進同一判準，必須被抓到', () => {
  const probe = '<button class="retreat-pick" onclick={(e)=>{e.stopPropagation();'
    + 'dispatch(GameActions.sendNewActive(b.iid, dIdx));}}>';
  ok(/dispatch\(/.test(probe), '正對照失效 —— 本守衛的判準抓不到舊寫法');
});

console.log('③ 手機直式：不得自己另做一份「點了直送」的補位 UI');

T('⭐ MobilePortraitBattle 不得出現 sendNewActive（補位共用主頁的 modal）', () => {
  ok(!/sendNewActive/.test(MOBILE),
    '手機直式元件自己做了一份補位送出 —— 會與主頁的兩段式流程漂移；\n'
    + '      補位 modal 刻意放在 isPortraitMobile 區塊外，手機桌機共用同一份。');
});

T('⭐ 手機直式的確定鈕不得被擠出畫面（.retreat-modal 的 sel-footer 要 sticky）', () => {
  // 手機直式把整個 modal 當捲動容器（v5.299/v5.308），備戰滿場時 footer 會落在折疊線下面。
  ok(/\.retreat-modal \.sel-footer \{[\s\S]{0,200}position: sticky/.test(PAGE),
    '手機版沒有把 .retreat-modal 的 sel-footer 釘在底部 —— 備戰滿場時要捲才看得到確定鈕，\n'
    + '      而補位是判負攸關的流程。');
});

console.log('④ 共用 markup（兩個 modal 不得再各抄一份卡片格子）');

T('⭐ 卡片格子收斂成單一 snippet', () => {
  ok(/\{#snippet promoteGrid\(/.test(PAGE), '沒有 promoteGrid snippet');
  const n = (PAGE.match(/@render promoteGrid\(/g) || []).length;
  ok(n === 1, '@render promoteGrid 應為 1 次（v6.425 起只有一個 {#each} 區塊），實得 ' + n);
});

console.log('\n=== v6.122 補位「選取→確定」兩段式 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail ? 1 : 0);
