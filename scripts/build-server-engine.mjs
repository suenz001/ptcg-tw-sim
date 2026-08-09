// 伺服器權威用：把遊戲引擎打包成 Node CJS bundle，給 Oracle 伺服器(server_admin_patch.js)require。
//   輸出 oracle-admin/tournament/server-engine.cjs，export { createGame, applyAction } + 瑞士制純函式(pairSwissRound/computeStandings/seedTopCut/buildSwissPlayersFromMatches/...)
import { build } from 'esbuild';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUB = join(ROOT, 'oracle-admin/tournament/.appstub.js');
writeFileSync(STUB, 'export const base = "";');
const ENTRY = join(ROOT, 'oracle-admin/tournament/.engine-entry.ts');
writeFileSync(ENTRY, `
import { createGame, applyAction } from '$lib/game/engine';
import type { Card } from '$lib/cards/types';
// buildPool：從 static/cards/*.json 組 pool（伺服器端用 fs 讀，故這裡只 re-export engine 函式）
export { createGame, applyAction };
export type { Card };
// 瑞士制純函式（單一真相來源，harness 已驗）：伺服器 server_admin_patch.js 透過 TENG.* 使用
export * from '$lib/tournament/swiss';
// v6.138 牌組公布欄：伺服器投稿端要驗牌組合法性（60 張／同名 4 張／重印例外／ACE SPEC／兩張合一）。
//   ⚠ 這些規則**只能有一份**。在 server_admin_patch.js 抄第二份必然與前端漂移
//     （v0.88／v0.93 的 classifyDeck 就是這個教訓）。validation.ts 只 import 型別、
//     零 runtime 依賴，可以安全打包進來。
export { validateDeck } from '$lib/decks/validation';
`);
await build({
  entryPoints: [ENTRY],
  outfile: join(ROOT, 'oracle-admin/tournament/server-engine.cjs'),
  bundle: true, format: 'cjs', platform: 'node', target: 'node18',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': STUB },
  logLevel: 'error',
});
try { unlinkSync(STUB); unlinkSync(ENTRY); } catch {}
console.log('OK: oracle-admin/tournament/server-engine.cjs 已產生');
// 同時輸出 live 卡池(伺服器 require 用，免在 VM 找 static/cards)
import { readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
const CARDS = join(ROOT, 'static/cards');
const idxEntries = JSON.parse(readFileSync(join(CARDS, 'index.json'), 'utf8'));
const liveCodes = new Set(idxEntries.map((e) => e.code));
const poolObj = {};
for (const f of readdirSync(CARDS)) {
  if (!f.endsWith('.json') || f === 'index.json' || !liveCodes.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(CARDS, f), 'utf8'))) if (c && c.id != null) poolObj[String(c.id)] = c;
}
const actualCount = Object.keys(poolObj).length;

// ── 防呆守衛：卡池張數必須等於 index.json 宣告的 live 卡總數 ──────────────────
// 基準取「HEAD 的 index.json」(非工作區),故即使整個工作區 static/cards 都是舊的也擋得住。
// 不符 = 工作區 static/cards 沒同步到最新 commit(最常見:git-plumbing 推送不動工作區、
// 或 deploy bat 的 sync 漏 static)→會導致新卡沒進錦標賽伺服器(client看得到但server不認)。
// 寧可 build 失敗中止部署,也不要默默上傳缺卡的舊卡池。
let expectedCount;
try {
  const headIdx = JSON.parse(execSync('git show HEAD:static/cards/index.json', { cwd: ROOT }).toString());
  expectedCount = headIdx.reduce((s, e) => s + (e.cardCount ?? e.count ?? 0), 0);
} catch {
  // 非 git 環境 fallback:改用工作區 index.json(至少擋得住部分 set 缺卡)
  expectedCount = idxEntries.reduce((s, e) => s + (e.cardCount ?? e.count ?? 0), 0);
}
if (actualCount !== expectedCount) {
  console.error('');
  console.error('*** 卡池數量不符：實際產出 ' + actualCount + ' 張，但 HEAD index.json 宣告應有 ' + expectedCount + ' 張 ***');
  console.error('*** 多半是工作區 static/cards 未同步到最新 commit。請執行： ***');
  console.error('***     git fetch origin ***');
  console.error('***     git reset --hard origin/main ***');
  console.error('*** 後重新部署。(若確實是新增/刪除卡且已同步,請確認 index.json 的 cardCount 也已更新。) ***');
  console.error('');
  process.exit(1);
}
writeFileSync(join(ROOT, 'oracle-admin/tournament/tournament-pool.json'), JSON.stringify(poolObj));
console.log('OK: tournament-pool.json 已產生（' + actualCount + ' 張卡，符合 index.json 宣告的 ' + expectedCount + ' 張）');

