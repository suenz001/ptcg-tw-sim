// ════════════════════════════════════════════════════════════════════════════
// scripts/lib/pw.mjs —— Playwright 的**唯一**中央閘（Rule 38：判準只能一份）
//
// 【為什麼要收斂】
//   站內有 10 支守衛帶 Playwright 段（v6285／6286／6293／6296／6297／6301／6302／
//   6303／6304／6306），而它們**各寫各的** gate：
//       try { chromium = createRequire(import.meta.url)('playwright').chromium; } catch { chromium = null; }
//       try { createRequire(import.meta.url)('playwright'); hasPw = true; } catch { hasPw = false; }
//       try { pw = require_.resolve('playwright'); } catch { pw = null; }
//   四種形狀、十份判準，而且 skip 的印法也十種 —— 平行 runner 想對「skip 標記」下硬判準
//   時，抓不到它們（它們印的是自己的 `⚠⚠ SKIP`，不是三種中央標記之一）。
//
// 【三種模式：PTCG_PW】
//   `off`    （**目前的預設**，過渡期）刻意不跑 PW 段，走 envSkip。
//            行為與「這台機器沒有 playwright」完全相同 ⇒ 主 chain 維持裝 playwright 之前的樣子。
//   `auto`   有模組就跑；模組或瀏覽器缺一 ⇒ envSkip（本機可接受、CI 上會 throw）。
//   `strict` 一定要能跑；缺任何一項都 envSkip ⇒ 在 CI 上必然 throw（＝翻紅）。
//
// ⭐⭐ **過渡期已於 v6.409 收尾（2026-09-20）**，預設是 `auto`。
//   收尾的依據是兩邊都實測全綠：
//     ・站長的 Windows：`set PTCG_PW=strict && node scripts\run-pw-guards.mjs` ⇒ **10 / 10 綠**
//     ・CI（ubuntu-latest）：deploy.yml 當時那個 continue-on-error 的獨立 step
//       連續四次 run（4f547434／732e8f4d／a00e830a／cdb2b39a）都是 success
//   ⇒ v6.408 的 425 字元那批版面判準（2026-09-19 一度讓 test-v6301 的 H2／H4 紅的
//     「按鈕群最右緣 333.97 vs BASE 356」）在兩個平台上都已經不紅，沒有理由再關著。
//   三件事一起做完了（`test-pw-gate` 的 B0 在守「三者一致」）：
//     ① 這裡的預設 'off' → 'auto'
//     ② deploy.yml 主 chain 的 `PTCG_PW: 'off'` 與 `PTCG_ALLOW_ENV_SKIP: '1'` 兩行已刪
//     ③ deploy.yml 的獨立 continue-on-error step 已刪
//   ⚠ 從此主 chain 的 `npm test` 在 CI 上會**真的跑**那 10 支（約多 80 秒），
//     它們紅了就會擋 deploy —— 這正是收尾的意義。
//   ⚠ 本機沒裝瀏覽器時 `auto` 會走 envSkip（不 throw），所以沙盒跑全套仍然綠。
//
// 【為什麼「模組在」不等於「跑得起來」】
//   `chromium.executablePath()` **不吃 channel 參數** —— 實測不論傳
//   `{channel:'chromium-headless-shell'}` 或不傳，回的都是**完整 chromium** 的路徑
//   （`ms-playwright/chromium-<rev>/chrome-win64/chrome.exe`）。而那 10 支守衛一律用
//   `launch({ channel: 'chromium-headless-shell' })`，裝的也只有 headless shell
//   ⇒ 拿 `executablePath()` 存不存在當判準會**永遠判成沒有**。
//   而 headless shell 的目錄名帶 build 號（`chromium_headless_shell-1243`），
//   寫死就是安慰劑型態 9（pin 死版本號，升級後靜默失效）。
//   ⇒ **唯一可靠的判準是真的 launch 一次**，所以 `pwLaunch()` 把 launch 包進閘裡，
//     並且**把 browser 回傳給呼叫端重用**（不會多花一次啟動）。
// ════════════════════════════════════════════════════════════════════════════

import { createRequire } from 'node:module';
import { envSkip } from './env-skip.mjs';

/** 預設模式。⭐v6.409 過渡期結束，改成 'auto'（見檔頭的「過渡期已收尾」一節）。 */
export const PW_DEFAULT_MODE = 'auto';

/** 目前模式：'off' | 'auto' | 'strict'。判準只有這一份。 */
export function pwMode() {
  const v = String(process.env.PTCG_PW || '').trim().toLowerCase();
  if (v === 'off' || v === 'auto' || v === 'strict') return v;
  if (v === 'on') return 'strict';            // 常見的口語寫法
  return PW_DEFAULT_MODE;
}

/** 這 10 支守衛統一用的 channel（與 measure-*.mjs 一致）。 */
export function pwChannel() {
  return process.env.PW_CHANNEL || 'chromium-headless-shell';
}

/**
 * 取得 playwright 的 chromium。拿不到就 **envSkip 並回 null**（呼叫端不必自己印 skip）。
 * ⚠ 只檢查「模式 + 模組」，**不**檢查瀏覽器裝了沒 —— 那一步在 pwLaunch()。
 * @param {string} what 哪一段（要能一眼認出是哪支守衛的哪一節）
 * @returns {null | import('playwright').BrowserType}
 */
export function pwChromium(what) {
  const mode = pwMode();
  if (mode === 'off') {
    envSkip(what, 'PTCG_PW=off（過渡期刻意關閉 PW 段，見 scripts/lib/pw.mjs 檔頭）');
    return null;
  }
  try {
    const req = createRequire(import.meta.url);
    const mod = req(process.env.PLAYWRIGHT_MODULE || 'playwright');
    if (!mod || !mod.chromium) throw new Error('playwright 模組沒有 chromium');
    return mod.chromium;
  } catch (e) {
    envSkip(what, '這台機器沒有 playwright 模組：' + String((e && e.message) || e).split('\n')[0].slice(0, 120));
    return null;
  }
}

/**
 * 取得 chromium **並真的 launch 一次**。任何一步不成就 envSkip 並回 null。
 * @param {string} what
 * @param {object} [opts] 覆寫 launch 參數（`executablePath`／`args` 之類）
 * @returns {Promise<null | import('playwright').Browser>}
 */
export async function pwLaunch(what, opts = {}) {
  const chromium = pwChromium(what);
  if (!chromium) return null;
  return pwLaunchWith(chromium, what, opts);
}

/**
 * 已經有 chromium（走過 pwChromium 的閘）之後才 launch 的版本。
 * ⚠ 守衛的結構通常是「先 gate、後面才 launch」，所以兩步分開；判準仍然只有這一份。
 * @param {import('playwright').BrowserType} chromium
 * @param {string} what
 * @param {object} [opts]
 * @returns {Promise<null | import('playwright').Browser>}
 */
export async function pwLaunchWith(chromium, what, opts = {}) {
  const base = process.env.PW_EXECUTABLE
    ? { executablePath: process.env.PW_EXECUTABLE, args: ['--no-sandbox'] }
    : { channel: pwChannel(), args: ['--no-sandbox'] };
  try {
    return await chromium.launch({ ...base, ...opts });
  } catch (e) {
    // ⚠ 這就是「模組在、瀏覽器不在」的那條路 —— 用 executablePath() 判斷會誤判，
    //   只有真的 launch 才分得出來。
    envSkip(what, `launch 失敗（channel=${pwChannel()}）：`
      + String((e && e.message) || e).split('\n')[0].slice(0, 160)
      + '　—— 跑 `npx playwright install chromium-headless-shell`');
    return null;
  }
}

/** 只要知道「這一段跑不跑得起來」而不需要 browser 的場合（例如要 spawn measure-*.mjs）。 */
export async function pwUsable(what) {
  const b = await pwLaunch(what);
  if (!b) return false;
  try { await b.close(); } catch { /* 關不掉不影響判準 */ }
  return true;
}
