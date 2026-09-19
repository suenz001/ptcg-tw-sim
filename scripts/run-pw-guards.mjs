#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// scripts/run-pw-guards.mjs —— 只把「帶 Playwright 段」的守衛跑一遍（CI 過渡期用）
//
// 【為什麼需要它】
//   2026-09-19 才第一次在 CI 上裝瀏覽器。在那之前那 10 支守衛的 PW 段從實裝那天起
//   **一次都沒有執行過**。一打開就發現會紅（test-v6301 的 375×812 版面量測），而那些
//   紅燈要逐條判「真退化 vs 環境相依（Rule 40 上移判準）」，不能讓它們先擋住 deploy。
//   ⇒ 過渡期：主 chain 用 `PTCG_PW=off` 維持原狀，這一支用 `PTCG_PW=strict` 真的跑一遍，
//     掛在 `continue-on-error: true` 的獨立 step 上，把結果攤開來看。
//
// 【清單是掃出來的，不是寫死的】
//   判準＝「這支守衛有沒有 import 中央閘 scripts/lib/pw.mjs」。
//   ⚠ 寫死檔名清單會在新增守衛時靜默失效（安慰劑型態 9）。
//   ⚠ 下限斷言：掃到的支數少於 MIN_PW_GUARDS ⇒ 直接失敗，不要退化成「一支都沒跑 ⇒ 全綠」
//     （安慰劑型態 4：空真）。
//
// 【⭐ 這一支自己不進 npm test chain】
//   它會真的開瀏覽器，而 chain 是 `&&` 串起來的阻擋路徑。
//   `scripts/test-pw-gate.mjs` 在守「它存在、而且 deploy.yml 真的有引用它」。
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseChain } from './lib/chain-parse.mjs';
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));   // Rule 46

/** 下限：掃到的 PW 守衛少於這個數 ⇒ 掃描器壞了（或有人把中央閘拆了）。 */
export const MIN_PW_GUARDS = 10;

/**
 * 判準只有一份：正式路徑與 test-pw-gate 的正反對照都呼叫它。
 * ⚠ 光看「有沒有 import ./lib/pw.mjs」不夠 —— `test-pw-gate.mjs` 自己也 import 它
 *   （拿 `pwMode`／`PW_DEFAULT_MODE` 來驗過渡期把手），但它**不會開瀏覽器**，
 *   算進來就會讓這支 runner 白跑一遍，也讓下限斷言鬆一格（安慰劑型態 4 的近親）。
 *   ⇒ 判準是「有沒有 import **會開瀏覽器的那幾個** export」。
 */
export function usesPwGate(src) {
  const m = /import\s*\{([^}]*)\}\s*from\s*['"]\.\/lib\/pw\.mjs['"]/.exec(normEol(src));
  if (!m) return false;
  return /\b(pwChromium|pwLaunch|pwLaunchWith|pwUsable)\b/.test(m[1]);
}

/** 掃出 chain 上所有「走中央閘」的守衛（相對路徑，正斜線）。 */
export function listPwGuards(root = ROOT) {
  const PKG = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const chain = parseChain(String((PKG.scripts && PKG.scripts.test) || ''));
  const hit = [];
  for (const rel of chain.uniq) {
    if (!/^scripts\/test-/.test(rel)) continue;
    let src = '';
    try { src = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
    if (usesPwGate(src)) hit.push(rel);
  }
  return hit;
}

// ── 被 import 時只當函式庫用，不要真的跑 ────────────────────────────────
const RUN_DIRECTLY = process.argv[1] && /run-pw-guards\.mjs$/.test(process.argv[1].replace(/\\/g, '/'));
if (RUN_DIRECTLY) {
  const list = listPwGuards();
  console.log(`\n【PW 守衛】掃到 ${list.length} 支（下限 ${MIN_PW_GUARDS}）  PTCG_PW=${process.env.PTCG_PW || '(預設)'}`);
  for (const r of list) console.log('  ・' + r);
  if (list.length < MIN_PW_GUARDS) {
    console.error(`\n✗ 只掃到 ${list.length} 支，少於下限 ${MIN_PW_GUARDS} —— 掃描器壞了，或有人把中央閘拆了。`);
    process.exit(2);
  }
  const bad = [];
  for (const rel of list) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [join(ROOT, rel)],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 27, timeout: 600000 });
    const out = String(r.stdout || '') + String(r.stderr || '');
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const ok = r.status === 0;
    if (!ok) bad.push({ rel, code: r.status, tail: out.slice(-2500) });
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${rel.replace('scripts/', '').padEnd(46)} ${secs}s  exit=${r.status}`);
  }
  if (bad.length) {
    console.log(`\n────── 紅燈 ${bad.length} 支（過渡期：這個 step 是 continue-on-error）──────`);
    for (const b of bad) {
      console.log(`\n### ${b.rel}  exit=${b.code}`);
      console.log(b.tail);
    }
  }
  console.log(`\n=== PW 守衛：${list.length - bad.length} / ${list.length} 支綠 ===`);
  process.exit(bad.length ? 1 : 0);
}
