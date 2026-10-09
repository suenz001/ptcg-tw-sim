#!/usr/bin/env node
/**
 * 守衛：scripts/run-tests.mjs 的「基準比對」與「計時歷史」（2026-10-09 站長要求檢查改版耗時時實測抓到）。
 *
 * 【事故一】--baseline 模式一跑完就當掉：
 *   比對迴圈裡用 `const bm = b.skipMarks …` 存 skip 標記，跟外層的基準表 `bm` 同名
 *   ⇒ 同一個區塊上面那行 `bm.get(r.script)` 落在 TDZ ⇒「Cannot access 'bm' before initialization」，
 *   報表寫不出來、基準比對從來沒有真的做過。
 * 【事故二】計時歷史永遠是空的：
 *   歷史只從 <sandbox-root>/__rt 讀，而每輪開跑前沙盒根會被整個刪掉
 *   ⇒ 每支守衛的逾時一律 120 秒下限、排程不知道誰該先跑 ⇒ 6 支慢守衛固定 TIMEOUT、要人工單跑。
 * 【事故三】預設 6 個 workers：雲端容器只有 2 核，單跑 0.8 秒的守衛在全套裡變 2～10 秒。
 *
 * 【A】行為：把 run-tests.mjs 的基準比對區段逐字抽出來，餵合成的基準與結果實跑：
 *      A1 不可丟例外（HEAD）；A2 差異判讀正確（條數不同／基準沒有／本次沒跑到）；A0 抽取錨點存在（下限）
 * 【B】行為：計時歷史合併函式逐字抽出實跑（一般覆寫、逾時取大、壞資料略過）；預設歷史目錄在沙盒根之外
 * 【C】接線：loadDurations 讀歷史檔、報表寫出後呼叫 saveHistory、預設 workers 依核數
 * 【H】HEAD-FAIL：同樣的 A 組抽取法套在 BASE（v6.517）的 run-tests.mjs 上必須丟 TDZ 例外；B／C 必紅
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.517。
const BASE_SHA = '6622caca';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

// 從原始碼抽出基準比對區段（外層 bm 宣告 → 「具名已知浮動」註解之前），包成函式。
function extractCompare(src) {
  const a = src.indexOf('const bm = new Map((base.results');
  const b = src.indexOf('// 具名已知浮動的挑出來單獨列', a);
  if (a < 0 || b < 0) return null;
  const body = src.slice(a, b);
  try {
    // eslint-disable-next-line no-new-func
    return new Function('base', 'results', 'byScript', 'OPT', 'NOISY_OUTPUT', body + '\nreturn { diffs, soft };');
  } catch (e) { return () => { throw new Error('語法：' + e.message); }; }
}
function runCompare(src) {
  const fn = extractCompare(src);
  if (!fn) return { missing: true };
  const R = (script, pass, extra = {}) => ({ script, exitCode: 0, pass, fail: 0, skipMarks: { shallow: 0, platform: 0, env: 0 }, outFp: 'x', numFp: 'n', ...extra });
  const base = { results: [R('a.mjs', 3), R('b.mjs', 5), R('gone.mjs', 1)] };
  const results = [R('a.mjs', 3), R('b.mjs', 4), R('new.mjs', 2)];
  const byScript = new Map(results.map((r) => [r.script, r]));
  try { return { out: fn(base, results, byScript, { only: [] }, new Set()) }; }
  catch (e) { return { err: e }; }
}

// 從原始碼抽出 mergeHistory 函式
function extractMerge(src) {
  const a = src.indexOf('function mergeHistory(');
  if (a < 0) return null;
  let i = src.indexOf('{', a), d = 0, e = i;
  for (; e < src.length; e++) { if (src[e] === '{') d++; else if (src[e] === '}') { d--; if (d === 0) break; } }
  try { return new Function(src.slice(a, e + 1) + '\nreturn mergeHistory;')(); } catch { return null; }
}
// 從原始碼抽出「預設歷史目錄」那一行，餵沙盒根算出結果
function historyDirFor(src, sandboxRoot) {
  const m = /if \(!OPT\.historyDir\) OPT\.historyDir = ([^;]+);/.exec(src);
  if (!m) return null;
  try { return new Function('OPT', 'return ' + m[1] + ';')({ sandboxRoot }); } catch { return null; }
}
function judgeStatic(src) {
  const ld = src.slice(src.indexOf('function loadDurations('), src.indexOf('function loadDurations(') + 2500);
  return {
    // 歷史檔必須在 baseline 之前讀（最新量測優先；baseline 裡逾時的只記著逾時上限）
    C1: /readFileSync\(HISTORY_FILE/.test(ld) && ld.indexOf('readFileSync(HISTORY_FILE') < ld.indexOf('OPT.baseline'),
    C2: /writeFileSync\(OPT\.report[^\n]*\n\s*saveHistory\(results\);/.test(src),
    C3: /argVal\('--workers', String\(Math\.min\(6, os\.cpus\(\)\.length \+ 1\)\)\)/.test(src),
  };
}

const HEAD_SRC = readFileSync(join(ROOT, 'scripts/run-tests.mjs'), 'utf8').replace(/\r\n/g, '\n');

console.log('【A】基準比對區段實跑');
{
  ok('[A0] 抽取錨點存在（區段抽得出來，否則整組是空轉）', !!extractCompare(HEAD_SRC));
  const r = runCompare(HEAD_SRC);
  ok('★★★[A1] 基準比對不可丟例外（原本 TDZ：Cannot access \'bm\' before initialization）', !r.err && !r.missing, r.err && r.err.message);
  const why = (s) => ((r.out && r.out.diffs) || []).filter((d) => d.script === s).map((d) => d.why).join('|');
  ok('★★[A2] 差異判讀：b 條數不同、new 基準沒有、gone 本次沒跑到；a 一致不列',
    !!r.out && /P5\/F0.*P4\/F0/.test(why('b.mjs')) && why('new.mjs') === '基準沒有這一支' && why('gone.mjs') === '本次沒跑到' && why('a.mjs') === '',
    JSON.stringify(r.out && r.out.diffs));
}

console.log('\n【B】計時歷史');
{
  const merge = extractMerge(HEAD_SRC);
  ok('[B0] mergeHistory 抽得出來', typeof merge === 'function');
  if (typeof merge === 'function') {
    const h = merge({ 'a.mjs': 1000, 't.mjs': 500000, 'keep.mjs': 7 }, [
      { script: 'a.mjs', ms: 2000 }, { script: 't.mjs', ms: 360000, timedOut: true }, { script: 'u.mjs', ms: 120000, timedOut: true },
      { script: 'bad.mjs', ms: 0 }, null,
    ]);
    ok('★★[B1] 一般結果覆寫、逾時與舊值取大（不會把長的歷史縮回逾時值）、新逾時照記、0 毫秒與壞資料略過、沒跑到的保留',
      h['a.mjs'] === 2000 && h['t.mjs'] === 500000 && h['u.mjs'] === 120000 && !('bad.mjs' in h) && h['keep.mjs'] === 7, JSON.stringify(h));
  } else ok('★★[B1] 一般覆寫／逾時取大', false, '抽不到 mergeHistory');
  const p1 = historyDirFor(HEAD_SRC, '/tmp/sb'), p2 = historyDirFor(HEAD_SRC, 'E:\\sb'), p3 = historyDirFor(HEAD_SRC, '/tmp/sb/');
  ok('★★★[B2] 預設歷史目錄在沙盒根之外（rm -rf 沙盒根不會刪到）：/tmp/sb → /tmp/sb-history、E:\\sb → E:\\sb-history、結尾斜線也一樣',
    p1 === '/tmp/sb-history' && p2 === 'E:\\sb-history' && p3 === '/tmp/sb-history', JSON.stringify([p1, p2, p3]));
}

console.log('\n【C】接線');
{
  const C = judgeStatic(HEAD_SRC);
  ok('★★[C1] loadDurations 讀沙盒外的歷史檔，而且排在 --baseline 之前（最新量測優先）', C.C1);
  ok('★★[C2] 報表寫出後立刻呼叫 saveHistory(results)', C.C2);
  ok('★[C3] 預設 workers ＝ min(6, CPU 核數＋1)（--workers 仍可覆寫）', C.C3);
}

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const rb = readBaseBlob(ROOT, BASE_SHA, 'scripts/run-tests.mjs');
  if (rb.ok) {
    const B = rb.out.replace(/\r\n/g, '\n');
    const r = runCompare(B);
    ok('★★★[H1] v6.517 的基準比對區段實跑必丟 TDZ 例外（而不是抽不到）', !r.missing && !!r.err && /before initialization/.test(String(r.err.message)), r.err ? r.err.message : JSON.stringify(r));
    const S = judgeStatic(B);
    ok('★★[H2] v6.517：沒有 mergeHistory、沒有預設歷史目錄、C1～C3 全紅',
      extractMerge(B) === null && historyDirFor(B, '/tmp/sb') === null && !S.C1 && !S.C2 && !S.C3, JSON.stringify(S));
  } else shallowSkip('runner-baseline-history H', '讀不到 BASE blob');
} else shallowSkip('runner-baseline-history H', '需要 v6.517 commit');

console.log(`\n=== run-tests 基準比對與計時歷史：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
