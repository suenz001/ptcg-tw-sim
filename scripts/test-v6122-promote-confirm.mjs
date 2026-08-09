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

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
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

// 兩個補位 modal 的 gating 條件（逐字，改了會被抓到 → 強迫重新檢視本守衛）
const A = "{#if game && game.phase==='playing' && defenderPlayer?.active===null && isMyDefenderTurn() && !pendingSelection";
const B = "{#if game && game.phase==='playing' && myPlayer?.active===null && (myPlayer?.bench??[]).length>0 && !pendingSelection";

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

console.log('② 兩個 modal 都要有確定鈕，且卡片點擊不得直接送出');

for (const [label, anchor, pickVar] of [['A 防守方版', A, 'promotePickDef'], ['B 自KO版', B, 'promotePickSelf']]) {
  T('⭐⭐⭐ ' + label + '：卡片 onclick 不得直接 dispatch，必須有 disabled 的確定鈕', () => {
    const w = modalWindow(anchor);
    ok(w, '找不到 ' + label + ' 的 modal（gating 條件被改了？請重新檢視本守衛）');
    ok(!/dispatch\(/.test(w),
      label + ' 的 modal 裡還有直接 dispatch —— 等於沒有二段確認，玩家還是會按錯');
    ok(/<div class="sel-footer">/.test(w), label + ' 沒有 sel-footer（確定鈕列）');
    // v6.147：確定鈕多了「動作送出中」的 busy 條件（disabled={actionBusy||!_pickOkX}），
    //   本條的判準是「有沒有 disabled 到那個選取旗標」，允許前面再 or 別的條件。
    ok(/disabled=\{(?:[^}]*\|\|)?!_pickOk/.test(w), label + ' 的確定鈕沒有 disabled 條件（可能送出空選取）');
    ok(new RegExp('confirmSendNewActive\\(' + pickVar).test(w),
      label + ' 的確定鈕沒有呼叫 confirmSendNewActive(' + pickVar + ' …)');
  });

  T(label + '：必須擋掉觀戰者（原本會蓋一個點不動也關不掉的 modal 在觀戰畫面上）', () => {
    const i = PAGE.indexOf(anchor);
    ok(i >= 0, '找不到 ' + label);
    const cond = PAGE.slice(i, PAGE.indexOf('}\n', i));
    ok(/!isSpectator/.test(cond), label + ' 的條件缺 !isSpectator');
  });
}

T('⭐⭐ 兩個 modal 的 pick state 不得共用（本機雙人雙方同時自 KO 時是兩份不同的備戰區）', () => {
  ok(/let promotePickDef = \$state/.test(PAGE) && /let promotePickSelf = \$state/.test(PAGE),
    '缺少兩個獨立的 pick state');
  const wA = modalWindow(A), wB = modalWindow(B);
  ok(wA && !/promotePickSelf/.test(wA), 'Modal A 用到了 Modal B 的 state');
  ok(wB && !/promotePickDef/.test(wB), 'Modal B 用到了 Modal A 的 state');
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
  ok(n === 2, '@render promoteGrid 應為 2 次（兩個 modal），實得 ' + n);
});

console.log('\n=== v6.122 補位「選取→確定」兩段式 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail ? 1 : 0);
