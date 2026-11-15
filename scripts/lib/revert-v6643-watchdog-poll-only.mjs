// v6.643 新鮮度看門狗只重建輪詢（擴容第四批）的逐字還原；不能放寬舊範圍鎖。
import assert from 'node:assert/strict';
export const V6643_PAIRS = {"src/routes/game/+page.svelte": [["          startTournamentPoll();\n          // <<< v6643-watchdog-poll-only\n        }\n", "          startTournamentPoll();\n        }\n"], ["          }\n          // >>> v6643-watchdog-poll-only\n          // ⭐v6.643（擴容審查追加，Opus 審查 v6.641 P2-1）：原本這裡是「tForceResync(); startTournamentPoll();」。\n          //   但 startTournamentPoll 會同步 ++tPollGen，tForceResync 回來時代次對不上 ⇒ 那一發的結果**一直都被整發丟棄**，\n          //   真正把盤面抓回來的是重建後的輪詢（第一個 tick 約 0.4 秒後就會送出）。⇒ 拿掉那一發純成本的請求，\n          //   只重建輪詢（自救仍無條件執行、不受上面的診斷判準影響）。回前景、「立即重新同步」等其他呼叫點不動。\n          startTournamentPoll();\n", "          }\n          tForceResync();\n          startTournamentPoll();\n"]], "src/lib/version.ts": [[" */\nexport const VERSION = '6.643';\n", " */\nexport const VERSION = '6.642';\n"]], "static/site-version.txt": [["6.643\n", "6.642\n"]]};
export function revertV6643IfPresent(path, source) {
  let s = source.replace(/\r\n/g, '\n');
  const pairs = V6643_PAIRS[path];
  if (!pairs || !pairs.every(([a]) => s.split(a).length === 2)) return s;
  for (const [a, b] of pairs) {
    assert.equal(s.split(a).length, 2, 'v6643 還原錨點缺失或重複 ' + path);
    s = s.replace(a, () => b);
  }
  return s;
}
