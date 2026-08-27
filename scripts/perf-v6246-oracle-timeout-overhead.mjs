// v6.246 效能量測腳本（IRON_RULES Rule 32：效能數字必須附量測腳本）。
//
// 量的是「成功路徑上，v6.246 比 v6.245 多做的事」：
//   ① body.length * 2（估上傳位元組）  ② oracleTimeoutBudgetMs()  ③ Math.max()
// 對照組是「TextEncoder 精算位元組」——說明為什麼**沒有**採用它。
//
// ⚠ 量測對象：本檔所在工作樹的 src/lib/game/oracle-client.ts（跟著 repo 走，不是抄來的數字）。
// Run: node scripts/perf-v6246-oracle-timeout-overhead.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OC = readFileSync(join(ROOT, 'src/lib/game/oracle-client.ts'), 'utf8');

// 從出貨碼把三個常數與純函式抽出來實跑（不重寫一份，避免量到「抄錯的版本」）
const pick = (name) => {
  const m = OC.match(new RegExp('export const ' + name + ' = (\\d+);'));
  if (!m) throw new Error('抽不到常數 ' + name + ' —— 抽取器壞了？');
  return Number(m[1]);
};
const ORACLE_API_TIMEOUT_MS = pick('ORACLE_API_TIMEOUT_MS');
const ORACLE_MIN_UPLINK_BPS = pick('ORACLE_MIN_UPLINK_BPS');
const ORACLE_UPLOAD_FREE_BYTES = pick('ORACLE_UPLOAD_FREE_BYTES');
const ORACLE_API_TIMEOUT_MAX_MS = pick('ORACLE_API_TIMEOUT_MAX_MS');
const fnSrc = OC.slice(OC.indexOf('export function oracleTimeoutBudgetMs'));
const fnBody = fnSrc.slice(0, fnSrc.indexOf('\n}\n') + 3).replace('export ', '');
if (fnBody.length < 120) throw new Error('抽不到 oracleTimeoutBudgetMs —— 抽取器壞了？');
const oracleTimeoutBudgetMs = new Function(
  'ORACLE_API_TIMEOUT_MS', 'ORACLE_MIN_UPLINK_BPS', 'ORACLE_UPLOAD_FREE_BYTES', 'ORACLE_API_TIMEOUT_MAX_MS',
  fnBody.replace(/: number/g, '') + '\n;return oracleTimeoutBudgetMs;',
)(ORACLE_API_TIMEOUT_MS, ORACLE_MIN_UPLINK_BPS, ORACLE_UPLOAD_FREE_BYTES, ORACLE_API_TIMEOUT_MAX_MS);

// 造一份大小接近 nginx log 那筆（request_length=48285）的盤面 JSON
const zh = '招式傷害寶可夢能量指示物備戰戰鬥場獎賞卡棄牌區牌庫手牌進化道具特殊狀態';
const obj = { gameState: { log: [] } };
for (let i = 0; obj.gameState.log.length < 432; i++) {
  obj.gameState.log.push({ t: i, m: zh.slice(i % 25) + '#' + i, d: [1, 2, 3, i], p: i % 2 });
}
const body = JSON.stringify(obj);
const realBytes = new TextEncoder().encode(body).length;
console.log('樣本：body.length（UTF-16 code unit） =', body.length,
  '｜實際 UTF-8 位元組 =', realBytes, '｜比值 =', (realBytes / body.length).toFixed(3));
console.log('估算值 body.length*2 =', body.length * 2, '（高估 ⇒ 只會多給預算，不會誤殺）');
console.log('這一發的逾時預算 =', oracleTimeoutBudgetMs(body.length * 2), 'ms',
  '｜555 B/s 下實際需要 =', Math.round(realBytes / 555 * 1000), 'ms');

const bench = (label, fn, n) => {
  for (let i = 0; i < Math.min(n, 2000); i++) fn();            // warm-up
  const t0 = process.hrtime.bigint();
  let sink = 0;
  for (let i = 0; i < n; i++) sink += fn();
  const t1 = process.hrtime.bigint();
  const ns = Number(t1 - t0) / n;
  console.log(('  ' + label).padEnd(52), (ns).toFixed(1).padStart(10), 'ns/發   (sink', sink % 7, ')');
  return ns;
};
const N = 200000;
console.log('\n── v6.246 在成功路徑上多做的事（每一發 oracleApi 各一次）──');
const a = bench('body.length * 2 + oracleTimeoutBudgetMs + Math.max',
  () => Math.max(30000, oracleTimeoutBudgetMs(body.length * 2)), N);
console.log('\n── 對照：沒有採用的做法 / 本來就要做的事 ──');
const b = bench('TextEncoder 精算位元組（未採用）', () => new TextEncoder().encode(body).length, 2000);
const c = bench('JSON.stringify（v6.245 本來就要做）', () => JSON.stringify(obj).length, 2000);
console.log('\n結論：v6.246 的成功路徑增量 ≈', a.toFixed(0), 'ns/發；'
  + 'TextEncoder 要 ' + (b / 1000).toFixed(0) + ' µs（' + (b / a).toFixed(0) + ' 倍）故不採用；'
  + '而 JSON.stringify 本來就要花 ' + (c / 1000).toFixed(0) + ' µs。');
console.log('對照基準：健康連線一次往返實測 273 ms ⇒ 增量佔比 ≈ '
  + (a / 1e6 / 273 * 100).toExponential(1) + ' %。');
console.log('⚠ 沙盒 CPU 比正式環境慢（Rule 32），這裡的絕對值只用來做**同機**比較。');
