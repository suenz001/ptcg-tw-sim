#!/usr/bin/env node
/**
 * v6.440 守衛：首頁「權利人聯絡管道」改走意見回饋，不再露出信箱
 *
 * 站長交辦（2026-09-29）：「點此來信」原本是 mailto 到站長信箱，但站長不常收信 ⇒
 *   改成與「💬 意見回饋｜點此提交意見 →」同一個入口（開同一個 showFeedbackModal），
 *   站長只要到 admin 的意見回饋頁看就好。
 *
 * 判準
 *   [HEAD-FAIL] 首頁不得再有任何 mailto 連結（BASE 有一個 ⇒ 必紅）。
 *   [HEAD-FAIL] 「權利人聯絡管道」那一段有一顆按鈕，onclick 開的是**同一個** showFeedbackModal
 *               （不是另做一個視窗 —— 判準只有一份，送出後同樣進 feedbacks 集合、admin 同一頁看得到）。
 *   [正對照]    原本「💬 意見回饋」的按鈕仍在、仍開同一個 modal。
 *
 * Run: node scripts/test-v6440-rights-contact-feedback.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src/routes/+page.svelte'), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const OPEN = 'onclick={() => showFeedbackModal = true}';
ok('[前提] 首頁讀得到，且有意見回饋視窗', SRC.length > 20000 && SRC.includes('{#if showFeedbackModal}'), String(SRC.length));
ok('★★★[HEAD-FAIL] 首頁不再有任何 mailto 連結', !/mailto:/i.test(SRC), String((SRC.match(/mailto:/gi) || []).length));
ok('★★[HEAD-FAIL] 首頁不再直接露出站長信箱', !SRC.includes('suenz001@yahoo.com.tw'));

// 「權利人聯絡管道」標題之後、</footer> 之前的那一段
const h = SRC.indexOf('<h4 class="disclaimer-section">權利人聯絡管道</h4>');
const f = SRC.indexOf('</footer>', h);
ok('[前提] 找得到「權利人聯絡管道」段落', h > 0 && f > h);
const seg = h > 0 && f > h ? SRC.slice(h, f) : '';
ok('★★★[HEAD-FAIL] 權利人段落的按鈕開的是同一個意見回饋視窗（showFeedbackModal）',
  seg.includes('<button class="link-btn" ' + OPEN + '>'), seg.slice(0, 300));
ok('★[文字] 權利人段落的連結文字是「點此提交意見」', seg.includes('>點此提交意見</button>'));

// 正對照：原本的意見回饋入口不變
const fs = SRC.indexOf('<section class="feedback-section">');
const fe = SRC.indexOf('</section>', fs);
ok('[正對照] 「💬 意見回饋」區塊的按鈕仍開同一個視窗',
  fs > 0 && SRC.slice(fs, fe).includes('<button class="link-btn" ' + OPEN + '>點此提交意見 →</button>'));
ok('[正對照] 開啟意見回饋視窗的按鈕恰好兩顆（意見回饋區＋權利人段落）', SRC.split(OPEN).length - 1 === 2, String(SRC.split(OPEN).length - 1));

console.log(`\n=== v6.440 權利人聯絡改走意見回饋: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END v6440-rights-contact-feedback ===');
process.exit(fail ? 1 : 0);
