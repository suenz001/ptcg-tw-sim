// v6.149 守衛：①Service Worker 絕不攔截 /api/ ②失聯必須有玩家看得到的提示。
//
// 事故（2026-08-09 網站賽-61 R6，dump 已存檔）：玩家與伺服器失聯約 8 分鐘，
//   畫面停在「對手回合」的舊盤面、本地把對手的閒置倒數走到 0，於是他看到「對方閒置超時」；
//   伺服器依權威盤面判的卻是他自己閒置逾時 ⇒「重新整理後變成我閒置超過，超莫名」。
//
// 根因鏈（逐行查證）：`/api/tournament/*` 是**同源**路徑，SW 的 fetch handler 只跳過
//   /music/、跨域、vite dev ⇒ API 落到 network-first：成功寫 cache、**失敗回同 URL 的舊 200**。
//   ① tApi 拿到假成功 → `_tLastPollOkAt` 被更新 ⇒ 唯一偵測斷線的 6 秒看門狗永遠不 fire；
//   ② 兩個看門狗的救援都是 `v=-1` 且**繞過版本檢查直接覆蓋 game** ⇒ 斷線時會把盤面倒轉回開局快照；
//   ③ 三處失敗路徑全部靜默 catch ⇒ 畫面零提示。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (x) => x.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, (x) => x.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}
const RAW_SW = readFileSync(join(ROOT, 'src/service-worker.ts'), 'utf8');
const SW = stripComments(RAW_SW);
const RAW_P = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const P = stripComments(RAW_P);

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('掃描器自我驗證：兩個被測檔的註解都確實被剝掉（兩邊註解都寫滿 /api/ 與失聯）', () => {
  assert.equal(RAW_SW.length, SW.length, 'SW stripComments 必須等長替換');
  assert.equal(RAW_P.length, P.length, 'page stripComments 必須等長替換');
  assert.ok(RAW_SW.includes('API 一律不進 SW'), '前提：service-worker 應含本版註解');
  assert.ok(!SW.includes('API 一律不進 SW'), 'SW 註解沒被剝掉 → 斷言不可信');
  assert.ok(RAW_P.includes('連線健康橫幅'), '前提：對戰頁應含本版註解');
  assert.ok(!P.includes('連線健康橫幅'), 'page 註解沒被剝掉 → 斷言不可信');
});

T('⭐⭐⭐SW 必須在寫 cache 之前就放行 /api/（否則斷線會被偽裝成正常回應）', () => {
  const i = SW.indexOf("url.pathname.startsWith('/api/')");
  assert.ok(i > 0, "service-worker 沒有 /api/ 早退 —— 斷線時會回舊的 200，看門狗永遠不會 fire");
  // 早退必須在 respond()／cache.put 之前，否則形同虛設
  const iRespond = SW.indexOf('async function respond(');
  assert.ok(iRespond > 0 && i < iRespond, '/api/ 早退必須在 respond() 之前');
  // 且必須是 `return;`（不 respondWith）而不是「回 network-only 的 Response」——
  // 前者才會完全交還瀏覽器原生 fetch（含 HTTP cache 語義與 abort）
  const seg = SW.slice(i, i + 120);
  assert.ok(/return;/.test(seg), '/api/ 應該直接 return（不 respondWith），實際：' + seg.slice(0, 80));
});
T('⭐SW 的其餘早退不得被誤刪（跨域／音樂／vite）', () => {
  for (const [name, re] of [
    ['跨域', /url\.origin !== sw\.location\.origin/],
    ['音樂', /includes\('\/music\/'\)/],
    ['vite', /startsWith\('\/@vite'\)/],
  ]) assert.ok(re.test(SW), `${name} 早退不見了`);
});

T('⭐⭐輪詢停擺看門狗**不得**自我安撫（原本把 _tLastPollOkAt 推到現在＝失聯秒數永遠歸零）', () => {
  const i = P.indexOf('(Date.now() - _tLastPollOkAt) > 6000');
  assert.ok(i > 0, '找不到 6 秒看門狗條件');
  const body = P.slice(i, i + 900);
  // ⚠ 判準是「不得**無條件**重置」，不是「完全不准出現」——
  //   救援真的拿到回應時更新它是正確的（那是貨真價實的伺服器回應，Fable 5 審查指出；
  //   不更新反而會在 RTT ≥6 秒時形成活鎖：看門狗每 6 秒 ++tPollGen，在途 poll 全被丟棄不記存活）。
  //   所以逐行檢查：每一個更新都必須被「真的有回應」gate 住。
  for (const line of body.split('\n')) {
    if (!/_tLastPollOkAt = Date\.now\(\)/.test(line)) continue;
    assert.ok(/if \(fr\)/.test(line),
      '看門狗無條件重置 _tLastPollOkAt —— 失聯秒數永遠累積不起來，橫幅不會出現：' + line.trim());
  }
  assert.ok(/_tPollStallGuardAt/.test(body), '沒有獨立的節流時間戳（節流與「上次真的收到回應」必須分開）');
});
T('⭐⭐失聯秒數必須由「上次真的收到伺服器回應」算出，且橫幅有實際渲染', () => {
  const m = P.match(/const tOfflineSec = \$derived\(([\s\S]{0,400}?)\);/);
  assert.ok(m, '找不到 tOfflineSec');
  assert.ok(/_tLastPollOkAt/.test(m[1]) && /tNow/.test(m[1]), 'tOfflineSec 應由 tNow - _tLastPollOkAt 算出');
  assert.ok(/tNetBannerOn/.test(P), '找不到橫幅開關');
  assert.ok(/\{#if tNetBannerOn\}/.test(P), '橫幅沒有實際渲染 —— v6.137/v6.147 的教訓：加了旗標卻沒有 template 綁定＝等於沒做');
  assert.ok(/net-warn-banner/.test(P), '橫幅缺 class（樣式對不上）');
});
T('⭐⭐⭐橫幅必須在 isPortraitMobile 分支**之外**（第一版寫在桌機 else 分支內，手機完全看不到）', () => {
  const iMobile = P.indexOf('{#if isPortraitMobile && game}');
  const iBanner = P.indexOf('{#if tNetBannerOn}');
  assert.ok(iMobile > 0 && iBanner > 0, '錨點失效');
  assert.ok(iBanner < iMobile,
    '橫幅在 isPortraitMobile 分支之後 —— 極可能落在桌機 {:else} 裡，手機直式玩家看不到。'
    + '（v6.148 的教訓：守衛要斷言**位置**，不是只斷言「有渲染」。）');
});
T('⭐⭐救援／強制同步成功也必須更新 _tLastPollOkAt（否則高延遲時形成活鎖）', () => {
  const n = (P.match(/_tLastPollOkAt = Date\.now\(\)/g) || []).length;
  assert.ok(n >= 3, `_tLastPollOkAt 的更新點只有 ${n} 個 —— 輪詢成功、看門狗救援、tForceResync 三處都要`);
});
T('⭐橫幅必須提供「立即重新同步」而不是只顯示訊息（玩家要能自救）', () => {
  const i = P.indexOf('net-warn-banner');
  const seg = P.slice(i, i + 900);
  assert.ok(/tForceResync\(\)/.test(seg), '橫幅沒有重新同步按鈕');
  assert.ok(/startTournamentPoll\(\)/.test(seg), '重新同步應同時重建輪詢 timer');
});
T('⭐橫幅只在錦標賽對戰中出現（觀戰／大廳／休閒不該被打擾）', () => {
  const m = P.match(/const tOfflineSec = \$derived\(([\s\S]{0,400}?)\);/);
  for (const [name, re] of [['isTournament', /isTournament/], ["tStep==='playing'", /tStep === 'playing'/], ['排除觀戰', /!isTournSpectator/]]) {
    assert.ok(re.test(m[1]), `tOfflineSec 缺少 ${name} 條件`);
  }
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
