#!/usr/bin/env node
/**
 * v6.394 守衛：TypeScript 型別檢查必須**零錯誤**（站長裁示 ④「tsc 排一版清」）。
 *
 * 【為什麼要有這一支】
 * v6.394 之前 `tsc --noEmit` 長期有 55 條錯誤。55 條的噪音有兩個後果：
 *   ① 新寫的程式碼再加一條錯誤沒有人會發現（判準等於不存在）；
 *   ② 裡面混著真的問題（半成品的 CardInstance、少打一個 `?` 會丟 TypeError 的樣板字串、
 *      宣告了卻沒接上中央閘的白名單），全部被噪音蓋住。
 *
 * 【判準】
 *   A1 ⭐⭐⭐ 行為層：實際跑 tsc，錯誤數必須是 0。
 *      ⚠ 這裡**不 pin 數字**（不寫「必須 ≤ 55」之類）—— Rule 40：判準往上移，不放寬。
 *   A1b ★ 正對照：偵測器餵人造輸出必須命中；A1c ★ 反對照：乾淨輸出不得誤命中。
 *      ⚠ 正對照**不依賴任何實體檔案** —— v6.393a 的教訓（靠一支未追蹤的檔撐著 ⇒ 本機綠、CI 紅）。
 *   B1 ⭐⭐ 資料層：static/cards 的 supertype 只能是 Pokemon／Trainer／Energy（或缺欄）。
 *      v6.394 移除了兩處 `card.supertype !== 'Pokémon'`（帶重音）的死比較，
 *      現查 48 個檔 5511 張卡一張都沒有 —— 這一條就是接手那個死比較的判準：
 *      資料哪天真的出現帶重音的值，紅的是這裡，不是靜默漏判。
 *   C1 ⭐ isMegaExCard 的回傳型別必須是 boolean（不可以改回型別述詞 `c is Card`）。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46
let pass = 0, fail = 0;
const chk = (name, ok, extra = '') => {
  if (ok) { pass++; console.log('  PASS ' + name); return true; }
  fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : ''));
  return false;
};

/** tsc 輸出 → 錯誤行陣列。單一判準，A1／A1b／A1c 共用（Rule 38）。 */
const tscErrors = (out) => String(out).split(/\r?\n/).filter((l) => /error TS\d+/.test(l));

// ═══════════════════════════════════════════════════════════════════════════
console.log('【A】⭐⭐⭐ 行為層：tsc --noEmit 必須零錯誤');
// ═══════════════════════════════════════════════════════════════════════════
const TSC = join(ROOT, 'node_modules/typescript/bin/tsc');
chk('A0 ★ 哨兵：找得到 typescript 編譯器（否則整節是空轉）', existsSync(TSC), TSC);

let tscOut = '';
let tscThrew = false;
try {
  tscOut = execFileSync(process.execPath, [TSC, '--noEmit', '-p', join(ROOT, 'tsconfig.json')],
    { cwd: ROOT, maxBuffer: 1 << 26, timeout: 600000 }).toString('utf8');
} catch (e) {
  tscThrew = true;
  tscOut = String((e.stdout && e.stdout.toString()) || '') + String((e.stderr && e.stderr.toString()) || '');
}
const errs = tscErrors(tscOut);
chk('A1 ⭐⭐⭐ tsc --noEmit 零錯誤（不 pin 數字：多一條就紅）',
  errs.length === 0, errs.length + ' 條，前 5 條：\n      ' + errs.slice(0, 5).join('\n      '));
chk('A1a ★ tsc 本身要跑得起來（exit 非 0 但又抓不到 error TS ⇒ 是工具壞了，不是程式碼乾淨）',
  !tscThrew || errs.length > 0, 'tsc 以非 0 結束卻沒有任何 error TS 行：' + tscOut.slice(-300));

// ★ 正／反對照：餵人造字串給同一個偵測器（不碰任何實體檔案）
const PROBE_BAD = "src/lib/game/engine.ts(1,1): error TS2322: Type 'a' is not assignable to type 'b'.";
const PROBE_OK = "src/lib/game/engine.ts:1:1 - 這只是一行普通輸出，沒有錯誤";
chk('A1b ★ 正對照：偵測器對「一行真的 tsc 錯誤」必定命中', tscErrors(PROBE_BAD).length === 1);
chk('A1c ★ 反對照：偵測器對「乾淨的輸出」不得命中（擋住恆真式）', tscErrors(PROBE_OK).length === 0);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【B】⭐⭐ 資料層：supertype 的值域（接手 v6.394 移除的那條死比較）');
// ═══════════════════════════════════════════════════════════════════════════
{
  const DIR = join(ROOT, 'static/cards');
  const ALLOWED = new Set(['Pokemon', 'Trainer', 'Energy']);
  const seen = new Map();
  let files = 0, cards = 0;
  for (const n of readdirSync(DIR)) {
    if (!n.endsWith('.json')) continue;
    let j;
    try { j = JSON.parse(readFileSync(join(DIR, n), 'utf8')); } catch { continue; }
    const arr = Array.isArray(j) ? j : (Array.isArray(j.cards) ? j.cards : null);
    if (!arr) continue;
    files++;
    for (const c of arr) {
      cards++;
      const v = c && c.supertype;
      if (v === undefined || v === null) continue;   // 缺欄（v6.394 現查 44 張）本來就走 !== 'Pokemon' 的 false 路徑
      if (!ALLOWED.has(v)) seen.set(v, (seen.get(v) || 0) + 1);
    }
  }
  chk('B0 ★ 哨兵：真的掃到卡（否則「沒有壞值」只是因為沒掃到東西）', files >= 40 && cards >= 5000, files + ' 檔 / ' + cards + ' 張');
  chk('B1 ⭐⭐ supertype 只有 Pokemon／Trainer／Energy（或缺欄）—— 出現別的值就要回頭看那兩處述詞',
    seen.size === 0, JSON.stringify([...seen]));
  // ★ 正對照：同一套判準餵一張人造的壞卡必須抓到
  const probe = { supertype: 'Pok\u00e9mon' };
  chk('B1b ★ 正對照：人造一張 supertype 帶重音的卡，判準必須抓到（不靠實體檔案）',
    probe.supertype !== undefined && !ALLOWED.has(probe.supertype));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【C】⭐ 不要再把 isMegaExCard 改回型別述詞');
// ═══════════════════════════════════════════════════════════════════════════
{
  const SF = readFileSync(join(ROOT, 'src/lib/game/selection-filter.ts'), 'utf8');
  const m = /export function isMegaExCard\(c: Card \| undefined\): ([^{]+)\{/.exec(SF);
  chk('C0 ★ 哨兵：找得到 isMegaExCard 的簽章', !!m, m ? m[1].trim() : '(找不到)');
  chk('C1 ⭐ 回傳型別是 boolean，不是型別述詞（述詞會讓呼叫端的 else 分支被窄成 never）',
    !!m && m[1].trim() === 'boolean', m ? m[1].trim() : '');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n【D】chain');
// ═══════════════════════════════════════════════════════════════════════════
{
  const pkg = readFileSync(join(ROOT, 'package.json'), 'utf8');
  chk('D1 本守衛已掛進 npm test chain', pkg.includes('test-v6394-tsc-clean.mjs'));
}

console.log('\n=== v6.394 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail ? 1 : 0);