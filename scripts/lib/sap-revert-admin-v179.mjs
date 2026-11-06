// server v1.79 推播排隊送出：還原入口（Rule 40）。本版只新增一個哨兵區塊 `// >>> v179-push-yield`（錦標賽區塊之前），
//   沒有改任何既有行 ⇒ 還原＝把整個區塊剝掉。釘整份 server_admin_patch.js 的舊守衛經 revertAdminV177 最先呼叫這裡。
//   區塊出現超過一次就 throw（不是放寬，是宣告端精確還原）；行為由 test-v179-push-yield 守。
import assert from 'node:assert/strict';
const RE = /  \/\/ >>> v179-push-yield\n[\s\S]*?  \/\/ <<< v179-push-yield\n/g;
export function stripAdminV179IfPresent(source) {
  const s = String(source).replace(/\r\n/g, '\n');
  const n = (s.match(RE) || []).length;
  assert.ok(n <= 1, 'v179-push-yield 區塊出現 ' + n + ' 次');
  return n ? s.replace(RE, '') : s;
}
