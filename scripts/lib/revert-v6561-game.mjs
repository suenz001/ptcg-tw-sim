// v6.561 錦標賽回放逐動作：對戰頁（+page.svelte）的「逐位元還原表」（單一來源；IRON_RULES Rule 38）
//   v6.561 只在 tStartReplay 多一行合併逐動作格（withTournPerActionSteps）＋一行 import。
//   test-v6441／test-v6293 先用這張表還原成 v6.560（cb4abe25），再接 V6560 表；其餘仍必須逐位元相同（Rule 40，不放寬）。
//   表由 difflib 產生、當場驗證可逐位元還原 v6.560；表本身由那兩支「每條恰命中 1 次＋還原後等於 BASE」鎖，行為由 test-v6561 守。
export const V6561_GAME_PAIRS = [
  ["      if ((!data.snapshots || data.snapshots.length === 0) && !data.finalState) { tError = '這場沒有可回放的資料（可能是部署回放功能之前的舊對戰）'; return; }\n      // ⭐v6.561 每個動作一格：伺服器 v1.64 起另存逐動作資料；拿得到就取代對應的半回合格，拿不到（舊對局／舊伺服器）照用半回合格\n      data.snapshots = await withTournPerActionSteps(matchId, data.snapshots || []);\n      await openReplayData(data, 'tournament');\n", "      if ((!data.snapshots || data.snapshots.length === 0) && !data.finalState) { tError = '這場沒有可回放的資料（可能是部署回放功能之前的舊對戰）'; return; }\n      await openReplayData(data, 'tournament');\n"],
  ["  // ⭐v6.560 一般對戰復盤（記錄／遮蔽／跳回合 與 瀏覽器儲存／檔案）\n  import { withTournPerActionSteps } from '$lib/game/replay-tourn';   // v6.561 錦標賽回放逐動作\n  import { createReplayRecorder, recordStep, finalizeReplay, stepsForStorage, nextTurnStepIndex, prevTurnStepIndex, type ReplayRecorder, type ReplayData } from '$lib/game/replay-record';\n", "  // ⭐v6.560 一般對戰復盤（記錄／遮蔽／跳回合 與 瀏覽器儲存／檔案）\n  import { createReplayRecorder, recordStep, finalizeReplay, stepsForStorage, nextTurnStepIndex, prevTurnStepIndex, type ReplayRecorder, type ReplayData } from '$lib/game/replay-record';\n"],
];
