// v6.641 錦標賽重新同步帶目前版本（擴容審查 P2-1）的逐字還原；不能放寬舊範圍鎖。
import assert from 'node:assert/strict';
export const V6641_PAIRS = {"src/routes/game/+page.svelte": [["    try {\n      // >>> v6641-resync-version\n      // ⭐v6.641（2026-11-14 擴容審查 P2-1）：原本一律帶 v=-1 ⇒ 伺服器每次都讀整份房間、解碼、序列化整份盤面。\n      //   但這支函式只在「版本不同」時才採納盤面（見下方 fr.version !== tVersion），其餘會用到的欄位\n      //   （lastActionAt、actorSeat、playerClock、longPoll、serverNow）在版本相符的精簡回應裡都有 ⇒ 改帶目前版本，\n      //   版本相同拿精簡回應、不同才拿全量，行為一樣、伺服器少做事。新鮮度看門狗在對手長考時每 8 秒呼叫一次，省最多。\n      //   ⚠ 例外仍帶 -1：①還沒有版本（tVersion < 0）②身分失效橫幅亮著（完整回應才會驗身分，按「立即重新同步」要能判斷好了沒）。\n      const _rsV = (!(tVersion >= 0) || tAuthLost) ? -1 : tVersion;\n      const fr = await tApi(`/state?room=${tActiveRoom}&v=${_rsV}&s=${mySeatIdx}`);   // v6.170 順便打心跳\n      // <<< v6641-resync-version\n      if (_rGen !== tPollGen || _rRoom !== tActiveRoom) return;   // 已離開對戰／換房 ⇒ 這一發整發作廢\n", "    try {\n      const fr = await tApi(`/state?room=${tActiveRoom}&v=-1&s=${mySeatIdx}`);   // v6.170 順便打心跳\n      if (_rGen !== tPollGen || _rRoom !== tActiveRoom) return;   // 已離開對戰／換房 ⇒ 這一發整發作廢\n"]], "src/lib/version.ts": [[" */\nexport const VERSION = '6.641';\n", " */\nexport const VERSION = '6.640';\n"]], "static/site-version.txt": [["6.641\n", "6.640\n"]]};
export function revertV6641IfPresent(path, source) {
  let s = source.replace(/\r\n/g, '\n');
  const pairs = V6641_PAIRS[path];
  if (!pairs || !pairs.every(([a]) => s.split(a).length === 2)) return s;
  for (const [a, b] of pairs) {
    assert.equal(s.split(a).length, 2, 'v6641 還原錨點缺失或重複 ' + path);
    s = s.replace(a, () => b);
  }
  return s;
}
